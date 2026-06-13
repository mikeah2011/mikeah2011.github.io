---

title: AI Agent Computer Use 实战：屏幕截图理解 + 鼠标键盘操作——Laravel 后台自动化运维的视觉 Agent
keywords: [AI Agent Computer Use, Laravel, Agent, 屏幕截图理解, 鼠标键盘操作, 后台自动化运维的视觉, AI]
date: 2026-06-09 13:39:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- AI Agent
- Computer Use
- Laravel
- 自动化
- 视觉理解
- 屏幕截图
description: 深入实战 AI Agent Computer Use 技术：通过屏幕截图理解 + 鼠标键盘模拟操作，让 AI 代替人类完成 Laravel 后台的日常运维任务。从原理到完整 PHP 实现，带你构建一个能看、能点、能输的视觉运维 Agent。
---



## 前言

2024 年底，Anthropic 率先在 Claude 中推出了 Computer Use 功能——AI 不再只是聊天，它能「看」屏幕、能「点」按钮、能「打字」。这不是科幻，这是实实在在的生产力革命。

想象一下：你的 Laravel 后台每天有大量重复操作——审核订单、导出报表、修改配置、检查异常。以前你写爬虫或调 API，但很多老旧系统根本没有 API。现在，你可以让 AI Agent 直接「看」屏幕，像人一样操作后台。

这篇文章，我会带你从零构建一个基于 Computer Use 的 Laravel 后台自动化运维 Agent。不是概念讲解，是能跑的代码。

## 什么是 Computer Use

### 核心理念

传统自动化（Selenium、Puppeteer）是**基于 DOM 选择器**的：找到 `#submit-btn`，点击它。问题是：页面一改版，选择器就废了。

Computer Use 走的是另一条路：**基于视觉理解**。AI 看到的是截图，就像人看到屏幕一样。它理解的是「界面上有个蓝色的提交按钮」，而不是 `button.submit.blue`。

```
传统自动化：代码 → DOM 选择器 → 操作
Computer Use：截图 → 视觉理解 → 操作指令 → 执行
```

### 技术栈

一个完整的 Computer Use Agent 需要三层：

1. **视觉层**：截图 + 多模态 LLM 理解（GPT-4o、Claude 3.5 Sonnet、Qwen-VL）
2. **决策层**：Agent 推理——分析当前状态，决定下一步操作
3. **执行层**：鼠标/键盘模拟（xdotool、PyAutoGUI、Playwright）

### 与传统 RPA 的区别

| 维度 | 传统 RPA | Computer Use Agent |
|------|----------|-------------------|
| 定位元素 | CSS/XPath 选择器 | 视觉理解 |
| 页面改版 | 需要修改脚本 | 自动适应 |
| 动态内容 | 处理困难 | 原生支持 |
| 复杂判断 | 需要硬编码规则 | LLM 推理 |
| 开发成本 | 中等 | 低（描述任务即可） |

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Laravel 应用                      │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ 任务调度器 │  │ Agent 管理 │  │  结果处理器   │  │
│  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
│        │              │               │           │
│  ┌─────┴──────────────┴───────────────┴────────┐  │
│  │           ComputerUseAgent (核心)            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │ 视觉引擎 │ │ 推理引擎 │ │  操作执行器   │ │  │
│  │  │ Screenshot│ │  LLM    │ │  Playwright  │ │  │
│  │  └──────────┘ └──────────┘ └──────────────┘ │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │   Laravel 后台管理    │
               │  (被操作的目标系统)    │
               └─────────────────────┘
```

### 核心循环

Agent 的工作遵循 **观察-思考-行动** 循环：

```
while (任务未完成) {
    1. 截图 → 获取当前屏幕状态
    2. 发送给 LLM → 理解屏幕内容 + 历史操作
    3. LLM 返回操作指令 → click(x, y) / type(text) / scroll()
    4. 执行操作 → 通过 Playwright/xdotool
    5. 等待页面响应 → 回到步骤 1
}
```

## 实战代码

### 环境准备

```bash
# PHP 依赖
composer require guzzlehttp/guzzle laravel/octane

