---

title: AI Agent + 数据库实战：Text-to-SQL、智能查询、数据治理
keywords: [AI Agent, Text, SQL, 数据库实战, 智能查询, 数据治理]
date: 2026-06-02 02:31:05
tags:
- AI
- Text-to-SQL
- 数据库
- 数据治理
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 本文系统梳理 Text-to-SQL 在企业级 AI Agent 场景中的落地方法，涵盖数据库 schema 理解、RAG 检索增强、Laravel 工程集成、SQL 安全校验、多库适配、结果可视化与数据治理实践。文章结合真实项目经验，分析从自然语言到 SQL 的关键链路、常见误区与优化策略，帮助团队构建可控、可审计、可持续演进的数据查询与分析能力。
---



# AI Agent + 数据库实战：Text-to-SQL、智能查询、数据治理

过去几年里，大模型最容易被业务侧感知的能力之一，就是“把自然语言变成数据库查询”。很多团队第一次接触 AI Agent 与企业数据结合，往往不是从复杂的自动化工作流开始，而是从一个非常具体的问题切入：**能不能让业务人员直接用中文提问，让系统自动查询数据库并返回结果？**

这个需求表面上像一个“更聪明的搜索框”，但真正落地之后，大家很快会发现它牵涉到的并不只是模型提示词，而是数据库 schema 理解、查询安全、跨库适配、结果可视化、数据治理、准确率评估，以及一大堆工程化细节。Text-to-SQL 真正难的地方，从来不是“让模型写出一条 SQL”，而是：**让模型稳定、可控、可解释、可审计地写出正确 SQL。**

本文结合 AI Agent、LLM、RAG、Schema Linking 和 Laravel 工程集成的完整链路，系统梳理一套可在真实项目中落地的 Text-to-SQL 实战方案。全文会覆盖：

1. Text-to-SQL 的原理与架构
2. 主流方案对比：LLM 直接生成 vs RAG 辅助 vs Schema Linking
3. Laravel 中集成 Text-to-SQL
4. SQL 安全校验与白名单
5. 智能数据治理：异常检测、数据血缘
6. 查询结果可视化
7. 多数据库适配
8. 准确率评估与优化
9. 真实踩坑记录

文章不会停留在概念层面，每一节都会给出代码示例、设计思路和踩坑经验，尽量还原“从 Demo 到上线”的真实过程。

---

## 一、为什么 Text-to-SQL 不是一个“调用模型接口”就能解决的问题

很多人第一次做 Text-to-SQL，会写出下面这种最朴素的代码：

```php
$prompt = "请根据用户问题生成 SQL。问题：统计最近 30 天新增订单数。表结构：orders(id, created_at)";
$sql = $llm->chat($prompt);
$result = DB::select($sql);
```

从演示角度，这已经“跑通”了。但在生产环境里，这种实现几乎必然会出问题：

- 模型可能猜错字段名
- 模型可能误用 Join
- 模型可能输出 DDL/DML
- 不同数据库方言不同
- 用户问题有歧义
- 数据库 schema 很大，prompt 放不下
- 结果正确性无法评估
- 查询性能可能灾难性恶化

也就是说，Text-to-SQL 不是一个单点模型问题，而是一个**由自然语言理解、语义检索、结构映射、SQL 约束、执行验证、可视化反馈、治理审计**组成的系统工程。

### 1.1 一个更现实的系统分层

在工程中，我更倾向把 Text-to-SQL 系统拆成下面几层：

```text
用户问题
  ↓
意图识别 / 查询分类
  ↓
Schema 检索 / 指标检索 / 业务术语映射
  ↓
Prompt 构造
  ↓
LLM 生成 SQL
  ↓
SQL 解析与安全校验
  ↓
执行计划检查 / LIMIT 注入 / 超时控制
  ↓
数据库执行
  ↓
结果解释与可视化
  ↓
日志沉淀 / 评估反馈 / 持续优化
```

它不是一个“生成 SQL 的函数”，而更像一个“数据查询 Agent”。

### 1.2 最小可用架构

下面是一个典型的服务化架构：

```php
interface TextToSqlPipelineInterface
{
    public function handle(string $question, array $context = []): array;
}

final class TextToSqlPipeline implements TextToSqlPipelineInterface
{
    public function __construct(
        private SchemaRetriever $schemaRetriever,
        private BusinessGlossaryRetriever $glossaryRetriever,
        private PromptBuilder $promptBuilder,
        private LlmClient $llmClient,
        private SqlGuard $sqlGuard,
        private SqlExecutor $sqlExecutor,
        private ResultFormatter $resultFormatter,
    ) {}

    public function handle(string $question, array $context = []): array
    {
        $schema = $this->schemaRetriever->retrieve($question, $context);
        $glossary = $this->glossaryRetriever->retrieve($question, $context);

        $prompt = $this->promptBuilder->build([
            'question' => $question,
            'schema' => $schema,
            'glossary' => $glossary,
            'context' => $context,
        ]);

        $sql = $this->llmClient->generateSql($prompt);
        $safeSql = $this->sqlGuard->validateAndRewrite($sql);
        $rows = $this->sqlExecutor->query($safeSql);

        return $this->resultFormatter->format($question, $safeSql, $rows);
    }
}
```

看起来步骤很多，但这是必要的。因为你迟早会需要：

- 把 schema 检索从静态 prompt 升级成动态召回
- 把“业务术语”纳入 prompt
- 把危险 SQL 拦下来
- 把结果转成图表结构
- 把失败问题存档做评估集

### 1.3 Text-to-SQL 的核心本质

从本质上看，Text-to-SQL 是一种**受约束的程序生成问题**：

- 输入：自然语言问题 + schema + 业务上下文
- 输出：满足语义、语法、安全和性能要求的 SQL 程序

所以它同时具备三重挑战：

1. **语义理解挑战**：用户说“新增客户”到底是注册用户还是首单用户？
2. **结构映射挑战**：用户说“订单金额”对应 `orders.total_amount` 还是 `payments.amount`？
3. **执行约束挑战**：生成的 SQL 能不能跑？跑得安不安全？

这三件事缺任何一个，系统都会不稳定。

---

## 二、Text-to-SQL 的原理与架构

### 2.1 从自然语言到 SQL 的典型流程

Text-to-SQL 常见的生成流程大致如下：

1. 解析用户问题中的意图、指标、过滤条件、时间范围、分组维度
2. 找到候选表、字段、关联关系
3. 构造 prompt，提供 schema、示例和规则
4. 让模型生成 SQL
5. 对 SQL 做 AST 解析、安全审查和必要重写
6. 执行 SQL，并根据错误做重试或修复
7. 生成结果摘要和可视化建议

例如用户问题：

> 查询最近 7 天各渠道的付费订单金额，并按金额倒序排列。

系统内部会把这个问题拆解为：

- 时间范围：最近 7 天
- 指标：付费订单金额
- 维度：渠道
- 排序：金额倒序
- 限制：可能需要 Top N 或默认 LIMIT

