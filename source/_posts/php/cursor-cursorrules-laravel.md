---
title: Cursor .cursorrules 工程化实战：Laravel 项目级 AI 配置——Eloquent 规范、测试策略、架构约束的版本控制与团队共享
keywords: [Cursor, cursorrules, Laravel, AI, Eloquent, 工程化实战, 项目级, 规范, 测试策略, 架构约束的版本控制与团队共享]
date: 2026-06-10 08:19:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Cursor
  - .cursorrules
  - Laravel
  - Eloquent
  - Testing
  - Architecture
  - AI
description: 以 Laravel 项目为例，把 Cursor 的 .cursorrules 工程化为可维护、可测试、可版本控制的团队配置，覆盖 Eloquent 规范、测试策略、架构约束与 CI 检查。重点是“规则即代码”，而不是“灵感即文档”。
---


## 概述

Cursor 把 AI 辅助开发推到了新阶段，但大多数团队只停留在“个人提示词”层面。真正让 AI 在项目里持续有效，需要把提示词工程化：可回滚、可测试、可共享、可执行。

本文以 Laravel 项目为核心场景，演示如何把 `.cursorrules` 做成“工程化配置”。不是写一句漂亮 Prompt，而是把 Eloquent 规范、测试策略、架构约束、命名约定、甚至禁止模式都写成机器可执行的约束，并纳入版本控制与 CI。

先说结论：如果团队只是想让 AI 帮忙补全代码，传统 Prompt 已经够用。但如果目标是“团队协作风格一致、关键路径可测试、风险操作可控”，就必须把规则升级为工程化资产。换句话说，`.cursorrules` 的作用不是告诉 AI“怎么写得漂亮”，而是告诉它“在这个仓库里，什么可以做、什么必须做、什么绝对不能做”。

很多人一开始会觉得这样写太重了。其实不是重，是更接近真实项目状态。因为真实 Laravel 项目不是一个人写，也不是只写一次。它要经历需求迭代、人员变化、代码评审、长期维护。如果 AI 只会“临时发挥”，长期下来反而增加混乱。

所以本文把目标拆成三件事：

1. **统一团队风格**，减少 Code Review 返工。  
2. **降低 AI 输出的随机性**，让生成代码更贴近项目现有结构。  
3. **把规则变成资产**，可复用、可迭代、可审计。

如果你只是想要一句 Prompt，这文章偏重了。如果你想要把 Cursor 的能力真正融进 Laravel 团队协作，这套工程化路径会更实用。

---

## 核心概念

### .cursorrules 不是注释，是契约

很多项目把 `.cursorrules` 当“给 AI 的备注”。更合理的定义是“项目级 AI 编码契约”。  
它应该规定：

- 什么可以做  
- 什么必须做  
- 什么绝对不能做  

例如 Laravel 常见契约：

- Eloquent 不允许裸字段拼接查询  
- 新增表必须有索引计划  
- 业务逻辑不进 Blade  
- Controller 不写复杂条件  
- 测试必须覆盖关键路径  
- 新能力必须配套 Feature Test

这些约束如果只靠口头约定，AI 不会遵守，人也容易忘。写成规则才有执行力。

还有一点很容易被忽略：**规则的稳定性**。如果一个规则三天两头大改，团队会失去信任，AI 也会在不同会话里给出不一致结果。所以规则不要“临时想到就加”，而是先沉淀成小规范，再逐步扩展。

### 规则粒度决定执行效果

粒度太粗，等于没说：

> 代码要规范，测试要写好，结构要清晰。

这种 Prompt 几乎无用。

粒度太细，会约束过度，甚至互相冲突。  
工程化目标是“中等粒度 + 明确示例 + 反模式清单”。

建议按模块拆分：

- `architecture.md`：分层、依赖、命名  
- `eloquent.md`：查询、关联、演进、迁移  
- `testing.md`：Feature、Unit、Database、Mock  
- `forbidden.md`：禁止模式、危险操作  

这样 Cursor 能按场景加载，也便于后续维护。

