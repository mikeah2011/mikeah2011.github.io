---
title: TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地
date: 2026-06-06 00:00:00
tags: [分布式事务, TCC, Laravel, 微服务, 架构设计]
description: TCC 分布式事务模式深度实战指南：详解 Try-Confirm-Cancel 三阶段设计原理，对比 2PC/Saga/本地消息表方案优劣。以 Laravel 电商订单-支付-库存核心链路为例，完整实现 Try 资源预留、Confirm 正幂等提交、Cancel 补偿回滚，涵盖空回滚/悬挂/幂等三大经典问题的防御策略。提供 DTM 框架集成方案、对账系统设计、监控告警体系，附 TCC vs Saga 编排模式选型决策树，适合微服务架构下资金、库存等强一致性场景的工程师和架构师。
categories:
  - architecture
cover: /images/covers/tcc-distributed-transaction-cover.jpg
---

## 一、引言：为什么需要 TCC

在微服务架构下，一个业务操作往往需要跨多个服务协作完成。以电商下单为例，用户点击"立即购买"后，系统需要同时完成**创建订单、扣减库存、冻结余额**三个动作。这三个操作分属不同的服务和数据库，无法通过单一数据库事务保证一致性。

传统的解决方案有以下几种：

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| **2PC（两阶段提交）** | 强一致 | 差（阻塞） | 中 | 数据库层面分布式事务 |
| **Saga** | 最终一致 | 好 | 中 | 长事务、补偿逻辑简单 |
| **TCC** | 最终一致 | 好 | 高 | 资金、库存等核心业务 |
| **本地消息表** | 最终一致 | 好 | 低 | 异步解耦场景 |

**2PC（Two-Phase Commit）** 的问题在于：协调者需要等待所有参与者响应，任何一环超时或宕机都会导致全局阻塞。此外，2PC 在准备阶段就锁定了资源，高并发场景下吞吐量急剧下降。

**Saga 模式**将长事务拆分为一系列本地事务，每个事务有对应的补偿操作。Saga 的补偿是"反向操作"（如退款、加库存），但不涉及资源预留，因此可能出现**余额不足时已发货无法退款**的不一致窗口。

**TCC（Try-Confirm-Cancel）** 正是为了弥补这些不足而设计的。它的核心思想是：在 Try 阶段就锁定资源（预留），Confirm 阶段正式提交，Cancel 阶段释放预留。这种"先占后提交"的模式将不一致窗口压缩到了最小，非常适合**资金、库存、订单**等对数据一致性要求极高的场景。

### TCC vs Saga 核心区别

```
Saga:    T1 → T2 → T3 (失败) → C3 → C2 → C1  （补偿是反向业务操作）
TCC:     Try1+Try2+Try3 → (全部成功) → Confirm1+Confirm2+Confirm3
                                    → (任一失败) → Cancel1+Cancel2+Cancel3
```

Saga 的补偿操作需要实现"如何撤销已提交的事务"，而 TCC 的 Cancel 操作只需要释放"预留但未提交"的资源，语义更清晰，实现更安全。

---

## 二、TCC 三阶段详解

### 2.1 Try — 资源预留（Reserve）

Try 阶段是 TCC 的关键创新点。它不执行真正的业务操作，而是**检查业务可行性并预留必要的资源**。

以库存扣减为例：

```
Try:   检查库存 >= 购买数量 → 冻结库存（冻结数量 += N，可用库存 -= N）
真正扣减发生在 Confirm 阶段
```

以账户扣款为例：

```
Try:   检查余额 >= 扣款金额 → 冻结金额（冻结金额 += N，可用余额 -= N）
真正扣减发生在 Confirm 阶段
```

Try 阶段的设计原则：

1. **幂等性**：同一笔交易多次调用 Try，结果应完全一致
2. **可空回滚**：如果 Try 没执行就收到 Cancel，需要能正确处理
3. **防悬挂**：Cancel 执行后，迟到的 Try 不应再生效

### 2.2 Confirm — 确认提交（Commit）

当所有参与者的 Try 都成功后，事务协调器（Transaction Manager）依次调用每个参与者的 Confirm 方法。

```
Confirm: 冻结库存 → 实际扣减（冻结数量 -= N，总库存 -= N）
Confirm: 冻结金额 → 实际扣除（冻结金额 -= N，总余额 -= N）
```

Confirm 阶段的特点：

- **必须保证成功**：Confirm 不允许失败（需要重试直到成功）
- **幂等性**：多次 Confirm 与一次 Confirm 结果一致
- **无业务异常**：Try 已经验证过可行性，Confirm 只做最终提交

### 2.3 Cancel — 回滚释放（Rollback）

当任一参与者 Try 失败时，协调器调用所有已成功 Try 的参与者执行 Cancel，释放预留的资源。

```
Cancel: 释放冻结库存（冻结数量 -= N，可用库存 += N）
Cancel: 释放冻结金额（冻结金额 -= N，可用余额 += N）
```

Cancel 阶段的特点：

- **幂等性**：多次 Cancel 与一次 Cancel 结果一致
- **处理空回滚**：如果 Try 未执行就收到 Cancel，直接返回成功
- **防悬挂**：Cancel 后如果迟到的 Try 到达，应该拒绝

---

## 三、Laravel 中的 TCC 实现框架设计

### 3.1 TCC 参与者接口定义

首先定义 TCC 参与者必须实现的接口：

```php
<?php

namespace App\Tcc\Contracts;

/**
 * TCC 参与者接口
 * 每个参与分布式事务的服务都需要实现此接口
 */
interface TccParticipant
{
    /**
     * Try 阶段：资源预留
     *
     * @param string $txId      全局事务 ID
     * @param string $branchId  分支事务 ID
     * @param array  $params    业务参数
     * @return bool 是否成功
     */
    public function try(string $txId, string $branchId, array $params): bool;

    /**
     * Confirm 阶段：确认提交
     *
     * @param string $txId
     * @param string $branchId
     * @return bool
     */
    public function confirm(string $txId, string $branchId): bool;

    /**
     * Cancel 阶段：回滚释放
     *
     * @param string $txId
     * @param string $branchId
     * @return bool
     */
    public function cancel(string $txId, string $branchId): bool;
}
```

### 3.2 事务日志模型

