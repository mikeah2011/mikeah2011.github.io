---
title: "Homebrew-自动更新脚本开发-macOS-开发环境自动化实战踩坑记录"
date: 2026-05-05 08:26:03
updated: 2026-05-05 08:29:14
categories:
  - macos
  - tools
tags: [Homebrew, 自动化, macOS, 脚本开发, 开发环境]
keywords: [Homebrew, macOS, 自动更新脚本开发, 开发环境自动化实战踩坑记录]
description: "macOS 开发者必备：Homebrew 自动更新脚本开发全流程实战，涵盖 LaunchAgent 定时调度、brew pin 版本锁定、Brewfile 团队协作、更新失败回滚策略与 Slack 通知。基于 KKday 30+ 仓库团队真实踩坑经验，助你实现无人值守的 Homebrew 依赖管理。"
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop



---

# Homebrew 自动更新脚本开发：macOS 开发环境自动化实战踩坑记录

## 1. 为什么需要 Homebrew 自动更新？

在 KKday 的 macOS 开发环境中，我们团队有 30+ 个 Laravel 仓库需要维护，每个项目的依赖栈（PHP、Composer、Node.js、Redis、MySQL）版本要求各不相同。手动管理 `brew update && brew upgrade` 的痛点越来越明显：

```
❌ 问题 1：遗忘更新 → 安全漏洞累积（openssl CVE 修复没人装）
❌ 问题 2：盲目更新 → 生产环境 PHP 8.0，本地升到 8.3 代码直接崩
❌ 问题 3：团队不一致 → 同一个项目，5 个人 5 种依赖版本
❌ 问题 4：更新时间冲突 → 正在写代码突然 `brew upgrade` 卡住 10 分钟
```

我们的目标是：**无人值守 + 安全可控 + 有迹可查**。

## 2. 架构设计