还有一个关键点：**规则和项目成熟度要匹配**。早期项目不需要写太多约束，先把架构边界和测试标准定下来就够了。中大型项目再逐步补充索引策略、数据迁移策略、性能策略、异常处理策略。别在第一个月就把团队压死。

---

## 实战代码（PHP / Laravel）

下面是一套可直接落地的结构与规则示例。  
重点不是“AI 写代码”，而是“AI 在约束下写代码”。

为什么强调约束？因为 Laravel 项目最常见的问题，不是“写不出来”，而是“写出来不符合团队规范”。例如有人喜欢全局辅助函数，有人喜欢 Repository；有人喜欢直接查 DB，有人喜欢 Scope；有人测试写得很完整，有人只有手动验证。如果不把边界定清楚，AI 只会放大这些差异。

### 项目结构建议

```text
project-root/
  .cursor/
    rules/
      architecture.md
      eloquent.md
      testing.md
      forbidden.md
  .cursorrules
  app/
    Http/
    Models/
    Services/
    Repositories/
    ValueObjects/
  tests/
    Feature/
    Unit/
  database/
    migrations/
  scripts/
    cursor-rules-check.sh
```

### 主入口 .cursorrules

```md
# 项目级 Cursor 规则

## 目标
你是 Laravel 项目内的高级开发者助手，遵守本仓库现有架构与命名，优先复用，最少变更。

## 上下文加载
请优先参考：
- .cursor/rules/architecture.md
- .cursor/rules/eloquent.md
- .cursor/rules/testing.md
- .cursor/rules/forbidden.md

## 通用约束
- 所有修改必须可回滚、可测试、可维护
- 不新增全局 Helper
- 不引入破坏性依赖
- 不修改现有公共接口，除非明确要求并标注影响范围
- 新功能需配套测试、迁移、文档注释

## 输出格式
- 给出方案前先说明风险与影响范围
- 给出文件变更清单
- 代码改动包含前后对比
- 如需数据库变更，请列出 migration 与索引策略

## 默认技术栈
- Laravel 11
- PHP 8.2+
- MySQL 8
- Pest 或 PHPUnit
- Repository 模式仅在复杂查询场景使用
```

### architecture.md

```md
# 架构规则

## 分层
- Controller：请求解析与参数校验
- Service：业务流程编排
- Domain/Model：实体与业务规则
- Repository：复杂查询封装
- ValueObject：值对象建模

## 依赖规则
- Controller 不直接操作 DB
- Service 不返回 View
- Model 不依赖 Request
- Repository 只做数据访问，不做业务决策

## 命名约定
- 表名：snake_case 复数
- 外键：关联_id
- 方法：动词 + 名词
- 测试方法：should_条件_when_场景

## 变更原则
- 小步修改，优先扩展而非重写
- 新字段默认可空或有回填策略
- 公共接口修改必须评估下游影响
```

### eloquent.md

```md
# Eloquent 规则

## 查询
- 禁止裸字符串拼接 where 子句
- 大查询优先 chunk / cursor
- 复杂条件使用 scope 或 Repository

## 关联
- 新增关联必须评估 N+1
- 列表查询必须说明 eager load 策略
- 多态关联需有类型字段约束与索引

## 演进
- 字段改名需新增新字段 + 迁移脚本回填 + 旧字段废弃计划
- 删除字段要分阶段发布

## 迁移
- 大表变更写明锁表影响与回滚策略
- 索引命名统一，避免重复索引
```

### testing.md

```md
# 测试策略

## 分层
- Feature Test：HTTP 流程与授权
- Unit Test：纯函数与领域规则
- Integration Test：服务与仓储联动

## 必须覆盖
- 新增 API 端点
- 核心业务状态机
- 规则校验与边界条件
- 金额、库存、权限、并发关键路径

## 测试原则
- 使用 refresh database 或事务回滚
- 避免测试间耦合
- Mock 第三方依赖，真实测试数据库依赖
- 断言行为，不只断言实现细节

## 结果标准
- 关键路径必须有测试
- 禁止仅靠手动验证上线
```

