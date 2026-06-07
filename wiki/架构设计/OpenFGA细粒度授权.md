# OpenFGA 细粒度授权

## 定义

OpenFGA 是一个开源的细粒度授权引擎，基于 Google Zanzibar 模型实现关系型访问控制（ReBAC, Relationship-Based Access Control）。与传统的 RBAC（基于角色）和 ABAC（基于属性）不同，ReBAC 通过实体间的关系图判断权限——"用户 X 是否有权限操作资源 Y"取决于 X 和 Y 之间是否存在特定的关系路径。

## 核心原理

### Zanzibar 模型

Google Zanzibar 是 Google 内部的统一授权系统，为 Google Drive、YouTube、Cloud IAM 等产品提供权限管理。核心思想：

```
关系元组 (Relation Tuple): (对象, 关系, 用户)
示例: (document:readme, editor, user:alice)

授权检查 (Authorization Check): 用户 U 是否对对象 O 有关系 R？
示例: alice 是否对 document:readme 有 edit 权限？
```

### 关系图与权限推导

OpenFGA 通过关系图（Relation Graph）进行权限推导：

```
用户 alice
  ├── owner → org:acme
  │              ├── member → org:acme  (继承 owner → member)
  │              └── repo:project-x
  │                    ├── org_member → org:acme
  │                    └── collaborator → user:bob
  │
  └── 直接关系: editor → document:readme

权限推导链:
  alice → owner → org:acme → org_member → repo:project-x → can_edit
  结论: alice 可以编辑 project-x 下的所有文档
```

### 授权模型（Authorization Model）

```yaml
# OpenFGA 授权模型 DSL
model
  schema 1.1

type user

type org
  relations
    define member: [user]
    define owner: [user] or member

type repo
  relations
    define org_member: [org#member]
    define collaborator: [user]
    define can_read: org_member or collaborator
    define can_write: collaborator
    define can_admin: [org#owner]

type document
  relations
    define parent_repo: [repo]
    define editor: [user] or collaborator from parent_repo
    define viewer: [user] or can_read from parent_repo
```

### 三种授权模型对比

| 维度 | RBAC | ABAC | ReBAC (OpenFGA) |
|------|------|------|-----------------|
| 权限维度 | 角色 | 属性（部门、时间、IP） | 实体间关系 |
| 灵活性 | 低（角色爆炸） | 高（规则组合） | 高（关系图推导） |
| 审计性 | 简单（谁有什么角色） | 复杂（规则评估链） | 可追溯（关系路径） |
| 适用规模 | 中小 | 中 | 大规模（Google 级别） |
| 实现复杂度 | 低 | 中 | 高 |
| 典型场景 | 后台管理系统 | 时间/地理限制 | 文档协作、社交平台 |

### 性能特征

- **单次授权检查**：< 10ms（关系图缓存 + 增量计算）
- **批量检查**：支持并行检查多个权限
- **变更传播**：关系变更时增量更新，无需全量重算
- **缓存策略**：授权模型缓存 + 关系图缓存 + 查询结果缓存

### OpenFGA 架构

```
Laravel App → OpenFGA SDK → OpenFGA Server
                                ├── 关系存储（MySQL/PostgreSQL）
                                ├── 授权模型缓存
                                └── 增量计算引擎
```

**Laravel 集成模式**：
1. 中间件拦截请求，提取资源 ID
2. 调用 OpenFGA `check` API 验证权限
3. 缓存高频检查结果（TTL 30s）
4. 权限变更时异步更新关系元组

## 实战案例

来自博客文章：[OpenFGA 实战：细粒度授权引擎（Zanzibar 模型）——Laravel 中的关系型权限控制与 ReBAC 落地](/2026/06/01/openfga-zanzibar-rebac-laravel/)

**关键技术点**：
- 授权模型 DSL 定义（type、relation、userset rewrite）
- `openfga/laravel-sdk` 集成
- 权限检查中间件（`CheckPermission`）
- 关系元组 CRUD（`WriteTuple` / `DeleteTuple`）
- 批量权限检查（`BatchCheck`）
- 授权模型版本管理（渐进式迁移）
- 高频检查结果缓存（Redis + TTL）

**适用场景**：
- 文档协作（谁能查看/编辑/管理文档）
- 组织架构（成员继承、部门权限传播）
- 多租户 SaaS（租户级资源隔离）
- 社交平台（关注关系、私密内容访问）

## 相关概念

- [API 安全加固](API安全加固.md) - JWT、请求签名等传输层安全
- [零信任架构](Zero-Trust架构.md) - 最小权限原则、身份验证
- [DDD 领域驱动设计](DDD领域驱动设计.md) - 限界上下文中的权限边界
- [微服务架构](微服务架构.md) - 跨服务的统一授权层
- [API 网关](API网关.md) - 网关层统一鉴权与 OpenFGA 集成

## 常见问题

**Q: OpenFGA 和 Laravel 的 Gate/Policy 有什么区别？**
A: Laravel Gate/Policy 是应用层授权，基于代码逻辑判断。OpenFGA 是独立的授权服务，基于关系图推导，支持跨服务统一授权、动态权限变更、大规模关系查询。适合权限模型复杂的场景。

**Q: 性能如何保障？**
A: OpenFGA 单次 check < 10ms。高频场景可通过 Redis 缓存检查结果（TTL 30s），或在 API 网关层做预检查。关系图变更时使用增量更新而非全量重算。

**Q: 授权模型如何演进？**
A: OpenFGA 支持授权模型版本管理。新模型发布后，存量关系元组自动兼容。渐进式迁移：先写入新关系 → 验证新旧模型一致性 → 切换到新模型 → 清理旧关系。

**Q: 和 Casbin、Keycloak 有什么区别？**
A: Casbin 是策略引擎，支持 RBAC/ABAC 但不支持关系图推导。Keycloak 是身份提供者（IdP），侧重认证而非授权。OpenFGA 专注授权，基于 Zanzibar 模型的图推导能力是其核心差异化。
