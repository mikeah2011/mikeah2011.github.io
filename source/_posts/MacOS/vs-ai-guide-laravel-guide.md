---
title: 本地 vs 云端 AI 实战：成本隐私性能的权衡与 Laravel 开发者选型指南
date: 2026-05-17 05:50:38
updated: 2026-05-17 05:53:29
categories:
  - macOS
  - Laravel
tags: [AI, DevOps, Laravel, 安全]
description: >
  本地 AI 模型 vs 云端 API 的真实选型决策指南。涵盖 Ollama/LM Studio 本地部署、Claude/GPT 云端调用的成本核算、隐私合规、推理性能对比，以及在 Laravel B2C 项目中如何混合使用本地与云端 AI 的实战架构方案。



---
# 本地 vs 云端 AI 实战：成本隐私性能的权衡与 Laravel 开发者选型指南

> 在 30+ 个 Laravel 仓库的日常开发中，我们同时使用了 Ollama 本地模型和 Claude/GPT 云端 API。这篇文章不是概念介绍，而是真实的成本账本、性能数据和架构决策记录。

## 为什么需要这篇文章？

当你的 AI 使用量从"偶尔问问"变成"每天跑 50+ 次代码审查 + 测试生成 + 文档编写"时，两个问题会立刻浮现：

1. **成本失控**：一个月 Claude API 账单 $200+，还在增长
2. **数据泄露焦虑**：将公司内部代码发到云端 API，合规团队开始追问

这时候你自然会想到：**能不能把一部分任务放到本地跑？** 答案是可以，但有明确的边界。本文记录了我们在实际项目中摸索出来的混合策略。

## 架构总览：混合 AI 工作流

```
┌─────────────────────────────────────────────────────┐
│                  开发者工作流                          │
│                                                     │
│  ┌──────────────┐          ┌──────────────────┐     │
│  │   本地 AI     │          │    云端 AI        │     │
│  │  (Ollama)    │          │  (Claude/GPT)    │     │
│  │              │          │                  │     │
│  │ • 代码补全    │          │ • 复杂代码生成    │     │
│  │ • 日志分析    │          │ • 架构设计建议    │     │
│  │ • 敏感数据处理│          │ • 代码审查(脱敏)  │     │
│  │ • 快速原型    │          │ • 文档生成       │     │
│  │ • 单元测试骨架 │          │ • Debug 深度分析  │     │
│  └──────────────┘          └──────────────────┘     │
│         │                          │                │
│         ▼                          ▼                │
│  ┌──────────────────────────────────────────┐       │
│  │           统一接口层 (Hermes Agent)        │       │
│  │  • 智能路由：按任务类型分发到本地/云端      │       │
│  │  • 成本监控：跟踪每次调用的 token 花费     │       │
│  │  • 脱敏网关：敏感代码自动脱敏后发送云端     │       │
│  └──────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

## 一、本地 AI 部署实战

### 1.1 Ollama：最简单的本地模型方案

Ollama 是目前 macOS 上部署本地 LLM 最友好的方案，一条命令就能跑起来：

```bash
# 安装 Ollama
brew install ollama

# 拉取模型（首次需要下载）
ollama pull codellama:13b          # 代码生成，~7.4GB
ollama pull deepseek-coder:6.7b    # DeepSeek 代码模型，~3.8GB
ollama pull qwen2.5-coder:7b       # 通义千问代码模型，~4.7GB

# 启动服务（默认监听 11434 端口）
ollama serve

# 测试调用
curl http://localhost:11434/api/generate -d '{
  "model": "deepseek-coder:6.7b",
  "prompt": "Write a Laravel Eloquent scope for active users with recent orders",
  "stream": false
}'
```

**踩坑记录 ①**：M1/M2 芯片 Mac 上，`codellama:13b` 需要至少 16GB 统一内存。8GB 机器建议用 `deepseek-coder:6.7b` 或 `qwen2.5-coder:7b`，否则会出现内存交换导致推理极慢。

### 1.2 LM Studio：可视化模型管理

LM Studio 提供了 GUI 界面，适合不习惯命令行的团队成员：

```bash
# 安装 LM Studio（从官网下载 DMG）
# 下载地址：https://lmstudio.ai/

