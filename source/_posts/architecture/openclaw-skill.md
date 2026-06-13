---

title: OpenClaw 技能开发实战：自定义 Skill 与工作流自动化
keywords: [OpenClaw, Skill, 技能开发实战, 自定义, 与工作流自动化]
date: 2026-06-02 09:00:00
tags:
- OpenClaw
- AI Agent
- Skill开发
- 工作流
- 自动化
- Agent
description: 深入讲解 OpenClaw Skill 体系架构与开发实战，涵盖 Skill 生命周期管理、元数据契约定义、文件处理与 API 调用两大实战案例、工作流编排、参数校验、错误处理、社区共享机制与设计模式，帮助开发者从零构建可扩展的 AI Agent 能力平台。
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




# OpenClaw 技能开发实战：自定义 Skill 与工作流自动化

## 1. 引言：从硬编码到技能化——AI Agent 的可扩展之路

过去很多 AI Agent 项目在初期都采用“功能直接写进主程序”的方式推进：要访问本地文件，就在主流程里加一个 `read_file()`；要调用第三方服务，就在 Agent 的推理循环里塞一段 HTTP 请求；要做自动化处理，再补几段条件判断。这样的做法在 Demo 阶段很高效，但随着业务扩展，很快会暴露三个问题：第一，能力耦合严重，新增一个功能往往要改动核心调度逻辑；第二，团队协作困难，不同开发者在同一条主链路上频繁改代码，冲突不断；第三，能力复用差，一个“能处理 Markdown 并同步到对象存储”的能力很难被其他项目直接复用。

Skill 化，正是解决这些问题的核心思路。所谓 Skill，本质上是对 Agent 能力的模块化封装：它把某项能力的输入、输出、执行逻辑、依赖资源与元信息收敛成一个可发现、可加载、可调用、可治理的单元。这样一来，Agent 不再是一个不断堆砌 if/else 的“超级脚本”，而是一个具备调度中枢角色的系统：它理解当前任务，选择合适的 Skill，完成参数绑定、执行控制、结果汇总，再将结论反馈给用户或下游流程。

在 OpenClaw 的语境中，Skill 不只是“工具函数换了个名字”。它更像一个有生命周期管理的插件单元，具备明确的元数据描述、运行时上下文、输入输出契约、错误语义和权限边界。一个成熟的 Skill 系统，至少需要回答以下问题：Skill 从哪里被发现？如何注册到运行时？如何进行参数校验？如何隔离依赖？如何避免危险操作？如何将多个 Skill 编排成稳定工作流？如何让第三方社区贡献 Skill，同时保持质量与安全？

这也是本文的核心主题：围绕 OpenClaw Skill 体系，从架构到底层文件结构，再到两个实战案例——文件处理 Skill 与 API 调用 Skill——完整演示 Skill 开发的关键路径。同时，我们会进一步讨论参数定义、错误处理、工作流编排、社区共享、调试测试与设计模式，帮助你把“写一个 Skill”提升为“构建一套可扩展能力平台”的视角。

为了让内容更贴近工程实践，本文中的示例会采用一种偏 Python 风格的 OpenClaw Skill 组织方式。即便你的具体实现语言或运行时稍有差异，这些设计原则同样适用。你会看到：真正决定 Skill 体系上限的，不是语法细节，而是抽象边界是否清晰、契约是否稳定、治理机制是否到位。

一个简单对比可以帮助我们理解 Skill 化的价值。

```python
# 反例：功能硬编码在主流程中
class Agent:
    def handle(self, task: str):
        if "总结目录里的 markdown" in task:
            files = self.read_markdown_files("./notes")
            merged = self.merge(files)
            return self.summarize(merged)
        elif "查询天气" in task:
            resp = requests.get("https://api.example.com/weather")
            return resp.json()
        elif "上传报告" in task:
            content = open("report.md").read()
            return self.upload(content)
```

随着需求增长，这段代码会变成一个臃肿的调度中心。而 Skill 化后，主流程更像这样：

```python
class Agent:
    def handle(self, request):
        skill = self.skill_registry.resolve(request.intent)
        params = self.parameter_binder.bind(skill.schema, request)
        result = self.executor.run(skill, params, context=self.context)
        return self.response_formatter.format(result)
```

此时，Agent 核心层负责调度，真正的业务能力被下沉到独立 Skill。这样带来的收益包括：

- **能力可插拔**：新增 Skill 不必改主流程。
- **团队可并行**：不同工程师维护不同 Skill 包。
- **权限可治理**：文件读写、网络访问、系统命令可单独授权。
- **工作流可编排**：多个 Skill 可以串联成标准流程。
- **生态可扩展**：社区可以发布第三方 Skill，形成市场。

在企业场景中，这种模式尤为重要。假设你要做一个“知识库运维 Agent”：它既要读文档、调用向量索引、生成摘要，也要同步到外部系统、发送通知、记录审计日志。如果这些能力都硬编码在一个服务中，几乎不可能稳定演进；但如果把“文档扫描”“标签提取”“Embedding 写入”“Webhook 通知”“变更审计”各自做成 Skill，那么系统就会从一个项目，逐步长成一个平台。

因此，Skill 开发不只是写插件，它其实是在设计 Agent 的能力边界、职责分层与自动化骨架。理解这一点，后续你在写每一个 Skill 时，就会自然关注几个更关键的问题：这个 Skill 的职责是否足够单一？输入输出是否稳定？是否能够被其他工作流复用？错误是否对调用方友好？是否便于测试与观测？

带着这些问题，我们先从 OpenClaw Skill 系统的整体架构开始。

## 2. OpenClaw Skill 系统架构

OpenClaw 的 Skill 架构可以理解为“注册中心 + 元数据协议 + 执行容器 + 工作流编排层”的组合。它不是单纯把 Python 文件塞进某个目录，而是建立了一套能力的操作系统。要真正用好 Skill，先要理解系统中的关键角色。

一个典型的架构分层如下：

```text
┌─────────────────────────────────────┐
│             Agent Planner           │
│  负责意图识别、任务分解、Skill选择     │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│            Skill Registry           │
│  负责 discover / metadata / lookup  │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│            Skill Executor           │
│  参数绑定、上下文注入、权限校验、执行   │
└─────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌───────────────┐   ┌────────────────┐
│ Local Skills  │   │ Remote Skills  │
│ 文件、脚本、API │   │ 服务化能力、网关 │
└───────────────┘   └────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│         Workflow / Observability    │
│  编排、重试、日志、Tracing、审计      │
└─────────────────────────────────────┘
```

### 2.1 Planner：决定“何时调用什么 Skill”

Planner 是 Agent 的策略大脑，它根据用户输入、上下文状态和历史执行结果，决定是否调用 Skill、调用哪个 Skill、需要哪些参数，以及是否将复杂任务拆分为多个步骤。Planner 不必知道每个 Skill 的内部实现，但必须读取 Skill 元数据，比如：

- skill 名称与描述
- 支持的参数 schema
- 适用场景
- 副作用类型（只读 / 写入 / 网络 / 系统命令）
- 预计耗时与成本

例如，Planner 看见“请遍历 docs 目录下所有 Markdown，抽取一级标题并生成索引 JSON”，就可能选择 `file.list_markdown`、`markdown.extract_headings`、`json.write_file` 这几个 Skill 组成流程。

### 2.2 Registry：让 Skill 可发现、可检索、可治理

Registry 是 Skill 系统的目录服务。它解决的问题是：Skill 存在哪里、如何被发现、如何被注册、如何按名称或能力检索。通常 Registry 会支持多种来源：

