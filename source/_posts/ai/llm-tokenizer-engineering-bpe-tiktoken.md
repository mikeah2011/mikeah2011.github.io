---

title: LLM Tokenizer 工程实战：BPE/tiktoken/Tokenizer.js 应用级 Token 计数——精确预算、Prompt 裁剪与多语言
keywords: [LLM Tokenizer, BPE, tiktoken, Tokenizer.js, Token, Prompt, 工程实战, 应用级, 计数, 精确预算]
date: 2026-06-10 08:03:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
- Token
- BPE
- tiktoken
- Prompt Engineering
- LLM
- PHP
description: 从 BPE 原理到工程落地，用 tiktoken、Tokenizer.js 和 PHP 实现精确 Token 计数，解决 Prompt 裁剪、上下文溢出、多语言 Token 效率差异等实战问题。
---




## 前言

你有没有遇到过这种情况：精心写好的 Prompt 发给 LLM，结果返回 `context_length_exceeded` 错误？或者明明觉得消息不长，API 却告诉你超了？

问题的根源在于——**你用字符数估算 Token 数，但 LLM 不按字符收费，按 Token 收费**。

一个汉字可能是 1-3 个 Token，一个英文单词可能是 1-2 个 Token，一个代码块可能比你想象的短得多。不了解 Token 计数机制，就像不知道汇率就去换钱——亏多少全靠运气。

本文从 BPE 算法原理讲起，用 tiktoken（Python）、Tokenizer.js（Node.js）和 PHP 实现应用级 Token 计数，覆盖精确预算、Prompt 裁剪、多语言效率对比三大实战场景。

## Token 是什么

### LLM 的"字符集"

LLM 不直接处理文本字符串，而是把文本切分成 **Token**（词元）。Token 是模型的最小处理单元，类似于中文的"字"或英文的"词"，但不完全一样。

```
"Hello, world!" → ["Hello", ",", " world", "!"]  # 4 个 Token
"你好世界" → ["你好", "世界"]  # 2 个 Token（GPT-4o）
"你好世界" → ["你", "好", "世", "界"]  # 4 个 Token（某些模型）
```

关键点：
- **同一个词在不同模型中 Token 数不同**，因为每个模型的词表（vocabulary）不同
- **同一个模型对不同语言的 Token 效率差异巨大**，英文通常比中文高效
- **Token 数 = 成本 + 上下文占用**，两者都直接影响你的钱包

### 为什么 Token 计数很重要

1. **成本控制**：GPT-4o 输入 $2.5/百万 Token，输出 $10/百万 Token。差一个数量级就是真金白银
2. **上下文管理**：模型有固定上下文窗口（如 128K），超了就报错
3. **Prompt 裁剪**：系统提示 + 历史消息 + 用户输入，要在有限窗口内合理分配
4. **响应质量**：留够 Token 给输出，否则模型会截断回答

## BPE：Tokenizer 的核心算法

### 原理

BPE（Byte Pair Encoding，字节对编码）是目前 LLM Tokenizer 的主流算法。GPT 系列、Claude、LLaMA 都用它。

核心思想非常简单：**反复合并最高频的相邻字符对，直到词表大小达标**。

举个例子，假设训练语料是：

```
"aaabdaaabac"
```

初始词表：`{a, b, d, c}`

第一轮：`aa` 出现最多（4 次），合并为 `Z`：
```
"ZabdZabZc"  → 词表: {a, b, d, c, Z}
```

第二轮：`Za` 出现最多（3 次），合并为 `Y`：
```
"YbdYbYc"  → 词表: {a, b, d, c, Z, Y}
```

如此反复，直到词表达到预设大小（如 50257 个 Token）。

### 训练 vs 推理

- **训练阶段**：统计语料频率，执行 BPE 合并，生成词表和合并规则
- **推理阶段**：用训练好的词表和规则，对新文本做编码（切分）和解码（还原）

我们工程中用的是推理阶段——直接用现成的 Tokenizer 模型，不需要自己训练。

### Byte-level BPE

GPT-2 开始使用 **Byte-level BPE**，先把文本转成 UTF-8 字节序列，再在字节上做 BPE。好处是词表基础单元只有 256 个字节，理论上能编码任何 Unicode 字符，不会出现 OOV（Out of Vocabulary）。

## 工具选型：三大 Tokenizer 对比

