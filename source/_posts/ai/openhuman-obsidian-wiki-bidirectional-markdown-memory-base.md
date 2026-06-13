---

title: OpenHuman Obsidian Wiki 深度剖析：双向 Markdown 记忆基底与用户编辑回流机制
keywords: [OpenHuman Obsidian Wiki, Markdown, 深度剖析, 双向, 记忆基底与用户编辑回流机制]
date: 2026-06-02 00:00:00
tags:
- OpenHuman
- Obsidian
- Wiki
- Markdown
- 知识管理
- AI Agent
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: AI Agent 的记忆系统如何让用户直接查看和编辑？OpenHuman 的 Obsidian Wiki 模块将全部记忆以标准 Markdown 文件暴露在 Obsidian Vault 中，实现 Agent 写入与用户编辑的双向流动。本文深度剖析 Wiki Sync Engine 架构、实体提取与渲染、文件监控器设计、冲突解决策略，以及 Obsidian 插件集成方案，让你的 AI Agent 拥有透明可控的知识图谱。
---



# OpenHuman Obsidian Wiki 深度剖析：双向 Markdown 记忆基底与用户编辑回流机制

## 前言

在 AI Agent 的记忆系统设计中，一个长期被忽视的问题是：**用户如何直接查看和编辑 Agent 的记忆？** 传统方案中，Agent 的记忆存储在数据库或专有格式中，用户只能通过 API 或 UI 界面间接访问。这导致两个问题：一是用户对 Agent "记住了什么"缺乏透明度；二是用户无法方便地纠正 Agent 的错误记忆。

OpenHuman 的 Obsidian Wiki 模块提供了一个优雅的解决方案：**将 Agent 的全部记忆以标准 Markdown 文件的形式暴露在 Obsidian Vault 中**，用户可以用 Obsidian（或任何 Markdown 编辑器）直接浏览和编辑。Agent 会自动检测用户的编辑，并将修改回流到记忆系统中。

本文将深入剖析这个双向 Markdown 记忆基底的架构设计和实现细节。

## 一、架构总览

### 1.1 核心设计理念

OpenHuman Obsidian Wiki 的设计遵循三个原则：

1. **人类可读**：所有记忆都以人类可读的 Markdown 格式存储，而非二进制数据库
2. **双向流动**：Agent 写入记忆 ↔ 用户编辑回流，形成闭环
3. **图结构**：利用 Obsidian 的双向链接（`[[wikilink]]`）构建知识图谱

### 1.2 系统架构

```
┌──────────────────────────────────────────────────┐
│                  OpenHuman Core                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Memory    │  │ Entity   │  │ Conversation │   │
│  │ Manager   │  │ Extractor│  │ History      │   │
│  └─────┬────┘  └─────┬────┘  └──────┬───────┘   │
│        │             │              │            │
│        ▼             ▼              ▼            │
│  ┌──────────────────────────────────────────┐    │
│  │         Wiki Sync Engine                 │    │
│  │  ┌────────┐ ┌────────┐ ┌────────────┐   │    │
│  │  │ Writer │ │ Watcher│ │ Conflict   │   │    │
│  │  │        │ │        │ │ Resolver   │   │    │
│  │  └────────┘ └────────┘ └────────────┘   │    │
│  └──────────────────┬───────────────────────┘    │
│                     │                            │
└─────────────────────┼────────────────────────────┘
                      │
                      ▼
        ┌──────────────────────────┐
        │    Obsidian Vault        │
        │  ┌────────────────────┐  │
        │  │ wiki/              │  │
        │  │ ├── people/        │  │
        │  │ │   ├── Alice.md   │  │
        │  │ │   └── Bob.md     │  │
        │  │ ├── projects/      │  │
        │  │ │   └── ProjectX.md│  │
        │  │ ├── topics/        │  │
        │  │ │   └── AI.md      │  │
        │  │ ├── daily/         │  │
        │  │ │   └── 2026-06-02 │  │
        │  │ └── index.md       │  │
        │  └────────────────────┘  │
        │                          │
        │  User edits via Obsidian │
        └──────────────────────────┘
```

## 二、Markdown 文件结构设计

### 2.1 文件组织

OpenHuman 的 Wiki 文件按类型分目录组织：