一个中间结构可以长这样：

```php
$intent = [
    'metric' => 'paid_order_amount',
    'dimensions' => ['channel'],
    'filters' => [
        ['field' => 'paid_at', 'operator' => '>=', 'value' => 'NOW() - INTERVAL 7 DAY'],
        ['field' => 'status', 'operator' => '=', 'value' => 'paid'],
    ],
    'order_by' => [
        ['field' => 'paid_order_amount', 'direction' => 'desc'],
    ],
];
```

虽然很多团队会直接把自然语言扔给模型，但如果能在前置阶段抽取出一部分结构化意图，整体准确率和可控性会明显提升。

### 2.2 Prompt 不是越长越好，而是越“结构化约束”越好

一个成熟的 Text-to-SQL Prompt，通常包含以下部分：

- 角色设定：你是资深数据分析工程师
- 任务目标：只输出 SQL，不输出解释
- 数据库类型：MySQL / PostgreSQL / ClickHouse
- 可用表及字段
- 关键字段解释
- Join 关系说明
- 业务定义：GMV、有效订单、活跃用户等
- 查询限制：必须包含 LIMIT，不允许 UPDATE/DELETE
- Few-shot 示例
- 用户问题

例如：

```text
你是一个资深数据分析工程师，请把用户问题转换为 MySQL 8 SQL。

规则：
1. 只允许 SELECT 查询。
2. 不允许使用 INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE。
3. 默认 LIMIT 200。
4. 若涉及订单金额，优先使用 orders.paid_amount。
5. 有效订单定义为 orders.status = 'paid'。

表结构：
- orders(id, user_id, channel_id, paid_amount, status, paid_at, created_at)
- channels(id, name, type)

关联关系：
- orders.channel_id = channels.id

用户问题：最近 7 天各渠道的付费订单金额，按金额倒序排列。
```

经验上，影响 Text-to-SQL 成败的，不只是模型参数，而是 Prompt 中的**结构边界是否明确**。如果没有明确的规则和业务定义，模型会自行脑补。

### 2.3 为什么需要 SQL AST 解析

只做字符串关键词过滤远远不够。比如你检查 SQL 中有没有 `DELETE`，但模型可能输出：

```sql
WITH x AS (SELECT * FROM users) SELECT * FROM x;
```

或者带注释、大小写变体、嵌套子查询、union 绕过。更稳妥的方式是把 SQL 解析成 AST（抽象语法树），再做节点级别限制。

在 PHP / Laravel 侧，如果不引入完整 parser，也至少应做分层检查：

```php
final class SqlGuard
{
    private array $forbiddenPatterns = [
        '/\bINSERT\b/i',
        '/\bUPDATE\b/i',
        '/\bDELETE\b/i',
        '/\bDROP\b/i',
        '/\bALTER\b/i',
        '/\bTRUNCATE\b/i',
        '/\bGRANT\b/i',
        '/\bREVOKE\b/i',
        '/;\s*$/',
    ];

    public function validateAndRewrite(string $sql): string
    {
        $normalized = trim($sql);

        foreach ($this->forbiddenPatterns as $pattern) {
            if (preg_match($pattern, $normalized)) {
                throw new InvalidArgumentException('SQL contains forbidden statements.');
            }
        }

        if (!preg_match('/^\s*SELECT\b/i', $normalized) && !preg_match('/^\s*WITH\b/i', $normalized)) {
            throw new InvalidArgumentException('Only SELECT/CTE queries are allowed.');
        }

        if (!preg_match('/\bLIMIT\b/i', $normalized)) {
            $normalized .= ' LIMIT 200';
        }

        return $normalized;
    }
}
```

这不是最终形态，但至少比“生成就执行”要安全得多。

### 2.4 执行前验证是第二道生命线

一个非常实用的工程策略是：先 `EXPLAIN` 再执行。

```php
final class SqlExecutor
{
    public function explain(string $sql, string $connection = 'mysql'): array
    {
        return DB::connection($connection)->select('EXPLAIN ' . $sql);
    }

    public function query(string $sql, string $connection = 'mysql'): array
    {
        $this->assertExplainSafe($sql, $connection);
        return DB::connection($connection)->select($sql);
    }

    private function assertExplainSafe(string $sql, string $connection): void
    {
        $plan = $this->explain($sql, $connection);

        foreach ($plan as $row) {
            $type = strtolower($row->type ?? '');
            $rows = (int) ($row->rows ?? 0);

            if ($type === 'all' && $rows > 500000) {
                throw new RuntimeException('Potential full table scan detected.');
            }
        }
    }
}
```

当然，不同数据库的 `EXPLAIN` 输出格式不同，但思路是一致的：**先看执行计划，再决定是否放行。**

---

## 三、主流方案对比：LLM 直接生成 vs RAG 辅助 vs Schema Linking

Text-to-SQL 的方案演进，通常会经历三个阶段：

1. LLM 直接生成
2. RAG 辅助生成
3. Schema Linking + 约束式生成

它们不是非此即彼的替代关系，而更像是逐步增强的工程成熟度。

### 3.1 方案一：LLM 直接生成

最简单的做法，就是把整个 schema 或关键表结构直接塞进 prompt，让模型生成 SQL。

```php
final class DirectSqlGenerator
{
    public function generate(string $question): string
    {
        $schema = <<<TEXT
orders(id, user_id, status, paid_amount, paid_at, created_at)
users(id, name, source, created_at)
TEXT;

        $prompt = "基于以下 schema 生成 SQL，只输出 SQL：\n{$schema}\n问题：{$question}";
        return app(LlmClient::class)->generateSql($prompt);
    }
}
```

#### 优点

- 实现最简单
- Demo 效果通常不错
- 适合小 schema、小项目验证

#### 缺点

- schema 一大就放不下
- 模型容易幻觉字段
- 缺乏业务术语解释
- 对复杂 Join 场景不稳定
- 无法随着库表增长而扩展

#### 适用场景

- 内部 PoC
- 单库单业务域
- 表数量少、字段命名规范

### 3.2 方案二：RAG 辅助生成

当 schema 规模增大后，不能再把全部结构硬塞进 prompt。此时更合理的方法是：**先检索，再生成。**

RAG 在 Text-to-SQL 中常用于召回：

- 相关表说明
- 字段含义
- 历史优秀 SQL 示例
- 指标口径文档
- 业务术语字典

例如先把表结构和字段说明做成知识片段：

```php
$documents = [
    [
        'id' => 'table_orders',
        'content' => '表 orders：订单事实表。字段 paid_amount 表示实付金额，status=paid 表示已支付。',
        'metadata' => ['type' => 'table', 'table' => 'orders'],
    ],
    [
        'id' => 'metric_gmv',
        'content' => 'GMV 指已支付订单金额汇总，使用 orders.paid_amount，过滤 status=paid。',
        'metadata' => ['type' => 'metric', 'name' => 'gmv'],
    ],
];
```

在查询时，先召回相关知识：

