---
title: LLM Function Calling 进阶实战：Parallel Tool Calls/Forced Tool Use/Tool Choice 策略——AI Agent 工具调用的工程化深度优化
date: 2026-06-05 10:00:00
tags: [AI Agent, LLM, Function Calling, 工具调用, Tool Use]
keywords: [LLM Function Calling, Parallel Tool Calls, Forced Tool Use, Tool Choice, AI Agent, 进阶实战, 策略, 工具调用的工程化深度优化, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: "深入解析 LLM Function Calling 高级实战：Parallel Tool Calls 并行调度、Forced Tool Use 强制调用、Tool Choice 策略控制，对比 OpenAI/Anthropic/Gemini 三大平台差异，含生产级 Python 代码示例与工程化最佳实践。"
---


在构建生产级 AI Agent 时，Function Calling 远不止「定义工具 → 发送请求 → 解析结果」这么简单。当你的 Agent 需要同时查询天气、搜索文档、调用数据库，或者在特定场景下强制使用某个工具，甚至精确控制模型是否可以「不调用工具」——这些高级场景需要对 Parallel Tool Calls、Forced Tool Use 和 Tool Choice 策略有深入理解。

如果你只是看过官方文档的入门教程，那么在生产环境中大概率会踩坑：并行调用时一个工具超时拖垮整个请求、跨平台时 tool_choice 参数格式不同导致调用失败、模型「偷懒」不调用工具直接给出编造的答案……这些问题的根源在于对 Function Calling 的高级特性理解不够深入。

本文将从工程实践角度，深入剖析三大主流 LLM 平台（OpenAI、Anthropic Claude、Google Gemini）在这些高级特性上的设计差异，并给出可直接用于生产环境的 Python 代码示例。这不是一份 API 文档的翻译，而是来自实际项目的踩坑总结和工程化思考。

## 一、基础回顾：Function Calling 的核心交互模型

在进入高级话题之前，先快速回顾 Function Calling 的核心交互流程。理解这个流程中每个环节的可配置项，是掌握高级特性的前提。

### 1.1 五步交互流程

1. 开发者在请求中定义 `tools`（函数签名 + 参数 schema）
2. LLM 分析用户意图，决定是否调用工具以及调用哪个工具
3. LLM 返回结构化的工具调用请求（函数名 + 参数）
4. 开发者在本地执行工具，将结果回传给模型
5. LLM 基于工具返回结果生成最终回复

这个流程看似简单，但步骤 2 的决策过程受 `tool_choice` 参数控制，步骤 3 的返回数量受 Parallel Tool Calls 能力影响，而步骤 4 的执行策略（串行/并行/带重试）则完全由开发者决定。这些正是本文讨论的核心。

### 1.2 三大平台的工具定义格式对比

不同平台的工具 schema 格式存在微妙但重要的差异。在封装统一接口时，这些差异极易导致 bug：

```python
# OpenAI 工具定义——嵌套在 function 对象内
openai_tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名称"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["city"]
        }
    }
}]

# Anthropic 工具定义——顶层 input_schema，没有外层 function 包装
anthropic_tools = [{
    "name": "get_weather",
    "description": "获取指定城市的天气信息",
    "input_schema": {
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "城市名称"},
            "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
        },
        "required": ["city"]
    }
}]

# Google Gemini 工具定义——使用 protobuf 风格的 FunctionDeclaration
import google.generativeai as genai

weather_func = genai.protos.FunctionDeclaration(
    name="get_weather",
    description="获取指定城市的天气信息",
    parameters=genai.protos.Schema(
        type=genai.protos.Type.OBJECT,
        properties={
            "city": genai.protos.Schema(type=genai.protos.Type.STRING),
            "unit": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                enum=["celsius", "fahrenheit"]
            )
        },
        required=["city"]
    )
)
```

关键差异总结：OpenAI 使用 JSON Schema 直接嵌套在 `function.parameters` 下，Anthropic 将其放在顶层 `input_schema` 字段，Gemini 则使用 protobuf 风格的 `FunctionDeclaration` 对象。此外，Gemini 还支持直接传入 Python 函数对象并自动解析签名（后面会详细讨论），这在开发体验上是最友好的。

---

## 二、Parallel Tool Calls：并发多工具调用的工程实践

### 2.1 什么是 Parallel Tool Calls

当 LLM 判断需要多个独立工具调用时，它可以在一次响应中返回**多个** tool_use 请求。这就是 Parallel Tool Calls——模型一次性告诉你「我需要同时调用 A、B、C 三个工具」，而不是逐个串行请求后再决定下一步。

这不是一个可选的「高级功能」，而是现代 Agent 系统的性能基石。想象一个典型的场景：用户问「帮我查一下北京和上海今天天气怎么样，顺便查一下两个城市的人口」。一个串行调用的 Agent 会依次执行四个工具调用（天气×2 + 人口×2），而支持并行的 Agent 可以在一轮中同时发起四个请求。

典型并行调用场景包括：
- **多实体查询**：同时查询多个城市的天气、多个股票的价格
- **多数据源聚合**：同时查询数据库、搜索 API 和缓存系统
- **检索 + 计算组合**：同时执行文档搜索和数学计算
- **验证 + 操作组合**：同时验证权限和查询操作目标

### 2.2 三大平台的 Parallel Tool Calls 支持情况

**OpenAI**（GPT-4o、GPT-4.1、o3 等最新模型）：
- 默认支持 Parallel Tool Calls，无需额外配置
- 在 `tool_choice="auto"` 模式下，模型自主决定是否并行
- 返回的 `tool_calls` 列表包含多个独立条目，每个有唯一的 `id`
- 可通过 `parallel_tool_calls=False` 参数显式禁用并行（GPT-4o 及以上模型支持此参数）

**Anthropic Claude**（Claude 3.5 Sonnet、Claude 4 Sonnet/Opus 等）：
- 从 Claude 3.5 开始稳定支持并行工具调用
- 返回多个 `tool_use` 类型的 content block
- 每个 block 有独立的 `id`，用于匹配 tool_result
- 不提供显式禁用并行的参数，模型自主判断

**Google Gemini**（2.0 Flash、2.5 Pro 等）：
- 支持并行 function calls，返回 `function_call` part 列表
- 通过 `functionResponse` 回传结果时需要用 `Part` 列表逐一匹配
- 同样不提供显式禁用并行的参数

值得注意的是，尽管三大平台都支持并行调用，但**模型是否真正发起并行调用是不确定的**。即使工具间完全独立，模型有时仍会选择串行调用。因此，你的代码必须同时兼容串行和并行两种情况。

### 2.3 OpenAI Parallel Tool Calls 完整实战

```python
import asyncio
import json
import time
from openai import AsyncOpenAI

client = AsyncOpenAI()

# 定义多个工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的实时天气信息，包括温度和天气状况",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"}
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_population",
            "description": "获取指定城市的最新常住人口数据",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"}
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_gdp",
            "description": "获取指定城市的 GDP 数据",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"}
                },
                "required": ["city"]
            }
        }
    }
]

# 模拟工具实现（实际场景中替换为真实 API 调用）
async def get_weather(city: str) -> dict:
    """模拟天气 API 调用，包含网络延迟"""
    await asyncio.sleep(0.5)  # 模拟网络延迟
    weather_db = {
        "北京": {"temp": "25°C", "condition": "晴", "humidity": "45%"},
        "上海": {"temp": "22°C", "condition": "多云", "humidity": "68%"},
    }
    return {"city": city, **weather_db.get(city, {"temp": "未知", "condition": "未知"})}

async def get_population(city: str) -> dict:
    """模拟人口数据查询"""
    await asyncio.sleep(0.3)
    pop_db = {"北京": "2154万", "上海": "2489万"}
    return {"city": city, "population": pop_db.get(city, "未知")}

async def get_gdp(city: str) -> dict:
    """模拟 GDP 数据查询"""
    await asyncio.sleep(0.4)
    gdp_db = {"北京": "4.16万亿", "上海": "4.72万亿"}
    return {"city": city, "gdp": gdp_db.get(city, "未知")}

# 工具注册表——统一管理所有可调用工具
TOOL_REGISTRY = {
    "get_weather": get_weather,
    "get_population": get_population,
    "get_gdp": get_gdp,
}

async def execute_single_tool(tool_call) -> dict:
    """执行单个工具调用并格式化结果"""
    func_name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)
    func = TOOL_REGISTRY[func_name]
    result = await func(**args)
    return {
        "tool_call_id": tool_call.id,
        "role": "tool",
        "name": func_name,
        "content": json.dumps(result, ensure_ascii=False)
    }

async def run_parallel_tool_calls():
    """完整的并行工具调用流程"""
    messages = [
        {"role": "user", "content": "请告诉我北京和上海的天气、人口和 GDP"}
    ]

    # 第一步：发送请求，让模型决定需要调用哪些工具
    start = time.time()
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto"  # 让模型自主决定
    )

    assistant_msg = response.choices[0].message
    tool_calls = assistant_msg.tool_calls or []

    print(f"模型决定调用 {len(tool_calls)} 个工具")
    for tc in tool_calls:
        print(f"  - {tc.function.name}({tc.function.arguments})")

    if not tool_calls:
        # 模型没有调用工具，直接返回文本
        print(assistant_msg.content)
        return

    # 第二步：将 assistant 的消息加入对话历史
    messages.append(assistant_msg)

    # 第三步：并发执行所有工具调用——这是性能关键点！
    tool_results = await asyncio.gather(
        *[execute_single_tool(tc) for tc in tool_calls]
    )

    parallel_time = time.time() - start
    print(f"并行执行 {len(tool_results)} 个工具耗时: {parallel_time:.2f}s")

    # 第四步：将所有工具结果一次性回传给模型
    messages.extend(tool_results)

    # 第五步：再次请求模型，基于工具结果生成最终回复
    final_response = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools
    )

    print(final_response.choices[0].message.content)
    print(f"总耗时: {time.time() - start:.2f}s")

asyncio.run(run_parallel_tool_calls())
```

运行这段代码，你可能会看到类似这样的输出：

```
模型决定调用 6 个工具
  - get_weather({"city": "北京"})
  - get_weather({"city": "上海"})
  - get_population({"city": "北京"})
  - get_population({"city": "上海"})
  - get_gdp({"city": "北京"})
  - get_gdp({"city": "上海"})
并行执行 6 个工具耗时: 0.52s
```

关键观察：六个工具并发执行的总耗时约等于最慢的那个工具的耗时（0.5 秒），而不是六个工具的耗时之和（约 2.4 秒）。这就是并行调用的价值——**在四个工具调用、每个耗时 0.5 秒的场景下，串行需要 2 秒，并发只需 0.5 秒，性能提升 75%**。

### 2.4 Anthropic Claude 并行工具调用

Anthropic 的并行调用模式与 OpenAI 有重要区别，特别是在消息结构上：

```python
import asyncio
import json
from anthropic import AsyncAnthropic

client = AsyncAnthropic()

tools = [
    {
        "name": "get_weather",
        "description": "获取城市天气",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"]
        }
    },
    {
        "name": "get_population",
        "description": "获取城市人口",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"]
        }
    }
]

async def run_claude_parallel():
    messages = [{"role": "user", "content": "北京和上海的天气和人口分别是什么？"}]

    # 第一步：发送请求
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        tools=tools,
        messages=messages
    )

    # Claude 的响应中 content 是一个 block 列表
    # 可能包含 text 类型和 tool_use 类型的 block
    tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
    text_blocks = [b for b in response.content if b.type == "text"]

    if text_blocks:
        print(f"模型文本回复: {text_blocks[0].text}")
    print(f"模型请求调用 {len(tool_use_blocks)} 个工具")

    if not tool_use_blocks:
        return

    # 第二步：将 assistant 的完整 content 加入历史
    # 注意：Anthropic 要求保留原始 content 结构，不能只提取 tool_use
    messages.append({"role": "assistant", "content": response.content})

    # 第三步：并发执行工具
    async def execute_tool(block):
        # block.name 是函数名，block.input 是参数字典
        func = TOOL_REGISTRY[block.name]
        result = await func(**block.input)
        return {
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": json.dumps(result, ensure_ascii=False)
        }

    tool_results = await asyncio.gather(
        *[execute_tool(b) for b in tool_use_blocks]
    )

    # 第四步：关键区别——Anthropic 要求 tool_result 以 user role 回传！
    # OpenAI 使用独立的 "tool" 角色，而 Anthropic 放在 "user" 角色中
    messages.append({"role": "user", "content": tool_results})

    # 第五步：最终请求
    final = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        tools=tools,
        messages=messages
    )

    for block in final.content:
        if block.type == "text":
            print(block.text)

asyncio.run(run_claude_parallel())
```

这里有一个极其重要的差异需要特别强调：**Anthropic 的 `tool_result` 必须放在 `user` 角色的消息中**，而 OpenAI 使用独立的 `tool` 角色。这个差异在封装多平台适配器时是最高频的 bug 来源之一。我曾经在一个项目中花了两个小时调试「Claude 返回空回复」的问题，最后发现就是 tool_result 的角色放错了。

### 2.5 禁用并行调用

在某些场景下你可能需要禁用并行调用——比如工具之间有写操作冲突，或者你需要精确控制工具调用顺序：

```python
# OpenAI：显式禁用并行调用
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="auto",
    parallel_tool_calls=False  # 禁用并行，模型只会返回单个 tool_call
)
```

Anthropic 和 Gemini 目前不提供显式禁用并行的 API 参数。如果你需要在这两个平台上强制串行，唯一的办法是在应用层逐个处理工具调用——即每次只回传一个 tool_result，让模型继续决定下一步。

---

## 三、Tool Choice 策略：精确控制模型的工具调用行为

### 3.1 四种 Tool Choice 模式详解

Tool Choice 是 Function Calling 中最被低估的参数之一。它决定了模型「是否有权选择不调用工具」以及「是否有权自由选择调用哪个工具」。用好这个参数，可以实现从开放式对话到精确工具路由的完整控制谱系。

| 模式 | 含义 | 适用场景 | 通俗解释 |
|------|------|---------|---------|
| `auto` | 模型自主决定是否调用、调用哪个 | 通用对话、开放性任务 | 「你自己判断要不要用工具」 |
| `none` | 强制模型不调用任何工具 | 测试、纯对话模式切换 | 「这次不许用工具」 |
| `required` | 强制模型必须调用至少一个工具 | 确保工具被触发的场景 | 「你必须用工具，用哪个你定」 |
| `specific` | 强制调用指定的某个工具 | 精确路由、流水线控制 | 「你必须用这个特定工具」 |

### 3.2 OpenAI 的 Tool Choice 实现

OpenAI 的 tool_choice 支持字符串和对象两种形式：

```python
# 模式一：auto——默认行为，模型自主决策
# 模型会分析用户意图，自行决定是否需要调用工具
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="auto"
)

# 模式二：none——忽略所有工具定义，直接生成文本
# 即使定义了工具，模型也不会调用，相当于完全禁用工具功能
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="none"
)

# 模式三：required——必须调用至少一个工具（但不指定具体哪个）
# 模型在所有可用工具中自行选择，但不能只返回文本
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="required"
)

# 模式四：specific——强制调用指定工具
# 模型必须调用 get_weather，即使用户的问题和天气无关
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice={
        "type": "function",
        "function": {"name": "get_weather"}
    }
)
```

### 3.3 Anthropic 的 Tool Choice 实现

Anthropic 的 tool_choice 在命名和格式上与 OpenAI 有显著差异：

```python
# 模式一：auto——默认行为
response = await client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    tool_choice={"type": "auto"},
    messages=messages
)

# 模式二：any——强制调用至少一个工具（对应 OpenAI 的 required）
# 注意：Anthropic 用 "any" 而非 "required"
response = await client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    tool_choice={"type": "any"},
    messages=messages
)

# 模式三：specific——强制调用指定工具
# 注意格式差异：Anthropic 用 {"type": "tool", "name": "..."}
# OpenAI 用 {"type": "function", "function": {"name": "..."}}
response = await client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    tool_choice={"type": "tool", "name": "get_weather"},
    messages=messages
)
```

重要区别：Anthropic 没有 `none` 模式。要禁止工具调用，直接不传 `tools` 参数即可。这在逻辑上更简洁，但在封装统一接口时需要注意。

### 3.4 Google Gemini 的 Tool Config

Gemini 使用独立的 `tool_config` 参数，设计思路与 OpenAI/Anthropic 都不同：

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_KEY")
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    tools=[weather_func, population_func]
)

