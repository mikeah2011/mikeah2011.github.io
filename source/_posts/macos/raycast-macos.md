---

title: Raycast 实战：macOS 效率启动器自定义脚本与开发工作流踩坑记录
keywords: [Raycast, macOS, 效率启动器自定义脚本与开发工作流踩坑记录]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-06-01
categories:
- macos
tags:
- Raycast
- macOS
- 效率工具
- 开发者工具
- 自动化
- spotlight
- hotkey
description: 这篇文章系统梳理 Raycast 在 macOS 上的真实使用方法，覆盖效率工具与启动器的基础配置、自定义脚本、快捷键体系、剪贴板与窗口管理、扩展生态和开发工作流实战，并补充 Shell、Node.js、Python 可运行示例、常见踩坑与对比选型建议，帮助开发者把 Raycast 变成可编程的效率中枢。
---



## 一、为什么写这篇？

作为一个在 macOS 上写了十几年代码的 Laravel 后端开发者，我对「效率工具」的执念大概比大多数人深。从最早的 Alfred，到 Spotlight 的逐步改进，再到各种终端 launcher，我一直在寻找一个能真正融入开发工作流的「第二大脑入口」。

直到 Raycast 出现。

它不只是一个 Spotlight 替代品——它是一个**可编程的效率平台**。你可以用它：

- 秒速启动应用 / 切换窗口 / 管理剪贴板
- 直接在 launcher 里执行 Shell 脚本、管理 Docker、查看 Git 状态
- 通过 Extension 生态集成 Slack、GitHub、Jira、Notion 等工具
- 自定义 Snippet 实现代码片段 / 常用文本的极速输入
- 用 Hotkey 绑定一切操作，实现「手不离键盘」的工作流

**痛点驱动：**

1. **Spotlight 太慢太弱**：搜个 Docker 容器状态还得切终端？不行。
2. **Alfred 的 Workflow 学习曲线陡**：Powerpack 贵，workflow 配置像写 XML 狱。
3. **macOS 原生快捷键不够用**：窗口管理、剪贴板历史、快速计算，每个都需要单独工具。
4. **多工具切换成本高**：剪贴板用 Paste，窗口管理用 Rectangle，snippet 用 TextExpander——Raycast 一个搞定。

本文基于我在 30+ Laravel 仓库日常开发中的 Raycast 使用经验，覆盖**基础配置、Shell 脚本扩展、Extension 实战、Hotkey 体系设计**，以及那些官方文档不会告诉你的踩坑细节。

---

## 二、核心概念与架构

### 2.1 Raycast 的定位

Raycast 本质上是一个**用 TypeScript 构建的可扩展 launcher 平台**。它的核心理念是：

> 一切操作都应该在键盘驱动的 launcher 中完成，无需离开当前上下文。

与 Alfred 的对比：

| 维度 | Raycast | Alfred |
|------|---------|--------|
| 价格 | 免费（Pro $8/月） | 免费基础 + Powerpack £29 |
| 扩展语言 | TypeScript (React) | XML plist + Shell |
| Extension 生态 | 官方 Store，1000+ 扩展 | 社区 Workflow，分散 |
| UI 框架 | React + 原生 macOS | 原生 macOS |
| AI 集成 | 内置 AI（Pro） | 无原生 AI |
| 剪贴板历史 | 内置 | 需 Powerpack |
| 窗口管理 | 内置 | 需 Powerpack |
| Snippet | 内置 | 需 Powerpack |

### 2.2 核心组件

Raycast 的功能由以下模块组成：

```
Raycast
├── Root Search（全局搜索入口）
├── Commands（命令）
│   ├── Built-in Commands（内置命令）
│   ├── Extensions（扩展命令）
│   └── Script Commands（脚本命令）
├── Clipboard History（剪贴板历史）
├── Snippets（文本片段）
├── Window Management（窗口管理）
├── Floating Notes（浮动笔记）
├── Quicklinks（快速链接）
└── Hotkeys（全局快捷键）
```

### 2.3 Script Command vs Extension

这是新手最容易混淆的两个概念：

| 维度 | Script Command | Extension |
|------|---------------|-----------|
| 语言 | Shell / AppleScript / Python / Ruby | TypeScript (React) |
| 配置 | YAML frontmatter + 脚本 | package.json + TSX 组件 |
| 交互性 | 有限（仅输出文本） | 完整 UI（列表、表单、详情） |
| 安装方式 | 拖入 Script 目录 | Store 一键安装 |
| 适用场景 | 快速自动化、系统操作 | 复杂交互、第三方 API |
| 开发成本 | 5 分钟 | 30 分钟 ~ 数小时 |

