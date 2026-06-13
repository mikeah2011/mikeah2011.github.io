---

title: OpenClaw 自改进 Agent 循环：.learnings/ 结构化日志 → AGENTS.md 提升 → 技能提取
keywords: [OpenClaw, Agent, learnings, AGENTS.md, 自改进, 循环, 结构化日志, 提升, 技能提取]
date: 2026-06-02 08:00:00
tags:
- OpenClaw
- AI Agent
- 自改进
- 元学习
- 技能提取
categories:
- ai
description: 深度剖析 OpenClaw 自改进 Agent 循环的三大核心组件：.learnings/ 结构化日志系统记录交互中的发现与教训，AGENTS.md 提升机制将具体经验提炼为通用规范，技能提取流程从重复模式中发现可复用技能。涵盖元认知理论基础与学术研究对比（Reflexion、Self-Refine、Voyager），详解学习触发条件、提炼算法、技能提取门槛，附完整的 Laravel N+1 优化案例全流程演示。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



# OpenClaw 自改进 Agent 循环：.learnings/ 结构化日志 → AGENTS.md 提升 → 技能提取

## 1. 引言：让 Agent 学会「反思」

人类之所以能够不断进步，关键在于「反思」能力——从经验中学习，将教训转化为行动准则。一个优秀的工程师不会在同一个 Bug 上跌倒两次，因为他会把踩坑经验记录下来，形成自己的「最佳实践库」。

AI Agent 传统上缺乏这种能力。每次对话都是一次全新的开始，Agent 不会记住上次犯过的错误，也不会从成功经验中提炼模式。即使有记忆系统，也通常是简单的键值存储，缺乏结构化的「学习机制」。

OpenClaw 通过一个精心设计的自改进循环解决了这个问题：

```
日常交互 → .learnings/ 结构化日志 → AGENTS.md 规范提升 → 技能提取 → 更好的交互
```

这个循环让 Agent 从「执行者」进化为「学习者」，逐步积累经验，提升能力。

本文将深入剖析这个自改进循环的每个环节，包括设计原理、实现细节、以及实际应用案例。

<!-- more -->

## 2. 自改进 Agent 的理论基础

### 2.1 元认知与反思学习

元认知（Metacognition）是认知心理学中的一个概念，指「对认知的认知」——即个体对自己思维过程的觉察和调控。

在 AI Agent 领域，元认知表现为：

```
传统 Agent:  输入 → 处理 → 输出
元认知 Agent: 输入 → 处理 → 输出 → 反思 → 改进 → 下次更好的输出
```

OpenClaw 的自改进循环正是基于这种元认知理念设计的。

### 2.2 相关研究

自改进 Agent 是当前 AI 研究的热点方向。以下是几种代表性的方法：

**Reflexion（2023）**
- 让 Agent 在任务失败后生成自我反思
- 将反思结果作为下次尝试的额外上下文
- 优势：无需额外训练，纯推理方式
- 局限：反思质量依赖模型能力，容易产生错误的自我评估

**Self-Refine（2023）**
- Agent 先生成初始输出，然后自我批评，最后自我修正
- 多轮迭代直到满意
- 优势：简单有效
- 局限：计算成本高，可能陷入局部最优

**Voyager（2023）**
- 在 Minecraft 环境中持续学习
- 自动发现和组合技能
- 优势：技能可复用
- 局限：限于特定环境

OpenClaw 的方法综合了这些研究的优点，同时针对实际使用场景做了工程化改进。

### 2.3 OpenClaw 的差异化设计

与学术研究不同，OpenClaw 的自改进系统面向实际使用场景，因此有几个关键的差异化设计：

1. **持久化学习**：学习成果写入文件系统，跨会话持久
2. **结构化日志**：学习记录有统一的格式，便于检索和应用
3. **人机协作**：用户可以审查和修改学习成果
4. **渐进式改进**：不追求一步到位，而是逐步积累

## 3. .learnings/ 目录：结构化日志系统

### 3.1 目录结构

