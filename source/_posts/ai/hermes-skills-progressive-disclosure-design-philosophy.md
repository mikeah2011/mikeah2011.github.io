---
title: Hermes Skills 渐进式披露机制：skills_list 元数据 vs skill_view 完整加载的设计哲学
date: 2026-06-02 14:00:00
tags: [Hermes, AI Agent, Skills, 渐进式披露, 架构设计, 上下文管理]
keywords: [Hermes Skills, skills, list, vs skill, view, 渐进式披露机制, 元数据, 完整加载的设计哲学, AI]
categories: [ai]
description: AI Agent 技能越多上下文越爆？Hermes Agent 用"渐进式披露"两级加载架构破解能力悖论：skills_list 提供轻量级技能目录（~200 tokens），skill_view 按需加载完整说明（~2000 tokens），实现 93%+ Token 节省的同时保持高准确率的技能选择。本文从设计哲学、源码实现、缓存策略到 Agent 决策流程全面拆解这一机制，适合所有关注 AI Agent 上下文管理与架构优化的开发者。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---


# Hermes Skills 渐进式披露机制：skills_list 元数据 vs skill_view 完整加载的设计哲学

> Hermes Agent 的 Skill 系统采用了"渐进式披露"的设计哲学：先通过 skills_list 展示所有可用技能的轻量级元数据，再按需通过 skill_view 加载完整内容。这个看似简单的两级加载机制，解决了 AI Agent 领域一个根本性的矛盾——能力越多越好 vs 上下文窗口有限。

## 前言

随着 AI Agent 的能力不断增强，一个 Agent 可能拥有几十甚至上百个技能（Skills）。每个技能包含详细的使用说明、示例代码、注意事项等内容，动辄几千 tokens。如果把所有技能的完整内容都塞进上下文窗口，很快就会超出 token 限制。

但如果不告诉 Agent 它有哪些技能，Agent 又无法自主选择合适的能力来完成任务。

这就是 AI Agent 领域的"能力悖论"：**能力越多越好，但每多一个能力，上下文负担就重一分。**

Hermes Agent 通过渐进式披露机制优雅地解决了这个问题：Agent 先看到所有技能的"目录"（skills_list），然后根据任务需要选择性地加载"详情页"（skill_view）。这就像操作系统的文件列表——你先看到文件名和大小，双击才打开文件内容。

## 一、渐进式披露的设计哲学

### 1.1 什么是渐进式披露

渐进式披露（Progressive Disclosure）是交互设计中的经典原则，最早由 Jakob Nielsen 提出：

> **不要一次性展示所有信息。先展示最核心的内容，在用户需要时再逐步展示更多细节。**

这个原则在 UI 设计中随处可见：

- macOS 的"显示更多选项"按钮
- IDE 的代码折叠
- 电商网站的商品列表 → 商品详情

Hermes 将这个原则引入了 AI Agent 的技能管理：

```
Level 0: Agent 知道"我有技能系统"              → ~0 tokens
Level 1: Agent 看到所有技能的名称和描述          → ~200 tokens
Level 2: Agent 加载某个技能的完整使用说明        → ~2000 tokens
Level 3: Agent 执行技能并获取实时结果            → 动态
```

### 1.2 为什么不直接加载所有技能

让我们算一笔账。假设一个 Hermes Agent 有 30 个技能，每个技能平均 1500 tokens：

```
全部加载: 30 × 1500 = 45,000 tokens
```

45,000 tokens 的 system prompt 意味着：
- **成本**：每次对话多花 $0.135（按 Claude 3.5 Sonnet 计算）
- **延迟**：首 token 延迟增加约 2-3 秒
- **注意力稀释**：LLM 的注意力机制对长上下文的末尾部分关注度下降
- **缓存失效**：技能一变化，整个 prompt 都要重新计算

而渐进式披露方案：

```
Level 1 (目录): 30 × 30 tokens = 900 tokens
Level 2 (按需): 平均 1-2 个技能 × 1500 tokens = 1500-3000 tokens

总消耗: 2400-3900 tokens (节省 91-95%)
```

### 1.3 核心权衡

