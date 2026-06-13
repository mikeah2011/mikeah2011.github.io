---

title: macOS 常用命令
keywords: [macOS, 常用命令]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2025-05-25 10:00:00
updated: 2026-06-06 10:00:00
categories:
- macos
- linux
tags:
- macOS
- CLI
- 开发工具
description: macOS 日常开发常用 Shell 命令速查手册：涵盖环境安装、Homebrew 包管理（formula vs cask）、文件操作与搜索、系统维护、网络调试、磁盘管理、进程管理、开发工具配置（Git/Docker/Python/Node 版本管理）、macOS 特有命令（defaults write、pbcopy、screencapture）等 200+ 条实战命令，面向 Laravel/PHP 后端与全栈开发者。
---



本文整理了 macOS 下日常开发中最常用的 Shell 命令，按场景分类，每条命令附带中文说明。从环境搭建到网络调试、从 Homebrew 包管理到进程排查，覆盖日常开发 90% 以上的终端操作需求。文章面向 Laravel/PHP 后端开发者和全栈工程师，同时兼顾了 Python、Node.js、Docker 等现代开发栈的命令需求。所有命令均在 macOS Sonoma/Sequoia 上验证过，Apple Silicon 和 Intel Mac 均适用。建议收藏本文，遇到问题时直接搜索对应章节，快速找到解决方案。

---

## 一、环境安装

首次使用 macOS 进行开发时，需要先安装基础工具链。macOS 自带的终端和命令行工具虽然够用，但距离真正的开发环境还有很大差距。以下命令按顺序执行即可完成从零到可用的开发环境搭建。整个过程大约需要 15-30 分钟，取决于网络速度。安装完成后，你将拥有一个功能完整的开发终端，支持命令自动补全、语法高亮、快速目录跳转等现代终端特性。

```shell
# 安装 Xcode Command Line Tools（提供 git、make、clang 等基础工具）
xcode-select --install

# 安装 Homebrew 包管理器（macOS 必备）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 将 Homebrew 添加到 PATH（Apple Silicon Mac）
echo '# Set PATH, MANPATH, etc., for Homebrew.' >> ~/.zprofile
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile

# 安装 iTerm2 终端（比系统自带 Terminal 功能更强）
brew install --cask iterm2

# 安装 Oh My Zsh 框架（增强 zsh 配置管理）
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
echo "source ~/.zshrc" >> ~/.zprofile

# 安装 Powerlevel10k zsh 主题（美观且信息丰富的命令行主题）
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k

# 安装 zsh 自动补全插件（输入命令时自动提示历史命令）
brew install zsh-autosuggestions
echo "source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh" >> ~/.zprofile

# 安装 zsh 语法高亮插件（命令正确显示绿色，错误显示红色）
brew install zsh-syntax-highlighting
echo "source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" >> ~/.zprofile

# 安装 zsh 快速目录跳转插件
brew install z
```

## 二、SSH 密钥管理

SSH 密钥是连接 GitHub、GitLab、远程服务器的必备凭证。相比每次输入密码的方式，SSH 密钥不仅更安全，还能实现免密登录，大幅提升日常开发效率。推荐使用 Ed25519 算法生成密钥，它比传统的 RSA 算法更安全、密钥更短、性能更好。如果你有多组账户（例如个人账户和工作账户），可以通过 SSH Config 文件实现多账户管理，不同仓库自动使用不同的密钥。

```shell
# 生成 Ed25519 SSH 密钥（比 RSA 更安全、更短）
ssh-keygen -t ed25519 -C "your_email@example.com"

# 查看公钥内容（复制到 GitHub/GitLab 的 SSH Keys 设置中）
cat ~/.ssh/id_ed25519.pub

# 测试 GitHub SSH 连接
ssh -T git@github.com

# 测试 GitLab SSH 连接
ssh -T git@gitlab.com

# 启动 ssh-agent 并添加密钥（避免每次输入密码）
eval "$(ssh-agent -s)"
ssh-add --apple-use-keychain ~/.ssh/id_ed25519

# 在 ~/.ssh/config 中配置多个账户
# Host github-work
#   HostName github.com
#   User git
#   IdentityFile ~/.ssh/id_ed25519_work

# 列出已添加的 SSH 密钥
ssh-add -l
```

## 三、Homebrew 包管理

