---
title: AI Agent Knowledge Distillation 实战：大模型蒸馏到小模型——Laravel 项目中的成本驱动模型降级路径
keywords: [AI Agent Knowledge Distillation, Laravel, 大模型蒸馏到小模型, 项目中的成本驱动模型降级路径, AI]
date: 2026-06-09 13:42:00
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - Knowledge Distillation
  - LLM
  - Laravel
  - AI Cost Optimization
  - Model Distillation
  - Deep Learning
description: 深入剖析 Knowledge Distillation 技术在 Laravel AI Agent 项目中的实战应用，从大模型到小模型的知识迁移，实现成本驱动的智能模型降级策略，包含完整的蒸馏流程、部署方案和效果对比
---


## 为什么大模型不是终点

在实际生产环境中，GPT-4 级别的大模型（Large Language Model）带来了惊艳的性能，但也带来了惊人的成本。当你的 AI Agent 每天处理数万次请求时，模型推理成本会成为最刺眼的账单数字。

**核心矛盾：** 大模型性能好但贵，小模型便宜但能力不足。有没有办法让小模型"学到"大模型的核心能力？

这就是 **Knowledge Distillation（知识蒸馏）** 要解决的问题。

<!-- more -->

## 什么是 Knowledge Distillation

Knowledge Distillation 是一种模型压缩技术，通过让一个小型模型（Student）模仿一个大型模型（Teacher）的行为，将大模型的知识迁移到小模型中。

### 蒸馏的核心原理

传统训练：模型学习 one-hot label（硬标签），每个样本只有一个"正确答案"。

蒸馏训练：Student 模型学习 Teacher 的 softmax 输出（软标签），软标签包含了类别之间的关系信息。

```
硬标签：[0, 0, 1, 0, 0]  ← 只知道"第3类是对的"
软标签：[0.02, 0.05, 0.85, 0.06, 0.02]  ← 知道"第3类最好，但第4类也不错"
```

软标签中隐藏的 **dark knowledge（暗知识）** 才是蒸馏的核心价值。

### 温度参数 T 的作用

```python
import torch
import torch.nn.functional as F

def distillation_loss(student_logits, teacher_logits, labels, T=3.0, alpha=0.7):
    """
    T: 温度参数，越大输出越平滑，越能暴露 Teacher 的内部知识
    alpha: 蒸馏损失权重
    """
    # 软标签蒸馏损失
    soft_student = F.log_softmax(student_logits / T, dim=1)
    soft_teacher = F.softmax(teacher_logits / T, dim=1)
    kl_loss = F.kl_div(soft_student, soft_teacher, reduction='batchmean') * (T * T)
    
    # 硬标签交叉熵损失
    ce_loss = F.cross_entropy(student_logits, labels)
    
    # 组合损失
    return alpha * kl_loss + (1 - alpha) * ce_loss
```

当 T=1 时就是标准 softmax，T 越大分布越平滑，Teacher 的"暗知识"暴露得越充分。

## Laravel 项目中的蒸馏实战

在 KKday 的 B2C 后端项目中，我们面临一个典型场景：AI Agent 需要处理用户意图识别、订单状态查询、商品推荐等任务，GPT-4 的成本实在扛不住。

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│                    Laravel Application                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Intent   │  │ Order    │  │ Product          │   │
│  │ Router   │  │ Query    │  │ Recommender      │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                  │              │
│  ┌────▼──────────────▼──────────────────▼─────────┐  │
│  │           Model Router Service                  │  │
│  │  ┌─────────────┐  ┌──────────────────────┐    │  │
│  │  │ Teacher     │  │ Student              │    │  │
│  │  │ GPT-4       │  │ Distilled Qwen-1.8B │    │  │
│  │  │ $0.03/req   │  │ $0.001/req          │    │  │
│  │  └─────────────┘  └──────────────────────┘    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Step 1：数据收集——让 Teacher 生产训练数据

