---

title: AutoGen 实战：微软多 Agent 对话框架与代码执行沙箱
keywords: [AutoGen, Agent, 微软多, 对话框架与代码执行沙箱]
date: 2026-06-02 09:00:00
tags:
- AutoGen
- AI Agent
- 微软
- Multi-Agent
- Python
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 这篇 AutoGen 实战指南系统拆解微软多 Agent 对话框架、GroupChat 协作机制与代码执行沙箱能力，结合 Python 示例讲清 Agent 角色分工、自动调度、Docker 安全执行与 AutoGen vs CrewAI vs LangGraph 选型差异。
---



# AutoGen 实战：微软多 Agent 对话框架与代码执行沙箱

当大模型从“一个问答助手”逐步演化为“一个能拆任务、能调用工具、能执行代码、能与其他模型协作的系统”时，传统的单 Agent 结构很快就会暴露局限：上下文越来越臃肿、职责越来越混乱、推理与执行混在一起、调试成本直线上升。微软研究院开源的 AutoGen，正是在这种背景下脱颖而出的多 Agent 对话框架。

AutoGen 的价值不只在于“可以有多个 Agent”，而在于它把多角色协作、消息交换、代码执行、错误修复与自动终止这些能力放进了一个统一的对话模型里。换句话说，它并不是把多个聊天机器人简单排排坐，而是把一个小型虚拟团队运行所需的关键机制真正抽象了出来。

本文从实战角度出发，系统讲清 AutoGen 的设计逻辑与落地方式，重点覆盖以下内容：

- AutoGen 框架概览与核心定位；
- `ConversableAgent`、`AssistantAgent`、`UserProxyAgent` 的职责与协作关系；
- 双 Agent 与 GroupChat 两种典型多 Agent 对话模式；
- 代码执行沙箱的工作方式，以及 Docker / 本地执行差异；
- GroupChat 中的发言者选择与调度设计；
- 自定义 Agent、回复函数与规则驱动扩展；
- 与 LangChain、LangGraph、CrewAI 等框架的对比。

如果你想构建的是一个“能讨论、能写代码、能运行代码、能根据结果继续修复”的智能系统，那么 AutoGen 非常值得认真研究。

---

## 一、AutoGen 是什么

AutoGen 是微软研究院推出的多 Agent 对话框架。它的核心思想很直接：**把复杂任务交给多个具有不同职责的 Agent，通过消息交互来协作完成。**

在很多传统 LLM 应用里，系统结构往往是：

```text
用户 -> 单个 LLM -> 答案
```

如果任务比较复杂，就给这个 LLM 增加工具调用、函数调用、RAG 检索和一大段系统提示词。但随着需求变复杂，单 Agent 模型会很快走到边界：

1. 它既要理解需求，又要制定计划；
2. 既要写代码，又要执行和调试；
3. 既要解释结果，又要负责安全控制；
4. 所有职责都堆在一个 Prompt 里，越来越难维护。

AutoGen 提供的思路是把这些职责拆开。你可以让：

- 一个 Agent 负责规划；
- 一个 Agent 负责写代码；
- 一个 Agent 负责执行代码；
- 一个 Agent 负责审查结果；
- 一个 Agent 负责安全约束；
- 必要时还可以保留人工输入节点。

于是，整个系统更像这样：

```text
用户/执行代理 -> Planner -> Engineer -> Executor -> Reviewer -> 修复/终止
```

这里最关键的不是 Agent 数量，而是**协作闭环**。AutoGen 让多角色围绕同一任务持续对话，直到满足终止条件，而不是每一步都靠人手动复制粘贴。

---

## 二、AutoGen 的核心理念：把协作建模为对话

很多框架擅长做“链式调用”或者“流程图编排”，而 AutoGen 的特点在于它更强调“对话”本身。

### 2.1 对话为什么重要

现实世界里的团队协作，本质上就是一种消息流转：

- PM 给需求；
- 工程师给方案；
- 执行器跑代码；
- QA 反馈 bug；
- 工程师修复；
- 最后给出结果。

AutoGen 把这个过程映射成 Agent 间的消息交互。每个 Agent 会根据：

- 当前收到的消息；
- 历史上下文；
- 系统角色设定；
- 可用工具；
- 自动回复规则；
- 终止条件；

来决定下一步行为。

这个行为未必只是“说一句话”，还可能是：

- 输出 Python / Shell / SQL 代码；
- 请求执行代码；
- 基于执行结果继续修复；
- 选择下一位发言者；
- 判断是否终止。

### 2.2 AutoGen 与“加工具的聊天机器人”区别

AutoGen 当然可以看作“给 LLM 加工具”，但这个表述过于简单。真正不同的地方在于：

- 它天然支持多个 Agent 共同参与；
- 它允许对话自动持续多轮；
- 它把执行结果回流到推理链里；
- 它允许某些 Agent 只做规则判断、不依赖 LLM；
- 它很适合表达“先讨论、再执行、再复盘”的过程。