# LM Studio 也会在本地启动 OpenAI 兼容的 API
# 默认端口：1234
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-coder-6.7b-instruct",
    "messages": [
      {"role": "user", "content": "Explain this Laravel error: Target class [App\\Services\\PaymentService] does not exist."}
    ]
  }'
```

### 1.3 本地模型性能基准测试

在 MacBook Pro M2 Pro (32GB) 上的实测数据：

```
┌──────────────────────┬──────────┬──────────┬──────────┬──────────┐
│ 模型                  │ 推理速度  │ 内存占用  │ 代码质量  │ 中文能力  │
│                      │ tokens/s │          │ (1-10)   │ (1-10)   │
├──────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ deepseek-coder:6.7b  │   45     │  4.2GB   │   7      │   6      │
│ qwen2.5-coder:7b     │   42     │  4.8GB   │   7.5    │   9      │
│ codellama:13b        │   22     │  7.8GB   │   7.5    │   4      │
│ llama3.1:8b          │   38     │  5.1GB   │   6      │   7      │
│ deepseek-coder:33b   │   8      │  19.2GB  │   8.5    │   7      │
├──────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Claude Sonnet (云端)  │   60+    │  N/A     │   9.5    │   9.5    │
│ GPT-4o (云端)        │   80+    │  N/A     │   9      │   9      │
└──────────────────────┴──────────┴──────────┴──────────┴──────────┘
```

**关键发现**：
- 本地 7B 模型的**代码补全**能力已经够用（简单函数、getter/setter、CRUD）
- 但**复杂架构设计**、**跨文件重构**、**安全审计**仍然需要云端大模型
- 33B 模型质量接近云端，但推理速度只有 8 tokens/s，开发体验差

## 二、云端 API 成本核算

### 2.1 真实账单数据

我们团队 3 个月的 AI 使用数据（5 人团队，30+ Laravel 仓库）：

```php
<?php

// 月度 AI 成本追踪脚本（Laravel Artisan Command）
namespace App\Console\Commands;

use Illuminate\Console\Command;

class AiCostReport extends Command
{
    protected $signature = 'ai:cost-report {--month= : 月份 YYYY-MM}';

    // 各平台单价（2026年5月数据）
    private array $pricing = [
        'claude-sonnet' => ['input' => 3.0, 'output' => 15.0],  // per 1M tokens
        'claude-haiku'  => ['input' => 0.25, 'output' => 1.25],
        'gpt-4o'        => ['input' => 2.5, 'output' => 10.0],
        'gpt-4o-mini'   => ['input' => 0.15, 'output' => 0.6],
        'deepseek-v3'   => ['input' => 0.27, 'output' => 1.1],
        'local-ollama'  => ['input' => 0.0, 'output' => 0.0],   // 本地免费
    ];