```
┌─────────────────────────────────────────────────────┐
│                  macOS 开发机                         │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  LaunchAgent  │───▶│  brew-auto-update.sh    │   │
│  │  (每天凌晨)   │    │                          │   │
│  └──────────────┘    │  1. brew update          │   │
│                       │  2. 读取 pinned.json     │   │
│                       │  3. brew upgrade --dry   │   │
│                       │  4. brew upgrade (safe)  │   │
│                       │  5. brew cleanup         │   │
│                       │  6. 生成 report.md       │   │
│                       │  7. 推送 Slack 通知      │   │
│                       └──────────────────────────┘   │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ pinned.json  │    │  logs/2026-05-05.log     │   │
│  │ (版本锁定)   │    │  reports/2026-05-05.md   │   │
│  └──────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

核心思路：
- **LaunchAgent** 负责定时触发（每天凌晨 3 点，Mac 开着的话）
- **pinned.json** 锁定关键依赖版本，防止意外升级
- **dry-run 先行**，先预览再执行
- **日志 + 报告**，每次更新都有据可查

## 3. 核心脚本实现

### 3.1 pinned.json — 版本锁定配置

```json
{
  "pinned": {
    "php": "8.0",
    "php@8.1": "8.1.31",
    "node": "18",
    "mysql": "8.0",
    "redis": "7.2",
    "composer": null
  },
  "auto_upgrade": true,
  "cleanup_after_upgrade": true,
  "slack_webhook": "",
  "log_dir": "$HOME/.brew-auto-update/logs",
  "report_dir": "$HOME/.brew-auto-update/reports",
  "max_log_days": 30
}
```

> **踩坑 1**：`brew pin` 命令只支持已安装的 formula。如果你 pin 了 `php@8.0` 但后来 uninstall 了，下次 `brew upgrade` 不会报错但也不会安装。所以我们在脚本里做了「pin 状态检查」。

### 3.2 brew-auto-update.sh — 主脚本

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# brew-auto-update.sh
# Homebrew 自动更新脚本 — 版本锁定 + dry-run + 报告
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/pinned.json"
TODAY=$(date '+%Y-%m-%d')
NOW=$(date '+%Y-%m-%d %H:%M:%S')

# 读取配置
LOG_DIR=$(jq -r '.log_dir' "$CONFIG_FILE" | sed "s|\$HOME|$HOME|g")
REPORT_DIR=$(jq -r '.report_dir' "$CONFIG_FILE" | sed "s|\$HOME|$HOME|g")
SLACK_WEBHOOK=$(jq -r '.slack_webhook' "$CONFIG_FILE")
CLEANUP=$(jq -r '.cleanup_after_upgrade' "$CONFIG_FILE")
MAX_LOG_DAYS=$(jq -r '.max_log_days' "$CONFIG_FILE")

mkdir -p "$LOG_DIR" "$REPORT_DIR"
LOG_FILE="${LOG_DIR}/${TODAY}.log"
REPORT_FILE="${REPORT_DIR}/${TODAY}.md"

# 日志函数
log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "========== Homebrew 自动更新开始 =========="
log "配置文件: $CONFIG_FILE"

# -----------------------------------------------------------
# Step 1: brew update（刷新 formula 索引）
# -----------------------------------------------------------
log "Step 1: brew update"
brew update >> "$LOG_FILE" 2>&1 || {
  log "⚠️  brew update 失败，可能是网络问题"
  # 不退出，继续尝试
}

# -----------------------------------------------------------
# Step 2: 读取 pinned 列表，设置 pin
# -----------------------------------------------------------
log "Step 2: 同步 pin 状态"
PINNED_FORMULAS=$(jq -r '.pinned | to_entries[] | select(.value != null) | .key' "$CONFIG_FILE")
while IFS= read -r formula; do
  if brew list --formula "$formula" &>/dev/null; then
    brew pin "$formula" 2>/dev/null || true
    log "  📌 已 pin: $formula"
  else
    log "  ⚠️  $formula 未安装，跳过 pin"
  fi
done <<< "$PINNED_FORMULAS"

# -----------------------------------------------------------
# Step 3: dry-run 检查可升级项
# -----------------------------------------------------------
log "Step 3: 检查可升级项"
OUTDATED=$(brew outdated --json=v2 2>/dev/null || echo '{"formulae":[],"casks":[]}')
OUTDATED_COUNT=$(echo "$OUTDATED" | jq '.formulae | length')
log "  发现 $OUTDATED_COUNT 个 formula 可升级"

# 生成 dry-run 报告
{
  echo "# Homebrew 更新报告 — $TODAY"
  echo ""
  echo "## 📊 概览"
  echo ""
  echo "| 项目 | 值 |"
  echo "|------|-----|"
  echo "| 执行时间 | $NOW |"
  echo "| 可升级 formula | $OUTDATED_COUNT 个 |"
  echo ""
  echo "## 📦 可升级列表"
  echo ""
  echo "| Formula | 当前版本 | 最新版本 | 状态 |"
  echo "|---------|----------|----------|------|"
  echo "$OUTDATED" | jq -r '.formulae[] | "| \(.name) | \(.installed_versions[-1]) | \(.current_version) | 待升级 |"'
} > "$REPORT_FILE"

# -----------------------------------------------------------
# Step 4: 执行升级（排除 pinned）
# -----------------------------------------------------------
UPGRADED=0
FAILED=0

if [[ "$OUTDATED_COUNT" -gt 0 ]]; then
  log "Step 4: 开始升级"

  while IFS= read -r formula; do
    name=$(echo "$formula" | jq -r '.name')
    current=$(echo "$formula" | jq -r '.installed_versions[-1]')
    target=$(echo "$formula" | jq -r '.current_version')

    # 跳过 pinned formula
    if echo "$PINNED_FORMULAS" | grep -qx "$name"; then
      log "  🔒 跳过 pinned: $name ($current)"
      continue
    fi

    log "  🔄 升级 $name: $current → $target"
    if brew upgrade "$name" >> "$LOG_FILE" 2>&1; then
      log "  ✅ $name 升级成功"
      ((UPGRADED++))
    else
      log "  ❌ $name 升级失败"
      ((FAILED++))
    fi
  done < <(echo "$OUTDATED" | jq -c '.formulae[]')
fi

# -----------------------------------------------------------
# Step 5: brew cleanup
# -----------------------------------------------------------
if [[ "$CLEANUP" == "true" ]]; then
  log "Step 5: brew cleanup"
  CLEANED=$(brew cleanup --dry-run 2>&1 | grep -c "Would remove" || true)
  brew cleanup >> "$LOG_FILE" 2>&1
  log "  🧹 清理了 $CLEANED 个旧版本"
fi

# -----------------------------------------------------------
# Step 6: 补充报告
# -----------------------------------------------------------
{
  echo ""
  echo "## ✅ 升级结果"
  echo ""
  echo "| 指标 | 数量 |"
  echo "|------|------|"
  echo "| 成功升级 | $UPGRADED |"
  echo "| 升级失败 | $FAILED |"
  echo "| 跳过（pinned）| $(echo "$PINNED_FORMULAS" | wc -l | tr -d ' ') |"
  echo ""
  echo "## 🔒 锁定版本"
  echo ""
  echo "| Formula | 锁定版本 |"
  echo "|---------|----------|"
  echo "$CONFIG_FILE" | jq -r '.pinned | to_entries[] | select(.value != null) | "| \(.key) | \(.value) |"'
  echo ""
  echo "## 📋 完整日志"
  echo ""
  echo "\`\`\`"
  tail -30 "$LOG_FILE"
  echo "\`\`\`"
} >> "$REPORT_FILE"

log "========== 更新完成: 成功 $UPGRADED, 失败 $FAILED =========="

# -----------------------------------------------------------
# Step 7: Slack 通知（可选）
# -----------------------------------------------------------
if [[ -n "$SLACK_WEBHOOK" && "$SLACK_WEBHOOK" != "null" ]]; then
  SLACK_MSG="🍺 *Homebrew 自动更新报告*\n📅 $TODAY\n✅ 成功: $UPGRADED | ❌ 失败: $FAILED"
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\": \"$SLACK_MSG\"}" \
    "$SLACK_WEBHOOK" >> "$LOG_FILE" 2>&1 || true
  log "📨 Slack 通知已发送"
fi

# -----------------------------------------------------------
# Step 8: 清理过期日志
# -----------------------------------------------------------
find "$LOG_DIR" -name "*.log" -mtime "+$MAX_LOG_DAYS" -delete 2>/dev/null
find "$REPORT_DIR" -name "*.md" -mtime "+$MAX_LOG_DAYS" -delete 2>/dev/null

exit 0
```

