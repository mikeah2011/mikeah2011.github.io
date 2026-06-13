---
title: AI Agent 代码助手实战：代码生成、Review、重构、文档生成
description: 后端视角拆解 AI Agent 代码助手：代码生成、Review、重构、文档生成四大场景，含 AST 解析与 Prompt Engineering 实战。
date: 2026-06-02 00:00:00
tags: [AI Agent, 代码助手, Code Review, 重构, 文档生成]
keywords: [AI Agent, Review, 代码助手实战, 代码生成, 重构, 文档生成, AI]
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---


# AI Agent 代码助手实战：代码生成、Review、重构、文档生成

这两年，AI Agent 已经从“会补全代码的高级输入法”，逐渐演进成“能理解仓库、调用工具、执行流程、输出结果”的工程化助手。对后端工程师来说，真正有价值的并不是它能不能在十秒钟内写出一个 CRUD，而是它能不能进入我们每天的主战场：读懂已有系统、在复杂上下文里生成代码、对 Pull Request 做自动评审、提出靠谱的重构建议、补全文档，以及在 CI/CD 流水线里扮演一个稳定、可控、可审计的协作者。

本文不讲概念秀，也不讨论“AI 会不会取代程序员”这种大而空的话题，而是聚焦一个更贴近一线开发的问题：**如何把 AI Agent 打造成一个真正能落地的代码助手**。文章面向已经有实际项目经验的后端工程师，默认你熟悉 Git、Pull Request、CI、单测、接口文档、常见架构分层，也踩过历史包袱、服务拆分、配置污染、脚本失控这些坑。

<!-- more -->

我会从六个维度展开：

1. 代码助手架构设计：AST 解析、上下文窗口管理、工具编排
2. 代码生成：Prompt Engineering、Few-shot、模板化策略
3. Code Review 自动化：PR 评审、安全扫描、风格检查
4. 重构建议：坏味道检测、迁移脚本、回滚策略
5. 文档生成：API Doc、README、CHANGELOG
6. 真实踩坑记录与解决方案：在真实项目里为什么“看起来很智能”的 Agent 会翻车

如果你想把 AI Agent 用在生产环境，请先记住一句话：**代码助手的核心不是模型本身，而是“上下文构造 + 工具约束 + 验证闭环”**。没有这三件事，再强的模型也只是在概率空间里胡猜。

---

## 一、为什么后端工程师需要一个“Agent 化”的代码助手

传统的 AI 编码工具大多停留在补全层：根据当前文件的局部上下文预测下一段代码。这对写新函数、补小逻辑、生成样板代码当然有帮助，但一旦进入后端真实场景，问题会立刻复杂起来：

- 一个需求会跨 controller、service、repository、DTO、数据库迁移脚本、测试代码和文档；
- 一个 PR 的质量不只取决于语法正确，还取决于幂等性、异常处理、事务边界、日志字段、监控埋点；
- 一个重构建议如果不知道调用链，不理解上下游协议，往往会“重构出事故”；
- 一份 README 如果脱离真实命令、环境变量和部署拓扑，生成得再漂亮也没法用。

这就是为什么“代码补全”不够，“代码助手”也不够，我们需要的是**Agent 化的代码助手**。所谓 Agent 化，不是给模型加个聊天框，而是让它具备以下能力：

1. **感知代码结构**：不仅看纯文本，还能理解 AST、符号引用、模块边界、调用关系；
2. **管理上下文**：知道什么信息该放进 prompt，什么该摘要，什么该延迟加载；
3. **调用外部工具**：执行搜索、跑测试、读 PR diff、调用 lint、安全扫描器、文档生成器；
4. **分步骤完成任务**：先定位问题，再生成建议，再验证结果；
5. **输出可审计结果**：告诉你它引用了哪些文件、依据了哪些规则、有哪些不确定点。

从工程实践上看，Agent 的价值主要体现在四类任务：

- **高频低风险任务**：生成 DTO、Mapper、测试样板、README 初稿；
- **中频中风险任务**：PR 初审、风格统一、重复逻辑检测、配置项梳理；
- **低频高风险任务**：重构方案建议、接口迁移、数据库变更说明；
- **持续性治理任务**：巡检代码味道、统计技术债、生成变更日志。

在我的实践里，真正节省时间的不是让它替你“写完代码”，而是让它替你**做第一轮脏活累活**：找重复逻辑、补文档骨架、扫明显问题、产出重构候选项、把散落在仓库中的知识先聚合起来。这样工程师的精力就能更多放在边界条件、业务抽象和最终拍板上。

---

## 二、代码助手的架构设计：从“会说话”到“会看仓库”

### 2.1 一个可落地的整体架构

一个能在后端项目中落地的 AI 代码助手，通常包含以下几个层次：

1. **接入层**
   - IDE 插件
   - Git 平台 Webhook（GitHub/GitLab PR 事件）
   - CLI 命令行工具
   - CI/CD Pipeline 阶段任务

2. **任务编排层**
   - 识别任务类型：代码生成、Review、重构、文档生成
   - 拆解子步骤：检索、分析、生成、验证、归档
   - 控制执行顺序与重试策略

3. **上下文构造层**
   - 文件检索
   - AST 提取
   - Git diff 解析
   - 调用链/依赖图分析
   - 历史 PR、提交信息、ADR、README、接口规范注入

4. **模型推理层**
   - 通用大模型负责推理、归纳、建议生成
   - 小模型或规则引擎负责快速分类、风险打标、模板填充

5. **工具执行层**
   - 代码搜索器
   - 编译/测试执行器
   - Linter、Formatter
   - SAST 安全扫描
   - 文档生成器
   - Git API、Issue API、CI API

6. **验证与反馈层**
   - 单测是否通过
   - 生成代码是否编译
   - Review 规则命中情况
   - 人工反馈回流用于 few-shot 样本积累

7. **审计与治理层**
   - 每次任务引用了哪些上下文
   - 给了哪些建议
   - 哪些建议被采纳/驳回
   - 错误率、命中率、节省时长

简单来说，**Agent 不应该直接面对整个仓库“裸聊”**，而应该先经过检索、结构化提取、任务拆解和结果验证，再进入模型推理。这样做的好处有两个：

- 降低 hallucination：减少模型在无关文本里瞎联想；
- 提高可控性：出了问题时，能知道是检索错了、规则漏了，还是模型推理偏了。

### 不同代码助手方案对比

在选择技术路线之前，有必要了解三种主流方案的优劣差异：

| 维度 | 规则引擎方案 | 纯 LLM 方案 | 混合方案（推荐） |
| --- | --- | --- | --- |
| **准确率** | 高（确定性规则） | 中（受 prompt 和上下文影响大） | 高（规则兜底 + LLM 补充） |
| **响应延迟** | 低（毫秒级） | 高（数秒到数十秒） | 中（按需调用 LLM） |
| **运行成本** | 低（无模型推理开销） | 高（token 计费） | 中（仅复杂任务调用模型） |
| **可维护性** | 高（规则可版本管理、单元测试） | 低（prompt 调试困难，行为不透明） | 中高（规则 + prompt 分层治理） |
| **适用场景** | 风格检查、禁用 API、命名规范 | 自然语言总结、上下文解释、建议生成 | PR Review、重构建议、文档生成 |
| **上下文理解** | 弱（仅匹配已定义模式） | 强（能理解语义和意图） | 强（结构化提取 + 语义推理） |
| **误报率** | 低 | 中高 | 低（多层校验） |

**推荐路线**：先用规则引擎覆盖确定性检查，再用 LLM 补充上下文理解和建议生成，最后通过验证闭环持续调优。这样既能控制成本和延迟，又能发挥大模型在语义理解上的优势。

### 2.2 AST 解析：为什么不能只靠字符串匹配

很多团队一开始做代码助手，最自然的实现是全文搜索 + 文件拼接 + 大模型总结。这在 demo 阶段很快见效，但一进真实项目就会暴露出明显问题：

- 搜到的方法同名但不是同一个符号；
- 类名、接口名、变量名重名导致上下文污染；
- 模型看不出真正的调用边界和作用域；
- 修改建议落在错误位置，甚至建议改一段根本不会被执行的代码。

因此，**AST（抽象语法树）解析是代码助手从玩具走向工具的第一步**。

在 Java、Go、Python、TypeScript 等主流后端栈里，AST 可以帮助我们提取至少五类核心信息：

1. **符号定义**：类、函数、方法、变量、常量定义位置；
2. **引用关系**：谁调用了谁，谁依赖了谁；
3. **结构边界**：函数体、条件分支、循环、异常处理块；
4. **注解/装饰器/元数据**：如 Spring 的 `@Transactional`、FastAPI 的路由装饰器；
5. **接口签名**：参数、返回值、泛型、异常声明。

对于代码助手来说，AST 至少有三种实际用途。

#### 用途一：精确切片上下文

比如用户问：“帮我 review 这个 PR 是否破坏了订单状态流转。”

如果你只是把 diff 扔给模型，模型可能只看到某个 `updateStatus()` 被改了，但不知道这个方法还被补偿任务、异步消费者和管理后台接口共同调用。通过 AST + 符号索引，你可以进一步提取：

- 当前 diff 改动了哪个方法；
- 这个方法被哪些调用点引用；
- 相关枚举、状态机定义在哪里；
- 事务边界和事件发送逻辑是否处于同一方法内。

这样模型看到的就不是散乱文本，而是一个围绕“订单状态流转”的结构化上下文包。

#### 用途二：生成更靠谱的修改建议

代码生成时，模型最怕的是“像对的，但接不上项目实际定义”。例如它可能会：

- 调错 repository 方法名；
- 返回错误 DTO；
- 忘记捕获项目统一异常；
- 漏掉注解、依赖注入、日志字段。