# 模式一：AUTO——模型自主决定
response = model.generate_content(
    "北京天气如何？",
    tool_config=genai.protos.ToolConfig(
        function_calling_config=genai.protos.FunctionCallingConfig(
            mode="AUTO"
        )
    )
)

# 模式二：ANY——强制调用至少一个工具
response = model.generate_content(
    "北京天气如何？",
    tool_config=genai.protos.ToolConfig(
        function_calling_config=genai.protos.FunctionCallingConfig(
            mode="ANY"
        )
    )
)

# 模式三：NONE——禁止调用任何工具
response = model.generate_content(
    "聊聊天气吧",
    tool_config=genai.protos.ToolConfig(
        function_calling_config=genai.protos.FunctionCallingConfig(
            mode="NONE"
        )
    )
)

# 模式四：限定范围——ANY + allowed_function_names
# 这是 Gemini 独有的设计：强制调用，但只能从指定列表中选择
response = model.generate_content(
    "北京的情况",
    tool_config=genai.protos.ToolConfig(
        function_calling_config=genai.protos.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["get_weather"]  # 只能调用这个工具
        )
    )
)
```

Gemini 的 `allowed_function_names` 设计是一个亮点——它是一个列表，可以同时允许多个工具，但模型不能选择列表外的工具。这比 OpenAI 的「只能强制一个工具」更灵活。例如，你可以让模型在 `get_weather` 和 `get_forecast` 之间选择，但不能调用 `delete_user`。

### 3.5 三大平台 Tool Choice 能力对比总结

| 特性 | OpenAI | Anthropic | Google Gemini |
|------|--------|-----------|---------------|
| 自动选择 | `"auto"` | `{"type":"auto"}` | `AUTO` |
| 强制调用（不限工具） | `"required"` | `{"type":"any"}` | `ANY` |
| 禁止调用 | `"none"` | 不传 `tools` 参数 | `NONE` |
| 指定单个工具 | `{"type":"function","function":{"name":"x"}}` | `{"type":"tool","name":"x"}` | `ANY` + `allowed_function_names` |
| 指定多个工具 | 不支持 | 不支持 | `allowed_function_names` 列表 |
| 禁用并行调用 | `parallel_tool_calls=False` | 不支持（API层） | 不支持（API层） |

---

## 四、Forced Tool Use：强制工具调用的高级应用场景

### 4.1 为什么需要强制调用工具

在以下场景中，你不能信任模型的「自主判断」——它可能会「偷懒」跳过工具调用，直接基于自己的训练数据编造答案：

1. **工具路由系统**：前置分类器将请求路由到特定工具，后续步骤必须调用对应工具才能完成任务
2. **数据验证流水线**：每次用户输入都必须经过校验工具处理后才能入库
3. **合规性要求**：某些操作必须通过审计日志工具记录，不能遗漏
4. **结构化输出**：利用 Function Calling 作为强制结构化输出的手段（比 JSON Mode 更可靠）
5. **防止幻觉**：对于实时数据查询（天气、股价、库存），强制调用工具确保数据准确性

### 4.2 使用 Forced Tool Use 实现高可靠结构化输出

这是一个被广泛使用但较少被深入讨论的技巧——用 `tool_choice=specific` 强制模型输出特定结构的 JSON：

```python
import json
from openai import OpenAI

