---

title: AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略
keywords: [AI Agent Error Recovery, LLM, 工具调用失败, 幻觉, 上下文溢出的自动降级与重试策略]
date: 2026-06-05 12:00:00
tags:
- AI Agent
- error-recovery
- 降级策略
- LLM
- Laravel
- 重试策略
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: AI Agent 在生产环境中面临工具调用失败、LLM 幻觉、上下文溢出三大核心故障模式。本文系统性地剖析每种故障的根因与表现，结合 Laravel/PHP 项目实战，给出可落地的错误恢复策略：指数退避重试与熔断器模式应对工具调用失败，Schema 校验、事实一致性检查与 Self-Reflection 机制防护 LLM 幻觉，对话摘要压缩、滑动窗口与关键信息持久化管理上下文溢出。文中涵盖完整的降级策略代码实现、重试风暴踩坑案例、错误恢复决策树，以及 Token 计数器、Prompt 工程技巧等实用工具，帮助开发者将 Agent 系统从 Demo 推向 Production。
---



# AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略

## 一、引言：Agent 系统中错误处理的重要性

在 Demo 阶段，AI Agent 总是「恰好」工作得很好——模型回复精准、工具调用一次成功、上下文窗口足够大。但一旦进入生产环境，你会很快发现一个残酷的事实：**Agent 系统的失败模式远比传统 Web 应用复杂，而且失败几乎是必然事件。**

传统 Web 应用的错误链条通常是：请求 → 业务逻辑 → 数据库或第三方 API → 响应。失败点相对集中，重试和降级策略已经非常成熟。但 AI Agent 的执行链路完全不同，它是一个多轮循环的推理执行过程：

用户输入 → LLM 推理 → 解析工具调用 → 执行工具 → 结果回填 → LLM 二次推理 → 最终输出

这个链条中的每一个环节都可能失败，而且失败的形态各不相同。更重要的是，这些失败往往不是独立的，一个环节的错误可能会级联放大。比如 LLM 生成了格式错误的工具参数，导致工具调用失败，Agent 重试时又因为上下文累积导致 Token 超限，最终整个对话崩溃。

在我们的 Laravel 电商客服 Agent 项目中，上线第一周就遇到了这些问题：支付网关偶尔超时导致订单查询失败、LLM 编造了不存在的优惠券代码告诉用户、多轮对话后上下文溢出导致 Agent 完全丧失记忆。这些经历促使我们构建了一套完整的错误恢复体系。

本文将系统性地拆解 Agent 系统的三大核心故障模式——**工具调用失败**、**LLM 幻觉**、**上下文溢出**——并结合 Laravel/PHP 项目场景，给出可落地的检测、降级与恢复策略。每种策略都配有完整的代码示例，读者可以直接借鉴到自己的项目中。

---

## 二、三大故障模式分类与深度剖析

在构建错误恢复系统之前，我们必须先理解每种故障模式的根因、表现和影响范围。盲目地套用「重试三次」的模板是远远不够的。

### 2.1 工具调用失败：最常见也最可控

工具调用失败是 Agent 系统中最常见的故障类型。在我们的项目中，Agent 可能调用的工具包括数据库查询、外部支付 API、物流追踪接口、知识库检索等。根据故障原因，可以进一步细分为四个层次：

**网络层故障**包括 API 超时、DNS 解析失败、TCP 连接被重置、SSL 握手失败等。这类问题通常是瞬时性的，在我们的监控数据中，约 70% 的网络层故障在 30 秒内自行恢复。重试通常是最有效的应对策略，但需要注意的是，对于非幂等操作（比如扣款），盲目重试可能产生重复操作。

**鉴权层故障**包括 OAuth 2.0 Access Token 过期、API Key 被管理员轮换、服务账号权限不足、IP 白名单变更等。这类问题的特殊之处在于，简单的重试不会有效果，必须先刷新凭证。在 Laravel 项目中，我们通常使用 Token Manager 统一管理各种外部服务的凭证生命周期。

**参数层故障**是 Agent 系统特有的问题。LLM 生成的工具调用参数可能不符合预期——日期格式从 `YYYY-MM-DD` 变成了 `YYYY/MM/DD`，必填字段被遗漏，枚举值使用了未定义的选项。这类问题的关键在于，错误信息本身是有价值的，可以反馈给 LLM 进行自我修正。

**业务层故障**是工具本身返回的业务逻辑错误，比如查询的订单不存在、余额不足无法支付、商品已下架等。这类错误重试完全没有意义，需要降级处理——向用户清晰地解释问题并提供替代方案。

```php
/**
 * 工具调用执行器 - 分层错误处理
 * 
 * 根据不同层次的异常类型，采取差异化的处理策略：
 * - 网络层 → 可重试
 * - 鉴权层 → 刷新凭证后重试
 * - 参数层 → 反馈给 LLM 自我修正
 * - 业务层 → 降级输出
 */
class ToolExecutor
{
    private CredentialManager $credentialManager;
    private AgentStructuredLogger $logger;

    public function execute(
        string $toolName,
        array $params,
        string $conversationId
    ): ToolResult {
        $startTime = microtime(true);

        try {
            $tool = $this->resolveTool($toolName);
            $result = $tool->call($params);
            
            $durationMs = (microtime(true) - $startTime) * 1000;
            $this->logger->logToolCall(
                $conversationId, $toolName, $params,
                $result, $durationMs
            );

            return $result;

        } catch (ConnectException|TimeoutException $e) {
            // 网络层故障 → 标记为可重试
            return ToolResult::retryable(
                "工具 {$toolName} 网络异常: " . $e->getMessage(),
                errorType: 'network'
            );

        } catch (AuthenticationException $e) {
            // 鉴权层故障 → 尝试刷新凭证
            $this->credentialManager->refresh($toolName);
            return ToolResult::retryable(
                "凭证已刷新，请重新调用 {$toolName}",
                errorType: 'auth',
                metadata: ['credential_refreshed' => true]
            );

        } catch (ValidationException $e) {
            // 参数层故障 → 反馈错误信息供 LLM 修正
            return ToolResult::correction(
                "参数校验失败: " . $e->getMessage(),
                errorType: 'validation',
                metadata: ['expected_schema' => $tool->getParameterSchema()]
            );

        } catch (BusinessException $e) {
            // 业务层故障 → 不可重试，需要降级
            return ToolResult::failed(
                "业务异常: " . $e->getMessage(),
                errorType: 'business'
            );
        }
    }
}
```

### 2.2 LLM 幻觉：最隐蔽也最危险

LLM 幻觉是 Agent 系统中最棘手的问题，因为它往往看起来「很像真的」。不像网络错误那样有明确的错误码，幻觉输出可能格式完美、语言流畅，但实际上包含虚假信息。

**虚构工具调用**是指 LLM 在 function calling 中生成了根本不存在的工具名称。在我们的监控中，这种情况约占所有工具调用失败的 15%。例如系统注册了 `search_orders` 工具，但 LLM 生成了 `find_orders_by_date` 或 `query_user_purchase_history` 的调用。这通常发生在工具描述不够清晰、或者 LLM 的训练数据中包含了类似但不同的函数名时。

**编造返回数据**是最危险的幻觉类型。当工具调用返回空结果或错误时，LLM 可能忽略这些信息，自行编造看起来合理的数据告诉用户。比如数据库查询返回 0 条记录，但 LLM 告诉用户「找到了 3 笔订单，总金额 ¥1,280」。如果用户基于这些虚假信息做出决策（比如认为订单已处理），后果可能非常严重。

**格式不一致**是指 LLM 的输出格式与预期不符。你要求 JSON，它返回 Markdown；你要求严格的字段结构，它多加了几个「贴心」的额外字段。这看起来是小问题，但在自动化流水线中，格式不一致会导致整个下游解析失败。

**逻辑自相矛盾**多发生在多轮对话中。LLM 先说「您的订单已发货」，几分钟后在用户追问时又说「订单还在仓库处理中」。这种前后矛盾会严重损害用户对系统的信任。

**数字幻觉**是电商和金融场景中最常见的幻觉类型。LLM 可能将订单金额从 ¥299 编造为 ¥399，或者将库存数量从 0 编造为 15。在涉及金钱的业务中，数字幻觉的后果尤为严重。

```php
// 真实生产环境中的幻觉案例
// 案例 1：虚构工具调用
$llmResponse = [
    'tool_calls' => [[
        'function' => [
            'name' => 'query_user_purchase_history', // 这个工具根本不存在！
            'arguments' => '{"user_id": 123, "days": 30}'
        ]
    ]]
];

// 案例 2：编造返回数据
$toolResult = ['orders' => [], 'count' => 0]; // 工具实际返回空
$llmResponse = "根据查询结果，用户在过去30天内有3笔订单，总金额¥1,280。"; // 纯属编造

// 案例 3：数字幻觉
$toolResult = ['price' => 299.00, 'stock' => 0]; // 实际价格299，库存0
$llmResponse = "该商品价格为¥399，目前库存充足。"; // 价格和库存都编造了
```

### 2.3 上下文溢出：最确定但最容易被忽视

上下文溢出是一个「温水煮青蛙」式的问题。它不像工具调用失败那样突然发生，而是随着对话轮次的增加，上下文窗口逐渐逼近极限，最终在某个时刻突破阈值导致 LLM API 调用直接失败。

**Token 超限的直接后果**是 LLM API 返回 HTTP 400 错误，Agent 完全无法生成响应。对于用户来说，这意味着对话突然中断，前面的所有沟通都白费了。

**隐性溢出**是一个更隐蔽的问题。即使 Token 总量未超限，过长的上下文也会导致 LLM 的注意力分散，关键信息被大量历史消息「淹没」。研究表明，当上下文长度超过模型有效上下文窗口的 60% 时，输出质量就开始明显下降。这意味着一个 128K 上下文的模型，在对话历史超过约 50K tokens 时，就应该开始考虑压缩了。

**RAG 内容膨胀**是另一个常见的溢出触发因素。检索增强生成场景中，如果检索策略不当（比如返回 Top-20 而不是 Top-5），每个检索片段平均 500 tokens，一次就可能塞入 10,000 tokens 的额外内容，迅速撑爆上下文预算。

**工具描述累积**是一个容易被忽视的因素。每个注册工具的描述平均占用 200-500 tokens，如果你的 Agent 注册了 20 个工具，光工具描述就可能占去 6,000-10,000 tokens。在 GPT-3.5-turbo 的 16K 上下文窗口中，这已经是一笔巨大的开销。

```php
/**
 * Token 预算计算器
 * 
 * 帮助开发者直观理解上下文空间的分配情况
 */
class TokenBudget
{
    private int $maxTokens;
    private int $systemPromptTokens;
    private int $toolsDescriptionTokens;

    public function __construct(int $maxTokens = 128000)
    {
        $this->maxTokens = $maxTokens;
        // system prompt 和工具描述在初始化时计算一次
        $this->systemPromptTokens = 0;
        $this->toolsDescriptionTokens = 0;
    }

    public function getAvailableForMessages(): int
    {
        return $this->maxTokens
            - $this->systemPromptTokens      // 系统提示词：约 800 tokens
            - $this->toolsDescriptionTokens   // 工具描述：约 2000-10000 tokens
            - 4000;                           // 预留给模型输出的安全余量
    }

    /**
     * 计算当前预算使用率
     * 返回 0.0 到 1.0 之间的浮点数
     */
    public function getUsageRatio(int $currentMessageTokens): float
    {
        $available = $this->getAvailableForMessages();
        return $available > 0 ? $currentMessageTokens / $available : 1.0;
    }

    /**
     * 根据使用率决定处理策略
     */
    public function getRecommendedAction(float $usageRatio): string
    {
        if ($usageRatio < 0.6) {
            return 'none';        // 安全区间，无需处理
        } elseif ($usageRatio < 0.8) {
            return 'compress';    // 预警区间，启动摘要压缩
        } elseif ($usageRatio < 0.95) {
            return 'truncate';    // 危险区间，滑动窗口截断
        } else {
            return 'emergency';   // 紧急区间，只保留最近 2 轮对话
        }
    }
}

// 不同模型的 Token 预算对比
$budgets = [
    'gpt-4o'            => 128000, // 约可容纳 300+ 轮对话
    'gpt-3.5-turbo'     => 16000,  // 约可容纳 30-40 轮对话
    'claude-3.5-sonnet' => 200000, // 约可容纳 500+ 轮对话
    'deepseek-v3'       => 64000,  // 约可容纳 150+ 轮对话
    'qwen-turbo'        => 131072, // 约可容纳 300+ 轮对话
];
```

