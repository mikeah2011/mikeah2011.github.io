---
title: PhpStorm
tags:
  - PhpStorm
  - JetBrains
  - IDE
categories:
  - Editor
date: 2019-03-20 15:05:07
description: 'PhpStorm 是 JetBrains 出品的 PHP 集成开发环境，被视为 PHP 生态最强 IDE。智能补全、深度重构、内置数据库 / Git / Docker / Vagrant / Composer / 调试器一站式整合。'
---

## 一、PhpStorm 是什么

PhpStorm 是 **JetBrains** 公司基于 IntelliJ 平台为 PHP 开发者打造的 IDE。和 VSCode + 插件相比，它的核心优势是：

- **静态分析强**：跨文件类型推导、未定义方法立刻飘红
- **重构无损**：改类名/方法名一键全项目同步，包括字符串引用
- **生态整合**：DB 工具、HTTP Client、终端、Git、Docker、Composer、PHPUnit 全内置
- **Xdebug / Zend Debugger 一键接管**：断点调试、变量观察、表达式求值
- **框架插件**：Symfony、Laravel、WordPress、Magento 官方/社区插件，识别框架约定

收费，但**学生 / 开源贡献者 / 公司**都有正版渠道。

---

## 二、第一次配置清单

### PHP 解释器

`Settings → PHP`：
- 设置本地 PHP 路径（macOS Homebrew：`/opt/homebrew/bin/php`）
- 配置 Composer
- 配置 PHPUnit（指向 `vendor/bin/phpunit`）

### Xdebug 调试

```ini
; php.ini
zend_extension=xdebug.so
xdebug.mode=debug
xdebug.client_host=127.0.0.1
xdebug.client_port=9003
xdebug.start_with_request=trigger
```

PhpStorm：`Run → Start Listening for PHP Debug Connections`，然后浏览器装 **Xdebug Helper** 扩展，开 Debug 模式即可命中断点。

### Code Style

`Settings → Editor → Code Style → PHP`：
- Set from → **PSR-12**
- 保存时格式化：`Settings → Tools → Actions on Save → Reformat code` ✓

### File Watchers（自动跑工具）

`Settings → Tools → File Watchers`：
- **PHP CS Fixer**：保存时自动按规范格式化
- **PHPStan / Psalm**：静态分析持续提示

---

## 三、必学快捷键（macOS / Win-Linux）

| 操作 | macOS | Win/Linux |
|------|-------|-----------|
| **Search Everywhere**（搜索一切） | `⇧⇧` | `Shift Shift` |
| Find Action（命令面板） | `⌘⇧A` | `Ctrl+Shift+A` |
| Go to File | `⌘⇧O` | `Ctrl+Shift+N` |
| Go to Class | `⌘O` | `Ctrl+N` |
| Go to Symbol | `⌘⌥O` | `Ctrl+Alt+Shift+N` |
| 跳到定义 | `⌘B` 或 `⌘点击` | `Ctrl+B` |
| 找用法 | `⌥F7` | `Alt+F7` |
| Refactor This | `⌃T` | `Ctrl+Alt+Shift+T` |
| 重命名 | `⇧F6` | `Shift+F6` |
| 提取变量/方法 | `⌘⌥V` / `⌘⌥M` | `Ctrl+Alt+V/M` |
| 全文件搜索 | `⌘⇧F` | `Ctrl+Shift+F` |
| 多光标（同选词） | `⌃G` | `Alt+J` |
| 整行注释 | `⌘/` | `Ctrl+/` |
| 折叠/展开 | `⌘+/-` | `Ctrl +/-` |
| 最近文件 | `⌘E` | `Ctrl+E` |
| 终端 | `⌥F12` | `Alt+F12` |

> 强烈推荐刷一遍 `Help → Productivity Guide`，会列出哪些快捷键你没用过。

---

## 四、神功能盘点

### 1. Database 工具

`View → Tool Windows → Database`，加 MySQL / PostgreSQL / Redis 数据源后：
- SQL 自动补全（含表/字段名）
- 直接编辑表数据像 Excel
- DDL → 实体类一键生成
- 查询历史、ER 图

**省了一个 Navicat 钱**。

### 2. HTTP Client

新建 `*.http` 文件：

```http
### 获取用户
GET https://api.example.com/users/1
Accept: application/json

### 创建用户
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "Mike",
  "age": 18
}
```

直接点行首绿色三角执行，比 Postman 还顺手（且文件能进 Git）。

### 3. Composer / 框架感知

- Composer 操作图形化（更新依赖、查包、看树）
- Laravel 插件让 `route()`、`view()`、`config()` 等辅助函数支持跳转
- Symfony 插件支持服务名补全、注解检查

### 4. Refactor 重构

`Refactor This (⌃T)` 列出当前位置可做的所有重构：
- Rename
- Extract Method / Variable / Constant / Field
- Move Class
- Change Signature
- Inline / Pull Up / Push Down

**改一个方法签名，全项目调用点自动改 + 文档注释更新**。

---

## 五、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **索引慢** | 打开大项目卡几分钟 | `Settings → Project Structure` 把 `node_modules`、`vendor`、缓存目录标 Excluded |
| **内存不足** | 卡顿、无响应 | `Help → Change Memory Settings`，调到 4096 MB+ |
| **Xdebug 连不上** | 断点不命中 | 检查 `xdebug.mode=debug`、防火墙、Docker 容器要 `host.docker.internal` |
| **PHP 版本错位** | 语法报错（实际语法是新版的） | `Settings → PHP → PHP Language Level` 设到对应版本 |
| **Composer autoload 不识别** | 类找不到 | `composer dump-autoload` + `File → Invalidate Caches` |
| **Git 行尾乱** | diff 全文件被改 | `git config core.autocrlf input` + IDE 设 LF |
| **续费贵** | 个人 749 元/年 | 学生 / 开源 / 用 GitHub edu pack 申请免费许可 |

---

## 六、推荐插件

| 插件 | 用途 |
|------|------|
| **PHP Annotations** | 注解补全 + 跳转 |
| **Symfony Support / Laravel Idea** | 框架特定加成 |
| **.env files support** | 环境变量补全 |
| **Rainbow Brackets** | 括号配色，嵌套不晕 |
| **GitToolBox** | 行内 blame、推送通知 |
| **Key Promoter X** | 用鼠标时提醒你"这个有快捷键" |
| **Material Theme UI** | 换主题 |
| **CodeGlance Pro** | 类似 Sublime 的 minimap |
| **Translation** | 选词翻译 |

---

## 七、和 VSCode 怎么选

| 维度 | PhpStorm | VSCode |
|------|----------|--------|
| 启动速度 | 慢 | 极快 |
| 内存占用 | 1-2 GB | 几百 MB |
| PHP 智能 | 顶级 | Intelephense 也不错，但不及 |
| 重构能力 | 强 | 一般 |
| 多语言通用 | PHP 为主 | 全能 |
| 价格 | 收费 | 免费 |

**短结论**：纯 PHP 项目、长期维护 → PhpStorm；多语言/轻量 → VSCode。

---

## 参考

- 官网：<https://www.jetbrains.com/phpstorm/>
- 文档：<https://www.jetbrains.com/help/phpstorm/>
- 快捷键速查：<https://resources.jetbrains.com/storage/products/phpstorm/docs/PhpStorm_ReferenceCard.pdf>
