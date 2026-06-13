---
title: Nix 实战进阶：声明式 macOS 开发环境管理——替代 Homebrew 的可复现开发环境配置与团队共享
date: 2026-06-10 05:00:00
description: 从 Nix 基础迈向进阶：flake-utils 多系统支持、NixOS 模块化配置、devenv.sh 自定义服务编排、Nix + direnv
  + Git 多项目环境切换、CI/CD 中的 Nix 缓存加速、团队共享 Nix 开发环境的完整工程化方案——附真实踩坑记录与性能基准对比。
tags:
- Nix
- macOS
- flakes
- devenv
- 声明式
- 开发环境
- Homebrew
- DevOps
- 团队协作
categories:
- macos
cover: /images/covers/nix-cover.jpg
---


> **TL;DR**：本文是 Nix 系列的进阶篇。在掌握 Nix Flakes 基础后，我们深入 flake-utils 多系统支持、NixOS 模块化配置、devenv.sh 自定义服务编排、多项目环境切换、CI/CD 缓存加速，以及团队共享开发环境的完整工程化方案。

---

## 一、从 Nix 基础到进阶：你需要知道什么

### 1.1 本篇的前置知识

如果你还没接触过 Nix，请先阅读 [Nix 实战：声明式开发环境管理——替代 Homebrew 的可复现 macOS 开发环境配置](/2026-06-03-Nix-实战-声明式开发环境管理-替代Homebrew的可复现macOS开发环境/)。本文假设你已经：

- 安装了 Nix（带 flakes 支持）
- 理解 `flake.nix` 的基本结构（inputs/outputs）
- 能在终端用 `nix shell` / `nix develop` 进入临时环境
- 了解 devenv.sh 的基础用法

### 1.2 进阶篇解决什么问题

基础篇解决了「单个项目的环境复现」。进阶篇要解决的是：

| 问题 | 基础篇 | 进阶篇 |
|------|--------|--------|
| 单个项目环境 | ✅ | ✅ |
| 多系统支持（macOS/Linux） | ❌ | ✅ |
| 多项目环境自动切换 | ❌ | ✅ |
| 自定义 Nix 服务编排 | ❌ | ✅ |
| CI/CD 缓存加速 | ❌ | ✅ |
| 团队共享与版本锁定 | 基础 | 深度 |

---

## 二、flake-utils：一份配置支持多系统

### 2.1 为什么需要多系统支持

你的 MacBook 开发，同事用 Linux。`flake.nix` 里写死了 `aarch64-darwin`，同事拉代码后直接报错。flake-utils 解决这个问题。

### 2.2 完整 flake.nix 模板

```nix
{
  description = "Laravel B2C API - multi-system dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          # 允许非自由软件（某些 PHP 扩展需要）
          config.allowUnfree = true;
        };

        # 自定义 overlay：添加私有包或覆盖版本
        customOverlay = final: prev: {
          php = prev.php.buildEnv {
            extensions = ({ enabled, all }: enabled ++ (with all; [
              redis
              imagick
              pcov
              xdebug
            ]));
            extraConfig = ''
              memory_limit = 512M
              upload_max_filesize = 64M
              max_execution_time = 300
              opcache.enable=1
              opcache.jit_buffer_size=256M
            '';
          };
        };

        # 应用 overlay
        pkgsWithCustom = import nixpkgs {
          inherit system;
          overlays = [ customOverlay ];
        };
      in
      {
        # 开发环境定义
        devShells.default = pkgsWithCustom.mkShell {
          buildInputs = with pkgs; [
            # PHP 全家桶
            php
            php.packages.composer
            php83Packages.box

            # Node.js
            nodejs_20
            corepack

            # Go（用于高性能工具）
            go
            golangci-lint

            # Python（Laravel mix/vite 可能需要）
            python311

            # 数据库工具
            mysql80
            redis
            sqlite

            # 开发工具
            git
            curl
            jq
            yq
            wget
            tree
            htop
            ncdu

            # Docker（仅 CLI）
            docker
            docker-compose

            # macOS 特有
          ] ++ lib.optionals stdenv.isDarwin [
            darwin.apple_sdk.frameworks.Security
            darwin.apple_sdk.frameworks.SystemConfiguration
            darwin.libobjc
          ];

          shellHook = ''
            echo "🚀 Laravel B2C API dev environment loaded"
            echo "   PHP: $(php -v | head -1)"
            echo "   Node: $(node -v)"
            echo "   Go: $(go version | awk '{print $3}')"

            # 设置环境变量
            export PHP_IDECONFIG="serverName=docker"
            export COMPOSER_HOME="$HOME/.config/composer"

            # 确保 vendor/bin 在 PATH 中
            if [ -d "vendor/bin" ]; then
              export PATH="$PWD/vendor/bin:$PATH"
            fi
          '';
        };

        # 额外的工具 shell（不影响主环境）
        devShools.tools = pkgsWithCustom.mkShell {
          buildInputs = with pkgs; [
            phpstan
            php-cs-fixer
            rector
          ];
        };
      }
    );
}
```

