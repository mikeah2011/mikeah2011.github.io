---
title: Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点
date: 2026-06-02 12:00:00
tags: [Hermes, AI Agent, 插件系统, PluginContext, 扩展点]
categories: [ai]
description: "深度剖析 Hermes AI Agent 框架的插件系统架构，从 PluginContext 注册机制到三大扩展点（tool/CLI/slash command）的完整实现原理。手把手演示自定义 Tool 插件开发、CLI 命令注册、Slash Command 定义的全流程，详解插件的生命周期管理、依赖注入、配置热更新与错误处理机制。对比 Skills 层与 Plugins 层的设计差异，涵盖插件打包发布、单元测试策略、性能影响分析，附 5 个生产级插件示例代码与架构图，帮助开发者全面掌握 Hermes 插件系统的扩展能力。"
cover: /images/covers/hermes-plugin-system-cover.jpg
---

# Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点

## 引言

一个好的 AI Agent 框架，不仅要能开箱即用，更要能深度定制。而插件系统，正是决定框架定制能力上限的关键组件。

在 Hermes 的设计哲学中，插件系统承载着一个核心使命：**让任何人都能扩展 Agent 的能力边界，而不需要修改框架核心代码**。无论是添加一个新的工具、注册一个 CLI 命令、还是定义一个斜杠命令，都应该通过插件系统完成。

本文将深入 Hermes 的插件系统，从 PluginContext 的注册机制、三大扩展点（tool/CLI/slash command）的实现原理，到插件的完整开发生命周期，带你全面理解这套精巧的扩展体系。

## 一、插件架构总览

### 1.1 插件系统的层次结构

Hermes 的插件系统分为两个层次：

```
┌─────────────────────────────────────────────────────────┐
│                    Skills Layer (上层)                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Skills = 轻量级 prompt 指令 + 配置                  ││
│  │  不涉及代码，用户通过 YAML/Markdown 定义              ││
│  │  适用于：行为定制、指令模板、工作流定义               ││
│  └─────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│                   Plugins Layer (下层)                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Plugins = 代码级扩展，通过 PluginContext 注册        ││
│  │  支持 Python/Node.js，可调用系统 API                  ││
│  │  适用于：新工具、CLI 命令、斜杠命令、外部服务集成     ││
│  └─────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│                   Agent Core (核心)                       │
│  ┌─────────────────────────────────────────────────────┐│
│  │  对话引擎、模型调度、记忆系统、安全层                 ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 1.2 插件生命周期

```
Discovery → Registration → Initialization → Active → Shutdown
    │            │              │            │          │
    │            │              │            │          │
    ▼            ▼              ▼            ▼          ▼
 扫描目录    读取manifest    调用register() 等待调用  清理资源
 加载manifest 注册到Registry  注册扩展点    处理请求  释放连接
```

### 1.3 插件目录结构

```
~/.hermes/plugins/
├── my-custom-tool/
│   ├── plugin.yaml          # 插件清单（必选）
│   ├── __init__.py          # Python 入口（Python 插件）
│   ├── requirements.txt     # 依赖声明（可选）
│   └── tests/               # 测试（可选）
│       └── test_my_tool.py
├── slack-notifier/
│   ├── plugin.yaml
│   ├── index.js             # Node.js 入口（Node 插件）
│   └── package.json
└── database-query/
    ├── plugin.yaml
    ├── adapter.py
    └── templates/
        └── queries.sql
```

## 二、PluginContext 核心机制

### 2.1 PluginContext 的角色

PluginContext 是插件与 Hermes 核心之间的桥梁。当一个插件被加载时，Hermes 会创建一个 PluginContext 实例并传递给插件的 `register()` 函数。插件通过这个上下文对象注册自己的扩展能力。

```python
# 插件的入口函数签名
def register(ctx: PluginContext) -> None:
    """
    Called when the plugin is loaded.
    Use ctx to register tools, commands, hooks, etc.
    """
    pass
```

### 2.2 PluginContext 定义

```python
# hermes/plugin/context.py
from typing import Callable, Any
from hermes.plugin.types import (
    ToolDefinition, ToolHandler,
    CliCommand, CliHandler,
    SlashCommand, SlashHandler,
    HookType, HookHandler
)

