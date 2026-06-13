---

title: AI Agent Tool Composition 实战：工具组合与编排——单工具调用 vs 多工具链 vs 并行工具的架构设计
keywords: [AI Agent Tool Composition, 工具组合与编排, 单工具调用, 多工具链, 并行工具的架构设计]
description: 深入解析 AI Agent Tool Composition（工具组合与编排）的三大核心模式——单工具调用、多工具链顺序编排与并行工具执行。本文通过 Python 和 Laravel 完整可运行代码示例，详解 Function Calling 的架构设计、错误处理与回滚机制、熔断器与补偿事务、混合编排决策树，帮助开发者将 AI Agent 从单工具演示升级为生产级多工具编排系统，覆盖可观测性、幂等性与死信队列等工程最佳实践。
date: 2026-06-06 08:00:00
tags:
- AI Agent
- tool-composition
- Function Calling
- 架构设计
- 编排
- 工具链
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



## 前言：为什么工具组合是 AI Agent 的核心命题？

在构建 AI Agent 应用的早期阶段，我们通常会注册一系列独立的工具（Tools）供模型调用——查天气、搜索数据库、发送邮件、调用支付接口等。当场景从"单一查询"走向"复杂任务"时，一个根本性的工程问题浮现出来：**如何将多个工具有效地组合与编排？**

试想一个看似简单的场景："帮我查一下北京到上海的航班，选最便宜的那班，然后订票并通知我的同事张三。"这个任务拆解下来涉及多个工具的协调配合：首先调用航班搜索接口获取航班列表，然后根据价格排序选出最优选项，接着调用预订接口锁定座位和创建订单，最后发送通知消息给同事。这些工具之间存在清晰的数据依赖关系——后续步骤必须等待前面的结果才能执行。同时还要考虑各种异常情况，比如支付失败后需要释放已经锁定的座位，通知发送失败后至少要保证订单状态的一致性。

这正是 **Tool Composition（工具组合）** 这一架构概念所要解决的核心问题。简单来说，Tool Composition 是指将多个独立的工具能力按照特定的编排策略组合在一起，形成一个能够完成复杂任务的工具执行管线。它不仅仅是一个技术实现问题，更是一个涉及系统可靠性、可扩展性和可维护性的架构设计问题。

本文将从三种核心编排模式出发——**单工具调用、多工具链（顺序编排）、并行工具执行**——结合 Python 和 Laravel 的完整实战代码，给出生产可用的架构设计思路、错误处理策略以及决策树，帮助你在实际项目中做出正确的技术选择。

---

## 一、单工具调用模式（Single Tool Call）

### 1.1 模式概述与适用场景

单工具调用是最基础也是最常见的模式。在这种模式下，Agent 接收到用户的自然语言请求后，大语言模型（LLM）根据上下文意图决定调用某一个工具，获取结果后再由 LLM 进行总结或格式化，最终返回给用户。整个流程只有一次工具调用，结构简单明了。

这种模式最适用的场景包括以下几类：第一，用户意图非常清晰明确，可以直接映射到某一个工具能力，比如"北京今天天气怎么样"显然只需要调用天气查询工具；第二，工具的返回结果本身就是最终答案，不需要进一步的数据加工或传递；第三，整个交互过程中不存在跨工具的状态依赖，一个工具的输出不需要作为另一个工具的输入。

### 1.2 架构流程

单工具调用的标准执行流程如下：

```
用户消息 → LLM 决策（选择工具 + 参数） → 工具执行 → LLM 总结回复 → 用户
```

在这个流程中，LLM 充当了两个关键角色：首先是**意图路由器**，根据用户消息决定是否需要调用工具以及调用哪个工具；其次是**结果格式化器**，将工具返回的结构化数据转换为自然语言回复。

### 1.3 Python 完整实现

以下是一个基于 OpenAI Function Calling 接口的单工具调用完整实现，包含了工具定义、调用执行和结果处理三个核心环节：

```python
import json
from openai import OpenAI

client = OpenAI()

# 定义可用工具列表，每个工具包含名称、描述和参数 schema
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市的当前天气信息，包括温度、天气状况和湿度",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如'北京'、'上海'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "温度单位，默认摄氏度"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# 工具的实际执行函数
def get_weather(city: str, unit: str = "celsius") -> dict:
    """调用天气 API 获取实时天气数据"""
    # 生产环境中替换为真实的天气 API 调用，如 OpenWeatherMap
    weather_data = {
        "北京": {"temp": 28, "condition": "晴", "humidity": 45},
        "上海": {"temp": 31, "condition": "多云", "humidity": 72},
    }
    data = weather_data.get(city, {"temp": 22, "condition": "未知", "humidity": 50})
    if unit == "fahrenheit":
        data["temp"] = round(data["temp"] * 9/5 + 32)
        data["unit"] = "°F"
    else:
        data["unit"] = "°C"
    data["city"] = city
    return data

def run_single_tool_agent(user_message: str) -> str:
    """
    单工具调用的完整 Agent 流程。
    第一轮：LLM 决策是否调用工具
    第二轮（如有工具调用）：将工具结果反馈给 LLM 生成最终回复
    """
    messages = [
        {"role": "system", "content": "你是一个有用的助手，可以查询天气信息。"},
        {"role": "user", "content": user_message}
    ]

    # 第一轮 LLM 调用：决策阶段
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
        tool_choice="auto"  # 让 LLM 自主决定是否调用工具
    )

    msg = response.choices[0].message

    # 检查 LLM 是否决定调用工具
    if msg.tool_calls:
        tool_call = msg.tool_calls[0]
        function_name = tool_call.function.name
        arguments = json.loads(tool_call.function.arguments)

        print(f"[调试] LLM 决定调用工具: {function_name}({arguments})")

        # 执行工具
        tool_result = get_weather(**arguments)

        # 将助手消息和工具结果追加到对话历史
        messages.append(msg)  # 包含 tool_calls 的助手消息
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(tool_result, ensure_ascii=False)
        })

        # 第二轮 LLM 调用：基于工具结果生成自然语言回复
        final_response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        return final_response.choices[0].message.content

    # LLM 认为不需要调用工具，直接返回回复
    return msg.content

# 运行示例
result = run_single_tool_agent("北京今天天气怎么样？需要穿外套吗？")
print(result)
```

