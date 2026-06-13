---
title: Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测
date: 2026-06-02 12:00:00
tags: [Hermes, MCP, AI Agent, 动态工具发现, 安全, prompt injection, stdio, SSE, HTTP]
description: "本文深入拆解 Hermes Agent 的 MCP 集成架构，从动态工具发现、stdio/SSE/HTTP 三种传输方式的工程实现，到 prompt injection 检测与安全防护链路，结合源码分析与可落地配置，帮助开发者理解如何把 MCP 协议从 Demo 级支持升级为生产级 Agent 工程能力。覆盖并发调度、生命周期管理、OAuth 认证恢复、工具过滤与能力协商等核心话题。"
categories:
  - architecture
cover: /images/covers/hermes-mcp-integration-cover.jpg
---

## 引言：为什么要单独讨论 Hermes 的 MCP 集成架构

前一天我已经写过一篇更偏协议层和生态层的文章，主题是 MCP 如何把 AI Agent 与外部工具之间的集成问题，从传统的 **M × N** 复杂度，压缩到更可维护的 **M + N**。那篇文章更像一张地图，解决的是“**为什么 MCP 很重要**”。

而本文更聚焦另外一个问题：**一个真正可用的 Agent，在工程上到底如何把 MCP 接进来，而且接得稳、接得安全、接得可演进？**

这件事并不只是“支持一下 MCP SDK”那么简单。对一个成熟 Agent 来说，至少要同时解决几类问题：

1. **工具发现问题**：MCP Server 的工具并不是编译期就固定的，而是运行时动态连接、动态发现、甚至动态变化的。
2. **传输多样性问题**：本地工具倾向于 `stdio`，远端服务通常走 `HTTP/Streamable HTTP`，某些已有服务或边缘部署更适合 `SSE`。
3. **并发与生命周期问题**：MCP 连接是长连接语义，不能把每次工具调用都当成一次独立 HTTP 请求来处理。
4. **安全问题**：MCP 的工具描述、Prompt、Resource，本质上都是外部输入。只要它们能进入模型上下文，就可能触发 prompt injection。
5. **运维问题**：连接超时、OAuth、证书、工具过滤、能力协商、动态刷新、崩溃恢复、日志收敛，一个都少不了。

Hermes Agent 在这件事上的实现，很有代表性。它并不是简单做一个“会列出 MCP tools 的客户端”，而是把 MCP 集成进了自己已有的工具注册体系、会话生命周期、并行调度策略、安全扫描链路和网关/CLI/cron 多运行时中。

如果说 MCP 是协议，那么 Hermes 的价值在于：**它把“协议支持”进一步做成了“可落地的 Agent 工程能力”**。

本文会重点围绕 Hermes 代码仓库中的 MCP 相关实现展开，尤其是 `tools/mcp_tool.py`、`tools/registry.py`、`model_tools.py` 以及 `cron/scheduler.py` 中和 prompt injection 相关的逻辑。文章不会重复上一篇关于 MCP 基础概念的全部内容，而是尽量做差异化：

- 用更偏实现的视角看 MCP；
- 解释 Hermes 为什么要这样设计；
- 结合源码分析动态工具发现、三种传输方式和安全防护；
- 最后给出一套可直接落地的配置与实战建议。

---

## 一、MCP 协议概述：从“工具调用”走向“能力协商”

在进入 Hermes 具体实现之前，还是有必要先把 MCP 的关键点重新压缩梳理一遍，不过这次会以“**Agent 集成者**”的视角来讲，而不是“协议介绍者”的视角。

### 1.1 MCP 不只是 Tool Calling

很多人第一次接触 MCP，容易把它理解成“一个统一版的 Function Calling”。这个理解只对了一半。

MCP 当然包含工具调用能力，但它实际定义的是一个更完整的、基于 JSON-RPC 2.0 的会话协议。一个 MCP 会话至少包含：

- `initialize`：初始化与能力协商
- `tools/list`、`tools/call`：工具发现与调用
- `resources/list`、`resources/read`：资源读取
- `prompts/list`、`prompts/get`：Prompt 模板获取
- `notifications/tools/list_changed`：服务端通知客户端工具列表发生变化
- `sampling/createMessage`：某些场景下，Server 反向请求客户端侧 LLM 完成采样

换句话说，MCP 不只是“把函数 schema 发给模型”，而是在尝试定义：

> **模型客户端如何与一个拥有多种能力的外部智能上下文服务建立长期会话。**

这也是为什么 Hermes 的集成不能只停留在“把远端工具转成本地 schema”这一步，它必须维护连接、监听通知、处理刷新、执行认证恢复，甚至要考虑不同传输层的行为差异。

### 1.2 Hermes 所面对的 MCP 集成问题，与普通 SDK Demo 完全不同

一个 Demo 级 MCP Client，往往只需要做三件事：

1. 建立连接；
2. `list_tools`；
3. `call_tool`。

但 Hermes 这种 Agent 运行在多个场景里：

- CLI 对话式使用
- Gateway/API Server 长驻运行
- cron 定时任务自动执行
- 多工具链混合场景（内置工具 + MCP 工具 + 插件工具）

所以它要面对的是：

- 如何把 MCP 工具塞进现有统一 registry 中；
- 如何避免 MCP 工具和内置工具重名冲突；
- 如何在 Server 发出 `tools/list_changed` 时动态增删工具；
- 如何在模型看起来是“统一工具池”的体验下，底层仍保留各个 MCP server 的独立连接和状态；
- 如何保证异常时不把 token、secret、Bearer header 泄漏给模型；
- 如何在 prompt injection 风险出现时及时拦截；
- 如何对 cron 这样的非交互执行场景做更严格保护。

这些，才是 Hermes 这套集成架构真正值得研究的地方。

### 1.3 MCP 的分层视角

如果从实现角度看，一个 Agent 内部的 MCP 支持大致可以拆成四层：

```text
┌──────────────────────────────────────────────────────────────┐
│                     Agent 工具编排层                         │
│   统一工具列表、schema 暴露、会话级工具开关、并发调度       │
├──────────────────────────────────────────────────────────────┤
│                     MCP 集成适配层                           │
│   配置加载、server 生命周期、tool 注册、动态刷新、安全扫描  │
├──────────────────────────────────────────────────────────────┤
│                     MCP 协议会话层                           │
│   initialize、list_tools、call_tool、resources/prompts 等   │
├──────────────────────────────────────────────────────────────┤
│                     传输层                                   │
│   stdio / SSE / HTTP(Streamable HTTP)                        │
└──────────────────────────────────────────────────────────────┘
```

Hermes 最核心的工程价值，正是在第二层：**MCP 集成适配层**。它把上层 Agent 的工具抽象和下层 MCP 会话、传输细节隔离开来。

---

## 二、Hermes MCP 集成架构设计：把外部工具“变成”内部工具

### 2.1 总体设计目标

根据源码 `tools/mcp_tool.py` 顶部注释，Hermes 的 MCP 支持目标非常明确：

- 连接外部 MCP Server；
- 通过 `stdio`、`HTTP/StreamableHTTP` 或 `SSE` 建立会话；
- 发现它们暴露的工具；
- 将这些工具注册到 Hermes 自身的 tool registry 中；
- 让 Agent 像调用内置工具一样调用这些 MCP 工具。