### 3.3 brew-auto-safe-upgrade.sh — 按项目要求升级

当你需要按项目要求选择性升级时（比如 KKday-B2C 要求 PHP 8.0，Affiliate 要求 PostgreSQL 15），可以用这个增强版：

```bash
#!/usr/bin/env bash
set -euo pipefail

# brew-auto-safe-upgrade.sh
# 按项目 .brew-requirements 文件升级

PROJECT_ROOT="$HOME/GitHub"
REPORT=""

check_project_requirements() {
  local project_dir="$1"
  local req_file="${project_dir}/.brew-requirements"

  if [[ ! -f "$req_file" ]]; then
    return
  fi

  echo "📋 检查项目: $(basename "$project_dir")"

  while IFS='=' read -r formula version; do
    [[ -z "$formula" || "$formula" == \#* ]] && continue

    installed=$(brew list --versions "$formula" 2>/dev/null | awk '{print $2}' || echo "未安装")

    if [[ "$installed" == "未安装" ]]; then
      echo "  ⚠️  $formula 未安装（项目要求 $version）"
      REPORT+="| $(basename "$project_dir") | $formula | $installed | $version | ❌ 未安装 |\n"
    elif [[ "$installed" == "$version"* ]]; then
      echo "  ✅ $formula $installed（要求 $version）"
      REPORT+="| $(basename "$project_dir") | $formula | $installed | $version | ✅ 匹配 |\n"
    else
      echo "  ❌ $formula $installed ≠ 要求 $version"
      REPORT+="| $(basename "$project_dir") | $formula | $installed | $version | ❌ 不匹配 |\n"
    fi
  done < "$req_file"
}

# 遍历所有项目
for project in "$PROJECT_ROOT"/*/; do
  [[ -d "$project/.git" ]] && check_project_requirements "$project"
done

# 输出报告
echo ""
echo "## 📊 项目依赖兼容性报告"
echo ""
echo "| 项目 | Formula | 已安装 | 要求 | 状态 |"
echo "|------|---------|--------|------|------|"
echo -e "$REPORT"
```