| 工具 | 语言 | 支持模型 | 特点 |
|------|------|----------|------|
| tiktoken | Python | GPT-4o, GPT-4, GPT-3.5, Codex | OpenAI 官方，C 实现，速度最快 |
| Tokenizer.js | Node.js | 多模型 | 纯 JS，可离线，支持 HuggingFace 格式 |
| PHP 方案 | PHP | 有限 | 调用外部进程或 HTTP API |

## 实战一：tiktoken 精确计数（Python）

### 安装

```bash
pip install tiktoken
```

### 基础计数

```python
import tiktoken

# GPT-4o 使用 o200k_base 编码
enc = tiktoken.encoding_for_model("gpt-4o")

text = "LLM Tokenizer 是大模型应用开发的基础知识"
tokens = enc.encode(text)
print(f"文本: {text}")
print(f"Token 数: {len(tokens)}")
print(f"Token 列表: {[enc.decode([t]) for t in tokens]}")
```

输出示例：

```
文本: LLM Tokenizer 是大模型应用开发的基础知识
Token 数: 12
Token 列表: ['LL', 'M', ' Token', 'izer', ' 是', '大', '模型', '应用', '开发', '的', '基础', '知识']
```

### 消息 Token 计数（含系统开销）

实际 API 调用中，每条消息都有额外开销。不同模型的消息格式开销不同：

```python
import tiktoken

def count_message_tokens(messages: list[dict], model: str = "gpt-4o") -> int:
    """计算消息列表的总 Token 数（含格式开销）"""
    enc = tiktoken.encoding_for_model(model)
    
    # GPT-4o 每条消息的固定开销
    # <|start|>{role}<|end|>\n  ≈ 4 tokens
    # 加上 reply priming: <|start|>assistant<|end|>\n  ≈ 3 tokens
    tokens_per_message = 4
    tokens_per_name = 1  # name 字段额外开销
    
    total = 0
    for msg in messages:
        total += tokens_per_message
        for key, value in msg.items():
            total += len(enc.encode(value))
            if key == "name":
                total += tokens_per_name
    
    total += 3  # reply priming
    return total

# 测试
messages = [
    {"role": "system", "content": "你是一个 PHP 开发专家，精通 Laravel 框架。"},
    {"role": "user", "content": "解释一下 Laravel 的 Service Container 是什么？"},
]

token_count = count_message_tokens(messages)
print(f"总 Token 数: {token_count}")
```

### Prompt 预算管理

```python
import tiktoken

class PromptBudget:
    """Prompt Token 预算管理器"""
    
    def __init__(self, model: str = "gpt-4o", max_tokens: int = 128000, reserved_output: int = 4096):
        self.enc = tiktoken.encoding_for_model(model)
        self.max_tokens = max_tokens
        self.reserved_output = reserved_output
        self.available = max_tokens - reserved_output
    
    def count(self, text: str) -> int:
        return len(self.enc.encode(text))
    
    def trim_to_budget(self, text: str, budget: int) -> str:
        """将文本裁剪到指定 Token 预算内"""
        tokens = self.enc.encode(text)
        if len(tokens) <= budget:
            return text
        trimmed = tokens[:budget]
        return self.enc.decode(trimmed)
    
    def build_messages(self, system: str, history: list[dict], user_input: str) -> list[dict]:
        """构建消息列表，确保不超出预算"""
        # 1. 系统提示（必须保留）
        system_tokens = self.count(system)
        remaining = self.available - system_tokens
        
        # 2. 用户输入（必须保留）
        input_tokens = self.count(user_input)
        remaining -= input_tokens
        
        if remaining < 0:
            # 用户输入本身就超了，裁剪用户输入
            user_input = self.trim_to_budget(user_input, self.available - system_tokens - 100)
            remaining = 100
        
        # 3. 历史消息（从最新的开始，直到预算用完）
        selected_history = []
        for msg in reversed(history):
            msg_tokens = self.count(msg["content"])
            if msg_tokens <= remaining:
                selected_history.insert(0, msg)
                remaining -= msg_tokens
            else:
                # 这条消息放不下，裁剪后放入
                trimmed_content = self.trim_to_budget(msg["content"], remaining)
                selected_history.insert(0, {"role": msg["role"], "content": trimmed_content})
                break
        
        return [
            {"role": "system", "content": system},
            *selected_history,
            {"role": "user", "content": user_input},
        ]

# 使用示例
budget = PromptBudget(model="gpt-4o")
system = "你是 PHP 开发专家。"
history = [
    {"role": "user", "content": "什么是 Composer？"},
    {"role": "assistant", "content": "Composer 是 PHP 的依赖管理工具..." * 50},
]
user_input = "那 Laravel 的 Service Container 呢？"

messages = budget.build_messages(system, history, user_input)
total = sum(budget.count(m["content"]) for m in messages)
print(f"构建后总 Token: {total}, 预算: {budget.available}")
```