这背后的核心思想非常重要：

> **Hermes 并没有把 MCP 工具单独做成“第二类工具系统”，而是把它们统一映射回 Hermes 原有 registry。**

这意味着在上层模型看来，MCP 工具与本地工具拥有相同的暴露方式；在下层执行时，MCP 工具又保留了独立连接、超时、认证和错误恢复逻辑。

这是一种非常典型、也非常正确的架构做法：**接口统一，执行分层**。

### 2.2 关键模块关系

结合代码结构，可以把主要模块关系画成下面这样：

```text
┌──────────────────────────────┐
│         model_tools.py        │
│  - handle_function_call()     │
│  - get_tool_definitions()     │
└──────────────┬───────────────┘
               │
               │ 查询/派发
               ▼
┌──────────────────────────────┐
│       tools/registry.py       │
│  - discover_builtin_tools()   │
│  - registry.register()        │
│  - registry.dispatch()        │
└──────────────┬───────────────┘
               │
      内置工具   │    MCP 工具注册
               │
     ┌─────────▼─────────┐
     │   tools/*.py       │
     │ 自注册 built-ins   │
     └────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│        tools/mcp_tool.py      │
│ - load mcp config             │
│ - connect servers             │
│ - register_mcp_servers()      │
│ - discover_mcp_tools()        │
│ - dynamic refresh             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│        MCPServerTask          │
│ - stdio/http/sse transport    │
│ - initialize/list_tools       │
│ - reconnect/keepalive         │
│ - message_handler             │
└──────────────────────────────┘
```

### 2.3 启动链路：内置工具与 MCP 工具并列发现

Hermes 的工具发现链路很有意思。

在 `tools/registry.py` 中，内置工具的发现是通过 AST 扫描完成的。`discover_builtin_tools()` 会遍历 `tools/` 目录下的 `.py` 文件，寻找顶层 `registry.register(...)` 调用，然后导入这些模块。

核心逻辑可以概括为：

```python
def discover_builtin_tools(tools_dir: Optional[Path] = None) -> List[str]:
    tools_path = Path(tools_dir) if tools_dir is not None else Path(__file__).resolve().parent
    module_names = [
        f"tools.{path.stem}"
        for path in sorted(tools_path.glob("*.py"))
        if path.name not in {"__init__.py", "registry.py", "mcp_tool.py"}
        and _module_registers_tools(path)
    ]

    imported: List[str] = []
    for mod_name in module_names:
        importlib.import_module(mod_name)
```

这里有两个关键点：

1. **内置工具是“模块导入即注册”** 的自注册模式；
2. `mcp_tool.py` 被明确排除在内置工具扫描之外，因为它不是一个普通工具模块，而是一个“外部工具接入器”。

随后，`tools/mcp_tool.py` 提供 `discover_mcp_tools()`，从配置里加载 `mcp_servers`，建立连接，发现外部工具，再调用 `registry.register()` 把它们注入同一个 registry。

于是，Hermes 最终呈现给模型的是一个统一工具池：

- 一部分是内置工具；
- 一部分是插件工具；
- 一部分是运行时接入的 MCP 工具。

这就是“**把外部工具变成内部工具**”的核心思想。

### 2.4 命名规范：前缀化避免冲突

Hermes 为每个 MCP 工具生成统一命名：

```text
mcp_<server>_<tool>
```

例如：

- `mcp_github_create_issue`
- `mcp_filesystem_read_file`
- `mcp_docs_search`

在 `mcp_tool.py` 里，对名称的生成由 `sanitize_mcp_name_component()` 负责，它会把非法字符转成下划线，保证最终名称兼容 provider 的 tool 命名规则。

同时，真正的 schema 转换在 `_convert_mcp_schema()` 中完成：

```python
def _convert_mcp_schema(server_name: str, mcp_tool) -> dict:
    safe_tool_name = sanitize_mcp_name_component(mcp_tool.name)
    safe_server_name = sanitize_mcp_name_component(server_name)
    prefixed_name = f"mcp_{safe_server_name}_{safe_tool_name}"
    return {
        "name": prefixed_name,
        "description": mcp_tool.description or f"MCP tool {mcp_tool.name} from {server_name}",
        "parameters": _normalize_mcp_input_schema(getattr(mcp_tool, "inputSchema", None)),
    }
```

这样做有三个好处：

1. **避免与内置工具重名**；
2. **保留 server 来源信息**；
3. **便于上层按 server 维度做并发/权限/状态控制**。

### 2.5 运行时别名与工具集映射

Hermes 并没有暴力修改全局静态 `TOOLSETS` 表，而是通过 registry 中的动态 alias 机制，让 `mcp-{server}` 成为一个独立 toolset，并支持用原 server 名作为 alias。

比如：

- toolset 逻辑名：`mcp-github`
- alias：`github`

这使得工具过滤、权限控制和“按 server 启停”的能力更自然，也避免了到处硬编码 server 名。

### 2.6 生命周期：MCP Server 是长生命周期任务，不是临时请求

Hermes 通过 `MCPServerTask` 管理每个 server 的连接生命周期。它的职责包括：

- 建立连接；
- 初始化会话；
- 发现工具；
- 维持 transport 上下文；
- 接受重连信号；
- shutdown 时清理资源。

源码注释写得很清楚：

- 整个连接生命周期运行在同一个 asyncio Task 里；
- 这是为了保证 anyio cancel scope 的 enter/exit 在同一 task 上完成；
- 每个 server 连接都运行在专门的后台 event loop 线程中；
- 工具调用通过 `run_coroutine_threadsafe()` 调度回该 loop 执行。

这说明 Hermes 并没有把 MCP 当成一个“无状态 HTTP API”，而是严格按照 MCP 的会话模型来实现。

---

## 三、动态工具发现机制源码解析：从静态 registry 到运行时刷新

如果说 Hermes 的 MCP 集成里最有技术含量的部分是什么，我会优先选 **动态工具发现**。

因为这直接决定了 Hermes 是否真正支持 MCP 的“能力可发现”特性，而不是停留在初始化时 list 一次 tools 的半成品实现。

### 3.1 内置工具发现：AST 扫描 + 模块自注册

先看 Hermes 本身的工具发现思路。

`tools/registry.py` 里有两个非常关键的函数：

```python
def _module_registers_tools(module_path: Path) -> bool:
    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))
    return any(_is_registry_register_call(stmt) for stmt in tree.body)
```

```python
def discover_builtin_tools(tools_dir: Optional[Path] = None) -> List[str]:
    ...
    if path.name not in {"__init__.py", "registry.py", "mcp_tool.py"}
    and _module_registers_tools(path)
```

这个设计有几个巧妙之处：

1. **无需维护手工工具清单**；
2. 只有真正包含顶层 `registry.register()` 的文件才会被导入；
3. 避免误导入 helper 模块；
4. 为工具系统提供了非常好的可扩展性。

这套机制也为 MCP 动态注册提供了天然落点：**只要外部工具最后也通过 `registry.register()` 进入统一 registry，那么上层完全不需要知道它们来自哪里。**

### 3.2 MCP 工具发现入口：discover_mcp_tools()

