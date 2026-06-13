---

title: iCloud-vs-Google-Drive-Laravel-项目同步策略备份还原实战踩坑记录
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-05 02:20:35
updated: 2026-05-05 02:22:40
categories:
  - macos
  - php
tags: [DevOps, Laravel, macOS]
keywords: [DevOps, Laravel, macOS, Cloud, Google, Drive]
description: >
---
# iCloud vs Google Drive：Laravel 项目同步策略、备份/还原实战

> 同步不是把文件夹丢进云端就完事了。丢一次 `vendor/` 或 `.env` 就够你喝一壶。

## 为什么需要这个话题？

在 KKday 的日常开发中，我们经常需要在公司 Mac 和家里 Mac 之间切换。两台机器跑同一个 Laravel B2C API 项目，代码用 Git 管理没问题，但有些东西 Git 管不了或不适合管：

- **数据库 dump**（几十 MB 的 `.sql` 文件，不适合提交到 repo）
- **本地 `.env`**（含敏感凭证，被 `.gitignore` 排除）
- **`storage/app` 下的临时文件**（测试用的上传文件、生成的 PDF）
- **IDE 配置**（`.idea/` 或 `.vscode/` 的个人偏好）

这时候就需要一个「Git 之外的同步层」。两个主流选择：**iCloud Drive** 和 **Google Drive**。

---

## 架构总览：同步层该放什么

```
┌─────────────────────────────────────────────────┐
│                   GitHub Repo                    │
│  (代码、migration、seed、config、routes)          │
└──────────────────────┬──────────────────────────┘
                       │ git pull / push
                       ▼
┌─────────────────────────────────────────────────┐
│              本地 Laravel 项目目录                 │
│  ~/GitHub/mikeah2011.github.io/                  │
│  ├── app/            ← Git 管理                  │
│  ├── config/         ← Git 管理                  │
│  ├── .env            ← ❌ .gitignore             │
│  ├── storage/dumps/  ← ❌ 临时 DB dump           │
│  └── .idea/          ← ❌ IDE 偏好               │
└──────────────────────┬──────────────────────────┘
                       │ 同步层（iCloud / Google Drive）
                       ▼
┌─────────────────────────────────────────────────┐
│              云存储同步目录                        │
│  ~/Library/Mobile Documents/ (iCloud)            │
│  或 ~/Google Drive/                              │
│  ├── .env.bak                                    │
│  ├── db-dumps/                                   │
│  ├── ide-settings/                               │
│  └── test-fixtures/                              │
└─────────────────────────────────────────────────┘
```

**核心原则**：Git 管代码，云存储管「代码之外的一切」。

---

## iCloud Drive vs Google Drive：关键差异对比

| 维度 | iCloud Drive | Google Drive (File Stream) |
|------|-------------|---------------------------|
| **macOS 集成** | 原生，Finder 直接显示 | 需要安装 Google Drive.app |
| **符号链接支持** | ⚠️ 不稳定，软链可能断裂 | ✅ 正常跟随 |
| **大文件性能** | 较慢，首次同步有延迟 | 较快，流式下载 |
| **离线访问** | 需手动「保留下载」 | 可设置离线可用 |
| **版本历史** | 30 天内可恢复 | 30 天内可恢复（Google Workspace 更长） |
| **API 访问** | 无公开 API，只能通过文件系统 | 有 Drive API，可编程操作 |
| **跨平台** | Apple 生态为主 | Windows/Linux/macOS 全平台 |
| **存储配额** | 免费 5GB，200GB ¥21/月 | 免费 15GB，100GB ¥15/月 |

### 选型建议

```
如果你的工作流是：
  纯 macOS 生态 + 小文件同步 + 偏好 Finder 集成 → iCloud
  多平台 + 大文件 + 需要脚本自动化 → Google Drive
```

---

## 实战一：项目目录同步策略

### ❌ 错误做法：直接把整个 Laravel 项目放进同步目录

```bash
# 这样做会出大问题！
cp -r ~/GitHub/my-laravel-project ~/Library/Mobile\ Documents/com~apple~CloudDocs/
```

**问题**：
1. `vendor/` 目录有几万个文件，同步极慢且频繁冲突
2. `node_modules/` 同理
3. `.git/` 目录在两台机器间同步会导致 Git 状态混乱
4. `storage/logs/` 大量日志文件持续变化，触发无意义同步

### ✅ 正确做法：只同步「需要跨设备共享的配置和数据」

我写了一个简单的同步脚本：