```php
final class RagContextBuilder
{
    public function build(string $question): array
    {
        $schemaDocs = app(VectorStore::class)->search($question, ['type' => 'table'], 5);
        $metricDocs = app(VectorStore::class)->search($question, ['type' => 'metric'], 3);
        $examples = app(VectorStore::class)->search($question, ['type' => 'sql_example'], 3);

        return [
            'schema_docs' => $schemaDocs,
            'metric_docs' => $metricDocs,
            'examples' => $examples,
        ];
    }
}
```

#### 优点

- 更适合大规模 schema
- 能补充业务术语和指标解释
- 能注入高质量 SQL 示例
- 可维护性强

#### 缺点

- 检索质量直接决定生成质量
- 召回错了，模型也会跟着错
- 需要维护 embedding、向量索引和文档同步

#### 核心经验

在 Text-to-SQL 场景里，RAG 检索目标不是“回答知识问答”，而是“为 SQL 生成提供最小但足够的结构上下文”。所以切片策略和普通知识库不完全一样。最有用的文档不是长篇描述，而是：

- 表级用途说明
- 字段语义定义
- Join 关系
- 指标口径
- 高质量 SQL 模板

### 3.3 方案三：Schema Linking

Schema Linking 是 Text-to-SQL 里最关键、也最容易被低估的一层。它的核心问题是：**把用户问题中的词，映射到数据库中的表、字段、枚举值和关系。**

例如用户说：

- “付费用户” → `users` + `orders.status='paid'`
- “渠道” → `channels.name`
- “新增客户” → `users.created_at`
- “退款金额” → `refunds.amount`

一个简单的 linking 结果可能长这样：

```php
$linking = [
    'tables' => ['orders', 'channels'],
    'columns' => [
        ['keyword' => '付费订单金额', 'table' => 'orders', 'column' => 'paid_amount', 'score' => 0.97],
        ['keyword' => '渠道', 'table' => 'channels', 'column' => 'name', 'score' => 0.93],
        ['keyword' => '最近7天', 'table' => 'orders', 'column' => 'paid_at', 'score' => 0.89],
    ],
    'joins' => [
        ['left' => 'orders.channel_id', 'right' => 'channels.id'],
    ],
];
```

Schema Linking 通常结合以下信息：

- 字段名称的文本相似度
- 字段注释 / 别名 / 中文名
- 业务词典
- 外键关系
- 历史查询频次
- 样例 SQL

一个实用版实现如下：

```php
final class SchemaLinker
{
    public function link(string $question, array $catalog): array
    {
        $matchedTables = [];
        $matchedColumns = [];

        foreach ($catalog['tables'] as $table) {
            similar_text($question, $table['name'], $tableScore);
            similar_text($question, implode(' ', $table['aliases']), $aliasScore);

            $score = max($tableScore, $aliasScore);
            if ($score > 10) {
                $matchedTables[] = ['table' => $table['name'], 'score' => $score];
            }

            foreach ($table['columns'] as $column) {
                similar_text($question, $column['name'], $columnScore);
                similar_text($question, implode(' ', $column['aliases']), $columnAliasScore);
                $score = max($columnScore, $columnAliasScore);

                if ($score > 10) {
                    $matchedColumns[] = [
                        'table' => $table['name'],
                        'column' => $column['name'],
                        'score' => $score,
                    ];
                }
            }
        }

        usort($matchedTables, fn ($a, $b) => $b['score'] <=> $a['score']);
        usort($matchedColumns, fn ($a, $b) => $b['score'] <=> $a['score']);

        return [
            'tables' => array_slice($matchedTables, 0, 5),
            'columns' => array_slice($matchedColumns, 0, 15),
        ];
    }
}
```

当然，真实项目里不会只用 `similar_text`，通常会叠加：BM25、Embedding、规则匹配、别名映射、人工词典和外键图谱。

### 3.4 三种方案怎么选

下面给一个工程上的选择建议：

| 方案 | 实现成本 | 准确率 | 扩展性 | 适用阶段 |
|---|---:|---:|---:|---|
| LLM 直接生成 | 低 | 低-中 | 低 | Demo / PoC |
| RAG 辅助 | 中 | 中-高 | 中-高 | 业务试点 |
| Schema Linking + RAG + Guard | 高 | 高 | 高 | 生产级 |

我的建议是：

- **起步阶段**：直接生成，用于验证需求价值
- **试点阶段**：引入 RAG，解决大 schema 和业务术语问题
- **生产阶段**：引入 Schema Linking、SQL 审核、执行计划校验、评估闭环

不要一开始就把系统设计成学术论文级别，但也不要以为一个 prompt 可以支撑长期生产。

---

## 四、Laravel 中集成 Text-to-SQL

Laravel 很适合做企业内部数据查询中台，因为它在以下方面工程效率很高：

- 依赖注入与服务容器
- 多数据库连接管理
- 队列与异步任务
- API 输出能力
- 中间件和权限体系
- 日志与监控扩展容易

这一节给出一个相对完整的 Laravel 集成方案。

### 4.1 服务分层设计

建议至少拆成以下服务：

- `SchemaCatalogService`：读取表结构、字段注释、外键关系
- `KnowledgeRetrieveService`：RAG 检索指标和示例 SQL
- `TextToSqlService`：调用模型生成 SQL
- `SqlAuditService`：安全审计和重写
- `QueryExecutionService`：执行查询
- `VisualizationService`：生成图表配置
- `QueryLogService`：记录问题、SQL、执行时间、用户反馈

接口示例：

```php
final class QueryController extends Controller
{
    public function ask(Request $request, AskDataQueryAction $action): JsonResponse
    {
        $payload = $request->validate([
            'question' => ['required', 'string', 'max:500'],
            'database' => ['required', 'string'],
        ]);

        $result = $action->execute(
            question: $payload['question'],
            database: $payload['database'],
            user: $request->user(),
        );

        return response()->json($result);
    }
}
```

### 4.2 Action 层串联完整流程

```php
final class AskDataQueryAction
{
    public function __construct(
        private SchemaCatalogService $schemaCatalogService,
        private KnowledgeRetrieveService $knowledgeRetrieveService,
        private TextToSqlService $textToSqlService,
        private SqlAuditService $sqlAuditService,
        private QueryExecutionService $queryExecutionService,
        private VisualizationService $visualizationService,
        private QueryLogService $queryLogService,
    ) {}

    public function execute(string $question, string $database, User $user): array
    {
        $schema = $this->schemaCatalogService->forDatabase($database);
        $knowledge = $this->knowledgeRetrieveService->retrieve($question, $database);

        $sql = $this->textToSqlService->generate(
            question: $question,
            database: $database,
            schema: $schema,
            knowledge: $knowledge,
        );

        $auditedSql = $this->sqlAuditService->audit($sql, $database, $user);
        $rows = $this->queryExecutionService->run($auditedSql, $database);
        $charts = $this->visualizationService->infer($rows, $question);

        $log = $this->queryLogService->store([
            'user_id' => $user->id,
            'database' => $database,
            'question' => $question,
            'sql' => $auditedSql,
            'row_count' => count($rows),
        ]);

        return [
            'query_id' => $log->id,
            'sql' => $auditedSql,
            'rows' => $rows,
            'charts' => $charts,
        ];
    }
}
```