Hermes 的 MCP 发现入口是 `discover_mcp_tools()`：

```python
def discover_mcp_tools() -> List[str]:
    if not _MCP_AVAILABLE:
        return []

    servers = _load_mcp_config()
    if not servers:
        return []

    tool_names = register_mcp_servers(servers)
    return tool_names
```

这个入口有几个工程层面的特点：

- **可选依赖**：如果 `mcp` Python 包没装，直接 no-op；
- **配置驱动**：从 `~/.hermes/config.yaml` 的 `mcp_servers` 读取；
- **幂等调用**：已经连接的 server 不会重复连接；
- **失败隔离**：某个 server 失败，不会影响其他 server。

### 3.3 配置加载与环境变量插值

Hermes 对 MCP 配置做了递归环境变量插值：

```python
def _interpolate_env_vars(value):
    if isinstance(value, str):
        def _replace(m):
            return os.environ.get(m.group(1), m.group(0))
        return _ENV_VAR_PATTERN.sub(_replace, value)
```

并在 `_load_mcp_config()` 中把 `.env` 也考虑进来：

```python
def _load_mcp_config() -> Dict[str, dict]:
    from hermes_cli.config import load_config
    config = load_config()
    servers = config.get("mcp_servers")
    ...
    return {name: _interpolate_env_vars(cfg) for name, cfg in servers.items()}
```

这意味着你可以这么写：

```yaml
mcp_servers:
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}"
```

对多环境部署、密钥分离和 CI/CD 都很友好。

### 3.4 server 注册：register_mcp_servers()

真正的连接与注册逻辑在 `register_mcp_servers()`：

```python
def register_mcp_servers(servers: Dict[str, dict]) -> List[str]:
    with _lock:
        new_servers = {
            k: v
            for k, v in servers.items()
            if k not in _servers and _parse_boolish(v.get("enabled", True), default=True)
        }
```

这里先做了两层过滤：

1. **已经连接的 server 不重复连接**；
2. `enabled: false` 的 server 直接跳过。

然后 Hermes 还会记录哪些 server 允许并行工具调用：

```python
if _parse_boolish(srv_cfg.get("supports_parallel_tool_calls", False), default=False):
    _parallel_safe_servers.add(sanitize_mcp_name_component(srv_name))
```

这意味着“是否允许同一个 MCP server 的多个工具并行执行”并不是默认开启的，而是需要显式 opt-in。这是个很稳健的默认值，因为很多 stdio MCP server 的底层实现并不一定线程安全，甚至连单连接多 RPC 并发都不支持。

### 3.5 并行连接多个 server

Hermes 在启动多个新 server 时，使用 `asyncio.gather()` 并行连接：

```python
async def _discover_all():
    results = await asyncio.gather(
        *(_discover_one(name, cfg) for name, cfg in new_servers.items()),
        return_exceptions=True,
    )
```

这个设计可以显著减少启动延迟，尤其是当你配置了多个远程 HTTP MCP server 时。

同时，由于用了 `return_exceptions=True`，任何一个 server 的失败都会被单独记录，而不是直接让整个初始化流程崩掉。这是非常典型的“多外部依赖接入”的正确姿势。

### 3.6 从 session.list_tools() 到 registry.register()

每个 server 完成连接后，会调用 `_discover_and_register_server()`：

```python
async def _discover_and_register_server(name: str, config: dict) -> List[str]:
    server = await asyncio.wait_for(_connect_server(name, config), timeout=connect_timeout)
    with _lock:
        _servers[name] = server

    registered_names = _register_server_tools(name, server, config)
    server._registered_tool_names = list(registered_names)
```

真正注册发生在 `_register_server_tools()` 中：

```python
for mcp_tool in server._tools:
    schema = _convert_mcp_schema(name, mcp_tool)
    registry.register(
        name=tool_name_prefixed,
        toolset=toolset_name,
        schema=schema,
        handler=_make_tool_handler(name, mcp_tool.name, server.tool_timeout),
        check_fn=_make_check_fn(name),
    )
```

注意这一层非常优雅：

- schema 用 MCP tool 的描述和 inputSchema 转换而来；
- handler 不是静态函数，而是一个闭包，里面绑定了 `server_name`、`tool_name` 和 timeout；
- `check_fn` 用于判断 server 当前是否可用；
- 最终这些信息都以 Hermes 原生 `ToolEntry` 形式进入 registry。

也就是说，上层 `handle_function_call()` 根本不用知道“这个工具是不是 MCP 来的”，它只会统一 `registry.dispatch()`。

### 3.7 动态刷新：真正支持 tools/list_changed

很多 MCP Client 实现会忽略 `notifications/tools/list_changed`，因为这一步做起来比初始化 list 一次复杂得多。

Hermes 选择把它做完整。

在 `MCPServerTask` 中，`ClientSession` 若支持 `message_handler`，就会注入 `_make_message_handler()`：

```python
if _MCP_NOTIFICATION_TYPES and _MCP_MESSAGE_HANDLER_SUPPORTED:
    sampling_kwargs["message_handler"] = self._make_message_handler()
```

消息处理器中专门处理：

```python
case ToolListChangedNotification():
    logger.info("MCP server '%s': received tools/list_changed notification", self.name)
    self._schedule_tools_refresh()
```

而不是在 handler 里同步刷新。注释解释得很清楚：

- 某些 server 会在 initialize 之后立刻发送 `tools/list_changed`；
- 如果在通知处理器里直接调用 `list_tools`，可能与正在执行的其他请求争用同一 JSON-RPC 流；
- 尤其是 stdio transport，容易把流“楔死”（wedge），最终导致后续所有调用超时。

所以 Hermes 的方案是：**通知处理器只负责调度刷新任务，真正刷新在单独 task 中做。**

### 3.8 刷新时不是“全量推倒重来”，而是增量修正

刷新逻辑在 `_refresh_tools()` 里：

```python
old_tool_names = set(self._registered_tool_names)
async with self._rpc_lock:
    tools_result = await self.session.list_tools()
new_mcp_tools = tools_result.tools if hasattr(tools_result, "tools") else []
```

然后先找出 stale tools：

```python
stale_tool_names = old_tool_names - {
    f"mcp_{sanitize_mcp_name_component(self.name)}_{sanitize_mcp_name_component(tool.name)}"
    for tool in new_mcp_tools
}
```

对不再存在的 tool，调用：

```python
registry.deregister(tool_name)
_forget_mcp_tool_server(tool_name)
```

然后再重新注册当前 tool 列表。

这里最值得注意的是注释中的一句话：Hermes **避免了“全量 nuke-and-repave”**。原因是：

- live agent turn 可能已经拿到了某个工具名和 tool-call ID；
- 如果你在刷新时把所有 handler 都删掉再重建，可能在进行中的会话里制造短暂的“工具不存在”窗口；
- 对于未变化的工具名，原地覆盖就足够了。

这说明 Hermes 的刷新逻辑已经不是“功能实现”层面的思考，而是进入了**在线系统一致性**层面的思考。

### 3.9 工具变化的可观测性

刷新完成后，Hermes 还会把变化写日志：

```python
if changes:
    logger.warning(
        "MCP server '%s': tools changed dynamically — %s. Verify these changes are expected.",
        self.name, "; ".join(changes),
    )
```