若提前通过 AST 收集当前模块中的：

- 可用类型定义；
- 常用基类/接口；
- 项目统一异常模型；
- 既有同类实现样例；

那么生成质量会比纯自然语言 prompt 高很多。

#### 用途三：检测坏味道和重构候选项

后文会详细讲重构，但先给一个直观例子：

- 某 service 方法长度 300 行，包含 6 层嵌套 if、3 次外部调用、2 段重复校验逻辑；
- 某个 util 类被 40 个模块直接依赖，形成隐式耦合中心；
- 多个 controller 重复做参数清洗和权限判定；
- 数据库实体被直接透传到 API 层。

这些问题，单靠文本模式匹配只能做很粗糙的扫描，而 AST 能帮助你更准确地统计：

- 函数长度、圈复杂度、嵌套深度；
- 重复结构片段；
- 依赖扇出/扇入；
- 不合理的跨层调用。

下面是一个使用 Python `ast` 模块对代码做结构分析的最小示例，可以提取函数定义、调用关系、嵌套深度等指标：

```python
import ast
from collections import defaultdict


class CodeAnalyzer(ast.NodeVisitor):
    """基于 Python AST 的代码结构分析器，提取函数定义、调用关系和复杂度指标。"""

    def __init__(self):
        self.functions = {}
        self.call_graph = defaultdict(list)
        self.current_function = None

    def visit_FunctionDef(self, node):
        func_name = node.name
        self.functions[func_name] = {
            "line": node.lineno,
            "args": [arg.arg for arg in node.args.args],
            "length": node.end_lineno - node.lineno + 1,
            "nested_depth": self._calc_depth(node),
        }
        prev = self.current_function
        self.current_function = func_name
        self.generic_visit(node)
        self.current_function = prev

    def visit_Call(self, node):
        if self.current_function:
            if isinstance(node.func, ast.Attribute):
                self.call_graph[self.current_function].append(
                    f".{node.func.attr}"
                )
            elif isinstance(node.func, ast.Name):
                self.call_graph[self.current_function].append(node.func.id)
        self.generic_visit(node)

    def _calc_depth(self, node, depth=0):
        max_depth = depth
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.For, ast.While, ast.With, ast.Try)):
                child_depth = self._calc_depth(child, depth + 1)
                max_depth = max(max_depth, child_depth)
        return max_depth

    def report(self):
        print(f"{'函数名':<30} {'行号':>5} {'长度':>5} {'嵌套':>5} {'调用数':>5}")
        print("-" * 60)
        for name, info in self.functions.items():
            call_count = len(self.call_graph.get(name, []))
            print(f"{name:<30} {info['line']:>5} {info['length']:>5} "
                  f"{info['nested_depth']:>5} {call_count:>5}")


# 使用示例：分析源码字符串
source = """
def create_order(user_id, items):
    validate(items)
    order = Order(user_id=user_id)
    for item in items:
        order.add_item(item)
    db.save(order)
    notify(user_id)
    return order

def validate(items):
    if not items:
        raise ValueError("empty")
"""
tree = ast.parse(source)
analyzer = CodeAnalyzer()
analyzer.visit(tree)
analyzer.report()
# 输出示例：
# 函数名                          行号   长度   嵌套   调用数
# ------------------------------------------------------------
# create_order                      2     8     2     5
# validate                         11     3     1     0
```

通过这种方式，Agent 在做 Review 或重构建议时，不再依赖"关键词猜测"，而是基于精确的结构指标做判断。例如上例中 `create_order` 嵌套深度为 2、调用数为 5，如果阈值设定为嵌套深度 > 4 或调用数 > 8，就可以自动标记为重构候选。

### 2.3 上下文窗口管理：不是越多越好，而是越准越好

模型的上下文窗口越来越大，很多人会产生一种幻觉：既然能塞几十万 token，那我把整个仓库都塞进去不就好了？

实际工程里，这通常不是最优解，原因有三点。

#### 第一，信息噪声会稀释关键线索

当模型看到太多不相关代码时，注意力会被拉散。你以为自己提供了“更多信息”，实际上给了它更多干扰项。尤其在多服务、多模块、多语言混合仓库里，噪声极其严重。

#### 第二，成本和时延不可接受

PR 自动 Review 往往发生在多人协作链路中。如果一次评审要花 40 秒甚至 2 分钟，工程师很快就会失去耐心。一个能落地的系统必须考虑 token 成本、响应时延和并发负载。

#### 第三，模型并不擅长自行完成大规模检索

大模型擅长在“已有上下文”上推理，不擅长在超大仓库文本里自己做精确定位。检索仍然应该由专门的搜索、索引和图结构完成。

所以，上下文管理的核心原则是：**分层、按需、可压缩、可追溯**。

一个比较实用的上下文分层策略如下：

1. **核心上下文**：当前 diff、当前文件、相邻定义、被修改函数签名；
2. **关联上下文**：调用方、被调用方、相关配置、测试样例；
3. **规范上下文**：团队编码规范、错误码规范、日志规范、安全基线；
4. **历史上下文**：相关 issue、历史 PR、设计文档、变更记录；
5. **摘要上下文**：对大文件、大模块做自动摘要，而不是整段原文塞入。

为了管理上下文，我通常建议实现下面几个机制：

#### 机制一：基于任务类型的上下文预算

不同任务需要的信息完全不同：

- 代码生成：更依赖同类样例、接口签名、模板规范；
- PR Review：更依赖 diff、测试、规则库、敏感调用点；
- 重构建议：更依赖调用图、复杂度统计、重复逻辑分析；
- 文档生成：更依赖注释、接口定义、命令行参数、提交记录。

不要用一个固定 prompt 模板服务所有任务，而是给每类任务独立的上下文预算策略。

#### 机制二：检索后重排

先通过搜索或向量检索拿到候选文件，再结合符号匹配、目录距离、近期改动、测试覆盖关系进行 rerank。后端项目里，**简单的词向量相似度往往不够，符号关系和目录结构常常更重要**。

#### 机制三：多级摘要

对超长文件不要直接截断，而是做“代码块级摘要”。例如：

- 文件级：这个类负责订单支付确认；
- 方法级：`confirmPayment()` 包含参数校验、状态检查、落库、事件发送；
- 风险级：该方法在事务中调用外部消息发送器，存在双写风险。

模型最终看到的是“摘要 + 关键原文片段”，而不是 2000 行源代码原封不动扔进去。

#### 机制四：显式标注不确定性

如果某些上下文未检索到，比如跨仓库依赖、外部 SDK 实现、数据库真实索引结构，就应该在 prompt 中明确告诉模型：

- 以下内容未知；
- 不要猜测未给出的实现；
- 若提出建议，请用“需要进一步确认”的语气标出。

这件事很关键，因为很多幻觉不是模型“能力差”，而是系统把缺失上下文伪装成了完整上下文。

### 2.4 工具调用与验证闭环

一个成熟的代码助手不能只输出建议，还必须具备验证能力。典型闭环是：

1. 检索代码与规则；
2. 生成建议或代码；
3. 调用编译、测试、lint、安全扫描；
4. 根据结果修正输出；
5. 记录最终结论与证据。

例如在“自动生成一个新增接口”的场景里，正确链路应该是：

- 读取相关 controller/service/repository 模板；
- 生成代码；
- 运行单测或至少编译目标模块；
- 若编译失败，提取错误回馈模型修正；
- 最终产出修改说明、影响文件列表、待人工确认项。

这比“一次性生成然后交给开发者自己修”要靠谱得多。

---

## 三、代码生成：Prompt Engineering、Few-shot 与模板化的配合

### 3.1 代码生成不是一句“帮我写个接口”

很多工程师第一次用 AI 写代码时，会直接给一句自然语言指令，比如：

> 帮我写一个查询订单详情接口。

结果生成出来的代码要么像教程示例，要么能跑但不符合项目规范。原因不复杂：对模型来说，“订单详情接口”只是业务意图，而真正决定代码能否落地的，是大量隐含约束：

- 用什么语言和框架；
- 分层结构如何；
- DTO 命名规则；
- 返回体封装约定；
- 错误码风格；
- 鉴权和审计要求；
- 日志字段格式；
- 是否要写单测、集成测试、迁移脚本、文档更新。

因此，**Prompt Engineering 的本质不是写得花，而是把隐含约束显性化**。

一个实用的生成型 prompt，通常至少包含这些部分：

1. **任务目标**：要新增/修改什么能力；
2. **项目约束**：语言、框架、分层、返回格式、异常规范；
3. **上下文输入**：相关文件、参考实现、接口定义；
4. **输出要求**：修改哪些文件、是否附带测试、是否给迁移说明；
5. **禁止项**：不要引入新依赖、不要修改公共接口、不要猜测未提供字段；
6. **验证要求**：代码必须可编译、测试命名遵循约定。

下面是一个可复用的 Prompt 模板类，把这些约束结构化后传入，避免每次手写 prompt 导致风格漂移：

