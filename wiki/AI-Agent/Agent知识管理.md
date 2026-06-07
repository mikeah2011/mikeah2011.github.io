# Agent 知识管理

## 定义

Agent 知识管理是指将个人或团队的知识（笔记、文档、经验）结构化存储，并通过 RAG 检索赋能 AI Agent 的实践。结合 Obsidian 等工具和向量数据库，构建「第二大脑」式的个人知识库。

## 核心原理

### 知识组织方法论

#### PARA 方法
Tiago Forte 的 PARA 组织框架：
- **Projects**（项目）：有明确截止日期的任务
- **Areas**（领域）：持续关注的责任领域
- **Resources**（资源）：感兴趣的主题资料
- **Archives**（归档）：已完成或不再活跃的内容

#### Zettelkasten 卡片笔记法
- 每条笔记是一个原子概念
- 笔记之间通过链接形成知识网络
- 强调笔记间的关联而非分类

### Obsidian + RAG 架构

```
Obsidian Vault（Markdown 文件）
    ↓ 文件监听
嵌入生成（OpenAI / Local Embedding）
    ↓
向量数据库（ChromaDB / Qdrant）
    ↓
RAG 检索 → LLM 生成
```

### 实现方案

```python
# Obsidian Vault 索引构建
class ObsidianIndexer:
    def __init__(self, vault_path, vector_db):
        self.vault_path = vault_path
        self.vector_db = vector_db
    
    def index_vault(self):
        for md_file in Path(self.vault_path).rglob("*.md"):
            content = md_file.read_text()
            # 提取 frontmatter、正文、标签
            metadata = self.parse_frontmatter(content)
            chunks = self.chunk_text(content)
            
            for chunk in chunks:
                embedding = self.embed(chunk)
                self.vector_db.insert(
                    embedding=embedding,
                    text=chunk,
                    metadata={
                        'source': str(md_file),
                        'tags': metadata.get('tags', []),
                        'created': metadata.get('date')
                    }
                )
    
    def search(self, query, top_k=5):
        embedding = self.embed(query)
        return self.vector_db.search(embedding, top_k=top_k)
```

### 混合检索策略

| 策略 | 优势 | 适用场景 |
|------|------|---------|
| 关键词检索 | 精确匹配 | 专有名词、代码片段 |
| 语义检索 | 理解意图 | 模糊查询、同义词 |
| 混合检索 | 两者结合 | 通用场景 |

## 实战案例

来自博客文章：
- [Agent 个人知识管理：Obsidian + RAG + Vector DB](/2026/06/02/ai-agent-personal-knowledge-management-obsidian-rag-vector-db/) - PARA + Zettelkasten 实战

## 相关概念

- [RAG 架构全览](RAG架构全览.md) - 知识检索的核心技术
- [Agent 记忆系统](Agent记忆系统.md) - 知识管理与记忆系统互补
- [向量数据库选型](../MySQL/向量数据库选型.md) - 底层存储选型

## 常见问题

### Q: 笔记太多索引太慢怎么办？
增量索引：监听文件变更，只重新索引修改的文件。使用 Embedding 缓存避免重复计算。

### Q: 如何保证检索质量？
笔记写作时：使用清晰标题、添加标签、建立双向链接。索引时：合理的 Chunk 策略（按段落或标题分割）。