```bash
#!/bin/bash
# sync-project.sh — Laravel 项目跨设备同步脚本
# 用法: ./sync-project.sh [push|pull]

PROJECT_DIR="$HOME/GitHub/my-laravel-project"
SYNC_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/LaravelSync/my-laravel-project"

# 需要同步的文件/目录列表
SYNC_ITEMS=(
    ".env"
    ".editorconfig"
    ".idea"          # JetBrains IDE 配置
    "storage/dumps"  # 数据库 dump
    "storage/fixtures" # 测试 fixtures
    ".php-cs-fixer.cache"
)

ACTION="${1:-pull}"

mkdir -p "$SYNC_DIR"

sync_item() {
    local item="$1"
    local src="$PROJECT_DIR/$item"
    local dst="$SYNC_DIR/$item"

    if [ "$ACTION" = "push" ]; then
        if [ -e "$src" ]; then
            mkdir -p "$(dirname "$dst")"
            rsync -av --delete "$src" "$dst"
            echo "✅ Pushed: $item"
        fi
    elif [ "$ACTION" = "pull" ]; then
        if [ -e "$dst" ]; then
            mkdir -p "$(dirname "$src")"
            rsync -av --delete "$dst" "$src"
            echo "✅ Pulled: $item"
        fi
    fi
}

for item in "${SYNC_ITEMS[@]}"; do
    sync_item "$item"
done

echo "🎉 Sync complete ($ACTION)"
```

**使用方式**：

```bash
# 在公司 Mac 下班前
./sync-project.sh push

# 到家后打开 Mac
./sync-project.sh pull

# 写完代码，准备回公司
./sync-project.sh push
```

---

## 实战二：数据库备份与还原

这是最痛的场景。本地开发数据库有几十张表、几万条测试数据，手动迁移太痛苦。

### mysqldump + 云同步

```bash
# 备份脚本 backup-db.sh
#!/bin/bash

DB_NAME="kkday_b2c_local"
DB_USER="root"
DB_PASS="secret"
DUMP_DIR="$HOME/GitHub/my-laravel-project/storage/dumps"
SYNC_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/LaravelSync/my-laravel-project/storage/dumps"

mkdir -p "$DUMP_DIR" "$SYNC_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="dump_${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "📦 Dumping database: $DB_NAME"
mysqldump -u"$DB_USER" -p"$DB_PASS" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    "$DB_NAME" | gzip > "$DUMP_DIR/$DUMP_FILE"

# 同步到云存储
cp "$DUMP_DIR/$DUMP_FILE" "$SYNC_DIR/"
echo "✅ Backup: $DUMP_FILE → iCloud"

# 清理 7 天前的旧 dump
find "$DUMP_DIR" -name "dump_*.sql.gz" -mtime +7 -delete
find "$SYNC_DIR" -name "dump_*.sql.gz" -mtime +7 -delete
echo "🧹 Cleaned dumps older than 7 days"
```

### 还原脚本

```bash
# restore-db.sh
#!/bin/bash

DB_NAME="kkday_b2c_local"
DB_USER="root"
DB_PASS="secret"
DUMP_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/LaravelSync/my-laravel-project/storage/dumps"

# 列出可用 dump
echo "📋 Available dumps:"
ls -lt "$DUMP_DIR"/dump_*.sql.gz 2>/dev/null | head -5

# 选择最新或指定文件
DUMP_FILE="${1:-$(ls -t $DUMP_DIR/dump_*.sql.gz | head -1)}"

if [ -z "$DUMP_FILE" ]; then
    echo "❌ No dump file found"
    exit 1
fi

echo "⚠️  This will DROP and recreate: $DB_NAME"
echo "📄 Using: $(basename $DUMP_FILE)"
read -p "Continue? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Dropping existing database..."
    mysql -u"$DB_USER" -p"$DB_PASS" -e "DROP DATABASE IF EXISTS $DB_NAME; CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

    echo "📥 Restoring..."
    gunzip -c "$DUMP_FILE" | mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME"

    echo "✅ Database restored from: $(basename $DUMP_FILE)"
fi
```

### 🔥 踩坑记录

**坑 1：iCloud 的「按需下载」导致 dump 文件损坏**

```
症状：gunzip 报 "unexpected end of file"
原因：iCloud 认为 dump 文件「不常用」，只下载了部分元数据
解决：
```

```bash
# 强制下载完整文件再操作
brctl download "$DUMP_DIR/$DUMP_FILE"
# 或在 Finder 中右键 → 「立即下载」
```

我后来在脚本中加了防护：