```
wiki/
├── index.md              # 首页：全局摘要和导航
├── people/               # 人物实体
│   ├── Alice.md
│   ├── Bob.md
│   └── _template.md      # 人物模板
├── projects/             # 项目实体
│   ├── ProjectX.md
│   └── _template.md
├── topics/               # 话题/知识实体
│   ├── AI.md
│   ├── Laravel.md
│   └── _template.md
├── conversations/        # 对话记录
│   ├── 2026-06-02/
│   │   ├── 14-30-meeting-notes.md
│   │   └── 16-00-code-review.md
│   └── _template.md
├── daily/                # 每日摘要
│   ├── 2026-06-01.md
│   └── 2026-06-02.md
├── learnings/            # 学习笔记
│   ├── python-async.md
│   └── k8s-hpa.md
└── system/               # 系统配置（用户不应编辑）
    ├── sync-state.json
    └── entity-index.json
```

### 2.2 文件模板

每个实体文件遵循统一的 frontmatter + body 结构：

```markdown
---
entity_type: person
entity_id: alice_chen
created: 2026-05-15T10:30:00+08:00
updated: 2026-06-02T14:20:00+08:00
tags: [colleague, backend, laravel]
aliases: [Alice, 陈晓, 晓晓]
sync_status: synced
user_edited: false
---

# Alice Chen (陈晓)

## 基本信息
- **角色**: 后端工程师
- **团队**: Platform Team
- **技术栈**: [[Laravel]], [[PHP]], [[MySQL]], [[Redis]]

## 交互历史
- 最近讨论了 [[ProjectX]] 的数据库迁移方案
- 2026-06-01 提到了对 [[Kubernetes]] HPA 的优化建议
- 擅长性能优化，对 [[Redis]] 缓存策略有深入理解

## 偏好与特点
- 喜欢简洁的代码风格
- 对 Type Hint 非常严格
- 偏好使用 [[Pest]] 而非 PHPUnit

## 笔记
> 用户可以在此处自由添加笔记，Agent 会自动检测并整合

---
*最后同步: 2026-06-02 14:20:00 | 同步状态: ✅ 已同步*
```

### 2.3 双向链接的设计

OpenHuman 大量使用 Obsidian 的双向链接 `[[entity]]` 来构建实体间的关系网络：

```markdown
## 在 Alice.md 中：
- 技术栈: [[Laravel]], [[PHP]]
- 参与项目: [[ProjectX]], [[ProjectY]]

## 在 ProjectX.md 中：
- 团队成员: [[Alice]], [[Bob]]
- 技术栈: [[Laravel]], [[PostgreSQL]]
- 相关话题: [[DDD]], [[CQRS]]
```

当用户在 Obsidian 中打开 `Alice.md` 时，右侧面板会自动显示所有反向链接（backlinks），形成一个可视化的知识图谱。

## 三、Wiki Sync Engine

### 3.1 同步引擎架构