- 本地目录扫描，如 `skills/`、`plugins/skills/`
- 包管理安装后的入口点
- 远程技能仓库或市场
- 企业内网技能中心

一个简化版注册过程如下：

```python
class SkillRegistry:
    def __init__(self):
        self._skills = {}

    def register(self, skill):
        if skill.name in self._skills:
            raise ValueError(f"duplicate skill: {skill.name}")
        self._skills[skill.name] = skill

    def get(self, name: str):
        return self._skills.get(name)

    def search(self, keyword: str):
        return [s for s in self._skills.values() if keyword in s.description]
```

在真正的 OpenClaw 运行时中，Registry 还应该承担更多职责，例如版本管理、依赖检查、来源签名验证、权限标记与启用状态控制。也就是说，Registry 不是简单的字典，而是能力治理的入口。

### 2.3 Executor：把“可描述能力”变成“可运行任务”

Skill 有了元数据，并不代表能安全执行。Executor 的职责是把一个 Skill 的声明转化为一次受控执行过程，通常包括：

1. 读取 Skill schema；
2. 将用户输入映射到参数对象；
3. 做类型校验、默认值填充与约束检查；
4. 注入运行时上下文，比如工作目录、凭据、日志器、追踪 ID；
5. 执行前做权限校验；
6. 调用 Skill 主函数；
7. 捕获异常并转换成标准错误；
8. 输出结果与审计信息。

示例：

```python
class SkillExecutor:
    def run(self, skill, params: dict, context: dict):
        validated = skill.schema.validate(params)
        self.check_permissions(skill, context)
        try:
            return skill.execute(validated, context)
        except TimeoutError as e:
            raise SkillExecutionError(skill.name, "timeout") from e
        except Exception as e:
            raise SkillExecutionError(skill.name, str(e)) from e
```

### 2.4 Skill Contract：契约先于实现

一个成熟的 Skill 系统强调“契约优先”，即先定义这个 Skill 对外提供什么能力，而不是先写内部代码。一个 Skill 的最小契约通常包含：

```yaml
name: file_processor
version: 1.0.0
description: 扫描目录中的文本文件并生成摘要报告
input_schema:
  type: object
  properties:
    root_dir:
      type: string
    pattern:
      type: string
      default: "*.md"
    recursive:
      type: boolean
      default: true
  required: [root_dir]
output_schema:
  type: object
  properties:
    total_files:
      type: integer
    output_file:
      type: string
permissions:
  - fs.read
  - fs.write
```

当 Skill 有了明确契约，Planner 才能准确选择它，Executor 才能可靠验证它，调用者也才知道如何消费结果。

### 2.5 Runtime Context：让 Skill 感知“当前世界”

Skill 很少是纯函数，它往往需要上下文。例如：

- 当前工作目录
- 用户身份 / 租户信息
- 可用凭据或密钥引用
- 本次请求 ID
- 日志与 tracing 对象
- 允许访问的路径白名单
- 网络出口策略

因此，Skill 执行签名通常不应只有 `execute(params)`，而应是：

```python
def execute(self, params: dict, context: SkillContext) -> dict:
    ...
```

一个示意性的上下文定义：

```python
from dataclasses import dataclass
from pathlib import Path

@dataclass
class SkillContext:
    request_id: str
    workspace: Path
    logger: object
    secrets: dict
    permissions: list[str]
```

### 2.6 Observability：没有可观测性，就没有生产级 Skill

在实验环境中，一个 Skill 只要“能跑通”似乎就够了。但到生产环境，没有日志、没有 trace、没有 metrics 的 Skill 基本不可维护。建议至少记录：

- skill 名称、版本、调用时间
- 调用参数摘要（注意脱敏）
- 成功 / 失败状态
- 耗时、重试次数
- 输出大小与关键结果
- 错误堆栈与错误码

例如：

```python
def execute(self, params, context):
    context.logger.info("skill_start", extra={
        "skill": self.name,
        "request_id": context.request_id,
        "params": {"root_dir": params["root_dir"]}
    })
```

### 2.7 典型调用链路

综合起来，一次 Skill 调用通常遵循如下链路：

```text
用户请求
  ↓
Planner 解析意图
  ↓
Registry 搜索候选 Skill
  ↓
Executor 校验 schema 与权限
  ↓
Skill 执行具体逻辑
  ↓
标准化返回结果
  ↓
Workflow 决定是否进入下一步
  ↓
响应用户 / 写入外部系统 / 记录审计
```

理解这一层之后，你就会明白：Skill 开发不是写孤立函数，而是在接入一个被调度、被监管、被观测的能力系统。接下来，我们继续深入到最关键的工程细节：Skill 的文件结构与生命周期。

## 3. Skill 文件结构与生命周期（discover → load → execute）

如果说架构回答了“系统有哪些角色”，那么生命周期回答的就是“一个 Skill 从磁盘上的文件，如何变成运行时中的能力”。在 OpenClaw 中，最核心的三个阶段可以概括为：**discover（发现）→ load（加载）→ execute（执行）**。这不仅是技术流程，也是 Skill 设计中最容易出问题的地方。

### 3.1 推荐的 Skill 目录结构

一个可维护的 Skill，不应该只有一个 `main.py`。建议采用如下结构：

```text
skills/
└── file_processor/
    ├── skill.yaml
    ├── __init__.py
    ├── implementation.py
    ├── schemas/
    │   ├── input.json
    │   └── output.json
    ├── templates/
    │   └── report.md.j2
    ├── tests/
    │   └── test_file_processor.py
    └── README.md
```

各部分职责如下：

- `skill.yaml`：Skill 元信息、入口、权限、依赖声明。
- `implementation.py`：核心执行逻辑。
- `schemas/`：输入输出契约。
- `templates/`：报告、Prompt、配置模板等资源。
- `tests/`：单元测试和集成测试。
- `README.md`：给团队或社区说明如何安装与使用。

一个典型 `skill.yaml` 可以写成：

```yaml
name: file_processor
version: 1.0.0
description: 扫描目录并生成文档摘要报告
entry: implementation:FileProcessorSkill
permissions:
  - fs.read
  - fs.write
capabilities:
  - markdown
  - report-generation
input_schema: schemas/input.json
output_schema: schemas/output.json
config:
  max_files: 500
  allowed_extensions: [".md", ".txt"]
```

### 3.2 Discover：Skill 是如何被发现的

Discover 阶段通常由启动器或 Registry 完成。最常见做法是扫描约定目录中的 `skill.yaml` 文件，然后收集其元数据。

示意代码如下：

```python
from pathlib import Path
import yaml

class SkillDiscovery:
    def discover(self, base_dir: str):
        skills = []
        for manifest in Path(base_dir).glob("*/skill.yaml"):
            meta = yaml.safe_load(manifest.read_text())
            meta["base_path"] = str(manifest.parent)
            skills.append(meta)
        return skills
```

实际场景中，Discover 阶段还会做这些事：

- 检查 manifest 是否完整；
- 过滤不兼容版本；
- 判断 Skill 是否被禁用；
- 从多个目录合并 Skill 来源；
- 检查是否有重名冲突；
- 读取签名或哈希，防止被篡改。

例如在企业环境中，你可能有三层来源：

```yaml
skill_sources:
  - ./skills
  - ~/.openclaw/community-skills
  - https://skill-registry.internal/api/v1/skills
```

此时 Discover 阶段不只是扫描文件，还涉及远程同步与缓存。

### 3.3 Load：从元数据到对象实例

发现 Skill 之后，下一步是把它真正加载成可调用对象。加载通常包括：

