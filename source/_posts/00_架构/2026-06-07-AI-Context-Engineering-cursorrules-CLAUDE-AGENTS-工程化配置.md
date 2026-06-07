---
title: 'AI Context Engineering 实战：系统化管理 AI 上下文——.cursorrules/CLAUDE.md/AGENTS.md 的工程化配置与团队共享'
date: 2026-06-07 00:00:00
tags: [ai, context-engineering, cursor, claude, agents, developer-tools]
categories: [架构]
cover: /images/covers/ai-context-engineering-cover.jpg
description: >
  深入解析 Context Engineering 工程化实践：系统讲解 .cursorrules、CLAUDE.md、AGENTS.md、copilot-instructions.md 等主流 AI 编程工具上下文文件的配置方法与团队共享策略。涵盖多层上下文架构设计、Token 预算管理、跨工具兼容方案、CI/CD 集成验证，并提供 Laravel/Next.js/微服务三大技术栈的完整可运行配置示例，附带六大常见踩坑案例与最佳实践清单，帮助团队实现 AI 辅助开发的标准化与一致性。
---

## 引言：为什么你需要 Context Engineering

2024 年以来，AI 辅助编程工具呈现爆发式增长——Cursor、Claude Code、GitHub Copilot、Windsurf、Amazon Q 等如雨后春笋般涌现。开发者们逐渐发现一个共同的痛点：**AI 生成代码的质量，极度依赖你喂给它的上下文信息**。

你是否有过这样的经历：每次开启新对话，都要重复告诉 AI "我们用 Laravel 11 + Pest + PHPStan Level 8"；每个新同事入职都要手把手解释项目规范；AI 生成的代码风格千变万化，因为它根本不知道你团队的编码约定。

这些问题的根源不在于 AI 模型的能力不足，而在于 **上下文管理缺乏系统化方法**。

这就是 **Context Engineering（上下文工程）** 要解决的核心问题。本文将从工程实践角度，系统讲解如何配置和管理 `.cursorrules`、`CLAUDE.md`、`AGENTS.md`、`.github/copilot-instructions.md` 等上下文文件，实现 AI 辅助开发的标准化、可复用、可共享。

---

## 一、什么是 Context Engineering

### 1.1 从 Prompt Engineering 到 Context Engineering

传统的 Prompt Engineering 关注的是如何在单次对话中写出更好的提示词。而 Context Engineering 是一个更高层次的概念——它关注的是如何 **系统化地构建和维护 AI 运行所需的完整上下文环境**。

Andrej Karpathy 曾精辟地总结：

> "The hottest new programming language is English. But Context Engineering is about how you structure that English across your entire project lifecycle."

Context Engineering 包含以下几个维度：

- **静态上下文**：项目规范、架构决策、编码标准等长期不变的信息
- **动态上下文**：当前打开的文件、光标位置、最近修改的代码等实时信息
- **分层上下文**：全局配置、项目级配置、目录级配置的层级关系
- **共享上下文**：团队成员之间如何统一和同步上下文配置

### 1.2 为什么 Context Engineering 对 AI 编程至关重要

一个好的上下文工程实践能带来以下收益：

1. **一致性**：AI 生成的代码风格、架构模式与团队保持一致
2. **效率**：无需每次对话重复基础约束，节省大量沟通成本
3. **质量**：AI 能做出更准确的架构决策，减少返工
4. **可传承**：新成员通过上下文文件快速了解项目规范
5. **可审计**：上下文配置纳入版本控制，变更可追溯

---

## 二、主流 AI 工具的上下文文件概览

目前主流的 AI 编程工具各自定义了上下文文件格式，但核心理念相通：

| AI 工具 | 上下文文件 | 作用域 | 格式 |
|---------|-----------|--------|------|
| Cursor | `.cursorrules` | 项目根目录 | Markdown |
| Cursor | `~/.cursorrules` | 全局用户级 | Markdown |
| Claude Code | `CLAUDE.md` | 项目根目录 | Markdown |
| Claude Code | `~/.claude/CLAUDE.md` | 全局用户级 | Markdown |
| GitHub Copilot | `.github/copilot-instructions.md` | 项目根目录 | Markdown |
| Windsurf | `.windsurfrules` | 项目根目录 | Markdown |
| Amazon Q | `.amazonq/rules/` | 项目根目录 | Markdown |
| 通用 | `AGENTS.md` | 项目根目录 | Markdown |

### 2.1 `.cursorrules` —— Cursor 的上下文引擎

Cursor 是最早引入上下文文件概念的 AI IDE 之一。`.cursorrules` 文件放置在项目根目录，Cursor 在每次对话时会自动加载该文件作为系统级指令。

```markdown
# .cursorrules 示例

## 项目概述
这是一个基于 Laravel 11 的电商平台后端 API。

## 技术栈
- PHP 8.3 + Laravel 11
- MySQL 8.0 + Redis 7
- Pest 用于测试，PHPStan Level 8
- Docker Compose 本地开发环境

## 编码规范
- 遵循 PSR-12 编码标准
- 使用 Pint 自动格式化
- Service 层不直接操作数据库，通过 Repository 模式
- 所有业务逻辑放在 app/Actions/ 目录下
- DTO 使用 spatie/laravel-data 包

## 命名约定
- 表名：复数 snake_case（如 order_items）
- 模型：单数 PascalCase（如 OrderItem）
- 控制器：单数 PascalCase + Controller 后缀
- Action 类：动词开头 PascalCase（如 CreateOrder）
```