```python
# openhuman/wiki/sync_engine.py
import asyncio
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class FileState:
    """文件状态"""
    path: str
    content_hash: str
    last_modified: float
    last_synced: float
    user_edited: bool = False
    agent_edited: bool = False


@dataclass
class SyncResult:
    """同步结果"""
    files_written: int = 0
    files_updated: int = 0
    files_deleted: int = 0
    conflicts_detected: int = 0
    conflicts_resolved: int = 0
    errors: List[str] = field(default_factory=list)


class WikiSyncEngine:
    """
    Wiki 同步引擎。

    核心职责：
    1. 将 Agent 记忆系统中的实体写入 Markdown 文件
    2. 监控用户对 Markdown 文件的编辑
    3. 检测和解决双向编辑冲突
    4. 维护文件状态索引
    """

    def __init__(self, vault_path: str, memory_manager, entity_extractor):
        self.vault_path = Path(vault_path)
        self.memory_manager = memory_manager
        self.entity_extractor = entity_extractor
        self.state_file = self.vault_path / "system" / "sync-state.json"
        self.entity_index_file = self.vault_path / "system" / "entity-index.json"

        # 文件状态缓存
        self.file_states: Dict[str, FileState] = {}
        self._load_state()

        # 确保目录结构
        self._ensure_directories()

    def _ensure_directories(self):
        """确保所有目录存在"""
        for subdir in ['people', 'projects', 'topics', 'conversations', 'daily', 'learnings', 'system']:
            (self.vault_path / subdir).mkdir(parents=True, exist_ok=True)

    def _load_state(self):
        """加载文件状态"""
        if self.state_file.exists():
            with open(self.state_file, 'r') as f:
                data = json.load(f)
                for path, state in data.items():
                    self.file_states[path] = FileState(**state)

    def _save_state(self):
        """保存文件状态"""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        data = {path: {
            'path': s.path,
            'content_hash': s.content_hash,
            'last_modified': s.last_modified,
            'last_synced': s.last_synced,
            'user_edited': s.user_edited,
            'agent_edited': s.agent_edited,
        } for path, s in self.file_states.items()}
        with open(self.state_file, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _compute_hash(self, content: str) -> str:
        """计算内容 hash"""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]

    async def sync_all(self) -> SyncResult:
        """
        执行全量同步。

        流程：
        1. 从记忆系统获取所有实体
        2. 检测用户编辑（文件 hash 变化）
        3. 处理冲突
        4. 写入/更新文件
        """
        result = SyncResult()
        start_time = time.time()

        # 步骤 1：获取所有实体
        entities = await self.memory_manager.get_all_entities()
        logger.info(f"Syncing {len(entities)} entities to Wiki vault")

        # 步骤 2：检测用户编辑
        user_edits = self._detect_user_edits()
        if user_edits:
            logger.info(f"Detected {len(user_edits)} user-edited files")
            await self._process_user_edits(user_edits, result)

        # 步骤 3：写入/更新实体文件
        for entity in entities:
            try:
                file_path = self._entity_to_path(entity)
                existing_content = self._read_file(file_path)
                new_content = self._render_entity(entity)

                if existing_content is None:
                    # 新文件
                    self._write_file(file_path, new_content)
                    result.files_written += 1
                else:
                    # 检查是否有冲突
                    state = self.file_states.get(str(file_path))
                    if state and state.user_edited:
                        # 用户编辑过，需要合并
                        merged = self._merge_content(existing_content, new_content, entity)
                        self._write_file(file_path, merged)
                        result.conflicts_resolved += 1
                        result.files_updated += 1
                    else:
                        # Agent 直接更新
                        if self._compute_hash(existing_content) != self._compute_hash(new_content):
                            self._write_file(file_path, new_content)
                            result.files_updated += 1

            except Exception as e:
                result.errors.append(f"Error syncing entity {entity.get('id', '?')}: {e}")
                logger.error(f"Sync error: {e}", exc_info=True)

        # 步骤 4：生成索引页
        self._generate_index(entities)

        self._save_state()

        elapsed = time.time() - start_time
        logger.info(
            f"Sync complete in {elapsed:.1f}s: "
            f"written={result.files_written}, updated={result.files_updated}, "
            f"conflicts={result.conflicts_resolved}, errors={len(result.errors)}"
        )

        return result

    def _detect_user_edits(self) -> List[Tuple[str, str]]:
        """
        检测用户编辑：比较文件 hash 与上次同步时的 hash。

        返回 [(file_path, current_content), ...]
        """
        user_edits = []

        for subdir in ['people', 'projects', 'topics', 'learnings']:
            dir_path = self.vault_path / subdir
            if not dir_path.exists():
                continue

            for md_file in dir_path.glob("*.md"):
                if md_file.name.startswith('_'):
                    continue

                file_key = str(md_file)
                current_content = md_file.read_text(encoding='utf-8')
                current_hash = self._compute_hash(current_content)

                state = self.file_states.get(file_key)
                if state:
                    if current_hash != state.content_hash:
                        # 文件被修改了
                        # 判断是用户修改还是 Agent 修改
                        if not state.agent_edited:
                            # 不是 Agent 修改的，那就是用户修改的
                            user_edits.append((file_key, current_content))
                            state.user_edited = True
                        else:
                            # Agent 也修改了，标记为潜在冲突
                            state.agent_edited = False  # 重置标记

        return user_edits

    async def _process_user_edits(self, edits: List[Tuple[str, str]], result: SyncResult):
        """处理用户编辑"""
        for file_path, content in edits:
            try:
                # 解析 Markdown 内容
                entity_data = self._parse_markdown(content)

                # 回流到记忆系统
                await self.memory_manager.update_entity_from_wiki(entity_data)
                logger.info(f"User edit synced back: {file_path}")

                # 更新状态
                state = self.file_states.get(file_path)
                if state:
                    state.user_edited = False
                    state.last_synced = time.time()
                    state.content_hash = self._compute_hash(content)

            except Exception as e:
                result.errors.append(f"Error processing user edit {file_path}: {e}")
                logger.error(f"User edit processing error: {e}", exc_info=True)

    def _entity_to_path(self, entity: dict) -> Path:
        """将实体映射为文件路径"""
        entity_type = entity.get('type', 'unknown')
        entity_id = entity.get('id', 'unknown')

        type_to_dir = {
            'person': 'people',
            'project': 'projects',
            'topic': 'topics',
            'learning': 'learnings',
            'conversation': 'conversations',
        }

        subdir = type_to_dir.get(entity_type, 'topics')
        # 文件名规范化
        safe_name = entity_id.replace('/', '-').replace('\\', '-')
        return self.vault_path / subdir / f"{safe_name}.md"

    def _render_entity(self, entity: dict) -> str:
        """将实体渲染为 Markdown"""
        entity_type = entity.get('type', 'unknown')
        name = entity.get('name', entity.get('id', 'Unknown'))
        aliases = entity.get('aliases', [])
        tags = entity.get('tags', [])

        # Frontmatter
        frontmatter = [
            "---",
            f"entity_type: {entity_type}",
            f"entity_id: {entity.get('id', '')}",
            f"created: {entity.get('created', datetime.now().isoformat())}",
            f"updated: {datetime.now().isoformat()}",
            f"tags: [{', '.join(tags)}]",
            f"aliases: [{', '.join(aliases)}]",
            "sync_status: synced",
            "user_edited: false",
            "---",
        ]

        # Body
        body = [f"\n# {name}\n"]

        # 基本信息
        if entity.get('attributes'):
            body.append("## 基本信息")
            for key, value in entity['attributes'].items():
                if isinstance(value, list):
                    # 列表值使用双向链接
                    linked = [f"[[{v}]]" for v in value]
                    body.append(f"- **{key}**: {', '.join(linked)}")
                else:
                    body.append(f"- **{key}**: {value}")
            body.append("")

        # 关系
        if entity.get('relations'):
            body.append("## 关系")
            for rel in entity['relations']:
                target = rel.get('target', '')
                rel_type = rel.get('type', 'related')
                body.append(f"- {rel_type}: [[{target}]]")
            body.append("")

        # 记忆片段
        if entity.get('memories'):
            body.append("## 记忆")
            for mem in entity['memories']:
                timestamp = mem.get('timestamp', '')
                content = mem.get('content', '')
                body.append(f"- [{timestamp}] {content}")
            body.append("")

        # 用户笔记区域（不可覆盖）
        body.append("## 笔记")
        body.append("> 💡 你可以在此处自由添加笔记，Agent 会在下次同步时读取。\n")

        # 同步信息
        body.append("---")
        body.append(f"*最后同步: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | 同步状态: ✅ 已同步*")

        return '\n'.join(frontmatter + body)

    def _parse_markdown(self, content: str) -> dict:
        """解析 Markdown 文件为实体数据"""
        entity_data = {}

        # 解析 frontmatter
        if content.startswith('---'):
            end_idx = content.index('---', 3)
            frontmatter_str = content[3:end_idx].strip()
            for line in frontmatter_str.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    if value.startswith('[') and value.endswith(']'):
                        # 列表值
                        value = [v.strip() for v in value[1:-1].split(',') if v.strip()]
                    entity_data[key] = value

        # 解析用户笔记区域
        notes_section = self._extract_section(content, "## 笔记")
        if notes_section:
            entity_data['user_notes'] = notes_section.strip()

        # 提取双向链接
        import re
        links = re.findall(r'\[\[([^\]]+)\]\]', content)
        entity_data['linked_entities'] = links

        return entity_data

    def _extract_section(self, content: str, heading: str) -> Optional[str]:
        """提取指定章节的内容"""
        idx = content.find(heading)
        if idx == -1:
            return None

        start = idx + len(heading)
        # 查找下一个同级或更高级标题
        next_heading = re.search(r'^#{1,2}\s', content[start:], re.MULTILINE)
        if next_heading:
            end = start + next_heading.start()
            return content[start:end]
        return content[start:]

    def _merge_content(self, existing: str, new: str, entity: dict) -> str:
        """
        合并用户编辑与 Agent 更新。

        策略：
        - 用户编辑的笔记区域保留不动
        - Agent 更新的基本信息、关系、记忆区域使用 Agent 版本
        - 用户在其他区域的修改标记为冲突，保留用户版本
        """
        # 提取用户笔记
        user_notes = self._extract_section(existing, "## 笔记")
        if user_notes:
            # 将用户笔记注入到新内容中
            new = new.replace(
                "## 笔记\n> 💡 你可以在此处自由添加笔记，Agent 会在下次同步时读取。\n",
                f"## 笔记\n{user_notes}\n",
            )

        return new

    def _read_file(self, path: Path) -> Optional[str]:
        """读取文件"""
        try:
            if path.exists():
                return path.read_text(encoding='utf-8')
        except Exception as e:
            logger.error(f"Error reading {path}: {e}")
        return None

    def _write_file(self, path: Path, content: str):
        """写入文件并更新状态"""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

        # 更新状态
        file_key = str(path)
        self.file_states[file_key] = FileState(
            path=file_key,
            content_hash=self._compute_hash(content),
            last_modified=time.time(),
            last_synced=time.time(),
            agent_edited=True,
            user_edited=False,
        )

    def _generate_index(self, entities: list):
        """生成索引页"""
        index_content = [
            "---",
            "title: OpenHuman Wiki 索引",
            f"updated: {datetime.now().isoformat()}",
            "---",
            "\n# 🧠 OpenHuman Wiki\n",
            "这是 OpenHuman AI Agent 的知识图谱。所有记忆以双向链接的 Markdown 文件形式存储。",
            "你可以直接在 Obsidian 中浏览和编辑这些文件。\n",
        ]

        # 按类型分组
        by_type = {}
        for entity in entities:
            t = entity.get('type', 'unknown')
            by_type.setdefault(t, []).append(entity)

        type_labels = {
            'person': '👤 人物',
            'project': '📁 项目',
            'topic': '💡 话题',
            'learning': '📚 学习笔记',
        }

        for entity_type, items in by_type.items():
            label = type_labels.get(entity_type, entity_type)
            index_content.append(f"## {label}\n")
            for item in sorted(items, key=lambda x: x.get('name', '')):
                name = item.get('name', item.get('id', ''))
                path = self._entity_to_path(item)
                rel_path = path.relative_to(self.vault_path)
                index_content.append(f"- [[{name}]]")
            index_content.append("")

        index_path = self.vault_path / "index.md"
        index_path.write_text('\n'.join(index_content), encoding='utf-8')
```