1. 读取 entry 配置；
2. 动态导入模块；
3. 初始化 Skill 类；
4. 注入 manifest、schema、配置；
5. 注册到 Registry。

例如：

```python
import importlib

class SkillLoader:
    def load(self, meta: dict):
        module_name, class_name = meta["entry"].split(":")
        module = importlib.import_module(f"skills.{meta['name']}.{module_name}")
        cls = getattr(module, class_name)
        return cls(meta)
```

一个 Skill 类可能长这样：

```python
class FileProcessorSkill:
    def __init__(self, meta: dict):
        self.meta = meta
        self.name = meta["name"]
        self.version = meta["version"]
        self.permissions = meta.get("permissions", [])

    def execute(self, params: dict, context):
        ...
```

Load 阶段的关键不是“能 import 成功”，而是要做**预检**。比如：

- schema 文件是否存在；
- 依赖包是否齐全；
- 配置项是否有效；
- 是否声明了高风险权限；
- 当前运行环境是否支持该 Skill。

一个更稳健的加载逻辑会是：

```python
class SkillLoader:
    def load(self, meta: dict):
        self.validate_manifest(meta)
        self.check_dependencies(meta)
        skill = self.instantiate(meta)
        self.validate_contract(skill)
        return skill
```

### 3.4 Execute：在受控上下文中真正运行

Execute 阶段才是 Skill 真正发挥作用的时候。很多初学者把所有逻辑都堆在 `execute()` 中，但生产级设计更推荐把它拆为几个明确步骤：

```python
class BaseSkill:
    def execute(self, params: dict, context):
        validated = self.validate_input(params)
        prepared = self.prepare(validated, context)
        result = self.run(prepared, context)
        return self.finalize(result, context)
```

这种分层有几个好处：

- `validate_input` 负责输入校验，便于复用；
- `prepare` 做资源准备，如创建临时目录、初始化客户端；
- `run` 只负责核心业务逻辑；
- `finalize` 负责结果清洗、格式化、记录输出。

### 3.5 生命周期中的钩子设计

在复杂 Skill 中，你会希望加入生命周期钩子，以实现更精细的控制。例如：

```python
class BaseSkill:
    def on_discover(self, meta):
        pass

    def on_load(self, context):
        pass

    def before_execute(self, params, context):
        pass

    def after_execute(self, result, context):
        pass

    def on_error(self, error, context):
        pass
```

这些钩子很适合处理以下场景：

- 在 `on_load` 预热连接池；
- 在 `before_execute` 做审计记录；
- 在 `after_execute` 写 metrics；
- 在 `on_error` 统一上报异常。

### 3.6 生命周期中的常见陷阱

#### 陷阱一：Discover 时执行副作用代码

一些开发者在模块顶层就写外部连接：

```python
# 不推荐
client = SomeRemoteClient(api_key=os.getenv("API_KEY"))
```

这样在 Discover 或 Load 阶段仅仅 import 模块时，就可能发起网络请求或因环境变量缺失而失败。正确做法是延迟初始化：

```python
class APISkill:
    def __init__(self, meta):
        self.meta = meta
        self.client = None

    def _get_client(self, context):
        if self.client is None:
            self.client = SomeRemoteClient(api_key=context.secrets["api_key"])
        return self.client
```

#### 陷阱二：Load 成功但契约不一致

如果 manifest 写着输出 `summary_file`，而实际 `execute()` 返回的是 `output_path`，Planner 或工作流编排器就会在运行时崩溃。因此输出 schema 也必须做验证。

#### 陷阱三：Execute 缺乏超时与取消机制

Skill 如果调用了慢速 API 或扫描超大目录，可能长期卡住。生产环境应支持超时控制与取消 token。

```python
def execute_with_timeout(skill, params, context, timeout=30):
    # 示例化伪代码
    with time_limit(timeout):
        return skill.execute(params, context)
```

### 3.7 一次完整生命周期示例

下面用一个简化流程展示 discover → load → execute：

```python
discovery = SkillDiscovery()
loader = SkillLoader()
registry = SkillRegistry()

for meta in discovery.discover("./skills"):
    skill = loader.load(meta)
    registry.register(skill)

skill = registry.get("file_processor")
result = skill.execute(
    {"root_dir": "./docs", "pattern": "*.md"},
    context=SkillContext(
        request_id="req-001",
        workspace=Path("./workspace"),
        logger=logger,
        secrets={},
        permissions=["fs.read", "fs.write"]
    )
)
```

当你理解生命周期之后，Skill 开发就不再是“写个函数让它能调用”，而是“设计一个能被发现、被验证、被安全执行、被持续维护的模块”。接下来，我们就进入真正的实战：先开发一个文件处理 Skill。

## 4. 实战：开发一个文件处理 Skill

文件处理类 Skill 是最常见的 Agent 能力之一。无论是知识库整理、日志归档、配置扫描，还是内容抽取、报告生成，都离不开本地文件系统操作。这个实战案例中，我们开发一个 `document_reporter` Skill：扫描指定目录下的 Markdown 文件，提取标题、字数、修改时间，并生成一份汇总报告。

### 4.1 需求定义

业务场景：

某个团队使用 Git 仓库存放项目文档，希望 Agent 能自动生成文档索引报告，帮助他们快速掌握目录中有哪些文档、每篇文档的主题是什么、哪些文件长期未更新。

功能要求：

- 输入一个目录路径；
- 支持递归扫描 `.md` 文件；
- 提取文件名、一级标题、字符数、最后修改时间；
- 输出为 Markdown 报告；
- 报告写入指定路径；
- 若扫描文件超出上限，提前终止并报错。

### 4.2 Manifest 与 schema 定义

先定义 `skill.yaml`：

```yaml
name: document_reporter
version: 1.0.0
description: 扫描 Markdown 文档并生成汇总报告
entry: implementation:DocumentReporterSkill
permissions:
  - fs.read
  - fs.write
input_schema: schemas/input.json
output_schema: schemas/output.json
config:
  max_files: 1000
  encoding: utf-8
```

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "root_dir": {"type": "string"},
    "output_file": {"type": "string"},
    "recursive": {"type": "boolean", "default": true},
    "pattern": {"type": "string", "default": "*.md"}
  },
  "required": ["root_dir", "output_file"]
}
```

输出 schema：

```json
{
  "type": "object",
  "properties": {
    "total_files": {"type": "integer"},
    "report_file": {"type": "string"},
    "skipped_files": {"type": "integer"}
  },
  "required": ["total_files", "report_file", "skipped_files"]
}
```

### 4.3 核心实现

下面给出一个较完整的实现示例：

```python
from pathlib import Path
from datetime import datetime

