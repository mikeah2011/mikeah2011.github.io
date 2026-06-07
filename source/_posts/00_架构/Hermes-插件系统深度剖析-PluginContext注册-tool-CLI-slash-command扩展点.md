---
title: Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点
date: 2026-06-02 12:00:00
tags: [Hermes, AI Agent, 插件系统, PluginContext, 扩展开发]
description: 深入解析 Hermes AI Agent 框架的插件系统架构，以源码级视角剖析 PluginContext 门面模式注册机制与 tool/CLI/slash command 三大扩展点实现原理，涵盖插件发现加载、PluginManager 生命周期管理、hook 事件订阅与容错隔离、dispatch_tool 编排能力、Provider 注册及跨插件通信模式
categories: [架构]
cover: /images/covers/hermes-plugin-system-cover.jpg
---

# Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点

在 AI Agent 进入工程化阶段之后，**插件系统**基本决定了一个 Agent 框架能否真正形成生态。一个只能“调用内置功能”的 Agent，顶多是一个封装精良的单体应用；而一个允许第三方模块安全接入、能够注册工具、扩展命令、订阅生命周期事件、参与上下文构建的 Agent，才有可能成长为平台。

Hermes 的插件系统正属于后者。

如果你第一次阅读 Hermes 源码，可能会有一种非常直观的感受：它并没有把“插件”做成一个独立的、和主体完全平行的大型框架，而是采用了一种更克制也更务实的方式——**以 `PluginContext` 作为插件与宿主之间的唯一受控接触面**，将工具注册、CLI 子命令扩展、会话内 slash command 扩展、hook 生命周期订阅、Provider 接入、技能注册等能力统一收敛到一个上下文对象里。

这套设计有几个非常明显的工程优势：

1. **宿主能力边界清晰**：插件拿不到整个 Agent 内部实现，只拿到一个被精心裁剪过的 API 面。
2. **扩展点聚合**：工具、CLI、slash command、hook、provider 并不是零散拼接，而是在同一注册阶段完成。
3. **容错性强**：插件注册失败、hook 抛异常、命令冲突，都尽量只影响插件本身，而不是拖垮主程序。
4. **多入口统一**：CLI、Gateway、Agent Loop、Provider Registry 最终都能汇聚到同一个插件注册过程里。

本文会以 **Hermes 当前源码实现** 为基础，系统拆解整个插件系统，重点围绕以下问题展开：

- Hermes 插件系统整体架构是怎样的？
- `PluginContext` 到底承担了什么职责？
- `register_tool()`、`register_cli_command()`、`register_command()` 三类扩展点在内部是如何落地的？
- 插件生命周期如何被发现、加载、调用、隔离、失败恢复？
- 插件之间如何通信、如何复用彼此能力？
- 我们如何从 0 到 1 开发一个真正可用的 Hermes 插件？
- 实际开发中有哪些非常容易踩坑的地方？

本文不是一篇“API 列表式文档翻译”，而是一次完整的**源码级深剖 + 实战开发教程**。如果你正准备给 Hermes 写插件，或者你在设计自己的 Agent 扩展机制，希望找到一套兼顾可用性与工程边界的方案，这篇文章应该会对你有帮助。

---

## 一、为什么 Hermes 的插件系统值得单独研究

很多 AI Agent 框架都声称支持插件，但真正深入到工程现场时，经常会遇到三类问题：

### 1. 插件只是“配置化工具表”

有些框架所谓插件，本质上只是让你把一个 HTTP endpoint 或 Python function 塞到工具列表里。它能解决“模型多一个函数可以调用”的问题，但解决不了：

- 如何在 CLI 中暴露管理命令；
- 如何在 Telegram / Discord / Slack 等 gateway 会话中增加 slash command；
- 如何参与 Agent 生命周期；
- 如何替换某个 provider；
- 如何给插件提供宿主 LLM 能力；
- 如何做跨插件互操作。

### 2. 插件能力过大，宿主边界失控

另一类框架则走向了反面：直接把宿主对象、运行时对象、配置对象、事件总线、数据库会话、模型客户端全部暴露给插件。短期看开发很爽，长期看问题很明显：

- 插件和宿主内部实现强耦合；
- 内核重构时兼容成本极高；
- 插件越多，安全与调试成本越高；
- 版本升级时经常出现“老插件全灭”。

### 3. 多入口能力割裂

工具扩展是一套机制，CLI 扩展是另一套机制，聊天内命令又是一套机制，Provider 注册再来一套机制。最后用户写一个插件，需要记住五种入口、七种约定，最后谁都写不对。

Hermes 的做法比较值得借鉴：**把所有扩展点的“注册动作”统一收束到 `PluginContext`**。插件作者只需要关心一件事：在 `register(ctx)` 中告诉宿主，“我想提供什么能力”。

这就是 Hermes 插件系统的设计核心。

---

## 二、Hermes 插件系统架构总览

先从全局看它的结构。

### 2.1 插件系统在源码中的位置

从仓库结构上看，插件系统的主实现位于：

- `hermes_cli/plugins.py`：插件发现、清单解析、加载、`PluginContext`、`PluginManager`
- `hermes_cli/commands.py`：slash command 注册表与 gateway 暴露逻辑
- `tools/registry.py`：工具注册与调度中心
- `agent/*_registry.py`：不同 provider 的注册中心，例如 web/image/video/browser/tts/transcription
- `gateway/*`：会话型 slash command 在各消息平台中的映射与分发

从设计视角来看，可以把 Hermes 插件系统拆成 5 层：

### 2.2 五层结构图

```text
┌────────────────────────────────────────────────────────────┐
│                    Plugin Source Layer                     │
│  bundled plugins / user plugins / project plugins / pip   │
└────────────────────────────────────────────────────────────┘
                           │  扫描 manifest
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    PluginManager Layer                     │
│  _scan_directory / _parse_manifest / _load_plugin         │
│  discover_and_load / invoke_hook / list_plugins           │
└────────────────────────────────────────────────────────────┘
                           │  创建上下文
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    PluginContext Layer                     │
│  register_tool / register_cli_command / register_command  │
│  register_hook / register_skill / register_provider...    │
│  dispatch_tool / inject_message / llm facade              │
└────────────────────────────────────────────────────────────┘
                │                    │                    │
                │                    │                    │
                ▼                    ▼                    ▼
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────────┐
│   Tool Registry    │  │ CLI Command Tree   │  │ Slash Command Registry │
│ tools.registry     │  │ hermes <subcmd>    │  │ /cmd in session        │
└────────────────────┘  └────────────────────┘  └────────────────────────┘
                │                    │                    │
                └──────────────┬─────┴──────────────┬─────┘
                               ▼                    ▼
                     Agent Loop / CLI / Gateway / Providers
```

这个图传达了一个很重要的信息：

> **Hermes 的插件系统不是一个单独的运行时，而是一个“把插件能力编织进既有主干流程”的注册层。**

也就是说，插件不是另起炉灶。它不是把 Hermes 变成一个插件容器；它是让 Hermes 的工具系统、命令系统、会话系统、provider 系统都接受来自插件的扩展。

这也是本文后面分析三类扩展点时需要抓住的主线。

---

## 三、插件发现与加载流程：从目录到运行时能力

在讲 `PluginContext` 之前，先看 Hermes 是怎样找到一个插件的。

### 3.1 PluginManager 的角色