因此，AutoGen 不只是一个聊天壳子，而更像一套多角色智能协作运行时。

---

## 三、核心抽象：ConversableAgent、AssistantAgent、UserProxyAgent

AutoGen 经典实践中，最值得掌握的三个核心概念是：

- `ConversableAgent`
- `AssistantAgent`
- `UserProxyAgent`

它们既是常用组件，也是理解整个框架的入口。

### 3.1 ConversableAgent：一切可对话对象的基础抽象

`ConversableAgent` 可以理解为 AutoGen 中最基础的 Agent 类型。名字中的 “Conversable” 已经很清楚地说明了其定位：**只要是能参与对话、能收发消息、能根据规则回复的对象，都可以看作一个 ConversableAgent。**

它通常具备以下能力：

- 保存消息历史；
- 接收和发送消息；
- 注册自动回复函数；
- 配置人工输入模式；
- 配置终止条件；
- 支持函数或工具调用扩展；
- 与其他 Agent 发起会话。

举个例子，我们可以用它创建一个“代码评审专家”：

```python
from autogen import ConversableAgent

reviewer = ConversableAgent(
    name="reviewer",
    system_message=(
        "你是一名严格的代码评审专家。"
        "请重点检查正确性、异常处理、边界条件和安全问题。"
    ),
    llm_config={
        "config_list": [{
            "model": "gpt-4o-mini",
            "api_key": "YOUR_API_KEY"
        }],
        "temperature": 0.2,
    },
    human_input_mode="NEVER",
)
```

这个 Agent 没有什么“神奇特殊逻辑”，但它已经能参与多 Agent 协作。你可以继续为它添加自定义回复规则，让它只在特定情况下发言，或者只负责审查某类输出。

### 3.2 AssistantAgent：负责规划、生成与解释

`AssistantAgent` 通常是 AutoGen 里最常见的“智能生成角色”。它适合扮演：

- 规划者；
- 工程师；
- 数据分析师；
- 文档写作者；
- 审查员；
- 某个具体领域专家。

典型职责包括：

- 理解用户目标；
- 输出分步方案；
- 编写代码；
- 分析运行结果；
- 在报错后修复；
- 与其他 Agent 协作。

例如：

```python
from autogen import AssistantAgent

assistant = AssistantAgent(
    name="assistant",
    system_message="你是资深 Python 工程师，只输出可执行、可验证的解决方案。",
    llm_config={
        "config_list": [{
            "model": "gpt-4o-mini",
            "api_key": "YOUR_API_KEY"
        }],
        "temperature": 0,
    },
)
```

它更像一个“有专长的思考者与生成者”。不过，`AssistantAgent` 本身未必直接执行代码，很多时候它会把代码输出给其他 Agent 去运行。

### 3.3 UserProxyAgent：用户代理，也是执行器桥梁

`UserProxyAgent` 是 AutoGen 最有辨识度的组件之一。很多初学者容易被名字误导，以为它只是“替用户说话”。实际上，它常常承担更重要的职责：

- 代表用户发起任务；
- 决定是否需要人工输入；
- 识别代码块；
- 触发代码执行；
- 将执行结果重新发回对话链；
- 在自动与人工之间扮演桥梁。

最典型的配置如下：

```python
from autogen import UserProxyAgent

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
    code_execution_config={
        "work_dir": "coding",
        "use_docker": True,
        "timeout": 120,
    },
)
```

这个配置很值得逐项理解：

- `human_input_mode="NEVER"`：表示整个流程尽量自动执行，不等待人工输入；
- `max_consecutive_auto_reply=8`：限制自动连续回复次数，防止循环失控；
- `is_termination_msg=...`：约定终止消息格式；
- `code_execution_config`：决定执行目录、执行方式和超时时间。

在很多实战中，正是 `UserProxyAgent` 把“能说”变成了“能做”。

---

## 四、最小实战：双 Agent 自动对话闭环

理解 AutoGen 的最好方式，不是先看复杂群聊，而是先搭一个最小闭环：

- 一个 `AssistantAgent` 负责写代码；
- 一个 `UserProxyAgent` 负责执行代码并回传结果。

### 4.1 安装准备

如果你在本地做实验，可以先创建虚拟环境：

```bash
python -m venv .venv
source .venv/bin/activate
pip install pyautogen docker
```

如果环境受 PEP 668 管理，也可以使用 `uv`：

```bash
uv venv
source .venv/bin/activate
uv pip install pyautogen docker
```

准备 LLM 配置：

```python
llm_config = {
    "config_list": [
        {
            "model": "gpt-4o-mini",
            "api_key": "YOUR_API_KEY"
        }
    ],
    "temperature": 0,
}
```

### 4.2 最小示例代码