这句 warning 非常有价值。因为动态工具变化虽然是 MCP 协议的正常能力，但从安全视角看，它也意味着：

- 服务端行为可能已经改变；
- 工具能力边界可能扩大或缩小；
- 如果这是攻击面，就应该有审计线索。

因此 Hermes 把它当成“值得关注的运行时事件”，而不是普通 debug log。

---

## 四、三种传输方式详解：stdio、SSE、HTTP/Streamable HTTP

MCP 协议本身与具体传输层解耦，但在工程实践中，传输层选择几乎决定了稳定性、延迟模型和部署方式。

Hermes 同时支持：

- `stdio`
- `SSE`
- `HTTP / Streamable HTTP`

源码中 `tools/mcp_tool.py` 的顶部注释也直接说明了这一点：

> Connects to external MCP servers via stdio, HTTP/StreamableHTTP, or SSE transport...

这一节我们不仅讲协议，还结合 Hermes 的实现谈它们各自适合什么场景、踩坑在哪里。

---

### 4.1 stdio：本地进程型 MCP 的首选传输

#### 4.1.1 适用场景

`stdio` 最适合：

- 本地文件系统、Git、SQLite、shell 辅助类 server；
- Node/Python 编写的本地 MCP server；
- 和 Agent 运行在同一宿主机上的工具服务。

它的优势是：

- 不需要额外开放端口；
- 本地启动，延迟低；
- 安全边界更容易靠 OS 权限控制；
- 部署成本最低。

典型配置：

```yaml
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env: {}
    timeout: 120
    connect_timeout: 60
```

#### 4.1.2 Hermes 如何处理 stdio 安全问题

stdio 最大的问题不是“能不能连”，而是“**子进程继承了什么环境**”。

Hermes 在 `_build_safe_env()` 里明确做了环境变量白名单过滤：

```python
_SAFE_ENV_KEYS = frozenset({
    "PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR",
})

for key, value in os.environ.items():
    if key in _SAFE_ENV_KEYS or key.startswith("XDG_"):
        env[key] = value
if user_env:
    env.update(user_env)
```

这一步非常关键。

否则，一个本地启动的 MCP server 可能无意中拿到：

- OpenAI / Anthropic / Gemini API keys
- GitHub token
- 数据库密码
- 各种内部环境变量

而 Hermes 的策略是：**默认只透传安全基线变量，用户想给什么，必须在该 server 配置里显式声明。**

这非常符合最小权限原则。

#### 4.1.3 Hermes 还解决了 stdio stderr 污染 TTY 的问题

源码里对 stdio stderr 有一段很长的注释，解释了一个很实战的问题：

- MCP SDK 默认会把 stdio server 子进程的 stderr 直接连到父进程 stderr；
- 如果用户在 TUI/CLI 中运行 Hermes，server 启动日志会直接把终端界面打花；
- 某些情况下还可能造成 prompt_toolkit / Rich 渲染异常。

所以 Hermes 把 stdio 子进程的 stderr 统一重定向到 `~/.hermes/logs/mcp-stderr.log`。

这属于非常典型的“**产品级集成**”细节。很多人做工具接入时忽略这些边角问题，结果是功能能跑，但用户体验一塌糊涂。

#### 4.1.4 stdio 的典型坑

Hermes 在源码里对 `npx/npm/node` 还做了额外路径解析 `_resolve_stdio_command()`，并给出了缺失可执行文件时的更友好错误信息。

这一点非常真实，因为本地 MCP server 最常见报错就是：

- `npx: command not found`
- PATH 被精简之后，Node 不在 PATH 内
- 用户写了相对路径，但子进程环境下找不到

Hermes 的错误提示会明确建议：

- 确保 Node.js 已安装；
- PATH 包含 Node 的 bin 目录；
- 或者在 `mcp_servers.<name>.command` 里使用绝对路径。

这类“错误文案质量”其实直接影响你排障速度。

---

### 4.2 SSE：适合已有 SSE MCP 服务，但要特别注意超时

#### 4.2.1 SSE 在 MCP 里的角色

SSE 适合一类已经以 HTTP Server 形式运行、并通过 Server-Sent Events 持续传输消息的 MCP 服务。你可以把它理解成：

- 控制面/写入可能通过 HTTP 请求完成；
- 事件流通过 SSE 保持长连接。

在 Hermes 中，配置方式是：

```yaml
mcp_servers:
  searxng:
    url: "http://localhost:8000/sse"
    transport: sse
    timeout: 180
    connect_timeout: 10
```

#### 4.2.2 Hermes 的 SSE 分支实现

在 `_run_http()` 中，Hermes 根据 `transport: sse` 进入 SSE 分支：

```python
if config.get("transport") == "sse":
    async with sse_client(**_sse_kwargs) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream, **sampling_kwargs) as session:
            self.initialize_result = await session.initialize()
            self.session = session
            await self._discover_tools()
            self._ready.set()
            reason = await self._wait_for_lifecycle_event()
```

可以看到 Hermes 对上层隐藏了 transport 差异：

- 无论是 stdio、SSE 还是 HTTP；
- 最终都会统一落到 `ClientSession`；
- 上层只面对同样的 `initialize / list_tools / call_tool` 语义。

这就是很好的一层抽象。

#### 4.2.3 SSE 最大的坑：read timeout 不能太短

Hermes 在源码里专门强调了一件事：

```python
"sse_read_timeout": 300.0,
```

注释非常明确：

- 如果把 SSE read timeout 错误地设成普通 tool timeout（比如 60 秒）；
- 但实际 server 可能几分钟都没有事件；
- 那连接就会在“正常空闲”状态下被错误断开。

这几乎是所有 SSE/流式协议的经典坑之一：

> **请求超时** 与 **空闲读取超时** 不是一回事。

Hermes 把 `sse_read_timeout` 固定到更长的 300 秒，本质上是在告诉我们：

- 对流式连接，要按“流的生命周期”建模；
- 不能把一次工具调用的时间预算，简单套到长连接读超时上。

#### 4.2.4 SSE 的 TLS / mTLS 支持

SSE 分支还支持：

- `ssl_verify`
- `client_cert`
- `client_key`

因为 `sse_client` 本身不直接暴露 `verify/cert` 参数，Hermes 通过自定义 `httpx_client_factory` 包一层，把 TLS 选项带进去。

这意味着对企业内部服务、私有 CA、自签证书、双向 TLS 的场景，Hermes 也能覆盖。

#### 4.2.5 SSE 适合什么，不适合什么

SSE 适合：

- 你已经有一个跑在 Web 容器里的 MCP 服务；
- 这个服务天然是长连接事件流模型；
- 你不希望在客户端本地启动子进程。

SSE 不太适合：

- 高频并发多工具调用、连接数特别多的重负载场景；
- 中间有复杂代理、超时链路非常敏感的环境；
- 团队对边缘网关和反向代理配置掌控不强的环境。

因为一旦反代层对 SSE 支持不完整，就容易出现神秘断流、首字节延迟大、空闲断开等问题。

---

### 4.3 HTTP / Streamable HTTP：远端 MCP 服务的主流方案