**我的经验法则：**
- 如果只需要「输入参数 → 执行脚本 → 显示结果」→ Script Command
- 如果需要列表选择、表单输入、实时更新 UI → Extension

---

## 三、实战代码

### 3.1 基础安装与配置

#### 安装 Raycast

```bash
# 推荐用 Homebrew 安装
brew install --cask raycast
```

#### 替换 Spotlight 快捷键

安装后第一步：**把 ⌘+Space 绑定给 Raycast，Spotlight 改用 ⌘+⌥+Space**。

```
System Settings → Keyboard → Keyboard Shortcuts → Spotlight
→ 取消 "Spotlight search" 的 ⌘+Space
→ 把 ⌘+Space 绑定给 Raycast
```

#### 关键偏好设置

打开 Raycast → `⌘+,` 进入 Settings：

```
# General
✅ Launch at Login
✅ Raycast Hotkey: ⌘+Space

# Advanced
✅ Clipboard History: ON
  → Ignore sensitive data: ON（避免记录密码）
  → History size: 500（默认 50 太少）
✅ Window Management: ON（替代 Rectangle）

# Extensions
→ 根据需要启用/禁用内置扩展
```

### 3.2 Script Command 实战

Script Command 是我用得最多的能力。它让 launcher 变成了一个「万能遥控器」。

#### 3.2.1 创建 Script Command 目录

```bash
# 创建你的脚本目录
mkdir -p ~/raycast-scripts

# 在 Raycast 中添加目录
# Settings → Extensions → Script Commands → Add Directory → 选 ~/raycast-scripts
```

#### 3.2.2 Docker 容器状态查看器

这是我每天用得最多的脚本——在 launcher 里直接看 Docker 容器状态，不用切终端。

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Docker 容器状态
# @raycast.mode fullOutput
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 🐳
# @raycast.description 显示所有 Docker 容器的运行状态
# @raycast.author Michael

echo "🐳 Docker 容器状态"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行！"
    echo ""
    echo "💡 提示：如果使用 Colima，执行 'colima start'"
    exit 1
fi

# 运行中的容器
RUNNING=$(docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | tail -n +2)
RUNNING_COUNT=$(docker ps -q | wc -l | tr -d ' ')

echo "🟢 运行中 ($RUNNING_COUNT 个)"
echo "$RUNNING" | while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
    fi
done

echo ""

# 已停止的容器
STOPPED=$(docker ps -a --filter "status=exited" --format "table {{.Names}}\t{{.Status}}" | tail -n +2)
STOPPED_COUNT=$(docker ps -a --filter "status=exited" -q | wc -l | tr -d ' ')

echo "🔴 已停止 ($STOPPED_COUNT 个)"
echo "$STOPPED" | while IFS= read -r line; do
    if [ -n "$line" ]; then
        echo "  $line"
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 资源占用："
docker stats --no-stream --format "  {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null
```

保存为 `docker-status.sh`，赋予执行权限：

```bash
chmod +x ~/raycast-scripts/docker-status.sh
```

#### 3.2.3 Laravel 项目快速导航

在 30+ 仓库之间切换是日常。这个脚本让我在 launcher 里直接搜索并打开项目：

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Laravel 项目导航
# @raycast.mode silent
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 🏗️
# @raycast.description 搜索并打开 Laravel 项目（在 VS Code 中）
# @raycast.argument1 { "type": "text", "placeholder": "项目名称关键词", "optional": false }
# @raycast.author Michael

PROJECT_DIR="$HOME/GitHub"
KEYWORD="$1"

if [ -z "$KEYWORD" ]; then
    echo "❌ 请输入项目名称关键词"
    exit 1
fi

# 搜索匹配的项目目录
MATCHES=$(find "$PROJECT_DIR" -maxdepth 3 -name "artisan" -type f 2>/dev/null | \
    grep -i "$KEYWORD" | \
    sed 's|/artisan||' | \
    head -5)

if [ -z "$MATCHES" ]; then
    echo "❌ 未找到包含 '$KEYWORD' 的 Laravel 项目"
    exit 1
fi

COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')

if [ "$COUNT" -eq 1 ]; then
    # 直接打开唯一匹配的项目
    PROJECT_PATH=$(echo "$MATCHES" | head -1)
    PROJECT_NAME=$(basename "$PROJECT_PATH")
    code "$PROJECT_PATH"
    echo "✅ 已在 VS Code 中打开: $PROJECT_NAME"
else
    # 多个匹配，显示列表让用户选择
    echo "🔍 找到 $COUNT 个匹配项目："
    echo "$MATCHES" | while IFS= read -r path; do
        name=$(basename "$path")
        echo "  📁 $name → $path"
    done
    echo ""
    echo "💡 请缩小关键词范围"
fi
```