Cursor 还支持 `~/.cursorrules` 作为全局配置，适用于所有项目。全局配置适合放置通用偏好，如语言风格、响应格式等。

### 2.2 `CLAUDE.md` —— Claude Code 的项目记忆

Claude Code 使用 `CLAUDE.md` 文件作为项目级上下文。与 `.cursorrules` 类似，但 Claude Code 的设计更强调 **多层记忆系统**：

```
~/.claude/CLAUDE.md          # 全局级：个人偏好
./CLAUDE.md                  # 项目级：项目规范
./src/CLAUDE.md              # 目录级：模块特定上下文
```

Claude Code 会自动发现并合并这些文件。目录级配置对于大型项目尤其有用——你可以在 `src/payments/CLAUDE.md` 中描述支付模块的特殊约束和架构决策。

```markdown
# CLAUDE.md 示例

## 重要约束
- 不要使用 any 类型，严格使用 TypeScript 类型定义
- API 响应统一使用 { success, data, error } 结构
- 所有数据库操作必须通过 Prisma Client
- 禁止在组件中直接调用 API，统一通过 hooks/useApi.ts

## 项目结构
- src/components/ - 可复用 UI 组件
- src/pages/ - Next.js 页面路由
- src/hooks/ - 自定义 React Hooks
- src/lib/ - 工具函数和第三方库封装
- src/types/ - TypeScript 类型定义

## 测试要求
- 使用 Vitest + Testing Library
- 组件测试覆盖率 > 80%
- API 路由必须有集成测试
```

### 2.3 `AGENTS.md` —— 跨工具的通用规范

`AGENTS.md` 是一个更通用的概念，不限于某个特定工具。它的设计理念是为 AI Agent 提供统一的项目理解和行为指引。越来越多的工具开始支持这个文件格式。

```markdown
# AGENTS.md 示例

## Agent 行为规范
1. 修改代码前先阅读相关的测试文件，理解预期行为
2. 生成新代码时必须同步生成测试
3. 遵循现有的错误处理模式，不要引入新的异常处理风格
4. 数据库迁移文件必须向上兼容，不能删除已有列

## 代码审查检查项
- 是否有硬编码的配置值？
- 是否有遗漏的错误处理？
- SQL 查询是否有 N+1 问题？
- 敏感信息是否已脱敏？
```

### 2.4 `.github/copilot-instructions.md` —— GitHub Copilot 的指令

GitHub Copilot 在 2024 年也引入了项目级指令文件：

```markdown
# .github/copilot-instructions.md

## 代码风格
- 使用 TypeScript strict 模式
- 组件使用函数式写法，禁止 class 组件
- 样式使用 Tailwind CSS，不使用内联 style
- 状态管理使用 Zustand，不使用 Redux

## API 规范
- RESTful 端点命名使用 kebab-case
- 所有 API 必须有 OpenAPI 文档
- 分页使用 cursor-based pagination
```

### 2.5 `.windsurfrules` —— Windsurf 的上下文配置

Windsurf（前身为 Codeium）同样采用 Markdown 格式的规则文件。与 Cursor 的 `.cursorrules` 类似，但 Windsurf 支持额外的结构化指令格式：

```markdown
# .windsurfrules

## 项目信息
- 项目类型：SaaS 多租户后台管理系统
- 框架：NestJS 10 + TypeORM + PostgreSQL
- 部署：Docker + Kubernetes (EKS)

## 代码生成规则
- Controller 使用 @ApiTags 装饰器标注 Swagger 分组
- DTO 使用 class-validator 进行验证，配合 @ApiProperty 装饰器
- Service 层方法必须标注返回类型，不允许隐式 any
- 数据库查询使用 QueryBuilder，禁止裸 SQL
- 多租户数据隔离通过 TenantInterceptor 自动注入 tenantId

## 项目结构
src/
├── modules/           # 按业务模块组织
│   ├── auth/          # 认证模块
│   ├── users/         # 用户管理
│   └── billing/       # 计费模块
├── common/            # 共享组件
│   ├── decorators/    # 自定义装饰器
│   ├── filters/       # 异常过滤器
│   ├── guards/        # 认证守卫
│   └── interceptors/  # 拦截器
└── config/            # 配置模块
```

### 2.6 各工具上下文文件格式差异速查

虽然各工具都使用 Markdown 格式，但在指令语法上存在细微差异，跨工具同步时需要注意：

| 特性 | Cursor `.cursorrules` | Claude `CLAUDE.md` | Copilot `.github/copilot-instructions.md` | Windsurf `.windsurfrules` |
|------|----------------------|-------------------|------------------------------------------|--------------------------|
| 结构化标签 | 支持 `@file` `@folder` 引用 | 支持 `<!-- comment -->` 元数据 | 纯 Markdown | 支持 `@context` 标签 |
| 路径引用 | `@file:src/api/routes.ts` | 相对路径即可 | 不支持 | `@context:src/` |
| 条件指令 | 不支持 | 不支持 | 不支持 | 有限支持 |
| 多语言注释 | `<!-- -->` HTML 注释 | `<!-- -->` HTML 注释 | `<!-- -->` HTML 注释 | `<!-- -->` HTML 注释 |
| 推荐编码 | UTF-8 | UTF-8 | UTF-8 | UTF-8 |
| 行数建议 | ≤100 行 | ≤150 行 | ≤80 行 | ≤100 行 |