### 4.3 获取数据库 schema

Laravel 可以通过 `information_schema` 或驱动 API 读取元数据。下面以 MySQL 为例：

```php
final class SchemaCatalogService
{
    public function forDatabase(string $connection): array
    {
        $db = DB::connection($connection);
        $databaseName = $db->getDatabaseName();

        $columns = $db->select(
            'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ?',
            [$databaseName]
        );

        $catalog = [];
        foreach ($columns as $column) {
            $table = $column->TABLE_NAME;
            $catalog[$table]['table'] = $table;
            $catalog[$table]['columns'][] = [
                'name' => $column->COLUMN_NAME,
                'type' => $column->DATA_TYPE,
                'comment' => $column->COLUMN_COMMENT,
            ];
        }

        return array_values($catalog);
    }
}
```

工程上建议把 schema 元数据缓存起来，而不是每次请求都实时扫库：

```php
public function forDatabase(string $connection): array
{
    return Cache::remember("schema_catalog:{$connection}", 3600, function () use ($connection) {
        return $this->loadCatalog($connection);
    });
}
```

### 4.4 PromptBuilder 的关键实现

```php
final class TextToSqlService
{
    public function generate(string $question, string $database, array $schema, array $knowledge): string
    {
        $schemaText = collect($schema)
            ->take(8)
            ->map(function ($table) {
                $columns = collect($table['columns'])
                    ->take(20)
                    ->map(fn ($c) => $c['name'] . '(' . $c['type'] . ')')
                    ->implode(', ');

                return $table['table'] . ': ' . $columns;
            })->implode("\n");

        $knowledgeText = collect($knowledge)
            ->pluck('content')
            ->implode("\n---\n");

        $prompt = <<<PROMPT
你是企业 BI 系统中的 SQL 生成助手。
请把用户问题转换为 {$database} 数据库可执行的只读 SQL。

要求：
1. 只输出 SQL。
2. 禁止任何写操作。
3. 如果没有明确要求，默认 LIMIT 200。
4. 优先选择最相关表，避免无意义 Join。
5. 严格依据提供的 schema 和业务知识，不要编造字段。

Schema:
{$schemaText}

业务知识:
{$knowledgeText}

用户问题:
{$question}
PROMPT;

        return app(LlmClient::class)->generateSql($prompt);
    }
}
```

### 4.5 Laravel 中的 LLM Client 抽象

```php
interface LlmClient
{
    public function generateSql(string $prompt): string;
}

final class OpenAiCompatibleClient implements LlmClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly string $model,
    ) {}

    public function generateSql(string $prompt): string
    {
        $response = Http::withToken($this->apiKey)
            ->baseUrl($this->baseUrl)
            ->post('/chat/completions', [
                'model' => $this->model,
                'messages' => [
                    ['role' => 'system', 'content' => 'You are a SQL generator.'],
                    ['role' => 'user', 'content' => $prompt],
                ],
                'temperature' => 0,
            ])->throw()->json();

        return trim($response['choices'][0]['message']['content'] ?? '');
    }
}
```

建议把以下参数开放成配置项：

- model
- temperature
- max_tokens
- timeout
- retry count
- 是否开启 SQL 修复重试

### 4.6 错误驱动的自动修复

一个很实用的技巧是：首次执行失败后，把报错信息和 SQL 一起发给模型，请它只做修复。

```php
final class SqlRepairService
{
    public function repair(string $question, string $sql, string $error, string $database): string
    {
        $prompt = <<<PROMPT
你生成的 {$database} SQL 执行失败，请根据错误信息修复。

原问题：{$question}
原 SQL：{$sql}
错误信息：{$error}

要求：
1. 只输出修复后的 SQL
2. 保持只读查询
3. 不要编造不存在的字段
PROMPT;

        return app(LlmClient::class)->generateSql($prompt);
    }
}
```

但这里要注意：**修复也必须重新经过 SQL Audit 和 EXPLAIN 检查。** 不能因为是“修复 SQL”就绕过安全链路。

---

## 五、SQL 安全校验与白名单

如果 Text-to-SQL 只能记住一条原则，那就是：**永远不要相信模型输出的 SQL。**

安全校验至少包括以下几个维度：

1. 语句类型校验
2. 表白名单与字段白名单
3. 函数白名单
4. 行数限制
5. 执行超时
6. EXPLAIN 风险检测
7. 租户隔离 / 数据权限

### 5.1 表级白名单

```php
final class SqlWhitelist
{
    private array $allowedTables = [
        'orders',
        'users',
        'channels',
        'refunds',
        'payments',
    ];

    public function ensureTablesAllowed(string $sql): void
    {
        preg_match_all('/\b(?:FROM|JOIN)\s+`?(\w+)`?/i', $sql, $matches);
        $tables = array_unique($matches[1] ?? []);

        foreach ($tables as $table) {
            if (!in_array($table, $this->allowedTables, true)) {
                throw new RuntimeException("Table [{$table}] is not allowed.");
            }
        }
    }
}
```

这类正则方式不够完美，但在没有 AST parser 时，是必要防线之一。

### 5.2 字段级白名单

有些表允许访问，但部分字段不能被查，比如手机号、身份证、邮箱、密钥等敏感列。

```php
final class SensitiveColumnGuard
{
    private array $forbiddenColumns = [
        'users.mobile',
        'users.id_card',
        'users.email',
        'api_keys.secret',
    ];

    public function ensureNoSensitiveColumns(string $sql): void
    {
        foreach ($this->forbiddenColumns as $column) {
            if (stripos($sql, $column) !== false) {
                throw new RuntimeException("Sensitive column [{$column}] is forbidden.");
            }
        }
    }
}
```

更成熟的方式是：

- schema catalog 里标记列敏感级别
- 生成 prompt 时就不暴露高敏字段
- audit 阶段再次兜底拦截
- 查询结果返回前做脱敏

### 5.3 SQL 重写：强制 LIMIT 与租户条件注入

很多内部系统需要自动注入租户条件或组织权限，比如当前用户只能看自己部门数据。