为了支持重试、幂等和故障恢复，我们需要一个事务日志表来记录每个分支事务的状态：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TccTransactionLog extends Model
{
    protected $table = 'tcc_transaction_logs';

    protected $fillable = [
        'tx_id',          // 全局事务 ID
        'branch_id',      // 分支事务 ID
        'participant',    // 参与者类名
        'action',         // 当前阶段：try / confirm / cancel
        'status',         // 状态：init / processing / succeed / failed
        'params',         // 业务参数（JSON）
        'retry_count',    // 重试次数
        'max_retries',    // 最大重试次数
        'next_retry_at',  // 下次重试时间
        'error_message',  // 错误信息
    ];

    protected $casts = [
        'params' => 'array',
        'next_retry_at' => 'datetime',
    ];

    // 状态常量
    const STATUS_INIT       = 'init';
    const STATUS_PROCESSING = 'processing';
    const STATUS_SUCCEED    = 'succeed';
    const STATUS_FAILED     = 'failed';

    // 阶段常量
    const ACTION_TRY     = 'try';
    const ACTION_CONFIRM = 'confirm';
    const ACTION_CANCEL  = 'cancel';
}
```

迁移文件：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tcc_transaction_logs', function (Blueprint $table) {
            $table->id();
            $table->string('tx_id', 64)->index();
            $table->string('branch_id', 64)->index();
            $table->string('participant', 255);
            $table->enum('action', ['try', 'confirm', 'cancel']);
            $table->enum('status', ['init', 'processing', 'succeed', 'failed']);
            $table->json('params')->nullable();
            $table->unsignedInteger('retry_count')->default(0);
            $table->unsignedInteger('max_retries')->default(3);
            $table->timestamp('next_retry_at')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();

            $table->unique(['tx_id', 'branch_id', 'action']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tcc_transaction_logs');
    }
};
```

### 3.3 事务协调器（Transaction Manager）

协调器是 TCC 的核心，负责编排 Try → Confirm/Cancel 的流程：

```php
<?php

namespace App\Tcc;

use App\Models\TccTransactionLog;
use App\Tcc\Contracts\TccParticipant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;

class TccTransactionManager
{
    /**
     * 执行 TCC 分布式事务
     *
     * @param array  $participants 参与者配置 [[participant, params], ...]
     * @param int    $timeout      超时时间（秒）
     * @return array ['success' => bool, 'tx_id' => string]
     */
    public function execute(array $participants, int $timeout = 30): array
    {
        $txId = Str::uuid()->toString();
        $branches = [];

        Log::info("TCC [{$txId}] 开始执行，参与者数量: " . count($participants));

        // ========== Phase 1: Try ==========
        foreach ($participants as $index => $config) {
            $participant = $config['participant'];
            $params = $config['params'] ?? [];
            $branchId = $this->generateBranchId($txId, $index);

            // 记录事务日志
            $this->logTransaction($txId, $branchId, $participant, 'try', $params);

            try {
                $result = $participant->try($txId, $branchId, $params);

                if (!$result) {
                    Log::warning("TCC [{$txId}] Try 阶段失败: {$branchId}");
                    $this->updateStatus($txId, $branchId, 'try', TccTransactionLog::STATUS_FAILED);
                    // Try 失败，回滚所有已成功的 Try
                    $this->rollbackAll($txId, $branches);
                    return ['success' => false, 'tx_id' => $txId];
                }

                $this->updateStatus($txId, $branchId, 'try', TccTransactionLog::STATUS_SUCCEED);
                $branches[] = ['participant' => $participant, 'branch_id' => $branchId];

            } catch (\Throwable $e) {
                Log::error("TCC [{$txId}] Try 异常: {$e->getMessage()}");
                $this->updateStatus($txId, $branchId, 'try', TccTransactionLog::STATUS_FAILED, $e->getMessage());
                $this->rollbackAll($txId, $branches);
                return ['success' => false, 'tx_id' => $txId];
            }
        }

        // ========== Phase 2: Confirm ==========
        foreach ($branches as $branch) {
            $branchId = $branch['branch_id'];
            $participant = $branch['participant'];

            $this->logTransaction($txId, $branchId, get_class($participant), 'confirm');

            try {
                $confirmed = $this->retryConfirm($participant, $txId, $branchId, $timeout);

                if (!$confirmed) {
                    Log::error("TCC [{$txId}] Confirm 最终失败: {$branchId}");
                    $this->updateStatus($txId, $branchId, 'confirm', TccTransactionLog::STATUS_FAILED);
                    // Confirm 失败是严重异常，需要人工介入
                    $this->alertConfirmFailure($txId, $branchId);
                    return ['success' => false, 'tx_id' => $txId];
                }

                $this->updateStatus($txId, $branchId, 'confirm', TccTransactionLog::STATUS_SUCCEED);

            } catch (\Throwable $e) {
                Log::error("TCC [{$txId}] Confirm 异常: {$e->getMessage()}");
                $this->updateStatus($txId, $branchId, 'confirm', TccTransactionLog::STATUS_FAILED, $e->getMessage());
                $this->alertConfirmFailure($txId, $branchId);
                return ['success' => false, 'tx_id' => $txId];
            }
        }

        Log::info("TCC [{$txId}] 事务完成 ✓");
        return ['success' => true, 'tx_id' => $txId];
    }

    /**
     * 带重试的 Confirm 执行
     */
    protected function retryConfirm(
        TccParticipant $participant,
        string $txId,
        string $branchId,
        int $timeout
    ): bool {
        $maxRetries = 3;
        $retryDelay = 100; // 初始延迟 100ms

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            try {
                $result = $participant->confirm($txId, $branchId);
                if ($result) {
                    return true;
                }
            } catch (\Throwable $e) {
                Log::warning("TCC [{$txId}] Confirm 重试 {$attempt}/{$maxRetries}: {$e->getMessage()}");
            }

            if ($attempt < $maxRetries) {
                usleep($retryDelay * 1000);
                $retryDelay = min($retryDelay * 2, 5000); // 指数退避，最大 5s
            }
        }

        return false;
    }

    /**
     * 回滚所有已成功的 Try
     */
    protected function rollbackAll(string $txId, array $branches): void
    {
        foreach (array_reverse($branches) as $branch) {
            $branchId = $branch['branch_id'];
            $participant = $branch['participant'];

            $this->logTransaction($txId, $branchId, get_class($participant), 'cancel');

            try {
                $participant->cancel($txId, $branchId);
                $this->updateStatus($txId, $branchId, 'cancel', TccTransactionLog::STATUS_SUCCEED);
                Log::info("TCC [{$txId}] Cancel 成功: {$branchId}");
            } catch (\Throwable $e) {
                Log::error("TCC [{$txId}] Cancel 异常: {$e->getMessage()}");
                $this->updateStatus($txId, $branchId, 'cancel', TccTransactionLog::STATUS_FAILED, $e->getMessage());
            }
        }
    }

    protected function generateBranchId(string $txId, int $index): string
    {
        return "{$txId}:branch:{$index}";
    }

    protected function logTransaction(
        string $txId,
        string $branchId,
        string $participant,
        string $action,
        array $params = []
    ): TccTransactionLog {
        return TccTransactionLog::create([
            'tx_id' => $txId,
            'branch_id' => $branchId,
            'participant' => $participant,
            'action' => $action,
            'status' => TccTransactionLog::STATUS_INIT,
            'params' => $params,
            'retry_count' => 0,
            'max_retries' => 3,
        ]);
    }

    protected function updateStatus(
        string $txId,
        string $branchId,
        string $action,
        string $status,
        ?string $errorMessage = null
    ): void {
        TccTransactionLog::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->where('action', $action)
            ->update([
                'status' => $status,
                'error_message' => $errorMessage,
            ]);
    }

    protected function alertConfirmFailure(string $txId, string $branchId): void
    {
        // 发送告警：Confirm 失败是严重异常，需要人工介入
        Log::critical("TCC CONFIRM FAILURE: tx_id={$txId}, branch_id={$branchId}");
        // 可接入钉钉/飞书/Slack 通知
    }
}
```