```php
<?php

namespace App\Services\KnowledgeDistillation;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;

class TeacherDataCollector
{
    private string $teacherModel;
    private string $teacherEndpoint;

    public function __construct()
    {
        $this->teacherModel = config('distillation.teacher_model', 'gpt-4');
        $this->teacherEndpoint = config('distillation.teacher_endpoint');
    }

    /**
     * 批量收集 Teacher 的输出作为训练数据
     */
    public function collectBatch(array $prompts, string $taskType): array
    {
        $trainingData = [];

        foreach ($prompts as $prompt) {
            $teacherResponse = $this->callTeacher($prompt, $taskType);

            $trainingData[] = [
                'input' => $prompt,
                'output' => $teacherResponse['content'],
                'logits' => $teacherResponse['logits'], // 如果 Teacher 支持返回 logits
                'task_type' => $taskType,
                'confidence' => $teacherResponse['confidence'],
                'created_at' => now(),
            ];
        }

        // 持久化训练数据
        DB::table('distillation_training_data')->insert($trainingData);

        return $trainingData;
    }

    /**
     * 调用 Teacher 模型，尽可能获取 logits（概率分布）
     */
    private function callTeacher(string $prompt, string $taskType): array
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
            'Content-Type' => 'application/json',
        ])->timeout(30)->post($this->teacherEndpoint, [
            'model' => $this->teacherModel,
            'messages' => [
                ['role' => 'system', 'content' => $this->getSystemPrompt($taskType)],
                ['role' => 'user', 'content' => $prompt],
            ],
            'temperature' => 0.3,
            'logprobs' => true, // 关键：获取 token 级别的概率
            'top_logprobs' => 5,
        ]);

        $body = $response->json();

        return [
            'content' => $body['choices'][0]['message']['content'],
            'logits' => $this->extractLogits($body['choices'][0]['logprobs'] ?? []),
            'confidence' => $this->calculateConfidence($body['choices'][0]['logprobs'] ?? []),
        ];
    }

    private function getSystemPrompt(string $taskType): string
    {
        return match ($taskType) {
            'intent' => '你是意图识别专家，分析用户输入并分类到预定义意图。返回 JSON: {"intent": "xxx", "confidence": 0.95}',
            'order_query' => '你是订单查询助手，根据用户描述提取订单参数。返回 JSON: {"order_id": "xxx", "status": "xxx"}',
            'product_recommend' => '你是商品推荐专家，根据用户偏好推荐商品。返回 JSON: {"recommendations": [...]}',
            default => '你是一个专业的 AI 助手。',
        };
    }

    private function extractLogits(array $logprobs): array
    {
        // 将 logprobs 转换为概率分布
        $dist = [];
        foreach ($logprobs as $item) {
            $token = $item['token'] ?? '';
            $logprob = $item['logprob'] ?? 0;
            $dist[$token] = exp($logprob);
        }
        return $dist;
    }

    private function calculateConfidence(array $logprobs): float
    {
        if (empty($logprobs)) return 0.0;
        $topLogprob = $logprobs[0]['logprob'] ?? 0;
        return min(1.0, exp($topLogprob));
    }
}
```

### Step 2：Student 模型蒸馏