client = OpenAI()

# 定义「伪工具」——实际上是输出 schema
# 模型不会真正执行任何操作，只是被迫输出符合 schema 的结构化数据
extraction_tool = [{
    "type": "function",
    "function": {
        "name": "extract_user_info",
        "description": "从自然语言文本中提取用户的结构化个人信息",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "用户姓名，保留原始语言"
                },
                "age": {
                    "type": "integer",
                    "description": "年龄，必须是正整数",
                    "minimum": 0,
                    "maximum": 150
                },
                "email": {
                    "type": "string",
                    "description": "电子邮箱地址",
                    "format": "email"
                },
                "occupation": {
                    "type": "string",
                    "description": "职业或职位"
                },
                "skills": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "技能列表"
                }
            },
            "required": ["name", "age", "email", "occupation"]
        }
    }
}]

def extract_info(text: str) -> dict:
    """使用 forced tool use 提取结构化信息"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "你是一个信息提取助手。从用户输入中准确提取个人信息。"
                           "如果某个字段在文本中没有提及，使用合理的默认值。"
            },
            {"role": "user", "content": text}
        ],
        tools=extraction_tool,
        # 关键：强制调用指定工具——模型不能只返回文本
        tool_choice={
            "type": "function",
            "function": {"name": "extract_user_info"}
        }
    )

    tool_call = response.choices[0].message.tool_calls[0]
    return json.loads(tool_call.function.arguments)

# 使用示例
text = "我叫张明，今年28岁，在腾讯做产品经理，邮箱是zm@qq.com，"
text += "擅长 Python、数据分析和产品设计"

result = extract_info(text)
print(json.dumps(result, ensure_ascii=False, indent=2))
# 输出：
# {
#   "name": "张明",
#   "age": 28,
#   "email": "zm@qq.com",
#   "occupation": "产品经理",
#   "skills": ["Python", "数据分析", "产品设计"]
# }
```

这种方式为什么比 JSON Mode 更可靠？因为：
- **完整的 JSON Schema 校验**：`required` 字段确保必要属性不缺失，`enum` 约束值域
- **函数签名即文档**：参数的 `description` 比 JSON Mode 的 prompt 指引更精确
- **可组合性**：可以定义多个「提取工具」，在不同场景下强制调用不同的工具
- **兼容性更好**：JSON Mode 仅 OpenAI 支持，而 Function Calling 三大平台都支持

### 4.3 多步工具路由中的 Forced Tool Use

在复杂的 Agent 系统中，你可以用 Forced Tool Use 实现一个「两阶段路由」架构：

```python
import json
from typing import Literal
from openai import AsyncOpenAI

client = AsyncOpenAI()

# 阶段一的路由工具定义
routing_tool = [{
    "type": "function",
    "function": {
        "name": "route_to_handler",
        "description": "将用户请求路由到合适的处理器",
        "parameters": {
            "type": "object",
            "properties": {
                "handler": {
                    "type": "string",
                    "enum": ["weather", "database", "search", "math", "general"],
                    "description": "目标处理器类型"
                },
                "confidence": {
                    "type": "number",
                    "description": "路由置信度，0-1之间"
                },
                "reasoning": {
                    "type": "string",
                    "description": "路由决策的理由说明"
                }
            },
            "required": ["handler", "confidence", "reasoning"]
        }
    }
}]

# 每个处理器对应不同的工具集
HANDLER_TOOLS = {
    "weather": [weather_tool],
    "database": [query_db_tool, list_tables_tool],
    "search": [search_docs_tool, search_web_tool],
    "math": [calculator_tool, equation_solver_tool],
    "general": [],  # 通用对话不需要工具
}

async def route_and_execute(user_query: str):
    """
    两阶段路由架构：
    阶段1：用小模型 + required 模式做快速路由（低成本）
    阶段2：用大模型 + 对应工具集执行（高质量）
    """

    # ===== 阶段一：路由决策 =====
    # 使用 gpt-4o-mini 做路由，成本仅为大模型的 1/10
    # tool_choice="required" 确保模型不会「逃避」路由决策
    route_response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "分析用户请求，将其路由到最合适的处理器。"
                           "如果请求涉及多个领域，选择最主要的那个。"
            },
            {"role": "user", "content": user_query}
        ],
        tools=routing_tool,
        tool_choice="required"  # 强制必须路由，不能只返回文本
    )

    route_data = json.loads(
        route_response.choices[0].message.tool_calls[0].function.arguments
    )
    handler = route_data["handler"]
    confidence = route_data["confidence"]

    print(f"路由决策: {handler} (置信度: {confidence})")
    print(f"理由: {route_data['reasoning']}")

    # 置信度过低时降级到通用对话
    if confidence < 0.6:
        handler = "general"

    # ===== 阶段二：领域执行 =====
    domain_tools = HANDLER_TOOLS[handler]

    if not domain_tools:
        # 通用对话，不使用工具
        final = await client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": user_query}]
        )
    else:
        # 使用对应领域的工具集执行
        # tool_choice="auto" 让大模型在具体工具间自主选择
        final = await client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": user_query}],
            tools=domain_tools,
            tool_choice="auto"
        )

    return final.choices[0].message
```

这个模式的核心价值在于：**路由阶段用 `required` 确保模型不会「逃避」决策，执行阶段用 `auto` 给模型灵活度**。小模型负责「分类」，大模型负责「执行」，既保证了路由的确定性，又保持了执行的灵活性。

### 4.4 强制工具调用 + 审计日志

一个合规场景的示例——确保每次敏感操作都被审计记录：

```python
async def execute_with_audit(user_query: str, user_id: str):
    """所有工具调用都自动附加审计日志工具"""

    audit_tool = {
        "type": "function",
        "function": {
            "name": "write_audit_log",
            "description": "记录操作审计日志，每次工具调用都必须记录",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "执行的操作"},
                    "user_id": {"type": "string", "description": "操作用户ID"},
                    "timestamp": {"type": "string", "description": "操作时间"},
                    "details": {"type": "string", "description": "操作详情"}
                },
                "required": ["action", "user_id", "timestamp", "details"]
            }
        }
    }

    # 将审计工具加入工具列表
    all_tools = regular_tools + [audit_tool]

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "你是一个助手。执行任何操作时，必须同时调用 write_audit_log "
                           "工具记录操作日志。审计日志是强制要求，不可跳过。"
            },
            {"role": "user", "content": user_query}
        ],
        tools=all_tools,
        tool_choice="auto"  # 通过 system prompt 引导而非强制
    )

    # 验证审计日志工具是否被调用
    tool_calls = response.choices[0].message.tool_calls or []
    audit_calls = [tc for tc in tool_calls if tc.function.name == "write_audit_log"]

    if not audit_calls:
        # 模型没有调用审计工具——兜底处理
        # 在这里可以强制追加一次审计调用
        print("警告：模型未调用审计工具，强制补充")

    return response
```

---

## 五、并行工具调用的错误处理与容错策略

### 5.1 工具执行失败的三种应对策略

当并行调用多个工具时，其中一个失败了怎么办？这是一个比看起来更复杂的问题，因为你需要在「完整性」和「可用性」之间做权衡：

```python
import asyncio
from dataclasses import dataclass
from typing import Any, Optional

@dataclass
class ToolResult:
    """工具执行结果的结构化表示"""
    success: bool
    tool_name: str
    data: Any = None
    error: Optional[str] = None
    latency_ms: float = 0

async def execute_single_tool_safe(tool_call, timeout: float = 30.0) -> dict:
    """
    安全的单工具执行：捕获所有异常，设置超时
    返回统一格式的 tool_result，无论成功还是失败
    """
    import time
    start = time.time()
    func_name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)

    try:
        result = await asyncio.wait_for(
            call_tool(func_name, args),
            timeout=timeout
        )
        latency = (time.time() - start) * 1000
        return {
            "tool_call_id": tool_call.id,
            "role": "tool",
            "content": json.dumps({
                "status": "success",
                "data": result,
                "latency_ms": round(latency, 1)
            }, ensure_ascii=False)
        }
    except asyncio.TimeoutError:
        latency = (time.time() - start) * 1000
        return {
            "tool_call_id": tool_call.id,
            "role": "tool",
            "content": json.dumps({
                "status": "error",
                "error": f"工具执行超时（{timeout}秒）",
                "latency_ms": round(latency, 1)
            }, ensure_ascii=False)
        }
    except Exception as e:
        latency = (time.time() - start) * 1000
        return {
            "tool_call_id": tool_call.id,
            "role": "tool",
            "content": json.dumps({
                "status": "error",
                "error": f"{type(e).__name__}: {str(e)}",
                "latency_ms": round(latency, 1)
            }, ensure_ascii=False)
        }

async def parallel_execution_with_fallback(tool_calls: list) -> list:
    """
    策略一（推荐）：全部并发，容忍部分失败
    每个工具独立处理异常，失败的工具返回错误信息
    模型会基于部分成功的结果生成回复，或在回复中告知用户某个查询失败
    """
    results = await asyncio.gather(
        *[execute_single_tool_safe(tc) for tc in tool_calls],
        return_exceptions=False  # 异常已在 safe_execute 中被捕获
    )

    # 统计执行情况
    success_count = sum(1 for r in results if '"success"' in r["content"])
    fail_count = len(results) - success_count
    print(f"工具执行结果: {success_count} 成功, {fail_count} 失败")

    return results
```

**策略一（推荐）**：全部并发执行，每个工具独立处理异常，失败的工具返回错误信息。模型会基于部分成功的结果生成回复，或在回复中告知用户某个查询失败。这是最实用的策略，适用于大多数场景。

**策略二**：使用 `asyncio.gather` 的 `return_exceptions=True`，然后根据异常类型决定是否重试或降级。

**策略三**：使用 `asyncio.wait` 配合 `FIRST_EXCEPTION`，任一失败立即取消其余——适用于工具间有强依赖的场景，但在实际中很少见。

### 5.2 带指数退避重试的并行执行

对于网络抖动、临时过载等瞬态错误，重试是最有效的恢复策略：

```python
import asyncio
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type
)

@retry(
    stop=stop_after_attempt(3),           # 最多重试 3 次
    wait=wait_exponential(multiplier=1,   # 指数退避：1s, 2s, 4s
                          min=1, max=10),
    retry=retry_if_exception_type((
        asyncio.TimeoutError,             # 超时重试
        ConnectionError,                  # 网络错误重试
        # 注意：ValueError、KeyError 等逻辑错误不重试
    ))
)
async def call_tool_with_retry(name: str, args: dict) -> dict:
    """带指数退避重试的工具调用"""
    return await asyncio.wait_for(
        TOOL_REGISTRY[name](**args),
        timeout=30.0
    )

async def parallel_execution_with_retry(tool_calls: list) -> list:
    """并行 + 重试的完整方案"""
    
    async def execute_with_retry(tc):
        try:
            result = await call_tool_with_retry(
                tc.function.name,
                json.loads(tc.function.arguments)
            )
            return format_tool_success(tc.id, result)
        except Exception as e:
            # 重试耗尽后，返回降级结果而非抛出异常
            return format_tool_error(
                tc.id,
                f"工具 {tc.function.name} 调用失败（已重试 3 次）: {e}"
            )

    return await asyncio.gather(*[execute_with_retry(tc) for tc in tool_calls])
```

重试策略的黄金法则：**只重试可恢复的错误**。网络超时、5xx 错误、速率限制（429）应该重试；参数校验失败（400）、权限不足（403）、工具不存在（404）不应该重试。

### 5.3 并发控制：Semaphore 限流

当工具数量很多或者工具下游的 API 有速率限制时，需要控制并发数：

```python
async def bounded_parallel_execution(
    tool_calls: list,
    max_concurrent: int = 5,
    timeout_per_tool: float = 30.0
) -> list:
    """
    限制并发数的并行执行
    max_concurrent 根据下游 API 的速率限制来设置
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def bounded_execute(tc):
        async with semaphore:
            return await execute_single_tool_safe(tc, timeout=timeout_per_tool)

    return await asyncio.gather(*[bounded_execute(tc) for tc in tool_calls])
