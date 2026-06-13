---
title: 'MCP Server 开发实战：用 TypeScript/Python 构建自定义 MCP 工具服务器——stdio/SSE/Streamable HTTP 三种传输'
date: 2026-06-06 12:00:00
tags: [MCP, AI Agent, TypeScript, Python, SSE, Streamable HTTP, LLM]
keywords: [MCP Server, TypeScript, Python, MCP, stdio, SSE, Streamable HTTP, 开发实战, 构建自定义, 工具服务器]
categories:
  - architecture
description: "MCP Server 开发实战指南：从零到一用 TypeScript 和 Python 构建自定义 MCP 工具服务器，完整覆盖 stdio、SSE、Streamable HTTP 三种传输方式的架构差异与工程权衡。手把手实现 PostgreSQL 数据库查询 Server 与文件系统操作 Server，深入讲解 MCP 协议的工具、资源、提示词三大原语，结合安全校验、错误处理与部署最佳实践，帮助开发者为 AI Agent 和 LLM 应用构建标准化的外部工具集成层。"
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


# MCP Server 开发实战：用 TypeScript/Python 构建自定义 MCP 工具服务器——stdio/SSE/Streamable HTTP 三种传输

## 一、引言：为什么你需要自己写 MCP Server？

2026 年的 AI Agent 生态已经远远超越了"让 LLM 聊天"的阶段。真正的业务价值在于让大语言模型能够**操作真实世界**——查询数据库、读写文件、调用内部 API、执行运维脚本、管理云资源。而连接 LLM 与外部世界的标准化桥梁，正是 **MCP（Model Context Protocol）**。

截至目前，MCP 生态已经涌现出大量官方和社区维护的 Server 实现：文件系统访问、GitHub 操作、PostgreSQL 查询、浏览器控制、Slack 集成等等。在 [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) 仓库中，收录的 MCP Server 已经超过数百个，覆盖了常见的开发和运维场景。

然而，**通用 Server 永远无法覆盖所有业务场景**。当你的需求是连接公司内部的订单系统、调用自有的推荐引擎 API、查询私有数据仓库、或者触发自定义的 CI/CD 流水线时，就需要自己动手编写 MCP Server。

本文将从零到一，手把手带你完成两个完整的 MCP Server 开发：

1. **TypeScript 实战**：构建一个 PostgreSQL 数据库查询 Server，支持安全的只读 SQL 查询、表结构浏览和查询计划分析
2. **Python 实战**：构建一个文件系统操作 Server，支持目录浏览、文件读写、内容搜索和元信息查询

同时，我们将深入对比 **stdio、SSE、Streamable HTTP** 三种传输方式的架构差异、工程权衡和适用场景，帮助你为每个项目做出正确的技术选型。

---

## 二、MCP 协议概述与设计理念

### 2.1 什么是 MCP？

MCP（Model Context Protocol）是 Anthropic 于 2024 年底发布的开放协议，旨在为 AI 模型提供一种**标准化的、安全的**方式，与外部工具和数据源进行交互。

你可以将 MCP 理解为 **AI 时代的 USB-C 接口**。就像 USB-C 统一了充电、数据传输和视频输出的标准一样，MCP 统一了 LLM 与外部世界交互的协议。无论你使用的是 Claude、GPT 还是开源模型，无论你使用的是 Cursor、Hermes Agent 还是自研平台，只要实现了 MCP 协议，就能无缝对接任何 MCP Server。

### 2.2 核心架构

MCP 采用经典的客户端-服务器架构，通信基于 JSON-RPC 2.0 协议。整体架构如下：

```
┌─────────────────────┐         ┌─────────────────────┐         ┌───────────────────┐
│    MCP Client        │  JSON-  │    MCP Server        │  各种   │  External         │
│  (Claude Desktop,    │◄─RPC──►│  (你的自定义         │◄─协议──►│  Resources        │
│   Cursor, Hermes,    │         │   工具服务器)        │         │  (DB, FS, API)    │
│   自研 Agent)        │         │                      │         │                   │
└─────────────────────┘         └─────────────────────┘         └───────────────────┘
```

一个完整的 MCP 交互生命周期包含以下阶段：

**阶段一：初始化握手（Initialize）**。客户端发起连接后，首先发送 `initialize` 请求，告知自身的协议版本和能力。服务器返回自己支持的能力集合（如是否支持工具、资源、提示词等）。随后客户端发送 `initialized` 通知，握手完成。

**阶段二：能力发现（Discovery）**。客户端通过 `tools/list` 获取服务器提供的所有工具定义，包括工具名称、描述、参数 JSON Schema。同样可以通过 `resources/list` 和 `prompts/list` 获取资源和提示词模板的列表。

**阶段三：执行交互（Interaction）**。客户端根据 LLM 的决策，调用 `tools/call` 执行具体操作，或通过 `resources/read` 读取结构化数据。服务器执行操作后返回结果。

**阶段四：通知与更新（Notifications）**。服务器可以主动发送通知，告知客户端工具列表已变化（`notifications/tools/list_changed`）、资源已更新（`notifications/resources/updated`）等，实现动态工具发现。

### 2.3 三大原语：工具、资源、提示词

MCP 定义了三种核心原语（Primitives），理解它们的设计意图和适用场景是编写高质量 MCP Server 的关键。

**工具（Tools）** 是 MCP 中最常用的原语。工具代表一个可以被 LLM 调用的函数，通常会产生副作用——查询数据库、发送邮件、创建文件、调用外部 API 等。工具的关键特征是**由模型自动决定何时调用**：LLM 根据用户的意图和工具的描述，自主判断是否需要调用某个工具以及传入什么参数。

一个好的工具定义应该包含：清晰准确的 `description`（告诉 LLM 这个工具做什么、什么时候该用它）、严格的 `inputSchema`（用 JSON Schema 定义参数类型和约束）、以及合理的默认值。工具描述的质量直接影响 LLM 调用的准确率，这一点怎么强调都不过分。

**资源（Resources）** 代表可以被读取的只读数据。资源使用 URI 标识（如 `db://mydb/schema`、`file:///etc/config`），类似于 REST API 中的 GET 端点。资源的关键特征是**由应用程序（而非模型）控制读取**——通常在会话开始时，应用程序主动读取相关资源并注入到 LLM 的上下文中。