```
~/.openclaw/.learnings/
├── 2026-05-01/
│   ├── laravel-eloquent-n+1.md
│   ├── redis-pipeline-performance.md
│   └── docker-multi-stage-build.md
├── 2026-05-02/
│   ├── k8s-pod-oom-debugging.md
│   └── mysql-slow-query-optimization.md
├── 2026-06-01/
│   ├── ai-agent-security-model.md
│   └── hermes-profile-system.md
├── index.md                    # 索引文件
└── stats.md                    # 统计信息
```

### 3.2 单个 Learning 的格式

每个 learning 文件遵循统一的结构化格式：

```markdown
# [简短标题]

## 元数据
- 日期: 2026-06-01
- 类型: bug_fix | optimization | best_practice | architecture | tool_usage
- 领域: laravel | redis | mysql | docker | k8s | ai_agent
- 重要性: high | medium | low
- 状态: pending | reviewed | integrated

## 背景
当时在做什么任务？遇到了什么问题？

## 发现
学到了什么？问题的根本原因是什么？

## 解决方案
如何解决的？具体的步骤和代码。

## 通用规则
从这个经验中可以提炼出什么通用规则？

## 关联
- 相关文件: [路径]
- 相关学习: [链接]
```

### 3.3 何时记录 Learnings

OpenClaw 定义了明确的「学习触发条件」：

```python
LEARNING_TRIGGERS = [
    # 1. 错误与修复
    {
        "condition": "agent_made_mistake_and_fixed",
        "description": "Agent 犯了错误，然后找到了正确的解决方案",
        "type": "bug_fix"
    },
    
    # 2. 用户纠正
    {
        "condition": "user_corrected_agent",
        "description": "用户纠正了 Agent 的行为或输出",
        "type": "best_practice"
    },
    
    # 3. 新发现
    {
        "condition": "discovered_new_approach",
        "description": "发现了一种更好的解决方案或工具用法",
        "type": "optimization"
    },
    
    # 4. 重复模式
    {
        "condition": "repeated_pattern_detected",
        "description": "同一类问题出现了多次，可以提炼为通用规则",
        "type": "best_practice"
    },
    
    # 5. 架构决策
    {
        "condition": "significant_architecture_decision",
        "description": "做出了重要的架构或设计决策",
        "type": "architecture"
    }
]
```

### 3.4 Learning 记录的示例

```markdown
# Laravel Eloquent N+1 查询优化

## 元数据
- 日期: 2026-06-01
- 类型: optimization
- 领域: laravel, mysql
- 重要性: high
- 状态: integrated

## 背景
在审查 B2C API 的订单列表接口时，发现每次请求会产生 200+ 条 SQL 查询。
EXPLAIN 分析显示主要瓶颈是 N+1 查询问题。

## 发现
问题出在 Order 模型的关联加载方式上：
- Order → User（N+1）
- Order → OrderItems → Product（N×M+1）
- Order → Payment（N+1）

## 解决方案
使用 eager loading 一次性加载所有关联：

```php
$orders = Order::with(['user', 'orderItems.product', 'payment'])
    ->where('status', 'completed')
    ->paginate(20);
```

优化效果：SQL 查询从 200+ 降到 4 条，响应时间从 2.3s 降到 0.15s。

## 通用规则
- 列表接口必须使用 eager loading
- 使用 Laravel Debugbar 检查 N+1 问题
- 复杂关联使用 with() 而非 lazy loading
- 考虑使用 withCount() 替代关联计数

## 关联
- 相关代码: app/Http/Controllers/OrderController.php
- 相关学习: [MySQL 索引优化](./2026-05-02/mysql-index-optimization.md)
```

### 3.5 索引与检索

.learnings/ 目录维护一个索引文件，便于快速检索：