在 `hermes_cli/plugins.py` 中，`PluginManager` 的定义非常直接：

```python
class PluginManager:
    """Central manager that discovers, loads, and invokes plugins."""
```

它内部维护了多个关键状态：

```python
self._plugins: Dict[str, LoadedPlugin] = {}
self._hooks: Dict[str, List[Callable]] = {}
self._plugin_tool_names: Set[str] = set()
self._plugin_platform_names: Set[str] = set()
self._cli_commands: Dict[str, dict] = {}
self._context_engine = None
self._plugin_commands: Dict[str, dict] = {}
self._plugin_skills: Dict[str, Dict[str, Any]] = {}
self._aux_tasks: Dict[str, Dict[str, Any]] = {}
```

你会看到它其实是一个**插件能力聚合器**：

- `_plugins`：记录每个插件的加载状态；
- `_hooks`：记录生命周期回调；
- `_cli_commands`：记录 CLI 子命令；
- `_plugin_commands`：记录 slash command；
- `_plugin_tool_names`：记录插件注册过的 tool；
- `_context_engine`：记录上下文引擎替换；
- `_plugin_skills`：记录插件附带技能；
- `_aux_tasks`：记录辅助任务；
- 以及一批 provider 注册入口。

所以 PluginManager 不只是“找插件”，它还是插件能力的总账本。

### 3.2 discover_and_load：四种插件来源

`discover_and_load()` 是加载入口。它会从四个来源扫描插件：

1. **bundled plugins**：仓库自带插件目录；
2. **user plugins**：`~/.hermes/plugins/`；
3. **project plugins**：当前项目下的 `./.hermes/plugins/`，需显式开启环境变量；
4. **entry-point plugins**：通过 pip 安装、使用 entry point 暴露的插件。

源码里的逻辑大致是：

```python
# 1. Bundled plugins
bundled = self._scan_directory(repo_plugins, source="bundled", ...)

# 2. User plugins
user_manifests = self._scan_directory(user_dir, source="user")

# 3. Project plugins
if _env_enabled("HERMES_ENABLE_PROJECT_PLUGINS"):
    project_manifests = self._scan_directory(project_dir, source="project")

# 4. Pip / entry-point plugins
ep_manifests = self._scan_entry_points()
```

这套扫描顺序很关键，因为它决定了**同名插件覆盖优先级**。后扫描到的来源会覆盖前面的来源，意味着：

- 项目级插件可以覆盖用户级；
- 用户级插件可以覆盖 bundled；
- 这使得“本地临时调试版替换内置插件”成为可能。

### 3.3 目录扫描规则：两种布局

Hermes 插件支持两种目录布局：

#### 平铺结构

```text
plugins/
└── disk-cleanup/
    ├── plugin.yaml
    └── __init__.py
```

键名通常是插件名，例如 `disk-cleanup`。

#### 分类结构

```text
plugins/
└── image_gen/
    └── openai/
        ├── plugin.yaml
        └── __init__.py
```

键名变成 `image_gen/openai`。

这在 Hermes 中非常重要，因为很多 provider 类插件会共用同一个 `name`，比如不同类别里都可能出现 `openai`。如果只靠 `name` 去识别，会直接冲突；而用 `category/plugin` 组成的 `key`，就天然避免了碰撞。

### 3.4 manifest 解析：插件元数据如何进入系统

`_parse_manifest()` 会读取 `plugin.yaml`，构造 `PluginManifest`。核心字段包括：

- `name`
- `version`
- `description`
- `author`
- `requires_env`
- `provides_tools`
- `provides_hooks`
- `source`
- `path`
- `kind`
- `key`

其中 `kind` 非常关键，它决定插件走哪条激活路径。Hermes 支持的类型至少包括：

- `standalone`
- `exclusive`
- `model-provider`
- `platform`

而且 Hermes 还做了一层**启发式自动识别**：

- 如果插件源码中出现 `register_memory_provider` / `MemoryProvider`，可能会被自动识别为 memory provider，转为 `exclusive`；
- 如果出现 `register_provider` / `ProviderProfile` 相关模式，可能被识别为 `model-provider`。

这说明 Hermes 并不是完全死板地依赖 manifest，而是会做一定的**容错型类别推断**。

### 3.5 加载阶段：真正进入 `register(ctx)`

插件解析完 manifest 之后，会进入 `_load_plugin()`：

```python
register_fn = getattr(module, "register", None)
if register_fn is None:
    loaded.error = "no register() function"
else:
    ctx = PluginContext(manifest, self)
    register_fn(ctx)
```

这段逻辑非常值得注意：

- 插件没有 `register()`，不会直接让 Hermes 崩溃，只会记录错误；
- `PluginContext` 是**按插件实例创建**的；
- 插件的全部扩展能力都必须在 `register(ctx)` 里完成。

可以说，`register(ctx)` 是 Hermes 插件世界里的 `main()`。

---

## 四、PluginContext 注册机制源码解析

现在进入本文核心。

### 4.1 PluginContext 的本质：受控能力面

`PluginContext` 在源码中的定义注释是：

```python
class PluginContext:
    """Facade given to plugins so they can register tools and hooks."""
```

这里的关键词是 **Facade**。这意味着它不是一个“宿主对象引用”，而是一个**门面对象**。

门面模式的好处是：

- 插件看到的是稳定 API；
- 宿主内部实现可以自由演进；
- 宿主可以在门面层加校验、日志、类型检查、冲突处理、失败隔离；
- 插件作者的 mental model 更简单。

这也是我认为 Hermes 插件系统设计最成熟的一点：**它没有把内部对象直接暴露给插件，而是通过门面做了强收口。**

### 4.2 上下文里有哪些能力

从源码可见，`PluginContext` 不只是注册三种扩展点，它还提供了：

- `llm`：宿主拥有的模型访问 facade；
- `register_tool()`：注册 tool；
- `register_cli_command()`：注册 CLI 子命令；
- `register_command()`：注册 slash command；
- `dispatch_tool()`：从插件中主动调度任意工具；
- `inject_message()`：向当前会话注入消息；
- `register_hook()`：注册生命周期 hook；
- `register_skill()`：注册插件技能；
- `register_context_engine()`：替换上下文引擎；
- `register_image_gen_provider()` / `register_video_gen_provider()` / `register_web_search_provider()` / `register_browser_provider()` / `register_tts_provider()` / `register_transcription_provider()` 等各类 provider；
- `register_platform()`、`register_auxiliary_task()` 等额外扩展。

也就是说，**三种扩展点只是 PluginContext 最常用的一部分能力，不是全部。**

### 4.3 `llm` 属性：插件如何调用宿主模型

`llm` 是懒加载的：

```python
@property
def llm(self) -> Any:
    if self._llm is None:
        from agent.plugin_llm import PluginLlm
        plugin_id = self.manifest.key or self.manifest.name
        self._llm = PluginLlm(plugin_id=plugin_id)
    return self._llm
```

这个设计很妙，背后的工程含义有三层：

1. **按需构造**：插件如果不需要 LLM，完全不会创建相关对象；
2. **插件身份隔离**：`plugin_id` 进入 `PluginLlm`，后续权限、审计、配置 gating 都能基于插件身份做；
3. **宿主控制模型访问**：插件不需要自己配置 provider key，可以借宿主当前激活模型完成带外推理。

