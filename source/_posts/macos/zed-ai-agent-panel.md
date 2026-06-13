---

title: Zed 2.x 实战：AI 原生代码编辑器——协作编辑、Agent Panel 与本地模型集成的深度使用体验
keywords: [Zed, AI, Agent Panel, 原生代码编辑器, 协作编辑, 与本地模型集成的深度使用体验]
date: 2026-06-07 10:00:00
tags:
- Zed
- AI
- 代码编辑器
- macOS
- 协作编辑
description: Zed 2.x 是一款基于 Rust 编写的 AI 原生代码编辑器，以 GPU 加速渲染和 CRDT 原生协作为核心。本文深度评测 Zed 的 Agent Panel、Inline Assist、本地模型集成（Ollama/LM Studio）、Multi-Buffer 等核心功能，实测启动速度与内存占用均碾压 VS Code，提供完整的 Laravel/PHP 开发配置方案，并与 Cursor、Windsurf 等 AI 编辑器进行全面对比，帮助 macOS 开发者判断是否值得切换。
categories:
- macos
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
---




在 AI 编程工具井喷式涌现的 2025-2026 年，开发者面临的选择前所未有地丰富：VS Code + Copilot 的官方组合、Cursor 的深度 AI 集成、Claude Code 的终端原生体验、Windsurf 的流式编辑……然而在这片喧嚣之中，有一个编辑器以截然不同的哲学走出了自己的道路——**Zed**。

Zed 不是在传统编辑器上"贴一层 AI"，而是从第一行代码开始就以 Rust 编写、以 GPU 渲染、以 CRDT 协作为底层，将 AI 视为核心能力而非插件。本文将基于 Zed 2.x 的实际深度使用经验，从架构哲学、安装配置、核心功能、AI 能力、协作编辑、本地模型集成、与主流工具的对比，到 Laravel/PHP 开发工作流的整合，给出一份全面而诚实的技术评测。

<!-- more -->

## 一、Zed 的设计哲学：为什么又一个编辑器？

### 1.1 从 Atom 到 Zed 的传承

Zed 的核心开发者 Nathan Sobo 和 Antonio Scandurra 正是 Atom 编辑器和 Teletype 协作插件的原作者。在 GitHub 停止维护 Atom 后，他们汲取了两个关键教训：

1. **Electron 架构的性能天花板不可逾越**——即使 Atom 拥有最好的社区生态，JavaScript + Chromium 的架构让大文件操作和渲染始终捉襟见肘。
2. **协作不应是插件，而应是编辑器的地基**——Teletype 作为后期添加的协作层，体验远不如原生集成。

因此 Zed 做出了几个激进的技术选择：

| 维度 | 选择 | 理由 |
|------|------|------|
| 语言 | Rust | 零 GC 停顿，内存安全，极致性能 |
| 渲染 | Metal/Vulkan GPU 加速 | 120fps 流畅渲染，大文件无卡顿 |
| 协作 | 原生 CRDT（文本算法） | 无需服务器中继，P2P 可行 |
| 扩展 | WASM 沙箱 + Tree-sitter | 安全、快速、声明式语法高亮 |
| AI | 内核级集成 | 非插件，与编辑操作深度耦合 |

### 1.2 GPU 加速渲染的体感差异

这不是营销噱头。在实际使用中，打开一个 15000 行的 JSON 文件，VS Code 会有明显的滚动卡顿和语法高亮延迟，Sublime Text 表现不错但偶有闪烁，而 Zed 的滚动如丝般顺滑——因为文本渲染走的是 GPU 管线，每一帧的光栅化都在显卡上完成，CPU 只负责布局计算。

## 二、安装与初始配置

### 2.1 macOS 安装

```bash
# 推荐：Homebrew 安装
brew install --cask zed

# 或者：使用官方安装脚本
curl -f https://zed.dev/install.sh | sh

# 验证版本
zed --version
# Zed 2.x.x
```

Zed 2.x 要求 macOS 12.0+，原生支持 Apple Silicon (M1/M2/M3/M4)。在 Apple Silicon 上，Metal 渲染管线可以获得最佳性能。

### 2.2 核心配置文件

Zed 的配置集中在 `~/.config/zed/settings.json`：

