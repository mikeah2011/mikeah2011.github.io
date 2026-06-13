---
title: Developer Environment as Code 实战：Devbox + devcontainer + Nix 的开发环境一致性
date: 2026-06-09 20:09:00
categories:
- devops
tags:
- Devbox
- DevContainer
- Nix
- Docker
- 开发环境
- 环境一致性
description: 从'在我机器上能跑'到'在所有机器上都能跑'——用 Devbox + devcontainer + Nix 构建可复现的开发环境，彻底解决环境差异问题。
---

## 前言：那个经典的开发者困境

每个开发团队都经历过这样的场景：

- 新同事入职，花了两天配环境，装了一堆依赖，最后发现版本不对
- 测试环境跑得飞快的代码，到了同事机器上报 `segmentation fault`
- `composer install` 在你的 macOS 上没问题，到 Linux CI 上炸了
- "在我机器上能跑啊"——这句话成了团队里最令人头疼的玩笑

问题的根源很简单：**开发环境不是代码的一部分**。我们用 Git 管理了源码、配置、文档，却把最基础的运行环境留给了"手动配置"。

今天介绍三个工具的组合拳：**Nix + Devbox + devcontainer**，把开发环境本身变成可版本控制、可复现、可共享的代码。

## 一、核心概念：什么是 Developer Environment as Code

### 1.1 传统方案的痛点

| 方案 | 优点 | 致命缺陷 |
|------|------|----------|
| README 手动安装步骤 | 零学习成本 | 依赖人的执行力，无法保证一致 |
| Docker Compose | 容器隔离 | 开发体验差，热重载慢，IDE 集成差 |
| Vagrant/VM | 完全隔离 | 资源占用大，启动慢 |
| asdf/mise | 版本管理 | 只管运行时版本，不管系统依赖 |

### 1.2 三层架构

我们采用的方案分三层：

```
┌─────────────────────────────────────────┐
│           devcontainer.json             │  ← IDE/编辑器集成层
│    (VS Code / Cursor / GitHub Codespaces)│
├─────────────────────────────────────────┤
│              Dockerfile                 │  ← 容器基础层
│         (基于 devcontainer 镜像)         │
├─────────────────────────────────────────┤
│    devbox.json + Nix flakes             │  ← 包管理层
│  (精确版本锁定，跨平台一致)               │
└─────────────────────────────────────────┘
```

- **Nix**：底层包管理器，保证每个包的版本、依赖、构建参数完全一致
- **Devbox**：Nix 的友好封装，用简单的 JSON 配置替代复杂的 Nix 表达式
- **devcontainer**：VS Code/Cursor 的开发容器标准，让 IDE 在容器内运行

## 二、Devbox 快速上手

### 2.1 安装 Devbox

```bash
# macOS / Linux
curl -fsSL https://get.jetify.com/devbox | bash

# 验证安装
devbox version
```

### 2.2 初始化项目

```bash
cd ~/my-laravel-project
devbox init
```

这会生成一个 `devbox.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/jetify-com/devbox/0.14.0/.schema/devbox.schema.json",
  "packages": [],
  "shell": {
    "init_hook": [
      "echo 'Welcome to devbox!'"
    ],
    "scripts": {
      "test": "echo \"Error: no test specified\" && exit 1"
    }
  }
}
```

### 2.3 配置 Laravel 项目

编辑 `devbox.json`，添加我们需要的 PHP 环境和工具：

```json
{
  "$schema": "https://raw.githubusercontent.com/jetify-com/devbox/0.14.0/.schema/devbox.schema.json",
  "packages": [
    "php83@8.3.12",
    "php83Extensions.pdo@8.3.12",
    "php83Extensions.mbstring@8.3.12",
    "php83Extensions.xml@8.3.12",
    "php83Extensions.curl@8.3.12",
    "php83Extensions.zip@8.3.12",
    "php83Extensions.bcmath@8.3.12",
    "php83Extensions.intl@8.3.12",
    "php83Extensions.redis@6.0.2",
    "composer@2.8.1",
    "nodejs@22.11.0",
    "mysql80@8.0.40",
    "redis@7.4.1"
  ],
  "env": {
    "PHP_EXTENSIONS": "pdo,mbstring,xml,curl,zip,bcmath,intl,redis"
  },
  "shell": {
    "init_hook": [
      "export DATABASE_URL=\"mysql://root@localhost:3306/laravel\"",
      "echo '🚀 Laravel dev environment ready!'"
    ],
    "scripts": {
      "setup": "composer install && php artisan key:generate && php artisan migrate",
      "serve": "php artisan serve --host=0.0.0.0 --port=8000",
      "test": "php artisan test",
      "pint": "vendor/bin/pint",
      "stan": "vendor/bin/phpstan analyse"
    }
  }
}
```