### 3.4 状态机设计

TCC 事务的状态流转如下：

```
                  ┌──────────────────────────────────────┐
                  │           全局事务状态机              │
                  └──────────────────────────────────────┘

  ┌─────┐   Try全部成功    ┌─────────┐   Confirm全部成功   ┌─────────┐
  │ Init ├───────────────→  │ Trying  ├──────────────────→  │ Succeed │
  └──┬──┘                  └────┬────┘                     └─────────┘
     │                         │ Try失败
     │                         ↓
     │                   ┌───────────┐   Cancel完成   ┌─────────┐
     └─────────────────→ │ Canceling ├──────────────→ │ Failed  │
                         └───────────┘                └─────────┘

                  ┌──────────────────────────────────────┐
                  │          分支事务状态机               │
                  └──────────────────────────────────────┘

  ┌──────┐  Try成功  ┌─────────┐  Confirm成功  ┌─────────┐
  │ Init ├─────────→ │ Tried   ├─────────────→ │ Confirmed│
  └──┬───┘           └────┬────┘               └─────────┘
     │                    │ 需要回滚
     │ Try失败            ↓
     │              ┌──────────┐  Cancel成功  ┌──────────┐
     └────────────→ │ Canceling├────────────→ │Cancelled │
                    └──────────┘              └──────────┘
```

---

## 四、实战案例一：订单创建场景

### 4.1 业务场景

用户下单购买商品，需要同时完成：
1. 创建订单记录（订单服务）
2. 预留库存（库存服务）
3. 冻结账户余额（账户服务）

### 4.2 数据库设计

```sql
-- 订单表
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(64) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    status ENUM('pending', 'confirmed', 'cancelled') DEFAULT 'pending',
    tx_id VARCHAR(64) NULL COMMENT '关联的TCC全局事务ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 库存表
CREATE TABLE inventories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    sku_id BIGINT NOT NULL,
    total_stock INT NOT NULL DEFAULT 0,
    frozen_stock INT NOT NULL DEFAULT 0 COMMENT '冻结库存',
    available_stock INT GENERATED ALWAYS AS (total_stock - frozen_stock) STORED,
    version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    UNIQUE KEY uk_sku (sku_id)
);

-- 账户余额表
CREATE TABLE accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNIQUE NOT NULL,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    frozen_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '冻结金额',
    available_balance DECIMAL(12,2) GENERATED ALWAYS AS (balance - frozen_amount) STORED,
    version INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 冻结明细表（用于幂等校验和Cancel防悬挂）
CREATE TABLE frozen_details (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tx_id VARCHAR(64) NOT NULL,
    branch_id VARCHAR(64) NOT NULL,
    biz_type ENUM('inventory', 'account') NOT NULL,
    biz_id BIGINT NOT NULL COMMENT '关联的资源ID',
    amount INT NOT NULL COMMENT '冻结数量/金额',
    status ENUM('frozen', 'confirmed', 'cancelled') DEFAULT 'frozen',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tx_branch (tx_id, branch_id)
);
```

### 4.3 库存预留参与者

```php
<?php

namespace App\Tcc\Participants;

use App\Models\FrozenDetail;
use App\Models\Inventory;
use App\Tcc\Contracts\TccParticipant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class InventoryParticipant implements TccParticipant
{
    public function try(string $txId, string $branchId, array $params): bool
    {
        $skuId = $params['sku_id'];
        $quantity = $params['quantity'];

        // 幂等检查：如果已经存在冻结记录，直接返回成功
        $existing = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->first();
        if ($existing) {
            Log::info("Inventory Try 幂等命中: {$branchId}");
            return true;
        }

        return DB::transaction(function () use ($txId, $branchId, $skuId, $quantity) {
            // 乐观锁扣减可用库存（锁定行）
            $inventory = Inventory::where('sku_id', $skuId)
                ->lockForUpdate()
                ->first();

            if (!$inventory || $inventory->available_stock < $quantity) {
                Log::warning("库存不足: sku={$skuId}, 需要={$quantity}, 可用={$inventory->available_stock}");
                return false;
            }

            // 冻结库存
            $affected = Inventory::where('sku_id', $skuId)
                ->where('available_stock', '>=', $quantity)
                ->update([
                    'frozen_stock' => DB::raw("frozen_stock + {$quantity}"),
                    'version' => DB::raw('version + 1'),
                ]);

            if ($affected === 0) {
                return false;
            }

            // 记录冻结明细（用于幂等和Cancel）
            FrozenDetail::create([
                'tx_id' => $txId,
                'branch_id' => $branchId,
                'biz_type' => 'inventory',
                'biz_id' => $inventory->id,
                'amount' => $quantity,
                'status' => 'frozen',
            ]);

            Log::info("库存预留成功: sku={$skuId}, 数量={$quantity}");
            return true;
        });
    }

    public function confirm(string $txId, string $branchId): bool
    {
        // 幂等检查
        $frozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->where('status', 'frozen')
            ->first();

        if (!$frozen) {
            // 已经确认过，或者冻结记录不存在（空Confirm）
            Log::info("Inventory Confirm 幂等命中或无冻结记录: {$branchId}");
            return true;
        }

        return DB::transaction(function () use ($frozen) {
            // 将冻结库存转为实际扣减
            $affected = Inventory::where('id', $frozen->biz_id)
                ->where('frozen_stock', '>=', $frozen->amount)
                ->update([
                    'total_stock' => DB::raw("total_stock - {$frozen->amount}"),
                    'frozen_stock' => DB::raw("frozen_stock - {$frozen->amount}"),
                    'version' => DB::raw('version + 1'),
                ]);

            if ($affected === 0) {
                throw new \RuntimeException("库存 Confirm 失败: 数据不一致");
            }

            $frozen->update(['status' => 'confirmed']);
            Log::info("库存确认扣减: branch={$branchId}, 数量={$frozen->amount}");
            return true;
        });
    }

    public function cancel(string $txId, string $branchId): bool
    {
        // 空回滚处理：如果冻结记录不存在，说明 Try 未执行
        $frozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->first();

        if (!$frozen) {
            Log::info("Inventory Cancel 空回滚: {$branchId}");
            // 插入一条 cancelled 记录，防止悬挂
            FrozenDetail::create([
                'tx_id' => $txId,
                'branch_id' => $branchId,
                'biz_type' => 'inventory',
                'biz_id' => 0,
                'amount' => 0,
                'status' => 'cancelled',
            ]);
            return true;
        }

        // 幂等检查
        if ($frozen->status === 'cancelled') {
            Log::info("Inventory Cancel 幂等命中: {$branchId}");
            return true;
        }

        return DB::transaction(function () use ($frozen) {
            // 释放冻结库存
            Inventory::where('id', $frozen->biz_id)
                ->update([
                    'frozen_stock' => DB::raw("frozen_stock - {$frozen->amount}"),
                    'version' => DB::raw('version + 1'),
                ]);

            $frozen->update(['status' => 'cancelled']);
            Log::info("库存释放成功: branch={$branchId}, 数量={$frozen->amount}");
            return true;
        });
    }
}
```