这意味着 Hermes 插件不仅可以提供工具，还可以自己发起模型调用，比如：

- 做结构化抽取；
- 做插件内部摘要；
- 做多轮流程拆解；
- 做 guardrail 判定。

而这些调用并不需要插件绕过宿主框架另起一个 OpenAI/Anthropic 客户端。

### 4.4 `register_tool()`：注册与追踪双写

源码如下：

```python
def register_tool(...):
    from tools.registry import registry

    registry.register(
        name=name,
        toolset=toolset,
        schema=schema,
        handler=handler,
        check_fn=check_fn,
        requires_env=requires_env,
        is_async=is_async,
        description=description,
        emoji=emoji,
        override=override,
    )
    self._manager._plugin_tool_names.add(name)
```

这段实现透露了 Hermes 的关键设计：

### 第一层：真正的工具归属在 `tools.registry`

`PluginContext` 本身不是工具注册表，它只是**代理写入**到全局工具注册中心 `tools.registry`。

这意味着插件工具和内置工具最终走的是同一套调度机制，具有以下优点：

- 模型看见的工具列表是统一的；
- 权限校验、执行路径、结果序列化不需要为插件单独开分支；
- 插件工具天然继承 Hermes 的工具运行时。

### 第二层：PluginManager 做一份“记账”

除了注册到全局 registry 外，`PluginContext` 还会把工具名记到：

```python
self._manager._plugin_tool_names.add(name)
```

这一步的意义在于**可观测性与插件归属追踪**：

- `/plugins` 之类的状态命令可以展示“某插件注册了多少个工具”；
- 插件卸载、调试、日志分析时可以知道哪些 tool 来自插件；
- `_load_plugin()` 在插件注册完成后，可以回算该插件新增了哪些工具。

### 第三层：override 机制

Hermes 支持：

```python
override=True
```

来显式替换一个已有 built-in tool。这个能力非常强，但 Hermes 要求必须显式声明，而不是默认覆盖。

这是非常典型的**危险操作显式化**设计：

- 防止插件误用同名 tool 导致核心能力被悄悄替换；
- 允许高级场景，比如替换 `browser_navigate`、`web_search` 等内置能力；
- 审计日志里可见 override 行为。

### 4.5 `register_cli_command()`：终端命令树扩展

源码核心逻辑很简单：

```python
def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
    self._manager._cli_commands[name] = {
        "name": name,
        "help": help,
        "description": description,
        "setup_fn": setup_fn,
        "handler_fn": handler_fn,
        "plugin": self.manifest.name,
    }
```

这里没有立刻去修改 argparse，而是先把定义保存到 `PluginManager._cli_commands`。

这说明 Hermes 的 CLI 命令扩展采用的是：

> **注册阶段先收集定义，构建 CLI parser 时再统一装配。**

这样做比“插件在注册时直接拿着 parser 去改”更好，原因有三：

1. 注册期与装配期解耦；
2. 插件命令可以先被 introspection、help、测试消费；
3. CLI 初始化顺序更可控，不容易在导入顺序上打架。

### 4.6 `register_command()`：会话级 slash command 扩展

`register_command()` 是本文另一个主角：

```python
def register_command(self, name, handler, description="", args_hint=""):
    clean = name.lower().strip().lstrip("/").replace(" ", "-")
    ...
    from hermes_cli.commands import resolve_command
    if resolve_command(clean) is not None:
        logger.warning(...)
        return

    self._manager._plugin_commands[clean] = {
        "handler": handler,
        "description": description or "Plugin command",
        "plugin": self.manifest.name,
        "args_hint": (args_hint or "").strip(),
    }
```

这里可以看到几个非常关键的机制：

#### 1. 名称标准化

- 转小写；
- 去掉前导 `/`；
- 空格替换为 `-`。

这可以显著减少插件作者因命名格式不统一带来的问题。

#### 2. 与 built-in command 冲突检测

`resolve_command(clean)` 如果能解析到内置命令，则插件命令注册被拒绝。

也就是说 Hermes 的规则是：

> **核心命令优先，插件 slash command 不允许覆盖 built-in slash command。**

这是非常合理的保守策略，因为 slash command 是用户高频直接输入的接口，一旦被插件覆盖，风险远高于 tool override。

#### 3. 只写入 `_plugin_commands`

和 CLI 类似，slash command 在注册时只是进入一张表，并不会立即分发。

后续：

- CLI 内 `/help`、自动补全会读取它；
- Telegram 菜单、Discord 原生 slash command 注册、Slack `/hermes` 子命令映射会读取它；
- gateway 的实际 dispatch 会通过命令解析器找到它。

这种“**一次注册，多处消费**”的设计，是 Hermes 插件命令系统非常漂亮的地方。

### 4.7 `dispatch_tool()`：插件内的“二次编排”能力

这不是一个纯注册 API，但在插件开发里极其重要。

```python
def dispatch_tool(self, tool_name: str, args: dict, **kwargs) -> str:
    from tools.registry import registry
    if "parent_agent" not in kwargs:
        cli = self._manager._cli_ref
        agent = getattr(cli, "agent", None) if cli else None
        if agent is not None:
            kwargs["parent_agent"] = agent
    return registry.dispatch(tool_name, args, **kwargs)
```

它意味着：

- 插件 slash command 可以主动调用任意工具；
- 插件无需直接摸到 Agent 对象；
- 父 agent 上下文、审批链路、workspace hints、spinner 等会自动透传。

这个能力让 Hermes 插件具备了一种非常实用的“**高层编排**”能力：

- slash command 负责接收用户入口；
- tool 负责执行底层动作；
- 插件自己只负责把多个既有能力拼装成一个更高层的工作流。

这实际上是 Agent 平台生态真正活起来的关键之一。

---

## 五、三种扩展点详解（一）：Tool 扩展点

工具扩展是所有插件系统中最常见的一类，但 Hermes 在这部分实现得比表面看起来更深。

### 5.1 Tool 扩展点的定位

在 Hermes 中，tool 不是“插件功能”的同义词，而是：

> **提供给模型在 Agent Loop 中直接 function call 的能力单元。**

换句话说，tool 的核心面向对象不是人，而是 LLM。

因此一个优秀的 plugin tool 需要同时满足两组要求：

- **模型友好**：schema 清晰、参数约束强、描述足够好；
- **运行时友好**：handler 稳定、可审计、失败可恢复、能接入宿主工具运行时。

### 5.2 基本注册方式

一个典型的工具注册长这样：

```python
def register(ctx):
    ctx.register_tool(
        name="calculate",
        toolset="calculator",
        schema=CALCULATE_SCHEMA,
        handler=calculate,
        description="执行数学表达式计算",
    )
```

核心参数解释如下：

- `name`：工具名，模型 function call 时使用；
- `toolset`：工具集分组，用于启用/禁用与展示；
- `schema`：给模型看的 JSON Schema；
- `handler`：真正执行逻辑的 Python callable；
- `check_fn`：运行时可用性检查；
- `requires_env`：环境变量依赖；
- `is_async`：是否异步；
- `description` / `emoji`：主要用于界面展示；
- `override`：是否覆盖已有工具。

### 5.3 schema 是模型接口，不是人类注释

很多插件作者容易把 schema 当成“顺手写一下”的东西，结果模型调用效果一塌糊涂。

在 Hermes 中，`schema` 最终进入工具注册表，被模型直接消费。因此 schema 的质量直接决定：