#### 4.3.1 为什么 HTTP 会成为远端默认方案

对于远端部署的 MCP server，`HTTP/Streamable HTTP` 通常是最自然的选择：

- 容易部署在已有 API 网关后面；
- 易于做认证、审计、TLS、mTLS；
- 易于接入 OAuth；
- 更符合云原生基础设施习惯。

Hermes 里如果 server 配置有 `url`，默认就会按 HTTP transport 处理：

```yaml
mcp_servers:
  remote_api:
    url: "https://my-mcp-server.example.com/mcp"
    headers:
      Authorization: "Bearer ${MY_MCP_TOKEN}"
    timeout: 180
```

#### 4.3.2 Hermes 对 Streamable HTTP 的兼容实现

Hermes 同时兼容新旧两套 MCP SDK HTTP API：

- 新版：`streamable_http_client`
- 旧版：`streamablehttp_client`

源码里先尝试导入新版，如果失败再回退旧版：

```python
from mcp.client.streamable_http import streamablehttp_client
...
try:
    from mcp.client.streamable_http import streamable_http_client
    _MCP_NEW_HTTP = True
except ImportError:
    _MCP_NEW_HTTP = False
```

这说明 Hermes 的实现考虑了 MCP Python SDK 的版本演进，不会把自己锁死在单个 SDK 版本上。

#### 4.3.3 HTTP 客户端层的几个关键处理

Hermes 在新 API 分支中手工构造 `httpx.AsyncClient`：

```python
client_kwargs: dict = {
    "follow_redirects": True,
    "timeout": httpx.Timeout(float(connect_timeout), read=300.0),
    "verify": ssl_verify,
    "event_hooks": {"response": [_strip_auth_on_cross_origin_redirect]},
}
```

这段看似普通，实际上非常讲究。

##### 第一，支持 `follow_redirects`

某些 MCP 服务部署在网关后面，可能会发生重定向。Hermes 默认允许跟随。

##### 第二，read timeout 明显长于 connect timeout

这和前面的 SSE 思路一致：

- 建连超时是建连超时；
- 读流超时是读流超时；
- 不能混为一谈。

##### 第三，跨域重定向时剥离 Authorization

Hermes 还做了一个安全加固：

```python
def _strip_auth_on_cross_origin_redirect(response):
    if response.is_redirect and response.next_request:
        target = response.next_request.url
        if (target.scheme, target.host, target.port) != (
            _original_url.scheme, _original_url.host, _original_url.port,
        ):
            response.next_request.headers.pop("authorization", None)
```

这是个非常重要的细节。

如果远端服务发生跨域重定向，而客户端傻乎乎地把原本的 Authorization header 原封不动带过去，那么你就可能把 token 发到错误的域名上。

Hermes 明确拦住了这一点。

#### 4.3.4 OAuth 2.1 PKCE 支持

Hermes 的 MCP 配置文档中还支持：

```yaml
auth: oauth
```

并在 `_run_http()` 中通过 `mcp_oauth_manager` 获取 provider，支持 token 持久化、刷新和重连恢复。

这意味着 Hermes 不只是支持“静态 Bearer Token”，而是能接真正面向用户授权的远端 MCP 服务。

对于企业 SaaS、第三方平台集成，这是非常重要的一步。

#### 4.3.5 URL 校验与 fail-fast

Hermes 在 `_validate_remote_mcp_url()` 中，对 URL 做了严格校验：

- 必须是字符串；
- 不能为空；
- scheme 必须是 `http` 或 `https`；
- 必须有 host；
- 拒绝 `file://`、`ws://`、无 scheme 形式。

其目的并不是“格式洁癖”，而是：

> **避免错误配置进入自动重试/backoff 循环，白白浪费连接时间和排障时间。**

这就是典型的 fail-fast 思维。

---

### 4.4 三种传输方式横向对比

#### 4.4.1 架构对比表

| 维度 | stdio | SSE | HTTP / Streamable HTTP |
|---|---|---|---|
| 部署位置 | 本地同机 | 远端或本地 Web 服务 | 远端 Web 服务 |
| 连接方式 | 子进程 stdin/stdout | HTTP + 事件流 | HTTP 长连接/流式 |
| 启动成本 | 低 | 中 | 中 |
| 网络基础设施要求 | 几乎没有 | 反代需支持 SSE | 最友好 |
| 安全边界 | OS 权限 + env 控制 | TLS / mTLS / Header | TLS / mTLS / OAuth |
| 常见问题 | PATH、子进程、stderr 污染 | idle timeout、代理断流 | 认证、重定向、session 过期 |
| 最适合 | 本地工具 server | 已有 SSE MCP 服务 | 云端 MCP 平台/远端服务 |

#### 4.4.2 选择建议

如果你让我给一个非常直接的建议：

- **本地开发 / 本机工具接入**：优先 `stdio`
- **远端生产环境 / 企业网关 / SaaS 平台**：优先 `HTTP/Streamable HTTP`
- **已有 SSE 形态服务、无法轻易改造**：才选择 `SSE`

并不是 SSE 不好，而是从长期运维看，HTTP/Streamable HTTP 的生态兼容性通常更强。

---

## 五、实战配置：Hermes 中如何接入三类 MCP Server

这一节不只讲理论，直接给出 Hermes 风格的配置示例。

### 5.1 stdio 实战：接 GitHub MCP Server

```yaml
mcp_servers:
  github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    timeout: 120
    connect_timeout: 30
    supports_parallel_tool_calls: true
    tools:
      include:
        - list_issues
        - create_issue
        - update_issue
        - search_code
      resources: false
      prompts: false
```

这个配置体现了几个最佳实践：

1. token 不明文写死，走环境变量；
2. 只开放白名单工具，不把危险工具暴露给模型；
3. 关闭资源与 prompt utility，减少表面积；
4. 明确声明该 server 支持并发工具调用。

### 5.2 SSE 实战：接文档/检索类 MCP Server

```yaml
mcp_servers:
  docs:
    url: "https://mcp.docs.example.com/sse"
    transport: sse
    headers:
      Authorization: "Bearer ${DOCS_MCP_TOKEN}"
    timeout: 180
    connect_timeout: 15
    ssl_verify: true
    tools:
      exclude:
        - delete_index
      resources: true
      prompts: false
```

适合文档类 server 的原因是：

- 通常以检索、读取为主；
- 事件流空闲时间可能较长；
- SSE 比较容易接已有 Web 服务。

### 5.3 HTTP 实战：接企业内部 MCP API

```yaml
mcp_servers:
  internal_api:
    url: "https://mcp.internal.example.com/mcp"
    headers:
      X-API-Key: "${INTERNAL_MCP_KEY}"
    ssl_verify: "~/secrets/internal-ca.pem"
    client_cert: "~/secrets/mcp-client.pem"
    timeout: 180
    connect_timeout: 20
    tools:
      include:
        - query_data
        - read_report
        - list_dashboards
      resources: true
      prompts: true
```

这个例子体现了 Hermes 对企业内网典型需求的支持：

- 私有 CA；
- mTLS；
- 头部认证；
- Resource / Prompt utility 按需开放。

### 5.4 变更配置后如何生效

Hermes 官方文档中给出的方式是：

```text
/reload-mcp
```

