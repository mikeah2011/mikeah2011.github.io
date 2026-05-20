---
title: macOS 常用命令
date: 2025-05-25 10:00:00
categories:
  - macOS
tags: [macOS]
description: macOS 日常开发常用 Shell 命令速查：环境安装、Homebrew、文件处理、系统维护与开发工具配置。
---

```shell
# 安裝必要的環境
xcode-select --install

# 安裝 brew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo '# Set PATH, MANPATH, etc., for Homebrew.' >> ~/.zprofile
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
 
# 安裝 iterm2
brew install iterm2

# 安裝 ohmyzsh 插件
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
echo "source ~/.zshrc" >> ~/.zprofile

# 安裝 zsh 主題
git clone https://github.com/romkatv/powerlevel10k.git $ZSH_CUSTOM/themes/powerlevel10k

# 安裝 zsh 插件
brew install zsh-autosuggestions
echo "source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh" >> ~/.zprofile

# 生成 SSH-key
ssh-keygen -t ed25519 -C "michael.ma@kkday.com"
# 查看
less ~/.ssh/id_ed25519.pub
 
# 安裝 PHP 多版本
brew tap shivammathur/php
brew install php@7.1

# 安裝 PHP 版本切換器
brew install brew-php-switcher
 
# 安裝 NGINX PostgreSQL redis 服務
brew install nginx postgresql@15 redis

# 所有的項目文件都放在家目錄下分門別類

# 軟鏈 NGINX 服務配置文件到 家目錄
ln -s $(brew --repo)/etc/nginx/servers ~/

```

