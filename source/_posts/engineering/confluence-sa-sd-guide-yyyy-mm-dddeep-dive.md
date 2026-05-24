---
title: Confluence-SA-SD-模板实战-YYYY-MM-DD专案格式详解-真实案例与踩坑记录
date: 2026-05-05 02:26:04
updated: 2026-05-05 02:28:42
categories:
  - Engineering
  - Docs
tags: [KKday, 工程管理, 架构]
description: >
  在 KKday B2C Backend Team 实践了两年的 Confluence SA/SD 文档规范，从最初格式混乱、缺少关键信息，到建立统一模板后新同事快速上手。本文详解 [SA/SD] YYYY-MM-DD {专案} 命名规范、文档结构模板、实际案例（订单 BFF 重构、支付回调优化、会员等级系统），以及团队协作中的真实踩坑记录。



---
# Confluence `[SA/SD] YYYY-MM-DD {专案}` 模板实战：KKday B2C 团队的文档规范落地与真实案例

## 为什么需要 SA/SD 文档规范？

在 KKday 的 B2C Backend Team，我们维护着 30+ 个 PHP/Laravel 仓库。新需求从 PM 的 PRD 到开发落地，中间最关键的一步就是 **SA/SD（System Analysis / System Design）** 文档。

没有 SA/SD 规范之前，我们遇到的典型问题：

- 开发 A 写的文档叫「API 重构笔记」，开发 B 的叫「订单流程设计 V2」，没有任何统一格式
- 新同事接手时找不到旧文档，因为命名随心所欲
- Code Review 时发现设计与文档不一致，因为文档没有 version control 的意识
- 跨团队协作时，前端/QA 根本不知道去哪找接口设计

于是我们制定了一个简单但强约束的规范：**`[SA/SD] YYYY-MM-DD {专案名称}`**

---

## 命名规范详解

### 格式定义

```
[SA/SD] YYYY-MM-DD {专案名称}
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `[SA/SD]` | 固定标签，SA = System Analysis，SD = System Design | `[SA/SD]` |
| `YYYY-MM-DD` | 文档创建日期，不是需求开始日期 | `2026-05-05` |
| `{专案名称}` | 简洁描述，中英文皆可 | `订单BFF重构` |

### 实际命名示例

```
[SA/SD] 2026-04-15 订单BFF重构 - Search/Recommend 聚合层
[SA/SD] 2026-04-20 Stripe支付回调幂等性优化
[SA/SD] 2026-05-01 会员等级系统 - 积分计算与自动升降级
[SA/SD] 2026-05-03 商品库存并发扣减 - SKIP LOCKED 方案
[SA/SD] 2026-05-05 多币种价格引擎 - 汇率缓存与精度处理
```

### 为什么用创建日期而不是需求日期？

**踩坑记录**：最初我们用需求日期（PRD 签核日），但实际执行时 PRD 经常改版，导致文档日期和 PRD 版本对不上。改用文档创建日期后，每篇文档就是一个独立的时间切片，后续修订直接在原文档上更新 `updated` 字段即可。

---

## 文档结构模板（完整版）

我们团队统一使用的 SA/SD 文档结构如下：

```markdown
# [SA/SD] YYYY-MM-DD {专案名称}

## 1. 背景与目标
- 需求来源（PRD link / JIRA ticket）
- 当前痛点
- 预期目标与验收标准

## 2. 现状分析（As-Is）
- 现有架构图
- 当前数据流
- 存在的问题与瓶颈

## 3. 方案设计（To-Be）
### 3.1 整体架构图
### 3.2 API 设计（OpenAPI Spec link）
### 3.3 数据库变更（DDL / Migration）
### 3.4 缓存策略
### 3.5 队列/事件设计

## 4. 时序图（Sequence Diagram）
- 核心流程时序图
- 异常流程时序图

## 5. 影响范围分析
- 受影响的 API Endpoint
- 受影响的数据库 Table
- 受影响的其他服务

## 6. 测试策略
- 单元测试重点
- 集成测试场景
- 契约测试（OpenAPI + Fake Response）

## 7. 风险评估与回滚方案
- 已知风险
- 回滚步骤
- 监控指标

## 8. 变更记录
| 日期 | 作者 | 变更内容 |
|------|------|----------|
| YYYY-MM-DD | Michael | 初版 |
```

---

## 真实案例一：订单 BFF 重构

### 背景

订单详情页（Order Detail）需要同时展示：
- 订单基本信息（Order Service）
- 商品推荐（Recommend Service）
- 用户积分（Member Service）

原来前端要调 3 个 API，BFF 重构后聚合为 1 个。

### 架构图

```
┌─────────────┐
│   Frontend  │
│  (Vue 3)    │
└──────┬──────┘
       │ GET /api/v3/order/{id}/detail
       ▼