```

在实际生产中，`max_concurrent` 应该根据下游 API 的速率限制来设置。比如你的工具是调用一个限制 10 QPS 的 API，而单次调用耗时约 200ms，那并发数就应该控制在 2（10 QPS × 0.2s = 2 并发）左右，留一些余量可以设为 5。

### 5.4 超时分层策略

不同工具的超时时间应该不同——一个简单的本地缓存查询可能只需 100ms，而一个需要调用外部 API 的工具可能需要 10 秒：

```python
# 工具超时配置——按工具类型设置不同的超时时间
TOOL_TIMEOUTS = {
    "get_weather": 10.0,       # 外部 API，10 秒
    "query_database": 5.0,     # 数据库查询，5 秒
    "search_docs": 15.0,       # 文档搜索，可能较慢
    "get_cache": 1.0,          # 缓存查询，1 秒足够
    "calculate": 2.0,          # 本地计算，2 秒
}

DEFAULT_TIMEOUT = 30.0  # 默认超时

async def execute_with_configured_timeout(tool_call) -> dict:
    """根据工具配置使用不同的超时时间"""
    func_name = tool_call.function.name
    timeout = TOOL_TIMEOUTS.get(func_name, DEFAULT_TIMEOUT)
    return await execute_single_tool_safe(tool_call, timeout=timeout)