Homebrew 是 macOS 上最强大的包管理工具，堪称 macOS 开发者的瑞士军刀。它能让你像在 Linux 上使用 apt 或 yum 一样，在 macOS 上轻松安装、更新和卸载各种软件包。理解 **Formula** 和 **Cask** 的区别是高效使用 Homebrew 的关键。Formula 是命令行工具和开发库（如 git、node、redis），而 Cask 是图形界面应用（如 iTerm2、VS Code、Google Chrome）。Homebrew 会自动处理依赖关系，管理版本升级，并且所有软件都安装在独立目录中，不会污染系统目录。在团队协作环境中，还可以通过 Brewfile 实现开发环境的批量声明和一键还原，确保团队成员拥有完全一致的开发环境。

### 3.1 Formula vs Cask

| 类型 | 说明 | 安装命令 | 示例 |
|------|------|----------|------|
| **Formula** | 命令行工具、库 | `brew install` | git, node, redis, php |
| **Cask** | GUI 图形应用 | `brew install --cask` | iterm2, visual-studio-code, google-chrome |

### 3.2 常用 Homebrew 命令

```shell
# 更新 Homebrew 本身及所有 formula 索引
brew update

# 升级所有已安装的包
brew upgrade

# 升级指定包
brew upgrade node

# 搜索包（支持模糊匹配）
brew search php

# 查看包信息（版本、依赖、安装路径）
brew info node

# 列出所有已安装的包
brew list

# 列出所有已安装的 Cask 应用
brew list --cask

# 卸载指定包
brew uninstall wget

# 清理旧版本缓存（释放磁盘空间）
brew cleanup

# 查看哪些包有可用更新
brew outdated

# 锁定某个包版本（防止被自动升级）
brew pin php@8.1

# 解除版本锁定
brew unpin php@8.1

# 查看 Homebrew 服务状态
brew services list

# 启动/停止/重启服务（如 Redis、MySQL）
brew services start redis
brew services stop redis
brew services restart mysql
```

### 3.3 多版本 PHP 管理
PHP 是 Laravel 开发的核心运行时。在实际项目中，不同的 Laravel 版本对 PHP 版本有不同要求（例如 Laravel 10 需要 PHP 8.1+，Laravel 11 需要 PHP 8.2+）。在同一台 Mac 上同时维护多个项目时，频繁切换 PHP 版本是刚需。通过 Homebrew 的多版本 PHP 安装和 `brew-php-switcher` 工具，可以实现一键切换全局 PHP 版本，避免手动修改环境变量的繁琐操作。


```shell
# 添加 PHP 多版本 tap 源
brew tap shivammathur/php

# 安装指定版本 PHP
brew install php@8.1
brew install php@8.2
brew install php@8.3

# 安装 PHP 版本切换器（一键切换 PHP 版本）
brew install brew-php-switcher

# 切换到 PHP 8.3
brew-php-switcher 8.3

# 手动切换 PHP 版本（取消链接旧版本、链接新版本）
brew unlink php@8.1
brew link --force --overwrite php@8.3

# 查看当前 PHP 版本及路径
php -v
which php
```

### 3.4 安装常用开发服务

```shell
# 安装 Nginx Web 服务器
brew install nginx

# 安装 PostgreSQL 15 数据库
brew install postgresql@15

# 安装 Redis 缓存服务
brew install redis

# 安装 MySQL 数据库
brew install mysql

# 安装 Elasticsearch
brew install elasticsearch

# 软链 Nginx 配置文件到家目录（方便管理）
ln -s $(brew --repo)/etc/nginx/servers ~/

# 启动 PostgreSQL 并设置开机自启
brew services start postgresql@15

# 初始化 PostgreSQL 数据库
initdb /opt/homebrew/var/postgresql@15
```

## 四、文件操作
macOS 基于 Unix 内核，拥有强大的文件操作命令行工具。无论是日常的文件查找、内容搜索，还是批量操作、远程同步，Shell 命令都能高效完成。特别是 `find`、`grep`、`xargs` 这三个命令的组合，堪称终端操作的三驾马车，掌握它们可以解决绝大多数文件处理场景。


### 4.1 文件与目录基础操作