资源适合暴露那些不需要 LLM "决策"就应加载的上下文信息：数据库表结构、项目配置文件、系统状态快照等。一个典型的用法是：在用户提问之前，应用程序先读取数据库 schema 资源，将表结构信息注入到 LLM 的系统提示中，这样 LLM 就能写出正确的 SQL。

**提示词（Prompts）** 是预定义的交互模板，用于引导 LLM 完成特定的复杂任务。提示词可以接受参数（如文件路径、关注领域），生成结构化的消息序列。提示词的关键特征是**由用户主动选择**——通常出现在客户端 UI 的快捷菜单中。

提示词的典型用法包括：代码审查模板（指定审查路径和关注点）、文档生成模板（指定模块和输出格式）、调试助手模板（指定错误日志和排查方向）。

### 2.4 协议版本演进

MCP 协议自发布以来经历了多次迭代：

- **2024-11-05**：初始版本发布，支持 stdio 和 SSE 传输
- **2025-03-26**：重大更新，引入 Streamable HTTP 传输（替代 SSE），支持 OAuth 2.1 授权，新增音频/图像内容类型
- **2025-06-18**：进一步完善 Streamable HTTP 规范，增强会话管理

截至目前，stdio 仍然是最稳定的传输方式，SSE 已被标记为 deprecated，Streamable HTTP 是官方推荐的新标准。如果你正在启动新项目，强烈建议直接采用 Streamable HTTP。

---

## 三、三种传输方式深度对比

传输（Transport）是 MCP 协议中负责 Client 和 Server 之间实际数据传输的层。MCP 协议的设计使得同一份业务逻辑可以适配不同的传输方式，只需替换传输层即可。理解三种传输的差异，是做出正确架构决策的前提。

### 3.1 stdio：标准输入/输出

stdio 是最简单、最轻量的传输方式。客户端通过操作系统级别的进程管理，启动 MCP Server 作为一个子进程，然后通过该子进程的 `stdin`（标准输入）发送 JSON-RPC 请求，从 `stdout`（标准输出）读取 JSON-RPC 响应。`stderr`（标准错误）保留给日志输出，不会干扰协议通信。

这种设计的精妙之处在于：它完全绕过了网络层。没有 TCP 连接建立、没有 HTTP 握手、没有端口监听，消息直接通过操作系统的管道（pipe）传递，延迟极低（通常在微秒级别）。同时，子进程天然提供了进程级别的隔离——即使 MCP Server 崩溃，也不会影响客户端进程的稳定性。

stdio 的主要局限在于它只能用于**本地通信**。客户端和服务器必须运行在同一台机器上，无法跨网络访问。此外，每个客户端连接都需要启动一个独立的服务器进程，当连接数量较多时，进程资源消耗会成为瓶颈。

**适用场景**：本地开发环境、IDE 集成（Cursor、VS Code）、个人 AI 助手（Claude Desktop）、以及所有不需要远程访问的场景。stdio 是目前兼容性最好的传输方式，几乎所有 MCP 客户端都支持。

### 3.2 SSE：Server-Sent Events

SSE 传输基于 HTTP 协议，使用 Server-Sent Events 实现服务器到客户端的单向实时推送。具体来说，客户端通过 HTTP GET 请求 `/sse` 端点建立一个 SSE 长连接，服务器通过该连接推送事件流（包括响应和通知）。客户端的请求则通过单独的 HTTP POST 请求发送到 `/messages` 端点。

SSE 传输的优势在于它基于标准 HTTP 协议，天然兼容现有的反向代理（Nginx、Traefik）、负载均衡器和 API 网关。这使得 MCP Server 可以轻松部署在云端，支持多客户端并发访问。

然而，SSE 传输也存在一些工程上的痛点。首先，SSE 是**单向的**（仅服务器到客户端），请求和响应使用不同的通道，架构不够直观。其次，长时间的 SSE 连接容易被中间代理（如 CDN、Nginx 的 `proxy_read_timeout`）超时断开，需要在服务器端实现心跳机制和客户端的重连逻辑。最后，SSE 连接的生命周期管理相对复杂，特别是在服务器重启或扩缩容时，需要妥善处理连接迁移。

**最重要的是，SSE 传输已被标记为 deprecated**，官方推荐迁移到 Streamable HTTP。如果你正在开发新的 MCP Server，不建议使用 SSE。

**适用场景**：已有 SSE 基础设施的遗留系统、需要逐步迁移的过渡期项目。对于新项目，请直接使用 Streamable HTTP。

### 3.3 Streamable HTTP：新标准

Streamable HTTP 是 MCP 协议在 2025 年引入的新传输标准，旨在解决 SSE 传输的架构缺陷，同时保持 HTTP 的通用性。

Streamable HTTP 的核心设计理念是**统一端点**。所有通信通过单个 HTTP POST 端点（通常为 `/mcp`）进行。客户端发送 JSON-RPC 请求到该端点，服务器可以选择返回：

- **单个 JSON 响应**：对于简单的请求-响应交互，直接返回 JSON
- **SSE 流**：对于需要流式输出或服务器推送通知的场景，返回 SSE 流

这种设计的优雅之处在于：它将请求和响应统一到一个通道，架构简洁直观。同时，由于每个 HTTP 请求天然独立，Streamable HTTP 支持**无状态部署**——服务器不需要在内存中维护客户端会话，每个请求都可以路由到不同的服务器实例。这对于 Serverless 架构（AWS Lambda、Vercel Edge Functions）和水平扩展场景极为友好。

对于需要会话状态的场景（如订阅资源变更通知），Streamable HTTP 通过 `Mcp-Session-Id` 头实现可选的会话管理。客户端首次请求时，服务器生成会话 ID 并在响应头中返回，后续请求携带该 ID 即可复用会话。

Streamable HTTP 还天然支持 CORS（跨域资源共享），这意味着浏览器端的 Web 应用可以直接调用 MCP Server，无需额外的代理层。

**适用场景**：所有新项目（强烈推荐）、生产环境部署、Serverless 架构、多客户端共享服务、需要水平扩展的高并发场景。

### 3.4 三种传输方式对比总结