#### 3.2.4 快速切换 PHP 版本

配合 `brew-php-switcher`，一键切换 PHP 版本：

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title 切换 PHP 版本
# @raycast.mode inline
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 🐘
# @raycast.description 快速切换 Homebrew PHP 版本
# @raycast.argument1 { "type": "dropdown", "placeholder": "PHP 版本", "data": [{"title": "PHP 8.0", "value": "8.0"}, {"title": "PHP 8.1", "value": "8.1"}, {"title": "PHP 8.2", "value": "8.2"}, {"title": "PHP 8.3", "value": "8.3"}, {"title": "PHP 8.4", "value": "8.4"}] }
# @raycast.author Michael

VERSION="$1"

# 切换 PHP 版本
brew-php-switcher "$VERSION" -s > /dev/null 2>&1

if [ $? -eq 0 ]; then
    CURRENT=$(php -v | head -1 | awk '{print $2}')
    echo "✅ PHP 已切换到 $CURRENT"
else
    echo "❌ 切换失败，请检查 PHP $VERSION 是否已安装"
    echo "💡 安装命令：brew install php@$VERSION"
fi
```

#### 3.2.5 Git 仓库批量状态检查

管理多个仓库时，快速查看哪些有未提交的更改：

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Git 批量状态检查
# @raycast.mode fullOutput
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 📦
# @raycast.description 检查 ~/GitHub 下所有仓库的 Git 状态
# @raycast.author Michael

GITHUB_DIR="$HOME/GitHub"
DIRS_TO_SKIP=("node_modules" ".git" "vendor" "storage" "public")

echo "📦 Git 仓库状态扫描"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DIRTY_COUNT=0
CLEAN_COUNT=0

find "$GITHUB_DIR" -maxdepth 3 -name ".git" -type d 2>/dev/null | while read git_dir; do
    repo_dir=$(dirname "$git_dir")
    repo_name=$(basename "$repo_dir")
    
    cd "$repo_dir" || continue
    
    # 获取状态
    STATUS=$(git status --porcelain 2>/dev/null)
    BRANCH=$(git branch --show-current 2>/dev/null)
    
    if [ -n "$STATUS" ]; then
        CHANGED=$(echo "$STATUS" | wc -l | tr -d ' ')
        echo "🔴 $repo_name ($BRANCH) — $CHANGED 个文件有变更"
        echo "   路径: $repo_dir"
        # 显示前 3 个变更文件
        echo "$STATUS" | head -3 | while IFS= read -r line; do
            echo "     $line"
        done
        DIRTY_COUNT=$((DIRTY_COUNT + 1))
    else
        CLEAN_COUNT=$((CLEAN_COUNT + 1))
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 干净: $CLEAN_COUNT | 🔴 有变更: $DIRTY_COUNT"
```

### 3.3 Extension 实战

Raycast 的 Extension Store 是它相比 Alfred 的最大优势。

#### 3.3.1 必装扩展

以下是我每天都在用的扩展：

```bash
# 通过 Raycast Store 安装（在 Raycast 中搜索 "Store" 即可进入）

# 核心开发工具
- GitHub          # PR、Issue、仓库搜索
- Docker          # 容器管理
- Brew            # Homebrew 包管理
- Kill Process    # 强制关闭进程

# 日常效率
- Color Picker    # 取色器
- Lorem Ipsum     # 生成测试文本
- Emoji Search    # Emoji 搜索（比系统好用 10 倍）
- Currency        # 汇率转换

# 开发辅助
- Base64          # Base64 编解码
- JSON 格式化      # JSON 格式化与压缩
- JWT Decoder     # JWT Token 解码
- Regex           # 正则表达式测试
- Timestamp       # 时间戳转换
```

#### 3.3.2 GitHub 扩展实战

安装 GitHub 扩展后，你可以：

1. **搜索仓库**：`⌘+Space` → 输入 `Search Repositories` → 输入关键词
2. **查看 PR**：`⌘+Space` → 输入 `My Pull Requests` → 直接查看分配给你的 PR
3. **创建 Issue**：`⌘+Space` → 输入 `Create Issue` → 填写表单
4. **查看通知**：`⌘+Space` → 输入 `Notifications` → 处理 GitHub 通知

**配置 GitHub Token：**

```
Settings → Extensions → GitHub → Personal Access Token
→ 生成 Token: https://github.com/settings/tokens
→ 勾选 repo, read:org, notifications
→ 粘贴到 Raycast
```

#### 3.3.3 Docker 扩展实战

比命令行快得多的容器管理：