```shell
# 递归列出目录结构（tree 命令替代方案，macOS 自带）
find . -type f | head -50

# 安装 tree 命令（更直观的目录树）
brew install tree
tree -L 2 -a            # 显示 2 层深度，包含隐藏文件

# 查看文件大小（人类可读格式）
ls -lh
du -sh *                 # 查看当前目录下各文件/文件夹大小
du -sh .* | sort -rh | head -10  # 查看隐藏文件/目录大小排行

# 批量重命名文件（将 .jpeg 改为 .jpg）
for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done

# 快速创建多层目录
mkdir -p ~/projects/myapp/src/components

# 查看文件类型和编码
file document.txt
file -I document.txt     # 显示 MIME 类型
```

### 4.2 文件搜索（find 命令）

```shell
# 按文件名搜索（不区分大小写）
find ~ -name "*.log" -type f 2>/dev/null
find . -iname "readme.md"     # 不区分大小写

# 按大小搜索（查找大于 100MB 的文件）
find ~ -type f -size +100M 2>/dev/null | head -20

# 按修改时间搜索（最近 7 天修改过的文件）
find . -type f -mtime -7

# 按文件类型搜索
find . -type f -name "*.php"           # 只找 PHP 文件
find . -type d -name "node_modules"    # 只找目录

# 组合条件：查找 .log 文件并删除超过 30 天的
find /var/log -name "*.log" -mtime +30 -delete

# 查找并统计某类文件数量
find . -name "*.js" -type f | wc -l

# 排除目录搜索
find . -type f -name "*.php" -not -path "*/vendor/*" -not -path "*/node_modules/*"
```

### 4.3 文件内容搜索（grep 命令）

```shell
# 递归搜索文件内容（显示文件名和行号）
grep -rn "TODO" --include="*.php" .

# 忽略大小写搜索
grep -rni "error" --include="*.log" /var/log/

# 显示匹配行及前后 3 行上下文
grep -rn -A 3 -B 3 "exception" --include="*.php" .

# 反向匹配（排除包含指定内容的行）
grep -rn -v "vendor" --include="*.php" .

# 统计匹配次数
grep -rc "function" --include="*.php" . | sort -t: -k2 -rn | head -10

# 使用正则表达式搜索
grep -rPn 'public\s+function\s+\w+' --include="*.php" .

# 组合 find + grep：在特定目录下搜索
find . -path ./vendor -prune -o -name "*.php" -exec grep -ln "TODO" {} \;
```

### 4.4 xargs 与管道组合
`xargs` 是 Shell 管道操作中最重要的命令之一，它的作用是将标准输入转换为命令参数。单独使用 `find` 只能列出文件名，但结合 `xargs` 后，可以对查找到的文件执行批量操作（删除、压缩、替换等）。`-P` 参数支持并行执行，在处理大量文件时可以显著提升速度。需要特别注意文件名中包含空格的情况，此时应使用 `xargs -0` 配合 `find -print0` 来正确处理。


```shell
# 批量删除 node_modules 目录（find + xargs 经典组合）
find . -type d -name "node_modules" -maxdepth 3 | xargs rm -rf

# 批量搜索并替换文件内容
grep -rl "old_string" --include="*.php" . | xargs sed -i '' 's/old_string/new_string/g'

# 批量统计文件行数
find . -name "*.php" -type f | xargs wc -l | sort -rn | head -20

# 批量压缩日志文件
find /var/log -name "*.log" -mtime +7 | xargs gzip

# 使用 -P 参数并行执行（加速批量操作）
find . -name "*.jpg" -type f | xargs -P 4 -I {} convert {} -resize 50% small_{}
```

### 4.5 rsync 文件同步
`rsync` 是最强大的文件同步工具，支持增量传输（只传输变化的部分）、保留文件权限和软链接、排除特定目录等功能。在部署代码到远程服务器、备份重要数据、或在多台 Mac 之间同步项目文件时，`rsync` 都是首选工具。相比 `scp`，`rsync` 在重复传输时速度更快，因为它只传输文件的差异部分。


```shell
# 同步本地目录到远程服务器（增量传输，只传输变化部分）
rsync -avz --progress ~/projects/myapp/ user@server:/var/www/myapp/

# 排除特定目录/文件
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='vendor' \
  ~/projects/myapp/ user@server:/var/www/myapp/

# 模拟运行（不实际传输，只显示会做什么）
rsync -avzn --delete ~/projects/myapp/ user@server:/var/www/myapp/

# 备份整个家目录（保留权限和软链接）
rsync -avz --progress ~/ /Volumes/Backup/home_backup/

# 限制传输带宽（单位 KB/s）
rsync -avz --bwlimit=5000 ~/projects/ user@server:/backup/
```