```php
final class SqlRewriteService
{
    public function appendLimit(string $sql, int $limit = 200): string
    {
        if (!preg_match('/\bLIMIT\b/i', $sql)) {
            $sql .= ' LIMIT ' . $limit;
        }

        return $sql;
    }

    public function injectTenantCondition(string $sql, int $tenantId): string
    {
        if (preg_match('/\bWHERE\b/i', $sql)) {
            return preg_replace('/\bWHERE\b/i', "WHERE tenant_id = {$tenantId} AND ", $sql, 1);
        }

        return preg_replace('/\bFROM\s+([`\w]+)/i', "$0 WHERE tenant_id = {$tenantId}", $sql, 1);
    }
}
```

这段代码只是展示思路，真实项目里最好基于 SQL AST 重写，而不是字符串拼接，否则复杂子查询很容易出错。

### 5.4 函数白名单

某些数据库函数可能导致高开销或信息泄露，例如文件读取、系统函数、sleep 等。应限制仅允许常用聚合与日期函数：

```php
final class FunctionWhitelistGuard
{
    private array $allowedFunctions = [
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
        'DATE', 'DATE_FORMAT', 'IFNULL', 'COALESCE',
        'ROUND', 'CASE',
    ];

    public function validate(string $sql): void
    {
        preg_match_all('/\b([A-Z_]+)\s*\(/i', strtoupper($sql), $matches);
        $functions = array_unique($matches[1] ?? []);

        foreach ($functions as $function) {
            if (in_array($function, ['SELECT', 'FROM', 'WHERE', 'ORDER', 'GROUP'], true)) {
                continue;
            }

            if (!in_array($function, $this->allowedFunctions, true)) {
                throw new RuntimeException("Function [{$function}] is not allowed.");
            }
        }
    }
}
```

### 5.5 审计服务整合

```php
final class SqlAuditService
{
    public function __construct(
        private SqlGuard $sqlGuard,
        private SqlWhitelist $sqlWhitelist,
        private SensitiveColumnGuard $sensitiveColumnGuard,
        private FunctionWhitelistGuard $functionWhitelistGuard,
        private SqlRewriteService $sqlRewriteService,
    ) {}

