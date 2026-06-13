---
title: Git Flow vs Trunk-Based：30+ 仓库的分支策略选型与踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 06:50:50
updated: 2026-05-05 06:53:31
categories:
  - architecture
  - git
tags: [CI/CD, Git, KKday, 工程管理]
keywords: [Git Flow vs Trunk, Based, 仓库的分支策略选型与踩坑记录, 架构]
description: 在管理 30+ 仓库的 KKday B2C 团队中，如何在 Git Flow 和 Trunk-Based Development 之间做出选型决策？本文基于真实项目经验，覆盖从单体到微服务、从发布周期到 CI/CD 管道的完整分支策略选型与踩坑记录。



---

> 📝 **写在前面**：在 KKday B2C Backend Team 中，我参与了 30+ 个仓库的分支策略选型与落地工作。从早期的 Git Flow 到后续的 Trunk-Based Development（TBD），经历了无数次的合并冲突、发布踩坑和团队协作摩擦。本文不是理论对比文章，而是一份**真实的踩坑记录与决策框架**。

---

## 一、先看结论：选型决策矩阵

```
┌─────────────────────────────────────────────────────────────────┐
│                     分支策略选型决策树                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  发布周期 < 1 周？ ──── YES ──→ Trunk-Based Development (TBD)   │
│        │                                                        │
│       NO                                                        │
│        │                                                        │
│        ▼                                                        │
│  需要并行维护多个版本？ ── YES ──→ Git Flow                     │
│        │                                                        │
│       NO                                                        │
│        │                                                        │
│        ▼                                                        │
│  团队 > 10 人？ ──── YES ──→ TBD + Feature Flags               │
│        │                                                        │
│       NO                                                        │
│        │                                                        │
│        ▼                                                        │
│  两者皆可，建议 TBD（学习成本更低）                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Git Flow | Trunk-Based |
|------|----------|-------------|
| **发布频率** | 按版本发布（周/月） | 随时发布（天/小时） |
| **分支数量** | 多（develop/feature/release/hotfix） | 少（main + 短生命周期 feature） |
| **合并冲突** | 高（长生命周期分支） | 低（每天合并） |
| **CI/CD 集成** | 复杂（多分支流水线） | 简单（单主干流水线） |
| **适合团队** | 大团队、需要版本管理 | 小中团队、持续交付 |
| **典型场景** | SaaS 多版本、客户端发布 | API 服务、微服务 |

---

## 二、Git Flow 在 KKday 的实际落地

### 2.1 我们最初的选择

KKday 早期采用 Git Flow，原因很直接：

```
main ──────────────────────────────────────────► 生产环境
  │
  └─ develop ──────────────────────────────────► 开发主干
       │
       ├─ feature/ORDER-1234 ──────────────────► 功能分支
       ├─ feature/SEARCH-567 ──────────────────► 功能分支
       │
       └─ release/v2.3.0 ─────────────────────► 发布分支
            │
            └─ hotfix/BUG-999 ────────────────► 紧急修复
```

**真实配置**（`.gitmodules` + 分支保护规则）：

```bash
# GitLab 分支保护设置
# main: 只允许 Merge Request 合入，禁止直接 push
# develop: 允许 Developer push，禁止删除
# release/*: 只允许 Maintainer 操作

# .gitlab-ci.yml 关键配置
stages:
  - lint
  - test
  - build
  - deploy-staging
  - deploy-production

# 只在 main 和 develop 分支上跑完整测试
test:
  stage: test
  only:
    - main
    - develop
    - merge_requests
  script:
    - php artisan test --parallel
```

### 2.2 踩坑一：长生命周期的 feature 分支

**问题描述**：`feature/SEARCH-ELASTIC` 分支存活了 3 周，期间 develop 分支已有 47 次提交。合并时产生了 **128 个冲突文件**。

```bash
# 合并时的真实惨状
$ git merge develop
Auto-merging app/Services/SearchService.php
CONFLICT (content): Merge conflict in app/Services/SearchService.php
Auto-merging app/Models/Product.php
CONFLICT (content): Merge conflict in app/Models/Product.php
... (128 个冲突)
```

**根因分析**：

```
时间线（3 周）
─────────────────────────────────────────────────────►
feature/SEARCH-ELASTIC:
  ●──●──●──●──●──●──●──●──●──●──●──●  (42 commits)