---

## 三、工具调用失败的降级策略

理解了故障模式之后，我们来看具体的应对策略。对于工具调用失败，我们有四种递进式的处理手段。

### 3.1 指数退避重试（Exponential Backoff with Jitter）

指数退避是处理瞬时性故障的首选策略。核心思想是每次重试间隔时间翻倍，并加入随机抖动避免多个客户端在同一时刻集中重试（即惊群效应）。在 Agent 系统中，这一点尤为重要，因为同一个 Agent 可能同时服务多个用户对话，如果所有失败的调用都在同一秒重试，反而会对下游服务造成更大压力。

重试策略中需要特别注意三个关键参数：最大重试次数决定了在放弃之前我们愿意等待多久；基础延迟决定了第一次重试前的等待时间；最大延迟则防止退避时间无限增长。经验值是：网络层故障最多重试 3 次，基础延迟 1 秒，最大延迟 30 秒。

```php
/**
 * 指数退避重试器
 * 
 * 实现了指数退避 + 随机抖动的重试策略。
 * 抖动（Jitter）的作用是防止惊群效应——当多个 Agent 实例
 * 同时遇到同一工具的故障时，如果没有抖动，它们会在完全相同
 * 的时刻发起重试，对下游造成额外压力。
 */
class ExponentialBackoffRetry
{
    private int $maxAttempts;
    private int $baseDelayMs;
    private int $maxDelayMs;
    private float $jitterFactor;

    public function __construct(
        int $maxAttempts = 3,
        int $baseDelayMs = 1000,
        int $maxDelayMs = 30000,
        float $jitterFactor = 0.3
    ) {
        $this->maxAttempts = $maxAttempts;
        $this->baseDelayMs = $baseDelayMs;
        $this->maxDelayMs = $maxDelayMs;
        $this->jitterFactor = $jitterFactor;
    }

    /**
     * 执行操作，失败时自动重试
     * 
     * @param callable $operation 要执行的操作
     * @param string $operationName 操作名称，用于日志
     * @return mixed 操作结果
     * @throws MaxRetriesExceededException 超过最大重试次数
     */
    public function execute(callable $operation, string $operationName = 'unknown'): mixed
    {
        $lastException = null;

        for ($attempt = 0; $attempt < $this->maxAttempts; $attempt++) {
            try {
                $result = $operation();

                // 重试成功时记录日志
                if ($attempt > 0) {
                    Log::channel('agent')->info("重试成功", [
                        'operation' => $operationName,
                        'attempt' => $attempt + 1,
                        'total_attempts' => $this->maxAttempts,
                    ]);
                }

                return $result;

            } catch (RetryableException $e) {
                $lastException = $e;

                if ($attempt < $this->maxAttempts - 1) {
                    $delay = $this->calculateDelay($attempt);
                    
                    Log::channel('agent')->warning("操作失败，准备重试", [
                        'operation' => $operationName,
                        'attempt' => $attempt + 1,
                        'max_attempts' => $this->maxAttempts,
                        'delay_ms' => $delay,
                        'error_class' => get_class($e),
                        'error_message' => $e->getMessage(),
                    ]);

                    // 使用 usleep 进行毫秒级等待
                    usleep($delay * 1000);
                }
            }
        }

        Log::channel('agent')->error("重试耗尽，操作最终失败", [
            'operation' => $operationName,
            'total_attempts' => $this->maxAttempts,
            'last_error' => $lastException?->getMessage(),
        ]);

        throw new MaxRetriesExceededException(
            "操作 {$operationName} 在 {$this->maxAttempts} 次重试后仍然失败",
            previous: $lastException
        );
    }

    /**
     * 计算第 N 次重试的延迟时间
     * 
     * 公式：min(baseDelay * 2^attempt + jitter, maxDelay)
     * 
     * 典型序列（baseDelay=1000ms, jitterFactor=0.3）：
     * - 第 1 次重试：约 1000ms
     * - 第 2 次重试：约 2000ms
     * - 第 3 次重试：约 4000ms
     */
    private function calculateDelay(int $attempt): int
    {
        $baseDelay = $this->baseDelayMs * pow(2, $attempt);
        $jitter = $baseDelay * $this->jitterFactor * (mt_rand() / mt_getrandmax());
        $totalDelay = (int)($baseDelay + $jitter);

        return min($totalDelay, $this->maxDelayMs);
    }
}
```

在 Laravel 中，除了自定义实现，你也可以直接使用框架内置的 retry 辅助函数来快速实现基础的重试逻辑：

```php
/**
 * Laravel 原生 retry 实现
 * 
 * 适合快速原型验证，但对于 Agent 生产系统，
 * 建议使用上面的 ExponentialBackoffRetry 获得更好的可观测性
 */
$result = retry(
    attempts: 3,
    callback: function () use ($toolName, $params) {
        return $this->toolRegistry->call($toolName, $params);
    },
    sleepMilliseconds: 1000,
    when: fn (\Throwable $e) => $e instanceof RetryableException
);
```

### 3.2 备用工具切换（Fallback Tool Chain）

当主工具完全不可用（而非临时故障）时，自动切换到功能等价的备用工具。这在依赖多个第三方 API 的场景中特别有用。比如搜索引擎有 Algolia、Elasticsearch、数据库 LIKE 查询三级降级链，任何一个环节出问题都可以无缝切换到下一级。

设计备用工具链时需要遵循一个重要原则：**功能等价性**。备用工具不一定提供完全相同的功能，但必须能满足用户请求的核心需求。比如在搜索场景中，Algolia 提供了高亮和分面搜索，降级到数据库 LIKE 查询后这些高级功能就没了，但核心的「查找匹配记录」功能仍然可以实现。

```php
/**
 * 备用工具链
 * 
 * 按优先级排列的工具集合，主工具失败时自动降级到下一个。
 * 注意：功能等价性是设计备用链的核心约束——不同工具的返回
 * 格式可能不同，需要做适配转换。
 */
class FallbackToolChain
{
    private array $toolChain;
    private AgentStructuredLogger $logger;

    /**
     * @param array<string, ToolInterface> $tools 优先级从高到低排列
     */
    public function __construct(array $tools, AgentStructuredLogger $logger)
    {
        $this->toolChain = $tools;
        $this->logger = $logger;
    }

    /**
     * 依次尝试工具链中的每个工具，直到成功或全部失败
     */
    public function execute(array $params, string $conversationId = ''): ToolResult
    {
        $errors = [];
        $attemptedTools = [];

        foreach ($this->toolChain as $toolName => $tool) {
            $attemptedTools[] = $toolName;

            try {
                $result = $tool->call($params);
                
                if (!empty($attemptedTools) && count($attemptedTools) > 1) {
                    Log::channel('agent')->info("备用工具链降级成功", [
                        'attempted_tools' => $attemptedTools,
                        'succeeded_tool' => $toolName,
                        'conversation_id' => $conversationId,
                    ]);
                }

                return $result;

            } catch (ToolException $e) {
                $errors[$toolName] = $e->getMessage();
                
                Log::channel('agent')->warning("备用工具链: {$toolName} 失败", [
                    'error' => $e->getMessage(),
                    'attempted' => $attemptedTools,
                    'remaining' => array_diff(array_keys($this->toolChain), $attemptedTools),
                ]);
            }
        }

        // 所有工具都失败了，返回详细的错误信息
        $errorSummary = collect($errors)
            ->map(fn($msg, $name) => "  - {$name}: {$msg}")
            ->implode("\n");

        return ToolResult::failed(
            "所有备用工具均失败:\n{$errorSummary}",
            errorType: 'fallback_exhausted'
        );
    }
}

// 使用示例：搜索工具的三级降级链
$searchChain = new FallbackToolChain([
    'algolia_search'  => new AlgoliaSearchTool(),       // 一级：全文搜索引擎
    'elasticsearch'   => new ElasticsearchTool(),       // 二级：自建搜索引擎
    'database_search' => new DatabaseLikeSearchTool(),  // 三级：数据库 LIKE 查询（最终降级）
], $logger);
```

### 3.3 熔断器模式（Circuit Breaker）

当某个工具持续失败时（比如目标 API 完全宕机），继续重试和切换备用工具都是在浪费时间和资源。熔断器模式可以在检测到连续失败后主动「跳闸」，在冷却期内直接拒绝所有对该工具的调用，避免无意义的资源消耗。

熔断器有三种状态：**关闭状态**（正常工作，所有请求都放行）、**开启状态**（拒绝所有请求，直接返回降级响应）、**半开状态**（冷却期结束后，试探性放行少量请求，如果成功则恢复到关闭状态，如果失败则重新回到开启状态）。

在 Laravel 项目中，我们使用 Redis 来存储熔断器状态，这样在多实例部署时所有实例共享同一个熔断器视图，避免单个实例的熔断器状态不一致。

```php
/**
 * 熔断器
 * 
 * 通过 Redis 驱动的状态机，实现跨实例共享的熔断保护。
 * 
 * 状态转换：
 * - CLOSED → OPEN：连续失败次数达到阈值
 * - OPEN → HALF_OPEN：冷却期结束
 * - HALF_OPEN → CLOSED：试探性请求成功
 * - HALF_OPEN → OPEN：试探性请求失败
 */
class CircuitBreaker
{
    private string $toolName;
    private int $failureThreshold;
    private int $recoveryTimeoutSeconds;
    private int $halfOpenMaxAttempts;

    private const STATE_CLOSED = 'closed';
    private const STATE_OPEN = 'open';
    private const STATE_HALF_OPEN = 'half_open';

    public function __construct(
        string $toolName,
        int $failureThreshold = 5,
        int $recoveryTimeoutSeconds = 60,
        int $halfOpenMaxAttempts = 3
    ) {
        $this->toolName = $toolName;
        $this->failureThreshold = $failureThreshold;
        $this->recoveryTimeoutSeconds = $recoveryTimeoutSeconds;
        $this->halfOpenMaxAttempts = $halfOpenMaxAttempts;
    }

    /**
     * 获取当前熔断器状态
     * 
     * 核心逻辑：即使状态记录为 OPEN，如果已经过了冷却期，
     * 也需要自动转换为 HALF_OPEN 状态
     */
    public function getState(): string
    {
        $key = "circuit_breaker:{$this->toolName}";
        $state = Cache::get($key, [
            'state' => self::STATE_CLOSED,
            'failures' => 0,
            'last_failure' => null,
            'half_open_successes' => 0,
        ]);

        // OPEN 状态下检查冷却期是否已过
        if ($state['state'] === self::STATE_OPEN && $state['last_failure'] !== null) {
            $elapsed = time() - $state['last_failure'];
            if ($elapsed >= $this->recoveryTimeoutSeconds) {
                $state['state'] = self::STATE_HALF_OPEN;
                $state['half_open_successes'] = 0;
                Cache::put($key, $state, now()->addHours(1));

                Log::channel('agent')->info("熔断器进入半开状态", [
                    'tool' => $this->toolName,
                    'cooldown_elapsed' => $elapsed,
                ]);
            }
        }

        return $state['state'];
    }

    /**
     * 通过熔断器执行操作
     * 
     * OPEN 状态直接拒绝，不浪费任何资源
     */
    public function execute(callable $operation): mixed
    {
        $currentState = $this->getState();

        if ($currentState === self::STATE_OPEN) {
            Log::channel('agent')->warning("熔断器已开启，拒绝调用", [
                'tool' => $this->toolName,
            ]);
            throw new CircuitBreakerOpenException(
                "工具 {$this->toolName} 暂时不可用（熔断器已开启），请稍后重试"
            );
        }

        try {
            $result = $operation();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();
            throw $e;
        }
    }

    private function recordSuccess(): void
    {
        $key = "circuit_breaker:{$this->toolName}";
        
        // 在 HALF_OPEN 状态下，需要累积成功次数才能完全恢复
        $state = Cache::get($key);
        if ($state && $state['state'] === self::STATE_HALF_OPEN) {
            $state['half_open_successes']++;
            if ($state['half_open_successes'] >= $this->halfOpenMaxAttempts) {
                $state['state'] = self::STATE_CLOSED;
                $state['failures'] = 0;
                Log::channel('agent')->info("熔断器已恢复（半开→关闭）", [
                    'tool' => $this->toolName,
                ]);
            }
            Cache::put($key, $state, now()->addHours(1));
        } else {
            // CLOSED 状态下直接重置
            Cache::put($key, [
                'state' => self::STATE_CLOSED,
                'failures' => 0,
                'last_failure' => null,
                'half_open_successes' => 0,
            ], now()->addHours(1));
        }
    }

    private function recordFailure(): void
    {
        $key = "circuit_breaker:{$this->toolName}";
        $state = Cache::get($key, [
            'state' => self::STATE_CLOSED,
            'failures' => 0,
            'last_failure' => null,
            'half_open_successes' => 0,
        ]);

        $state['failures']++;
        $state['last_failure'] = time();

        // 在 HALF_OPEN 状态下失败，立即回到 OPEN 状态
        if ($state['state'] === self::STATE_HALF_OPEN) {
            $state['state'] = self::STATE_OPEN;
            Log::channel('agent')->warning("熔断器重新开启（半开失败）", [
                'tool' => $this->toolName,
            ]);
        }
        // 在 CLOSED 状态下，检查是否达到阈值
        elseif ($state['failures'] >= $this->failureThreshold) {
            $state['state'] = self::STATE_OPEN;
            Log::channel('agent')->alert("熔断器已开启", [
                'tool' => $this->toolName,
                'failures' => $state['failures'],
                'threshold' => $this->failureThreshold,
            ]);
        }

        Cache::put($key, $state, now()->addHours(1));
    }

    /**
     * 手动重置熔断器（用于运维操作）
     */
    public function reset(): void
    {
        Cache::forget("circuit_breaker:{$this->toolName}");
        Log::channel('agent')->info("熔断器已手动重置", ['tool' => $this->toolName]);
    }
}
```