### 1.4 Laravel 实现示例

在 Laravel 生态中，我们可以借助 `openai-php/laravel` 包来实现同样的功能，并且利用 Laravel 的依赖注入和服务容器机制来更好地管理工具服务：

```php
<?php

namespace App\Services\Agent;

use App\Services\WeatherService;
use Illuminate\Support\Facades\Log;
use OpenAI\Laravel\Facades\OpenAI;

class SingleToolAgent
{
    public function __construct(
        private WeatherService $weatherService
    ) {}

    public function handle(string $userMessage): string
    {
        $tools = $this->buildToolDefinitions();

        $messages = [
            ['role' => 'system', 'content' => '你是一个有用的助手，可以查询天气信息。'],
            ['role' => 'user', 'content' => $userMessage],
        ];

        // 第一轮调用：让 LLM 决策
        $response = OpenAI::chat()->create([
            'model' => 'gpt-4o',
            'messages' => $messages,
            'tools' => $tools,
            'tool_choice' => 'auto',
        ]);

        $message = $response->choices[0]->message;

        if (!empty($message->toolCalls)) {
            $toolCall = $message->toolCalls[0];
            $args = json_decode($toolCall->function->arguments, true);

            Log::info('Agent 调用工具', [
                'tool' => $toolCall->function->name,
                'args' => $args,
            ]);

            // 通过服务容器执行具体的工具逻辑
            $result = $this->weatherService->getWeather(
                city: $args['city'],
                unit: $args['unit'] ?? 'celsius'
            );

            $messages[] = [
                'role' => 'assistant',
                'tool_calls' => [$toolCall->toArray()],
            ];
            $messages[] = [
                'role' => 'tool',
                'tool_call_id' => $toolCall->id,
                'content' => json_encode($result, JSON_UNESCAPED_UNICODE),
            ];

            // 第二轮调用：基于工具结果生成回复
            $final = OpenAI::chat()->create([
                'model' => 'gpt-4o',
                'messages' => $messages,
            ]);

            return $final->choices[0]->message->content;
        }

        return $message->content;
    }

    private function buildToolDefinitions(): array
    {
        return [[
            'type' => 'function',
            'function' => [
                'name' => 'get_weather',
                'description' => '查询指定城市的当前天气信息',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'city' => ['type' => 'string', 'description' => '城市名称'],
                        'unit' => [
                            'type' => 'string',
                            'enum' => ['celsius', 'fahrenheit'],
                            'description' => '温度单位',
                        ],
                    ],
                    'required' => ['city'],
                ],
            ],
        ]];
    }
}
```

### 1.5 单工具调用的错误处理策略

单工具调用的错误处理相对直接但不容忽视。核心策略是**将异常信息以工具角色回传给 LLM**，让 LLM 生成用户友好的错误说明。具体做法是在工具执行层捕获所有异常，将错误信息格式化为 JSON 后作为 `tool` 角色消息追加到对话历史中。LLM 会理解这是工具返回的错误信息，并据此生成自然语言的错误提示。

此外还应该实现重试机制：对于网络超时等瞬时故障，可以在工具层设置指数退避重试，最多重试三次。对于参数校验错误等确定性失败，则不需要重试，直接返回错误即可。这种区分对待可以避免对不可恢复的错误进行无效重试，浪费时间和资源。

---

## 二、多工具链模式（Sequential Tool Chain）

### 2.1 模式概述与核心特征

当一个复杂任务需要多个工具**按严格顺序依次执行**，并且后续工具的输入依赖于前面工具的输出时，就形成了**工具链（Tool Chain）**。这是在生产环境中最常见也最需要精心设计的编排模式。

工具链模式有三个核心特征需要特别关注。首先是**数据依赖性**：工具之间存在明确的数据流向，工具 B 的参数可能完全来自工具 A 的返回结果。这意味着执行顺序不能随意调整，必须按照依赖关系的拓扑排序来执行。其次是**事务一致性**：由于多个工具共同完成一个原子性任务，任何一环的失败都可能导致系统处于不一致状态，因此需要设计完善的回滚或补偿机制。最后是**状态可追踪性**：每个工具步骤的执行状态（成功、失败、已回滚）都需要被记录，这不仅是为了错误处理，也是为了调试、审计和监控。

### 2.2 架构流程

```
用户请求 → LLM 决策
         → 工具 A 执行 → 获取结果 A
         → 工具 B 执行（输入来自结果 A）→ 获取结果 B
         → 工具 C 执行（输入来自结果 B）→ 获取结果 C
         → LLM 聚合所有结果 → 生成最终回复
```

在整个执行过程中，编排器需要维护一个**上下文对象（Context）**，它随着每一步的执行不断积累数据。每一步的输出都会被合并到上下文中，供后续步骤按需读取。这种设计既保证了数据的正确传递，又提供了良好的调试能力——任何时候都可以通过检查上下文对象来了解当前的执行状态。

### 2.3 生产级工具链编排器实现

以下是一个功能完整的工具链编排器实现，支持顺序执行、上下文传递、回滚机制和状态追踪：