## 五、系统维护
macOS 虽然以稳定著称，但长时间使用后也会积累各种缓存文件、日志数据和过期的开发环境文件，导致磁盘空间不足或系统变慢。定期进行系统维护可以保持 Mac 始终处于最佳状态。本节介绍系统信息查看、缓存清理、以及使用 `defaults write` 命令深度定制 macOS 系统行为的方法。`defaults write` 是 macOS 独有的强大工具，它可以修改系统和应用的各种隐藏设置，很多在系统偏好设置中找不到的选项都可以通过它来调整。


### 5.1 系统信息查看

```shell
# 查看 macOS 版本和硬件信息
sw_vers                    # 显示 macOS 版本
system_profiler SPHardwareDataType  # 显示硬件信息（CPU、内存等）
uname -a                   # 内核版本信息

# 查看磁盘使用情况
df -h                      # 所有挂载点磁盘使用率
diskutil list              # 列出所有磁盘及分区

# 查看内存使用情况
vm_stat                    # 虚拟内存统计
top -l 1 -s 0 | head -10  # 内存和 CPU 概览

# 查看系统运行时间和负载
uptime

# 查看系统日志（排查崩溃、错误）
log show --predicate 'eventMessage contains "error"' --last 1h
```

### 5.2 清理系统缓存

```shell
# 清理 Homebrew 缓存
brew cleanup --prune=all

# 清理 Xcode 模拟器缓存（通常占用很大空间）
xcrun simctl delete unavailable

# 清理 Xcode DerivedData 缓存
rm -rf ~/Library/Developer/Xcode/DerivedData/*

# 清理系统 DNS 缓存
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

# 清理 pip 缓存
pip cache purge

# 清理 npm 缓存
npm cache clean --force

# 清理 yarn 缓存
yarn cache clean

# 查看 Time Machine 本地快照（占用磁盘空间）
tmutil listlocalsnapshots /
# 删除本地快照
tmutil deletelocalsnapshots 2025-01-01-000000

# 查看最大的文件和目录（磁盘空间分析）
du -sh ~/Library/* | sort -rh | head -20
```

### 5.3 macOS defaults write 系统设置

```shell
# 显示所有文件扩展名（默认隐藏已知类型的扩展名）
defaults write NSGlobalDomain AppleShowAllExtensions -bool true

# 显示 Finder 路径栏
defaults write com.apple.finder ShowPathbar -bool true

# 显示 Finder 状态栏
defaults write com.apple.finder ShowStatusBar -bool true

# Finder 显示隐藏文件
defaults write com.apple.finder AppleShowAllFiles -bool true

# 保存截图到指定目录（默认保存到桌面）
defaults write com.apple.screencapture location ~/Screenshots

# 截图格式改为 PNG（默认）
defaults write com.apple.screencapture type png

# 禁用"是否确认打开从互联网下载的文件"对话框
defaults write com.apple.LaunchServices LSQuarantine -bool false

# 键盘按键重复速度加快
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15

# 触控板轻点点击（不需要用力按压）
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool true
defaults -currentHost write NSGlobalDomain com.apple.mouse.tapBehavior -int 1

# Dock 自动隐藏且无延迟
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -float 0

# 重启 Finder 和 Dock 使设置生效
killall Finder
killall Dock
```

## 六、网络调试
网络调试是后端开发者和运维工程师的日常必修课。当 API 请求失败、端口冲突、DNS 解析异常时，终端命令往往是最快的排查工具。本节从基础的网络诊断、端口排查，到进阶的 tcpdump 抓包分析，覆盖了开发中最常见的网络问题排查场景。掌握这些命令可以让你在遇到网络问题时不再手足无措，快速定位问题根源。


### 6.1 网络诊断基础

```shell
# 查看网络接口和 IP 地址
ifconfig                    # 查看所有网络接口
ipconfig getifaddr en0      # 获取指定接口的 IP 地址

# 测试网络连通性
ping -c 4 google.com        # 发送 4 个 ICMP 包

# 追踪路由（查看数据包经过的节点）
traceroute google.com

# DNS 查询
nslookup google.com         # 查询域名解析
dig google.com              # 更详细的 DNS 查询（显示 TTL、记录类型等）
dig +short google.com       # 只显示 IP 地址

# 查看 DNS 缓存
sudo discoveryutil udnsflushecache  # macOS 旧版
sudo dscacheutil -statistics        # 查看 DNS 缓存统计
```