渐进式披露不是没有代价的：

| 维度 | 全部加载 | 渐进式披露 |
|------|---------|-----------|
| Token 消耗 | 高（45K） | 低（2.4-3.9K） |
| 首次响应延迟 | 高 | 低 |
| 技能选择准确率 | 高（完整信息） | 中等（基于摘要） |
| 额外工具调用 | 无 | 需要 skill_view 调用 |
| 实现复杂度 | 低 | 中等 |

Hermes 选择渐进式披露，是因为在实践中：
1. 技能选择不需要完整信息——名称和描述已经足够判断相关性
2. 99% 的对话只需要 1-2 个技能
3. Token 节省的效果远大于偶尔多一次工具调用的开销

## 二、skills_list：轻量级技能目录

### 2.1 元数据结构

skills_list 返回的是每个技能的"名片"——只包含最核心的识别信息：

```typescript
interface SkillMetadata {
  // 唯一标识
  name: string;
  
  // 人类可读的描述（1-2 句话，约 20-30 tokens）
  description: string;
  
  // 技能分类
  category: string;
  
  // 触发条件摘要
  triggers: string[];
  
  // 所需权限级别
  permissionLevel: 'read' | 'write' | 'admin';
  
  // 是否需要用户确认
  requiresConfirmation: boolean;
  
  // 预估 token 消耗（加载完整内容时）
  estimatedTokens: number;
  
  // 最后更新时间
  lastUpdated: string;
}

// skills_list 的返回格式
interface SkillsListResponse {
  skills: SkillMetadata[];
  totalCount: number;
  categories: string[];
}
```

### 2.2 注入方式

skills_list 的元数据被注入到 Agent 的 system prompt 中：

```typescript
class SkillListInjector {
  async inject(systemPrompt: string, session: Session): Promise<string> {
    const skills = await this.skillRegistry.listSkills();
    
    // 按类别分组
    const grouped = this.groupByCategory(skills);
    
    // 构建技能目录
    const catalog = Object.entries(grouped).map(([category, skills]) => {
      const skillList = skills.map(s => 
        `- **${s.name}**: ${s.description}`
      ).join('\n');
      
      return `### ${category}\n${skillList}`;
    }).join('\n\n');
    
    // 注入到 system prompt 的工具说明部分
    return systemPrompt.replace(
      '{{SKILLS_CATALOG}}',
      `## 可用技能

以下是你可以使用的所有技能。要使用某个技能，请先调用 \`skill_view\` 获取完整使用说明。

${catalog}

### 如何使用技能
1. 根据用户需求，从上面的目录中选择合适的技能
2. 调用 \`skill_view(name="<技能名>")\` 获取完整使用说明
3. 按照使用说明执行技能
4. 如果一个任务需要多个技能，按顺序逐个加载和执行`
    );
  }
}
```

### 2.3 优化：智能排序与截断

当技能数量很多时，需要智能地决定展示哪些技能：

```typescript
class SmartSkillCatalog {
  async buildCatalog(
    skills: SkillMetadata[],
    context: ConversationContext
  ): Promise<string> {
    // 1. 计算每个技能与当前上下文的相关性
    const scored = await Promise.all(
      skills.map(async skill => ({
        skill,
        relevance: await this.computeRelevance(skill, context)
      }))
    );
    
    // 2. 按相关性排序
    scored.sort((a, b) => b.relevance - a.relevance);
    
    // 3. 分层展示
    const highlyRelevant = scored.filter(s => s.relevance > 0.7);
    const moderatelyRelevant = scored.filter(s => s.relevance > 0.3 && s.relevance <= 0.7);
    const lowRelevance = scored.filter(s => s.relevance <= 0.3);
    
    let catalog = '';
    
    // 高相关性技能：完整展示
    if (highlyRelevant.length > 0) {
      catalog += '### 推荐技能\n';
      catalog += highlyRelevant.map(s => 
        `- **${s.skill.name}** [推荐]: ${s.skill.description}`
      ).join('\n');
      catalog += '\n\n';
    }
    
    // 中等相关性技能：简要展示
    if (moderatelyRelevant.length > 0) {
      catalog += '### 其他可用技能\n';
      catalog += moderatelyRelevant.map(s => 
        `- ${s.skill.name}: ${this.truncate(s.skill.description, 50)}`
      ).join('\n');
      catalog += '\n\n';
    }
    
    // 低相关性技能：只提数量
    if (lowRelevance.length > 0) {
      catalog += `还有 ${lowRelevance.length} 个其他技能可用。\n`;
    }
    
    return catalog;
  }
  