## 实战二：Tokenizer.js（Node.js）

### 安装

```bash
npm install @anthropic-ai/tokenizer
# 或者 OpenAI 兼容的
npm install js-tiktoken
```

### 使用 js-tiktoken

```javascript
import { encoding_for_model } from "js-tiktoken";

const enc = encoding_for_model("gpt-4o");

const text = "LLM Tokenizer 是大模型应用开发的基础知识";
const tokens = enc.encode(text);

console.log(`文本: ${text}`);
console.log(`Token 数: ${tokens.length}`);
console.log(`Token 列表: ${tokens.map(t => enc.decode([t]))}`);
```

### Express API：Token 计数服务

```javascript
import express from "express";
import { encoding_for_model } from "js-tiktoken";

const app = express();
app.use(express.json());

const encodings = {
  "gpt-4o": encoding_for_model("gpt-4o"),
  "gpt-4": encoding_for_model("gpt-4"),
  "gpt-3.5-turbo": encoding_for_model("gpt-3.5-turbo"),
};

app.post("/count", (req, res) => {
  const { text, model = "gpt-4o" } = req.body;
  const enc = encodings[model] || encodings["gpt-4o"];
  const tokens = enc.encode(text);
  
  res.json({
    model,
    text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
    token_count: tokens.length,
    char_count: text.length,
    ratio: (tokens.length / text.length).toFixed(3),
  });
});

app.post("/trim", (req, res) => {
  const { text, max_tokens, model = "gpt-4o" } = req.body;
  const enc = encodings[model] || encodings["gpt-4o"];
  const tokens = enc.encode(text);
  
  if (tokens.length <= max_tokens) {
    return res.json({ trimmed: text, token_count: tokens.length, trimmed: false });
  }
  
  const trimmedText = enc.decode(tokens.slice(0, max_tokens));
  res.json({
    trimmed: trimmedText,
    token_count: max_tokens,
    original_count: tokens.length,
    trimmed: true,
  });
});

app.listen(3000, () => console.log("Tokenizer API running on :3000"));
```

## 实战三：PHP 集成方案

PHP 没有原生的高性能 Tokenizer，但有几种实用方案。

### 方案一：调用 Python 子进程

```php
<?php

namespace App\Services;

class TokenCounter
{
    private string $pythonBin;
    private string $model;

    public function __construct(
        string $pythonBin = 'python3',
        string $model = 'gpt-4o'
    ) {
        $this->pythonBin = $pythonBin;
        $this->model = $model;
    }

    /**
     * 计算文本的 Token 数
     */
    public function count(string $text): int
    {
        $script = <<<PYTHON
import sys, json, tiktoken
enc = tiktoken.encoding_for_model("{$this->model}")
text = sys.stdin.read()
tokens = enc.encode(text)
print(json.dumps({"count": len(tokens)}))
PYTHON;

        $process = proc_open(
            [$this->pythonBin, '-c', $script],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );

        fwrite($pipes[0], $text);
        fclose($pipes[0]);

        $output = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);

        return json_decode($output, true)['count'] ?? 0;
    }

    /**
     * 裁剪文本到指定 Token 数
     */
    public function trim(string $text, int $maxTokens): string
    {
        $script = <<<PYTHON
import sys, json, tiktoken
enc = tiktoken.encoding_for_model("{$this->model}")
data = json.loads(sys.stdin.read())
tokens = enc.encode(data['text'])
if len(tokens) > data['max']:
    result = enc.decode(tokens[:data['max']])
else:
    result = data['text']
print(json.dumps({"text": result}))
PYTHON;

        $process = proc_open(
            [$this->pythonBin, '-c', $script],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );

        fwrite($pipes[0], json_encode(['text' => $text, 'max' => $maxTokens]));
        fclose($pipes[0]);

        $output = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);

        return json_decode($output, true)['text'] ?? $text;
    }
}
```