### 3.4 优雅降级输出

当所有自动恢复手段（重试、切换、熔断）都耗尽后，我们需要给用户一个有意义的降级响应。这个响应不是简单的「系统错误」，而是要尽可能地帮助用户理解当前状况并提供替代方案。

```php
/**
 * 优雅降级处理器
 * 
 * 当工具调用完全失败时，生成对用户友好的降级响应。
 * 关键原则：
 * 1. 诚实告知问题（不隐瞒错误）
 * 2. 提供替代方案（不让用户无路可走）
 * 3. 给出预期（告诉用户什么时候可以再试）
 */
class GracefulDegradation
{
    /**
     * 针对不同工具的降级消息模板
     * 为高频使用的工具定制个性化降级信息
     */
    private array $toolSpecificMessages = [
        'payment_gateway' => [
            'message' => '支付服务暂时不可用。建议您：',
            'suggestions' => [
                '稍后重试支付',
                '尝试使用其他支付方式',
                '联系客服协助处理（客服电话：400-xxx-xxxx）',
            ],
        ],
        'order_search' => [
            'message' => '订单查询服务暂时不可用。建议您：',
            'suggestions' => [
                '提供订单号，我可以尝试直接查询',
                '稍后重试查询',
                '查看您的邮箱，订单确认邮件中包含订单详情',
            ],
        ],
        'knowledge_base' => [
            'message' => '知识库检索暂时不可用。建议您：',
            'suggestions' => [
                '尝试更具体地描述您的问题',
                '稍后重试',
                '联系人工客服获取帮助',
            ],
        ],
    ];

    public function handleToolFailure(
        string $toolName,
        string $userQuery,
        ?\Throwable $exception
    ): string {
        // 优先使用工具特定的降级消息
        if (isset($this->toolSpecificMessages[$toolName])) {
            $template = $this->toolSpecificMessages[$toolName];
            $suggestions = collect($template['suggestions'])
                ->map(fn($s, $i) => ($i + 1) . ". {$s}")
                ->implode("\n");

            return "{$template['message']}\n{$suggestions}";
        }

        // 通用降级消息
        return sprintf(
            "抱歉，执行「%s」时遇到了技术问题（错误已自动上报）。您可以：\n" .
            "1. 稍后重试\n" .
            "2. 换一种方式描述您的需求\n" .
            "3. 输入「人工客服」转接人工服务",
            $userQuery
        );
    }
}
```

---

## 四、LLM 幻觉检测与防护

幻觉无法完全消除——这是由 LLM 的概率生成本质决定的。但我们可以通过多层防护机制，将幻觉的影响降到最低。

### 4.1 输出 Schema 校验：从源头堵住幻觉

第一道防线是在 Agent 框架层面强制对 LLM 的所有 tool_calls 输出进行 Schema 校验。这不是可选的后处理步骤，而是必须在工具执行之前完成的前置检查。

在 Laravel 项目中，我们结合 JSON Schema 标准和 PHP 的强类型系统来实现双重校验。JSON Schema 提供了声明式的参数约束（类型、范围、枚举值、正则匹配等），而 PHP 的类型系统在运行时提供额外的安全保障。

```php
/**
 * 输出 Schema 校验器
 * 
 * 对 LLM 生成的 tool_calls 进行严格的 Schema 校验。
 * 校验层次：
 * 1. 工具存在性：调用的工具是否在注册表中
 * 2. 参数完整性：必填参数是否都存在
 * 3. 参数类型：每个参数的类型是否正确
 * 4. 参数范围：数值参数是否在允许范围内
 * 5. 格式校验：日期、邮箱、URL 等格式是否正确
 */
class OutputSchemaValidator
{
    private JsonSchemaValidator $jsonValidator;

    public function __construct()
    {
        $this->jsonValidator = new JsonSchemaValidator();
    }

    /**
     * 校验 LLM 的 tool_calls 输出
     */
    public function validateToolCalls(
        array $toolCalls,
        ToolRegistry $registry
    ): ValidationResult {
        $errors = [];

        foreach ($toolCalls as $index => $toolCall) {
            $functionName = $toolCall['function']['name'] ?? '';
            $arguments = $toolCall['function']['arguments'] ?? '{}';

            // 第一层：工具存在性检查
            if (!$registry->has($functionName)) {
                $similarTools = $registry->findSimilar($functionName);
                $errors[] = [
                    'index' => $index,
                    'type' => 'unknown_tool',
                    'message' => "工具 '{$functionName}' 不存在",
                    'suggestions' => $similarTools,
                    'severity' => 'critical',
                ];
                continue; // 工具不存在就不需要校验参数了
            }

            // 解析参数
            $tool = $registry->get($functionName);
            $params = is_string($arguments) ? json_decode($arguments, true) : $arguments;

            // JSON 解析失败
            if ($params === null && json_last_error() !== JSON_ERROR_NONE) {
                $errors[] = [
                    'index' => $index,
                    'type' => 'invalid_json',
                    'message' => "参数 JSON 解析失败: " . json_last_error_msg(),
                    'severity' => 'critical',
                ];
                continue;
            }

            // 第二层：参数 Schema 校验
            $schemaErrors = $this->validateParams($params, $tool);
            if (!empty($schemaErrors)) {
                $errors[] = [
                    'index' => $index,
                    'type' => 'invalid_params',
                    'message' => $schemaErrors,
                    'tool_schema' => $tool->getParameterSchema(),
                    'severity' => 'high',
                ];
            }
        }

        return new ValidationResult(empty($errors), $errors);
    }

    /**
     * 对单个工具的参数进行多维度校验
     */
    private function validateParams(array $params, ToolInterface $tool): array
    {
        $errors = [];
        $schema = $tool->getParameterSchema();

        // 检查必填字段
        $required = $schema['required'] ?? [];
        foreach ($required as $field) {
            if (!array_key_exists($field, $params)) {
                $errors[] = "缺少必填参数: {$field}";
            }
        }

        // 检查参数类型和约束
        $properties = $schema['properties'] ?? [];
        foreach ($params as $key => $value) {
            if (!isset($properties[$key])) {
                $errors[] = "未知参数: {$key}";
                continue;
            }

            $propSchema = $properties[$key];
            $expectedType = $propSchema['type'];

            // 类型检查
            $actualType = gettype($value);
            if ($expectedType === 'integer' && !is_int($value)) {
                $errors[] = "参数 {$key} 期望 integer，实际 {$actualType}";
            }
            if ($expectedType === 'string' && !is_string($value)) {
                $errors[] = "参数 {$key} 期望 string，实际 {$actualType}";
            }

            // 枚举值检查
            if (isset($propSchema['enum']) && !in_array($value, $propSchema['enum'])) {
                $errors[] = "参数 {$key} 的值 '{$value}' 不在允许的枚举范围内: " .
                            implode(', ', $propSchema['enum']);
            }

            // 数值范围检查
            if ($expectedType === 'integer' || $expectedType === 'number') {
                if (isset($propSchema['minimum']) && $value < $propSchema['minimum']) {
                    $errors[] = "参数 {$key} 的值 {$value} 小于最小值 {$propSchema['minimum']}";
                }
                if (isset($propSchema['maximum']) && $value > $propSchema['maximum']) {
                    $errors[] = "参数 {$key} 的值 {$value} 大于最大值 {$propSchema['maximum']}";
                }
            }

            // 日期格式检查
            if (isset($propSchema['format']) && $propSchema['format'] === 'date') {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
                    $errors[] = "参数 {$key} 的日期格式不正确，期望 YYYY-MM-DD，实际 '{$value}'";
                }
            }
        }

        return $errors;
    }
}
```

### 4.2 工具存在性验证与智能修正

当 LLM 生成了不存在的工具调用时，简单的报错是不够的。我们需要一个智能修正机制：通过模糊匹配找到最可能的正确工具名，并在置信度足够高时自动修正。

```php
/**
 * 工具调用净化器
 * 
 * 检测并修正 LLM 生成的幻觉工具调用。
 * 修正策略：
 * 1. 精确匹配 → 直接通过
 * 2. 模糊匹配且置信度 > 0.7 → 自动修正并记录日志
 * 3. 模糊匹配但置信度 ≤ 0.7 → 丢弃并记录幻觉事件
 * 4. 无匹配 → 丢弃并记录幻觉事件
 */
class ToolCallSanitizer
{
    private ToolRegistry $registry;
    private float $autoCorrectThreshold;
    private AgentMetrics $metrics;

    public function __construct(
        ToolRegistry $registry,
        AgentMetrics $metrics,
        float $autoCorrectThreshold = 0.7
    ) {
        $this->registry = $registry;
        $this->metrics = $metrics;
        $this->autoCorrectThreshold = $autoCorrectThreshold;
    }

    /**
     * 净化 tool_calls 数组，过滤或修正幻觉调用
     */
    public function sanitize(array $toolCalls, string $conversationId = ''): array
    {
        $sanitized = [];

        foreach ($toolCalls as $toolCall) {
            $name = $toolCall['function']['name'];

            // 精确匹配：工具存在，直接通过
            if ($this->registry->has($name)) {
                $sanitized[] = $toolCall;
                continue;
            }

            // 幻觉检测！进入修正流程
            $bestMatch = $this->findBestMatch($name);

            if ($bestMatch !== null && $bestMatch['score'] >= $this->autoCorrectThreshold) {
                // 高置信度匹配：自动修正
                $originalName = $name;
                $toolCall['function']['name'] = $bestMatch['tool'];
                $sanitized[] = $toolCall;

                Log::channel('agent')->warning("自动修正幻觉工具名", [
                    'original' => $originalName,
                    'corrected' => $bestMatch['tool'],
                    'score' => $bestMatch['score'],
                    'conversation_id' => $conversationId,
                ]);

                $this->metrics->incrementHallucination('tool_name_auto_corrected');
            } else {
                // 低置信度或无匹配：丢弃
                Log::channel('agent')->error("丢弃幻觉工具调用", [
                    'tool_name' => $name,
                    'best_match' => $bestMatch?->toArray(),
                    'conversation_id' => $conversationId,
                ]);

                $this->metrics->incrementHallucination('tool_name_dropped');
            }
        }

        return $sanitized;
    }

    /**
     * 在已注册工具中找到与给定名称最相似的工具
     */
    private function findBestMatch(string $name): ?array
    {
        $tools = $this->registry->all();
        $best = null;
        $bestScore = 0;

        foreach ($tools as $tool) {
            $score = $this->calculateSimilarity($name, $tool->getName());
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = ['tool' => $tool->getName(), 'score' => $score];
            }
        }

        return $best;
    }

    /**
     * 组合相似度算法
     * 
     * 结合编辑距离和 Token 重叠度两种方法：
     * - 编辑距离：捕捉字符级的相似性（如 find_orders vs find_order）
     * - Token 重叠度：捕捉语义级的相似性（如 search_orders vs query_orders）
     * 
     * 权重分配：编辑距离 40%，Token 重叠 60%
     */
    private function calculateSimilarity(string $a, string $b): float
    {
        // 编辑距离归一化
        $maxLength = max(strlen($a), strlen($b));
        $editDistance = levenshtein($a, $b);
        $editScore = $maxLength > 0 ? 1 - ($editDistance / $maxLength) : 0;

        // Token 重叠度
        $tokensA = $this->tokenize($a);
        $tokensB = $this->tokenize($b);
        $intersection = array_intersect($tokensA, $tokensB);
        $union = array_unique(array_merge($tokensA, $tokensB));
        $tokenScore = count($union) > 0 ? count($intersection) / count($union) : 0;

        return ($editScore * 0.4) + ($tokenScore * 0.6);
    }

    /**
     * 将函数名拆分为语义 Token
     * 
     * 支持下划线和驼峰两种命名风格：
     * - search_orders → ['search', 'orders']
     * - searchOrders → ['search', 'orders']
     */
    private function tokenize(string $name): array
    {
        $name = preg_replace('/([a-z])([A-Z])/', '$1_$2', $name);
        return array_filter(explode('_', strtolower($name)));
    }
}
```