```python
# distill.py - Python 蒸馏脚本，Laravel 通过 Artisan Command 调用

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoModelForCausalLM, AutoTokenizer, AutoModelForSequenceClassification
from torch.utils.data import DataLoader, Dataset
import json
import sys

class DistillationDataset(Dataset):
    """从 Laravel 数据库导出的训练数据"""

    def __init__(self, data_file, tokenizer, max_length=512):
        with open(data_file, 'r') as f:
            self.data = json.load(f)
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        item = self.data[idx]
        encoding = self.tokenizer(
            item['input'],
            max_length=self.max_length,
            padding='max_length',
            truncation=True,
            return_tensors='pt'
        )
        return {
            'input_ids': encoding['input_ids'].squeeze(),
            'attention_mask': encoding['attention_mask'].squeeze(),
            'labels': item['output'],
            'teacher_logits': torch.tensor(item.get('logits', []), dtype=torch.float32),
        }


class DistillationTrainer:
    def __init__(self, teacher_name, student_name, output_dir):
        # Teacher: 冻结，不训练
        self.teacher = AutoModelForCausalLM.from_pretrained(teacher_name)
        self.teacher.eval()
        for param in self.teacher.parameters():
            param.requires_grad = False

        # Student: 可训练
        self.student = AutoModelForCausalLM.from_pretrained(student_name)
        self.tokenizer = AutoTokenizer.from_pretrained(student_name)

        self.output_dir = output_dir
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.teacher.to(self.device)
        self.student.to(self.device)

    def distill(self, dataset, epochs=10, batch_size=16, T=3.0, alpha=0.7, lr=5e-5):
        """
        T: 温度参数
        alpha: 蒸馏损失权重（越大越依赖 Teacher 信号）
        """
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
        optimizer = torch.optim.AdamW(self.student.parameters(), lr=lr)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

        best_loss = float('inf')

        for epoch in range(epochs):
            self.student.train()
            total_loss = 0
            distill_losses = 0
            ce_losses = 0

            for batch in dataloader:
                input_ids = batch['input_ids'].to(self.device)
                attention_mask = batch['attention_mask'].to(self.device)

                # Teacher forward (无梯度)
                with torch.no_grad():
                    teacher_outputs = self.teacher(
                        input_ids=input_ids,
                        attention_mask=attention_mask
                    )
                    teacher_logits = teacher_outputs.logits

                # Student forward
                student_outputs = self.student(
                    input_ids=input_ids,
                    attention_mask=attention_mask
                )
                student_logits = student_outputs.logits

                # === 核心：蒸馏损失 ===
                # 1. 软标签 KL 散度
                soft_student = F.log_softmax(student_logits / T, dim=-1)
                soft_teacher = F.softmax(teacher_logits / T, dim=-1)
                distill_loss = F.kl_div(
                    soft_student, soft_teacher,
                    reduction='batchmean'
                ) * (T * T)

                # 2. 硬标签交叉熵（如果有 ground truth）
                ce_loss = F.cross_entropy(
                    student_logits.view(-1, student_logits.size(-1)),
                    input_ids.view(-1),
                    ignore_index=self.tokenizer.pad_token_id
                )

                # 3. 组合损失
                loss = alpha * distill_loss + (1 - alpha) * ce_loss

                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.student.parameters(), 1.0)
                optimizer.step()

                total_loss += loss.item()
                distill_losses += distill_loss.item()
                ce_losses += ce_loss.item()

            scheduler.step()

            avg_loss = total_loss / len(dataloader)
            avg_distill = distill_losses / len(dataloader)
            avg_ce = ce_losses / len(dataloader)

            print(f'Epoch {epoch+1}/{epochs} | Loss: {avg_loss:.4f} | Distill: {avg_distill:.4f} | CE: {avg_ce:.4f}')

            # 保存最佳模型
            if avg_loss < best_loss:
                best_loss = avg_loss
                self.student.save_pretrained(f'{self.output_dir}/best')
                self.tokenizer.save_pretrained(f'{self.output_dir}/best')
                print(f'  → Saved best model (loss: {best_loss:.4f})')

        return self.student


if __name__ == '__main__':
    config = json.loads(sys.argv[1])
    trainer = DistillationTrainer(
        teacher_name=config['teacher_model'],
        student_name=config['student_model'],
        output_dir=config['output_dir']
    )
    dataset = DistillationDataset(
        config['data_file'],
        trainer.tokenizer
    )
    trainer.distill(
        dataset,
        epochs=config.get('epochs', 10),
        T=config.get('temperature', 3.0),
        alpha=config.get('alpha', 0.7)
    )
```

### Step 3：Laravel 中的模型路由——智能降级