---

## 三、上下文文件的解剖学：一个好配置的组成要素

一个高质量的上下文文件应包含以下核心模块：

### 3.1 项目概述与技术栈

这是最基础的信息，让 AI 快速理解项目全貌：

```markdown
## 技术栈
- 语言：TypeScript 5.4 + Node.js 20 LTS
- 框架：Next.js 14 (App Router)
- 数据库：PostgreSQL 16 + Prisma ORM
- 缓存：Redis 7 (ioredis)
- 部署：Vercel + AWS RDS
- 包管理：pnpm 9
```

### 3.2 架构决策记录（ADR）

关键的架构决策应明确记录，防止 AI 做出违背设计意图的修改：

```markdown
## 架构决策
1. **服务端组件优先**：优先使用 React Server Components，仅在需要交互性时使用 'use client'
2. **API 层使用 tRPC**：不使用 REST API，全部通过 tRPC 实现类型安全的前后端通信
3. **认证使用 NextAuth.js v5**：不自行实现 JWT，统一使用 NextAuth 的 Session 管理
4. **错误处理**：使用 neverthrow 库的 Result 类型，不使用 try-catch 控制流
```

### 3.3 编码规范与命名约定

```markdown
## 编码规范
- 文件命名：kebab-case（user-profile.tsx）
- 组件命名：PascalCase（UserProfile）
- Hook 命名：use 前缀（useUserSession）
- 常量命名：UPPER_SNAKE_CASE（MAX_RETRY_COUNT）
- 接口命名：不加 I 前缀（User 而非 IUser）
- 数据库字段：snake_case，TypeScript 属性：camelCase
```

### 3.4 禁止事项与常见陷阱

明确告诉 AI 不要做什么，比告诉它要做什么有时更有效：

```markdown
## 禁止事项
- ❌ 不使用 moment.js，使用 date-fns 或 dayjs
- ❌ 不使用 var 声明变量
- ❌ 不在组件中直接使用 fetch，统一通过 apiClient
- ❌ 不要为了一致性而强制同步修改不相关的文件
- ❌ 不要使用 console.log 进行调试，使用 pino logger
- ❌ 不要生成 index.ts 桶文件（barrel files），会导致 tree-shaking 失效
```

---

## 四、多层上下文架构：从全局到目录

Context Engineering 的核心设计原则之一是 **分层管理**。不同层级的上下文解决不同粒度的问题：

```
~/.cursorrules                    # 第一层：全局（个人偏好）
├── 项目根目录/.cursorrules       # 第二层：项目级（项目规范）
│   ├── src/payments/.cursorrules # 第三层：目录级（模块特定）
│   └── src/auth/.cursorrules     # 第三层：目录级（模块特定）
```

### 4.1 全局上下文——个人偏好

```markdown
# ~/.cursorrules

## 响应偏好
- 回答使用中文
- 代码注释使用英文
- 解释保持简洁，不要过度展开
- 生成代码时附带简要说明

## 通用编码偏好
- 优先使用最新语言特性
- 优先使用不可变数据结构
- 错误处理倾向于显式而非隐式
```

### 4.2 项目级上下文——团队规范

项目级上下文是最重要的层，应该纳入版本控制，在团队中共享。这是新成员了解项目的最佳文档。

### 4.3 目录级上下文——模块特化

对于大型项目，不同模块可能有不同的技术约束：

```markdown
# src/payments/.cursorrules

## 支付模块特定规范
- 所有金额使用整数（分为单位），不使用浮点数
- 支付状态机转换必须通过 PaymentStateMachine 类
- 与第三方支付网关的交互封装在 PaymentGateway 接口中
- 所有支付操作必须记录审计日志
- 退款逻辑必须支持部分退款
```

```markdown
# src/ml/.cursorrules

## 机器学习模块规范
- 模型推理使用 ONNX Runtime，不直接调用 PyTorch
- 特征工程代码放在 features/ 子目录
- 模型版本通过 MLflow 追踪
- 所有数据预处理必须有对应的单元测试
```

### 4.4 上下文继承与合并

大多数 AI 工具会自动合并多层上下文，遵循就近原则——目录级配置优先于项目级，项目级优先于全局。理解这个合并机制有助于避免冲突：

- **全局层**放置：通用偏好、语言风格、响应格式
- **项目层**放置：技术栈、架构决策、团队编码规范
- **目录层**放置：模块特定约束、领域知识、局部覆盖规则

---

## 五、版本控制与团队共享策略

### 5.1 将上下文文件纳入 Git

上下文文件应像其他源代码一样纳入版本控制。推荐的做法：

```bash
# 确保上下文文件被提交
git add .cursorrules CLAUDE.md AGENTS.md .github/copilot-instructions.md
git commit -m "chore: add AI context configuration files"
```

### 5.2 上下文文件的 Code Review

上下文文件的变更应纳入正常的 Code Review 流程：