```python
import json
import uuid
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger("tool_chain")

class StepStatus(Enum):
    """工具步骤的执行状态"""
    PENDING = "pending"       # 待执行
    RUNNING = "running"       # 执行中
    SUCCESS = "success"       # 执行成功
    FAILED = "failed"         # 执行失败
    ROLLED_BACK = "rolled_back"  # 已回滚

@dataclass
class ToolStep:
    """工具链中的单个步骤定义"""
    name: str
    tool_fn: Callable          # 工具执行函数
    rollback_fn: Optional[Callable] = None  # 回滚函数
    status: StepStatus = StepStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    duration_ms: float = 0

@dataclass
class ToolChain:
    """
    工具链编排器。
    支持顺序执行、上下文传递、失败回滚和状态追踪。
    """
    steps: list[ToolStep] = field(default_factory=list)
    context: dict = field(default_factory=dict)

    def add_step(self, name: str, tool_fn: Callable,
                 rollback_fn: Optional[Callable] = None) -> "ToolChain":
        """向工具链追加一个步骤，支持链式调用"""
        self.steps.append(ToolStep(name=name, tool_fn=tool_fn,
                                    rollback_fn=rollback_fn))
        return self

    def execute(self, initial_input: dict) -> dict:
        """
        顺序执行工具链中的所有步骤。
        任何步骤失败时自动触发回滚，从最近的成功步骤逆序执行回滚函数。
        """
        import time
        completed_steps = []
        current_input = initial_input.copy()

        for i, step in enumerate(self.steps):
            step.status = StepStatus.RUNNING
            start_time = time.monotonic()

            try:
                logger.info(f"执行步骤 [{i+1}/{len(self.steps)}]: {step.name}")
                result = step.tool_fn(current_input)

                step.status = StepStatus.SUCCESS
                step.result = result
                step.duration_ms = (time.monotonic() - start_time) * 1000
                completed_steps.append(step)

                # 将当前步骤的输出合并到上下文
                current_input.update(result)
                self.context[step.name] = result

                logger.info(f"步骤 {step.name} 执行成功 ({step.duration_ms:.0f}ms)")

            except Exception as e:
                step.status = StepStatus.FAILED
                step.error = str(e)
                step.duration_ms = (time.monotonic() - start_time) * 1000

                logger.error(f"步骤 {step.name} 执行失败: {e}")

                # 触发回滚流程
                rolled_back = self._rollback(completed_steps, current_input)

                return {
                    "success": False,
                    "failed_at_step": step.name,
                    "failed_at_index": i,
                    "error": str(e),
                    "completed_steps": [s.name for s in completed_steps],
                    "rolled_back_steps": rolled_back,
                    "context": self.context
                }

        return {
            "success": True,
            "context": self.context,
            "step_results": {s.name: s.result for s in self.steps},
            "total_duration_ms": sum(s.duration_ms for s in self.steps)
        }

    def _rollback(self, completed_steps: list[ToolStep], context: dict) -> list[str]:
        """从最近的成功步骤开始，逆序执行回滚函数"""
        rolled_back = []
        for step in reversed(completed_steps):
            if step.rollback_fn:
                try:
                    logger.info(f"回滚步骤: {step.name}")
                    step.rollback_fn(context)
                    step.status = StepStatus.ROLLED_BACK
                    rolled_back.append(step.name)
                except Exception as rollback_error:
                    # 回滚失败是严重问题，需要记录并告警
                    logger.critical(
                        f"步骤 {step.name} 回滚失败: {rollback_error}，"
                        f"系统可能处于不一致状态，需要人工介入！"
                    )
                    # 实际生产中这里应该发送告警通知
        return rolled_back
```

### 2.4 实战场景：电商订单处理流水线

以电商系统中的订单创建流程为例，这是一个典型的多工具链场景。工具链为：**库存校验 → 创建订单 → 扣减库存 → 发送确认通知**。每一步都有对应的回滚操作：