- 模型是否知道该工具适合做什么；
- 参数是否会被正确拼装；
- 错误调用率高不高；
- Agent Loop 是否容易陷入无效重试。

一个建议的 schema 写法：

```python
CALCULATE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "安全地计算数学表达式，支持加减乘除、幂运算和常见数学函数",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "要计算的数学表达式，例如 '2**16' 或 'sqrt(2) * pi'"
                }
            },
            "required": ["expression"]
        }
    }
}
```

这里最关键的是描述要尽量让模型形成明确预期，不要写成模糊语言。

### 5.4 check_fn：让工具“隐形下线”而不是报错上线

`check_fn` 是 Hermes 插件工具中非常实用但容易被忽略的参数。

比如你的工具依赖某个可选 SDK 或系统命令，不应该等模型调用时才炸，而是应该在工具列表暴露前就决定是否可见。

```python
def _has_dep() -> bool:
    try:
        import my_sdk
        return True
    except Exception:
        return False

ctx.register_tool(
    name="vendor_search",
    toolset="vendor",
    schema=VENDOR_SCHEMA,
    handler=vendor_search,
    check_fn=_has_dep,
)
```

这样做的价值非常高：

- 模型看不到不可用工具，自然不会误调；
- 减少“调用后再报缺依赖”的无效轮次；
- 用户体验明显更平滑。

### 5.5 requires_env：配置缺失时优雅降级

很多插件需要 API Key，这时应该配合 manifest 和 tool 注册进行 gating。Hermes 支持在 manifest 里写：

```yaml
requires_env:
  - WEATHER_API_KEY
```

或者 richer 形式：

```yaml
requires_env:
  - name: WEATHER_API_KEY
    description: OpenWeather API key
    url: https://openweathermap.org/api
    secret: true
```

它的设计哲学不是“缺变量直接异常崩掉”，而是：

- 插件可被识别；
- 但在缺依赖时不启用；
- 并给出清晰的缺失原因。

这套思路对插件生态很重要，因为第三方插件最怕“用户一装就炸”。

### 5.6 override：替换内置工具的正确姿势

Hermes 允许插件替换内置工具，比如：

```python
ctx.register_tool(
    name="browser_navigate",
    toolset="my_browser",
    schema=MY_BROWSER_SCHEMA,
    handler=my_browser_navigate,
    override=True,
)
```

但是必须显式开启 `override=True`。

这个设计背后有两个工程信号：

1. Hermes 认可“替换默认能力”的高级场景；
2. Hermes 认为这属于高风险行为，因此必须显式声明。

在实践中，适合 override 的场景通常有：

- 公司内部想用自研搜索替换默认 web_search；
- 想接入更强的浏览器自动化 backend；
- 想用企业网盘 / 文档系统替换默认文件检索入口。

不适合 override 的场景则包括：

- 只是想做一个“类似功能”；
- 调试期临时验证；
- 团队多人共享环境且缺少强审计机制。

### 5.7 Tool 扩展点的最佳实践

我通常会建议把插件工具拆成三层文件：

```text
my_plugin/
├── __init__.py     # register(ctx)
├── schemas.py      # tool schema
└── tools.py        # handler implementation
```

示例：

```python
# __init__.py
from .schemas import SEARCH_SCHEMA
from .tools import search_docs

def register(ctx):
    ctx.register_tool(
        name="search_docs",
        toolset="docs",
        schema=SEARCH_SCHEMA,
        handler=search_docs,
        description="搜索内部文档库",
    )
```

```python
# tools.py
import json

def search_docs(args, **kwargs):
    query = args.get("query", "")
    if not query:
        return json.dumps({"error": "missing query"}, ensure_ascii=False)
    # ... 查询逻辑
    return json.dumps({"results": [...]}, ensure_ascii=False)
```

这样拆的好处是：

- schema 与 handler 职责分离；
- 测试时可以分别验证“模型接口是否清晰”和“执行逻辑是否正确”；
- `register(ctx)` 保持干净。

---

## 六、三种扩展点详解（二）：CLI Command 扩展点

如果说 tool 是面向模型的，那么 CLI command 就是面向终端用户和运维用户的。

### 6.1 CLI 扩展点的定位

CLI 命令适合做的事通常有：

- 插件状态查看；
- 配置初始化；
- 索引构建；
- 本地诊断；
- 导入导出；
- 后台服务控制；
- 一些不适合让模型直接调用的管理操作。

一句话总结：

> **CLI command 更像“插件控制面”，tool 更像“插件执行面”。**

### 6.2 基本注册方式

Hermes 的典型写法：

```python
def _setup(subparser):
    subs = subparser.add_subparsers(dest="subcmd")
    subs.add_parser("status", help="查看状态")
    subs.add_parser("sync", help="同步索引")


def _handler(args):
    if args.subcmd == "status":
        print("ok")
    elif args.subcmd == "sync":
        print("sync done")


def register(ctx):
    ctx.register_cli_command(
        name="docs",
        help="文档插件管理",
        setup_fn=_setup,
        handler_fn=_handler,
        description="管理内部文档插件",
    )
```

这样用户就能执行：

```bash
hermes docs status
hermes docs sync
```

### 6.3 为什么 Hermes 不让插件直接操作顶层 argparse

这是 CLI 扩展设计里很重要的一点。

Hermes 的做法是：插件提交的是“命令定义”，而不是直接改全局 parser。原因有三个：

#### 1. 降低初始化耦合

如果插件在导入时就持有 parser 并开始改树，CLI 初始化顺序就会极其脆弱。

#### 2. 支持更好的 introspection

所有 CLI 命令先进入 `_cli_commands`，这张表可以被：

- help 页面；
- 插件状态页；
- 测试；
- 文档生成；
- shell completion

共同消费。

#### 3. 更容易隔离错误

插件注册 CLI 失败时，只会少一个插件命令，不至于把整个 Hermes 顶层命令树弄坏。

### 6.4 重复注册覆盖行为

测试文件 `tests/hermes_cli/test_plugin_cli_registration.py` 中有一个非常明确的测试：

```python
ctx.register_cli_command("x", "first", MagicMock())
ctx.register_cli_command("x", "second", MagicMock())
assert mgr._cli_commands["x"]["help"] == "second"
```

这说明 CLI command 的重复注册是**后写覆盖前写**。

这既是灵活性，也是一个潜在风险：

- 好处：用户级插件可以覆盖 bundled 插件的 CLI 子命令；
- 风险：如果你不控制命名空间，很容易互相踩。

因此我的建议是：

- CLI command 名尽量用插件名本身作为一级节点，例如 `docs`、`kanban`、`myplugin`；
- 不要抢通用名，如 `config`、`status`、`index` 作为顶层命令。

### 6.5 CLI 扩展点和 memory plugin 的特殊约定

Hermes 还有一个很容易忽略的特殊逻辑：**memory provider 插件的 CLI 命令不走 `ctx.register_cli_command()`，而是走约定式的 `cli.py -> register_cli(subparser)` 发现机制。**

这意味着并不是所有插件都统一通过 `PluginContext.register_cli_command()` 暴露 CLI。为什么要这样？

因为 memory provider 属于“exclusive plugin”，它的激活模型和普通 standalone plugin 不一样：

- 普通插件走 `plugins.enabled`；
- memory provider 走 `memory.provider` 配置；
- 只有当前激活 provider 的 CLI 才应该出现。