class DocumentReporterSkill:
    def __init__(self, meta: dict):
        self.meta = meta
        self.name = meta["name"]
        self.max_files = meta.get("config", {}).get("max_files", 1000)
        self.encoding = meta.get("config", {}).get("encoding", "utf-8")

    def execute(self, params: dict, context):
        root_dir = Path(params["root_dir"])
        output_file = Path(params["output_file"])
        recursive = params.get("recursive", True)
        pattern = params.get("pattern", "*.md")

        if not root_dir.exists() or not root_dir.is_dir():
            raise ValueError(f"invalid root_dir: {root_dir}")

        files = list(root_dir.rglob(pattern) if recursive else root_dir.glob(pattern))
        if len(files) > self.max_files:
            raise ValueError(f"too many files: {len(files)} > {self.max_files}")

        rows = []
        skipped = 0
        for file in files:
            try:
                content = file.read_text(encoding=self.encoding)
                title = self._extract_title(content) or file.stem
                rows.append({
                    "path": str(file.relative_to(root_dir)),
                    "title": title,
                    "chars": len(content),
                    "updated_at": datetime.fromtimestamp(file.stat().st_mtime).isoformat()
                })
            except Exception:
                skipped += 1

        report = self._render_report(root_dir, rows)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(report, encoding="utf-8")

        return {
            "total_files": len(rows),
            "report_file": str(output_file),
            "skipped_files": skipped
        }

    def _extract_title(self, content: str):
        for line in content.splitlines():
            if line.startswith("# "):
                return line[2:].strip()
        return None

    def _render_report(self, root_dir: Path, rows: list[dict]) -> str:
        lines = [
            f"# 文档汇总报告",
            "",
            f"扫描目录：`{root_dir}`",
            f"文档数量：{len(rows)}",
            "",
            "| 文件 | 标题 | 字符数 | 最后更新时间 |",
            "|---|---|---:|---|"
        ]
        for row in rows:
            lines.append(
                f"| {row['path']} | {row['title']} | {row['chars']} | {row['updated_at']} |"
            )
        return "\n".join(lines)
```

### 4.4 场景说明：知识库巡检

这个 Skill 的典型用途是知识库巡检。比如你每天凌晨自动扫描 `docs/` 目录，生成一份报告并同步到团队 Wiki 首页，让成员快速看到：

- 最近新增了哪些文档；
- 哪些文档没有标题、格式不规范；
- 哪些内容字符数极低，可能只是占位文件；
- 哪些文档长期没有更新。

如果再配合一个通知 Skill，就可以形成“扫描 → 报告 → 钉钉/Slack 提醒”的自动化链路。

### 4.5 加入白名单与安全边界

文件 Skill 最危险的问题是路径越权。用户如果传入 `/etc`、`~/.ssh` 之类目录，会触发安全风险。因此建议引入工作区白名单：

```python
class DocumentReporterSkill:
    def _ensure_in_workspace(self, path: Path, workspace: Path):
        resolved = path.resolve()
        workspace = workspace.resolve()
        if workspace not in resolved.parents and resolved != workspace:
            raise PermissionError(f"path out of workspace: {resolved}")
```

在 `execute()` 开始时调用：

```python
self._ensure_in_workspace(root_dir, context.workspace)
self._ensure_in_workspace(output_file.parent, context.workspace)
```

### 4.6 加入配置模板

如果你希望 Skill 在不同环境中灵活复用，可以把规则下沉到配置：

```yaml
config:
  max_files: 1000
  encoding: utf-8
  title_fallback: use_filename
  report_template: templates/report.md.j2
```

这样未来你可以把输出从 Markdown 替换为 HTML，甚至输出 CSV，而不必重写 Skill 主流程。

### 4.7 示例调用

```python
result = executor.run(
    skill=registry.get("document_reporter"),
    params={
        "root_dir": "/workspace/docs",
        "output_file": "/workspace/reports/docs-summary.md",
        "recursive": True
    },
    context=context
)
```

返回结果：

```json
{
  "total_files": 42,
  "report_file": "/workspace/reports/docs-summary.md",
  "skipped_files": 1
}
```

这个案例说明了一个重要原则：**Skill 的价值，不是把文件系统 API 包一层，而是把业务目标、输入契约、安全边界与结果格式一起沉淀下来。**

接下来，我们再看第二个实战：如何开发一个 API 调用 Skill。

## 5. 实战：开发一个 API 调用 Skill

如果说文件处理 Skill 解决的是本地世界，那么 API Skill 解决的就是外部世界。绝大多数企业级 Agent 都离不开 API 能力：查询工单、拉取 CRM 数据、触发 CI/CD、发送 Webhook、访问知识库、调用 LLM 服务、写入业务系统。API Skill 的关键不是“把 requests 写出来”，而是处理认证、重试、限流、错误分类和结果标准化。

本节我们开发一个 `weather_lookup` Skill。它从外部天气服务查询指定城市天气，并返回适合 Agent 后续消费的标准化结果。

### 5.1 业务需求

场景：

企业有一个办公自动化 Agent，用户会问“今天上海的天气怎么样，适合安排线下活动吗？”Agent 不仅要拿到天气数据，还要形成结构化输出供后续判断流程使用。

需求：

- 输入城市名与可选日期；
- 从远程 API 获取天气信息；
- 统一处理 API key；
- 对 4xx、5xx、超时做不同错误语义；
- 输出结构化天气对象；
- 可选缓存，减少重复调用。

### 5.2 Manifest 设计

```yaml
name: weather_lookup
version: 1.1.0
description: 查询天气 API 并返回结构化结果
entry: implementation:WeatherLookupSkill
permissions:
  - network.http
input_schema: schemas/input.json
output_schema: schemas/output.json
config:
  timeout_seconds: 10
  base_url: https://api.example.com/weather
  cache_ttl: 300
required_secrets:
  - WEATHER_API_KEY
```

输入 schema：

```json
{
  "type": "object",
  "properties": {
    "city": {"type": "string", "minLength": 1},
    "date": {"type": "string", "format": "date"}
  },
  "required": ["city"]
}
```

输出 schema：

```json
{
  "type": "object",
  "properties": {
    "city": {"type": "string"},
    "date": {"type": "string"},
    "weather": {"type": "string"},
    "temperature": {"type": "number"},
    "humidity": {"type": "number"},
    "raw": {"type": "object"}
  },
  "required": ["city", "date", "weather", "temperature"]
}
```

### 5.3 实现示例

```python
import requests
from datetime import date

class WeatherLookupSkill:
    def __init__(self, meta: dict):
        self.meta = meta
        self.base_url = meta.get("config", {}).get("base_url")
        self.timeout = meta.get("config", {}).get("timeout_seconds", 10)

    def execute(self, params: dict, context):
        city = params["city"]
        target_date = params.get("date") or date.today().isoformat()
        api_key = context.secrets.get("WEATHER_API_KEY")
        if not api_key:
            raise ValueError("missing secret: WEATHER_API_KEY")

        resp = requests.get(
            self.base_url,
            params={"city": city, "date": target_date},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=self.timeout
        )

        if resp.status_code == 404:
            raise SkillExecutionError(self.meta["name"], f"city not found: {city}")
        if 400 <= resp.status_code < 500:
            raise SkillExecutionError(self.meta["name"], f"client error: {resp.text}")
        if resp.status_code >= 500:
            raise SkillExecutionError(self.meta["name"], "upstream server error")

        data = resp.json()
        return {
            "city": data["city"],
            "date": data["date"],
            "weather": data["condition"],
            "temperature": data["temp_c"],
            "humidity": data.get("humidity"),
            "raw": data
        }
```

### 5.4 增加重试与退避

外部 API 总会有抖动，因此建议把重试做成基础能力。示例：

```python
import time
import requests

class WeatherLookupSkill:
    def _request_with_retry(self, url, **kwargs):
        retries = 3
        delay = 1
        for attempt in range(1, retries + 1):
            try:
                return requests.get(url, **kwargs)
            except requests.Timeout:
                if attempt == retries:
                    raise
                time.sleep(delay)
                delay *= 2
```

然后在 `execute()` 中替换原始请求：

```python
resp = self._request_with_retry(
    self.base_url,
    params={"city": city, "date": target_date},
    headers={"Authorization": f"Bearer {api_key}"},
    timeout=self.timeout
)
```

### 5.5 缓存策略

若同一个城市的天气在短时间内频繁查询，就没必要重复调用远程服务。你可以在 Skill 层加简单缓存：

```python
class WeatherLookupSkill:
    def __init__(self, meta):
        self.meta = meta
        self.cache = {}
        self.cache_ttl = meta.get("config", {}).get("cache_ttl", 300)

    def _cache_key(self, city, target_date):
        return f"{city}:{target_date}"