```
# 查看所有容器
⌘+Space → "Docker" → 显示容器列表

# 操作容器
选中容器 → Enter → 看到操作菜单：
  - Start / Stop / Restart
  - View Logs
  - Open in Browser
  - Copy Container ID
  - Remove

# 查看镜像
⌘+Space → "Docker Images" → 管理镜像
```

#### 3.3.4 Window Management 实战

Raycast 内置的窗口管理**完全替代了 Rectangle**：

```
# 基础操作（默认快捷键，可在 Settings 中自定义）
⌃+⌥+←    → 左半屏
⌃+⌥+→    → 右半屏
⌃+⌥+↑    → 上半屏
⌃+⌥+↓    → 下半屏
⌃+⌥+⏎    → 最大化
⌃+⌥+C    → 居中

# 高级操作
⌃+⌥+1    → 左上 1/4
⌃+⌥+2    → 右上 1/4
⌃+⌥+3    → 左下 1/4
⌃+⌥+4    → 右下 1/4

# 多显示器
⌃+⌥+⇧+←  → 移到左侧显示器
⌃+⌥+⇧+→  → 移到右侧显示器
```

### 3.4 Snippet 实战

Snippet 是 Raycast 的「隐藏杀手」——它不只是文本替换，还支持**动态变量**。

#### 3.4.1 常用 Snippet 配置

在 Settings → Snippets 中添加：

```
# 1. 邮箱模板
Keyword: @reply
Content:
---
Hi {cursor},

Thanks for reaching out. Here's my response:

{cursor}

Best regards,
Michael
---

# 2. SQL 模板
Keyword: @sql
Content:
---
SELECT 
    {cursor}
FROM 
    {table}
WHERE 
    1 = 1
ORDER BY 
    created_at DESC
LIMIT 100;
---

# 3. Git Commit 模板
Keyword: @gc
Content:
---
{date:yyyy-MM-dd} - {clipboard}
---

# 4. Laravel Migration 模板
Keyword: @mig
Content:
---
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Schema::Table
{
    public function up(): void
    {
        Schema::table('{clipboard}', function (Blueprint $table) {
            {cursor}
        });
    }

    public function down(): void
    {
        Schema::table('{clipboard}', function (Blueprint $table) {
            //
        });
    }
};
---
```

#### 3.4.2 动态变量

Raycast Snippet 支持的动态变量：

```
{date:格式}       → 当前日期时间（Java DateTimeFormatter 格式）
{clipboard}       → 剪贴板内容
{cursor}          → 光标位置
{date}            → 等同于 {date:yyyy-MM-dd}
{datetime}        → 等同于 {date:yyyy-MM-dd HH:mm:ss}
```

**踩坑记录：**
- Snippet 的 keyword 不能与系统快捷键冲突（如 `@c` 可能与某些应用的快捷键冲突）
- 建议用 `@` 前缀 + 有意义的缩写，避免误触发
- Snippet 的 Expand 模式建议设为「After word boundary」，避免代码中误触发

### 3.5 Clipboard History 实战

#### 3.5.1 基础使用

```
# 打开剪贴板历史
⌘+Shift+V    → 显示剪贴板历史

# 搜索
直接输入关键词 → 过滤历史记录

# 固定常用内容
选中条目 → ⌘+P → Pin（置顶）

# 粘贴为纯文本
选中条目 → ⌘+⇧+V → 去除格式粘贴
```

#### 3.5.2 高级配置

```
Settings → Advanced → Clipboard History

# 排除敏感应用
→ Add Application → 选择 1Password、Keychain Access 等
→ 这些应用中的复制操作不会被记录

# 自动清理
→ Clear on exit: 关闭（保留历史）
→ History size: 500（默认太小）
```

**踩坑记录：**
- 如果你同时使用 Paste（剪贴板管理工具），会有冲突——二选一
- Clipboard History 与某些密码管理器的自动填充可能冲突，务必在排除列表中添加

### 3.6 Hotkey 体系设计

Hotkey 是 Raycast 效率的终极形态——**一切操作都有快捷键**。

#### 3.6.1 我的 Hotkey 设计原则

```
1. 高频操作用 ⌘+Shift+X（系统级，不与应用冲突）
2. 中频操作用 ⌃+⌥+X（应用级）
3. 低频操作用 Raycast 搜索（不绑快捷键）
4. 一致性：同一类操作用同一前缀
```

#### 3.6.2 推荐 Hotkey 配置