```yaml
# .github/CODEOWNERS
# 上下文文件变更需要 Tech Lead 审批
/.cursorrules            @tech-lead
/CLAUDE.md               @tech-lead
/AGENTS.md               @tech-lead
/.github/copilot-instructions.md  @tech-lead
```

### 5.3 上下文文件的模板化

对于多仓库项目，建议维护一个上下文模板仓库：

```bash
# 上下文模板初始化脚本
#!/bin/bash
TEMPLATE_REPO="git@github.com:org/ai-context-templates.git"

# 检查是否已有上下文文件
if [ ! -f ".cursorrules" ]; then
    echo "Initializing AI context files from template..."
    git archive --remote=$TEMPLATE_REPO main laravel-project | tar -x
    echo "Done. Please review and customize the context files."
fi
```

### 5.4 跨工具兼容方案

由于不同 AI 工具使用不同的文件名，维护多份配置会增加成本。推荐使用符号链接或构建脚本来同步：

```json
// package.json scripts
{
  "scripts": {
    "sync:context": "cp CLAUDE.md .cursorrules && cp CLAUDE.md AGENTS.md && cp CLAUDE.md .github/copilot-instructions.md",
    "context:validate": "node scripts/validate-context.js"
  }
}
```

或者使用一个主文件 + 软链接的方式：

```bash
# 以 CLAUDE.md 为主文件
ln -s CLAUDE.md .cursorrules
ln -s CLAUDE.md AGENTS.md
ln -s CLAUDE.md .github/copilot-instructions.md
```

注意：某些 AI 工具的上下文格式有细微差异（如 Cursor 支持更结构化的规则），完全统一可能需要一个转换脚本。

---

## 六、实战示例：三大技术栈的上下文配置

### 6.1 Laravel/PHP 项目

```markdown
# CLAUDE.md — Laravel 11 电商平台

## 技术栈
- PHP 8.3 / Laravel 11 / MySQL 8.0
- Pest 3 / PHPStan Level 9 / Pint
- Docker / Laravel Sail

## 架构模式
- 采用 Action 模式封装业务逻辑，路径 app/Actions/
- Controller 仅负责请求验证和调用 Action
- 使用 Form Request 进行输入验证
- DTO 使用 spatie/laravel-data
- 事件驱动：关键业务操作通过 Event/Listener 解耦

## 编码规范
- PSR-12 + Pint 自动格式化
- 所有方法必须有返回类型声明
- 使用构造函数注入，不使用 app() 辅助函数
- Eloquent 关系使用显式类型注解
- 数据库查询使用 Query Builder 或 Repository，禁止在 Controller 中写原生 SQL

## 目录约定
app/
├── Actions/          # 业务逻辑（单一职责）
├── Collections/      # 自定义集合类
├── Concerns/         # Trait
├── Data/             # DTO (spatie/laravel-data)
├── Enums/            # PHP 8.3 枚举
├── Events/           # 事件类
├── Exceptions/       # 自定义异常
├── Http/
│   ├── Controllers/  # 仅做请求分发
│   ├── Middleware/    # 中间件
│   └── Requests/     # Form Request 验证
├── Listeners/        # 事件监听器
├── Models/           # Eloquent 模型
├── Notifications/    # 通知类
├── Observers/        # 模型观察者
├── Policies/         # 授权策略
├── Providers/        # 服务提供者
├── Queries/          # 复杂查询封装
├── Repositories/     # Repository 接口与实现
├── Services/         # 第三方服务封装
└── ValueObjects/     # 值对象

## 测试约定
- 测试文件与源文件对应：app/Actions/CreateOrder.php → tests/Feature/Actions/CreateOrderTest.php
- 使用 Pest 的 expect API，不使用 PHPUnit 的 assert
- 使用工厂创建测试数据，不硬编码
- Feature 测试覆盖完整业务流程，Unit 测试覆盖边界条件
```

### 6.2 React/Next.js 项目

```markdown
# CLAUDE.md — Next.js 14 SaaS 应用

## 技术栈
- Next.js 14 (App Router) / TypeScript 5.4 strict
- tRPC / Prisma / PostgreSQL 16
- Tailwind CSS / Radix UI
- Vitest / Playwright
- pnpm 9 / Turborepo

## 核心架构原则
1. **Server Components 优先**：默认使用 Server Component，仅在需要浏览器 API 或交互时添加 'use client'
2. **数据获取在服务端**：通过 Server Component 或 tRPC server 调用数据库，不在客户端直接查询
3. **类型安全贯穿全栈**：tRPC 实现端到端类型安全，前端调用后端无需手写类型
4. **组件组合模式**：优先使用组合（children props, render props）而非 prop drilling

## 项目结构
src/
├── app/                # Next.js App Router 路由
│   ├── (auth)/         # 认证相关路由组
│   ├── (dashboard)/    # 仪表盘路由组
│   └── api/trpc/       # tRPC 路由处理
├── components/
│   ├── ui/             # 基础 UI 组件（来自 Radix）
│   ├── layout/         # 布局组件
│   └── features/       # 业务功能组件
├── hooks/              # 自定义 Hooks
├── lib/                # 工具库封装
├── server/
│   ├── trpc/           # tRPC 路由定义
│   ├── db/             # Prisma Client 封装
│   └── auth/           # 认证逻辑
├── styles/             # 全局样式
└── types/              # 共享类型定义

## 编码规范
- 组件使用 function 声明，不使用箭头函数
- Props 接口命名：ComponentNameProps
- 导出顺序：默认导出 > 命名导出 > 类型导出
- 错误边界使用 error.tsx 文件
- Loading 状态使用 loading.tsx 文件
```