    public function audit(string $sql, string $database, User $user): string
    {
        $sql = $this->sqlGuard->validateAndRewrite($sql);
        $this->sqlWhitelist->ensureTablesAllowed($sql);
        $this->sensitiveColumnGuard->ensureNoSensitiveColumns($sql);
        $this->functionWhitelistGuard->validate($sql);

        $sql = $this->sqlRewriteService->appendLimit($sql, 200);
        $sql = $this->sqlRewriteService->injectTenantCondition($sql, $user->tenant_id);

        return $sql;
    }
}
```

这一步一定不能省。你可以接受模型偶尔答错，但绝不能接受它越权或拖垮数据库。

---

## 六、智能数据治理：异常检测、数据血缘

很多团队把 AI + 数据库 的讨论停留在“自然语言查数”，但真正有长期价值的，是把 Agent 能力延伸到数据治理。因为企业里最痛的往往不是“查不到数”，而是：

- 数据今天为什么突然掉了 30%？
- 这个指标到底来自哪张表？
- 为什么报表 A 和报表 B 数字不一致？
- 某个字段被改了之后影响了哪些下游任务？

Text-to-SQL 只是入口，数据治理才是中后场能力。

### 6.1 异常检测的最小实践

一个简单但实用的异常检测，可以从时间序列统计开始。比如检测每日订单金额是否异常。

```php
final class AnomalyDetectionService
{
    public function detect(array $series, float $threshold = 3.0): array
    {
        $values = array_column($series, 'value');
        $avg = array_sum($values) / max(count($values), 1);

        $variance = 0.0;
        foreach ($values as $value) {
            $variance += ($value - $avg) ** 2;
        }

        $std = sqrt($variance / max(count($values), 1));
        $anomalies = [];

        foreach ($series as $point) {
            $z = $std > 0 ? (($point['value'] - $avg) / $std) : 0;
            if (abs($z) >= $threshold) {
                $anomalies[] = [
                    'date' => $point['date'],
                    'value' => $point['value'],
                    'z_score' => round($z, 2),
                ];
            }
        }

        return $anomalies;
    }
}
```

如果和 Text-to-SQL 结合，可以这样用：

1. 用户问“近 30 天订单金额趋势”
2. 系统自动生成 SQL 拉取序列
3. 结果返回前自动做异常检测
4. 附带说明“某日出现异常峰值，建议检查活动投放或数据同步任务”

### 6.2 数据质量规则自动巡检

除了统计异常，还可以做规则型治理：

- 主键重复
- 空值率异常
- 枚举值漂移
- 分区数据缺失
- 事实表与汇总表不一致

例如检测空值率：

```php
final class DataQualityRuleService
{
    public function nullRateSql(string $table, string $column): string
    {
        return "
            SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN {$column} IS NULL THEN 1 ELSE 0 END) AS null_count,
                ROUND(SUM(CASE WHEN {$column} IS NULL THEN 1 ELSE 0 END) / COUNT(*), 4) AS null_rate
            FROM {$table}
        ";
    }
}
```

再配合阈值配置：

```php
$rules = [
    ['table' => 'orders', 'column' => 'paid_amount', 'max_null_rate' => 0.001],
    ['table' => 'users', 'column' => 'source', 'max_null_rate' => 0.05],
];
```

AI Agent 的价值在于，它不只是执行规则，还能自动生成解释：

- “`users.source` 空值率由 1.2% 升至 8.4%，高于阈值 5%，疑似注册来源埋点缺失。”

### 6.3 数据血缘：从 SQL 反推依赖关系

数据血缘的核心，是知道一个字段、报表或指标由哪些上游构成。哪怕先不做全平台级解析，也可以从常见 SQL 中提取依赖关系。

```php
final class LineageParser
{
    public function parse(string $sql): array
    {
        preg_match_all('/\bFROM\s+`?(\w+)`?|\bJOIN\s+`?(\w+)`?/i', $sql, $matches);

        $tables = [];
        foreach ($matches as $group) {
            foreach ($group as $item) {
                if ($item && !preg_match('/^(FROM|JOIN)$/i', $item)) {
                    $tables[] = $item;
                }
            }
        }

        return [
            'source_tables' => array_values(array_unique(array_filter($tables))),
        ];
    }
}
```

如果再往前走一步，就可以把指标、SQL、表、字段之间的关系存成图结构：

```php
$lineage = [
    'metric' => 'gmv_daily',
    'depends_on' => [
        ['type' => 'table', 'name' => 'orders'],
        ['type' => 'column', 'name' => 'orders.paid_amount'],
        ['type' => 'column', 'name' => 'orders.status'],
        ['type' => 'column', 'name' => 'orders.paid_at'],
    ],
];
```

这在真实项目里非常有用：

- 字段变更影响分析
- 指标口径审计
- 报表不一致溯源
- 模型生成 SQL 时补充“来源解释”

### 6.4 Agent 如何参与数据治理

一个成熟的 Agent 不只是回答“结果是多少”，还应该回答：

- 这个结果来自哪些表？
- 指标定义是什么？
- 今天的结果是否异常？
- 与昨天相比变化原因可能是什么？
- 如果数据异常，可能受哪些上游任务影响？

这意味着 Text-to-SQL 之后，还应有一个 `Insight Layer`：

```php
final class InsightService
{
    public function summarize(array $rows, array $anomalies, array $lineage): array
    {
        return [
            'summary' => '近30天订单金额整体平稳，2026-05-28 出现显著峰值。',
            'anomalies' => $anomalies,
            'lineage' => $lineage,
            'suggestions' => [
                '检查 2026-05-28 是否存在营销活动投放。',
                '核对 orders 表当日同步任务状态。',
            ],
        ];
    }
}
```

真正让业务觉得“智能”的，往往不是 SQL 生成本身，而是这些额外解释能力。

---

## 七、查询结果可视化

Text-to-SQL 生成结果之后，如果只是返回一堆 JSON 行数据，业务价值其实会打折扣。因为大部分业务用户不是要“表格”，而是要“洞察”。

所以结果可视化应该被视为查询链路的一部分，而不是前端自己随便画。

### 7.1 可视化推荐的基本思路

根据结果的列类型和问题语义，推断图表类型：

- 一个维度 + 一个指标 → 柱状图 / 条形图
- 时间序列 + 指标 → 折线图
- 占比结构 → 饼图 / 环形图
- 多指标对比 → 分组柱状图
- 明细列表 → 表格

可以先做一个启发式规则引擎：

```php
final class VisualizationService
{
    public function infer(array $rows, string $question): array
    {
        if (empty($rows)) {
            return [];
        }

        $firstRow = (array) $rows[0];
        $columns = array_keys($firstRow);

        $timeColumn = collect($columns)->first(fn ($col) => str_contains($col, 'date') || str_contains($col, 'day'));
        $numericColumns = collect($firstRow)
            ->filter(fn ($value) => is_numeric($value))
            ->keys()
            ->values()
            ->all();

        if ($timeColumn && count($numericColumns) >= 1) {
            return [
                'type' => 'line',
                'x' => $timeColumn,
                'y' => $numericColumns[0],
            ];
        }

        if (count($columns) === 2 && count($numericColumns) === 1) {
            return [
                'type' => 'bar',
                'x' => $columns[0],
                'y' => $numericColumns[0],
            ];
        }

        return [
            'type' => 'table',
            'columns' => $columns,
        ];
    }
}
```

### 7.2 输出 ECharts 配置

如果前端使用 ECharts，可以由后端直接生成可渲染配置：

```php
final class EchartBuilder
{
    public function build(array $rows, array $chart): array
    {
        if ($chart['type'] === 'line') {
            return [
                'tooltip' => ['trigger' => 'axis'],
                'xAxis' => [
                    'type' => 'category',
                    'data' => array_map(fn ($row) => $row->{$chart['x']}, $rows),
                ],
                'yAxis' => ['type' => 'value'],
                'series' => [[
                    'type' => 'line',
                    'data' => array_map(fn ($row) => (float) $row->{$chart['y']}, $rows),
                    'smooth' => true,
                ]],
            ];
        }

        if ($chart['type'] === 'bar') {
            return [
                'tooltip' => ['trigger' => 'axis'],
                'xAxis' => [
                    'type' => 'category',
                    'data' => array_map(fn ($row) => $row->{$chart['x']}, $rows),
                ],
                'yAxis' => ['type' => 'value'],
                'series' => [[
                    'type' => 'bar',
                    'data' => array_map(fn ($row) => (float) $row->{$chart['y']}, $rows),
                ]],
            ];
        }

        return [];
    }
}
```

### 7.3 让模型参与图表语义补全

除了规则引擎，也可以让模型协助判断：

- 这是趋势、分布还是排行？
- 适合画什么图？
- 图标题应该叫什么？
- 是否需要附带洞察描述？

但要注意：**图表类型推荐可以让模型做，图表数据映射最好仍然由规则和列类型驱动。** 因为纯靠模型输出图表 JSON 很容易不稳定。

### 7.4 一个完整的 API 返回结构

```php
return [
    'question' => $question,
    'sql' => $auditedSql,
    'rows' => $rows,
    'chart' => [
        'meta' => $chartMeta,
        'option' => $echartOption,
    ],
    'insight' => [
        'summary' => '最近7天微信渠道付费金额增长明显。',
        'highlights' => [
            '2026-05-30 达到周期峰值。',
            'APP 渠道占比下降。',
        ],
    ],
];
```

这会让产品体验从“AI 帮我写 SQL”升级成“AI 帮我做数据分析”。

---

## 八、多数据库适配

只要一进入企业环境，几乎必然会遇到多数据库并存：

- OLTP：MySQL / PostgreSQL
- 分析型：ClickHouse / Doris / StarRocks
- 历史遗留：SQL Server / Oracle
- 轻量场景：SQLite

这意味着 Text-to-SQL 不能把“SQL”当成单一语言，而要考虑**方言适配**。

### 8.1 常见差异点

不同数据库在以下方面都有差异：

- 分页语法：`LIMIT` vs `TOP`
- 日期函数：`DATE_SUB`、`INTERVAL`、`toDate`、`date_trunc`
- 字符串函数
- JSON 函数
- 大小写敏感性
- 标识符引用符号
- EXPLAIN 语法

例如“最近 7 天订单数”在不同数据库里可能写法不同：

**MySQL**

```sql
SELECT COUNT(*) AS order_count
FROM orders
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY);
```

**PostgreSQL**

```sql
SELECT COUNT(*) AS order_count
FROM orders
WHERE created_at >= NOW() - INTERVAL '7 day';
```

**ClickHouse**

```sql
SELECT count() AS order_count
FROM orders
WHERE created_at >= now() - INTERVAL 7 DAY;
```

### 8.2 方言抽象层

建议在服务层抽象出数据库方言：

```php
interface SqlDialect
{
    public function name(): string;
    public function defaultLimitClause(int $limit): string;
    public function explainPrefix(): string;
    public function quoteIdentifier(string $identifier): string;
}

final class MySqlDialect implements SqlDialect
{
    public function name(): string { return 'mysql'; }
    public function defaultLimitClause(int $limit): string { return 'LIMIT ' . $limit; }
    public function explainPrefix(): string { return 'EXPLAIN '; }
    public function quoteIdentifier(string $identifier): string { return "`{$identifier}`"; }
}