```python
from dataclasses import dataclass, field
from typing import List


@dataclass
class CodeGenPrompt:
    """代码生成 Prompt 模板，将隐含约束显性化。"""
    task_goal: str                          # 要新增/修改什么能力
    language: str = "Python"                # 语言
    framework: str = "FastAPI"              # 框架
    layer_rules: List[str] = field(default_factory=list)   # 分层约束
    response_format: str = "ApiResponse[T]"                # 返回格式
    error_model: str = "BizException"                       # 异常模型
    references: List[str] = field(default_factory=list)     # 参考实现
    prohibitions: List[str] = field(default_factory=list)   # 禁止项
    output_files: List[str] = field(default_factory=list)   # 需要输出的文件
    test_required: bool = True                              # 是否需要单测

    def render(self) -> str:
        sections = [
            f"# 任务目标\n{self.task_goal}",
            f"# 技术栈\n- 语言: {self.language}\n- 框架: {self.framework}",
            f"# 分层约束\n" + "\n".join(f"- {r}" for r in self.layer_rules),
            f"# 返回格式\n{self.response_format}",
            f"# 异常模型\n{self.error_model}",
            f"# 参考实现\n" + "\n".join(f"- {r}" for r in self.references),
            f"# 禁止项\n" + "\n".join(f"- {p}" for p in self.prohibitions),
            f"# 输出文件\n" + "\n".join(f"- {f}" for f in self.output_files),
            f"# 测试要求\n{'需要补单测' if self.test_required else '无需单测'}",
        ]
        return "\n\n".join(sections)


# 使用示例
prompt = CodeGenPrompt(
    task_goal="新增订单详情查询接口 GET /api/orders/{id}",
    layer_rules=[
        "controller 只做参数接收和路由，不直接访问 repository",
        "业务逻辑下沉到 service 层",
        "返回统一使用 ApiResponse[T]，不直接返回 entity",
    ],
    references=["UserController#getProfile", "PaymentController#getDetail"],
    prohibitions=[
        "不要引入新依赖",
        "不要修改公共接口签名",
        "不要猜测未提供的方法名",
    ],
    output_files=[
        "OrderController.java",
        "OrderService.java",
        "OrderDetailResponse.java",
    ],
)
print(prompt.render())
```

例如，你可以把"新增订单详情接口"改造成下面这样的任务描述：

- 在 `OrderController` 新增查询详情接口；
- 复用现有 `OrderService` 风格，不新增新的 facade 层；
- 返回结构使用项目统一 `ApiResponse<T>`；
- 若订单不存在，抛出 `BizException`，错误码使用 `ORDER_NOT_FOUND`；
- 参考 `UserController#getProfile` 和 `PaymentController#getDetail` 两个实现；
- 需要补一个 service 单测；
- 不要直接返回 entity。

当任务信息颗粒度足够高时，模型生成的代码通常会明显更“像这个项目”。

### 3.2 Few-shot：让模型学会“我们项目是怎么写的”

对后端项目而言，few-shot 比很多人想象中更重要，因为真正难的不是逻辑本身，而是**风格一致性和约束一致性**。

同样是一个接口，不同团队差异巨大：

- 有的团队习惯 controller 只做参数接收，业务都下沉 service；
- 有的团队会在 service 里做组装，有的则单独拆 assembler；
- 有的错误码是枚举，有的是字符串常量；
- 有的日志必须包含 traceId、tenantId、operatorId；
- 有的单测采用 given-when-then，有的偏好表格驱动。

这些约定，如果只靠自然语言描述，模型未必稳定吸收；但如果提供 2~5 个高质量样例，效果会明显提升。

few-shot 样本的选择建议遵循三条原则：

#### 原则一：选“最近邻样本”而不是“最漂亮样本”

很多团队会把自己最规范的 demo 文件拿来当样本，但真实项目中更有效的是：

- 同模块、同分层；
- 同一种接口风格；
- 同样的鉴权/缓存/事务模式；
- 同样的异常和返回封装。

也就是说，**相似度优先于理想化程度**。

#### 原则二：样本要短而完整

别塞一个 1000 行大类进去。最好提供：

- 一个 controller 例子；
- 一个 service 实现例子；
- 一个测试例子；
- 一个异常处理例子。

每个样本都不必太长，但要能体现项目的关键写法。

#### 原则三：样本要配“解释标签”

不要只给代码，还应在 prompt 里说明这个样本为什么重要。例如：

- 样本 A 展示了项目统一返回结构；
- 样本 B 展示了 service 中参数校验和异常抛法；
- 样本 C 展示了 repository 的分页查询写法；
- 样本 D 展示了单测的 mock 约定。

这样模型更容易对齐，而不是机械模仿表面格式。

### 3.3 模板化：把高频场景从“生成”变成“填空”

对于真实后端项目，高频代码生成任务通常不该完全交给模型自由发挥，而应该尽量模板化。常见模板包括：

- CRUD 接口骨架；
- 数据库迁移脚本模板；
- MQ 消费者模板；
- 定时任务模板；
- OpenAPI 注释模板；
- 单测结构模板；
- README 目录结构模板。

模板化的价值不只是提高一致性，更重要的是**降低自由度**。模型真正擅长的是在局部空白处补全合理内容，而不是从零搭一套完整工程规范。

一个实用策略是“三层生成”：

1. **骨架由模板生成**：文件结构、类名、固定注解、返回包装、日志模板；
2. **细节由模型补全**：字段映射、校验逻辑、分支处理、错误信息；
3. **结果由规则校验**：lint、命名规则、必填注解、测试覆盖门槛。

例如生成一个新 API：

- 模板先产出 `Controller/Service/DTO/Test` 四个文件骨架；
- 模型再基于需求补参数、组装逻辑和异常处理；
- 校验器检查是否遗漏了鉴权注解、接口注释、返回泛型。

这样就能显著减少“看起来很聪明、实际上没法 merge”的输出。

### 3.4 代码生成中的常见失败模式

我在实践中见过几类高频失败模式，几乎每个团队都会踩中。

#### 失败模式一：生成能运行，但不符合项目边界

比如模型直接在 controller 中写数据库查询，因为它在公共语料里见过太多这种写法。如果没有明确分层约束，它就会采用“最常见写法”，而不是“你项目中的写法”。

**解决方案**：在 prompt 和 few-shot 中明确层次边界，并在后置检查里加入“禁止 controller 直接依赖 repository”这类规则。

#### 失败模式二：补全了不存在的类型或方法

这通常是上下文不足造成的。模型知道应该有一个“看起来像是合理存在”的方法，于是自己编了一个。

**解决方案**：注入可用符号表，或者让模型仅从已提供方法中选择；若缺失则要求显式标注“需要新增”。

#### 失败模式三：忽略非功能性要求

比如代码逻辑没错，但缺失：

- 超时控制；
- 幂等处理；
- 监控埋点；
- 审计日志；
- 安全脱敏。

后端工程里，这些常常比主流程更重要。

**解决方案**：把非功能性约束做成任务清单，固定注入上下文，并在生成后逐项检查。

#### 失败模式四：单测像是写了，其实没测到关键路径

模型特别容易写“形式正确”的测试，比如只验证返回非空，却没验证状态流转、异常分支、边界输入。

**解决方案**：在测试 prompt 中显式指定要覆盖的分支清单，并结合覆盖率/变异测试工具做辅助验证。

### 3.5 一个可直接落地的代码生成示例

为了避免“讲了一堆方法论，却没有可运行参考”，下面给一个后端代码助手常见的最小示例：让 Agent 为订单详情接口生成代码时，先固定输入约束，再产出可验证结果。

```python
from dataclasses import dataclass


@dataclass
class GenerateTask:
    endpoint: str
    service_method: str
    response_type: str
    not_found_error: str


def build_prompt(task: GenerateTask) -> str:
    return f"""
你是项目内的代码助手，请为以下需求生成代码：
- endpoint: {task.endpoint}
- service_method: {task.service_method}
- response_type: {task.response_type}
- not_found_error: {task.not_found_error}

约束：
1. controller 只接收参数，不直接访问 repository
2. 返回统一使用 ApiResponse[T]
3. 若订单不存在，抛出 BizException
4. 补一个 service 单测
5. 若上下文缺失，不要猜测不存在的方法名
""".strip()


task = GenerateTask(
    endpoint="GET /api/orders/{id}",
    service_method="OrderService.get_detail",
    response_type="ApiResponse[OrderDetailResponse]",
    not_found_error="ORDER_NOT_FOUND",
)

print(build_prompt(task))
```

这个示例的重点不在于代码本身多复杂，而在于它体现了三个真实可用的原则：**结构化输入、明确约束、可继续接入验证环节**。在生产里，你完全可以在它后面继续挂接符号表注入、测试执行、编译检查和错误回灌。

同时建议把高频任务做成固定输入表单，而不是每次都让开发者重新组织自然语言。这样可以显著降低 prompt 漂移，减少不同人对同一类任务给出完全不同指令的情况。

---

## 四、Code Review 自动化：从“找语法错”到“发现工程风险”

### 4.1 自动化 Review 的目标不是替代人，而是做第一层过滤

很多团队引入 AI 做 Code Review，最开始期待很高：希望它像资深工程师一样，读完 PR 就能指出设计问题、性能风险、并发缺陷、安全漏洞和维护成本。现实中，如果没有良好的规则和上下文支撑，AI 常常只能给出一些空泛建议：

- 建议增加注释；
- 变量名可以更清晰；
- 考虑拆分函数；
- 建议补充测试。

这些话当然没错，但没有任何工程价值。

我更推荐把自动化 Review 的定位设为：**第一层系统性过滤器 + 第二层风险提示器**。

它最适合做的事情有三类：

1. **确定性规则检查**：风格、规范、禁用 API、敏感信息；
2. **高概率风险提示**：空指针风险、事务边界问题、未处理异常、潜在注入点；
3. **上下文化建议生成**：结合 diff 和附近代码，指出可能的遗漏测试、遗漏文档、潜在回归点。

真正涉及架构取舍、业务语义和上线风险兜底的决定，仍然应该由人来拍板。

### 4.2 PR 评审的上下文构造方法

对 PR 做 Review 时，最核心的输入不是整个仓库，而是：

- PR diff；
- 修改文件的上下文；
- 受影响调用链；
- 对应规则库；
- 相关测试变化；
- 历史相似问题。

一个比较实用的评审流水线如下：