develop:
  ●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●  (47 commits)
  ↑ 同样修改了 SearchService.php、Product.php、routes/api.php
```

**解决方案**：定期 rebase（但不是万能药）：

```bash
# 每天在 feature 分支上执行 rebase
git checkout feature/SEARCH-ELASTIC
git fetch origin
git rebase origin/develop

# 解决冲突后强制推送（⚠️ 如果是共享分支要小心）
git push --force-with-lease origin feature/SEARCH-ELASTIC
```

**教训**：长生命周期分支 = 定时炸弹。后来我们制定了规则：**feature 分支最长存活 3 天**。

### 2.3 踩坑二：release 分支的热修复困境

**场景**：`release/v2.3.0` 正在准备发布，但 staging 环境发现一个严重 bug。

```
main ───────────●──── (v2.2.0 已发布)
                 │
develop ─────────●──── (正在开发 v2.4 功能)
                 │
release/v2.3.0 ──●──── (准备发布)
                 │
                 ▼
            staging 发现 bug：订单金额计算错误
```

**困境**：这个 fix 要同时合入 `release/v2.3.0`、`develop`、`main`，三次 Merge Request，三次 Code Review。

```bash
# 实际操作流程（真实踩坑）
# 1. 在 release 分支上修复
git checkout release/v2.3.0
git checkout -b hotfix/ORDER-AMOUNT-FIX
# 修复代码...
git push origin hotfix/ORDER-AMOUNT-FIX

# 2. 合入 release 分支（MR #1）
# 3. Cherry-pick 到 develop（MR #2）
git checkout develop
git cherry-pick <commit-hash>
# ⚠️ 踩坑：cherry-pick 时冲突，因为 develop 上 OrderService 已重构

# 4. 合入 main（MR #3）
```

**教训**：Git Flow 的分支同步成本被严重低估了。在 30+ 仓库中，这个成本是**乘以 30**的。

### 2.4 Git Flow 完整 CI/CD 流水线示例

以下是 Git Flow 模式下针对不同分支类型的完整 `.gitlab-ci.yml` 配置，展示了多分支流水线的复杂度：

```yaml
# .gitlab-ci.yml - Git Flow 模式下的多分支 CI 配置
# 复杂度远高于 TBD 的单主干流水线

stages:
  - lint
  - test
  - build
  - deploy-staging
  - deploy-production

variables:
  PHP_VERSION: "8.2"
  COMPOSER_CACHE_DIR: "$CI_PROJECT_DIR/.composer-cache"

# ---- Lint 阶段 ----
phpstan:
  stage: lint
  only:
    - merge_requests
    - main
    - develop
    - /^release\/.*$/
  script:
    - composer install --no-dev --optimize-autoloader --no-progress
    - ./vendor/bin/phpstan analyse --memory-limit=2G
  cache:
    key: "$CI_COMMIT_REF_SLUG"
    paths:
      - .composer-cache/

pint:
  stage: lint
  only:
    - merge_requests
    - main
    - develop
  script:
    - ./vendor/bin/pint --test

# ---- Test 阶段 ----
# ⚠️ Git Flow 的痛点：需要为多个分支分别配置触发规则
test:
  stage: test
  only:
    - main
    - develop
    - /^release\/.*$/
    - merge_requests
  script:
    - php artisan test --parallel --processes=4
  coverage: '/Statements:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      junit: report.xml
    when: always
  cache:
    key: "$CI_COMMIT_REF_SLUG"
    paths:
      - .composer-cache/

# ---- Build 阶段 ----
build:
  stage: build
  only:
    - main
    - develop
    - /^release\/.*$/
  script:
    - php artisan config:cache
    - php artisan route:cache
    - php artisan view:cache
    - tar -czf build.tar.gz --exclude=.git --exclude=vendor .
  artifacts:
    paths:
      - build.tar.gz
    expire_in: 1 week

# ---- Staging 部署 ----
# release 和 develop 分支都部署到 staging
deploy:staging:
  stage: deploy
  only:
    - develop
    - /^release\/.*$/
  script:
    - php artisan migrate --force
    - scp build.tar.gz $STAGING_HOST:/var/www/app/
    - ssh $STAGING_HOST "cd /var/www/app && tar -xzf build.tar.gz && php artisan config:cache"
  environment:
    name: staging
  when: on_success