┌──────────────────────────────────┐
│         BFF Layer (Laravel)      │
│  ┌────────────────────────────┐  │
│  │  OrderDetailController     │  │
│  │  ┌──────────────────────┐  │  │
│  │  │ OrderDetailService   │  │  │
│  │  │  ├─ OrderRepository  │  │  │
│  │  │  ├─ RecommendClient  │  │  │
│  │  │  └─ MemberClient     │  │  │
│  │  └──────────────────────┘  │  │
│  └────────────────────────────┘  │
└──────┬─────────┬─────────┬──────┘
       │         │         │
       ▼         ▼         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Order   │ │ Recommend│ │  Member  │
│ Service  │ │ Service  │ │ Service  │
│ (MySQL)  │ │ (ES)     │ │ (MySQL)  │
└──────────┘ └──────────┘ └──────────┘
```

### 时序图

```mermaid
sequenceDiagram
    participant F as Frontend
    participant B as BFF Layer
    participant O as Order Service
    participant R as Recommend Service
    participant M as Member Service

    F->>B: GET /api/v3/order/{id}/detail
    B->>O: gRPC GetOrder(id)
    B->>R: HTTP GET /recommend?product_ids=...
    B->>M: HTTP GET /member/{uid}/points
    Note over B: 并发请求，任一失败降级
    O-->>B: Order DTO
    R-->>B: Recommend List
    M-->>B: Points Balance
    B-->>F: Aggregated Response
```

### 关键设计决策（在 SD 文档中必须记录）

```php
// 为什么用 Laravel HTTP Client 而不是 gRPC？
// 决策：Recommend Service 是 Java 团队维护，目前只暴露 REST API
// gRPC 方案留给后续优化，当前用 HTTP Client + Circuit Breaker

class RecommendClient
{
    public function getRecommendations(array $productIds): Collection
    {
        return Http::retry(3, 1000)
            ->timeout(5)
            ->baseUrl(config('services.recommend.base_url'))
            ->get('/api/recommend', ['product_ids' => $productIds])
            ->collect('data');
    }
}
```

### 影响范围分析（SD 文档关键章节）

```markdown
## 5. 影响范围分析

### 受影响的 API Endpoint
- `GET /api/v2/order/{id}` → 将被 `/api/v3/order/{id}/detail` 替代
- `GET /api/v2/recommend?product_ids=` → 内部调用，对外不变

### 受影响的数据库 Table
- `orders` - 新增 `recommend_cache_key` 字段（用于缓存关联）
- `order_items` - 无变更

### 受影响的其他服务
- Frontend: 需更新 API 调用，使用新的聚合接口
- QA: 需新增聚合接口的 E2E 测试
```

---

## 真实案例二：支付回调幂等性优化

### SD 文档中的风险评估（真实踩坑）

```markdown
## 7. 风险评估与回滚方案

### 已知风险
1. **Stripe 回调重试风暴**：Stripe 在 72 小时内最多重试 3 次，
   但网络抖动时可能短时间内收到多次回调
2. **并发问题**：两个相同的 `checkout.session.completed` 事件
   同时到达，可能触发两次库存扣减
3. **数据库死锁**：`UPDATE orders SET status = 'paid'` 与
   `UPDATE stock SET quantity = quantity - 1` 可能产生死锁

### 回滚步骤
1. 关闭 webhook endpoint 的 Nginx 路由
2. 手动处理积压的 Stripe 事件（通过 Stripe Dashboard）
3. 回滚 Migration: `php artisan migrate:rollback --step=1`

### 监控指标
- Stripe webhook 响应时间 (P99 < 500ms)
- 幂等 key 命中率 (日志搜索 `idempotent_hit`)
- 订单状态更新失败告警 (Sentry)
```

### 幂等性实现代码（SD 文档附录）

```php
class StripeWebhookController extends Controller
{
    public function handleWebhook(Request $request): JsonResponse
    {
        $event = $this->constructEvent($request);
        
        // 幂等性检查：使用 Stripe event_id 作为幂等键
        $idempotentKey = 'stripe_event:' . $event->id;
        
        if (Cache::has($idempotentKey)) {
            Log::info('Stripe event already processed', [
                'event_id' => $event->id,
                'type' => $event->type,
            ]);
            return response()->json(['status' => 'duplicate']);
        }
        
        DB::transaction(function () use ($event, $idempotentKey) {
            match ($event->type) {
                'checkout.session.completed' => $this->handleCheckoutCompleted($event),
                'payment_intent.payment_failed' => $this->handlePaymentFailed($event),
                default => Log::info('Unhandled event type', ['type' => $event->type]),
            };
            
            // 处理成功后设置幂等键，TTL 72 小时（Stripe 最大重试窗口）
            Cache::put($idempotentKey, true, now()->addHours(72));
        });
        
        return response()->json(['status' => 'success']);
    }
}
```

---

## 真实案例三：会员等级系统

### 数据库设计（SD 文档中的 DDL）

```sql
-- [SA/SD] 2026-05-01 会员等级系统