```python
# ---------- 具体业务工具函数 ----------

def check_inventory(input_data: dict) -> dict:
    """校验商品库存是否充足"""
    product_id = input_data["product_id"]
    requested_qty = input_data["quantity"]
    # 生产环境中查询数据库或调用库存服务
    available_stock = InventoryService.get_stock(product_id)
    if available_stock < requested_qty:
        raise ValueError(
            f"库存不足: 商品 {product_id} 需要 {requested_qty} 件，"
            f"当前仅剩 {available_stock} 件"
        )
    return {"available_stock": available_stock, "reserved_quantity": requested_qty}

def create_order(input_data: dict) -> dict:
    """创建订单记录"""
    order_id = f"ORD-{uuid.uuid4().hex[:8].upper()}"
    order = {
        "order_id": order_id,
        "product_id": input_data["product_id"],
        "quantity": input_data["reserved_quantity"],
        "status": "pending",
        "total_amount": input_data.get("unit_price", 99.9) * input_data["reserved_quantity"]
    }
    # 写入数据库
    OrderRepository.create(order)
    return {"order_id": order_id, "order_status": "pending"}

def rollback_order(input_data: dict) -> None:
    """回滚操作：取消已创建的订单"""
    order_id = input_data.get("order_id")
    if order_id:
        OrderRepository.cancel(order_id)
        logger.info(f"已取消订单: {order_id}")

def deduct_inventory(input_data: dict) -> dict:
    """扣减库存"""
    order_id = input_data["order_id"]
    product_id = input_data["product_id"]
    quantity = input_data["reserved_quantity"]
    InventoryService.deduct(product_id, quantity, reference_order=order_id)
    return {"inventory_updated": True, "remaining_stock": InventoryService.get_stock(product_id)}

def rollback_inventory(input_data: dict) -> None:
    """回滚操作：恢复已扣减的库存"""
    product_id = input_data.get("product_id")
    quantity = input_data.get("reserved_quantity", 0)
    if product_id and quantity:
        InventoryService.restore(product_id, quantity)
        logger.info(f"已恢复库存: {product_id} +{quantity}")

def send_order_confirmation(input_data: dict) -> dict:
    """发送订单确认通知（此步骤失败不影响订单本身）"""
    order_id = input_data["order_id"]
    # 发送邮件、短信或站内信
    NotificationService.send_order_created(order_id)
    return {"notification_sent": True}

# ---------- 组装并执行工具链 ----------

def process_order(product_id: str, quantity: int, unit_price: float = 99.9) -> dict:
    chain = ToolChain()
    chain.add_step("check_inventory", check_inventory)
    chain.add_step("create_order", create_order, rollback_fn=rollback_order)
    chain.add_step("deduct_inventory", deduct_inventory, rollback_fn=rollback_inventory)
    chain.add_step("send_confirmation", send_order_confirmation)
    # 通知发送失败不需要回滚，因为订单和库存操作已经完成

    return chain.execute({
        "product_id": product_id,
        "quantity": quantity,
        "unit_price": unit_price
    })

# 执行
result = process_order("SKU-12345", 2)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

### 2.5 工具链设计的核心要点

在设计工具链时，有几个工程实践需要牢记。

**第一，上下文对象的设计。** 上下文不仅用于传递数据，还承担着"执行日志"的角色。每一步的输入和输出都被记录在上下文中，这使得调试和审计变得非常方便。在生产环境中，建议在每一步执行前后都对上下文做快照，这样即使执行中途崩溃，也能通过快照恢复执行状态。

**第二，回滚函数的注册策略。** 并非所有步骤都需要回滚函数。一般来说，只有那些产生了"副作用"（如写入数据库、调用外部 API）的步骤才需要注册回滚函数。纯查询性质的步骤（如校验、检查）通常不需要回滚。此外，回滚函数本身应该是幂等的，即多次执行的结果与执行一次相同，这样可以安全地在重试场景中使用。

**第三，步骤之间的数据传递。** 使用 `context.update(result)` 的方式将每一步的输出合并到上下文中是最简单的做法，但需要注意 key 命名冲突的问题。如果两个步骤返回了同名的 key，后者的值会覆盖前者。建议在每个工具函数的返回值中使用具有语义前缀的 key，比如 `inventory_available_stock` 而不是简单的 `stock`。

---

## 三、并行工具执行模式（Parallel Tool Execution）

### 3.1 模式概述与性能优势

当任务需要调用多个工具，而这些工具之间**没有数据依赖**时，将它们并行执行可以显著降低总延迟。假设每个工具的平均响应时间为 1 秒，串行执行 5 个工具需要约 5 秒，而并行执行只需要约 1 秒（受限于最慢的那个工具），延迟降低了 80%。

并行执行在以下场景中特别有价值：第一，**多维度信息聚合**，比如同时查询天气、汇率和新闻，然后由 LLM 综合这些信息生成一个全面的晨报；第二，**多数据源查询**，比如同时从 MySQL、Redis 和 Elasticsearch 中获取数据，聚合后返回给用户；第三，**批量独立操作**，比如同时给 5 位同事发送会议通知，每条通知之间互不影响。

值得注意的是，OpenAI 等主流 LLM 提供商已经原生支持在一次模型响应中返回多个 `tool_calls`，这为并行工具执行提供了天然的接口支持。LLM 在分析用户请求后，可以一次性规划多个独立的工具调用，编排器收到后并行执行这些调用，最后再将所有结果聚合反馈给 LLM。

### 3.2 并行执行器的完整实现

以下实现包含同步和异步两个版本，均支持超时控制和错误隔离：

```python
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from dataclasses import dataclass
from typing import Any, Callable

@dataclass
class ParallelToolResult:
    """单个并行工具的执行结果"""
    tool_name: str
    success: bool
    result: Any = None
    error: str = ""
    duration_ms: float = 0

class ParallelToolExecutor:
    """
    并行工具执行器。
    使用线程池并发执行多个工具调用，支持超时控制和错误隔离。
    每个工具的失败不会影响其他工具的执行。
    """

    def __init__(self, max_workers: int = 10, timeout: float = 30.0):
        self.max_workers = max_workers
        self.timeout = timeout

    def execute(self, tool_calls: list[dict],
                tool_registry: dict[str, Callable]) -> list[ParallelToolResult]:
        """
        并行执行多个工具调用。
        
        :param tool_calls: LLM 返回的工具调用列表
            [{"name": "tool_a", "args": {"key": "value"}}, ...]
        :param tool_registry: 工具名称到执行函数的映射
            {"tool_a": callable_function, ...}
        :return: 每个工具的执行结果列表
        """
        results = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # 提交所有工具任务到线程池
            future_to_info = {}
            for call in tool_calls:
                name = call["name"]
                args = call.get("args", {})
                fn = tool_registry.get(name)

                if fn is None:
                    results.append(ParallelToolResult(
                        tool_name=name, success=False,
                        error=f"工具 {name} 未注册"
                    ))
                    continue

                start = time.monotonic()
                future = executor.submit(self._safe_call, fn, args)
                future_to_info[future] = (name, start)

            # 收集结果，带超时控制
            try:
                for future in as_completed(future_to_info, timeout=self.timeout):
                    name, start = future_to_info[future]
                    duration = (time.monotonic() - start) * 1000

                    try:
                        result = future.result(timeout=0.1)
                        results.append(ParallelToolResult(
                            tool_name=name, success=True,
                            result=result, duration_ms=duration
                        ))
                    except Exception as e:
                        results.append(ParallelToolResult(
                            tool_name=name, success=False,
                            error=str(e), duration_ms=duration
                        ))
            except TimeoutError:
                # 超时：记录未完成的工具
                for future, (name, start) in future_to_info.items():
                    if not future.done():
                        results.append(ParallelToolResult(
                            tool_name=name, success=False,
                            error=f"执行超时（>{self.timeout}s）"
                        ))

        return results

    @staticmethod
    def _safe_call(fn: Callable, args: dict) -> Any:
        """安全调用工具函数，捕获所有异常"""
        return fn(**args)