### forbidden.md

```md
# 禁止模式

- 禁止 raw SQL 拼接用户输入
- 禁止在 Controller 写复杂业务分支
- 禁止在 Blade 做金额计算
- 禁止引入全局魔术方法
- 禁止用随机字符串做业务标识
- 禁止无日志无告警直接重试付款流程
- 禁止未说明影响范围直接改公共接口
- 禁止把敏感配置硬编码到代码库

## 替代方案
- 金额：Money / Decimal 字段
- 幂等：业务唯一键 + 事务
- 配置：环境变量与配置中心
- 日志：结构化上下文日志
```

---

## Laravel 项目落地示例

下面给出几个真实场景，说明规则如何影响 Cursor 输出。

### 场景一：新增“订单备注”字段

如果只说“加一个字段”，AI 可能只给 migration。  
但在规则下，会得到更完整的方案：

原因很简单：规则要求“字段变更必须可回滚、可测试、可说明影响范围”。AI 就会从 migration、Model、测试、关联说明四个角度去补全。这才是团队需要的输出。

```php
// database/migrations/2026_06_10_000001_add_note_to_orders_table.php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->text('note')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('note');
        });
    }
};
```

同时要求补充测试与模型声明：

```php
// app/Models/Order.php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $fillable = [
        'user_id',
        'status',
        'note',
    ];

    public function scopeWithNote($query)
    {
        return $query()->whereNotNull('note');
    }
}
```

```php
// tests/Feature/OrderNoteTest.php
<?php

use App\Models\Order;
use App\Models\User;
use Tests\TestCase;

class OrderNoteTest extends TestCase
{
    public function test_order_can_have_note(): void
    {
        $user = User::factory()->create();
        $order = Order::factory()->create([
            'user_id' => $user->id,
            'status' => 'pending',
            'note' => 'Please pack carefully',
        ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'note' => 'Please pack carefully',
        ]);
    }

    public function test_order_note_is_optional(): void
    {
        $order = Order::factory()->create([
            'status' => 'pending',
            'note' => null,
        ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'note' => null,
        ]);
    }
}
```

如果团队规则更严格，还会自动提示：

- 评估索引需求  
- 评估是否需要 API 文档变更  
- 评估是否影响缓存层  
- 评估是否需要后台页面同步改动  

这就是“规则驱动”的差别。

### 场景二：重构分页查询

旧代码常见：

```php
$orders = Order::where('status', $request->input('status'))
    ->orderByDesc('created_at')
    ->paginate(20);
```

这种写法功能没问题，但扩展性差。如果后续要加统计、导出、权限过滤、性能优化，很快会乱。所以规则会要求先分析查询边界，再决定要不要拆 Repository、要不要改 cursor、要不要补 scope。

在规则约束下，Cursor 应该提醒：

- 评估索引  
- 评估大数据集性能  
- 是否改用 cursor  
- 是否增加 scope  
- 是否补充测试

更稳妥版本：

```php
// app/Repositories/OrderRepository.php
<?php

namespace App\Repositories;

use App\Models\Order;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class OrderRepository
{
    public function __construct(
        protected Order $model,
    ) {}

    public function paginateByStatus(string $status, int $perPage = 20): LengthAwarePaginator
    {
        return $this->model
            ->query()
            ->where('status', $status)
            ->orderByDesc('id')
            ->paginate($perPage);
    }

    public function cursorByStatus(string $status, int $chunkSize = 500): \Generator
    {
        yield from $this->model
            ->query()
            ->where('status', $status)
            ->orderByDesc('id')
            ->cursor()
            ->chunk($chunkSize)
            ->flatMap
            ->all();
    }
}
```

配套测试：