这背后的工程思想是：

> **统一机制优先，但允许对强领域约束的插件类别做局部特化。**

所以如果你开发的是普通扩展插件，优先使用 `ctx.register_cli_command()`；除非你正在写 Hermes 已定义类别的 provider 插件，否则不要自己发明另一套 CLI 注册方式。

### 6.6 CLI 扩展适合做什么，不适合做什么

适合：

- `hermes docs build-index`
- `hermes docs status`
- `hermes kanban doctor`
- `hermes observability export`

不太适合：

- 高频会话内动作；
- 需要在 Telegram/Discord 中使用的命令；
- 适合模型自动决定调用的执行动作。

如果你发现某个功能用户更希望在聊天里输入 `/foo` 来做，而不是退出会话跑终端命令，那它大概率应该是 slash command，而不是 CLI command。

---

## 七、三种扩展点详解（三）：Slash Command 扩展点

这是 Hermes 插件系统里最有“产品感”的一个扩展点，因为它直接作用于会话交互体验。

### 7.1 什么是 Hermes 中的 slash command

在 Hermes 里，slash command 指的是用户在会话内直接输入的命令，例如：

```text
/help
/model gpt-5
/new
/status
```

插件也可以注册自己的：

```text
/docs
/docs-search 向量数据库
/kanban-sync sprint-42
```

它和 CLI command 的本质区别在于：

- CLI command 是在 shell 中执行；
- slash command 是在**进行中的会话**里执行；
- slash command 可以同时服务 CLI 会话和 gateway 平台（Telegram、Discord、Slack 等）。

### 7.2 `register_command()` 的核心定位

源码注释写得很清楚：

```python
"""Register a slash command (e.g. ``/lcm``) available in CLI and gateway sessions."""
```

这句话的含义非常重：

> **插件 slash command 不是某个平台的私有命令，而是 Hermes 会话层的统一命令抽象。**

然后各平台再根据自身约束，把这套统一抽象映射到：

- CLI 自动补全；
- Telegram 菜单；
- Discord native slash command picker；
- Slack `/hermes` 子命令映射等。

### 7.3 注册方式与参数说明

```python
def handle_status(raw_args: str) -> str:
    if raw_args.strip() == "help":
        return "Usage: /mystatus [help|check]"
    return "Plugin status: all systems nominal"


def register(ctx):
    ctx.register_command(
        name="mystatus",
        handler=handle_status,
        description="Show plugin status",
        args_hint="[help|check]",
    )
```

这里有几个重要点：

- `handler` 接收的是**原始参数字符串**，不是 argparse `Namespace`；
- `args_hint` 用于描述参数形态，帮助 gateway 平台做原生命令展示；
- handler 可以是 sync，也可以是 async。

### 7.4 为什么 slash command 用 raw string 而不是 argparse

这其实是一个很高明的折中。

会话内命令与 shell 命令完全不是一个语境：

- 用户常常会粘贴自然语言参数；
- 不同 gateway 平台对参数输入的支持差异很大；
- CLI 内 `/foo a b c` 与 Telegram/Discord 的参数组织方式不完全一致。

如果强制上 argparse 风格，会带来两个问题：

1. 插件实现复杂度过高；
2. 各平台适配会变得非常笨重。

所以 Hermes 让 slash command handler 接收 raw string，然后插件作者可以根据需要：

- 自己 `split()`；
- 用 `shlex.split()`；
- 自己解析 kv 格式；
- 甚至直接把整串文本当查询词。

这个设计让 slash command 保持了**会话语义上的轻量性**。

### 7.5 冲突处理：built-in 永远优先

Hermes 在注册插件 slash command 时，会调用 `resolve_command(clean)` 检查是否与内置命令冲突。

冲突时的行为不是覆盖，也不是报错中止，而是：

- 写 warning 日志；
- 跳过该命令注册。

这种处理方式非常符合会话命令的安全需求。因为 slash command 一旦被覆盖，用户几乎无法直观看出命令行为变了，风险很高。

### 7.6 `_iter_plugin_command_entries()`：插件命令如何进入全局命令视图

在 `hermes_cli/commands.py` 中，有一个关键函数：

```python
def _iter_plugin_command_entries() -> list[tuple[str, str, str]]:
    from hermes_cli.plugins import get_plugin_commands
    commands = get_plugin_commands() or {}
    ...
    entries.append((name, description, args_hint))
```

也就是说，`commands.py` 并不在启动时强依赖插件系统，而是**懒加载**读取 `get_plugin_commands()`。

这样做的好处很明显：

- 导入 `commands.py` 时不会强制触发插件扫描；
- 减少导入副作用；
- 对测试更友好；
- 对无插件场景启动更轻量。

### 7.7 插件 slash command 如何被各平台消费

这是很多人第一次看 Hermes 时容易忽略的一条链路。

`_iter_plugin_command_entries()` 返回 `(name, description, args_hint)`，然后会被多处使用：

#### 1. Telegram Bot Commands

`telegram_bot_commands()` 会把 plugin slash command 合并进 Telegram 命令菜单，但有个限制：

- **带参数要求的 plugin command 会被排除**，因为 Telegram 菜单选择后未必能优雅处理参数缺失。

这说明 Hermes 并不是“注册一次，所有平台等价呈现”，而是会根据平台能力做裁剪。

#### 2. Discord 原生 slash commands

`commands.py` 中的注释明确提到，plugin slash command 会进入 Discord 的 native slash command picker。

而 `args_hint` 在这里的价值就体现出来了：

- 没有 `args_hint` 的命令可以视为无参命令；
- 有 `args_hint` 的命令可在 UI 上体现参数槽位提示。

#### 3. Slack `/hermes` 子命令映射

Hermes 不一定把每个插件命令都变成独立 Slack slash command，而是通过 `/hermes <subcommand>` 形式统一代理一部分命令，这是平台差异下的折中方案。

### 7.8 命令命名约束：为什么你的名字不能乱取

`commands.py` 里有一整套针对 Telegram/Discord/Slack 的命令名清洗和长度限制逻辑：

- 最大长度 32；
- Telegram 只允许小写字母、数字、下划线；
- Slack 还有内置保留命令；
- 超长名字会被截断并做碰撞处理。

这意味着一个插件命令在设计时应该遵守这些原则：

1. 名字尽量短；
2. 避免复杂符号；
3. 避免平台特定关键字；
4. 不要依赖大小写区分。

建议直接采用：

- `docs`
- `docs-search`
- `kanban-sync`
- `obs-status`

而不是：

- `MyCommand`
- `docs/search`
- `internal.docs.lookup`
- `超级复杂的中文命令`

### 7.9 slash command 的最佳场景

最适合插件 slash command 的功能包括：

- 快速查看插件状态；
- 执行轻量工作流入口；
- 会话上下文相关动作；
- 调试命令；
- 发起 tool 编排。

例如：

```python
def register(ctx):
    def _handle_deliver(raw_args: str):
        return ctx.dispatch_tool(
            "delegate_task",
            {
                "goal": raw_args,
                "toolsets": ["terminal", "file", "web"]
            }
        )

    ctx.register_command(
        "deliver",
        handler=_handle_deliver,
        description="把当前目标委托给子 agent",
        args_hint="<goal>",
    )
```