### 6.3 多语言微服务项目

```markdown
# AGENTS.md — 微服务电商平台

## 项目概述
这是一个多语言微服务架构的电商平台，不同服务使用最适合的技术栈。

## 服务矩阵
| 服务 | 技术栈 | 路径 | 通信方式 |
|------|--------|------|---------|
| API Gateway | Go + Gin | /gateway | HTTP/2 |
| 用户服务 | Python + FastAPI | /services/user | gRPC |
| 订单服务 | Java + Spring Boot | /services/order | gRPC + Kafka |
| 支付服务 | Node.js + Fastify | /services/payment | gRPC |
| 搜索服务 | Rust + Actix | /services/search | gRPC |
| 前端 | React + Next.js | /frontend | REST to Gateway |

## 跨服务规范
- 所有服务间通信使用 Protocol Buffers 定义接口
- 共享 Proto 定义放在 /proto/ 目录
- 每个服务必须有 Dockerfile 和 docker-compose 配置
- 日志格式统一为 JSON，字段包括 timestamp, level, service, traceId
- 配置管理：开发环境用 .env，生产环境用 Kubernetes ConfigMap
- 数据库迁移文件放在各服务的 migrations/ 目录
- 健康检查端点统一为 GET /health

## 开发流程
1. Proto 文件变更需先提 MR 并获得 API 团队审批
2. 服务端实现必须先写集成测试
3. 前端调用通过 tRPC Gateway 代理到各服务
```

### 6.4 Python/FastAPI 项目

```markdown
# .cursorrules — Python/FastAPI 数据平台

## 技术栈
- Python 3.12 / FastAPI 0.111 / SQLAlchemy 2.0
- PostgreSQL 16 / Redis 7 / Celery 5
- Pydantic v2 / uvicorn
- pytest + httpx + factory_boy
- Ruff 格式化 + mypy strict

## 架构规范
- 使用 Repository 模式封装数据访问层
- Service 层处理业务逻辑，不直接依赖 SQLAlchemy
- 依赖注入通过 FastAPI 的 Depends 机制
- Pydantic 模型分层：CreateSchema / UpdateSchema / ResponseSchema
- 异步优先：所有 I/O 操作使用 async/await

## 代码规范
- 遵循 PEP 8 + Ruff 自动格式化
- 类型注解必须完整，mypy strict 模式不允许 Any
- 函数和类必须有 docstring（Google 风格）
- 导入顺序：标准库 → 第三方库 → 本地模块（isort）
- 使用 pathlib 替代 os.path

## 项目结构
app/
├── api/               # API 路由
│   ├── deps.py        # 依赖注入定义
│   └── v1/            # API v1 版本
├── core/              # 核心配置
│   ├── config.py      # Pydantic Settings
│   └── security.py    # JWT / OAuth
├── crud/              # 数据访问层（Repository）
├── db/                # 数据库相关
│   ├── models/        # SQLAlchemy ORM 模型
│   └── session.py     # 数据库会话管理
├── schemas/           # Pydantic 模型
├── services/          # 业务逻辑层
└── tasks/             # Celery 异步任务
```

### 6.5 Go/Gin 微服务项目

```markdown
# CLAUDE.md — Go/Gin API Gateway

## 技术栈
- Go 1.22 / Gin 1.10 / gRPC
- PostgreSQL 16 / Redis 7
- Wire 依赖注入 / Zap 日志
- golangci-lint / go test -race

## 编码规范
- 遵循 Go 官方风格：gofmt + goimports
- 错误处理：使用 fmt.Errorf + %w 包装错误链
- 不使用 panic，所有错误显式返回
- 接口定义放在消费者侧，不在 provider 包中
- 使用 context.Context 传递请求级数据

## 项目结构
cmd/
├── server/            # 主服务入口
└── worker/            # 后台任务入口
internal/
├── config/            # 配置加载
├── handler/           # HTTP Handler（类似 Controller）
├── middleware/         # 中间件
├── model/             # 数据模型
├── repository/        # 数据访问层
├── service/           # 业务逻辑层
└── pkg/               # 内部共享工具
pkg/                   # 可外部引用的工具包
proto/                 # gRPC Proto 定义

## 特殊约束
- 所有公开函数必须有 godoc 注释
- 依赖注入使用 Wire 编译时注入，不使用运行时反射
- 并发安全：共享状态必须通过 channel 或 sync 包保护
- HTTP 响应统一使用 { code, data, message } 结构
- 数据库迁移使用 golang-migrate
```

---

## 七、上下文优化：Token 预算管理

### 7.1 理解 Token 预算

上下文文件虽然强大，但并非越大越好。AI 模型的上下文窗口有限，上下文文件会占用宝贵的 Token 预算。一个好的上下文文件应该 **精炼而完整**。

典型 Token 预算分配：