```bash
# 全局（不与任何应用冲突）
⌘+Space        → 打开 Raycast（替代 Spotlight）
⌘+Shift+V      → 剪贴板历史
⌘+Shift+/      → Raycast AI（Pro）

# 窗口管理
⌃+⌥+←/→/↑/↓   → 半屏
⌃+⌥+⏎          → 最大化
⌃+⌥+C          → 居中
⌃+⌥+1/2/3/4    → 四分之一屏

# 快速操作（自定义 Hotkey）
⌘+Shift+D      → Docker 状态（绑定到 Script Command）
⌘+Shift+G      → Git 批量状态
⌘+Shift+T      → 切换 PHP 版本
⌘+Shift+E      → 打开 VS Code 项目

# Snippet
@reply          → 邮件回复模板
@gc             → Git commit 模板
@mig            → Migration 模板
```

#### 3.6.3 为 Script Command 绑定 Hotkey

```
1. ⌘+Space 打开 Raycast
2. 搜索你的 Script Command（如 "Docker 容器状态"）
3. 选中后按 ⌘+K 打开操作菜单
4. 选择 "Add Hotkey"
5. 按下你想要的快捷键组合
```

---

## 四、踩坑记录

### 4.1 Raycast 与 Spotlight 冲突

**问题：** 安装 Raycast 后，⌘+Space 同时触发 Raycast 和 Spotlight。

**解决：**
```
System Settings → Keyboard → Keyboard Shortcuts → Spotlight
→ 取消勾选 "Show Spotlight search" 的 ⌘+Space
→ 将 Spotlight 改为 ⌘+⌥+Space（保留备用）
```

### 4.2 Script Command 不显示

**问题：** 创建了脚本文件，但 Raycast 中看不到。

**排查步骤：**
```bash
# 1. 检查文件权限
chmod +x ~/raycast-scripts/your-script.sh

# 2. 检查 YAML frontmatter 是否正确
# 必须有这些字段：
# @raycast.schemaVersion 1
# @raycast.title 标题
# @raycast.mode fullOutput 或 silent 或 inline

# 3. 检查 Script Command 目录是否已添加
# Settings → Extensions → Script Commands → 确认目录在列表中

# 4. 刷新 Script Commands
# Settings → Extensions → Script Commands → 点击目录旁的刷新按钮
```

### 4.3 Extension 权限问题

**问题：** 某些 Extension 安装后无法使用（如 GitHub Extension 无法访问 API）。

**解决：**
```
1. 检查 API Token 配置
   Settings → Extensions → GitHub → Personal Access Token

2. 检查 macOS 权限
   System Settings → Privacy & Security → Accessibility
   → 确保 Raycast 在列表中并已开启

3. 网络代理问题
   如果使用代理，确保 Raycast 的网络设置正确
   （Raycast 使用系统代理设置）
```

### 4.4 Snippet 误触发

**问题：** 在代码编辑器中输入 `@` 开头的文本时，Snippet 会被触发。

**解决：**
```
Settings → Snippets → Expand Snippets
→ 改为 "After word boundary"（默认是 "Immediately"）
→ 或者给 Snippet keyword 加上更独特的前缀，如 `@@reply` 而非 `@reply`
```

### 4.5 Clipboard History 与密码管理器冲突

**问题：** 1Password 的自动填充被 Clipboard History 干扰。

**解决：**
```
Settings → Advanced → Clipboard History → Ignored Applications
→ 添加 1Password
→ 添加 Keychain Access
→ 添加其他密码管理器
```

### 4.6 窗口管理快捷键与其他应用冲突

**问题：** `⌃+⌥+←` 与 JetBrains IDE 的「单词选择」快捷键冲突。

**解决：**
```
方案一：修改 Raycast 快捷键
Settings → Extensions → Window Management → 更改快捷键前缀

方案二：修改 JetBrains 快捷键
Preferences → Keymap → 搜索 "Extend Selection"
→ 修改为其他快捷键

方案三（推荐）：使用 ⌃+⌘ 前缀替代 ⌃+⌥
这样与 JetBrains、VS Code 的冲突最少
```

### 4.7 Raycast 占用内存过高

**问题：** 长时间运行后，Raycast 内存占用超过 500MB。

**解决：**
```bash
# 检查 Extension 数量
# Extension 越多，内存占用越大
# 禁用不常用的 Extension

# 清理 Clipboard History
Settings → Advanced → Clipboard History → Clear History

# 如果持续占用过高，重启 Raycast
# ⌘+Q 退出 Raycast，然后重新打开
```

### 4.8 Script Command 输出中文乱码

**问题：** Shell 脚本输出中文时显示乱码。

**解决：**
```bash
# 在脚本头部添加：
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 或者在脚本中使用 printf 替代 echo
printf "🐳 Docker 容器状态\n"
```

### 4.9 Script Command 的 PATH 与交互式终端不一致

**问题：** 在 Terminal 里能执行 `node`、`python3`、`php`、`pnpm`，但放到 Raycast Script Command 里却提示 command not found。