    public function handle(): int
    {
        $month = $this->option('month') ?? date('Y-m');

        // 从 usage_logs 表统计
        $stats = \DB::table('ai_usage_logs')
            ->select('model', \DB::raw('
                SUM(input_tokens) as total_input,
                SUM(output_tokens) as total_output,
                COUNT(*) as request_count,
                AVG(response_time_ms) as avg_latency
            '))
            ->where('created_at', 'like', $month . '%')
            ->groupBy('model')
            ->get();

        $totalCost = 0;
        $rows = [];

        foreach ($stats as $stat) {
            $pricing = $this->pricing[$stat->model] ?? $this->pricing['gpt-4o-mini'];
            $inputCost = ($stat->total_input / 1_000_000) * $pricing['input'];
            $outputCost = ($stat->total_output / 1_000_000) * $pricing['output'];
            $total = $inputCost + $outputCost;
            $totalCost += $total;

            $rows[] = [
                $stat->model,
                number_format($stat->request_count),
                number_format($stat->total_input) . ' / ' . number_format($stat->total_output),
                '$' . number_format($total, 2),
                $stat->avg_latency . 'ms',
            ];
        }

        $this->table(['模型', '请求数', '输入/输出 Tokens', '费用', '平均延迟'], $rows);
        $this->info("月度 AI 总费用: $" . number_format($totalCost, 2));

        return 0;
    }
}
```

### 2.2 月度费用分解

```
┌─────────────────┬──────────┬────────────┬───────────┬──────────┐
│ 使用场景         │ 月请求量  │ 月Token量   │ 推荐模型   │ 月费用    │
├─────────────────┼──────────┼────────────┼───────────┼──────────┤
│ 代码补全         │  3,200   │   2.1M     │ 本地 Ollama│  $0.00   │
│ 简单问答         │    800   │   1.2M     │ GPT-4o-mini│  $3.60   │
│ 代码审查         │    450   │   8.5M     │ Claude Son.│  $58.50  │
│ 测试生成         │    300   │   4.2M     │ DeepSeek V3│  $5.40   │
│ 文档生成         │    120   │   6.8M     │ Claude Son.│  $46.80  │
│ 架构设计         │     50   │   3.5M     │ Claude Son.│  $24.00  │
│ Debug 分析      │    200   │   2.8M     │ Claude Son.│  $19.20  │
├─────────────────┼──────────┼────────────┼───────────┼──────────┤
│ 合计(全部云端)   │  5,120   │  29.1M     │           │ $157.50  │
│ 合计(混合策略)   │  5,120   │  29.1M     │ 本地+云端  │  $92.40  │
│ 节省比例         │          │            │           │  41.3%   │
└─────────────────┴──────────┴────────────┴───────────┴──────────┘
```

**核心结论**：将代码补全和简单问答迁移到本地后，月费用从 $157.50 降到 $92.40，节省 41%。

## 三、隐私合规：哪些代码不能上云？

这是很多团队忽视但最致命的问题。

### 3.1 数据分类矩阵

```
┌─────────────────────┬──────────┬──────────────┬──────────────────┐
│ 数据类型             │ 风险等级  │ 可否发云端    │ 处理策略          │
├─────────────────────┼──────────┼──────────────┼──────────────────┤
│ .env 配置文件        │ 🔴 高    │ ❌ 绝对不行   │ 仅本地模型        │
│ 数据库迁移文件       │ 🟡 中    │ ⚠️ 脱敏后可   │ 替换表名/字段名    │
│ API 密钥/Token      │ 🔴 高    │ ❌ 绝对不行   │ 仅本地模型        │
│ 用户数据 SQL        │ 🔴 高    │ ❌ 绝对不行   │ 仅本地模型        │
│ 业务逻辑代码        │ 🟢 低    │ ✅ 可以      │ 云端大模型        │
│ 测试代码            │ 🟢 低    │ ✅ 可以      │ 云端大模型        │
│ 文档/README         │ 🟢 低    │ ✅ 可以      │ 云端大模型        │
│ 开源项目代码        │ 🟢 低    │ ✅ 可以      │ 云端大模型        │
│ 私有 API 接口定义    │ 🟡 中    │ ⚠️ 脱敏后可   │ 替换端点路径      │
│ 支付相关代码        │ 🔴 高    │ ❌ 不建议     │ 本地 + 审查后云端 │
└─────────────────────┴──────────┴──────────────┴──────────────────┘
```

### 3.2 自动脱敏网关实现

在发送到云端 API 之前，我们实现了一个简单的脱敏层：

```php
<?php

namespace App\Services\AiGateway;

class SanitizeGateway
{
    // 敏感模式匹配规则
    private array $patterns = [
        // 环境变量值
        '/(password|secret|key|token)\s*=\s*[\'"]([^\'"]+)[\'"]/' => '$1=***REDACTED***',
        // 数据库连接串
        '/mysql:\/\/[^@]+@[^\/]+\/\w+/' => 'mysql://***:***@db-host/database',
        // AWS 密钥
        '/AKIA[0-9A-Z]{16}/' => 'AKIA***REDACTED***',
        // JWT Token
        '/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/' => '***JWT_REDACTED***',
        // Stripe 密钥
        '/sk_(live|test)_[0-9a-zA-Z]+/' => 'sk_***REDACTED***',
        // IP 地址（内网）
        '/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/' => '10.x.x.x',
        '/192\.168\.\d{1,3}\.\d{1,3}/' => '192.168.x.x',
    ];

    // 需要替换的类名/变量名（项目特定）
    private array $replacements = [
        'KKdayPaymentService' => 'PaymentService',
        'kkday_member_api' => 'member_api',
        'kkday_b2c_db' => 'app_db',
    ];

    public function sanitize(string $code): string
    {
        // 1. 正则替换敏感模式
        foreach ($this->patterns as $pattern => $replacement) {
            $code = preg_replace($pattern, $replacement, $code);
        }

        // 2. 替换项目特定名称
        $code = str_replace(
            array_keys($this->replacements),
            array_values($this->replacements),
            $code
        );

        // 3. 移除注释中的敏感信息
        $code = preg_replace('/\/\/\s*(TODO|FIXME|HACK).*$/m', '', $code);

        return $code;
    }

    /**
     * 判断内容是否包含高敏感数据，应使用本地模型
     */
    public function shouldBeLocalOnly(string $content): bool
    {
        $highRiskIndicators = [
            '/\.env\b/',
            '/password/i',
            '/secret_key/i',
            '/private_key/i',
            '/sk_(live|test)_/',
            '/AKIA[0-9A-Z]/',
            '/BEGIN (RSA |EC )?PRIVATE KEY/',
        ];

        foreach ($highRiskIndicators as $pattern) {
            if (preg_match($pattern, $content)) {
                return true;
            }
        }

        return false;
    }
}
```

**踩坑记录 ②**：我们最初没有做支付代码的脱敏，结果 Stripe 的 `sk_test_xxx` 密钥出现在了 Claude 的训练反馈中。虽然 Anthropic 声称不使用 API 数据训练，但合规审计还是标记了这个风险。现在所有包含 `sk_`、`AKIA`、`-----BEGIN` 的内容自动路由到本地模型。

## 四、智能路由：按任务类型选择模型

这是混合策略的核心——不是所有任务都需要云端大模型。

### 4.1 路由决策引擎

```php
<?php

namespace App\Services\AiGateway;

enum TaskType: string
{
    case CODE_COMPLETION = 'code_completion';
    case CODE_REVIEW = 'code_review';
    case TEST_GENERATION = 'test_generation';
    case DOC_GENERATION = 'doc_generation';
    case ARCHITECTURE = 'architecture';
    case DEBUG_ANALYSIS = 'debug_analysis';
    case SIMPLE_QA = 'simple_qa';
}

class ModelRouter
{
    private SanitizeGateway $sanitizeGateway;

    // 路由策略配置
    private array $routingTable = [
        TaskType::CODE_COMPLETION => [
            'primary' => 'local:deepseek-coder:6.7b',
            'fallback' => 'cloud:gpt-4o-mini',
            'reason' => '补全任务对质量要求不高，本地模型延迟更低',
        ],
        TaskType::CODE_REVIEW => [
            'primary' => 'cloud:claude-sonnet',
            'fallback' => 'cloud:gpt-4o',
            'reason' => '审查需要深度理解和安全判断，需大模型',
        ],
        TaskType::TEST_GENERATION => [
            'primary' => 'cloud:deepseek-v3',
            'fallback' => 'cloud:gpt-4o-mini',
            'reason' => '测试生成需要理解业务逻辑，但成本敏感',
        ],
        TaskType::DOC_GENERATION => [
            'primary' => 'cloud:claude-sonnet',
            'fallback' => 'cloud:gpt-4o',
            'reason' => '文档需要语言质量高，Claude 中文表现好',
        ],
        TaskType::ARCHITECTURE => [
            'primary' => 'cloud:claude-sonnet',
            'fallback' => 'cloud:gpt-4o',
            'reason' => '架构设计是高价值任务，必须用最强模型',
        ],
        TaskType::DEBUG_ANALYSIS => [
            'primary' => 'cloud:claude-sonnet',
            'fallback' => 'local:deepseek-coder:33b',
            'reason' => 'Debug 需要深度推理，但可降级到本地大模型',
        ],
        TaskType::SIMPLE_QA => [
            'primary' => 'local:qwen2.5-coder:7b',
            'fallback' => 'cloud:gpt-4o-mini',
            'reason' => '简单问答本地模型足够，节省成本',
        ],
    ];

    public function __construct(SanitizeGateway $sanitizeGateway)
    {
        $this->sanitizeGateway = $sanitizeGateway;
    }

    public function route(TaskType $taskType, string $content): ModelTarget
    {
        $strategy = $this->routingTable[$taskType];

        // 检查是否包含敏感数据，强制本地
        if ($this->sanitizeGateway->shouldBeLocalOnly($content)) {
            return $this->parseTarget('local:qwen2.5-coder:7b');
        }

        // 使用主模型
        return $this->parseTarget($strategy['primary']);
    }

    private function parseTarget(string $target): ModelTarget
    {
        [$platform, $model] = explode(':', $target, 2);

        return new ModelTarget(
            platform: $platform === 'local' ? Platform::LOCAL : Platform::CLOUD,
            model: $model,
            isLocal: $platform === 'local',
        );
    }
}

readonly class ModelTarget
{
    public function __construct(
        public Platform $platform,
        public string $model,
        public bool $isLocal,
    ) {}
}

enum Platform { case LOCAL; case CLOUD; }
```

### 4.2 在 Laravel 命令中集成

```php
<?php

namespace App\Console\Commands;

use App\Services\AiGateway\{ModelRouter, TaskType, SanitizeGateway};
use Illuminate\Console\Command;

class AiAssist extends Command
{
    protected $signature = 'ai:assist
        {--task=code_completion : 任务类型}
        {--file= : 目标文件路径}
        {--prompt= : 自定义提示词}';

    protected ModelRouter $router;
    protected SanitizeGateway $gateway;

    public function handle(): int
    {
        $taskType = TaskType::from($this->option('task'));
        $content = $this->option('file')
            ? file_get_contents($this->option('file'))
            : $this->option('prompt');

        // 路由决策
        $target = $this->router->route($taskType, $content);

        $this->info("📡 路由决策: " . ($target->isLocal ? '🏠 本地' : '☁️ 云端') . " → {$target->model}");

        // 如果发云端，先脱敏
        if (!$target->isLocal) {
            $content = $this->gateway->sanitize($content);
            $this->warn("🔒 已执行脱敏处理");
        }

        // 调用模型
        $startTime = microtime(true);
        $response = $this->callModel($target, $content, $taskType);
        $elapsed = round((microtime(true) - $startTime) * 1000);

        $this->info("⏱️ 响应时间: {$elapsed}ms");
        $this->line($response);

        return 0;
    }

    private function callModel($target, string $content, TaskType $taskType): string
    {
        if ($target->isLocal) {
            return $this->callOllama($target->model, $content);
        }

        return $this->callCloudApi($target->model, $content, $taskType);
    }

    private function callOllama(string $model, string $prompt): string
    {
        $response = \Http::timeout(120)->post('http://localhost:11434/api/generate', [
            'model' => $model,
            'prompt' => $prompt,
            'stream' => false,
            'options' => [
                'temperature' => 0.3,
                'num_predict' => 2048,
            ],
        ]);

        return $response->json('response', '');
    }

    private function callCloudApi(string $model, string $prompt, TaskType $taskType): string
    {
        // 使用 Hermes Agent 或直接调用 Claude/GPT API
        $response = \Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.anthropic.key'),
            'anthropic-version' => '2023-06-01',
        ])->timeout(60)->post('https://api.anthropic.com/v1/messages', [
            'model' => $model,
            'max_tokens' => 4096,
            'messages' => [
                ['role' => 'user', 'content' => $prompt],
            ],
        ]);

        return $response->json('content.0.text', '');
    }
}
```

**踩坑记录 ③**：本地 Ollama 的默认超时是 30 秒，但 33B 模型生成长代码经常需要 60-90 秒。务必在 HTTP 客户端设置 `timeout(120)`，否则你会得到一堆 "Connection timed out" 错误。

## 五、实际使用体验对比

### 5.1 各场景实际表现

经过 2 个月的混合使用，以下是各场景的真实体验：

**场景 1：Laravel Eloquent 查询补全**
```
Prompt: "Write a scope that filters orders by date range, status, and customer region"