```json
{
  "base_font_size": 14,
  "buffer_font_family": "JetBrains Mono",
  "buffer_font_size": 14,
  "theme": {
    "dark": "Gruvbox Dark Hard",
    "light": "Gruvbox Light"
  },
  "ui_font_size": 13,
  "relative_line_numbers": true,
  "cursor_blink": false,
  "scroll_sensitivity": 1.0,
  "hard_tabs": false,
  "tab_size": 4,
  "show_whitespaces": "boundary",
  "wrap_guides": [120],
  "auto_indent_on_paste": true,
  "seed_search_query_from_cursor": "always",
  "indent_guides": {
    "enabled": true,
    "coloring": "indent_aware"
  },
  "terminal": {
    "font_family": "JetBrainsMono Nerd Font",
    "font_size": 13,
    "shell": {
      "program": "zsh"
    }
  },
  "vim_mode": true,
  "vim": {
    "toggle_relative_line_numbers": true
  }
}
```

### 2.3 Vim 模式深度配置

对于 Vim 用户，Zed 的 Vim 模式是真正的一等公民，不是模拟层：

```json
{
  "vim_mode": true,
  "vim": {
    "toggle_relative_line_numbers": true,
    "use_system_clipboard": "always",
    "custom_digraphs": {}
  }
}
```

Zed 的 Vim 模式支持几乎所有核心操作：`d`, `c`, `y`, `v`, 可视模式、宏录制（`q`）、寄存器、`/` 搜索，甚至 `gx` 打开链接。它不支持的是一些极端边缘插件行为，但对于 95% 的 Vim 用户来说已经足够。

快捷键映射可以在 `~/.config/zed/keymap.json` 中自定义：

```json
[
  {
    "context": "Editor",
    "bindings": {
      "ctrl-shift-f": "workspace::Search",
      "cmd-shift-r": "editor::Format",
      "ctrl-w g d": "editor::GoToDefinition",
      "ctrl-w g t": "editor::GoToTypeDefinition",
      "space f f": "file_finder::Toggle",
      "space b b": "tab_switcher::Toggle",
      "space c a": "assistant::ToggleFocus"
    }
  }
]
```

## 三、核心编辑功能深度解析

### 3.1 Multi-Buffer：超越标签页的多文件视图

Multi-Buffer 是 Zed 最具革命性的功能之一。它允许你将多个文件的内容合并到一个编辑视图中，类似 Emacs 的 `grep-mode` 或 VS Code 的"Peek References"，但更彻底。

**典型场景：搜索结果视图**

按下 `Cmd-Shift-F` 全局搜索后，Zed 不是在侧边栏列出结果列表，而是把所有匹配行连同上下文显示在一个 Multi-Buffer 中，你可以在其中直接编辑每一个匹配位置。保存时，修改会同时写回各自对应的源文件。

**典型场景：LSP 符号搜索**

搜索一个 PHP 方法的所有引用时，Multi-Buffer 会把散落在 `app/Http/Controllers/`、`app/Services/`、`resources/views/` 中的调用点全部聚合显示，光标跳转和编辑与普通文件完全一致。

### 3.2 Tree-sitter 驱动的语法理解

Zed 的语法高亮和代码结构理解不依赖 TextMate 正则，而是使用 Tree-sitter 增量解析器。这意味着：

- 高亮在你输入的**同一帧**内更新，无闪烁
- 缩进规则基于 AST 而非正则，更准确
- 代码折叠基于真实语法结构（类、函数、数组）

对于 PHP，Zed 内置的 Tree-sitter 解析器能正确处理 Blade 模板中的 PHP 嵌入，以及混合 HTML/PHP 文件。

### 3.3 语言服务器协议（LSP）

Zed 对 LSP 的支持是深度原生的。配置在 `~/.config/zed/languages/PHP/settings.json`：

```json
{
  "lsp": {
    "intelephense": {
      "initialization_options": {
        "storagePath": "/tmp/intelephense",
        "licenceKey": "YOUR_LICENCE_KEY",
        "diagnostics": {
          "enable": true,
          "phpDoc": {
            "property": true
          }
        }
      }
    }
  }
}
```

Zed 自动安装和管理的语言服务器包括：

