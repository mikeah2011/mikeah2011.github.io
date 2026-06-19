---
title: Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？
date: 2026-06-02 00:00:00
author: Michael
tags: [Hermes, Skill, Plugin, 扩展机制, AI Agent]
keywords: [Hermes Skill vs Plugin, Skill, Plugin, 扩展点对比, 什么时候用, 架构]
categories: [architecture]
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 全面对比 Hermes Agent 的 Skill 与 Plugin 两种扩展机制，从设计理念、能力边界到适用场景逐一剖析。提供清晰的决策框架：什么时候用 Skill 改变 Agent 思维方式，什么时候用 Plugin 扩展行动能力，以及如何组合使用两者实现最佳扩展效果，附带实际代码示例与最佳实践。
---


# Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？

## 前言

Hermes Agent 提供了两种主要的扩展机制：**Skill（技能）** 和 **Plugin（插件）**。很多用户在开始自定义 Hermes 时都会面临一个困惑：我应该创建一个 Skill 还是一个 Plugin？

这两种机制看似相似——都是用来扩展 Agent 的能力——但在设计理念、能力边界、适用场景上有本质区别。本文将从多个维度深入对比这两种扩展点，并提供一个清晰的决策框架。

---

## 第一章：核心概念对比

### 1.1 Skill 是什么？

Skill 在 Hermes 中是一个 **Markdown 文件**，其核心作用是：

- **注入上下文**：为 Agent 提供特定领域的知识和行为指导
- **约束行为**：定义 Agent 在特定场景下应该如何行动
- **提供参考**：包含代码示例、最佳实践、常见问题解答

```markdown
---
name: laravel-expert
triggers:
  - "Laravel"
  - "artisan"
  - "Eloquent"
tools:
  - terminal
  - file
---

You are a Laravel expert. When working with Laravel projects:

## Code Style
- Follow PSR-12 coding standards
- Use strict types declaration
- Prefer constructor injection

## Database
- Always use migrations for schema changes
- Use Eloquent ORM, avoid raw queries
- Implement repository pattern for complex queries

## Testing
- Write feature tests for all API endpoints
- Use factories for test data
- Mock external services
```

**关键特征**：
- 纯文本，无代码执行能力
- 通过 `triggers` 自动激活
- 声明式（告诉 Agent "做什么"）
- 不需要安装或编译

### 1.2 Plugin 是什么？

Plugin 在 Hermes 中是一个 **可执行程序**（通常是 Python 模块），其核心作用是：

- **扩展工具**：为 Agent 提供新的工具能力
- **集成外部系统**：连接 API、数据库、消息队列等
- **执行复杂逻辑**：处理需要编程的场景

```python
# ~/.hermes/plugins/weather_plugin.py

from hermes.plugin import Plugin, PluginContext

class WeatherPlugin(Plugin):
    """天气查询插件"""
    
    name = "weather"
    description = "查询指定城市的天气信息"
    
    def register_tools(self, context: PluginContext):
        context.register_tool(
            name="weather_query",
            description="查询指定城市的当前天气",
            parameters={
                "city": {"type": "string", "description": "城市名称"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius"}
            },
            handler=self.query_weather
        )
    
    async def query_weather(self, city: str, unit: str = "celsius") -> dict:
        # 调用天气 API
        response = await self.http_client.get(
            f"https://api.weather.com/v1/current?city={city}&unit={unit}"
        )
        return {
            "city": city,
            "temperature": response.json()["temp"],
            "condition": response.json()["condition"],
            "humidity": response.json()["humidity"]
        }
```

**关键特征**：
- 可执行代码，有完整的编程能力
- 通过 `register_tools` 注册新工具
- 命令式（告诉系统"怎么做"）
- 需要安装和初始化

---

## 第二章：能力边界对比

### 2.1 功能矩阵