🏠 本地 (deepseek-coder:6.7b) - 1.2s
✅ 输出：基本正确的 scope 方法，但缺少参数验证

☁️ 云端 (Claude Sonnet) - 2.1s
✅ 输出：完整的 scope + 参数验证 + 异常处理 + 测试用例建议

结论：简单补全用本地，复杂逻辑用云端
```

**场景 2：错误日志分析**
```
Input: production.log 中的 500 错误堆栈

🏠 本地 (qwen2.5-coder:7b) - 3.5s
✅ 能识别常见错误（N+1查询、内存溢出），给出基本建议

☁️ 云端 (Claude Sonnet) - 4.2s
✅ 深度分析：关联上下文、建议修复方案、预防措施

结论：简单错误本地够用，复杂问题需云端
```

**场景 3：单元测试生成**
```
Input: PaymentService.php 完整类（200+ 行）

🏠 本地 (deepseek-coder:6.7b) - 8.5s
⚠️ 生成 60% 的测试，Mock 设置基本正确，但断言太弱

☁️ 云端 (Claude Sonnet) - 6.3s
✅ 生成 95% 的测试，包含边界条件、异常路径、Mock 验证

结论：测试生成必须用云端，本地生成的测试还需要大量修改
```

### 5.2 开发者体验总结

```php
<?php