| 语言 | 语言服务器 | 自动安装 |
|------|-----------|---------|
| TypeScript/JavaScript | vtsls | ✅ |
| Python | pyright | ✅ |
| Rust | rust-analyzer | ✅ |
| Go | gopls | ✅ |
| PHP | 需手动配置 intelephense | ❌ |
| Blade | 需手动配置 | ❌ |

对于 PHP 开发者，确保先安装 intelephense：

```bash
npm i -g intelephense
```

## 四、AI 能力：Agent Panel 与内联助手

### 4.1 架构差异：AI 不是插件

与 VS Code 的 Copilot（基于扩展 API）和 Cursor 的 fork 模式不同，Zed 的 AI 能力直接嵌入编辑器内核。这意味着：

- AI 补全的延迟更低（与渲染管线在同一进程）
- AI 可以直接访问 AST 和语义信息（通过 Tree-sitter + LSP）
- AI 操作与编辑操作共享撤销栈

### 4.2 Inline Assist（内联助手）

按下 `Ctrl-Enter`（或 `Cmd-Enter`）激活内联助手。与 Copilot 的 ghost text 不同，Zed 的内联助手是一个真正的对话界面：

**代码生成示例：**

在 PHP 文件中输入以下注释后按 `Ctrl-Enter`：

```php
// 创建一个 Laravel Artisan 命令，用于批量清理过期的临时文件
// 要求：支持 dry-run 模式、记录清理日志、可配置保留天数
```

Zed 会生成完整的 Artisan Command 类，包括 `handle()` 方法、签名定义、选项解析等。生成的代码直接在当前光标位置插入，而非弹窗预览。

**代码转换示例：**

选中一段代码，按 `Ctrl-Enter` 后输入：

```
将此方法重构为使用 Repository 模式，注入 UserRepository 并添加缓存
```

Zed 会分析选中代码的上下文（通过 LSP 获取类型信息），然后生成重构后的代码。

### 4.3 Agent Panel：AI Agent 的编辑器原生实现

Agent Panel 是 Zed 2.x 中最具前瞻性的功能。按下 `Cmd-Shift-A`（或在命令面板中搜索 `agent: toggle focus`）打开 Agent Panel。

Agent Panel 与传统的 AI 聊天有本质区别：

1. **文件系统访问**：Agent 可以读取、搜索、编辑你的项目文件
2. **终端执行**：Agent 可以运行 shell 命令并查看输出
3. **多轮工具调用**：Agent 可以在一次对话中连续执行多个操作
4. **编辑预览**：所有代码修改以 diff 形式展示，你可以逐个接受或拒绝

**实战示例：让 Agent 重构 Laravel 项目**

在 Agent Panel 中输入：

```
分析 app/Http/Controllers/UserController.php，
将所有数据库查询逻辑提取到 app/Repositories/UserRepository.php，
使用构造函数注入 UserRepository，并更新路由和测试。
```

Agent 的执行流程：

1. 读取 `UserController.php` 的完整内容
2. 通过 LSP 获取方法签名和依赖关系
3. 创建 `UserRepository.php`，移入查询逻辑
4. 修改 Controller，注入 Repository
5. 搜索并更新引用该 Controller 的路由文件
6. 运行 `php artisan test` 验证

每一步的文件修改都会以 diff 预览呈现，你可以 `Cmd-Enter` 接受或 `Escape` 拒绝。

### 4.4 支持的 AI 模型

Zed Agent Panel 支持的后端模型：

| 提供商 | 模型 | 配置方式 |
|--------|------|---------|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus | API Key |
| OpenAI | GPT-4o, GPT-4 Turbo | API Key |
| Google | Gemini 1.5 Pro | API Key |
| GitHub Copilot | 各模型 | GitHub 账号 |
| Ollama | Llama 3, CodeLlama, Mistral 等 | 本地端点 |
| LM Studio | 任意 GGUF 模型 | 本地端点 |

在 `settings.json` 中配置 AI 后端：

```json
{
  "assistant": {
    "default_model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    },
    "version": "2",
    "provider": {
      "anthropic": {
        "api_key": "sk-ant-xxx"
      },
      "ollama": {
        "api_url": "http://localhost:11434"
      }
    }
  }
}
```

## 五、本地模型集成：Ollama 与 LM Studio