这会触发已有连接关闭并按新配置重连。对于长驻 gateway 来说，这是非常必要的运维能力。

---

## 六、MCP 工具调用链路：从模型决策到远端执行

前面我们解决了“工具如何进入工具池”，这一节看“工具如何被真正调用”。

### 6.1 顶层调度：handle_function_call()

Hermes 的工具总入口是 `model_tools.py` 里的 `handle_function_call()`：

```python
def handle_function_call(function_name, function_args, ...):
    function_args = coerce_tool_args(function_name, function_args)
    ...
    result = registry.dispatch(function_name, function_args, ...)
```

这说明：

- 无论工具是内置还是 MCP；
- 最终都走统一 dispatch。

因此上层 Agent loop 可以保持纯粹：

1. 模型输出 tool call；
2. Hermes 根据 name + args 做调用；
3. 结果再塞回上下文。

而不用关心工具底层传输细节。

### 6.2 MCP handler：同步接口包装异步 RPC

MCP tool 的 handler 是 `_make_tool_handler()` 返回的闭包。

它首先从 `_servers` 找到对应 server：

```python
with _lock:
    server = _servers.get(server_name)
if not server or not server.session:
    return json.dumps({"error": f"MCP server '{server_name}' is not connected"})
```

然后定义真正的异步调用：

```python
async def _call():
    async with server._rpc_lock:
        result = await server.session.call_tool(tool_name, arguments=args)
```

再通过 `_run_on_mcp_loop()` 丢到后台 event loop 执行。

这是 Hermes 里一个非常重要的桥接模式：

- 上层 registry.dispatch 是同步语义；
- MCP 底层是 async session；
- 通过后台专用 loop + `run_coroutine_threadsafe`，把异步执行安全地包成同步工具接口。

### 6.3 为什么每个 server 都有 `_rpc_lock`

源码里写得很清楚：

- 某些 stdio session 本质上是单条 JSON-RPC 流；
- 如果同时发多个 request，可能会打乱序列或把流卡死；
- 因此 Hermes 对每个 server 加了 `_rpc_lock`，序列化 client-initiated RPC。

甚至 HTTP transport 也统一用了这把锁，属于一种保守但稳健的做法。

如果你是做 Agent 的，我会非常建议认真吸收这个经验：

> **不要因为“协议上看起来支持并发”就默认把所有调用并发化。**

真实世界里，SDK、server 实现、stdio 封装、下游依赖，都会成为并发问题来源。

### 6.4 工具结果如何回传给模型

Hermes 对 MCP tool result 做了内容归一化：

- `TextContent` 合并成文本；
- `ImageContent` 会缓存为 Hermes 自己的 `MEDIA:<path>` 标签；
- `structuredContent` 会与文本一起打包成 JSON 返回。

这说明 Hermes 不是简单 `str(result)`，而是在做协议到 Agent 结果语义的转换。

尤其图片内容这一点很值得肯定。很多实现只支持 text block，结果遇到 screenshot / browser / design 类工具时，模型拿到空结果。Hermes 明显把这类真实使用场景考虑进去了。

---

## 七、prompt injection 检测与防护机制：Hermes 做了什么，为什么这样做

说完能力和传输，终于来到最关键的一节：安全。

MCP 最大的安全误区之一，是很多人把它当成“一个更标准的工具协议”，却忽视了：

> **MCP server 返回的工具描述、prompt、resource，本质上都是外部输入。**

而外部输入只要能进模型上下文，就可能变成 prompt injection 载体。

Hermes 在这方面做了两层防护：

1. **MCP 工具描述扫描**：对工具元信息做提示注入风险检测；
2. **cron 组装 prompt 扫描**：对最终组装后的执行 prompt 做更严格检测。

---

### 7.1 MCP 工具描述扫描：轻量告警，不默认阻断

在 `tools/mcp_tool.py` 中，Hermes定义了一组 `_MCP_INJECTION_PATTERNS`：

```python
_MCP_INJECTION_PATTERNS = [
    (re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I),
     "prompt override attempt ('ignore previous instructions')"),
    (re.compile(r"you\s+are\s+now\s+a", re.I),
     "identity override attempt ('you are now a...')"),
    (re.compile(r"system\s*:\s*", re.I),
     "system prompt injection attempt"),
    (re.compile(r"<\s*(system|human|assistant)\s*>", re.I),
     "role tag injection attempt"),
    ...
]
```

注册工具时会执行：

```python
_scan_mcp_description(name, mcp_tool.name, mcp_tool.description or "")
```

命中后只会 warning：

```python
logger.warning(
    "MCP server '%s' tool '%s': suspicious description content — %s. Description: %.200s",
    server_name, tool_name, "; ".join(findings), description,
)
```

这里的设计取舍非常合理。

为什么不直接 block？因为：

- 工具描述里提到 `system:`、`curl`、`eval`，未必就是恶意；
- 某些安全分析、代码审计、运维工具，本来就会描述这些内容；
- 如果默认阻断，误报成本很高，用户会觉得“这玩意不能用”。

所以 Hermes 的策略是：

- 对 MCP tool description 做**告警级扫描**；
- 把风险暴露给运维日志；
- 但不因为元描述可疑就直接切断能力。

这是一个很成熟的安全工程思路：**先监控、先审计、先可观测，再根据业务场景决定是否升级为强阻断。**

---

### 7.2 为什么 cron 场景必须更严格

Hermes 在 `cron/scheduler.py` 中引入了 `CronPromptInjectionBlocked` 异常，并在注释中明确说明了背景：

- create/update 时只扫描了用户输入的 prompt；
- 但 skill 内容是在运行时从磁盘加载的；
- 如果 skill markdown 中带有恶意注入内容，它会直接进入 cron agent 的最终 prompt；
- 而 cron 运行是 **non-interactive / auto-approve** 的。

这意味着风险远高于 CLI 人工交互：

- 没有人在现场二次确认；
- 工具调用可能自动批准；
- 一旦被注入，破坏面更大。

所以 Hermes 对 cron 的 assembled prompt 做了更强扫描。

### 7.3 组装后扫描，而不是只扫输入片段

这是 Hermes 做得非常对的一点。

问题的根源往往不在某个孤立片段，而在于：

- 用户 prompt + skill 模板 + 系统提示 + 附加上下文，拼装后才形成危险语义；
- 单独扫描某个字段，很容易漏掉“拼接后成句”的攻击载荷。

Hermes 在 `_build_job_prompt()` 之后会调用：

```python
return _scan_assembled_cron_prompt("\n".join(parts), job, has_skills=True)
```

在 `_scan_assembled_cron_prompt()` 中，根据是否带 skill 使用不同扫描器：

- `has_skills=False`：更严格的 `_scan_cron_prompt`
- `has_skills=True`：更宽松的 `_scan_cron_skill_assembled`

这是因为 skill markdown 里可能合法地讨论安全命令、攻击样例、系统角色等内容。如果依然用最严格规则，误报会很多。

也就是说，Hermes 在这里并不是“一刀切”做安全，而是根据 **上下文来源** 调整策略强度。

### 7.4 阻断后的处理方式

如果命中规则，会抛出：

```python
raise CronPromptInjectionBlocked(scan_error)
```