final class PostgresDialect implements SqlDialect
{
    public function name(): string { return 'pgsql'; }
    public function defaultLimitClause(int $limit): string { return 'LIMIT ' . $limit; }
    public function explainPrefix(): string { return 'EXPLAIN '; }
    public function quoteIdentifier(string $identifier): string { return '"' . $identifier . '"'; }
}
```

### 8.3 Prompt 中显式声明方言

很多线上错误都来自模型默认按 MySQL 写，而实际库是 PostgreSQL 或 ClickHouse。因此 prompt 必须强制声明：

```php
$prompt = <<<PROMPT
请生成 {$dialect->name()} 方言 SQL。
只允许使用 {$dialect->name()} 支持的函数与语法。
如果涉及日期运算，必须使用 {$dialect->name()} 的原生写法。
PROMPT;
```

### 8.4 多库元数据统一

不同数据库的 schema 元数据获取方式不同，所以要统一 catalog 结构：

```php
$catalog = [
    'database' => 'analytics',
    'dialect' => 'clickhouse',
    'tables' => [
        [
            'name' => 'orders',
            'comment' => '订单事实表',
            'columns' => [
                ['name' => 'paid_amount', 'type' => 'Decimal(18,2)', 'comment' => '实付金额'],
            ],
        ],
    ],
];
```

只要 catalog 统一，RAG、Schema Linking、PromptBuilder 和 Audit 层就更容易复用。

### 8.5 一个数据库工厂

```php
final class DialectFactory
{
    public function make(string $connection): SqlDialect
    {
        return match (config("database.connections.{$connection}.driver")) {
            'mysql' => new MySqlDialect(),
            'pgsql' => new PostgresDialect(),
            default => throw new InvalidArgumentException('Unsupported driver'),
        };
    }
}
```

这层抽象的意义不只在于“语法兼容”，更在于你后面做：

- EXPLAIN 检查
- LIMIT 注入
- 时间函数规范化
- 错误信息修复提示

都会依赖数据库方言。

---

## 九、准确率评估与优化

Text-to-SQL 项目最常见的误区之一，是“看起来能跑，就以为准确率还行”。但如果没有评估集和指标，团队很容易高估系统效果。

### 9.1 评估维度不能只看 SQL 是否执行成功

至少要区分以下几个层次：

1. **Syntax Accuracy**：SQL 是否可执行
2. **Execution Accuracy**：执行结果是否和标准答案一致
3. **Semantic Accuracy**：是否真正回答了用户问题
4. **Safety Accuracy**：是否始终满足安全约束
5. **Latency**：从提问到结果返回耗时多少

真正重要的是 2 和 3，而不是 1。

### 9.2 构建评估集

最好的评估集来源不是公开数据集，而是你自己的真实业务问题。建议把以下信息沉淀下来：

- 原始自然语言问题
- 人工确认的正确 SQL
- 正确结果摘要
- 所属业务域
- 难度等级
- 是否涉及 Join / 子查询 / 时间窗口 / 指标口径

例如：

```php
$dataset[] = [
    'question' => '统计最近30天每个渠道的付费订单金额',
    'gold_sql' => "SELECT c.name, SUM(o.paid_amount) AS total_amount
                   FROM orders o
                   JOIN channels c ON o.channel_id = c.id
                   WHERE o.status = 'paid'
                     AND o.paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                   GROUP BY c.name",
    'tags' => ['aggregation', 'join', 'time_range'],
    'difficulty' => 'medium',
];
```

### 9.3 执行结果比对

因为 SQL 写法可能不同，但结果相同，所以评估不能只做字符串比对。更实用的是比对执行结果。

```php
final class SqlEvaluator
{
    public function evaluate(array $cases, TextToSqlService $service): array
    {
        $passed = 0;
        $details = [];

        foreach ($cases as $case) {
            $predictedSql = $service->generate($case['question'], 'mysql', [], []);

            $goldResult = DB::select($case['gold_sql']);
            $predResult = DB::select($predictedSql);

            $ok = $this->sameResult($goldResult, $predResult);
            if ($ok) {
                $passed++;
            }

            $details[] = [
                'question' => $case['question'],
                'passed' => $ok,
                'predicted_sql' => $predictedSql,
            ];
        }

        return [
            'accuracy' => $passed / max(count($cases), 1),
            'details' => $details,
        ];
    }