### 4.4 账户冻结参与者

```php
<?php

namespace App\Tcc\Participants;

use App\Models\Account;
use App\Models\FrozenDetail;
use App\Tcc\Contracts\TccParticipant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AccountParticipant implements TccParticipant
{
    public function try(string $txId, string $branchId, array $params): bool
    {
        $userId = $params['user_id'];
        $amount = $params['amount'];

        // 幂等检查
        $existing = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->first();
        if ($existing) {
            return true;
        }

        return DB::transaction(function () use ($txId, $branchId, $userId, $amount) {
            $account = Account::where('user_id', $userId)->lockForUpdate()->first();

            if (!$account || $account->available_balance < $amount) {
                Log::warning("余额不足: user={$userId}, 需要={$amount}, 可用={$account->available_balance}");
                return false;
            }

            $affected = Account::where('user_id', $userId)
                ->where('available_balance', '>=', $amount)
                ->update([
                    'frozen_amount' => DB::raw("frozen_amount + {$amount}"),
                    'version' => DB::raw('version + 1'),
                ]);

            if ($affected === 0) {
                return false;
            }

            FrozenDetail::create([
                'tx_id' => $txId,
                'branch_id' => $branchId,
                'biz_type' => 'account',
                'biz_id' => $account->id,
                'amount' => $amount,
                'status' => 'frozen',
            ]);

            Log::info("余额冻结成功: user={$userId}, 金额={$amount}");
            return true;
        });
    }

    public function confirm(string $txId, string $branchId): bool
    {
        $frozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->where('status', 'frozen')
            ->first();

        if (!$frozen) {
            return true; // 幂等
        }

        return DB::transaction(function () use ($frozen) {
            Account::where('id', $frozen->biz_id)
                ->where('frozen_amount', '>=', $frozen->amount)
                ->update([
                    'balance' => DB::raw("balance - {$frozen->amount}"),
                    'frozen_amount' => DB::raw("frozen_amount - {$frozen->amount}"),
                    'version' => DB::raw('version + 1'),
                ]);

            $frozen->update(['status' => 'confirmed']);
            Log::info("余额确认扣除: branch={$branchId}, 金额={$frozen->amount}");
            return true;
        });
    }

    public function cancel(string $txId, string $branchId): bool
    {
        $frozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->first();

        // 空回滚
        if (!$frozen) {
            FrozenDetail::create([
                'tx_id' => $txId,
                'branch_id' => $branchId,
                'biz_type' => 'account',
                'biz_id' => 0,
                'amount' => 0,
                'status' => 'cancelled',
            ]);
            return true;
        }

        // 幂等
        if ($frozen->status === 'cancelled') {
            return true;
        }

        return DB::transaction(function () use ($frozen) {
            Account::where('id', $frozen->biz_id)
                ->update([
                    'frozen_amount' => DB::raw("frozen_amount - {$frozen->amount}"),
                    'version' => DB::raw('version + 1'),
                ]);

            $frozen->update(['status' => 'cancelled']);
            Log::info("余额释放成功: branch={$branchId}, 金额={$frozen->amount}");
            return true;
        });
    }
}
```

### 4.5 订单服务编排调用

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Tcc\Participants\InventoryParticipant;
use App\Tcc\Participants\AccountParticipant;
use App\Tcc\TccTransactionManager;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderService
{
    public function __construct(
        protected TccTransactionManager $tccManager
    ) {}

    public function createOrder(int $userId, array $items): array
    {
        // 计算总价
        $totalAmount = collect($items)->sum(fn($item) => $item['price'] * $item['quantity']);

        // 构建 TCC 参与者列表
        $participants = [];

        // 库存预留参与者
        foreach ($items as $item) {
            $participants[] = [
                'participant' => app(InventoryParticipant::class),
                'params' => [
                    'sku_id' => $item['sku_id'],
                    'quantity' => $item['quantity'],
                ],
            ];
        }

        // 账户冻结参与者
        $participants[] = [
            'participant' => app(AccountParticipant::class),
            'params' => [
                'user_id' => $userId,
                'amount' => $totalAmount,
            ],
        ];

        // 执行 TCC 事务
        $result = $this->tccManager->execute($participants);

        if ($result['success']) {
            // TCC 成功，创建订单
            $order = Order::create([
                'order_no' => $this->generateOrderNo(),
                'user_id' => $userId,
                'total_amount' => $totalAmount,
                'status' => 'confirmed',
                'tx_id' => $result['tx_id'],
            ]);

            return [
                'success' => true,
                'order_no' => $order->order_no,
                'message' => '下单成功',
            ];
        }

        return [
            'success' => false,
            'message' => '下单失败，请稍后重试',
            'tx_id' => $result['tx_id'],
        ];
    }

    protected function generateOrderNo(): string
    {
        return 'ORD' . date('YmdHis') . str_pad(mt_rand(1, 9999), 4, '0', STR_PAD_LEFT);
    }
}
```

---

## 五、实战案例二：支付场景

### 5.1 业务场景

用户对已确认的订单发起支付，需要同时完成：
1. 创建支付单（支付服务）
2. 调用第三方支付渠道扣款（渠道服务）
3. 更新订单状态为已支付（订单服务）

如果支付失败，需要补偿退款。

### 5.2 支付参与者实现

```php
<?php

namespace App\Tcc\Participants;