| 上下文类型 | Token 占比 | 说明 |
|-----------|-----------|------|
| 系统指令 | 10-15% | 模型行为设定 |
| 上下文文件 | 5-10% | 项目规范 |
| 对话历史 | 20-30% | 当前对话的上下文 |
| 代码上下文 | 40-50% | 当前编辑的文件和相关代码 |
| 响应预留 | 10-15% | AI 生成响应的空间 |

### 7.2 应该包含的内容

- **高频约束**：每次对话都需要的编码规范、命名约定
- **关键架构决策**：影响代码结构的核心设计选择
- **技术栈版本**：框架、库的具体版本信息
- **禁止事项**：明确列出不应该使用的模式或库
- **目录结构**：帮助 AI 理解代码组织方式

### 7.3 应该避免的内容

- **详细的 API 文档**：应由 AI 自行阅读代码获取
- **临时性信息**：当前 Sprint 的任务、临时热修复说明
- **过于宽泛的原则**：如"写干净的代码"——这对 AI 没有指导意义
- **完整的数据库 Schema**：AI 可以直接读取迁移文件
- **第三方库的使用文档**：AI 模型通常已包含主流库的知识

### 7.4 Token 预算优化技巧

```markdown
## 优化前（~2000 tokens，冗余）
我们使用 TypeScript 编写代码。TypeScript 是 JavaScript 的超集，
由微软开发维护。我们项目中所有的 JavaScript 文件都使用 TypeScript
重写。TypeScript 提供了静态类型检查，可以在编译时发现错误...

## 优化后（~100 tokens，精炼）
- TypeScript 5.4 strict mode
- tsconfig.json 中 strict: true, noUncheckedIndexedAccess: true
```

---

## 八、高级模式：动态上下文与 CI/CD 集成

### 8.1 动态上下文生成

静态上下文文件虽然有效，但某些信息会随项目演进而变化。可以通过脚本动态生成部分上下文：

```javascript
// scripts/generate-context.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 自动扫描目录结构
function getDirectoryTree(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return '';
  const items = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  let tree = '';
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    const indent = '  '.repeat(depth);
    if (stat.isDirectory()) {
      tree += `${indent}- ${item}/\n`;
      tree += getDirectoryTree(fullPath, depth + 1, maxDepth);
    }
  }
  return tree;
}

// 提取 package.json 中的依赖信息
function getDependencies() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {}).join(', ');
  const devDeps = Object.keys(pkg.devDependencies || {}).join(', ');
  return { deps, devDeps };
}

// 生成上下文文件
const context = `# Auto-generated context (do not edit manually)
# Last updated: ${new Date().toISOString()}

## 项目结构
${getDirectoryTree('./src')}

## 主要依赖
${getDependencies().deps}

## 开发依赖
${getDependencies().devDeps}
`;

fs.writeFileSync('CONTEXT_DYNAMIC.md', context);
console.log('Dynamic context generated.');
```

### 8.2 CI/CD 集成——上下文文件验证

将上下文文件的验证集成到 CI/CD 流程中，确保配置的正确性和一致性：

```yaml
# .github/workflows/validate-context.yml
name: Validate AI Context Files

on:
  pull_request:
    paths:
      - '.cursorrules'
      - 'CLAUDE.md'
      - 'AGENTS.md'
      - '.github/copilot-instructions.md'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check context files exist
        run: |
          for file in CLAUDE.md AGENTS.md; do
            if [ ! -f "$file" ]; then
              echo "ERROR: $file is missing"
              exit 1
            fi
          done

      - name: Validate context file format
        run: |
          # 检查必须包含的章节
          required_sections=("技术栈" "编码规范" "禁止事项")
          for section in "${required_sections[@]}"; do
            if ! grep -q "$section" CLAUDE.md; then
              echo "WARNING: CLAUDE.md is missing required section: $section"
            fi
          done

      - name: Check token budget
        run: |
          # 估算 token 数量（粗略：1 token ≈ 4 字符）
          char_count=$(wc -c < CLAUDE.md)
          token_estimate=$((char_count / 4))
          echo "CLAUDE.md estimated tokens: $token_estimate"
          if [ "$token_estimate" -gt 3000 ]; then
            echo "WARNING: CLAUDE.md exceeds recommended token budget (3000 tokens)"
            echo "Consider trimming less essential sections"
          fi

      - name: Check for secrets
        run: |
          # 确保上下文文件中不包含敏感信息
          patterns=("\.env" "password" "secret_key" "api_key" "private_key")
          for pattern in "${patterns[@]}"; do
            if grep -i "$pattern" CLAUDE.md .cursorrules AGENTS.md 2>/dev/null; then
              echo "ERROR: Possible secret found matching pattern: $pattern"
              exit 1
            fi
          done
```

### 8.3 上下文版本化

对于需要长期维护的项目，可以对上下文文件实施版本管理：

```markdown
# CLAUDE.md

<!-- context-version: 2.3.0 -->
<!-- last-reviewed: 2026-06-01 -->
<!-- reviewer: @tech-lead -->

## 变更日志
- v2.3.0 (2026-06-01): 添加 Server Components 规范
- v2.2.0 (2026-05-15): 更新测试策略，引入 Playwright
- v2.1.0 (2026-04-20): 添加 tRPC 相关规范
- v2.0.0 (2026-03-01): 迁移至 Next.js 14 App Router
```