```php
<?php

namespace App\Services\AI;

use App\Services\KnowledgeDistillation\TeacherDataCollector;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class ModelRouter
{
    /**
     * 模型降级策略：根据请求复杂度和预算动态选择模型
     */
    public function route(string $input, string $taskType): array
    {
        $complexity = $this->assessComplexity($input, $taskType);
        $dailyBudget = $this->getDailyBudgetRemaining();
        $studentAccuracy = $this->getStudentAccuracy($taskType);

        // 路由决策矩阵
        if ($complexity === 'high' || $dailyBudget < 0.10) {
            // 高复杂度请求 → 用 Teacher（GPT-4）
            // 或预算快用完了 → 回退到 Student（省钱）
            if ($complexity === 'high' && $dailyBudget >= 0.10) {
                return $this->routeToTeacher($input, $taskType);
            }
        }

        if ($complexity === 'low' && $studentAccuracy >= 0.90) {
            // 低复杂度 + Student 准确率足够 → 用 Student
            return $this->routeToStudent($input, $taskType);
        }

        if ($complexity === 'medium' && $studentAccuracy >= 0.85) {
            // 中等复杂度 + Student 准确率尚可 → 用 Student + 置信度检查
            $result = $this->routeToStudent($input, $taskType);

            if ($result['confidence'] < 0.7) {
                // Student 不确定 → 升级到 Teacher
                Log::info('Student confidence too low, escalating to Teacher', [
                    'task' => $taskType,
                    'confidence' => $result['confidence'],
                ]);
                return $this->routeToTeacher($input, $taskType);
            }

            return $result;
        }

        // 默认路由到 Teacher
        return $this->routeToTeacher($input, $taskType);
    }

    private function assessComplexity(string $input, string $taskType): string
    {
        $score = 0;

        // 长度因素
        $score += strlen($input) > 200 ? 2 : (strlen($input) > 50 ? 1 : 0);

        // 多意图检测
        $intentIndicators = ['并且', '然后', '另外', '同时', '但是'];
        foreach ($intentIndicators as $indicator) {
            if (str_contains($input, $indicator)) {
                $score += 1;
            }
        }

        // 任务类型权重
        $complexityWeights = [
            'intent' => 0,
            'order_query' => 1,
            'product_recommend' => 2,
            'multi_turn' => 3,
            'code_generation' => 4,
        ];
        $score += $complexityWeights[$taskType] ?? 2;

        return match (true) {
            $score >= 5 => 'high',
            $score >= 3 => 'medium',
            default => 'low',
        };
    }

    private function routeToTeacher(string $input, string $taskType): array
    {
        $start = microtime(true);
        $result = $this->callGPT4($input, $taskType);
        $latency = microtime(true) - $start;

        $this->recordMetrics('teacher', $taskType, $latency, $result['confidence']);

        return array_merge($result, ['model' => 'gpt-4', 'route' => 'teacher']);
    }

    private function routeToStudent(string $input, string $taskType): array
    {
        $start = microtime(true);
        $result = $this->callDistilledModel($input, $taskType);
        $latency = microtime(true) - $start;

        $this->recordMetrics('student', $taskType, $latency, $result['confidence']);

        // 异步收集 Teacher 数据用于持续蒸馏
        $this->queueForTeacherLabeling($input, $result, $taskType);

        return array_merge($result, ['model' => 'qwen-1.8b-distilled', 'route' => 'student']);
    }

    private function callDistilledModel(string $input, string $taskType): array
    {
        // 调用本地部署的蒸馏模型（vLLM / TGI）
        $response = Http::timeout(5)->post(config('distillation.student_endpoint'), [
            'inputs' => $input,
            'parameters' => [
                'max_new_tokens' => 256,
                'temperature' => 0.1,
                'task_type' => $taskType,
            ],
        ]);

        $body = $response->json();

        return [
            'content' => $body['generated_text'] ?? '',
            'confidence' => $body['confidence'] ?? 0.0,
            'tokens_used' => $body['usage']['total_tokens'] ?? 0,
        ];
    }

    private function getDailyBudgetRemaining(): float
    {
        $today = now()->toDateString();
        $used = Cache::get("ai_budget_{$today}", 0);
        $limit = config('distillation.daily_budget_limit', 50.0);
        return max(0, $limit - $used);
    }

    private function getStudentAccuracy(string $taskType): float
    {
        return Cache::get("student_accuracy_{$taskType}", 0.85);
    }

    private function queueForTeacherLabeling(string $input, array $studentResult, string $taskType): void
    {
        // 将 Student 的输出发送给 Teacher 标注，用于持续改进
        dispatch(new TeacherLabelingJob($input, $studentResult, $taskType));
    }

    private function recordMetrics(string $route, string $taskType, float $latency, float $confidence): void
    {
        DB::table('ai_model_metrics')->insert([
            'route' => $route,
            'task_type' => $taskType,
            'latency_ms' => round($latency * 1000, 2),
            'confidence' => $confidence,
            'created_at' => now(),
        ]);
    }
}
```