```python
from autogen import AssistantAgent, UserProxyAgent

llm_config = {
    "config_list": [{
        "model": "gpt-4o-mini",
        "api_key": "YOUR_API_KEY"
    }],
    "temperature": 0,
}

assistant = AssistantAgent(
    name="assistant",
    system_message=(
        "你是一名数据分析工程师。"
        "当需要计算时，请给出可执行 Python 代码，并在最终答案中总结结果。"
    ),
    llm_config=llm_config,
)

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=6,
    code_execution_config={
        "work_dir": "tmp_autogen",
        "use_docker": True,
        "timeout": 120,
    },
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
)

user_proxy.initiate_chat(
    assistant,
    message="请编写 Python 代码，计算 1 到 100 的平方和，并输出结果。完成后回复 TERMINATE。"
)
```

### 4.3 它实际做了什么

这段代码背后发生的流程非常典型：

1. `user_proxy` 向 `assistant` 发起任务；
2. `assistant` 输出 Python 代码；
3. `user_proxy` 检测到代码块后执行；
4. 执行输出和错误信息被回传；
5. `assistant` 根据结果总结答案，必要时继续修复；
6. 出现终止标记后对话结束。

这个闭环与“LLM 只给代码建议”的最大区别在于：**执行结果成为了推理上下文的一部分。** 这使 AutoGen 可以自动进入“写代码—运行—修复—再运行”的反馈式工作模式。

---

## 五、多 Agent 对话模式：从双人协作到群聊编排

双 Agent 模式是起点，但 AutoGen 的真正优势在于它可以自然扩展成多角色协作系统。

### 5.1 双 Agent 模式

最常见结构是：

- `AssistantAgent`：负责理解任务、输出代码、解释结果；
- `UserProxyAgent`：负责执行代码、反馈结果、终止会话。

优点：

- 简单直接；
- 调试方便；
- Token 开销相对可控；
- 很适合做原型验证和代码执行闭环。

缺点：

- 规划、实现、审查可能被塞进一个 Agent；
- 任务复杂后 Prompt 迅速膨胀；
- 缺少清晰角色边界。

### 5.2 多 Agent 模式

一旦进入稍复杂的场景，你往往希望拆角色：

- `planner`：拆解目标和执行步骤；
- `engineer`：根据计划写代码；
- `executor`：运行代码并返回日志；
- `reviewer`：判断结果是否满足要求；
- `security_guard`：拦截危险命令或高风险行为。

这种拆分的意义是：

1. 每个 Agent 的系统提示更明确；
2. 输出风格更稳定；
3. 便于复用与替换；
4. 更接近真实团队分工；
5. 更利于调试错误来源。

对于需要多轮验证、分析和修复的任务，多 Agent 往往比一个全能 Agent 更稳。

---

## 六、GroupChat：AutoGen 的群聊式协作机制

AutoGen 中最有代表性的多 Agent 能力之一就是 `GroupChat`。它允许多个 Agent 共享同一段对话历史，并在协调器控制下轮流发言。

### 6.1 为什么 GroupChat 有价值

如果没有群聊调度器，你也可以手写一个固定流程：

```python
planner -> engineer -> executor -> reviewer -> engineer -> reviewer
```

但随着角色数量增加、任务分支变复杂，纯手写流程会迅速失控。`GroupChat` 的作用就是把“多 Agent 共享上下文 + 选择下一位发言者”这件事抽象出来。

### 6.2 基础 GroupChat 示例

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

llm_config = {
    "config_list": [{
        "model": "gpt-4o-mini",
        "api_key": "YOUR_API_KEY"
    }],
    "temperature": 0,
}

planner = AssistantAgent(
    name="planner",
    system_message="你负责拆解任务，给出分步计划。",
    llm_config=llm_config,
)

engineer = AssistantAgent(
    name="engineer",
    system_message="你负责根据计划编写 Python 代码并修复错误。",
    llm_config=llm_config,
)

reviewer = AssistantAgent(
    name="reviewer",
    system_message="你负责检查结果是否正确、是否满足需求。",
    llm_config=llm_config,
)

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "groupchat_workspace",
        "use_docker": True,
        "timeout": 120,
    },
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
)

groupchat = GroupChat(
    agents=[user_proxy, planner, engineer, reviewer],
    messages=[],
    max_round=12,
)

manager = GroupChatManager(
    groupchat=groupchat,
    llm_config=llm_config,
)