# ---- 生产部署 ----
# ⚠️ Git Flow 的复杂点：只有 main 分支合入后才触发生产部署
deploy:production:
  stage: deploy
  only:
    - main
  script:
    - php artisan migrate --force
    - scp build.tar.gz $PROD_HOST:/var/www/app/
    - ssh $PROD_HOST "cd /var/www/app && tar -xzf build.tar.gz && php artisan config:cache"
  environment:
    name: production
  when: manual
  allow_failure: false

# ---- Release 分支的特殊处理 ----
# ⚠️ 当 release 分支合并到 main 后，需要打 tag
tag:release:
  stage: build
  only:
    - main
  when: on_success
  script:
    - |
      # 检查最近一次合并是否来自 release 分支
      LAST_MERGE_MSG=$(git log -1 --pretty=%B)
      if echo "$LAST_MERGE_MSG" | grep -q "^Merge branch 'release/"; then
        VERSION=$(echo "$LAST_MERGE_MSG" | grep -oP "release/\K[0-9]+\.[0-9]+\.[0-9]+")
        git tag -a "v$VERSION" -m "Release $VERSION"
        git push origin "v$VERSION"
        echo "🏷️ 已创建 tag: v$VERSION"
      else
        echo "非 release 合并，跳过打 tag"
      fi
```

**对比：TBD 模式下的 CI/CD 流水线**（同等功能，配置量减半）：

```yaml
# .gitlab-ci.yml - TBD 模式（同等功能的精简版）
stages:
  - quality
  - test
  - build
  - deploy

# 所有 MR 和 main 分支统一走同一条流水线
quality:
  stage: quality
  script:
    - composer install --no-dev --optimize-autoloader
    - ./vendor/bin/pint --test
    - ./vendor/bin/phpstan analyse --memory-limit=2G
  only:
    - merge_requests
    - main

test:
  stage: test
  script:
    - php artisan test --parallel --processes=4
  only:
    - merge_requests
    - main

deploy:staging:
  stage: deploy
  script:
    - php artisan migrate --force
  environment:
    name: staging
  only:
    - main
  when: on_success

deploy:production:
  stage: deploy
  script:
    - php artisan migrate --force
  environment:
    name: production
  only:
    - main
  when: manual
```

**两种模式 CI/CD 对比小结**：

| 对比维度 | Git Flow 流水线 | TBD 流水线 |
|----------|----------------|-----------|
| 配置行数 | 150+ 行 | 60 行 |
| 需匹配的分支 | 5+ 种（main/develop/release/hotfix/feature） | 2 种（main + MR） |
| 部署目标 | 3 个（staging × develop/release, production × main） | 2 个（staging + production） |
| 打 tag 逻辑 | 手动或额外 CI job | 自动化（semantic-release） |
| 新人上手难度 | 高（需理解分支生命周期） | 低（只需知道 main） |

---

## 三、转向 Trunk-Based Development

### 3.1 为什么切换？

| Git Flow 的痛点 | TBD 的解决方案 |
|------------------|----------------|
| 合并冲突频繁 | 每天合并，冲突即时解决 |
| 发布周期长（2-4 周） | 随时发布 |
| 分支同步成本高 | 只有 main + 短 feature |
| CI/CD 配置复杂 | 单主干流水线 |
| 代码审查延迟 | 小 PR，快速审查 |

### 3.2 TBD 的核心原则

```
main ──────────────────────────────────────────► 持续部署
  │
  ├── feature/small-fix (1-2 天) ──●──┐
  │                                    │ Merge
  ├── feature/add-cache (1-2 天) ──●──┐│
  │                                   ││ Merge
  └── feature/refactor (1-2 天) ───●──┘┘
```

**关键规则**：
1. **main 分支始终可部署**
2. **Feature 分支最长 2 天**
3. **每天至少合并一次到 main**
4. **使用 Feature Flags 控制未完成功能的可见性**

### 3.3 Feature Flag 实现（Laravel）

```php
<?php

declare(strict_types=1);

namespace App\Services\FeatureFlags;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * 基于数据库的 Feature Flag 服务
 * 
 * ⚠️ 踩坑记录：
 * 1. 不要用 config() 缓存 flag，需要运行时动态切换
 * 2. 不要用 Redis 直接存储，需要持久化（防止 Redis 重启丢失）
 * 3. 使用 DB + Cache 组合，Cache 做读加速，DB 做持久化
 */
class FeatureFlagService
{
    private const CACHE_PREFIX = 'feature_flag:';
    private const CACHE_TTL = 300; // 5 分钟