```markdown
# Learnings 索引

## 按类型
### Bug Fix
- [Laravel Eloquent N+1 查询优化](./2026-06-01/laravel-eloquent-n+1.md)
- [Redis 缓存击穿防护](./2026-05-15/redis-cache-breakdown.md)

### Optimization
- [Redis Pipeline 批量命令优化](./2026-06-01/redis-pipeline-performance.md)
- [Docker 多阶段构建瘦身](./2026-05-20/docker-multi-stage-build.md)

### Best Practice
- [Laravel Form Request 验证规范](./2026-05-10/laravel-form-request.md)
- [Git Commit Message 规范](./2026-05-05/git-commit-message.md)

## 按领域
### Laravel
- [Laravel Eloquent N+1 查询优化](./2026-06-01/laravel-eloquent-n+1.md)
- [Laravel Form Request 验证规范](./2026-05-10/laravel-form-request.md)

### Redis
- [Redis Pipeline 批量命令优化](./2026-06-01/redis-pipeline-performance.md)
- [Redis 缓存击穿防护](./2026-05-15/redis-cache-breakdown.md)

## 统计
- 总计: 42 条
- 本月新增: 8 条
- 已集成到 AGENTS.md: 15 条
```

## 4. AGENTS.md 提升机制

### 4.1 从 Learnings 到规范的提炼

.learnings/ 记录的是具体的经验，而 AGENTS.md 记录的是通用的规范。两者之间的桥梁是「提炼」过程：

```
具体经验 (Learning)
  ↓ 分析
模式识别 (Pattern Recognition)
  ↓ 抽象
通用规则 (General Rule)
  ↓ 写入
规范更新 (AGENTS.md Update)
```

### 4.2 提炼算法

```python
def refine_learnings_to_agents(learnings: List[Learning]) -> List[Rule]:
    """从 learnings 中提炼通用规则"""
    rules = []
    
    # 1. 按领域分组
    grouped = group_by_domain(learnings)
    
    # 2. 在每个领域内识别模式
    for domain, domain_learnings in grouped.items():
        patterns = find_patterns(domain_learnings)
        
        # 3. 将模式转化为规则
        for pattern in patterns:
            if pattern.frequency >= 2:  # 至少出现 2 次
                rule = Rule(
                    domain=domain,
                    description=pattern.description,
                    examples=pattern.examples,
                    confidence=pattern.frequency / len(domain_learnings)
                )
                rules.append(rule)
    
    # 4. 按置信度排序
    rules.sort(key=lambda r: r.confidence, reverse=True)
    
    return rules
```

### 4.3 AGENTS.md 的更新策略

AGENTS.md 的更新不是简单的追加，而是需要考虑：

1. **去重**：新规则不能与现有规则冲突
2. **优先级**：高置信度的规则优先
3. **可读性**：规则应该清晰、简洁、可执行
4. **可追溯**：每条规则应该关联到原始 learnings

```python
def update_agents_md(new_rules: List[Rule]):
    """更新 AGENTS.md"""
    agents_md = read_file("~/.openclaw/AGENTS.md")
    
    for rule in new_rules:
        # 检查是否与现有规则冲突
        conflict = find_conflict(agents_md, rule)
        
        if conflict:
            # 合并或替换
            agents_md = resolve_conflict(agents_md, conflict, rule)
        else:
            # 添加新规则
            section = find_or_create_section(agents_md, rule.domain)
            section.add_rule(rule)
    
    write_file("~/.openclaw/AGENTS.md", agents_md)
```

### 4.4 提炼示例

**输入：3 条相关的 Learnings**

```markdown
# Learning 1: Laravel Eloquent N+1 查询优化
- 发现: 列表接口必须使用 eager loading

# Learning 2: API 响应时间优化
- 发现: 数据库查询是主要瓶颈，N+1 是常见原因

# Learning 3: Laravel Debugbar 使用
- 发现: Debugbar 可以快速识别 N+1 问题
```

**输出：AGENTS.md 中的规则**

```markdown
## Laravel 开发规范

### 数据库查询优化
1. **列表接口必须使用 eager loading**
   - 使用 `with()` 预加载关联
   - 避免在循环中访问关联属性
   - 使用 Laravel Debugbar 检查查询数量
   
2. **复杂查询使用 query builder**
   - 当 Eloquent 无法高效表达时，使用 DB facade
   - 使用 `select()` 限制返回字段
   
3. **分页查询优化**
   - 使用 `simplePaginate()` 替代 `paginate()`（当不需要总数时）
   - 考虑使用 cursor 分页处理大数据集
```