```

---

## 六、Gemini 的独特设计与自动函数调用

### 6.1 Gemini 的自动函数调用模式

Gemini 有一个独特的功能——**自动函数调用（Automatic Function Calling）**，它直接接受 Python 函数对象，自动解析签名、生成 schema、甚至自动执行并回传结果：

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_KEY")

def get_weather(city: str) -> str:
    """
    获取指定城市的实时天气信息。

    Args:
        city: 要查询天气的城市名称，例如"北京"、"上海"

    Returns:
        包含天气状况和温度的字符串
    """
    weather_data = {
        "北京": "晴天，25°C，湿度45%",
        "上海": "多云，22°C，湿度68%",
    }
    if city not in weather_data:
        raise ValueError(f"不支持的城市: {city}，支持的城市: {list(weather_data.keys())}")
    return weather_data[city]

def calculate(expression: str) -> float:
    """
    计算数学表达式。

    Args:
        expression: 数学表达式字符串，例如 "2+3*4"

    Returns:
        计算结果
    """
    # 安全的数学表达式求值
    allowed_chars = set("0123456789+-*/.() ")
    if not all(c in allowed_chars for c in expression):
        raise ValueError(f"表达式包含不允许的字符: {expression}")
    return eval(expression)

# 直接传入 Python 函数——Gemini 会自动完成所有工作
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    tools=[get_weather, calculate]  # 直接传函数对象！
)

# Gemini 自动：解析函数签名 → 生成 schema → 调用模型 → 执行函数 → 回传结果
chat = model.start_chat()
response = chat.send_message("北京天气怎么样？2+3*4等于多少？")
print(response.text)
# Gemini 自动并发调用了 get_weather 和 calculate，然后生成汇总回复
```