```

执行时：

```python
now = time.time()
key = self._cache_key(city, target_date)
if key in self.cache and now - self.cache[key][0] < self.cache_ttl:
    return self.cache[key][1]
```

### 5.6 结果标准化的重要性

不同天气 API 的字段命名都不同：有的叫 `temp`，有的叫 `temperature`，有的叫 `temp_celsius`。如果 Skill 直接把上游结果原样返回，调用方就必须知道每个 API 的细节。正确做法是 Skill 层统一抽象，输出稳定字段，例如：

```json
{
  "city": "Shanghai",
  "date": "2026-06-02",
  "weather": "Cloudy",
  "temperature": 26.5,
  "humidity": 0.81
}
```

这样，后续工作流中“是否适合线下活动”的判断 Skill 就不必关心上游 API 是谁。

### 5.7 实际场景：运营日报自动化

这个 Skill 往往不会单独存在，而是被嵌入业务流程中。例如：

1. 每天 8:00 调用天气 Skill；
2. 根据温度、降雨概率判断是否适合线下拍摄；
3. 生成运营建议；
4. 推送到 Slack 或飞书群。

这正是 Skill 化的优势：一个 API Skill 只专注于“拿到稳定数据”，至于如何消费，由工作流层决定。

### 5.8 API Skill 的安全边界

API Skill 特别需要注意几类风险：

- API key 不应硬编码在代码里；
- 日志不能打印敏感 header；
- 不应允许任意 URL 输入，否则容易形成 SSRF；
- 要限定超时时间和返回大小；
- 要区分业务错误与基础设施错误。

例如，危险的设计：

```python
# 反例：允许用户指定完整URL
params = {"url": "http://169.254.169.254/latest/meta-data"}
```

更安全的做法是：

- 用户只传资源标识（如城市名、工单号）；
- URL 在 Skill 配置中固定；
- 所有请求经过网关或 allowlist 校验。

到这里，你已经看到了两类最常见 Skill：文件型与 API 型。接下来，我们进一步讨论让它们稳定可用的核心：参数定义、输入验证与错误处理。

## 6. Skill 参数定义、输入验证与错误处理

Skill 系统从“能跑”走向“可维护”的关键，就在于参数与错误的设计。如果一个 Skill 的输入定义混乱、校验不严、报错模糊，即使逻辑本身正确，也会让 Planner 难以调用、工作流难以衔接、排障成本极高。

### 6.1 参数定义的三层结构

一个高质量 Skill 的参数定义通常分三层：

1. **语义层**：参数代表什么业务概念；
2. **类型层**：参数的数据类型、格式、范围；
3. **约束层**：参数之间的依赖关系、互斥关系、默认值规则。

例如一个文件处理 Skill 的参数：

```json
{
  "root_dir": "/workspace/docs",
  "pattern": "*.md",
  "recursive": true,
  "limit": 200
}
```

其中：

- `root_dir` 是语义层，表示扫描根目录；
- `pattern`、`recursive`、`limit` 体现类型层；
- `limit <= 1000`、`root_dir` 必须在工作区内，则属于约束层。

### 6.2 使用 JSON Schema 或 Pydantic 建模

参数建模推荐采用标准化方式。若 Skill 生态语言多样，JSON Schema 更通用；若主要是 Python 实现，Pydantic 会带来更好的开发体验。

Pydantic 示例：

```python
from pydantic import BaseModel, Field, field_validator

class FileSkillParams(BaseModel):
    root_dir: str = Field(..., description="待扫描目录")
    output_file: str = Field(..., description="输出报告路径")
    recursive: bool = True
    pattern: str = "*.md"
    limit: int = Field(default=500, ge=1, le=1000)

    @field_validator("pattern")
    @classmethod
    def validate_pattern(cls, value: str):
        if not value.strip():
            raise ValueError("pattern must not be empty")
        return value
```

有了模型以后，Skill 中的校验会更清晰：

```python
def execute(self, params: dict, context):
    parsed = FileSkillParams.model_validate(params)
    ...
```

### 6.3 参数默认值不要随意隐藏业务含义

很多 Skill 为了“省事”，喜欢给几乎所有字段都设默认值。但默认值如果过多，会让调用方误以为这些参数不重要。建议遵守两个原则：

- **与业务强相关的字段必须显式提供**，如 `root_dir`、`city`、`resource_id`；
- **与行为优化相关的字段可以有默认值**，如 `timeout`、`recursive`、`limit`。

不推荐：

```python
class BadParams(BaseModel):
    city: str = "Beijing"
```

因为用户如果忘了给城市，Skill 仍会返回北京天气，这会制造隐性错误。

### 6.4 输入验证不仅是类型检查

真正的验证至少分四层：

#### 1）结构验证

检查 JSON 结构、必填字段、类型是否合法。

#### 2）格式验证

例如日期是否符合 ISO 格式、路径字符串是否为空。

#### 3）业务验证

例如目录是否存在、城市名是否在允许列表中、分页大小不能超过系统限制。

#### 4）权限验证

例如路径是否越过工作区，是否具备网络权限，是否允许访问某个资源。

组合示例：

```python
def validate_input(self, params, context):
    parsed = FileSkillParams.model_validate(params)
    root_dir = Path(parsed.root_dir)
    if not root_dir.exists():
        raise SkillValidationError("root_dir_not_found", f"目录不存在: {root_dir}")
    if not self._is_in_workspace(root_dir, context.workspace):
        raise SkillPermissionError("path_not_allowed", f"越权路径: {root_dir}")
    return parsed
```

### 6.5 错误分类：把异常变成可治理信息

如果所有错误都直接抛 `Exception("failed")`，Agent 上层根本不知道该如何响应。Skill 错误应该具备分类能力。建议至少区分以下几类：

- `SkillValidationError`：输入无效；
- `SkillPermissionError`：权限不足；
- `SkillDependencyError`：依赖缺失、外部服务未配置；
- `SkillExecutionError`：执行过程失败；
- `SkillTimeoutError`：超时；
- `SkillRetryableError`：可重试错误；
- `SkillFatalError`：不可恢复错误。

例如：

```python
class SkillError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable

class SkillValidationError(SkillError):
    pass

class SkillPermissionError(SkillError):
    pass