### 5.1 为什么需要本地模型？

在以下场景中，本地模型比云端 API 更合适：

- **离线开发**：飞机上、网络受限环境
- **隐私敏感代码**：企业内部项目、安全审计代码
- **成本控制**：高频使用 AI 补全时，API 费用可观
- **低延迟补全**：本地模型的网络延迟为零

### 5.2 Ollama 集成

```bash
# 安装 Ollama
brew install ollama

# 启动服务
ollama serve

# 拉取代码专用模型
ollama pull codellama:13b
ollama pull deepseek-coder-v2:16b
ollama pull qwen2.5-coder:14b

# 验证
curl http://localhost:11434/api/tags
```

在 Zed 中配置 Ollama：

```json
{
  "assistant": {
    "default_model": {
      "provider": "ollama",
      "model": "qwen2.5-coder:14b"
    },
    "version": "2",
    "provider": {
      "ollama": {
        "api_url": "http://localhost:11434"
      }
    }
  }
}
```

### 5.3 LM Studio 集成

LM Studio 提供了更友好的 GUI 模型管理和更稳定的 OpenAI 兼容 API：

```bash
# 下载 LM Studio: https://lmstudio.ai
# 在 LM Studio 中下载模型（如 deepseek-coder-v2-lite）
# 启动本地服务器，默认端口 1234
```

Zed 配置：

```json
{
  "assistant": {
    "provider": {
      "openai_compatible": {
        "api_url": "http://localhost:1234/v1",
        "available_models": [
          {
            "name": "deepseek-coder-v2-lite",
            "max_tokens": 8192,
            "max_output_tokens": 4096
          }
        ]
      }
    },
    "default_model": {
      "provider": "openai_compatible",
      "model": "deepseek-coder-v2-lite"
    }
  }
}
```

### 5.4 本地模型的实际体验

在 Apple M3 Max (36GB RAM) 上测试各模型：

| 模型 | 大小 | 补全延迟 | 代码质量 | 内存占用 |
|------|------|---------|---------|---------|
| Qwen2.5-Coder 14B | 9GB | ~200ms | ★★★★☆ | ~12GB |
| DeepSeek-Coder-V2 16B | 9.5GB | ~250ms | ★★★★☆ | ~13GB |
| CodeLlama 13B | 7.4GB | ~180ms | ★★★☆☆ | ~10GB |
| Claude Sonnet (API) | — | ~500ms | ★★★★★ | — |

本地模型在补全简单代码片段时体验良好，但在需要大范围上下文理解（如跨文件重构）时，与 Claude Sonnet 仍有明显差距。

## 六、协作编辑：原生 CRDT 的力量

### 6.1 技术原理

Zed 的协作编辑基于一个自研的 CRDT（Conflict-free Replicated Data Type）算法。与 Google Docs 的 OT（Operational Transformation）不同，CRDT 不需要中央服务器来解决冲突，每个客户端的操作可以独立合并。

这意味着：
- **无锁并发**：多人同时编辑同一行不会冲突
- **离线编辑**：断网后继续编辑，重连后自动合并
- **去中心化**：理论上可以 P2P 协作（虽然 Zed 目前仍用其中继服务器）

### 6.2 实际协作流程

**发起协作：**

1. 点击右上角的"Share"按钮，或按下 `Cmd-Shift-P` 输入 `projects: share`
2. 生成一个协作链接，发送给同事
3. 对方在 Zed 中打开链接即可加入

**协作功能：**

- **实时光标**：看到对方的光标位置和选中区域（不同颜色标识）
- **跟随模式**：点击对方头像可"跟随"对方的视角
- **语音通话**：内置语音通话功能，无需额外工具
- **终端共享**：协作双方共享同一个终端会话
- **Agent Panel 共享**：双方可以共同与 AI Agent 对话

### 6.3 与 VS Code Live Share 的对比

| 特性 | Zed 协作 | VS Code Live Share |
|------|---------|-------------------|
| 底层技术 | 自研 CRDT | OT + 中继服务器 |
| 延迟 | 极低（<50ms） | 中等（100-300ms） |
| 离线编辑 | ✅ 支持 | ❌ 不支持 |
| 语音通话 | ✅ 内置 | ❌ 需外挂 |
| 终端共享 | ✅ | ✅ |
| 浏览器客户端 | ❌ | ✅ |
| 服务器开销 | 低 | 高 |