项目根目录放置 `.brew-requirements` 文件：

```ini
# .brew-requirements — KKday B2C Backend
php=8.0
mysql=8.0
redis=7.2
node=18
composer=2.7
```

> **踩坑 2**：`brew list --versions php` 返回的是 `php 8.0.30_1`，版本号带后缀。比较时要用前缀匹配 `8.0` 而非精确匹配。我们用 `$installed == "$version"*` 来处理。

## 4. LaunchAgent 定时调度

### 4.1 plist 配置

```xml
<!-- ~/Library/LaunchAgents/com.michael.brew-auto-update.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.michael.brew-auto-update</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/michael/Scripts/brew-auto-update.sh</string>
    </array>

    <!-- 每天凌晨 3:00 执行 -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <!-- 如果错过了（电脑关机），开机后补执行 -->
    <key>StartInterval</key>
    <integer>86400</integer>

    <key>StandardOutPath</key>
    <string>/Users/michael/.brew-auto-update/logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/michael/.brew-auto-update/logs/launchd-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

> **踩坑 3**：LaunchAgent 默认的 `PATH` 只有 `/usr/bin:/bin`，不包含 `/opt/homebrew/bin`。如果不设置 `EnvironmentVariables`，`brew` 命令会找不到。这是最常见的 LaunchAgent 失败原因。

### 4.2 注册与管理

```bash
# 加载
launchctl load ~/Library/LaunchAgents/com.michael.brew-auto-update.plist

# 手动触发测试
launchctl start com.michael.brew-auto-update

# 查看状态
launchctl list | grep brew

# 卸载
launchctl unload ~/Library/LaunchAgents/com.michael.brew-auto-update.plist
```

> **踩坑 4**：`launchctl unload` 之后再 `load`，如果 plist 有修改，macOS 不会自动刷新。需要先 `unload`，再 `load`。或者用 `launchctl kickstart -k gui/$(id -u)/com.michael.brew-auto-update` 强制重启。

## 5. 进阶：brew doctor + drift 检测

定期运行 `brew doctor` 检测环境健康状态：

```bash
#!/usr/bin/env bash
# brew-health-check.sh — 健康检查脚本

echo "🏥 Homebrew 健康检查 — $(date '+%Y-%m-%d %H:%M')"
echo "================================================"

# 1. brew doctor
echo ""
echo "## 1. brew doctor"
brew doctor 2>&1 | head -20

# 2. 检查 drift（已安装但不在任何 Brewfile 中）
echo ""
echo "## 2. 依赖漂移检测"
BREWFILE="$HOME/.Brewfile"

if [[ -f "$BREWFILE" ]]; then
  BREWFILE_FORMULAS=$(grep "^brew " "$BREWFILE" | sed 's/brew "//;s/"//' | sort)
  INSTALLED_FORMULAS=$(brew list --formula | sort)

  echo "以下 formula 已安装但不在 Brewfile 中："
  comm -23 <(echo "$INSTALLED_FORMULAS") <(echo "$BREWFILE_FORMULAS") | while read -r f; do
    echo "  ⚠️  $f"
  done
else
  echo "  未找到 $BREWFILE"
fi

# 3. 检查过期 formula（超过 30 天未更新）
echo ""
echo "## 3. 长期未更新的 formula"
brew list --formula | while read -r f; do
  install_date=$(brew info --json=v2 "$f" | jq -r '.formulae[0].pinned' 2>/dev/null)
  if [[ "$install_date" == "true" ]]; then
    echo "  📌 $f (pinned)"
  fi