### 3.2 文件监控器

```python
# openhuman/wiki/file_watcher.py
import asyncio
from pathlib import Path
from typing import Callable, Optional
import logging
import time

logger = logging.getLogger(__name__)


class FileWatcher:
    """
    Obsidian Vault 文件监控器。

    使用轮询方式检测文件变化（兼容所有操作系统）。
    在生产环境中可替换为 watchdog 库的 inotify/FSEvents 方案。
    """

    def __init__(self, vault_path: str, callback: Callable, poll_interval: float = 5.0):
        self.vault_path = Path(vault_path)
        self.callback = callback
        self.poll_interval = poll_interval
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._file_mtimes: dict = {}

    async def start(self):
        """启动文件监控"""
        self._running = True
        self._scan_initial()
        self._task = asyncio.create_task(self._watch_loop())
        logger.info(f"File watcher started on {self.vault_path}")

    async def stop(self):
        """停止文件监控"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("File watcher stopped")

    def _scan_initial(self):
        """初始扫描，记录所有文件的修改时间"""
        for md_file in self.vault_path.rglob("*.md"):
            if md_file.is_file():
                self._file_mtimes[str(md_file)] = md_file.stat().st_mtime

    async def _watch_loop(self):
        """监控循环"""
        while self._running:
            try:
                changes = self._detect_changes()
                if changes:
                    logger.info(f"Detected {len(changes)} file changes")
                    await self.callback(changes)
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"File watcher error: {e}", exc_info=True)
                await asyncio.sleep(self.poll_interval)

    def _detect_changes(self) -> list:
        """检测文件变化"""
        changes = []
        current_files = set()

        for md_file in self.vault_path.rglob("*.md"):
            if not md_file.is_file():
                continue
            if str(md_file).endswith('system/sync-state.json'):
                continue

            file_key = str(md_file)
            current_files.add(file_key)
            current_mtime = md_file.stat().st_mtime

            if file_key not in self._file_mtimes:
                # 新文件
                changes.append(('created', file_key))
            elif current_mtime > self._file_mtimes[file_key]:
                # 修改过的文件
                changes.append(('modified', file_key))

            self._file_mtimes[file_key] = current_mtime

        # 检测删除的文件
        for old_file in set(self._file_mtimes.keys()) - current_files:
            changes.append(('deleted', old_file))
            del self._file_mtimes[old_file]

        return changes
```

