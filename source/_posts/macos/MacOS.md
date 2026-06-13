---

title: macOS 开发环境基础配置：终端、Homebrew 与开发工具链
keywords: [macOS, Homebrew, 开发环境基础配置, 终端, 与开发工具链]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
tags:
- macOS
- 开发环境
categories:
- macos
date: 2021-03-20 15:05:07
description: 全面的macOS开发者指南：涵盖Homebrew包管理器、pecl PHP扩展安装（Redis/Kafka/MongoDB/Swoole/Xdebug）、pbcopy剪贴板命令、常用终端工具与快捷键、Xcode CLI与Rosetta 2环境搭建，以及SIP/Gatekeeper等常见问题排查，助你高效搭建macOS开发环境。
---





## 前言

macOS 以其优雅的界面和强大的 Unix 内核，成为众多开发者的首选操作系统。本文将系统性地介绍 macOS 下的开发环境搭建、常用命令行工具、包管理器使用技巧以及常见问题的排查方法，帮助你快速打造高效的开发工作站。

---

## 一、开发环境基础搭建

### 1.1 安装 Xcode Command Line Tools

Xcode Command Line Tools 是 macOS 开发的基石，它提供了 Git、Make、Clang 等核心工具链。

```bash
# 安装命令行工具
xcode-select --install

# 验证安装
xcode-select -p
# 输出: /Library/Developer/CommandLineTools

# 查看版本
gcc --version
git --version
```

如果遇到安装失败，可以尝试重置：

```bash
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

### 1.2 Apple Silicon 与 Rosetta 2

如果你使用的是 M1/M2/M3 等 Apple Silicon 芯片，部分工具仍然需要通过 Rosetta 2 来兼容运行。

```bash
# 安装 Rosetta 2
softwareupdate --install-rosetta

# 以 Rosetta 模式运行某个终端
arch -x86_64 /bin/bash

# 查看当前 shell 架构
uname -m
# Apple Silicon 输出: arm64
# Intel 输出: x86_64

# 为某个应用启用 Rosetta（在 Finder 中）
# 右键应用 -> 显示简介 -> 勾选"使用 Rosetta 打开"
```

> **提示**：Homebrew 在 Apple Silicon 上安装路径为 `/opt/homebrew`，而非 Intel 上的 `/usr/local`。确保你的 `PATH` 环境变量中包含了正确路径。

```bash
# ~/.zshrc 中添加（Apple Silicon）
eval "$(/opt/homebrew/bin/brew shellenv)"

# Intel Mac
eval "$(/usr/local/bin/brew shellenv)"
```

---

## 二、Homebrew 包管理器

[Homebrew](https://brew.sh/) 是 macOS 上最流行的包管理器，被誉为"macOS 缺失的包管理器"。它能让你轻松安装、更新和管理数以万计的命令行工具和应用程序。

### 2.1 安装 Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2.2 基本使用

```bash
# 安装软件包
brew install wget
brew install node
brew install php
brew install redis
brew install mysql

# 安装指定版本
brew install php@8.1
brew install node@18

# 搜索软件包
brew search nginx
brew search php

# 查看软件包信息
brew info nginx

# 列出已安装的软件包
brew list

# 升级单个软件包
brew upgrade nginx

# 升级所有可升级的软件包
brew upgrade

# 卸载软件包
brew uninstall wget

# 锁定软件包版本（防止被升级）
brew pin php@8.1

# 解除锁定
brew unpin php@8.1
```

### 2.3 Homebrew Cask（GUI 应用管理）

Homebrew Cask 用于安装 macOS 图形界面应用程序。

```bash
# 安装 GUI 应用
brew install --cask google-chrome
brew install --cask visual-studio-code
brew install --cask iterm2
brew install --cask docker
brew install --cask postman
brew install --cask sequel-pro

# 搜索 Cask 应用
brew search --cask firefox

# 列出已安装的 Cask 应用
brew list --cask
```

### 2.4 清理与维护

```bash
# 清理旧版本和缓存
brew cleanup

# 查看可清理的大小
brew cleanup --dry-run

# 诊断 Homebrew 环境问题
brew doctor

# 更新 Homebrew 自身及软件包索引
brew update

# 查看哪些包有可用更新
brew outdated

# 导出已安装包列表（用于迁移备份）
brew bundle dump