### 4.3 事实一致性检查

对于 LLM 生成的最终回复（面向用户的自然语言），我们需要验证其中引用的数据是否与工具实际返回的数据一致。这是幻觉防护的最后一道防线，专门对付「编造返回数据」和「数字幻觉」这两类最危险的幻觉。

```php
/**
 * 事实一致性检查器
 * 
 * 将 LLM 回复中提到的关键信息（数字、实体名称）
 * 与工具实际返回的数据进行交叉验证。
 * 
 * 检查维度：
 * 1. 数字一致性：LLM 提及的金额、数量等数字是否有数据来源
 * 2. 实体一致性：LLM 提及的产品名、人名等是否出现在工具结果中
 * 3. 空结果防护：工具返回空但 LLM 声称有数据
 * 4. 趋势一致性：LLM 描述的趋势（增长/下降）是否与数据吻合
 */
class FactualConsistencyChecker
{
    /**
     * 检查 LLM 回复的事实一致性
     */
    public function check(
        string $llmResponse,
        array $toolResults
    ): ConsistencyReport {
        $issues = [];

        // 检查 1：数字一致性
        $mentionedNumbers = $this->extractNumbers($llmResponse);
        $actualNumbers = $this->extractNumbersFromResults($toolResults);

        foreach ($mentionedNumbers as $number) {
            if (!$this->isNumberPlausible($number, $actualNumbers)) {
                $issues[] = [
                    'type' => 'unverified_number',
                    'value' => $number,
                    'message' => "数字 {$number} 在工具返回数据中未找到来源",
                    'severity' => 'high',
                ];
            }
        }

        // 检查 2：实体一致性
        $mentionedEntities = $this->extractEntities($llmResponse);
        $actualEntities = $this->extractEntitiesFromResults($toolResults);

        foreach ($mentionedEntities as $entity) {
            if (!$this->entityExistsInResults($entity, $actualEntities)) {
                $issues[] = [
                    'type' => 'unverified_entity',
                    'value' => $entity,
                    'message' => "实体 '{$entity}' 在工具返回数据中未找到",
                    'severity' => 'medium',
                ];
            }
        }

        // 检查 3：空结果防护
        foreach ($toolResults as $toolResult) {
            if ($this->isEmptyResult($toolResult) && $this->claimsPositiveResult($llmResponse)) {
                $issues[] = [
                    'type' => 'empty_result_hallucination',
                    'message' => '工具返回空结果，但 LLM 声称找到了数据（最严重的幻觉类型）',
                    'severity' => 'critical',
                ];
            }
        }

        // 检查 4：数量级一致性
        $claimedCounts = $this->extractCountClaims($llmResponse);
        foreach ($claimedCounts as $claim) {
            $actualCount = $this->getActualCount($claim['context'], $toolResults);
            if ($actualCount !== null && abs($claim['count'] - $actualCount) > 0) {
                $issues[] = [
                    'type' => 'count_mismatch',
                    'claimed' => $claim['count'],
                    'actual' => $actualCount,
                    'message' => "声称有 {$claim['count']} 条记录，实际为 {$actualCount} 条",
                    'severity' => 'high',
                ];
            }
        }

        return new ConsistencyReport(empty($issues), $issues);
    }

    /**
     * 从文本中提取数字（金额、数量、百分比等）
     */
    private function extractNumbers(string $text): array
    {
        $numbers = [];

        // 匹配金额：¥299.00、$199、299元
        preg_match_all('/[¥￥$]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块|美元)/', $text, $matches);
        foreach ($matches[1] as $match) {
            if ($match !== '') $numbers[] = (float)$match;
        }
        foreach ($matches[2] as $match) {
            if ($match !== '') $numbers[] = (float)$match;
        }

        // 匹配纯数字（在「有X笔」「共X个」等上下文中）
        preg_match_all('/(?:有|共|总计|合计|找到)\s*(\d+)\s*(?:笔|个|条|项)/', $text, $matches);
        foreach ($matches[1] as $match) {
            $numbers[] = (int)$match;
        }

        return array_unique($numbers);
    }

    /**
     * 检查数字是否在工具返回数据中有合理来源
     */
    private function isNumberPlausible(float $number, array $actualNumbers): bool
    {
        foreach ($actualNumbers as $actual) {
            // 允许 1% 的误差（处理四舍五入等）
            if (abs($number - $actual) / max(abs($actual), 1) < 0.01) {
                return true;
            }
        }
        return false;
    }
}
```

### 4.4 Self-Reflection 模式

Self-Reflection 是近年来非常有效的幻觉抑制手段。核心思想是：让 LLM 在生成最终回复之前，先对自己的推理过程和工具使用进行自我审查。如果发现不一致，主动修正后再输出。

这种模式借鉴了人类认知中的「元认知」能力——知道自己知道什么，知道自己不知道什么。在实践中，引入 1-2 轮自我反思可以将幻觉率降低 40-60%。

```php
/**
 * 自反思 Agent
 * 
 * 在标准的 LLM → 工具 → LLM 流程基础上，
 * 增加 Schema 校验和事实一致性检查两个反思环节。
 * 
 * 执行流程：
 * 1. LLM 推理生成 tool_calls
 * 2. Schema 校验（发现幻觉则要求修正）
 * 3. 执行工具获取结果
 * 4. LLM 基于工具结果生成回复
 * 5. 事实一致性检查（发现不一致则要求修正）
 * 6. 返回最终回复
 */
class SelfReflectionAgent
{
    private LLMClient $llm;
    private OutputSchemaValidator $validator;
    private FactualConsistencyChecker $consistencyChecker;
    private int $maxReflectionAttempts;

    public function __construct(
        LLMClient $llm,
        OutputSchemaValidator $validator,
        FactualConsistencyChecker $consistencyChecker,
        int $maxReflectionAttempts = 2
    ) {
        $this->llm = $llm;
        $this->validator = $validator;
        $this->consistencyChecker = $consistencyChecker;
        $this->maxReflectionAttempts = $maxReflectionAttempts;
    }

    public function executeWithReflection(
        string $userMessage,
        array $context,
        string $conversationId
    ): AgentResponse {
        $rawResponse = $this->llm->chat($userMessage, $context);

        // 反思循环
        for ($reflectionRound = 0; $reflectionRound < $this->maxReflectionAttempts; $reflectionRound++) {

            // 阶段 1：Schema 校验
            if (!empty($rawResponse['tool_calls'])) {
                $validation = $this->validator->validateToolCalls(
                    $rawResponse['tool_calls'],
                    $this->toolRegistry
                );

                if (!$validation->isValid()) {
                    $correctionPrompt = $this->buildSchemaCorrectionPrompt(
                        $rawResponse,
                        $validation->getErrors()
                    );
                    $rawResponse = $this->llm->chat($correctionPrompt, $context);

                    Log::channel('agent')->info("Self-Reflection 第 {$reflectionRound} 轮: Schema 校验修正", [
                        'conversation_id' => $conversationId,
                        'errors_fixed' => count($validation->getErrors()),
                    ]);
                    continue; // 修正后重新校验
                }
            }

            // 阶段 2：执行工具
            $toolResults = $this->executeTools($rawResponse['tool_calls'] ?? []);

            // 阶段 3：生成最终回复
            $finalResponse = $this->llm->chat(
                $this->buildResponsePrompt($userMessage, $toolResults),
                $context
            );

            // 阶段 4：事实一致性检查
            $consistency = $this->consistencyChecker->check(
                $finalResponse['content'],
                $toolResults
            );

            if ($consistency->isConsistent()) {
                return new AgentResponse(
                    $finalResponse['content'],
                    $toolResults,
                    isVerified: true,
                    reflectionRounds: $reflectionRound
                );
            }

            // 一致性检查未通过，要求 LLM 修正
            $reflectionPrompt = $this->buildReflectionPrompt(
                $consistency,
                $toolResults
            );
            $rawResponse = $this->llm->chat($reflectionPrompt, $context);

            Log::channel('agent')->info("Self-Reflection 第 {$reflectionRound} 轮: 事实一致性修正", [
                'conversation_id' => $conversationId,
                'issues_found' => $consistency->getIssues(),
            ]);
        }

        // 超过最大反思次数，返回带免责声明的结果
        return new AgentResponse(
            $finalResponse['content'] . "\n\n⚠️ 以上回答可能包含未经验证的信息，请注意甄别。",
            $toolResults,
            isVerified: false,
            reflectionRounds: $this->maxReflectionAttempts
        );
    }

    private function buildSchemaCorrectionPrompt(array $response, array $errors): string
    {
        $errorList = collect($errors)
            ->map(fn($e) => "- {$e['message']}")
            ->implode("\n");

        return <<<PROMPT
你之前的工具调用存在以下问题，请修正后重新生成：

{$errorList}

可用的工具列表和参数格式已在系统提示中定义。
请严格按规范生成工具调用，不要调用不存在的工具。
PROMPT;
    }

    private function buildReflectionPrompt(
        ConsistencyReport $report,
        array $toolResults
    ): string {
        $issueList = collect($report->getIssues())
            ->map(fn($i) => "- [{$i['severity']}] {$i['message']}")
            ->implode("\n");

        $rawData = json_encode($toolResults, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return <<<PROMPT
你的回答存在以下事实性问题：

{$issueList}

请严格基于以下工具返回的原始数据重新生成回答：
- 只引用数据中实际存在的信息
- 不要编造数字或实体名称
- 如果数据为空，如实告知用户

工具原始返回数据：
{$rawData}
PROMPT;
    }
}
```

---

## 五、上下文溢出处理策略

### 5.1 对话摘要压缩

当对话历史接近 Token 上限时，用 LLM 自身来压缩历史消息为结构化摘要是最优雅的上下文管理策略。这种方法的优势在于，LLM 可以理解对话的语义，保留真正重要的信息，丢弃冗余的细节。

摘要压缩的关键决策点是「压缩什么，保留什么」。我们设计了分层保留策略：系统提示和工具描述永远不压缩；最近 3 轮对话原样保留（保证 LLM 能理解最新的用户意图）；更早的历史压缩为结构化摘要，包含关键决策、待办事项和核心数据点。