| 维度 | stdio | SSE | Streamable HTTP |
|------|-------|-----|-----------------|
| **通信模型** | 子进程 stdin/stdout | SSE + POST 双通道 | 统一 POST（可选 SSE 流） |
| **网络访问** | ❌ 仅本地 | ✅ 远程 | ✅ 远程 |
| **部署复杂度** | 低（一个可执行文件） | 中（需要 HTTP 服务器） | 低（标准 HTTP 服务器） |
| **多客户端支持** | ❌ 每连接独立进程 | ✅ 共享服务器进程 | ✅ 共享服务器进程 |
| **无状态部署** | ❌ | ❌ | ✅ 天然支持 |
| **Serverless 友好** | ❌ | ❌ | ✅ |
| **连接稳定性** | 高（进程级） | 中（长连接易断） | 高（请求级） |
| **客户端兼容性** | ⭐⭐⭐ 最广 | ⭐⭐ 逐步减少 | ⭐⭐ 快速增长 |
| **协议状态** | 稳定 | **Deprecated** | **推荐** |
| **典型延迟** | < 1ms | 10-100ms | 10-100ms |
| **适用场景** | 本地工具/IDE | 遗留系统 | 生产/云端/新项目 |

### 3.5 如何选择？

决策路径很简单：

1. **只在本地使用**（单机、单用户、IDE 集成）→ **stdio**。零配置、零网络开销、最广的客户端兼容性。
2. **需要远程访问**（多用户、云端部署、团队共享）→ **Streamable HTTP**。这是官方推荐的标准，也是未来的方向。
3. **已有 SSE 基础设施**→ 短期内可以继续使用 **SSE**，但应规划向 Streamable HTTP 的迁移。MCP SDK 已经提供了从 SSE 迁移到 Streamable HTTP 的平滑路径。

---

## 四、实战 1：用 TypeScript 构建数据库查询 MCP Server

我们来构建一个实用且安全的 MCP Server：**PostgreSQL 数据库查询服务**。这个 Server 将提供以下能力：

- **工具**：执行只读 SQL 查询、列出所有表、查看表结构详情、分析查询执行计划
- **资源**：将数据库表列表暴露为可浏览的资源
- 完整的输入验证和 SQL 注入防护

### 4.1 项目初始化

```bash
mkdir mcp-db-server && cd mcp-db-server
npm init -y
npm install @modelcontextprotocol/sdk pg
npm install -D typescript @types/node @types/pg
npx tsc --init
```

`tsconfig.json` 关键配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

### 4.2 完整代码实现

`src/index.ts`——这是一个完整的、可直接运行的 MCP Server 实现：

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

// ── 数据库连接池配置 ──
// 使用 DATABASE_URL 环境变量配置连接，支持连接池参数调优
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mydb",
  max: 10,                    // 最大连接数，根据并发量调整
  idleTimeoutMillis: 30000,   // 空闲连接超时时间
  connectionTimeoutMillis: 5000, // 连接建立超时
});

// ── SQL 安全校验：只允许 SELECT 查询 ──
function validateQuery(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toUpperCase();

  // 只允许 SELECT 和 WITH（CTE 查询）
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    return {
      valid: false,
      error: "Only SELECT queries are allowed. Write operations are prohibited.",
    };
  }

  // 禁止危险关键字，防止注入攻击
  const dangerousPatterns = [
    /\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bALTER\b/i,
    /\bINSERT\b/i, /\bUPDATE\b/i, /\bCREATE\b/i, /\bGRANT\b/i,
    /\bREVOKE\b/i, /\bEXECUTE\b/i,
    /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        error: `Query contains prohibited keyword matching: ${pattern.source}`,
      };
    }
  }

  // 防止多语句执行（SQL 注入的常见手法）
  const withoutTrailingSemicolon = sql.trim().replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return { valid: false, error: "Multiple statements are not allowed." };
  }

  return { valid: true };
}

// ── 创建 MCP Server 实例，声明支持的能力 ──
const server = new Server(
  { name: "mcp-db-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ── 注册工具列表 ──
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description:
          "Execute a read-only SQL query against the PostgreSQL database. " +
          "Only SELECT statements are allowed. Returns results as JSON array. " +
          "Use this to explore data, run analytics queries, or check specific records.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "The SQL SELECT query to execute",
            },
            limit: {
              type: "number",
              description: "Maximum number of rows to return (default: 100, max: 1000)",
              default: 100,
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "list_tables",
        description:
          "List all tables in the connected PostgreSQL database with their schema, " +
          "row count estimates, and column information. Use this to understand the " +
          "database structure before writing queries.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "describe_table",
        description:
          "Get detailed column information for a specific table, including data types, " +
          "nullable flags, default values, indexes, and foreign key relationships.",
        inputSchema: {
          type: "object" as const,
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to describe",
            },
          },
          required: ["table_name"],
        },
      },
      {
        name: "explain_query",
        description:
          "Run EXPLAIN ANALYZE on a SQL query to understand its execution plan and " +
          "performance characteristics. Use this to optimize slow queries.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "The SQL query to explain",
            },
          },
          required: ["sql"],
        },
      },
    ],
  };
});

// ── 注册资源列表：将数据库表暴露为可浏览资源 ──
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `);
    return {
      resources: result.rows.map((row) => ({
        uri: `db://${row.schemaname}/${row.tablename}`,
        name: `${row.schemaname}.${row.tablename}`,
        description: `PostgreSQL table ${row.schemaname}.${row.tablename}`,
        mimeType: "application/json",
      })),
    };
  } finally {
    client.release();
  }
});

// ── 读取资源：返回表结构和样本数据 ──
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = new URL(request.params.uri);
  const schema = uri.hostname;
  const table = uri.pathname.replace(/^\//, "");

  const client = await pool.connect();
  try {
    const columnsResult = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table]
    );
    const sampleResult = await client.query(
      `SELECT * FROM "${schema}"."${table}" LIMIT 10`
    );
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              columns: columnsResult.rows,
              sample_data: sampleResult.rows,
              row_count_estimate: sampleResult.rowCount,
            },
            null, 2
          ),
        },
      ],
    };
  } finally {
    client.release();
  }
});