use App\Models\PaymentOrder;
use App\Models\FrozenDetail;
use App\Tcc\Contracts\TccParticipant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentParticipant implements TccParticipant
{
    /**
     * Try: 创建支付单（状态为 pending），请求渠道预扣款
     */
    public function try(string $txId, string $branchId, array $params): bool
    {
        $orderNo = $params['order_no'];
        $amount = $params['amount'];
        $channel = $params['channel'] ?? 'alipay';

        // 幂等检查
        $existing = PaymentOrder::where('tx_id', $txId)->first();
        if ($existing) {
            return $existing->status !== 'failed';
        }

        return DB::transaction(function () use ($txId, $orderNo, $amount, $channel) {
            // 1. 创建支付单
            $payment = PaymentOrder::create([
                'payment_no' => $this->generatePaymentNo(),
                'order_no' => $orderNo,
                'amount' => $amount,
                'channel' => $channel,
                'status' => 'pending',
                'tx_id' => $txId,
                'expire_at' => now()->addMinutes(30),
            ]);

            // 2. 调用第三方支付渠道预扣款（同步接口）
            try {
                $channelResult = $this->channelPreAuth($payment);
                if (!$channelResult['success']) {
                    $payment->update([
                        'status' => 'failed',
                        'channel_trade_no' => $channelResult['trade_no'] ?? null,
                        'fail_reason' => $channelResult['message'] ?? '渠道预扣款失败',
                    ]);
                    return false;
                }

                $payment->update([
                    'status' => 'authorized',
                    'channel_trade_no' => $channelResult['trade_no'],
                ]);

                return true;
            } catch (\Throwable $e) {
                Log::error("支付渠道预扣款异常: {$e->getMessage()}");
                $payment->update(['status' => 'failed', 'fail_reason' => $e->getMessage()]);
                return false;
            }
        });
    }

    /**
     * Confirm: 将预扣款转为实际扣款
     */
    public function confirm(string $txId, string $branchId): bool
    {
        $payment = PaymentOrder::where('tx_id', $txId)->first();

        if (!$payment) {
            Log::warning("Confirm 时支付单不存在: {$txId}");
            return true; // 空 Confirm
        }

        if ($payment->status === 'paid') {
            return true; // 幂等
        }

        return DB::transaction(function () use ($payment) {
            // 调用渠道确认扣款
            $channelResult = $this->channelConfirm($payment);

            if ($channelResult['success']) {
                $payment->update([
                    'status' => 'paid',
                    'paid_at' => now(),
                ]);
                Log::info("支付确认成功: payment={$payment->payment_no}");
                return true;
            }

            throw new \RuntimeException("渠道确认扣款失败: " . ($channelResult['message'] ?? ''));
        });
    }

    /**
     * Cancel: 退款（如果已预扣款）或关闭支付单
     */
    public function cancel(string $txId, string $branchId): bool
    {
        $payment = PaymentOrder::where('tx_id', $txId)->first();

        // 空回滚
        if (!$payment) {
            return true;
        }

        // 幂等
        if (in_array($payment->status, ['refunded', 'closed', 'cancelled'])) {
            return true;
        }

        return DB::transaction(function () use ($payment) {
            if ($payment->status === 'authorized') {
                // 已预扣款，需要退款
                $channelResult = $this->channelRefund($payment);

                if ($channelResult['success']) {
                    $payment->update([
                        'status' => 'refunded',
                        'refunded_at' => now(),
                    ]);
                    Log::info("支付退款成功: payment={$payment->payment_no}");
                    return true;
                }

                // 退款失败，记录待人工处理
                $payment->update([
                    'status' => 'refund_pending',
                    'fail_reason' => '自动退款失败，待人工处理',
                ]);
                Log::critical("支付退款失败，需人工介入: payment={$payment->payment_no}");
                return false;
            }

            // 仅创建了支付单，直接关闭
            $payment->update(['status' => 'closed']);
            return true;
        });
    }

    protected function channelPreAuth(PaymentOrder $payment): array
    {
        // 模拟第三方支付渠道预扣款
        // 实际接入时替换为具体渠道 SDK 调用
        return ['success' => true, 'trade_no' => 'CH' . uniqid()];
    }

    protected function channelConfirm(PaymentOrder $payment): array
    {
        return ['success' => true];
    }

    protected function channelRefund(PaymentOrder $payment): array
    {
        return ['success' => true];
    }

    protected function generatePaymentNo(): string
    {
        return 'PAY' . date('YmdHis') . str_pad(mt_rand(1, 9999), 4, '0', STR_PAD_LEFT);
    }
}
```

### 5.3 超时处理与定时任务

支付场景中，超时未完成的支付单需要自动关闭。我们通过 Laravel 的定时任务实现：

```php
<?php

namespace App\Console\Commands;

use App\Models\PaymentOrder;
use App\Models\FrozenDetail;
use App\Models\Inventory;
use App\Models\Account;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentTimeoutHandler extends Command
{
    protected $signature = 'payment:handle-timeout';
    protected $description = '处理超时未完成的支付单';

    public function handle(): int
    {
        // 查找所有超时的 authorized 状态支付单
        $expiredPayments = PaymentOrder::where('status', 'authorized')
            ->where('expire_at', '<', now())
            ->limit(100)
            ->get();

        $this->info("发现 {$expiredPayments->count()} 笔超时支付单");

        foreach ($expiredPayments as $payment) {
            DB::beginTransaction();
            try {
                Log::info("处理超时支付: {$payment->payment_no}");

                // 1. 关闭支付单
                $payment->update(['status' => 'timeout_closed']);

                // 2. 关联的 TCC 事务需要执行 Cancel
                if ($payment->tx_id) {
                    // 通过消息队列触发 Cancel 流程
                    // 或直接在此处调用参与者 Cancel
                    Log::info("触发 TCC Cancel: tx_id={$payment->tx_id}");
                }

                DB::commit();
            } catch (\Throwable $e) {
                DB::rollBack();
                Log::error("处理超时支付失败: {$payment->payment_no}, error: {$e->getMessage()}");
            }
        }

        return self::SUCCESS;
    }
}
```

在 `app/Console/Kernel.php` 中注册定时任务：

```php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('payment:handle-timeout')->everyFiveMinutes();
}
```

---

## 六、实战案例三：库存扣减场景

### 6.1 业务场景

库存扣减是最经典的 TCC 场景。除了基础的库存预留/确认/释放，还需要特别注意：

1. **高并发安全**：同一 SKU 可能被大量请求同时扣减
2. **幂等性**：网络重试不应导致重复扣减
3. **防悬挂**：Cancel 先于 Try 到达的极端情况

### 6.2 高性能库存参与者

```php
<?php

namespace App\Tcc\Participants;