这个自动模式的开发体验确实很好，但有一个重要的限制：**你无法在工具执行前后插入自定义逻辑**（比如日志记录、权限校验、结果缓存）。对于生产环境，建议使用手动模式。

### 6.2 手动控制模式

在需要自定义逻辑的场景下，使用手动模式：

```python
from google.generativeai.protos import Part, FunctionResponse

# 手动模式：自己控制工具执行
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    tools=[get_weather, calculate]
)

chat = model.start_chat()
response = chat.send_message("北京天气和 2+3*4 的结果")

# 检查是否有 function_call
for part in response.parts:
    if fn := part.function_call:
        func_name = fn.name
        args = dict(fn.args)
        print(f"模型请求调用: {func_name}({args})")

        # 这里可以插入自定义逻辑：日志、权限校验、缓存等
        result = TOOL_REGISTRY[func_name](**args)

        # 手动回传结果
        response = chat.send_message(
            Part(function_response=FunctionResponse(
                name=func_name,
                response={"result": str(result)}
            ))
        )
```

---

## 七、跨平台适配层的工程设计

### 7.1 统一适配器架构

在实际项目中，你通常需要支持多个 LLM 提供商（成本优化、故障切换、不同场景选用不同模型）。以下是一个经过生产验证的适配器设计：

```python
from abc import ABC, abstractmethod
from typing import Literal, Union
from dataclasses import dataclass

@dataclass
class UnifiedToolCall:
    """统一的工具调用表示"""
    id: str
    name: str
    arguments: dict

@dataclass
class UnifiedResponse:
    """统一的响应表示"""
    content: str
    tool_calls: list[UnifiedToolCall] | None

class LLMAdapter(ABC):
    """LLM 工具调用适配器基类"""

    @abstractmethod
    async def chat_with_tools(
        self,
        messages: list,
        tools: list,
        tool_choice: Literal["auto", "none", "required"] | str = "auto"
    ) -> UnifiedResponse:
        """
        统一接口

        tool_choice 接受统一格式：
        - "auto": 自动选择
        - "none": 禁止调用
        - "required": 必须调用（不限工具）
        - "具体工具名": 强制调用指定工具
        """
        pass

    @abstractmethod
    def format_tool_result(
        self, call_id: str, name: str, result: str
    ) -> dict:
        """格式化工具结果为该平台要求的格式"""
        pass

    @abstractmethod
    def build_tool_result_message(self, results: list[dict]) -> dict:
        """构建包含工具结果的消息（不同平台格式不同）"""
        pass


class OpenAIAdapter(LLMAdapter):
    """OpenAI 适配器"""

    def __init__(self, model: str = "gpt-4o"):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI()
        self.model = model

    async def chat_with_tools(self, messages, tools, tool_choice="auto"):
        # 将统一的 tool_choice 转为 OpenAI 格式
        if tool_choice in ("auto", "none", "required"):
            tc = tool_choice
        else:
            tc = {"type": "function", "function": {"name": tool_choice}}

        resp = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tools if tools else None,
            tool_choice=tc if tools else None
        )
        msg = resp.choices[0].message

        tool_calls = None
        if msg.tool_calls:
            tool_calls = [
                UnifiedToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=json.loads(tc.function.arguments)
                )
                for tc in msg.tool_calls
            ]

        return UnifiedResponse(content=msg.content or "", tool_calls=tool_calls)

    def format_tool_result(self, call_id, name, result):
        return {
            "tool_call_id": call_id,
            "role": "tool",
            "name": name,
            "content": result
        }

    def build_tool_result_message(self, results):
        # OpenAI：每个 tool_result 是独立的消息
        return results  # OpenAI 直接 append 列表


class AnthropicAdapter(LLMAdapter):
    """Anthropic Claude 适配器"""

    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        from anthropic import AsyncAnthropic
        self.client = AsyncAnthropic()
        self.model = model

    async def chat_with_tools(self, messages, tools, tool_choice="auto"):
        # 转换 tool_choice 格式
        if tool_choice == "auto":
            tc = {"type": "auto"}
        elif tool_choice == "required":
            tc = {"type": "any"}
        elif tool_choice == "none":
            tc = None
        else:
            tc = {"type": "tool", "name": tool_choice}

        # 转换消息格式（OpenAI 格式 → Anthropic 格式）
        anthropic_messages = self._convert_messages(messages)

        kwargs = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": anthropic_messages,
        }
        if tools and tool_choice != "none":
            kwargs["tools"] = tools
            if tc:
                kwargs["tool_choice"] = tc

        resp = await self.client.messages.create(**kwargs)

        tool_calls = [
            UnifiedToolCall(
                id=b.id,
                name=b.name,
                arguments=b.input
            )
            for b in resp.content if b.type == "tool_use"
        ]

        text = "\n".join(
            b.text for b in resp.content
            if hasattr(b, "text") and b.text
        )

        return UnifiedResponse(
            content=text,
            tool_calls=tool_calls if tool_calls else None
        )

    def format_tool_result(self, call_id, name, result):
        return {
            "type": "tool_result",
            "tool_use_id": call_id,
            "content": result
        }

    def build_tool_result_message(self, results):
        # Anthropic：tool_result 必须放在 user 角色中
        return {"role": "user", "content": results}
```

### 7.2 适配器使用示例

```python
async def universal_tool_call_loop(
    adapter: LLMAdapter,
    user_query: str,
    tools: list,
    tool_executor: callable
):
    """通用的工具调用循环，适配任何平台"""
    messages = [{"role": "user", "content": user_query}]

    for round_num in range(5):  # 最多 5 轮
        response = await adapter.chat_with_tools(
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        if not response.tool_calls:
            return response.content  # 模型不再调用工具，返回最终文本

        # 并发执行工具
        results = await asyncio.gather(*[
            execute_and_format(adapter, tc, tool_executor)
            for tc in response.tool_calls
        ])

        # 更新消息历史（平台特定格式）
        messages.append({
            "role": "assistant",
            "content": [{"type": "tool_use", **tc.__dict__}]
            if isinstance(adapter, AnthropicAdapter)
            else response
        })
        messages.append(adapter.build_tool_result_message(results))

    return "达到最大工具调用轮次限制"
```

---

## 八、生产环境最佳实践与踩坑指南

### 8.1 工具定义的黄金法则

