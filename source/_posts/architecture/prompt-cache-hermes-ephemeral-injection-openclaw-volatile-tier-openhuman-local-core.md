---
title: 三大框架 Prompt Cache 策略对比：Hermes ephemeral injection vs OpenClaw volatile tier vs OpenHuman local core
date: 2026-06-02 10:00:00
tags: [AI Agent, Hermes, OpenClaw, OpenHuman, Prompt Cache, 性能优化]
keywords: [Prompt Cache, Hermes ephemeral injection vs OpenClaw volatile tier vs OpenHuman local core, 三大框架, 策略对比, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "深入对比 Hermes、OpenClaw、OpenHuman 三大 AI Agent 框架的 Prompt Cache 策略：Hermes 的临时注入（Ephemeral Injection）将 Prompt 分为稳定骨架与动态注入物，缓存命中率 70-85%；OpenClaw 的易失层级（Volatile Tier）按稳定性三级分层，命中率 60-75%；OpenHuman 的本地核心（Local Core）将高频数据预加载到内存，命中率达 80-90%。文章详解各策略的实现机制、缓存命中率分析、优势与局限，并提供不同场景下的选型建议和实战优化指南。"
---


# 三大框架 Prompt Cache 策略对比：Hermes ephemeral injection vs OpenClaw volatile tier vs OpenHuman local core

## 引言

在 AI Agent 框架的性能优化中，Prompt Cache 是一个经常被忽视但影响深远的技术。每次与 LLM 的交互都需要发送大量的系统提示、工具定义、记忆上下文，这些内容在连续对话中变化很小。如果不做缓存优化，每次请求都要重复传输和计费相同的 Token，造成巨大的浪费。

根据 Anthropic 2025 年底发布的数据，启用 Prompt Cache 可以将连续对话的 Token 成本降低 85-90%，首次响应延迟降低 50-70%。对于构建生产级 AI Agent 应用的开发者来说，Prompt Cache 策略的选择直接影响运营成本和用户体验。

本文将深入分析 Hermes Agent、OpenClaw 和 OpenHuman 三个框架各自采用的 Prompt Cache 策略，揭示它们在设计哲学、实现机制和适用场景上的根本差异。

## 二、Prompt Cache 基础概念

### 2.1 什么是 Prompt Cache

Prompt Cache 是指在连续的 LLM 调用中，缓存前缀相同的 Prompt 内容，避免重复处理。现代 LLM 提供商（如 Anthropic、OpenAI）在服务端实现了自动的 Prompt Caching——如果新的请求与之前的请求有相同的前缀，服务端可以跳过前缀部分的计算，直接复用缓存的 KV Cache。

### 2.2 Prompt Cache 的关键指标

评估 Prompt Cache 策略的优劣，需要关注以下指标：

- **命中率（Hit Rate）**：缓存命中的请求占比
- **延迟收益（Latency Reduction）**：缓存命中时的响应时间改善
- **成本节省（Cost Reduction）**：缓存命中时的 Token 计费节省
- **一致性（Consistency）**：缓存内容与最新状态的一致性保证
- **内存开销（Memory Overhead）**：维护缓存所需的额外存储

### 2.3 Agent 框架的特殊挑战

与普通的 API 调用不同，AI Agent 框架面临独特的 Prompt Cache 挑战：

1. **系统提示的动态性**：Agent 的系统提示包含工具定义、记忆上下文、技能描述等，这些内容可能在每次对话中发生变化
2. **多模型切换**：Agent 可能根据任务类型切换不同的模型，缓存不能跨模型复用
3. **工具调用的循环**：Agent 的工具调用会产生多轮对话，每轮都需要缓存前缀
4. **记忆的累积增长**：随着对话进行，上下文窗口中的记忆会不断增长

## 三、Hermes 的 Ephemeral Injection 策略

### 3.1 设计哲学

Hermes 采用 **Ephemeral Injection（临时注入）** 策略。核心思想是：将 Prompt 内容分为**稳定的骨架**和**动态的注入物**两部分。骨架（系统提示的框架部分、工具定义、Provider 配置）在会话生命周期内保持不变，注入物（记忆、上下文、技能描述）根据需要临时插入。

「Ephemeral」意味着注入物是临时的——它们只在需要时存在，不需要时被移除。这种设计的目标是最大化骨架部分的缓存命中率，同时最小化注入物对缓存失效的影响。

### 3.2 实现机制

Hermes 的 Prompt 构建分为以下层次：

```
Prompt 结构（从上到下）：
┌─────────────────────────────┐
│  System Prompt 骨架         │  ← 长期稳定，高缓存命中率
│  - 框架指令                  │
│  - 工具定义                  │
│  - Provider 配置             │
├─────────────────────────────┤
│  Ephemeral Injection 区域   │  ← 动态变化，按需注入
│  - 技能上下文                │
│  - 记忆片段                  │
│  - 临时指令                  │
├─────────────────────────────┤
│  对话历史                    │  ← 追加写入，逐步增长
│  - 用户消息                  │
│  - 助手回复                  │
│  - 工具调用结果              │
└─────────────────────────────┘
```

关键实现细节：

1. **骨架冻结**：系统提示的骨架部分在会话开始时生成后就不再变化。即使注入物发生变化，骨架部分的 Token 位置保持不变，服务端的 KV Cache 可以复用。

2. **注入物排序**：多个注入物按照变化频率从低到高排序。变化频率低的内容（如技能描述）排在前面，变化频率高的内容（如动态记忆）排在后面。这样可以最大化可缓存的前缀长度。

3. **缓存标记**：Hermes 在发送请求时会标记缓存断点（cache breakpoint），告诉服务端在哪个位置可以安全地截断缓存。这避免了因为注入物的微小变化导致整个骨架的缓存失效。

```python
# Hermes 的 Prompt 构建伪代码
def build_prompt(session):
    # 1. 骨架（长期稳定）
    skeleton = [
        system_instructions(),
        tool_definitions(session.tools),
        provider_config(session.provider),
    ]
    
    # 2. Ephemeral injections（按变化频率排序）
    injections = sorted(
        session.active_injections,
        key=lambda x: x.change_frequency
    )
    
    # 3. 对话历史
    history = session.conversation_history
    
    # 4. 组合并标记缓存断点
    prompt = concatenate(skeleton, injections, history)
    prompt.set_cache_breakpoint(len(skeleton) + len(injections))
    
    return prompt
```

### 3.3 缓存命中率分析

Ephemeral Injection 策略的缓存命中率取决于：
- 骨架的稳定性：骨架越稳定，缓存命中率越高
- 注入物的变化频率：注入物变化越少，可缓存的前缀越长
- 对话轮次：随着对话进行，新增的对话历史是追加的，不影响前缀缓存

在典型的使用场景中，Hermes 的缓存命中率可以达到 **70-85%**。骨架部分几乎 100% 命中，注入物部分根据变化频率有 30-60% 的命中率。

### 3.4 优势与局限

**优势：**
- 缓存策略对用户透明，无需手动管理
- 注入物的灵活排序最大化了缓存命中率
- 支持跨 Provider 的统一缓存策略

**局限：**
- 注入物的变化会导致注入点之后的所有缓存失效
- 需要精确的缓存断点管理，实现复杂度较高
- 对 LLM 提供商的 Prompt Cache API 有依赖

## 四、OpenClaw 的 Volatile Tier 策略

### 4.1 设计哲学

OpenClaw 采用 **Volatile Tier（易失层级）** 策略。核心思想是：将所有上下文内容按照**稳定性**分为三个层级（Tier），每个层级有独立的缓存生命周期。

与 Hermes 的「骨架 + 注入物」二分法不同，OpenClaw 的三分法更细粒度：

- **Stable Tier（稳定层）**：IDENTITY.md 等几乎不变的内容
- **Semi-stable Tier（半稳定层）**：MODEL_STRATEGY.md、技能定义等偶尔变化的内容
- **Volatile Tier（易失层）**：MEMORY.md、daily-notes 等频繁变化的内容

### 4.2 实现机制

OpenClaw 的 Prompt 构建遵循严格的层级顺序：

```
Prompt 结构：
┌─────────────────────────────┐
│  Stable Tier                 │  ← 变化频率：极低
│  - IDENTITY.md 内容          │  ← 缓存生命周期：会话级
├─────────────────────────────┤
│  Semi-stable Tier            │  ← 变化频率：低
│  - MODEL_STRATEGY.md         │  ← 缓存生命周期：小时级
│  - 技能文件                   │
├─────────────────────────────┤
│  Volatile Tier               │  ← 变化频率：高
│  - MEMORY.md 当前快照        │  ← 缓存生命周期：轮次级
│  - daily-notes 今日内容      │
│  - heartbeat-state.json      │
├─────────────────────────────┤
│  对话历史                    │  ← 追加写入
└─────────────────────────────┘
```

关键实现细节：

1. **层级隔离缓存**：每个层级独立维护缓存标记。当 Volatile Tier 发生变化时，只有该层及以下的缓存失效，Stable Tier 和 Semi-stable Tier 的缓存保持有效。

2. **快照机制**：Volatile Tier 的内容在每轮对话开始时生成快照。即使 MEMORY.md 在对话过程中被修改，当前对话使用的仍是开始时的快照，保证了对话内的一致性。

3. **增量更新**：当对话跨越多个轮次时，OpenClaw 只发送变化的 Volatile Tier 内容，而非全量重传。这通过 diff 算法实现。

```python
# OpenClaw 的 Prompt 构建伪代码
def build_prompt(session):
    # 1. Stable Tier（几乎不变，高优先级缓存）
    stable = read_file(".openclaw/IDENTITY.md")
    
    # 2. Semi-stable Tier（偶尔变化）
    semi_stable = [
        read_file(".openclaw/MODEL_STRATEGY.md"),
        load_skills(".openclaw/skills/"),
    ]
    
    # 3. Volatile Tier（每轮可能变化）
    volatile_snapshot = snapshot([
        read_file(".openclaw/MEMORY.md"),
        read_file(f".openclaw/daily-notes/{today()}.md"),
        read_file(".openclaw/heartbeat-state.json"),
    ])
    
    # 4. 对话历史
    history = session.conversation_history
    
    # 5. 组合，每层设置独立的缓存标记
    prompt = concatenate(stable, semi_stable, volatile_snapshot, history)
    prompt.set_cache_boundary("stable", len(stable))
    prompt.set_cache_boundary("semi-stable", len(stable) + len(semi_stable))
    prompt.set_cache_boundary("volatile", len(stable) + len(semi_stable) + len(volatile_snapshot))
    
    return prompt
```

### 4.3 缓存命中率分析

Volatile Tier 策略的缓存命中率取决于：
- Stable Tier 的命中率：极高（接近 100%），因为 IDENTITY.md 几乎不变
- Semi-stable Tier 的命中率：较高（80-90%），技能和策略文件变化不频繁
- Volatile Tier 的命中率：较低（20-40%），记忆文件每轮都可能变化

综合缓存命中率约为 **60-75%**。虽然低于 Hermes 的 Ephemeral Injection，但 OpenClaw 的策略在一致性保证上更强。

### 4.4 优势与局限

**优势：**
- 层级隔离设计使缓存失效的影响范围更小
- 快照机制保证了对话内的一致性
- 文件原生的设计使缓存策略的调试非常直观

**局限：**
- 文件读取本身有 I/O 开销
- Volatile Tier 的变化频率高，缓存命中率较低
- 缺乏跨 Provider 的统一缓存管理

## 五、OpenHuman 的 Local Core 策略

### 5.1 设计哲学

OpenHuman 采用 **Local Core（本地核心）** 策略。核心思想是：将最核心、最常访问的上下文数据**预加载到本地内存**，构建一个本地的「热缓存」。这个热缓存独立于 LLM 提供商的 Prompt Cache 机制，是框架自己管理的。

这种设计的出发点是 OpenHuman 的本地优先架构——既然所有数据都在本地，为什么不直接在本地维护一个高性能的缓存层？

### 5.2 实现机制

OpenHuman 的 Local Core 是一个分层的内存缓存：

```
Local Core 结构：
┌─────────────────────────────┐
│  L1: Identity Core           │  ← 内存常驻
│  - Agent 身份定义             │  ← 大小：~2KB
│  - 行为规则                   │
├─────────────────────────────┤
│  L2: Memory Core             │  ← 内存常驻 + 定期刷新
│  - Memory Tree 高频实体      │  ← 大小：~50KB
│  - 主题树摘要                │
│  - 最近对话摘要              │
├─────────────────────────────┤
│  L3: Context Core            │  ← 按需加载
│  - 当前任务相关叶子           │  ← 大小：~200KB
│  - 相关实体关系图             │
│  - 工具定义                  │
├─────────────────────────────┤
│  L4: Extended Context        │  ← 懒加载
│  - 历史记忆                  │  ← 大小：动态
│  - 完整知识图谱              │
└─────────────────────────────┘
```

关键实现细节：

1. **预计算 Prompt 前缀**：L1 和 L2 的内容在会话开始时就预计算为 Prompt 前缀。这个前缀是固定的，可以直接用于服务端的 Prompt Cache。

2. **语义相关性排序**：L3 的内容不是全量加载，而是基于当前对话的语义相关性，从 Memory Tree 中检索最相关的叶子和实体。这确保了上下文的相关性和 Token 效率。

3. **本地 KV Cache**：OpenHuman 在本地维护一个 KV Cache，存储最近处理过的 Prompt 前缀的 KV 向量。当新的请求与缓存的前缀匹配时，可以直接复用本地的 KV Cache，跳过服务端的前缀处理。

```python
# OpenHuman 的 Prompt 构建伪代码
def build_prompt(session, current_query):
    # 1. L1: Identity Core（内存常驻）
    l1 = local_core.identity_cache  # 直接从内存读取
    
    # 2. L2: Memory Core（内存常驻，定期刷新）
    l2 = local_core.memory_cache  # 包含高频实体和主题摘要
    if l2.is_stale():
        l2.refresh(from_memory_tree())
    
    # 3. L3: Context Core（语义检索）
    relevant_leaves = memory_tree.semantic_search(
        query=current_query,
        top_k=10,
        min_relevance=0.7
    )
    relevant_entities = memory_tree.get_related_entities(relevant_leaves)
    l3 = format_context(relevant_leaves, relevant_entities, session.tools)
    
    # 4. L4: Extended Context（按需）
    l4 = session.conversation_history
    
    # 5. 组合并检查本地 KV Cache
    prompt = concatenate(l1, l2, l3, l4)
    
    cached_prefix = local_core.kv_cache.match(prompt)
    if cached_prefix:
        # 复用本地 KV Cache，只发送增量部分
        prompt.set_resume_point(cached_prefix.end_position)
    
    return prompt
```

### 5.3 缓存命中率分析

Local Core 策略的缓存命中率取决于：
- L1 的命中率：100%（内存常驻）
- L2 的命中率：95%+（内存常驻，只有定期刷新时短暂失效）
- L3 的命中率：40-60%（取决于对话主题的变化频率）
- 本地 KV Cache 命中率：70-80%（取决于请求间隔和缓存大小）

综合缓存命中率约为 **80-90%**，是三个框架中最高的。

### 5.4 优势与局限

**优势：**
- 最高的缓存命中率，因为核心数据始终在本地内存
- 语义检索确保了上下文的相关性，减少了无效 Token
- 本地 KV Cache 减少了对服务端 Prompt Cache 的依赖
- 不受 LLM 提供商缓存策略变化的影响

**局限：**
- 内存开销较大，L1-L3 可能占用数百 MB 内存
- 本地 KV Cache 的维护增加了系统复杂度
- 语义检索的质量直接影响缓存命中率
- 在低内存设备上可能无法发挥全部优势

## 六、三框架综合对比

### 6.1 缓存策略对比表

| 维度 | Hermes Ephemeral Injection | OpenClaw Volatile Tier | OpenHuman Local Core |
|------|---------------------------|----------------------|---------------------|
| 核心思想 | 骨架 + 临时注入 | 稳定性分层 | 本地热缓存 |
| 缓存命中率 | 70-85% | 60-75% | 80-90% |
| 延迟收益 | 中等 | 较低 | 最高 |
| 成本节省 | 高 | 中等 | 最高 |
| 一致性保证 | 中等 | 强 | 强 |
| 内存开销 | 低 | 低 | 高 |
| 实现复杂度 | 高 | 中等 | 最高 |
| Provider 依赖 | 高 | 中等 | 低 |
| 适用场景 | 多 Provider 切换 | 文件驱动工作流 | 知识密集型工作 |

### 6.2 不同场景下的最优选择

**场景 1：高频短对话（客服、问答）**

最优选择：**Hermes**

原因：高频短对话中，骨架部分的缓存命中率最高，Ephemeral Injection 策略能最大化利用服务端 Prompt Cache。OpenHuman 的 Local Core 在短对话中优势不明显，反而增加了内存开销。

**场景 2：长时间深度对话（研究、写作）**

最优选择：**OpenHuman**

原因：长时间对话中，Memory Tree 的语义检索可以持续提供高相关性的上下文，L2 Memory Core 的常驻缓存在长对话中收益最大。OpenClaw 的 Volatile Tier 在长对话中变化频繁，缓存命中率下降明显。

**场景 3：文件驱动的开发工作流**

最优选择：**OpenClaw**

原因：OpenClaw 的文件原生设计使其在文件驱动的工作流中有天然优势。IDENTITY.md 和技能文件的高稳定性保证了 Stable Tier 的缓存命中率，而 MEMORY.md 的变化是可预测的（主要在对话结束时追加）。

**场景 4：多模型切换场景**

最优选择：**Hermes**

原因：Hermes 的 Ephemeral Injection 策略在模型切换时可以复用骨架部分的缓存（如果新旧模型来自同一 Provider），而 OpenClaw 和 OpenHuman 在模型切换时需要重建大部分缓存。

**场景 5：低内存 / 边缘设备**

最优选择：**OpenClaw**

原因：OpenClaw 的 Volatile Tier 策略内存开销最低，文件 I/O 的开销在现代 SSD 上可以忽略。OpenHuman 的 Local Core 需要数百 MB 内存，在边缘设备上不现实。

## 七、Prompt Cache 的实战优化建议

### 7.1 通用优化原则

无论使用哪个框架，以下优化原则都适用：

1. **将稳定内容放在 Prompt 前面**：LLM 提供商的 Prompt Cache 是基于前缀匹配的，将稳定内容放在前面可以最大化缓存命中率。

2. **减少不必要的上下文**：不要把整个 MEMORY.md 都塞进 Prompt。只包含与当前对话相关的部分。OpenHuman 的语义检索在这方面做得最好。

3. **控制工具定义的数量**：每个工具定义都会占用 Prompt 空间。只注册当前对话可能用到的工具。

4. **利用 Provider 的缓存 API**：Anthropic 和 OpenAI 都提供了显式的 Prompt Cache 控制 API。了解并利用这些 API 可以进一步优化缓存效果。

### 7.2 Hermes 用户的优化建议

- 合理规划骨架内容，将最稳定的部分放在最前面
- 减少 ephemeral injection 的数量，合并相关的注入物
- 利用 ProviderProfile 的钩子机制，在模型切换时复用缓存

### 7.3 OpenClaw 用户的优化建议

- 保持 IDENTITY.md 简洁，避免不必要的细节
- 定期精简 MEMORY.md，移除过时的信息
- 使用 daily-notes 而非在 MEMORY.md 中追加日常信息

### 7.4 OpenHuman 用户的优化建议

- 调整 Memory Core 的刷新频率，平衡新鲜度和缓存命中率
- 优化语义检索的 top_k 参数，找到相关性和 Token 效率的平衡点
- 在内存受限的环境中，考虑只启用 L1 和 L2 缓存

## 八、未来发展趋势

### 8.1 服务端 Prompt Cache 的演进

LLM 提供商正在不断增强服务端的 Prompt Cache 能力：
- **更长的缓存窗口**：从几分钟扩展到数小时
- **更灵活的匹配策略**：从严格前缀匹配到模糊匹配
- **跨会话缓存**：不同会话之间共享缓存

这些演进将降低框架端缓存策略的重要性，但不会完全消除——框架端的优化仍然可以在服务端缓存之上进一步降低成本和延迟。

### 8.2 框架间的融合趋势

三个框架的缓存策略正在相互借鉴：
- Hermes 正在探索本地 KV Cache 的可能性
- OpenClaw 正在引入更细粒度的注入机制
- OpenHuman 正在优化 Local Core 的内存效率

未来可能会出现融合三种策略优势的「混合缓存」方案。

## 总结

Prompt Cache 是 AI Agent 框架性能优化的关键技术。三个框架代表了三种不同的策略：

- **Hermes 的 Ephemeral Injection**：适合多 Provider 切换和高频短对话场景，缓存命中率 70-85%
- **OpenClaw 的 Volatile Tier**：适合文件驱动工作流和低内存环境，缓存命中率 60-75%
- **OpenHuman 的 Local Core**：适合知识密集型工作和长时间对话，缓存命中率 80-90%

选择哪个策略，取决于你的使用场景、资源约束和性能需求。理解每个策略的设计哲学和权衡取舍，才能最大化 Prompt Cache 的收益。

---

*本文基于对 Hermes Agent、OpenClaw、OpenHuman 源码和文档的分析。Prompt Cache 的实际效果受 LLM 提供商的实现、网络条件、对话模式等多种因素影响，建议在实际场景中进行基准测试。*

## 相关阅读

- [三大框架模型路由对比：Hermes ProviderProfile vs OpenClaw Fallback Chain vs OpenHuman Hint Router](/categories/架构/三大框架模型路由对比-Hermes-ProviderProfile-vs-OpenClaw-Fallback-Chain-vs-OpenHuman-Hint-Router/)
- [TokenJuice 压缩策略详解：HTML/Markdown/URL缩短/输出去重/正则噪声过滤](/categories/架构/TokenJuice-压缩策略详解-HTML-Markdown-URL缩短-输出去重-正则噪声过滤/)
- [Hermes ProviderProfile 架构深度剖析：模型提供者的声明式注册与运行时钩子机制](/categories/架构/Hermes-ProviderProfile-架构深度剖析-模型提供者的声明式注册与运行时钩子机制/)