### 2.4 启动开发环境

```bash
# 首次启动（会下载 Nix 包，可能需要几分钟）
devbox shell

# 现在你在一个完全隔离的 shell 里
php -v        # PHP 8.3.12
composer -V   # Composer 2.8.1
node -v       # v22.11.0
mysql --version  # mysql  Ver 8.0.40

# 运行项目设置脚本
devbox run setup

# 启动开发服务器
devbox run serve
```

### 2.5 Nix 包搜索

找不到想要的包？用 `devbox search`：

```bash
# 搜索 PHP 扩展
devbox search php83Extensions

# 搜索特定工具
devbox search nginx
devbox search imagemagick

# 查看包的可用版本
devbox search php --show-all
```

## 三、集成 devcontainer

### 3.1 为什么需要 devcontainer

Devbox 解决了包管理的一致性，但开发体验还差一环：

- 你用 VS Code / Cursor，同事用 JetBrains
- 系统库版本不同（libssl、libcurl 等）
- 端口映射、文件挂载需要手动配置

devcontainer 是 VS Code 团队定义的标准，让 IDE 在容器内运行，**编辑器感知到的是容器里的环境**。

### 3.2 配置 devcontainer

在项目根目录创建 `.devcontainer/devcontainer.json`：

```json
{
  "name": "Laravel Devbox",
  "build": {
    "dockerfile": "Dockerfile",
    "context": ".."
  },
  "features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "bmewburn.vscode-intelephense-client",
        "ms-azuretools.vscode-docker",
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "streetsidesoftware.code-spell-checker",
        "editorconfig.editorconfig"
      ],
      "settings": {
        "php.validate.executablePath": "/usr/bin/php",
        "php.suggestBasic": false,
        "intelephense.environment.phpVersion": "8.3.0"
      }
    }
  },
  "forwardPorts": [8000, 3306, 6379],
  "postCreateCommand": "devbox run setup",
  "postStartCommand": "devbox run serve &",
  "remoteUser": "vscode"
}
```

### 3.3 Dockerfile

创建 `.devcontainer/Dockerfile`：

```dockerfile
FROM mcr.microsoft.com/devcontainers/base:ubuntu

# 安装 Devbox
RUN curl -fsSL https://get.jetify.com/devbox | bash

# 复制 devbox 配置
COPY devbox.json /workspace/devbox.json

# 预安装 Nix 包（利用 Docker 缓存层）
WORKDIR /workspace
RUN devbox install

# 设置 MySQL 数据目录
RUN mkdir -p /var/lib/mysql && chown vscode:vscode /var/lib/mysql

USER vscode
```

### 3.4 使用方式

**VS Code / Cursor：**

1. 安装 `Dev Containers` 扩展
2. 打开项目文件夹
3. `Cmd+Shift+P` → `Dev Containers: Reopen in Container`
4. 等待构建完成，IDE 自动连接到容器内

**GitHub Codespaces：**

推送到 GitHub 后，任何人点击 `Code → Codespaces → Create codespace` 即可获得完全相同的开发环境，**零配置**。

**JetBrains（GoLand / PhpStorm）：**

JetBrains 也支持 devcontainer，通过 `Remote Development → Dev Containers` 连接。

## 四、实战：完整的 Laravel 项目配置

### 4.1 最终目录结构

```
my-laravel-project/
├── .devcontainer/
│   ├── devcontainer.json
│   └── Dockerfile
├── .docker/
│   └── mysql/
│       └── init.sql          # 数据库初始化脚本
├── devbox.json                # Devbox 配置
├── devbox.lock                # 自动生成，锁文件
├── .env.example
├── composer.json
├── artisan
└── ...
```

### 4.2 MySQL 初始化脚本

`.docker/mysql/init.sql`：