class PluginContext:
    """
    The bridge between a plugin and the Hermes core.
    
    Provides methods to register:
    - Tools: Functions the LLM can call
    - CLI Commands: Terminal commands the user can run
    - Slash Commands: Chat commands starting with /
    - Hooks: Event listeners for lifecycle events
    """
    
    def __init__(self, plugin_name: str, plugin_config: dict, 
                 agent_core: 'AgentCore'):
        self.plugin_name = plugin_name
        self.config = plugin_config
        self._core = agent_core
        self._registrations = {
            "tools": [],
            "cli_commands": [],
            "slash_commands": [],
            "hooks": [],
        }
    
    # ===== Tool Registration =====
    
    def register_tool(self, definition: ToolDefinition, 
                      handler: ToolHandler) -> None:
        """
        Register a tool that the LLM can call.
        
        Args:
            definition: Tool metadata (name, description, parameters)
            handler: Async function that executes the tool
        """
        self._registrations["tools"].append((definition, handler))
        self._core.tool_registry.register(
            self.plugin_name, definition, handler
        )
    
    # ===== CLI Command Registration =====
    
    def register_cli_command(self, name: str, handler: CliHandler,
                             description: str = "",
                             usage: str = "") -> None:
        """
        Register a CLI command.
        
        Args:
            name: Command name (e.g., "hermes-deploy")
            handler: Function that handles the command
            description: Short description
            usage: Usage example
        """
        cmd = CliCommand(
            name=f"hermes-{name}" if not name.startswith("hermes-") else name,
            handler=handler,
            description=description,
            usage=usage,
            plugin=self.plugin_name
        )
        self._registrations["cli_commands"].append(cmd)
        self._core.cli_registry.register(cmd)
    
    # ===== Slash Command Registration =====
    
    def register_slash_command(self, name: str, handler: SlashHandler,
                               description: str = "",
                               usage: str = "") -> None:
        """
        Register a slash command for use in chat.
        
        Args:
            name: Command name with / prefix (e.g., "/deploy")
            handler: Function that handles the command
            description: Short description for help text
            usage: Usage example
        """
        if not name.startswith("/"):
            name = f"/{name}"
        
        cmd = SlashCommand(
            name=name,
            handler=handler,
            description=description,
            usage=usage,
            plugin=self.plugin_name
        )
        self._registrations["slash_commands"].append(cmd)
        self._core.slash_registry.register(cmd)
    
    # ===== Hook Registration =====
    
    def register_hook(self, event: HookType, handler: HookHandler,
                      priority: int = 0) -> None:
        """
        Register a lifecycle hook.
        
        Args:
            event: The event to listen for
            handler: Async function to call when event fires
            priority: Higher priority runs first
        """
        self._core.hook_registry.register(event, handler, priority)
    
    # ===== Utility Methods =====
    
    def get_config(self, key: str = None, default: Any = None) -> Any:
        """Get plugin configuration value."""
        if key is None:
            return self.config
        return self.config.get(key, default)
    
    def get_memory(self) -> 'PluginMemory':
        """Get plugin-specific memory store."""
        return self._core.memory.get_plugin_memory(self.plugin_name)
    
    async def emit(self, event: str, data: dict) -> None:
        """Emit a custom event for other plugins to listen to."""
        await self._core.event_bus.emit(f"plugin.{self.plugin_name}.{event}", data)
    
    @property
    def logger(self):
        """Get plugin-specific logger."""
        return logging.getLogger(f"hermes.plugin.{self.plugin_name}")