**原因：** Raycast 启动脚本时通常不会完整加载你在 `.zshrc`、`.zprofile`、`.bashrc` 里的交互式环境变量，尤其是通过 Homebrew、mise、nvm、pyenv 注入的 PATH。

**解决思路：**

```bash
# 方案一：在脚本顶部显式补 PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

# 方案二：如果你使用 mise
export PATH="$HOME/.local/share/mise/shims:$PATH"

# 方案三：调试当前 Raycast 实际拿到的 PATH
#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Debug PATH
# @raycast.mode fullOutput

echo "$PATH"
which node || true
which python3 || true
which php || true
```

**经验：** 不要假设 Raycast 的运行环境等于你在 iTerm2 或 Ghostty 里的环境。凡是依赖语言运行时、包管理器、版本管理器的脚本，最好都在开头补一遍 PATH。

### 4.10 Script Command 超时或卡住

**问题：** 某些脚本在终端里可以正常执行，但在 Raycast 中会长时间转圈，或者结果迟迟不返回。

**常见原因：**

1. 脚本里调用了需要交互输入的命令，例如 `ssh`、`sudo`、`read`
2. 脚本执行了长时间阻塞操作，比如完整日志流、长时间轮询、等待容器启动
3. 输出内容过多，Raycast 渲染体验很差

**优化方法：**

```bash
# 错误示例：会阻塞
docker logs -f my-app

# 更适合 Raycast 的写法：只展示最近 50 行
docker logs --tail 50 my-app

# 错误示例：需要密码输入
sudo lsof -i :8080

# 更好的方式：改成无需 sudo 的检查逻辑
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

**经验：** Raycast 更适合“短平快”的命令：输入参数 → 执行 → 返回结果。如果你要做长连接、交互式会话、持续刷新的监控，还是终端更合适。

### 4.11 Node / Python 脚本在 Raycast 中无法直接运行

**问题：** 明明系统已经安装 Node.js / Python，但脚本不显示或者运行失败。

**排查点：**

```bash
# Node 脚本必须保证 shebang 正确
#!/usr/bin/env node

# Python 脚本必须保证 shebang 正确
#!/usr/bin/env python3

# 都要有执行权限
chmod +x your-script.js
chmod +x your-script.py
```

另外，Raycast Script Command 并不是读取 Markdown 代码块，它读取的是脚本文件本身。也就是说，文章里的示例代码你需要保存成独立文件，再放进已添加的脚本目录里。

### 4.12 Script Command 参数设计不合理，导致命令越用越烦

**问题：** 很多人刚开始写 Script Command 时，喜欢把所有逻辑都塞进一个脚本里，让用户通过自由输入参数控制行为。结果是脚本虽然“强大”，但每天都要重新输入同样的东西。

**我的建议：**

1. 高频命令优先使用 `dropdown`、固定参数、预设环境
2. 一个脚本只做一件事，不要把“查看状态 + 启动服务 + 打开浏览器 + 清日志”全塞一起
3. 如果脚本输出超过一屏，优先考虑拆成多个命令或者改写成 Extension

例如“切换 PHP 版本”用下拉框就明显比自由输入更高效，因为可选值是固定的，输错版本号只会增加摩擦。

---

## 五、更多可运行的 Script Command 示例

上面的示例已经覆盖了 Shell 脚本场景，但如果你想把 Raycast 更深入地接入开发工作流，建议至少保留一份 Bash、一份 Node.js、一份 Python 的模板。这样你遇到系统操作、JSON 处理、API 调用时都能快速选对语言。

### 5.1 Bash：快速查看当前监听端口

适合排查“为什么本地服务启动失败”“谁占了 3000/5173/8000 端口”这类高频问题。

```bash
#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title 端口占用检查
# @raycast.mode fullOutput
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 🔌
# @raycast.description 查看指定端口是否被占用
# @raycast.argument1 { "type": "text", "placeholder": "端口号，例如 3000", "optional": false }

PORT="$1"

if [ -z "$PORT" ]; then
  echo "❌ 请输入端口号"
  exit 1
fi

echo "🔎 检查端口: $PORT"
echo ""

RESULT=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)

if [ -z "$RESULT" ]; then
  echo "✅ 端口 $PORT 当前未被监听"
  exit 0
fi

echo "$RESULT"
echo ""
echo "💡 如需结束进程，可复制 PID 后执行: kill -9 <PID>"
```

### 5.2 Node.js：格式化 JSON 并输出摘要

这个脚本特别适合处理接口响应、Webhook Payload、日志里的 JSON 字符串。相比纯 Shell，Node.js 在 JSON 解析上更稳。

```javascript
#!/usr/bin/env node