# Node.js 依赖（Playwright 用于浏览器操作）
npm install playwright
npx playwright install chromium

# Python 依赖（备选方案：PyAutoGUI 用于桌面操作）
pip install pyautogui pillow
```

### 核心类：ComputerUseAgent

```php
<?php

namespace App\Services\Agent;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

class ComputerUseAgent
{
    private Client $http;
    private string $llmEndpoint;
    private string $llmModel;
    private string $playwrightWs;
    private array $history = [];
    private int $maxIterations = 30;

    public function __construct(
        ?string $llmEndpoint = null,
        ?string $llmModel = null,
        ?string $playwrightWs = null
    ) {
        $this->http = new Client(['timeout' => 120]);
        $this->llmEndpoint = $llmEndpoint ?? config('agent.llm_endpoint', 'https://api.openai.com/v1');
        $this->llmModel = $llmModel ?? config('agent.llm_model', 'gpt-4o');
        $this->playwrightWs = $playwrightWs ?? config('agent.playwright_ws', 'ws://localhost:3000');
    }

    /**
     * 执行一个自动化任务
     */
    public function executeTask(string $task, string $targetUrl): array
    {
        Log::info("Agent 开始执行任务: {$task}");

        // 初始化浏览器
        $this->callPlaywright('navigate', ['url' => $targetUrl]);
        sleep(2); // 等待页面加载

        $iterations = 0;
        $result = ['success' => false, 'steps' => [], 'error' => null];

        while ($iterations < $this->maxIterations) {
            $iterations++;
            Log::info("Agent 迭代 #{$iterations}");

            // 步骤 1：截图
            $screenshot = $this->takeScreenshot();

            // 步骤 2：LLM 分析 + 决策
            $action = $this->analyzeAndDecide($task, $screenshot);

            // 步骤 3：检查是否完成
            if ($action['type'] === 'complete') {
                $result['success'] = true;
                $result['summary'] = $action['summary'] ?? '任务完成';
                Log::info("Agent 任务完成: {$result['summary']}");
                break;
            }

            if ($action['type'] === 'fail') {
                $result['error'] = $action['reason'] ?? '任务失败';
                Log::warning("Agent 任务失败: {$result['error']}");
                break;
            }

            // 步骤 4：执行操作
            $this->executeAction($action);
            $result['steps'][] = [
                'iteration' => $iterations,
                'action' => $action,
            ];

            // 等待页面响应
            usleep(500_000); // 500ms
        }

        if ($iterations >= $this->maxIterations) {
            $result['error'] = "超过最大迭代次数 ({$this->maxIterations})";
        }

        return $result;
    }

    /**
     * 截图
     */
    private function takeScreenshot(): string
    {
        $response = $this->callPlaywright('screenshot', [
            'fullPage' => false,
            'type' => 'png',
        ]);

        return $response['base64']; // Base64 编码的截图
    }

    /**
     * LLM 分析屏幕 + 决策下一步操作
     */
    private function analyzeAndDecide(string $task, string $screenshot): array
    {
        $systemPrompt = $this->getSystemPrompt();
        $userContent = $this->buildUserMessage($task, $screenshot);

        $response = $this->http->post("{$this->llmEndpoint}/chat/completions", [
            'headers' => [
                'Authorization' => 'Bearer ' . config('agent.llm_api_key'),
                'Content-Type' => 'application/json',
            ],
            'json' => [
                'model' => $this->llmModel,
                'messages' => array_merge(
                    [['role' => 'system', 'content' => $systemPrompt]],
                    $this->getHistoryMessages(),
                    [['role' => 'user', 'content' => $userContent]]
                ],
                'max_tokens' => 1024,
                'temperature' => 0.1,
            ],
        ]);

        $body = json_decode($response->getBody(), true);
        $content = $body['choices'][0]['message']['content'] ?? '';

        // 解析 LLM 返回的操作指令
        $action = $this->parseAction($content);

        // 记录历史
        $this->history[] = ['role' => 'user', "content" => "[截图已发送]"];
        $this->history[] = ['role' => 'assistant', 'content' => $content];

        // 保持历史窗口不超过 10 轮
        if (count($this->history) > 20) {
            $this->history = array_slice($this->history, -20);
        }

        return $action;
    }