```bash
# 确保文件已完整下载
ensure_downloaded() {
    local file="$1"
    # 检查文件是否标记为 "不在本地"
    if xattr -l "$file" 2>/dev/null | grep -q "com.apple.icloud.item"; then
        echo "⚠️  File is iCloud-only, downloading..."
        brctl download "$file"
        # 等待下载完成
        while [ ! -f "$file" ] || [ "$(stat -f%z "$file")" -eq 0 ]; do
            sleep 1
        done
    fi
}
```

**坑 2：Google Drive File Stream 与 `.git` 目录冲突**

```
症状：git status 显示大量文件被修改，但 diff 内容相同
原因：Google Drive 修改了文件的 mtime（修改时间）
解决：不要把 .git 目录放在 Google Drive 同步路径下
```

---

## 实战三：.env 文件管理

`.env` 是最容易被忽略但最危险的同步对象。它包含数据库密码、API Key、Stripe Secret 等敏感信息。

### 策略：分层 .env

```bash
# .env.local（每台设备独立，不同步）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=kkday_b2c_local
DB_USERNAME=root
DB_PASSWORD=local_secret_123

# .env.shared（通过云存储同步，不含敏感信息）
APP_NAME="KKday B2C API"
APP_ENV=local
APP_DEBUG=true
LOG_CHANNEL=stack
CACHE_DRIVER=redis
QUEUE_CONNECTION=redis

# .env.secrets（通过云存储同步，加密存储）
# 见下方 GPG 加密方案
```

### 用 GPG 加密同步敏感 .env

```bash
#!/bin/bash
# sync-secrets.sh

SYNC_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/LaravelSync/secrets"
PROJECT_DIR="$HOME/GitHub/my-laravel-project"

encrypt_secrets() {
    echo "🔐 Encrypting .env.secrets..."
    gpg --symmetric --cipher-algo AES256 \
        --output "$SYNC_DIR/.env.secrets.gpg" \
        "$PROJECT_DIR/.env.secrets"
    echo "✅ Encrypted → iCloud"
}

decrypt_secrets() {
    echo "🔓 Decrypting .env.secrets..."
    gpg --decrypt \
        --output "$PROJECT_DIR/.env.secrets" \
        "$SYNC_DIR/.env.secrets.gpg"
    echo "✅ Decrypted → project"
}

case "$1" in
    encrypt) encrypt_secrets ;;
    decrypt) decrypt_secrets ;;
    *) echo "Usage: $0 [encrypt|decrypt]" ;;
esac
```

### 🔥 踩坑记录

**坑 3：Laravel 缓存了 .env 导致切换后配置不生效**

```bash
# 切换 .env 后必须清缓存
php artisan config:clear
php artisan cache:clear
php artisan config:cache  # 重新缓存
```

我见过同事在两台机器间切换后，因为没清缓存，API 连到了错误的数据库，把测试订单写进了生产环境的 staging 库。教训惨痛。

**坑 4：iCloud 同步的 .env 文件权限变化**

```
症状：Laravel 报 "The stream or file could not be opened"
原因：iCloud 同步后文件权限从 644 变成 600
解决：
```

```bash
# 在 sync 脚本中加权限修复
chmod 644 "$PROJECT_DIR/.env"
chmod 755 "$PROJECT_DIR/storage"
chmod -R 775 "$PROJECT_DIR/storage/logs"
chmod -R 775 "$PROJECT_DIR/storage/framework/cache"
```

---

## 实战四：IDE 配置同步

### JetBrains（PhpStorm）

PhpStorm 的配置目录结构：

```
.idea/
├── codeStyles/         ← 代码风格（值得同步）
├── inspectionProfiles/ ← 检查规则（值得同步）
├── misc.xml            ← 项目配置
├── modules.xml
└── workspace.xml       ← ⚠️ 窗口布局（不建议同步，会冲突）
```

**选择性同步方案**：

```bash
# 只同步 code style 和 inspection，不同步 workspace
SYNC_IDEA_ITEMS=(
    ".idea/codeStyles"
    ".idea/inspectionProfiles"
    ".idea/php.xml"           # PHP 解释器配置
    ".idea/laravel-idea.xml"  # Laravel 插件配置
)
```

### VS Code

```json
// .vscode/settings.json（提交到 Git）
{
    "php.validate.executablePath": "/opt/homebrew/bin/php",
    "intelephense.environment.includePaths": [
        "vendor/laravel/framework/src"
    ]
}

// .vscode/extensions.json（提交到 Git）
{
    "recommendations": [
        "bmewburn.vscode-intelephense-client",
        "onecentlin.laravel-blade",
        "shufo.vscode-blade-formatter"
    ]
}
```

VS Code 的好处是配置可以全部提交到 Git，不需要额外同步。

---