done

# 4. 磁盘占用
echo ""
echo "## 4. Homebrew 磁盘占用"
du -sh /opt/homebrew/ 2>/dev/null || du -sh /usr/local/ 2>/dev/null
echo ""
echo "缓存目录："
du -sh "$(brew --cache)" 2>/dev/null || echo "  无法获取"
```

> **踩坑 5**：`brew --cache` 在 Apple Silicon 上返回 `/Users/michael/Library/Caches/Homebrew`，但在 Intel Mac 上是 `/Users/michael/Library/Caches/Homebrew`（相同）。不过 Docker 环境或 CI 中可能返回 `/tmp`，脚本要兼容。

## 6. 团队协作：Brewfile 共享

### 6.1 导出当前环境

```bash
# 导出所有已安装的 formula + cask + tap
brew bundle dump --file=~/.Brewfile --force

# 查看
cat ~/.Brewfile
```

### 6.2 从 Brewfile 恢复

```bash
# 新电脑一键安装所有依赖
brew bundle --file=~/.Brewfile

# 只安装 missing 的
brew bundle --file=~/.Brewfile --no-upgrade
```

### 6.3 项目级 Brewfile

在每个项目的根目录放置项目级 Brewfile：

```ruby
# ~/GitHub/kkday-b2c-backend/Brewfile
tap "shivammathur/php"
brew "php@8.0"
brew "mysql@8.0"
brew "redis"
brew "node@18"
brew "composer"
cask "docker"
cask "tableplus"
cask "postman"
```

> **踩坑 6**：多个项目 Brewfile 可能指定同一个 formula 的不同版本。`brew bundle` 不会自动切换版本，它只检查「是否已安装任意版本」。需要配合 `brew-php-switcher` 或 `brew unlink/link` 手动切换。

## 7. 踩坑总结

| # | 踩坑 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | `brew pin` 对未安装 formula 无效 | pin 只作用于已安装 formula | 脚本里先检查 `brew list` |
| 2 | 版本号带后缀 `8.0.30_1` | Homebrew 的版本规范 | 前缀匹配而非精确匹配 |
| 3 | LaunchAgent 找不到 `brew` | 默认 PATH 不含 `/opt/homebrew/bin` | plist 设置 EnvironmentVariables |
| 4 | plist 修改后不生效 | macOS 缓存了 plist 内容 | 必须先 unload 再 load |
| 5 | `brew --cache` 路径不一致 | Intel vs Apple Silicon 路径不同 | 动态获取，不硬编码 |
| 6 | 多项目 Brewfile 版本冲突 | `brew bundle` 只检查任意版本 | 配合 brew-php-switcher |

## 8. 完整目录结构

```
~/.brew-auto-update/
├── pinned.json              # 版本锁定配置
├── brew-auto-update.sh      # 主更新脚本
├── brew-auto-safe-upgrade.sh # 按项目升级
├── brew-health-check.sh     # 健康检查
├── logs/
│   ├── 2026-05-01.log
│   ├── 2026-05-02.log
│   └── ...
└── reports/
    ├── 2026-05-01.md
    ├── 2026-05-02.md
    └── ...

~/Library/LaunchAgents/
└── com.michael.brew-auto-update.plist