  private async computeRelevance(
    skill: SkillMetadata,
    context: ConversationContext
  ): Promise<number> {
    // 基于关键词匹配
    const keywordScore = this.keywordMatch(skill, context.currentInput);
    
    // 基于历史使用频率
    const historyScore = await this.usageHistory(skill.name, context.userId);
    
    // 基于触发条件匹配
    const triggerScore = this.triggerMatch(skill.triggers, context);
    
    return keywordScore * 0.4 + historyScore * 0.3 + triggerScore * 0.3;
  }
}
```

### 2.4 实战对比：skills_list vs skill_view 调用流程

为了更直观地展示两级加载机制，以下是一个完整的 Agent 交互流程：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    skills_list（System Prompt 注入）                  │
│                                                                     │
│  ## 可用技能                                                         │
│  ### 代码质量                                                        │
│  - **laravel_code_review**: Laravel 代码审查（安全、性能、风格）      │
│  - **phpstan_analysis**: PHPStan 静态分析，检查类型错误               │
│                                                                     │
│  ### 数据库                                                          │
│  - **query_optimizer**: SQL 查询优化，分析慢查询并建议索引           │
│  - **migration_review**: Laravel 迁移文件审查，检查 DDL 安全性        │
│                                                                     │
│  还有 26 个其他技能可用。                                            │
│                                                                     │
│  Token 消耗：~900 tokens                                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
        用户说："帮我检查一下 app/ 下的代码安全性"
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent 决策：从目录中匹配 → laravel_code_review（提到"代码""安全"）  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              skill_view(name="laravel_code_review")                  │
│                                                                     │
│  返回完整使用说明：                                                   │
│  ├── 描述：对 Laravel 项目代码进行全面审查...                         │
│  ├── 参数：path(必填), dimensions(可选), severity(可选)              │
│  ├── 示例：skill_use(name="laravel_code_review", params={...})      │
│  └── 注意事项：自动修复会创建备份...                                  │
│                                                                     │
│  Token 消耗：~1500 tokens（按需加载）                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  skill_use(name="laravel_code_review", params={                     │
│    "path": "app/",                                                   │
│    "dimensions": "security",                                         │
│    "severity": "strict"                                              │
│  })                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**关键区别总结**：

| 维度 | skills_list | skill_view |
|------|------------|------------|
| 调用时机 | 系统启动时自动注入 | Agent 按需手动调用 |
| 数据量 | 每技能 ~30 tokens 元数据 | 每技能 ~1500 tokens 完整说明 |
| 注入方式 | System Prompt 内嵌 | 工具调用返回 |
| 缓存策略 | 会话级别常驻 | 10 分钟 TTL + 手动失效 |
| 变更影响 | 元数据变更需重建 Prompt | 仅清除对应缓存 |
| 设计目标 | 让 Agent 知道"能做什么" | 让 Agent 知道"怎么做" |

## 三、skill_view：按需加载完整内容

### 3.1 工具定义

skill_view 是一个注册到 Hermes 工具系统中的标准工具：

```typescript
const skillViewTool: ToolDefinition = {
  name: 'skill_view',
  description: '获取指定技能的完整使用说明。在确定要使用某个技能后，调用此工具获取详细的执行指南。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '技能的名称（从 skills_list 中获取）'
      }
    },
    required: ['name']
  },
  
  async execute(params: { name: string }, context: ExecutionContext) {
    const skill = await skillRegistry.getSkill(params.name);
    
    if (!skill) {
      return {
        error: true,
        message: `技能 "${params.name}" 不存在。请检查名称是否正确。`
      };
    }
    
    // 检查权限
    if (!context.hasPermission(skill.permissionLevel)) {
      return {
        error: true,
        message: `没有权限使用技能 "${params.name}"（需要 ${skill.permissionLevel} 权限）`
      };
    }
    
    // 返回完整内容
    return {
      name: skill.name,
      description: skill.fullDescription,
      usage: skill.usage,
      examples: skill.examples,
      notes: skill.notes,
      parameters: skill.parameters,
      estimatedExecutionTime: skill.estimatedTime
    };
  }
};
```

### 3.2 技能内容结构

每个技能的完整内容遵循统一的结构：

```markdown
# 技能：Laravel 代码审查