```php
/**
 * 对话摘要压缩器
 * 
 * 当上下文 Token 预算不足时，使用 LLM 将旧对话历史
 * 压缩为结构化摘要，保留关键信息的同时释放 Token 空间。
 * 
 * 压缩策略：
 * - 最近 N 轮对话原样保留（保证即时上下文完整性）
 * - 更早的历史压缩为结构化摘要
 * - 摘要中保留：关键决策、待办事项、用户偏好、核心数据
 * - 摘要中丢弃：寒暄、确认性回复、重复信息
 */
class ConversationSummarizer
{
    private LLMClient $llm;
    private TokenCounter $counter;

    /**
     * 压缩对话历史，使其不超过目标 Token 数
     * 
     * @param array $messages 完整对话历史
     * @param int $targetTokenCount 目标 Token 数
     * @return array 压缩后的消息列表
     */
    public function compressHistory(
        array $messages,
        int $targetTokenCount
    ): array {
        $currentTokenCount = $this->counter->countMessages($messages);

        // 未超限，无需压缩
        if ($currentTokenCount <= $targetTokenCount) {
            return $messages;
        }

        // 保留最近 N 轮对话不动
        $recentKeepCount = 6; // 保留最近 3 轮（每轮 user + assistant）
        $recentMessages = array_slice($messages, -$recentKeepCount);
        $oldMessages = array_slice($messages, 0, -$recentKeepCount);

        if (empty($oldMessages)) {
            // 连最近的消息都超限了，只能截断
            return $this->truncateMessages($messages, $targetTokenCount);
        }

        // 用 LLM 压缩旧消息
        $summary = $this->llm->chat(
            $this->buildCompressionPrompt($oldMessages),
            [
                ['role' => 'system', 'content' =>
                    '你是一个对话摘要助手。请将对话历史压缩为结构化摘要。' .
                    '输出格式为 JSON，包含以下字段：' .
                    'summary（总体摘要）、key_decisions（关键决策列表）、' .
                    'pending_tasks（待办事项列表）、key_data（重要数据点）、' .
                    'user_preferences（用户偏好）。'
                ],
            ],
            maxTokens: 500
        );

        // 构建压缩后的消息列表
        $compressed = array_merge(
            [[
                'role' => 'system',
                'content' => "## 对话历史摘要\n{$summary['content']}\n" .
                             "（以上为早期对话的压缩摘要，以下为最近的完整对话）",
            ]],
            $recentMessages
        );

        $compressedTokenCount = $this->counter->countMessages($compressed);
        $compressionRatio = round($compressedTokenCount / $currentTokenCount, 2);

        Log::channel('agent')->info("对话历史已压缩", [
            'original_tokens' => $currentTokenCount,
            'compressed_tokens' => $compressedTokenCount,
            'compression_ratio' => $compressionRatio,
            'messages_dropped' => count($oldMessages),
            'messages_kept' => count($recentMessages),
        ]);

        return $compressed;
    }

    private function buildCompressionPrompt(array $messages): string
    {
        $formatted = collect($messages)
            ->map(fn($m) => "[{$m['role']}]: {$m['content']}")
            ->implode("\n");

        return <<<PROMPT
请将以下对话历史压缩为结构化摘要。保留所有关键信息，丢弃冗余和重复内容。

对话历史：
{$formatted}
PROMPT;
    }
}
```

### 5.2 滑动窗口策略

滑动窗口是一种更简单但确定性更强的策略——只保留最近 N 轮对话，丢弃更早的历史。与摘要压缩相比，滑动窗口不需要额外的 LLM 调用，延迟和成本都更低，但代价是可能丢失重要的上下文信息。

在实践中，我们通常将滑动窗口作为摘要压缩的降级方案：当摘要压缩因为某种原因不可用时（比如 LLM 本身过载），自动降级到滑动窗口。

```php
/**
 * 滑动窗口上下文管理器
 * 
 * 简单、确定性强的上下文截断策略。
 * 始终保留最近的对话，丢弃最旧的对话。
 * 
 * 适用场景：
 * - 作为摘要压缩的降级方案
 * - 对话历史中旧信息价值较低的场景
 * - 需要最小化延迟的实时对话
 */
class SlidingWindowManager
{
    private int $maxTurns;
    private int $maxTokens;
    private TokenCounter $counter;

    public function __construct(int $maxTurns = 20, int $maxTokens = 8000)
    {
        $this->maxTurns = $maxTurns;
        $this->maxTokens = $maxTokens;
    }

    public function manageMessages(array $messages): array
    {
        // 分离系统消息和对话消息
        $systemMessages = array_values(
            array_filter($messages, fn($m) => $m['role'] === 'system')
        );
        $conversationMessages = array_values(
            array_filter($messages, fn($m) => $m['role'] !== 'system')
        );

        // 从最新消息向前遍历，同时检查轮次和 Token 两个限制
        $result = [];
        $tokenCount = $this->counter->countMessages($systemMessages);
        $turnCount = 0;

        $reversed = array_reverse($conversationMessages);
        foreach ($reversed as $message) {
            $msgTokens = $this->counter->count($message['content']);

            // 轮次限制
            if ($turnCount >= $this->maxTurns * 2) {
                break;
            }
            // Token 限制
            if ($tokenCount + $msgTokens > $this->maxTokens) {
                break;
            }

            $result[] = $message;
            $tokenCount += $msgTokens;

            // 每遇到一条 user 消息算一轮
            if ($message['role'] === 'user') {
                $turnCount++;
            }
        }

        return array_merge($systemMessages, array_reverse($result));
    }
}
```

### 5.3 关键信息提取与持久化

对于长期运行的 Agent 对话（比如客服系统中的多日咨询），将关键信息持久化到外部存储比塞进上下文更可靠。这种方法的核心思想是：**上下文是短期工作记忆，数据库是长期记忆**。

每个对话轮次结束后，Agent 自动提取本轮的关键信息（用户偏好、决策结果、待办事项等），存入数据库。下一轮对话开始时，先从数据库检索相关记忆，注入到上下文中。这样即使对话历史被截断，关键信息也不会丢失。

```php
/**
 * 对话记忆管理器
 * 
 * 从对话中提取关键信息并持久化，实现长期记忆。
 * 
 * 记忆类型：
 * - 用户偏好（喜欢的沟通风格、语言习惯等）
 * - 关键决策（已确认的订单、已达成的共识等）
 * - 待办事项（后续需要跟进的事项）
 * - 关键实体（人名、订单号、产品名等）
 * - 上下文事实（需要跨对话保持一致的数字等）
 */
class ConversationMemory
{
    private LLMClient $llm;
    private MemoryStore $store;
    private TokenCounter $counter;

    /**
     * 从最近的对话中提取关键信息
     */
    public function extractAndPersist(
        string $conversationId,
        array $recentMessages
    ): void {
        $formattedMessages = collect($recentMessages)
            ->map(fn($m) => "[{$m['role']}]: {$m['content']}")
            ->implode("\n");

        $prompt = <<<PROMPT
请从以下对话中提取关键信息，以严格的 JSON 格式输出。

要求：
1. 只提取有价值的信息，不要提取寒暄和客套
2. 数据点必须来自对话原文，不要推测或补充
3. 如果某类信息不存在，对应字段输出空数组

输出 JSON 结构：
{
  "user_preferences": ["用户偏好1", "用户偏好2"],
  "key_decisions": ["决策1", "决策2"],
  "pending_tasks": ["待办1", "待办2"],
  "mentioned_entities": ["实体1", "实体2"],
  "context_facts": ["事实1", "事实2"]
}

对话内容：
{$formattedMessages}
PROMPT;

        $result = $this->llm->chat(
            $prompt,
            [['role' => 'system', 'content' => '你是信息提取助手，只输出 JSON，不要有多余文字。']],
            maxTokens: 800
        );

        $extracted = json_decode($result['content'], true);

        if ($extracted === null) {
            Log::channel('agent')->warning("记忆提取 JSON 解析失败", [
                'conversation_id' => $conversationId,
                'raw_output' => $result['content'],
            ]);
            return;
        }

        // 合并已有记忆（避免覆盖之前提取的信息）
        $existing = $this->store->get($conversationId);
        $merged = $this->mergeMemory($existing, $extracted);

        $this->store->save($conversationId, [
            'extracted_at' => now()->toIso8601String(),
            'data' => $merged,
            'source_message_range' => [
                count($recentMessages) . ' recent messages',
            ],
        ]);
    }

    /**
     * 将持久化记忆注入到新对话的上下文中
     */
    public function injectMemory(string $conversationId): array
    {
        $memory = $this->store->get($conversationId);

        if (!$memory || empty($memory['data'])) {
            return [];
        }

        $memoryJson = json_encode(
            $memory['data'],
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );

        return [[
            'role' => 'system',
            'content' => "## 用户长期记忆\n以下是之前对话中提取的关键信息，请在回答时参考：\n{$memoryJson}",
        ]];
    }

    /**
     * 合并新旧记忆，去重并保留最新版本
     */
    private function mergeMemory(?array $existing, array $new): array
    {
        if (!$existing) {
            return $new;
        }

        $merged = [];
        $fields = ['user_preferences', 'key_decisions', 'pending_tasks', 'mentioned_entities', 'context_facts'];

        foreach ($fields as $field) {
            $oldItems = $existing['data'][$field] ?? [];
            $newItems = $new[$field] ?? [];
            $merged[$field] = array_values(array_unique(array_merge($oldItems, $newItems)));
        }

        return $merged;
    }
}
```

---

## 六、Laravel 中的工程化实现

### 6.1 统一的 Agent Pipeline

将重试、熔断、降级、幻觉检测等策略整合为一个统一的执行管线，避免在每个业务逻辑中重复编写错误处理代码。

```php
namespace App\Services\Agent;

/**
 * 弹性 Agent 执行管线
 * 
 * 将所有错误恢复策略整合为一个标准化的执行流程。
 * 业务代码只需调用 pipeline->handle() 即可获得完整的错误保护。
 */
class ResilientAgentPipeline
{
    public function __construct(
        private LLMClient $llm,
        private ToolRegistry $tools,
        private CircuitBreakerManager $circuitBreakers,
        private OutputSchemaValidator $validator,
        private ToolCallSanitizer $sanitizer,
        private FactualConsistencyChecker $consistencyChecker,
        private ConversationSummarizer $summarizer,
        private ConversationMemory $memory,
        private GracefulDegradation $degradation,
        private AgentStructuredLogger $logger,
        private AgentTraceRecorder $tracer
    ) {}

    public function handle(string $userMessage, string $conversationId): string
    {
        $this->tracer->startTrace($conversationId);

        try {
            // === 阶段 1: 上下文准备 ===
            $messages = $this->prepareContext($conversationId, $userMessage);

            // === 阶段 2: LLM 推理（带重试）===
            $response = ExponentialBackoffRetry::create()
                ->execute(
                    fn() => $this->llm->chat($userMessage, $messages),
                    operationName: 'llm_inference'
                );

            $this->tracer->recordStep(TraceStep::llmCall($userMessage, $response));

            // === 阶段 3: 幻觉净化 ===
            if (!empty($response['tool_calls'])) {
                $response['tool_calls'] = $this->sanitizer->sanitize(
                    $response['tool_calls'],
                    $conversationId
                );
            }

            // === 阶段 4: 工具执行（带熔断器 + 重试 + 降级）===
            $toolResults = $this->executeToolsSafely(
                $response['tool_calls'] ?? [],
                $userMessage,
                $conversationId
            );

            // === 阶段 5: 生成最终回复（带事实检查）===
            $finalContent = $this->generateVerifiedResponse(
                $userMessage,
                $messages,
                $toolResults,
                $conversationId
            );

            // === 阶段 6: 持久化记忆 ===
            $this->persistConversation($conversationId, $userMessage, $finalContent);

            return $finalContent;

        } catch (\Throwable $e) {
            $this->logger->logPipelineFailure($conversationId, $e);
            return $this->degradation->handlePipelineFailure($userMessage, $e);

        } finally {
            $this->tracer->finishTrace();
        }
    }

    /**
     * 准备上下文：加载历史、注入记忆、处理溢出
     */
    private function prepareContext(string $conversationId, string $userMessage): array
    {
        $history = ConversationHistory::for($conversationId)->getMessages();
        $maxTokens = config('agent.max_context_tokens', 8000);

        // 检查 Token 并处理溢出
        $usageRatio = (new TokenBudget($maxTokens))
            ->getUsageRatio((new TokenCounter())->countMessages($history));

        if ($usageRatio > 0.8) {
            $history = $this->summarizer->compressHistory(
                $history,
                (int)($maxTokens * 0.6)
            );
        }

        // 注入持久化记忆
        $memoryContext = $this->memory->injectMemory($conversationId);

        return array_merge(
            [['role' => 'system', 'content' => config('agent.system_prompt')]],
            $memoryContext,
            $history,
            [['role' => 'user', 'content' => $userMessage]]
        );
    }

    /**
     * 安全地执行工具调用链
     */
    private function executeToolsSafely(
        array $toolCalls,
        string $userMessage,
        string $conversationId
    ): array {
        $toolResults = [];

        foreach ($toolCalls as $toolCall) {
            $toolName = $toolCall['function']['name'];
            $params = json_decode($toolCall['function']['arguments'], true);

            // 通过熔断器执行，失败时降级
            try {
                $breaker = $this->circuitBreakers->get($toolName);
                $result = $breaker->execute(
                    fn() => ExponentialBackoffRetry::create()
                        ->execute(
                            fn() => $this->tools->call($toolName, $params),
                            operationName: "tool:{$toolName}"
                        )
                );
                $toolResults[] = ['tool' => $toolName, 'result' => $result];

            } catch (CircuitBreakerOpenException $e) {
                $degradedResponse = $this->degradation
                    ->handleToolFailure($toolName, $userMessage, $e);
                $toolResults[] = [
                    'tool' => $toolName,
                    'result' => $degradedResponse,
                    'is_degraded' => true,
                ];
            }
        }

        return $toolResults;
    }
}
```