## 5. 技能提取流程

### 5.1 什么是技能？

在 OpenClaw 的上下文中，「技能」是一个可复用的行为模式：

```
技能 = 触发条件 + 执行步骤 + 所需工具 + 输出格式
```

例如，「代码审查」技能：

```markdown
# 代码审查技能

## 触发条件
用户请求审查代码，或提交了新的代码变更。

## 执行步骤
1. 使用 terminal 执行 git diff 获取变更
2. 使用 file 读取变更文件的完整内容
3. 分析代码质量、安全性、性能
4. 生成结构化的审查报告

## 所需工具
- terminal: git 命令
- file: 读取文件
- search_files: 查找相关代码

## 输出格式
```markdown
## 代码审查报告

### 发现的问题
1. [严重] 问题描述
2. [建议] 改进建议

### 优点
- 做得好的地方

### 总体评分
- 代码质量: ⭐⭐⭐⭐
```
```

### 5.2 技能提取的触发条件

技能提取不是自动发生的，需要满足特定条件：

```python
SKILL_EXTRACTION_CONDITIONS = {
    "min_occurrences": 3,        # 至少出现 3 次类似模式
    "min_success_rate": 0.7,     # 成功率至少 70%
    "min_user_satisfaction": 0.8, # 用户满意度至少 80%
    "pattern_stability": 0.9,    # 模式稳定性至少 90%
}
```

### 5.3 技能提取算法

```python
def extract_skills(learnings: List[Learning]) -> List[Skill]:
    """从 learnings 中提取可复用技能"""
    skills = []
    
    # 1. 识别重复的任务模式
    task_patterns = identify_task_patterns(learnings)
    
    for pattern in task_patterns:
        # 2. 检查是否满足提取条件
        if not meets_extraction_conditions(pattern):
            continue
        
        # 3. 提取技能定义
        skill = Skill(
            name=generate_skill_name(pattern),
            trigger=extract_trigger(pattern),
            steps=extract_steps(pattern),
            tools=extract_tools(pattern),
            output_format=extract_output_format(pattern)
        )
        
        # 4. 验证技能
        if validate_skill(skill):
            skills.append(skill)
    
    return skills
```

### 5.4 技能存储

提取的技能存储在 AGENTS.md 的「技能声明」部分：

```markdown
# AGENTS.md

## 技能声明

### 代码审查技能
[技能定义]

### 日志分析技能
[技能定义]

### 数据库优化技能
[技能定义]
```

同时，技能也会被写入独立的文件，便于复用和分享：

```
~/.openclaw/skills/
├── code-review/
│   ├── SKILL.md
│   └── examples/
├── log-analysis/
│   ├── SKILL.md
│   └── examples/
└── db-optimization/
    ├── SKILL.md
    └── examples/
```

### 5.5 技能提取示例

**输入：多次代码审查的 learnings**

```markdown
# Learning 1: 2026-05-20
- 任务: 审查 PR #123
- 步骤: git diff → 读文件 → 分析 → 生成报告
- 工具: terminal, file
- 结果: 用户满意

# Learning 2: 2026-05-25
- 任务: 审查 PR #145
- 步骤: git diff → 读文件 → 分析 → 生成报告
- 工具: terminal, file
- 结果: 用户满意

# Learning 3: 2026-05-30
- 任务: 审查 PR #167
- 步骤: git diff → 读文件 → 分析 → 生成报告
- 工具: terminal, file
- 结果: 用户满意
```

**输出：提取的技能**

```markdown
### 代码审查技能
- 触发条件: 用户请求审查代码
- 执行步骤:
  1. 使用 terminal 获取 git diff
  2. 使用 file 读取变更文件
  3. 分析代码质量
  4. 生成结构化报告
- 所需工具: terminal, file
- 输出格式: 问题列表 + 改进建议 + 总体评分
```