    /**
     * 系统提示词
     */
    private function getSystemPrompt(): string
    {
        return <<<'PROMPT'
你是一个 Computer Use Agent，通过观察屏幕截图来操作 Laravel 后台管理系统。

你的能力：
- 看懂屏幕截图中的所有元素（按钮、输入框、表格、菜单等）
- 通过坐标点击屏幕上的元素
- 在输入框中输入文字
- 滚动页面
- 按键盘快捷键

每次你会收到：
1. 用户的任务描述
2. 当前屏幕截图
3. 之前的操作历史（如果有）

你必须返回以下 JSON 格式之一：

```json
{"type": "click", "x": 500, "y": 300, "reason": "点击提交按钮"}
```
```json
{"type": "type", "text": "Hello World", "reason": "在搜索框输入关键词"}
```
```json
{"type": "scroll", "direction": "down", "amount": 300, "reason": "向下滚动查看更多"}
```
```json
{"type": "keypress", "key": "Enter", "reason": "按下回车键"}
```
```json
{"type": "wait", "seconds": 2, "reason": "等待页面加载"}
```
```json
{"type": "complete", "summary": "已成功导出订单报表到 /tmp/orders.csv"}
```
```json
{"type": "fail", "reason": "找不到登录入口，页面可能已改版"}
```

坐标规则：
- 坐标基于截图的像素位置（左上角为 0,0）
- x 是水平方向，y 是垂直方向
- 点击要精确，尽量点在元素的中心位置

注意事项：
- 每次只返回一个操作指令
- 如果页面还在加载中，使用 wait 操作
- 遇到弹窗/对话框要优先处理
- 如果连续 3 次操作无效，返回 fail
PROMPT;
    }

    /**
     * 构建发送给 LLM 的消息
     */
    private function buildUserMessage(string $task, string $screenshot): array
    {
        return [
            [
                'type' => 'text',
                'text' => "任务：{$task}\n\n请观察当前屏幕截图，决定下一步操作。只返回 JSON 格式的操作指令。",
            ],
            [
                'type' => 'image_url',
                'image_url' => [
                    'url' => "data:image/png;base64,{$screenshot}",
                    'detail' => 'high',
                ],
            ],
        ];
    }

    /**
     * 获取历史消息
     */
    private function getHistoryMessages(): array
    {
        return array_map(fn($msg) => [
            'role' => $msg['role'],
            'content' => $msg['content'],
        ], $this->history);
    }

    /**
     * 解析 LLM 返回的操作指令
     */
    private function parseAction(string $content): array
    {
        // 尝试从返回内容中提取 JSON
        if (preg_match('/\{[\s\S]*\}/', $content, $matches)) {
            $action = json_decode($matches[0], true);
            if ($action && isset($action['type'])) {
                return $action;
            }
        }

        // 如果无法解析，返回 fail
        return [
            'type' => 'fail',
            'reason' => "无法解析 LLM 返回: " . substr($content, 0, 200),
        ];
    }

    /**
     * 执行操作
     */
    private function executeAction(array $action): void
    {
        match ($action['type']) {
            'click' => $this->callPlaywright('click', [
                'x' => $action['x'],
                'y' => $action['y'],
            ]),
            'type' => $this->callPlaywright('type', [
                'text' => $action['text'],
            ]),
            'scroll' => $this->callPlaywright('scroll', [
                'direction' => $action['direction'] ?? 'down',
                'amount' => $action['amount'] ?? 300,
            ]),
            'keypress' => $this->callPlaywright('keypress', [
                'key' => $action['key'],
            ]),
            'wait' => sleep($action['seconds'] ?? 1),
            default => Log::warning("未知操作类型: {$action['type']}"),
        };

        Log::info("Agent 执行操作: " . json_encode($action, JSON_UNESCAPED_UNICODE));
    }