### 6.2 端口与连接排查

```shell
# 查看指定端口被哪个进程占用
lsof -i :8080
lsof -i :3306
lsof -i :6379

# 查看所有已建立的网络连接
lsof -i -P -n | grep ESTABLISHED

# 查看所有监听的端口
lsof -i -P -n | grep LISTEN

# 使用 netstat 查看端口监听（macOS 版）
netstat -an | grep LISTEN
netstat -an | grep 8080

# 查看指定进程的网络连接
lsof -p <PID> -i

# 关闭占用端口的进程
kill -9 $(lsof -t -i :8080)
```

### 6.3 网络抓包与调试

```shell
# 抓取指定接口的网络包（需要 root 权限）
sudo tcpdump -i en0 -c 100        # 抓取 100 个包

# 抓取 HTTP 流量
sudo tcpdump -i en0 -A port 80

# 抓取指定主机的流量
sudo tcpdump -i en0 host 192.168.1.100

# 使用 curl 调试 API 请求（显示详细连接信息）
curl -v https://api.example.com/health

# 测试 HTTPS 连接和证书
curl -vI https://example.com 2>&1 | grep -E "(SSL|expire|subject)"

# 使用 nc（netcat）测试端口连通性
nc -zv example.com 443

# 测量请求耗时
curl -o /dev/null -s -w "DNS: %{time_namelookup}s\nConnect: %{time_connect}s\nTLS: %{time_appconnect}s\nTotal: %{time_total}s\n" https://example.com
```

## 七、磁盘管理
磁盘空间管理是 macOS 用户经常遇到的问题，尤其是 256GB 或 512GB 存储配置的 MacBook，空间非常宝贵。通过命令行工具可以精确查看磁盘使用情况，找到占用空间最大的文件和目录。`diskutil` 是 macOS 自带的磁盘管理工具，功能远比图形界面的磁盘工具强大，支持格式化、分区、挂载、卸载等操作。


```shell
# 查看磁盘分区列表
diskutil list

# 查看磁盘使用情况（人类可读格式）
df -h

# 查看当前目录总大小
du -sh .

# 查看子目录各自大小（按大小排序）
du -sh */ | sort -rh

# 查看指定目录占用空间
du -sh ~/Library/Caches
du -sh ~/Library/Developer
du -sh ~/.Trash

# 安全清空废纸篓
rm -rf ~/.Trash/*

# 挂载/卸载外接磁盘
diskutil mount /dev/disk2s1
diskutil unmount /dev/disk2s1

# 格式化磁盘为 APFS
diskutil eraseDisk APFS "MyDisk" /dev/disk2

# 创建 APFS 宗卷（在现有容器中创建新卷）
diskutil apfs addVolume disk2 APFS "NewVolume"

# 检查并修复磁盘权限（macOS Big Sur 及以后版本不需要）
diskutil verifyDisk disk0s2
diskutil repairVolume disk0s2
```

## 八、进程管理
进程管理是系统运维的核心技能之一。当某个服务卡死、内存泄漏、或者端口被占用时，你需要快速找到对应的进程并进行处理。macOS 提供了丰富的进程管理命令，从基础的 `ps`、`top` 到高级的 `lsof`，可以满足各种进程排查需求。特别要注意的是，macOS 的 `ps` 命令默认使用 BSD 风格参数（不带 `-`），而 `ps -ef` 则是 System V 风格，两者输出格式略有不同。


```shell
# 查看所有进程（BSD 风格）
ps aux | grep nginx

# 查看进程树
ps -ef | grep php

# 实时查看进程状态（类似 Linux 的 top）
top                         # 按 q 退出，按 P 按 CPU 排序，按 M 按内存排序
top -o cpu                  # 按 CPU 使用率排序

# 使用 htop 替代 top（需安装）
brew install htop
htop

# 按名称查找进程 PID
pgrep -f "php-fpm"
pidof nginx                 # 某些系统不支持，用 pgrep 替代

# 杀死指定进程
kill <PID>                  # 发送 SIGTERM（优雅终止）
kill -9 <PID>               # 发送 SIGKILL（强制终止）

# 按名称杀进程
killall nginx
pkill -f "php artisan queue:work"

# 查看指定进程打开的文件和网络连接
lsof -p <PID>

# 查看进程的详细信息（启动时间、CPU/内存使用）
ps -p <PID> -o pid,lstart,etime,%cpu,%mem,command

# 后台运行命令（即使关闭终端也不会停止）
nohup php artisan queue:work &
```

