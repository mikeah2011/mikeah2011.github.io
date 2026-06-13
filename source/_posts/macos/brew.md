---
title: macOS APP 管理神器——brew
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
tags: [macOS, Homebrew, tools]
keywords: [macOS APP, brew, 管理神器, macOS]
categories:
  - macos
date: 2022-12-08 09:11:30
description: 'macOS Homebrew 完全指南：brew install 命令速查、Cask vs Formula 区别、brew services 服务管理、Brewfile 一键备份恢复、中国区镜像源配置（清华/中科大/阿里云）、Apple Silicon M 系列芯片适配、Homebrew vs MacPorts vs Nix 对比及常见报错排查（权限错误/网络超时/SHA256 校验失败），附 60+ 款常用开发工具一键安装命令，助你高效管理 Mac 开发环境。'



---

> [`brew`](https://brew.sh) 神器



眾所周知，`brew` 是 `macOS` 系統的管理工具，如果是你重度 `Linux` 系統使用者，你可能也會知道她。

身為 `Mac` 用戶，你真的會用嗎？在看到這裡之前，你可能跟我一樣，都不太清楚她~，今天我們就一起了解了解她。



官方安裝指令：

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

PS：如果提示相關 `git` 錯誤，建議可以執行 `xcode-select --install` 嘗試下。



用 `brew`管理 `APP` 可以自動選擇對應芯片的版本，媽媽再也不操心我到處尋找 `APP`，還擔心我裝錯版本...![image-20221206154428957](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221206154428957.png)



總結：

1. 最新的版本；`release laster`

2. 最合適的版本；`Apple M1` or `Intel`

3. 支持批量安裝；`brew install app1 app2...`

4. 自動遷移到`/Applications/`下，無需手動拖拽

5. 一鍵卸載&批量&安全

   `brew cask uninstall app1 app2...`

6. 一鍵更新；

   `brew upgrade app1 app2...`

7. 支持重裝；

   `brew reinstall`，舊APP會被備份至`$(brew --repo)/Caskroom`下，且APP 數據均會被保留；![image-20221206211600038](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221206211600038-20221207100345553.png)

   

   唯一的缺陷就是不支持重裝除 `brew`方式之外的`APP` ，需要手動卸載掉後才可以安裝；![image-20221206160819960](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221206160819960.png)



> `brew` 常用命令和常量

| `brew` 命令             | 釋義                     | 別名               |
| ----------------------- | ------------------------ | ------------------ |
| `$(brew --repo)`        | 倉庫目錄                 | `HOMEBREW_PREFIX`  |
| `brew config`           | 查看 `brew` 的配置信息   |                    |
| `brew doctor`           | 檢查 `brew` 健康狀況     |                    |
| `brew info`             | 查看應用詳情             |                    |
| `brew install`          | 安裝                     |                    |
| `brew list`             | 查看當前已安裝的應用列表 | `brew ls`          |
| `brew reinstall`        | 重裝                     |                    |
| `brew search`           | 檢索應用                 |                    |
| `brew services cleanup` | 卸載服務                 |                    |
| `brew services kill`    | 殺掉服務進程             |                    |
| `brew services list`    | 查看安裝的服務列表       | `brew services ls` |
| `brew services restart` | 重啟服務                 |                    |
| `brew services start`   | 啟動服務                 |                    |
| `brew services stop`    | 停止服務                 |                    |
| `brew uninstall`        | 卸載                     |                    |
| `brew update`           | 更新 `brew` 配置         |                    |
| `brew upgrade`          | 更新應用                 |                    |



> 以下是我個人經過測試可以安裝的 `APP` 列表

| 序號 | `APP`                 | 是否安裝 | 是否免費 | 用途                    | 備註                                        |
| ---- | --------------------- | -------- | -------- | ----------------------- | ------------------------------------------- |
| 1    | `aldente`             | ✅        | ✔️        | 電源管理工具            | 社區版，付費版請訂閱 `Pro`                  |
| 2    | `alfred`              | ✅        | ❌        | 記憶工具                | 部分功能是需要訂閱付費的                    |
| 3    | `apipost`             | ✅        | ✔️        | `api` 接口文檔調試工具  | 免費，也有企業團隊付費版                    |
| 4    | `asana`               | ✅        | ✔️        | 項目管理                | 免費                                        |
| 5    | `bartender`           | ✅        | ❌        | 任務欄管理工具          | 部分功能是需要訂閱付費的                    |
| 6    | `bob`                 | ✅        | ✔️        | 翻譯工具                | 社區版，付費版請前往`App Store`自行購買     |
| 7    | `brew-php-switcher`   | ✅        | ✔️        | `PHP` 多版本切換工具    |                                             |
| 8    | `cleanmymac`          | ✅        | ❌        | 清理工具                | 部分功能是需要訂閱付費的                    |
| 9    | `composer`            | ✅        | ✔️        | `PHP` 擴展包管理工具    |                                             |
| 10   | `google-chrome`       | ✅        | ✔️        | 瀏覽器                  | 免費                                        |
| 11   | `istat-menus`         | ✅        | ❌        | 狀態工具                | 部分功能是需要訂閱付費的                    |
| 12   | `iterm2`              | ✅        | ✔️        | 終端工具                | 免費                                        |
| 13   | `jetbrains-toolbox`   | ✅        | ❌        | `jetbrains` 工具箱      | 管理的應用是訂閱付費的                      |
| 14   | `nginx`               | ✅        | ✔️        | `NGINX web` 服務        |                                             |
| 15   | `nordlayer`           | ✅        | ❌        | `VPN` 工具              | 企業訂閱付費                                |
| 16   | `php`                 | ✅        | ✔️        | `PHP` 服務              | `brew tap shivammathur/php`                 |
| 17   | `postgresql`          | ✅        | ✔️        | `PostgreSQL` 服務       |                                             |
| 18   | `qq`                  | ✅        | ✔️        | `QQ`                    | 免費                                        |
| 19   | `RunCat`              | ❎        | ❌        | 指示 `Mac` 的運行狀況， | 暫時沒找到...                               |
| 20   | `slack`               | ✅        | ✔️        | 辦公通訊                | 免費                                        |
| 21   | `tree`                | ✅        | ✔️        | 檔案結構樹形化          |                                             |
| 22   | `uPic`                | ✅        | ✔️        | 圖床                    | `brew install bigwig-club/brew/upic --cask` |
| 23   | `utools`              | ✅        | ✔️        | 效率工具                | 既是插件也是應用                            |
| 24   | `wechat`              | ✅        | ✔️        | 微信                    | 免費                                        |
| 25   | `wechatwebdevtools`   | ✅        | ✔️        | 微信開發者工具          | 免費                                        |
| 26   | `wechatwork`          | ✅        | ✔️        | 企業微信                | 免費                                        |
| 27   | `zsh-autosuggestions` | ✅        | ✔️        | 命令猜想插件            |                                             |

以下是對應的命令：

```shell
brew install aldente	alfred	apipost	asana	bartender	bob	brew-php-switcher	cleanmymac	composer	google-chrome	istat-menus	iterm2	jetbrains-toolbox	nginx	nordlayer	php	postgresql	qq	RunCat	slack	tree	uPic	utools	wechat	wechatwebdevtools	wechatwork	zsh-autosuggestions 
```



用完之後，是不是就釋放了 `dmg` 、`apk` 包，節省了空間不說，還很方便。

所以，以後如果想安裝什麼 `APP`，是不是可以優先考慮 `brew`，平台都不是問題，也支持 `Linux`。

---

## brew 常用命令速查表

以下整理了日常開發中最常使用的 20 個 `brew` 命令，建議收藏備用：

| 序號 | 命令 | 說明 | 示例 |
| ---- | ---- | ---- | ---- |
| 1 | `brew install <formula>` | 安裝命令行工具 | `brew install git` |
| 2 | `brew install --cask <app>` | 安裝 GUI 應用 | `brew install --cask google-chrome` |
| 3 | `brew uninstall <formula>` | 卸載軟件包 | `brew uninstall wget` |
| 4 | `brew uninstall --cask <app>` | 卸載 GUI 應用 | `brew uninstall --cask firefox` |
| 5 | `brew update` | 更新 Homebrew 自身 | `brew update` |
| 6 | `brew upgrade` | 升級所有已過時的軟件包 | `brew upgrade` |
| 7 | `brew upgrade <formula>` | 升級指定軟件包 | `brew upgrade node` |
| 8 | `brew search <keyword>` | 搜索軟件包 | `brew search python` |
| 9 | `brew info <formula>` | 查看軟件包詳細信息 | `brew info nginx` |
| 10 | `brew list` | 列出所有已安裝的軟件包 | `brew list` |
| 11 | `brew list --cask` | 列出所有已安裝的 Cask 應用 | `brew list --cask` |
| 12 | `brew outdated` | 列出所有可升級的軟件包 | `brew outdated` |
| 13 | `brew doctor` | 診斷 Homebrew 環境問題 | `brew doctor` |
| 14 | `brew config` | 查看 Homebrew 配置信息 | `brew config` |
| 15 | `brew cleanup` | 清理舊版本緩存 | `brew cleanup` |
| 16 | `brew services list` | 查看所有服務狀態 | `brew services list` |
| 17 | `brew services start <svc>` | 啟動服務（開機自啟） | `brew services start mysql` |
| 18 | `brew services stop <svc>` | 停止服務 | `brew services stop redis` |
| 19 | `brew tap <user/repo>` | 添加第三方倉庫 | `brew tap shivammathur/php` |
| 20 | `brew deps <formula>` | 查看軟件包依賴關係 | `brew deps php` |

> 💡 **小技巧**：`brew install` 和 `brew uninstall` 都支持同時指定多個包，用空格隔開即可，例如 `brew install git wget curl`。

---

## Cask vs Formula 區別

很多剛接觸 Homebrew 的用戶會對 `Formula` 和 `Cask` 感到困惑，這裡做一個清晰的說明：

### Formula（公式）

Formula 是 Homebrew 的核心概念，它本質上是一個**構建腳本**（Ruby 文件），描述了如何從源碼編譯並安裝一個軟件包。Formula 主要用於安裝：

- **命令行工具**：如 `git`、`wget`、`curl`、`tree`
- **編程語言運行時**：如 `python`、`node`、`php`、`go`
- **後端服務**：如 `mysql`、`redis`、`nginx`、`postgresql`

```shell
# Formula 安裝示例
brew install git
brew install node
brew install mysql
```

安裝後的文件通常位於 `/usr/local/`（Intel）或 `/opt/homebrew/`（Apple Silicon）目錄下。

### Cask（木桶）

Cask 是 Homebrew 的擴展機制，專門用於安裝 **macOS GUI 應用**。它直接下載預編譯好的 `.dmg`、`.pkg` 或 `.app` 文件，然後自動將應用安裝到 `/Applications/` 目錄。

```shell
# Cask 安裝示例
brew install --cask google-chrome
brew install --cask visual-studio-code
brew install --cask iterm2
```

### 核心區別對比

| 特性 | Formula | Cask |
| ---- | ------- | ---- |
| 安裝對象 | 命令行工具 / 服務 | GUI 桌面應用 |
| 安裝方式 | 從源碼編譯或下載預編譯二進制 | 下載 `.dmg` / `.pkg` / `.app` |
| 安裝路徑 | `/opt/homebrew/` 或 `/usr/local/` | `/Applications/` |
| 啟動命令 | 終端中直接使用命令 | 在 Launchpad 或 Finder 中打開 |
| 服務管理 | `brew services start/stop` | 不支持 |
| 典型示例 | `git`、`nginx`、`python` | `Chrome`、`VSCode`、`Slack` |

> ⚠️ **注意**：從 Homebrew 4.0 開始，`brew cask` 子命令已被棄用，統一使用 `brew install --cask <app>` 的語法。如果你還在使用 `brew cask install`，建議更新習慣。

### 如何判斷用哪個？

很簡單：如果你需要的是一個在終端裡執行的命令或工具，用 Formula；如果你需要的是一個有圖形界面的應用，用 Cask。你可以通過 `brew search <name>` 來查看搜索結果，Cask 的結果會標註 `(Cask)`。

---

## 踩坑記錄

在使用 Homebrew 的過程中，你可能會遇到各種問題。這裡總結了最常見的幾個坑和解決方案。

### 1. 權限錯誤（Permission Denied）

這是新手最常遇到的問題，通常發生在安裝或更新時：

```shell
Error: Permission denied @ dir_s_mkdir - /usr/local/Frameworks
```

**解決方案**：

```shell
# 方案一：修復 /usr/local 目錄權限（推薦）
sudo chown -R $(whoami) /usr/local/*

# 方案二：如果使用 Apple Silicon，修復 /opt/homebrew 目錄權限
sudo chown -R $(whoami) /opt/homebrew

# 方案三：重新安裝 Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> ⚠️ **重要提醒**：在 macOS Ventura 及以上版本中，`/usr/local` 目錄可能受到系統完整性保護（SIP），不建議使用 `sudo chown` 修改。如果你使用的是 Apple Silicon Mac，Homebrew 默認安裝在 `/opt/homebrew/`，權限問題會少很多。

### 2. 下載速度慢 / 網絡超時

在中國大陸，由於眾所周知的網絡原因，直接從 GitHub 下載軟件包速度極慢甚至超時：

```shell
curl: (56) LibreSSL SSL_read: SSL_ERROR_SYSCALL, errno 54
Error: Download failed
```

**解決方案——使用鏡像源**：

以下是幾個常用的中國鏡像源：

| 鏡像 | 提供方 | 地址 |
| ---- | ------ | ---- |
| 清華大學 | TUNA | `https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/` |
| 中國科技大學 | USTC | `https://mirrors.ustc.edu.cn/` |
| 阿里雲 | Alibaba | `https://mirrors.aliyun.com/homebrew/` |
| 騰訊雲 | Tencent | `https://mirrors.cloud.tencent.com/homebrew/` |

**以清華鏡像為例，配置步驟**：

```shell
# 替換 Homebrew 主倉庫
cd "$(brew --repo)"
git remote set-url origin https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git

# 替換 core 倉庫
cd "$(brew --repo)/Library/Taps/homebrew/homebrew-core"
git remote set-url origin https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git

# 替換 cask 倉庫（Homebrew 4.0+ 已合併到核心倉庫，此步可選）
cd "$(brew --repo)/Library/Taps/homebrew/homebrew-cask"
git remote set-url origin https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-cask.git

# 設置環境變量（添加到 ~/.zshrc 或 ~/.bash_profile）
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git"

# 生效
source ~/.zshrc

# 更新 Homebrew
brew update
```

**恢復默認源**：

```shell
cd "$(brew --repo)"
git remote set-url origin https://github.com/Homebrew/brew.git

cd "$(brew --repo)/Library/Taps/homebrew/homebrew-core"
git remote set-url origin https://github.com/Homebrew/homebrew-core.git

# 移除環境變量設置，然後
source ~/.zshrc
```

### 3. brew update 卡住不動

```shell
Already up-to-date.
```

但實際上包版本明明很舊，這是因為本地倉庫和遠程倉庫不一致。

**解決方案**：

```shell
# 強制更新
brew update-reset

# 或者先重置再更新
cd "$(brew --repo)"
git fetch origin
git reset --hard origin/HEAD
brew update
```

### 4. 衝突錯誤（Conflict）

```shell
Error: Cannot install <package> because conflicting formulae are installed.
```

**解決方案**：

```shell
# 查看衝突的包
brew list | grep <conflicting-package>

# 卸載衝突的包後重新安裝
brew uninstall <conflicting-package>
brew install <your-package>
```

### 5. brew doctor 報 Warning

`brew doctor` 是你的第一道防線，它可以檢測大部分常見問題：

```shell
brew doctor
# 輸出可能包含：
# Warning: You have unlinked kegs in your Cellar.
# Warning: Your Homebrew's prefix is not /usr/local.
```

根據 doctor 的提示逐一修復即可。大多數 Warning 都可以通過以下方式解決：

```shell
# 鏈接未鏈接的包
brew link <package>

# 清理舊版本
brew cleanup

# 重置所有 taps
brew update-reset
```

### 6. 安裝時報 SHA256 校驗失敗

```shell
Error: SHA256 mismatch
```

**解決方案**：

```shell
# 清理下載緩存後重試
brew cleanup
brew install <package>

# 如果仍然失敗，手動刪除緩存
rm -rf $(brew --cache)
brew install <package>
```

---

## brew 與 Mac App Store 對比

很多人會問：既然有 Mac App Store，為什麼還需要用 brew？以下是兩者的詳細對比：

| 特性 | Homebrew | Mac App Store |
| ---- | -------- | ------------- |
| **應用類型** | 命令行工具 + GUI 應用 | 僅 GUI 應用 |
| **安裝方式** | 終端命令 | 圖形界面點擊 |
| **應用數量** | 超過 6000+（Formula）+ 5000+（Cask） | 受限於 Apple 審核政策 |
| **版本更新** | 緊跟上游最新版本 | 開發者提交後需審核 |
| **批量安裝** | ✅ 支持 `brew install a b c` | ❌ 需逐個點擊 |
| **批量更新** | ✅ `brew upgrade` 一鍵全量升級 | 需手動逐個更新 |
| **自動化腳本** | ✅ 完美支持 Shell 腳本 | ❌ 不支持 |
| **卸載清理** | ✅ `brew uninstall` 徹底清除 | 部分殘留數據目錄 |
| **服務管理** | ✅ `brew services` 管理後台服務 | ❌ 不支持 |
| **開發者工具** | ✅ 大量開發工具和運行時 | ❌ 極少 |
| **登錄要求** | ❌ 無需 Apple ID | ✅ 必須登錄 |
| **付費應用** | 少數，通常有免費替代 | 大量付費應用 |
| **系統集成** | 非沙盒化，完全訪問系統 | 沙盒化，受限制 |
| **網絡要求** | 依賴 GitHub（需科學上網或配置鏡像） | 依賴 Apple 服務器 |

### 什麼時候用 brew？

- 安裝開發工具：`git`、`node`、`python`、`docker`、`mysql`
- 安裝命令行效率工具：`fzf`、`ripgrep`、`bat`、`htop`
- 批量部署開發環境：寫一個 `Brewfile`，一行命令恢復所有工具
- 管理後台服務：`brew services start mysql`

### 什麼時候用 Mac App Store？

- 購買付費生產力應用（如 `Final Cut Pro`、`Logic Pro`）
- 需要 iCloud 同步功能的應用
- 系統級工具（如 `Keynote`、`Pages`、`Numbers`）

---

## Homebrew vs MacPorts vs Nix 對比

macOS 上的包管理工具不止 Homebrew 一個，還有 MacPorts 和 Nix。以下是三者的詳細對比，幫助你選擇最適合自己的工具：

| 特性 | Homebrew | MacPorts | Nix |
| ---- | -------- | -------- | --- |
| **倉庫語言** | Ruby | Tcl | Nix 表達式 |
| **Formula/Cask 數量** | 6000+ Formula + 5000+ Cask | 30000+ Port | 80000+ Package |
| **默認安裝路徑（Apple Silicon）** | `/opt/homebrew/` | `/opt/local/` | `/nix/store/` |
| **GUI 應用支持** | ✅ Cask | ⚠️ 有限 | ❌ 不直接支持 |
| **多版本共存** | ⚠️ 需額外 tap（如 shivammathur/php） | ✅ 原生支持 `variants` | ✅ 完美支持，每個版本獨立存儲 |
| **可復現環境** | ❌ 不支持 | ❌ 不支持 | ✅ 核心特性，支持聲明式環境 |
| **回滾/原子更新** | ❌ 不支持 | ❌ 不支持 | ✅ 支持 |
| **學習曲線** | ⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐ 高 |
| **中文鏡像** | ✅ 清華/中科大/阿里雲 | ⚠️ 有限 | ❌ 無 |
| **中國區使用體驗** | ✅ 優（配置鏡像後） | ⚠️ 一般 | ⚠️ 需自建鏡像 |
| **社區活躍度** | ⭐⭐⭐ 非常活躍 | ⭐⭐ 穩定 | ⭐⭐⭐ 快速增長 |
| **macOS 默認支持** | ⚠️ 需手動安裝 | ⚠️ 需手動安裝 | ⚠️ 需手動安裝 |
| **典型用戶** | Web 開發者、日常用戶 | 系統管理員、跨平台用戶 | 函數式編程愛好者、DevOps |

### 選擇建議

| 你的需求 | 推薦工具 | 理由 |
| -------- | -------- | ---- |
| 日常開發，快速安裝常用工具 | **Homebrew** | 生態最豐富，社區最活躍，上手最快 |
| 需要多版本 PHP/Python/Node 共存 | **Nix** 或 **MacPorts** | 原生多版本支持，不互相衝突 |
| 需要可復現的團隊開發環境 | **Nix** | 聲明式配置，跨機器完全一致 |
| 已有 Linux/FreeBSD 經驗 | **MacPorts** | 跨平台一致的使用體驗 |
| 需要管理 GUI 應用 | **Homebrew** | Cask 是唯一支持的方案 |
| 中國大陸用戶 | **Homebrew** | 鏡像源最完善，下載速度最快 |

> 💡 **結論**：對於大多數 macOS 開發者，**Homebrew 仍然是首選**。如果你有更高的需求（如可復現環境、多版本共存），可以考慮引入 Nix 作為補充。MacPorts 適合對開源自由度有較高要求的用戶。

### Brewfile——一鍵備份和恢復你的開發環境

Homebrew 支持 `Brewfile`，這是一個類似 `package.json` 的聲明文件，可以讓你一鍵安裝所有依賴：

```shell
# 導出當前已安裝的所有包到 Brewfile
brew bundle dump

# 從 Brewfile 安裝所有包
brew bundle

# 指定文件路徑
brew bundle --file=~/.Brewfile
```

生成的 `Brewfile` 示例：

```ruby
tap "homebrew/bundle"
tap "homebrew/cask"
tap "homebrew/core"
brew "git"
brew "node"
brew "php"
brew "mysql"
cask "google-chrome"
cask "visual-studio-code"
cask "iterm2"
mas "Xcode", id: 497799835  # Mac App Store 應用也可以包含！
```

> 💡 **Brewfile 的威力**：當你換了一台新 Mac，只需要一個 `Brewfile` 加上一行 `brew bundle` 命令，就能在幾分鐘內恢復你的整個開發環境。這是 Mac App Store 做不到的。

---

## Apple Silicon（M1/M2/M3/M4）專題

自 2020 年 Apple 推出 M1 芯片以來，Homebrew 在 Apple Silicon Mac 上有一些重要的變化和注意事項。

### 安裝路徑的變化

| 架構 | 安裝路徑 | 說明 |
| ---- | -------- | ---- |
| Intel Mac | `/usr/local/` | 傳統路徑 |
| Apple Silicon | `/opt/homebrew/` | 新路徑，避免與系統工具衝突 |

這是最常見的困惑來源。如果你在 M 系列 Mac 上看到 `/usr/local/bin/brew` 和 `/opt/homebrew/bin/brew` 兩個版本，說明你可能同時安裝了 Intel 和 ARM 兩個版本的 Homebrew。

### 環境變量配置

在 Apple Silicon Mac 上，你需要確保 shell 配置文件中包含以下路徑：

```shell
# 對於 zsh（macOS 默認 shell）
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
source ~/.zshrc

# 對於 bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.bash_profile
source ~/.bash_profile
```

### Rosetta 2 轉譯模式

有些軟件包還沒有原生支持 ARM 架構，此時 Homebrew 會自動通過 Rosetta 2 進行轉譯。你也可以手動以 Rosetta 模式運行 brew：

```shell
# 安裝 Rosetta 2（如果尚未安裝）
softwareupdate --install-rosetta

# 以 Rosetta 模式運行 Terminal
arch -x86_64 /bin/bash

# 以 Rosetta 模式安裝特定軟件
arch -x86_64 brew install <package>
```

### 判斷軟件是否為 ARM 原生

```shell
# 查看已安裝的軟件架構
file $(which <command>)

# ARM 原生輸出：
# /opt/homebrew/bin/git: Mach-O 64-bit executable arm64

# Rosetta 轉譯輸出：
# /usr/local/bin/git: Mach-O 64-bit executable x86_64
```

### 常見 ARM 相關問題

**問題一：`bad CPU type in executable`**

這意味著該軟件是為 x86_64 編譯的，且你沒有安裝 Rosetta 2。

```shell
# 解決：安裝 Rosetta
softwareupdate --install-rosetta
```

**問題二：Intel 和 ARM 版本衝突**

如果你之前在 Intel Mac 上使用過 Homebrew，遷移到 Apple Silicon 後建議重新安裝：

```shell
# 備份已安裝的包列表
brew bundle dump --file=~/Brewfile.backup

# 卸載舊版 Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"

# 重新安裝 Homebrew（ARM 版本）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 配置環境變量
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
source ~/.zshrc

# 從備份恢復
brew bundle --file=~/Brewfile.backup
```

**問題三：`brew install` 提示找不到包**

某些 Formula 可能還沒有適配 ARM 架構的 bottle（預編譯包），此時 Homebrew 會嘗試從源碼編譯：

```shell
# 如果編譯失敗，嘗試使用 Rosetta
arch -x86_64 brew install <package>
```

### Apple Silicon 性能優勢

在 M 系列芯片上，Homebrew 的從源碼編譯速度通常比 Intel Mac 快 2-3 倍，這是因為：

1. ARM 原生編譯避免了 Rosetta 轉譯開銷
2. Apple Silicon 的高性能核心編譯效率極高
3. 統一內存架構減少了 I/O 瓶頸

### M 系列芯片推薦配置

```shell
# 查看當前 Homebrew 版本和架構
brew --version
brew config

# 確認是否為 ARM 原生
file $(which brew)
# 應該輸出：Mach-O 64-bit executable arm64
```

---

## 進階技巧

### 使用 Brewfile 管理開發環境

如前所述，`Brewfile` 是管理開發環境的利器。建議將 `Brewfile` 提交到 Git 倉庫中，方便多台 Mac 同步：

```shell
# 初始化
brew bundle dump --file=~/dotfiles/Brewfile --force

# 在新 Mac 上恢復
brew bundle --file=~/dotfiles/Brewfile
```

### 使用 `brew tap` 添加第三方倉庫

`brew tap` 可以添加社區維護的軟件倉庫，擴展 Homebrew 的軟件源：

```shell
# 添加常用的第三方 tap
brew tap homebrew/cask-fonts      # 字體倉庫
brew tap shivammathur/php          # PHP 多版本
brew tap heroku/brew               # Heroku CLI
```

### Homebrew services 管理後台服務

`brew services` 可以像 `systemctl` 一樣管理後台服務：

```shell
# 查看所有服務狀態
brew services list

# 啟動 MySQL 並設置開機自啟
brew services start mysql

# 只啟動一次，不開機自啟
brew services run mysql

# 停止並移除開機自啟
brew services stop mysql

# 重啟服務
brew services restart nginx
```

### 定期維護命令

```shell
# 更新 Homebrew 和所有軟件包
brew update && brew upgrade

# 清理舊版本和緩存
brew cleanup -s

# 全面體檢
brew doctor

# 查看哪些包可以被清理
brew autoremove --dry-run

# 自動移除不再需要的依賴
brew autoremove
```

---

PS：`brew` 依賴於 `GitHub` 的訪問環境。在中國大陸地區，建議配置鏡像源（見上方「踩坑記錄」章節）以獲得更好的使用體驗。

---

## 常用開發工具 `brew install` 速查表

以下整理了不同開發場景下的常用工具安裝命令，方便一鍵搭建開發環境：

### 語言與運行時

| 工具 | 安裝命令 | 說明 |
| ---- | -------- | ---- |
| PHP（多版本） | `brew install php@8.3` | 需先 `brew tap shivammathur/php` |
| Node.js | `brew install node` | 含 npm |
| nvm | `brew install nvm` | Node 版本管理 |
| Python | `brew install python@3.12` | 含 pip |
| pyenv | `brew install pyenv` | Python 版本管理 |
| Go | `brew install go` | |
| Rust | `brew install rust` | |
| Java | `brew install openjdk@21` | |
| Ruby | `brew install ruby` | |

### 數據庫與緩存

| 工具 | 安裝命令 | 說明 |
| ---- | -------- | ---- |
| MySQL | `brew install mysql` | `brew services start mysql` |
| PostgreSQL | `brew install postgresql@16` | `brew services start postgresql@16` |
| Redis | `brew install redis` | `brew services start redis` |
| SQLite | `brew install sqlite` | macOS 自帶，brew 版本更新 |
| MongoDB | `brew install mongodb-community` | 需 `brew tap mongodb/brew` |
| Memcached | `brew install memcached` | |

### Web 服務器與代理

| 工具 | 安裝命令 | 說明 |
| ---- | -------- | ---- |
| Nginx | `brew install nginx` | `brew services start nginx` |
| Caddy | `brew install caddy` | 自動 HTTPS |
| HAProxy | `brew install haproxy` | 負載均衡 |

### 開發效率工具

| 工具 | 安裝命令 | 說明 |
| ---- | -------- | ---- |
| Git | `brew install git` | |
| Composer | `brew install composer` | PHP 包管理 |
| jq | `brew install jq` | JSON 處理 |
| yq | `brew install yq` | YAML 處理 |
| fzf | `brew install fzf` | 模糊搜索 |
| ripgrep | `brew install ripgrep` | 快速搜索（`rg`） |
| bat | `brew install bat` | 帶語法高亮的 `cat` |
| htop | `brew install htop` | 進程監控 |
| tree | `brew install tree` | 目錄樹展示 |
| watch | `brew install watch` | 定時執行命令 |
| tmux | `brew install tmux` | 終端復用 |
| lazygit | `brew install lazygit` | Git TUI |

### 一鍵搭建 PHP 開發環境

```shell
brew install php@8.3 nginx mysql redis composer
brew services start php@8.3 nginx mysql redis
```

### 一鍵搭建 Node.js 開發環境

```shell
brew install node nvm yarn pnpm
brew services start redis
```

### 一鍵搭建 Python 開發環境

```shell
brew install python@3.12 pyenv pipx sqlite
```

> 💡 **提示**：以上工具也可以寫入 `Brewfile`，在新 Mac 上用 `brew bundle` 一鍵恢復。

---

## 相關閱讀

- [Homebrew PHP 多版本切換指南](/categories/macOS/brew-php-switcher-homebrew-php-guide/)
- [macOS 開發環境配置](/categories/macOS/vs-ai-guide-laravel-guide/)
- [Charles SSL Mock API 調試](/categories/macOS/charles-guide-sslmock-laravel-api/)
- [Homebrew 自動更新腳本開發：macOS 開發環境自動化實戰](/categories/macos/homebrew-macos-automation/)
- [LM Studio 實戰：本地模型管理與推理](/categories/macos/lm-studio-guide-ai/)
- [macOS 常用命令](/categories/macos/common-commands/)
- [iTerm2 + Oh My Zsh 實戰：終端美化與效率提升踩坑記錄](/categories/macos/iterm2-oh-my-zsh-guide/)
- [uv 實戰：下一代 Python 包管理器](/categories/macos/uv-guide-python-100-php-guide/)
- [Nix 實戰：聲明式開發環境管理——替代 Homebrew 的可復現 macOS 開發環境配置](/categories/macos/2026-06-03-Nix-实战-声明式开发环境管理-替代Homebrew的可复现macOS开发环境/)