// ── 处理工具调用 ──
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "query": {
        const sql = args?.sql as string;
        const limit = Math.min((args?.limit as number) || 100, 1000);

        // 安全校验
        const validation = validateQuery(sql);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ Query rejected: ${validation.error}` }],
            isError: true,
          };
        }

        // 自动添加 LIMIT 保护，防止全表扫描
        const limitedSql = sql.trim().replace(/;\s*$/, "");
        const finalSql = /\bLIMIT\b/i.test(limitedSql) ? limitedSql : `${limitedSql} LIMIT ${limit}`;

        const client = await pool.connect();
        try {
          const startTime = Date.now();
          const result = await client.query(finalSql);
          const elapsed = Date.now() - startTime;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    rows: result.rows,
                    rowCount: result.rowCount,
                    fields: result.fields.map((f) => ({
                      name: f.name,
                      dataTypeID: f.dataTypeID,
                    })),
                    executionTimeMs: elapsed,
                  },
                  null, 2
                ),
              },
            ],
          };
        } finally {
          client.release();
        }
      }

      case "list_tables": {
        const client = await pool.connect();
        try {
          const result = await client.query(`
            SELECT t.schemaname, t.tablename,
                   c.reltuples::bigint AS estimated_rows,
                   COUNT(col.column_name) AS column_count
            FROM pg_tables t
            JOIN pg_class c ON c.relname = t.tablename
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
            LEFT JOIN information_schema.columns col
              ON col.table_schema = t.schemaname AND col.table_name = t.tablename
            WHERE t.schemaname NOT IN ('pg_catalog', 'information_schema')
            GROUP BY t.schemaname, t.tablename, c.reltuples
            ORDER BY t.schemaname, t.tablename
          `);
          return {
            content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
          };
        } finally {
          client.release();
        }
      }

      case "describe_table": {
        const tableName = args?.table_name as string;

        // 验证表名，防止 SQL 注入
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
          return {
            content: [{ type: "text", text: "❌ Invalid table name. Only alphanumeric characters and underscores are allowed." }],
            isError: true,
          };
        }

        const client = await pool.connect();
        try {
          const columns = await client.query(
            `SELECT column_name, data_type, is_nullable, column_default,
                    character_maximum_length, numeric_precision
             FROM information_schema.columns
             WHERE table_name = $1 ORDER BY ordinal_position`,
            [tableName]
          );
          const indexes = await client.query(
            `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
            [tableName]
          );
          const foreignKeys = await client.query(
            `SELECT kcu.column_name, ccu.table_name AS foreign_table,
                    ccu.column_name AS foreign_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`,
            [tableName]
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    table: tableName,
                    columns: columns.rows,
                    indexes: indexes.rows,
                    foreignKeys: foreignKeys.rows,
                  },
                  null, 2
                ),
              },
            ],
          };
        } finally {
          client.release();
        }
      }

      case "explain_query": {
        const sql = args?.sql as string;
        const validation = validateQuery(sql);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ Query rejected: ${validation.error}` }],
            isError: true,
          };
        }
        const client = await pool.connect();
        try {
          const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
          return {
            content: [{ type: "text", text: JSON.stringify(result.rows[0]["QUERY PLAN"], null, 2) }],
          };
        } finally {
          client.release();
        }
      }

      default:
        return {
          content: [{ type: "text", text: `❌ Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `❌ Database error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// ── 启动 Server（stdio 传输） ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-db-server started on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### 4.3 构建与运行

```bash
# 编译 TypeScript
npx tsc

# 使用 stdio 传输运行
DATABASE_URL="postgresql://user:***@localhost:5432/mydb" node dist/index.js
```

### 4.4 支持 Streamable HTTP 传输

如果需要将同一个 Server 暴露为 HTTP 服务，只需添加一个额外的入口文件，替换传输层即可。业务逻辑完全复用：

```bash
npm install express
npm install -D @types/express
```

`src/http-server.ts`：

```typescript
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());

// 存储活跃会话，用于有状态模式
const sessions: Map<string, {
  server: Server;
  transport: StreamableHTTPServerTransport;
}> = new Map();

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // 已有会话，复用 transport
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    return;
  }

  // 新会话：仅接受 POST 初始化
  if (req.method === "POST") {
    const server = new Server(
      { name: "mcp-db-server", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );

    // 注册所有 handler（与 stdio 版本完全相同，此处省略）
    registerHandlers(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { server, transport });
        console.log(`Session initialized: ${sid}`);
      },
    });

    server.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
  } else {
    res.status(405).json({ error: "Method not allowed. Use POST to /mcp" });
  }
});