```

### 6.6 对 Planner 友好的错误表达

Agent 上层并不一定需要 Python 堆栈，它更需要“可理解且可处理”的错误对象。例如：

```json
{
  "error": {
    "type": "validation_error",
    "code": "missing_required_field",
    "message": "缺少必填参数 city",
    "retryable": false,
    "suggestion": "请提供 city，例如 city=Shanghai"
  }
}
```

这样 Planner 可以选择：

- 回问用户补充参数；
- 切换其他 Skill；
- 终止工作流并返回明确原因。

### 6.7 日志与错误脱敏

Skill 报错时千万不要把敏感信息直接打进日志。例如 API 请求失败时，不要输出：

```python
logger.error(f"request failed: headers={headers}, body={payload}")
```

更安全的方式：

```python
logger.error("request failed", extra={
    "status_code": resp.status_code,
    "request_id": context.request_id,
    "endpoint": "/weather",
    "payload_keys": list(payload.keys())
})
```

### 6.8 返回局部成功结果

很多 Skill 并不是非黑即白。比如扫描 100 个文件，其中 3 个乱码读取失败。这时不应该直接整个任务失败，而应该支持“部分成功”语义：

```json
{
  "total_files": 97,
  "skipped_files": 3,
  "warnings": [
    "docs/legacy.md 编码无法识别",
    "docs/tmp.md 文件已损坏"
  ]
}
```

这种设计在批量处理类 Skill 中尤其重要。

### 6.9 实际场景：人机协作中的容错

在客服、办公自动化、研发助手等场景里，很多参数都来自自然语言解析，天然不稳定。比如“帮我查下明天上海天气”可能被解析成：

```json
{"city": "上海", "date": "tomorrow"}
```

此时，Skill 层要么自己支持更宽松的格式解析，要么明确返回格式错误并建议标准输入。核心原则是：**不要把模糊性传导给下游系统。**

有了健壮的参数与错误机制，Skill 才适合被编排进更复杂的工作流。接下来，我们看多 Skill 串联与条件分支的工作流设计。

## 7. 工作流编排：多 Skill 串联与条件分支

一个 Skill 再强，也只是一个能力单元。真正让 Agent 产生业务价值的，往往不是单次调用，而是多个 Skill 在上下文中有序协作。这就是工作流编排的意义：把原子能力串成业务闭环。

### 7.1 为什么要有工作流层

如果把复杂任务全部交给 LLM 在推理时临时决定，会带来两个问题：

- 可重复性差，同样的输入每次调用路径可能不同；
- 缺乏治理，失败重试、条件分支、审计记录都难以稳定控制。

工作流层的作用，是把常见任务模板化。例如“知识库更新流程”可以固定为：

1. 扫描文档；
2. 提取元数据；
3. 生成摘要；
4. 写入索引；
5. 发送通知。

每一步背后都是一个 Skill，但流程本身可配置、可测试、可观测。

### 7.2 串联模式：上一步输出作为下一步输入

一个最基本的工作流定义示例：

```yaml
name: docs_pipeline
steps:
  - id: scan_docs
    skill: document_reporter
    with:
      root_dir: /workspace/docs
      output_file: /workspace/reports/docs-summary.md

  - id: notify_team
    skill: slack_notify
    with:
      channel: docs-alert
      message: "文档扫描完成，报告见 {{ steps.scan_docs.report_file }}"
```

这里第二步使用了第一步的输出 `report_file`。这类“数据依赖串联”是最常见的模式。

### 7.3 条件分支：根据结果决定是否继续

工作流通常不只是线性流程，还需要分支。比如天气查询后，决定是否通知活动团队：

```yaml
name: event_planning
steps:
  - id: weather
    skill: weather_lookup
    with:
      city: Shanghai

  - id: suggest_mode
    when: "{{ steps.weather.weather in ['Sunny', 'Cloudy'] and steps.weather.temperature < 30 }}"
    skill: slack_notify
    with:
      channel: ops
      message: "适合安排线下活动。"

  - id: fallback_mode
    when: "{{ steps.weather.weather not in ['Sunny', 'Cloudy'] }}"
    skill: slack_notify
    with:
      channel: ops
      message: "天气不佳，建议切换线上方案。"
```

### 7.4 编排器的执行模型

一个简化版编排器如下：

```python
class WorkflowEngine:
    def __init__(self, registry, executor):
        self.registry = registry
        self.executor = executor

    def run(self, workflow, context):
        state = {"steps": {}}
        for step in workflow["steps"]:
            if "when" in step and not self.evaluate(step["when"], state):
                continue
            skill = self.registry.get(step["skill"])
            params = self.render(step.get("with", {}), state)
            result = self.executor.run(skill, params, context)
            state["steps"][step["id"]] = result
        return state
```

真正的生产级编排器还要支持：

- 步骤超时；
- 并行节点；
- 失败重试；
- 回滚 / 补偿；
- 人工审批节点；
- 持久化状态恢复。

### 7.5 并行执行：提升效率

当多个步骤互不依赖时，可以并行执行。例如：

```yaml
steps:
  - id: weather
    skill: weather_lookup
    with: { city: Shanghai }

  - id: traffic
    skill: traffic_lookup
    with: { city: Shanghai }
    parallel_group: external_checks

  - id: venue_advice
    skill: venue_recommender
    depends_on: [weather, traffic]
```

并行带来的好处是缩短整体流程时间，但要注意上游 API 限流与资源竞争。

### 7.6 条件编排中的真实场景

以“研发发布助手”为例，一个实际工作流可能是：

1. `git_diff_summary`：提取本次提交变更；
2. `test_report_reader`：读取测试结果；
3. `jira_ticket_fetcher`：获取关联需求单；
4. 若测试失败，则 `slack_notify` 通知开发；
5. 若测试通过且需求单状态正确，则 `deploy_trigger` 发起灰度发布；
6. 发布完成后 `audit_logger` 记录操作。

这说明 Skill 的价值在于“原子能力”，工作流的价值在于“业务闭环”。

### 7.7 补偿与幂等

工作流一旦涉及副作用，就必须考虑补偿。例如：

- 已写入数据库但通知失败；
- 已触发部署但审计记录未写成功；
- 已创建工单但附件上传失败。

此时可以为 Skill 设计补偿动作：

```yaml
steps:
  - id: create_ticket
    skill: ticket_create
    compensation: ticket_delete
```

而幂等性则要求同一个流程重试时，不会重复创建资源。常见做法是为每次执行附加 `request_id` 或 `idempotency_key`。

### 7.8 人工节点与审批流

在企业环境中，Agent 自动化不能总是无条件执行。比如“批量删除文件”“发布到生产环境”“修改客户数据”这些操作，最好加入人工审批节点：

```yaml
- id: approval
  type: human_approval
  message: "即将删除 128 个文件，是否继续？"
```

Skill 工作流不是为了消灭人工，而是为了把人工放在最关键的位置。

### 7.9 LLM 与显式工作流的协同

比较成熟的架构往往不是“全由 LLM 决定”或“完全死板流程”，而是混合模式：

- LLM 负责任务理解与动态参数补全；
- 工作流负责执行路径与治理边界；
- Skill 负责原子能力落地。

这样的组合可以兼顾灵活性与稳定性。

接下来，我们从内部工程走向生态层：如果 Skill 已经足够模块化，就自然会产生市场与社区共享机制。

## 8. Skill 市场与社区共享机制

当 Skill 从团队内部复用，演进到跨项目、跨组织复用时，就会自然出现“Skill 市场”的需求。它既可以是官方中心仓库，也可以是企业内网平台，甚至是一个带评分、版本、签名与兼容性标签的插件生态。构建 Skill 市场，不只是为了方便安装，更是为了建立能力流通、质量控制和社区协作机制。

### 8.1 为什么需要 Skill 市场

在没有市场机制时，团队共享 Skill 往往靠复制代码、发压缩包、贴 Wiki 链接，问题很多：

- 版本难追踪；
- 依赖与配置不透明；
- 安全风险不可控；
- 很难知道哪些 Skill 已过时；
- 使用反馈无法沉淀。

有了市场，Skill 就像包管理生态中的模块，可以被：

- 搜索；
- 安装；
- 升级；
- 评分；
- 认证；
- 签名验证；
- 自动检查兼容性。

### 8.2 Skill 包的分发单元

一个可发布的 Skill 包通常应包含：

```text
openclaw-weather-skill/
├── skill.yaml
├── implementation.py
├── schemas/
├── README.md
├── LICENSE
└── CHANGELOG.md
```

同时附带发布元数据，例如：

```yaml
publisher: mikeah
homepage: https://example.com/openclaw-weather-skill
repository: https://github.com/example/openclaw-weather-skill
license: MIT
openclaw_compatibility: ">=1.5.0"
signature: sha256:xxxxxx
```

### 8.3 安装与启用流程

一个 Skill 市场通常会把安装流程分为三步：

1. 下载 Skill 包或拉取仓库；
2. 校验签名、版本和依赖；
3. 安装到本地 skills 目录并登记启用状态。

例如配置：

```yaml
marketplace:
  default_registry: https://skills.openclaw.dev
  trusted_publishers:
    - openclaw-official
    - mikeah
  install_path: ~/.openclaw/community-skills