user_proxy.initiate_chat(
    manager,
    message="请分析一组销售数据，生成统计脚本、执行并总结关键发现，最后回复 TERMINATE。"
)
```

### 6.3 GroupChat 的工作过程

这段代码背后一般会发生以下步骤：

1. `user_proxy` 把任务提交给 `manager`；
2. `GroupChatManager` 判断谁先发言；
3. `planner` 给出步骤拆解；
4. `engineer` 输出脚本；
5. `user_proxy` 执行代码并回传结果；
6. `reviewer` 检查结果是否达标；
7. 若不满足，则继续迭代；
8. 到达终止条件或轮次上限后结束。

可以把 `GroupChatManager` 看作一个轻量调度器，它并不做业务本身，但负责维持群聊秩序。

---

## 七、GroupChat 调度核心：Speaker Selection

很多人对 GroupChat 的第一印象是“多个 Agent 在同一个会话里聊天”。但对工程落地来说，真正的难点不是共享消息，而是：**下一轮应该由谁发言？**

这就是 Speaker Selection，也就是发言者选择机制。

### 7.1 为什么发言者选择这么关键

如果调度不合理，多 Agent 系统会出现很多低效行为：

- 同一个 Agent 连续自言自语；
- 还没写代码，执行器就被唤起；
- 代码还没跑，Reviewer 就开始评价；
- Planner 反复重复计划，系统空转；
- 多个 Agent 因为角色边界不清相互覆盖。

所以，多 Agent 系统的上限不只取决于模型能力，也很大程度取决于调度策略。

### 7.2 AutoGen 的常见发言策略

AutoGen 中常见的 Speaker Selection 方法包括：

- `auto`：由模型根据上下文自动决定；
- `round_robin`：轮询；
- `manual`：人工指定；
- `random`：随机；
- 自定义函数：按业务规则精细控制。

从实验角度看，`auto` 很方便；从工程角度看，它也意味着额外 LLM 开销和不确定性。尤其当群聊角色较多时，调度成本可能非常可观。

### 7.3 自定义 speaker selection 示例

下面是一个更工程化的发言选择函数：

```python
from autogen import GroupChat

def custom_speaker_selection(last_speaker, groupchat: GroupChat):
    messages = groupchat.messages
    if not messages:
        return groupchat.agent_by_name("planner")

    last_message = messages[-1].get("content", "")

    if last_speaker.name == "planner":
        return groupchat.agent_by_name("engineer")

    if "```python" in last_message or "```bash" in last_message:
        return groupchat.agent_by_name("user_proxy")

    if last_speaker.name == "user_proxy":
        return groupchat.agent_by_name("reviewer")

    if last_speaker.name == "reviewer":
        if "需要修复" in last_message:
            return groupchat.agent_by_name("engineer")
        return groupchat.agent_by_name("planner")

    return groupchat.agent_by_name("planner")