这类设计非常有威力：slash command 成为用户入口，而真正执行仍走标准工具链。

---

## 八、插件生命周期管理：发现、注册、调用、结束

很多人理解插件系统只停留在“插件能不能加载”，但真正决定插件系统质量的，是**生命周期管理**。

Hermes 在这一点上做得比较稳健。

### 8.1 生命周期阶段总览

Hermes 插件大致经历以下阶段：

```text
扫描目录/entry-point
    ↓
解析 manifest
    ↓
按配置决定是否启用
    ↓
导入模块
    ↓
调用 register(ctx)
    ↓
注册 tool / command / hook / provider / skill
    ↓
在 Agent Loop / CLI / Gateway / Provider Registry 中被消费
    ↓
会话级 hook 在各事件点被触发
```

其中最关键的两个阶段是：

- **加载时注册阶段**；
- **运行时 hook 调用阶段**。

### 8.2 插件只注册一次

`register(ctx)` 在插件加载时调用一次，而不是每轮对话重复调用。

这个约束非常重要。它意味着：

- `register()` 里不要放昂贵的业务调用；
- 不要在注册时直接做远程网络请求；
- 不要在里面启动难以管理的后台线程；
- 最好只做声明式注册与轻量初始化。

最稳妥的思路是：

- `register()` 负责把能力挂上去；
- 真正重逻辑放到 handler / hook 内按需执行。

### 8.3 hook 生命周期：Hermes 的事件面

Hermes 支持的一批 hook 包括：

- `pre_tool_call`
- `post_tool_call`
- `pre_llm_call`
- `post_llm_call`
- `on_session_start`
- `on_session_end`
- `on_session_finalize`
- `on_session_reset`

注册方式：

```python
ctx.register_hook("pre_tool_call", before_any_tool)
ctx.register_hook("post_tool_call", after_any_tool)
ctx.register_hook("pre_llm_call", inject_memory)
```

### 8.4 `register_hook()` 的设计：未知 hook 不拒绝，只警告

源码：

```python
if hook_name not in VALID_HOOKS:
    logger.warning(...)
self._manager._hooks.setdefault(hook_name, []).append(callback)
```

这说明 Hermes 对 hook 名做了一个很务实的设计：

- 不认识的 hook 会 warning；
- 但仍然保存。

为什么这样做？

因为这有利于**前向兼容**：

- 新版本 Hermes 可能增加新 hook；
- 老版本插件先写上去，在旧宿主里不会立刻崩；
- 未来升级 Hermes 后，这些 hook 就能自然生效。

这是一种非常典型的生态友好型设计。

### 8.5 `invoke_hook()`：逐个 try/except 隔离失败

源码逻辑：

```python
for cb in callbacks:
    try:
        ret = cb(**kwargs)
        if ret is not None:
            results.append(ret)
    except Exception as exc:
        logger.warning(...)
```

这意味着 Hermes 的 hook 调用满足两个重要原则：

1. **一个插件挂了，不影响其他插件**；
2. **hook 抛异常，不打断核心 Agent Loop。**

这点非常关键。因为插件生态一旦扩大，宿主不可能假设所有第三方插件都写得很好。Hermes 的容错思路是：

> **插件失败是局部故障，不应该升级为系统故障。**

### 8.6 `pre_llm_call` 的特殊地位：上下文注入而不是观察者

绝大多数 hook 的返回值都会被忽略，但 `pre_llm_call` 是个例外。

如果 callback 返回：

```python
{"context": "..."}
```

或直接返回字符串，那么 Hermes 会把这些内容**注入到当前轮次的用户消息**中。

这一点很关键，源码注释也明确说明：

- 上下文注入进入 user message；
- **不会写入 system prompt**；
- 这样做是为了**保住 prompt cache prefix**；
- 注入内容是临时的，不会写回 session DB。

这对 memory plugin / RAG plugin / guardrail plugin 来说非常重要。它说明 Hermes 已经认真考虑过缓存成本和 prompt 稳定性，不是简单粗暴地把插件上下文直接拼进 system prompt。

### 8.7 on_session_end / finalize / reset 的意义

这几个 hook 很适合做资源清理和状态同步：

- `on_session_end`：每轮对话结束后触发；
- `on_session_finalize`：CLI/gateway 彻底结束一个会话；
- `on_session_reset`：用户 `/new`、`/reset` 时触发。

这意味着如果你的插件维护：

- 临时缓存；
- 当前 session 的 tracing span；
- 一个轻量状态机；
- 一个会话级审计缓冲区；

那么这些 hook 都是合适的收尾点。

---

## 九、插件间通信：Hermes 没有显式总线，但有非常实用的间接通道

很多人会问：Hermes 有没有官方的插件消息总线？

严格来说，**没有一个独立命名的“plugin bus”**。但这并不代表插件无法协作。Hermes 实际上提供了几条非常实用的间接通信路径。

### 9.1 方式一：通过 Tool Registry 间接互调

最稳妥的办法就是：

- A 插件注册一个 tool；
- B 插件通过 `ctx.dispatch_tool("that_tool", args)` 调用它。

这其实就是一种“以工具为边界的插件互操作”。

优点：

- 复用统一工具运行时；
- 权限、日志、审批链可继承；
- 接口天然结构化。

缺点：

- 更适合动作型能力，不太适合事件广播；
- 返回值通常是 JSON 字符串，需要约定格式。

### 9.2 方式二：通过 Hook 共享观察面

多个插件都可以订阅同一个 hook，比如 `post_tool_call`：

- A 插件做审计；
- B 插件做指标采集；
- C 插件做安全策略记录。

它们彼此不需要认识对方，但可以在同一个事件面上协同工作。

这是一种很典型的**发布-订阅式松耦合协作**，只不过 Hermes 没把它叫总线。

### 9.3 方式三：通过 Provider Registry 共享后端能力

比如：

- 一个 web search provider 注册自己；
- 上层插件或者 tool 调度逻辑通过配置选中它；
- 其他插件不需要直接 import 它，只需要依赖宿主 provider 选择结果。

这是“通过系统注册中心而不是直接相互依赖”来实现协作。

### 9.4 方式四：通过 slash command + tool 编排形成高层工作流

一个插件完全可以：

- 提供 `/deliver` slash command；
- 内部用 `dispatch_tool()` 调用 Hermes 内置 `delegate_task`；
- 再在 hook 中监听任务结果；
- 最后通过 `inject_message()` 把结果反馈进当前会话。

这时插件不是直接与另一个插件通信，而是通过 Hermes 核心调度链完成“软集成”。

### 9.5 方式五：通过技能命名空间协作

`register_skill()` 会把技能注册为：

```text
<plugin_name>:<skill_name>
```

因此插件也可以通过显式 skill namespacing 来组织一组可被加载的能力文档。虽然这不是严格意义上的插件通信，但它是插件向宿主与其他工作流暴露知识资产的一种方式。

### 9.6 我对 Hermes 插件通信设计的评价

Hermes 没有上来就设计一个重型插件总线，我认为是好事。

因为插件总线一旦设计过重，就会带来：

- 事件契约膨胀；
- 生命周期复杂度上升；
- 调试难度成倍增加；
- 第三方插件互相耦合。

Hermes 现在的思路更偏工程现实主义：

- 动作用 tool 交互；
- 观察用 hook 共享；
- 能力选择走 registry；
- 用户入口走 command；
- 会话插入走 inject_message。