| 能力 | Skill | Plugin |
|------|-------|--------|
| 注入系统提示词 | ✅ 核心能力 | ❌ 不支持 |
| 约束 Agent 行为 | ✅ 核心能力 | ❌ 不支持 |
| 提供知识参考 | ✅ 核心能力 | ⚠️ 有限支持 |
| 注册新工具 | ❌ 不支持 | ✅ 核心能力 |
| 调用外部 API | ❌ 不支持 | ✅ 核心能力 |
| 执行数据库查询 | ❌ 不支持 | ✅ 核心能力 |
| 监听事件 | ❌ 不支持 | ✅ 核心能力 |
| 自动触发 | ✅ 基于 triggers | ⚠️ 基于事件 |
| 用户可编辑 | ✅ 直接编辑 Markdown | ⚠️ 需要编程能力 |
| 版本管理 | ✅ Skills Hub | ⚠️ 手动管理 |
| 安全审计 | ✅ Quarantine 机制 | ⚠️ 代码审查 |

### 2.2 上下文注入 vs 工具扩展

这是 Skill 和 Plugin 最本质的区别：

**Skill 改变 Agent 的"思维方式"**：

```markdown
# Skill: security-reviewer
When reviewing code, always check for:
1. SQL injection vulnerabilities
2. XSS attack vectors
3. CSRF token validation
4. Authentication bypass possibilities

For each finding, provide:
- Severity level (Critical/High/Medium/Low)
- Code location
- Remediation suggestion
```

这个 Skill 不提供任何新工具，但它改变了 Agent 在做代码审查时的行为模式。

**Plugin 扩展 Agent 的"行动能力"**：

```python
class DatabasePlugin(Plugin):
    """数据库操作插件"""
    
    def register_tools(self, context: PluginContext):
        context.register_tool(
            name="db_query",
            description="执行 SQL 查询",
            parameters={
                "sql": {"type": "string"},
                "database": {"type": "string"}
            },
            handler=self.execute_query
        )
```

这个 Plugin 给 Agent 提供了直接执行 SQL 查询的能力——这是 Agent 本身不具备的。

### 2.3 触发机制对比

**Skill 的触发**：基于文本匹配

```yaml
triggers:
  - "Laravel"          # 精确匹配
  - "/artisan\s+/"     # 正则匹配
  - "Eloquent ORM"     # 短语匹配
```

当用户的消息或上下文中包含这些触发词时，Skill 自动加载。

**Plugin 的触发**：基于事件或显式调用

```python
class NotificationPlugin(Plugin):
    async def on_event(self, event):
        """监听事件触发"""
        if event.type == "deployment_complete":
            await self.send_notification(event.data)
    
    # 或者通过注册的工具被 Agent 显式调用
    # Agent 决定何时使用工具
```

---

## 第三章：生命周期对比

### 3.1 Skill 的生命周期

```
创建 → 注册 → 触发 → 加载 → 注入上下文 → 卸载
  │      │      │      │         │          │
  ▼      ▼      ▼      ▼         ▼          ▼
Markdown 写入   匹配   读取    拼接到     从上下文
文件     skills/ 触发词  文件    系统提示    中移除
```

Skill 的生命周期非常轻量：

1. **创建**：写一个 Markdown 文件
2. **注册**：放到 `skills/` 目录
3. **触发**：上下文中出现触发词
4. **加载**：读取文件内容
5. **注入**：将内容拼接到系统提示
6. **卸载**：对话结束后从上下文移除

### 3.2 Plugin 的生命周期

```
安装 → 初始化 → 注册工具 → 监听事件 → 处理请求 → 清理
  │      │         │          │          │         │
  ▼      ▼         ▼          ▼          ▼         ▼
pip    实例化    调用       事件发生    工具被     释放
install Plugin   register_  时回调     Agent调用  资源
       类       tools()    on_event() handler()
```

Plugin 的生命周期更复杂：

1. **安装**：安装依赖包
2. **初始化**：实例化 Plugin 类
3. **注册工具**：调用 `register_tools()` 方法
4. **监听事件**：注册事件处理器
5. **处理请求**：响应 Agent 的工具调用
6. **清理**：释放连接、关闭文件等

### 3.3 错误处理对比

**Skill 的错误处理**：几乎不会出错

```markdown
# Skill 文件本身就是纯文本
# 最坏的情况：文件损坏或格式错误
# 后果：Agent 无法读取该 Skill，但不影响其他功能
```

**Plugin 的错误处理**：需要精心设计

```python
class MyPlugin(Plugin):
    async def risky_operation(self, params):
        try:
            result = await external_api_call(params)
            return {"success": True, "data": result}
        except ConnectionError:
            return {"success": False, "error": "API 连接失败"}
        except TimeoutError:
            return {"success": False, "error": "请求超时"}
        except Exception as e:
            # 记录日志，但不崩溃
            logger.error(f"Plugin error: {e}")
            return {"success": False, "error": "内部错误"}
```