# 从 Brewfile 恢复安装
brew bundle
```

**Brewfile 示例**：

```ruby
# Brewfile
tap "homebrew/services"
brew "php@8.2"
brew "nginx"
brew "redis"
brew "mysql"
brew "node"
cask "iterm2"
cask "visual-studio-code"
cask "docker"
```

---

## 三、PECL 安装 PHP 扩展

[PECL](https://pecl.php.net/)（PHP Extension Community Library）是 PHP 扩展的官方仓库。在 macOS 上，通过 pecl 可以方便地安装各种 PHP 扩展。

### 3.1 安装 Redis 扩展

```bash
pecl install redis
```

安装完成后，在 `php.ini` 中添加：

```ini
extension=redis.so
```

### 3.2 安装 Rdkafka（Kafka）扩展

安装 kafka 扩展前，确保 macOS 已经安装了 `librdkafka` 依赖库：

```bash
# 先安装 librdkafka 依赖
brew install librdkafka

# 安装 rdkafka 扩展
pecl install rdkafka
```

### 3.3 安装 MongoDB 扩展

因为 mongodb 扩展在默认版本下，对 PHP 的版本要求较高（通常需要 7.2+），可以指定版本安装：

```bash
# 安装指定版本的 MongoDB 扩展
pecl install mongodb-1.11.1

# 或安装最新版
pecl install mongodb
```

### 3.4 安装 Swoole 扩展

Swoole 是一个高性能的 PHP 异步编程框架，安装时可以指定编译选项：

```bash
# 基本安装
pecl install swoole

# 常用编译选项
pecl install --enable-openssl \
             --enable-http2 \
             --enable-swoole-curl \
             swoole
```

在 `php.ini` 中添加：

```ini
extension=swoole.so
```

### 3.5 安装 Xdebug 扩展

Xdebug 是 PHP 调试和代码覆盖率分析的利器：

```bash
# 安装 Xdebug
pecl install xdebug
```

配置 `php.ini`：

```ini
zend_extension=xdebug
xdebug.mode=debug
xdebug.start_with_request=yes
xdebug.client_host=127.0.0.1
xdebug.client_port=9003
```

### 3.6 批量安装与版本管理

```bash
# 一次性安装多个扩展
pecl install redis rdkafka mongodb-1.11.1

# 查看已安装的扩展
pecl list

# 查看扩展的可用版本
pecl remote-info redis

# 卸载扩展
pecl uninstall redis

# 安装特定版本的扩展（参考地址）
# https://pecl.php.net/packages.php
```

### 3.7 PHP 版本切换技巧

如果你通过 Homebrew 安装了多个 PHP 版本，可以使用以下方法切换：

```bash
# 查看当前 PHP 版本
php -v

# 切换到 PHP 8.1
brew link --overwrite --force php@8.1

# 或者使用别名在 ~/.zshrc 中快速切换
alias php81="brew link --overwrite --force php@8.1 && php -v"
alias php82="brew link --overwrite --force php@8.2 && php -v"
alias php83="brew link --overwrite --force php@8.3 && php -v"
```

---

## 四、pbcopy 与 pbpaste 剪贴板命令

`pbcopy` 和 `pbpaste` 是 macOS 独有的剪贴板操作命令，在终端中非常实用。

### 4.1 pbcopy（复制到剪贴板）

```bash
# 将文件内容复制到剪贴板
pbcopy < ~/.ssh/id_rsa.pub

# 将命令输出复制到剪贴板
echo "Hello, macOS" | pbcopy

# 将目录列表复制到剪贴板
ls -la | pbcopy

# 将当前分支名复制到剪贴板（Git 开发常用）
git branch --show-current | pbcopy

# 将环境变量值复制到剪贴板
echo $PATH | pbcopy
```

### 4.2 pbpaste（从剪贴板粘贴）

```bash
# 将剪贴板内容输出到终端
pbpaste

# 将剪贴板内容写入文件
pbpaste > output.txt

# 将剪贴板内容追加到文件
pbpaste >> output.txt

# 将剪贴板内容通过管道传递
pbpaste | grep "keyword"
```

### 4.3 实际应用场景

```bash
# 场景一：快速分享 SSH 公钥
pbcopy < ~/.ssh/id_rsa.pub
echo "公钥已复制到剪贴板，直接去 GitHub 粘贴即可"