## 四、记忆树与实体提取

### 4.1 从对话到实体

```python
# openhuman/wiki/entity_extractor.py
from typing import List, Dict, Any
import re
import logging

logger = logging.getLogger(__name__)


class EntityExtractor:
    """
    从对话历史中提取实体。

    实体类型：
    - person: 人物
    - project: 项目
    - topic: 技术话题
    - learning: 学习笔记
    - decision: 决策记录
    """

    def __init__(self, llm_client):
        self.llm_client = llm_client

    async def extract_from_conversation(
        self,
        messages: List[Dict[str, str]],
    ) -> List[Dict[str, Any]]:
        """
        从对话中提取实体。

        使用 LLM 进行命名实体识别和关系抽取。
        """
        # 构建 prompt
        conversation_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in messages
        )

        prompt = f"""从以下对话中提取实体和关系。

实体类型：
- person: 提到的人物（同事、朋友、家人）
- project: 提到的项目或产品
- topic: 技术话题、概念、工具
- learning: 学到的知识或经验
- decision: 做出的决策

对话内容：
{conversation_text}

请以 JSON 格式输出：
[
  {{
    "type": "person",
    "id": "alice_chen",
    "name": "Alice Chen",
    "aliases": ["Alice", "陈晓"],
    "attributes": {{"role": "后端工程师", "team": "Platform"}},
    "relations": [
      {{"type": "works_on", "target": "project_x"}},
      {{"type": "knows", "target": "laravel"}}
    ],
    "memories": [
      {{"timestamp": "2026-06-02", "content": "讨论了数据库迁移方案"}}
    ],
    "tags": ["colleague", "backend"]
  }}
]
"""

        response = await self.llm_client.chat(
            messages=[{"role": "user", "content": prompt}],
            model="deepseek-v3",
        )

        # 解析 JSON 响应
        import json
        try:
            entities = json.loads(response)
            logger.info(f"Extracted {len(entities)} entities from conversation")
            return entities
        except json.JSONDecodeError:
            logger.error(f"Failed to parse entity extraction response: {response[:200]}")
            return []
```