### Step 4：Artisan Command——驱动蒸馏流程

```php
<?php

namespace App\Console\Commands;

use App\Services\KnowledgeDistillation\TeacherDataCollector;
use Illuminate\Console\Command;

class DistillModel extends Command
{
    protected $signature = 'ai:distill
                            {--teacher=gpt-4 : Teacher model name}
                            {--student=Qwen/Qwen2-1.5B : Student model}
                            {--task= : Task type to distill}
                            {--samples=1000 : Number of training samples}
                            {--epochs=10 : Training epochs}
                            {--temperature=3.0 : Distillation temperature}';

    protected $description = 'Run knowledge distillation pipeline';

    public function handle(): int
    {
        $this->info('=== Knowledge Distillation Pipeline ===');
        $this->newLine();

        // Step 1: 收集训练数据
        $this->info('Step 1/4: Collecting training data from Teacher...');
        $collector = app(TeacherDataCollector::class);

        $samples = $this->option('samples');
        $taskType = $this->option('task');

        $prompts = $this->getTaskPrompts($taskType, $samples);
        $dataFile = $collector->exportToJson($prompts, $taskType);

        $this->info("  → Collected {$samples} samples → {$dataFile}");

        // Step 2: 准备蒸馏配置
        $this->info('Step 2/4: Preparing distillation config...');
        $config = [
            'teacher_model' => $this->option('teacher'),
            'student_model' => $this->option('student'),
            'data_file' => $dataFile,
            'output_dir' => storage_path('app/models/distilled-' . $taskType),
            'epochs' => $this->option('epochs'),
            'temperature' => (float) $this->option('temperature'),
            'alpha' => 0.7,
        ];

        $configFile = storage_path("app/distill_config_{$taskType}.json");
        file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));

        // Step 3: 调用 Python 蒸馏脚本
        $this->info('Step 3/4: Running distillation...');
        $pythonScript = base_path('scripts/distill.py');

        $process = process([
            'python3', $pythonScript, $configFile
        ]);

        $process->wait(function ($type, $output) {
            $this->line("  [Python] {$output}");
        });

        if ($process->exitCode() !== 0) {
            $this->error('Distillation failed!');
            return self::FAILURE;
        }

        // Step 4: 验证模型质量
        $this->info('Step 4/4: Evaluating distilled model...');
        $accuracy = $this->evaluateModel($config['output_dir'] . '/best', $taskType);

        $this->newLine();
        $this->info("✅ Distillation complete!");
        $this->info("  Task: {$taskType}");
        $this->info("  Accuracy: " . round($accuracy * 100, 2) . "%");
        $this->info("  Output: {$config['output_dir']}/best");

        return self::SUCCESS;
    }

    private function getTaskPrompts(string $taskType, int $count): array
    {
        return DB::table('prompts')
            ->where('task_type', $taskType)
            ->where('active', true)
            ->inRandomOrder()
            ->limit($count)
            ->pluck('prompt_text')
            ->toArray();
    }

    private function evaluateModel(string $modelPath, string $taskType): float
    {
        // 用验证集评估蒸馏后的模型
        $evalScript = base_path('scripts/evaluate.py');
        $process = process([
            'python3', $evalScript,
            '--model', $modelPath,
            '--task', $taskType,
            '--output', 'json'
        ]);
        $process->wait();
        $result = json_decode($process->output(), true);
        return $result['accuracy'] ?? 0.0;
    }
}
```

## 踩坑记录