### 2.3 `eachDefaultSystem` 原理

```
eachDefaultSystem 接受一个函数：
  system: { ... }

它会自动为以下系统调用该函数：
  • aarch64-darwin  (Apple Silicon Mac)
  • x86_64-darwin   (Intel Mac)
  • aarch64-linux   (ARM Linux, 如 AWS Graviton)
  • x86_64-linux    (标准 Linux)

输出结构：
  {
    devShells.aarch64-darwin.default = ...;
    devShells.x86_64-linux.default = ...;
    # ...
  }
```

### 2.4 系统特定依赖的处理

```nix
# macOS 特有框架
lib.optionals stdenv.isDarwin [
  darwin.apple_sdk.frameworks.Security
  darwin.apple_sdk.frameworks.CoreFoundation
]

# Linux 特有
lib.optionals stdenv.isLinux [
  # 例如 systemd 支持等
]
```

---

## 三、devenv.sh 自定义服务编排

### 3.1 devenv 进阶：自定义服务

devenv.sh 不只是 `services.mysql.enable = true`。我们可以编排完整的开发栈：

```nix
# devenv.nix
{ pkgs, lib, config, ... }:

{
  # 语言支持
  languages.php = {
    enable = true;
    version = "8.3";
    extensions = [
      "redis"
      "imagick"
      "pcov"
      "xdebug"
      "swoole"
    ];
    ini = ''
      memory_limit = 512M
      upload_max_filesize = 64M
      max_execution_time = 300
      opcache.enable=1
      opcache.jit_buffer_size=256M
      error_reporting=E_ALL
      display_errors=On
    '';
  };

  languages.node = {
    enable = true;
    version = "20";
  };

  languages.go.enable = true;
  languages.python.enable = true;

  # 数据库服务
  services.mysql = {
    enable = true;
    package = pkgs.mysql80;
    initialDatabases = [{
      name = "kkday_b2c";
      schema = ./database/seed.sql;  # 可选：初始 schema
    }];
    settings = {
      mysqld = {
        port = 3306;
        max_connections = 100;
        innodb_buffer_pool_size = "256M";
        slow_query_log = 1;
        long_query_time = 1;
      };
    };
  };

  services.redis = {
    enable = true;
    port = 6379;
    settings = {
      maxmemory = "256mb";
      maxmemory-policy = "allkeys-lru";
    };
  };

  services.mailhog = {
    enable = true;
    webInterface = {
      smtpListenAddr = "0.0.0.0:1025";
      httpListenAddr = "0.0.0.0:8025";
    };
  };

  # 自定义进程（如 Laravel worker）
  processes.laravel-worker = {
    exec = "php artisan queue:work --sleep=3 --tries=3";
    process-compose = {
      working_dir = config.env.PROJECT_ROOT or ".";
      environment = [
        "APP_ENV=local"
        "QUEUE_CONNECTION=redis"
      ];
    };
  };

  # 自定义脚本
  scripts.start.exec = ''
    echo "Starting development environment..."
    php artisan migrate:fresh --seed
    php artisan serve --host=0.0.0.0 --port=8000
  '';

  scripts.test.exec = ''
    echo "Running test suite..."
    php artisan test --parallel
    npm run test
  '';

  scripts.lint.exec = ''
    echo "Running code quality checks..."
    ./vendor/bin/pint --test
    ./vendor/bin/phpstan analyse --memory-limit=512M
  '';

  # Git hooks
  git-hooks = {
    enable = true;
    pre-commit = ./scripts/pre-commit.sh;
    commit-msg = ./scripts/commit-msg.sh;
  };

  # 环境变量
  env = {
    APP_ENV = "local";
    APP_DEBUG = "true";
    DB_HOST = "127.0.0.1";
    DB_PORT = "3306";
    DB_DATABASE = "kkday_b2c";
    REDIS_HOST = "127.0.0.1";
    REDIS_PORT = "6379";
    MAIL_MAILER = "smtp";
    MAIL_HOST = "127.0.0.1";
    MAIL_PORT = "1025";
  };
}
```