```php
// tests/Feature/OrderRepositoryTest.php
<?php

use App\Models\Order;
use App\Repositories\OrderRepository;
use Tests\TestCase;

class OrderRepositoryTest extends TestCase
{
    public function test_paginate_by_status_returns_matching_orders(): void
    {
        Order::factory()->count(3)->create(['status' => 'paid']);
        Order::factory()->count(2)->create(['status' => 'pending']);

        $repo = new OrderRepository(new Order());
        $paginator = $repo->paginateByStatus('paid', 10);

        $this->assertEquals(3, $paginator->total());
    }
}
```

这种输出才像“项目内部协作者”，而不是“通用 Copilot”。

---

## 踩坑记录

### 1. 规则写成愿望清单

常见错误：

> 请写出优雅、可读、可维护、高性能代码。

这种话对人是礼貌，对 AI 是噪音。  
要写成具体约束和示例，而不是形容词堆砌。

比如“不要写得太乱”没有用；但如果写成“Controller 不允许超过 2 个业务分支，复杂逻辑必须下沉到 Service”，AI 才知道该怎么拆。

### 2. 规则与项目结构冲突

如果项目实际是 Service 模型，规则却强制 Repository 全面替代，Cursor 会陷入“规则冲突 - 代码冲突 - 人工补丁”循环。  
规则必须从现有架构出发，再做渐进式演进。

这也是很多团队配置失败的原因：规则写得太理想，而不是太现实。工程里最怕的是“理想模型和现实代码打起来”。

### 3. 不把 .cursorrules 纳入版本控制

一旦规则只在个人本地，团队很快分裂成多种风格。  
应该与代码一起提交、一起 Review。

这一步看起来简单，执行起来却很关键。因为规则本身也会演进，而演进需要记录、讨论、回滚。没有版本控制，就失去了可追溯性。

### 4. 只考虑生成，不考虑测试

很多配置只写“怎么写代码”，没写“怎么验证代码”。  
更关键的是：

- 什么必须测试  
- 什么算通过  
- 什么不能合并  

这才会真正提升质量。

没有测试约束的 AI 配置，本质上只是在加速“不确定代码”的产出。速度越快，风险越高。

### 5. 忽略安全与敏感信息

规则里要明确：

- 不允许硬编码 Key  
- 不允许打印敏感字段  
- 第三方调用必须超时与重试策略  
- 风险操作必须日志与监控  

否则 Cursor 很容易“写得漂亮，但不安全”。

尤其在 Laravel 项目里，配置、缓存、队列、支付、授权都是高风险区域。不能只看功能，还要看失败模式。

---

## 实用模板与落地顺序

### 最小可用版

如果团队刚开始，建议先做四件事：

1. 新建 `.cursorrules`  
2. 新建 `architecture.md`  
3. 新建 `forbidden.md`  
4. 新建 `testing.md`

先别追求大而全，先把最容易出错的部分约束住。

很多团队一开始就想写几十页规则，结果规则没人维护，最后变成摆设。更聪明的方法是“先小后大”：先解决最高频问题，再逐步补充。

### 推荐落地顺序

1. **架构约束**：分层、依赖、命名  
2. **Eloquent 约束**：查询、关联、迁移  
3. **测试策略**：关键路径必须覆盖  
4. **禁止清单**：高频踩坑模式  
5. **示例库**：真实场景 Prompt + 输出样本  

规则不是一次写死。  
建议每两周回顾一次，把新踩坑点补进去。

最后补充一句：不要把 .cursorrules 当成“一次性工程”。它更像是团队编码标准的 AI 版本。随着项目演进，它也要演进。

---

## 总结

Cursor 的 `.cursorrules` 真正价值，不是“让 AI 更聪明”，而是“让 AI 更守规矩”。  
对 Laravel 项目来说，最重要的不是通用提示词，而是把 Eloquent 规范、测试策略、架构约束、命名约定和风险边界写成可执行规则。

一句话总结：

**把 Cursor 从“聊天助手”升级为“项目协作者”。**

当团队把规则当代码维护，AI 输出就会更稳定，Review 成本更低，新成员上手更快，重构也更有底。  
这才是 Cursor 在真实工程里最值得投资的玩法。