### 8.4 Context Engineering 工具生态

随着 Context Engineering 理念的普及，社区涌现出多种辅助工具，帮助团队更高效地管理和维护上下文配置：

| 工具 | 类型 | 功能 | 适用场景 |
|------|------|------|---------|
| [contextcraft](https://github.com/punkpeye/contextcraft) | CLI | 扫描项目结构自动生成上下文文件 | 新项目初始化 |
| [cursor-tools](https://github.com/eastlondoner/cursor-tools) | CLI | Cursor 辅助命令行工具，支持规则验证 | Cursor 用户 |
| [rulesync](https://github.com/airtaks/rulesync) | CLI | 跨工具上下文文件同步 | 多工具团队 |
| [aider](https://github.com/paul-gauthier/aider) | CLI | AI 编程助手，支持 `.aider.conf.yml` 配置 | 终端用户 |
| 自定义脚本 | Script | 结合 git hooks 自动生成动态上下文 | CI/CD 集成 |

一个实用的 Git pre-commit hook 示例，确保上下文文件在提交前通过基本校验：

```bash
#!/bin/bash
# .git/hooks/pre-commit

# 检查上下文文件是否包含敏感信息
for file in CLAUDE.md .cursorrules AGENTS.md; do
  if [ -f "$file" ]; then
    if grep -qiE "(password|secret_key|api_key|private_key)\s*[:=]" "$file"; then
      echo "❌ ERROR: $file may contain secrets. Please remove them before committing."
      exit 1
    fi
  fi
done

# 检查文件大小
for file in CLAUDE.md .cursorrules; do
  if [ -f "$file" ]; then
    lines=$(wc -l < "$file")
    if [ "$lines" -gt 200 ]; then
      echo "⚠️  WARNING: $file has $lines lines (recommended: <200). Consider trimming."
    fi
  fi
done

echo "✅ Context files validation passed."
```

---

## 九、各工具上下文机制对比

| 特性 | Cursor | Claude Code | GitHub Copilot | Windsurf |
|------|--------|------------|----------------|----------|
| 配置文件 | `.cursorrules` | `CLAUDE.md` | `.github/copilot-instructions.md` | `.windsurfrules` |
| 全局配置 | `~/.cursorrules` | `~/.claude/CLAUDE.md` | ❌ | `~/.windsurfrules` |
| 目录级配置 | ❌ | ✅ (`子目录/CLAUDE.md`) | ❌ | ❌ |
| 多文件合并 | ❌ | ✅ | ❌ | ❌ |
| 格式 | Markdown | Markdown | Markdown | Markdown |
| Token 预算建议 | ≤4000 | ≤4000 | ≤3000 | ≤4000 |
| 自动加载 | ✅ | ✅ | ✅ | ✅ |
| 版本控制友好 | ✅ | ✅ | ✅ | ✅ |
| 团队共享 | Git | Git | Git | Git |
| 动态生成支持 | 手动 | 手动 | 手动 | 手动 |
| 实时预览 | ❌ | 需重启 | 需重启 | 需重启 |

从对比可以看出，Claude Code 在上下文管理方面最为成熟——支持目录级配置和多文件自动合并，这对于大型项目来说是一个显著优势。Cursor 的 `.cursorrules` 简单易用，生态最成熟。GitHub Copilot 的配置能力相对有限，但胜在与 GitHub 平台的深度集成。

---

## 十、常见陷阱与最佳实践

### 10.1 六大常见陷阱

**陷阱一：上下文文件过长**

当上下文文件超过 4000 tokens 时，AI 的注意力会被稀释，反而降低生成质量。解决方案是精炼内容，移除可以从代码中自行推断的信息。

**陷阱二：上下文文件与代码不同步**

项目演进了但上下文文件没有更新，导致 AI 基于过时的约束生成代码。解决方案是将上下文文件变更纳入 PR Review 流程。

**陷阱三：团队成员各自维护私有配置**

全局配置（如 `~/.cursorrules`）适合个人偏好，但关键项目约束不应只存在于某个人的全局配置中。解决方案是将核心约束放在项目级配置中。

**陷阱四：禁止事项过多**

当禁止列表太长时，AI 可能会 "过度谨慎"，生成过于保守的代码。解决方案是只列出高频出现的错误模式。

**陷阱五：忽略 Token 预算**

把整个项目的 README 搬进上下文文件，导致真正有用的约束被淹没在大量无关信息中。解决方案是分离 "AI 需要知道的" 和 "人类需要阅读的"。

**陷阱六：不同工具的配置不一致**

使用 `.cursorrules` 的规范和 `CLAUDE.md` 的规范不一致，导致切换工具时 AI 行为突变。解决方案是建立单一事实源（single source of truth），通过同步机制保持一致。

**陷阱七：过度依赖模板，缺少项目特异性**

直接从网上复制通用模板而不做定制，AI 生成的代码虽然规范但与项目实际需求脱节。例如模板写了 "使用 REST API"，但项目实际使用 GraphQL。解决方案是在模板基础上，必须补充项目独有的架构决策和约束。

**陷阱八：上下文文件中包含硬编码的环境信息**

将数据库连接串、API 端点、环境变量值写入上下文文件，导致不同环境切换时出错或泄露敏感信息。解决方案是只写配置项的名称和用途，不写具体值。

```markdown
# ❌ 错误做法
数据库连接：postgresql://admin:secret@prod-db.internal:5432/myapp

# ✅ 正确做法
数据库配置通过 DATABASE_URL 环境变量注入，连接池大小由 DB_POOL_SIZE 控制
```

**陷阱九：未考虑 AI 工具升级导致的格式变更**

AI 工具迭代频繁，上下文文件的解析规则可能随版本更新。例如 Cursor 在某次更新中改变了 `.cursorrules` 的优先级逻辑。解决方案是关注工具更新日志，并在 CI 中添加兼容性测试。

**陷阱十：多人同时编辑导致合并冲突**

上下文文件与代码一起提交时，多人同时修改容易产生 Git 冲突。解决方案是：(1) 将上下文文件按模块拆分到子目录；(2) 使用 CODEOWNERS 限制编辑权限；(3) 大型团队考虑使用上下文生成工具自动维护。

### 10.2 不同技术栈的上下文配置策略对比

不同技术栈在编写上下文文件时有不同的关注重点：

| 关注维度 | 前端 (React/Vue) | 后端 (Python/Java) | 移动端 (Flutter/Swift) | 基础设施 (IaC) |
|---------|-----------------|-------------------|----------------------|---------------|
| 核心约束 | 组件模式、状态管理 | API 设计、ORM 规范 | 平台 API、性能约束 | 安全策略、资源命名 |
| 命名重点 | 组件/PascalCase | 类/方法/PascalCase | Widget/Snake_case | 资源/kebab-case |
| 测试关注 | 组件渲染、交互 | 接口集成、数据库 | UI 自动化、快照 | Plan 输出校验 |
| 禁止事项 | class 组件、any 类型 | 裸 SQL、全局变量 | 主线程阻塞操作 | 硬编码 secrets |
| 文件大小建议 | 1500-2500 tokens | 2000-3000 tokens | 1500-2000 tokens | 1000-2000 tokens |
| 特殊关注 | 响应式设计、a11y | 并发、事务、N+1 | 内存泄漏、电池消耗 | 状态漂移、计划确认 |
 
 ### 10.3 最佳实践清单

```markdown
## Context Engineering 最佳实践

1. ✅ 保持上下文文件精炼，控制在 2000-3000 tokens 以内
2. ✅ 将上下文文件纳入版本控制，与代码同审
3. ✅ 建立 Code Ownership，上下文文件变更需 Lead 审批
4. ✅ 使用分层架构：全局偏好 → 项目规范 → 模块特定约束
5. ✅ 每季度 Review 一次上下文文件，移除过时信息
6. ✅ 为新项目提供上下文模板，降低配置门槛
7. ✅ CI 中验证上下文文件格式和完整性
8. ✅ 团队使用统一的 AI 工具集，减少兼容性成本
9. ✅ 记录架构决策的 "为什么"，不仅是 "是什么"
10. ✅ 定期收集团队反馈，持续优化上下文配置
```

---

## 总结

Context Engineering 不是一个新概念，但它在 AI 辅助编程时代变得前所未有地重要。通过系统化地管理 `.cursorrules`、`CLAUDE.md`、`AGENTS.md` 等上下文文件，你可以：

1. **将隐性知识显性化**：团队的编码规范、架构决策、最佳实践不再只是口头传递
2. **实现 AI 输出一致性**：不同开发者使用相同的上下文配置，AI 生成的代码风格统一
3. **加速新成员融入**：上下文文件本身就是极好的项目文档
4. **提升开发效率**：减少重复说明，让 AI 在正确的约束下高效工作

未来，随着 AI Agent 能力的增强和工具生态的成熟，Context Engineering 的实践将变得更加精细化和自动化。可以预见的趋势包括：上下文文件的自动生成与智能推荐、基于代码变更的动态上下文适配、以及跨团队的上下文共享平台。但核心原则不变——**理解你的项目，记录你的决策，约束你的 AI，保持你的配置活着**。

开始行动吧：为你的项目创建一个 `CLAUDE.md` 或 `.cursorrules`，提交到 Git 仓库，邀请团队成员共同维护。这是你在 AI 辅助编程时代最有价值的工程化投资之一。

---

*本文最后更新于 2026 年 6 月。AI 工具生态变化迅速，建议结合各工具官方文档获取最新信息。*

## 相关阅读

- [AI Pair Programming 评估实战：Copilot vs Cursor vs Claude Code 代码质量开发速度与开发者满意度量化研究](/post/AI-Pair-Programming-Copilot-Cursor-Claude-Code-评估实战.html)
- [Claude Agent SDK 实战：Anthropic 官方 Agent 开发框架 MCP 原生集成](/post/2026-06-07-Claude-Agent-SDK-实战-Anthropic官方Agent开发框架-MCP原生集成.html)
- [AI Agent 代码助手实战：代码生成 Review 重构 文档生成](/post/AI-Agent-代码助手实战-代码生成-Review-重构-文档生成.html)
- [Windsurf Augment Code AI-native IDE 对比 Cursor Claude Code](/categories/前端/2026-06-05-Windsurf-Augment-Code-AI-native-IDE-对比-Cursor-Claude-Code/)