1. **解析 diff**：新增、删除、修改的文件和代码块；
2. **分类文件类型**：业务代码、配置文件、SQL、测试、脚本、文档；
3. **提取关键符号**：修改了哪些函数、类、配置项、表结构；
4. **检索关联代码**：调用点、实现类、测试、配置、接口文档；
5. **匹配规则**：按语言、框架、目录、风险等级注入规则；
6. **执行工具扫描**：lint、sast、secret scan、依赖漏洞扫描；
7. **让模型生成评审结论**：按高/中/低风险输出；
8. **输出可操作评论**：评论要绑定到具体文件和行。

这里有个关键点：**AI Review 必须尽量行级、证据化、可操作**。否则开发者看到一大段总结，既无法定位，也无法判断依据是否成立。

高质量评论通常包含四部分：

- 位置：文件 + 行号；
- 现象：这里做了什么修改；
- 风险：为什么可能有问题；
- 建议：如何修改或如何验证。

例如比起说“建议注意事务一致性”，更好的评论是：

- 位置：`OrderService.java:128`
- 现象：在数据库更新成功后、事务提交前发送 MQ 消息
- 风险：若事务回滚，消息已发出，可能导致下游读取到不存在的状态变更
- 建议：改为事务提交后发送，或采用 outbox 模式

### 4.3 安全扫描：把大模型与传统扫描器结合起来

安全问题是 AI Review 最容易“说得像懂、实际上不可靠”的领域。对 SQL 注入、SSRF、反序列化、硬编码密钥、路径穿越等问题，**传统 SAST/规则扫描器的确定性通常比模型更强**；而模型的优势在于补充上下文理解和解释能力。

因此一个靠谱的方案不是“用大模型替代安全扫描器”，而是：

- 先用 Semgrep、CodeQL、Bandit、SpotBugs、Gosec 等工具做确定性扫描；
- 再让模型结合具体代码上下文进行解释、归并、降噪、优先级排序；
- 对误报较多的规则，积累团队级 suppress 策略。

安全扫描在 AI Agent 里的最佳角色是“**扫描结果解释器 + 风险传播分析器**”。

例如扫描器报了一个 SSRF 风险点：某个内部代理接口把用户输入 URL 直接传给 HTTP Client。模型可以进一步补充：

- 该接口暴露在管理后台还是公网；
- 是否存在 allowlist；
- 请求是否可访问云元数据地址；
- 日志中是否会输出敏感响应；
- 是否已有类似问题历史修复样例。

这类上下文化说明，对开发者比单纯一个 rule id 更有帮助。

### 4.4 风格检查与工程约束检查

风格问题最适合自动化，因为确定性高、争议小、收益稳定。AI 在这里不一定比 formatter/linter 更强，但它可以做“解释型风格检查”，尤其适合处理一些项目私有规则：

- DTO 不允许直接暴露 entity 字段；
- controller 层禁止捕获通用 `Exception`；
- 公共方法必须打审计日志；
- 异步任务必须设置 traceId 透传；
- 变更配置项时必须同步更新示例配置文件。

这些规则往往超出了通用 lint 能力范围，但又高度结构化，非常适合做成“规则引擎 + 模型解释”混合方案。

我的经验是，Review 规则最好分三层：

1. **阻断级**：命中即失败，如硬编码密钥、禁用 API、缺少鉴权；
2. **警告级**：需要人工确认，如事务中远程调用、循环内 I/O；
3. **建议级**：优化项，如可抽取公共方法、可补充测试。

这样工程师不会被大量无关痛痒的评论淹没。

下面是一个 Review 评分引擎的实现示例，可以把规则命中情况量化为分数，便于在 CI 中做 gate 判断：

```python
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class Severity(Enum):
    BLOCKER = "blocker"      # 阻断级：命中即失败
    WARNING = "warning"      # 警告级：需人工确认
    INFO = "info"            # 建议级：优化项


@dataclass
class ReviewRule:
    rule_id: str
    name: str
    severity: Severity
    category: str            # style / security / performance / correctness
    description: str


@dataclass
class ReviewFinding:
    rule: ReviewRule
    file_path: str
    line: int
    message: str
    suggestion: str


class CodeReviewScorer:
    """Code Review 评分与检查清单引擎。"""

    # 各级别扣分权重
    WEIGHTS = {
        Severity.BLOCKER: 20,
        Severity.WARNING: 5,
        Severity.INFO: 1,
    }

    def __init__(self):
        self.rules: List[ReviewRule] = []

    def add_rule(self, rule: ReviewRule):
        self.rules.append(rule)

    def evaluate(self, findings: List[ReviewFinding]) -> dict:
        blockers = [f for f in findings if f.rule.severity == Severity.BLOCKER]
        warnings = [f for f in findings if f.rule.severity == Severity.WARNING]
        infos = [f for f in findings if f.rule.severity == Severity.INFO]

        score = 100
        score -= len(blockers) * self.WEIGHTS[Severity.BLOCKER]
        score -= len(warnings) * self.WEIGHTS[Severity.WARNING]
        score -= len(infos) * self.WEIGHTS[Severity.INFO]
        score = max(0, score)

        return {
            "score": score,
            "blockers": len(blockers),
            "warnings": len(warnings),
            "suggestions": len(infos),
            "pass": len(blockers) == 0,
            "details": [
                {
                    "severity": f.rule.severity.value,
                    "rule_id": f.rule.rule_id,
                    "file": f.file_path,
                    "line": f.line,
                    "message": f.message,
                    "suggestion": f.suggestion,
                }
                for f in findings
            ],
        }


# --- 预置常见规则 ---
scorer = CodeReviewScorer()
scorer.add_rule(ReviewRule(
    rule_id="SEC-001", name="硬编码密钥检测",
    severity=Severity.BLOCKER, category="security",
    description="检测代码中是否存在硬编码的密钥、密码或 token",
))
scorer.add_rule(ReviewRule(
    rule_id="PERF-001", name="循环内 I/O 检测",
    severity=Severity.WARNING, category="performance",
    description="检测循环体内的数据库或网络调用",
))
scorer.add_rule(ReviewRule(
    rule_id="STYLE-001", name="函数长度检测",
    severity=Severity.INFO, category="style",
    description="函数超过 50 行建议拆分",
))

# --- 模拟评审结果 ---
findings = [
    ReviewFinding(
        rule=scorer.rules[0],
        file_path="config.py", line=12,
        message="检测到硬编码的 API Key: sk-xxxx",
        suggestion="迁移到环境变量或密钥管理服务",
    ),
    ReviewFinding(
        rule=scorer.rules[1],
        file_path="order_service.py", line=87,
        message="在 for 循环内执行数据库查询",
        suggestion="改为批量查询后在内存中关联",
    ),
]

report = scorer.evaluate(findings)
print(f"评分: {report['score']}/100 | 通过: {report['pass']}")
print(f"阻断: {report['blockers']} | 警告: {report['warnings']} | 建议: {report['suggestions']}")
# 输出: 评分: 75/100 | 通过: False
#       阻断: 1 | 警告: 1 | 建议: 0
```

把这套评分机制接入 CI 后，你可以在 PR 流程中设定"阻断级问题数为 0 且评分 ≥ 80 才允许合并"这样的门禁策略，让 Review 从主观判断变成可量化的质量关卡。

### 4.5 Review 输出格式对比表

很多团队引入 AI Review 后效果不稳定，往往不是模型完全不行，而是输出格式设计得太散。下面这个对比表，基本可以帮助你快速判断当前方案为什么“开发者不爱看”。

| 输出方式 | 典型表现 | 优点 | 缺点 | 适用阶段 |
| --- | --- | --- | --- | --- |
| 纯总结式评论 | “建议关注异常处理和测试覆盖” | 实现简单 | 空泛、不可执行、难定位 | 仅适合最早期试水 |
| 行级风险评论 | 绑定文件与行号，说明现象、风险、建议 | 可操作性强，开发者愿意处理 | 依赖 diff 解析和上下文构造 | 适合正式落地 |
| 规则+模型混合报告 | 先列确定性命中，再补充模型解释 | 误报更低，证据更充分 | 系统建设成本更高 | 适合中大型团队 |
| 阻断级 Gate + 建议级评论 | 高风险问题阻断，低风险问题提示 | 流程清晰，便于治理 | 规则分层设计要求高 | 适合成熟工程体系 |

如果你的团队当前还停留在“机器人发一大段总结”的阶段，优先优化评论颗粒度，通常比盲目更换模型更有效。

### 4.6 自动 Review 的落地方式

最常见的落地方式有三种：

#### 方式一：PR 评论机器人

在 GitHub/GitLab PR 上自动评论，适合团队协作流程成熟、代码评审已经规范化的团队。优点是嵌入现有流程，缺点是评论噪声容易令人烦躁。

#### 方式二：CI 生成 Review 报告

在 CI 中产出 markdown 或 HTML 报告，并作为工件挂载。适合先低干扰试运行，观察命中率和误报率。

#### 方式三：本地/IDE 预审

在开发者提交前本地执行。适合风格和低级错误前置，但对较重的模型推理和全量扫描支持有限。

比较推荐的渐进式路线是：

- 第一阶段：只生成报告，不评论、不阻断；
- 第二阶段：对阻断级问题接入 CI gate；
- 第三阶段：对高价值规则做行级评论；
- 第四阶段：根据反馈持续调整规则权重和评论模板。

---

## 五、重构建议：让 Agent 不只指出问题，还给出迁移路径

### 5.1 AI 做重构建议，最怕“纸上谈兵”

如果说代码生成的风险在于“生成错了”，那重构建议的风险在于“建议看起来很对，但执行后出事故”。后端系统中的重构往往伴随这些复杂因素：

- 历史兼容；
- 上下游接口依赖；
- 数据迁移窗口；
- 回滚路径；
- 流量切换；
- 配置灰度；
- 监控与告警适配。