class AsyncParallelToolExecutor:
    """异步并行工具执行器，适合高并发 I/O 密集型场景"""

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout

    async def execute(self, tool_calls: list[dict],
                      tool_registry: dict[str, Callable]) -> list[dict]:
        tasks = []
        for call in tool_calls:
            name = call["name"]
            args = call.get("args", {})
            fn = tool_registry.get(name)
            if fn:
                tasks.append(self._run_single(name, fn, args))
            else:
                tasks.append(asyncio.coroutine(
                    lambda: {"name": name, "success": False, "error": "工具未注册"}
                )())

        return await asyncio.gather(*tasks, return_exceptions=False)

    async def _run_single(self, name: str, fn: Callable, args: dict) -> dict:
        start = time.monotonic()
        try:
            if asyncio.iscoroutinefunction(fn):
                result = await asyncio.wait_for(fn(**args), timeout=self.timeout)
            else:
                loop = asyncio.get_event_loop()
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: fn(**args)),
                    timeout=self.timeout
                )
            duration = (time.monotonic() - start) * 1000
            return {"name": name, "success": True, "result": result,
                    "duration_ms": round(duration, 2)}
        except asyncio.TimeoutError:
            return {"name": name, "success": False, "error": "执行超时"}
        except Exception as e:
            return {"name": name, "success": False, "error": str(e)}
```

### 3.3 并行执行的实际使用示例

```python
import time
import json

# 模拟三个独立的工具函数，各自有不同的执行延迟
def get_weather(city: str) -> dict:
    """查询天气"""
    time.sleep(1.0)  # 模拟网络延迟
    return {"city": city, "temp": "28°C", "condition": "晴", "humidity": "45%"}

def get_exchange_rate(from_currency: str, to_currency: str) -> dict:
    """查询汇率"""
    time.sleep(0.8)
    return {"from": from_currency, "to": to_currency, "rate": 7.25, "updated": "2026-06-06"}

def get_news_summary(topic: str) -> dict:
    """获取新闻摘要"""
    time.sleep(1.2)
    return {"topic": topic, "headline": f"关于 {topic} 的最新进展", "source": "Reuters"}

# 注册工具到注册表
tool_registry = {
    "get_weather": get_weather,
    "get_exchange_rate": get_exchange_rate,
    "get_news_summary": get_news_summary,
}

# LLM 一次性返回的多个工具调用
tool_calls = [
    {"name": "get_weather", "args": {"city": "北京"}},
    {"name": "get_exchange_rate", "args": {"from_currency": "USD", "to_currency": "CNY"}},
    {"name": "get_news_summary", "args": {"topic": "人工智能"}},
]

# 并行执行并计时
executor = ParallelToolExecutor(max_workers=5, timeout=10.0)
start = time.monotonic()
results = executor.execute(tool_calls, tool_registry)
total_ms = (time.monotonic() - start) * 1000

print(f"并行执行总耗时: {total_ms:.0f}ms")
print(f"（串行执行预估耗时: ~3000ms，加速比: {3000/total_ms:.1f}x）")
for r in results:
    status = "✓ 成功" if r.success else "✗ 失败"
    print(f"  [{status}] {r.tool_name}: {r.result or r.error} ({r.duration_ms:.0f}ms)")
```

预期输出会展示并行执行的总耗时接近最慢工具的延迟（约 1.2 秒），而非三个工具延迟之和（约 3 秒），延迟降低了约 60%。

### 3.4 并行执行的关键挑战与解决方案

**挑战一：结果聚合策略。** 并行返回的多个结果需要被合理聚合后提交给 LLM。最简单的方式是将所有结果序列化为 JSON 字符串，按顺序拼接后作为多条 `tool` 角色消息发送给 LLM。但如果部分工具失败，就需要决定是整体失败还是部分降级返回。推荐的做法是**部分降级**：将成功的结果正常返回，失败的结果附带错误说明，让 LLM 在回复中告知用户哪些信息获取失败。

**挑战二：并发控制与下游限流。** 并行调用可能触发下游 API 的速率限制。解决方法是在并行执行器之上增加一个基于信号量的限流层，按工具所属的服务分组限制并发数。例如同一个第三方 API 的所有工具共享一个信号量，确保不会超过该 API 的速率限制。

**挑战三：超时与资源管理。** 当某个工具执行时间异常长时，不能无限等待。需要为每个工具设置独立的超时时间，并且在超时后正确释放线程资源。使用 `as_completed` 的 timeout 参数是一个简单有效的方式。

---

## 四、混合模式：条件分支与混合编排

### 4.1 为什么需要混合模式

在真实的生产场景中，纯粹的链式或并行模式往往不足以覆盖复杂的业务逻辑。更常见的是一种**混合模式**：在工具链的某些节点上做条件判断，根据中间结果动态决定下一步的操作；在某些节点内部并行执行多个独立子任务。

以智能客服场景为例：首先查询用户信息（顺序），然后并行查询该用户的订单记录和工单记录（并行），接着根据查询结果判断用户的问题类型（条件分支），如果是一般问题则调用知识库查询，如果是严重投诉则升级到人工客服。这样的流程同时包含了顺序、并行和条件分支三种编排策略。

### 4.2 混合编排器实现

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Optional

@dataclass
class ToolNode:
    """工具节点定义，支持条件执行和并行分组"""
    name: str
    fn: Callable
    rollback_fn: Optional[Callable] = None
    condition: Optional[Callable[[dict], bool]] = None
    group: Optional[str] = None  # 并行组名称，同组内的节点并行执行

class HybridOrchestrator:
    """
    混合编排器：支持顺序、并行和条件分支的组合编排。
    通过 group 属性将节点分组，同组内的节点并行执行，不同组之间顺序执行。
    """

    def __init__(self):
        self.nodes: list[ToolNode] = []
        self.groups: dict[str, list[ToolNode]] = {}
        self.execution_order: list[str | list[str]] = []

    def add_node(self, node: ToolNode) -> "HybridOrchestrator":
        self.nodes.append(node)
        if node.group:
            self.groups.setdefault(node.group, []).append(node)
        return self

    def chain(self, *names: str) -> "HybridOrchestrator":
        """声明顺序执行的一组节点"""
        for name in names:
            self.execution_order.append([name])
        return self

    def parallel_group(self, group_name: str) -> "HybridOrchestrator":
        """声明一个并行执行的节点组"""
        node_names = [n.name for n in self.groups.get(group_name, [])]
        self.execution_order.append(node_names)
        return self

    def run(self, context: dict) -> dict:
        """执行混合编排流程"""
        completed = []

        for group in self.execution_order:
            if isinstance(group, list) and len(group) == 1:
                # 单节点顺序执行
                node = self._find_node(group[0])
                if node is None:
                    continue
                if node.condition and not node.condition(context):
                    continue  # 条件不满足，跳过此节点
                try:
                    result = node.fn(context)
                    if result:
                        context.update(result)
                    completed.append(node)
                except Exception as e:
                    self._rollback(completed, context)
                    return {"success": False, "failed_at": node.name, "error": str(e)}
            elif isinstance(group, list) and len(group) > 1:
                # 多节点并行执行
                active_nodes = [self._find_node(n) for n in group]
                active_nodes = [n for n in active_nodes if n and (not n.condition or n.condition(context))]

                with ThreadPoolExecutor(max_workers=len(active_nodes)) as executor:
                    futures = {executor.submit(n.fn, context): n for n in active_nodes}
                    for future in as_completed(futures):
                        node = futures[future]
                        try:
                            result = future.result()
                            if result:
                                context.update(result)
                            completed.append(node)
                        except Exception as e:
                            self._rollback(completed, context)
                            return {"success": False, "failed_at": node.name, "error": str(e)}

        return {"success": True, "context": context}

    def _find_node(self, name: str) -> Optional[ToolNode]:
        for node in self.nodes:
            if node.name == name:
                return node
        return None

    def _rollback(self, completed: list[ToolNode], context: dict):
        for node in reversed(completed):
            if node.rollback_fn:
                try:
                    node.rollback_fn(context)
                except Exception as e:
                    print(f"[回滚失败] {node.name}: {e}")
```