```python
# ❌ 错误示例：描述模糊、缺少参数约束
bad_tool = {
    "name": "search",
    "description": "搜索",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string"}
        }
    }
}

# 问题：
# 1. "search" 太模糊，搜索什么？文档？用户？商品？
# 2. "搜索" 描述太少，模型不知道何时该调用这个工具
# 3. query 没有描述，模型不知道该传什么格式

# ✅ 正确示例：描述清晰、参数有类型和约束
good_tool = {
    "name": "search_knowledge_base",
    "description": "在企业知识库中搜索技术文档和FAQ。"
                   "适用于查找产品文档、技术规范、常见问题解答。"
                   "不适用于搜索用户数据或实时信息。",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词或自然语言问题，建议使用具体的描述性语言"
            },
            "limit": {
                "type": "integer",
                "description": "返回结果数量上限，默认 10",
                "minimum": 1,
                "maximum": 50
            },
            "category": {
                "type": "string",
                "enum": ["tech", "product", "faq", "policy"],
                "description": "文档分类过滤，不指定则搜索全部分类"
            },
            "date_from": {
                "type": "string",
                "description": "起始日期，格式 YYYY-MM-DD",
                "format": "date"
            }
        },
        "required": ["query"]
    }
}
```

工具定义的最佳实践：
- **函数名使用动词短语**：`get_weather` 而非 `weather`，`search_docs` 而非 `docs`
- **描述要说明「何时使用」和「何时不使用」**：帮助模型做正确的决策
- **每个参数都要有 description**：这是模型生成正确参数的关键线索
- **使用 `enum` 约束可选值**：减少模型生成无效参数的概率
- **使用 `required` 标记必要字段**：避免模型遗漏关键参数

### 8.2 并行工具调用的四大陷阱

**陷阱一：工具间存在隐式依赖**

```python
# ❌ 危险：工具 B 依赖工具 A 的结果，不能并行调用
# 调用 order_id = create_order(product_id, quantity)
# 然后  process_payment(order_id, amount)  # 需要 order_id！

# ✅ 正确：识别依赖关系，分阶段执行
# 第一阶段（并行）：查询产品信息、检查用户余额、验证库存
# 第二阶段（串行）：基于结果创建订单
# 第三阶段（串行）：处理支付并更新库存
```

**陷阱二：并行结果的顺序不保证**

```python
# ❌ 错误：假设 tool_calls 的顺序和 tool_results 一一对应
# asyncio.gather 会保持输入的顺序，但不能依赖 tool_calls 的返回顺序
for i, tc in enumerate(tool_calls):
    result = tool_results[i]  # 不安全！如果中间有异常处理逻辑

# ✅ 正确：通过 tool_call_id 匹配
result_map = {r["tool_call_id"]: r for r in tool_results}
for tc in tool_calls:
    result = result_map[tc.id]  # 安全、可靠
```

**陷阱三：并行调用中同一个工具被多次写入**

当用户问「比较北京和上海的天气」时，模型可能返回两个 `get_weather` 调用，参数不同。你的工具实现必须是**线程安全**或**无副作用**的。如果工具涉及数据库写入，要特别小心并发写入冲突。

**陷阱四：Token 爆炸**

并行工具返回的所有结果都会注入上下文窗口。如果每个工具返回 2000 token，六个并行调用就是 12000 token，加上用户消息和系统提示，很容易逼近或超过模型的上下文限制。

```python
def truncate_tool_result(result: str, max_chars: int = 2000) -> str:
    """截断过长的工具返回结果，保留关键信息"""
    if len(result) <= max_chars:
        return result
    return result[:max_chars] + f"\n... [结果已截断，原始长度 {len(result)} 字符]"
```

### 8.3 多轮工具调用的无限循环防护

```python
async def tool_call_loop_with_guard(
    messages: list,
    tools: list,
    max_rounds: int = 5,
    max_total_tool_calls: int = 20
) -> str:
    """
    带多重防护的工具调用循环

    防护措施：
    1. max_rounds：最大轮次限制（一轮可能包含多个并行工具调用）
    2. max_total_tool_calls：最大总工具调用次数
    """
    total_calls = 0

    for round_num in range(max_rounds):
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content  # 正常结束

        # 检查总调用次数限制
        round_calls = len(msg.tool_calls)
        if total_calls + round_calls > max_total_tool_calls:
            # 超过限制，强制结束工具调用
            messages.append({
                "role": "system",
                "content": "工具调用次数已达上限，请基于已有结果直接回复用户。"
            })
            final = await client.chat.completions.create(
                model="gpt-4o",
                messages=messages
            )
            return final.choices[0].message.content

        total_calls += round_calls
        messages.append(msg)

        # 并发执行本轮所有工具
        results = await asyncio.gather(
            *[execute_tool_safe(tc) for tc in msg.tool_calls]
        )
        messages.extend(results)

    # 超过最大轮次
    return "工具调用轮次已达上限，请基于已有结果回复。"
```

在生产环境中，没有这些防护措施的 Agent 曾经出现过无限循环调用工具直到 token 耗尽或费用爆表的事故。`max_rounds` 和 `max_total_tool_calls` 是必须有的安全阀。

### 8.4 Tool Choice 的动态策略

```python
def determine_tool_choice(
    messages: list,
    available_tools: list,
    user_context: dict
) -> str | dict:
    """
    根据上下文动态决定 tool_choice 策略

    策略逻辑：
    1. 闲聊场景 → none（节省不必要的工具调用成本）
    2. 明确的查询意图 → required（确保工具被触发）
    3. 开放性问题 → auto（让模型自主判断）
    4. 特定路由 → specific（强制精确路由）
    """
    last_message = messages[-1]["content"].lower() if messages else ""

    # 闲聊关键词检测——这些场景不需要工具
    chat_keywords = ["你好", "谢谢", "再见", "你是谁", "介绍"]
    if any(kw in last_message for kw in chat_keywords):
        return "none"

    # 查询意图检测——这些场景必须调用工具
    query_keywords = ["查询", "搜索", "帮我查", "告诉我", "多少钱", "天气"]
    if any(kw in last_message for kw in query_keywords):
        # 如果有且只有一个相关工具，直接指定
        relevant_tools = match_relevant_tools(last_message, available_tools)
        if len(relevant_tools) == 1:
            return relevant_tools[0]["name"]  # specific mode
        return "required"  # 让模型在相关工具中选择

    # 默认自动
    return "auto"
```

### 8.5 监控与可观测性