```

企业内环境可能还会要求管理员先审核后上架。

### 8.4 社区共享中的元数据质量

一个 Skill 是否容易被他人使用，很大程度上取决于描述质量。建议 manifest 中包含更丰富的说明：

```yaml
examples:
  - input:
      city: Shanghai
    output:
      city: Shanghai
      weather: Cloudy
use_cases:
  - 每日天气播报
  - 活动安排建议
risk_level: low
estimated_latency_ms: 800
estimated_cost: low
```

这些信息对 Planner 也很有帮助，未来甚至可以参与自动选择逻辑。

### 8.5 安全审核机制

开放 Skill 生态最怕的不是质量低，而是恶意 Skill。比如某个 Skill 声称“文档格式化”，实际上偷偷上传本地文件。要降低风险，市场层应具备以下机制：

- 权限声明审查；
- 静态扫描可疑代码；
- 发布者身份认证；
- 签名与校验哈希；
- 沙箱运行；
- 用户侧显示副作用风险。

例如在市场 UI 中标识：

```text
Skill: advanced_file_sync
Permissions: fs.read, fs.write, network.http
Risk Level: Medium
Publisher: verified
```

### 8.6 社区评分与反馈回路

一个健康生态不应该只靠官方推荐，还要允许真实反馈沉淀：

- 安装量；
- 成功率；
- 平均延迟；
- 最近维护时间；
- 用户评分；
- Issue 链接。

例如：

```yaml
stats:
  installs: 12540
  rating: 4.8
  success_rate: 99.2%
  last_updated: 2026-05-28
```

这些指标可以反向帮助开发者持续优化 Skill。

### 8.7 企业内部 Skill 门户

对于中大型公司，更现实的场景不是开放公共市场，而是“企业内部 Skill 门户”。例如：

- CRM 查询 Skill；
- OA 审批 Skill；
- 数据仓库 SQL 执行 Skill；
- 工单系统 Skill；
- 发布平台 Skill；
- 内部知识检索 Skill。

这些 Skill 不适合公开，但非常适合做成企业技能中心，让不同 Agent 共享同一套能力底座。

### 8.8 版本演进与废弃策略

市场里最容易被忽视的是版本治理。如果你发布了 `weather_lookup@1.0.0`，后来把输出字段从 `temp` 改成 `temperature`，却没有升级主版本，就会直接破坏依赖它的工作流。因此建议：

- 遵守语义化版本；
- 输出 schema 变更要升级主版本；
- 废弃字段时给过渡期；
- 旧版本保留一段时间；
- 市场 UI 提示 breaking changes。

Skill 市场的本质，是把“能力共享”从人治转向机制化。接下来，我们进入更偏工程实践的一节：调试与测试。

## 9. 调试技巧与单元测试

一个 Skill 在你本机上跑通，并不代表它在真实 Agent 环境中可靠。很多问题只有在参数错误、权限受限、上下文缺失、远程 API 波动、工作流串联时才会暴露。因此，调试与测试是 Skill 开发不可跳过的环节。

### 9.1 先做可独立运行的本地调试入口

推荐为每个 Skill 提供一个本地调试入口，让你不必每次都从整个 Agent 启动。比如：

```python
if __name__ == "__main__":
    skill = DocumentReporterSkill({
        "name": "document_reporter",
        "config": {"max_files": 1000, "encoding": "utf-8"}
    })
    context = SkillContext(
        request_id="debug-001",
        workspace=Path("./demo_workspace"),
        logger=logger,
        secrets={},
        permissions=["fs.read", "fs.write"]
    )
    result = skill.execute({
        "root_dir": "./demo_workspace/docs",
        "output_file": "./demo_workspace/report.md"
    }, context)
    print(result)
```

这样你可以快速复现问题，而不必依赖完整调度链路。

### 9.2 打印结构化日志，而不是随手 print

调试时很多人喜欢 `print(params)`、`print(resp.text)`。短期看方便，长期看会制造噪音。更好的方式是结构化日志：

```python
context.logger.info("document_reporter.scan_start", extra={
    "root_dir": str(root_dir),
    "pattern": pattern,
    "request_id": context.request_id
})
```

这样日志平台才能按字段聚合，例如检索所有 `request_id=req-001` 的链路。

### 9.3 Mock 外部依赖

API Skill 的测试不能依赖真实线上接口，否则测试会变得脆弱、缓慢且不可重复。推荐使用 mock：

```python
from unittest.mock import patch, Mock

def test_weather_lookup_success():
    skill = WeatherLookupSkill({
        "name": "weather_lookup",
        "config": {"base_url": "https://api.example.com/weather", "timeout_seconds": 3}
    })

    fake_response = Mock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "city": "Shanghai",
        "date": "2026-06-02",
        "condition": "Cloudy",
        "temp_c": 26.5,
        "humidity": 0.81
    }

    context = Mock()
    context.secrets = {"WEATHER_API_KEY": "token"}

    with patch("requests.get", return_value=fake_response):
        result = skill.execute({"city": "Shanghai"}, context)

    assert result["weather"] == "Cloudy"
    assert result["temperature"] == 26.5
```

### 9.4 单元测试关注什么

Skill 单元测试至少要覆盖四类场景：

1. **正常路径**：输入正确，结果符合预期；
2. **参数异常**：缺字段、类型错误、越界值；
3. **权限异常**：超出工作区、缺少网络权限；
4. **依赖异常**：外部 API 超时、文件不可读、配置缺失。

例如文件 Skill 的测试：

```python
def test_document_reporter_invalid_dir(tmp_path):
    skill = DocumentReporterSkill({
        "name": "document_reporter",
        "config": {"max_files": 10}
    })
    context = Mock()
    context.workspace = tmp_path

    try:
        skill.execute({
            "root_dir": str(tmp_path / "missing"),
            "output_file": str(tmp_path / "report.md")
        }, context)
        assert False, "should raise"
    except ValueError as e:
        assert "invalid root_dir" in str(e)
```

### 9.5 集成测试：验证 discover → load → execute 全链路

单元测试只能保证 Skill 自身逻辑，而集成测试要覆盖完整生命周期。比如：

```python
def test_skill_registry_integration(tmp_path):
    discovery = SkillDiscovery()
    metas = discovery.discover(str(tmp_path / "skills"))
    assert len(metas) == 1

    loader = SkillLoader()
    skill = loader.load(metas[0])
    assert skill.name == "document_reporter"