~/GitHub/*/Brewfile          # 各项目级依赖声明
~/.Brewfile                  # 全局依赖声明
```

## 9. 与其他方案对比

| 方案 | 自动化程度 | 版本锁定 | 跨机器同步 | 学习成本 |
|------|-----------|---------|-----------|---------|
| 手动 `brew upgrade` | ❌ 无 | ❌ 无 | ❌ 无 | 低 |
| Brewfile + `brew bundle` | ⚠️ 手动触发 | ❌ 无 | ✅ Git 管理 | 低 |
| **本文方案** | ✅ LaunchAgent | ✅ pinned.json | ✅ 报告 + Slack | 中 |
| Nix / nix-darwin | ✅ 完全自动 | ✅ 精确锁定 | ✅ Flake | 高 |
| asdf / mise | ✅ 项目级 | ✅ .tool-versions | ✅ Git 管理 | 中 |

> 如果团队规模 < 5 人，本文方案足够。如果 > 10 人或有合规审计需求，建议考虑 Nix 或 Mise。

## 10. 更新失败回滚策略

自动更新最怕的就是「更新完环境炸了」。生产环境中，一次错误的 `brew upgrade` 可能导致编译失败、服务无法启动。以下是我们的回滚策略：

### 10.1 brew switch — 快速版本切换

Homebrew 保留了旧版本的 Cellar，可以直接切换：

```bash
# 查看已安装的所有版本
brew list --versions php
# php 8.0.30_1 8.1.31 8.3.6

# 切换回 8.0
brew switch php 8.0.30_1

# 重新链接
brew unlink php@8.3 && brew link php@8.0 --force
```

> ⚠️ **注意**：`brew switch` 在 Homebrew 4.0+ 已被移除，取而代之的是直接使用 `brew unlink` / `brew link` 操作不同版本的 keg。

### 10.2 升级前快照脚本

在自动更新脚本中加入升级前快照，确保随时可回退：

```bash
#!/usr/bin/env bash
# brew-snapshot.sh — 升级前保存当前状态

SNAPSHOT_DIR="$HOME/.brew-auto-update/snapshots"
TODAY=$(date '+%Y-%m-%d_%H%M%S')
SNAPSHOT_FILE="${SNAPSHOT_DIR}/${TODAY}.json"

mkdir -p "$SNAPSHOT_DIR"

# 保存当前所有已安装 formula 的版本
brew info --json=v2 --installed | jq '{
  timestamp: now | todate,
  formulae: [.formulae[] | {
    name: .name,
    installed: .installed_versions,
    pinned: .pinned
  }],
  casks: [.casks[] | {
    name: .name,
    installed: .version
  }]
}' > "$SNAPSHOT_FILE"

echo "📸 快照已保存: $SNAPSHOT_FILE"

# 保留最近 10 个快照
ls -t "$SNAPSHOT_DIR"/*.json | tail -n +11 | xargs rm -f 2>/dev/null
```

### 10.3 回滚脚本

```bash
#!/usr/bin/env bash
# brew-rollback.sh — 根据快照回滚
set -euo pipefail

SNAPSHOT_FILE="$1"

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "❌ 快照文件不存在: $SNAPSHOT_FILE"
  echo "可用快照:"
  ls -lt "$HOME/.brew-auto-update/snapshots/"
  exit 1
fi

echo "🔄 正在根据快照回滚: $SNAPSHOT_FILE"

# 解析快照，逐个 formula 回滚
jq -r '.formulae[] | "\(.name) \(.installed[-1])"' "$SNAPSHOT_FILE" | while read -r name version; do
  current=$(brew list --versions "$name" 2>/dev/null | awk '{print $NF}')
  if [[ "$current" != "$version" ]]; then
    echo "  🔄 $name: $current → $version"
    # 如果目标版本还在 Cellar 中，直接切换
    if [[ -d "$(brew --cellar)/$name/$version" ]]; then
      brew unlink "$name" 2>/dev/null || true
      brew link "$name" --version="$version" --force 2>/dev/null || true
      echo "  ✅ $name 已回滚到 $version"
    else
      echo "  ⚠️  $name 的 $version 版本已被清理，需手动安装"
    fi
  fi
done

echo ""
echo "✅ 回滚完成。建议运行 brew doctor 检查环境。"
```

### 10.4 自动回滚集成

在主更新脚本中集成自动回滚机制：

```bash
# 在 brew-auto-update.sh 的 Step 4 之前加入
# 升级前自动快照
SNAPSHOT_FILE="$HOME/.brew-auto-update/snapshots/pre-upgrade-${TODAY}.json"
brew info --json=v2 --installed > "$SNAPSHOT_FILE" 2>/dev/null
log "📸 升级前快照: $SNAPSHOT_FILE"

# 升级后验证
if [[ "$FAILED" -gt 0 ]]; then
  log "⚠️  有 $FAILED 个 formula 升级失败，建议检查日志"
  # 发送告警
  if [[ -n "$SLACK_WEBHOOK" && "$SLACK_WEBHOOK" != "null" ]]; then
    ALERT_MSG="🚨 *Homebrew 升级告警*\n📅 $TODAY\n❌ $FAILED 个 formula 升级失败\n📋 日志: $LOG_FILE\n💡 可用回滚: \`brew-rollback.sh $SNAPSHOT_FILE\`"
    curl -s -X POST -H 'Content-type: application/json' \
      --data "{\"text\": \"$ALERT_MSG\"}" \
      "$SLACK_WEBHOOK" >> "$LOG_FILE" 2>&1 || true
  fi
fi
```

> **最佳实践**：`brew cleanup` 会删除旧版本的缓存。建议在确认升级无问题后再执行 cleanup，或者在 cleanup 前先创建快照。我们的脚本将 cleanup 放在最后一步，就是为了给回滚留窗口。

## 11. 多人团队 Homebrew 版本同步方案

团队协作中，最容易出现的问题就是「我的机器上跑得好好的」。以下是我们的版本同步方案：

### 11.1 三层依赖声明体系

```
┌─────────────────────────────────────────────┐
│              三层依赖声明                     │
├─────────────────────────────────────────────┤
│  Layer 1: 全局 Brewfile (~/.Brewfile)       │
│  → 基础工具：git, wget, jq, htop 等         │
│  → 所有人共享，放到 dotfiles 仓库            │
├─────────────────────────────────────────────┤
│  Layer 2: 项目 Brewfile (项目根/Brewfile)   │
│  → 项目特定依赖：php@8.0, mysql@8.0 等      │
│  → 跟着代码走，code review 审查              │
├─────────────────────────────────────────────┤
│  Layer 3: .brew-requirements (精确版本)      │
│  → 锁定精确版本号：php=8.0.30               │
│  → 配合 CI 检查，不匹配则告警               │
└─────────────────────────────────────────────┘
```

### 11.2 brew bundle check — CI 集成

在项目的 CI pipeline 中加入依赖检查：

```yaml
# .github/workflows/brew-check.yml (macOS CI)
name: Brewfile Check
on: [push, pull_request]

jobs:
  brew-check:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check Brewfile
        run: |
          brew bundle check --file=Brewfile || {
            echo "❌ Brewfile 不满足，请运行: brew bundle --file=Brewfile"
            exit 1
          }
```

### 11.3 brew-bundle-dump 自动同步

```bash
#!/usr/bin/env bash
# brew-sync.sh — 同步团队依赖

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
BREWFILE="${PROJECT_ROOT}/Brewfile"

echo "🔄 同步项目依赖..."

# 1. 检查当前环境
if [[ -f "$BREWFILE" ]]; then
  echo "📋 检查 Brewfile..."
  if ! brew bundle check --file="$BREWFILE" 2>/dev/null; then
    echo "⚠️  有缺失的依赖，是否安装？[y/N]"
    read -r answer
    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
      brew bundle --file="$BREWFILE"
    fi
  else
    echo "✅ 所有依赖已满足"
  fi
fi

# 2. 检查是否有新增依赖需要更新 Brewfile
INSTALLED=$(brew list --formula | sort)
BREWFILE_LIST=$(grep "^brew " "$BREWFILE" 2>/dev/null | sed 's/brew "//;s/".*//' | sort)
NEW_DEPS=$(comm -23 <(echo "$INSTALLED") <(echo "$BREWFILE_LIST"))