### 方案二：HTTP API 调用（适合生产环境）

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class TokenCounterApi
{
    private string $baseUrl;
    private int $timeout;

    public function __construct(
        string $baseUrl = 'http://localhost:3000',
        int $timeout = 5
    ) {
        $this->baseUrl = $baseUrl;
        $this->timeout = $timeout;
    }

    /**
     * 计算 Token 数（带缓存）
     */
    public function count(string $text, string $model = 'gpt-4o'): int
    {
        $cacheKey = 'token_count:' . md5($text . $model);
        
        return Cache::remember($cacheKey, 3600, function () use ($text, $model) {
            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}/count", [
                    'text' => $text,
                    'model' => $model,
                ]);

            return $response->json('token_count', 0);
        });
    }

    /**
     * 批量计数（减少 HTTP 调用）
     */
    public function countBatch(array $texts, string $model = 'gpt-4o'): array
    {
        $response = Http::timeout($this->timeout * 2)
            ->post("{$this->baseUrl}/count-batch", [
                'texts' => $texts,
                'model' => $model,
            ]);

        return $response->json('counts', array_fill(0, count($texts), 0));
    }
}
```

### 方案三：Laravel Artisan 命令行工具

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\TokenCounter;

class TokenCount extends Command
{
    protected $signature = 'token:count 
                            {--text= : 要计算的文本}
                            {--file= : 从文件读取}
                            {--trim= : 裁剪到指定 Token 数}
                            {--model=gpt-4o : 模型名称}';

    protected $description = '计算文本的 LLM Token 数';

    public function handle(TokenCounter $counter): int
    {
        $text = $this->option('text');
        
        if ($file = $this->option('file')) {
            if (!file_exists($file)) {
                $this->error("文件不存在: {$file}");
                return 1;
            }
            $text = file_get_contents($file);
        }

        if (empty($text)) {
            $this->error('请通过 --text 或 --file 提供文本');
            return 1;
        }

        $model = $this->option('model');
        $count = $counter->count($text);

        $this->info("模型: {$model}");
        $this->info("字符数: " . mb_strlen($text));
        $this->info("Token 数: {$count}");
        $this->info("比率: " . round($count / mb_strlen($text), 3));

        if ($trim = $this->option('trim')) {
            $trimmed = $counter->trim($text, (int) $trim);
            $trimmedCount = $counter->count($trimmed);
            $this->newLine();
            $this->info("裁剪后 Token 数: {$trimmedCount}");
            $this->info("裁剪后文本:");
            $this->line($trimmed);
        }

        return 0;
    }
}
```

使用：

```bash
# 计算文本 Token 数
php artisan token:count --text="Hello, world!"

# 从文件计算
php artisan token:count --file=./prompt.txt

# 裁剪到 100 Token
php artisan token:count --file=./long-text.txt --trim=100
```

## 实战四：多语言 Token 效率对比

这是最容易踩坑的地方——不同语言的 Token 效率差异巨大。

```python
import tiktoken

enc = tiktoken.encoding_for_model("gpt-4o")

samples = {
    "英文": "The quick brown fox jumps over the lazy dog. This is a simple English sentence for testing.",
    "中文": "敏捷的棕色狐狸跳过了懒狗。这是一个用于测试的简单中文句子。",
    "日文": "素早い茶色の狐が怠け犬を飛び越えた。これはテスト用の簡単な日本語の文です。",
    "韩文": "빠른 갈색 여우가 게으른 개를 뛰어넘었다. 이것은 테스트를 위한 간단한 한국어 문장이다.",
    "代码": "function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }",
    "JSON": '{"name": "张三", "age": 30, "skills": ["PHP", "Laravel", "MySQL"], "active": true}',
}

print(f"{'语言':<8} {'字符数':<8} {'Token数':<8} {'比率':<8} {'每Token字符':<10}")
print("-" * 50)

for lang, text in samples.items():
    tokens = enc.encode(text)
    char_count = len(text)
    token_count = len(tokens)
    ratio = token_count / char_count
    chars_per_token = char_count / token_count
    
    print(f"{lang:<8} {char_count:<8} {token_count:<8} {ratio:<8.3f} {chars_per_token:<10.2f}")
```

典型输出：

```
语言      字符数    Token数   比率      每Token字符
--------------------------------------------------
英文      87       18       0.207     4.83
中文      30       12       0.400     2.50
日文      35       16       0.457     2.19
韩文      33       20       0.606     1.65
代码      73       22       0.301     3.32
JSON      67       23       0.343     2.91
```

### 关键发现