# 场景二：复制当前目录路径
pwd | pbcopy

# 场景三：将日志关键信息复制出来分析
tail -100 /var/log/system.log | pbcopy

# 场景四：复制上一条命令结果
!! | pbcopy  # 注意：需要上一条命令有输出
```

---

## 五、macOS 常用开发者工具

### 5.1 open 命令

`open` 命令用于在 Finder 或默认应用中打开文件、目录和 URL。

```bash
# 用默认编辑器打开文件
open ~/.zshrc

# 用 Finder 打开当前目录
open .

# 用指定应用打开文件
open -a "Visual Studio Code" ~/project

# 用默认浏览器打开 URL
open https://www.google.com

# 新建 Finder 窗口并打开指定目录
open -a Finder ~/Documents

# 打开并等待应用关闭
open -W -a "TextEdit" readme.txt
```

### 5.2 say 命令

`say` 是 macOS 的文字转语音工具，也可用于脚本中做任务完成提醒。

```bash
# 朗读文字
say "Hello, welcome to macOS"

# 使用中文语音
say -v "Ting-Ting" "你好，欢迎使用 macOS"

# 查看所有可用语音
say -v '?'

# 生成音频文件
say -o output.aiff "This is a test"

# 脚本中使用：长时间任务完成后语音提醒
long_running_command && say "任务完成"
```

### 5.3 screencapture 截屏工具

```bash
# 全屏截图并保存到桌面
screencapture ~/Desktop/screenshot.png

# 选区截图
screencapture -i ~/Desktop/selected.png

# 窗口截图（点击选择窗口）
screencapture -w ~/Desktop/window.png

# 截图到剪贴板（直接粘贴使用）
screencapture -c

# 延迟截图（5秒后）
screencapture -T 5 ~/Desktop/delayed.png

# 录屏（macOS Mojave 及以上）
screencapture -v ~/Desktop/recording.mov
```

### 5.4 defaults write 系统偏好设置

`defaults` 命令可以直接修改 macOS 的系统偏好设置。

```bash
# 显示隐藏文件
defaults write com.apple.finder AppleShowAllFiles -bool TRUE
killall Finder

# 隐藏桌面图标
defaults write com.apple.finder CreateDesktop -bool FALSE
killall Finder

# 截图保存格式改为 PNG（默认就是）
defaults write com.apple.screencapture type png

# 截图保存位置
defaults write com.apple.screencapture location ~/Desktop/Screenshots

# 禁用"你的 Mac 从互联网下载的应用"警告
defaults write com.apple.LaunchServices LSQuarantine -bool FALSE

# 加速 Dock 栏动画
defaults write com.apple.dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0.5
killall Dock

# 显示电池百分比（笔记本）
defaults write com.apple.menuextra.battery ShowPercent -string "YES"

# 设置 Dock 栏图标大小
defaults write com.apple.dock tilesize -int 48

# 开启三指拖移
defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerDrag -bool TRUE
```

### 5.5 networksetup 网络管理

```bash
# 查看所有网络服务
networksetup -listallnetworkservices

# 查看 Wi-Fi 信息
networksetup -getairportnetwork en0

# 连接指定 Wi-Fi
networksetup -setairportnetwork en0 "SSID" "password"

# 查看 DNS 设置
networksetup -getdnsservers Wi-Fi

# 设置 DNS
networksetup -setdnsservers Wi-Fi 8.8.8.8 8.8.4.4

# 设置代理
networksetup -setwebproxy Wi-Fi 127.0.0.1 7890
networksetup -setsocksfirewallproxy Wi-Fi 127.0.0.1 7891
```

---

## 六、终端快捷键与生产力技巧

### 6.1 常用终端快捷键

| 快捷键 | 功能 |
|---------|------|
| `Ctrl + A` | 跳到行首 |
| `Ctrl + E` | 跳到行尾 |
| `Ctrl + U` | 删除光标前的所有内容 |
| `Ctrl + K` | 删除光标后的所有内容 |
| `Ctrl + W` | 删除光标前的一个单词 |
| `Ctrl + Y` | 粘贴上一次删除的内容 |
| `Ctrl + L` | 清屏（等同 `clear`） |
| `Ctrl + C` | 终止当前命令 |
| `Ctrl + Z` | 挂起当前进程 |
| `Ctrl + D` | 退出终端 / EOF |
| `Ctrl + R` | 反向搜索历史命令 |
| `Ctrl + T` | 交换光标前两个字符 |
| `Option + ←` | 按单词向左跳转 |
| `Option + →` | 按单词向右跳转 |
| `Cmd + K` | 清除终端缓冲区 |
| `Cmd + T` | 新建标签页 |
| `Cmd + D` | 分屏 |
| `Cmd + ←/→` | 切换标签页 |

### 6.2 实用终端技巧

```bash
# 1. 快速回到上一次所在的目录
cd -