## 九、macOS 特有命令

这些是 macOS 独有的实用命令，在 Linux 上通常不可用。它们充分利用了 macOS 的图形界面能力和系统级集成，让终端操作更加便捷。比如 `pbcopy` 和 `pbpaste` 可以在命令行和剪贴板之间无缝传递数据，`open` 命令可以用默认应用打开文件或目录，`screencapture` 支持各种截图模式，`say` 可以将文字转为语音朗读。这些命令是 macOS 作为开发平台的独特优势之一。

### 9.1 pbcopy / pbpaste（剪贴板操作）

```shell
# 复制文件内容到剪贴板
cat ~/.ssh/id_ed25519.pub | pbcopy

# 复制命令输出到剪贴板
echo "Hello World" | pbcopy

# 将剪贴板内容粘贴到文件
pbpaste > output.txt

# 粘贴剪贴板内容（等同于 Cmd+V 的终端版）
pbpaste

# 复制当前目录路径到剪贴板
pwd | pbcopy
```

### 9.2 open 命令

```shell
# 用默认应用打开文件
open document.pdf           # 用 Preview 打开 PDF
open image.png              # 用 Preview 打开图片

# 用指定应用打开
open -a "Visual Studio Code" .    # 用 VS Code 打开当前目录
open -a "Google Chrome" index.html # 用 Chrome 打开 HTML 文件

# 打开当前目录的 Finder 窗口
open .

# 打开 URL
open https://github.com

# 打开系统偏好设置
open "x-apple.systempreferences:com.apple.preference"
```

### 9.3 screencapture（屏幕截图）

```shell
# 全屏截图（保存到桌面）
screencapture ~/Desktop/screenshot.png

# 交互式截图（手动选择区域）
screencapture -i ~/Desktop/screenshot.png

# 截图后直接复制到剪贴板（不保存文件）
screencapture -c

# 带窗口阴影的窗口截图
screencapture -l$(osascript -e 'tell app "Finder" to get id of window 1') window.png

# 延迟 5 秒截图（给时间准备）
screencapture -T 5 ~/Desktop/delayed.png

# 录制屏幕（macOS 自带，按 Command+Control+Esc 停止）
screencapture -v ~/Desktop/recording.mov
```

### 9.4 say 命令（文字转语音）

```shell
# 朗读文本
say "Hello, welcome to macOS"

# 用中文朗读
say -v Ting-Ting "你好，欢迎使用 macOS"

# 列出所有可用语音
say -v '?'

# 朗读文件内容
say -f readme.txt

# 将文本转为音频文件
say -o output.aiff "This is a test"
```

### 9.5 其他实用命令

```shell
# 查看电池状态和健康度
pmset -g batt

# 快速查看文件（Quick Look）
qlmanage -p file.pdf

# 生成 UUID
uuidgen

# 计算文件 SHA256 校验和
shasum -a 256 file.zip

# 查看 macOS 系统信息概览（弹窗形式）
system_profiler SPSoftwareDataType

# 使用 spotlight 搜索文件
mdfind "name:*.log"
mdfind -name "docker-compose"

# 查看文件的扩展属性（quarantine 标记等）
xattr -l downloaded_file.dmg

# 移除下载文件的隔离属性
xattr -d com.apple.quarantine downloaded_file.dmg
```

## 十、开发工具配置
工欲善其事，必先利其器。合理的开发工具配置可以大幅提升日常编码效率。本节覆盖 Git、Docker、Python、Node.js、PHP 五大开发工具的常用配置和快捷操作。其中 Git 别名可以将常用命令缩短到 2-3 个字符，Docker 的清理命令可以帮你回收大量磁盘空间，而 Python 和 Node.js 的版本管理器则让你轻松在多个项目之间切换不同的运行时版本。


### 10.1 Git 常用别名与配置

