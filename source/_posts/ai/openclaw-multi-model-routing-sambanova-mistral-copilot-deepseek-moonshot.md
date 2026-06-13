---
title: OpenClaw 多模型路由实战：SambaNova/Mistral/Copilot/DeepSeek/Moonshot 选型与降级
date: 2026-06-02 00:00:00
tags: [OpenClaw, AI Agent, 多模型路由, 降级策略, LLM]
keywords: [OpenClaw, SambaNova, Mistral, Copilot, DeepSeek, Moonshot, 多模型路由实战, 选型与降级, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: "深入剖析 OpenClaw 多模型路由与降级机制的完整实战方案。涵盖 SambaNova、Mistral、GitHub Copilot、DeepSeek、Moonshot 等主流 LLM 提供商的选型策略，详解 31 级 fallback chain 的设计原理与配置方法，包含 provider 健康监控、成本预算管理、智能路由决策树等核心机制。附带真实配置代码示例、各模型提供商延迟与成本对比表格，以及生产环境中常见的踩坑案例与最佳实践，帮助开发者构建高可用、低成本的 AI Agent 系统。"
---


# OpenClaw 多模型路由实战：SambaNova/Mistral/Copilot/DeepSeek/Moonshot 选型与降级

## 前言

在构建生产级 AI Agent 系统时，单一模型依赖是最危险的架构决策。一旦该模型提供商出现故障、调价或服务质量下降，整个系统将陷入瘫痪。OpenClaw 作为开源 AI Agent 框架，其核心竞争力之一就是内置了一套成熟的**多模型路由与降级机制**——31 级 fallback chain、provider 健康监控、成本预算管理三位一体的模型策略体系。

本文将从实战角度出发，深入剖析 OpenClaw 如何在 SambaNova、Mistral、GitHub Copilot、DeepSeek、Moonshot 等多个模型提供商之间进行智能路由，以及在故障场景下如何自动降级，确保 Agent 的高可用性。

## 一、多模型路由的核心挑战

### 1.1 为什么需要多模型路由？

在真实的 AI Agent 生产环境中，我们面临以下核心挑战：

**可用性风险**：任何单一 LLM 提供商都可能出现服务中断。2025 年下半年，OpenAI 曾经历多次 API 故障，最长持续超过 4 小时，导致依赖其服务的应用大面积不可用。

**成本压力**：不同模型的定价差异巨大。以 2026 年初的价格为例，GPT-4o 的输入 token 成本约为 $2.50/1M tokens，而 DeepSeek-V3 仅需 $0.27/1M tokens，差距接近 10 倍。对于高频调用场景，选择合适的模型直接影响运营成本。

**能力差异**：不同任务对模型能力的要求不同。代码生成任务需要强大的推理能力（适合 Claude/GPT-4o），而简单的文本分类任务用轻量模型（如 Mistral-Small）即可胜任，成本更低、延迟更小。

**地域合规**：部分场景需要将数据处理限制在特定区域。例如中国大陆用户可能需要优先使用 DeepSeek 或 Moonshot 等国内提供商，以满足数据合规要求。

### 1.2 OpenClaw 的路由设计哲学

OpenClaw 的模型路由遵循三个核心原则：

1. **声明式配置**：模型优先级、fallback 链、成本预算均通过 YAML 配置文件定义，无需修改代码
2. **渐进式降级**：从最佳模型逐级降级到兜底模型，而非直接失败
3. **可观测性优先**：每次路由决策都有详细的日志和指标输出

## 二、ProviderProfile：模型提供者的声明式注册

### 2.1 配置文件结构

OpenClaw 使用 `ProviderProfile` 来声明式地注册每个模型提供商。以下是完整的配置示例：

```yaml
# config/model_providers.yaml
providers:
  sambanova:
    name: "SambaNova"
    base_url: "https://api.sambanova.ai/v1"
    api_key_env: "SAMBANOVA_API_KEY"
    models:
      - id: "Meta-Llama-3.1-405B-Instruct"
        alias: "samba-405b"
        input_cost_per_1m: 3.00
        output_cost_per_1m: 6.00
        max_tokens: 16384
        capabilities: ["reasoning", "code", "multilingual"]
        priority: 10
      - id: "Meta-Llama-3.1-70B-Instruct"
        alias: "samba-70b"
        input_cost_per_1m: 0.80
        output_cost_per_1m: 1.60
        max_tokens: 16384
        capabilities: ["reasoning", "code"]
        priority: 20
    health_check:
      endpoint: "/models"
      interval_seconds: 60
      timeout_seconds: 10
      failure_threshold: 3
      recovery_threshold: 2

  mistral:
    name: "Mistral AI"
    base_url: "https://api.mistral.ai/v1"
    api_key_env: "MISTRAL_API_KEY"
    models:
      - id: "mistral-large-latest"
        alias: "mistral-large"
        input_cost_per_1m: 2.00
        output_cost_per_1m: 6.00
        max_tokens: 32768
        capabilities: ["reasoning", "code", "multilingual"]
        priority: 15
      - id: "mistral-small-latest"
        alias: "mistral-small"
        input_cost_per_1m: 0.20
        output_cost_per_1m: 0.60
        max_tokens: 32768
        capabilities: ["classification", "extraction"]
        priority: 25
    health_check:
      endpoint: "/models"
      interval_seconds: 60
      timeout_seconds: 10
      failure_threshold: 3
      recovery_threshold: 2

  copilot:
    name: "GitHub Copilot"
    base_url: "https://api.githubcopilot.com"
    api_key_env: "COPILOT_API_KEY"
    models:
      - id: "gpt-4o"
        alias: "copilot-4o"
        input_cost_per_1m: 2.50
        output_cost_per_1m: 10.00
        max_tokens: 16384
        capabilities: ["reasoning", "code", "vision"]
        priority: 5
      - id: "gpt-4o-mini"
        alias: "copilot-4o-mini"
        input_cost_per_1m: 0.15
        output_cost_per_1m: 0.60
        max_tokens: 16384
        capabilities: ["classification", "extraction", "code"]
        priority: 30
    health_check:
      endpoint: "/models"
      interval_seconds: 120
      timeout_seconds: 15
      failure_threshold: 2
      recovery_threshold: 1

  deepseek:
    name: "DeepSeek"
    base_url: "https://api.deepseek.com/v1"
    api_key_env: "DEEPSEEK_API_KEY"
    models:
      - id: "deepseek-chat"
        alias: "deepseek-v3"
        input_cost_per_1m: 0.27
        output_cost_per_1m: 1.10
        max_tokens: 8192
        capabilities: ["reasoning", "code", "multilingual"]
        priority: 12
      - id: "deepseek-reasoner"
        alias: "deepseek-r1"
        input_cost_per_1m: 0.55
        output_cost_per_1m: 2.19
        max_tokens: 8192
        capabilities: ["reasoning", "math", "code"]
        priority: 8
    health_check:
      endpoint: "/models"
      interval_seconds: 60
      timeout_seconds: 10
      failure_threshold: 3
      recovery_threshold: 2

  moonshot:
    name: "Moonshot AI"
    base_url: "https://api.moonshot.cn/v1"
    api_key_env: "MOONSHOT_API_KEY"
    models:
      - id: "moonshot-v1-128k"
        alias: "moonshot-128k"
        input_cost_per_1m: 1.22
        output_cost_per_1m: 1.22
        max_tokens: 8192
        capabilities: ["long-context", "reasoning"]
        priority: 18
      - id: "moonshot-v1-32k"
        alias: "moonshot-32k"
        input_cost_per_1m: 0.61
        output_cost_per_1m: 0.61
        max_tokens: 4096
        capabilities: ["reasoning", "multilingual"]
        priority: 22
    health_check:
      endpoint: "/models"
      interval_seconds: 60
      timeout_seconds: 10
      failure_threshold: 3
      recovery_threshold: 2
```

### 2.2 ProviderProfile 的加载与初始化

在 OpenClaw 启动时，`ModelRouter` 组件负责加载所有 ProviderProfile 并构建路由表：

```python
# openclaw/core/model_router.py
import yaml
import os
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import asyncio
import aiohttp
import time
import logging

logger = logging.getLogger(__name__)


class HealthStatus(Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class ModelConfig:
    id: str
    alias: str
    provider: str
    input_cost_per_1m: float
    output_cost_per_1m: float
    max_tokens: int
    capabilities: List[str]
    priority: int
    base_url: str
    api_key: str


@dataclass
class ProviderHealth:
    status: HealthStatus = HealthStatus.UNKNOWN
    consecutive_failures: int = 0
    consecutive_successes: int = 0
    last_check_time: float = 0.0
    last_failure_time: float = 0.0
    avg_latency_ms: float = 0.0
    latency_history: List[float] = field(default_factory=list)


class ModelRouter:
    """多模型路由器，负责模型选择、健康检查和故障降级"""

    def __init__(self, config_path: str):
        self.config_path = config_path
        self.providers: Dict[str, dict] = {}
        self.models: Dict[str, ModelConfig] = {}
        self.health: Dict[str, ProviderHealth] = {}
        self._load_config()

    def _load_config(self):
        """加载模型提供商配置"""
        with open(self.config_path, 'r') as f:
            config = yaml.safe_load(f)

        for provider_name, provider_config in config['providers'].items():
            api_key = os.environ.get(provider_config['api_key_env'], '')
            self.providers[provider_name] = provider_config
            self.health[provider_name] = ProviderHealth()

            for model_def in provider_config['models']:
                model = ModelConfig(
                    id=model_def['id'],
                    alias=model_def['alias'],
                    provider=provider_name,
                    input_cost_per_1m=model_def['input_cost_per_1m'],
                    output_cost_per_1m=model_def['output_cost_per_1m'],
                    max_tokens=model_def['max_tokens'],
                    capabilities=model_def['capabilities'],
                    priority=model_def['priority'],
                    base_url=provider_config['base_url'],
                    api_key=api_key,
                )
                self.models[model.alias] = model

        logger.info(f"Loaded {len(self.models)} models from {len(self.providers)} providers")

    def select_model(
        self,
        required_capabilities: List[str] = None,
        max_cost_per_1m: float = None,
        preferred_provider: str = None,
        exclude_providers: List[str] = None,
    ) -> Optional[ModelConfig]:
        """
        根据条件选择最优模型。

        选择策略：
        1. 过滤不健康的 provider
        2. 过滤不满足能力要求的模型
        3. 过滤超出成本预算的模型
        4. 按 priority 排序（数字越小优先级越高）
        5. 返回优先级最高的模型
        """
        exclude_providers = exclude_providers or []
        candidates = []

        for alias, model in self.models.items():
            # 跳过不健康的 provider
            health = self.health.get(model.provider)
            if health and health.status == HealthStatus.UNHEALTHY:
                logger.debug(f"Skipping {alias}: provider {model.provider} is unhealthy")
                continue

            # 跳过被排除的 provider
            if model.provider in exclude_providers:
                continue

            # 检查能力要求
            if required_capabilities:
                if not all(cap in model.capabilities for cap in required_capabilities):
                    continue

            # 检查成本预算
            if max_cost_per_1m is not None:
                if model.input_cost_per_1m > max_cost_per_1m:
                    continue

            candidates.append(model)

        if not candidates:
            logger.warning("No suitable model found with current constraints")
            return None

        # 优先选择 preferred_provider 的模型
        if preferred_provider:
            preferred = [m for m in candidates if m.provider == preferred_provider]
            if preferred:
                candidates = preferred

        # 按 priority 排序
        candidates.sort(key=lambda m: m.priority)
        selected = candidates[0]
        logger.info(f"Selected model: {selected.alias} (provider: {selected.provider}, priority: {selected.priority})")
        return selected

    def get_fallback_chain(
        self,
        required_capabilities: List[str] = None,
        max_cost_per_1m: float = None,
    ) -> List[ModelConfig]:
        """
        获取完整的 fallback chain，按优先级排序。
        用于在主模型失败时依次尝试其他模型。
        """
        candidates = []
        for alias, model in self.models.items():
            health = self.health.get(model.provider)
            if health and health.status == HealthStatus.UNHEALTHY:
                continue
            if required_capabilities:
                if not all(cap in model.capabilities for cap in required_capabilities):
                    continue
            if max_cost_per_1m is not None:
                if model.input_cost_per_1m > max_cost_per_1m:
                    continue
            candidates.append(model)

        candidates.sort(key=lambda m: m.priority)
        return candidates

    def report_success(self, provider: str, latency_ms: float):
        """报告调用成功，更新健康状态"""
        health = self.health.get(provider)
        if not health:
            return

        health.consecutive_failures = 0
        health.consecutive_successes += 1
        health.last_check_time = time.time()

        # 更新延迟统计（滑动窗口）
        health.latency_history.append(latency_ms)
        if len(health.latency_history) > 20:
            health.latency_history = health.latency_history[-20:]
        health.avg_latency_ms = sum(health.latency_history) / len(health.latency_history)

        # 恢复判定
        recovery_threshold = self.providers[provider]['health_check']['recovery_threshold']
        if health.consecutive_successes >= recovery_threshold:
            if health.status != HealthStatus.HEALTHY:
                logger.info(f"Provider {provider} recovered to HEALTHY")
            health.status = HealthStatus.HEALTHY

    def report_failure(self, provider: str, error: str):
        """报告调用失败，更新健康状态"""
        health = self.health.get(provider)
        if not health:
            return

        health.consecutive_successes = 0
        health.consecutive_failures += 1
        health.last_failure_time = time.time()
        health.last_check_time = time.time()

        failure_threshold = self.providers[provider]['health_check']['failure_threshold']
        if health.consecutive_failures >= failure_threshold:
            health.status = HealthStatus.UNHEALTHY
            logger.warning(f"Provider {provider} marked UNHEALTHY after {health.consecutive_failures} failures: {error}")
        elif health.consecutive_failures >= 1:
            health.status = HealthStatus.DEGRADED
            logger.info(f"Provider {provider} marked DEGRADED: {error}")
```

## 三、31 级 Fallback Chain 的设计与实现

### 3.1 为什么是 31 级？

OpenClaw 的 31 级 fallback chain 并非随意设计的数字。它涵盖了 5 个提供商 × 每提供商 2-3 个模型 = 约 13 个直接模型节点，加上基于能力的分组（reasoning、code、classification、multilingual 等）形成的虚拟路由节点，以及最终的兜底策略节点，总计 31 级。

这 31 级分为四层：

1. **Tier 1 — 首选模型**（Priority 1-10）：最高质量、最高成本的模型，用于关键任务
2. **Tier 2 — 主力模型**（Priority 11-20）：性价比最优的模型，处理 80% 的日常请求
3. **Tier 3 — 经济模型**（Priority 21-30）：低成本模型，用于批量处理和非关键任务
4. **Tier 4 — 兜底策略**（Priority 31）：当所有模型都不可用时的应急方案

### 3.2 Fallback Chain 的执行引擎

```python
# openclaw/core/fallback_engine.py
import asyncio
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
import logging
import time

logger = logging.getLogger(__name__)


@dataclass
class FallbackResult:
    """fallback 执行结果"""
    success: bool
    model_alias: str
    provider: str
    response: Optional[str] = None
    error: Optional[str] = None
    latency_ms: float = 0.0
    attempts: int = 0
    fallback_level: int = 0


class FallbackEngine:
    """
    31 级 Fallback Chain 执行引擎。

    核心逻辑：
    1. 获取完整的 fallback chain
    2. 依次尝试每个模型
    3. 记录每次尝试的结果
    4. 成功则返回，失败则降级到下一个
    5. 全部失败则执行兜底策略
    """

    def __init__(self, router, llm_client):
        self.router = router
        self.llm_client = llm_client
        self.max_retries_per_model = 2
        self.retry_delay_base = 1.0  # 秒，指数退避基数

    async def execute_with_fallback(
        self,
        messages: List[Dict[str, str]],
        required_capabilities: List[str] = None,
        max_cost_per_1m: float = None,
        task_context: str = "",
    ) -> FallbackResult:
        """
        带 fallback 的 LLM 调用。

        参数：
            messages: 对话消息列表
            required_capabilities: 所需的模型能力
            max_cost_per_1m: 最大成本预算
            task_context: 任务上下文（用于日志）

        返回：
            FallbackResult 包含成功/失败状态和响应
        """
        chain = self.router.get_fallback_chain(
            required_capabilities=required_capabilities,
            max_cost_per_1m=max_cost_per_1m,
        )

        if not chain:
            return FallbackResult(
                success=False,
                model_alias="none",
                provider="none",
                error="No available models in fallback chain",
                attempts=0,
            )

        excluded = []
        last_error = None

        for level, model in enumerate(chain):
            # 跳过已标记不健康的 provider
            if model.provider in excluded:
                continue

            for retry in range(self.max_retries_per_model):
                attempt_start = time.time()
                try:
                    logger.info(
                        f"Fallback level {level}, attempt {retry + 1}: "
                        f"calling {model.alias} ({model.provider}) "
                        f"[task: {task_context}]"
                    )

                    response = await self.llm_client.chat(
                        model=model.id,
                        messages=messages,
                        base_url=model.base_url,
                        api_key=model.api_key,
                        max_tokens=model.max_tokens,
                    )

                    latency_ms = (time.time() - attempt_start) * 1000
                    self.router.report_success(model.provider, latency_ms)

                    return FallbackResult(
                        success=True,
                        model_alias=model.alias,
                        provider=model.provider,
                        response=response,
                        latency_ms=latency_ms,
                        attempts=level * self.max_retries_per_model + retry + 1,
                        fallback_level=level,
                    )

                except Exception as e:
                    latency_ms = (time.time() - attempt_start) * 1000
                    last_error = str(e)
                    self.router.report_failure(model.provider, last_error)
                    logger.warning(
                        f"Model {model.alias} attempt {retry + 1} failed: {last_error}"
                    )

                    # 指数退避
                    if retry < self.max_retries_per_model - 1:
                        delay = self.retry_delay_base * (2 ** retry)
                        await asyncio.sleep(delay)

            # 当前模型所有重试都失败，排除此 provider
            excluded.append(model.provider)
            logger.warning(
                f"Excluding provider {model.provider} after all retries exhausted"
            )

        # 所有模型都失败，执行兜底策略
        return await self._fallback_emergency(messages, last_error, task_context)

    async def _fallback_emergency(
        self,
        messages: List[Dict[str, str]],
        last_error: str,
        task_context: str,
    ) -> FallbackResult:
        """
        兜底策略：当所有模型都不可用时的应急处理。

        策略包括：
        1. 返回缓存的最近一次成功响应（如果有）
        2. 返回预设的降级响应模板
        3. 记录告警日志
        """
        logger.critical(
            f"All models exhausted for task [{task_context}]. "
            f"Last error: {last_error}. Executing emergency fallback."
        )

        # 尝试返回缓存响应
        cached = self._get_cached_response(task_context)
        if cached:
            logger.info("Returning cached response as emergency fallback")
            return FallbackResult(
                success=True,
                model_alias="cache",
                provider="cache",
                response=cached,
                attempts=0,
                fallback_level=31,  # 兜底级别
            )

        # 返回降级响应
        degraded_response = self._build_degraded_response(task_context)
        return FallbackResult(
            success=False,
            model_alias="degraded",
            provider="none",
            response=degraded_response,
            error=f"All providers failed. Last error: {last_error}",
            attempts=len(self.router.models) * self.max_retries_per_model,
            fallback_level=31,
        )

    def _get_cached_response(self, task_context: str) -> Optional[str]:
        """获取缓存的响应"""
        # 实现 LRU 缓存查找逻辑
        return None

    def _build_degraded_response(self, task_context: str) -> str:
        """构建降级响应"""
        return (
            "抱歉，当前 AI 服务暂时不可用。我们已记录此问题，"
            "技术团队正在处理中。请稍后重试。\n\n"
            f"任务上下文: {task_context}\n"
            f"时间: {time.strftime('%Y-%m-%d %H:%M:%S')}"
        )
```

### 3.3 基于任务类型的路由策略

OpenClaw 不是简单地按优先级顺序遍历 fallback chain，而是根据任务类型智能选择起点：

```python
# openclaw/core/task_router.py
from enum import Enum
from typing import List, Dict


class TaskType(Enum):
    """任务类型枚举"""
    REASONING = "reasoning"          # 复杂推理任务
    CODE_GENERATION = "code"         # 代码生成
    CLASSIFICATION = "classification" # 文本分类
    EXTRACTION = "extraction"        # 信息抽取
    SUMMARIZATION = "summarization"  # 文本摘要
    TRANSLATION = "translation"      # 翻译
    CREATIVE = "creative"            # 创意写作
    MATH = "math"                    # 数学计算
    VISION = "vision"                # 图像理解
    LONG_CONTEXT = "long_context"    # 长上下文处理


# 任务类型到最优提供商的映射
TASK_PROVIDER_PREFERENCES: Dict[TaskType, List[str]] = {
    TaskType.REASONING: ["deepseek-r1", "copilot-4o", "samba-405b", "mistral-large"],
    TaskType.CODE_GENERATION: ["copilot-4o", "deepseek-v3", "samba-405b", "mistral-large"],
    TaskType.CLASSIFICATION: ["mistral-small", "copilot-4o-mini", "deepseek-v3"],
    TaskType.EXTRACTION: ["mistral-small", "copilot-4o-mini", "deepseek-v3"],
    TaskType.SUMMARIZATION: ["deepseek-v3", "mistral-large", "moonshot-32k"],
    TaskType.TRANSLATION: ["deepseek-v3", "moonshot-128k", "mistral-large"],
    TaskType.CREATIVE: ["copilot-4o", "samba-405b", "mistral-large"],
    TaskType.MATH: ["deepseek-r1", "samba-405b", "copilot-4o"],
    TaskType.VISION: ["copilot-4o"],  # 仅 GPT-4o 支持视觉
    TaskType.LONG_CONTEXT: ["moonshot-128k", "mistral-large", "deepseek-v3"],
}


class TaskRouter:
    """基于任务类型的智能路由器"""

    def __init__(self, model_router):
        self.model_router = model_router

    def route_for_task(
        self,
        task_type: TaskType,
        message_length: int = 0,
    ) -> List[str]:
        """
        根据任务类型返回推荐的模型别名列表（fallback chain）。

        策略：
        1. 首选该任务类型最擅长的模型
        2. 然后是通用高质量模型
        3. 最后是低成本兜底模型
        """
        preferred = TASK_PROVIDER_PREFERENCES.get(task_type, [])
        available = [alias for alias in preferred if alias in self.model_router.models]

        # 如果 message 很长，优先使用长上下文模型
        if message_length > 50000:
            long_ctx = TASK_PROVIDER_PREFERENCES[TaskType.LONG_CONTEXT]
            available = [a for a in long_ctx if a in self.model_router.models] + available

        # 补充通用模型作为后备
        general_models = ["deepseek-v3", "mistral-large", "copilot-4o"]
        for alias in general_models:
            if alias not in available and alias in self.model_router.models:
                available.append(alias)

        return available
```

## 四、Provider 健康监控

### 4.1 异步健康检查器

OpenClaw 运行一个独立的异步健康检查任务，周期性地探测每个 provider 的可用性：

```python
# openclaw/core/health_monitor.py
import asyncio
import aiohttp
import time
import logging
from typing import Dict

logger = logging.getLogger(__name__)


class HealthMonitor:
    """
    Provider 健康监控器。

    功能：
    1. 周期性健康检查（HTTP 探测）
    2. 基于连续失败/成功的状态转移
    3. 延迟统计与异常检测
    4. 自动恢复通知
    """

    def __init__(self, router, alert_callback=None):
        self.router = router
        self.alert_callback = alert_callback
        self._running = False
        self._task = None

    async def start(self):
        """启动健康监控"""
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Health monitor started")

    async def stop(self):
        """停止健康监控"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Health monitor stopped")

    async def _monitor_loop(self):
        """主监控循环"""
        while self._running:
            tasks = []
            for provider_name, provider_config in self.router.providers.items():
                tasks.append(self._check_provider(provider_name, provider_config))

            await asyncio.gather(*tasks, return_exceptions=True)

            # 找到最短的检查间隔
            min_interval = min(
                pc['health_check']['interval_seconds']
                for pc in self.router.providers.values()
            )
            await asyncio.sleep(min_interval)

    async def _check_provider(self, provider_name: str, config: dict):
        """检查单个 provider 的健康状态"""
        health_config = config['health_check']
        url = f"{config['base_url']}{health_config['endpoint']}"
        timeout = aiohttp.ClientTimeout(total=health_config['timeout_seconds'])

        start_time = time.time()
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                headers = {}
                api_key_env = config.get('api_key_env', '')
                import os
                api_key = os.environ.get(api_key_env, '')
                if api_key:
                    headers['Authorization'] = f'Bearer {api_key}'

                async with session.get(url, headers=headers) as resp:
                    latency_ms = (time.time() - start_time) * 1000

                    if resp.status == 200:
                        self.router.report_success(provider_name, latency_ms)
                    else:
                        error_text = await resp.text()
                        self.router.report_failure(
                            provider_name,
                            f"HTTP {resp.status}: {error_text[:200]}"
                        )

        except asyncio.TimeoutError:
            latency_ms = (time.time() - start_time) * 1000
            self.router.report_failure(provider_name, f"Timeout after {latency_ms:.0f}ms")
        except Exception as e:
            self.router.report_failure(provider_name, str(e))

        # 检查是否需要发送告警
        health = self.router.health[provider_name]
        if health.status.value == "unhealthy" and self.alert_callback:
            await self.alert_callback(
                provider=provider_name,
                status=health.status.value,
                consecutive_failures=health.consecutive_failures,
                last_error=f"Last check at {time.strftime('%H:%M:%S')}",
            )

    def get_health_summary(self) -> Dict[str, dict]:
        """获取所有 provider 的健康摘要"""
        summary = {}
        for provider_name, health in self.router.health.items():
            summary[provider_name] = {
                "status": health.status.value,
                "consecutive_failures": health.consecutive_failures,
                "consecutive_successes": health.consecutive_successes,
                "avg_latency_ms": round(health.avg_latency_ms, 2),
                "last_check": time.strftime(
                    '%Y-%m-%d %H:%M:%S',
                    time.localtime(health.last_check_time)
                ) if health.last_check_time else "never",
            }
        return summary
```

### 4.2 健康状态转移图

OpenClaw 的 provider 健康状态遵循以下转移规则：

```
UNKNOWN --[首次成功]--> HEALTHY
UNKNOWN --[首次失败]--> DEGRADED
HEALTHY --[连续 N 次失败]--> UNHEALTHY  (N = failure_threshold)
HEALTHY --[1 次失败]--> DEGRADED
DEGRADED --[连续 N 次成功]--> HEALTHY   (N = recovery_threshold)
DEGRADED --[连续 N 次失败]--> UNHEALTHY
UNHEALTHY --[连续 N 次成功]--> HEALTHY   (N = recovery_threshold)
```

这种设计避免了"抖动"问题——不会因为单次失败就标记为不健康，也不会因为单次成功就恢复为健康，需要连续的多次确认才会触发状态转移。

## 五、成本预算管理

### 5.1 预算控制器

OpenClaw 内置了成本预算管理，防止意外的高额 API 调用费用：

```python
# openclaw/core/cost_controller.py
import time
import json
import logging
from typing import Optional, Dict
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class CostBudget:
    """成本预算配置"""
    daily_limit_usd: float = 10.0       # 每日预算上限（美元）
    monthly_limit_usd: float = 200.0    # 每月预算上限
    per_request_limit_usd: float = 0.5  # 单次请求成本上限
    warning_threshold: float = 0.8      # 80% 时发出警告
    hard_stop_threshold: float = 0.95   # 95% 时硬停止


@dataclass
class CostRecord:
    """单次调用的成本记录"""
    timestamp: float
    model_alias: str
    provider: str
    input_tokens: int
    output_tokens: int
    input_cost: float
    output_cost: float
    total_cost: float
    task_context: str = ""


class CostController:
    """
    成本预算控制器。

    功能：
    1. 实时计算每次 API 调用的成本
    2. 跟踪每日/每月累计成本
    3. 在接近预算上限时发出警告
    4. 在达到硬上限时阻止请求
    5. 按 provider 和模型维度统计成本
    """

    def __init__(self, budget: CostBudget, data_dir: str):
        self.budget = budget
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.records: list = []
        self._load_records()

    def _load_records(self):
        """加载历史成本记录"""
        today = time.strftime('%Y-%m-%d')
        record_file = self.data_dir / f"cost_records_{today}.json"
        if record_file.exists():
            with open(record_file, 'r') as f:
                self.records = json.load(f)

    def _save_records(self):
        """保存成本记录"""
        today = time.strftime('%Y-%m-%d')
        record_file = self.data_dir / f"cost_records_{today}.json"
        with open(record_file, 'w') as f:
            json.dump(self.records, f, indent=2)

    def calculate_cost(
        self,
        model_alias: str,
        input_tokens: int,
        output_tokens: int,
        router,
    ) -> float:
        """计算单次调用的成本"""
        model = router.models.get(model_alias)
        if not model:
            return 0.0

        input_cost = (input_tokens / 1_000_000) * model.input_cost_per_1m
        output_cost = (output_tokens / 1_000_000) * model.output_cost_per_1m
        return input_cost + output_cost

    def check_budget(
        self,
        estimated_cost: float,
    ) -> tuple[bool, str]:
        """
        检查预算是否允许此次调用。

        返回：
            (allowed: bool, reason: str)
        """
        daily_total = self.get_daily_total()
        monthly_total = self.get_monthly_total()

        # 单次请求成本检查
        if estimated_cost > self.budget.per_request_limit_usd:
            return False, (
                f"单次请求预估成本 ${estimated_cost:.4f} 超过上限 "
                f"${self.budget.per_request_limit_usd:.4f}"
            )

        # 每日预算检查
        if daily_total + estimated_cost > self.budget.daily_limit_usd:
            if daily_total >= self.budget.daily_limit_usd * self.budget.hard_stop_threshold:
                return False, (
                    f"每日预算已达硬上限: ${daily_total:.4f} / ${self.budget.daily_limit_usd:.2f}"
                )

        # 每月预算检查
        if monthly_total + estimated_cost > self.budget.monthly_limit_usd:
            if monthly_total >= self.budget.monthly_limit_usd * self.budget.hard_stop_threshold:
                return False, (
                    f"每月预算已达硬上限: ${monthly_total:.4f} / ${self.budget.monthly_limit_usd:.2f}"
                )

        # 警告阈值检查（不阻止，仅警告）
        if daily_total + estimated_cost > self.budget.daily_limit_usd * self.budget.warning_threshold:
            logger.warning(
                f"Daily cost approaching limit: ${daily_total:.4f} / ${self.budget.daily_limit_usd:.2f} "
                f"({daily_total / self.budget.daily_limit_usd * 100:.1f}%)"
            )

        return True, "OK"

    def record_cost(self, record: CostRecord):
        """记录一次调用成本"""
        self.records.append({
            "timestamp": record.timestamp,
            "model_alias": record.model_alias,
            "provider": record.provider,
            "input_tokens": record.input_tokens,
            "output_tokens": record.output_tokens,
            "input_cost": record.input_cost,
            "output_cost": record.output_cost,
            "total_cost": record.total_cost,
            "task_context": record.task_context,
        })
        self._save_records()

        logger.info(
            f"Cost recorded: ${record.total_cost:.6f} "
            f"({record.model_alias}, {record.input_tokens}+{record.output_tokens} tokens)"
        )

    def get_daily_total(self) -> float:
        """获取今日累计成本"""
        return sum(r.get("total_cost", 0) for r in self.records)

    def get_monthly_total(self) -> float:
        """获取本月累计成本"""
        month_prefix = time.strftime('%Y-%m')
        monthly_records = [
            r for r in self.records
            if time.strftime('%Y-%m', time.localtime(r['timestamp'])) == month_prefix
        ]
        return sum(r.get("total_cost", 0) for r in monthly_records)

    def get_cost_breakdown(self) -> Dict[str, float]:
        """按 provider 获取成本分布"""
        breakdown = {}
        for r in self.records:
            provider = r.get("provider", "unknown")
            breakdown[provider] = breakdown.get(provider, 0) + r.get("total_cost", 0)
        return breakdown
```

### 5.2 成本优化的路由策略

在预算紧张时，OpenClaw 会自动切换到更经济的模型：

```python
# openclaw/core/cost_aware_router.py
class CostAwareRouter:
    """成本感知的路由器，在预算紧张时自动降级到低成本模型"""

    def __init__(self, model_router, cost_controller):
        self.model_router = model_router
        self.cost_controller = cost_controller

    def select_model_with_budget(
        self,
        required_capabilities: List[str] = None,
        task_type: TaskType = TaskType.REASONING,
    ):
        """
        选择模型时考虑预算状态。

        策略：
        - 预算充裕（<60%）：使用首选模型
        - 预算中等（60-80%）：使用中等成本模型
        - 预算紧张（80-95%）：使用低成本模型
        - 预算耗尽（>95%）：使用最低成本模型或拒绝
        """
        daily_usage = self.cost_controller.get_daily_total()
        daily_limit = self.cost_controller.budget.daily_limit_usd
        usage_ratio = daily_usage / daily_limit if daily_limit > 0 else 0

        if usage_ratio < 0.6:
            # 预算充裕，不限制成本
            max_cost = None
        elif usage_ratio < 0.8:
            # 预算中等，限制中等成本
            max_cost = 2.0
        elif usage_ratio < 0.95:
            # 预算紧张，使用低成本模型
            max_cost = 0.5
        else:
            # 预算紧张，只用最便宜的模型
            max_cost = 0.3

        return self.model_router.select_model(
            required_capabilities=required_capabilities,
            max_cost_per_1m=max_cost,
        )
```

## 六、完整集成示例

### 6.1 OpenClaw Agent 中的模型调用

将上述组件集成到 OpenClaw Agent 的一次完整调用流程中：

```python
# openclaw/agent.py
import asyncio
from openclaw.core.model_router import ModelRouter
from openclaw.core.fallback_engine import FallbackEngine
from openclaw.core.health_monitor import HealthMonitor
from openclaw.core.cost_controller import CostController, CostBudget, CostRecord
from openclaw.core.task_router import TaskRouter, TaskType
from openclaw.core.cost_aware_router import CostAwareRouter
import time
import logging

logger = logging.getLogger(__name__)


class OpenClawAgent:
    """OpenClaw Agent 主类，集成多模型路由的完整流程"""

    def __init__(self, config_path: str, data_dir: str):
        # 初始化核心组件
        self.router = ModelRouter(config_path)
        self.fallback_engine = FallbackEngine(self.router, self._create_llm_client())
        self.health_monitor = HealthMonitor(self.router, self._on_provider_alert)
        self.cost_controller = CostController(
            budget=CostBudget(
                daily_limit_usd=15.0,
                monthly_limit_usd=300.0,
                per_request_limit_usd=0.8,
            ),
            data_dir=data_dir,
        )
        self.task_router = TaskRouter(self.router)
        self.cost_aware_router = CostAwareRouter(self.router, self.cost_controller)

    async def start(self):
        """启动 Agent，包括健康监控"""
        await self.health_monitor.start()
        logger.info("OpenClaw Agent started with multi-model routing")

    async def stop(self):
        """停止 Agent"""
        await self.health_monitor.stop()
        logger.info("OpenClaw Agent stopped")

    async def chat(
        self,
        messages: list,
        task_type: TaskType = TaskType.REASONING,
        task_context: str = "general",
    ) -> str:
        """
        带完整路由逻辑的对话接口。

        流程：
        1. 分析任务类型
        2. 成本预算检查
        3. 模型选择
        4. 带 fallback 的调用
        5. 成本记录
        6. 返回结果
        """
        # 步骤 1：确定所需能力
        required_capabilities = self._infer_capabilities(task_type)

        # 步骤 2：预算检查
        estimated_cost = self._estimate_cost(required_capabilities)
        allowed, reason = self.cost_controller.check_budget(estimated_cost)
        if not allowed:
            logger.warning(f"Budget check failed: {reason}")
            return f"请求被预算控制器拒绝: {reason}"

        # 步骤 3：模型选择（成本感知）
        selected = self.cost_aware_router.select_model_with_budget(
            required_capabilities=required_capabilities,
            task_type=task_type,
        )

        # 步骤 4：带 fallback 的调用
        result = await self.fallback_engine.execute_with_fallback(
            messages=messages,
            required_capabilities=required_capabilities,
            task_context=task_context,
        )

        # 步骤 5：记录成本
        if result.success and result.model_alias != "cache":
            model = self.router.models.get(result.model_alias)
            if model:
                # 估算 token 数（实际使用 tokenizer 计算）
                input_tokens = sum(len(m.get("content", "")) * 1.3 for m in messages)
                output_tokens = len(result.response or "") * 1.3
                cost = self.cost_controller.calculate_cost(
                    result.model_alias, int(input_tokens), int(output_tokens), self.router
                )
                self.cost_controller.record_cost(CostRecord(
                    timestamp=time.time(),
                    model_alias=result.model_alias,
                    provider=result.provider,
                    input_tokens=int(input_tokens),
                    output_tokens=int(output_tokens),
                    input_cost=cost * 0.4,  # 近似比例
                    output_cost=cost * 0.6,
                    total_cost=cost,
                    task_context=task_context,
                ))

        # 步骤 6：返回结果
        if result.success:
            logger.info(
                f"Request completed: model={result.model_alias}, "
                f"provider={result.provider}, latency={result.latency_ms:.0f}ms, "
                f"attempts={result.attempts}, fallback_level={result.fallback_level}"
            )
            return result.response
        else:
            logger.error(f"Request failed after all fallbacks: {result.error}")
            return result.response or "服务暂时不可用，请稍后重试。"

    def _infer_capabilities(self, task_type: TaskType) -> list:
        """从任务类型推断所需能力"""
        mapping = {
            TaskType.REASONING: ["reasoning"],
            TaskType.CODE_GENERATION: ["code"],
            TaskType.CLASSIFICATION: ["classification"],
            TaskType.EXTRACTION: ["extraction"],
            TaskType.VISION: ["vision"],
            TaskType.LONG_CONTEXT: ["long-context"],
        }
        return mapping.get(task_type, ["reasoning"])

    def _estimate_cost(self, capabilities: list) -> float:
        """估算单次请求成本"""
        model = self.router.select_model(required_capabilities=capabilities)
        if model:
            return model.input_cost_per_1m * 0.002 + model.output_cost_per_1m * 0.003
        return 0.1

    async def _on_provider_alert(self, **kwargs):
        """Provider 状态变化告警回调"""
        logger.critical(f"PROVIDER ALERT: {kwargs}")
        # 可以集成 Slack/Telegram/邮件通知

    def get_status(self) -> dict:
        """获取 Agent 整体状态"""
        return {
            "health": self.health_monitor.get_health_summary(),
            "cost": {
                "daily_total": self.cost_controller.get_daily_total(),
                "monthly_total": self.cost_controller.get_monthly_total(),
                "breakdown": self.cost_controller.get_cost_breakdown(),
            },
            "models": {
                alias: {
                    "provider": model.provider,
                    "priority": model.priority,
                    "cost_per_1m": model.input_cost_per_1m,
                }
                for alias, model in self.router.models.items()
            },
        }
```

### 6.2 启动脚本

```python
# run_openclaw.py
import asyncio
from openclaw.agent import OpenClawAgent
from openclaw.core.task_router import TaskType


async def main():
    agent = OpenClawAgent(
        config_path="config/model_providers.yaml",
        data_dir="data/cost",
    )
    await agent.start()

    try:
        # 简单对话 — 使用 cost-effective 模型
        response = await agent.chat(
            messages=[{"role": "user", "content": "你好，请介绍一下你自己"}],
            task_type=TaskType.REASONING,
            task_context="greeting",
        )
        print(f"Response: {response}")

        # 代码生成 — 路由到擅长 coding 的模型
        response = await agent.chat(
            messages=[{"role": "user", "content": "写一个 Python 快速排序算法"}],
            task_type=TaskType.CODE_GENERATION,
            task_context="code_gen_quicksort",
        )
        print(f"Code: {response}")

        # 查看状态
        status = agent.get_status()
        print(f"Status: {status}")

    finally:
        await agent.stop()


if __name__ == "__main__":
    asyncio.run(main())
```

## 七、各提供商特色对比与选型建议

### 7.1 SambaNova

**优势**：基于自研 RPU 芯片，推理速度极快，尤其适合大模型（405B）的高吞吐场景。Llama 3.1 405B 在 SambaNova 上的推理延迟比传统 GPU 低 30-50%。

**适用场景**：需要大模型推理能力但对延迟敏感的场景，如实时代码生成、复杂推理任务。

**成本**：中等偏上，但考虑速度优势后性价比突出。

### 7.2 Mistral AI

**优势**：欧洲 AI 公司，模型覆盖从小（7B）到大（Large）的完整产品线。Mistral-Small 在分类和抽取任务上性价比极高，Mistral-Large 在多语言场景下表现出色。

**适用场景**：需要 GDPR 合规的欧洲业务；轻量级 NLP 任务用 Mistral-Small；多语言翻译和摘要用 Mistral-Large。

**成本**：Mistral-Small 极其便宜，Mistral-Large 中等。

### 7.3 GitHub Copilot (GPT-4o)

**优势**：与 GitHub 生态深度集成，代码理解能力极强。GPT-4o 是目前综合能力最强的模型之一，特别是在代码生成和视觉理解方面。

**适用场景**：代码相关任务的首选；需要图像理解能力的多模态任务。

**成本**：较高，特别是 GPT-4o 的输出 token 成本。

### 7.4 DeepSeek

**优势**：中国 AI 公司，DeepSeek-V3 在推理和代码任务上表现出色，成本极低。DeepSeek-R1 是专门的推理模型，在数学和逻辑推理上表现卓越。

**适用场景**：成本敏感的高频调用场景；中文处理任务；数学和逻辑推理。

**成本**：极低，是目前主流提供商中最具性价比的选择之一。

### 7.5 Moonshot AI (Kimi)

**优势**：支持 128K 超长上下文，在需要处理长文档的场景下优势明显。中文理解能力强。

**适用场景**：长文档分析和摘要；中文对话场景；需要超长上下文窗口的任务。

**成本**：中等，128K 版本略贵但上下文长度优势明显。

### 7.6 选型决策矩阵

| 场景 | 首选 | 次选 | 经济选 |
|------|------|------|--------|
| 代码生成 | Copilot-4o | DeepSeek-V3 | Samba-70B |
| 复杂推理 | DeepSeek-R1 | Samba-405B | Copilot-4o |
| 文本分类 | Mistral-Small | Copilot-4o-mini | DeepSeek-V3 |
| 长文档处理 | Moonshot-128K | Mistral-Large | DeepSeek-V3 |
| 多语言翻译 | DeepSeek-V3 | Mistral-Large | Moonshot-32K |
| 图像理解 | Copilot-4o | - | - |
| 高频批量处理 | DeepSeek-V3 | Mistral-Small | Copilot-4o-mini |

## 八、生产环境最佳实践

### 8.1 配置管理

```yaml
# config/production.yaml
model_routing:
  # 默认 fallback chain（不指定 task_type 时使用）
  default_chain:
    - deepseek-v3      # 成本最优的通用模型
    - mistral-large     # 欧洲合规备选
    - copilot-4o        # 最高质量兜底

  # 任务特定路由覆盖
  task_overrides:
    code_generation:
      chain: [copilot-4o, deepseek-v3, samba-405b]
      max_cost_per_1m: 5.0
    classification:
      chain: [mistral-small, copilot-4o-mini]
      max_cost_per_1m: 0.5

  # 紧急降级配置
  emergency:
    enable_cache_fallback: true
    cache_ttl_seconds: 3600
    degraded_response_template: "templates/degraded_response.md"
    alert_channels: ["slack", "telegram"]
```

### 8.2 监控与告警

建议在生产环境中配置以下监控指标：

- **模型可用率**：每个 provider 的成功请求比例
- **P95 延迟**：95 分位的请求延迟
- **Fallback 触发率**：有多少请求走了 fallback chain
- **每日/每月成本**：累计 API 调用成本
- **Token 使用分布**：输入/输出 token 的分布情况

### 8.3 常见陷阱与解决方案

**陷阱 1：Provider 同时故障**
当多个 provider 同时出现故障时（如上游 DNS 问题），健康检查可能会误判。解决方案是在 health_check 中增加 DNS 解析检查，并使用多个 DNS 服务器。

**陷阱 2：Token 计数不准确**
不同模型使用不同的 tokenizer，简单按字符数估算会导致成本计算偏差。建议集成 tiktoken 或 sentencepiece 进行精确计数。

**陷阱 3：长上下文模型的隐性成本**
128K 上下文模型虽然单次可以处理更多内容，但输入 token 成本也会线性增长。需要在路由时考虑实际需要的上下文长度，避免不必要的成本浪费。

## 九、总结

OpenClaw 的多模型路由系统通过声明式配置、31 级 fallback chain、provider 健康监控和成本预算管理四个核心机制，实现了生产级的高可用和成本优化。其设计哲学是**"不把鸡蛋放在一个篮子里"**——通过多提供商冗余确保服务可用性，通过智能路由确保成本可控，通过健康监控确保故障快速恢复。

在实际部署中，建议从以下步骤开始：

1. **配置 2-3 个提供商**：先从 DeepSeek + Mistral + Copilot 开始，覆盖低成本、中等和高质量三个层次
2. **设置合理的预算**：根据业务量设置每日/每月预算上限
3. **监控 fallback 触发率**：如果 fallback 频繁触发，说明主模型配置需要调整
4. **定期评审成本分布**：每月 review 一次各 provider 的成本占比，优化路由策略

多模型路由不是一次性配置的工作，而是需要根据业务变化持续优化的运营实践。OpenClaw 提供的工具链和配置体系，让这种持续优化变得简单而高效。

## 相关阅读

- [OpenClaw vs Hermes 模型管理对比：声明式 ProviderProfile 与运维级 Fallback Chain](/categories/架构/OpenClaw-vs-Hermes-模型管理对比-声明式ProviderProfile与运维级Fallback-Chain/)
- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比/)
- [AI Agent 成本优化实战：Token 缓存、模型降级与预算管控](/categories/AI%20Agent/ai-application-cost-optimization-token-caching-model-degradation/)