这套组合虽然没有一个统一名词，但已经足够覆盖大多数真实插件协作场景。

---

## 十、自定义插件开发全流程：从 0 到 1 做一个可用插件

接下来我们做一个完整的实战案例。

目标：实现一个“项目文档助手”插件，具备以下能力：

1. 注册一个 tool：`project_docs_search`，供模型搜索本地索引；
2. 注册一个 CLI 命令：`hermes project-docs rebuild`，重建索引；
3. 注册一个 slash command：`/docs <query>`，在会话中快速查文档；
4. 注册一个 hook：`pre_llm_call`，根据最近查询自动注入相关文档摘要；
5. 记录一些真实开发中的坑位与规避方法。

### 10.1 目录结构

先建立插件目录：

```text
~/.hermes/plugins/project-docs/
├── plugin.yaml
├── __init__.py
├── schemas.py
├── tools.py
├── cli.py
└── indexer.py
```

### 10.2 编写 manifest

`plugin.yaml`：

```yaml
name: project-docs
version: 1.0.0
description: 项目文档搜索与注入插件
author: Mike
kind: standalone
provides_tools:
  - project_docs_search
provides_hooks:
  - pre_llm_call
requires_env: []
```

这里建议把 `provides_tools`、`provides_hooks` 写上，即便 Hermes 不完全依赖它们，也方便状态展示和自解释。

### 10.3 编写 schema

`schemas.py`：

```python
PROJECT_DOCS_SEARCH = {
    "type": "function",
    "function": {
        "name": "project_docs_search",
        "description": "搜索项目文档索引并返回相关片段",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索关键词或自然语言问题"
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回条数，默认 5",
                    "minimum": 1,
                    "maximum": 10
                }
            },
            "required": ["query"]
        }
    }
}
```

### 10.4 编写工具逻辑

`tools.py`：

```python
import json
from pathlib import Path

INDEX_FILE = Path.home() / ".hermes" / "project_docs_index.json"


def _load_index():
    if not INDEX_FILE.exists():
        return []
    return json.loads(INDEX_FILE.read_text(encoding="utf-8"))


def project_docs_search(args, **kwargs):
    query = (args or {}).get("query", "").strip()
    top_k = int((args or {}).get("top_k", 5))
    if not query:
        return json.dumps({"error": "missing query"}, ensure_ascii=False)

    docs = _load_index()
    scored = []
    for item in docs:
        text = item.get("text", "")
        score = text.lower().count(query.lower())
        if score > 0:
            scored.append({
                "path": item.get("path"),
                "text": text[:400],
                "score": score,
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return json.dumps({"results": scored[:top_k]}, ensure_ascii=False)
```

这个实现非常简化，但足够说明插件 tool 的典型结构。

### 10.5 编写 CLI rebuild 命令

`cli.py`：

```python
import json
from pathlib import Path

INDEX_FILE = Path.home() / ".hermes" / "project_docs_index.json"


def rebuild_index(args):
    root = Path(args.path).resolve()
    rows = []
    for p in root.rglob("*.md"):
        try:
            rows.append({
                "path": str(p),
                "text": p.read_text(encoding="utf-8", errors="ignore")
            })
        except Exception:
            pass
    INDEX_FILE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"Indexed {len(rows)} markdown files into {INDEX_FILE}")


def setup_cli(subparser):
    subs = subparser.add_subparsers(dest="project_docs_cmd")
    rebuild = subs.add_parser("rebuild", help="重建文档索引")
    rebuild.add_argument("path", help="项目根目录")
    subparser.set_defaults(func=rebuild_index)
```

### 10.6 在 `register(ctx)` 中统一挂载

`__init__.py`：

```python
import json
from .schemas import PROJECT_DOCS_SEARCH
from .tools import project_docs_search
from .cli import setup_cli

_LAST_QUERY = {"value": ""}


def _cli_handler(args):
    return args.func(args)


def _docs_command_factory(ctx):
    def _handle_docs(raw_args: str):
        query = raw_args.strip()
        if not query:
            return "Usage: /docs <query>"
        _LAST_QUERY["value"] = query
        return ctx.dispatch_tool("project_docs_search", {"query": query, "top_k": 5})
    return _handle_docs


def _inject_context(session_id=None, user_message="", **kwargs):
    q = _LAST_QUERY.get("value", "").strip()
    if not q:
        return None
    return {"context": f"最近一次 /docs 检索关键词：{q}\n如相关，请优先结合 project_docs_search 的结果回答。"}


def register(ctx):
    ctx.register_tool(
        name="project_docs_search",
        toolset="project_docs",
        schema=PROJECT_DOCS_SEARCH,
        handler=project_docs_search,
        description="搜索项目文档索引",
    )

    ctx.register_cli_command(
        name="project-docs",
        help="项目文档插件管理",
        setup_fn=setup_cli,
        handler_fn=_cli_handler,
        description="管理项目文档索引",
    )

    ctx.register_command(
        name="docs",
        handler=_docs_command_factory(ctx),
        description="搜索项目文档",
        args_hint="<query>",
    )

    ctx.register_hook("pre_llm_call", _inject_context)
```

这里有几个很实战的点：

- slash command handler 通过闭包拿到 `ctx`；
- slash command 内不直接自己做搜索，而是调用 `ctx.dispatch_tool()`；
- hook 只做轻量上下文注入，不重复执行重逻辑；
- CLI 和 slash command 分别承担控制面与会话入口职责。

### 10.7 使用方式

#### 先重建索引

```bash
hermes project-docs rebuild /path/to/your/repo
```

#### 在对话中使用 slash command

```text
/docs PluginContext
```

#### 让模型自动调用工具

直接问：

```text
PluginContext.register_command 的实现细节是什么？
```

如果 schema 写得足够好、工具集已启用，模型就有机会自动调用 `project_docs_search`。

---

## 十一、真实踩坑记录：这些问题我建议你提前规避

理论说完，下面讲点最有价值的——踩坑。

### 坑 1：在 `register()` 里做重逻辑，导致插件加载慢甚至失败

很多人第一次写插件，会在 `register()` 里：

- 扫描磁盘；
- 读大文件；
- 请求远程 API；
- 初始化数据库连接池；
- 启后台线程。

这样做的问题是：

- 插件一加载就变慢；
- CLI 启动时间被拖长；
- 任何异常都发生在注册期，用户甚至还没开始用插件。

**建议**：`register()` 里只做声明式挂载，重逻辑延迟到 handler/hook 执行时。

### 坑 2：slash command 和 built-in 冲突，以为“怎么命令不生效”

比如你注册：

```python
ctx.register_command("help", ...)
```

Hermes 会直接跳过并记 warning。用户表面看只是命令不存在，开发者如果没看日志，很容易以为自己代码没加载。

**建议**：

- 插件 slash command 一律走明显的插件前缀；
- 不要碰内置高频词。

### 坑 3：tool 名字取得太泛，和别的插件互踩

例如：

- `search`
- `status`
- `sync`
- `convert`

这类名字极容易冲突。

**建议**：

- tool 名用明确前缀：`project_docs_search`、`kanban_sync_board`；
- CLI 顶层命令用插件名；
- slash command 也尽量带有业务辨识度。

### 坑 4：以为 slash command handler 收到的是结构化参数

Hermes 给你的就是 `raw_args: str`。如果你直接按 `args.foo` 去写，一定炸。