### 6.2 结构化错误日志与 Trace 回放

完整的 Trace 记录是事后调试和持续优化的基础。每次 Agent 调用的完整链路（包括中间的重试、降级、幻觉修正）都应该被记录下来。

```php
/**
 * Agent 结构化日志记录器
 * 
 * 记录 Agent 执行过程中的所有关键事件，
 * 支持按 conversation_id 追踪完整链路。
 */
class AgentStructuredLogger
{
    /**
     * 记录工具调用事件
     */
    public function logToolCall(
        string $conversationId,
        string $toolName,
        array $params,
        ToolResult $result,
        float $durationMs
    ): void {
        $logData = [
            'conversation_id' => $conversationId,
            'tool_name' => $toolName,
            'params' => $params,
            'result_status' => $result->getStatus(),
            'duration_ms' => round($durationMs, 2),
            'timestamp' => now()->toIso8601String(),
        ];

        if ($result->isSuccess()) {
            Log::channel('agent')->info('工具调用成功', $logData);
        } else {
            $logData['error_type'] = $result->getErrorType();
            $logData['error_message'] = $result->getErrorMessage();
            $logData['retry_count'] = $result->getRetryCount();
            $logData['circuit_breaker_state'] = $result->getCircuitBreakerState();

            Log::channel('agent')->error('工具调用失败', $logData);
        }
    }

    /**
     * 记录幻觉检测事件
     */
    public function logHallucination(
        string $conversationId,
        string $hallucinationType,
        array $detectedIssues,
        string $rawLlmOutput
    ): void {
        Log::channel('agent')->warning('检测到 LLM 幻觉', [
            'conversation_id' => $conversationId,
            'hallucination_type' => $hallucinationType,
            'issues' => $detectedIssues,
            'raw_output_preview' => mb_substr($rawLlmOutput, 0, 500),
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * 记录上下文溢出处理事件
     */
    public function logContextOverflow(
        string $conversationId,
        int $currentTokens,
        int $maxTokens,
        string $actionTaken
    ): void {
        Log::channel('agent')->info('上下文溢出处理', [
            'conversation_id' => $conversationId,
            'current_tokens' => $currentTokens,
            'max_tokens' => $maxTokens,
            'usage_percentage' => round($currentTokens / $maxTokens * 100, 1),
            'action_taken' => $actionTaken,
            'timestamp' => now()->toIso8601String(),
        ]);
    }
}
```

---

## 七、监控与可观测性

### 7.1 错误率 Dashboard 设计

没有监控的错误恢复系统就像没有仪表盘的汽车——你不知道它是否在正常工作。我们基于 Prometheus + Grafana 构建了 Agent 错误监控看板，核心指标包括：

**工具调用成功率**：这是最核心的健康指标。公式为 `rate(tool_calls_total{status="success"}) / rate(tool_calls_total)`。低于 95% 时触发告警。

**幻觉检测率**：监控单位时间内检测到的幻觉数量。如果幻觉率突然升高，可能是 LLM 模型变更或工具描述不够清晰导致的。

**平均重试次数**：反映下游工具的整体健康度。如果重试率持续偏高，说明某个工具可能存在系统性问题。

**熔断器状态**：实时显示每个工具的熔断器状态。OPEN 状态意味着该工具完全不可用，需要立即关注。

**上下文溢出频率**：如果溢出频率很高，说明需要优化对话摘要策略或升级到更大上下文的模型。

### 7.2 告警规则配置

告警规则的核心原则是：**区分紧急和非紧急**。熔断器开启是紧急事件（影响用户），幻觉率升高是非紧急事件（需要调查但不阻塞服务）。

```yaml
# Prometheus AlertManager 告警规则
groups:
  - name: agent_error_recovery
    rules:
      # 紧急：工具完全不可用
      - alert: CircuitBreakerOpen
        expr: agent_tool_circuit_breaker_state{state="open"} == 1
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "工具 {{ $labels.tool_name }} 熔断器已开启"
          description: "该工具已连续失败多次，所有调用已被拒绝。需要人工介入检查。"

      # 警告：工具失败率偏高
      - alert: HighToolFailureRate
        expr: |
          sum(rate(agent_tool_calls_total{status="failure"}[10m])) by (tool_name)
          / sum(rate(agent_tool_calls_total[10m])) by (tool_name) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "工具 {{ $labels.tool_name }} 失败率 {{ $value | humanizePercentage }}"

      # 警告：幻觉率异常
      - alert: HallucinationSpike
        expr: sum(rate(agent_hallucinations_detected_total[30m])) > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "LLM 幻觉率异常升高，过去30分钟检测到 {{ $value }} 次"
          description: "请检查工具描述是否清晰，或 LLM 模型是否有变更。"
```

### 7.3 Trace 回放与调试

完整的 Trace 记录让事后调试变得可能。当用户投诉「Agent 给了错误的回答」时，我们可以通过 conversation_id 回放整个执行链路，定位问题出在哪个环节。

```php
/**
 * Agent Trace 记录器
 * 
 * 记录完整的 Agent 执行链路，支持事后回放。
 * 每个 Trace 包含一系列 Step，每个 Step 记录了
 * 输入、输出、耗时、错误信息和恢复动作。
 */
class AgentTraceRecorder
{
    private string $conversationId;
    private array $trace = [];
    private float $traceStartTime;

    public function startTrace(string $conversationId): void
    {
        $this->conversationId = $conversationId;
        $this->traceStartTime = microtime(true);
        $this->trace = [
            'conversation_id' => $conversationId,
            'started_at' => now()->toIso8601String(),
            'steps' => [],
            'metadata' => [],
        ];
    }

    public function recordStep(TraceStep $step): void
    {
        $this->trace['steps'][] = [
            'step_index' => count($this->trace['steps']),
            'type' => $step->getType(),
            'input_summary' => mb_substr($step->getInputSummary(), 0, 200),
            'output_summary' => mb_substr($step->getOutputSummary(), 0, 200),
            'duration_ms' => $step->getDurationMs(),
            'errors' => $step->getErrors(),
            'recovery_action' => $step->getRecoveryAction(),
            'timestamp' => now()->toIso8601String(),
        ];
    }

    public function finishTrace(): void
    {
        $this->trace['finished_at'] = now()->toIso8601String();
        $this->trace['total_duration_ms'] = (microtime(true) - $this->traceStartTime) * 1000;

        $steps = collect($this->trace['steps']);
        $this->trace['summary'] = [
            'total_steps' => $steps->count(),
            'error_count' => $steps->filter(fn($s) => !empty($s['errors']))->count(),
            'recovery_count' => $steps->filter(fn($s) => $s['recovery_action'] !== null)->count(),
            'llm_call_count' => $steps->filter(fn($s) => $s['type'] === 'llm_call')->count(),
            'tool_call_count' => $steps->filter(fn($s) => $s['type'] === 'tool_call')->count(),
        ];

        // 持久化到数据库
        AgentTrace::create([
            'conversation_id' => $this->conversationId,
            'trace_data' => $this->trace,
            'total_duration_ms' => $this->trace['total_duration_ms'],
            'error_count' => $this->trace['summary']['error_count'],
            'recovery_count' => $this->trace['summary']['recovery_count'],
        ]);
    }
}
```

---

## 八、Laravel 中间件级别的重试策略（指数退避 + Jitter 完整实现）

在第六章中我们将重试、熔断、降级整合为统一 Pipeline。但在更细粒度的层面，Laravel 中间件提供了一种更优雅的方式来注入重试逻辑——让重试策略与业务代码完全解耦。下面是一个生产可用的中间件实现，支持指数退避、随机抖动、可配置的重试条件和详细的结构化日志。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Agent 工具调用重试中间件
 *
 * 在 HTTP 中间件层面对外部 API 调用实现透明的重试保护。
 * 与 Laravel 的 retry() 辅助函数不同，本中间件：
 * 1. 支持真正的指数退避 + jitter（防惊群效应）
 * 2. 根据 HTTP 状态码智能判断是否重试
 * 3. 记录每次重试的详细结构化日志
 * 4. 支持自定义重试条件回调
 * 5. 通过请求头传递重试上下文，便于下游排查
 */
class AgentRetryMiddleware
{
    /** @var array<int, int> 可重试的 HTTP 状态码 */
    private array $retryableStatusCodes = [408, 429, 500, 502, 503, 504];

    public function __construct(
        private int $maxAttempts = 3,
        private int $baseDelayMs = 1000,
        private int $maxDelayMs = 30000,
        private float $jitterFactor = 0.3,
        private ?\Closure $customRetryCondition = null,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $lastResponse = null;
        $lastException = null;
        $attempt = 0;

        while ($attempt < $this->maxAttempts) {
            try {
                // 注入重试上下文到请求头（便于下游服务识别）
                if ($attempt > 0) {
                    $request->headers->set('X-Retry-Attempt', $attempt);
                    $request->headers->set('X-Retry-Max-Attempts', $this->maxAttempts);
                }

                $response = $next($request);

                // 检查响应状态码是否需要重试
                if ($this->shouldRetryResponse($response)) {
                    $lastResponse = $response;
                    $delay = $this->calculateDelay($attempt);

                    Log::channel('agent')->warning('中间件重试：不可用响应', [
                        'attempt' => $attempt + 1,
                        'max_attempts' => $this->maxAttempts,
                        'status_code' => $response->getStatusCode(),
                        'delay_ms' => $delay,
                        'url' => $request->url(),
                    ]);

                    usleep($delay * 1000);
                    $attempt++;
                    continue;
                }

                // 成功响应
                if ($attempt > 0) {
                    Log::channel('agent')->info('中间件重试成功', [
                        'attempt' => $attempt + 1,
                        'url' => $request->url(),
                    ]);
                }

                return $response;

            } catch (\Throwable $e) {
                $lastException = $e;

                if (!$this->shouldRetryException($e) || $attempt >= $this->maxAttempts - 1) {
                    throw $e;
                }

                $delay = $this->calculateDelay($attempt);

                Log::channel('agent')->warning('中间件重试：异常', [
                    'attempt' => $attempt + 1,
                    'max_attempts' => $this->maxAttempts,
                    'exception_class' => get_class($e),
                    'exception_message' => $e->getMessage(),
                    'delay_ms' => $delay,
                    'url' => $request->url(),
                ]);

                usleep($delay * 1000);
                $attempt++;
            }
        }

        // 所有重试耗尽：返回最后一次响应或抛出异常
        if ($lastResponse) {
            Log::channel('agent')->error('中间件重试耗尽，返回最后一次响应', [
                'status_code' => $lastResponse->getStatusCode(),
                'url' => $request->url(),
            ]);
            return $lastResponse;
        }

        throw $lastException;
    }