```sql
CREATE DATABASE IF NOT EXISTS `laravel` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `laravel_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建开发用用户（可选）
CREATE USER IF NOT EXISTS 'dev'@'localhost' IDENTIFIED BY 'dev';
GRANT ALL PRIVILEGES ON `laravel`.* TO 'dev'@'localhost';
GRANT ALL PRIVILEGES ON `laravel_test`.* TO 'dev'@'localhost';
FLUSH PRIVILEGES;
```

### 4.3 devbox.json 完整版

```json
{
  "$schema": "https://raw.githubusercontent.com/jetify-com/devbox/0.14.0/.schema/devbox.schema.json",
  "packages": [
    "php83@8.3.12",
    "php83Extensions.pdo@8.3.12",
    "php83Extensions.mbstring@8.3.12",
    "php83Extensions.xml@8.3.12",
    "php83Extensions.curl@8.3.12",
    "php83Extensions.zip@8.3.12",
    "php83Extensions.bcmath@8.3.12",
    "php83Extensions.intl@8.3.12",
    "php83Extensions.redis@6.0.2",
    "php83Extensions.gd@8.3.12",
    "php83Extensions.exif@8.3.12",
    "composer@2.8.1",
    "nodejs@22.11.0",
    "mysql80@8.0.40",
    "redis@7.4.1",
    "nginx@1.27.2",
    "imagemagick@7.1.1-38"
  ],
  "env": {
    "APP_ENV": "local",
    "APP_DEBUG": "true",
    "DB_CONNECTION": "mysql",
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "3306",
    "DB_DATABASE": "laravel",
    "DB_USERNAME": "root",
    "DB_PASSWORD": "",
    "REDIS_HOST": "127.0.0.1",
    "REDIS_PORT": "6379"
  },
  "shell": {
    "init_hook": [
      "export PATH=\"$DEVBOX_PROJECT_ROOT/vendor/bin:$PATH\"",
      "[ -f .env ] && source .env 2>/dev/null || true",
      "echo ''",
      "echo '  ╔══════════════════════════════════════╗'",
      "echo '  ║   Laravel Development Environment    ║'",
      "echo '  ║   PHP $(php -r 'echo PHP_VERSION;')                      ║'",
      "echo '  ╚══════════════════════════════════════╝'",
      "echo ''"
    ],
    "scripts": {
      "setup": [
        "echo '📦 Installing PHP dependencies...'",
        "composer install --no-interaction",
        "echo '🔑 Generating app key...'",
        "php artisan key:generate --force",
        "echo '🗄️  Running migrations...'",
        "php artisan migrate --force",
        "echo '🌱 Seeding database...'",
        "php artisan db:seed --force || true",
        "echo '🔗 Installing Node dependencies...'",
        "npm install",
        "echo '✅ Setup complete!'"
      ],
      "serve": "php artisan serve --host=0.0.0.0 --port=8000",
      "queue": "php artisan queue:work --sleep=3 --tries=3 --max-time=3600",
      "vite": "npm run dev",
      "test": [
        "php artisan test --parallel"
      ],
      "pint": "vendor/bin/pint",
      "stan": "vendor/bin/phpstan analyse --memory-limit=2G",
      "rector": "vendor/bin/rector process --dry-run",
      "fresh": [
        "php artisan migrate:fresh --seed --force"
      ],
      "tinker": "php artisan tinker",
      "logs": "tail -f storage/logs/laravel.log"
    }
  }
}
```

### 4.4 一键启动

```bash
# 新同事入职，只需三步：
git clone git@github.com:team/my-laravel-project.git
cd my-laravel-project
devbox run setup

# 或者用 VS Code 打开，自动进入 devcontainer
code .
# → Cmd+Shift+P → Reopen in Container
```

## 五、踩坑记录与解决方案

### 5.1 Nix 包下载慢

**问题**：首次 `devbox shell` 或 `devbox install` 下载 Nix 包很慢。

**解决**：

```bash
# 方案1：配置 Nix 二进制缓存镜像（国内用户）
# ~/.config/nix/nix.conf
substituters = https://mirrors.tuna.tsinghua.edu.cn/nix-channels/store https://cache.nixos.org

# 方案2：项目级配置
# devbox.json 添加
{
  "nixpkgs": {
    "url": "github:NixOS/nixpkgs/nixpkgs-unstable"
  }
}
```

### 5.2 PHP 扩展找不到

**问题**：`devbox search php83Extensions` 找不到某个扩展。

**解决**：

```bash
# 搜索完整的扩展名（有些扩展名和 PECL 不一样）
devbox search php83Extensions | grep -i imagick
# 可能是 php83Extensions.imagick 而不是 php83Extensions.imagick_php