**建议**：

- 简单场景直接 `raw_args.strip()`；
- 复杂场景用 `shlex.split(raw_args)`；
- 面向自然语言查询的命令就别强行做 shell 风格参数化。

### 坑 5：hook 回调没写 `**kwargs`，版本升级后容易裂

Hermes 文档明确建议 hook callback 接收 `**kwargs`，原因很简单：宿主未来可能给 hook 增加新参数。

如果你把签名写死：

```python
def my_hook(session_id, user_message):
    ...
```

将来 Hermes 多传一个 `platform`，你的插件就可能直接 TypeError。

**建议**：

```python
def my_hook(session_id=None, user_message="", **kwargs):
    ...
```

### 坑 6：在 hook 里返回了错误格式，以为上下文注入没生效

`pre_llm_call` 只有两种稳妥返回：

- 纯字符串；
- `{"context": "..."}`。

你返回别的 dict 结构，Hermes 不一定按你想的那样处理。

**建议**：保持返回格式极简、稳定。

### 坑 7：把插件之间共享状态写成模块级全局，最后多会话串台

比如上文示例里 `_LAST_QUERY` 是为了演示方便；真实生产里，如果你有并发会话、多 gateway、多用户，就不能用简单模块级全局保存会话态。

**建议**：

- 需要会话隔离时，用 `session_id` 做 key；
- 或写入你自己的外部存储；
- 不要假设 Hermes 始终单用户单会话。

### 坑 8：Telegram/Discord 上命令名被截断或被过滤

如果命令太长、带非法字符、或者平台不支持该形式，最终呈现会和 CLI 不一样。

**建议**：

- 命令名控制在 32 字以内；
- 只用小写字母、数字、短横线；
- 不依赖复杂参数展示；
- `args_hint` 写清楚，但不要过度复杂。

### 坑 9：忘了看 `HERMES_PLUGINS_DEBUG=1`

插件没加载、命令没出现、manifest 没识别、目录布局不对时，最有效的办法往往不是盲猜，而是打开调试日志。

```bash
HERMES_PLUGINS_DEBUG=1 hermes plugins list
```

这会告诉你：

- 扫描了哪些目录；
- 识别到哪些 manifest；
- 为什么某插件被跳过；
- `register()` 里到底注册了多少 tool/hook/command/CLI。

在真实开发中，这条命令能省掉你至少一半排查时间。

---

## 十二、PluginContext + 三种扩展点的设计哲学总结

回头看 Hermes 的插件系统，会发现它并不是一个靠“功能多”取胜的系统，而是靠**边界设计得当**取胜。

### 12.1 为什么 `PluginContext` 是整个系统的关键

因为它把插件与宿主的关系变成了：

- 宿主提供受控能力；
- 插件声明式注册；
- 运行时统一落到已有主干系统中。

这比直接暴露内部对象更稳，也比纯配置化工具表更强。

### 12.2 为什么要同时存在 tool、CLI、slash command 三类扩展点

因为它们服务的是三个不同层面：

| 扩展点 | 面向对象 | 典型入口 | 适合场景 |
|---|---|---|---|
| tool | 模型 | Agent function call | 执行动作、结构化调用 |
| CLI command | 终端用户/运维 | `hermes xxx` | 管理、初始化、诊断 |
| slash command | 会话用户 | `/xxx` | 快速动作、会话内控制 |

如果只保留其中一种，最终都会把不适合的任务硬塞进去：

- 只靠 tool，会话体验差；
- 只靠 CLI，无法进聊天平台；
- 只靠 slash command，复杂配置流程会很痛苦。

Hermes 同时提供三种扩展点，本质上是在承认：

> **Agent 平台的扩展需求天然是分层的。**

### 12.3 为什么 Hermes 的插件系统适合做生态，而不只是 demo

因为它已经具备了生态所需的关键属性：

- 统一注册门面；
- 多来源发现；
- 冲突处理；
- 生命周期 hook；
- Provider 扩展；
- 容错隔离；
- Gateway 命令映射；
- Tool runtime 复用；
- 审计与 introspection。

这些不是 demo 级插件系统会认真处理的问题，而是生态级平台必须面对的问题。

---

## 十三、给插件开发者的实战建议清单

如果你准备正式写 Hermes 插件，我给出的建议是：

### 命名策略

- tool：用明确业务前缀，如 `project_docs_search`
- CLI 顶层命令：用插件名本身，如 `project-docs`
- slash command：简洁、短小、业务明确，如 `docs`

### 目录结构

- `plugin.yaml`
- `__init__.py`
- `schemas.py`
- `tools.py`
- `cli.py`
- `providers.py`（如果有）
- `skills/`（如果有）

### 注册函数约束

- `register(ctx)` 中不做重活；
- 所有 handler 尽量可独立测试；
- hook 一律接受 `**kwargs`；
- 对可能失败的外部依赖做 graceful degradation。

### 设计思路

- 模型要自动调用的能力做成 tool；
- 用户显式控制的复杂动作做成 CLI command；
- 会话内高频快操作做成 slash command；
- 组合工作流优先用 `dispatch_tool()` 复用已有能力；
- 需要上下文注入时用 `pre_llm_call`，不要想着乱改 system prompt。

### 调试手段

- `HERMES_PLUGINS_DEBUG=1`
- `hermes plugins list`
- 查看 `~/.hermes/logs/agent.log`
- 单独测试 schema、handler、hook
- 针对命令名做跨平台约束检查

---

## 十四、结语：Hermes 插件系统给我们哪些启发

Hermes 插件系统真正值得学习的，不只是“它能注册 tool、CLI、slash command”，而是它背后的工程判断：

1. **插件能力必须统一收口**，而不是四处开后门；
2. **扩展点应该分层**，分别服务模型、终端用户、会话用户；
3. **运行时能力复用比另起炉灶更重要**，插件工具就应该走统一工具注册表；
4. **容错优先于完美**，插件失败不能拖垮宿主；
5. **多平台支持必须建立在统一抽象上**，slash command 先是会话命令，再映射到 Telegram/Discord/Slack；
6. **生态稳定性来自门面 API，而不是暴露内部实现。**

从源码层面看，`PluginContext` 并不复杂；但正因为它不复杂，才说明设计者做了足够好的抽象收敛。对于一个不断生长的 Agent 平台来说，这种收敛能力比增加十几个炫目的扩展 API 更重要。

如果你接下来要做 Hermes 插件，我建议你先从下面这个最小心智模型开始：

- **tool**：给模型用；
- **CLI command**：给终端用户管插件用；
- **slash command**：给会话用户快捷操作用；
- **hook**：让插件参与生命周期；
- **dispatch_tool**：做高层工作流编排；
- **PluginContext**：插件和宿主唯一可信的握手面。

把这个模型吃透，再去看 Hermes 其他 provider 类插件、platform 插件、memory 插件的实现，你会发现整个系统其实非常统一。

这正是一个优秀插件架构最难得的地方：**表面上扩展很多，底层却没有失控。**

---

## 相关阅读

- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？](/categories/架构/Hermes-Skill-vs-Plugin-扩展点对比-什么时候用-Skill-什么时候用-Plugin/)
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
- [Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽、审批策略](/categories/架构/Hermes-子代理架构-leaf-vs-orchestrator-角色模型-工具屏蔽-审批策略/)
