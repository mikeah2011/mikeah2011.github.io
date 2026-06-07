# Redis 8.0 新特性

## 概览

Redis 8.0 是 Redis 发展史上最重要的版本升级之一，全面引入**原生向量搜索**、**JSON Path 增强**、**I/O 多线程性能提升**与**持久化优化**。这些特性使 Redis 从传统缓存/数据结构服务器进化为支持 AI 场景的全能型数据平台。

- 关联页面：[数据结构](数据结构.md)、[性能优化](性能优化.md)、[Laravel集成](Laravel集成.md)、[高可用架构](高可用架构.md)

---

## 一、向量搜索（Vector Search）

### 核心能力

Redis 8.0 的向量搜索基于 RediSearch 模块，支持：

| 特性 | 说明 |
|------|------|
| FP16/INT8 量化 | 半精度浮点与整数量化，节省 50%-75% 内存 |
| HNSW 索引 | 高效近似最近邻搜索 |
| 混合搜索 | 向量搜索 + 文本过滤 + 数值范围的融合查询 |
| 多向量索引 | 同一文档支持多个向量维度（文本向量 + 图片向量） |
| RRF 融合 | Reciprocal Rank Fusion，全文搜索与向量搜索的排序融合 |

### 关键参数

```bash
FT.CREATE products_idx
    ON HASH
    PREFIX 1 product:
    SCHEMA
        name TEXT SORTABLE
        category TAG
        price NUMERIC SORTABLE
        embedding VECTOR HNSW 6
            TYPE FLOAT16        # FP16 节省 50% 内存
            DIM 1536            # OpenAI embedding 维度
            DISTANCE_METRIC COSINE
            M 16                # HNSW 连接数
            EF_CONSTRUCTION 200 # 构建时精度
            EF_RUNTIME 10       # 查询时精度
```

### 混合搜索示例

```bash
# 向量 + 文本 + 数值范围
FT.SEARCH products_idx
    "(@category:{electronics}) (@price:[0 1000])"
    VECTOR $query_vec 10
    SORTBY __vector_score
    DIALECT 3
```

### AI 应用场景

- **RAG（检索增强生成）**：文档分块 → embedding → 向量存储 → 相似度检索 → 上下文注入 LLM
- **语义缓存**：相似查询命中缓存，减少 LLM 调用
- **实时推荐**：用户行为向量 + 商品向量的实时匹配

相关文章：
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/2026/06/02/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/)

---

## 二、JSON Path 增强

### 新增聚合函数

Redis 8.0 的 JSON Path 支持更接近 JSONPath 标准：

```bash
# 聚合函数（8.0 新增）
JSON.GET data:1 $.users.length()      # 数组长度
JSON.GET data:1 $.items.sum(@.qty)    # 求和
JSON.GET data:1 $.items.min(@.price)  # 最小值
JSON.GET data:1 $.items.max(@.price)  # 最大值

# 递归搜索
JSON.GET data:1 $..email              # 递归查找所有 email

# 过滤表达式
JSON.GET orders:1 $.items[?(@.qty > 2)]

# 数组切片
JSON.GET orders:1 $.items[0:2]
```

### 原子数组操作

```bash
JSON.ARRAPPEND user:1 $.hobbies "reading"
JSON.ARRINSERT user:1 $.hobbies 0 "coding"
JSON.ARRPOP user:1 $.hobbies 0
JSON.ARRTRIM data:1 $.items 0 99
```

### 适用场景

| 场景 | 传统方案 | JSON Path 方案 |
|------|----------|---------------|
| 用户会话 | Hash 多字段 | JSON 文档，嵌套结构 |
| 购物车 | Hash + List | JSON 数组，过滤查询 |
| 配置管理 | 多个 String | 单个 JSON，路径读取 |
| 事件日志 | List + 序列化 | JSON 文档，聚合统计 |

相关文章：
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/2026/06/02/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/)

---

## 三、性能改进

### I/O 多线程增强

Redis 8.0 增强了 I/O 多线程能力：

| 配置 | SET ops/sec | GET ops/sec | 延迟 P99 |
|------|------------|------------|----------|
| 单线程 | 120K | 150K | 8.5ms |
| 2 线程 | 200K | 250K | 5.2ms |
| 4 线程 | 350K | 420K | 3.1ms |
| 8 线程 | 500K | 600K | 2.4ms |

```bash
# redis.conf
io-threads 4
io-threads-do-reads yes
```

### 内存优化

- 增强的 active defrag（内存碎片整理）
- 小对象 listpack 压缩优化
- FP16/INT8 向量量化存储

### 持久化改进

- RDB 格式压缩率提升 30%
- AOF 增量重写支持
- 混合持久化（RDB + AOF）优化

相关页面：[性能优化](性能优化.md)

---

## 四、版本对比速查

| 特性 | Redis 7.x | Redis 8.0 |
|------|-----------|-----------|
| 向量搜索 | 模块支持 | 原生增强（FP16/INT8） |
| JSON Path | 基础支持 | 聚合函数、递归搜索 |
| I/O 多线程 | 基础 | 增强，更高并发 |
| 混合搜索 | 不支持 | RRF 融合 |
| 多向量索引 | 不支持 | 同一文档多维度 |
| 内存优化 | 基础 | listpack 增强、量化压缩 |

---

## 五、Laravel 集成要点

### 向量搜索集成

使用 Predis 客户端操作向量索引：

```php
// 创建索引
$redis->ftcreate('products_idx', [
    ['field' => 'name', 'type' => 'TEXT'],
    ['field' => 'embedding', 'type' => 'VECTOR',
     'algorithm' => 'HNSW',
     'attributes' => ['TYPE' => 'FLOAT32', 'DIM' => 1536,
                       'DISTANCE_METRIC' => 'COSINE']],
]);

// 向量搜索
$redis->ftsearch('products_idx',
    "*=>[KNN 10 @embedding \$vec AS score]",
    ['PARAMS' => ['vec', pack('f*', ...$embedding)],
     'DIALECT' => 3]);
```

### JSON 操作集成

```php
$redis->jsonset('session:1', '$', json_encode($sessionData));
$redis->jsonget('session:1', '$.cart[?(@.qty > 2)]');
$redis->jsonarrappend('session:1', '$.page_views', json_encode($view));
```

相关页面：[Laravel集成](Laravel集成.md)

---

## 六、与其他页面的关系

- 向量搜索扩展了 [数据结构](数据结构.md) 的边界
- I/O 多线程与 [性能优化](性能优化.md) 中的 Pipeline/Lua 互补
- JSON Path 增强了 [Laravel集成](Laravel集成.md) 中的会话/购物车方案
- AI 场景与 [缓存策略](缓存策略.md) 中的语义缓存概念关联