## 七、Laravel/PHP 开发工作流整合

### 7.1 完整开发环境配置

将 Zed 打造为 Laravel 开发的主力编辑器：

**第一步：语言服务器配置**

`~/.config/zed/languages/PHP/settings.json`：

```json
{
  "lsp": {
    "intelephense": {
      "initialization_options": {
        "storagePath": "/tmp/intelephense",
        "licenceKey": null,
        "globalStoragePath": "/Users/michael/.intelephense",
        "diagnostics": {
          "enable": true
        },
        "completion": {
          "insertUseDeclaration": true,
          "fullyQualifyGlobalConstantsAndFunctions": false,
          "triggerParameterHints": true,
          "maxItems": 100
        }
      }
    }
  }
}
```

**第二步：代码格式化**

Zed 支持通过外部命令格式化代码。对于 PHP，使用 Laravel Pint：

`~/.config/zed/settings.json` 添加：

```json
{
  "languages": {
    "PHP": {
      "format_on_save": {
        "external": {
          "command": "./vendor/bin/pint",
          "arguments": ["--stdin", "{buffer_path}"]
        }
      }
    }
  }
}
```

**第三步：终端集成**

在 Zed 的内置终端中运行 Laravel 命令：

```bash
# 终端在项目根目录自动打开
php artisan serve
php artisan migrate
php artisan test --parallel
npm run dev
```

终端支持分屏，可以同时查看日志和运行命令。

**第四步：Blade 模板支持**

Zed 2.x 通过 Tree-sitter 扩展支持 Blade 语法高亮。在 `~/.config/zed/extensions/` 安装 Blade 扩展后，`.blade.php` 文件可获得正确的语法高亮和缩进。

### 7.2 日常开发工作流

**典型的一天：**

1. `Cmd-Shift-P` → `projects: open`，打开 Laravel 项目
2. `space f f`（自定义快捷键）打开文件查找器，输入 `UserC` 快速跳转到 `UserController`
3. 使用 `gd`（Vim 模式下的 Go to Definition）跳转到 Service 类
4. `Ctrl-Enter` 调用内联助手，输入"为这个方法添加表单验证"
5. `Cmd-Shift-A` 打开 Agent Panel，让它"创建一个完整的 CRUD API，包括 Request、Resource、Controller 和 Migration"
6. 在终端中运行 `php artisan test` 验证
7. `Cmd-Shift-F` 全局搜索，检查是否有遗漏的引用更新
8. `Cmd-Shift-G` 打开 Git 面板，查看 diff，提交

### 7.3 与 Laravel Herd 的配合

如果你使用 Laravel Herd 管理本地 PHP 环境，确保 Zed 的终端能正确找到 Herd 的 PHP 和 Composer：

在 `~/.config/zed/settings.json` 的终端配置中：

```json
{
  "terminal": {
    "shell": {
      "program": "zsh",
      "args": ["-l"]
    },
    "env": {
      "PATH": "/Users/michael/.config/herd/bin:/usr/local/bin:/usr/bin:/bin"
    }
  }
}
```

## 八、性能对比与基准测试

### 8.1 启动速度

在 Apple M3 MacBook Pro 上冷启动测试（打开一个包含 500 个文件的 Laravel 项目）：

| 编辑器 | 冷启动时间 | 热启动时间 |
|--------|-----------|-----------|
| Zed 2.x | ~0.8s | ~0.3s |
| VS Code | ~3.2s | ~1.5s |
| Cursor | ~3.8s | ~1.8s |
| Sublime Text | ~0.5s | ~0.2s |
| PhpStorm | ~8s | ~3s |

Zed 的启动速度接近 Sublime Text，远快于所有 Electron 系编辑器。

### 8.2 大文件处理

打开一个 200MB 的 JSON 日志文件：

| 编辑器 | 能否打开 | 滚动流畅度 | 搜索速度 |
|--------|---------|-----------|---------|
| Zed | ✅ | 极流畅 | 快 |
| VS Code | ✅（警告） | 明显卡顿 | 慢 |
| Cursor | ✅（警告） | 明显卡顿 | 慢 |
| Sublime Text | ✅ | 流畅 | 快 |