```

### 2.3 Plugin Registration 流程

```python
# hermes/plugin/loader.py
class PluginLoader:
    """Discovers and loads plugins."""
    
    def __init__(self, core: 'AgentCore'):
        self.core = core
        self.loaded_plugins: dict[str, PluginContext] = {}
    
    async def load_all(self):
        """Load all plugins from standard directories."""
        # 1. Bundled plugins
        bundled_dir = os.path.join(HERMES_ROOT, "plugins", "bundled")
        await self._load_from_directory(bundled_dir)
        
        # 2. User plugins
        user_dir = os.path.expanduser("~/.hermes/plugins")
        if os.path.exists(user_dir):
            await self._load_from_directory(user_dir)
        
        # 3. Profile plugins
        profile_dir = os.path.join(
            os.path.expanduser("~/.hermes/profiles"),
            self.core.profile_name, "plugins"
        )
        if os.path.exists(profile_dir):
            await self._load_from_directory(profile_dir)
    
    async def _load_from_directory(self, directory: str):
        """Load plugins from a directory."""
        for entry in os.scandir(directory):
            if not entry.is_dir():
                continue
            
            manifest_path = os.path.join(entry.path, "plugin.yaml")
            if not os.path.exists(manifest_path):
                continue
            
            try:
                await self._load_plugin(entry.path, manifest_path)
            except Exception as e:
                logger.error(f"Failed to load plugin {entry.name}: {e}")
    
    async def _load_plugin(self, plugin_dir: str, manifest_path: str):
        """Load a single plugin."""
        # 1. Read manifest
        with open(manifest_path) as f:
            manifest = yaml.safe_load(f)
        
        plugin_name = manifest["name"]
        logger.info(f"Loading plugin: {plugin_name}")
        
        # 2. Check dependencies
        for dep in manifest.get("dependencies", []):
            if dep not in self.loaded_plugins:
                raise PluginDependencyError(
                    f"Plugin {plugin_name} requires {dep}, which is not loaded"
                )
        
        # 3. Install dependencies if needed
        req_file = os.path.join(plugin_dir, "requirements.txt")
        if os.path.exists(req_file):
            await self._install_requirements(req_file, plugin_name)
        
        # 4. Import plugin module
        init_path = os.path.join(plugin_dir, "__init__.py")
        if os.path.exists(init_path):
            spec = importlib.util.spec_from_file_location(
                f"hermes_plugin_{plugin_name}", init_path
            )
        else:
            # Try adapter.py as fallback
            adapter_path = os.path.join(plugin_dir, "adapter.py")
            if os.path.exists(adapter_path):
                spec = importlib.util.spec_from_file_location(
                    f"hermes_plugin_{plugin_name}", adapter_path
                )
            else:
                raise PluginLoadError(f"No entry point found for {plugin_name}")
        
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # 5. Get register function
        if not hasattr(module, "register"):
            raise PluginLoadError(
                f"Plugin {plugin_name} has no register() function"
            )
        
        # 6. Create context and register
        config = self._resolve_config(manifest)
        ctx = PluginContext(plugin_name, config, self.core)
        
        await module.register(ctx)
        
        self.loaded_plugins[plugin_name] = ctx
        logger.info(f"Plugin {plugin_name} loaded successfully")
    
    async def _install_requirements(self, req_file: str, plugin_name: str):
        """Install plugin Python dependencies in isolated venv."""
        venv_dir = os.path.expanduser(
            f"~/.hermes/plugin_venvs/{plugin_name}"
        )
        
        if not os.path.exists(venv_dir):
            # Create virtual environment
            await asyncio.create_subprocess_exec(
                sys.executable, "-m", "venv", venv_dir
            )
        
        pip = os.path.join(venv_dir, "bin", "pip")
        
        # Install requirements
        proc = await asyncio.create_subprocess_exec(
            pip, "install", "-r", req_file,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            raise PluginDependencyError(
                f"Failed to install dependencies for {plugin_name}: {stderr.decode()}"
            )
```

## 三、Tool 扩展点详解

### 3.1 Tool 的定义

在 Hermes 中，Tool 是 LLM 可以调用的函数。每个 Tool 包含：

1. **元数据**（ToolDefinition）：名称、描述、参数定义
2. **处理器**（ToolHandler）：实际执行逻辑

```python
# Tool 类型定义
@dataclass
class ToolDefinition:
    name: str                           # 唯一标识，如 "read_file"
    description: str                    # LLM 可理解的描述
    parameters: dict                    # JSON Schema 格式的参数定义
    dangerous: bool = False             # 是否需要用户确认
    sandbox: bool = True                # 是否在沙箱中执行
    timeout: int = 30                   # 执行超时（秒）
    requires_approval: bool = False     # 是否需要审批

# Tool 处理器签名
ToolHandler = Callable[[dict], Awaitable[dict]]
```

### 3.2 注册一个 Tool

```python
# plugin: file-manager
from hermes.plugin.context import PluginContext
from hermes.plugin.types import ToolDefinition

async def register(ctx: PluginContext):
    """Register file management tools."""
    
    # Tool 1: 读取文件
    ctx.register_tool(
        definition=ToolDefinition(
            name="read_file",
            description="Read the contents of a file. Returns the file content as text.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file"
                    },
                    "encoding": {
                        "type": "string",
                        "default": "utf-8",
                        "description": "File encoding"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Line number to start reading from (1-indexed)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of lines to read"
                    }
                },
                "required": ["path"]
            },
            sandbox=True,
            timeout=10
        ),
        handler=handle_read_file
    )
    
    # Tool 2: 写入文件
    ctx.register_tool(
        definition=ToolDefinition(
            name="write_file",
            description="Write content to a file. Creates parent directories if needed. "
                        "OVERWRITES the entire file — use patch for targeted edits.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write"
                    }
                },
                "required": ["path", "content"]
            },
            dangerous=True,  # 写入文件是危险操作
            sandbox=True,
            requires_approval=False  # 文件写入不需要审批
        ),
        handler=handle_write_file
    )
    
    # Tool 3: 搜索文件
    ctx.register_tool(
        definition=ToolDefinition(
            name="search_files",
            description="Search file contents or find files by name. "
                        "Use target='content' for grep, target='files' for glob.",
            parameters={
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex or glob pattern"
                    },
                    "target": {
                        "type": "string",
                        "enum": ["content", "files"],
                        "default": "content"
                    },
                    "path": {
                        "type": "string",
                        "default": ".",
                        "description": "Directory to search in"
                    },
                    "limit": {
                        "type": "integer",
                        "default": 50
                    }
                },
                "required": ["pattern"]
            },
            sandbox=True
        ),
        handler=handle_search_files
    )