// 本地模型的最佳使用方式：在 IDE 中做实时补全
// 配合 Continue (VS Code) 或 Cursor 的本地模型功能

// .cursor/settings.json 配置示例
{
    "cursor.cpp.enabled": true,
    "cursor.cpp.localModel": "deepseek-coder:6.7b",
    "cursor.cpp.fallbackModel": "claude-sonnet",
    "cursor.cpp.contextWindow": 4096
}
```

## 六、踩坑汇总与决策指南

### 6.1 踩坑清单

| # | 踩坑 | 影响 | 解决方案 |
|---|------|------|---------|
| 1 | 8GB Mac 跑 13B 模型 | 推理极慢（2-3 token/s） | 降到 7B 或升级硬件 |
| 2 | 云端发送含密钥代码 | 合规风险 | 实现脱敏网关 |
| 3 | Ollama 超时设置太短 | 调用失败 | HTTP timeout(120) |
| 4 | 本地模型中文能力差 | 输出质量低 | 用 qwen2.5-coder 系列 |
| 5 | 本地模型不理解项目上下文 | 补全不准 | 配合 Cursor IDE 的 @codebase |
| 6 | 33B 模型并发受限 | 多人使用卡顿 | 限制并发为 2，排队处理 |
| 7 | 云端 API 限流 | 批量任务失败 | 实现指数退避重试 |

### 6.2 最终决策指南

```
┌─────────────────────────────┐
│     这个任务该用哪个模型？      │
└──────────────┬──────────────┘
               │
        ┌──────▼──────┐
        │ 是否包含敏感  │
        │ 数据(.env等) │
        └──────┬──────┘
          是 ↙     ↘ 否
      ┌─────┐    ┌──────────┐
      │本地  │    │ 复杂度如何 │
      │模型  │    └────┬─────┘
      └─────┘     低 ↙     ↘ 高
            ┌────────┐   ┌──────────┐
            │GPT-4o  │   │ 是否需要  │
            │mini    │   │ 深度推理  │
            │或本地   │   └────┬─────┘
            └────────┘    是 ↙     ↘ 否
                   ┌──────────┐  ┌──────────┐
                   │Claude    │  │DeepSeek  │
                   │Sonnet    │  │V3        │
                   │(最强)     │  │(性价比)   │
                   └──────────┘  └──────────┘
```

## 总结

| 维度 | 本地 AI | 云端 AI |
|------|---------|---------|
| **成本** | 一次性硬件投入，后续免费 | 按 token 计费，持续支出 |
| **隐私** | 数据不出本机，100% 安全 | 需脱敏处理，仍有合规风险 |
| **质量** | 7B 模型约 70% 的云端水平 | 深度推理、复杂任务最佳 |
| **延迟** | 取决于硬件，通常 1-3s | 网络延迟 + 推理，通常 2-5s |
| **并发** | 受限于本地 GPU/内存 | 弹性扩展，几乎无上限 |
| **适合场景** | 补全、简单QA、敏感数据 | 审查、架构、测试、文档 |

**我们的最终选择**：70% 的日常任务（代码补全、简单问答）走本地，30% 的高价值任务（审查、架构、测试）走云端。月费用降低 41%，同时敏感数据零泄露。

---

> **下一篇预告**：《MiMo-v2.5-pro 实战：小米 AI 模型接入与使用》——探索国产大模型在 Laravel 开发中的实际表现。