所以，**一个有价值的 AI 重构助手，不是给出一句“建议拆分类”，而是要给出可执行、可验证、可回滚的迁移方案**。

### 5.2 坏味道检测：从静态指标到业务感知

坏味道检测可以分为两类。

#### 第一类：结构性坏味道

这类问题相对容易自动化识别，例如：

- 超长函数；
- 圈复杂度过高；
- 重复代码块；
- 过大的类；
- 参数过多；
- 深层嵌套；
- 跨层依赖；
- God Object；
- Shotgun Surgery 候选点。

这些可以通过 AST、调用图和静态分析直接算出来。

#### 第二类：业务性坏味道

这类问题更难，但更有价值，例如：

- 订单状态机逻辑散落在多个 service；
- 权限校验在不同入口重复实现且不一致；
- 同一种失败重试策略在多个消费者中各写一套；
- 金额计算逻辑复制后轻微变种，导致口径不一致；
- 领域对象和持久化对象混用，导致接口演进困难。

这类问题仅靠通用指标不够，需要结合：

- 命名相似度；
- 重复业务片段聚类；
- Git 共变更历史；
- 缺陷单关联；
- 调用链位置。

AI Agent 的优势在于，它可以把这些信号汇总后生成人可读的"重构候选报告"。

下面是一个基于 AST 的代码坏味道自动检测脚本，可以批量扫描项目文件并输出结构化报告：

```python
import ast
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class CodeSmell:
    smell_type: str
    file_path: str
    location: str
    severity: str       # high / medium / low
    description: str
    suggestion: str


class RefactoringDetector:
    """基于 AST 的代码坏味道检测器。"""

    def __init__(self, max_func_length: int = 50, max_nesting: int = 4, max_args: int = 5):
        self.max_func_length = max_func_length
        self.max_nesting = max_nesting
        self.max_args = max_args
        self.smells: List[CodeSmell] = []
        self.func_signatures: dict[str, List[Tuple[str, str]]] = defaultdict(list)

    def analyze_file(self, file_path: str, source: str):
        tree = ast.parse(source)
        self._check_long_functions(file_path, tree)
        self._check_deep_nesting(file_path, tree)
        self._check_too_many_args(file_path, tree)
        self._collect_signatures(file_path, tree)

    def _check_long_functions(self, file_path: str, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                length = node.end_lineno - node.lineno + 1
                if length > self.max_func_length:
                    self.smells.append(CodeSmell(
                        smell_type="超长函数",
                        file_path=file_path,
                        location=f"{node.name} (行 {node.lineno}-{node.end_lineno})",
                        severity="high" if length > self.max_func_length * 2 else "medium",
                        description=f"函数 {node.name} 长度为 {length} 行，超过阈值 {self.max_func_length} 行",
                        suggestion="拆分为多个职责单一的子函数",
                    ))

    def _check_deep_nesting(self, file_path: str, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                depth = self._max_depth(node)
                if depth > self.max_nesting:
                    self.smells.append(CodeSmell(
                        smell_type="深层嵌套",
                        file_path=file_path,
                        location=f"{node.name} (行 {node.lineno})",
                        severity="high" if depth > self.max_nesting + 2 else "medium",
                        description=f"函数 {node.name} 最大嵌套深度为 {depth} 层",
                        suggestion="使用卫语句、策略模式或提取子函数降低嵌套",
                    ))

    def _check_too_many_args(self, file_path: str, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                arg_count = len(node.args.args)
                if arg_count > self.max_args:
                    self.smells.append(CodeSmell(
                        smell_type="参数过多",
                        file_path=file_path,
                        location=f"{node.name} (行 {node.lineno})",
                        severity="medium",
                        description=f"函数 {node.name} 有 {arg_count} 个参数",
                        suggestion="考虑使用 dataclass 或配置对象封装参数",
                    ))

    def _collect_signatures(self, file_path: str, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                sig = self._structural_hash(node.body)
                self.func_signatures[sig].append((file_path, node.name))

    def report(self) -> List[CodeSmell]:
        # 检测重复结构
        for _, locations in self.func_signatures.items():
            if len(locations) > 1:
                loc_str = ", ".join(f"{f}#{n}" for f, n in locations)
                self.smells.append(CodeSmell(
                    smell_type="重复代码",
                    file_path="多文件",
                    location=loc_str,
                    severity="medium",
                    description=f"检测到 {len(locations)} 个结构相似的函数",
                    suggestion="提取公共逻辑到共享函数或基类",
                ))

        return self.smells

    def _max_depth(self, node, depth=0):
        max_d = depth
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.If, ast.For, ast.While, ast.With, ast.Try)):
                max_d = max(max_d, self._max_depth(child, depth + 1))
        return max_d

    def _structural_hash(self, nodes):
        """简化版结构哈希：基于 AST 节点类型序列。"""
        types = tuple(
            type(n).__name__
            for n in ast.walk(ast.Module(body=nodes, type_ignores=[]))
        )
        return hash(types)


# 使用示例
detector = RefactoringDetector()
detector.analyze_file("order_service.py", """
def cancel_order(order_id, user_id, reason, admin_id, timestamp, force):
    order = db.query(order_id)
    if order:
        if order.status == 'paid':
            if not force:
                if reason:
                    order.cancel(reason)
                    db.save(order)
                    notify(user_id, "cancelled")
                else:
                    raise ValueError("需要取消原因")
            else:
                order.force_cancel()
                db.save(order)

def refund_order(order_id, user_id, reason, admin_id, timestamp, force):
    order = db.query(order_id)
    if order:
        if order.status == 'paid':
            if not force:
                if reason:
                    order.refund(reason)
                    db.save(order)
                    notify(user_id, "refunded")
                else:
                    raise ValueError("需要退款原因")
            else:
                order.force_refund()
                db.save(order)
""")

for smell in detector.report():
    print(f"[{smell.severity.upper():<6}] {smell.smell_type}")
    print(f"  位置: {smell.file_path} -> {smell.location}")
    print(f"  描述: {smell.description}")
    print(f"  建议: {smell.suggestion}")
    print()
```

将这类检测脚本集成到 CI 或定期巡检任务中，Agent 就可以自动生成重构候选清单，而不是等人工发现问题。

例如报告可以这样写：

- 检测到 4 个模块中存在相似的订单取消资格校验逻辑；
- 这 4 段逻辑在过去 3 个月内被同时修改过 5 次；
- 当前实现对超时订单和人工审核订单的判定条件不一致；
- 建议抽取为统一领域服务 `OrderCancellationPolicy`；
- 迁移顺序建议从只读校验路径开始，最后切换写路径；
- 风险点：管理后台存在特例逻辑，需要单独确认。

这比单纯说“有重复代码，建议抽取方法”要有价值得多。

### 5.3 迁移脚本：重构真正困难的地方在于“旧系统怎么活着过渡”

在后端项目里，重构很少是“一把梭全量替换”，更多是分阶段迁移。尤其涉及数据库、缓存 key、消息体结构、接口字段、配置模型时，迁移脚本往往比重构代码本身更关键。

AI Agent 在这方面可以提供三类帮助：

1. **生成迁移步骤草案**
   - 先双写还是先回填；
   - 先灰度读还是先灰度写；
   - 是否需要兼容老字段；
   - 哪些监控指标必须先就位。

2. **生成迁移脚本初稿**
   - SQL backfill 脚本；
   - 数据校验脚本；
   - 配置迁移脚本；
   - CHANGELOG 与 runbook。

3. **生成回滚方案**
   - 哪些步骤可逆；
   - 哪些步骤不可逆；
   - 数据回滚与代码回滚是否独立；
   - 灰度开关如何关闭。

举个常见例子：把订单表中的 `status` 字段从字符串迁移为枚举编码，同时修改下游消息协议。Agent 不应该只建议“把字段类型改了”，而应该给出类似下面的迁移路径：

- 第一步：新增 `status_code` 字段，保留旧字段；
- 第二步：写双写逻辑，保证新老字段同时更新；
- 第三步：回填历史数据并做一致性校验；
- 第四步：下游消费端兼容新老字段；
- 第五步：灰度读取新字段；
- 第六步：观测一段时间后移除旧字段写入；
- 第七步：最终删除旧字段与兼容逻辑。

这类方案非常适合由 Agent 先给出初稿，再由资深工程师结合业务窗口和数据规模做最后确认。

### 5.4 重构建议的验收标准

一个能落地的重构建议，至少应该满足以下五个条件：

1. **指出具体问题位置，而不是泛泛而谈**；
2. **说明收益**：降低复杂度、统一口径、减少重复变更；
3. **说明风险**：兼容性、性能、数据一致性；
4. **给出迁移步骤**：不是一句“建议拆分”；
5. **给出验证方式**：测试、监控、灰度、回滚。

否则，所谓“重构建议”就只是另一种形式的空话。

### 5.5 重构任务里的高频坑位清单

真正让重构翻车的，往往不是“没发现坏味道”，而是忽略了迁移过程中的现实约束。下面这些坑位，建议在 Agent 输出重构建议时做成固定检查项：

| 坑位 | 典型现象 | 若忽略会怎样 | Agent 应补充的检查 |
| --- | --- | --- | --- |
| 兼容字段未保留 | 新旧字段直接替换 | 下游解析失败、历史流量报错 | 是否需要双写、回填、兼容读取 |
| 配置灰度缺失 | 新逻辑直接全量生效 | 难以分批验证，回滚成本高 | 是否提供开关、白名单、流量比例 |
| 回滚路径不完整 | 只写迁移，不写撤回 | 出现故障后无法快速止损 | 哪些步骤可逆、哪些不可逆 |
| 监控指标未补齐 | 功能上线后无观测面 | 故障发生了也无法定位 | 是否新增核心指标、日志、告警 |
| 测试只覆盖主流程 | 分支和边界未验证 | 迁移期间出现隐藏回归 | 是否列出关键分支、对账脚本、一致性校验 |