1. **英文最高效**：平均 4-5 个字符 / Token，因为 BPE 训练语料以英文为主
2. **中文次之**：平均 2-3 个字符 / Token，一个汉字通常 1-2 个 Token
3. **日韩文更低效**：因为字符集更大，BPE 合并机会更少
4. **代码和 JSON 介于中间**：标识符和结构符号有较多重复模式

### 实际影响

假设你有一个 10 万 Token 的上下文窗口：

- **英文 Prompt**：约 40 万字符可用
- **中文 Prompt**：约 25 万字符可用
- **日文 Prompt**：约 20 万字符可用

**差了将近一倍！** 如果你的应用主要服务中文用户，在设计 Prompt 和上下文管理策略时，必须按中文的 Token 效率来计算预算，不能用英文的经验值。

## 踩坑记录

### 坑 1：不同模型的词表不通用

```python
# 错误：用 GPT-3.5 的编码器算 GPT-4o 的 Token 数
enc_35 = tiktoken.encoding_for_model("gpt-3.5-turbo")  # cl100k_base
enc_4o = tiktoken.encoding_for_model("gpt-4o")          # o200k_base

text = "你好世界"
print(len(enc_35.encode(text)))  # 可能是 4
print(len(enc_4o.encode(text)))  # 可能是 2
```

**教训**：始终用目标模型对应的编码器，不要偷懒用一个通用的。

### 坑 2：Token 计数和实际 API 消耗不完全一致

API 消耗的 Token 数会比纯文本计数多，因为：
- 每条消息有角色标记开销（`<|start|>system<|end|>`）
- `name` 字段有额外开销
- 末尾有 reply priming 开销
- 不同模型版本的开销不同

**教训**：预留 10-15% 的 Token 余量，不要卡着上限算。

### 坑 3：中文分词结果因模型而异

```python
# GPT-4o (o200k_base) 对中文更友好
text = "机器学习"
enc_4o = tiktoken.encoding_for_model("gpt-4o")
enc_35 = tiktoken.encoding_for_model("gpt-3.5-turbo")

print([enc_4o.decode([t]) for t in enc_4o.encode(text)])
# 可能: ['机器', '学习']  → 2 tokens

print([enc_35.decode([t]) for t in enc_35.encode(text)])
# 可能: ['机器', '学', '习']  → 3 tokens
```

**教训**：升级模型后重新测试 Token 计数，不要假设旧数据还准确。

### 坑 4：图片和文件的 Token 计数

图片 Token 数取决于分辨率，不是文件大小：

```python
# GPT-4o 图片 Token 估算（低分辨率模式）
# 85x85 → 固定 85 tokens
# 高分辨率模式：每 512x512 tile → 170 tokens + base 85

def estimate_image_tokens(width: int, height: int, detail: str = "high") -> int:
    if detail == "low":
        return 85
    
    # 高分辨率：缩放到 fit in 2048x2048
    if width > 2048 or height > 2048:
        ratio = min(2048 / width, 2048 / height)
        width = int(width * ratio)
        height = int(height * ratio)
    
    # 缩放最短边到 768
    if min(width, height) > 768:
        ratio = 768 / min(width, height)
        width = int(width * ratio)
        height = int(height * ratio)
    
    # 计算 512x512 tiles
    import math
    tiles_w = math.ceil(width / 512)
    tiles_h = math.ceil(height / 512)
    
    return 85 + 170 * tiles_w * tiles_h

print(f"1024x1024 图片: {estimate_image_tokens(1024, 1024)} tokens")
# 输出: 1024x1024 图片: 765 tokens
```

### 坑 5：Streaming 模式下无法精确预知输出 Token 数

Streaming 模式是逐 Token 返回的，你无法提前知道输出会用多少 Token。解决办法：

```python
import tiktoken

def estimate_output_tokens(prompt_tokens: int, max_tokens: int, model: str = "gpt-4o") -> int:
    """估算输出 Token 数（保守估计）"""
    # 通常输出是输入的 0.5-2 倍，取决于任务类型
    # 代码生成：输入的 1-3 倍
    # 问答：输入的 0.3-1 倍
    # 翻译：输入的 1-1.5 倍
    
    return min(max_tokens, prompt_tokens * 2)  # 保守取 2 倍
```

## 工程最佳实践

### 1. 建立 Token 计数中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\TokenCounter;

class TokenBudgetMiddleware
{
    public function __construct(private TokenCounter $counter) {}