```python
import time
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger("agent.tools")

@asynccontextmanager
async def tool_call_span(tool_name: str, tool_args: dict, call_id: str):
    """
    工具调用的观测上下文管理器
    记录开始/结束时间、成功/失败状态、延迟等关键指标
    """
    start = time.time()

    logger.info(f"工具调用开始: {tool_name}", extra={
        "call_id": call_id,
        "tool": tool_name,
        "args": tool_args,
        "phase": "start"
    })

    try:
        yield
        latency_ms = (time.time() - start) * 1000
        logger.info(f"工具调用成功: {tool_name}", extra={
            "call_id": call_id,
            "tool": tool_name,
            "latency_ms": round(latency_ms, 2),
            "phase": "end",
            "status": "success"
        })
        # 上报 Prometheus 指标
        TOOL_LATENCY.labels(tool=tool_name).observe(latency_ms / 1000)
        TOOL_SUCCESS.labels(tool=tool_name).inc()
    except Exception as e:
        latency_ms = (time.time() - start) * 1000
        logger.error(f"工具调用失败: {tool_name} - {e}", extra={
            "call_id": call_id,
            "tool": tool_name,
            "latency_ms": round(latency_ms, 2),
            "phase": "end",
            "status": "error",
            "error_type": type(e).__name__,
            "error_message": str(e)
        })
        TOOL_FAILURE.labels(tool=tool_name, error_type=type(e).__name__).inc()
        raise
```

在生产环境中，你应该监控以下关键指标：

- **工具调用触发率**：多少百分比的用户请求触发了工具调用？这个指标可以反映 tool_choice 策略是否合理
- **并行调用比例**：多少请求包含多个并行工具调用？这个指标反映模型的工具使用效率
- **单工具 P50/P95/P99 延迟**：每个工具的响应时间分布，用于发现慢工具和性能退化
- **工具调用失败率**：按工具维度拆分的失败率，用于发现不稳定工具
- **Tool Choice 策略命中率**：各种策略被使用的比例，用于优化动态策略

---

## 九、高级编排模式：分阶段与条件工具调用

### 9.1 Fan-out / Fan-in 模式

这是最常用的编排模式——先并行获取数据，再汇总分析：

```python
async def fan_out_fan_in(user_query: str):
    """
    Fan-out / Fan-in 编排模式

    Fan-out 阶段：并行调用多个数据源获取原始数据
    Fan-in 阶段：汇总所有数据后让模型生成分析报告
    """
    # ===== Fan-out 阶段 =====
    # 使用 required 模式确保模型不会跳过数据获取步骤
    data_tools = [database_tool, web_search_tool, cache_tool]

    response1 = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "你是一个数据收集助手。根据用户问题，调用所有相关数据源获取信息。"
            },
            {"role": "user", "content": user_query}
        ],
        tools=data_tools,
        tool_choice="required"  # 强制必须调用数据工具
    )

    # 并行执行所有数据获取
    tool_calls = response1.choices[0].message.tool_calls
    results = await asyncio.gather(*[execute_tool(tc) for tc in tool_calls])

    # ===== Fan-in 阶段 =====
    # 汇总数据后让模型生成最终分析
    messages = [
        {
            "role": "system",
            "content": "你是一个数据分析助手。基于提供的原始数据，生成详细的分析报告。"
        },
        {"role": "user", "content": user_query},
        response1.choices[0].message,  # assistant 的工具调用请求
        *results                        # 所有工具返回结果
    ]

    # Fan-in 阶段不再需要工具，直接生成文本
    response2 = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )

    return response2.choices[0].message.content
```

### 9.2 条件工具调用链

多轮条件调用——模型根据前一轮的结果决定下一步需要调用什么工具：

```python
async def conditional_tool_chain(
    user_query: str,
    max_rounds: int = 5
) -> str:
    """
    支持多轮条件调用的工具链

    关键特性：
    1. 模型根据上下文自主决定每一轮调用什么工具
    2. 支持动态工具选择（不同轮次可能调用不同工具）
    3. 有 max_rounds 防护避免无限循环
    """
    messages = [{"role": "user", "content": user_query}]

    for round_num in range(max_rounds):
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=ALL_TOOLS,
            tool_choice="auto"
        )

        msg = response.choices[0].message

        # 如果模型决定不调用工具，链式调用结束
        if not msg.tool_calls:
            return msg.content or ""

        messages.append(msg)

        # 并行执行本轮所有工具调用
        results = await asyncio.gather(
            *[execute_tool_safe(tc) for tc in msg.tool_calls]
        )
        messages.extend(results)

        print(f"第 {round_num + 1} 轮完成，调用了 "
              f"{len(msg.tool_calls)} 个工具")

    # 防止无限循环的兜底处理
    final = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages + [{
            "role": "system",
            "content": "你已达到最大工具调用轮次，请基于已有结果直接回复用户。"
        }]
    )
    return final.choices[0].message.content
```

---

## 十、总结：从「能用」到「可靠」的工程化思考

Function Calling 的这些高级特性，是从「Demo 能跑」到「生产能用」的关键分水岭。让我总结本文的核心要点：

**关于 Parallel Tool Calls**：
- 始终使用 `asyncio.gather` 并发执行，而非逐个串行。多工具场景下性能可提升 50%-80%
- 通过 `tool_call_id` 匹配结果，不要依赖顺序
- 使用 Semaphore 控制并发数，保护下游 API
- 设置 per-tool 超时，避免一个慢工具拖垮整个请求

**关于 Tool Choice 策略**：
- `auto` 适用于大多数场景，不要过度使用 `required` 或 `specific`
- `required` 在数据获取和路由场景下非常有用，确保模型不逃避工具调用
- `specific` 用于精确路由和结构化输出，是最强的控制手段
- 动态 tool_choice 策略比静态配置更能适应多样化的用户输入

**关于错误处理**：
- 并行调用时一个工具的失败不应该拖垮整个请求，用 `try-except` 兜底
- 只重试可恢复的错误（网络超时、5xx），不重试逻辑错误
- 对工具返回结果做截断或摘要，防止 token 爆炸

**关于跨平台差异**：
- OpenAI、Anthropic、Gemini 在 API 格式、tool_choice 取值、tool_result 回传方式上都有显著差异
- tool_result 的角色（OpenAI 用 `tool`，Anthropic 用 `user`）是最常见的 bug 来源
- 封装统一适配层时，务必覆盖所有边界情况

**关于安全防护**：
- 多轮工具调用链必须有 `max_rounds` 和 `max_total_tool_calls` 双重防护
- 对敏感操作强制审计日志
- 监控工具调用的各项指标，建立告警机制

构建一个真正可靠的 AI Agent 不是一蹴而就的事情。希望本文的实战经验和踩坑总结能帮助你少走弯路，构建出更健壮、更高性能的生产级 Agent 系统。在 Function Calling 这个快速演进的领域，保持对新 API 特性的关注，持续优化你的工具调用策略，是每个 Agent 工程师的必修课。

## 相关阅读

- [AI Agent 工具调用实战：Function Calling 标准化与错误处理](/post/ai-agent-function-calling-standardization-error-handling/) — Function Calling 标准化实践、MCP 协议与错误处理策略，本文的姊妹篇
- [Structured Output 实战：让 LLM 返回结构化 JSON](/post/vercel-ai-sdk-typescript-llm-unified-abstraction-streaming-tool-calls-structured-output-laravel-hybrid-architecture/) — Function Calling 的互补技术，用 JSON Schema 约束 LLM 输出，确保返回可预测的结构化数据
- Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测 — 从 MCP 协议角度理解工具注册与动态发现，Agent 工具生态的基础设施