    /**
     * 调用 Playwright WebSocket 服务
     */
    private function callPlaywright(string $method, array $params = []): array
    {
        // 实际实现中通过 WebSocket 与 Playwright 通信
        // 这里简化为 HTTP 调用示例
        $response = $this->http->post($this->playwrightWs . '/' . $method, [
            'json' => $params,
        ]);

        return json_decode($response->getBody(), true);
    }
}
```

### Playwright 服务端

```javascript
// playwright-server.js
const { chromium } = require('playwright');
const express = require('express');
const app = express();

app.use(express.json());

let browser = null;
let page = null;

// 初始化浏览器
async function initBrowser() {
    browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();
}

// 导航到 URL
app.post('/navigate', async (req, res) => {
    const { url } = req.body;
    if (!page) await initBrowser();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    res.json({ success: true });
});

// 截图
app.post('/screenshot', async (req, res) => {
    if (!page) return res.status(400).json({ error: '浏览器未初始化' });
    const buffer = await page.screenshot({
        type: req.body.type || 'png',
        fullPage: req.body.fullPage || false,
    });
    res.json({ base64: buffer.toString('base64') });
});

// 点击
app.post('/click', async (req, res) => {
    const { x, y } = req.body;
    if (!page) return res.status(400).json({ error: '浏览器未初始化' });
    await page.mouse.click(x, y);
    res.json({ success: true });
});

// 输入文字
app.post('/type', async (req, res) => {
    const { text } = req.body;
    if (!page) return res.status(400).json({ error: '浏览器未初始化' });
    await page.keyboard.type(text, { delay: 50 });
    res.json({ success: true });
});

// 按键
app.post('/keypress', async (req, res) => {
    const { key } = req.body;
    if (!page) return res.status(400).json({ error: '浏览器未初始化' });
    await page.keyboard.press(key);
    res.json({ success: true });
});

// 滚动
app.post('/scroll', async (req, res) => {
    const { direction, amount } = req.body;
    if (!page) return res.status(400).json({ error: '浏览器未初始化' });
    const delta = direction === 'up' ? -(amount || 300) : (amount || 300);
    await page.mouse.wheel(0, delta);
    res.json({ success: true });
});

app.listen(3000, () => {
    console.log('Playwright 服务运行在 http://localhost:3000');
});
```

### Artisan 命令集成

```php
<?php

namespace App\Console\Commands;

use App\Services\Agent\ComputerUseAgent;
use Illuminate\Console\Command;

class AgentComputerUse extends Command
{
    protected $signature = 'agent:computer-use 
                            {task : 任务描述} 
                            {--url= : 目标后台 URL}
                            {--max-iterations=30 : 最大迭代次数}';

    protected $description = '使用 Computer Use Agent 执行后台自动化任务';

    public function handle(ComputerUseAgent $agent): int
    {
        $task = $this->argument('task');
        $url = $this->option('url') ?? config('app.admin_url', 'http://localhost:8000/admin');

        $this->info("🤖 Agent 开始执行任务...");
        $this->info("📋 任务: {$task}");
        $this->info("🌐 目标: {$url}");
        $this->newLine();

        $startTime = microtime(true);
        $result = $agent->executeTask($task, $url);
        $elapsed = round(microtime(true) - $startTime, 2);

        $this->newLine();
        $this->info("⏱️  耗时: {$elapsed}s");
        $this->info("📊 步骤数: " . count($result['steps']));

        if ($result['success']) {
            $this->info("✅ 任务完成: " . ($result['summary'] ?? ''));
            return self::SUCCESS;
        }

        $this->error("❌ 任务失败: " . ($result['error'] ?? '未知错误'));
        return self::FAILURE;
    }
}
```

### 队列任务封装

```php
<?php

namespace App\Jobs;