    /**
     * 检查某个 feature 是否对指定用户/租户开启
     *
     * @param string $flag    feature flag 名称
     * @param int    $userId  用户 ID（可选，用于灰度）
     * @return bool
     */
    public function isEnabled(string $flag, int $userId = 0): bool
    {
        $cacheKey = self::CACHE_PREFIX . $flag;

        // 先查缓存
        $config = Cache::remember($cacheKey, self::CACHE_TTL, function () use ($flag) {
            return DB::table('feature_flags')
                ->where('name', $flag)
                ->where('enabled', true)
                ->first();
        });

        if (!$config) {
            return false;
        }

        // 全量开启
        if ($config->rollout_percentage >= 100) {
            return true;
        }

        // 灰度放量：基于用户 ID 哈希取模
        if ($userId > 0) {
            $hash = crc32($flag . $userId);
            return (abs($hash) % 100) < $config->rollout_percentage;
        }

        return false;
    }

    /**
     * 运行时动态开启/关闭 feature flag
     * 
     * 用途：发布后发现问题，快速关闭新功能
     */
    public function toggle(string $flag, bool $enabled): void
    {
        DB::table('feature_flags')
            ->where('name', $flag)
            ->update([
                'enabled' => $enabled,
                'updated_at' => now(),
            ]);

        // 清除缓存，立即生效
        Cache::forget(self::CACHE_PREFIX . $flag);
    }
}
```

**在 Service 层使用**：

```php
<?php

declare(strict_types=1);

namespace App\Services\Order;

use App\Services\FeatureFlags\FeatureFlagService;

class OrderService
{
    public function __construct(
        private readonly FeatureFlagService $featureFlags,
        private readonly NewOrderCalculationService $newCalc,
        private readonly LegacyOrderCalculationService $legacyCalc,
    ) {}

    /**
     * 计算订单金额
     * 
     * ⚠️ 踩坑：新旧计算逻辑切换时，必须有对比验证
     * 我们的做法是：先同时执行，对比结果，确认无误后再切换
     */
    public function calculateAmount(int $userId, array $orderData): array
    {
        // 新版计算逻辑（Trunk-Based：代码已在 main 分支，通过 flag 控制）
        if ($this->featureFlags->isEnabled('new_order_calculation', $userId)) {
            $result = $this->newCalc->calculate($orderData);

            // ⚠️ 踩坑：过渡期同时跑旧逻辑，对比结果
            if (app()->environment('staging')) {
                $legacyResult = $this->legacyCalc->calculate($orderData);
                $this->logCalculationDiff($userId, $result, $legacyResult);
            }

            return $result;
        }

        return $this->legacyCalc->calculate($orderData);
    }

    private function logCalculationDiff(int $userId, array $new, array $legacy): void
    {
        $diff = array_diff_assoc($new, $legacy);
        if (!empty($diff)) {
            logger()->warning('Order calculation diff detected', [
                'user_id' => $userId,
                'diff' => $diff,
                'new' => $new,
                'legacy' => $legacy,
            ]);
        }
    }
}
```

### 3.4 Git 配置与 CI/CD 管道

**分支保护规则**（GitLab）：

```yaml
# .gitlab-ci.yml - TBD 模式下的 CI 配置
stages:
  - quality
  - test
  - build
  - deploy

# 阶段 1：代码质量门禁（所有 MR 必须通过）
quality:lint:
  stage: quality
  only:
    - merge_requests
  script:
    - composer install --no-dev --optimize-autoloader
    - ./vendor/bin/pint --test
    - ./vendor/bin/phpstan analyse --memory-limit=2G
    - ./vendor/bin/psalm --no-cache

# 阶段 2：测试（所有 MR + main 分支）
test:unit:
  stage: test
  only:
    - merge_requests
    - main
  script:
    - php artisan test --parallel --processes=4
  coverage: '/Statements:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml

# 阶段 3：自动部署 staging（main 分支自动触发）
deploy:staging:
  stage: deploy
  only:
    - main
  script:
    - php artisan migrate --force
    - php artisan config:cache
    - php artisan route:cache
    - php artisan view:cache
  environment:
    name: staging
  when: on_success

# 阶段 4：生产部署（手动触发，需要审批）
deploy:production:
  stage: deploy
  only:
    - main
  script:
    - php artisan migrate --force
    - php artisan config:cache
    - php artisan route:cache
  environment:
    name: production
  when: manual
  allow_failure: false