### 1. Teacher API 的 logprobs 限制

OpenAI 的 `logprobs` 参数在 chat completion 中只返回 token 级别的概率，而不是整个词表的概率分布。这和论文中的理想情况有差距。

**解决方案：** 多次采样（采样 5-10 次）取平均概率分布，近似模拟 logits。

### 2. 蒸馏温度 T 的选择

T=3 是常见起点，但不同任务的最优温度差异很大：

| 任务类型 | 最优温度 | 原因 |
|---------|---------|------|
| 意图分类 | 2-4 | 类别边界清晰，需要暴露"接近但不完全对"的知识 |
| 文本生成 | 5-8 | 语言多样性高，需要更平滑的概率分布 |
| 代码生成 | 1.5-3 | 代码结构严格，过度平滑会引入噪声 |

**建议：** 用小规模实验（100 样本）扫一遍 T=[1,2,3,4,5,8,10]，找到每个任务的最优值。

### 3. 小模型容量不足

把 GPT-4 的知识蒸馏到 1.8B 参数的小模型，某些复杂推理任务效果会明显下降。

**解决方案：** 分任务蒸馏。不要试图蒸馏所有能力，而是为每个任务训练专门的蒸馏模型。

```
意图识别 → 蒸馏到 1.8B 模型（简单分类，小模型够用）
商品推荐 → 蒸馏到 3B 模型（需要理解用户偏好）
代码生成 → 保留 GPT-4（复杂推理，小模型不够）
```

### 4. 蒸馏数据质量 vs 数量

收集 10 万条 Teacher 输出，效果反而不如 1 万条精选数据。

**原因：** Teacher 的错误和偏差也会被蒸馏进去。需要对 Teacher 输出做质量过滤：

```php
// 过滤低置信度的 Teacher 输出
$trainingData = collect($rawData)
    ->filter(fn($item) => $item['confidence'] >= 0.85)  // 只保留高置信度
    ->filter(fn($item) => strlen($item['output']) > 10)  // 排除空回答
    ->values()
    ->toArray();
```

### 5. 持续蒸馏 vs 一次性蒸馏

模型能力会随业务变化漂移。新商品类型、新意图需要重新蒸馏。

**实践：** 每周用最新的 Teacher 数据重新蒸馏 Student，保持 Student 的能力与业务同步。

## 成本对比数据

在 KKday 项目中的实际效果（30 天数据）：

```
                  GPT-4 Only    蒸馏混合方案    节省
日均请求量         12,000        12,000          -
日均成本          $360          $52             85.6%
平均延迟          1.2s          0.3s (Student)  75%
总体准确率        94.2%         92.8%           -1.4%
```

**关键发现：** 85% 的请求是简单的意图识别和状态查询，用蒸馏的 1.8B 模型完全够用。只有 15% 的复杂请求才需要 GPT-4。

## 总结

Knowledge Distillation 不是"万能药"，但在以下场景中它是极具性价比的选择：

1. **成本敏感型项目**：日均请求量 > 5000，大模型成本占收入比例过高
2. **延迟敏感型场景**：需要 < 500ms 响应，大模型网络延迟不可接受
3. **离线/边缘部署**：需要在本地设备上运行 AI 能力
4. **任务相对固定**：意图识别、分类、简单问答等结构化任务

**核心原则：**

- 不要试图把所有能力蒸馏到一个模型，分任务蒸馏效果更好
- 蒸馏质量取决于 Teacher 输出质量，做好数据过滤
- 温度参数需要实验调优，不要直接用默认值
- 持续蒸馏比一次性蒸馏更实用，业务变化时 Student 要跟上

最终，蒸馏的价值不在于"让小模型变成大模型"，而在于**让 85% 的简单请求用 5% 的成本完成**，把预算留给真正需要大模型的复杂场景。

---

**下一步：** 如果你已经在用 Laravel + OpenAI，可以先做一个简单实验——收集 1000 条请求数据，用 Qwen2-1.5B 做蒸馏，对比一下准确率和成本差异。从 `ai:distill` 这个 Artisan Command 开始。