use App\Services\Agent\ComputerUseAgent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ExecuteComputerUseTask implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 600; // 10 分钟超时

    public function __construct(
        public string $task,
        public string $targetUrl,
        public ?string $callbackUrl = null,
    ) {}

    public function handle(ComputerUseAgent $agent): void
    {
        Log::info("开始执行 Computer Use 任务: {$this->task}");

        $result = $agent->executeTask($this->task, $this->targetUrl);

        // 如果有回调 URL，发送结果
        if ($this->callbackUrl) {
            $http = new \GuzzleHttp\Client();
            $http->post($this->callbackUrl, [
                'json' => [
                    'task' => $this->task,
                    'result' => $result,
                    'completed_at' => now()->toIso8601String(),
                ],
            ]);
        }

        Log::info("Computer Use 任务完成: " . json_encode($result));
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("Computer Use 任务失败: {$this->task}", [
            'error' => $exception->getMessage(),
        ]);
    }
}
```

### 调度集成

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天早上 9 点自动导出昨日订单报表
    $schedule->job(new ExecuteComputerUseTask(
        task: '进入订单管理页面，筛选昨天的订单，点击导出按钮，等待导出完成后记录文件路径',
        targetUrl: 'http://localhost:8000/admin/orders',
        callbackUrl: 'http://localhost:8000/api/agent/callback',
    ))->dailyAt('09:00')->name('export-daily-orders');

    // 每小时检查系统健康状态
    $schedule->job(new ExecuteComputerUseTask(
        task: '登录后台，进入系统监控页面，检查 CPU、内存、磁盘使用率，如果有超过 80% 的指标，记录告警信息',
        targetUrl: 'http://localhost:8000/admin/monitor',
    ))->hourly()->name('system-health-check');
}
```

## 踩坑记录

### 坐标偏移问题

**现象**：Agent 点击的位置总是偏移几十个像素。

**原因**：截图分辨率和浏览器视口分辨率不一致。高 DPI 屏幕下，截图可能是 2x 或 3x 分辨率。

**解决**：

```javascript
// Playwright 端：确保截图和视口使用相同的 deviceScaleFactor
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1, // 固定为 1，避免 DPI 缩放
});
```

### LLM 返回格式不稳定

**现象**：GPT-4o 有时候返回自然语言而不是 JSON。

**解决**：在 system prompt 中强化格式要求，同时用正则兜底解析：

```php
private function parseAction(string $content): array
{
    // 先尝试提取 markdown 代码块中的 JSON
    if (preg_match('/```(?:json)?\s*(\{[\s\S]*?\})\s*```/', $content, $matches)) {
        $action = json_decode($matches[1], true);
        if ($action && isset($action['type'])) return $action;
    }

    // 再尝试直接提取 JSON
    if (preg_match('/\{[^{}]*"type"\s*:\s*"[^"]+"[^{}]*\}/', $content, $matches)) {
        $action = json_decode($matches[0], true);
        if ($action) return $action;
    }

    return ['type' => 'fail', 'reason' => "无法解析 LLM 返回"];
}
```

### 页面加载等待不足

**现象**：Agent 点击了按钮，但页面还没加载完就截图了，导致后续操作失败。

**解决**：加入智能等待机制：

```javascript
// Playwright 端：等待网络空闲 + 特定元素出现
app.post('/click', async (req, res) => {
    const { x, y } = req.body;
    await page.mouse.click(x, y);
    
    // 等待网络空闲（最多 5 秒）
    try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
        // 超时也没关系，继续执行
    }
    
    res.json({ success: true });
});
```

### Token 消耗过高

**现象**：每轮截图都是高分辨率图片，token 消耗巨大。

**解决**：

1. 使用 `detail: 'low'` 降低图片解析精度（节省约 60% token）
2. 压缩截图分辨率到 1280x720
3. 只在关键步骤使用高精度

```php
private function takeScreenshot(bool $highDetail = false): string
{
    $response = $this->callPlaywright('screenshot', [
        'fullPage' => false,
        'type' => 'jpeg',        // JPEG 比 PNG 小很多
        'quality' => 70,          // 适当压缩
        'width' => 1280,          // 降低分辨率
        'height' => 720,
    ]);

    return $response['base64'];
}
```

### 认证状态维护

**现象**：Agent 每次都要重新登录，浪费时间和 token。

**解决**：使用 Playwright 的持久化上下文：