## 描述
对 Laravel 项目代码进行全面审查，包括代码风格、安全漏洞、性能问题、最佳实践等维度。

## 使用方法
1. 指定要审查的文件或目录路径
2. 可选：指定审查维度（style/security/performance/all）
3. 可选：指定严格程度（strict/moderate/lenient）

## 参数
- `path` (必填): 文件或目录路径
- `dimensions` (可选): 审查维度，默认 "all"
- `severity` (可选): 严格程度，默认 "moderate"
- `fix` (可选): 是否自动修复可修复的问题，默认 false

## 示例
\`\`\`
skill_use(name="laravel_code_review", params={
  "path": "app/Http/Controllers/",
  "dimensions": "security,performance",
  "severity": "strict"
})
\`\`\`

## 注意事项
- 审查大量文件时可能需要较长时间
- 自动修复会创建备份文件
- 安全审查可能产生误报，需要人工确认
```

### 3.3 内容缓存策略

skill_view 的返回内容可以被缓存，避免同一会话中重复加载：

```typescript
class SkillViewCache {
  private cache = new Map<string, CachedSkillView>();
  private ttl = 10 * 60 * 1000; // 10 分钟
  
  async getOrLoad(skillName: string): Promise<SkillViewContent> {
    const cached = this.cache.get(skillName);
    
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      // 缓存命中
      return cached.content;
    }
    
    // 缓存未命中，加载完整内容
    const content = await this.loadSkillContent(skillName);
    
    this.cache.set(skillName, {
      content,
      timestamp: Date.now()
    });
    
    return content;
  }
  
  // 当技能文件更新时，清除对应缓存
  invalidate(skillName: string): void {
    this.cache.delete(skillName);
  }
  
  // 清除所有缓存
  clearAll(): void {
    this.cache.clear();
  }
}
```

## 四、Agent 的技能选择决策过程

### 4.1 完整的决策流程

让我们通过一个实际场景来展示 Agent 如何使用渐进式披露机制：

```
用户输入："帮我审查一下 app/Http/Controllers/ 下的代码安全性"

Agent 的决策过程：

Step 1: 查看 skills_list（已在 system prompt 中）
┌──────────────────────────────────────────────────┐
│ ## 可用技能                                       │
│                                                   │
│ ### 代码质量                                      │
│ - **laravel_code_review**: Laravel 代码审查        │
│ - **phpstan_analysis**: 静态分析                   │
│                                                   │
│ ### 部署运维                                      │
│ - **deploy_check**: 部署前检查                     │
│ - **health_check**: 健康检查                       │
│                                                   │
│ ### 数据库                                        │
│ - **query_optimizer**: SQL 查询优化                │
│ - **migration_review**: 迁移文件审查               │
│                                                   │
│ 还有 24 个其他技能可用。                           │
└──────────────────────────────────────────────────┘

Agent 判断：用户要"审查代码安全性" → laravel_code_review 最相关

Step 2: 调用 skill_view 获取完整说明
skill_view(name="laravel_code_review")

Step 3: 获取到完整使用说明
{
  "name": "laravel_code_review",
  "description": "对 Laravel 项目代码进行全面审查...",
  "usage": "指定路径和审查维度...",
  "parameters": {
    "path": "文件或目录路径",
    "dimensions": "审查维度",
    "severity": "严格程度"
  }
}

Step 4: 根据用户需求执行
skill_use(name="laravel_code_review", params={
  "path": "app/Http/Controllers/",
  "dimensions": "security",
  "severity": "strict"
})
```