## 五、用户编辑回流机制

### 5.1 编辑检测与分类

用户在 Obsidian 中的编辑行为可以分为几类：

1. **内容修改**：修改了实体的属性或描述
2. **添加笔记**：在"笔记"区域添加了个人备注
3. **添加链接**：建立了新的双向链接关系
4. **添加标签**：在 frontmatter 中添加了 tags
5. **删除内容**：删除了某些记忆或信息

```python
# openhuman/wiki/edit_classifier.py
from enum import Enum
from typing import List, Dict, Tuple
import difflib


class EditType(Enum):
    CONTENT_MODIFIED = "content_modified"
    NOTE_ADDED = "note_added"
    LINK_ADDED = "link_added"
    TAG_ADDED = "tag_added"
    CONTENT_DELETED = "content_deleted"
    STRUCTURAL_CHANGE = "structural_change"


class EditClassifier:
    """用户编辑分类器"""

    def classify(
        self,
        old_content: str,
        new_content: str,
    ) -> List[Tuple[EditType, str]]:
        """
        分类用户的编辑操作。

        通过 diff 分析确定具体的编辑类型。
        """
        edits = []

        old_lines = old_content.split('\n')
        new_lines = new_content.split('\n')

        diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=''))

        added_lines = [line[1:] for line in diff if line.startswith('+') and not line.startswith('+++')]
        removed_lines = [line[1:] for line in diff if line.startswith('-') and not line.startswith('---')]

        # 检测笔记添加
        notes_section_start = False
        for line in added_lines:
            if '## 笔记' in line:
                notes_section_start = True
            elif notes_section_start and line.strip():
                edits.append((EditType.NOTE_ADDED, line.strip()))

        # 检测链接添加
        import re
        for line in added_lines:
            new_links = re.findall(r'\[\[([^\]]+)\]\]', line)
            for link in new_links:
                edits.append((EditType.LINK_ADDED, link))

        # 检测标签添加
        for line in added_lines:
            if line.startswith('tags:'):
                new_tags = re.findall(r'\b\w+\b', line)
                edits.append((EditType.TAG_ADDED, str(new_tags)))

        # 检测内容删除
        if removed_lines and not added_lines:
            for line in removed_lines:
                if line.strip() and not line.startswith('---'):
                    edits.append((EditType.CONTENT_DELETED, line.strip()))

        # 检测内容修改
        if added_lines and removed_lines:
            for add, remove in zip(added_lines, removed_lines):
                if add.strip() != remove.strip():
                    edits.append((EditType.CONTENT_MODIFIED, f"{remove.strip()} → {add.strip()}"))

        return edits
```

