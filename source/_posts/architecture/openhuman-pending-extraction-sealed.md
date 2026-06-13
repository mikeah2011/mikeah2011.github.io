---

title: OpenHuman 叶子生命周期深度剖析：pending_extraction 到 sealed 的状态机设计
keywords: [OpenHuman, pending, extraction, sealed, 叶子生命周期深度剖析, 的状态机设计]
date: 2026-06-02 07:22:45
tags:
- OpenHuman
- AI Agent
- 状态机
- memory-tree
- 数据生命周期
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 为什么 AI Agent 的记忆节点需要生命周期管理？本文深入剖析 OpenHuman 的叶子四态状态机设计——从 pending_extraction 到 sealed 的完整生命周期。涵盖批量提取与去重、缓冲区 LRU 淘汰策略、sealed 叶子的压缩存储与召回机制、时间/容量/访问频率三种驱动的状态转换规则、乐观锁并发控制、WAL 崩溃恢复，以及一天对话中叶子状态流转的实战场景。
---



# OpenHuman 叶子生命周期深度剖析：pending_extraction 到 sealed 的状态机设计

## 引言：为什么记忆节点需要生命周期管理

在 Memory Tree 的架构中，**叶子（Leaf）**是最基本的记忆单元——它代表一个经过处理的知识片段，包含原始文本、提取的实体、所属主题以及相关的元数据。如果把 Memory Tree 比作一棵真正的树，那么叶子就是进行光合作用的基本单位。

然而，一个关键问题常常被忽略：**不是所有的叶子都生而平等，也不是所有的叶子都应该永远存在。**

想象一个每天与 OpenHuman 交互的用户。一天下来可能产生 50-100 个新的记忆叶子。一个月就是 1500-3000 个。一年就是 18000-36000 个。如果所有叶子都保持"活跃"状态，Memory Tree 将面临三个严重问题：

1. **查询噪音**：当用户问"我最近在忙什么？"时，系统需要从数万个叶子中筛选，大量过时信息会干扰结果。
2. **存储膨胀**：每个叶子都占用内存和磁盘空间，包括其索引、实体关联和主题映射。
3. **上下文污染**：如果 Agent 的上下文窗口被旧的、不再相关的叶子填满，它就无法关注当前最重要的信息。

OpenHuman 的解决方案是引入**叶子生命周期管理**——一个完整的状态机，将叶子从诞生到归档的全过程纳入管理。这个状态机定义了四个状态：

```
pending_extraction → admitted → buffered → sealed
```

每个状态都有明确的含义、进入条件和退出条件。本文将深入剖析这个状态机的设计理念、每个状态的技术细节、状态转换的触发机制，以及在实际使用中的表现。

---

## 状态机总览

### 四态模型

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
    ┌─────────────────────┐    提取完成     ┌──────────────┤
    │ pending_extraction  │───────────────→│   admitted   │
    │  （待提取）          │               │   （已准入）   │
    └─────────────────────┘               └──────┬───────┘
                                                  │
                                         被激活到上下文
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │   buffered   │
                                          │  （缓冲活跃）  │
                                          └──────┬───────┘
                                                  │
                                        访问频率下降/容量压力
                                                  │
                                                  ▼
    ┌─────────────────────┐               ┌──────────────┐
    │     (GC 清理)       │←──────────────│    sealed    │
    │                     │  长期未访问    │   （已封存）   │
    └─────────────────────┘               └──────────────┘
```

### 状态定义

| 状态 | 英文 | 含义 | 典型存活时间 |
|------|------|------|------------|
| 待提取 | pending_extraction | 新捕获的原始信息，等待实体提取和主题分类 | 秒级到分钟级 |
| 已准入 | admitted | 通过提取验证，正式纳入知识库索引 | 小时级到天级 |
| 缓冲活跃 | buffered | 在当前活跃上下文中，被频繁引用 | 分钟级到小时级 |
| 已封存 | sealed | 归档保存的冷数据，仅在精确查询时检索 | 天级到永久 |

### 状态转换矩阵

| 源状态 → 目标状态 | pending_extraction | admitted | buffered | sealed |
|-------------------|-------------------|----------|----------|--------|
| pending_extraction | - | ✅ 提取完成 | ❌ | ❌ |
| admitted | ❌ | - | ✅ 被激活 | ✅ 长期未用 |
| buffered | ❌ | ❌ | - | ✅ 降级 |
| sealed | ❌ | ❌ | ✅ 被召回 | - |

注意：状态转换是**单向为主**的——叶子通常沿着 pending → admitted → buffered → sealed 的方向演进。但 sealed 状态的叶子可以被"召回"到 buffered 状态（当用户再次查询到相关内容时）。

---

## pending_extraction 状态：新捕获的原始信息

### 何时进入此状态

每当用户发送一条新消息，或系统接收到一个新的文档/数据源时，原始内容首先被确定性分块（Deterministic Chunking），每个生成的 chunk 对应一个新的叶子，初始状态为 `pending_extraction`。

```python
class Leaf:
    def __init__(self, raw_text, source='conversation'):
        self.id = generate_leaf_id(raw_text)
        self.raw_text = raw_text
        self.source = source  # conversation, document, import
        self.state = 'pending_extraction'
        self.created_at = datetime.now()
        self.state_history = [
            {'state': 'pending_extraction', 'entered_at': datetime.now()}
        ]
        
        # 以下字段在 pending_extraction 阶段为空
        self.entities = []
        self.topic_id = None
        self.summary = None
        self.importance_score = 0.0
        self.access_count = 0
        self.last_accessed = None