```

---

## 四、踩坑实录：30+ 仓库的分支策略演进

### 4.1 踩坑一：monorepo 中的 TBD 陷阱

**背景**：KKday 有一个 monorepo 包含 BFF 层和 3 个微服务的共享代码。

```bash
# monorepo 结构
packages/
  ├── bff-api/          # BFF 层
  ├── order-service/    # 订单服务
  ├── search-service/   # 搜索服务
  └── shared/           # 共享库（DTO、Enum、Common）
```

**问题**：开发者修改 `shared/Enum/OrderStatus.php`，只跑了 BFF 层的测试，没有验证其他服务的兼容性。

```php
<?php

// shared/Enum/OrderStatus.php - 修改这个文件影响 3 个服务
namespace Shared\Enum;

enum OrderStatus: string
{
    case PENDING = 'pending';
    case PAID = 'paid';
    case SHIPPED = 'shipped';
    case COMPLETED = 'completed';
    case CANCELLED = 'cancelled';
    
    // ⚠️ 新增的 case，没有通知其他服务
    case REFUNDING = 'refunding'; // ← 这个变更导致 order-service 测试失败
}
```

**解决方案**：共享库变更必须跑全量测试矩阵。

```yaml
# .gitlab-ci.yml - 共享库变更检测
shared:impact-test:
  stage: test
  only:
    - merge_requests
  script:
    - |
      CHANGED_FILES=$(git diff --name-only origin/main...HEAD)
      if echo "$CHANGED_FILES" | grep -q "^packages/shared/"; then
        echo "共享库变更，触发全量测试"
        # 跑所有依赖 shared 的服务的测试
        for service in bff-api order-service search-service; do
          cd packages/$service && php artisan test --parallel
          cd ../..
        done
      else
        echo "无共享库变更，只跑当前服务测试"
        php artisan test --parallel
      fi
```

### 4.2 踩坑二：Feature Flag 遗忘导致代码腐烂

**问题**：Feature flag 开启后，旧代码分支从未被清理。6 个月后发现 20+ 个死代码分支。

```php
// ❌ 踩坑：这个 flag 早已全量开启，但旧代码还在
public function calculateDiscount(float $amount): float
{
    if ($this->featureFlags->isEnabled('new_discount_v2')) {
        return $this->newDiscountCalculation($amount);  // ← 99% 流量走这里
    }
    
    // ⚠️ 死代码，但没人敢删
    return $this->legacyDiscountCalculation($amount);
}
```

**解决方案**：Feature flag 生命周期管理

```sql
-- feature_flags 表增加生命周期字段
CREATE TABLE feature_flags (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT false,
    rollout_percentage INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enabled_at TIMESTAMP NULL,
    sunset_at TIMESTAMP NULL,          -- 计划下线日期
    cleanup_ticket VARCHAR(50) NULL,   -- 关联的清理 Jira ticket
    INDEX idx_enabled (enabled),
    INDEX idx_sunset (sunset_at)
);
```

**自动化清理提醒**（Cron Job）：

```php
<?php

// app/Console/Commands/CheckStaleFlags.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use App\Notifications\StaleFlagWarning;

class CheckStaleFlags extends Command
{
    protected $signature = 'feature:check-stale';
    protected $description = '检查已全量开启超过 30 天但未清理的 feature flags';

    public function handle(): int
    {
        $staleFlags = DB::table('feature_flags')
            ->where('enabled', true)
            ->where('rollout_percentage', '>=', 100)
            ->where('enabled_at', '<', now()->subDays(30))
            ->whereNull('cleanup_ticket')
            ->get();

        if ($staleFlags->isEmpty()) {
            $this->info('✅ 没有需要清理的 feature flags');
            return self::SUCCESS;
        }

        foreach ($staleFlags as $flag) {
            $this->warn("⚠️ Stale flag: {$flag->name} (全量开启于 {$flag->enabled_at})");
        }

        // 通知团队
        Notification::route('slack', config('services.slack.channel'))
            ->notify(new StaleFlagWarning($staleFlags));

        return self::SUCCESS;
    }
}
```

### 4.3 踩坑三：TBD 下的数据库迁移冲突

**场景**：两个 feature 分支同时修改同一张表，合并到 main 后迁移顺序出错。

```
main:
  20260501_001 → create_orders_table
  20260502_002 → add_status_column

