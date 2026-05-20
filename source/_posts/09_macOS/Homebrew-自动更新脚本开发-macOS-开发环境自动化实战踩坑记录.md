---
title: "Homebrew-自动更新脚本开发-macOS-开发环境自动化实战踩坑记录"
date: 2026-05-05 08:26:03
updated: 2026-05-05 08:29:14
categories:
  - 09_macOS
tags:
  - macOS
  - macOS
  - 自动化
  - Shell
  - Launchd
description: "macOS 开发者 Homebrew 自动更新脚本开发实战：brew upgrade 无人值守、Launchd 定时调度、多 Tap 同步策略、更新报告生成与生产环境踩坑记录。基于 KKday 30+ 仓库 macOS 开发团队真实经验。"
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

## 10. 总结

Homebrew 自动更新看起来简单，但实际落地时会遇到 PATH 问题、版本号规范、LaunchAgent 缓存等一堆坑。核心经验：

1. **先 dry-run，再执行** — 避免盲目升级破坏开发环境
2. **pin 住关键依赖** — PHP、MySQL 这种一旦升级可能影响编译的 formula 必须锁版本
3. **日志 + 报告** — 每次更新都有据可查，出问题能快速定位
4. **项目级 Brewfile** — 让依赖声明跟着代码走，新人 onboard 一条命令搞定
5. **LaunchAgent 注意 PATH** — 这是最常见的坑，务必在 plist 里设置 EnvironmentVariables

---

*本文基于 macOS Sonoma + Apple M2 芯片 + Homebrew 4.x 实战编写。Intel Mac 路径为 `/usr/local/` 而非 `/opt/homebrew/`，其余逻辑相同。*