```

### 此状态的特征

1. **已分配唯一 ID**：基于内容哈希，保证确定性
2. **已存储原始文本**：完整的 chunk 内容已持久化
3. **未建立索引**：实体索引和主题树中没有此叶子的记录
4. **不可查询**：正常的记忆查询不会返回 pending_extraction 状态的叶子

### 为什么需要这个中间状态

为什么不直接在分块后就进行实体提取和主题分类？原因有三：

1. **批量处理效率**：实体提取涉及 NLP 处理和可能的 LLM 调用，单条处理效率低。积累到一定数量后批量处理可以利用批处理优化。

2. **依赖就绪检查**：某些叶子的实体提取可能依赖于其他叶子的内容（例如，代词"它"需要上下文才能确定指代对象）。pending_extraction 状态允许系统等待依赖就绪。

3. **去重机会**：在提取之前，系统有机会检查新 chunk 是否与已有 chunk 高度相似（基于内容哈希），避免重复处理。

```python
def process_pending_leaves(memory_tree, batch_size=10):
    """批量处理待提取的叶子"""
    pending = memory_tree.get_leaves_by_state('pending_extraction', limit=batch_size)
    
    if not pending:
        return
    
    # 第一步：去重检查
    unique_leaves = []
    for leaf in pending:
        existing = memory_tree.find_similar_leaf(leaf, threshold=0.95)
        if existing:
            # 高度相似的叶子：合并信息后丢弃
            existing.merge_mentions(leaf)
            leaf.state = 'discarded'
        else:
            unique_leaves.append(leaf)
    
    # 第二步：批量实体提取
    texts = [leaf.raw_text for leaf in unique_leaves]
    batch_entities = batch_extract_entities(texts)
    
    for leaf, entities in zip(unique_leaves, batch_entities):
        leaf.entities = entities
    
    # 第三步：主题分类
    for leaf in unique_leaves:
        topic = memory_tree.topic_tree.classify(leaf)
        leaf.topic_id = topic.id
    
    # 第四步：转换到 admitted 状态
    for leaf in unique_leaves:
        leaf.transition_to('admitted')
        memory_tree.index_leaf(leaf)
```

### 超时处理

如果一个叶子在 `pending_extraction` 状态停留过久（例如超过 1 小时），系统会将其标记为异常并尝试强制处理：

```python
PENDING_TIMEOUT = timedelta(hours=1)

def check_pending_timeout(memory_tree):
    """检查超时的待提取叶子"""
    now = datetime.now()
    pending = memory_tree.get_leaves_by_state('pending_extraction')
    
    for leaf in pending:
        if now - leaf.created_at > PENDING_TIMEOUT:
            logging.warning(f"Leaf {leaf.id} stuck in pending_extraction "
                          f"for {now - leaf.created_at}")
            # 尝试强制处理，即使依赖未就绪
            force_extract(leaf)
```

---

## admitted 状态：正式纳入知识库

### 何时进入此状态

当一个叶子完成以下处理后，它从 `pending_extraction` 转换到 `admitted`：

1. **实体提取完成**：至少识别出一个有意义的实体
2. **主题分类完成**：被分配到主题树的某个节点
3. **重要性评分完成**：基于内容和上下文计算出初始重要性分数

```python
def transition_to_admitted(leaf, memory_tree):
    """从 pending_extraction 转换到 admitted"""
    # 验证前置条件
    if not leaf.entities:
        raise ValueError(f"Leaf {leaf.id} has no extracted entities")
    if not leaf.topic_id:
        raise ValueError(f"Leaf {leaf.id} has no topic assignment")
    
    # 计算重要性评分
    leaf.importance_score = calculate_importance(leaf)
    
    # 建立索引
    for entity in leaf.entities:
        memory_tree.entity_index.add(leaf.id, entity)
    memory_tree.topic_tree.add_leaf(leaf.topic_id, leaf)
    
    # 状态转换
    leaf.state = 'admitted'
    leaf.state_history.append({
        'state': 'admitted',
        'entered_at': datetime.now()
    })
    
    # 持久化
    memory_tree.persist_leaf(leaf)