而 `run_job()` 会捕获它，并把本次 cron run 标记为 BLOCKED，而不是让 scheduler 崩掉。

这又体现了一个非常成熟的工程原则：

> **安全策略触发，不应当导致系统异常崩溃，而应当导致业务动作被拒绝并可审计。**

也就是说：

- 安全事件要有明确状态；
- 要有 operator 可理解的原因；
- 要便于后续审计 offending skill 或配置。

这比单纯抛异常强太多了。

---

## 八、Hermes 的 MCP 安全最佳实践：不仅是 injection 检测

安全从来不是单一规则，而是多层防线。综合 Hermes 源码，可以总结出一套很有参考价值的 MCP 安全实践。

### 8.1 最小权限：只开放需要的工具

在 `mcp-config-reference.md` 中，Hermes 明确支持：

- `tools.include`
- `tools.exclude`
- `tools.resources`
- `tools.prompts`

例如：

```yaml
tools:
  include: [create_issue, list_issues]
  resources: false
  prompts: false
```

这很重要。因为 MCP server 提供了什么，并不意味着 Agent 就应该全量暴露给模型。

**建议：默认白名单，谨慎黑名单。**

因为黑名单意味着新增工具默认可见，而白名单意味着新增工具默认不可见。

### 8.2 最小信息暴露：stdio 环境变量白名单

Hermes 的 `_build_safe_env()` 是非常值得抄作业的一段实现。

不要把父进程所有 env 直接透给 stdio MCP server。

推荐原则：

- 只透传 PATH、HOME、LANG 这类运行必需变量；
- 业务密钥按 server 逐个显式配置；
- 不要因为“懒得写 env”就把整个当前进程环境透过去。

### 8.3 错误信息脱敏

Hermes 定义了 `_CREDENTIAL_PATTERN`，会对这些模式脱敏：

- `ghp_...`
- `sk-...`
- `Bearer ...`
- `token=...`
- `API_KEY=...`
- `password=...`
- `secret=...`

并在 `_sanitize_error()` 中统一替换成 `[REDACTED]`。

这一步的意义是：

- 某些 MCP server 异常信息会把 header、URL 参数或命令行带出来；
- 如果你把原始错误直接回传给模型，相当于把秘密喂给了模型上下文；
- 这不仅危险，还可能污染日志和会话存档。

所以，**对面向模型的任何错误消息，都应该视为“外发消息”做脱敏。**

### 8.4 capability-aware utility registration

Hermes 不会盲目注册 `list_resources/read_resource/list_prompts/get_prompt` 四个 utility。

它会先看 `initialize_result.capabilities`：

- server 若没声明 `resources` capability，就不注册资源工具；
- 没声明 `prompts` capability，就不注册 prompt 工具。

这能避免两个问题：

1. 模型看到“其实不能用”的假工具；
2. 每次调用都收到 `method not found`，误以为 server 挂了。

从安全角度看，这也是**缩小攻击面**的一部分。

### 8.5 动态变更可观测

Hermes 对 `tools/list_changed` 的处理不仅刷新工具，还输出 warning 日志，提示：

```text
Verify these changes are expected.
```

对于生产环境，这很重要。动态能力变化本身就应该被看作“可能影响安全边界的配置变化”。

### 8.6 对自动化运行场景做更严策略

CLI 与 cron 不应使用同样宽松的信任模型。

Hermes 在 cron 场景上采取更严格 assembled prompt 扫描，这一点非常值得借鉴。

如果你的 Agent 也支持：

- 定时任务
- webhook 自动执行
- 无人值守工作流

那么请一定把它们视为**高风险执行面**，比交互式会话更严格地做输入审计。

---

## 九、踩坑记录：从源码里能看出的那些“血泪教训”

读 Hermes 的 MCP 代码，一个很明显的感受是：很多实现细节都不是“教科书式设计”，而是**真实线上问题反推出来的修复**。这部分尤其值得总结。

### 9.1 坑一：stdio server 启动日志把 TUI 打花

症状：

- 用户一打开 Hermes，MCP server banner、JSON log、warning 直接刷到终端；
- prompt_toolkit / Rich 界面被破坏；
- 看起来像 CLI 卡住了。

解决：

- stdio 子进程 stderr 不直接连 TTY；
- 重定向到统一日志文件 `mcp-stderr.log`；
- 启动前写 session marker，便于定位。

经验：

> 只要你在 TUI/CLI 中嵌外部长生命周期子进程，就要第一时间设计 stdout/stderr 去向。

### 9.2 坑二：SSE read timeout 误设成 tool timeout

症状：

- SSE server 一段时间不发事件后连接自动断掉；
- 表面看像服务不稳定，实际上只是 read timeout 太短。

解决：

- 区分 `connect_timeout` 和 `sse_read_timeout`；
- SSE 流空闲不代表异常，read timeout 必须更长。

经验：

> 面向流的协议，超时语义一定要单独建模。

### 9.3 坑三：通知里同步 refresh 把 stdio JSON-RPC 流卡死

症状：

- 某些 server 在 initialize 后立刻发 `tools/list_changed`；
- 如果 handler 里直接再发 `list_tools`，会与别的 in-flight RPC 打架；
- 后续工具调用开始超时。

解决：

- 通知 handler 只做调度；
- 真正 refresh 放后台 task；
- 并用 `_refresh_lock` 和 `_rpc_lock` 做串行保护。

经验：

> 回调里不要做重 RPC；通知处理器最好“快进快出”。

### 9.4 坑四：工具 utility 虚假注册，模型误判 server 坏了

症状：

- 某些 server 只支持 `tools`，不支持 `resources/prompts`；
- 但客户端还是注册了 `list_resources/get_prompt`；
- 模型一调用就收到 `-32601 Method not found`；
- 最终模型以为整个 MCP server 不可靠。

解决：

- 基于 `initialize_result.capabilities` 做 capability-aware registration。

经验：

> 工具暴露给模型之前，必须和真实 server capability 对齐。

### 9.5 坑五：错误信息把 token 带回模型

症状：

- 上游服务返回 401/500 时，异常里可能带 Bearer token、API key、URL query；
- 如果原样塞回 tool result，就造成凭证泄漏。

解决：

- `_sanitize_error()` 统一脱敏；
- `_format_connect_error()` 只输出有限、可操作的信息。

经验：

> 给模型看的 error message，本质上是外发内容，必须像面向用户日志一样做脱敏。

### 9.6 坑六：session 过期和 auth 失效不是一回事

源码里专门有 `_handle_session_expired_and_retry()`，区别于 OAuth 401 恢复。

这说明 Hermes 已经遇到过这样的现实问题：

- access token 还有效；
- 但 server 端 session 状态没了；
- 此时不需要重新授权，只需要重建 transport/session。

经验：

> 认证状态、连接状态、会话状态三者不能混为一谈。

### 9.7 坑七：restricted session 被 tool_search 桥接绕过

虽然这不只属于 MCP，但 `handle_function_call()` 中对桥接工具的防御说明了 Hermes 在权限边界上的谨慎：

- 即使 `tool_call` bridge 能看到全局 registry；
- 最终还要再检查 underlying tool 是否属于当前 session 被授权的 toolset。

经验：