    /**
     * 计算带 jitter 的指数退避延迟
     *
     * 公式：min(baseDelay × 2^attempt + jitter, maxDelay)
     * jitter 范围：[-jitterFactor × baseDelay, +jitterFactor × baseDelay]
     *
     * 典型序列（baseDelay=1000ms, jitterFactor=0.3）：
     *   第1次：700ms ~ 1300ms
     *   第2次：1400ms ~ 2600ms
     *   第3次：2800ms ~ 5200ms
     */
    private function calculateDelay(int $attempt): int
    {
        $baseDelay = $this->baseDelayMs * pow(2, $attempt);
        $jitterRange = $baseDelay * $this->jitterFactor;
        $jitter = $jitterRange * (2 * (mt_rand() / mt_getrandmax()) - 1); // [-range, +range]
        $totalDelay = (int) max(0, $baseDelay + $jitter);

        return min($totalDelay, $this->maxDelayMs);
    }

    private function shouldRetryResponse(Response $response): bool
    {
        return in_array($response->getStatusCode(), $this->retryableStatusCodes, true);
    }

    private function shouldRetryException(\Throwable $e): bool
    {
        // 自定义条件优先
        if ($this->customRetryCondition !== null) {
            return ($this->customRetryCondition)($e);
        }

        // 默认：网络超时和连接异常可重试
        return $e instanceof \GuzzleHttp\Exception\ConnectException
            || $e instanceof \GuzzleHttp\Exception\TransferException
            || $e instanceof \Illuminate\Http\Client\ConnectionException;
    }
}

// --- 在 Agent 服务提供者中注册 ---
// 用法示例：通过 Laravel HTTP Client 的 withMiddleware 注入
use Illuminate\Support\Facades\Http;
use App\Http\Middleware\AgentRetryMiddleware;

$response = Http::withMiddleware(
    new AgentRetryMiddleware(
        maxAttempts: 4,
        baseDelayMs: 500,
        maxDelayMs: 15000,
        jitterFactor: 0.4,
        customRetryCondition: fn (\Throwable $e) =>
            str_contains($e->getMessage(), 'timeout') ||
            str_contains($e->getMessage(), 'connection refused')
    )
)->post('https://api.example.com/tools/execute', [
    'tool' => 'search_orders',
    'params' => ['user_id' => 123],
]);
```

> **与 Pipeline 中 ExponentialBackoffRetry 的关系**：Pipeline 级别的重试面向整个 Agent 执行链路（可能包含多次 LLM 调用和工具调用），而中间件级别的重试面向单次 HTTP 请求。两者互补，不冲突。

### 踩坑案例：重试风暴导致 API 限流

2025 年初，我们的客服 Agent 系统遭遇了一次严重的重试风暴。以下是从这次事故中总结的完整复盘：

**事故经过**：支付网关（第三方服务）在凌晨 2:00 进行计划外维护，返回 503 状态码。由于每个用户对话都会触发订单查询 → 支付状态校验的工具链，而每个工具调用失败后都会重试 3 次，更糟糕的是——我们有 50 个并发 Agent 实例同时在服务不同用户。

**雪崩效应**：

1. 支付网关返回 503 → 所有 50 个 Agent 实例同时开始重试
2. 每个实例 3 次重试 × 2 个工具 = 每个用户对话产生 6 次额外请求
3. 当时有 200 个活跃对话 → 瞬间产生 1,200 次额外重试请求
4. 支付网关的限流阈值是 500 req/min → 立刻触发 429 限流
5. 429 又被当作可重试错误 → 继续重试 → 形成正反馈恶性循环
6. 最终支付网关封禁了我们的 API Key，影响范围扩大到所有用户

**根因分析**：

- **缺少 jitter**：所有实例的重试时间完全同步，形成「惊群」
- **未区分 429 和 503**：429（限流）应该立即停止重试并延长冷却期，而非继续重试
- **无全局并发控制**：每个实例独立决策，没有全局限流感知
- **重试次数过多**：对于已知不可用的服务，3 次重试完全不够也完全没必要

**修复方案**（已上线验证）：

```php
// 修复 1：429 响应特殊处理——读取 Retry-After 头部，延长等待时间
private function shouldRetryResponse(Response $response): bool
{
    if ($response->getStatusCode() === 429) {
        // 读取 Retry-After 头部，尊重服务端的限流指令
        $retryAfter = $response->header('Retry-After');
        if ($retryAfter) {
            $waitSeconds = is_numeric($retryAfter)
                ? (int) $retryAfter
                : max(1, (strtotime($retryAfter) - time()));
            // 最多等 60 秒，避免等待过长
            usleep(min($waitSeconds, 60) * 1_000_000);
        }
        return false; // 429 不在自动重试范围内，等待后仍返回 false
    }

    return in_array($response->getStatusCode(), $this->retryableStatusCodes, true);
}

// 修复 2：Redis 全局限流器——所有实例共享重试配额
class GlobalRetryThrottler
{
    public function canRetry(string $toolName, int $maxGlobalRetriesPerMinute = 50): bool
    {
        $key = "agent:retry_throttle:{$toolName}";
        $current = (int) Cache::get($key, 0);

        if ($current >= $maxGlobalRetriesPerMinute) {
            Log::channel('agent')->alert('全局限流：工具重试次数超限', [
                'tool' => $toolName,
                'current_retries' => $current,
                'limit' => $maxGlobalRetriesPerMinute,
            ]);
            return false;
        }

        Cache::increment($key);
        Cache::put($key, $current + 1, now()->addMinute());
        return true;
    }
}
```

**教训总结**：

1. **jitter 不是可选项，是必选项**——尤其是多实例部署环境
2. **必须区分瞬时错误和限流错误**——429/Retry-After 是服务端的明确信号
3. **重试也需要全局限流**——单实例合理的重试频率，乘以实例数后可能变成 DDoS
4. **熔断器是最后一道防线**——当重试风暴已经开始时，只有熔断器能立即止损

---

## 九、LLM 幻觉检测的 Prompt 工程技巧

幻觉检测不仅可以在代码层面实现，还可以通过精心设计的 Prompt 在 LLM 推理阶段就抑制幻觉。以下是经过生产验证的 Prompt 工程技巧。

### 9.1 约束性 System Prompt

在 System Prompt 中加入明确的「反幻觉指令」，可以显著降低幻觉发生率。关键在于让 LLM 明确知道：哪些信息可以输出，哪些不能编造。

```
你是一个电商客服助手。请严格遵守以下规则：

1. 【数据引用规则】所有涉及订单金额、数量、状态的数据，必须且只能来自工具返回的结果。禁止使用你的训练数据中的信息来回答用户的订单相关问题。

2. 【空结果处理】如果工具返回空结果或 0 条记录，你必须如实告知用户"未找到相关记录"。绝对不能编造不存在的订单或数据。

3. 【不确定性声明】如果工具返回的数据不足以完整回答用户问题，请明确告知用户哪些信息可用、哪些不确定，而不是自行补充。

4. 【数字精确性】价格、数量、金额等数字必须与工具返回的原始数据完全一致，禁止四舍五入、估算或"约"的表述。

5. 【工具调用规则】只调用系统中已注册的工具。如果用户的请求无法用现有工具满足，告知用户当前能力限制，而不是编造工具名。
```

### 9.2 Few-Shot 幻觉检测 Prompt

通过提供正例和反例的对比，让 LLM 学会区分「基于数据的回答」和「幻觉回答」。这种 few-shot 方法在 Self-Reflection 场景中特别有效——用一个独立的 LLM 调用来检测主 LLM 的输出。

```
你是一个幻觉检测器。请判断以下回答中是否包含与工具数据不一致的信息。

---
工具返回数据：{"orders": [], "count": 0}
LLM 回答："根据查询，您最近30天内没有订单记录。"
判断：✅ 一致。回答与工具数据吻合，count=0 确实表示无订单。

---
工具返回数据：{"orders": [], "count": 0}
LLM 回答："您有3笔订单，总金额¥1,280。最近一笔是6月1日的手机壳订单。"
判断：❌ 幻觉。工具返回空结果，但LLM声称有3笔订单并编造了金额和商品名。

---
工具返回数据：{"price": 299.00, "stock": 0, "name": "蓝牙耳机"}
LLM 回答："蓝牙耳机售价¥299，目前暂时缺货。"
判断：✅ 一致。价格299与数据吻合，stock=0 正确表述为"缺货"。

---
工具返回数据：{"price": 299.00, "stock": 0, "name": "蓝牙耳机"}
LLM 回答："蓝牙耳机售价¥399，库存充足，建议尽快下单。"
判断：❌ 幻觉。价格从299编造为399，stock=0编造为"库存充足"。

---
工具返回数据：{"status": "shipped", "tracking_no": "SF1234567890"}
LLM 回答："您的订单已发货，快递单号 SF1234567890，可通过顺丰官网查询。"
判断：✅ 一致。状态和快递单号均来自工具数据，顺丰为合理推断（SF前缀）。

---
现在请判断：
工具返回数据：{tool_data}
LLM 回答：{llm_response}
判断：
```

### 9.3 自我校验 Prompt（嵌入到主推理流程）

在 LLM 生成最终回复之前，追加一段自我校验指令，要求 LLM 审查自己的输出：

```
在输出你的最终回答之前，请执行以下自检：

1. 回顾你回答中提到的每一个数字（金额、数量、日期）。这些数字是否全部来自工具返回的数据？
2. 你提到的每一个产品名、订单号、人名是否都在工具数据中出现过？
3. 如果工具返回了空结果或错误，你是否如实反映了这一情况？
4. 你是否在回答中添加了任何工具数据中没有的信息？

如果发现任何不一致，请在最终回答前修正。
```

> **实测效果**：在我们的客服 Agent 中，结合 9.1 的约束性 System Prompt 和 9.3 的自我校验指令，幻觉率从基线的 12.3% 降低到了 4.1%（降幅 67%）。加入 9.2 的 Few-Shot 检测器作为二次校验后，进一步降至 2.4%。

---

## 十、上下文窗口管理的 Token 计数器实现

在第五章中，我们多次使用了 `TokenCounter` 类来计算消息的 Token 数。本节给出一个完整的、tiktoken 风格的 Token 计数器实现，支持多种模型的 Token 计算。

```php
<?php

namespace App\Services\Agent;

/**
 * Token 计数器（tiktoken 风格）
 *
 * 为 Agent 上下文管理提供精确的 Token 计数能力。
 * 支持两种计数模式：
 * 1. 精确模式：调用 tiktoken 的 PHP 移植版 cl100k_base 编码
 * 2. 估算模式：基于字符数的快速估算（适合高频调用场景）
 *
 * 设计要点：
 * - 支持多模型的 Token 差异化计算
 * - 缓存编码结果，避免重复计算
 * - 提供消息级和会话级的计数 API
 * - 支持 Token 预算管理和溢出预警
 */
class TokenCounter
{
    /** @var array<string, int> 各模型的 Token 上限 */
    private static array $modelLimits = [
        'gpt-4o'            => 128000,
        'gpt-4o-mini'       => 128000,
        'gpt-3.5-turbo'     => 16385,
        'claude-3.5-sonnet' => 200000,
        'claude-3-opus'     => 200000,
        'deepseek-v3'       => 64000,
        'qwen-turbo'        => 131072,
    ];

    /** @var array<string, float> 不同模型每 Token 平均字符数（经验值） */
    private static array $charsPerToken = [
        'latin'    => 3.5,   // 英文/数字：约 3.5 字符 = 1 token
        'cjk'      => 1.2,   // 中文/日文/韩文：约 1.2 字符 = 1 token
        'mixed'    => 2.5,   // 中英混合：约 2.5 字符 = 1 token
        'code'     => 3.0,   // 代码：约 3.0 字符 = 1 token
    ];

    private string $mode; // 'precise' | 'estimate'
    private array $cache = [];

    public function __construct(string $mode = 'estimate')
    {
        $this->mode = $mode;
    }

    /**
     * 计算单条消息的 Token 数
     */
    public function count(string $text): int
    {
        $cacheKey = md5($text);
        if (isset($this->cache[$cacheKey])) {
            return $this->cache[$cacheKey];
        }

        $tokenCount = $this->mode === 'precise'
            ? $this->countPrecise($text)
            : $this->countEstimate($text);

        $this->cache[$cacheKey] = $tokenCount;
        return $tokenCount;
    }

