# Monorepo 构建策略（Nx vs Turborepo vs Pants）

## 定义

Monorepo（单一代码仓库）是将多个项目/包/服务放在同一个 Git 仓库中的代码管理策略。构建工具负责**任务编排、增量构建、缓存和依赖图分析**，解决 Monorepo 在规模化后的构建性能问题。

## 核心挑战

- **构建时间随项目规模线性增长**：10 个包 × 每个 2 分钟 = 20 分钟
- **不知道改了什么影响什么**：修改公共库后，哪些包需要重新构建？
- **CI 资源浪费**：每次都全量构建，即使只改了一行代码

## 三种工具对比

| 维度 | Nx | Turborepo | Pants |
|------|-----|-----------|-------|
| 出品方 | Nrwl（Angular 团队） | Vercel（Next.js 团队） | Pantsbuild（原 Twitter） |
| 语言支持 | JS/TS 为主，支持 Go/Rust/Java | JS/TS 专注 | 多语言（Python/Go/Java/Shell） |
| 依赖图分析 | ✅ 静态分析 + 插件 | ✅ 基于 package.json | ✅ 精确文件级依赖 |
| 远程缓存 | Nx Cloud（商业） | Vercel Remote Cache / 自建 | 支持多种后端 |
| 任务编排 | 丰富（run-many, affected） | 简洁（pipeline 配置） | 强大（精确依赖） |
| 增量构建 | ✅ 精确到文件 | ✅ 基于文件 hash | ✅ 精确到文件 |
| 上手难度 | 中等（概念多） | 低（配置简单） | 高（学习曲线陡） |
| 社区生态 | 丰富（插件体系） | 活跃（Vercel 生态） | 较小（大厂内部用） |
| 适用规模 | 中大型（50+ 包） | 中小型（5-30 包） | 超大型（100+ 包） |
| PHP/Laravel 支持 | 有限 | 不支持 | 有限 |

## 核心原理

### 依赖图（Dependency Graph）

```
                    ┌─────────┐
                    │  @app/  │
                    │  web    │
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌─────────┐ ┌─────────┐ ┌─────────┐
        │@shared/ │ │@feature/│ │@feature/│
        │utils    │ │orders   │ │payments │
        └────┬────┘ └────┬────┘ └────┬────┘
             │           │           │
             └─────┬─────┘           │
                   ▼                 │
             ┌─────────┐            │
             │@shared/ │◄───────────┘
             │types    │
             └─────────┘

修改 @shared/types → 重新构建：orders, payments, web
修改 @feature/orders → 重新构建：web（仅受影响的包）
```

### 任务流水线（Pipeline）

```jsonc
// Turborepo turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],  // 先构建依赖包
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]    // 先构建再测试
    },
    "lint": {}                   // 无依赖，可并行
  }
}
```

### 缓存策略

```
第一次构建：
  @shared/types  ──→ build ──→ hash(abc123) ──→ 缓存 dist/
  @shared/utils  ──→ build ──→ hash(def456) ──→ 缓存 dist/
  @app/web       ──→ build ──→ hash(ghi789) ──→ 缓存 dist/

第二次构建（仅修改 @shared/utils）：
  @shared/types  ──→ hash(abc123) ──→ 命中缓存 ✅ 跳过
  @shared/utils  ──→ hash(xxx999) ──→ 缓存失效 ❌ 重新构建
  @app/web       ──→ hash(xxx111) ──→ 缓存失效 ❌ 重新构建
```

## Laravel + 前端 Monorepo 场景

```
monorepo/
├── apps/
│   ├── web/          # Vue 3 前端
│   ├── admin/        # 管理后台
│   └── api/          # Laravel API
├── packages/
│   ├── ui/           # 共享 UI 组件
│   ├── types/        # 共享 TypeScript 类型
│   └── config/       # 共享配置（ESLint/Prettier）
├── package.json
└── turbo.json        # 或 nx.json
```

```jsonc
// Nx nx.json
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx-cloud",
      "options": {
        "cacheableOperations": ["build", "test", "lint"]
      }
    }
  },
  "affected": {
    "defaultBase": "main"
  }
}
```

### CI 中的 affected 构建

```yaml
# GitHub Actions
- name: Build affected
  run: npx nx affected --target=build --base=origin/main --head=HEAD

- name: Test affected
  run: npx nx affected --target=test --base=origin/main --head=HEAD
```

## 选型建议

```
你的项目是什么语言？
├─ 纯 JS/TS 前端项目
│  ├─ 小团队（< 10 人）→ Turborepo（简单上手）
│  └─ 大团队（> 10 人）→ Nx（插件丰富，affected 构建）
│
├─ 多语言（Python + Go + JS）
│  └─ Pants（原生多语言支持）
│
└─ Laravel + Vue/React 全栈
   └─ Nx（前端用 Nx，Laravel 用 Composer workspace 或独立管理）
```

## 相关概念

- [微服务架构](微服务架构.md) - Monorepo vs Polyrepo 的选型
- [模块化单体架构](模块化单体架构.md) - Monorepo 是模块化单体的代码组织形式
- [工程效能度量](工程效能度量.md) - 构建时间是效能度量的关键指标
- [API治理进阶](API治理进阶.md) - Monorepo 中的 API 规范统一

## 常见问题

**Q: Monorepo 会导致 Git 仓库太大吗？**
A: 100 个 Laravel 项目（每个 50MB）= 5GB？不会。大部分代码是重复的依赖（vendor/），Git 只存储差异。实际中 30+ 仓库的 Monorepo 通常在 500MB-2GB。

**Q: Laravel 支持 Monorepo 吗？**
A: Laravel 本身不提供 Monorepo 工具，但可以用 Composer Path Repository 实现本地包引用。前端部分用 Nx/Turborepo 管理，后端用 Composer。

**Q: 远程缓存安全吗？**
A: Nx Cloud 和 Vercel Remote Cache 都是基于文件 hash 的缓存，不会泄露源码。自建方案可以用 S3 + Redis。

## 参考文章

- [Monorepo 深度实战：Nx vs Turborepo vs Pants——大型 Laravel + 前端项目的构建缓存与任务编排](/2026/06/06/2026-06-06-Monorepo-深度实战-Nx-vs-Turborepo-vs-Pants-大型Laravel前端项目构建缓存与任务编排/)
- [Monorepo vs Polyrepo：30+ 仓库架构选型与管理经验](/2026/05/05/monorepo-vs-polyrepo-30-architecture/)