### 5.2 冲突解决策略

当 Agent 和用户同时修改了同一个实体时，需要冲突解决：

```python
# openhuman/wiki/conflict_resolver.py
from enum import Enum
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class ConflictStrategy(Enum):
    """冲突解决策略"""
    USER_WINS = "user_wins"         # 用户编辑优先
    AGENT_WINS = "agent_wins"       # Agent 更新优先
    MERGE = "merge"                 # 尝试合并
    ASK_USER = "ask_user"           # 询问用户


class ConflictResolver:
    """
    冲突解决器。

    默认策略：
    - 用户笔记区域：用户永远优先
    - 基本信息区域：Agent 优先（但保留用户的补充）
    - 记忆区域：追加合并（不删除任何一方的内容）
    - 关系区域：合并（取并集）
    """

    def __init__(self, strategy: ConflictStrategy = ConflictStrategy.MERGE):
        self.strategy = strategy

    def resolve(
        self,
        agent_content: str,
        user_content: str,
        entity_type: str,
    ) -> str:
        """
        解决冲突，返回合并后的内容。
        """
        if self.strategy == ConflictStrategy.USER_WINS:
            return user_content
        elif self.strategy == ConflictStrategy.AGENT_WINS:
            return agent_content
        elif self.strategy == ConflictStrategy.MERGE:
            return self._merge(agent_content, user_content)
        else:
            logger.warning("ASK_USER strategy not implemented, falling back to MERGE")
            return self._merge(agent_content, user_content)

    def _merge(self, agent_content: str, user_content: str) -> str:
        """智能合并"""
        # 解析两个版本的各区域
        agent_sections = self._parse_sections(agent_content)
        user_sections = self._parse_sections(user_content)

        merged_sections = {}

        # 笔记区域：保留用户版本
        if '笔记' in user_sections:
            merged_sections['笔记'] = user_sections['笔记']
        elif '笔记' in agent_sections:
            merged_sections['笔记'] = agent_sections['笔记']

        # 其他区域：使用 Agent 版本，但追加用户的新增内容
        for section_name, agent_text in agent_sections.items():
            if section_name == '笔记':
                continue

            user_text = user_sections.get(section_name, '')

            if not user_text:
                merged_sections[section_name] = agent_text
            else:
                # 合并：Agent 内容 + 用户新增的行
                agent_lines = set(agent_text.strip().split('\n'))
                user_lines = set(user_text.strip().split('\n'))
                new_lines = user_lines - agent_lines

                if new_lines:
                    merged_sections[section_name] = agent_text.rstrip() + '\n' + '\n'.join(new_lines)
                else:
                    merged_sections[section_name] = agent_text

        # 重组内容
        return self._reassemble(merged_sections, agent_content)

    def _parse_sections(self, content: str) -> Dict[str, str]:
        """解析 Markdown 各区域"""
        import re
        sections = {}
        current_section = "frontmatter"
        current_content = []

        for line in content.split('\n'):
            if re.match(r'^##\s+', line):
                sections[current_section] = '\n'.join(current_content)
                current_section = line.lstrip('#').strip()
                current_content = [line]
            else:
                current_content.append(line)

        sections[current_section] = '\n'.join(current_content)
        return sections

    def _reassemble(self, sections: Dict[str, str], template: str) -> str:
        """将合并后的各区域重组为完整 Markdown"""
        # 使用模板的结构顺序
        import re
        result = []
        current_section = "frontmatter"

        for line in template.split('\n'):
            if re.match(r'^##\s+', line):
                current_section = line.lstrip('#').strip()
                if current_section in sections:
                    result.append(sections[current_section])
                else:
                    result.append(line)
            elif current_section not in sections:
                result.append(line)

        return '\n'.join(result)
```

## 六、Obsidian 插件集成

### 6.1 Obsidian 插件概念

OpenHuman 可以通过 Obsidian 插件实现更深度的集成：