// Required parameters:
// @raycast.schemaVersion 1
// @raycast.title JSON Pretty Print
// @raycast.mode fullOutput
// @raycast.packageName Developer Utils

// Optional parameters:
// @raycast.icon 🧩
// @raycast.description 格式化 JSON 字符串并输出字段摘要
// @raycast.argument1 { "type": "text", "placeholder": "输入 JSON 字符串", "optional": false }

const input = process.argv[2];

if (!input) {
  console.log("❌ 请输入 JSON 字符串");
  process.exit(1);
}

try {
  const parsed = JSON.parse(input);
  const keys = typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : [];

  console.log("✅ JSON 解析成功");
  console.log("");
  console.log(`字段数量: ${keys.length}`);
  if (keys.length > 0) {
    console.log(`顶层字段: ${keys.join(", ")}`);
  }
  console.log("");
  console.log(JSON.stringify(parsed, null, 2));
} catch (error) {
  console.log("❌ JSON 解析失败");
  console.log(error.message);
  process.exit(1);
}
```

### 5.3 Python：查询本地 Git 仓库最近一次提交

Python 适合做轻量的数据整理和批量扫描。这个脚本会扫描 `~/GitHub` 下的仓库，并输出最近一次提交时间，适合快速判断哪些项目最近仍在活跃维护。

```python
#!/usr/bin/env python3

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title 最近提交扫描
# @raycast.mode fullOutput
# @raycast.packageName DevOps

# Optional parameters:
# @raycast.icon 🐍
# @raycast.description 扫描 ~/GitHub 下仓库最近一次提交信息

from pathlib import Path
import subprocess

root = Path.home() / "GitHub"

if not root.exists():
    print(f"❌ 目录不存在: {root}")
    raise SystemExit(1)

repos = sorted({p.parent for p in root.rglob('.git') if p.is_dir()})

if not repos:
    print("❌ 没有扫描到 Git 仓库")
    raise SystemExit(1)

print("📦 最近提交扫描")
print("=" * 60)

for repo in repos[:20]:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "log", "-1", "--pretty=format:%ad | %an | %s", "--date=short"],
            capture_output=True,
            text=True,
            check=True,
        )
        print(f"{repo.name}: {result.stdout}")
    except subprocess.CalledProcessError:
        print(f"{repo.name}: 读取失败")
```

### 5.4 如何组织你的脚本目录

当脚本数量从 3 个增长到 20 个以后，目录结构是否清晰会直接影响后续维护成本。我更推荐按用途拆目录，而不是把所有脚本都扔在同一级。

```bash
~/raycast-scripts/
├── devops/
│   ├── docker-status.sh
│   ├── check-port.sh
│   └── switch-php.sh
├── git/
│   ├── git-status-all.sh
│   └── recent-commits.py
├── utils/
│   └── json-pretty.js
└── README.md
```

**建议：**

- 文件名用英文，方便跨机器同步和 Git 管理
- `@raycast.title` 用中文，方便自己搜索
- 脚本目录本身纳入 Git 仓库管理，避免重装 macOS 后全部重配

---

## 六、对比与选型建议

### 6.1 Raycast vs Alfred vs Spotlight

| 维度 | Raycast | Alfred | Spotlight |
|------|---------|--------|-----------|
| **启动速度** | ⚡ 极快 | ⚡ 快 | 🐌 偶尔卡顿 |
| **扩展生态** | ⭐⭐⭐⭐⭐ Store 1000+ | ⭐⭐⭐⭐ 社区 | ⭐ 基础 |
| **学习曲线** | 低 | 中（Powerpack） | 无 |
| **AI 集成** | ✅ 内置 AI | ❌ | ❌ |
| **价格** | 免费基础 / Pro $8/月 | 免费基础 / Powerpack £29 | 免费 |
| **内存占用** | ~100-200MB | ~50-100MB | ~50MB |
| **窗口管理** | ✅ 内置 | 需 Powerpack | ❌ |
| **剪贴板历史** | ✅ 内置 | 需 Powerpack | ❌ |
| **Snippet** | ✅ 内置 | 需 Powerpack | ❌ |
| **Script Command** | ✅ 原生支持，适合自定义脚本 | ✅（可实现，但配置与分享成本更高） | ❌ |
| **开发工作流集成** | ⭐⭐⭐⭐⭐ GitHub、Docker、Brew、脚本联动强 | ⭐⭐⭐⭐ 老牌强者，偏重个人 Workflow 沉淀 | ⭐⭐ 仅适合基础搜索启动 |
| **上手后的可扩展性** | ⭐⭐⭐⭐⭐ 从内置命令到 Extension 都很顺滑 | ⭐⭐⭐⭐ 很强，但部分能力依赖 Powerpack 与社区 | ⭐ 近乎没有 |

### 6.2 选型建议

```
如果你是...
├── macOS 轻度用户 → Spotlight 够用
├── 需要基础效率提升 → Raycast 免费版
├── 需要深度自动化 → Raycast Pro（AI + 云同步）
├── 已经买了 Alfred Powerpack → 继续用 Alfred，迁移成本不低
└── 开发者 / 效率极客 → Raycast（生态更好，开发体验更佳）
```

### 6.3 我的推荐理由

作为 Laravel 后端开发者，我选择 Raycast 的核心原因：

1. **Extension Store 生态**：GitHub、Docker、Brew 等扩展开箱即用
2. **Script Command 灵活性**：5 分钟写一个 Shell 脚本就能集成到 launcher
3. **内置工具整合**：剪贴板、窗口管理、Snippet、计算器，一个搞定
4. **AI 集成**：Pro 版的 AI 功能让 launcher 变成了「智能助手」
5. **TypeScript 扩展开发**：对前端开发者极其友好

---

## 七、总结与最佳实践

### 7.1 核心要点

```
1. Raycast 不只是 Spotlight 替代品——它是可编程的效率平台
2. Script Command 是最快上手的扩展方式（5 分钟搞定）
3. Extension Store 是最大优势（GitHub、Docker 等开箱即用）
4. Snippet + Hotkey 是效率提升的关键组合
5. Clipboard History + Window Management 替代两个独立工具
```

### 7.2 最佳实践清单

```
✅ 必做：
1. ⌘+Space 绑定给 Raycast，Spotlight 改用 ⌘+⌥+Space
2. Clipboard History 开启并设置 500 条
3. 安装 GitHub、Docker、Brew 等核心 Extension
4. 为高频 Script Command 绑定 Hotkey
5. 配置常用 Snippet（邮件模板、SQL 模板等）