// 健康检查端点
app.get("/health", (_req, res) => {
  res.json({ status: "ok", activeSessions: sessions.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MCP DB Server (Streamable HTTP) listening on http://localhost:${PORT}/mcp`);
});
```

---

## 五、实战 2：用 Python 构建文件系统 MCP Server

接下来我们用 Python 构建一个功能完善的文件系统 MCP Server。这个 Server 不仅支持基本的文件读写，还实现了目录递归浏览、文件内容搜索、元信息查询等高级功能，同时展示了如何同时支持三种传输方式。

### 5.1 项目初始化

```bash
mkdir mcp-filesystem && cd mcp-filesystem
python3 -m venv .venv
source .venv/bin/activate
pip install "mcp[cli]" uvicorn starlette
```

### 5.2 核心设计决策

在编写代码之前，先明确几个关键设计决策：

**安全第一**：文件系统操作天然存在安全风险。任何路径输入都必须经过白名单校验，防止目录遍历攻击（path traversal）。我们将实现一个 `validate_path` 函数，确保所有操作都在允许的根目录范围内。

**错误处理**：文件操作的错误类型多样（权限不足、文件不存在、磁盘空间不足等）。每种错误都应该返回清晰的错误信息，而不是暴露内部堆栈。

**分页与限制**：大文件和大目录的处理需要特别注意。文件读取应支持 offset/limit 分页，目录列表应支持递归深度限制，搜索应限制最大结果数。

### 5.3 完整代码实现

`server.py`——一个支持三种传输方式的完整 MCP 文件系统 Server：

```python
#!/usr/bin/env python3
"""
MCP Filesystem Server
支持：目录浏览、文件读写、文件搜索、文件元信息、目录创建
支持传输：stdio / SSE / Streamable HTTP
"""

import os
import json
import mimetypes
from pathlib import Path
from datetime import datetime
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.server.sse import SseServerTransport
from mcp.server.streamable_http import StreamableHTTPServerTransport
from mcp.types import (
    Tool, TextContent, Resource, Prompt,
    PromptArgument, PromptMessage,
)
import mcp.types as types

# ── 全局配置 ──
ALLOWED_ROOTS: list[Path] = []
server = Server("mcp-filesystem")


def init_roots(roots: list[str]) -> None:
    """初始化允许访问的根目录白名单"""
    global ALLOWED_ROOTS
    ALLOWED_ROOTS = [Path(r).resolve() for r in roots]


def validate_path(requested_path: str) -> Path:
    """
    路径安全校验：确保请求路径在白名单内。
    这是防止目录遍历攻击的核心函数。
    resolve() 会解析所有符号链接和 .. 组件，
    然后检查解析后的路径是否以某个允许的根目录开头。
    """
    resolved = Path(requested_path).resolve()
    for root in ALLOWED_ROOTS:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise PermissionError(
        f"Access denied: '{requested_path}' is outside allowed directories. "
        f"Allowed roots: {[str(r) for r in ALLOWED_ROOTS]}"
    )


def format_size(size_bytes: int) -> str:
    """将字节数格式化为人类可读的大小"""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ── 工具定义 ──
# 每个工具的 description 被 LLM 用于判断何时调用，
# 因此描述越精确，调用准确率越高。
TOOLS: list[Tool] = [
    Tool(
        name="read_file",
        description=(
            "Read the contents of a file at the specified path. "
            "Returns numbered lines for text files. Supports offset and limit for large files. "
            "Binary files (images, etc.) return metadata only."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to the file"},
                "offset": {"type": "number", "description": "Starting line number (1-indexed)", "default": 1},
                "limit": {"type": "number", "description": "Max lines to read (default: 500)", "default": 500},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="write_file",
        description=(
            "Write content to a file. Creates parent directories if needed. "
            "Use mode='append' to add to existing content."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to the file"},
                "content": {"type": "string", "description": "Content to write"},
                "mode": {"type": "string", "enum": ["overwrite", "append"], "default": "overwrite"},
            },
            "required": ["path", "content"],
        },
    ),
    Tool(
        name="list_directory",
        description=(
            "List files and directories with size, type, and modification time. "
            "Supports recursive listing with depth control and glob pattern filtering."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to the directory"},
                "recursive": {"type": "boolean", "default": False},
                "max_depth": {"type": "number", "default": 3},
                "pattern": {"type": "string", "description": "Glob pattern filter (e.g., '*.py')"},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="search_files",
        description=(
            "Search for files by name pattern (glob) or content (regex). "
            "Returns matching file paths and context lines for content matches."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory to search in"},
                "pattern": {"type": "string", "description": "Glob pattern for filename search"},
                "content_pattern": {"type": "string", "description": "Regex for content search"},
                "max_results": {"type": "number", "default": 50},
                "file_types": {"type": "array", "items": {"type": "string"},
                               "description": "File extensions to filter (e.g., ['.py', '.ts'])"},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="file_info",
        description=(
            "Get detailed metadata about a file or directory: size, permissions, "
            "timestamps, MIME type, line count (for text files)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute path to file or directory"},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="create_directory",
        description="Create a directory and any necessary parent directories.",
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path to create"},
            },
            "required": ["path"],
        },
    ),
]


# ── 资源定义 ──
@server.list_resources()
async def list_resources() -> list[Resource]:
    """将配置的根目录暴露为 MCP 资源，客户端可浏览目录树结构"""
    resources = []
    for root in ALLOWED_ROOTS:
        resources.append(
            Resource(
                uri=f"file://{root}",
                name=f"root:{root.name}",
                description=f"Filesystem root: {root}",
                mimeType="application/json",
            )
        )
    return resources


@server.read_resource()
async def read_resource(uri: str) -> str:
    """读取目录资源，返回该目录下的文件和子目录列表（JSON 格式）"""
    path_str = uri.replace("file://", "", 1)
    path = validate_path(path_str)
    if not path.is_dir():
        raise ValueError(f"Not a directory: {path}")

    tree: list[dict[str, Any]] = []
    for entry in sorted(path.iterdir()):
        stat = entry.stat()
        tree.append({
            "name": entry.name,
            "type": "directory" if entry.is_dir() else "file",
            "size": stat.st_size if entry.is_file() else None,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    return json.dumps({"path": str(path), "entries": tree}, indent=2)


# ── 提示词定义 ──
@server.list_prompts()
async def list_prompts() -> list[Prompt]:
    return [
        Prompt(
            name="code_review",
            description="Perform a code review on a file or directory",
            arguments=[
                PromptArgument(name="path", description="Path to review", required=True),
                PromptArgument(name="focus", description="Review focus: security/performance/readability/all", required=False),
            ],
        ),
        Prompt(
            name="project_structure",
            description="Analyze and summarize the project structure",
            arguments=[
                PromptArgument(name="path", description="Root path of the project", required=True),
            ],
        ),
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
    """根据提示词名称和参数，生成结构化的消息序列"""
    if name == "code_review":
        path = arguments.get("path", ".") if arguments else "."
        focus = arguments.get("focus", "all") if arguments else "all"
        focus_instructions = {
            "security": "Focus on security vulnerabilities: path traversal, injection, secret exposure.",
            "performance": "Focus on performance: N+1 queries, unnecessary I/O, missing caching.",
            "readability": "Focus on clarity: naming, function length, error handling patterns.",
            "all": "Review holistically: security, performance, readability, test coverage.",
        }
        return types.GetPromptResult(messages=[
            PromptMessage(role="user", content=types.TextContent(type="text", text=(
                f"Please perform a thorough code review of: `{path}`\n\n"
                f"Review criteria: {focus_instructions.get(focus, focus_instructions['all'])}\n\n"
                "For each issue found, provide:\n1. Severity (critical/warning/info)\n"
                "2. Location (file:line)\n3. Description\n4. Suggested fix"
            ))),
        ])
    elif name == "project_structure":
        path = arguments.get("path", ".") if arguments else "."
        return types.GetPromptResult(messages=[
            PromptMessage(role="user", content=types.TextContent(type="text", text=(
                f"Analyze the project at `{path}`:\n"
                "1. Top-level directory layout\n2. Tech stack identification\n"
                "3. Main entry points and configs\n4. Architectural pattern\n5. Potential issues"
            ))),
        ])
    raise ValueError(f"Unknown prompt: {name}")


# ── 工具调用分发 ──
@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
    try:
        if name == "read_file":
            path = validate_path(arguments["path"])
            offset = arguments.get("offset", 1)
            limit = arguments.get("limit", 500)
            if not path.is_file():
                return [TextContent(type="text", text=f"❌ Not a file: {path}")]

            mime = mimetypes.guess_type(str(path))[0] or "text/plain"
            if mime.startswith("image/"):
                stat = path.stat()
                return [TextContent(type="text", text=(
                    f"📷 Image: {path.name}\nType: {mime}\n"
                    f"Size: {format_size(stat.st_size)}\nModified: {datetime.fromtimestamp(stat.st_mtime).isoformat()}"
                ))]

            content = path.read_text(encoding="utf-8", errors="replace")
            lines = content.splitlines()
            start = max(0, offset - 1)
            end = min(start + limit, len(lines))
            numbered = [f"{i:4d}│{l}" for i, l in enumerate(lines[start:end], start=start + 1)]
            result = "\n".join(numbered)
            if end < len(lines):
                result += f"\n\n... ({len(lines) - end} more lines, use offset={end + 1})"
            return [TextContent(type="text", text=result)]

        elif name == "write_file":
            path = validate_path(arguments["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            mode = arguments.get("mode", "overwrite")
            if mode == "append":
                with open(path, "a", encoding="utf-8") as f:
                    f.write(arguments["content"])
                return [TextContent(type="text", text=f"✅ Appended to: {path}")]
            else:
                path.write_text(arguments["content"], encoding="utf-8")
                return [TextContent(type="text", text=f"✅ Written: {path} ({format_size(len(arguments['content'].encode()))})")  ]

        elif name == "list_directory":
            path = validate_path(arguments["path"])
            if not path.is_dir():
                return [TextContent(type="text", text=f"❌ Not a directory: {path}")]
            recursive = arguments.get("recursive", False)
            max_depth = arguments.get("max_depth", 3)
            pattern = arguments.get("pattern")
            entries: list[str] = []

            def scan(d: Path, depth: int = 0):
                if depth > max_depth:
                    return
                try:
                    items = sorted(d.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
                except PermissionError:
                    return
                for item in items:
                    if pattern and not item.is_dir() and not item.match(pattern):
                        continue
                    try:
                        s = item.stat()
                        icon = "📁" if item.is_dir() else "📄"
                        sz = format_size(s.st_size) if item.is_file() else "-"
                        mt = datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M")
                        indent = "  " * depth
                        entries.append(f"{indent}{icon}  {sz:>10}  {mt}  {item.name}")
                        if recursive and item.is_dir():
                            scan(item, depth + 1)
                    except (PermissionError, OSError):
                        entries.append(f"❌ {item.name} (permission denied)")

            scan(path)
            header = f"📂 {path}\n{'─' * 60}\n{'Type':>4} {'Size':>10}  {'Modified':<16}  {'Name'}\n{'─' * 60}"
            return [TextContent(type="text", text=header + "\n" + "\n".join(entries) + f"\n{'─' * 60}\nTotal: {len(entries)} entries")]

        elif name == "search_files":
            import re as regex
            path = validate_path(arguments["path"])
            results: list[dict] = []
            max_results = arguments.get("max_results", 50)

            if arguments.get("pattern"):
                for match in path.rglob(arguments["pattern"]):
                    if len(results) >= max_results:
                        break
                    try:
                        validate_path(str(match.resolve()))
                        results.append({"path": str(match), "type": "dir" if match.is_dir() else "file"})
                    except (PermissionError, ValueError):
                        continue

            if arguments.get("content_pattern"):
                compiled = regex.compile(arguments["content_pattern"], regex.IGNORECASE)
                for fp in path.rglob("*"):
                    if len(results) >= max_results:
                        break
                    if not fp.is_file():
                        continue
                    ft = arguments.get("file_types")
                    if ft and fp.suffix not in ft:
                        continue
                    mime = mimetypes.guess_type(str(fp))[0]
                    if mime and not mime.startswith("text/"):
                        continue
                    try:
                        validate_path(str(fp.resolve()))
                        text = fp.read_text(encoding="utf-8", errors="ignore")
                        if compiled.search(text):
                            matches = []
                            for i, line in enumerate(text.splitlines(), 1):
                                if compiled.search(line):
                                    matches.append({"line": i, "content": line.strip()})
                                    if len(matches) >= 3:
                                        break
                            results.append({"path": str(fp), "matches": matches})
                    except (PermissionError, ValueError, OSError):
                        continue

            return [TextContent(type="text", text=json.dumps(results, indent=2, ensure_ascii=False) if results else "No results found.")]

        elif name == "file_info":
            path = validate_path(arguments["path"])
            if not path.exists():
                return [TextContent(type="text", text=f"❌ Not found: {path}")]
            s = path.stat()
            info: dict[str, Any] = {
                "path": str(path), "name": path.name,
                "type": "directory" if path.is_dir() else "file",
                "size_bytes": s.st_size, "size_human": format_size(s.st_size),
                "created": datetime.fromtimestamp(s.st_ctime).isoformat(),
                "modified": datetime.fromtimestamp(s.st_mtime).isoformat(),
                "permissions": oct(s.st_mode)[-3:],
            }
            if path.is_file():
                info["extension"] = path.suffix
                info["mime_type"] = mimetypes.guess_type(str(path))[0]
                if (info.get("mime_type") or "").startswith("text/"):
                    try:
                        text = path.read_text(encoding="utf-8", errors="ignore")
                        info["line_count"] = len(text.splitlines())
                    except Exception:
                        pass
            if path.is_dir():
                try:
                    children = list(path.iterdir())
                    info["children"] = len(children)
                except PermissionError:
                    info["children"] = "denied"
            return [TextContent(type="text", text=json.dumps(info, indent=2, ensure_ascii=False))]

        elif name == "create_directory":
            path = validate_path(arguments["path"])
            path.mkdir(parents=True, exist_ok=True)
            return [TextContent(type="text", text=f"✅ Created: {path}")]

        else:
            return [TextContent(type="text", text=f"❌ Unknown tool: {name}")]

    except PermissionError as e:
        return [TextContent(type="text", text=f"❌ Permission denied: {e}")]
    except FileNotFoundError as e:
        return [TextContent(type="text", text=f"❌ Not found: {e}")]
    except Exception as e:
        return [TextContent(type="text", text=f"❌ Error: {type(e).__name__}: {e}")]


# ── 三种传输方式的启动函数 ──
async def run_stdio():
    """stdio 模式：通过标准输入/输出通信，适合本地使用"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


async def run_sse(host: str = "0.0.0.0", port: int = 8080):
    """SSE 模式：已 deprecated，但仍支持"""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Route, Mount

    sse_transport = SseServerTransport("/messages/")

    async def handle_sse(request):
        async with sse_transport.connect_sse(request.scope, request.receive, request._send) as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    app = Starlette(routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages/", app=sse_transport.handle_post_message),
    ])
    config = uvicorn.Config(app, host=host, port=port)
    await uvicorn.Server(config).serve()


async def run_streamable_http(host: str = "0.0.0.0", port: int = 8080):
    """Streamable HTTP 模式：推荐的远程部署方式"""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Route
    from starlette.requests import Request
    from starlette.responses import Response

    transport = StreamableHTTPServerTransport()

    async def handle_mcp(request: Request) -> Response:
        return await transport.handle_request(request.scope, request.receive, request._send)

    app = Starlette(routes=[
        Route("/mcp", endpoint=handle_mcp, methods=["GET", "POST", "DELETE"]),
    ])
    config = uvicorn.Config(app, host=host, port=port)
    await uvicorn.Server(config).serve()


if __name__ == "__main__":
    import argparse, asyncio

    parser = argparse.ArgumentParser(description="MCP Filesystem Server")
    parser.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default="stdio")
    parser.add_argument("--roots", nargs="+", required=True, help="Allowed root directories")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    init_roots(args.roots)

    if args.transport == "stdio":
        asyncio.run(run_stdio())
    elif args.transport == "sse":
        asyncio.run(run_sse(args.host, args.port))
    elif args.transport == "streamable-http":
        asyncio.run(run_streamable_http(args.host, args.port))
```

### 5.4 运行与测试

```bash
# stdio 模式（本地使用，最常用）
python server.py --transport stdio --roots /Users/michael/projects

# SSE 模式（远程访问，已 deprecated）
python server.py --transport sse --roots /home/data --port 8080

# Streamable HTTP 模式（推荐的生产模式）
python server.py --transport streamable-http --roots /home/data --port 8080

# 使用 mcp CLI 工具测试
mcp dev server.py -- --roots /tmp
```

---

## 六、MCP Server 注册配置

开发完成后，需要将 MCP Server 注册到 AI 客户端中才能使用。以下是三种主流客户端的配置方法。

### 6.1 Claude Desktop

编辑配置文件 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "db-query": {
      "command": "node",
      "args": ["/path/to/mcp-db-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:***@localhost:5432/mydb"
      }
    },
    "filesystem": {
      "command": "python",
      "args": [
        "/path/to/mcp-filesystem/server.py",
        "--transport", "stdio",
        "--roots", "/Users/michael/projects", "/Users/michael/documents"
      ]
    }
  }
}
```

对于远程 Streamable HTTP Server，Claude Desktop 目前主要支持 stdio 传输，需要通过 `mcp-remote` 工具桥接：

```json
{
  "mcpServers": {
    "remote-fs": {
      "command": "npx",
      "args": ["mcp-remote", "http://your-server.com:8080/mcp"]
    }
  }
}
```

### 6.2 Cursor

在 Cursor 设置中找到 MCP Servers 配置区域，或直接编辑项目根目录下的 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "db-query": {
      "command": "node",
      "args": ["/path/to/mcp-db-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:***@localhost:5432/mydb"
      }
    },
    "remote-filesystem": {
      "url": "http://your-server.com:8080/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### 6.3 Hermes Agent

在 Hermes Agent 的配置文件中添加 MCP Server 定义：

```yaml
# ~/.hermes/config.yaml
mcpServers:
  db-query:
    command: node
    args:
      - /path/to/mcp-db-server/dist/index.js
    env:
      DATABASE_URL: "postgresql://user:***@localhost:5432/mydb"
    transport: stdio
    timeout: 30

  remote-fs:
    url: "http://your-server.com:8080/mcp"
    transport: streamable-http
    headers:
      Authorization: "Bearer ${MCP_AUTH_TOKEN}"
    timeout: 60
```

---

## 七、安全最佳实践

MCP Server 暴露的能力直接面向 LLM 的自动决策，这意味着安全防护比传统的 API 服务更加重要。LLM 可能在用户的引导下（甚至在 prompt injection 攻击下）尝试执行危险操作，因此 MCP Server 必须假设**所有输入都可能是恶意的**。

### 7.1 权限控制：最小权限原则

MCP Server 应该以最小权限运行。数据库连接应使用只读角色，文件操作应限制在特定目录内，API 调用应使用受限的 token。

```python
# 白名单机制：路径必须在允许的根目录内
ALLOWED_ROOTS = [Path("/data/public"), Path("/home/user/docs")]

def validate_path(path: str) -> Path:
    resolved = Path(path).resolve()
    for root in ALLOWED_ROOTS:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise PermissionError("Access denied")
```

```typescript
// PostgreSQL：使用只读用户
// ALTER USER mcp_reader SET default_transaction_read_only = on;
const pool = new Pool({
  connectionString: process.env.DATABASE_READONLY_URL,
});
```

### 7.2 输入验证：防御注入攻击

```python
import re

# 表名白名单字符验证
def validate_identifier(name: str) -> bool:
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name))

# SQL 查询只允许 SELECT
FORBIDDEN = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'GRANT']
def validate_sql(sql: str) -> bool:
    upper = sql.upper().strip()
    return upper.startswith('SELECT') and not any(kw in upper for kw in FORBIDDEN)
```

### 7.3 资源限制：防止资源耗尽

```python
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10MB
MAX_LINES = 10000                   # 单次读取最大行数
MAX_QUERY_ROWS = 1000               # 查询最大返回行数
MAX_SEARCH_RESULTS = 100            # 搜索最大结果数
QUERY_TIMEOUT_SECONDS = 30          # 查询超时
```

### 7.4 沙箱隔离

在生产环境中，MCP Server 应该运行在容器内，限制 CPU、内存和网络访问：

```bash
docker run --rm \
  --memory=512m --cpus=0.5 \
  --network=mcp-network \
  --read-only --tmpfs /tmp:size=100m \
  -v /data/public:/data:ro \
  -e DATABASE_URL \
  mcp-filesystem:latest --roots /data
```

### 7.5 日志审计

所有工具调用都应该被记录，包括调用者、参数、结果和耗时。这对于事后审计和异常检测至关重要。

---

## 八、性能调优与生产部署建议

### 8.1 连接池调优

数据库连接池的配置直接影响 Server 的并发能力和响应延迟。关键参数包括最大连接数（`max`）、最小空闲连接（`min`）、空闲超时和连接超时。建议根据预期的并发客户端数量和数据库服务器的连接限制来调整。

### 8.2 缓存策略

对于频繁访问但变化不大的数据（如数据库 schema、目录结构），应该实现 TTL 缓存，避免每次都查询数据库或遍历文件系统。一个简单但有效的方案是使用 Python 的 `functools.lru_cache` 或自定义的 TTL 缓存装饰器。

### 8.3 Streamable HTTP 生产部署架构

推荐的生产部署架构包含以下组件：

- **反向代理（Nginx）**：处理 TLS 终止、负载均衡、请求限流
- **MCP Server 集群**：多个无状态实例，通过负载均衡器分配请求
- **健康检查**：`/health` 端点，用于容器编排的存活探针和就绪探针
- **日志收集**：结构化日志输出到 stdout，由容器运行时收集

Nginx 关键配置注意事项：禁用 `proxy_buffering`（因为 SSE 流需要实时转发），设置合理的 `proxy_read_timeout`（防止长查询被超时断开），配置 CORS 头（如果需要浏览器端访问）。

### 8.4 监控指标

生产环境中应监控以下关键指标：

- **工具调用频率**（按工具名分组）：识别热点工具
- **响应延迟 P50/P95/P99**：保证 LLM 交互体验
- **错误率**（按错误类型分组）：及时发现异常
- **活跃会话数**：监控连接资源使用
- **连接池利用率**：防止数据库连接耗尽

---

## 九、工程化建议：从原型到生产

### 9.1 推荐的项目结构

一个生产级的 MCP Server 项目应该将传输层、业务逻辑、验证逻辑和工具定义清晰分离：

```
mcp-server/
├── src/
│   ├── index.ts              # 入口：根据环境变量选择传输方式
│   ├── server.ts             # MCP Server 实例创建和能力声明
│   ├── handlers/
│   │   ├── tools.ts          # 所有工具的实现逻辑
│   │   ├── resources.ts      # 资源实现
│   │   └── prompts.ts        # 提示词模板
│   ├── validators/
│   │   ├── sql.ts            # SQL 安全校验
│   │   └── path.ts           # 路径安全校验
│   ├── transports/
│   │   ├── stdio.ts          # stdio 传输封装
│   │   └── streamable-http.ts # HTTP 传输封装
│   └── utils/
│       ├── logger.ts         # 结构化日志
│       └── cache.ts          # TTL 缓存
├── tests/
│   ├── tools.test.ts         # 工具功能测试
│   ├── security.test.ts      # 安全测试（注入、越权）
│   └── integration.test.ts   # 端到端集成测试
├── Dockerfile
├── docker-compose.yml
└── package.json
```

### 9.2 测试策略

使用 MCP SDK 提供的 `InMemoryTransport` 可以在不启动真实网络服务的情况下进行端到端测试。测试应覆盖三个维度：功能正确性（工具返回预期结果）、安全性（注入攻击被拒绝）、异常处理（数据库不可用时返回友好错误）。

### 9.3 版本管理

MCP Server 应遵循语义化版本（SemVer）。工具的增删改是破坏性变更（major version），参数的新增是兼容性变更（minor version）。通过 Server 实例的版本号声明，客户端可以感知 Server 的能力变化。

---

## 十、总结与选型建议

### 快速决策矩阵

| 场景 | 推荐传输 | 推荐语言 | 核心理由 |
|------|----------|----------|----------|
| 本地 IDE 集成 | stdio | TypeScript 或 Python | 零配置，延迟最低，兼容性最广 |
| 团队共享工具服务 | Streamable HTTP | 均可 | 远程访问，多客户端，易扩展 |
| Serverless 部署 | Streamable HTTP | TypeScript | Edge Runtime 友好，按需冷启动 |
| 数据库查询工具 | stdio / Streamable HTTP | TypeScript | pg 生态成熟，类型安全 |
| 文件操作工具 | stdio | Python | pathlib 生态强大，简洁直观 |
| 高并发生产服务 | Streamable HTTP | 均可 | 无状态，天然支持水平扩展 |

### 关键决策路径

1. **只在本地使用？** → **stdio**。零网络开销，最广的客户端兼容性
2. **需要远程访问？** → **Streamable HTTP**。官方推荐标准，面向未来
3. **已有 SSE 基础设施？** → 短期可用 **SSE**，但应尽快规划迁移

MCP 协议正在快速演进，但其核心设计理念——**标准化的工具描述、安全的传输层、灵活的原语模型**——已经足够成熟和稳定。现在就动手，为你的核心业务能力构建一个 MCP Server，让 AI Agent 真正"连接"到你的系统中，释放自动化的全部潜力。

---

**参考资料**：

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP 规范（GitHub）](https://github.com/modelcontextprotocol/specification)
- [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers)

---

## 相关阅读

- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/) — 深入拆解 Hermes Agent 的 MCP 集成架构，覆盖并发调度、生命周期管理、OAuth 认证恢复等生产级话题
- [AI Agent with Code Interpreter 实战：沙箱化代码执行](/categories/架构/ai-agent-code-interpreter-sandboxed-execution/) — Docker/Firecracker/gVisor/nsjail 四大沙箱方案对比，让你的 MCP Server 调用的代码执行工具更安全
- [AI Coding Agent 安全实战：沙箱隔离、权限边界、代码审计](/categories/架构/AI-Coding-Agent-安全实战/) — 系统讲解 AI Agent 的安全防护维度，与 MCP Server 的权限设计密切相关
- [AI Agent Observability 进阶：LangSmith vs LangFuse vs Helicone](/categories/架构/2026-06-05-AI-Agent-Observability-LangSmith-LangFuse-Helicone/) — 监控和调试你的 AI Agent 工具调用链路