```

在创建群聊时这样接入：

```python
groupchat = GroupChat(
    agents=[user_proxy, planner, engineer, reviewer],
    messages=[],
    max_round=12,
    speaker_selection_method=custom_speaker_selection,
)
```

### 7.4 为什么很多场景推荐自定义调度

自定义调度有几个明显好处：

- 行为可预测；
- 逻辑可调试；
- 减少额外 LLM 调度成本；
- 便于加入安全与状态约束；
- 更适合后续接入监控与审计。

我的经验是：

- 原型阶段可以先用 `auto` 验证协作模式；
- 进入实用阶段后，应尽早把关键路径规则化；
- 真正生产化时，最好让状态流转尽量显式。

因为当 Agent 数量变多时，你本质上已经在做一个轻量工作流系统了。

---

## 八、代码执行沙箱：AutoGen 的关键竞争力

很多 Agent 框架都能让模型“输出代码”，但真正把 AutoGen 区分出来的能力之一，是它把**代码执行沙箱**做成了对话闭环的一部分。

### 8.1 什么是代码执行沙箱

代码执行沙箱可以理解为一个受控运行环境。Agent 生成的代码不会只停留在文本层面，而是可以在指定环境中运行，然后把执行结果反馈回来。

反馈内容通常包括：

- 标准输出；
- 标准错误；
- 返回码；
- 生成文件；
- 运行异常信息。

当这些信息重新回到会话上下文后，系统就能继续做下一步判断：

- 代码成功了，输出结果总结；
- 代码报错了，按错误继续修复；
- 结果不完整，Reviewer 要求补充；
- 结果危险，安全 Agent 拦截。

### 8.2 为什么这项能力重要

如果只有“代码生成”没有“代码执行”，LLM 很容易出现三类经典问题：

1. 代码看上去对，实际上根本运行不了；
2. 路径、依赖、包名、API 细节经常猜错；
3. 没有真实运行反馈，就谈不上自动修复。

而有了沙箱后，系统就变成：

```text
生成代码 -> 执行代码 -> 收集报错 -> 修改代码 -> 重新执行 -> 输出答案
```

这使 AutoGen 特别适合：

- 自动写脚本并运行；
- 数据分析与可视化；
- SQL / Python / Shell 实验；
- 原型级自动调试；
- 面向结果的研究任务。

---

## 九、Docker 与本地执行：两种沙箱模式的取舍

AutoGen 常见的代码执行方式主要有两种：

- Docker 容器执行；
- 本地环境执行。

二者都能用，但工程含义完全不同。

### 9.1 Docker 执行：推荐的默认选择

示例配置：

```python
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "workspace",
        "use_docker": True,
        "timeout": 120,
    },
)
```

优点：

- 更好的环境隔离；
- 对宿主机破坏面更小；
- 依赖更容易标准化；
- 更适合执行模型生成的非完全可信代码；
- 便于在 CI 或团队环境中复现。

缺点：

- 需要 Docker 正常可用；
- 冷启动通常比本地慢；
- 文件挂载、网络、镜像管理需要额外设计。

如果你的 Agent 系统会自动执行大量模型输出代码，**Docker 应该是默认优先级最高的方案**。

### 9.2 本地执行：开发期方便，风险更高

示例配置：

```python
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "workspace",
        "use_docker": False,
        "timeout": 60,
    },
)
```

优点：

- 启动快；
- 调试简单；
- 直接复用本地 Python 环境和依赖；
- 非常适合个人 PoC。

缺点：

- 可能误读误写本地文件；
- 可能执行危险命令；
- 容易污染本地环境；
- 更容易出现“在我机器上能跑”的环境耦合。

一句话总结：**本地执行适合受控开发实验，不适合直接面对不可信输入。**

### 9.3 沙箱安全设计建议

无论使用 Docker 还是本地执行，都建议至少做好以下限制：

- 设置执行超时时间；
- 限定工作目录；
- 限制可访问文件范围；
- 对 shell 命令做白名单或黑名单控制；
- 记录每次执行日志；
- 限制依赖安装行为；
- 对输出文件做隔离。

如果你在企业环境里使用，还可以进一步增加：

- rootless Docker；
- seccomp / AppArmor；
- 禁止容器联网；
- 只读文件系统；
- 临时挂载工作目录；
- 审计事件上报。

Agent 自动执行代码这件事，一定要按“不可信代码运行”来设计，而不是按“普通开发脚本”来设计。

---

## 十、实战示例：带沙箱的分析型多 Agent 流程

下面给出一个更完整的例子：工程师 Agent 负责写分析脚本，执行器负责运行，Reviewer 负责检查结果是否真的回答了问题。

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

llm_config = {
    "config_list": [{
        "model": "gpt-4o-mini",
        "api_key": "YOUR_API_KEY"
    }],
    "temperature": 0,
}

engineer = AssistantAgent(
    name="engineer",
    system_message=(
        "你是数据工程师。"
        "收到分析任务后，先输出可执行 Python 代码，"
        "代码必须包含读取数据、统计分析、结果打印。"
    ),
    llm_config=llm_config,
)

reviewer = AssistantAgent(
    name="reviewer",
    system_message=(
        "你是分析 reviewer。"
        "请检查运行输出是否真正回答了问题。"
        "如果没有回答完整，就明确指出需要修复的点。"
    ),
    llm_config=llm_config,
)

executor = UserProxyAgent(
    name="executor",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    code_execution_config={
        "work_dir": "analysis_workspace",
        "use_docker": True,
        "timeout": 120,
    },
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
)

groupchat = GroupChat(
    agents=[executor, engineer, reviewer],
    messages=[],
    max_round=10,
)

manager = GroupChatManager(groupchat=groupchat, llm_config=llm_config)

executor.initiate_chat(
    manager,
    message=(
        "请用 Python 读取 sales.csv，计算总销售额、平均客单价、"
        "销量最高的前三个商品，并用简洁文字总结。最后回复 TERMINATE。"
    )
)
```

### 10.1 这个流程体现了什么

这个例子展示了一个很重要的工程闭环：

- Agent 不是只给建议，而是真的写脚本；
- 执行器不是只转发消息，而是真的运行代码；
- Reviewer 不是只判断“代码优雅不优雅”，而是判断“是否回答了业务问题”；
- 若输出不完整，系统会继续迭代，而不是停在第一版答案。

这使得 AutoGen 在“结果导向型任务”上明显强于只做文本生成的框架用法。

---

## 十一、自定义 Agent：让 Agent 不止依赖 Prompt

很多人做 Agent 项目时，容易陷入“把所有逻辑都写在系统提示词里”的思路。Prompt 很重要，但 AutoGen 真正的扩展性并不只来自 Prompt，还来自：

- 自定义 Agent；
- 注册回复函数；
- 规则驱动消息处理；
- 工具或函数调用扩展。

### 11.1 注册 reply handler

我们可以构造一个不依赖 LLM 的安全审计 Agent，用规则检测危险代码：

```python
from autogen import ConversableAgent

security_guard = ConversableAgent(
    name="security_guard",
    system_message="你是安全审计代理，负责检测危险代码和命令。",
    llm_config=False,
)

def security_check(recipient, messages, sender, config):
    content = messages[-1].get("content", "")
    risky_patterns = ["rm -rf", "os.remove(", "subprocess.run(", "shutil.rmtree("]
    for pattern in risky_patterns:
        if pattern in content:
            return True, {
                "content": f"检测到潜在危险操作：{pattern}。请改写为安全方案。"
            }
    return False, None

security_guard.register_reply(
    trigger=[ConversableAgent, None],
    reply_func=security_check,
)
```