```javascript
// 保存登录状态
const storageState = await context.storageState();
fs.writeFileSync('auth-state.json', JSON.stringify(storageState));

// 恢复登录状态
const context = await browser.newContext({
    storageState: 'auth-state.json',
});
```

## 进阶：多任务编排

单个任务之外，你可能需要编排一系列操作。这里用 Laravel 的 Pipeline 模式：

```php
<?php

namespace App\Services\Agent;

use Illuminate\Pipeline\Pipeline;

class TaskOrchestrator
{
    private ComputerUseAgent $agent;

    public function __construct(ComputerUseAgent $agent)
    {
        $this->agent = $agent;
    }

    /**
     * 执行多步任务编排
     */
    public function orchestrate(string $targetUrl, array $tasks): array
    {
        $results = [];

        foreach ($tasks as $index => $task) {
            $result = app(Pipeline::class)
                ->send(['task' => $task, 'url' => $targetUrl])
                ->through([
                    ValidateTask::class,
                    PreConditionCheck::class,
                    ExecuteTask::class,  // 调用 ComputerUseAgent
                    PostConditionVerify::class,
                    RecordResult::class,
                ])
                ->thenReturn();

            $results[] = $result;

            if (!$result['success']) {
                // 任务失败，记录上下文后中断
                $this->recordFailureContext($tasks, $index, $result);
                break;
            }
        }

        return $results;
    }
}
```

使用示例：

```php
$orchestrator = app(TaskOrchestrator::class);

$results = $orchestrator->orchestrate('http://localhost:8000/admin', [
    '登录后台（用户名 admin，密码从 .env 读取）',
    '进入订单管理页面，筛选状态为"待审核"的订单',
    '逐个审核前 10 个订单，确认信息无误后点击通过',
    '进入报表页面，导出本月销售数据',
    '退出登录',
]);
```

## 安全考量

### 敏感信息保护

```php
// 不要把真实密码直接写在任务描述里
// ❌ 错误
$task = '用密码 mySecret123 登录后台';

// ✅ 正确：从配置/环境变量读取
$credentials = [
    'username' => config('agent.admin_user'),
    'password' => decrypt(config('agent.admin_password')),
];
$task = "用用户名 {$credentials['username']} 和提供的密码登录后台";
```

### 操作审计

```php
// 记录 Agent 的每一步操作
private function auditLog(array $action, string $screenshot): void
{
    DB::table('agent_audit_logs')->insert([
        'action_type' => $action['type'],
        'action_detail' => json_encode($action),
        'screenshot_path' => $this->saveScreenshot($screenshot),
        'created_at' => now(),
    ]);
}
```

### 权限限制

Agent 的操作范围必须受限：

```php
// 定义允许 Agent 操作的 URL 白名单
'allowed_urls' => [
    'http://localhost:8000/admin/orders',
    'http://localhost:8000/admin/reports',
    // 不允许访问系统设置、用户管理等敏感页面
],
```

## 总结

Computer Use Agent 是一种全新的自动化范式。它不要求目标系统有 API，不要求页面结构稳定，只要人能看懂的界面，AI 就能操作。

**适合的场景**：
- 老旧后台系统的自动化运维
- 没有 API 的第三方系统操作
- 需要视觉判断的复杂流程（如审核图片内容）
- 定时的报表导出、数据检查

**不适合的场景**：
- 高频操作（每秒多次）——视觉理解有延迟
- 纯数据处理——直接调 API 更高效
- 涉及大量文件上传/下载——Computer Use 处理文件流效率低

**成本参考**：
- GPT-4o：每张截图约 1000-2000 token（low detail），一个 10 步任务约消耗 $0.05-0.15
- Claude 3.5 Sonnet：类似成本，但在复杂 UI 理解上更稳定
- 本地 Qwen-VL：零成本，但精度和速度都有差距

技术在快速迭代。2026 年的 Computer Use 已经比一年前成熟很多，准确率和速度都有大幅提升。如果你还在手动做重复的后台操作，现在是时候让 AI 帮你干活了。