把这张表嵌入重构评审流程后，Agent 的输出会更像“工程迁移方案”，而不是“理想化设计建议”。

---

## 六、文档生成：API Doc、README、CHANGELOG 的工程化做法

### 6.1 文档生成最常见的问题不是写不出来，而是写出来没人敢信

很多团队对 AI 生成文档的第一印象很好，因为它确实能快速写出结构完整、语言流畅的内容。但几次之后大家就会发现一个更致命的问题：**文档很像真的，但细节经常不准**。

比如：

- README 里的启动命令是错的；
- API 字段说明漏了可选/必选；
- CHANGELOG 把修复和优化混为一谈；
- 部署说明遗漏环境变量；
- 示例请求与真实接口不一致。

这说明文档生成不能只依赖语言能力，而必须建立在“真实来源”之上。

我建议把文档生成理解为三类任务：

1. **从结构化源生成**：如 OpenAPI、注解、CLI 参数、数据库 schema；
2. **从变更记录归纳**：如 Git log、PR 描述、Issue 关联；
3. **从仓库事实拼装**：如目录结构、Makefile、Dockerfile、配置文件。

模型在这里最适合做的是**整合、解释、润色和补全缺失说明**，而不是凭空编造事实。

### 6.2 API Doc：优先基于接口定义生成

API 文档最可靠的方式仍然是“代码即文档”或“规范即文档”：

- OpenAPI/Swagger 注解；
- Protobuf 定义；
- gRPC proto；
- FastAPI/Fiber/Spring 等框架的元数据；
- DTO 字段注释。

AI Agent 可以在这个基础上做增强：

- 给字段说明补自然语言解释；
- 自动归纳错误码含义；
- 为复杂接口生成调用示例；
- 检查文档与代码是否漂移。

例如它可以读取接口签名后生成：

- 接口用途；
- 调用前置条件；
- 请求参数解释；
- 成功响应示例；
- 常见错误场景；
- 幂等与限流说明。

对于后端团队，最有价值的不是“把字段表再写一遍”，而是把那些平时散落在口头沟通里的信息结构化下来，例如：

- 哪些字段只在某状态下返回；
- 哪些错误码意味着可以重试；
- 哪些接口受租户隔离影响；
- 哪些参数组合是互斥的。

### 6.3 README：让新同事 10 分钟内跑起来

一个仓库的 README 是否有价值，标准很简单：**新同事按 README 能不能尽快启动、定位、调试和贡献代码**。

Agent 在生成 README 时，应该优先从这些来源提取事实：

- 项目目录结构；
- 启动命令（Makefile、package script、gradle/maven、docker compose）；
- 环境变量模板；
- 本地依赖（MySQL、Redis、Kafka 等）；
- 测试命令；
- 构建产物和部署方式。

一份面向后端仓库的高质量 README，通常至少包括：

1. 项目简介与核心能力；
2. 技术栈；
3. 目录结构；
4. 本地启动步骤；
5. 环境变量说明；
6. 常用开发命令；
7. 测试与调试方式；
8. 部署概览；
9. 常见问题；
10. 贡献指南。

AI 的作用在于把这些零碎信息组织得更适合阅读，同时标出仍需人工确认的部分。例如：

- “以下环境变量是从 `.env.example` 与配置类中提取，默认值需要确认”；
- “检测到项目依赖本地 Redis 与 Kafka，但未找到 docker compose 文件，请补充启动方式”。

这类“明确提示不确定性”的文档，比强行写满更有工程价值。

### 6.4 CHANGELOG：别只会罗列 commit message

很多 CHANGELOG 自动化工具的问题是机械：把提交记录按时间拼起来，但对业务方和维护者并不友好。AI Agent 可以更进一步，把变更归纳为更适合发布说明的结构：

- 新增功能；
- 问题修复；
- 性能优化；
- 重构与内部改造；
- 破坏性变更；
- 升级与迁移说明。

关键在于，它不能只看 commit message，还应该结合：

- PR 标题和描述；
- diff 中修改的模块；
- 是否涉及 schema 变更；
- 是否涉及配置项变更；
- 是否涉及公共 API 变更。

例如某次发布同时包含：

- 新增订单批量导出；
- 修复支付回调重复处理；
- 将状态字段迁移为枚举码；
- 新增 `EXPORT_MAX_ROWS` 配置项。

一个好的 CHANGELOG 不只写“feat/fix/refactor”，而会补充：

- 对用户有什么影响；
- 是否需要更新配置；
- 是否有兼容性风险；
- 是否需要运维执行额外步骤。

### 6.5 文档生成的防漂移机制

文档生成真正难的是“持续正确”，而不是“一次写出来”。所以需要防漂移机制：

- PR 修改接口时，自动提醒是否需要更新 API 文档；
- 修改配置类时，自动比对 README/示例配置；
- 发布时，自动检查 CHANGELOG 是否覆盖迁移项；
- 定期巡检 README 命令是否还能跑通。

这里尤其推荐把文档检查纳入 CI：

- 代码中的 OpenAPI 注解缺失则告警；
- 新增环境变量未写入示例文件则失败；
- 破坏性接口变更未更新 CHANGELOG 则阻断发布。

这样 AI 生成文档才不会沦为“一次性内容生产器”。

---

## 七、真实踩坑记录与解决方案：AI 代码助手为什么经常“看起来很聪明，落地却翻车”

下面我结合实际落地经验，讲几个非常典型的坑。这些坑几乎不取决于模型品牌，而取决于工程实现是否扎实。

### 7.1 坑一：把整个仓库塞给模型，结果建议越来越空泛

我们最早做 PR Review Agent 时，觉得上下文越多越好，于是把 diff、修改文件全文、相关目录下所有文件、团队规范文档一股脑塞进去。结果出现两个问题：

- 响应很慢；
- 评论越来越空泛，很多是“建议增加测试”“注意异常处理”这种废话。

根因是：**上下文太多，信号被噪声淹没**。

#### 解决方案

- 把上下文拆成核心层、关联层、规则层；
- 先检索再重排，只保留最相关的 5~15 个片段；
- 对大文件先摘要，再补关键原文；
- 评论生成前先做“问题候选列表”，不要直接端到端从海量文本生成结论。

改完后，评论数量减少了，但命中率明显提升。

### 7.2 坑二：Review 建议看起来专业，其实误报很多

一个典型案例是事务问题。模型看到方法里有数据库操作和远程调用，就经常提示“事务中远程调用可能导致一致性风险”。这句话在很多情况下是对的，但如果远程调用其实发生在事务外，或者只是异步事件注册，这条评论就是误报。

#### 解决方案

- 用 AST 精确标记事务边界，而不是靠关键词猜；
- 对框架注解、AOP 生效方式做专项适配；
- 只有命中结构性证据时才发高优先级评论；
- 给评论加置信度和依据说明。

经过这轮治理后，开发者对机器评论的信任度才慢慢上来。

### 7.3 坑三：代码生成总爱“发明”项目里不存在的方法

这是最常见的坑之一。比如项目里 repository 只有 `findById` 和 `save`，模型却生成了 `findActiveByUserIdAndTenantId`，名字一看就像是对的，但根本不存在。

#### 解决方案

- 生成前注入可用符号表；
- prompt 中明确要求“仅使用已给出的接口，若缺失请显式标注待新增”；
- 生成后立即编译或跑类型检查；
- 把编译错误回灌，让模型做一次修正。

这里的关键不是“让模型更聪明”，而是**用工具把它关进正确边界**。

### 7.4 坑四：文档生成很漂亮，但 README 一步都跑不通

我们曾让 Agent 自动生成某服务的 README，结构非常完整，结果新同事照着做还是启动失败。最后发现问题在于：

- README 说用 `docker-compose up -d`，但仓库根本没有 compose 文件；
- 漏写了一个本地必需的 Kafka topic 初始化步骤；
- 环境变量名字引用了旧版本配置。

#### 解决方案

- README 只从真实文件和命令中提取事实；
- 未找到依据的内容一律标注“需人工确认”；
- 对 README 中的命令做可执行验证；
- 启动脚本、配置文件、README 做一致性巡检。

文档类任务里，**事实校验比文笔更重要**。

### 7.5 坑五：重构建议太理想化，忽略灰度和回滚

某次 Agent 给出一个很漂亮的建议：把分散在多个模块的用户画像组装逻辑统一抽到一个 facade。思路没错，但它忽略了两个关键现实：

- 现网有一部分流量依赖某个老字段兼容逻辑；
- 下游 BI 系统直接消费旧结构，没有及时同步。

如果按建议直接推动，很可能线上出事故。

#### 解决方案

- 重构建议必须包含“兼容影响”检查；
- 扫描调用方和下游依赖，不只看当前仓库；
- 输出迁移步骤时强制包含灰度、监控、回滚小节；
- 对公共接口和数据结构变更，默认提高风险等级。

这件事让我彻底意识到：**重构建议的价值不在于抽象得多优雅，而在于迁移方案是否现实**。

### 7.6 坑六：团队没有反馈闭环，Agent 永远停留在“似懂非懂”

很多团队上线 AI Agent 后，发现最初几周挺惊艳，后面效果却没有持续提升。原因通常不是模型不行，而是**缺少反馈闭环**：

- 哪些评论被采纳了；
- 哪些被标记为误报；
- 哪些生成代码被大量修改；
- 哪些文档段落被人工重写。

如果没有这些反馈，系统就无法积累团队特有的 few-shot 样本和规则经验。

#### 解决方案