async def handle_read_file(params: dict) -> dict:
    """Handle read_file tool call."""
    path = params["path"]
    encoding = params.get("encoding", "utf-8")
    offset = params.get("offset", 1)
    limit = params.get("limit", 500)
    
    # Security check
    if not is_safe_path(path):
        return {"error": f"Access denied: {path}"}
    
    try:
        with open(path, encoding=encoding) as f:
            lines = f.readlines()
        
        selected = lines[offset-1 : offset-1+limit]
        content = "".join(
            f"{offset + i}|{line}" for i, line in enumerate(selected)
        )
        
        return {
            "content": content,
            "total_lines": len(lines),
            "showing": f"{offset}-{min(offset+limit-1, len(lines))}"
        }
    except FileNotFoundError:
        return {"error": f"File not found: {path}"}
    except Exception as e:
        return {"error": str(e)}

async def handle_write_file(params: dict) -> dict:
    """Handle write_file tool call."""
    path = params["path"]
    content = params["content"]
    
    if not is_safe_path(path):
        return {"error": f"Access denied: {path}"}
    
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        
        return {
            "success": True,
            "path": path,
            "bytes_written": len(content.encode())
        }
    except Exception as e:
        return {"error": str(e)}

async def handle_search_files(params: dict) -> dict:
    """Handle search_files tool call."""
    # ... implementation using ripgrep
    pass

def is_safe_path(path: str) -> bool:
    """Check if the path is safe to access."""
    real_path = os.path.realpath(path)
    forbidden = ["/etc/shadow", "/etc/passwd", "/root/.ssh"]
    return not any(real_path.startswith(f) for f in forbidden)
```

### 3.3 Tool 调用链路

当 LLM 决定调用一个工具时，完整的调用链路如下：

```
LLM Response: tool_call(name="read_file", args={path: "/tmp/test.txt"})
     │
     ▼
┌──────────────────────────┐
│ 1. Tool Call Parser      │  解析 LLM 返回的工具调用
│    → 提取 name 和 args   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 2. Tool Registry Lookup  │  查找注册的工具
│    name → (definition,   │
│            handler)      │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 3. Security Check        │  安全检查
│    - 权限检查             │
│    - 参数验证             │
│    - 沙箱决策             │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 4. Approval (if needed)  │  用户审批（可选）
│    - dangerous=true      │
│    - requires_approval   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 5. Execution             │  执行工具
│    - 沙箱内 or 直接执行   │
│    - 超时控制             │
│    - 结果收集             │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 6. Result Processing     │  处理结果
│    - 格式化               │
│    - 大小限制             │
│    - 注入回对话上下文     │
└──────────────────────────┘
```

### 3.4 沙箱执行

对于标记为 `sandbox=True` 的工具，Hermes 会在沙箱中执行：

```python
class ToolSandbox:
    """Sandbox for executing tools safely."""
    
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.temp_dir = tempfile.mkdtemp(prefix="hermes_sandbox_")
    
    async def execute(self, handler: ToolHandler, params: dict) -> dict:
        """Execute a tool handler in a sandboxed environment."""
        try:
            # Set resource limits
            result = await asyncio.wait_for(
                handler(params),
                timeout=self.timeout
            )
            
            # Validate result size
            result_str = json.dumps(result)
            if len(result_str) > 1_000_000:  # 1MB limit
                return {
                    "error": "Result too large",
                    "truncated": result_str[:10000] + "...(truncated)"
                }
            
            return result
            
        except asyncio.TimeoutError:
            return {"error": f"Tool execution timed out after {self.timeout}s"}
        except Exception as e:
            return {"error": f"Tool execution failed: {str(e)}"}
    
    def cleanup(self):
        """Clean up sandbox resources."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
```

## 四、CLI 扩展点详解

### 4.1 CLI 命令的作用

CLI 命令让用户可以在终端中直接使用插件提供的功能，而不需要进入 Hermes 的对话模式。例如：

```bash
# 内置 CLI 命令
hermes chat              # 启动对话
hermes config set ...    # 修改配置
hermes init              # 初始化

# 插件注册的 CLI 命令
hermes-deploy production # 部署插件
hermes-db migrate        # 数据库插件
hermes-test coverage     # 测试插件
```

### 4.2 注册 CLI 命令

```python
# plugin: deploy-assistant
import argparse
import asyncio
from hermes.plugin.context import PluginContext

async def register(ctx: PluginContext):
    """Register deployment CLI commands."""
    
    ctx.register_cli_command(
        name="deploy",
        handler=handle_deploy,
        description="Deploy application to specified environment",
        usage="""