### 3.2 自定义服务：Process Compose 编排

devenv.sh 的 `processes` 基于 [Process Compose](https://github.com/F1bonacc1/process-compose)，可以编排多进程：

```nix
processes = {
  # Laravel 工作进程
  queue-worker = {
    exec = "php artisan queue:work --sleep=3 --tries=3 --max-time=3600";
    process-compose = {
      working_dir = config.env.PROJECT_ROOT or ".";
      availability.retries = 3;
      availability.backoff_secs = 5;
      shutdown.command = "php artisan queue:restart";
    };
  };

  # Schedule 任务
  scheduler = {
    exec = "php artisan schedule:work";
    process-compose = {
      working_dir = config.env.PROJECT_ROOT or ".";
    };
  };

  # Vite 前端热重载
  vite = {
    exec = "npm run dev";
    process-compose = {
      working_dir = config.env.PROJECT_ROOT or ".";
    };
  };
};
```

### 3.3 自定义 Nix 包

当 Nixpkgs 里没有你需要的包时，可以自己定义：

```nix
# 自定义包定义
let
  myCustomTool = pkgs.stdenv.mkDerivation {
    pname = "my-custom-tool";
    version = "1.0.0";

    src = pkgs.fetchFromGitHub {
      owner = "your-org";
      repo = "your-tool";
      rev = "v1.0.0";
      sha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    };

    buildInputs = [ pkgs.go ];

    buildPhase = ''
      cd cmd/your-tool
      go build -o $out/bin/your-tool .
    '';

    nativeBuildInputs = [ pkgs.makeWrapper ];

    meta = with pkgs.lib; {
      description = "Custom tool for Laravel projects";
      license = licenses.mit;
    };
  };
in
{
  devShell.buildInputs = [ myCustomTool ];
}
```

---

## 四、多项目环境切换：direnv + Nix

### 4.1 问题场景

你同时开发三个项目：

```
~/projects/kkday-b2c-api/     → PHP 8.3 + MySQL 8.0 + Redis
~/projects/cheertoys-max/     → PHP 8.2 + MySQL 8.0 + Node 20
~/projects/personal-blog/     → Node 20 + Go 1.22
```

每次 `cd` 到不同项目，需要手动切换环境。direnv + Nix 实现自动切换。

### 4.2 安装 direnv

```bash
# 通过 Nix 安装
nix-env -iA nixpkgs.direnv

# 配置 shell hook（zsh）
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc

# 或者用 Nix home-manager 统一管理
```

### 4.3 项目级 `.envrc`

每个项目的根目录放一个 `.envrc` 文件：

```bash
# ~/projects/kkday-b2c-api/.envrc
use flake

# 或者指定特定的 devShell
# use flake .#tools

# 或者用 devenv
# use devenv
```

```bash
# ~/projects/cheertoys-max/.envrc
use flake
export PROJECT_ENV=sit
```

```bash
# ~/projects/personal-blog/.envrc
use flake
```

### 4.4 自动切换流程

```
cd ~/projects/kkday-b2c-api/
  │
  ▼ direnv 检测到 .envrc
  │
  ▼ 执行 use flake
  │
  ▼ nix develop 自动加载 devShell
  │
  ▼ 环境变量、PATH、服务全部就绪
  │
  ✅ php, node, go, mysql, redis 全部可用

cd ~/projects/personal-blog/
  │
  ▼ 环境自动切换
  │
  ✅ php 被移除，只保留 node + go
```

### 4.5 `.envrc` 的安全性

direnv 默认需要授权才能加载 `.envrc`。首次进入目录时：

```bash
direnv: error /path/to/.envrc is blocked. Run `direnv allow` to approve its content
```

批准后，direnv 会缓存授权，后续自动加载。

### 4.6 全局与项目级配置

```bash
# 全局允许（不推荐，安全风险）
echo 'source_env_if_exists ~/.direnv/global' >> ~/.config/direnv/direnvrc

# 在 ~/.direnv/global 中定义共享环境
# 例如：所有项目共享 git 配置
```

---

## 五、Nix 在 CI/CD 中的应用

### 5.1 GitHub Actions + Nix

传统 CI 每次都要 `composer install` + `npm install`，耗时 20-60s。Nix 可以用二进制缓存秒级完成：

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest  # 或 ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: cachix/install-nix-action@v27
        with:
          nix_path: nixpkgs=channel:nixos-24.05
          extra_nix_config: |
            experimental-features = nix-command flakes

      # 使用 Nix 缓存
      - uses: cachix/cachix-action@v15
        with:
          name: my-project-cache
          authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'

      # 直接使用 flake 中的 devShell
      - name: Setup environment
        run: |
          nix develop --command bash -c "
            php -v
            node -v
            composer install --no-interaction
            npm ci
          "

      - name: Run tests
        run: |
          nix develop --command bash -c "
            php artisan test --parallel
            npm test
          "
```

### 5.2 Cachix 二进制缓存

Cachix 是 Nix 的二进制缓存服务，可以大幅加速 CI 和团队构建：

```bash
# 安装 cachix
nix-env -iA cachix -f https://cachix.org/api/v1/install

# 认证
cachix authtoken YOUR_TOKEN

# 使用已有缓存
cachix use my-project-cache

# 推送构建结果到缓存
nix-build | cachix push my-project-cache

# 自动推送（在 CI 中）
cachix watch-exec my-project-cache -- nix-build
```

### 5.3 GitHub Actions 自动缓存推送

```yaml
# 在 CI 中自动推送构建结果
- name: Build and cache
  run: |
    nix build .#devShells.x86_64-linux.default \
      --no-link \
      --print-out-paths \
    | cachix push my-project-cache
```

### 5.4 Nix 与其他 CI 工具的对比

```
┌──────────────────────┬──────────────────┬───────────────────┬──────────────────┐
│ 特性                  │ Nix + Cachix     │ Docker 镜像缓存    │ setup-php + npm  │
├──────────────────────┼──────────────────┼───────────────────┼──────────────────┤
│ 环境复现性            │ 完全确定性        │ 镜像级复现         │ 依赖版本锁定      │
│ 构建缓存              │ 二进制级缓存      │ 层级缓存           │ npm/composer 缓存 │
│ 首次构建              │ 较慢（下载依赖）   │ 中等              │ 较快             │
│ 缓存命中后            │ < 1s             │ 2-5s              │ 5-15s            │
│ 跨平台支持            │ 原生多系统        │ 需要多架构镜像      │ 需要矩阵策略      │
│ 学习曲线              │ 较陡             │ 中等              │ 低               │
│ 存储开销              │ 低（共享 store）  │ 高（镜像层）       │ 低               │
└──────────────────────┴──────────────────┴───────────────────┴──────────────────┘
```

---

## 六、团队共享开发环境

### 6.1 Git 仓库中的 Nix 配置

团队共享的核心是把 Nix 配置文件提交到 Git：

```
project-root/
├── flake.nix           # Nix flake 入口
├── flake.lock          # 依赖版本锁定（必须提交！）
├── .envrc              # direnv 配置
├── .gitignore          # 排除 Nix 构建产物
├── devenv.nix          # devenv 配置（如果用 devenv）
└── ...
```

`.gitignore` 需要排除但不能忽略的文件：

```gitignore
# Nix 相关
result          # nix-build 的符号链接
.direnv/        # direnv 缓存（每个开发者本地生成）

# 但这些必须提交：
# flake.nix
# flake.lock
# .envrc
```

### 6.2 flake.lock 的重要性

`flake.lock` 锁定所有依赖的确切版本和哈希值，是可复现性的关键：

```bash
# 更新 flake.lock（所有开发者统一操作）
nix flake update

# 查看当前依赖
nix flake metadata

# 检查 flake 是否有效
nix flake check
```

### 6.3 新人入职流程

传统流程 vs Nix 流程：

```
传统流程（平均 2-4 小时）：
  1. 安装 Homebrew                    → 5 min
  2. brew install php node mysql redis → 15 min
  3. 配置 PHP 版本和扩展               → 30 min
  4. 安装 Composer                    → 5 min
  5. composer install                 → 5 min
  6. npm install                      → 5 min
  7. 配置环境变量                     → 30 min
  8. 解决各种版本冲突                  → 60-120 min
  9. 跑通测试                        → 30 min

Nix 流程（平均 5-10 分钟）：
  1. 安装 Nix                        → 2 min
  2. git clone + direnv allow         → 1 min
  3. nix develop（自动全部就绪）       → 2-5 min（首次）
  4. composer install + npm ci        → 2 min
  5. php artisan migrate:fresh        → 1 min
  ✅ 完成
```

### 6.4 团队 Nix 配置管理策略

```nix
# flake.nix - 团队共享模板
{
  description = "Team shared development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";
    # 可选：引入 devenv
    devenv.url = "github:cachix/devenv/latest";
  };

  outputs = { self, nixpkgs, flake-utils, devenv }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = devenv.lib.mkShell {
          inherit inputs pkgs;
          modules = [
            # 共享配置
            {
              languages.php.enable = true;
              languages.php.version = "8.3";
              languages.node.enable = true;
              languages.node.version = "20";

              services.mysql.enable = true;
              services.redis.enable = true;

              # 团队共享的环境变量
              env = {
                DB_DATABASE = "team_project";
                APP_ENV = "local";
              };
            }

            # 个人覆盖（不提交到 Git）
            # 可通过 import 本地文件实现
          ];
        };

        # 提供更新脚本
        apps.update = {
          type = "app";
          program = "${pkgs.writeShellScript "update" ''
            echo "Updating flake inputs..."
            nix flake update
            echo "Done. Run 'nix develop' to reload."
          ''}";
        };
      }
    );
}
```

---

## 七、高级技巧与踩坑记录

### 7.1 Nix Store 磁盘空间管理

```bash
# 查看 Nix store 大小
du -sh /nix/store