# 2. 使用 pushd/popd 管理目录栈
pushd /var/log
pushd /etc/nginx
dirs          # 查看目录栈
popd          # 返回上一个目录
popd          # 再返回上一个

# 3. 使用 !! 重复上一条命令
sudo !!       # 给上一条命令加上 sudo

# 4. 使用 !$ 引用上一条命令的最后一个参数
mkdir new_project
cd !$          # 等同于 cd new_project

# 5. 历史命令搜索
history | grep nginx
!1234          # 执行历史记录中第 1234 条命令

# 6. 使用 alias 提高效率
alias ll="ls -la"
alias gs="git status"
alias gp="git push"
alias artisan="php artisan"
```

### 6.3 Zsh 配置优化

macOS Catalina 起默认使用 Zsh 作为 shell。以下是一些实用的 Zsh 配置：

```bash
# ~/.zshrc 常用配置

# 环境变量
export PATH="/opt/homebrew/bin:$PATH"
export EDITOR="vim"

# 常用别名
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias ..='cd ..'
alias ...='cd ../..'
alias grep='grep --color=auto'

# Git 快捷别名
alias g='git'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git log --oneline --graph'
alias gd='git diff'

# PHP 开发别名
alias pa='php artisan'
alias pfs='php artisan serve'
alias mfs='php artisan migrate:fresh --seed'

# Homebrew 自动更新间隔（秒，0 为每次检查）
export HOMEBREW_AUTO_UPDATE_SECS=86400