## 6. 反馈闭环

### 6.1 闭环设计

自改进循环的关键在于「闭环」——改进的效果需要被验证，并反馈到下一轮改进中：

```
Learnings → AGENTS.md 更新 → 执行 → 结果评估 → 新的 Learnings
```

### 6.2 效果评估

```python
def evaluate_improvement(rule: Rule, before: Performance, after: Performance):
    """评估规则改进的效果"""
    improvement = {
        "metric": rule.metric,
        "before": before.value,
        "after": after.value,
        "improvement": (after.value - before.value) / before.value,
        "statistical_significance": calculate_significance(before, after)
    }
    
    # 更新规则的置信度
    if improvement["improvement"] > 0 and improvement["statistical_significance"] > 0.95:
        rule.confidence = min(rule.confidence * 1.1, 1.0)
        rule.status = "validated"
    elif improvement["improvement"] < 0:
        rule.confidence *= 0.8
        rule.status = "under_review"
    
    return improvement
```

### 6.3 规则的生命周期

每条规则都有一个生命周期：

```
Draft → Active → Validated → Deprecated
  ↑        ↓         ↓          ↓
  └────────┴─────────┴──────────┘
           (反馈循环)
```

- **Draft**：新提炼的规则，等待验证
- **Active**：正在使用的规则
- **Validated**：经过多次验证的有效规则
- **Deprecated**：不再适用的规则

### 6.4 规则的自动调整

基于反馈，规则会自动调整：

```python
def auto_adjust_rule(rule: Rule, feedback: List[Feedback]):
    """根据反馈自动调整规则"""
    
    # 计算成功率
    success_rate = sum(1 for f in feedback if f.success) / len(feedback)
    
    if success_rate < 0.5:
        # 成功率过低，标记为待审查
        rule.status = "under_review"
        rule.confidence *= 0.5
    
    elif success_rate > 0.9:
        # 成功率很高，提升置信度
        rule.confidence = min(rule.confidence * 1.2, 1.0)
        if rule.confidence > 0.95:
            rule.status = "validated"
    
    # 检查是否有更好的替代方案
    alternative = find_better_alternative(rule, feedback)
    if alternative:
        rule.alternative = alternative
        rule.note = f"建议考虑替代方案: {alternative.description}"
```

## 7. 与其他自改进方案的对比

| 特性 | OpenClaw | Reflexion | Self-Refine | Voyager |
|------|----------|-----------|-------------|---------|
| 持久化 | ✅ | ❌ | ❌ | ✅ |
| 结构化 | ✅ | 部分 | ❌ | ✅ |
| 人机协作 | ✅ | ❌ | ❌ | ❌ |
| 跨会话 | ✅ | ❌ | ❌ | ✅ |
| 技能提取 | ✅ | ❌ | ❌ | ✅ |
| 反馈闭环 | ✅ | 部分 | ✅ | ✅ |
| 通用性 | 高 | 高 | 高 | 低 |
| 计算成本 | 低 | 中 | 高 | 高 |

OpenClaw 的核心优势在于：
1. **工程化**：面向实际使用场景设计
2. **持久化**：学习成果跨会话持久
3. **可协作**：用户可以参与审查和修改

## 8. 实际案例：一个完整的自改进循环

### 8.1 阶段一：初次交互

```
用户: 帮我优化这个 Laravel API 的性能
Agent: [执行优化，但使用了 eager loading 的错误语法]
Agent: 报错：Undefined property: Illuminate\Database\Eloquent\Builder::$users
```

### 8.2 阶段二：记录 Learning

```markdown
# Laravel Eager Loading 语法错误

## 元数据
- 日期: 2026-06-01
- 类型: bug_fix
- 领域: laravel, eloquent

## 背景
优化订单列表 API 时，尝试使用 eager loading。

## 发现
错误写法: `Order::with('user.addresses')->...`
正确写法: `Order::with(['user' => function($q) { $q->with('addresses'); }])->...`

或者使用嵌套 eager loading:
`Order::with('user.addresses')->...`

## 通用规则
- 嵌套关联使用 dot notation: `with('user.addresses')`
- 条件加载使用闭包: `with(['user' => fn($q) => $q->where(...)])`
```