---

## 第四章：注册与配置对比

### 4.1 Skill 的注册

Skill 的注册极其简单——把文件放到正确的位置：

```
~/.hermes/skills/my-skill.md
```

或者在 frontmatter 中声明元数据：

```markdown
---
name: my-skill
version: 1.0.0
author: Michael
triggers:
  - "关键词1"
  - "关键词2"
tools:
  - terminal
  - file
categories:
  - development
  - backend
---
```

### 4.2 Plugin 的注册

Plugin 的注册需要编写 Python 代码：

```python
# ~/.hermes/plugins/my_plugin.py

from hermes.plugin import Plugin, PluginContext
from hermes.plugin.types import ToolDefinition

class MyPlugin(Plugin):
    name = "my_plugin"
    version = "1.0.0"
    description = "我的自定义插件"
    author = "Michael"
    
    # 声明依赖
    requirements = [
        "requests>=2.28.0",
        "aiohttp>=3.8.0"
    ]
    
    # 声明配置项
    config_schema = {
        "api_key": {"type": "string", "required": True},
        "base_url": {"type": "string", "default": "https://api.example.com"},
        "timeout": {"type": "integer", "default": 30}
    }
    
    async def initialize(self, context: PluginContext):
        """插件初始化"""
        self.config = context.get_config(self.name)
        self.http_client = aiohttp.ClientSession(
            base_url=self.config["base_url"],
            timeout=aiohttp.ClientTimeout(total=self.config["timeout"])
        )
    
    def register_tools(self, context: PluginContext):
        """注册工具"""
        context.register_tool(ToolDefinition(
            name="my_tool",
            description="工具描述",
            parameters={...},
            handler=self.my_handler,
            requires_approval=True  # 需要用户确认
        ))
    
    def register_events(self, context: PluginContext):
        """注册事件监听"""
        context.on("session_start", self.on_session_start)
        context.on("tool_call", self.on_tool_call)
    
    async def cleanup(self):
        """清理资源"""
        await self.http_client.close()
```

### 4.3 配置管理对比

**Skill 配置**：通过 frontmatter

```markdown
---
name: deploy-helper
settings:
  default_env: production
  notify_slack: true
  auto_rollback: true
---
```

**Plugin 配置**：通过配置文件或环境变量

```yaml
# ~/.hermes/plugins.yaml
my_plugin:
  api_key: ${MY_API_KEY}  # 从环境变量读取
  base_url: "https://api.example.com"
  timeout: 30
  retry_count: 3
```

---

## 第五章：实际场景对比

### 5.1 场景一：Laravel 开发助手

**需求**：让 Agent 在 Laravel 项目中表现得像一个资深 Laravel 开发者。

**使用 Skill**：

```markdown
---
name: laravel-expert
triggers:
  - "Laravel"
  - "artisan"
  - "Eloquent"
  - "blade"
---

You are a senior Laravel developer with 10 years of experience.

## Code Style
- Always use strict types: `declare(strict_types=1);`
- Follow PSR-12 coding standards
- Use constructor injection for dependencies

## Architecture Patterns
- Use Repository Pattern for complex queries
- Implement Service Layer for business logic
- Use Form Request for validation
- Use API Resources for response transformation

## Common Commands
```bash
php artisan make:model Post -mcr  # Model + Migration + Controller
php artisan make:request StorePostRequest
php artisan db:seed --class=PostSeeder
```
```

**结论**：✅ 使用 Skill。这纯粹是行为指导，不需要新工具。

### 5.2 场景二：数据库查询工具

**需求**：让 Agent 能够直接查询数据库。

**使用 Plugin**：

```python
class DatabasePlugin(Plugin):
    def register_tools(self, context: PluginContext):
        context.register_tool(ToolDefinition(
            name="db_query",
            description="执行 SQL 查询并返回结果",
            parameters={
                "sql": {"type": "string", "description": "SQL 查询语句"},
                "database": {"type": "string", "default": "default"}
            },
            handler=self.execute_query,
            requires_approval=True  # SQL 查询需要用户确认
        ))
    
    async def execute_query(self, sql: str, database: str = "default"):
        conn = await self.get_connection(database)
        try:
            result = await conn.execute(sql)
            return {
                "rows": result.fetchall(),
                "row_count": result.rowcount,
                "columns": result.keys()
            }
        finally:
            await conn.close()
```