# 历史记录配置
HISTSIZE=10000
SAVEHIST=10000
HISTFILE=~/.zsh_history
setopt SHARE_HISTORY
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_SPACE
```

---

## 七、Homebrew vs MacPorts 对比

macOS 上有两大主流包管理器：Homebrew 和 MacPorts。以下是详细对比：

| 对比项 | Homebrew | MacPorts |
|--------|----------|----------|
| **安装路径** | `/opt/homebrew`（ARM）/ `/usr/local`（Intel） | `/opt/local` |
| **设计理念** | 尽量使用系统自带库 | 自建完整依赖环境，不依赖系统库 |
| **软件包数量** | 丰富，社区活跃 | 较多，维护稳定 |
| **安装速度** | 快（预编译二进制包） | 较慢（通常从源码编译） |
| **依赖管理** | 自动处理，可能出现冲突 | 严格隔离，冲突少 |
| **GUI 应用** | 支持（通过 Cask） | 不支持 |
| **社区活跃度** | ⭐⭐⭐⭐⭐ 极高 | ⭐⭐⭐ 中等 |
| **配置文件** | `Brewfile` | `variants.conf` |
| **命令风格** | `brew install nginx` | `port install nginx` |
| **系统要求** | 需要 Xcode CLT | 需要 Xcode CLT |
| **适合人群** | 绝大多数开发者 | 需要稳定隔离环境的开发者 |

> **推荐**：对于大多数开发者，Homebrew 是更好的选择，因为它社区活跃、更新快速、支持 Cask 安装 GUI 应用。MacPorts 更适合需要严格隔离编译环境的场景。

---

## 八、常见问题排查

### 8.1 权限问题

```bash
# 问题：Permission denied
# 解决方案一：使用 sudo
sudo chown -R $(whoami) /usr/local/*

# 解决方案二：修复 Homebrew 目录权限
sudo chown -R $(whoami) /opt/homebrew/*

# 解决方案三：修复 /usr/local 目录权限
sudo chown -R $(whoami) /usr/local/share/man/man1

# 查看文件权限
ls -la /usr/local/bin/
```

### 8.2 SIP（System Integrity Protection）

SIP 是 macOS 的系统完整性保护机制，它限制了对系统目录的写入操作。

```bash
# 查看 SIP 状态
csrutil status
# 输出: System Integrity Protection status: enabled.

# 临时关闭 SIP（需要重启进入恢复模式）
# 1. 重启 Mac，按住 Command + R 进入恢复模式
# 2. 打开终端（菜单 -> Utilities -> Terminal）
# 3. 执行命令
csrutil disable

# 重新启用 SIP
csrutil enable

# 注意：不建议长期关闭 SIP，仅在必要时临时关闭
```

### 8.3 Gatekeeper 问题

Gatekeeper 阻止了未签名应用的运行。

```bash
# 方法一：对单个应用解除限制
xattr -cr /Applications/SomeApp.app

# 方法二：允许从任何来源安装（谨慎使用）
sudo spctl --master-disable
# 执行后在 系统偏好设置 -> 安全性与隐私 中会出现"任何来源"选项

# 恢复默认设置
sudo spctl --master-enable

# 查看文件的隔离属性
xattr -l /Applications/SomeApp.app

# 清除所有扩展属性
xattr -c /Applications/SomeApp.app
```

### 8.4 端口被占用

```bash
# 查看端口占用情况
lsof -i :8080
lsof -i :3306
lsof -i :6379

# 终止占用端口的进程
kill -9 $(lsof -t -i :8080)

# 查看所有监听端口
netstat -an | grep LISTEN
# 或使用更现代的命令
lsof -i -P | grep LISTEN
```

### 8.5 Homebrew 常见问题

```bash
# 问题：brew update 卡住或很慢
# 解决：更换国内镜像源（清华源）
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
# 写入 ~/.zshrc 使其永久生效

# 问题：Error: Cannot install in Homebrew on ARM processor
# 解决：确保使用的是 Apple Silicon 版本的 Homebrew
which brew
# 应该输出: /opt/homebrew/bin/brew

# 问题：Linking 失败
brew link --overwrite php@8.2

# 问题：依赖冲突
brew doctor
brew autoremove
brew link --overwrite --force <package>
```

### 8.6 磁盘空间清理

```bash
# 查看磁盘使用情况
df -h

# 清理 Homebrew 缓存
brew cleanup --prune=all

# 清理 Xcode 缓存
rm -rf ~/Library/Developer/Xcode/DerivedData/*
rm -rf ~/Library/Developer/Xcode/Archives/*

# 清理系统日志
sudo rm -rf /var/log/*.log

# 查找大文件
find ~ -type f -size +100M -exec ls -lh {} \;

# 使用 macOS 自带存储管理
# 关于本机 -> 存储空间 -> 管理...
```

---

## 九、实用脚本示例

### 9.1 一键开发环境启动脚本

```bash
#!/bin/bash
# start-dev.sh - 一键启动开发环境

echo "🚀 正在启动开发环境..."

# 启动 MySQL
brew services start mysql
echo "✅ MySQL 已启动"

# 启动 Redis
brew services start redis
echo "✅ Redis 已启动"

# 启动 Nginx
sudo nginx
echo "✅ Nginx 已启动"

# 启动 PHP-FPM
brew services start php@8.2
echo "✅ PHP-FPM 已启动"

echo "🎉 开发环境启动完成！"
```

### 9.2 快速切换 Hosts

```bash
#!/bin/bash
# switch-hosts.sh

if [ "$1" == "dev" ]; then
    sudo bash -c 'cat > /etc/hosts << EOF
127.0.0.1   localhost
192.168.1.100   api.dev.local
192.168.1.100   web.dev.local
EOF'
    echo "✅ 已切换到开发环境 hosts"
elif [ "$1" == "prod" ]; then
    sudo bash -c 'cat > /etc/hosts << EOF
127.0.0.1   localhost
10.0.0.1    api.prod.com
EOF'
    echo "✅ 已切换到生产环境 hosts"
fi

sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

---

## 相关阅读

- [Homebrew 包管理器指南](/categories/macOS/brew/)
- [macOS 常用命令速查](/categories/macOS/common-commands/)
- [iTerm2 + Oh My Zsh 终端美化](/categories/macOS/iterm2-oh-my-zsh-guide/)
- [PHPStorm 开发利器](/categories/macOS/phpstorm-guide-live-templates/)