```shell
# 全局 Git 用户配置
git config --global user.name "Your Name"
git config --global user.email "your_email@example.com"

# 设置默认分支名为 main
git config --global init.defaultBranch main

# 设置 Git 别名（极大提升效率）
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.last 'log -1 HEAD --stat'
git config --global alias.lg "log --oneline --graph --decorate --all"
git config --global alias.unstage 'reset HEAD --'
git config --global alias.df 'diff --color'
git config --global alias.amend 'commit --amend --no-edit'
git config --global alias.wip '!git add -A && git commit -m "WIP"'

# 查看 Git 全局配置
git config --global --list

# 设置 Git 使用 VS Code 作为 diff 和 merge 工具
git config --global diff.tool vscode
git config --global difftool.vscode.cmd 'code --wait --diff $LOCAL $REMOTE'
git config --global merge.tool vscode
git config --global mergetool.vscode.cmd 'code --wait $MERGED'
```

### 10.2 Docker 快捷操作
Docker 是现代微服务开发的基础设施，在本地开发中广泛用于运行数据库、缓存、消息队列等中间件服务。长期使用 Docker 后，未使用的镜像、容器、网络和卷会占用大量磁盘空间（通常可达数十 GB），定期清理是必要的维护操作。以下命令涵盖了日常 Docker 操作中最常用的指令，以及一些容易被忽略但非常实用的清理技巧。


```shell
# 查看运行中的容器
docker ps

# 查看所有容器（包括已停止的）
docker ps -a

# 停止所有运行中的容器
docker stop $(docker ps -q)

# 删除所有已停止的容器
docker container prune -f

# 删除所有未使用的镜像（释放磁盘空间）
docker image prune -a -f

# 查看 Docker 磁盘使用情况
docker system df

# 彻底清理 Docker（容器、镜像、网络、缓存）
docker system prune -a --volumes -f

# 进入运行中的容器
docker exec -it <container_name> /bin/bash

# 查看容器日志（实时跟踪）
docker logs -f --tail 100 <container_name>

# 从容器复制文件到宿主机
docker cp <container_name>:/app/logs/app.log ./app.log

# Docker Compose 快捷操作
docker compose up -d          # 后台启动所有服务
docker compose down            # 停止并移除所有服务
docker compose logs -f         # 查看日志
docker compose ps              # 查看服务状态
docker compose restart app     # 重启指定服务
```

### 10.3 Python 版本管理
Python 在后端开发中的应用场景越来越广泛，从 AI 辅助脚本、数据处理管道到自动化测试工具，都离不开 Python。不同项目可能依赖不同的 Python 版本，`pyenv` 可以让你在同一台 Mac 上安装和管理多个 Python 版本，并通过 `.python-version` 文件实现项目级别的版本自动切换。配合 `uv` 或 `pipx` 等现代工具，可以进一步提升 Python 开发的效率和体验。


```shell
# 安装 pyenv（Python 多版本管理器）
brew install pyenv

# 安装指定 Python 版本
pyenv install 3.11.0
pyenv install 3.12.0

# 设置全局默认 Python 版本
pyenv global 3.12.0

# 设置项目级别 Python 版本（在项目根目录执行）
pyenv local 3.11.0

# 查看已安装的 Python 版本
pyenv versions

# 查看可安装的 Python 版本列表
pyenv install --list | grep "3\."

# 安装 uv（超快的 Python 包管理器，替代 pip）
brew install uv
uv pip install requests       # 安装包
uv venv                       # 创建虚拟环境
uv pip sync requirements.txt  # 同步依赖

# 安装 pipx（全局安装 Python CLI 工具）
brew install pipx
pipx install httpie           # 安装 HTTPie
pipx install ruff             # 安装 Ruff linter
```

### 10.4 Node.js 版本管理

```shell
# 安装 nvm（Node.js 版本管理器）
brew install nvm
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc

# 安装指定 Node.js 版本
nvm install 18
nvm install 20

# 切换 Node.js 版本
nvm use 20

# 设置默认版本
nvm alias default 20

# 查看已安装的版本
nvm ls

# 使用 pnpm 替代 npm（更节省磁盘空间）
brew install pnpm
pnpm install                  # 安装依赖
pnpm add <package>            # 添加依赖
```

### 10.5 PHP 开发快捷命令
PHP 和 Laravel 是很多 macOS 开发者的主力技术栈。以下整理了日常开发中使用频率最高的 PHP 相关命令，包括 Artisan 命令行工具、Composer 依赖管理、以及 PHP 环境诊断。建议将常用的 Artisan 命令通过 alias 缩短，例如 `alias art='php artisan'`，这样可以大幅减少重复输入的时间。