使用混合编排器的智能客服示例：

```python
orch = HybridOrchestrator()

# 添加节点，标注并行组
orch.add_node(ToolNode("lookup_user", lookup_user_fn))
orch.add_node(ToolNode("check_orders", check_orders_fn, group="query_parallel"))
orch.add_node(ToolNode("check_tickets", check_tickets_fn, group="query_parallel"))
orch.add_node(ToolNode("search_knowledge_base", search_kb_fn,
                        condition=lambda ctx: ctx.get("severity", "low") != "critical"))
orch.add_node(ToolNode("escalate_to_human", escalate_fn,
                        condition=lambda ctx: ctx.get("severity", "low") == "critical"))

# 定义执行顺序：查询用户 → 并行查询订单和工单 → 根据严重程度决定下一步
orch.chain("lookup_user")
orch.parallel_group("query_parallel")
orch.chain("search_knowledge_base", "escalate_to_human")

result = orch.run({"user_id": "U-12345", "message": "我的订单已经三天没发货了！"})
```

---

## 五、错误处理与回滚策略深度解析

### 5.1 三层错误处理模型

在工具组合场景中，错误处理需要从三个不同的层次来系统性地考虑，每一层有不同的关注点和策略。

**第一层是工具层。** 这是最内层的错误处理，关注单个工具调用本身的可靠性。核心策略包括：重试机制（对网络超时、服务暂时不可用等瞬时故障进行指数退避重试）、超时控制（为每个工具调用设置最大等待时间，避免无限阻塞）、以及熔断机制（当某个工具连续失败达到阈值时自动熔断，短时间内不再调用，给下游服务恢复的时间）。工具层的错误处理目标是尽可能让单次工具调用成功完成。

**第二层是编排层。** 这一层关注的是多个工具之间的协调一致性。核心策略包括：回滚机制（当工具链中某一步失败时，逆序执行已完成步骤的回滚函数，恢复系统到一致状态）、降级策略（当某个非关键工具失败时，跳过该步骤或使用默认值继续执行）、以及分支切换（根据当前执行状态动态改变后续步骤的执行路径）。编排层的错误处理目标是保证整个任务的事务一致性。

**第三层是 Agent 层。** 这是最外层的错误处理，面向最终用户。核心策略是将前两层的技术性错误信息转化为用户可以理解的自然语言说明。LLM 在接收到工具层返回的错误信息后，能够生成诸如"抱歉，当前库存不足，无法完成下单"这样的用户友好提示，而不是直接暴露底层的错误堆栈。

### 5.2 带重试和熔断的工具包装器

以下实现了一个完整的工具弹性包装器，集成了指数退避重试和熔断器：