# 如果 Nix 确实没有，可以用 composer 包替代
# 例如：没有 php83Extensions.swoole，可以用：
composer require swoole/swoole
# 或者在 devbox.json 中通过 env 配置编译参数
```

### 5.3 MySQL socket 路径问题

**问题**：MySQL 启动后，PHP 连接报 `No such file or directory`。

**解决**：

```bash
# MySQL socket 默认在 Nix store 里，需要手动指定
# devbox.json 的 init_hook 中添加：
"mkdir -p /tmp/mysql && mysqld --datadir=/tmp/mysql --socket=/tmp/mysql.sock --initialize-insecure --user=$(whoami) 2>/dev/null || true",
"mysqld --datadir=/tmp/mysql --socket=/tmp/mysql.sock --port=3306 --user=$(whoami) &",
"sleep 2"

# PHP 连接时指定 socket：
"DB_UNIX_SOCKET": "/tmp/mysql.sock"
```

### 5.4 devcontainer 内权限问题

**问题**：容器内创建的文件属于 root，宿主机上需要 sudo 才能编辑。

**解决**：

```dockerfile
# Dockerfile 中确保使用 vscode 用户
USER vscode

# 并且挂载卷时设置正确的权限
# devcontainer.json 中添加：
"mounts": [
  "source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=cached"
],
"remoteUser": "vscode"
```

### 5.5 IDE 插件不识别 Nix 路径

**问题**：Intelephense / PHPStan 找不到 Nix 管理的 PHP 二进制。

**解决**：

```json
// devcontainer.json 中显式指定路径
"customizations": {
  "vscode": {
    "settings": {
      "php.validate.executablePath": "/nix/store/xxx-php-8.3.12/bin/php",
      "phpstan.phpPath": "/nix/store/xxx-php-8.3.12/bin/php"
    }
  }
}

// 或者更优雅的方式：使用 devbox 的 PATH
// init_hook 中确保 PATH 正确：
"export PATH=\"$DEVBOX_PACKAGES_DIR/bin:$PATH\""
```

### 5.6 多人协作时 lock 文件冲突

**问题**：`devbox.lock` 频繁冲突。

**解决**：

```bash
# .gitattributes 中配置合并策略
devbox.lock merge=ours

# 或者更简单的做法：lock 文件确实应该提交
# 它保证了所有人用完全相同的包版本
# 冲突时接受最新的那个：
git checkout --theirs devbox.lock
devbox install
```

## 六、高级用法

### 6.1 多项目共享配置

多个 Laravel 项目可以共享基础配置：

```json
// 项目 A 的 devbox.json
{
  "packages": [
    "php83@8.3.12",
    // ... 基础 PHP 包
    "nodejs@22.11.0"
  ],
  "includes": [
    "path:../shared-devbox/php-laravel.json"
  ]
}

// shared-devbox/php-laravel.json
{
  "packages": [
    "php83Extensions.pdo@8.3.12",
    "php83Extensions.mbstring@8.3.12",
    "composer@2.8.1"
  ]
}
```

### 6.2 与 CI/CD 集成

devbox 不仅用于本地开发，也可以用在 CI 中：

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Devbox
        uses: jetify-com/devbox-install-action@v0.12.0

      - name: Run tests
        run: |
          devbox run setup
          devbox run test

      - name: Code style
        run: devbox run pint -- --test

      - name: Static analysis
        run: devbox run stan
```

### 6.3 自定义 Nix 包

如果 Devbox 仓库没有你需要的包，可以直接在 `devbox.json` 中引用 Nix flake：

```json
{
  "packages": [
    "php83@8.3.12",
    "path:./nix-packages/custom-tool.nix"
  ]
}
```

`nix-packages/custom-tool.nix`：

```nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "custom-tool";
  version = "1.0.0";
  src = pkgs.fetchFromGitHub {
    owner = "someone";
    repo = "custom-tool";
    rev = "v1.0.0";
    sha256 = "sha256-xxxxx";
  };
  buildInputs = [ pkgs.php83 ];
  installPhase = ''
    mkdir -p $out/bin
    cp tool $out/bin/
  '';
}
```

### 6.4 环境变量管理

不同环境使用不同配置：

```json
{
  "shell": {
    "init_hook": [
      "# 根据分支切换环境",
      "BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'main')",
      "if [ \"$BRANCH\" = \"main\" ]; then",
      "  export APP_ENV=production",
      "elif [ \"$BRANCH\" = \"staging\" ]; then",
      "  export APP_ENV=staging",
      "else",
      "  export APP_ENV=local",
      "fi",
      "echo \"Environment: $APP_ENV\""
    ]
  }
}
```

## 七、对比其他方案

### 7.1 Devbox vs asdf/mise