### 8.3 阶段三：更新 AGENTS.md

```markdown
## Laravel 开发规范

### Eager Loading 规范
1. 嵌套关联使用 dot notation
   ```php
   // 正确
   Order::with('user.addresses', 'orderItems.product')
   
   // 错误
   Order::with('user', 'addresses')  // addresses 不是 Order 的直接关联
   ```

2. 条件加载使用闭包
   ```php
   Order::with(['user' => function ($query) {
       $query->where('active', true)->with('addresses');
   }])
   ```
```

### 8.4 阶段四：技能提取

经过多次类似的优化任务后，提取「API 性能优化」技能：

```markdown
### API 性能优化技能
- 触发条件: 用户请求优化 API 性能
- 执行步骤:
  1. 使用 terminal 获取当前 SQL 查询: php artisan debugbar:enable
  2. 使用 file 读取 Controller 和 Model 代码
  3. 识别 N+1 查询、缺失索引、大字段等问题
  4. 应用优化: eager loading、索引、缓存、分页
  5. 验证效果: 对比优化前后的查询数量和响应时间
- 所需工具: terminal, file
- 输出格式: 优化前后对比 + 具体代码变更 + 性能数据
```

### 8.5 阶段五：效果验证

下次遇到类似的 API 优化任务时，Agent 会：

1. 自动应用「API 性能优化」技能
2. 使用正确的 eager loading 语法
3. 提供更结构化的优化报告

这就是完整的自改进循环。

## 9. 局限性与未来方向

### 9.1 当前局限

1. **提炼质量依赖模型**：规则的提炼质量取决于底层 LLM 的能力
2. **规则冲突**：多条规则可能互相矛盾
3. **过度泛化**：从少量案例中可能提炼出过于宽泛的规则
4. **遗忘问题**：旧规则可能不再适用，但未被及时清理

### 9.2 未来方向

1. **自动冲突检测**：使用 LLM 自动检测和解决规则冲突
2. **规则优先级学习**：从用户反馈中学习规则的优先级
3. **跨域知识迁移**：将一个领域的规则迁移到相关领域
4. **协作学习**：多个 Agent 之间共享学习成果
5. **形式化验证**：使用形式化方法验证规则的正确性

## 10. 总结

OpenClaw 的自改进 Agent 循环通过三个核心组件构建了一个完整的学习系统：

1. **.learnings/ 结构化日志**：记录每次交互中的发现和教训
2. **AGENTS.md 提升机制**：将具体经验提炼为通用规范
3. **技能提取流程**：从重复模式中发现可复用的技能

这个循环让 Agent 从「执行者」进化为「学习者」，逐步积累经验，提升能力。虽然当前实现还有局限，但它为 AI Agent 的自改进提供了一个实用的工程化方案。

随着 LLM 能力的提升和更多实践的积累，自改进 Agent 循环将变得更加智能和可靠，最终实现真正的「终身学习」AI 助手。

## 相关阅读

- [OpenClaw 文件原生心智架构：SOUL.md/IDENTITY.md/USER.md/AGENTS.md 的协作机制](/categories/AI%20Agent/openclaw-file-native-mental-architecture-soul-identity-user-agents/)
- [OpenClaw Bootstrap 协议：首次运行身份共创与状态清理的设计模式](/categories/AI%20Agent/openclaw-bootstrap-protocol-first-run-identity-co-creation-state-cleanup/)
- [OpenClaw 技能开发实战：自定义 Skill 与工作流自动化](/categories/AI%20Agent/openclaw-skill-development-custom-skill-workflow-automation/)

---

*本文基于 OpenClaw 框架的自改进机制设计分析撰写。自改进循环是 OpenClaw 最具创新性的特性之一，也是 AI Agent 从「工具」走向「助手」的关键路径。*