### 8.3 内存占用

打开同一个 Laravel 项目（含 LSP）的内存占用：

| 编辑器 | 内存占用 |
|--------|---------|
| Zed | ~280MB |
| VS Code | ~650MB |
| Cursor | ~750MB |
| PhpStorm | ~1.2GB |

Zed 的内存效率令人印象深刻，约为 VS Code 的一半。

## 九、与竞品的全面对比

### 9.1 Zed vs VS Code + Copilot

| 维度 | Zed | VS Code + Copilot |
|------|-----|-------------------|
| 性能 | ★★★★★ | ★★★☆☆ |
| 插件生态 | ★★☆☆☆ | ★★★★★ |
| AI 补全质量 | ★★★★☆ | ★★★★☆ |
| AI Agent 能力 | ★★★★☆ | ★★★☆☆（Copilot Chat） |
| 协作体验 | ★★★★★ | ★★★★☆（Live Share） |
| 配置复杂度 | 低 | 中高 |
| PHP 支持 | ★★★☆☆ | ★★★★☆ |
| Git 集成 | ★★★☆☆ | ★★★★☆ |

### 9.2 Zed vs Cursor

| 维度 | Zed | Cursor |
|------|-----|--------|
| 哲学 | 开源、独立编辑器 | VS Code fork |
| 性能 | ★★★★★ | ★★★☆☆ |
| AI 深度 | 原生集成 | 深度集成 + fork 修改 |
| 价格 | 免费（AI 用 API Key） | $20/月订阅 |
| 离线 AI | ✅（Ollama） | ✅（有限） |
| 代码库索引 | 基于 LSP | 专有向量索引 |
| 多文件编辑 | Multi-Buffer | Composer |

### 9.3 Zed vs Claude Code

Claude Code 是终端原生的 AI 编程工具，而 Zed 是编辑器原生。两者可以互补：

- **Claude Code 擅长**：大型重构、架构设计、跨项目分析、Git 操作
- **Zed 擅长**：日常编码、代码导航、实时协作、语法高亮

实际上，你可以在 Zed 的内置终端中运行 Claude Code，获得两者的结合。

## 十、已知局限与诚实评估

### 10.1 当前不足

在深度使用数月后，以下是 Zed 2.x 的诚实不足：

1. **插件生态薄弱**：与 VS Code 的数万扩展相比，Zed 的扩展市场还很初级。很多常用功能（如 REST Client、Docker 支持）尚无对应扩展。
2. **Git 集成基础**：内置的 Git 支持仅涵盖基本操作（diff、commit、stage），没有交互式 rebase、blame 侧边栏、Git Graph 等高级功能。
3. **PHP 生态支持有限**：不像 VS Code 有 PHP Debug、Laravel Extra Intellisense、Blade Formatter 等成熟扩展，Zed 的 PHP 开发体验需要更多手动配置。
4. **无浏览器版本**：不像 VS Code 有 github.dev 和 vscode.dev，Zed 目前只能本地运行。
5. **扩展 API 限制**：Zed 的扩展使用 WASM 运行，目前仅支持 Tree-sitter 语法扩展和少量其他类型，不能像 VS Code 扩展那样自由操作 UI。

### 10.2 最适合的使用场景

基于以上分析，Zed 最适合：

- **性能敏感的开发者**：无法忍受 Electron 编辑器的卡顿
- **Rust/Swift/Go 开发者**：这些语言在 Zed 中有最佳支持
- **需要实时协作的小团队**：Zed 的协作体验明显优于 Live Share
- **隐私敏感的 AI 使用**：通过 Ollama 集成本地模型
- **macOS 原生开发**：Zed 在 macOS 上的体验最佳

### 10.3 可能不适合的场景

- **重度依赖 VS Code 插件的团队**：很多企业级扩展在 Zed 上不存在
- **大型 PHP/Laravel 项目**：PHP 生态支持尚需完善
- **需要远程开发（SSH/Container）**：Zed 的远程开发支持仍在开发中
- **Windows 用户**：Zed 的 Windows 版本仍处于早期阶段

## 十一、高级技巧与工作流优化

### 11.1 任务自动化（Tasks）