**结论**：✅ 使用 Plugin。需要实际连接数据库执行查询，这是 Skill 无法做到的。

### 5.3 场景三：代码审查规范

**需求**：定义代码审查的标准和流程。

**使用 Skill**：

```markdown
---
name: code-review-checklist
triggers:
  - "代码审查"
  - "code review"
  - "PR review"
---

When performing code review, follow this checklist:

## Security
- [ ] No hardcoded credentials
- [ ] SQL injection prevention
- [ ] XSS protection
- [ ] CSRF validation

## Performance
- [ ] No N+1 queries
- [ ] Proper indexing
- [ ] Cache strategy

## Code Quality
- [ ] Single Responsibility Principle
- [ ] DRY (Don't Repeat Yourself)
- [ ] Proper error handling
- [ ] Unit test coverage
```

**结论**：✅ 使用 Skill。这是一个审查清单，是行为指导。

### 5.4 场景四：Slack 通知集成

**需求**：部署完成后自动发送 Slack 通知。

**使用 Plugin**：

```python
class SlackNotificationPlugin(Plugin):
    def register_tools(self, context: PluginContext):
        context.register_tool(ToolDefinition(
            name="send_slack_message",
            description="发送消息到 Slack 频道",
            parameters={
                "channel": {"type": "string"},
                "message": {"type": "string"},
                "attachments": {"type": "array", "items": {"type": "object"}}
            },
            handler=self.send_message
        ))
    
    def register_events(self, context: PluginContext):
        context.on("deployment_complete", self.on_deployment)
        context.on("test_failure", self.on_test_failure)
    
    async def on_deployment(self, event):
        await self.send_message(
            channel="#deployments",
            message=f"✅ Deployment complete: {event.data['version']}"
        )
```

**结论**：✅ 使用 Plugin。需要调用 Slack API，这是外部系统集成。

### 5.5 场景五：Git 工作流指导

**需求**：规范团队的 Git 提交和分支管理。

**使用 Skill**：

```markdown
---
name: git-workflow
triggers:
  - "git commit"
  - "git push"
  - "merge request"
  - "pull request"
---

Follow this Git workflow:

## Branch Naming
- feature/TICKET-123-description
- bugfix/TICKET-456-description
- hotfix/description

## Commit Messages
Format: type(scope): description

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance

Example: feat(auth): add JWT token refresh endpoint
```

**结论**：✅ 使用 Skill。这是工作流规范，是行为指导。

### 5.6 场景六：GitHub API 集成

**需求**：让 Agent 能操作 GitHub（创建 Issue、查看 PR 等）。

**使用 Plugin**：

```python
class GitHubPlugin(Plugin):
    def register_tools(self, context: PluginContext):
        context.register_tool(ToolDefinition(
            name="github_create_issue",
            description="创建 GitHub Issue",
            parameters={
                "repo": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "labels": {"type": "array", "items": {"type": "string"}}
            },
            handler=self.create_issue
        ))
        
        context.register_tool(ToolDefinition(
            name="github_list_prs",
            description="列出 Pull Requests",
            parameters={
                "repo": {"type": "string"},
                "state": {"type": "string", "enum": ["open", "closed", "all"]}
            },
            handler=self.list_prs
        ))
```

**结论**：✅ 使用 Plugin。需要调用 GitHub API。

---

## 第六章：决策框架

### 6.1 决策流程图

```
需要扩展 Hermes 的能力？
    │
    ├── 需要改变 Agent 的行为/思维方式？
    │   │
    │   ├── 是 → 使用 Skill
    │   │
    │   └── 否 → 继续判断
    │
    ├── 需要提供新的工具/API？
    │   │
    │   ├── 是 → 使用 Plugin
    │   │
    │   └── 否 → 继续判断
    │
    ├── 需要连接外部系统？
    │   │
    │   ├── 是 → 使用 Plugin
    │   │
    │   └── 否 → 继续判断
    │
    └── 需要执行复杂逻辑？
        │
        ├── 是 → 使用 Plugin
        │
        └── 否 → 使用 Skill（默认选择）
```