use App\Models\FrozenDetail;
use App\Models\Inventory;
use App\Tcc\Contracts\TccParticipant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class HighConcurrencyInventoryParticipant implements TccParticipant
{
    /**
     * 使用 Redis + Lua 脚本实现高性能 Try
     * 适用于秒杀、抢购等极高并发场景
     */
    public function try(string $txId, string $branchId, array $params): bool
    {
        $skuId = $params['sku_id'];
        $quantity = $params['quantity'];

        // 幂等检查（先查 Redis 缓存）
        $cacheKey = "tcc:frozen:{$txId}:{$branchId}";
        if (Redis::exists($cacheKey)) {
            return true; // 幂等命中
        }

        // Redis Lua 脚本：原子性检查并预留库存
        $luaScript = <<<LUA
            local stockKey = KEYS[1]
            local frozenKey = KEYS[2]
            local quantity = tonumber(ARGV[1])
            local txBranch = ARGV[2]

            local available = tonumber(redis.call('GET', stockKey) or '0')
            if available < quantity then
                return 0
            end

            redis.call('DECRBY', stockKey, quantity)
            redis.call('HINCRBY', frozenKey, txBranch, quantity)
            return 1
        LUA;

        $result = Redis::eval($luaScript, 2,
            "inventory:available:{$skuId}",
            "inventory:frozen:{$skuId}",
            $quantity,
            "{$txId}:{$branchId}"
        );

        if ($result == 0) {
            Log::warning("Redis 库存不足: sku={$skuId}");
            return false;
        }

        // 异步持久化到数据库（通过消息队列）
        dispatch(function () use ($txId, $branchId, $skuId, $quantity) {
            DB::transaction(function () use ($txId, $branchId, $skuId, $quantity) {
                FrozenDetail::updateOrCreate(
                    ['tx_id' => $txId, 'branch_id' => $branchId],
                    [
                        'biz_type' => 'inventory',
                        'biz_id' => $skuId,
                        'amount' => $quantity,
                        'status' => 'frozen',
                    ]
                );

                Inventory::where('sku_id', $skuId)->update([
                    'frozen_stock' => DB::raw("frozen_stock + {$quantity}"),
                ]);
            });
        })->afterCommit();

        // 设置幂等缓存（24 小时过期）
        Redis::setex($cacheKey, 86400, '1');

        Log::info("Redis 库存预留成功: sku={$skuId}, qty={$quantity}");
        return true;
    }

    public function confirm(string $txId, string $branchId): bool
    {
        $cacheKey = "tcc:frozen:{$txId}:{$branchId}";
        $frozen = Redis::get($cacheKey);

        if (!$frozen) {
            // 可能是延迟到达的 Confirm，查数据库
            $dbFrozen = FrozenDetail::where('tx_id', $txId)
                ->where('branch_id', $branchId)
                ->first();

            if (!$dbFrozen || $dbFrozen->status !== 'frozen') {
                return true; // 幂等或空 Confirm
            }
        }

        $skuId = null;
        $quantity = 0;

        // 从 Redis 获取冻结信息
        $parts = explode(':', $branchId);
        $frozenKey = "inventory:frozen:*";

        // 从数据库获取详细信息
        $dbFrozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->where('status', 'frozen')
            ->first();

        if (!$dbFrozen) {
            return true;
        }

        $skuId = $dbFrozen->biz_id;
        $quantity = $dbFrozen->amount;

        // Redis Lua：将冻结库存转为实际扣减
        $luaScript = <<<LUA
            local frozenKey = KEYS[1]
            local txBranch = ARGV[1]
            local qty = tonumber(ARGV[2])

            local frozen = tonumber(redis.call('HGET', frozenKey, txBranch) or '0')
            if frozen < qty then
                return 0
            end

            redis.call('HDEL', frozenKey, txBranch)
            redis.call('DECRBY', 'inventory:total:' .. ARGV[3], qty)
            return 1
        LUA;

        Redis::eval($luaScript, 1,
            "inventory:frozen:{$skuId}",
            "{$txId}:{$branchId}",
            $quantity,
            $skuId
        );

        // 异步持久化
        dispatch(function () use ($txId, $branchId, $skuId, $quantity) {
            DB::transaction(function () use ($txId, $branchId, $skuId, $quantity) {
                Inventory::where('sku_id', $skuId)->update([
                    'total_stock' => DB::raw("total_stock - {$quantity}"),
                    'frozen_stock' => DB::raw("frozen_stock - {$quantity}"),
                ]);

                FrozenDetail::where('tx_id', $txId)
                    ->where('branch_id', $branchId)
                    ->update(['status' => 'confirmed']);
            });
        })->afterCommit();

        return true;
    }

    public function cancel(string $txId, string $branchId): bool
    {
        $dbFrozen = FrozenDetail::where('tx_id', $txId)
            ->where('branch_id', $branchId)
            ->first();

        // 空回滚处理
        if (!$dbFrozen) {
            FrozenDetail::create([
                'tx_id' => $txId,
                'branch_id' => $branchId,
                'biz_type' => 'inventory',
                'biz_id' => 0,
                'amount' => 0,
                'status' => 'cancelled',
            ]);

            // 检查是否需要防悬挂：如果 Redis 中有冻结记录，说明 Try 延迟到达
            // 此时标记为悬挂，由补偿任务清理
            return true;
        }

        if ($dbFrozen->status === 'cancelled') {
            return true; // 幂等
        }

        $skuId = $dbFrozen->biz_id;
        $quantity = $dbFrozen->amount;

        if ($quantity > 0) {
            // Redis Lua：释放冻结库存
            $luaScript = <<<LUA
                local frozenKey = KEYS[1]
                local stockKey = KEYS[2]
                local txBranch = ARGV[1]
                local qty = tonumber(ARGV[2])

                local frozen = tonumber(redis.call('HGET', frozenKey, txBranch) or '0')
                if frozen >= qty then
                    redis.call('HDEL', frozenKey, txBranch)
                    redis.call('INCRBY', stockKey, qty)
                    return 1
                end
                return 0
            LUA;

            Redis::eval($luaScript, 2,
                "inventory:frozen:{$skuId}",
                "inventory:available:{$skuId}",
                "{$txId}:{$branchId}",
                $quantity
            );

            // 异步持久化
            dispatch(function () use ($txId, $branchId, $skuId, $quantity) {
                Inventory::where('sku_id', $skuId)->update([
                    'frozen_stock' => DB::raw("frozen_stock - {$quantity}"),
                ]);
                FrozenDetail::where('tx_id', $txId)
                    ->where('branch_id', $branchId)
                    ->update(['status' => 'cancelled']);
            })->afterCommit();
        }

        return true;
    }
}
```

---

## 七、空回滚、悬挂、幂等三大问题与解决方案

TCC 在分布式环境下会遇到三个经典问题，如果处理不当，将导致严重的数据不一致。这是 TCC 实现中最容易出错的地方，也是区分"理论 TCC"和"生产级 TCC"的关键。

### 7.1 空回滚（Empty Rollback）

**问题描述**：Try 还没有执行，协调者就发起了 Cancel。这通常是因为 Try 请求超时，协调者认为失败而触发回滚。

**发生场景**：
1. 网络超时：Try 请求在网络中延迟，协调者超时后发起 Cancel
2. 服务重启：Try 处理到一半服务重启，协调者重试后发起 Cancel

**解决方案**：

```php
public function cancel(string $txId, string $branchId): bool
{
    // 关键：查询是否已存在 Try 的执行记录
    $frozen = FrozenDetail::where('tx_id', $txId)
        ->where('branch_id', $branchId)
        ->first();

    if (!$frozen) {
        // 没有冻结记录，说明 Try 未执行，属于空回滚
        Log::info("空回滚处理: tx={$txId}, branch={$branchId}");

        // 必须插入一条记录，标记此事务已 Cancel
        // 后续迟到的 Try 到达时，需要检查这条记录来拒绝执行
        FrozenDetail::create([
            'tx_id' => $txId,
            'branch_id' => $branchId,
            'biz_type' => 'inventory',
            'biz_id' => 0,
            'amount' => 0,
            'status' => 'cancelled',
        ]);

        return true;
    }

    // ... 正常 Cancel 逻辑
}
```

**核心原则**：Cancel 必须能检测 Try 是否已执行。最可靠的方式是通过 `tx_id + branch_id` 查询事务记录表。

### 7.2 悬挂（Suspension）

**问题描述**：Cancel 已经执行完毕（空回滚），但迟到的 Try 请求又到达了，导致资源被冻结却永远不会被 Confirm 或 Cancel。

**发生场景**：
1. Try 网络严重延迟，Cancel 已完成空回滚后，Try 才到达
2. 这时 Try 会冻结资源，但对应的事务已被标记为 Cancelled

**解决方案**：

```php
public function try(string $txId, string $branchId, array $params): bool
{
    // 防悬挂：检查是否存在已 Cancel 的记录
    $cancelled = FrozenDetail::where('tx_id', $txId)
        ->where('branch_id', $branchId)
        ->where('status', 'cancelled')
        ->first();

    if ($cancelled) {
        // Cancel 已执行过，拒绝迟到的 Try
        Log::warning("拒绝悬挂 Try: tx={$txId}, branch={$branchId}");
        return false;
    }

    // 幂等检查
    $existing = FrozenDetail::where('tx_id', $txId)
        ->where('branch_id', $branchId)
        ->first();

    if ($existing) {
        return true; // Try 已执行过，幂等返回
    }

    // ... 正常 Try 逻辑
}
```

**核心原则**：Try 执行前必须检查是否已经有过 Cancel 记录。如果有，说明是迟到的 Try，必须拒绝。

### 7.3 幂等性（Idempotency）

**问题描述**：网络重试、消息重复投递等原因导致 Confirm 或 Cancel 被多次调用，如果不做幂等处理，会导致资源被多次扣减或释放。

**解决方案**：

```php
public function confirm(string $txId, string $branchId): bool
{
    // 幂等控制：使用数据库行锁 + 状态检查
    $frozen = FrozenDetail::where('tx_id', $txId)
        ->where('branch_id', $branchId)
        ->lockForUpdate()
        ->first();

    if (!$frozen || $frozen->status !== 'frozen') {
        // 非 frozen 状态，说明已经处理过（confirmed 或 cancelled）
        return true;
    }

    return DB::transaction(function () use ($frozen) {
        // 执行确认逻辑...
        Inventory::where('id', $frozen->biz_id)
            ->update([
                'total_stock' => DB::raw("total_stock - {$frozen->amount}"),
                'frozen_stock' => DB::raw("frozen_stock - {$frozen->amount}"),
            ]);

        // 关键：将状态从 frozen 改为 confirmed
        // 后续重复调用会因 status !== 'frozen' 而直接返回
        $frozen->update(['status' => 'confirmed']);

        return true;
    });
}
```

**核心原则**：通过状态机保证幂等。`frozen → confirmed → (已确认，不再处理)`，每一步状态转换都是幂等检查点。

### 7.4 三大问题的关联关系

```
时间线示例：