if [[ -n "$NEW_DEPS" ]]; then
  echo ""
  echo "📦 以下依赖已安装但不在 Brewfile 中："
  echo "$NEW_DEPS" | while read -r dep; do
    echo "  + $dep"
  done
  echo ""
  echo "是否添加到 Brewfile？[y/N]"
  read -r answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    echo "$NEW_DEPS" | while read -r dep; do
      echo "brew \"$dep\"" >> "$BREWFILE"
    done
    echo "✅ 已更新 Brewfile"
  fi
fi
```

### 11.4 版本对齐检查脚本

```bash
#!/usr/bin/env bash
# brew-align-check.sh — 检查团队成员版本是否对齐

REQUIREMENTS_FILE="$1"

echo "🔍 版本对齐检查"
echo "==============="

MISALIGNED=0

while IFS='=' read -r formula version; do
  [[ -z "$formula" || "$formula" == \#* ]] && continue

  installed=$(brew list --versions "$formula" 2>/dev/null | awk '{print $2}')

  if [[ -z "$installed" ]]; then
    echo "❌ $formula: 未安装 (要求 $version)"
    ((MISALIGNED++))
  elif [[ "$installed" != "$version"* ]]; then
    echo "❌ $formula: $installed ≠ $version"
    ((MISALIGNED++))
  else
    echo "✅ $formula: $installed"
  fi
done < "$REQUIREMENTS_FILE"

echo ""
if [[ "$MISALIGNED" -gt 0 ]]; then
  echo "⚠️  有 $MISALIGNED 个依赖版本不一致"
  echo "💡 建议运行: brew bundle --file=Brewfile"
  exit 1
else
  echo "✅ 所有依赖版本对齐"
fi
```

### 11.5 新人 Onboarding 流程

```bash
# 新人入职，一条命令搞定开发环境
# 1. 安装 Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Clone dotfiles（包含全局 Brewfile）
git clone https://github.com/your-org/dotfiles.git ~/.dotfiles
brew bundle --file=~/.dotfiles/Brewfile

# 3. 进入项目目录，安装项目依赖
cd ~/GitHub/project-name
brew bundle --file=Brewfile

# 4. 验证
brew doctor
brew-auto-safe-upgrade.sh  # 检查版本是否对齐
```

> **踩坑 7**：不同 macOS 版本的 Homebrew formula 仓库可能不同。建议团队统一 macOS 版本（至少大版本一致），否则可能出现 formula 找不到的情况。我们的做法是在 `.brew-requirements` 中注释最低 macOS 版本要求。

## 12. 总结

Homebrew 自动更新看起来简单，但实际落地时会遇到 PATH 问题、版本号规范、LaunchAgent 缓存等一堆坑。核心经验：

1. **先 dry-run，再执行** — 避免盲目升级破坏开发环境
2. **pin 住关键依赖** — PHP、MySQL 这种一旦升级可能影响编译的 formula 必须锁版本
3. **日志 + 报告** — 每次更新都有据可查，出问题能快速定位
4. **项目级 Brewfile** — 让依赖声明跟着代码走，新人 onboard 一条命令搞定
5. **LaunchAgent 注意 PATH** — 这是最常见的坑，务必在 plist 里设置 EnvironmentVariables
6. **升级前快照，清理后移** — 回滚是自动更新的最后一道防线，cleanup 要放在最后
7. **三层依赖声明** — 全局 / 项目 / 精确版本，团队协作的基石

---

*本文基于 macOS Sonoma + Apple M2 芯片 + Homebrew 4.x 实战编写。Intel Mac 路径为 `/usr/local/` 而非 `/opt/homebrew/`，其余逻辑相同。*

---

## 📚 相关阅读

- [JetBrains Toolbox 深度实战：PHPStorm/WebStorm/GoLand 选型与配置](/categories/macOS/jetbrains-toolbox-guide-phpstorm-webstorm-goland/) — macOS 开发工具链选型，与 Homebrew 管理 IDE 版本的协同实践
- [pnpm 深度实战：Workspace/Monorepo 工程化管理](/categories/macOS/pnpm-guide-workspace-monorepo/) — 前端依赖管理的进阶方案，与 Homebrew 的多项目管理思路相通
- [Hermes Agent 实战：AI 自动化助手与监控](/categories/macOS/hermes-agent-guide-automationmonitoring/) — 用 AI Agent 实现更多 macOS 自动化场景
- [LM Studio 本地 AI 模型部署实战](/categories/macOS/lm-studio-guide-ai/) — 在 macOS 上部署本地 AI 模型，依赖 Homebrew 管理运行环境
