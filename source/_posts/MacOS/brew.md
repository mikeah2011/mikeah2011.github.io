---
title: macOS APP 管理神器——brew
tags:
  - macOS
  - Homebrew
categories:
  - macOS
date: 2022-12-08 09:11:30
description: '`brew` 神器 眾所周知，`brew` 是 `MacOS` 系統的管理工具，如果是你重度 `Linux` 系統使用者，你可能也會知道她。 身為 `Mac` 用戶，你真的會用嗎？在看到這裡之前，你可能跟我一樣，都不太清楚她~，今天我們就一…'
---
> [`brew`](https://brew.sh) 神器



眾所周知，`brew` 是 `MacOS` 系統的管理工具，如果是你重度 `Linux` 系統使用者，你可能也會知道她。

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

PS： `brew` 依賴於 `GitHub` 的訪問環境

