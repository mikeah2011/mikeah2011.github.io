---
title: macOS 开发者云存储选型：哪些文件放哪里？如何保证一致性？
date: 2026-05-05 03:00:59
updated: 2026-05-05 03:02:39
categories:
  - macOS
tags: [macOS, 工程管理]
description: >
  作为 macOS 开发者，面对 iCloud、Google Drive、NAS 等多云存储，如何科学地决定"哪个文件放哪里"？
  本文基于 KKday B2C Backend Team 的真实实践，分享文件分类决策框架、目录结构设计、一致性保障脚本，
  以及踩过的权限冲突、同步死锁、存储爆盘等坑。
---

## 前言

上一篇我们聊了 iCloud vs Google Drive 的同步策略与备份还原（[Laravel 项目同步策略备份还原实战](https://mikeah2011.github.io/posts/09_macOS/iCloud-vs-Google-Drive-Laravel-项目同步策略备份还原实战踩坑记录)），但很多开发者真正头疼的不是"用哪个云"，而是：

> **我有 100G 的开发资料，分布在哪？为什么要这么分？怎么保证不丢、不冲突？**

这篇文章就是解决这个问题的——给你一个**文件归属决策框架**、一套**目录结构模板**，以及我踩过的真实坑。

---

## 一、文件分类决策框架

### 1.1 四象限决策法

我用两个维度来决定文件放哪里：

| 维度 | 说明 |
|------|------|
| **协作频率** | 是否需要团队多人实时协作？ |
| **安全敏感度** | 泄露后影响有多大？ |

```
高协作 ┌───────────────┬───────────────┐
       │  Google Drive │  内部 Wiki/   │
       │  (共享文档)    │  Confluence   │
       │  设计稿/PRD    │  (SA/SD文档)  │
       ├───────────────┼───────────────┤
       │  iCloud       │  本地加密     │
       │  (个人项目)    │  (.env/密钥)  │
低协作 └───────────────┴───────────────┘
       低安全            高安全
```

### 1.2 决策树速查

```python
# 文件归属决策伪代码
def choose_storage(file):
    if file.is_secret:  # .env, private keys, tokens
        return "本地加密卷 + 1Password"
    if file.is_code:  # Git 仓库
        return "GitHub/GitLab (远端) + 本地 clone"
    if file.is_team_doc:  # PRD, SA/SD, 设计稿
        return "Google Drive / Confluence"
    if file.is_personal_ref:  # 读书笔记, cheatsheet, snippet
        return "iCloud (Obsidian/Notion)"
    if file.is_build_artifact:  # vendor, node_modules, .docker
        return "不同步 (加入 .gitignore / .stignore)"
    return "本地 Documents"
```

---

## 二、我的目录结构模板（macOS）

```
~/
├── Projects/                    # 所有 Git 项目（不在 iCloud/Google Drive）
│   ├── mikeah2011.github.io/   # 博客
│   ├── kkday/                  # 工作项目
│   │   ├── b2c-api/
│   │   └── affiliate-api/
│   └── side-projects/
│
├── Library/Mobile Documents/    # iCloud 自动同步
│   ├── com~apple~Pages/        # Apple Pages 文档
│   └── iCloud~md~obsidian/     # Obsidian 笔记库
│
├── Google Drive/                # Google Drive File Stream
│   ├── Team Drives/
│   │   ├── B2C Backend/        # 团队共享
│   │   │   ├── PRD/
│   │   │   ├── SA-SD/
│   │   │   └── Postmortem/
│   │   └── Engineering/
│   └── My Drive/
│       ├── Meeting Notes/
│       └── Certificates/       # 证书/资质文件
│
├── Documents/                   # 本地（不同步）
│   ├── env-backup/             # .env 备份（加密）
│   ├── ssh-keys/
│   └── screenshots/
│
├── .config/                     # dotfiles
│   ├── .zshrc                  # → iCloud (Obsidian 附件)
│   ├── .gitconfig
│   └── .ssh/
│       ├── config              # → iCloud (不含私钥)
│       └── *.pub               # → iCloud
│       └── id_*                # ← 私钥，不同步！
```

### 2.1 关键决策点详解

#### Git 项目：永远不同步到云盘

这是最重要的一条。我曾经把 Laravel 项目放在 iCloud Drive 里，结果：

```bash
# iCloud 的噩梦场景
$ git status
  vendor/laravel/framework/src/Illuminate/Database/Connection.php
  vendor/laravel/framework/src/Illuminate/Database/Connection.php  (iCloud conflict)
  vendor/laravel/framework/src/Illuminate/Database/Connection (Michael's MacBook).conflict
```

**iCloud 会把 `.git` 目录里的文件也同步，导致 git 内部数据结构损坏。** 我经历过一次 `git fsck` 失败，丢失了 3 天的本地提交。

**正确做法：**

```bash
# 项目放在标准路径
~/Projects/kkday/b2c-api/

# 用 rsync 手动备份（非实时同步）
#!/bin/bash
# backup-projects.sh
BACKUP_DIR="$HOME/Documents/backup/projects-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

for project in ~/Projects/kkday/*; do
    [ -d "$project/.git" ] || continue
    project_name=$(basename "$project")
    echo "Backing up $project_name..."
    
    # 排除 vendor 和 node_modules
    rsync -a --exclude='vendor' --exclude='node_modules' \
          --exclude='.docker' --exclude='storage/logs' \
          "$project/" "$BACKUP_DIR/$project_name/"
done

echo "Backup completed: $BACKUP_DIR"
```

#### 敏感文件：本地加密卷

`.env` 文件、SSH 私钥、API Token 绝不进云盘。我用 macOS 自带的加密磁盘映像：

```bash
# 创建加密 DMG（AES-256）
hdiutil create -size 100m -encryption AES-256 \
    -volname "SecureVault" -fs APFS \
    -attach ~/Documents/SecureVault.dmg

# 挂载后使用
open ~/Documents/SecureVault.dmg
# → 输入密码
# → /Volumes/SecureVault/ 就像普通文件夹

# 我把敏感文件软链过去
ln -s /Volumes/SecureVault/env-backup ~/.env-backup
ln -s /Volumes/SecureVault/ssh-keys ~/.ssh-keys-secure
```

#### 笔记与知识库：iCloud + Obsidian

读书笔记、技术 cheatsheet、会议记录这些**个人知识资产**放 iCloud，通过 Obsidian 管理：

```
iCloud Drive/Obsidian/
├── Vault-Mike/
│   ├── 00-Inbox/           # 快速捕获
│   ├── 01-Projects/        # 项目相关笔记
│   │   ├── B2C-API/
│   │   └── Affiliate/
│   ├── 02-Areas/           # 长期关注领域
│   │   ├── PHP-Laravel/
│   │   ├── Architecture/
│   │   └── DevOps/
│   ├── 03-Resources/       # 参考资料
│   │   ├── Cheatsheet/
│   │   └── Book-Notes/
│   ├── 04-Archive/         # 归档
│   └── Templates/          # 笔记模板
```

---

## 三、一致性保障：脚本与检查

### 3.1 文件归属审计脚本

每月跑一次，检查是否有文件"放错了地方"：

```php
<?php
// audit-storage.php
// 检查：敏感文件是否意外出现在云盘里

$cloudPaths = [
    getenv('HOME') . '/Library/Mobile Documents/',  // iCloud
    getenv('HOME') . '/Google Drive/',
];

$dangerousPatterns = [
    '/\.env$/',
    '/\.pem$/',
    '/\.key$/',
    '/id_rsa/',
    '/id_ed25519/',
    '/\.p12$/',
    '/secret/',
    '/password/',
    '/token\.json$/',
    '/credentials\.json$/',
];

$issues = [];

foreach ($cloudPaths as $cloudPath) {
    if (!is_dir($cloudPath)) continue;
    
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($cloudPath)
    );
    
    foreach ($iterator as $file) {
        if (!$file->isFile()) continue;
        
        $relativePath = str_replace($cloudPath, '', $file->getPathname());
        
        foreach ($dangerousPatterns as $pattern) {
            if (preg_match($pattern, $relativePath)) {
                $issues[] = [
                    'path' => $file->getPathname(),
                    'size' => $file->getSize(),
                    'modified' => date('Y-m-d H:i:s', $file->getMTime()),
                    'matched_pattern' => $pattern,
                ];
            }
        }
    }
}

if (empty($issues)) {
    echo "✅ No sensitive files found in cloud storage.\n";
    exit(0);
}

echo "🚨 Found " . count($issues) . " potential issues:\n\n";

foreach ($issues as $issue) {
    echo "  ⚠️  {$issue['path']}\n";
    echo "      Pattern: {$issue['matched_pattern']}\n";
    echo "      Size: " . number_format($issue['size']) . " bytes\n";
    echo "      Modified: {$issue['modified']}\n\n";
}

exit(1);
```

### 3.2 .stignore 防护（Syncthing 用户）

如果你用 Syncthing 做点对点同步，`.stignore` 文件很重要：

```
// .stignore
// 排除敏感文件
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519

// 排除构建产物
vendor
node_modules
.docker
storage/logs
storage/framework/cache
storage/framework/sessions

// 排除 macOS 临时文件
.DS_Store
._*
.Spotlight-V100
.Trashes
.fseventsd

// 排除 IDE 配置
.idea
.vscode
*.swp
*.swo
*~
```

### 3.3 iCloud 同步状态检查

```bash
#!/bin/bash
# check-icloud-sync.sh
# 检查 iCloud 文件同步状态，找出"仅云端"的文件

find ~/Library/Mobile\ Documents/ -name "*.icloud" 2>/dev/null | while read f; do
    size=$(stat -f%z "$f" 2>/dev/null || echo "0")
    echo "☁️  [EVICTED] $f ($size bytes)"
done

# 找出正在下载中的文件
brctl log --wait --shorten 2>/dev/null | grep "download" | tail -20
```

---

## 四、踩坑记录

### 坑 1：iCloud Drive `.icloud` 文件导致 Laravel 报错

**现象：** 把一个 PHP 项目放在 iCloud Drive 里开发，`vendor` 目录里的文件被 iCloud 自动驱逐（evict），变成 `.icloud` 占位文件。Laravel 启动时报 `Class not found`。

```bash
# 症状：vendor 里的 .php 文件变成了 .icloud 文件
$ ls vendor/laravel/framework/src/
Connection.php.icloud   # ← 不是真正的 PHP 文件！
```

**解决：** 项目绝不放 iCloud。已经在 iCloud 的项目，用 `brctl` 强制下载：

```bash
# 强制下载所有 iCloud 文件
find ~/iCloudDrive/Projects -name "*.icloud" -exec brctl download {} \;

# 然后移出 iCloud
mv ~/iCloudDrive/Projects ~/Projects
```

### 坑 2：Google Drive File Stream 与 Docker Volume 权限冲突

**现象：** Google Drive File Stream 挂载在 `/Users/michael/Google Drive/`，Docker 把一个 volume 挂载到这个路径下的目录。容器内文件权限错乱，`chmod` 无效。

```bash
# Google Drive File Stream 用的是 osxfuse，权限模型与本地 FS 不同
$ ls -la "/Users/michael/Google Drive/Team Drives/B2C Backend/"
total 0
drwxr-xr-x  1 michael  staff  0 Jan 15 10:00 .  # size=0，这是 osxfuse 的特征
```

**解决：** Docker volume 只映射本地路径，不映射云盘路径。需要从云盘复制文件再挂载：

```bash
# 错误做法
docker run -v "/Users/michael/Google Drive/data:/app/data" myimage

# 正确做法
cp -r "/Users/michael/Google Drive/data" ~/tmp/docker-data/
docker run -v "$HOME/tmp/docker-data:/app/data" myimage
```

### 坑 3：Obsidian 同步冲突导致笔记损坏

**现象：** 在 MacBook 和 iPhone 上同时编辑同一篇 Obsidian 笔记，iCloud 同步后产生冲突文件，原文件内容被覆盖。

```
# Obsidian 的冲突文件命名
How-to-use-Redis.md
How-to-use-Redis (Michael's MacBook Pro).md   # 冲突副本
```

**解决：** Obsidian 设置 → 同步 → 启用"冲突检测"插件，或者用 Obsidian Sync（付费，支持端到端加密）：

```json
// .obsidian/plugins/sync-conflict-resolver/data.json
{
  "conflictResolution": "keep-both",
  "autoMerge": false,
  "notifyOnConflict": true,
  "conflictFolder": "05-Conflicts"
}
```

### 坑 4：Google Drive Team Drive 共享权限继承问题

**现象：** 把 SA/SD 文档放在 Team Drive 的子文件夹里，设置了"仅查看"权限。但文件夹的父目录是"可编辑"，子文件夹的权限覆盖不生效。

**解决：** Google Drive 的权限模型是**从上往下继承**的，子目录无法收紧父目录开放的权限。要么调整父目录权限，要么把敏感文档移到独立的 Team Drive。

```
# 正确的 Team Drive 结构
Team Drives/
├── B2C Backend (所有成员可编辑)/
│   ├── PRD/                    # 可编辑
│   ├── SA-SD/                  # 可编辑
│   └── Meeting Notes/          # 可编辑
├── B2C Backend - Confidential (仅 TL 可编辑)/
│   ├── Salary Reviews/
│   └── Security Audit/
```

### 坑 5：磁盘空间爆盘——云盘缓存不释放

**现象：** Google Drive File Stream 默认会缓存最近访问的文件到本地。100GB 的 Team Drive，本地缓存占了 30GB，磁盘空间告急。

```bash
# 查看 Google Drive 缓存大小
du -sh ~/Library/Application\ Support/Google/DriveFS/

# 清理缓存（Google Drive 设置 → 本地缓存 → 清除）
# 或者用命令行：
rm -rf ~/Library/Application\ Support/Google/DriveFS/*/content_cache
```

**解决：** Google Drive 偏好设置 → 设置缓存上限，或者改为"流式传输"模式（只在打开时下载）：

```
Google Drive 偏好设置 → General → Streaming vs Mirroring
→ 选择 Streaming（节省本地空间）
→ 选择 Mirroring（离线可访问，但占空间）
```

---

## 五、我的最终方案总结

| 文件类型 | 存储位置 | 同步方式 | 备份策略 |
|----------|----------|----------|----------|
| Git 项目代码 | `~/Projects/` | Git remote | rsync 每日备份到外置硬盘 |
| .env / 私钥 | 加密 DMG | 不同步 | 1Password + 离线备份 |
| 团队文档 | Google Drive Team Drive | File Stream | Google 保留 30 天历史 |
| 个人笔记 | iCloud + Obsidian | iCloud 自动 | Obsidian Git 插件 → GitHub |
| Cheatsheet | iCloud (Markdown) | iCloud 自动 | Git 备份 |
| SSH config (公钥) | `~/.ssh/*.pub` | 手动复制到 iCloud | 1Password |
| SSH 私钥 | `~/.ssh/id_*` | 不同步 | 加密 DMG |
| 设计稿/截图 | Google Drive | File Stream | — |
| 读书笔记 | iCloud + Obsidian | iCloud 自动 | Git |
| 软件安装包 | `~/Downloads/` → 清理 | 不同步 | Homebrew 管理 |

---

## 六、自动化：定期审计 cron

```bash
# 每月 1 号运行审计
# crontab -e
0 9 1 * * php ~/Projects/scripts/audit-storage.php >> ~/Documents/logs/storage-audit.log 2>&1

# 每周日备份项目
0 10 * * 0 bash ~/Projects/scripts/backup-projects.sh >> ~/Documents/logs/backup.log 2>&1

# 每天检查磁盘空间
0 8 * * * df -h / | awk 'NR==2 {if($5+0 > 85) print "⚠️ Disk usage: "$5}' | \
    osascript -e 'display notification (do shell script "cat") with title "Disk Alert"'
```

---

## 总结

云存储不是"把文件放上去"就完事了。作为 macOS 开发者，你需要：

1. **有一个决策框架**——不是凭感觉放，而是按协作频率 × 安全敏感度分类
2. **Git 项目永远不进云盘**——这是血泪教训
3. **敏感文件用加密 DMG**——不依赖云盘的"权限"功能
4. **定期审计**——用脚本检查是否有人不小心把 `.env` 放进了 Google Drive
5. **备份 ≠ 同步**——同步是实时的，备份是点快照的，两者都要有

希望这个框架能帮你理清混乱的文件分布。如果你有更好的方案，欢迎在评论区分享。