```javascript
// obsidian-openhuman-plugin/main.js
const { Plugin, Notice, Modal } = require('obsidian');

class OpenHumanPlugin extends Plugin {
    async onload() {
        // 注册命令：手动触发同步
        this.addCommand({
            id: 'openhuman-sync',
            name: 'Sync with OpenHuman',
            callback: () => this.syncNow(),
        });

        // 注册命令：查看实体详情
        this.addCommand({
            id: 'openhuman-entity-info',
            name: 'View Entity Info',
            editorCallback: (editor) => this.showEntityInfo(editor),
        });

        // 文件修改监听
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file.path.startsWith('wiki/') && file.extension === 'md') {
                    this.onFileModified(file);
                }
            })
        );

        // 状态栏
        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.setText('🧠 OpenHuman: Ready');

        new Notice('OpenHuman Wiki plugin loaded');
    }

    async syncNow() {
        this.statusBarItem.setText('🧠 OpenHuman: Syncing...');
        try {
            const response = await fetch('http://localhost:8765/api/wiki/sync', {
                method: 'POST',
            });
            const result = await response.json();
            new Notice(`Sync complete: ${result.files_updated} files updated`);
            this.statusBarItem.setText('🧠 OpenHuman: Synced ✅');
        } catch (e) {
            new Notice(`Sync failed: ${e.message}`);
            this.statusBarItem.setText('🧠 OpenHuman: Error ❌');
        }
    }

    async onFileModified(file) {
        // 通知 OpenHuman 文件已被修改
        try {
            await fetch('http://localhost:8765/api/wiki/file-changed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: file.path }),
            });
        } catch (e) {
            // 静默失败，不打扰用户
            console.error('OpenHuman notification failed:', e);
        }
    }
}

module.exports = OpenHumanPlugin;
```

## 七、最佳实践

### 7.1 目录结构建议

- 每种实体类型一个目录，便于在 Obsidian 侧边栏中快速导航
- 使用 `_template.md` 文件定义每种类型的默认模板
- `system/` 目录存放同步状态，用户不应手动编辑

### 7.2 命名规范

- 实体 ID 使用 snake_case：`alice_chen`、`project_x`
- 文件名与实体 ID 一致：`alice_chen.md`
- 双向链接使用显示名称：`[[Alice Chen]]`（Obsidian 会自动匹配文件名）

### 7.3 编辑注意事项

用户在编辑 Wiki 文件时应注意：
1. **不要修改 frontmatter**（除非你明确知道自己在做什么）
2. **不要删除"笔记"区域之外的内容**（Agent 可能会在下次同步时覆盖）
3. **大胆在"笔记"区域添加内容**（Agent 不会覆盖这个区域）
4. **可以自由添加双向链接**（Agent 会在下次同步时识别并整合）

## 总结

OpenHuman 的 Obsidian Wiki 模块通过双向 Markdown 记忆基底，实现了 Agent 记忆系统与人类可读文件之间的无缝双向流动。用户可以在 Obsidian 中直观地浏览 Agent 的知识图谱，通过双向链接发现实体间的隐藏关系，并直接编辑来纠正或补充 Agent 的记忆。

这种设计的核心价值在于**透明度和可控性**——用户不再是 AI Agent 记忆系统的"被动接受者"，而是"主动参与者"。Agent 负责从对话中提取和整理信息，用户负责审核和修正，两者协同构建一个越来越准确的知识库。

## 八、常见踩坑案例

### 8.1 Obsidian 插件冲突问题

在使用 Obsidian 的 Sync 或 Git 插件时，文件的修改时间可能与实际编辑时间不一致（例如 Git pull 后文件 mtime 更新但内容未变）。这会导致 `FileWatcher` 误报大量文件变化。解决方案是在 `_detect_changes` 中同时检查 mtime 和 content hash，只有两者都变化时才触发同步。

### 8.2 中文文件名兼容性问题

在 macOS 上 Obsidian Vault 使用 UTF-8 编码的中文文件名（如 `张三.md`）可以正常工作，但在某些 Windows 环境下通过 Git 同步时可能出现编码问题。建议实体 ID 使用 snake_case 英文（如 `zhang_san.md`），通过 `aliases` 字段存储中文显示名。

### 8.3 双向链接的图谱爆炸

当 Wiki 文件数量增长到数百个时，Obsidian 的 Graph View 可能变得难以阅读。建议在 `index.md` 中使用 `tags` 和 `cssclasses` 对实体分类，并利用 Obsidian 的 Excluded Files 劒能隐藏 `system/` 目录。

## 相关阅读

- [OpenHuman 叶子生命周期深度剖析：pending_extraction 到 sealed 的状态机设计](/categories/架构/OpenHuman-叶子生命周期深度剖析-pending_extraction到sealed状态机设计/)
- [OpenHuman 知识图谱构建实战：实体索引、关系提取与力导向可视化](/categories/架构/OpenHuman-知识图谱构建实战-实体索引-关系提取-力导向可视化/)
- [Hermes 记忆系统双层架构](/categories/AI%20Agent/Hermes-记忆系统双层架构/)