```python
import time
import random
from functools import wraps
from collections import defaultdict
from threading import Lock

class CircuitBreaker:
    """
    熔断器实现。
    当某个工具的连续失败次数达到阈值时自动熔断，
    在指定的恢复时间内拒绝所有对该工具的调用，
    恢复时间过后进入半开状态，允许一次尝试。
    """

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failure_counts: dict[str, int] = defaultdict(int)
        self._last_failure_time: dict[str, float] = {}
        self._lock = Lock()

    def is_available(self, tool_name: str) -> bool:
        with self._lock:
            if self._failure_counts[tool_name] < self.failure_threshold:
                return True
            # 检查是否已过恢复期
            elapsed = time.time() - self._last_failure_time.get(tool_name, 0)
            if elapsed >= self.recovery_timeout:
                self._failure_counts[tool_name] = 0  # 重置，进入半开状态
                return True
            return False

    def record_success(self, tool_name: str):
        with self._lock:
            self._failure_counts[tool_name] = 0

    def record_failure(self, tool_name: str):
        with self._lock:
            self._failure_counts[tool_name] += 1
            self._last_failure_time[tool_name] = time.time()

breaker = CircuitBreaker(failure_threshold=3, recovery_timeout=30.0)

def resilient_tool(name: str, max_retries: int = 3, base_delay: float = 1.0):
    """
    弹性工具装饰器。
    集成熔断检查、指数退避重试和延迟抖动。
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            # 熔断检查
            if not breaker.is_available(name):
                raise RuntimeError(
                    f"工具 {name} 已熔断（连续失败 {breaker._failure_counts[name]} 次），"
                    f"请在 {breaker.recovery_timeout}s 后重试"
                )

            last_error = None
            for attempt in range(max_retries):
                try:
                    result = fn(*args, **kwargs)
                    breaker.record_success(name)
                    return result
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        # 指数退避 + 随机抖动，避免雷鸣羊群效应
                        delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
                        time.sleep(delay)

            # 所有重试都失败
            breaker.record_failure(name)
            raise last_error
        return wrapper
    return decorator

# 使用示例
@resilient_tool("payment_gateway", max_retries=3, base_delay=2.0)
def process_payment(order_id: str, amount: float) -> dict:
    """调用支付网关处理付款"""
    response = PaymentGateway.charge(order_id, amount)
    if response.status_code != 200:
        raise ConnectionError(f"支付网关返回错误: {response.status_code}")
    return {"payment_id": response.json()["id"], "status": "charged"}
```

### 5.3 补偿事务模式

对于那些无法简单回滚的操作——比如已经发送出去的邮件通知、已经推送到外部系统的数据——需要采用**补偿事务**模式。补偿事务不是撤销已完成的操作，而是执行一个"反向操作"来抵消原操作的影响：

```python
class CompensationChain:
    """补偿事务链，用于处理无法回滚的操作"""

    def __init__(self):
        self.compensations: list[tuple[Callable, str]] = []

    def register(self, compensator: Callable, description: str):
        """注册一个补偿操作"""
        self.compensations.append((compensator, description))

    def execute_compensations(self) -> list[dict]:
        """逆序执行所有已注册的补偿操作"""
        results = []
        for compensator, desc in reversed(self.compensations):
            try:
                compensator()
                results.append({"description": desc, "status": "compensated"})
                logger.info(f"[补偿成功] {desc}")
            except Exception as e:
                results.append({"description": desc, "status": "failed", "error": str(e)})
                logger.critical(f"[补偿失败] {desc}: {e}")
                # 补偿失败的操作发送到死信队列等待人工处理
                DeadLetterQueue.push({
                    "type": "compensation_failure",
                    "description": desc,
                    "error": str(e),
                    "timestamp": time.time()
                })
        return results

# 使用示例
compensation = CompensationChain()
compensation.register(
    lambda: EmailService.send_cancellation(order_id),
    f"发送订单 {order_id} 取消通知"
)
compensation.register(
    lambda: InventoryService.restore(product_id, quantity),
    f"恢复商品 {product_id} 库存 {quantity} 件"
)

# 当工具链执行失败时触发补偿
if not result["success"]:
    compensation.execute_compensations()
```

---

## 六、架构决策树：如何选择合适的编排模式

### 6.1 决策流程图

面对具体的业务场景，可以按照以下决策流程来选择合适的工具组合模式：

```
你的任务需要调用多少个工具？
│
├─ 仅 1 个工具 → 【单工具调用模式】
│   └─ 直接调用，最简单、最低延迟
│
└─ 多个工具
    │
    ├─ 工具之间是否存在数据依赖？
    │   │
    │   ├─ 存在依赖（后续工具需要前面的输出）
    │   │   │
    │   │   ├─ 依赖是否可以局部解耦？
    │   │   │   │
    │   │   │   ├─ 可以 → 【混合模式】
    │   │   │   │   主流程链式执行，部分节点内并行
    │   │   │   │
    │   │   │   └─ 不可以 → 【纯链式编排】
    │   │   │       全程顺序执行，带回滚机制
    │   │   │
    │   │   └─ 失败时是否需要回滚？
    │   │       │
    │   │       ├─ 需要 → 注册回滚函数的事务性工具链
    │   │       └─ 不需要 → 简单顺序执行 + 错误上报即可
    │   │
    │   └─ 无依赖（工具之间完全独立）
    │       │
    │       ├─ 工具数量是否较多（>3 个）？
    │       │   │
    │       │   ├─ 是 → 【并行执行】+ 限流控制
    │       │   └─ 否 → 【并行执行】（简单线程池即可）
    │       │
    │       └─ 部分工具失败是否可接受？
    │           │
    │           ├─ 可接受 → 降级聚合，返回成功部分 + 失败说明
    │           └─ 不可接受 → 全部成功或全部失败（all-or-nothing）
    │
    └─ 是否存在条件分支（根据中间结果决定下一步）？
        │
        ├─ 存在 → 【混合模式】+ 条件判断节点
        └─ 不存在 → 按上述依赖分析选择对应模式
```

### 6.2 常见场景的模式推荐

| 业务场景 | 推荐模式 | 延迟特征 | 容错策略 |
|---------|---------|---------|---------|
| 查询天气、查汇率 | 单工具调用 | 最低 | 重试 + 降级 |
| 电商下单流程 | 链式编排 | 中等 | 补偿事务 + 回滚 |
| 信息聚合（晨报生成） | 并行执行 | 最低 | 部分降级 |
| 智能客服（多步查询+条件路由） | 混合模式 | 中等 | 条件分支 + 回滚 |
| 批量通知发送（多人邮件） | 并行执行 | 最低 | 错误隔离 |
| 数据 ETL 管线 | 链式编排 | 较高 | 检查点 + 断点续传 |
| 文档处理（提取+翻译+摘要） | 链式编排 | 中等 | 重试 + 降级 |
| 市场分析（多数据源并行查询+综合分析） | 混合模式 | 中等 | 部分降级 |