```

这类测试很适合发现 manifest 错误、entry 配置错误、schema 路径错误等问题。

### 9.6 断点之外，更要有可重复场景

很多开发者调试只依赖 IDE 断点，但 Skill 问题往往与上下文、输入、外部环境相关。建议为每个 Skill 维护一组“样本输入包”：

```text
fixtures/
├── valid-input.json
├── invalid-input-missing-city.json
├── weather-api-404.json
└── markdown-sample/
```

有了这些样本，你可以快速回放问题，而不是靠记忆重造现场。

### 9.7 回归测试与版本升级

一旦某个 Skill 被多个工作流依赖，就必须建立回归测试，尤其是在以下变更时：

- 修改输入 schema；
- 修改输出字段名；
- 更换上游 API；
- 增加缓存或重试逻辑；
- 调整权限模型。

推荐把每个已修复 Bug 都沉淀成测试用例，防止未来回归。

### 9.8 观测指标驱动调优

除了测试，线上运行也要持续观察。建议为每个 Skill 输出指标：

- 调用次数；
- 成功率；
- 平均耗时；
- P95 / P99 延迟；
- 错误类型分布；
- 重试次数。

当你发现某个 Skill 的超时率持续上升，就知道不是“偶发现象”，而是该优化依赖或超时策略了。

### 9.9 实际场景：把调试经验产品化

成熟团队往往会把调试经验沉淀成统一工具。例如：

- `openclaw skill run <name> --input input.json`
- `openclaw skill test <name>`
- `openclaw skill inspect <name>`
- `openclaw workflow replay <run-id>`

这类工具本质上是在降低 Skill 生态的维护成本。

最后，我们进入全文总结性的部分：最佳实践与设计模式。

## 10. 最佳实践与设计模式

Skill 开发写到最后，真正拉开差距的不是“会不会写 manifest”，而是有没有形成稳定的方法论。下面这一节总结的是在实际项目中最值得长期坚持的设计原则。

### 10.1 单一职责：一个 Skill 只解决一类问题

不要把“扫描文件 + 总结内容 + 上传云端 + 发送通知”全写在一个 Skill 里。一个 Skill 如果承担太多职责，会带来：

- 参数爆炸；
- 输出不稳定；
- 难以复用；
- 难以测试；
- 任意一步失败都会拖垮整体。

正确做法是拆分为多个原子 Skill，再通过工作流编排：

```text
scan_files -> summarize_docs -> upload_report -> notify_team
```

### 10.2 契约稳定：输入输出优先于内部实现

你可以随时优化内部代码，但不要轻易改变对外字段。一个好的 Skill 把 schema 当成 API，对兼容性保持敬畏。建议：

- 所有输出字段写入 schema；
- 输出命名尽量语义明确；
- 不把上游原始格式直接暴露给下游；
- 变更前先评估依赖工作流。

### 10.3 配置外置：不要把环境差异写死在代码中

不要写：

```python
BASE_URL = "https://prod-api.example.com"
```

应该写成：

```yaml
config:
  base_url: https://prod-api.example.com
  timeout_seconds: 10
```

这样不同环境可以覆盖配置，Skill 代码保持通用。

### 10.4 显式权限：让副作用可见

Skill 最怕“看起来只是查一下，实际上会写很多东西”。因此权限要显式声明：

```yaml
permissions:
  - fs.read
  - network.http
```

对于高风险 Skill，最好在 UI 或日志中显示其副作用类型。显式权限不仅是安全要求，也有助于 Planner 做风险决策。

### 10.5 幂等优先：让重试成为安全操作

如果 Skill 可能被工作流重试，就要保证多次执行不会产生重复副作用。例如创建工单 Skill 可以接受 `idempotency_key`：

```python
payload = {
    "title": params["title"],
    "idempotency_key": context.request_id
}
```

### 10.6 Template Method 模式：统一 Skill 骨架

推荐使用模板方法模式统一 Skill 结构：

```python
class BaseSkill:
    def execute(self, params, context):
        parsed = self.validate(params, context)
        prepared = self.prepare(parsed, context)
        result = self.run(prepared, context)
        return self.format_output(result, context)
```

子类只重写必要部分：

```python
class WeatherLookupSkill(BaseSkill):
    def run(self, prepared, context):
        ...
```

好处是所有 Skill 都遵循统一生命周期，观测、审计、异常处理也更容易抽象成通用逻辑。

### 10.7 Adapter 模式：适配异构系统

面对多个外部系统时，不要让每个工作流都理解对方接口，而是在 Skill 层做适配。例如天气服务 A 与 B 的字段不同，可以通过 Adapter 统一输出。

```python
class WeatherProviderAdapter:
    def normalize(self, raw: dict) -> dict:
        return {
            "city": raw["location"],
            "weather": raw["condition_text"],
            "temperature": raw["temp_c"]
        }
```

### 10.8 Facade 模式：对复杂能力提供简单入口

如果某个业务需要串联多个底层接口，可以提供一个门面 Skill，对上层暴露简单入口。例如“发布日报”内部可能包含数据查询、模板渲染、图表生成、上传对象存储，但对 Agent 只暴露：

```json
{"date": "2026-06-02", "channel": "ops"}
```

这种 Facade Skill 适合屏蔽复杂性，但仍建议内部保持可拆分结构。

### 10.9 策略模式：根据上下文切换实现

有些 Skill 在不同环境下会有不同实现。例如通知 Skill 在测试环境写日志，在生产环境发 Slack。可以用策略模式：

```python
class NotifyStrategy:
    def send(self, message: str):
        raise NotImplementedError

class SlackNotifyStrategy(NotifyStrategy):
    def send(self, message: str):
        ...

class LogNotifyStrategy(NotifyStrategy):
    def send(self, message: str):
        print(message)
```

### 10.10 把 Skill 当产品，而不是脚本

这是最重要的一条。真正高质量的 Skill，应该像一个产品一样被对待：

- 有清晰边界；
- 有用户文档；
- 有版本历史；
- 有测试覆盖；
- 有指标监控；
- 有兼容性承诺；
- 有安全审查。

当你用这样的标准开发 Skill，OpenClaw 才不会只是“一个能调用函数的 Agent”，而会成长为真正可扩展、可协作、可治理的能力平台。

## 结语

从硬编码到 Skill 化，本质上是 AI Agent 工程化成熟的必经之路。OpenClaw 之所以值得关注，不在于它提供了一个“插件目录”，而在于它把能力封装、运行时治理、工作流编排、社区共享和调试测试串成了完整方法论。对于个人开发者而言，Skill 可以让你快速积累可复用能力；对于团队和企业而言，Skill 则意味着能力资产化、自动化规模化与生态化演进。

本文从架构、生命周期到文件处理与 API 调用实战，进一步延伸到参数定义、错误治理、工作流编排、市场机制与设计模式，目的就是帮助你建立一个清晰认知：**写 Skill，不是写一个临时函数，而是在为 Agent 构建长期可演进的能力基础设施。**

如果你准备开始实践，建议从最简单的两个方向入手：

1. 把你现有 Agent 中写死的文件操作、API 调用抽成 Skill；
2. 为这些 Skill 补齐 manifest、schema、测试与权限声明；
3. 再把多个 Skill 通过一个小型工作流串起来；
4. 最后建立团队内部的 Skill 目录和复用规范。

这样走下来，你会明显感受到：Agent 不再只是“会聊天的程序”，而是开始拥有像操作系统一样的能力插槽与自动化编排能力。这，也正是 OpenClaw Skill 体系最有价值的地方。

## 相关阅读

- [OpenClaw 隐私感知记忆分区：MEMORY.md 主会话隔离 vs 群聊上下文的安全边界](/categories/架构/OpenClaw-隐私感知记忆分区-MEMORY-md-主会话隔离-vs-群聊上下文的安全边界/)
- [OpenClaw WhatsApp 实战：跨平台消息集成与自动化](/categories/架构/OpenClaw-WhatsApp-实战-跨平台消息集成与自动化/)
- [OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比](/categories/架构/OpenHuman-vs-Hermes-vs-OpenClaw-三大开源AI-Agent框架深度对比/)