这个例子体现出 AutoGen 的一个很重要的工程特性：**不是所有 Agent 都必须依赖大模型。** 某些 Agent 完全可以是规则驱动的守门员。

### 11.2 规则与 LLM 的混合设计

在可控系统里，通常建议这样分工：

- 高确定性任务交给规则；
- 需要创造性与模糊判断的任务交给 LLM；
- 结果正确性通过执行器验证；
- 边界行为通过终止条件和安全守卫控制。

这其实也是成熟 Agent 架构的一般原则：**不要把所有判断都交给模型。**

### 11.3 自定义领域专家 Agent

你还可以根据项目需求，为不同领域创建专家：

```python
sql_expert = AssistantAgent(
    name="sql_expert",
    system_message=(
        "你是资深数据库性能优化专家。"
        "擅长分析执行计划、索引设计和慢查询优化。"
    ),
    llm_config=llm_config,
)
```

类似地，你可以创建：

- `api_architect`：API 设计专家；
- `fin_risk_agent`：金融风控专家；
- `log_analyst`：日志诊断专家；
- `doc_reviewer`：文档审核专家。

拆成多个 Agent 的核心价值是**分离上下文和职责边界**。比起一个巨型 Prompt，让多个职责清晰的 Agent 协作，往往更稳定、更易复用。

---

## 十二、终止条件、自动回复与防失控设计

AutoGen 很强的一点是可以自动持续对话，但这也意味着如果你不认真做边界控制，系统很容易失控。

### 12.1 常见终止方式

AutoGen 实战中常用的终止方式包括：

- 在消息中使用 `TERMINATE` 作为结束标记；
- 设置 `max_round` 限制群聊轮次；
- 设置 `max_consecutive_auto_reply` 限制连续自动回复；
- 通过业务条件判断任务是否完成；
- 对重复报错或重复消息做熔断。

示例：

```python
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    is_termination_msg=lambda msg: msg.get("content", "").strip().endswith("TERMINATE"),
)
```

### 12.2 常见空转现象

多 Agent 系统里非常常见的空转模式有：

- Reviewer 一直要求“进一步优化”；
- Engineer 每次都重写整段代码而不是修补；
- Planner 不断重复已经说过的计划；
- 执行器总是卡在同一类错误；
- 多个 Agent 争抢同一种职责。

### 12.3 工程上的应对方式

建议从以下几方面做约束：

1. 给每个 Agent 明确“何时停止发言”的标准；
2. 让 Reviewer 的修改意见尽量结构化、具体化；
3. 限制执行失败重试次数；
4. 检测重复输出并提前终止；
5. 给 Planner 限制最多规划轮数；
6. 给 Engineer 限制每轮必须针对上一轮错误修改，而不是全文重写。

本质上，多 Agent 系统并不是“人越多越聪明”，而是“组件越多越需要治理”。

---

## 十三、AutoGen 与其他框架的对比

Agent 框架越来越多，但它们解决问题的方式并不相同。理解 AutoGen 的最好方式之一，就是把它放进整个框架谱系里比较。

| 维度 | AutoGen | CrewAI | LangGraph |
| --- | --- | --- | --- |
| 核心范式 | 对话驱动的多 Agent 协作 | 角色 + 任务驱动的团队协作 | 有状态图编排与流程控制 |
| 最强场景 | 多角色讨论、代码生成与执行闭环 | 内容生产、研究分析、任务委派 | 生产级工作流、强控制流程、状态机 |
| 结构表达 | Agent 之间持续消息交换 | Agent / Task / Crew 明确拆分 | Node / Edge / State 显式定义 |
| 执行闭环 | 原生强调“生成—执行—反馈—修复” | 更强调任务拆解与责任分工 | 更强调路由、分支、重试与可恢复性 |
| 上手难点 | 终止条件、调度策略、上下文失控 | 任务颗粒度与角色边界设计 | 图状态设计、节点编排复杂度 |
| 工程取舍 | 灵活度高，但需要治理自动对话成本 | 结构清晰，但复杂动态协作略受限 | 可控性最强，但抽象层更偏工程化 |

如果你在做框架选型，可以先问自己三个问题：你更需要“让多个 Agent 自然讨论”，还是“把任务明确委派给团队角色”，或者“把整个执行过程做成可追踪状态机”。这三个问题基本就能把 AutoGen、CrewAI、LangGraph 的适用边界区分出来。

### 13.1 与 LangChain 的区别

LangChain 的优势在于组件生态极其丰富：

- Prompt 模板；
- Retriever；
- 各类 Tool Calling 封装；
- 模型与向量库集成；
- 结合 LangSmith 形成较强的观测体系。

但如果你的核心需求是“多个 Agent 围绕同一段任务上下文自然协作”，AutoGen 往往表达得更直接。LangChain 也能做多 Agent，但很多时候需要你自己组合更多抽象层。

可以粗略理解为：

- LangChain 更像通用 LLM 应用装配箱；
- AutoGen 更像对话式多 Agent 协作引擎。