## 实战五：符号链接踩坑

Laravel 项目中有 `storage` 的符号链接：

```bash
# Laravel 的 storage link
public/storage → storage/app/public
```

### 踩坑记录

**坑 5：iCloud 同步破坏符号链接**

```
症状：public/storage 指向错误路径
原因：iCloud 将符号链接解析为实际文件副本，或同步后路径断裂
```

```bash
# 诊断
ls -la public/storage
# 期望: public/storage -> ../storage/app/public
# 实际: public/storage 变成了一个普通目录

# 修复
rm -rf public/storage
php artisan storage:link

# 每次 pull 后检查
if [ ! -L "public/storage" ]; then
    echo "⚠️  storage link broken, fixing..."
    php artisan storage:link
fi
```

**Google Drive 没有这个问题**——它正确保留符号链接。

---

## 完整的同步工作流

```
┌──────────────────────────────────────────────────┐
│              每日开发工作流                        │
├──────────────────────────────────────────────────┤
│                                                  │
│  [公司 Mac] 早上到工位                            │
│  1. git pull                                     │
│  2. ./sync-project.sh pull    ← 从 iCloud 拉配置 │
│  3. ./sync-secrets.sh decrypt ← 解密敏感配置      │
│  4. php artisan config:clear                      │
│  5. docker-compose up -d                          │
│                                                  │
│  [开发中...]                                      │
│  - 代码变更 → git commit + push                   │
│  - 数据库变更 → php artisan migrate               │
│  - 测试数据 → ./backup-db.sh                      │
│                                                  │
│  [公司 Mac] 下班前                                │
│  1. ./sync-project.sh push    ← 推配置到 iCloud  │
│  2. ./sync-secrets.sh encrypt ← 加密敏感配置      │
│  3. git push                                      │
│                                                  │
│  [家里 Mac] 到家后                                │
│  1. git pull                                      │
│  2. ./sync-project.sh pull                        │
│  3. ./sync-secrets.sh decrypt                     │
│  4. ./restore-db.sh           ← 还原最新 dump     │
│  5. php artisan config:clear                      │
│  6. docker-compose up -d                          │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 最终推荐方案

| 文件类型 | 同步方式 | 工具 |
|---------|---------|------|
| 代码 | Git | GitHub |
| `.env`（非敏感） | Git + `.env.example` | Git |
| `.env`（敏感） | GPG 加密 + 云存储 | iCloud / Google Drive |
| 数据库 dump | rsync + 云存储 | iCloud / Google Drive |
| IDE 配置 | 选择性云存储 | iCloud（JetBrains）/ Git（VS Code） |
| `vendor/` | 不同步，`composer install` | — |
| `node_modules/` | 不同步，`npm install` | — |
| `.git/` | **绝对不能放云存储** | — |

### 我的最终选择

经过半年实战，我选择 **Google Drive File Stream** 作为同步层：

1. **符号链接可靠**——不会破坏 Laravel 的 `storage:link`
2. **API 可编程**——可以用 `rclone` 做自动化
3. **大文件快**——数据库 dump 几十秒同步完成
4. **跨平台**——偶尔需要在 Linux CI 服务器上拉配置

```bash
# 用 rclone 做定时同步（比手动脚本更可靠）
# brew install rclone
rclone sync ~/GitHub/my-laravel-project/storage/dumps gdrive:LaravelSync/my-project/dumps \
    --include "*.sql.gz" \
    --max-age 7d
```

---

## 总结

云存储同步不是「选 iCloud 还是 Google Drive」的问题，而是**定义清楚「什么该同步、什么不该同步」**的问题。核心原则：

1. **Git 管代码，云存储管数据和配置**
2. **永远不要把 `.git/` 和 `vendor/` 放进同步目录**
3. **敏感信息必须加密后再同步**
4. **同步后必须清 Laravel 缓存**
5. **符号链接优先用 Google Drive，或在 pull 后自动修复**

> 最好的同步策略是：你根本不需要想「我现在在哪台机器上」。

---

## 相关阅读

- [macOS 开发者云存储选型：哪些文件放哪里？如何保证一致性？](/posts/09_macOS/macos-cloud-storage/)
- [Laravel Herd 实战：macOS 原生 PHP 环境管理——替代 Valet/Homestead 的一键开发体验](/posts/09_macOS/Laravel-Herd-实战-macOS原生PHP环境管理-替代Valet-Homestead一键开发体验/)
- [brew-php-switcher + Homebrew：macOS 多版本 PHP 管理实战与踩坑记录](/posts/09_macOS/brew-php-switcher-homebrew-php-guide/)
