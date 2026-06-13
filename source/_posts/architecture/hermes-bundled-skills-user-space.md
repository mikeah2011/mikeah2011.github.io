---
title: Hermes 技能同步机制：bundled skills → user space 的增量同步与用户修改保留策略
date: 2026-06-02 00:00:00
tags: [Hermes, Skills, 同步机制, AI Agent, 版本管理]
keywords: [Hermes, bundled skills, user space, 技能同步机制, 的增量同步与用户修改保留策略, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深入解析 Hermes Agent 如何在更新内置技能的同时保留用户个性化修改：采用 Section 级 diff 与三方合并策略，结合语义感知 diff 忽略格式差异、智能冲突解决建议与原子性写入保障可靠性。涵盖 bundled skills 同步流程、用户修改检测、merge conflict 处理的完整工程实现，附实战踩坑案例与 Git diff 对比示例。
---


# Hermes 技能同步机制：bundled skills → user space 的增量同步与用户修改保留策略

## 前言

在上一篇文章中，我们宏观地分析了 Hermes Skills Hub 的分发架构。本文将聚焦于其中一个最核心的技术难题：**如何在更新内置技能的同时，保留用户对其所做的个性化修改？**

这个问题看似简单，实则涉及 diff 算法、冲突检测、语义合并、用户意图推断等多个层面。Hermes 采用了一套精巧的增量同步机制来解决这个难题。

---

## 第一章：问题的本质

### 1.1 一个常见的困境

假设用户小王在使用 Hermes 的 `laravel-expert` 技能时，发现其中的一条规则不太适合自己的项目风格，于是做了修改：

**原始版本（bundled）**：
```markdown
When writing Eloquent queries:
- Always use eager loading to avoid N+1 problems
- Use `with()` method for all relationships
```

**小王的修改（user space）**：
```markdown
When writing Eloquent queries:
- Always use eager loading to avoid N+1 problems
- Use `with()` method for hasMany/belongsTo relationships
- Use `load()` method for conditional lazy loading
```

两周后，Hermes 发布了新版本，`laravel-expert` 技能也更新了：

**新 bundled 版本**：
```markdown
When writing Eloquent queries:
- Always use eager loading to avoid N+1 problems
- Use `with()` method for all relationships
- Prefer `cursor()` for large result sets
```

问题来了：如果直接覆盖，小王的个性化修改就丢了。如果不更新，小王就错过了新的最佳实践（`cursor()` 优化）。

### 1.2 传统方案的不足

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接覆盖 | 简单，总是最新 | 丢失用户修改 |
| 不覆盖 | 保留用户修改 | 永远拿不到更新 |
| 手动合并 | 完全控制 | 操作成本高，容易出错 |
| Patch 文件 | 可追溯 | 无法处理上下文变化 |

### 1.3 Hermes 的解决方案

Hermes 的增量同步机制结合了以下技术：

1. **Section-based diff**：以 Markdown 标题为单位进行分节比较
2. **Content hash tracking**：追踪每个 section 的内容哈希
3. **Semantic merge**：理解 Markdown 语义的合并策略
4. **Conflict prediction**：预测合并冲突并提前告知用户

---

## 第二章：增量同步的数据模型

### 2.1 Section 抽象

Hermes 将一个技能文件解析为多个 section，每个 section 是一个独立的合并单元：

```python
@dataclass
class SkillSection:
    """技能文件中的一个逻辑段落"""
    heading: str           # 标题文本（如 "## When to use Eloquent"）
    level: int             # 标题级别（1-6）
    content: str           # 段落内容（不含标题行）
    raw: str               # 原始文本（含标题行）
    start_line: int        # 起始行号
    end_line: int          # 结束行号
    content_hash: str      # 内容的 SHA-256 哈希
    children: List['SkillSection']  # 子 section
```

### 2.2 Skill Manifest

每个技能文件都有一个 manifest，记录了每个 section 的元数据：

```json
{
    "skill_name": "laravel-expert",
    "version": "2.1.0",
    "file_hash": "sha256:abc123...",
    "sections": [
        {
            "heading": "## Eloquent Best Practices",
            "content_hash": "sha256:def456...",
            "start_line": 15,
            "end_line": 45
        },
        {
            "heading": "## Database Migrations",
            "content_hash": "sha256:ghi789...",
            "start_line": 46,
            "end_line": 78
        }
    ]
}
```

### 2.3 三方版本追踪

Hermes 为每个 forked 技能维护三个版本的信息：

```python
@dataclass
class ThreeWayContext:
    """三方合并的上下文"""
    base: SkillManifest       # fork 时的 bundled 版本（公共祖先）
    ours: SkillManifest       # 当前用户空间版本
    theirs: SkillManifest     # 最新的 bundled 版本
    
    # 衍生信息
    our_changes: Dict[str, ChangeType]    # 用户改了哪些 section
    their_changes: Dict[str, ChangeType]  # 上游改了哪些 section
    conflicts: List[str]                   # 冲突的 section heading 列表
```

---

## 第三章：Diff 算法详解

### 3.1 Section-level Diff

第一步是在 section 级别进行比较：

```python
def compute_section_diff(base_sections, target_sections):
    """
    计算两个版本之间的 section 级差异
    
    返回：
    - added: 新增的 section headings
    - removed: 删除的 section headings
    - modified: 内容变更的 section headings
    - unchanged: 未变更的 section headings
    - reordered: 顺序变更的 section headings
    """
    base_map = {s.heading: s for s in base_sections}
    target_map = {s.heading: s for s in target_sections}
    
    base_headings = set(base_map.keys())
    target_headings = set(target_map.keys())
    
    added = target_headings - base_headings
    removed = base_headings - target_headings
    common = base_headings & target_headings
    
    modified = set()
    unchanged = set()
    
    for heading in common:
        if base_map[heading].content_hash == target_map[heading].content_hash:
            unchanged.add(heading)
        else:
            modified.add(heading)
    
    return DiffResult(added, removed, modified, unchanged)
```

### 3.2 Content-level Diff

当一个 section 被标记为 modified 时，需要进一步进行内容级别的 diff：

```python
def compute_content_diff(base_content, target_content):
    """
    计算内容级别的差异，使用改进的 Myers 算法
    """
    base_lines = base_content.splitlines(keepends=True)
    target_lines = target_content.splitlines(keepends=True)
    
    # 使用 difflib 的 SequenceMatcher
    matcher = difflib.SequenceMatcher(None, base_lines, target_lines)
    
    changes = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            continue
        changes.append(ContentChange(
            type=tag,  # 'replace', 'insert', 'delete'
            base_range=(i1, i2),
            target_range=(j1, j2),
            base_lines=base_lines[i1:i2],
            target_lines=target_lines[j1:j2]
        ))
    
    return changes
```

### 3.3 语义级别的 Diff

纯文本 diff 在某些场景下会产生误判。Hermes 增加了语义级别的 diff：

```python
def semantic_diff(base_content, target_content):
    """
    语义级别的 diff，忽略不影响语义的变更
    
    忽略的变更：
    - 空白行数量变化
    - 行尾空格
    - Markdown 格式等价替换（如 **bold** vs __bold__）
    - 列表标记等价替换（如 - vs *）
    """
    base_normalized = normalize_markdown(base_content)
    target_normalized = normalize_markdown(target_content)
    
    if base_normalized == target_normalized:
        return SemanticDiffResult(is_semantic_change=False)
    
    # 提取语义单元（列表项、代码块、段落等）
    base_units = extract_semantic_units(base_normalized)
    target_units = extract_semantic_units(target_normalized)
    
    return SemanticDiffResult(
        is_semantic_change=True,
        changed_units=compare_units(base_units, target_units)
    )
```

---

## 第四章：合并策略

### 4.1 合并决策树

对于每个 section，Hermes 根据三个版本的状态做出合并决策：

```python
def merge_decision(base, ours, theirs):
    """
    合并决策树
    
    输入：三个版本的 section 内容（可能为 None 表示不存在）
    输出：合并结果 + 是否需要用户干预
    """
    # Case 1: 三方都相同
    if base == ours == theirs:
        return MergeResult(content=ours, action="keep", needs_review=False)
    
    # Case 2: 用户没改，上游改了
    if base == ours and base != theirs:
        return MergeResult(content=theirs, action="accept_upstream", needs_review=False)
    
    # Case 3: 用户改了，上游没改
    if base != ours and base == theirs:
        return MergeResult(content=ours, action="keep_user", needs_review=False)
    
    # Case 4: 双方都改了，但改成了相同的内容
    if base != ours and base != theirs and ours == theirs:
        return MergeResult(content=ours, action="converged", needs_review=False)
    
    # Case 5: 双方都改了，且不同 → 冲突
    if base != ours and base != theirs and ours != theirs:
        return MergeResult(
            content=conflict_markers(ours, theirs),
            action="conflict",
            needs_review=True
        )
    
    # Case 6: 新增（一方有，另一方没有）
    if base is None:
        if ours is not None and theirs is not None:
            # 双方都新增了同名 section
            if ours == theirs:
                return MergeResult(content=ours, action="converged", needs_review=False)
            else:
                return MergeResult(
                    content=conflict_markers(ours, theirs),
                    action="conflict",
                    needs_review=True
                )
        elif ours is not None:
            return MergeResult(content=ours, action="keep_user", needs_review=False)
        else:
            return MergeResult(content=theirs, action="accept_upstream", needs_review=False)
    
    # Case 7: 删除（一方删除了）
    if ours is None and theirs is None:
        return MergeResult(content=None, action="both_deleted", needs_review=False)
    if ours is None:
        return MergeResult(content=None, action="user_deleted", needs_review=True)
    if theirs is None:
        return MergeResult(content=ours, action="upstream_deleted", needs_review=True)
```

### 4.2 冲突标记格式

当发生冲突时，Hermes 使用类似 Git 的冲突标记格式：

```markdown
## Eloquent Best Practices

<<<<<<< YOUR VERSION
When writing Eloquent queries:
- Always use eager loading to avoid N+1 problems
- Use `with()` method for hasMany/belongsTo relationships
- Use `load()` method for conditional lazy loading
=======
When writing Eloquent queries:
- Always use eager loading to avoid N+1 problems
- Use `with()` method for all relationships
- Prefer `cursor()` for large result sets
>>>>>>> UPSTREAM v2.1.0
```

### 4.3 智能冲突解决建议

对于某些常见的冲突模式，Hermes 可以提供智能建议：

```python
def suggest_resolution(base, ours, theirs, conflict_type):
    """
    根据冲突类型提供解决建议
    """
    if conflict_type == "append_conflict":
        # 双方都在末尾追加了内容
        # 建议：合并两者的追加内容
        return MergeSuggestion(
            strategy="concatenate",
            description="Both versions added content at the end. Consider merging both additions.",
            suggested_content = base + "\n" + extract_addition(base, ours) + "\n" + extract_addition(base, theirs)
        )
    
    if conflict_type == "list_item_conflict":
        # 双方修改了同一个列表的不同项
        # 建议：合并列表
        return MergeSuggestion(
            strategy="list_union",
            description="Both versions modified different list items. Consider merging the lists.",
            suggested_content = merge_lists(ours, theirs)
        )
    
    if conflict_type == "refinement_conflict":
        # 双方对同一内容做了不同的细化
        # 建议：让用户手动选择
        return MergeSuggestion(
            strategy="manual",
            description="Both versions refined the same content differently. Manual resolution needed."
        )
```

---

## 第五章：增量同步的执行流程

### 5.1 完整的同步流程

```python
async def sync_skill(skill_name):
    """
    同步单个技能的完整流程
    """
    # Step 1: 加载三个版本
    base_manifest = load_manifest(skill_name, version="base")
    ours_manifest = load_manifest(skill_name, version="user")
    theirs_manifest = load_manifest(skill_name, version="bundled_latest")
    
    # Step 2: 检查是否需要同步
    if ours_manifest.file_hash == theirs_manifest.file_hash:
        return SyncResult(action="no_change")
    
    # Step 3: 计算差异
    our_diff = compute_section_diff(base_manifest.sections, ours_manifest.sections)
    their_diff = compute_section_diff(base_manifest.sections, theirs_manifest.sections)
    
    # Step 4: 识别冲突
    potential_conflicts = our_diff.modified & their_diff.modified
    
    # Step 5: 执行合并
    merge_results = {}
    for section_heading in all_sections(base_manifest, ours_manifest, theirs_manifest):
        base = get_section(base_manifest, section_heading)
        ours = get_section(ours_manifest, section_heading)
        theirs = get_section(theirs_manifest, section_heading)
        
        result = merge_decision(base, ours, theirs)
        merge_results[section_heading] = result
    
    # Step 6: 处理冲突
    conflicts = {k: v for k, v in merge_results.items() if v.needs_review}
    
    if conflicts:
        # 生成冲突报告
        report = generate_conflict_report(conflicts)
        
        if is_interactive():
            # 交互模式：让用户解决冲突
            resolved = await interactive_resolve(conflicts)
            merge_results.update(resolved)
        else:
            # 非交互模式：保留用户版本，记录冲突
            for heading, result in conflicts.items():
                if result.action == "conflict":
                    merge_results[heading] = MergeResult(
                        content=ours_manifest.get_section(heading).content,
                        action="kept_user_due_to_conflict",
                        needs_review=True
                    )
    
    # Step 7: 生成合并后的文件
    merged_content = assemble_skill_file(merge_results)
    
    # Step 8: 写入并更新 lock file
    write_skill(skill_name, merged_content)
    update_lock_file(skill_name, merged_content)
    
    # Step 9: 生成同步报告
    return SyncResult(
        action="merged",
        sections_updated=len(their_diff.modified) - len(conflicts),
        sections_kept=len(our_diff.modified) - len(conflicts),
        conflicts=len(conflicts),
        report=generate_sync_report(merge_results)
    )
```

### 5.2 同步报告示例

```
🔄 Skill Sync Report: laravel-expert
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📦 Upstream version: 1.0.0 → 2.1.0
   📝 Your modifications: 3 sections modified
   
   ✅ Auto-merged sections:
      • "## Database Migrations" (upstream update applied)
      • "## Error Handling" (your modification kept)
      • "## Testing Patterns" (new section from upstream)
   
   ⚠️  Conflicts requiring review:
      • "## Eloquent Best Practices" - both versions modified
   
   📊 Summary:
      • 12 sections unchanged
      • 3 sections auto-merged
      • 1 section conflict (your version kept, review recommended)
      
   Run `hermes skill resolve laravel-expert` to review conflicts.
```

---

## 第六章：高级特性

### 6.1 增量 Diff 的优化

对于大型技能文件（数百行），逐行 diff 可能很慢。Hermes 使用了多级优化：

```python
class IncrementalDiffEngine:
    """增量 diff 引擎，支持多级优化"""
    
    def __init__(self):
        self.section_cache = {}      # section hash 缓存
        self.content_cache = {}      # 内容 diff 缓存
    
    def fast_diff(self, base_manifest, target_manifest):
        """
        快速 diff：先比较文件级 hash，再比较 section 级 hash
        大多数情况下可以在 O(1) 时间内判断是否有变化
        """
        # Level 1: 文件级比较
        if base_manifest.file_hash == target_manifest.file_hash:
            return DiffResult.no_change()
        
        # Level 2: Section 级比较
        changed_sections = []
        for base_s, target_s in zip(base_manifest.sections, target_manifest.sections):
            if base_s.heading != target_s.heading:
                # 结构变化，需要完全重算
                return self.full_diff(base_manifest, target_manifest)
            
            if base_s.content_hash != target_s.content_hash:
                changed_sections.append(target_s.heading)
        
        return DiffResult(modified_sections=changed_sections)
```

### 6.2 用户修改的分类

Hermes 将用户的修改分为几类，以便在合并时采取不同策略：

```python
class UserModificationType(Enum):
    """用户修改类型"""
    CONTENT_CHANGE = "content_change"      # 修改了内容
    ADDITION = "addition"                   # 新增了内容
    DELETION = "deletion"                   # 删除了内容
    REORDER = "reorder"                    # 调整了顺序
    FORMATTING = "formatting"              # 格式化修改（不影响语义）
    ANNOTATION = "annotation"              # 添加了注释或备注
```

### 6.3 合并的原子性

为了确保合并过程的可靠性，Hermes 采用了原子写入策略：

```python
async def atomic_merge_write(skill_name, merged_content, lock_data):
    """原子性地写入合并结果"""
    temp_path = f"~/.hermes/skills/.{skill_name}.tmp"
    target_path = f"~/.hermes/skills/{skill_name}.md"
    backup_path = f"~/.hermes/skills/.{skill_name}.bak"
    
    try:
        # 1. 先写入临时文件
        write_file(temp_path, merged_content)
        
        # 2. 备份当前版本
        if os.path.exists(target_path):
            copy_file(target_path, backup_path)
        
        # 3. 原子替换
        os.rename(temp_path, target_path)
        
        # 4. 更新 lock file
        update_lock_file(lock_data)
        
    except Exception as e:
        # 回滚
        if os.path.exists(backup_path):
            copy_file(backup_path, target_path)
        raise MergeError(f"Atomic merge failed: {e}")
    
    finally:
        # 清理临时文件
        cleanup(temp_path, backup_path)
```

### 6.4 批量同步

当需要同步多个技能时，Hermes 支持批量处理：

```python
async def batch_sync(skill_names, strategy="parallel"):
    """
    批量同步多个技能
    
    strategy:
    - "parallel": 并行同步（推荐）
    - "sequential": 顺序同步（调试用）
    - "fail-fast": 遇到冲突立即停止
    """
    if strategy == "parallel":
        tasks = [sync_skill(name) for name in skill_names]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    elif strategy == "sequential":
        results = []
        for name in skill_names:
            result = await sync_skill(name)
            results.append(result)
            if strategy == "fail-fast" and result.has_conflicts:
                break
    
    return BatchSyncResult(results)
```

---

## 第七章：边界情况处理

### 7.1 Section 重命名

当上游重命名了一个 section heading 时：

```python
def detect_rename(base_sections, theirs_sections, ours_sections):
    """
    检测 section 重命名
    
    策略：如果一个 section 被删除，同时有一个新 section 的内容与之相似，
    则认为是重命名
    """
    removed = set(base_sections.keys()) - set(theirs_sections.keys())
    added = set(theirs_sections.keys()) - set(base_sections.keys())
    
    renames = {}
    for old_heading in removed:
        for new_heading in added:
            similarity = compute_similarity(
                base_sections[old_heading].content,
                theirs_sections[new_heading].content
            )
            if similarity > 0.8:  # 80% 相似度阈值
                renames[old_heading] = new_heading
                break
    
    return renames
```

### 7.2 嵌套 Section 的处理

Markdown 中的嵌套标题（h2 > h3 > h4）需要特殊处理：

```python
def merge_nested_sections(base, ours, theirs):
    """
    合并嵌套 section 时，需要保持层级关系
    
    规则：
    - 子 section 的合并独立于父 section
    - 父 section 的内容（标题和第一个子标题之间的部分）单独合并
    - 如果父 section 被删除，所有子 section 也被删除
    """
    base_tree = build_section_tree(base)
    ours_tree = build_section_tree(ours)
    theirs_tree = build_section_tree(theirs)
    
    return merge_trees(base_tree, ours_tree, theirs_tree)
```

### 7.3 空 Section 的处理

有时用户会清空一个 section 的内容（但保留标题），这与删除 section 是不同的：

```python
def handle_empty_section(base_content, ours_content, theirs_content):
    """
    区分"清空内容"和"删除 section"
    """
    if ours_content == "" and base_content != "":
        # 用户有意清空了这个 section
        # 上游更新时，应该尊重用户的意图
        return MergeResult(content="", action="user_emptied", needs_review=True)
```

### 7.4 循环更新检测

防止同步过程中的无限循环：

```python
def detect_update_loop(skill_name, recent_hashes):
    """
    检测是否存在更新循环（A→B→A→B...）
    """
    if len(recent_hashes) < 4:
        return False
    
    # 检查最近 4 个 hash 是否构成 ABAB 模式
    if (recent_hashes[-1] == recent_hashes[-3] and 
        recent_hashes[-2] == recent_hashes[-4]):
        raise UpdateLoopError(
            f"Detected update loop for skill '{skill_name}'. "
            f"Hash pattern: ABAB detected."
        )
    
    return False
```

---

## 第八章：性能优化

### 8.1 哈希缓存

为了避免重复计算哈希，Hermes 维护了一个多级缓存：

```python
class HashCache:
    """多级哈希缓存"""
    
    def __init__(self):
        self.memory_cache = {}     # 内存缓存（LRU）
        self.disk_cache_path = "~/.hermes/.hash_cache"
        self.disk_cache = self._load_disk_cache()
    
    def get_hash(self, content):
        content_key = hashlib.md5(content.encode()).hexdigest()
        
        # 查内存缓存
        if content_key in self.memory_cache:
            return self.memory_cache[content_key]
        
        # 查磁盘缓存
        if content_key in self.disk_cache:
            hash_value = self.disk_cache[content_key]
            self.memory_cache[content_key] = hash_value
            return hash_value
        
        # 计算并缓存
        hash_value = hashlib.sha256(content.encode()).hexdigest()
        self.memory_cache[content_key] = hash_value
        self.disk_cache[content_key] = hash_value
        
        return hash_value
```

### 8.2 增量解析

对于大型技能文件，Hermes 支持增量解析：

```python
def incremental_parse(file_path, previous_manifest):
    """
    增量解析：只重新解析发生变化的部分
    """
    with open(file_path, 'r') as f:
        content = f.read()
    
    # 快速检查：文件 hash 是否变化
    current_hash = hashlib.sha256(content.encode()).hexdigest()
    if current_hash == previous_manifest.file_hash:
        return previous_manifest  # 无变化，直接返回缓存
    
    # 逐行扫描，找到第一个变化的 section
    lines = content.splitlines()
    first_changed_line = None
    
    for section in previous_manifest.sections:
        section_content = "\n".join(lines[section.start_line:section.end_line])
        section_hash = hashlib.sha256(section_content.encode()).hexdigest()
        
        if section_hash != section.content_hash:
            first_changed_line = section.start_line
            break
    
    if first_changed_line is None:
        return previous_manifest
    
    # 从变化点开始重新解析
    new_sections = parse_sections_from_line(lines, first_changed_line)
    
    # 合并未变化的 section
    return merge_manifests(previous_manifest, new_sections, first_changed_line)
```

---

## 第九章：测试策略

### 9.1 合并正确性测试

```python
class MergeCorrectnessTest:
    """合并正确性的测试用例"""
    
    def test_no_changes(self):
        """三方都无变化时，结果应该不变"""
        base = "## Section A\nContent A"
        result = three_way_merge(base, base, base)
        assert result.content == base
        assert result.action == "keep"
    
    def test_user_only_change(self):
        """只有用户修改时，保留用户版本"""
        base = "## Section A\nContent A"
        ours = "## Section A\nContent A Modified"
        result = three_way_merge(base, ours, base)
        assert result.content == ours
        assert result.action == "keep_user"
    
    def test_upstream_only_change(self):
        """只有上游修改时，接受上游版本"""
        base = "## Section A\nContent A"
        theirs = "## Section A\nContent A Updated"
        result = three_way_merge(base, base, theirs)
        assert result.content == theirs
        assert result.action == "accept_upstream"
    
    def test_both_changed_same(self):
        """双方修改成相同时，结果应该一致"""
        base = "## Section A\nContent A"
        modified = "## Section A\nContent B"
        result = three_way_merge(base, modified, modified)
        assert result.content == modified
        assert result.action == "converged"
    
    def test_conflict(self):
        """双方不同修改时，应该标记为冲突"""
        base = "## Section A\nContent A"
        ours = "## Section A\nContent B"
        theirs = "## Section A\nContent C"
        result = three_way_merge(base, ours, theirs)
        assert result.action == "conflict"
        assert "<<<<<<< " in result.content
```

### 9.2 边界情况测试

```python
class EdgeCaseTest:
    """边界情况测试"""
    
    def test_empty_file_merge(self):
        """空文件的合并"""
        result = three_way_merge("", "new content", "")
        assert result.content == "new content"
    
    def test_single_line_change(self):
        """单行修改的精确合并"""
        base = "Line 1\nLine 2\nLine 3"
        ours = "Line 1\nLine 2 Modified\nLine 3"
        theirs = "Line 1\nLine 2\nLine 3 Modified"
        result = three_way_merge(base, ours, theirs)
        assert "Line 2 Modified" in result.content
        assert "Line 3 Modified" in result.content
    
    def test_section_reorder(self):
        """Section 顺序调整"""
        base = "## A\n...\n## B\n..."
        ours = "## B\n...\n## A\n..."  # 用户调整了顺序
        theirs = "## A\n...updated\n## B\n..."  # 上游更新了内容
        result = three_way_merge(base, ours, theirs)
        # 应该保留用户的顺序，但更新内容
        assert result.content.index("## B") < result.content.index("## A")
```

---

## 第十章：与 Git Merge 的对比

### 10.1 相似之处

| 特性 | Git Merge | Hermes Sync |
|------|-----------|-------------|
| 三方合并 | ✅ | ✅ |
| 冲突标记 | ✅ | ✅ |
| 自动合并 | ✅ | ✅ |
| 手动解决 | ✅ | ✅ |

### 10.2 关键差异

| 特性 | Git Merge | Hermes Sync |
|------|-----------|-------------|
| 合并粒度 | 行级 | Section 级 |
| 语义理解 | 无 | 理解 Markdown 结构 |
| 冲突预测 | 无 | 可预测潜在冲突 |
| 用户意图推断 | 无 | 根据修改类型推断 |
| 自动解决建议 | 无 | 提供智能建议 |

### 10.3 为什么不用 Git？

一个自然的问题是：为什么不直接用 Git 来管理技能文件？

答案是：

1. **用户不应感知 Git**：Hermes 的目标用户不一定熟悉 Git
2. **合并粒度不同**：Git 的行级合并在 Markdown 场景下太细了
3. **特殊的合并语义**：技能文件有特定的合并规则（如 section 重命名检测）
4. **轻量级**：不需要 `.git` 目录的开销

---

## 总结

Hermes 的技能增量同步机制通过以下设计解决了"更新 vs 自定义"这一核心矛盾：

1. **Section 级别的 diff 和合并**：比行级更智能，比全文更精确
2. **三方合并策略**：基于 Git 的成熟理论，但针对 Markdown 做了优化
3. **语义感知的 diff**：忽略格式差异，关注实际内容变化
4. **智能冲突解决建议**：不只是标记冲突，还提供解决方案
5. **原子性写入**：确保合并过程的可靠性

这套机制让 Hermes 的用户可以放心地定制技能，同时不担心错过上游的更新——这正是一个健康的技能生态系统所需要的基础。

---

*本文基于 Hermes Agent v0.4.x 源码分析，相关设计可能随版本迭代而演进。*

## 相关阅读

- [Hermes Skills Hub 分发架构：seed-then-fork 模型、quarantine 审计、lock file 溯源](/categories/架构/Hermes-Skills-Hub-分发架构-seed-then-fork-模型-quarantine-审计-lock-file-溯源/)
- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？](/categories/架构/Hermes-Skill-vs-Plugin-扩展点对比-什么时候用-Skill-什么时候用-Plugin/)
- [Hermes 插件系统深度剖析：PluginContext 注册、tool/CLI/slash command 扩展点](/categories/架构/Hermes-插件系统深度剖析-PluginContext注册-tool-CLI-slash-command扩展点/)
---