> 任何“工具桥接”“工具搜索”“二次分发”层，都要做 defense in depth。

---

## 十、Hermes MCP 集成中的源码亮点：值得借鉴的设计模式

如果从架构设计模式角度总结，Hermes 这套实现里有几个特别值得借鉴的点。

### 10.1 统一注册中心模式

所有工具最终都进同一个 `registry`，而不是分成：

- built-in registry
- plugin registry
- MCP registry

这样做的好处是：

- 上层 schema 组装简单；
- dispatch 简单；
- 权限控制和工具集过滤可统一处理；
- observability、hook、post-processing 也可以统一。

### 10.2 外部能力“内部化”模式

Hermes 没有让模型“感知 MCP 协议”，而是把 MCP server 转换成 Hermes 原生工具。

这是非常标准的 anti-corruption layer 思想：

- 外部系统有自己的协议和语义；
- 内部核心域只接受自己的统一抽象；
- 适配复杂性封装在边界层。

### 10.3 单独后台事件循环模式

MCP 连接不和主 Agent loop 共用混乱的线程状态，而是有自己的后台 event loop 线程。

这使得：

- 长连接管理更清晰；
- 重连/keepalive 不会阻塞主逻辑；
- 同步工具 dispatch 也能优雅桥接 async session。

### 10.4 渐进安全策略模式

Hermes 对安全不是“一律拦截”，而是分层：

- MCP description：warning
- cron assembled prompt：hard block
- 错误脱敏：默认开启
- env 过滤：默认开启
- capability-aware 暴露：默认开启

这是一种非常实战的安全落地方式。因为太强硬的安全策略，在很多产品里最后会被用户要求“全关掉”；而渐进式策略更容易长期保留。

### 10.5 失败隔离与幂等重试

不管是：

- 多 server 并行连接；
- 某个 server 失败不影响其他；
- 已连接 server 幂等跳过；
- 初次连接与后续重连分开计数；
- circuit breaker 防止模型 90 次空转重试；

这些都说明 Hermes 把 MCP 当成“脆弱外部依赖”来看待，而不是“总会成功的本地函数”。

这才是对外部系统集成应有的尊重。

---

## 十一、如果你也要为自己的 Agent 集成 MCP，我建议这样做

读完 Hermes 的实现，如果让我给出一份“自己做 Agent 集成 MCP 的落地建议清单”，我会列下面这些。

### 11.1 架构建议

1. **一定要做统一工具抽象层**，不要让上层模型直接感知各种 transport/client 差异。
2. **MCP 连接做成长生命周期对象**，不要每次 tool call 重连。
3. **工具名必须前缀化**，避免与内置工具冲突。
4. **registry 要支持动态注册/反注册**，否则 tools/list_changed 无法优雅实现。
5. **transport 和 session 分层**，方便以后扩展新的传输方式。

### 11.2 安全建议

1. 对 MCP tool description 做扫描和审计。
2. 对自动化运行场景做组装后 prompt 扫描。
3. stdio 子进程环境变量按白名单透传。
4. 错误信息一律脱敏后再给模型。
5. 资源、prompt、工具都尽量按 capability 和白名单暴露。
6. 动态变更一定要留下审计日志。

### 11.3 运维建议

1. 记录每个 server 的 transport、连接状态、工具数。
2. 把 stdio stderr 收敛到独立日志文件。
3. 区分 connect timeout、read timeout、tool timeout。
4. 做 circuit breaker，防止模型在 server 挂掉时疯狂空转。
5. 为 session 过期与 auth 失效设计不同恢复路径。
6. 支持 reload/reconnect，而不是只能重启整个 Agent。

---

## 十二、总结：Hermes 的价值，不是“支持 MCP”，而是“把 MCP 做成可生产化能力”

回到文章开头的问题：为什么要专门讨论 Hermes 的 MCP 集成架构？

因为真正困难的，从来都不是“连上一个 MCP server 并调用一次工具”。

真正困难的是：

- 如何把外部能力稳定地纳入 Agent 的统一工具系统；
- 如何在 stdio / SSE / HTTP 三种传输差异中维持一致抽象；
- 如何支持动态工具变化，而不把在线会话搞坏；
- 如何把 prompt injection 风险控制在可接受范围；
- 如何让这套系统在 CLI、gateway、cron、API server 中都跑得住。

Hermes 给出的答案，可以概括成一句话：

> **用统一 registry 做能力归一化，用独立 server task 管理连接生命周期，用渐进式安全策略守住边界。**

这背后体现出来的，不只是 MCP 协议支持，而是完整的 Agent 工程思维：

- 对协议边界有敬畏；
- 对外部依赖有戒心；
- 对用户体验有打磨；
- 对安全问题不天真；
- 对动态系统的一致性和可观测性有追求。

如果你正在做自己的 AI Agent，或者准备在现有系统中引入 MCP，我非常建议你不要只关注“工具能不能跑通”，而是把下面三个问题放到最前面：

1. **我的工具发现机制能不能承受动态变化？**
2. **我的传输层选型是否和部署方式、超时模型相匹配？**
3. **我的安全边界，是不是只停留在“相信 server 不会作恶”？**

Hermes 的实现给我们的启发恰恰是：

- 工具接入要面向长期演进；
- 连接管理要面向真实故障；
- 安全设计要面向最坏情况；
- 而最终对模型暴露的接口，应该尽量保持简单、统一、稳定。

这才是一个生产级 Agent 集成 MCP 时，真正应该追求的形态。

---

## 附录：文中提到的关键源码位置

为了便于你进一步对照源码阅读，我把本文最关键的文件位置列出来：

- `tools/registry.py`
  - `discover_builtin_tools()`
  - `registry.register()`
  - `registry.deregister()`
  - `registry.dispatch()`
- `tools/mcp_tool.py`
  - `discover_mcp_tools()`
  - `register_mcp_servers()`
  - `MCPServerTask`
  - `_run_http()`
  - `_run_stdio()`
  - `_refresh_tools()`
  - `_register_server_tools()`
  - `_scan_mcp_description()`
- `model_tools.py`
  - `handle_function_call()`
- `cron/scheduler.py`
  - `CronPromptInjectionBlocked`
  - `_build_job_prompt()`
  - `_scan_assembled_cron_prompt()`

如果你准备继续深入，我建议下一步重点读两条链路：

1. **启动链路**：`discover_builtin_tools()` → `discover_mcp_tools()` → `register_mcp_servers()`
2. **调用链路**：`handle_function_call()` → `registry.dispatch()` → `_make_tool_handler()` → `server.session.call_tool()`

把这两条链路读通，Hermes 的 MCP 集成架构基本就真正掌握了。

## 相关阅读

- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源-AI-Agent-框架选型对比/)
- [Hermes ProviderProfile 架构深度剖析：模型提供者的声明式注册与运行时钩子机制](/categories/架构/Hermes-ProviderProfile-架构深度剖析-模型提供者的声明式注册与运行时钩子机制/)
- [Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点](/categories/架构/Hermes-插件系统深度剖析-PluginContext-注册-tool-CLI-slash-command-扩展点/)
- [OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比](/categories/架构/OpenHuman-vs-Hermes-vs-OpenClaw-三大开源AI-Agent框架深度对比/)