Usage: hermes-deploy [options] [environment]

Environments:
  staging     Deploy to staging
  production  Deploy to production
  
Options:
  --tag TAG       Git tag to deploy (default: latest)
  --dry-run       Show what would be deployed without doing it
  --rollback      Rollback to previous version
  --force         Skip confirmation prompt
        """
    )

async def handle_deploy(args: list[str]) -> int:
    """Handle the deploy CLI command."""
    parser = argparse.ArgumentParser(
        prog="hermes-deploy",
        description="Deploy application"
    )
    parser.add_argument("environment", nargs="?", default="staging",
                       choices=["staging", "production"])
    parser.add_argument("--tag", help="Git tag to deploy")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--force", action="store_true")
    
    try:
        parsed = parser.parse_args(args)
    except SystemExit as e:
        return e.code
    
    if parsed.rollback:
        return await rollback(parsed.environment, parsed.force)
    
    # Validate
    if parsed.environment == "production" and not parsed.force:
        confirm = input("Deploy to PRODUCTION? [y/N] ")
        if confirm.lower() != "y":
            print("Aborted.")
            return 1
    
    # Deploy
    if parsed.dry_run:
        print(f"[DRY RUN] Would deploy {parsed.tag or 'latest'} to {parsed.environment}")
        return 0
    
    print(f"Deploying {parsed.tag or 'latest'} to {parsed.environment}...")
    
    try:
        result = await run_deployment(parsed.environment, parsed.tag)
        print(f"✅ Deployment successful!")
        print(f"   Version: {result['version']}")
        print(f"   URL: {result['url']}")
        return 0
    except DeploymentError as e:
        print(f"❌ Deployment failed: {e}")
        return 1
```

### 4.3 CLI 命令的发现机制

Hermes 使用 entry_points 机制让系统发现插件注册的 CLI 命令：

```python
# hermes/cli/discovery.py
class CliDiscovery:
    """Discovers and registers CLI commands from plugins."""
    
    def __init__(self):
        self.commands: dict[str, CliCommand] = {}
    
    def discover(self):
        """Discover CLI commands from all sources."""
        # 1. Built-in commands
        self._register_builtins()
        
        # 2. Plugin commands (from PluginContext registrations)
        # These are registered during plugin loading
        
        # 3. PATH-based discovery
        # Look for hermes-* executables in PATH
        for path_dir in os.environ.get("PATH", "").split(":"):
            if not os.path.isdir(path_dir):
                continue
            for entry in os.scandir(path_dir):
                if entry.name.startswith("hermes-") and entry.is_file():
                    self._register_path_command(entry)
    
    def dispatch(self, command: str, args: list[str]) -> int:
        """Dispatch a CLI command."""
        if command in self.commands:
            cmd = self.commands[command]
            return asyncio.run(cmd.handler(args))
        else:
            print(f"Unknown command: {command}")
            self._show_help()
            return 1
    
    def _show_help(self):
        """Show available commands."""
        print("Available commands:")
        for name, cmd in sorted(self.commands.items()):
            print(f"  {name:20s} {cmd.description}")
```

## 五、Slash Command 扩展点详解

### 5.1 Slash Command 的作用

Slash Command 是在 Hermes 对话模式中使用的命令，以 `/` 开头。它们提供了不通过 LLM 就能执行的操作：

```
用户: /help                    → 显示帮助
用户: /model claude-opus       → 切换模型
用户: /deploy staging          → 触发部署
用户: /db query "SELECT ..."   → 执行数据库查询
用户: /clear                   → 清除上下文
```

### 5.2 注册 Slash Command

```python
# plugin: db-tools
from hermes.plugin.context import PluginContext

async def register(ctx: PluginContext):
    """Register database slash commands."""
    
    ctx.register_slash_command(
        name="/db",
        handler=handle_db_command,
        description="Database operations",
        usage="/db <subcommand> [args]\n"
              "  /db query <sql>       Execute a query\n"
              "  /db tables            List tables\n"
              "  /db schema <table>    Show table schema\n"
              "  /db explain <sql>     Explain a query"
    )
    
    ctx.register_slash_command(
        name="/cache",
        handler=handle_cache_command,
        description="Cache operations",
        usage="/cache <subcommand>\n"
              "  /cache stats     Show cache statistics\n"
              "  /cache clear     Clear all cache\n"
              "  /cache key <k>   Show cache value for key"
    )

async def handle_db_command(args: str, ctx: PluginContext) -> str:
    """Handle /db slash command."""
    parts = args.strip().split(maxsplit=1)
    if not parts:
        return "Usage: /db <query|tables|schema|explain> [args]"
    
    subcommand = parts[0].lower()
    subargs = parts[1] if len(parts) > 1 else ""
    
    db = ctx.get_config("connection_string")
    
    if subcommand == "query":
        if not subargs:
            return "Usage: /db query <SQL>"
        
        # Security: only allow SELECT
        if not subargs.strip().upper().startswith("SELECT"):
            return "❌ Only SELECT queries are allowed via slash command"
        
        result = await execute_query(db, subargs)
        return format_query_result(result)
    
    elif subcommand == "tables":
        result = await execute_query(db, 
            "SELECT table_name, table_rows, data_length "
            "FROM information_schema.tables "
            "WHERE table_schema = DATABASE()")
        return format_query_result(result)
    
    elif subcommand == "schema":
        if not subargs:
            return "Usage: /db schema <table_name>"
        result = await execute_query(db,
            f"DESCRIBE {subargs}")
        return format_query_result(result)
    
    elif subcommand == "explain":
        if not subargs:
            return "Usage: /db explain <SQL>"
        result = await execute_query(db, f"EXPLAIN {subargs}")
        return format_query_result(result)
    
    else:
        return f"Unknown subcommand: {subcommand}"
```

### 5.3 Slash Command 的执行流程

```
用户输入: /db query "SELECT COUNT(*) FROM users"
     │
     ▼
┌──────────────────────────┐
│ 1. Input Router          │  识别 / 前缀
│    → 检测为 slash command│
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 2. Command Parser        │  解析命令和参数
│    cmd = "/db"           │
│    args = 'query "SELECT │
│    COUNT(*) FROM users"' │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 3. Slash Registry Lookup │  查找处理器
│    → handle_db_command   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 4. Execute Handler       │  执行处理器
│    → 解析子命令           │
│    → 执行数据库查询       │
│    → 格式化结果           │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 5. Output                │  输出结果
│    → 直接显示（不经过LLM）│
└──────────────────────────┘
```

关键设计决策：**Slash Command 的结果不经过 LLM 处理**。这是有意为之——Slash Command 应该是确定性的、快速的、不需要 AI 解释的。

## 六、Hooks 扩展点

### 6.1 Hook 类型

Hermes 定义了以下 Hook 类型：

```python
class HookType(Enum):
    # 生命周期
    AGENT_START = "agent.start"
    AGENT_STOP = "agent.stop"
    
    # 对话
    BEFORE_CHAT = "chat.before"
    AFTER_CHAT = "chat.after"
    ON_ERROR = "chat.error"
    
    # 工具
    BEFORE_TOOL_CALL = "tool.before"
    AFTER_TOOL_CALL = "tool.after"
    ON_TOOL_ERROR = "tool.error"
    
    # LLM
    BEFORE_LLM_CALL = "llm.before"
    AFTER_LLM_CALL = "llm.after"
    
    # 同步
    BEFORE_SYNC = "sync.before"
    AFTER_SYNC = "sync.after"
```

### 6.2 使用 Hook

```python
# plugin: analytics
from hermes.plugin.context import PluginContext
from hermes.plugin.types import HookType

async def register(ctx: PluginContext):
    """Register analytics hooks."""
    
    ctx.register_hook(HookType.AFTER_CHAT, track_conversation)
    ctx.register_hook(HookType.AFTER_TOOL_CALL, track_tool_usage)
    ctx.register_hook(HookType.ON_ERROR, track_errors)

async def track_conversation(data: dict):
    """Track conversation metrics."""
    analytics.track("conversation", {
        "user_message_length": len(data["user_message"]),
        "response_length": len(data["response"]),
        "model": data["model"],
        "tools_used": data.get("tools_used", []),
        "duration_ms": data["duration_ms"],
        "token_usage": data.get("usage", {})
    })

async def track_tool_usage(data: dict):
    """Track tool usage metrics."""
    analytics.track("tool_usage", {
        "tool_name": data["tool_name"],
        "duration_ms": data["duration_ms"],
        "success": data.get("error") is None,
        "result_size": len(str(data.get("result", "")))
    })
```

## 七、完整实战：开发一个 Slack 通知插件

### 7.1 需求

开发一个 Slack 通知插件，支持：
- Tool：LLM 可以调用发送 Slack 消息
- CLI：用户可以在终端发送消息
- Slash Command：用户可以在对话中发送消息
- Hook：部署完成后自动通知

### 7.2 完整代码

```yaml
# ~/.hermes/plugins/slack-notifier/plugin.yaml
name: slack-notifier
version: 1.0.0
description: Slack notification integration for Hermes
author: Michael

dependencies: []

config_schema:
  type: object
  properties:
    webhook_url:
      type: string
      description: Slack incoming webhook URL
      env_var: SLACK_WEBHOOK_URL
      required: true
    default_channel:
      type: string
      default: "#general"
    bot_name:
      type: string
      default: "Hermes Agent"
    bot_emoji:
      type: string
      default: ":robot_face:"

capabilities:
  - tool
  - cli
  - slash_command
  - hooks
```

```python
# ~/.hermes/plugins/slack-notifier/__init__.py
import httpx
import json
from hermes.plugin.context import PluginContext
from hermes.plugin.types import ToolDefinition, HookType

async def register(ctx: PluginContext):
    """Register all Slack notification features."""
    
    webhook_url = ctx.get_config("webhook_url")
    if not webhook_url:
        ctx.logger.warning("Slack webhook URL not configured, plugin disabled")
        return
    
    default_channel = ctx.get_config("default_channel", "#general")
    bot_name = ctx.get_config("bot_name", "Hermes Agent")
    bot_emoji = ctx.get_config("bot_emoji", ":robot_face:")
    
    client = SlackClient(webhook_url, bot_name, bot_emoji)
    
    # 1. Register Tool
    ctx.register_tool(
        definition=ToolDefinition(
            name="send_slack_message",
            description="Send a message to a Slack channel. "
                        "Use this to notify the team about important events.",
            parameters={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message text (supports Slack mrkdwn format)"
                    },
                    "channel": {
                        "type": "string",
                        "description": "Channel name (e.g., #engineering)",
                        "default": default_channel
                    },
                    "thread_ts": {
                        "type": "string",
                        "description": "Thread timestamp to reply in thread"
                    }
                },
                "required": ["message"]
            }
        ),
        handler=lambda params: client.send(
            params["message"],
            channel=params.get("channel", default_channel),
            thread_ts=params.get("thread_ts")
        )
    )
    
    # 2. Register CLI Command
    ctx.register_cli_command(
        name="slack",
        handler=lambda args: handle_slack_cli(args, client, default_channel),
        description="Send a Slack message",
        usage="hermes-slack [-c CHANNEL] message..."
    )
    
    # 3. Register Slash Command
    ctx.register_slash_command(
        name="/slack",
        handler=lambda args, **kw: handle_slack_slash(args, client, default_channel),
        description="Send a Slack message",
        usage="/slack [#channel] message"
    )
    
    # 4. Register Hooks
    ctx.register_hook(HookType.AFTER_CHAT, 
        lambda data: maybe_notify(data, client, ctx))
    
    ctx.logger.info("Slack notifier plugin registered successfully")


class SlackClient:
    """Simple Slack webhook client."""
    
    def __init__(self, webhook_url: str, bot_name: str, bot_emoji: str):
        self.webhook_url = webhook_url
        self.bot_name = bot_name
        self.bot_emoji = bot_emoji
        self.client = httpx.AsyncClient(timeout=10)
    
    async def send(self, message: str, channel: str = None,
                   thread_ts: str = None) -> dict:
        """Send a message via Slack webhook."""
        payload = {
            "text": message,
            "username": self.bot_name,
            "icon_emoji": self.bot_emoji,
        }
        
        if channel:
            payload["channel"] = channel
        if thread_ts:
            payload["thread_ts"] = thread_ts
        
        try:
            response = await self.client.post(
                self.webhook_url,
                json=payload
            )
            
            if response.status_code == 200:
                return {"success": True, "channel": channel}
            else:
                return {"error": f"Slack API error: {response.status_code}"}
        except Exception as e:
            return {"error": f"Failed to send: {str(e)}"}


async def handle_slack_cli(args: list[str], client: SlackClient, 
                           default_channel: str) -> int:
    """Handle hermes-slack CLI command."""
    import argparse
    
    parser = argparse.ArgumentParser(prog="hermes-slack")
    parser.add_argument("-c", "--channel", default=default_channel)
    parser.add_argument("message", nargs="+")
    
    parsed = parser.parse_args(args)
    message = " ".join(parsed.message)
    
    result = await client.send(message, channel=parsed.channel)
    
    if "error" in result:
        print(f"❌ {result['error']}")
        return 1
    
    print(f"✅ Message sent to {parsed.channel}")
    return 0


async def handle_slack_slash(args: str, client: SlackClient,
                             default_channel: str) -> str:
    """Handle /slack slash command."""
    parts = args.strip().split(maxsplit=1)
    
    if not parts:
        return "Usage: /slack [#channel] message"
    
    channel = default_channel
    message = args
    
    if parts[0].startswith("#"):
        channel = parts[0]
        message = parts[1] if len(parts) > 1 else ""
    
    if not message:
        return "Usage: /slack [#channel] message"
    
    result = await client.send(message, channel=channel)
    
    if "error" in result:
        return f"❌ {result['error']}"
    
    return f"✅ Sent to {channel}"


async def maybe_notify(data: dict, client: SlackClient, ctx: PluginContext):
    """Conditionally notify on certain events."""
    # Notify on deployment keywords
    response = data.get("response", "")
    if any(kw in response.lower() for kw in ["deployed", "deployment successful", "上线完成"]):
        await client.send(
            f"🚀 Deployment detected:\n>{response[:500]}",
            channel="#deployments"
        )
```

## 八、与 LangChain/LlamaIndex 的对比

| 维度 | Hermes Plugins | LangChain Tools | LlamaIndex Tools |
|------|---------------|-----------------|------------------|
| 注册方式 | PluginContext.register_tool() | @tool 装饰器 | FunctionTool.from_defaults() |
| CLI 扩展 | ✅ 原生支持 | ❌ 不支持 | ❌ 不支持 |
| Slash Command | ✅ 原生支持 | ❌ 不支持 | ❌ 不支持 |
| 生命周期 Hook | ✅ 丰富 | ❌ 不支持 | ❌ 不支持 |
| 沙箱执行 | ✅ 内置 | ❌ 需自行实现 | ❌ 需自行实现 |
| 依赖隔离 | ✅ 独立 venv | ❌ 共享环境 | ❌ 共享环境 |
| 插件发现 | ✅ 目录扫描 | ❌ 手动导入 | ❌ 手动导入 |
| 配置管理 | ✅ 层叠配置 | ⚠️ 简单 | ⚠️ 简单 |

Hermes 的插件系统在功能丰富度上明显领先，但这也带来了更高的学习成本。对于简单的工具集成，LangChain 的 `@tool` 装饰器更加简洁。选择取决于你的需求复杂度。

## 总结

Hermes 的插件系统通过 PluginContext 这个统一的注册接口，将 Tool、CLI Command、Slash Command、Hook 四大扩展点整合在一起：

- **Tool 扩展点**：让 LLM 能调用新的能力
- **CLI 扩展点**：让终端用户能使用新的命令
- **Slash Command 扩展点**：让对话用户能执行快速操作
- **Hook 扩展点**：让插件能监听和响应生命周期事件

这套设计的核心理念是：**扩展应该是声明式的、隔离的、安全的**。开发者只需要声明"我能做什么"，Hermes 负责"什么时候做"和"怎么做"。

---

*本文基于 Hermes 插件系统的源码分析撰写。更多开发指南请参考官方文档。*

## 相关阅读

- [Hermes 模型发现机制：Bundled Plugins、用户覆盖与懒加载](/categories/AI/hermes-model-discovery-bundled-plugins-user-overrides-lazy-loading/)
- [OpenHuman vs Hermes vs OpenClaw：2026 年主流 AI Agent 框架对比](/categories/AI/2026-06-02-openhuman-vs-hermes-vs-openclaw-ai-agent-framework-comparison/)
- [AI Agent 记忆系统对比：Hermes vs OpenClaw vs OpenHuman](/categories/AI/ai-agent-memory-system-hermes-vs-openclaw-vs-openhuman/)