### 4.2 Agent 提示词中的决策引导

为了让 Agent 更好地利用渐进式披露机制，system prompt 中包含了决策引导：

```typescript
const decisionGuide = `
## 技能使用决策指南

1. **先看目录**：技能目录已在上方列出，包含所有可用技能的名称和简要描述
2. **判断相关性**：根据用户需求，从目录中识别最相关的 1-2 个技能
3. **加载详情**：调用 skill_view 获取完整使用说明
4. **确认参数**：根据用户输入确定技能的执行参数
5. **执行技能**：调用 skill_use 执行技能

### 选择技能的原则
- 优先选择与用户需求最匹配的技能
- 如果不确定，先加载最可能的技能查看详细说明
- 一个任务通常只需要 1-2 个技能
- 不要一次加载多个技能的详情——先用完一个再加载下一个
`;
```

### 4.3 多技能协作

当一个任务需要多个技能时，Agent 可以按需逐个加载：

```typescript
class MultiSkillOrchestrator {
  async executeTask(
    task: string,
    context: ExecutionContext
  ): Promise<TaskResult> {
    // 第一步：基于目录选择第一个技能
    const firstSkill = await this.selectSkill(task, 'initial');
    const firstSkillView = await this.loadSkillView(firstSkill);
    
    // 执行第一个技能
    const firstResult = await this.executeSkill(firstSkill, firstSkillView, context);
    
    // 第二步：根据第一个技能的结果决定是否需要更多技能
    const needsMore = await this.evaluateNeedForMore(task, firstResult);
    
    if (needsMore) {
      // 选择第二个技能
      const secondSkill = await this.selectSkill(task, 'followup', firstResult);
      const secondSkillView = await this.loadSkillView(secondSkill);
      
      // 执行第二个技能
      const secondResult = await this.executeSkill(
        secondSkill, secondSkillView, context, firstResult
      );
      
      return this.mergeResults(firstResult, secondResult);
    }
    
    return firstResult;
  }
}
```

## 五、技能发现与注册机制

### 5.1 技能文件结构

Hermes 的技能以文件形式存储在 `skills/` 目录下：

```
~/.hermes/skills/
├── laravel-code-review/
│   ├── skill.yaml          # 技能元数据
│   └── prompt.md           # 完整使用说明
├── deploy-check/
│   ├── skill.yaml
│   └── prompt.md
└── query-optimizer/
    ├── skill.yaml
    └── prompt.md
```

skill.yaml 定义元数据：

```yaml
name: laravel_code_review
description: "Laravel 代码审查：代码风格、安全漏洞、性能问题"
category: "代码质量"
triggers:
  - "代码审查"
  - "code review"
  - "安全检查"
  - "代码质量"
permissionLevel: read
requiresConfirmation: false
estimatedTokens: 1500
version: "1.2.0"
author: "Hermes Team"
```

### 5.2 动态技能发现

Hermes 支持多种技能来源：

```typescript
class SkillDiscovery {
  private sources: SkillSource[] = [];
  
  constructor() {
    // 内置技能
    this.sources.push(new BuiltinSkillSource());
    
    // 用户自定义技能
    this.sources.push(new UserSkillSource('~/.hermes/skills/'));
    
    // Profile 技能
    this.sources.push(new ProfileSkillSource('~/.hermes/profiles/*/skills/'));
    
    // 插件提供的技能
    this.sources.push(new PluginSkillSource());
  }
  
  async discover(): Promise<SkillMetadata[]> {
    const allSkills: SkillMetadata[] = [];
    
    for (const source of this.sources) {
      const skills = await source.list();
      allSkills.push(...skills);
    }
    
    // 去重（后注册的覆盖先注册的）
    return this.deduplicate(allSkills);
  }
  
  async load(name: string): Promise<SkillContent> {
    // 按优先级查找技能
    for (const source of this.sources.reverse()) {
      const skill = await source.load(name);
      if (skill) return skill;
    }
    
    throw new SkillNotFoundError(name);
  }
}
```

### 5.3 技能热更新

技能文件的修改可以被实时检测：