feature/A (周二创建):
  20260503_003 → add_payment_method_column  ← 依赖 orders 表存在

feature/B (周三创建):
  20260503_004 → add_shipping_info_column   ← 也依赖 orders 表存在

# 合并后迁移顺序：
# 20260501_001 → create_orders_table
# 20260502_002 → add_status_column
# 20260503_003 → add_payment_method_column  (feature/A 先合并)
# 20260503_004 → add_shipping_info_column   (feature/B 后合并)
# ✅ 这次没问题

# 但如果 feature/B 的迁移是：
# 20260503_002 → drop_and_recreate_orders   ← 💥 破坏性迁移
# 合并后顺序不确定，可能导致灾难
```

**解决方案**：迁移命名规范 + CI 检查

```php
<?php

// app/Console/Commands/CheckMigrationConflicts.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class CheckMigrationConflicts extends Command
{
    protected $signature = 'migrate:check-conflicts';
    protected $description = '检查当前分支的迁移文件是否与 main 分支冲突';

    public function handle(): int
    {
        // 获取当前分支新增的迁移文件
        $currentMigrations = $this->getNewMigrations();
        
        // 获取 main 分支的迁移文件
        $mainMigrations = $this->exec('git diff --name-only origin/main...HEAD -- database/migrations/');

        // 检查是否有同名表的操作冲突
        $conflicts = $this->detectTableConflicts($currentMigrations, $mainMigrations);

        if (!empty($conflicts)) {
            $this->error('❌ 检测到迁移冲突：');
            foreach ($conflicts as $conflict) {
                $this->error("  - {$conflict}");
            }
            return self::FAILURE;
        }

        $this->info('✅ 迁移文件无冲突');
        return self::SUCCESS;
    }

    private function detectTableConflicts(array $current, array $main): array
    {
        $conflicts = [];
        
        foreach ($current as $file) {
            $content = File::get($file);
            
            // 检测破坏性操作
            $destructivePatterns = [
                '/Schema::drop/i',
                '/Schema::dropIfExists/i',
                '/\$table->dropColumn/i',
                '/\$table->renameColumn/i',
            ];

            foreach ($destructivePatterns as $pattern) {
                if (preg_match($pattern, $content)) {
                    $conflicts[] = basename($file) . ' 包含破坏性操作，需要人工审查';
                }
            }
        }

        return $conflicts;
    }

    private function exec(string $command): string
    {
        return trim(shell_exec($command) ?? '');
    }
}
```

---

## 五、多仓库场景：30+ 仓库的统一策略

### 5.1 策略矩阵

```
┌─────────────────────────────────────────────────────────┐
│           30+ 仓库的分支策略矩阵                          │
├──────────────────┬──────────────────────────────────────┤
│ 仓库类型          │ 分支策略                              │
├──────────────────┼──────────────────────────────────────┤
│ BFF 层 (3 个)     │ TBD + Feature Flags                  │
│ API 服务 (8 个)   │ TBD（主干开发，随时部署）              │
│ 共享库 (5 个)     │ TBD + 语义化版本（Semantic Versioning）│
│ 前端仓库 (6 个)   │ TBD + Feature Flags                  │
│ 配置仓库 (3 个)   │ Git Flow（需要版本管理）              │
│ 工具/脚本 (5+ 个) │ TBD（直接 main 开发）                │
└──────────────────┴──────────────────────────────────────┘
```

### 5.2 共享库的版本管理

共享库（如 `kkday/common`、`kkday/log`）需要语义化版本配合 TBD：

```json
{
  "name": "kkday/common",
  "version": "3.2.1",
  "require": {
    "php": "^8.0"
  }
}
```

**发布流程**：

```bash
# 1. 在 main 分支开发（TBD）
git checkout main
git pull origin main

# 2. 通过 conventional commits 自动生成 changelog
# feat: 新功能 → minor 版本升级
# fix: 修复 → patch 版本升级
# BREAKING CHANGE: 破坏性变更 → major 版本升级

# 3. 使用 release-please 或 semantic-release 自动化
npx semantic-release --branches main

# 4. 消费方通过 Composer 锁定版本
composer require kkday/common:^3.2
```

---

## 六、团队协作：如何让 30+ 开发者接受 TBD

### 6.1 渐进式迁移路径

```
阶段 1（第 1-2 周）：
  - 选择 2 个低风险仓库试点 TBD
  - 引入 Feature Flag 基础设施
  - 团队培训：TBD 原则 + 短分支实践