- 给每条 Review 建议增加“采纳/忽略/误报”反馈入口；
- 把被人工修改较多的生成代码收集为反例；
- 定期整理高价值样本，更新 few-shot 库；
- 统计规则命中率、误报率、节省时长，淘汰低价值规则。

对后端团队来说，真正可持续的不是一次性的“模型接入”，而是把 Agent 当作一个持续演化的工程系统来运营。

---

## 八、一套适合后端团队的落地路线图

如果你所在团队准备把 AI Agent 引入代码助手场景，我建议按下面的顺序推进，而不是一上来追求“大而全”。

### 第一阶段：从低风险高收益场景切入

优先做：

- README/CHANGELOG 初稿生成；
- DTO、测试样板代码生成；
- PR 的风格检查和基础风险提示；
- 配置项与文档一致性检查。

这一阶段的目标不是“惊艳”，而是建立信任：输出可用、误报可控、流程不打扰人。

### 第二阶段：引入结构化理解能力

补上：

- AST 解析；
- 符号索引；
- 调用链分析；
- diff 精确定位；
- 规则引擎分级。

这一阶段，系统会从“会说一些建议”升级为“能围绕具体位置给出有证据的建议”。

### 第三阶段：接入验证闭环

把以下工具链打通：

- 编译；
- 单测；
- lint/format；
- 安全扫描；
- 文档校验；
- 配置检查。

到这一步，Agent 才开始真正具备“先产出，再自证”的能力。

### 第四阶段：做重构与治理

开始尝试：

- 坏味道巡检；
- 重复逻辑聚类；
- 重构候选报告；
- 迁移脚本初稿；
- 发布说明自动生成。

这一阶段的关键是风险意识，不追求全自动执行，而是追求高质量辅助决策。

### 第五阶段：建立团队知识飞轮

最后要做的是沉淀：

- 团队规则库；
- 高价值 few-shot 样本；
- 常见误报模式；
- 项目专属 prompt 模板；
- 反馈数据看板。

做到这里，Agent 才会越来越像“你们团队的代码助手”，而不是一个通用聊天机器人。

---

## 九、结语：把 AI Agent 当成工程系统，而不是魔法黑盒

对有经验的后端工程师来说，判断一个 AI 代码助手是否值得投入，不该只看它能不能写出一段炫目的代码，而该看它是否具备以下能力：

- 能否理解项目结构，而不是只会补全文本；
- 能否管理上下文，而不是把整个仓库胡乱塞进 prompt；
- 能否调用工具验证，而不是靠语言伪装正确；
- 能否围绕真实工作流落地，而不是停留在 demo；
- 能否形成反馈闭环，随着团队使用越来越懂项目。

本文讨论的代码生成、Review、重构、文档生成，本质上都遵循同一个原则：

> **让模型做擅长的推理和归纳，让工具做确定性的检索、执行和验证。**

当你按照这个原则去设计 Agent，就会发现很多问题都能变得清晰：

- AST 解析解决的是“看懂代码结构”；
- 上下文窗口管理解决的是“给模型看什么”；
- Prompt、few-shot、模板解决的是“如何稳定输出”；
- Review 规则与安全扫描解决的是“如何发现风险”；
- 迁移脚本与回滚方案解决的是“如何让重构真正落地”；
- 文档生成与防漂移机制解决的是“如何让知识持续可用”。

最后我想强调一点：**AI Agent 不会替代后端工程师对边界、语义和风险的判断，但它完全可以替代大量重复性的检索、整理、初步分析和模板性产出工作。**

真正成熟的团队，不会把它神化为“自动写代码的黑箱”，也不会把它贬低为“高级补全工具”，而是会把它纳入工程体系，作为一个有约束、有反馈、有验证的协作角色。

如果你正准备在团队里推进 AI 代码助手，不妨从一个具体场景开始：

- 先让它给 PR 做第一轮 Review；
- 再让它生成 README 和 CHANGELOG 初稿；
- 然后接入 AST 和规则引擎；
- 最后再逐步触达代码生成和重构治理。

用工程化的方法驯服概率模型，往往比盲目追逐更大的模型参数，更能带来真实生产力提升。

当一个 Agent 真正理解了你的代码结构、团队规范、发布流程和历史坑点，它才配得上“代码助手”这个名字。

## 十、实战进阶：文档生成流水线与上下文管理策略选型

前面六、七章节讲了文档生成的理念和踩坑经验，本节把这些落地为**可运行的代码实现**，同时给出上下文管理策略的选型对比，帮助你在实际项目中做技术决策。

### 10.1 一个完整的文档生成流水线

在真实后端项目中，文档生成绝不是"把源码丢给大模型让它写 README"。一个可投产的流水线通常包含四个阶段：**信息采集 → 结构化提取 → LLM 增强生成 → 校验与防漂移**。下面这个 Python 实现展示了如何用 AST + OpenAPI 规范 + Git 日志三重来源，构建一份可靠的 API 文档：

```python
import ast
import json
import subprocess
from dataclasses import dataclass, field
from typing import List, Dict, Optional


@dataclass
class EndpointInfo:
    """从代码中提取的接口信息。"""
    name: str
    path: str
    method: str
    params: List[Dict[str, str]] = field(default_factory=list)
    return_type: str = ""
    description: str = ""


@dataclass
class ChangelogEntry:
    """从 Git 日志中提取的变更记录。"""
    commit_hash: str
    date: str
    author: str
    subject: str
    files_changed: List[str] = field(default_factory=list)


class DocGenerationPipeline:
    """文档生成流水线：采集 → 提取 → 生成 → 校验。"""

    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.endpoints: List[EndpointInfo] = []
        self.changelog: List[ChangelogEntry] = []
        self.openapi_spec: Optional[dict] = None

    # ---------- 阶段一：信息采集 ----------

    def scan_endpoints(self, source_code: str):
        """通过 AST 扫描 FastAPI 路由装饰器，提取接口定义。"""
        tree = ast.parse(source_code)
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            # 扫描装饰器中的 @app.get / @app.post 等
            for decorator in node.decorator_list:
                if (isinstance(decorator, ast.Call)
                        and hasattr(decorator.func, "attr")
                        and decorator.func.attr in ("get", "post", "put", "delete")):
                    path = ""
                    method = decorator.func.attr.upper()
                    if decorator.args and isinstance(decorator.args[0], ast.Constant):
                        path = decorator.args[0].value
                    params = [
                        {"name": arg.arg, "type": "Any"}
                        for arg in node.args.args
                        if arg.arg != "self"
                    ]
                    # 尝试提取返回类型注解
                    return_type = ""
                    if node.returns:
                        return_type = ast.dump(node.returns)
                    self.endpoints.append(EndpointInfo(
                        name=node.name, path=path, method=method,
                        params=params, return_type=return_type,
                    ))

    def collect_changelog(self, since_tags: int = 20):
        """从 Git 日志中收集最近 N 条提交记录。"""
        try:
            result = subprocess.run(
                ["git", "-C", self.repo_path, "log",
                 f"--oneline", f"-{since_tags}", "--format=%H|%ad|%an|%s"],
                capture_output=True, text=True, timeout=30
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split("|", 3)
                if len(parts) == 4:
                    self.changelog.append(ChangelogEntry(
                        commit_hash=parts[0][:8],
                        date=parts[1],
                        author=parts[2],
                        subject=parts[3],
                    ))
        except Exception as e:
            print(f"[WARN] Git 日志采集失败: {e}")

    def load_openapi(self, spec_path: str):
        """加载已有的 OpenAPI 规范文件。"""
        try:
            with open(spec_path, "r") as f:
                self.openapi_spec = json.load(f)
        except FileNotFoundError:
            print(f"[WARN] 未找到 OpenAPI 规范文件: {spec_path}")

    # ---------- 阶段二：结构化提取 ----------

    def build_context_bundle(self) -> str:
        """将采集到的信息组装为 LLM 可消费的结构化上下文。"""
        sections = []

        # 接口列表
        if self.endpoints:
            ep_lines = []
            for ep in self.endpoints:
                params_str = ", ".join(
                    f"{p['name']}: {p['type']}" for p in ep.params
                )
                ep_lines.append(f"- {ep.method} {ep.path}  -> {ep.name}({params_str})")
            sections.append("## 接口清单\n" + "\n".join(ep_lines))

        # 最近变更
        if self.changelog:
            cl_lines = [
                f"- [{entry.commit_hash}] {entry.date} {entry.author}: {entry.subject}"
                for entry in self.changelog[:10]
            ]
            sections.append("## 近期变更\n" + "\n".join(cl_lines))

        # OpenAPI 补充
        if self.openapi_spec:
            paths = list(self.openapi_spec.get("paths", {}).keys())[:10]
            sections.append(
                "## OpenAPI 已定义路径\n" + "\n".join(f"- {p}" for p in paths)
            )

        return "\n\n".join(sections)

    # ---------- 阶段三：生成 ----------

    def generate_readme_prompt(self) -> str:
        """构建 README 生成 Prompt。"""
        context = self.build_context_bundle()
        return f"""你是一个后端项目的文档助手。请基于以下结构化信息生成 README。

要求：
1. 只使用提供的信息，不要编造不存在的接口、命令或配置
2. 如果信息不足，在对应位置标注「⚠️ 需人工确认」
3. 结构包含：项目简介、技术栈、接口概览、本地启动、变更日志

上下文：
{context}

请输出完整的 README 内容。"""

    def generate_api_doc_prompt(self) -> str:
        """构建 API 文档生成 Prompt。"""
        context = self.build_context_bundle()
        return f"""你是一个 API 文档生成助手。基于以下接口信息和变更记录，生成接口文档。

要求：
1. 每个接口包含：路径、方法、参数说明、返回格式、常见错误码
2. 只使用已有信息，不猜测未给出的字段
3. 补充实际使用中容易忽略的注意事项

接口信息：
{context}

请输出 Markdown 格式的 API 文档。"""

    # ---------- 阶段四：校验 ----------

    def validate_output(self, generated_doc: str) -> List[str]:
        """对生成的文档做基础校验。"""
        warnings = []
        # 检查是否引用了真实存在的接口
        for ep in self.endpoints:
            if ep.path and ep.path not in generated_doc:
                warnings.append(
                    f"接口 {ep.method} {ep.path} 未出现在生成文档中"
                )
        # 检查是否有未确认标记
        confirm_count = generated_doc.count("需人工确认")
        if confirm_count > 0:
            warnings.append(
                f"文档中有 {confirm_count} 处需人工确认的内容"
            )
        return warnings


# ========== 使用示例 ==========

pipeline = DocGenerationPipeline(repo_path="/path/to/your/project")

# 扫描源码中的接口定义
sample_source = '''
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/orders/{order_id}")
async def get_order(order_id: int):
    """获取订单详情"""
    return {"id": order_id}

@app.post("/api/orders")
async def create_order(order_data: dict):
    """创建新订单"""
    return {"id": 1, "status": "created"}
'''
pipeline.scan_endpoints(sample_source)

# 采集 Git 日志
pipeline.collect_changelog(since_tags=10)

# 构建上下文
context = pipeline.build_context_bundle()
print("=== 上下文预览 ===")
print(context[:500])

# 生成 Prompt（实际项目中接入 LLM API）
readme_prompt = pipeline.generate_readme_prompt()
api_prompt = pipeline.generate_api_doc_prompt()
print(f"\nREADME Prompt 长度: {len(readme_prompt)} 字符")
print(f"API Doc Prompt 长度: {len(api_prompt)} 字符")

# 校验（假设 generated_doc 为 LLM 返回内容）
mock_doc = "GET /api/orders/{order_id} 获取订单详情\nPOST /api/orders 创建订单"
warnings = pipeline.validate_output(mock_doc)
print(f"\n校验警告: {warnings if warnings else '无'}")
```