### 6.2 简化决策规则

如果你不想走完整的决策流程，记住这条简单规则：

> **如果可以用 Markdown 表达，用 Skill。如果需要写代码，用 Plugin。**

### 6.3 组合使用

在实际项目中，Skill 和 Plugin 经常组合使用：

```markdown
# Skill: deployment-assistant
---
name: deployment-assistant
triggers:
  - "部署"
  - "deploy"
tools:
  - terminal
  - slack_notification    # 来自 Slack Plugin
  - db_query              # 来自 Database Plugin
---

When deploying applications:

1. Run database migrations first
2. Clear application cache
3. Restart queue workers
4. Send deployment notification to Slack
5. Verify application health

Use the `slack_notification` tool to notify the team.
Use the `db_query` tool to verify database state.
```

这个 Skill 提供了部署流程的指导，但它引用的 `slack_notification` 和 `db_query` 工具来自 Plugin。

---

## 第七章：高级对比

### 7.1 性能影响

| 方面 | Skill | Plugin |
|------|-------|--------|
| 启动时间 | 无（懒加载） | 需要初始化 |
| 内存占用 | 极小（纯文本） | 取决于插件复杂度 |
| 上下文消耗 | 占用 token 额度 | 不占用（按需调用） |
| 执行开销 | 无（只是提示词） | 取决于工具实现 |

### 7.2 安全模型

**Skill 的安全边界**：

```markdown
# Skill 可以：
- 影响 Agent 的决策过程
- 建议 Agent 使用某些工具
- 提供知识和参考

# Skill 不能：
- 直接执行代码
- 访问网络
- 读写文件（除了自身）
```

**Plugin 的安全边界**：

```python
# Plugin 可以：
- 注册新工具（受工具权限控制）
- 监听和响应事件
- 访问配置数据

# Plugin 受限于：
- 工具调用需要用户确认（如果设置了 requires_approval）
- 网络访问受代理配置限制
- 文件访问受路径白名单限制
```

### 7.3 可测试性

**Skill 的测试**：

```bash
# Skill 的测试主要是内容审查
# 1. 检查 Markdown 语法
# 2. 检查触发词覆盖
# 3. 检查与已有 Skill 的冲突
hermes skill validate my-skill.md
```

**Plugin 的测试**：

```python
# Plugin 需要单元测试
import pytest
from my_plugin import MyPlugin

@pytest.fixture
def plugin():
    return MyPlugin()

@pytest.mark.asyncio
async def test_query_weather(plugin):
    result = await plugin.query_weather("Beijing")
    assert result["city"] == "Beijing"
    assert "temperature" in result

@pytest.mark.asyncio
async def test_query_weather_invalid_city(plugin):
    result = await plugin.query_weather("InvalidCity")
    assert result["success"] == False
```

### 7.4 社区分享

**Skill 的分享**：

```bash
# 分享 Skill 就是分享一个 Markdown 文件
# 可以通过 Git、Gist、Skills Hub 等方式
hermes skill share my-skill.md
```

**Plugin 的分享**：

```bash
# 分享 Plugin 需要打包和依赖管理
hermes plugin package my_plugin/
# 生成 my_plugin-1.0.0.hpkg

hermes plugin publish my_plugin-1.0.0.hpkg
```

---

## 第八章：常见误区

### 8.1 误区一：Skill 比 Plugin 简单所以更好

**事实**：简单不等于更好。选择应该基于需求，而不是复杂度。

一个设计精良的 Plugin 比一个写得差的 Skill 更有价值。

### 8.2 误区二：Plugin 能做所有 Skill 能做的事

**事实**：Plugin 无法注入系统提示词，无法改变 Agent 的思维方式。

如果你想让 Agent 在处理特定任务时遵循特定的思维框架，必须用 Skill。

### 8.3 误区三：Skill 和 Plugin 是互斥的

**事实**：它们是互补的。最佳实践是组合使用：

- Skill 定义"做什么"和"怎么做"
- Plugin 提供"用什么做"的工具

### 8.4 误区四：所有扩展都应该用 Plugin

**事实**：过度使用 Plugin 会导致系统臃肿。如果一个功能可以用 Skill 实现，就不应该用 Plugin。

---

## 第九章：最佳实践

### 9.1 Skill 设计最佳实践