    public function handle(Request $request, Closure $next)
    {
        $messages = $request->input('messages', []);
        $totalTokens = 0;

        foreach ($messages as $msg) {
            $totalTokens += $this->counter->count($msg['content'] ?? '');
        }

        // 注入到请求中，供后续使用
        $request->merge(['_token_count' => $totalTokens]);

        // 超出预算时返回友好提示
        $maxTokens = config('llm.max_context_tokens', 128000);
        if ($totalTokens > $maxTokens * 0.9) {
            return response()->json([
                'error' => 'token_budget_exceeded',
                'message' => "Token 数 ({$totalTokens}) 接近上限 ({$maxTokens})，请精简输入。",
                'token_count' => $totalTokens,
                'max_tokens' => $maxTokens,
            ], 413);
        }

        return $next($request);
    }
}
```

### 2. 监控和告警

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class TokenMonitor
{
    public static function logUsage(
        string $model,
        int $inputTokens,
        int $outputTokens,
        string $userId = 'unknown'
    ): void {
        $cost = self::calculateCost($model, $inputTokens, $outputTokens);

        Log::channel('token_usage')->info('LLM Token Usage', [
            'model' => $model,
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'total_tokens' => $inputTokens + $outputTokens,
            'estimated_cost_usd' => $cost,
            'user_id' => $userId,
        ]);

        // 单次调用超过 $0.10 告警
        if ($cost > 0.10) {
            Log::warning("Token 成本告警: {$model} 单次调用 ${$cost}");
        }
    }

    private static function calculateCost(string $model, int $input, int $output): float
    {
        $pricing = [
            'gpt-4o' => ['input' => 2.5 / 1_000_000, 'output' => 10 / 1_000_000],
            'gpt-4-turbo' => ['input' => 10 / 1_000_000, 'output' => 30 / 1_000_000],
            'gpt-3.5-turbo' => ['input' => 0.5 / 1_000_000, 'output' => 1.5 / 1_000_000],
        ];

        $price = $pricing[$model] ?? $pricing['gpt-4o'];
        return $input * $price['input'] + $output * $price['output'];
    }
}
```

### 3. 动态 Prompt 裁剪策略

```php
<?php

namespace App\Services;

class PromptTrimmer
{
    public function __construct(private TokenCounter $counter) {}

    /**
     * 智能裁剪：保留系统提示和最近消息，压缩中间历史
     */
    public function trimHistory(array $messages, int $maxTokens): array
    {
        $totalTokens = 0;
        foreach ($messages as $msg) {
            $totalTokens += $this->counter->count($msg['content']);
        }

        if ($totalTokens <= $maxTokens) {
            return $messages;
        }

        // 保留第一条（系统提示）和最后两条（最近对话）
        $mustKeep = 3;
        $systemAndRecent = array_slice($messages, 0, 1);
        $systemAndRecent[] = array_slice($messages, -2, 1)[0];
        $systemAndRecent[] = array_slice($messages, -1, 1)[0];

        $keptTokens = 0;
        foreach ($systemAndRecent as $msg) {
            $keptTokens += $this->counter->count($msg['content']);
        }

        // 中间的历史消息：从旧到新，逐条尝试保留
        $remainingBudget = $maxTokens - $keptTokens;
        $middle = array_slice($messages, 1, count($messages) - 3);
        $trimmedMiddle = [];

        foreach ($middle as $msg) {
            $msgTokens = $this->counter->count($msg['content']);
            if ($msgTokens <= $remainingBudget) {
                $trimmedMiddle[] = $msg;
                $remainingBudget -= $msgTokens;
            }
        }

        // 组装：系统提示 + 保留的中间历史 + 最近两条
        return [
            $systemAndRecent[0],
            ...$trimmedMiddle,
            $systemAndRecent[1],
            $systemAndRecent[2],
        ];
    }
}
```

## 总结

Token 计数不是可选的优化项，而是 LLM 应用开发的基础设施。核心要点：

1. **BPE 是通用算法，但每个模型的词表不同**——用错编码器会导致成本和上下文计算全部偏差
2. **中文的 Token 效率只有英文的一半**——设计系统时必须按目标语言的实际效率计算预算
3. **消息格式有隐藏开销**——每条消息 4-5 个 Token，别忘了算进去
4. **建立 Token 监控和告警**——单次调用成本超阈值要报警，月度汇总要分析
5. **动态裁剪优于硬截断**——保留系统提示和最近上下文，压缩中间历史

在生产环境中，把 Token 计数能力当作和日志、监控一样的基础设施来建设。前期多花一小时，后期能省下真金白银。