| 特性 | Devbox | asdf/mise |
|------|--------|-----------|
| 包来源 | Nix（数万个包） | 插件生态 |
| 系统依赖 | ✅ 自动处理 | ❌ 只管运行时 |
| 跨平台一致性 | ✅ Nix 保证 | ⚠️ 依赖插件质量 |
| 学习曲线 | 低（JSON 配置） | 低 |
| 锁文件 | ✅ devbox.lock | ✅ .tool-versions |
| 离线使用 | ✅ 有缓存 | ⚠️ 需要预下载 |

### 7.2 Devbox vs Docker 开发

| 特性 | Devbox | 纯 Docker 开发 |
|------|--------|---------------|
| 启动速度 | 秒级 | 分钟级 |
| 磁盘占用 | 小（共享 Nix store） | 大（每项目一个镜像） |
| IDE 集成 | 原生 | 需要 devcontainer |
| 热重载 | 原生速度 | 挂载卷有延迟 |
| 调试体验 | 原生 | 需要远程调试配置 |
| 系统隔离 | 进程级 | 容器级 |

### 7.3 最佳组合

- **个人/小团队**：Devbox 足够，简单直接
- **团队协作**：Devbox + devcontainer，保证 IDE 配置一致
- **严格隔离需求**：devcontainer + Docker，完全容器化
- **大型团队**：Nix flakes + Devbox + devcontainer + CI 集成

## 八、迁移现有项目

### 8.1 从 asdf 迁移

```bash
# 1. 查看当前 .tool-versions
cat .tool-versions
# nodejs 22.11.0
# php 8.3.12

# 2. 初始化 devbox
devbox init

# 3. 转换为 devbox.json
# 手动添加对应包到 devbox.json

# 4. 删除 .tool-versions
rm .tool-versions

# 5. 添加 .gitignore 条目
echo ".devbox/" >> .gitignore
```

### 8.2 从 Docker Compose 迁移

```bash
# 1. 保留 docker-compose.yml 用于生产
# 2. 新建 devbox.json 用于开发
# 3. 逐步将依赖从 Docker 转到 Devbox
# 4. 最终：开发用 devbox，生产用 Docker
```

## 九、团队落地建议

### 9.1 渐进式采用

不要一次性迁移所有项目：

1. **第一周**：在一个新项目上试点 devbox.json
2. **第二周**：加上 devcontainer 配置
3. **第三周**：更新 README，添加快速开始指南
4. **第四周**：分享给团队，收集反馈
5. **之后**：逐步推广到其他项目

### 9.2 配置维护

```bash
# 定期更新包版本
devbox update

# 检查过时的包
devbox outdated

# 更新后测试
devbox run test
```

### 9.3 文档模板

在 README 中添加：

```markdown
## 🚀 快速开始

### 前置条件
- [Devbox](https://www.jetify.com/devbox/docs/installing_devbox/) 已安装
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（可选，用于 devcontainer）

### 本地开发
```bash
git clone git@github.com:team/project.git
cd project
devbox run setup    # 首次运行
devbox run serve    # 启动开发服务器
devbox run test     # 运行测试
```

### VS Code / Cursor 用户
1. 安装 Dev Containers 扩展
2. 打开项目 → Cmd+Shift+P → Reopen in Container
3. 等待自动配置完成
```

## 十、总结

Developer Environment as Code 不是一个新概念，但 Nix 生态让它真正变得可行：

| 维度 | 改善 |
|------|------|
| 新人入职 | 从 2 天 → 10 分钟 |
| 环境问题 | 从"在我机器上能跑" → "所有机器都一样" |
| 依赖管理 | 从"手动装" → `devbox run setup` |
| 版本一致性 | 从"大概差不多" → bit-for-bit 一致 |
| CI 一致性 | 从"CI 环境不同" → 和本地完全一样 |

**核心价值**：

1. **可复现**：任何人、任何时候、任何机器，拿到同一个 commit 就能跑
2. **可版本控制**：环境变更和代码变更一起 review、一起回滚
3. **可共享**：新同事、开源贡献者、面试候选人，零配置上手
4. **可审计**：每个依赖的版本、来源、构建参数都有记录

不要等到"环境问题"再次成为阻碍时才行动。从今天开始，把你的 `devbox.json` 加入项目根目录，把它当作和 `composer.json` 同等重要的配置文件。

---

**相关资源**：

- [Devbox 官方文档](https://www.jetify.com/devbox/docs/)
- [devcontainer 规范](https://containers.dev/)
- [Nix 包搜索](https://search.nixos.org/packages)
- [Devbox GitHub](https://github.com/jetify-com/devbox)
- [devcontainer features](https://github.com/devcontainers/features)