这个流水线体现了前面章节强调的三个核心原则：

- **真实来源驱动**：接口信息从 AST 提取，变更记录从 Git 日志获取，不凭空编造；
- **结构化上下文**：不是把整个仓库扔给模型，而是组装精简的 context bundle；
- **输出校验**：生成后自动检查是否覆盖了所有已知接口，标注不确定内容。

在生产环境中，你可以继续扩展这个流水线：加入 OpenAPI diff 检测文档漂移、自动对比 README 中的命令是否能执行、把 CHANGELOG 与 PR 描述交叉验证。

### 10.2 上下文管理策略选型对比

文章第二章讨论了上下文窗口管理的重要性，但在实际选型时，工程师往往面临更具体的决策。下面这张表对比了三种主流上下文管理策略的核心差异：

| 维度 | 基于关键词检索 | 基于向量语义检索 | 基于 AST + 符号索引（推荐） |
| --- | --- | --- | --- |
| **检索精度** | 低（容易搜到无关内容） | 中（语义相近但可能不相关） | 高（精确匹配符号定义与引用） |
| **实现复杂度** | 低（grep/ripgrep 即可） | 中（需要 embedding 模型 + 向量库） | 中高（需要 AST 解析器 + 索引构建） |
| **对多语言支持** | 强（纯文本匹配） | 强（embedding 语言无关） | 弱-中（每种语言需独立 AST 解析） |
| **上下文相关性** | 弱（不知道调用链和依赖关系） | 中（能捕获语义但忽略结构） | 强（能沿调用链精确扩展上下文） |
| **首次索引成本** | 几乎为零 | 中（需要向量化全部文件） | 中（需要遍历并解析所有源文件） |
| **增量更新** | 自动（无需索引） | 需重新向量化变更文件 | 只需重新解析变更文件的 AST |
| **推荐场景** | 快速原型、小仓库 | 中大型仓库语义搜索 | 后端代码 Review、重构分析、精确文档生成 |
| **最佳实践** | 搭配正则规则使用 | 搭配 rerank 做后过滤 | 作为核心层，向量检索做补充 |

**选型建议**：

- **小团队 / 小仓库**（<50 个源文件）：关键词检索 + 向量检索就够了，AST 解析收益不明显；
- **中型后端项目**（50~500 个源文件）：AST 符号索引做核心层，向量检索做补充，关键词检索做兜底；
- **大型微服务架构**（>500 个源文件或跨仓库）：必须 AST 索引 + 符号图 + 分层检索，向量检索仅用于跨模块语义搜索。

很多团队犯的错误是**一上来就追求最复杂的方案**，结果索引构建成本吃掉了整个项目的时间预算。正确的路径是：先用最简单的方案跑起来，积累真实查询样本，再根据误报率和漏报率决定是否升级。

### 10.3 真实案例：一次"AI 生成文档全量替换"引发的事故

2025 年初，某中型 SaaS 团队决定用 AI Agent 批量重新生成所有微服务的 README。团队有 30+ 个服务仓库，每个仓库的 README 都已过时，人力维护成本高。于是他们做了一个看起来很合理的决策：用 Agent 读取每个仓库的代码，一次性生成所有 README，然后 PR 提交替换。

#### 事故经过

- Agent 扫描了 30 个仓库的代码，生成了 30 份 README；
- 其中 22 份基本准确，5 份有小问题（环境变量名过时），**3 份存在严重错误**；
- 服务 A 的 README 中，启动命令引用了错误的端口配置（写成了另一个服务的端口），新同事照做后启动的服务无法连接数据库；
- 服务 B 的 README 遗漏了数据库初始化步骤，导致集成测试全部失败；
- 服务 C 的 README 中 Docker 命令引用了不存在的镜像标签，CI 构建直接报错；
- 这些 README 被合并后的一周内，有 4 位新入职工程师因此浪费了累计 16 小时排查问题。

#### 根因分析

事故的根本原因不在于模型能力不足，而在于**流水线缺少验证环节**：

1. 没有对 README 中的命令做"可执行性验证"；
2. 没有将 README 与 docker-compose、Makefile、.env.example 做交叉校验；
3. 没有灰度策略，30 个仓库的 README 一次性全量替换；
4. 没有让对应服务的 owner review，直接由 DevOps 合并。

#### 修正后的流程

团队后续改进了文档生成流程，建立了四层防护：

| 防护层 | 措施 | 效果 |
| --- | --- | --- |
| 生成层 | 只从真实文件（Makefile、docker-compose、.env.example）提取事实 | 消除 60% 的事实性错误 |
| 校验层 | 自动生成后做交叉比对（端口、路径、镜像标签） | 消除 30% 的不一致问题 |
| 评审层 | 每个仓库的 README PR 必须由 owner 签核 | 拦截剩余 10% 的业务语义错误 |
| 灰度层 | 先在 3 个仓库试点，验证流程后再推广 | 控制爆炸半径，降低修复成本 |

这次事故给团队的最大教训是：**AI 生成内容的质量上限取决于流水线的设计，而不取决于模型的参数量**。再强的模型，如果没有校验和人工兜底，在生产环境中都会翻车。

### 10.4 从单次生成到持续治理

最后补充一个很多团队容易忽略的维度：**文档和代码一样，需要持续治理，而不是一次性生产**。建议在 CI/CD 流水线中加入以下自动化检查：

```python
# 文档一致性检查脚本（可集成到 CI）
import os
import re
from pathlib import Path


def check_env_var_consistency(repo_root: str) -> list:
    """检查 .env.example 中的变量是否在 README 中都有说明。"""
    warnings = []
    env_example = Path(repo_root) / ".env.example"
    readme = Path(repo_root) / "README.md"

    if not env_example.exists() or not readme.exists():
        return ["缺少 .env.example 或 README.md"]

    env_vars = set()
    for line in env_example.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            env_vars.add(line.split("=")[0].strip())

    readme_content = readme.read_text()
    missing = [v for v in env_vars if v not in readme_content]
    if missing:
        warnings.append(
            f"以下环境变量未在 README 中说明: {', '.join(missing)}"
        )
    return warnings


def check_docker_compose_refs(repo_root: str) -> list:
    """检查 README 中引用的 docker-compose 命令是否与实际文件匹配。"""
    warnings = []
    readme = Path(repo_root) / "README.md"
    compose_files = list(Path(repo_root).glob("docker-compose*"))

    if not readme.exists():
        return []

    readme_content = readme.read_text()
    if "docker-compose" in readme_content and not compose_files:
        warnings.append("README 引用了 docker-compose 但仓库中未找到对应文件")

    return warnings


# 在 CI 中调用
if __name__ == "__main__":
    root = os.environ.get("REPO_ROOT", ".")
    all_warnings = []
    all_warnings.extend(check_env_var_consistency(root))
    all_warnings.extend(check_docker_compose_refs(root))

    if all_warnings:
        print("⚠️ 文档一致性检查发现问题:")
        for w in all_warnings:
            print(f"  - {w}")
    else:
        print("✅ 文档一致性检查通过")
```

把这类检查加入 CI，你的文档生成流水线就从"一次性的内容生产器"进化为"可持续的文档质量保障系统"。这才是 AI 文档助手在生产环境中真正该有的样子。

## 相关阅读

- [AI Agent 客服系统实战：多轮对话、知识库检索、工单流转](/post/ai-agent-customer-service-system/)
- [AI Agent 数据分析实战：自然语言转SQL、图表生成、报告自动化](/post/ai-agent-sql/)
- [AI Agent 运维助手实战：日志分析、告警处理、故障自愈](/post/ai-agent-3/)
- [AI Agent 自动化测试实战：测试用例生成、执行、结果分析闭环](/post/ai-agent-automated-testing-pipeline/)