T1: Try 请求发出（网络延迟...）
T2: 协调者超时，发出 Cancel
T3: Cancel 到达参与者，发现无 Try 记录 → 空回滚（插入 cancelled 记录）
T4: Try 终于到达参与者，发现有 cancelled 记录 → 拒绝执行（防悬挂）
T5: 协调者重试 Cancel → 发现已有 cancelled 记录 → 幂等返回

这三个问题的解决形成一个闭环：
- 空回滚 → Cancel 时无 Try 记录，插入 cancelled 标记
- 防悬挂 → Try 时检查 cancelled 标记，拒绝迟到请求
- 幂等   → Confirm/Cancel 检查状态，避免重复执行
```

---

## 八、TCC 框架选型：自建 vs Seata vs DTM

### 8.1 方案对比

| 维度 | 自建框架 | Seata（阿里） | DTM（国内开源） |
|------|----------|---------------|-----------------|
| 语言支持 | PHP/Laravel 原生 | Java 为主，PHP SDK 不完善 | Go 为主，HTTP/gRPC 协议语言无关 |
| 学习成本 | 低（自己写的代码） | 高（概念多、配置复杂） | 中（API 简洁） |
| 协议侵入 | 自定义接口 | 需引入 Seata SDK | HTTP 调用，侵入低 |
| 运维复杂度 | 低（依赖少） | 高（需要 Server 集群） | 中（单 binary 部署） |
| 功能完整度 | 取决于开发投入 | 非常完善 | 完善（TCC/Saga/XA/二阶段消息） |
| 社区活跃度 | N/A | 非常活跃 | 活跃 |
| 生产验证 | 取决于团队能力 | 阿里内部大量验证 | 多家公司生产使用 |

### 8.2 自建框架适用场景

选择自建的条件：
- 团队对 TCC 原理理解深入
- 业务场景相对简单（参与者数量少、流程固定）
- 不想引入额外的中间件依赖
- 需要深度定制化（如与现有日志/监控系统集成）

自建框架的代码量参考：本文提供的示例代码约 300 行，一个生产级的自建 TCC 框架通常需要 1000-3000 行，包括协调器、事务日志、重试调度、告警、管理后台等。

### 8.3 DTM 集成方案

DTM 是目前对多语言（尤其是 PHP）最友好的分布式事务框架。以下是 Laravel 集成 DTM 的示例：

```php
<?php

namespace App\Tcc;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class DtmTccClient
{
    protected string $dtmServer;

    public function __construct(string $dtmServer = 'http://localhost:36789')
    {
        $this->dtmServer = $dtmServer;
    }

    /**
     * 发起 TCC 全局事务
     */
    public function execute(array $participants): array
    {
        $gid = $this->generateGid();

        // 1. 创建全局事务
        $this->callDtm('/api/dtmsvr/newGid', ['gid' => $gid]);

        // 2. 注册 TCC 分支
        foreach ($participants as $participant) {
            $this->callDtm('/api/dtmsvr/registerTccBranch', [
                'gid' => $gid,
                'branch_id' => $participant['branch_id'],
                'trans_type' => 'tcc',
                'status' => 'prepared',
                'data' => $participant['params'],
            ]);
        }

        // 3. 执行 Try 阶段
        foreach ($participants as $participant) {
            $tryResult = Http::timeout(10)
                ->post($participant['try_url'], array_merge(
                    $participant['params'],
                    ['gid' => $gid, 'branch_id' => $participant['branch_id']]
                ));

            if (!$tryResult->successful()) {
                // Try 失败，DTM 会自动调用所有 Cancel
                $this->callDtm('/api/dtmsvr/operate', [
                    'gid' => $gid,
                    'action' => 'abort',
                ]);
                return ['success' => false, 'gid' => $gid];
            }
        }

        // 4. 提交（DTM 自动调用所有 Confirm）
        $this->callDtm('/api/dtmsvr/operate', [
            'gid' => $gid,
            'action' => 'submit',
        ]);

        return ['success' => true, 'gid' => $gid];
    }

    protected function callDtm(string $path, array $data): array
    {
        $response = Http::timeout(5)->post($this->dtmServer . $path, $data);
        return $response->json();
    }

    protected function generateGid(): string
    {
        return uniqid('dtm_') . '_' . mt_rand(1000, 9999);
    }
}
```

使用 DTM 时，Laravel 服务只需暴露 Try/Confirm/Cancel 三个 HTTP 端点：

```php
// routes/api.php
Route::post('/tcc/inventory/try', [InventoryTccController::class, 'try']);
Route::post('/tcc/inventory/confirm', [InventoryTccController::class, 'confirm']);
Route::post('/tcc/inventory/cancel', [InventoryTccController::class, 'cancel']);
```

### 8.4 Seata 的 PHP 生态现状

Seata 对 PHP 的支持相对有限，官方主要维护 Java SDK。社区有非官方的 PHP Client（如 `php-seata-client`），但成熟度不高。如果项目以 Java 微服务为主，少数 PHP 服务通过 HTTP 参与 Seata 事务是可行的；但如果整体都是 PHP/Laravel，不推荐选择 Seata。

---

## 九、生产环境踩坑记录与最佳实践

### 9.1 踩坑一：Confirm 不允许失败

**问题**：TCC 理论要求 Confirm 必须成功，但实际开发中，开发者习惯性地在 Confirm 中加入业务校验逻辑，导致偶发失败。

**教训**：Confirm 中不应有任何可能导致失败的业务逻辑。所有检查应在 Try 阶段完成。

```php
// ❌ 错误示范：Confirm 中做了余额检查
public function confirm(string $txId, string $branchId): bool
{
    $account = Account::find($frozen->biz_id);
    if ($account->balance < $frozen->amount) {
        return false; // ← 这不应该发生！
    }
    // ...
}