```typescript
class SkillWatcher {
  private watcher: FSWatcher;
  
  start(): void {
    this.watcher = chokidar.watch('~/.hermes/skills/**/*', {
      ignoreInitial: true
    });
    
    this.watcher.on('change', (path) => {
      if (path.endsWith('skill.yaml')) {
        // 元数据变更 → 更新 skills_list
        this.skillRegistry.reloadMetadata(this.extractName(path));
        this.invalidateListCache();
      } else if (path.endsWith('prompt.md')) {
        // 内容变更 → 清除 skill_view 缓存
        this.skillViewCache.invalidate(this.extractName(path));
      }
    });
  }
}
```

## 六、性能优化

### 6.1 Token 消耗对比

在 30 个技能的场景下：

| 方案 | System Prompt | 每次对话额外 | 1000 次对话总计 |
|------|--------------|-------------|---------------|
| 全部加载 | 45,000 tokens | 0 | 45,000,000 tokens |
| 渐进式披露 | 900 tokens | ~2,000 tokens | 900,000 + 2,000,000 = 2,900,000 tokens |
| 节省比例 | - | - | **93.6%** |

### 6.2 相关性预计算

```typescript
class PrecomputedRelevance {
  // 在技能注册时预计算关键词索引
  private keywordIndex = new Map<string, Set<string>>();
  
  indexSkill(skill: SkillMetadata): void {
    // 提取关键词
    const keywords = this.extractKeywords(
      skill.name + ' ' + skill.description + ' ' + skill.triggers.join(' ')
    );
    
    for (const keyword of keywords) {
      const skills = this.keywordIndex.get(keyword) || new Set();
      skills.add(skill.name);
      this.keywordIndex.set(keyword, skills);
    }
  }
  
  // 快速查找相关技能（无需 LLM）
  findRelevant(input: string): string[] {
    const inputKeywords = this.extractKeywords(input);
    const skillScores = new Map<string, number>();
    
    for (const keyword of inputKeywords) {
      const skills = this.keywordIndex.get(keyword) || new Set();
      for (const skill of skills) {
        skillScores.set(skill, (skillScores.get(skill) || 0) + 1);
      }
    }
    
    return Array.from(skillScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }
}
```

### 6.3 懒加载与预取

```typescript
class SkillPrefetcher {
  // 根据对话趋势预取可能需要的技能
  async predictAndPrefetch(session: Session): Promise<void> {
    const recentInputs = session.messages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content);
    
    // 使用轻量级模型预测可能需要的技能
    const predicted = await this.predictSkills(recentInputs);
    
    // 后台预取
    for (const skillName of predicted) {
      this.skillViewCache.prefetch(skillName);
    }
  }
}
```

## 七、与其他方案的对比

| 维度 | Hermes 渐进式披露 | 全部加载 | RAG 检索 | 无技能系统 |
|------|------------------|---------|---------|-----------|
| Token 效率 | ✅ 93%+ 节省 | ❌ | ✅ | ✅（无消耗） |
| 技能选择准确率 | ✅ 高 | ✅ 最高 | ⚠️ 中等 | ❌ 无 |
| 响应延迟 | ✅ 低 | ❌ 高 | ⚠️ 中等 | ✅ 最低 |
| 实现复杂度 | ⚠️ 中等 | ✅ 低 | ❌ 高 | ✅ 最低 |
| 可扩展性 | ✅ 无限技能 | ❌ 受限 | ✅ | ❌ |

## 八、最佳实践

### 8.1 技能描述的编写规范

好的技能描述是渐进式披露成功的关键：

```yaml
# ❌ 不好的描述
description: "代码审查工具"

# ✅ 好的描述
description: "Laravel 代码审查：检查 SQL 注入、XSS、权限绕过等安全漏洞"
```

好的描述应该：
1. 明确技术栈（Laravel）
2. 说明核心功能（安全审查）
3. 列出关键能力（SQL 注入、XSS、权限绕过）
4. 控制在 30 tokens 以内

### 8.2 触发条件的设计