```shell
# 使用 Laravel Artisan 常用命令
php artisan serve             # 启动开发服务器
php artisan migrate           # 运行数据库迁移
php artisan make:model Post -mcr  # 生成模型+迁移+控制器
php artisan tinker            # 进入交互式 REPL
php artisan queue:work        # 处理队列任务

# Composer 常用操作
composer install              # 安装依赖（根据 composer.lock）
composer update               # 更新依赖（根据 composer.json）
composer dump-autoload        # 重新生成自动加载文件
composer require --dev phpunit/phpunit  # 安装开发依赖

# 使用 brew-php-switcher 快速切换 PHP 版本
brew-php-switcher 8.3

# 查看当前 PHP 配置
php --ini                     # 查看 php.ini 文件位置
php -m                        # 查看已加载的扩展
php -i | grep xdebug         # 查看 Xdebug 配置
```

## 十一、实用技巧与快捷键
除了具体命令之外，掌握终端快捷键和 Shell 技巧可以进一步提升操作效率。很多开发者忽略了这些小技巧，但一旦习惯使用，每天可以节省大量时间。比如 `Ctrl+R` 反向搜索历史命令比手动翻阅历史高效十倍，`Ctrl+A/E` 快速跳转行首行尾比鼠标点击更精准，自定义 alias 可以将长命令缩短为一个单词。


### 11.1 终端快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + A` | 跳转到行首 |
| `Ctrl + E` | 跳转到行尾 |
| `Ctrl + U` | 删除光标前的所有内容 |
| `Ctrl + K` | 删除光标后的所有内容 |
| `Ctrl + W` | 删除光标前的一个单词 |
| `Ctrl + Y` | 粘贴被删除的内容（撤销 Ctrl+U/K/W） |
| `Ctrl + R` | 反向搜索历史命令 |
| `Ctrl + L` | 清屏（等同于 clear） |
| `Ctrl + C` | 终止当前命令 |
| `Ctrl + Z` | 挂起当前命令（用 fg 恢复） |
| `Option + ←/→` | 按单词移动光标 |
| `Cmd + K` | 清屏（iTerm2） |

### 11.2 常用 Shell 技巧

```shell
# 上一条命令的最后参数（非常实用）
vim !$

# 重复上一条命令
!!

# 在后台运行命令（关闭终端也不会停止）
nohup ./long_running_script.sh &

# 将命令输出同时保存到文件和显示在终端
ls -la | tee output.txt

# 快速编辑上一条命令
fc

# 使用 alias 定义常用快捷命令
alias ll='ls -la'
alias gs='git status'
alias gp='git push'
alias dc='docker compose'
alias art='php artisan'
alias sail='./vendor/bin/sail'

# 使 alias 永久生效（添加到 ~/.zshrc）
echo "alias ll='ls -la'" >> ~/.zshrc
echo "alias gs='git status'" >> ~/.zshrc
echo "alias gp='git push'" >> ~/.zshrc

# 计算命令执行时间
time make test

# 生成随机密码
openssl rand -base64 32

# 快速启动 HTTP 文件服务器（分享文件给同事）
python3 -m http.server 8080

# 监控文件变化并执行命令（安装 fswatch）
brew install fswatch
fswatch -o src/ | xargs -n1 -I{} make build
```

---

## 相关阅读

- [macOS APP 管理神器——brew](/categories/macOS/brew/) —— Homebrew 深度使用指南，涵盖 Formula、Cask、Tap 详解
- [iTerm2 + Oh My Zsh 实战：终端美化与效率提升踩坑记录](/categories/macOS/iterm2-oh-my-zsh-guide/) —— 终端配置全流程：主题、插件、快捷键体系
- [VS Code 高效开发实战](/categories/macOS/vs-code-guide/) —— 扩展选型、快捷键体系、Xdebug 调试配置
- [Homebrew 自动更新脚本开发：macOS 开发环境自动化实战](/categories/macOS/homebrew-macos-automation/) —— brew upgrade 无人值守、Launchd 定时调度
- [MacOS基础](/categories/macOS/macos/) —— macOS 开发环境搭建、pecl 扩展安装、常用工具与快捷键