⚠️ 避免：
1. 不要安装太多 Extension（影响启动速度和内存）
2. 不要给 Snippet 设置太短的 keyword（避免误触发）
3. 不要在 Clipboard History 中记录密码管理器内容
4. 不要在脚本中硬编码路径（用 $HOME 等变量）
5. 不要忽略 Script Command 的 YAML frontmatter 格式
```

### 7.3 进阶方向

```
1. 自定义 Extension：用 TypeScript 开发专属扩展
2. Raycast AI：Pro 版的 AI 助手，可以总结网页、生成代码
3. Cloud Sync：Pro 版跨设备同步配置
4. 团队共享：将 Script Commands 和配置分享给团队
5. 与 CI/CD 集成：用 Script Command 触发 Jenkins/GitHub Actions
```

### 7.4 我的日常 Raycast 工作流

```
早晨：
  ⌘+Space → "Docker 容器状态" → 确认开发环境正常
  ⌘+Space → "Git 批量状态" → 检查昨晚的 CI 是否有失败
  ⌘+Space → "Laravel 项目" → 打开今天要开发的项目

开发中：
  ⌃+⌥+←/→    → 左右分屏（代码 + 浏览器）
  ⌘+Shift+V  → 从剪贴板历史粘贴 API Response
  @mig + Tab  → 快速生成 Migration 模板
  ⌘+Space → "JSON 格式化" → 格式化 API Response

Code Review：
  ⌘+Space → "My Pull Requests" → 查看待审 PR
  ⌘+Space → "Search Repositories" → 搜索相关代码

部署：
  ⌘+Space → "Docker" → 查看容器日志
  ⌘+Space → "Kill Process" → 杀死卡住的进程
```

---

## 参考资源

- [Raycast 官方文档](https://manual.raycast.com/)
- [Raycast Script Commands 仓库](https://github.com/raycast/script-commands)
- [Raycast Extension Store](https://www.raycast.com/store)
- [Raycast 社区 Reddit](https://www.reddit.com/r/raycastapp/)
- [Script Command 开发指南](https://manual.raycast.com/script-commands)

---

> 💡 **一句话总结：** Raycast 让 macOS 的 launcher 从「搜索入口」进化成了「可编程的效率中枢」。对开发者来说，它不只是快，更是**可扩展**——5 分钟写个脚本，就能把任何操作集成到 ⌘+Space 的世界里。

## 相关阅读

- [Arc Browser 实战：开发者友好的浏览器工作区管理](/categories/macOS/arc-browser-workspace/)
- [Lazygit 实战：终端 Git GUI 与高效分支管理踩坑记录](/categories/macOS/lazygit-terminal-git-gui/)
- [Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战踩坑记录](/categories/macOS/cursor-claude-code-hermes-workflow/)