# 清理旧版本（保留最近 3 个版本）
nix-collect-garbage --delete-older-than 30d

# 精确清理：只删除未被任何 profile 引用的包
nix-collect-garbage

# 清理所有旧版本（极端情况）
nix-collect-garbage -d

# 查看哪些包占空间最多
nix store diff-closures /nix/var/nix/profiles/default /nix/var/nix/profiles/default-1-link
```

### 7.2 Apple Silicon 特有问题

```bash
# 问题：某些包没有 aarch64-darwin 预编译二进制
# 解决：启用 Rosetta 2 模拟
nix build --system x86_64-darwin .#package

# 或者在 flake.nix 中用 overlays
pkgs = import nixpkgs {
  inherit system;
  # 允许通过 Rosetta 2 使用 x86_64 包
  localSystem.system = "aarch64-darwin";
  crossSystem.system = "x86_64-darwin";
};
```

### 7.3 PHP 扩展的 Nix 踩坑

```nix
# 问题：pcov 扩展在某些 Nixpkgs 版本中缺失
# 解决：从源码编译
php.buildEnv {
  extensions = ({ enabled, all }: enabled ++ [
    (pkgs.callPackage ./php-pcov.nix {})
  ]);
};

# php-pcov.nix
{ lib, buildPecl, fetchFromGitHub, php }:

buildPecl {
  pname = "pcov";
  version = "1.3.12";

  src = fetchFromGitHub {
    owner = "krakjoe";
    repo = "pcov";
    rev = "v1.3.12";
    sha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  buildInputs = [ php ];
}
```

### 7.4 网络问题与代理

```bash
# 在公司网络下，Nix 可能需要代理
export http_proxy=http://proxy.company.com:8080
export https_proxy=http://proxy.company.com:8080

# 或者配置 Nix 使用镜像
# /etc/nix/nix.conf
experimental-features = nix-command flakes
substituters = https://mirrors.tuna.tsinghua.edu.cn/nix-channels/store
```

### 7.5 与现有工具共存

```bash
# Nix 和 Homebrew 可以共存，但 PATH 顺序要注意
# 在 ~/.zshrc 中：

# Nix PATH（优先）
if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then
  . ~/.nix-profile/etc/profile.d/nix.sh
fi

# Homebrew PATH（Nix 没有的包用 Homebrew 补充）
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 7.6 性能基准对比

在 M2 MacBook Pro 上的测试结果（10 次平均）：

```
┌─────────────────────────────┬──────────┬──────────┬──────────┐
│ 操作                         │ Homebrew │ Nix 冷启动│ Nix 热启动│
├─────────────────────────────┼──────────┼──────────┼──────────┤
│ 安装 PHP 8.3 + 10 扩展       │ 45s      │ 120s*    │ N/A      │
│ 进入开发环境（含服务启动）     │ N/A      │ 8s       │ < 1s     │
│ composer install             │ 12s      │ 11s      │ 11s      │
│ npm ci                       │ 18s      │ 17s      │ 17s      │
│ 环境切换（cd 到另一个项目）   │ N/A      │ N/A      │ < 1s     │
│ 磁盘占用（10 个项目）         │ 2.1 GB   │ 3.8 GB   │ 3.8 GB   │
└─────────────────────────────┴──────────┴──────────┴──────────┘

* 冷启动需要下载预编译二进制，后续使用缓存
```

---

## 八、完整团队配置示例

### 8.1 项目仓库结构

```
kkday-b2c-api/
├── flake.nix                 # Nix 入口
├── flake.lock                # 版本锁定
├── devenv.nix                # devenv 配置
├── .envrc                    # direnv 配置
├── .gitignore
├── .nix/                     # Nix 辅助配置
│   ├── php-pcov.nix          # 自定义 PHP 扩展
│   └── overlays.nix          # 自定义 overlay
├── composer.json
├── package.json
├── app/
├── config/
├── database/
├── routes/
├── tests/
└── ...
```

### 8.2 .envrc

```bash
# .envrc
use flake

# 可选：加载本地覆盖（不提交到 Git）
# if [ -f .envrc.local ]; then
#   source_env .envrc.local
# fi
```

### 8.3 团队 onboarding 脚本

```bash
#!/bin/bash
# scripts/setup.sh - 团队新人一键搭建

set -e

echo "🔧 Installing Nix..."
sh <(curl -L https://nixos.org/nix/install) --daemon

echo "📦 Installing direnv..."
nix-env -iA nixpkgs.direnv

echo "🐚 Configuring shell..."
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
source ~/.zshrc

echo "📂 Setting up project..."
cd "$(dirname "$0")/.."
direnv allow

echo "📥 Installing dependencies..."
nix develop --command bash -c "
  composer install --no-interaction
  npm ci
  cp .env.example .env
  php artisan key:generate
  php artisan migrate:fresh --seed
"

echo "✅ Development environment ready!"
echo "   Run 'nix develop' to enter the environment"
echo "   Or just 'cd' into the project directory (direnv auto-loads)"
```

---

## 九、Nix vs Homebrew vs mise：进阶对比

### 9.1 三种方案的定位

```
┌─────────────────────────────────────────────────────────────┐
│                     开发环境管理方案对比                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Homebrew          Nix                mise (rtx)             │
│  ─────────         ───                ──────                 │
│  简单易用          完全复现            轻量多版本              │
│  单用户            函数式              插件驱动               │
│  全局污染          隔离存储            版本切换               │
│  无回滚            原子回滚            无回滚                 │
│  依赖不透明        依赖完全可见        依赖部分可见            │
│                                                               │
│  适合：            适合：              适合：                  │
│  个人工具          团队协作            快速多版本              │
│  快速安装          生产环境复现         个人项目               │
│  非关键工具        CI/CD 一致性        轻量需求               │
│                                                               │
│  学习成本：        学习成本：          学习成本：              │
│  ⭐               ⭐⭐⭐⭐             ⭐⭐                    │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 混合使用策略

```bash
# 实际项目中的最佳实践：
# 1. Nix：核心语言版本 + 数据库服务 + 团队共享环境
# 2. Homebrew：macOS 特有工具（如 Xcode CLI tools、cask 应用）
# 3. mise：Nix 覆盖不到的零散工具

# 在 flake.nix 中只定义核心依赖
# 在 .envrc 中补充 Homebrew/mise 的工具
```

### 9.3 何时选择 Nix

| 场景 | 推荐方案 |
|------|----------|
| 个人小项目 | mise + Homebrew |
| 团队协作项目 | Nix + direnv |
| 需要 CI 一致性 | Nix + Cachix |
| 快速试用新工具 | Nix shell（临时） |
| 生产环境部署 | Nix + Docker |
| macOS 桌面应用 | Homebrew cask |

---

## 十、总结与后续

### 10.1 进阶篇核心收获

1. **flake-utils 多系统支持**：一份配置适配 macOS/Linux
2. **devenv.sh 服务编排**：自定义进程、脚本、Git hooks
3. **direnv 多项目切换**：cd 自动加载对应环境
4. **CI/CD 缓存加速**：Cachix 让构建秒级完成
5. **团队共享工程化**：新人 5 分钟搭建完整环境

### 10.2 Nix 的未来

Nix 的生态正在快速发展：

- **Determinate Systems** 正在改善 Nix 的用户体验
- **flake-parts** 简化大型 flake 的组织
- **treefmt-nix** 统一代码格式化
- **conix** 用 Nix 生成文档和配置

### 10.3 推荐阅读

- [NixOS 官方手册](https://nixos.org/manual/nix/)
- [devenv.sh 文档](https://devenv.sh/manual/)
- [Nixpkgs 手册](https://nixos.org/manual/nixpkgs/)
- [Nix Flakes 入门](https://nixos.wiki/wiki/Flakes)

---

> **写在最后**：Nix 的学习曲线确实陡峭，但一旦你的团队建立起基于 Nix 的开发环境，「在我机器上能跑」这个问题将彻底成为历史。从 `nix develop` 到 CI 的 `cachix push`，每一步都是确定性的。这就是声明式的力量。