```

### 此状态的特征

1. **已建立索引**：实体索引和主题树中都有此叶子的记录
2. **可被查询**：正常的记忆查询可以返回此叶子
3. **不在活跃上下文中**：除非被主动检索，否则不会出现在 Agent 的上下文窗口中
4. **等待激活**：当用户讨论相关话题时，此叶子可能被"激活"到 buffered 状态

### admitted 状态的重要性

这个状态是 Memory Tree 的**默认状态**——大部分叶子都会停留在这里。它们构成了知识库的"背景知识"，在需要时被检索，但不会主动干扰当前对话。

```python
def query_admitted_leaves(memory_tree, query, top_k=10):
    """查询 admitted 状态的叶子"""
    # 提取查询中的实体
    query_entities = extract_entities(query)
    
    # 通过实体索引查找候选叶子
    candidate_ids = set()
    for entity in query_entities:
        candidate_ids |= memory_tree.entity_index.chunks_containing(entity)
    
    # 过滤只保留 admitted 状态的
    candidates = [
        memory_tree.get_leaf(lid) 
        for lid in candidate_ids 
        if memory_tree.get_leaf(lid).state == 'admitted'
    ]
    
    # 按相关性和重要性排序
    scored = [
        (leaf, compute_relevance(query, leaf) * leaf.importance_score)
        for leaf in candidates
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    
    return [leaf for leaf, score in scored[:top_k]]
```

---

## buffered 状态：活跃缓冲区中的热数据

### 何时进入此状态

当一个叶子与当前对话上下文高度相关时，它被"激活"到 buffered 状态。触发条件包括：

1. **直接引用**：用户或 Agent 在当前对话中提到了叶子中的实体
2. **主题匹配**：当前对话的主题与叶子所属主题一致
3. **时间窗口**：叶子在最近的时间窗口内被创建或访问
4. **手动激活**：用户明确要求查看或引用某个记忆

```python
def activate_to_buffered(leaf, trigger, memory_tree):
    """将叶子激活到 buffered 状态"""
    if leaf.state != 'admitted':
        raise ValueError(f"Can only activate admitted leaves, "
                        f"got {leaf.state}")
    
    # 检查缓冲区容量
    buffered_leaves = memory_tree.get_leaves_by_state('buffered')
    if len(buffered_leaves) >= MAX_BUFFER_SIZE:
        # 缓冲区满，需要淘汰最不活跃的叶子
        evict_lru_leaf(memory_tree)
    
    leaf.state = 'buffered'
    leaf.access_count += 1
    leaf.last_accessed = datetime.now()
    leaf.state_history.append({
        'state': 'buffered',
        'entered_at': datetime.now(),
        'trigger': trigger
    })
    
    # 加入活跃上下文
    memory_tree.active_context.add(leaf)

MAX_BUFFER_SIZE = 50  # 缓冲区最大叶子数

def evict_lru_leaf(memory_tree):
    """淘汰最近最少使用的 buffered 叶子"""
    buffered = memory_tree.get_leaves_by_state('buffered')
    if not buffered:
        return
    
    # 按最后访问时间排序
    buffered.sort(key=lambda l: l.last_accessed or datetime.min)
    
    # 淘汰最旧的
    oldest = buffered[0]
    oldest.transition_to('sealed', reason='buffer_eviction')
```

### 此状态的特征

1. **在活跃上下文中**：叶子的内容可以直接被 Agent 引用，无需额外检索
2. **高频访问**：access_count 持续增长
3. **参与上下文组装**：当 Agent 组装上下文窗口时，buffered 叶子有优先权
4. **有容量限制**：不能无限增长，有最大容量限制

### buffered 叶子在上下文组装中的角色

```python
def assemble_context_window(memory_tree, current_query, max_tokens=4000):
    """组装 Agent 的上下文窗口"""
    context_parts = []
    used_tokens = 0
    
    # 第一优先级：全局摘要（L1 + 相关 L2）
    summary = memory_tree.global_summary.get_relevant_summary(current_query)
    context_parts.append(('summary', summary))
    used_tokens += count_tokens(summary)
    
    # 第二优先级：buffered 叶子（活跃记忆）
    buffered = memory_tree.get_leaves_by_state('buffered')
    buffered.sort(key=lambda l: l.importance_score, reverse=True)
    
    for leaf in buffered:
        leaf_tokens = count_tokens(leaf.raw_text)
        if used_tokens + leaf_tokens <= max_tokens * 0.6:  # 不超过 60%
            context_parts.append(('buffered', leaf.raw_text))
            used_tokens += leaf_tokens
            # 更新访问记录
            leaf.access_count += 1
            leaf.last_accessed = datetime.now()
    
    # 第三优先级：admitted 叶子（按查询相关性检索）
    relevant_admitted = query_admitted_leaves(memory_tree, current_query)
    for leaf in relevant_admitted:
        leaf_tokens = count_tokens(leaf.raw_text)
        if used_tokens + leaf_tokens <= max_tokens:
            context_parts.append(('admitted', leaf.raw_text))
            used_tokens += leaf_tokens
    
    return context_parts
```

### 缓冲区的命中率优化

缓冲区的价值在于**命中率**——如果用户查询的内容恰好在缓冲区中，就不需要从磁盘加载 admitted 叶子，查询延迟大幅降低。

OpenHuman 使用**预取（Prefetch）策略**来提升命中率：

```python
def prefetch_related_leaves(leaf, memory_tree):
    """预取与当前 buffered 叶子相关的 admitted 叶子"""
    related_entities = set()
    for entity in leaf.entities:
        related_entities |= set(
            memory_tree.entity_index.related_entities(entity, min_co_occurrence=2)
        )
    
    for entity in related_entities:
        candidate_ids = memory_tree.entity_index.chunks_containing(entity)
        for cid in candidate_ids:
            candidate = memory_tree.get_leaf(cid)
            if candidate and candidate.state == 'admitted':
                # 预取到缓冲区（低优先级）
                candidate.state = 'buffered'
                candidate.state_history.append({
                    'state': 'buffered',
                    'entered_at': datetime.now(),
                    'trigger': 'prefetch'
                })
                memory_tree.active_context.add(candidate)
```

---

## sealed 状态：归档封存的冷数据

### 何时进入此状态

叶子从 buffered 转换到 sealed 的触发条件：

1. **LRU 淘汰**：缓冲区满时，最久未访问的叶子被淘汰
2. **时间衰减**：超过设定的时间窗口未被访问
3. **重要性下降**：重要性分数低于阈值
4. **手动归档**：用户或系统主动归档旧记忆

```python
def transition_to_sealed(leaf, reason, memory_tree):
    """从 buffered 转换到 sealed"""
    if leaf.state != 'buffered':
        raise ValueError(f"Can only seal buffered leaves, got {leaf.state}")
    
    leaf.state = 'sealed'
    leaf.sealed_at = datetime.now()
    leaf.state_history.append({
        'state': 'sealed',
        'entered_at': datetime.now(),
        'reason': reason
    })
    
    # 从活跃上下文移除
    memory_tree.active_context.remove(leaf)
    
    # 生成压缩摘要（可选）
    if leaf.importance_score > 0.3:
        leaf.summary = generate_leaf_summary(leaf)
    
    # 保留索引（sealing 不删除索引，只是降低活跃度）
    # 实体索引和主题树中的引用保持不变
    
    # 持久化到冷存储
    memory_tree.archive_leaf(leaf)
```

### 此状态的特征

1. **不在活跃上下文中**：不会出现在 Agent 的上下文窗口
2. **索引保留**：实体索引和主题树中的引用仍然存在
3. **可被精确查询**：通过实体或主题查询仍然可以检索到
4. **可能有压缩摘要**：高重要性的 sealed 叶子保留了摘要，用于快速浏览
5. **存储优化**：原始文本可能被压缩存储

### sealed 叶子的存储优化

```python
import gzip
import json

def archive_leaf(leaf, storage_path):
    """将 sealed 叶子归档到压缩存储"""
    leaf_data = {
        'id': leaf.id,
        'raw_text': leaf.raw_text,
        'entities': leaf.entities,
        'topic_id': leaf.topic_id,
        'importance_score': leaf.importance_score,
        'summary': leaf.summary,
        'created_at': leaf.created_at.isoformat(),
        'sealed_at': leaf.sealed_at.isoformat(),
        'access_count': leaf.access_count,
        'state_history': leaf.state_history,
    }
    
    # 压缩存储
    archive_path = f"{storage_path}/sealed/{leaf.id}.json.gz"
    with gzip.open(archive_path, 'wt', encoding='utf-8') as f:
        json.dump(leaf_data, f, ensure_ascii=False)
```

### sealed 叶子的召回

当用户查询恰好命中 sealed 叶子的实体时，叶子可以被"召回"到 buffered 状态：

```python
def recall_from_sealed(leaf_id, memory_tree):
    """将 sealed 叶子召回为 buffered"""
    leaf = memory_tree.get_leaf(leaf_id)
    
    if leaf.state != 'sealed':
        raise ValueError(f"Can only recall sealed leaves, got {leaf.state}")
    
    # 从冷存储加载
    if leaf.is_archived:
        leaf_data = memory_tree.load_archived_leaf(leaf_id)
        leaf.restore_from_archive(leaf_data)
    
    # 检查缓冲区容量
    buffered = memory_tree.get_leaves_by_state('buffered')
    if len(buffered) >= MAX_BUFFER_SIZE:
        evict_lru_leaf(memory_tree)
    
    # 转换状态
    leaf.state = 'buffered'
    leaf.access_count += 1
    leaf.last_accessed = datetime.now()
    leaf.state_history.append({
        'state': 'buffered',
        'entered_at': datetime.now(),
        'trigger': 'recall_from_sealed'
    })
    
    memory_tree.active_context.add(leaf)
    
    return leaf
```

---

## 状态转换触发条件

### 时间驱动转换

```python
class TimeBasedTransition:
    """基于时间的状态转换规则"""
    
    # admitted → sealed：超过 7 天未被激活
    ADMITTED_TO_SEALED_TIMEOUT = timedelta(days=7)
    
    # buffered → sealed：超过 4 小时未被访问
    BUFFERED_TO_SEALED_TIMEOUT = timedelta(hours=4)
    
    # pending_extraction → 超时告警
    PENDING_TIMEOUT = timedelta(hours=1)
    
    def check_transitions(self, memory_tree):
        now = datetime.now()
        
        # 检查 admitted 叶子
        for leaf in memory_tree.get_leaves_by_state('admitted'):
            if now - leaf.created_at > self.ADMITTED_TO_SEALED_TIMEOUT:
                if leaf.importance_score < 0.3:
                    leaf.transition_to('sealed', reason='time_decay_low_importance')
        
        # 检查 buffered 叶子
        for leaf in memory_tree.get_leaves_by_state('buffered'):
            if leaf.last_accessed and now - leaf.last_accessed > self.BUFFERED_TO_SEALED_TIMEOUT:
                leaf.transition_to('sealed', reason='time_decay_inactive')
```

### 容量驱动转换

```python
class CapacityBasedTransition:
    """基于容量的状态转换规则"""
    
    MAX_BUFFERED = 50
    MAX_ADMITTED = 5000
    MAX_TOTAL = 20000
    
    def check_transitions(self, memory_tree):
        # 缓冲区溢出
        buffered = memory_tree.get_leaves_by_state('buffered')
        if len(buffered) > self.MAX_BUFFERED:
            # 淘汰最不活跃的
            excess = len(buffered) - self.MAX_BUFFERED
            sorted_by_activity = sorted(
                buffered,
                key=lambda l: (l.access_count, l.last_accessed or datetime.min)
            )
            for leaf in sorted_by_activity[:excess]:
                leaf.transition_to('sealed', reason='buffer_overflow')
        
        # admitted 过多
        admitted = memory_tree.get_leaves_by_state('admitted')
        if len(admitted) > self.MAX_ADMITTED:
            excess = len(admitted) - self.MAX_ADMITTED
            sorted_by_importance = sorted(
                admitted,
                key=lambda l: l.importance_score
            )
            for leaf in sorted_by_importance[:excess]:
                leaf.transition_to('sealed', reason='admitted_overflow')
        
        # 总量检查
        total = memory_tree.total_leaf_count()
        if total > self.MAX_TOTAL:
            # 触发 GC
            self._gc_old_sealed(memory_tree)
```

### 访问频率驱动转换

```python
class AccessBasedTransition:
    """基于访问频率的状态转换规则"""
    
    # 高频阈值：5 分钟内被访问 3 次以上
    HIGH_FREQ_THRESHOLD = 3
    HIGH_FREQ_WINDOW = timedelta(minutes=5)
    
    # 低频阈值：24 小时内未被访问
    LOW_FREQ_THRESHOLD = timedelta(hours=24)
    
    def on_query(self, leaf, memory_tree):
        """每次查询命中叶子时调用"""
        leaf.access_count += 1
        leaf.last_accessed = datetime.now()
        
        # 高频访问：确保在缓冲区
        if leaf.state == 'admitted':
            recent_accesses = self._count_recent_accesses(
                leaf, self.HIGH_FREQ_WINDOW
            )
            if recent_accesses >= self.HIGH_FREQ_THRESHOLD:
                leaf.transition_to('buffered', trigger='high_frequency')
        
        # 低频访问：考虑降级
        if leaf.state == 'buffered':
            if leaf.last_accessed and \
               datetime.now() - leaf.last_accessed > self.LOW_FREQ_THRESHOLD:
                leaf.transition_to('sealed', reason='low_frequency')
```

### 手动触发转换

```python
def manual_archive(leaf_id, memory_tree, user_note=None):
    """用户手动归档叶子"""
    leaf = memory_tree.get_leaf(leaf_id)
    leaf.transition_to('sealed', reason='manual_archive', note=user_note)

def manual_pin(leaf_id, memory_tree):
    """用户手动固定叶子到缓冲区（防止被淘汰）"""
    leaf = memory_tree.get_leaf(leaf_id)
    if leaf.state == 'sealed':
        leaf = recall_from_sealed(leaf_id, memory_tree)
    elif leaf.state == 'admitted':
        leaf.transition_to('buffered', trigger='manual_pin')
    leaf.pinned = True  # 固定标记，不会被 LRU 淘汰
```

---

## 与 GC（垃圾回收）机制的对比

### 为什么不用简单删除

一个自然的问题是：为什么不直接删除不再需要的叶子，而是引入 sealed 状态？

答案在于**记忆的不确定性**：

1. **旧记忆可能再次相关**：用户三个月前讨论的 Redis 优化方案，可能在今天遇到类似问题时突然变得重要。
2. **上下文恢复需要**：当用户重新提起旧话题时，sealed 叶子可以快速召回，而删除后就永远丢失了。
3. **审计需求**：某些记忆有保留价值（例如重要的技术决策），即使不再活跃也需要保留记录。

### 与传统 GC 的对比

| 特性 | 传统 GC | OpenHuman 生命周期 |
|------|---------|-------------------|
| 目标 | 回收不再使用的内存 | 管理记忆的活跃度 |
| 判定标准 | 引用计数/可达性分析 | 访问频率/时间衰减/重要性 |
| 操作 | 直接释放 | 状态转换（封存而非删除） |
| 可逆性 | 不可逆 | 可逆（sealed → buffered） |
| 时机 | 运行时自动触发 | 定期检查 + 事件触发 |

```python
class MemoryGC:
    """OpenHuman 的记忆垃圾回收器"""
    
    def __init__(self, memory_tree):
        self.memory_tree = memory_tree
        self.gc_stats = {
            'total_gc_runs': 0,
            'leaves_sealed': 0,
            'leaves_recalled': 0,
            'storage_reclaimed': 0,
        }
    
    def run_gc(self):
        """执行一轮垃圾回收"""
        self.gc_stats['total_gc_runs'] += 1
        
        # 阶段 1：标记 — 识别应该被 seal 的叶子
        to_seal = []
        
        # 1a：缓冲区 LRU 淘汰
        buffered = self.memory_tree.get_leaves_by_state('buffered')
        unpinned = [l for l in buffered if not getattr(l, 'pinned', False)]
        if len(unpinned) > MAX_BUFFER_SIZE:
            unpinned.sort(key=lambda l: l.last_accessed or datetime.min)
            to_seal.extend(unpinned[MAX_BUFFER_SIZE:])
        
        # 1b：低重要性 admitted 超时
        admitted = self.memory_tree.get_leaves_by_state('admitted')
        for leaf in admitted:
            age = datetime.now() - leaf.created_at
            if age > timedelta(days=7) and leaf.importance_score < 0.2:
                to_seal.append(leaf)
        
        # 阶段 2：封存 — 执行状态转换
        for leaf in to_seal:
            leaf.transition_to('sealed', reason='gc')
            self.gc_stats['leaves_sealed'] += 1
        
        # 阶段 3：压缩 — 对 sealed 叶子进行存储优化
        self._compress_old_sealed()
        
        return self.gc_stats
    
    def _compress_old_sealed(self):
        """压缩长时间 sealed 的叶子"""
        sealed = self.memory_tree.get_leaves_by_state('sealed')
        for leaf in sealed:
            if leaf.sealed_at and \
               datetime.now() - leaf.sealed_at > timedelta(days=30):
                if not leaf.is_compressed:
                    self.memory_tree.compress_leaf(leaf)
                    self.gc_stats['storage_reclaimed'] += leaf.storage_size
```

---

## 并发控制：多会话同时操作同一叶子的锁策略

### 并发场景

在实际使用中，可能出现多个并发操作同时影响同一个叶子：

1. 用户在一个会话中讨论 Redis，触发相关叶子激活到 buffered
2. 同时，后台 GC 试图将同一个叶子降级到 sealed
3. 另一个会话的预取逻辑也在操作这个叶子

### 乐观锁策略

OpenHuman 使用乐观锁来处理这种并发冲突：

```python
class LeafLock:
    """叶子级别的乐观锁"""
    
    def __init__(self):
        self.version = 0  # 版本号
    
    def try_transition(self, leaf, new_state, reason):
        """尝试状态转换（乐观锁）"""
        # 读取当前版本
        current_version = leaf.version
        
        # 验证转换合法性
        if not self._is_valid_transition(leaf.state, new_state):
            return False, 'invalid_transition'
        
        # 执行转换（原子操作）
        leaf.state = new_state
        leaf.version = current_version + 1
        leaf.state_history.append({
            'state': new_state,
            'entered_at': datetime.now(),
            'reason': reason,
            'version': leaf.version
        })
        
        # 持久化并检查冲突
        try:
            self._persist_with_version_check(leaf, current_version)
            return True, 'success'
        except VersionConflictError:
            # 版本冲突：另一个操作已经修改了这个叶子
            # 回滚并重试
            self._rollback(leaf, current_version)
            return False, 'version_conflict'
    
    def _is_valid_transition(self, current, target):
        """验证状态转换是否合法"""
        valid_transitions = {
            'pending_extraction': {'admitted'},
            'admitted': {'buffered', 'sealed'},
            'buffered': {'sealed'},
            'sealed': {'buffered'},  # 只有 sealed 可以回到 buffered
        }
        return target in valid_transitions.get(current, set())
```

### 冲突解决策略

当发生版本冲突时，OpenHuman 的解决策略是：

1. **重新读取**：从持久化存储重新加载叶子的最新状态
2. **重新评估**：基于最新状态重新判断是否需要执行原操作
3. **重试（有限次数）**：最多重试 3 次

```python
def safe_transition(leaf_id, new_state, reason, memory_tree, max_retries=3):
    """带重试的安全状态转换"""
    for attempt in range(max_retries):
        leaf = memory_tree.get_leaf(leaf_id)  # 每次重新读取
        
        success, status = leaf.lock.try_transition(leaf, new_state, reason)
        
        if success:
            return True
        elif status == 'version_conflict':
            logging.info(f"Version conflict on leaf {leaf_id}, "
                        f"retry {attempt + 1}/{max_retries}")
            time.sleep(0.01 * (attempt + 1))  # 指数退避
        else:
            return False
    
    logging.error(f"Failed to transition leaf {leaf_id} after {max_retries} retries")
    return False
```

---

## 持久化与恢复：状态机的 Crash-Safe 设计

### Write-Ahead Logging (WAL)

为了保证状态机在崩溃后能正确恢复，OpenHuman 采用 Write-Ahead Logging 策略：

```python
class StateTransitionLog:
    """状态转换的预写日志"""
    
    def __init__(self, log_path):
        self.log_path = log_path
        self.log_file = open(log_path, 'a')
    
    def log_transition(self, leaf_id, from_state, to_state, reason):
        """记录状态转换到日志"""
        entry = {
            'timestamp': datetime.now().isoformat(),
            'leaf_id': leaf_id,
            'from_state': from_state,
            'to_state': to_state,
            'reason': reason,
            'checksum': None  # 稍后计算
        }
        entry['checksum'] = self._compute_checksum(entry)
        
        self.log_file.write(json.dumps(entry) + '\n')
        self.log_file.flush()  # 确保写入磁盘
        os.fsync(self.log_file.fileno())  # 强制同步
    
    def recover(self, memory_tree):
        """从日志恢复未完成的状态转换"""
        with open(self.log_path) as f:
            entries = [json.loads(line) for line in f]
        
        # 找到最后一次成功的持久化点
        last_checkpoint = memory_tree.last_checkpoint_time
        
        # 重放 checkpoint 之后的日志
        for entry in entries:
            if entry['timestamp'] > last_checkpoint:
                leaf = memory_tree.get_leaf(entry['leaf_id'])
                if leaf and leaf.state == entry['from_state']:
                    leaf.state = entry['to_state']
                    leaf.state_history.append({
                        'state': entry['to_state'],
                        'entered_at': entry['timestamp'],
                        'reason': entry['reason'] + ' (recovered)'
                    })
```

### 检查点机制

定期创建检查点，将所有叶子的状态快照持久化：

```python
def create_checkpoint(memory_tree):
    """创建状态检查点"""
    checkpoint_data = {
        'timestamp': datetime.now().isoformat(),
        'leaves': {}
    }
    
    for leaf in memory_tree.all_leaves():
        checkpoint_data['leaves'][leaf.id] = {
            'state': leaf.state,
            'version': leaf.version,
            'importance_score': leaf.importance_score,
            'access_count': leaf.access_count,
            'last_accessed': leaf.last_accessed.isoformat() if leaf.last_accessed else None,
        }
    
    checkpoint_path = f"{memory_tree.storage_path}/checkpoint.json"
    with open(checkpoint_path, 'w') as f:
        json.dump(checkpoint_data, f, indent=2)
    
    memory_tree.last_checkpoint_time = datetime.now().isoformat()
    
    # 截断已检查点覆盖的日志
    memory_tree.transition_log.truncate()
```

---

## 实战场景：一天的对话如何驱动叶子在四个状态间流转

### 时间线

让我们跟踪一个典型工作日中叶子的状态流转：

**09:00 — 用户开始工作**

```
用户："帮我查一下昨天 Redis 慢查询的日志"
→ 新建叶子 leaf_001: "帮我查一下昨天 Redis 慢查询的日志"
  状态: pending_extraction
→ 实体提取: [Redis, 慢查询, 日志]
→ 主题: 项目工作 > 性能优化
→ 状态: admitted
```

**09:05 — 继续讨论**

```
用户："慢查询主要是 KEYS 命令导致的"
→ 新建叶子 leaf_002
  状态: pending_extraction → admitted
→ leaf_001 因为与当前话题相关，被激活
  状态: admitted → buffered
```

**09:30 — 切换话题**

```
用户："对了，下午的会议几点？"
→ 新建叶子 leaf_003: 会议时间
  状态: pending_extraction → admitted
→ leaf_001, leaf_002 仍在 buffered（刚讨论过）
```

**11:00 — 缓冲区管理**

```
→ leaf_001, leaf_002 超过 1 小时未被访问
→ GC 检查：importance_score > 0.3，保留
→ 状态: buffered → sealed (time_decay_inactive)
→ 但保留了摘要："讨论了 Redis KEYS 命令导致的慢查询问题"
```

**14:00 — 再次讨论 Redis**

```
用户："Redis 慢查询的问题解决了吗？"
→ 查询命中 sealed 的 leaf_001 和 leaf_002
→ 召回: sealed → buffered
→ Agent 基于召回的记忆回答："之前发现是 KEYS 命令导致的，建议用 SCAN 替代"
```

**17:00 — 一天结束**

```
→ 所有 buffered 叶子超过 3 小时未访问
→ leaf_001, leaf_002: buffered → sealed（但有摘要）
→ leaf_003: 已在之前 sealed
→ 新建叶子 leaf_004: 一天工作总结
  状态: pending_extraction → admitted → buffered（高重要性，保持活跃）
```

### 状态分布仪表盘

一天结束时，Memory Tree 的叶子状态分布：

```
pending_extraction: 0   (所有新叶子已处理)
admitted:          12   (今天的新知识)
buffered:           1   (工作总结)
sealed:            847  (历史记忆)
─────────────────────
total:            860
```

---

## 监控与可观测性

### 状态分布指标

```python
class LifecycleMetrics:
    """叶子生命周期监控指标"""
    
    def collect(self, memory_tree):
        return {
            # 各状态叶子数量
            'leaves_pending': len(memory_tree.get_leaves_by_state('pending_extraction')),
            'leaves_admitted': len(memory_tree.get_leaves_by_state('admitted')),
            'leaves_buffered': len(memory_tree.get_leaves_by_state('buffered')),
            'leaves_sealed': len(memory_tree.get_leaves_by_state('sealed')),
            
            # 转换速率（每小时）
            'transitions_per_hour': self._calc_transition_rate(memory_tree),
            
            # 缓冲区命中率
            'buffer_hit_rate': self._calc_buffer_hit_rate(memory_tree),
            
            # 平均叶子年龄
            'avg_leaf_age_hours': self._calc_avg_age(memory_tree),
            
            # 重要性分布
            'importance_distribution': self._calc_importance_dist(memory_tree),
        }
    
    def _calc_buffer_hit_rate(self, memory_tree):
        """计算缓冲区查询命中率"""
        total_queries = memory_tree.stats.get('total_queries', 0)
        buffer_hits = memory_tree.stats.get('buffer_hits', 0)
        return buffer_hits / max(total_queries, 1)
```

### 告警规则

```python
ALERT_RULES = {
    'pending_stuck': {
        'condition': lambda m: len(m.get_leaves_by_state('pending_extraction')) > 50,
        'message': 'Too many leaves stuck in pending_extraction',
        'severity': 'warning'
    },
    'buffer_thrashing': {
        'condition': lambda m: m.stats.get('buffer_evictions_per_hour', 0) > 20,
        'message': 'High buffer eviction rate — possible thrashing',
        'severity': 'warning'
    },
    'low_hit_rate': {
        'condition': lambda m: m.metrics.buffer_hit_rate < 0.3,
        'message': 'Buffer hit rate below 30%',
        'severity': 'info'
    },
    'total_excessive': {
        'condition': lambda m: m.total_leaf_count() > 50000,
        'message': 'Total leaf count exceeds 50,000',
        'severity': 'critical'
    }
}
```

---

## 总结：生命周期管理对 AI Agent 记忆质量的影响

叶子生命周期管理不是一个"可有可无"的优化——它是 Memory Tree 在长期使用中保持高效和精准的**核心机制**。

**关键价值**：

1. **查询精准度**：通过区分活跃记忆和封存记忆，避免了旧信息的噪音干扰
2. **资源效率**：缓冲区限制和 GC 机制保证了内存和存储的合理使用
3. **上下文质量**：Agent 的上下文窗口只包含最相关、最活跃的记忆
4. **记忆可恢复**：sealed 状态保留了记忆的可恢复性，比直接删除更安全

**设计启示**：

1. **状态机是复杂系统的骨架**：清晰的状态定义和转换规则让系统行为可预测
2. **生命周期管理是系统成熟的标志**：从"全部存储"到"分级管理"是工程化的关键一步
3. **平衡记忆与遗忘**：AI Agent 需要像人类一样，既记住重要的，也遗忘无关的

叶子生命周期管理让 OpenHuman 的记忆系统从一个"只进不出"的存储引擎，进化为一个有"新陈代谢"能力的智能记忆系统。这是 AI Agent 从短期工具向长期助手转变的基础能力之一。

## 常见踩坑案例

### 缓冲区容量设置不当导致 Thrashing

`MAX_BUFFER_SIZE` 的设置是一个关键的调参点。如果设置过小（如 10），在快速对话中叶子会频繁进出缓冲区，产生严重的"抖动"（thrashing）——刚刚激活的叶子马上被淘汰，下次引用时又要从冷存储召回。建议根据用户的对话频率设置，一般 30-100 是合理范围。

### 时间衰减参数的经验调优

`BUFFERED_TO_SEALED_TIMEOUT` 默认 4 小时对活跃用户可能太短，对低频用户可能太长。一个实用的方案是根据用户的最近活跃度动态调整：如果用户在过去 1 小时内有 3 次以上对话，将超时延长到 8 小时；如果过去 24 小时无对话，缩短到 1 小时。

### 并发状态转换的数据不一致

在高并发场景下（如多个会话同时激活相关叶子），乐观锁的重试机制可能出现饥饿问题——某个叶子的状态转换被反复冲突。建议在 `safe_transition` 中加入优先级机制，让"激活"操作优先于"淘汰"操作，避免用户正在讨论的内容被后台 GC 意外降级。

## 相关阅读

- [OpenHuman 知识图谱构建实战：实体索引、关系提取与力导向可视化](/categories/架构/OpenHuman-知识图谱构建实战-实体索引-关系提取-力导向可视化/)
- [OpenHuman Obsidian Wiki 深度剖析：双向 Markdown 记忆基底与用户编辑回流机制](/categories/AI%20Agent/OpenHuman-Obsidian-Wiki-深度剖析-双向-Markdown-记忆基底与用户编辑回流机制/)
- [AI Agent 记忆系统设计](/categories/AI%20Agent/AI-Agent-记忆系统设计/)