    private function sameResult(array $a, array $b): bool
    {
        return json_encode($a) === json_encode($b);
    }
}
```

实际项目里，建议进一步增强：

- 排序不敏感比较
- 浮点数容差比较
- Top-N 截断比较
- 空值统一处理

### 9.4 失败样本分类

准确率提升最快的方式，不是盲目换模型，而是把失败样本分类。

常见失败类型：

- 字段映射错误
- 表选错
- Join 条件错
- 指标口径错
- 时间过滤错
- 数据库方言错
- 安全审计误杀
- 返回 SQL 包含解释文本

你可以做一个自动标签器：

```php
final class FailureClassifier
{
    public function classify(string $question, string $sql, string $error): string
    {
        if (str_contains($error, 'Unknown column')) {
            return 'unknown_column';
        }

        if (str_contains($error, 'syntax error')) {
            return 'syntax_error';
        }

        if (str_contains($error, 'not allowed')) {
            return 'security_blocked';
        }

        return 'semantic_error';
    }
}
```

当失败样本积累到一定规模后，你会清楚看到：

- 是 schema 检索出了问题
- 还是业务术语定义不清
- 还是 Prompt 不够约束
- 还是某个模型在复杂 Join 上明显偏弱

### 9.5 常见优化手段

#### 1）加业务词典

```php
$glossary = [
    'GMV' => 'orders.status = paid 的 paid_amount 求和',
    '新增用户' => 'users.created_at 在指定时间范围内的用户',
    '活跃用户' => '在 events 表中有事件记录的去重用户数',
];
```

#### 2）加 Few-shot 示例

```text
示例问题：最近7天每天订单数
示例SQL：SELECT DATE(created_at) AS day, COUNT(*) AS order_count FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY day
```

#### 3）缩小候选 schema

不要把 200 张表全塞给模型，而是先做召回，只给最相关的 3-10 张表。

#### 4）两阶段生成

第一阶段先输出“查询计划”，第二阶段再生成 SQL。

```php
[
    'plan' => [
        'tables' => ['orders', 'channels'],
        'metrics' => ['SUM(orders.paid_amount)'],
        'filters' => ['orders.status = paid', 'paid_at in last 7 days'],
    ],
]
```

两阶段策略在复杂查询上往往比一步直出更稳。

#### 5）引入执行反馈修复

首次失败后，根据错误信息修复一轮，通常能显著提升可执行率。

---

## 十、真实踩坑记录

如果说前面的内容是“方法论”，这一节就是“别人的坑你别再踩一遍”。我把几个在真实项目中最典型的问题整理出来。

### 10.1 坑一：字段名很规范，但业务语义完全不规范

项目早期我们以为字段命名已经很清晰，比如：

- `amount`
- `total_amount`
- `final_amount`
- `pay_amount`
- `settle_amount`

结果业务问“订单金额”，不同团队心里的定义根本不一样。模型在没有明确指标口径时，会随机选一个看起来最像的字段。

#### 教训

- 不要相信“字段名看起来差不多就够了”
- 指标字典必须独立维护
- Prompt 必须显式告诉模型优先使用哪个字段

#### 改进示例

```php
$metricDefinitions = [
    '订单金额' => [
        'column' => 'orders.paid_amount',
        'definition' => '用户实际支付金额，不含退款',
    ],
    '结算金额' => [
        'column' => 'orders.settle_amount',
        'definition' => '与商家结算金额，可能低于实付金额',
    ],
];
```

### 10.2 坑二：模型总爱“脑补”不存在的字段

比如明明表里只有 `created_at`，模型却经常写 `create_time`；明明只有 `status`，它却写 `order_status`。

#### 原因

- 训练语料里的字段名先验太强
- prompt 里 schema 不够突出
- 检索表太多，注意力分散

#### 解决办法

1. Prompt 里明确要求“不要编造字段”
2. 生成前缩小 schema 范围
3. 执行失败后做自动修复
4. 统计高频幻觉字段，加入反例提示

```text
注意：系统中不存在 create_time、order_status、user_name 等字段，请严格使用提供的字段名。
```

### 10.3 坑三：安全审计误杀正常 SQL

一开始为了保险，我们把很多函数都禁掉了，结果正常的 `DATE_FORMAT`、`IFNULL` 也被拦下，用户体验非常差。

#### 教训

- 白名单不能过粗
- 安全策略要和数据库方言一起维护
- 需要区分“高危函数”和“分析常用函数”

#### 更合理的策略

- 聚合函数默认允许
- 日期函数按方言分类允许
- 文件、系统、网络、sleep 类函数一律禁止
- 白名单配置化而不是硬编码

```php
return [
    'mysql' => [
        'allowed_functions' => [
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
            'DATE', 'DATE_FORMAT', 'IFNULL', 'COALESCE',
        ],
    ],
];
```

### 10.4 坑四：多租户条件注入把 SQL 改坏了

我们曾经直接在字符串里插入 `tenant_id = ?`，结果遇到子查询、CTE 和别名时，经常拼坏 SQL。

例如：

```sql
WITH recent_orders AS (
  SELECT * FROM orders WHERE created_at >= '2026-05-01'
)
SELECT * FROM recent_orders;
```

如果你简单替换第一个 `WHERE`，很可能把逻辑注入到错误位置。

#### 教训

- 权限条件最好在逻辑层前置过滤
- 若必须 SQL 注入，优先 AST 重写
- 简单字符串替换只能用于非常有限的场景

### 10.5 坑五：用户问题本身有歧义

比如“看一下上个月转化率”，这里至少有三个不确定点：

- 转化率定义是什么？
- 是注册转化、下单转化还是支付转化？
- 统计口径按天、按周还是整月？

如果 cron 或自动流程里不能反问用户，就必须采用保守策略：

1. 优先使用预定义指标口径
2. 若存在多个可能解释，选默认业务定义
3. 在结果中带出口径说明
4. 记录歧义命中日志，供后续优化

```php
$result['metric_definition'] = '转化率默认定义为访问用户中完成支付的用户占比';
```

### 10.6 坑六：结果对了，但性能差到不能上线

有些 SQL 执行结果没问题，但用了大表全扫描、低效 Join、函数包裹索引列，线上一跑就慢。

#### 解决思路

- 强制 EXPLAIN
- 大表默认要求时间范围
- 没有过滤条件时拒绝扫描事实表
- 对高风险表增加预聚合视图
- 允许模型优先查询汇总表而不是明细表

```php
if ($this->isLargeFactTableQueryWithoutTimeFilter($sql)) {
    throw new RuntimeException('Large fact table queries must include a time range filter.');
}
```

### 10.7 坑七：业务以为“AI 查数”可以替代所有 BI 建模

这是最大的认知坑。Text-to-SQL 可以降低取数门槛，但它不能替代：

- 指标治理
- 数仓建模
- 权限管理
- 审计流程
- 高性能预计算

如果底层数据模型一团乱，AI 只会更快地把混乱暴露出来。

我的经验是：**AI 不会自动修复数据基础设施，但它会放大基础设施的好与坏。**

---

## 十一、一套更接近生产可用的落地建议

如果今天要在团队里落地一个可用的 AI 数据查询 Agent，我会建议按下面路线推进。

### 阶段一：验证价值

目标：证明业务真的会用。

- 选 1 个业务域，例如订单分析
- 只开放 3-5 张表
- 使用 LLM + Prompt + 基础白名单
- 人工验证结果
- 收集 100 条真实问题

### 阶段二：增强准确率

目标：从“能演示”到“能试点”。

- 接入 schema catalog
- 引入 RAG 检索表说明、指标定义和示例 SQL
- 建立业务词典
- 增加自动修复与失败日志分类
- 增加 ECharts 可视化输出

### 阶段三：生产治理

目标：从“试点”到“可上线”。

- 多数据库方言抽象
- SQL AST 审计
- EXPLAIN 风险检测
- 租户权限与字段脱敏
- 评估集和回归测试
- 异常检测与数据血缘
- Query 日志审计与用户反馈闭环

一个可参考的配置结构如下：

```php
return [
    'text_to_sql' => [
        'default_limit' => 200,
        'max_limit' => 1000,
        'execution_timeout_seconds' => 15,
        'allowed_tables' => [
            'orders', 'users', 'channels', 'refunds', 'payments',
        ],
        'forbidden_columns' => [
            'users.mobile', 'users.id_card', 'users.email',
        ],
        'large_fact_tables' => [
            'events', 'order_items', 'user_actions',
        ],
        'require_time_filter_for_large_tables' => true,
    ],
];
```

---

## 十二、结语：真正可用的 Text-to-SQL，本质上是“受治理的数据 Agent”

回到文章开头的问题：为什么 Text-to-SQL 看起来只是“让模型写 SQL”，但真正做起来却像在搭一个小型数据平台？

因为企业级场景从来不只关心“能不能生成”，更关心：

- 能不能稳定生成
- 能不能按业务口径生成
- 能不能安全执行
- 能不能跨库适配
- 能不能解释来源
- 能不能发现异常
- 能不能持续优化

所以，真正可用的 Text-to-SQL，不是一个 prompt，也不是一个 SDK 调用，而是一个**有 schema 感知、有业务知识、有安全护栏、有评估闭环、有治理能力的 AI Agent 系统**。

如果只把它当作“自然语言转 SQL”，系统很快会撞到天花板；但如果把它作为“智能数据访问层 + 数据治理入口”来建设，它会在以下方向持续释放价值：

- 降低业务取数门槛
- 缩短分析反馈周期
- 统一指标口径
- 增强数据可解释性
- 让数据治理更智能

最后给一句非常现实的建议：

> **先把表、字段、指标定义清楚，再上 AI；否则 AI 只会更快地把不清楚的东西变成更复杂的问题。**

对于大多数团队来说，最合适的落地路线不是一步到位，而是：

- 先用小范围场景做可用性验证
- 再用 RAG 和 Schema Linking 提升准确率
- 最后用安全审计、评估体系和数据治理能力把它做成可长期维护的系统

当你走完这三步，Text-to-SQL 才不再只是一个炫技 Demo，而会真正成为企业内部 AI Agent 能力的一块关键基础设施。

## 相关阅读

- [AI Agent + uni-app 实战：移动端 AI 助手集成与离线推理](/categories/AI%20Agent/AI-Agent-uni-app-Mobile-AI-Assistant/)
- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/categories/AI%20Agent/AI-Agent-数据分析实战-自然语言转SQL-图表生成-报告自动化/)