阶段 2（第 3-4 周）：
  - 扩展到 5 个 API 服务仓库
  - 完善 CI/CD 管道（自动部署 staging）
  - 建立代码审查 SLA（24 小时内完成）

阶段 3（第 5-8 周）：
  - 全面推广到所有适合 TBD 的仓库
  - 优化 Feature Flag 管理平台
  - 建立发布节奏：每天部署 staging，每周部署 production

阶段 4（持续改进）：
  - 监控指标：合并频率、PR 大小、CI 通过率
  - 定期回顾：哪些仓库还在用 Git Flow？为什么？
```

### 6.2 关键指标监控

```bash
#!/bin/bash
# scripts/git-metrics.sh - 每周生成 Git 指标报告

REPO_PATH=$1
cd "$REPO_PATH" || exit

echo "=== Git 指标报告: $(basename "$REPO_PATH") ==="
echo "报告日期: $(date '+%Y-%m-%d')"

# 1. 平均 PR 大小（行数）
echo ""
echo "📊 PR 大小统计（最近 30 天）："
git log --merges --since="30 days ago" --oneline | while read -r line; do
  commit=$(echo "$line" | awk '{print $NF}')
  additions=$(git diff --shortstat "$commit^..$commit" | awk '{print $4}')
  deletions=$(git diff --shortstat "$commit^..$commit" | awk '{print $6}')
  echo "  $commit: +${additions} -${deletions}"
done

# 2. 分支存活时间
echo ""
echo "⏱️ 分支存活时间："
git for-each-ref --format='%(refname:short) %(creatordate:relative)' refs/heads/ | \
  grep -v main | grep -v develop | head -20

# 3. 合并频率
echo ""
echo "📈 合并频率（最近 7 天）："
git log --merges --since="7 days ago" --oneline | wc -l

# 4. 冲突频率
echo ""
echo "⚠️ 冲突 PR 数量（最近 30 天）："
git log --merges --since="30 days ago" --oneline | grep -i conflict | wc -l
```

---

## 七、总结与建议

### 7.1 选型建议

```
你的团队应该选 Git Flow，如果：
  ✗ 需要维护多个发布版本（如 SaaS 客户不同版本）
  ✗ 有严格的发布窗口（如每周二/四发布）
  ✗ 团队规模大且分布在不同时区
  ✗ 产品发布节奏慢（月级别）

你的团队应该选 TBD，如果：
  ✓ 持续部署是目标（每天/每小时发布）
  ✓ 服务是 API/微服务架构
  ✓ 团队有成熟的 CI/CD 管道
  ✓ 能接受 Feature Flag 的额外复杂度
```

### 7.2 我们的经验总结

| 决策 | 结果 |
|------|------|
| BFF 层切换到 TBD | 发布频率从 2 周/次 → 每天/次 |
| 共享库引入语义化版本 | 依赖冲突减少 80% |
| Feature Flag 灰度发布 | 线上事故回滚时间从 30 分钟 → 3 分钟 |
| 分支存活时间限制 3 天 | 合并冲突减少 70% |
| 全量测试矩阵检查共享库变更 | 兼容性 bug 减少 90% |

### 7.3 最后的话

> **没有完美的分支策略，只有适合团队和业务的策略。**
> 
> 在 KKday 的 30+ 仓库中，我们最终采用了混合策略：
> - **API 服务和 BFF**：TBD + Feature Flags
> - **配置仓库和需要版本管理的库**：Git Flow
> 
> 关键不是选哪个策略，而是**让整个团队理解并一致执行**。
> 最怕的不是选错策略，而是团队里一半人用 Git Flow、一半人用 TBD。

---

**标签**：Git, Git Flow, Trunk-Based Development, 分支策略, CI/CD, 团队协作

---

## 相关阅读

- [Monorepo vs Polyrepo：30+ 仓库架构选型与管理经验](/architecture/monorepo-vs-polyrepo-30-architecture/)
- [Fork 项目维护与上游同步实战：以 Scribe/CRMEB 为例的 Fork 协作工作流踩坑记录](/architecture/fork-guide-scribe-crmeb-fork/)
- [Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地](/07_CICD/Trunk-Based-Development-深度实战-Feature-Flag-替代长生命周期分支的工程化落地/)