-- 会员等级表
CREATE TABLE `member_levels` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(50) NOT NULL COMMENT '等级名称',
    `min_points` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '最低积分',
    `discount_rate` DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT '折扣率',
    `perks` JSON DEFAULT NULL COMMENT '权益配置',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_min_points` (`min_points`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员等级配置表';

-- 会员积分流水表（分区表设计）
CREATE TABLE `member_point_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT,
    `member_id` BIGINT UNSIGNED NOT NULL,
    `points` INT NOT NULL COMMENT '积分变动（正=获得，负=消耗）',
    `type` VARCHAR(30) NOT NULL COMMENT '变动类型',
    `reference_id` VARCHAR(64) DEFAULT NULL COMMENT '关联业务ID',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`, `created_at`),
    INDEX `idx_member_created` (`member_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (UNIX_TIMESTAMP(`created_at`)) (
    PARTITION p202601 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p202602 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p202603 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

---

## 团队协作踩坑记录

### 踩坑 1：文档与代码不同步

**问题**：SA/SD 文档写完后，开发过程中改了方案但没更新文档。QA 按旧文档写测试，全部失败。

**解决方案**：在 CI 流程中加入文档检查。我们在 PR template 中加了一项：

```markdown
## PR Checklist
- [ ] 代码变更是否与 SA/SD 文档一致？
- [ ] 如有设计变更，是否已更新 SA/SD 文档？
- [ ] SA/SD 文档链接：[Confluence Link]
```

### 踩坑 2：文档太长没人看

**问题**：一篇 SA/SD 文档写了 5000+ 字，Code Review 时没人完整读完。

**解决方案**：采用"Executive Summary + Detail"的分层结构：

```markdown
## TL;DR（30 秒读完）
- 做什么：订单详情页聚合接口
- 影响什么：3 个 API → 1 个 API
- 风险：Recommend Service 降级时显示默认推荐
- 预计工时：5 人天

## 详细设计（有需要时再读）
...（完整内容）
```

### 踩坑 3：跨时区团队的日期混乱

**问题**：台北、雅加达、曼谷三个办公室，Confluence 显示的日期格式不一致。

**解决方案**：强制要求文档内所有日期使用 `YYYY-MM-DD` 格式，不依赖 Confluence 的自动格式化：

```javascript
// Confluence Template 中使用固定格式
// 使用 Confluence 的 Date Macro 时指定格式
{date:yyyy-MM-dd}
```

### 踩坑 4：SA 和 SD 混在一起

**问题**：有些文档只写 SA（分析），不写 SD（设计），导致开发时要自己猜实现方案。

**解决方案**：如果项目小，可以合并为 `[SA/SD]`；如果项目大（预估 > 10 人天），必须拆分为两个文档：

```
[SA] 2026-05-01 会员等级系统 - 需求分析与现状调研
[SD] 2026-05-03 会员等级系统 - 技术方案与数据库设计
```

---

## 如何在 Confluence 中建立模板

### 步骤一：创建模板

1. 进入 Confluence Space Settings → Content Tools → Templates
2. 点击 "Create Template"
3. 将上述模板结构粘贴进去
4. 设置模板名称为 `[SA/SD] 模板`

### 步骤二：使用 Confluence Macro 增强模板

```markdown
<!-- 信息提示框 -->
{info}
本文档由 {author} 于 {date:yyyy-MM-dd} 创建
最后一次更新：{date:yyyy-MM-dd}
{info}

<!-- 任务列表 -->
{tasklist}
[x] SA 完成
[x] SA Review 通过
[ ] SD 完成
[ ] SD Review 通过
[ ] Code Review 通过
{tasklist}

<!-- 目录 -->
{toc:outline=true|maxLevel=3}
```

### 步骤三：建立文档索引页

在 Confluence 中创建一个索引页，使用 `{children}` macro 自动列出所有 SA/SD 文档：

```markdown
# SA/SD 文档索引

## 2026 年

{children:depth=1|sort=creation|reverse=true}
```

---

## 总结：SA/SD 文档规范的核心价值

| 维度 | 没有规范时 | 有规范后 |
|------|----------|---------|
| 文档查找 | 找不到 / 找错版本 | 按日期 + 专案名精准定位 |
| 新人上手 | 靠口口相传 | 读 3 篇 SA/SD 就能理解架构 |
| Code Review | Review 代码但不知设计意图 | Review 前先读 SD，有据可依 |
| 跨团队协作 | 前端/QA 不知道接口在哪 | SA/SD 中有 OpenAPI link |
| 事后复盘 | 忘了当初为什么这样做 | 变更记录完整保留决策链 |

**一句话总结**：`[SA/SD] YYYY-MM-DD {专案}` 不是形式主义，而是你在 6 个月后回头看时，唯一能想起"当初为什么这么设计"的东西。