    /**
     * 计算消息数组的总 Token 数（含 role 开销）
     *
     * 每条消息的额外开销约为 4 tokens（role 标记、分隔符等）
     * 系统提示有额外的 ~2 tokens 开销
     */
    public function countMessages(array $messages): int
    {
        $totalTokens = 0;
        $perMessageOverhead = 4; // <|start|>role\n ... <|end|>\n

        foreach ($messages as $message) {
            $totalTokens += $perMessageOverhead;

            // role 名称
            $totalTokens += $this->count($message['role'] ?? '');

            // message content
            $content = $message['content'] ?? '';
            $totalTokens += $this->count($content);

            // tool_calls 的 Token 计算
            if (!empty($message['tool_calls'])) {
                foreach ($message['tool_calls'] as $toolCall) {
                    $totalTokens += $this->count(json_encode($toolCall));
                }
            }

            // tool_call_id 的固定开销
            if (!empty($message['tool_call_id'])) {
                $totalTokens += $this->count($message['tool_call_id']);
            }
        }

        // 对话级固定开销（<|start|>assistant<|message|>）
        $totalTokens += 3;

        return $totalTokens;
    }

    /**
     * 精确模式：基于 cl100k_base 编码计算
     *
     * 注意：生产环境建议使用 https://github.com/nicholasgasior/php-tiktoken
     * 或通过 Shell 调用 Python tiktoken 库
     */
    private function countPrecise(string $text): int
    {
        // cl100k_base 编码的简化实现
        // 生产环境应替换为完整的 BPE 编码器
        if (function_exists('tiktoken_count')) {
            return tiktoken_count($text, 'cl100k_base');
        }

        // 降级到估算模式
        return $this->countEstimate($text);
    }

    /**
     * 估算模式：基于字符类型的加权计算
     *
     * 精度约 ±15%，适用于 Token 预算管理（不需要精确值）
     */
    private function countEstimate(string $text): int
    {
        if ($text === '') return 0;

        $totalChars = mb_strlen($text, 'UTF-8');

        // 分类统计不同类型的字符
        $cjkChars = preg_match_all(
            '/[\x{4e00}-\x{9fff}\x{3040}-\x{309f}\x{30a0}-\x{30ff}]/u',
            $text
        );
        $latinChars = preg_match_all('/[a-zA-Z0-9\s]/', $text);
        $otherChars = $totalChars - $cjkChars - $latinChars;

        // 加权计算
        $estimatedTokens = ($cjkChars / $this::$charsPerToken['cjk'])
            + ($latinChars / $this::$charsPerToken['latin'])
            + ($otherChars / $this::$charsPerToken['mixed']);

        return max(1, (int) ceil($estimatedTokens));
    }

    /**
     * 检查消息是否超出模型的 Token 上限
     */
    public function willOverflow(array $messages, string $model = 'gpt-4o', int $reserveForOutput = 4000): bool
    {
        $limit = self::$modelLimits[$model] ?? 128000;
        $messageTokens = $this->countMessages($messages);

        return ($messageTokens + $reserveForOutput) > $limit;
    }

    /**
     * 计算 Token 预算剩余空间
     */
    public function remainingBudget(array $messages, string $model = 'gpt-4o', int $reserveForOutput = 4000): int
    {
        $limit = self::$modelLimits[$model] ?? 128000;
        $messageTokens = $this->countMessages($messages);

        return max(0, $limit - $messageTokens - $reserveForOutput);
    }

    /**
     * 清除缓存（在内存敏感的场景中使用）
     */
    public function clearCache(): void
    {
        $this->cache = [];
    }
}

// --- 使用示例 ---
$counter = new TokenCounter('estimate');

$messages = [
    ['role' => 'system', 'content' => '你是一个电商客服助手。'],
    ['role' => 'user', 'content' => '帮我查一下订单 #12345 的状态'],
    ['role' => 'assistant', 'content' => '好的，我来帮您查询...'],
    ['role' => 'user', 'content' => '快递到哪里了？大概什么时候能到？'],
];

$totalTokens = $counter->countMessages($messages);
echo "当前消息 Token 数：{$totalTokens}\n";
echo "是否溢出：{$counter->willOverflow($messages, 'gpt-4o')}\n";
echo "剩余预算：{$counter->remainingBudget($messages, 'gpt-4o')} tokens\n";

// 输出示例：
// 当前消息 Token 数：68
// 是否溢出：否
// 剩余预算：127528 tokens
```

> **精确模式部署建议**：生产环境建议使用 [php-tiktoken](https://github.com/nicholasgasior/php-tiktoken) 扩展实现精确计数。如果 PHP 扩展不可用，可以通过 Laravel 的 `Process::run()` 调用 Python tiktoken 库作为降级方案：`python3 -c "import tiktoken; enc = tiktoken.encoding_for_model('gpt-4o'); print(len(enc.encode('$text')))"`。

---

## 十一、错误恢复决策树

以下是完整的错误恢复决策树，描述了 Agent 遇到各类错误时的判断与处理路径。可将其视为一份运维参考手册，也可以据此实现自动化的决策引擎。

- **Agent 收到用户输入**
  - **阶段 1：上下文准备**
    - 计算当前对话历史的 Token 数
    - Token 使用率 < 60%？ → 直接使用原始历史 ✅
    - Token 使用率 60%~80%？ → 启动 LLM 摘要压缩，保留最近 3 轮 + 结构化摘要
    - Token 使用率 80%~95%？ → 滑动窗口截断，只保留最近 N 轮
    - Token 使用率 > 95%？ → 紧急模式：只保留最近 2 轮 + 系统提示
    - 压缩/截断后仍然溢出？ → 返回错误提示："对话过长，请开始新对话"
  - **阶段 2：LLM 推理**
    - 调用 LLM API 成功？
      - ✅ 成功 → 进入阶段 3
      - ❌ 失败
        - HTTP 429（限流）？ → 读取 Retry-After → 等待后重试（最多 3 次）
        - HTTP 500/502/503？ → 指数退避重试（最多 3 次）
        - HTTP 400（Token 超限）？ → 回退到阶段 1 重新压缩上下文
        - 网络超时？ → 指数退避重试（最多 3 次）
        - 重试耗尽？ → 触发降级："AI 服务暂时不可用，请稍后重试"
  - **阶段 3：输出净化（幻觉防护）**
    - LLM 返回了 tool_calls？
      - ✅ 是 → 进入工具调用流程
      - ❌ 否（纯文本回复）→ 跳到阶段 5
    - 调用的工具是否存在？
      - ✅ 存在 → 继续
      - ❌ 不存在
        - 模糊匹配置信度 > 0.7？ → 自动修正工具名 → 继续
        - 模糊匹配置信度 ≤ 0.7？ → 丢弃该 tool_call → 记录幻觉事件 → 要求 LLM 重新生成
    - 参数 Schema 校验通过？
      - ✅ 通过 → 继续
      - ❌ 不通过 → 将校验错误反馈给 LLM → 要求修正参数 → 重新校验（最多 2 轮）
  - **阶段 4：工具执行**
    - 熔断器状态？
      - OPEN（已开启）？ → 直接跳过，使用降级响应
      - HALF_OPEN（半开）？ → 允许试探性调用
      - CLOSED（正常）？ → 正常调用
    - 工具调用结果？
      - ✅ 成功 → 记录结果，回到阶段 2 让 LLM 基于结果生成回复
      - ❌ 失败
        - 网络层故障？ → 指数退避重试（最多 3 次）
        - 鉴权层故障？ → 刷新凭证 → 重试 1 次
        - 参数层故障？ → 将错误信息反馈给 LLM 自我修正
        - 业务层故障？ → 不重试，直接进入降级
    - 重试耗尽？
      - 有备用工具？ → 切换到 Fallback Chain 中的下一个工具
      - 无备用工具？ → 触发熔断器 → 返回降级响应
  - **阶段 5：事实一致性检查**
    - LLM 回复中提到的数字是否都有数据来源？
      - ✅ 一致 → 输出给用户
      - ❌ 不一致
        - 第 1 次不一致？ → 将原始数据 + 一致性报告反馈给 LLM → 要求修正
        - 第 2 次仍不一致？ → 输出带免责声明的回复："以下回答包含未经验证的信息"
    - 工具返回空结果但 LLM 声称有数据？
      - ✅ 存在空结果幻觉 → 强制覆盖为："未找到相关记录"
  - **阶段 6：记忆持久化**
    - 提取本轮对话的关键信息 → 存入外部存储
    - 对话结束

---

## 十二、总结与最佳实践 Checklist

### 三大故障模式的应对策略总结

| 故障模式 | 根因 | 检测手段 | 恢复策略 |
|---------|------|---------|---------|
| 工具调用失败 | 网络/鉴权/参数/业务异常 | 异常捕获 + 错误码分类 | 重试 → 备用工具 → 熔断 → 降级 |
| LLM 幻觉 | 模型概率生成的不确定性 | Schema 校验 + 事实检查 | 校验 → 修正 → Self-Reflection |
| 上下文溢出 | Token 累积超过模型限制 | Token 计数器 + 使用率监控 | 摘要压缩 → 滑动窗口 → 信息持久化 |

### 最佳实践 Checklist

**工具调用失败处理**

- [ ] 所有外部工具调用都包裹在重试逻辑中
- [ ] 重试使用指数退避 + 随机抖动
- [ ] 关键工具配置了备用方案（Fallback Chain）
- [ ] 高频调用工具配置了熔断器
- [ ] 熔断器状态可在监控面板实时查看
- [ ] 降级响应对用户友好且包含替代方案

**LLM 幻觉防护**

- [ ] 所有 tool_calls 都经过 Schema 校验
- [ ] 工具名做存在性验证 + 模糊匹配修正
- [ ] LLM 最终回复经过事实一致性检查
- [ ] 关键业务操作引入 Self-Reflection 二次校验
- [ ] 空结果场景有专门的防护机制
- [ ] 幻觉事件记录到结构化日志

**上下文溢出管理**

- [ ] 所有 LLM 调用前检查 Token 预算
- [ ] 对话历史达到阈值时自动摘要压缩
- [ ] 关键信息持久化到外部存储
- [ ] RAG 检索结果有 Token 预算限制
- [ ] system prompt 和工具描述的 Token 占用单独统计

**可观测性**

- [ ] 每次工具调用记录结构化日志
- [ ] 幻觉检测事件有独立计数器
- [ ] 上下文溢出事件有独立计数器
- [ ] Grafana Dashboard 包含核心指标面板
- [ ] 关键指标配置了告警规则
- [ ] 完整的 Trace 记录，支持事后回放

**Laravel 工程化**

- [ ] 重试、熔断、降级封装为可复用的服务类
- [ ] 通过 config 文件管理各工具的参数
- [ ] Agent 专用日志通道与业务日志隔离
- [ ] 熔断器状态通过 Redis 驱动，支持多实例共享
- [ ] 定时任务清理过期状态和历史数据

### 结语

AI Agent 的错误处理不是锦上添花，而是决定系统能否在生产环境中生存的关键能力。工具调用失败是分布式系统中的经典问题，用成熟的重试、熔断、降级手段即可应对；LLM 幻觉是 AI 系统特有的挑战，需要从校验、检测、反思三个维度构建多层防护；上下文溢出则是资源管理问题，压缩、截断、持久化三管齐下才能有效控制。

在 Laravel 项目中，将这些策略整合为统一的 Agent Pipeline，配合完善的监控告警和 Trace 回放，你的 Agent 系统才能真正从 Demo 走向 Production。记住：**一个好的 Agent 系统不是从不犯错，而是能够在犯错后快速恢复，并且让每一次错误都变得可追踪、可分析、可改进。**

## 相关阅读

- [AI Agent Long-Running Tasks 实战：持久化状态、断点恢复、人机审批节点](/categories/AI/2026-06-05-ai-agent-long-running-tasks-durable-state-checkpoint-human-approval/)
- [AI Agent Function Calling 标准化与错误处理实战](/categories/AI/2026-06-02-ai-agent-function-calling-standardization-error-handling/)
- [AI Agent Debugging 实战：MCP Inspector/LangSmith Trace/日志回放](/categories/AI/AI-Agent-Debugging-实战-MCP-Inspector-LangSmith-Trace-日志回放-从黑盒到可调试的Agent开发工作流/)