```markdown
# 1. 明确的触发词
triggers:
  - "Laravel"          # 太宽泛
  - "Laravel 开发"     # 更精确
  - "artisan 命令"     # 具体场景

# 2. 结构化内容
## Section 1: 基本原则
## Section 2: 具体规则
## Section 3: 代码示例
## Section 4: 常见错误

# 3. 可操作的指导
- ❌ "写好代码"
- ✅ "每个方法不超过 20 行，参数不超过 3 个"

# 4. 版本控制
---
version: 1.2.0
changelog: |
  v1.2.0: 添加了 PHP 8.3 特性指导
  v1.1.0: 添加了测试章节
  v1.0.0: 初始版本
---
```

### 9.2 Plugin 设计最佳实践

```python
# 1. 单一职责
class GoodPlugin(Plugin):
    """只做一件事：天气查询"""
    ...

class BadPlugin(Plugin):
    """做了太多事：天气 + 股票 + 新闻"""
    ...

# 2. 错误处理
async def handler(self, params):
    try:
        result = await self.do_work(params)
        return {"success": True, "data": result}
    except SpecificError as e:
        return {"success": False, "error": str(e)}

# 3. 配置验证
config_schema = {
    "api_key": {"type": "string", "required": True},
    "timeout": {"type": "integer", "min": 1, "max": 300, "default": 30}
}

# 4. 资源清理
async def cleanup(self):
    if self.session:
        await self.session.close()
```

### 9.3 何时升级 Skill 为 Plugin

当你发现你的 Skill 开始包含以下内容时，考虑升级为 Plugin：

```markdown
# ⚠️ 这些内容表明你应该用 Plugin

## 执行这个命令
\```bash
curl -X POST https://api.example.com/endpoint \
  -H "Authorization: Bearer TOKEN" \
  -d '{"key": "value"}'
\```

## 然后解析响应
将 JSON 响应中的 data.id 字段提取出来...

## 然后用这个 ID 执行下一个命令
\```bash
curl https://api.example.com/items/{id}
\```
```

这种"教 Agent 如何一步步调用 API"的方式既脆弱又低效。正确的做法是写一个 Plugin，封装 API 调用逻辑，注册为一个工具。

---

## 总表对比

| 维度 | Skill | Plugin |
|------|-------|--------|
| **本质** | 提示词注入 | 代码扩展 |
| **文件格式** | Markdown (.md) | Python (.py) |
| **核心能力** | 改变 Agent 行为 | 扩展 Agent 工具 |
| **触发方式** | 文本匹配 | 事件/显式调用 |
| **安装方式** | 放到目录 | pip install |
| **安全模型** | 沙箱化（纯文本） | 权限控制 |
| **性能影响** | 消耗 token | 消耗计算资源 |
| **学习曲线** | 低（会写 Markdown） | 中（会写 Python） |
| **适用场景** | 行为指导、知识库 | API 集成、工具扩展 |
| **典型例子** | 代码规范、审查清单 | 数据库查询、消息通知 |

---

## 总结

选择 Skill 还是 Plugin，本质上是在回答一个问题：

> **你是在改变 Agent 的"思维方式"，还是在扩展 Agent 的"行动能力"？**

- **改变思维方式** → Skill
- **扩展行动能力** → Plugin
- **两者都需要** → 组合使用

记住这个原则，你就不会选错。

---

*本文基于 Hermes Agent v0.4.x 架构分析，相关 API 可能随版本迭代而变化。*

---

## 相关阅读

- [Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash-command 扩展点](/categories/架构/Hermes-插件系统深度剖析-PluginContext注册-tool-CLI-slash-command扩展点/)
- [Hermes 技能同步机制：bundled-skills 到 user-space 增量同步与用户修改保留策略](/categories/架构/Hermes-技能同步机制-bundled-skills-到-user-space-增量同步与用户修改保留策略/)
- [Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽与审批策略](/categories/架构/Hermes-子代理架构-leaf-vs-orchestrator-角色模型-工具屏蔽-审批策略/)
- [Hermes Skills Hub 分发架构：seed-then-fork 模型、quarantine 审计与 lock-file 溯源](/categories/架构/Hermes-Skills-Hub-分发架构-seed-then-fork-模型-quarantine-审计-lock-file-溯源/)