### 13.2 与 LangGraph 的区别

LangGraph 更强调有状态图编排，非常适合：

- 显式状态流转；
- 分支与回退；
- 持久化与恢复；
- 复杂生产流程治理。

它的优势是状态可控、节点明确、流程稳定。相比之下，AutoGen 更偏向“会话驱动的自组织协作”。

一个很直观的类比是：

- LangGraph 更像工作流状态机；
- AutoGen 更像虚拟会议室。

如果你要的是生产级强控制流程，LangGraph 通常更适合；如果你更看重多 Agent 的讨论、交互、试错与代码执行闭环，AutoGen 会更顺手。

### 13.3 与 CrewAI 的区别

CrewAI 也强调多 Agent 协作，但它的使用体验通常更偏“角色 + 任务分派”。对于很多清晰分工的任务，它上手很友好。

而 AutoGen 的区别在于：

- 更强调消息对话；
- 更适合自动持续迭代；
- 代码执行沙箱能力更突出；
- GroupChat 表达更自然。

如果你希望角色之间像一个持续讨论的团队一样工作，AutoGen 的风格往往更贴切。

### 13.4 对比总结表

| 维度 | AutoGen | LangChain | LangGraph | CrewAI |
| --- | --- | --- | --- | --- |
| 核心范式 | 对话式多 Agent | 组件化 LLM 应用 | 有状态图编排 | 角色任务协作 |
| 多 Agent 表达 | 很强 | 中等 | 强，但偏流程化 | 强 |
| 代码执行闭环 | 很强 | 需自行集成 | 可实现 | 中等 |
| 调度可控性 | 中等，需要设计 | 中等 | 很强 | 中等 |
| 生产级状态治理 | 一般 | 一般 | 很强 | 中等 |
| 实验探索体验 | 很好 | 好 | 偏工程化 | 较好 |

所以，AutoGen 不一定是“最万能”的框架，但它在“多 Agent 对话 + 代码执行 + 自动修复”这条能力线上非常有代表性。

---

## 十四、什么时候适合用 AutoGen

并不是所有 Agent 项目都适合 AutoGen。实际选型时，建议从任务特征出发。

### 14.1 适合的场景

以下情况通常很适合使用 AutoGen：

1. **代码生成并运行验证**：写脚本、执行、修复、总结；
2. **数据分析自动化**：让 Agent 生成分析代码并解释结果；
3. **多专家协作评审**：工程师、Reviewer、安全 Agent 共同工作；
4. **研究探索型任务**：允许多个角色讨论、反驳和修正；
5. **人机混合流程**：关键节点人工确认，其余步骤自动运行。

### 14.2 不太适合的场景

以下场景未必优先选 AutoGen：

1. **严格固定的审批流**：工作流引擎更自然；
2. **高并发事务型系统**：需要更强的状态机和队列保障；
3. **合规要求极强的执行环境**：需要定制更严密的沙箱与审计体系；
4. **超长链路生产业务**：单靠对话历史容易膨胀。

### 14.3 一条现实的演进路线

很多团队真正落地时，往往不是“从第一天就把 AutoGen 直接上线”，而是：

- 先用 AutoGen 快速验证协作模式；
- 找出有效角色分工与反馈机制；
- 再把稳定路径沉淀成显式规则或状态机；
- 让 AutoGen 保持在探索层、实验层、辅助层。

这种路线非常现实：**先让对话驱动帮助你发现流程，再把成熟流程工程化。**

---

## 十五、一个更完整的多 Agent 模板

下面给出一个综合模板，包含规划、实现、执行、审查四种角色，可以作为很多项目的起点。

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

llm_config = {
    "config_list": [{
        "model": "gpt-4o-mini",
        "api_key": "YOUR_API_KEY"
    }],
    "temperature": 0,
}

planner = AssistantAgent(
    name="planner",
    system_message="你是任务规划师。先把任务拆解成清晰步骤，再交给 engineer 执行。",
    llm_config=llm_config,
)

engineer = AssistantAgent(
    name="engineer",
    system_message="你是 Python 工程师。你必须输出完整可执行代码，并根据执行反馈修复。",
    llm_config=llm_config,
)

reviewer = AssistantAgent(
    name="reviewer",
    system_message=(
        "你是质量审查员。请检查结果是否正确、是否回答完整、是否存在风险。"
        "如需修改，请明确指出修改点。"
    ),
    llm_config=llm_config,
)

executor = UserProxyAgent(
    name="executor",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    code_execution_config={
        "work_dir": "autogen_project_workspace",
        "use_docker": True,
        "timeout": 120,
    },
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
)

def speaker_selector(last_speaker, groupchat):
    if last_speaker is None:
        return planner

    last_content = groupchat.messages[-1].get("content", "") if groupchat.messages else ""

    if last_speaker.name == "planner":
        return engineer
    if last_speaker.name == "engineer":
        return executor if "```" in last_content else reviewer
    if last_speaker.name == "executor":
        return reviewer
    if last_speaker.name == "reviewer":
        return engineer if "修改" in last_content or "修复" in last_content else planner
    return planner