// ✅ 正确做法：Confirm 只做最终提交
public function confirm(string $txId, string $branchId): bool
{
    // 直接执行扣减，不做额外检查
    $affected = Account::where('id', $frozen->biz_id)
        ->where('frozen_amount', '>=', $frozen->amount)
        ->update([...]);

    return $affected > 0;
}
```

### 9.2 踩坑二：数据库事务与 TCC 的时序问题

**问题**：Try 阶段使用了 `DB::transaction`，但事务提交延迟导致 Cancel 读取不到冻结记录，误判为空回滚。

**解决方案**：确保 Try 的数据库事务在返回前已提交。避免使用 Laravel 的 `dispatch(...)->afterCommit()` 来延迟核心冻结逻辑。

### 9.3 踩坑三：Redis 与数据库双写一致性

**问题**：库存扣减同时写 Redis 和 MySQL，Redis 成功但 MySQL 失败，导致数据不一致。

**最佳实践**：以数据库为最终一致性源，Redis 作为加速层。启动时从数据库加载库存到 Redis，定期对账修正差异。

```php
// 定时对账任务
$schedule->call(function () {
    $inventories = Inventory::all();
    foreach ($inventories as $inv) {
        $redisAvailable = Redis::get("inventory:available:{$inv->sku_id}") ?? 0;
        $dbAvailable = $inv->available_stock;

        if ((int)$redisAvailable !== $dbAvailable) {
            Log::warning("库存不一致: sku={$inv->sku_id}, redis={$redisAvailable}, db={$dbAvailable}");
            Redis::set("inventory:available:{$inv->sku_id}", $dbAvailable);
        }
    }
})->everyTenMinutes();
```

### 9.4 踩坑四：超时时间设置不当

**问题**：Try 的超时时间设置过短（如 1 秒），网络稍有波动就判定失败并触发 Cancel。但 Try 实际已在服务端执行成功，Cancel 又无法回滚（因为资源已预留）。

**最佳实践**：

```php
// 超时时间配置建议
$timeoutConfig = [
    'try_timeout' => 5,      // Try 调用超时：5秒
    'confirm_timeout' => 10,  // Confirm 调用超时：10秒（需要重试）
    'cancel_timeout' => 10,   // Cancel 调用超时：10秒
    'total_timeout' => 30,    // 整个事务超时：30秒
    'confirm_retry_interval' => [100, 500, 1000, 2000, 5000], // 指数退避
];
```

### 9.5 踩坑五：日志不足导致问题排查困难

**问题**：TCC 涉及多服务、多阶段，出问题时很难定位。线上曾出现"库存莫名减少"的问题，排查了两天才发现是 Cancel 重试时幂等处理有 bug。

**最佳实践**：每个 TCC 阶段都必须记录详细日志，包括 tx_id、branch_id、操作前后的资源状态。

```php
// 统一日志封装
trait TccLogging
{
    protected function logTccAction(
        string $txId,
        string $branchId,
        string $action,
        string $result,
        array $context = []
    ): void {
        Log::info("TCC.{$action}", array_merge([
            'tx_id' => $txId,
            'branch_id' => $branchId,
            'result' => $result,
            'timestamp' => now()->toIso8601String(),
        ], $context));
    }
}
```

### 9.6 最佳实践总结

1. **冻结表是核心**：所有 TCC 参与者共享一张 `frozen_details` 表，记录每笔冻结/释放的状态转换
2. **数据库为真相源**：Redis/缓存只是加速层，最终一致性以数据库为准
3. **Confirm 只做提交**：不要在 Confirm 中做业务校验
4. **幂等贯穿始终**：每个阶段的入口都必须做幂等检查
5. **完善监控告警**：Confirm 失败、Cancel 失败必须有告警
6. **定期对账**：定时任务对比冻结记录和实际库存/余额，发现不一致及时修正
7. **压力测试**：上线前必须测试网络超时、服务重启、重复请求等异常场景
8. **灰度发布**：TCC 涉及资金操作，务必灰度上线并密切观察

---

## 十、总结与选型建议

### 10.1 TCC 适用场景

TCC 最适合以下业务场景：

- **资金交易**：支付、转账、退款等涉及金额变动的操作
- **库存管理**：商品库存扣减、预留、释放
- **订单状态**：多服务协同的订单创建、取消流程
- **资源预约**：会议室预约、票务锁定等需要"先占后提交"的场景

### 10.2 TCC 不适合的场景

- **纯查询操作**：读多写少的场景，Saga 或本地消息表更简单
- **无回滚能力的操作**：如发送短信、调用不支持退款的外部接口
- **高吞吐低延迟场景**：TCC 的三阶段通信带来额外延迟，秒杀场景需配合 Redis 预扣
- **团队经验不足**：TCC 的实现复杂度高，需要深入理解分布式事务理论

### 10.3 选型决策树

```
需要分布式事务？
├── 否 → 使用本地事务
└── 是 → 对一致性要求高？
    ├── 否 → Saga 模式（简单、补偿逻辑直观）
    └── 是 → 操作可预留资源？
        ├── 否 → 本地消息表 + 最终一致
        └── 是 → 参与者数量多？
            ├── 少（2-3个） → 自建 TCC 框架
            └── 多 → DTM / Seata（有成熟编排能力）
```

### 10.4 最终建议

1. **起步阶段**：如果团队第一次接触分布式事务，建议从 Saga 模式开始，理解分布式事务的核心思想
2. **资金场景**：涉及资金的操作必须使用 TCC，因为它提供了最强的一致性保证
3. **框架选择**：PHP/Laravel 项目优先考虑 DTM（HTTP 协议、多语言友好），其次是自建
4. **渐进式落地**：先在非核心链路试用 TCC，积累经验后再应用到支付等核心链路
5. **配套建设**：TCC 不只是代码层面的事，还需要完善的监控、告警、对账、人工介入等运维体系

TCC 模式虽然实现复杂度较高，但在对数据一致性要求严格的场景下，它是目前最可靠的分布式事务解决方案之一。掌握 TCC 的原理和实践，是微服务架构师的必备技能。



## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/架构/saga-orchestration-pattern-laravel-distributed-transaction/) — 分布式事务的另一种主流模式 Saga 的完整实现方案
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/categories/架构/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/) — 事件驱动架构下的订单系统设计
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd——PHP 开发者的分布式互斥选型](/categories/架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/) — 微服务间的分布式协调机制


---

> **参考资料**
> - [Pattern: Distributed transactions - Saga](https://microservices.io/patterns/data/saga.html)
> - [DTM 官方文档](https://dtm.pub/)
> - [Seata 官方文档](https://seata.io/zh-cn/)
> - 《分布式事务原理与实践》— 张亮 著
> - [TCC Transaction Design](https://www.infoq.com/articles/tcc-transaction-design/)
