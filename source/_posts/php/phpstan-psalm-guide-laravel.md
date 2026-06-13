---

title: PHPStan-Psalm-静态分析实战-Laravel-项目类型安全最佳实践踩坑记录
keywords: [PHPStan, Psalm, Laravel, 静态分析实战, 项目类型安全最佳实践踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 08:00:16
updated: 2026-05-05 08:02:37
description: 基于 30+ Laravel B2C 仓库的 PHPStan 与 Psalm 静态分析落地实战，涵盖工具选型决策、Laravel Model 泛型注解、Builder 链式调用类型推导、Eloquent 返回类型治理、常见误报 suppression 策略、CI/CD 门禁集成与团队类型安全渐进式文化建设。
tags:
- CI/CD
- Laravel
- PHP
categories:
- php
---


# PHPStan/Psalm 静态分析实战：Laravel 项目类型安全最佳实践踩坑记录

## 前言

在前面的 [Laravel Pint + PHPStan CI 集成实战](/07_CICD/Laravel-Pint-PHPStan-CI集成实战-代码质量门禁自动化与渐进式治理踩坑记录/) 中，我们聊的是**怎么把 PHPStan 塞进 CI 流水线**——baseline 管理、level 提升策略、增量检查优化。但 CI 门禁只是「卡」，真正让团队受益的是**类型安全本身的实践**：怎么给 Laravel Model 加泛型注解？怎么让 Builder 链式调用不再返回 `mixed`？PHPStan 和 Psalm 到底选哪个？level 6 和 level 8 的区别到底在哪？

这篇文章从 30+ Laravel B2C 仓库的真实治理经验出发，聊聊**静态分析在日常编码中的落地细节**。

---

## 一、PHPStan vs Psalm：工具选型决策树

很多团队纠结「用 PHPStan 还是 Psalm」，实际上两者的设计哲学完全不同：

```
┌─────────────────────────────────────────────────────────────┐
│                    静态分析工具选型                            │
├─────────────────────┬───────────────────────────────────────┤
│      PHPStan        │              Psalm                     │
├─────────────────────┼───────────────────────────────────────┤
│ • 增量 adoption     │ • 需要全面类型注解                      │
│ • 容忍 untyped 代码  │ • 对无注解代码报错更多                   │
│ • Laravel 生态最强   │ • Laravel 插件相对薄弱                  │
│ • level 渐进式提升   │ • errorLevel 配置较少                   │
│ • 社区活跃（nunomaduro）│ • 社区维护放缓（vimeo/psalm）        │
│ • PHPStan 2.x 更快   │ • Psalm 5.x 开始落后                   │
└─────────────────────┴───────────────────────────────────────┘
```

### 我们的决策：PHPStan 为主，Psalm 为辅

```
┌──────────────────────────────────────────────────────────────────┐
│                     治理策略架构图                                 │
│                                                                    │
│   开发阶段              CI 阶段                发布阶段            │
│  ┌──────────┐       ┌──────────────┐       ┌──────────────┐      │
│  │ PHPStan  │──────▶│  GitHub      │──────▶│  PHPStan     │      │
│  │ (IDE插件) │       │  Actions     │       │  level ≥ 6   │      │
│  │ 实时提示  │       │  + baseline  │       │  0 新增 error │      │
│  └──────────┘       └──────────────┘       └──────────────┘      │
│        │                    │                      │              │
│        ▼                    ▼                      ▼              │
│  ┌──────────┐       ┌──────────────┐       ┌──────────────┐      │
│  │ Psalm    │       │  增量检查     │       │  baseline    │      │
│  │ (可选)   │       │  只扫改动文件 │       │  逐步消除     │      │
│  └──────────┘       └──────────────┘       └──────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

**理由**：
1. Laravel 生态中 `larastan/larastan` 维护最活跃，对 Eloquent Model、Facade、Middleware 有专门规则
2. PHPStan 支持渐进式 level 提升（0→9），适合存量代码治理
3. Psalm 对 Laravel 的 `@template` 支持虽然更严格，但 larastan 已经覆盖了核心场景

---

## 二、Level 升级路线图：从 level 0 到 level 8

PHPStan 的 level 决定了检查的严格程度。很多人直接设 level 8 然后被几千个 error 吓退，正确做法是**逐级爬升**：

```
Level 0: 基础错误（未定义变量、不存在的方法）
Level 1: + 未知方法调用、错误参数数量
Level 2: + 未知类/接口、错误返回类型
Level 3: + 不可达代码、未知函数
Level 4: + 基本死代码检测
Level 5: + 严格类型检查（参数类型）
Level 6: ⭐ 推荐起步点 — 检查 return type + property type
Level 7: + 不可达模式、严格混合类型
Level 8: + 严格 null check、missing typehints
Level 9: + 完全严格模式，不允许 mixed
```

### 实战：30 个仓库的 level 分布

```
┌─────────────────────────────────────────┐
│     仓库 Level 分布（治理完成后）         │
├─────────┬───────────┬───────────────────┤
│  Level  │  仓库数量  │     典型场景       │
├─────────┼───────────┼───────────────────┤
│  L6     │    12     │ 老项目，代码量大    │
│  L7     │    10     │ 中期项目           │
│  L8     │     6     │ 新项目/重构项目     │
│  L9     │     2     │ 核心库/SDK         │
└─────────┴───────────┴───────────────────┘
```

### 关键踩坑：level 6 → level 7 的「混合类型墙」

```php
// ❌ level 7 会报错：Method App\Http\Controllers\OrderController::getOrder()
//    return type has no value type specified in iterable type array
public function getOrder(int $id): array
{
    return Order::find($id)->toArray(); // PHPStan: array 的 value type 是什么？
}

// ✅ 修复：用 @return 注解明确数组结构
/**
 * @return array{id: int, status: string, total: float, items: array<int, array{sku: string, qty: int}>}
 */
public function getOrder(int $id): array
{
    return Order::with('items')->find($id)->toArray();
}
```

---

## 三、Laravel Model 类型注解：Eloquent 的类型安全痛点

Eloquent 是 Laravel 类型安全的**最大战场**。`Model::find()` 返回 `?Model`，`Model::all()` 返回 `Collection`——泛型信息全丢了。

### 3.1 基础：属性注解

```php
/**
 * @property int         $id
 * @property string      $order_no
 * @property float       $total_amount
 * @property string      $status
 * @property Carbon|null $paid_at
 * @property Carbon      $created_at
 * @property-read string $status_label  // 只读访问器
 */
class Order extends Model
{
    protected $casts = [
        'total_amount' => 'float',
        'paid_at'      => 'datetime',
    ];

    protected $appends = ['status_label'];

    // ✅ 访问器返回类型
    public function getStatusLabelAttribute(): string
    {
        return match ($this->status) {
            'pending'  => '待支付',
            'paid'     => '已支付',
            'shipped'  => '已发货',
            default    => '未知',
        };
    }
}
```

**踩坑**：`@property` 注解和 `$casts` 必须一致。我见过一个仓库 `$casts` 写了 `'is_active' => 'boolean'`，但 `@property` 写成了 `int`，导致 PHPStan 和实际运行行为不一致，排查了半天。

### 3.2 进阶：泛型注解让 Collection 有类型

```php
/**
 * @property int    $id
 * @property string $name
 * @property string $email
 *
 * @method static Collection<int, User> all()
 * @method static User|null find(int $id)
 * @method static User findOrFail(int $id)
 * @method static Collection<int, User> where(string $column, mixed $operator, mixed $value)
 */
class User extends Authenticatable {}

// 使用时 PHPStan 能推导出类型
$users = User::where('is_active', true)->get();
// PHPStan 知道 $users 是 Collection<int, User>
foreach ($users as $user) {
    echo $user->name; // ✅ 不再报 "Access to property on mixed"
}
```

### 3.3 关联方法的类型注解

```php
/**
 * @property int    $id
 * @property string $order_no
 *
 * @property-read Collection<int, OrderItem> $items
 * @property-read User|null $user
 */
class Order extends Model
{
    /** @return HasMany<OrderItem> */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    /** @return BelongsTo<User, Order> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

**踩坑**：`BelongsTo<User, Order>` 的泛型参数顺序——第一个是「父模型」（被关联的），第二个是「子模型」（拥有外键的）。写反了 PHPStan 会报 `Method App\Models\Order::user() should return BelongsTo<User, Order> but returns BelongsTo<Order, User>`，而且错误信息看半天才反应过来是参数顺序的问题。

---

## 四、Builder 链式调用的类型推导

Eloquent Builder 的链式调用是另一个类型黑洞：

```php
// ❌ PHPStan 默认推导不出最终类型
$orders = Order::query()
    ->where('status', 'paid')
    ->where('created_at', '>=', now()->subDays(7))
    ->orderByDesc('total_amount')
    ->limit(100)
    ->get();
// PHPStan: Collection<int, Model>  ← 太泛了！
```

### 修复方案：@var 注解 + 方法链中间断言

```php
/** @var Collection<int, Order> $orders */
$orders = Order::query()
    ->where('status', 'paid')
    ->where('created_at', '>=', now()->subDays(7))
    ->orderByDesc('total_amount')
    ->limit(100)
    ->get();

// 或者用方法封装
class OrderRepository
{
    /**
     * @param string $status
     * @param int    $days
     * @param int    $limit
     * @return Collection<int, Order>
     */
    public function getRecentPaidOrders(
        string $status = 'paid',
        int $days = 7,
        int $limit = 100
    ): Collection {
        return Order::query()
            ->where('status', $status)
            ->where('created_at', '>=', now()->subDays($days))
            ->orderByDesc('total_amount')
            ->limit($limit)
            ->get();
    }
}
```

### Builder Scope 的类型注解

```php
class Order extends Model
{
    /**
     * @param Builder<Order> $query
     * @param string $status
     * @return Builder<Order>
     */
    public function scopeStatus(Builder $query, string $status): Builder
    {
        return $query->where('status', $status);
    }

    /**
     * @param Builder<Order> $query
     * @param int $days
     * @return Builder<Order>
     */
    public function scopeRecentDays(Builder $query, int $days = 7): Builder
    {
        return $query->where('created_at', '>=', now()->subDays($days));
    }
}

// ✅ 链式调用现在有类型了
$orders = Order::query()
    ->status('paid')
    ->recentDays(30)
    ->get();
// PHPStan: Collection<int, Order> ✅
```

---

## 五、PHPStan + Laravel 常见误报与 suppression 策略

### 5.1 Facade 误报

```php
// PHPStan 不认识某些 Facade 的动态调用
Cache::tags(['orders'])->get('key'); // 报错：TaggedCache 没有 get 方法？

// 修复：在 phpstan.neon 中加载 larastan
// includes:
//   - ./vendor/larastan/larastan/extension.neon
```

### 5.2 `@phpstan-ignore-next-line` vs `@phpstan-ignore-line`

```php
// ❌ 过时写法（PHPStan 1.x）
/** @phpstan-ignore-line */
$result = someLegacyCode();

// ✅ PHPStan 2.x 推荐写法：用 identifier 精确忽略
$result = someLegacyCode(); // @phpstan-ignore argument.type

// ✅ 最佳实践：用 baseline 而不是 inline ignore
// phpstan analyse --generate-baseline
```

### 5.3 `@var` 强制覆盖 vs 信任推导

```php
// ⚠️ 不要滥用 @var 覆盖——这是最常见的「假类型安全」
/** @var User $user */  // 实际可能返回 null！
$user = User::find($id);
$user->name; // 运行时 NPE，但 PHPStan 不会报错

// ✅ 正确做法：用断言
$user = User::find($id);
assert($user instanceof User, "User #{$id} not found");
$user->name; // PHPStan 知道此时 $user 一定是 User
```

---

## 六、PHPStan vs Psalm：同一份代码的检查差异

用一个真实案例展示两者的区别：

```php
class PricingService
{
    /**
     * @param array<string, mixed> $product
     * @param float $discount
     * @return array{original: float, final: float, saved: float}
     */
    public function calculate(array $product, float $discount): array
    {
        $original = (float) ($product['price'] ?? 0);
        $final    = $original * (1 - $discount);
        $saved    = $original - $final;

        return [
            'original' => $original,
            'final'    => $final,
            'saved'    => $saved,
        ];
    }
}
```

```
PHPStan (level 8):
  ✅ 通过 — array shape 检查通过

Psalm (level 1):
  ⚠️  警告 — $product['price'] 可能是 mixed，
     需要 psalm-assert 或 array shape 更精确
  ⚠️  建议 — $discount 应该范围校验（0 <= $discount <= 1）
```

**结论**：Psalm 对**值域约束**更敏感（比如折扣应该是 0~1），PHPStan 对**结构类型**更实用（比如返回数组的 shape）。在 Laravel B2C 项目中，PHPStan 的实用性更高。

---

## 七、团队落地策略：渐进式类型安全文化建设

### 7.1 三阶段治理计划

```
┌──────────────────────────────────────────────────────────────────┐
│                    渐进式类型安全治理计划                          │
│                                                                    │
│  第 1 阶段（1-2周）    第 2 阶段（3-4周）    第 3 阶段（持续）      │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐      │
│  │ PHPStan L6   │────▶│ PHPStan L7   │────▶│ PHPStan L8   │      │
│  │ + baseline   │     │ + 消除 baseline│    │ + 零 baseline │      │
│  │ + CI 门禁    │     │ + Model 注解  │     │ + 泛型全覆盖  │      │
│  └──────────────┘     └──────────────┘     └──────────────┘      │
│        │                    │                      │              │
│        ▼                    ▼                      ▼              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐      │
│  │ 仅检查改动文件│     │ 全量扫描     │     │ PR 必须通过   │      │
│  │ 容忍存量 error│     │ 分批消除     │     │ 合并前检查    │      │
│  └──────────────┘     └──────────────┘     └──────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 新文件零容忍策略

```yaml
# .github/workflows/phpstan.yml
name: PHPStan
on: [pull_request]
jobs:
  phpstan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: composer install --no-progress
      - name: Run PHPStan on changed files
        run: |
          CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR origin/main...HEAD -- '*.php')
          if [ -n "$CHANGED_FILES" ]; then
            vendor/bin/phpstan analyse --no-progress --error-format=github $CHANGED_FILES
          fi
```

**策略**：存量代码用 baseline 容忍，但**新增/修改的代码必须零 error**。这样存量问题不会阻塞 CI，但新代码的质量有保障。

---

## 八、踩坑记录汇总

| # | 踩坑场景 | 根因 | 解决方案 |
|---|---------|------|---------|
| 1 | `Model::find()` 返回类型是 `?Model` | Eloquent 泛型丢失 | larastan 自动处理 + `@property` 注解 |
| 2 | `Collection->map()` 返回 `Collection<int, mixed>` | 闭包返回类型未声明 | 闭包加返回类型：`fn(Order $o): array => [...]` |
| 3 | `Carbon::now()->addDays(7)` 报类型错误 | Carbon 版本差异 | `@var Carbon $date` 或升级 `nesbot/carbon` |
| 4 | level 7+ 大量 `mixed` 报错 | 存量代码无类型注解 | baseline 文件 + 逐文件消除 |
| 5 | `@var` 覆盖导致假安全感 | 开发者滥用 `@var` | CI 规则禁止 `@var` inline 覆盖 |
| 6 | `Builder<T>` 泛型参数不生效 | Scope 方法未加泛型 | 所有 Scope 方法加 `@param Builder<Order>` |
| 7 | `match` 表达式 exhaustiveness 检查 | PHPStan 对 `match` 返回类型的推导 | 用 `never` 类型标记不可达分支 |
| 8 | Facade 方法找不到 | 未加载 larastan extension | `phpstan.neon` 添加 `larastan/extension.neon` |

---

## 总结

类型安全不是一蹴而就的工程。在 30+ 仓库的治理经验中，我们总结出三个核心原则：

1. **渐进式提升**：从 level 6 开始，配合 baseline，逐级消除存量问题
2. **新代码零容忍**：新增/修改的代码必须通过当前 level 的完整检查
3. **Model 注解优先**：Eloquent Model 的 `@property` 和关联泛型注解是投入产出比最高的工作

PHPStan + larastan 是 Laravel 生态中目前最成熟的静态分析方案。Psalm 可以作为补充，但不建议作为主力工具。类型安全的最终目标不是「让工具满意」，而是**让团队在重构时有信心，在 Code Review 时省时间**。

---

*本文基于 KKday RD B2C Backend Team 30+ Laravel 仓库的真实治理经验整理。*

## 相关阅读

- [Laravel Pint + PHPStan CI 集成实战：代码质量门禁自动化与渐进式治理](/devops/laravel-pint-phpstan-ciguide-automation/)
- [Laravel Pint + Rector + PHPStan 三剑客联动：代码风格+重构+类型安全一站式质量治理流水线](/devops/Laravel-Pint-Rector-PHPStan-三剑客联动-代码风格重构类型安全一站式质量治理流水线/)
- [AI-Driven Refactoring 实战：用 Rector + Claude Code 批量识别代码坏味道——Laravel 30+ 仓库的渐进式重构策略](/00_架构/AI-Driven-Refactoring-实战-用Rector-Claude-Code批量识别代码坏味道-Laravel仓库渐进式重构策略/)