groupchat = GroupChat(
    agents=[planner, engineer, reviewer, executor],
    messages=[],
    max_round=12,
    speaker_selection_method=speaker_selector,
)

manager = GroupChatManager(groupchat=groupchat, llm_config=llm_config)

executor.initiate_chat(
    manager,
    message=(
        "请编写脚本分析 orders.csv，输出 GMV、订单数、平均订单金额、"
        "按地区汇总结果，并给出一句管理层摘要。任务完成后回复 TERMINATE。"
    )
)
```

这个模板里有几个重要工程思想：

- Planner 不直接写代码，只负责拆解；
- Engineer 只关注实现与修复；
- Executor 负责执行与回传；
- Reviewer 负责质量闭环；
- 发言顺序尽量规则化，降低纯 LLM 调度的不确定性。

如果你想把 AutoGen 真正用起来，这种模板化设计通常比“全靠自由发挥”更稳定。

---

## 十六、常见坑与实践建议

### 16.1 把所有职责塞进一个 Agent

这是最常见的问题之一。看起来省事，实际上会造成：

- 提示词越来越长；
- 角色目标互相冲突；
- 输出时而规划、时而编码、时而评审，边界混乱；
- 调试时很难判断是哪一层出了问题。

更好的做法是显式拆角色。

### 16.2 过度迷信自动调度

完全依赖 `auto` 的 speaker selection 虽然省事，但在复杂流程里经常导致额外 Token 消耗和空转。最佳实践通常是：

- 核心路径规则化；
- 非关键环节允许模型灵活选择；
- 把调度日志纳入观测。

### 16.3 忽略沙箱安全

只要系统会自动执行模型生成代码，就必须把它视为潜在不可信代码。开发环境不是豁免理由。目录隔离、超时、最小权限、日志记录这些措施都不能省。

### 16.4 忽略执行环境一致性

很多所谓的“模型失败”，本质其实是环境失败：

- Python 包版本不一致；
- Docker 镜像和本地环境不同；
- 工作目录不固定；
- 文件路径约定不统一；
- 网络权限在不同机器上不同。

因此，AutoGen 项目要稳定，执行环境本身必须被标准化管理。

### 16.5 终止条件设计过弱

如果没有明确终止条件，系统非常容易出现“其实答案已经够了，但几个 Agent 还在互相建议优化”的情况。终止条件越明确，成本越可控。

---

## 十七、总结

在当前 Agent 框架生态中，AutoGen 的独特价值非常清楚：**它把多 Agent 协作、对话驱动、代码执行和自动修复融合成了一套可直接落地的机制。**

它特别适合这样的任务链路：

```text
讨论问题 -> 制定方案 -> 生成代码 -> 执行代码 -> 根据报错修复 -> 复核结果 -> 输出结论
```

这条链路恰恰是很多真实任务最需要的能力。相比一个只会回答问题的聊天助手，AutoGen 更像一个能边想边做、边做边验证的小型虚拟团队。

如果你准备构建的是：

- 自动代码生成与修复系统；
- 数据分析型 Agent；
- 多专家协作评审系统；
- 带代码沙箱的实验平台；
- 人机混合决策流；

那么 AutoGen 值得深入掌握。

最后给一个最实际的建议：**不要一开始就追求五六个 Agent 的复杂系统，先把“Assistant + UserProxy + Docker 沙箱”的最小闭环跑通。** 当你真正把“生成—执行—反馈—修复”这条链打通，再逐步增加 Planner、Reviewer、安全代理和调度策略，你会更容易构建出稳定、可解释、可维护的多 Agent 系统。

从这个角度看，AutoGen 不只是一个框架，更是一种 Agent 设计方法：把复杂任务拆给多个可协作角色，让模型不仅会说，还能在受控环境中行动、验证并持续改进。这正是多 Agent 系统最迷人的地方。

## 相关阅读

- [CrewAI 实战：多角色 Agent 协作与任务分解策略](/categories/AI%20Agent/CrewAI-%E5%AE%9E%E6%88%98-%E5%A4%9A%E8%A7%92%E8%89%B2-Agent-%E5%8D%8F%E4%BD%9C%E4%B8%8E%E4%BB%BB%E5%8A%A1%E5%88%86%E8%A7%A3%E7%AD%96%E7%95%A5/)
- [AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计](/categories/AI/2026-05-31-ai-agent-orchestration-patterns-react-plan-execute-multi-agent/)
- [LangChain 实战：Chain/Agent/Tool 编排与自定义工具开发](/categories/AI/2026-06-02-langchain-chain-agent-tool-custom-tool-development/)
- [AI Agent 规划能力实战：ReAct/Tree-of-Thought/Graph-of-Thought 推理模式](/categories/AI/2026-06-02-ai-agent-reasoning-patterns-react-tot-got-planning/)