```yaml
# ❌ 不好的触发条件
triggers:
  - "代码"
  - "审查"

# ✅ 好的触发条件
triggers:
  - "代码审查"
  - "code review"
  - "安全扫描"
  - "安全检查"
  - "代码质量"
  - "lint"
```

触发条件应该：
1. 足够具体，避免误匹配
2. 包含中英文变体
3. 包含同义词和近义词
4. 不超过 10 个

### 8.3 分类体系的设计

```yaml
# 推荐的分类体系
categories:
  - "代码质量"     # 审查、测试、重构
  - "开发工具"     # Git、编辑器、调试
  - "部署运维"     # CI/CD、监控、日志
  - "数据库"       # 查询优化、迁移、备份
  - "安全"         # 漏洞扫描、权限审查
  - "文档"         # API 文档、README
  - "AI 辅助"      # 代码生成、Review
```

## 总结

Hermes 的渐进式披露机制通过 skills_list 和 skill_view 的两级设计，优雅地解决了 AI Agent 技能管理中的核心矛盾：

1. **skills_list** 提供轻量级的技能目录，让 Agent 知道"我能做什么"
2. **skill_view** 提供按需加载的完整说明，让 Agent 知道"怎么做"
3. **智能排序** 确保最相关的技能优先展示
4. **缓存机制** 避免同一会话中重复加载
5. **预取策略** 提前准备可能需要的技能内容

这种设计不仅节省了 93%+ 的 token 消耗，还提高了 Agent 的技能选择准确性——因为 Agent 先看到精炼的目录，再按需加载详情，比一次性面对 45000 tokens 的信息海洋更容易做出正确判断。

渐进式披露的核心理念——**信息应按需提供，而非一次性倾泻**——不仅适用于 AI Agent 的技能管理，也适用于所有需要在有限上下文中管理大量能力的系统设计。

## 相关阅读

- [三大框架技能系统对比：Hermes Skill Hub vs OpenClaw ClawdHub vs OpenHuman Composio](/categories/架构/三大框架技能系统对比-Hermes-Skill-Hub-vs-OpenClaw-ClawdHub-vs-OpenHuman-Composio/) — 从技能分发、社区生态、安全审计维度横向对比三大框架的技能系统设计
- [Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点](/categories/架构/Hermes-插件系统深度剖析-PluginContext注册-tool-CLI-slash-command扩展点/) — 深入理解 Hermes 的插件扩展机制，与 Skills 系统互补的另一条扩展路径
- [Hermes 模型发现机制：bundled plugins + user overrides 的优先级覆盖与延迟加载](/categories/架构/Hermes-模型发现机制-bundled-plugins-user-overrides-优先级覆盖与延迟加载/) — 了解 Hermes 如何通过延迟加载和优先级覆盖管理模型与插件，与渐进式披露一脉相承的设计思路
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/) — MCP 协议如何让 Agent 动态发现外部工具，与 Skills 渐进式披露形成互补的工具加载策略
- [Hermes Agent vs Claude Code vs Cursor：开发者 AI 助手选型与工作流对比实战踩坑记录](/categories/macOS/hermes-agent-vs-claude-code-vs-cursor-developer-ai-assistant-comparison/) — 横向对比主流开发者 AI 助手，了解 Hermes Skills 机制在实际工具选型中的优势
- [Hermes Agent 定时任务实战：自动化博客写作、系统监控与代码更新踩坑记录](/categories/macOS/hermes-agent-guide-automationmonitoring/) — 用 Hermes 的 Skills + Cron 实现自动化工作流的完整实战案例
- [用 AI Agent 实现自动化 DevOps：监控、告警、修复、部署闭环](/categories/运维/用-AI-Agent-实现自动化-DevOps/) — AI Agent 在运维场景中的自动化实践，与 Skills 渐进式披露在实际业务中的应用
- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/categories/AI%20Agent/AI-Agent-数据分析实战-自然语言转SQL-图表生成-报告自动化/) — AI Agent 在数据分析场景的实战，展示技能系统的多样化应用场景

---

*本文基于 Hermes Agent 源码分析。如需了解更多关于 Skills 系统的细节，请参考 [Hermes Agent Skills 文档](https://hermes-agent.nousresearch.com/docs/skills)。*