---

## 七、生产环境最佳实践

### 7.1 可观测性与链路追踪

在生产环境中，每次工具组合执行都需要完整的链路追踪。建议为每次工具链执行分配一个唯一的 `trace_id`，并在每个步骤中记录开始时间、结束时间、输入参数、输出结果和错误信息。这些数据不仅用于调试，还用于性能分析和 SLA 监控。

在 Python 中可以使用 context manager 模式为每个工具调用添加追踪 span。在 Laravel 中则可以通过中间件和事件机制来实现类似的功能。关键是确保追踪数据的结构化存储，便于后续的查询和分析。

### 7.2 超时与死信队列

每个工具调用必须设置超时时间。对于链式编排中回滚失败的操作，应该发送到死信队列（Dead Letter Queue）中等待人工处理。死信队列可以使用 Redis List、RabbitMQ 或 AWS SQS 等消息中间件来实现。这是保证系统最终一致性的重要安全网。

### 7.3 工具注册与发现机制

在大型项目中，工具的定义和实现应该解耦。建议使用注册中心模式：每个工具在启动时将自己的名称、描述、参数 schema 和执行函数注册到中心化的注册表中。Agent 在运行时从注册表中获取可用工具列表，动态生成 LLM 的 tools 参数。这样做的好处是新增或修改工具不需要改动 Agent 的核心逻辑，只需在工具注册表中增减即可。

### 7.4 幂等性设计

工具函数应尽量设计为幂等的，即相同的输入多次调用产生的副作用与调用一次相同。这对于重试场景至关重要。实现幂等性的常见方式包括：使用唯一请求 ID 去重、基于数据库唯一约束防止重复写入、以及使用乐观锁或版本号机制。

---

## 总结

Tool Composition 是 AI Agent 从"演示原型"走向"生产系统"的关键架构能力。本文介绍的三种核心模式各有其适用场景和设计考量：

**单工具调用**是最简单直接的模式，适用于用户意图清晰、映射到单一工具能力的场景。它的实现成本最低，但能力也最有限。

**多工具链**保证了顺序依赖和数据一致性，通过回滚机制保障事务安全。它适用于有明确步骤顺序的业务流程，如订单处理、数据管线等。

**并行工具执行**最大化了吞吐量和响应速度，但需要处理好结果聚合、部分失败降级和下游限流等挑战。它适用于工具之间无依赖的信息聚合和批量操作场景。

在实际项目中，**混合模式**才是常态——通过决策树分析你的具体场景，灵活组合使用这三种模式，并在每一层都做好错误处理和可观测性，才能构建出真正可靠的 AI Agent 系统。

最后需要强调的是，工具编排不是一次性设计，而是随着业务需求不断演进的架构能力。建议从最简单的单工具模式开始，当复杂度增加时逐步引入链式编排和并行执行，配合完善的监控、日志和回滚机制，这才是 AI Agent 工程化的正确演进路径。

---

## 三种编排模式对比一览

| 维度 | 单工具调用 | 多工具链（顺序编排） | 并行工具执行 |
|------|-----------|---------------------|-------------|
| **工具数量** | 1 个 | ≥2 个，按顺序执行 | ≥2 个，同时执行 |
| **数据依赖** | 无 | 强依赖（后续依赖前序输出） | 无依赖（工具间独立） |
| **延迟特征** | 最低（单次调用） | 较高（N 次调用串行累加） | 低（取决于最慢工具） |
| **吞吐量** | 一般 | 一般 | 高（并发优势） |
| **事务性** | 无需 | 需要回滚/补偿机制 | 部分降级即可 |
| **错误影响范围** | 仅当前调用 | 整条链路可能回滚 | 隔离，仅影响失败工具 |
| **实现复杂度** | ⭐ 最低 | ⭐⭐⭐ 较高 | ⭐⭐ 中等 |
| **典型场景** | 天气查询、汇率查询 | 电商下单、数据 ETL 管线 | 晨报聚合、批量通知发送 |
| **LLM 交互轮次** | 2 轮（决策→回复） | 多轮（每步可能需 LLM） | 2 轮（决策→聚合回复） |
| **限流风险** | 低 | 中（顺序调用） | 高（并发触发限流） |

> 💡 **选型建议**：大多数 AI Agent 系统会从单工具调用起步，随业务复杂度提升逐步引入链式编排和并行执行。在生产环境中，**混合模式**（链式 + 条件分支 + 局部并行）才是常态——参考上方的决策树选择最适合你场景的组合方式。

---

## 相关阅读

- [AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计](/categories/AI/ai-agent-orchestration-patterns-react-plan-execute-multi-agent/) — 深入解析 ReAct、Plan-and-Execute 和 Multi-Agent 三大编排模式的设计哲学与实现细节
- [LangChain 实战：Chain/Agent/Tool 编排与自定义工具开发](/categories/AI/langchain-chain-agent-tool-custom-tool-development/) — LangChain 中 Chain、Agent、Tool 的职责分工、LCEL 编排方式与生产落地策略
- [AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略](/categories/AI/ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/) — 指数退避重试、熔断器模式、幻觉防护与上下文溢出管理的工程化方案
- [MCP (Model Context Protocol) 实战：AI Agent 工具标准化与生态集成深度剖析](/categories/AI/mcp-model-context-protocol-ai-agent-tool-standardization/) — AI Agent 工具层的标准化协议与生态集成架构分析