Zed 支持自定义任务，类似 VS Code 的 Tasks。在项目根目录创建 `.zed/tasks.json`：

```json
[
  {
    "label": "Run Tests",
    "command": "php artisan test",
    "use_new_terminal": false,
    "allow_concurrent_runs": false,
    "reveal": "always"
  },
  {
    "label": "Run Pint",
    "command": "./vendor/bin/pint",
    "reveal": "always"
  },
  {
    "label": "Queue Work",
    "command": "php artisan queue:work --tries=3",
    "use_new_terminal": true,
    "allow_concurrent_runs": true,
    "reveal": "always"
  }
]
```

通过 `Cmd-Shift-P` → `task: spawn` 快速运行任务。

### 11.2 Snippets 配置

在 `~/.config/zed/snippets/php.json` 中定义 PHP 代码片段：

```json
{
  "Laravel Controller Method": {
    "prefix": "lcmethod",
    "body": [
      "public function ${1:methodName}(Request \\$request): ${2:JsonResponse}",
      "{",
      "    $0",
      "    return response()->json(['message' => 'Success']);",
      "}"
    ],
    "description": "Laravel controller method"
  },
  "Laravel Test Method": {
    "prefix": "ltest",
    "body": [
      "/** @test */",
      "public function ${1:testName}(): void",
      "{",
      "    $0",
      "}"
    ],
    "description": "Laravel test method"
  }
}
```

### 11.3 主题与外观

Zed 的主题系统支持丰富的自定义。内置主题包括 One Dark、Gruvbox、Catppuccin、Solarized 等经典配色。也可以在 `~/.config/zed/themes/` 下创建自定义主题 JSON。

推荐配色方案：

```json
{
  "theme": {
    "dark": "Catppuccin Mocha",
    "light": "Catppuccin Latte"
  },
  "theme_overrides": {
    "editor.background": "#1e1e2e",
    "editor.gutter.background": "#181825"
  }
}
```

## 十二、总结：值得切换吗？

经过数月的深度使用，以下是最终评价：

**值得切换的情况：**

- 你是 macOS 用户，重视编辑器性能和原生体验
- 你的主要语言是 Rust、Go、Swift、TypeScript（Zed 支持最完善的语言）
- 你需要频繁的实时协作编辑
- 你想尝试本地 AI 模型集成
- 你对 VS Code 的臃肿和 Electron 性能感到厌倦

**暂时观望的情况：**

- 你的工作流深度依赖特定 VS Code 扩展
- 你主要使用 PHP/Laravel（支持可用但不完善）
- 你需要远程开发（SSH/Container）功能
- 你使用 Windows 作为主力开发平台

**Zed 的未来可期。** 它的架构选择（Rust + GPU + CRDT + WASM 扩展）是目前最"正确"的技术路径。随着扩展生态的成熟和 AI 能力的深入，Zed 有望成为下一代主力编辑器的有力竞争者。特别是当 Agent Panel 的能力进一步增强——支持更复杂的多步任务、更好的项目级上下文理解、更智能的工具调用——Zed 可能成为 AI 时代编辑器的范式定义者。

对于 macOS 上的开发者，我的建议是：**现在就安装 Zed，至少作为你的 AI 编辑器来使用**。即使你暂时保留 VS Code 作为主力，Zed 的 Agent Panel + Ollama 组合也值得一试。它的启动速度和 AI 响应速度带来的效率提升，可能会让你逐渐把越来越多的工作迁移到 Zed 上。

> 编辑器之争从来不是零和游戏。Zed 的存在让整个生态变得更好——它迫使 VS Code 和 Cursor 在性能和 AI 集成上做出改进，最终受益的是所有开发者。

## 相关阅读

- [Windsurf/Augment Code 实战：2026年 AI-native IDE 新势力，对比 Cursor/Claude Code 功能性能定价](/categories/macOS/Windsurf-Augment-Code-实战-2026年AI-native-IDE新势力-对比Cursor-Claude-Code功能性能定价/)
- [Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战踩坑记录](/categories/macOS/2026-06-01-Cursor-Claude-Code-Hermes-macOS-开发者多AI协作工作流实战踩坑记录/)
- [AI Pair Programming 实战](/categories/macOS/pair-programming-with-ai-practice/)
