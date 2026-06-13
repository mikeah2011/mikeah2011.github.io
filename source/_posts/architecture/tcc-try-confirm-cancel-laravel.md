---

title: TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地
keywords: [TCC, Try, Confirm, Cancel, Laravel, 分布式事务模式实战, 订单, 支付, 库存中的落地]
date: 2026-06-06 09:00:00
tags:
- TCC
- 分布式
- Laravel
- 微服务
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: TCC 分布式事务模式深度实战指南，基于 Laravel 框架完整实现订单、支付、库存三大微服务的 Try-Confirm-Cancel 三阶段事务编排。文章详解 TCC 核心原理与状态机设计，提供事务日志管理、空回滚防护、悬挂处理、幂等保障三大经典问题的生产级解决方案，涵盖 Sage/TCC/2PC 三种分布式事务方案的对比选型表，包含完整的可运行 PHP 代码示例与踩坑经验，帮助后端工程师在高一致性要求的电商场景中稳健落地分布式事务。
---



## 前言

在微服务架构下，一个看似简单的"用户下单"操作，往往需要跨订单服务、支付服务、库存服务三个独立服务协同完成。传统的单机数据库事务（ACID）无法跨越服务边界，如何保证数据一致性成为了后端工程师必须面对的核心难题。

本文将以 **Laravel** 为技术栈，深入剖析 **TCC（Try-Confirm-Cancel）分布式事务模式**的原理与实战，手把手带你完成订单、支付、库存三大服务的 TCC 编排，涵盖空回滚、悬挂、幂等三大经典问题的解决方案，以及生产环境中的踩坑经验与最佳实践。

---

## 一、分布式事务概述

### 1.1 为什么需要分布式事务？

在单体应用中，我们可以利用数据库事务保证操作的原子性。但在微服务架构下，每个服务拥有独立的数据库，一个业务操作可能涉及多个服务的数据变更。以电商下单为例：

```
用户下单 → 订单服务创建订单 → 库存服务扣减库存 → 支付服务发起扣款
```

如果库存扣减成功但支付失败，就会出现"库存被扣了但钱没扣"的数据不一致问题。分布式事务的目标就是在这种跨服务场景下，保证所有操作要么全部成功，要么全部回滚。

### 1.2 主流分布式事务方案对比

目前业界主流的分布式事务解决方案主要有三种：**2PC（两阶段提交）**、**Saga 模式** 和 **TCC 模式**。下表从多个维度进行对比：

| 维度 | 2PC | Saga | TCC |
|------|-----|------|-----|
| **一致性** | 强一致 | 最终一致 | 最终一致（接近强一致） |
| **隔离性** | 好（全局锁） | 差（无隔离） | 好（资源预留） |
| **性能** | 差（阻塞等待） | 好（无锁） | 较好（柔性锁） |
| **实现复杂度** | 中等 | 中等 | 高 |
| **业务侵入** | 低 | 中（需实现补偿） | 高（需拆分三阶段） |
| **适用场景** | 数据库层面 | 长事务、跨多服务 | 高一致性要求的短事务 |
| **典型实现** | XA 协议 | Seata Saga、Eventuate Tram | Seata TCC、自研框架 |

**2PC** 的核心问题是同步阻塞——所有参与者在准备阶段必须锁定资源并等待协调者指令，一旦协调者宕机，所有参与者将长时间持有锁，吞吐量极低。

**Saga** 模式通过将长事务拆分为一系列本地事务，每个事务有对应的补偿操作，失败时逆序执行补偿。优点是无锁高性能，缺点是中间状态对外可见，缺乏隔离性。

**TCC** 模式则是 2PC 的"业务层升级版"——它在业务层面实现了 Try（预留）、Confirm（确认）、Cancel（取消）三个阶段，通过资源预留机制实现了比 Saga 更好的隔离性，同时避免了 2PC 的全局锁阻塞问题。

### 1.3 什么时候选择 TCC？

- 对一致性要求极高（如金融交易、电商下单扣款）
- 业务操作时间短（秒级完成）
- 团队有能力对每个服务实现三个阶段的接口
- 需要比 Saga 更好的隔离性保障

---

## 二、TCC 三阶段详解

TCC 模式的核心思想是将每个参与者的操作拆分为三个阶段：

### 2.1 Try —— 资源预留

Try 阶段不执行真正的业务操作，而是对资源进行"预留"或"冻结"。以库存扣减为例：

```
实际业务：库存 -1，从 100 变为 99
Try 阶段：冻结库存 +1，可用库存从 100 变为 99（实际库存仍为 100）
```

关键点：Try 阶段不改变业务的最终状态，只是"占住"资源，确保后续操作能成功执行。

### 2.2 Confirm —— 确认提交

当所有参与者的 Try 阶段都成功后，协调者会依次调用每个参与者的 Confirm 接口。Confirm 阶段执行真正的业务操作：

```
Confirm 阶段：将冻结的 1 件库存真正扣减，总库存从 100 变为 99，冻结库存归零
```

关键点：Confirm 操作必须是幂等的——因为网络超时等原因可能导致重试，多次调用 Confirm 必须结果一致。

### 2.3 Cancel —— 取消回滚

如果任何一个参与者的 Try 阶段失败，协调者会调用已成功 Try 的参与者的 Cancel 接口，释放预留的资源：

```
Cancel 阶段：释放冻结的 1 件库存，冻结库存 -1，可用库存恢复为 100
```

关键点：Cancel 操作同样必须是幂等的。

### 2.4 状态机示意

```
             Try 全部成功
    ┌─────────────────────────────┐
    │                             ▼
[初始] ── Try ──► [部分Try成功]  [全部Try成功]
                      │              │
                      ▼              ▼
                   Cancel        Confirm
                      │              │
                      ▼              ▼
                 [已回滚]        [已提交]
```

---

## 三、三大经典问题：空回滚、悬挂、幂等

TCC 模式在实际落地中有三个必须解决的经典问题，如果处理不当，会导致严重的数据不一致。

### 3.1 空回滚（Empty Rollback）

**场景描述**：在 Try 阶段，某个服务因为网络超时没有收到 Try 请求，协调者判定 Try 失败后调用 Cancel。此时该服务收到了 Cancel 请求，但从未执行过 Try。

**问题**：如果 Cancel 不做判断直接执行"释放冻结资源"的逻辑，而冻结资源本来就是 0，可能导致数据异常。

**解决方案**：引入事务状态表（TCC Transaction Log），记录每个事务 ID 的 Try 是否已执行。Cancel 执行前先查询日志，如果发现 Try 未执行过，则标记为空回滚，直接返回成功。

```php
// Cancel 方法中的空回滚判断
public function cancel(string $xid, array $params): bool
{
    $log = TccTransactionLog::where('xid', $xid)->first();

    // 空回滚：Try 从未执行过
    if (!$log || $log->status !== TccStatus::TRIED) {
        // 记录空回滚标记，防止后续悬挂
        TccTransactionLog::create([
            'xid' => $xid,
            'status' => TccStatus::ROLLBACKED,
            'is_empty_rollback' => true,
        ]);
        Log::warning("TCC空回滚: xid={$xid}");
        return true;
    }

    // 正常回滚逻辑...
    return $this->doCancel($log, $params);
}
```

### 3.2 悬挂（Suspension）

**场景描述**：空回滚发生后，之前因网络延迟未到达的 Try 请求此时才到达服务端。

**问题**：如果 Try 此时被正常执行，冻结了资源，但对应的 Cancel 已经作为"空回滚"执行完毕，后续不会再有 Cancel 来释放这些冻结的资源，导致资源被永久冻结。

**解决方案**：在 Try 执行前检查事务日志，如果发现该事务 ID 已经执行过 Cancel（或被标记为空回滚），则拒绝执行 Try。

```php
// Try 方法中的悬挂防护
public function try_(string $xid, array $params): bool
{
    $log = TccTransactionLog::where('xid', $xid)->first();

    // 悬挂防护：Cancel 已执行，拒绝 Try
    if ($log && $log->status === TccStatus::ROLLBACKED) {
        Log::warning("TCC悬挂防护: xid={$xid}，Cancel已执行，拒绝Try");
        return false;
    }

    // 防止 Try 重复执行
    if ($log && $log->status === TccStatus::TRIED) {
        Log::info("TCC Try幂等: xid={$xid}，已执行过Try");
        return true;
    }

    // 执行真正的 Try 逻辑
    DB::beginTransaction();
    try {
        $this->doTry($params);
        TccTransactionLog::create([
            'xid' => $xid,
            'status' => TccStatus::TRIED,
        ]);
        DB::commit();
        return true;
    } catch (\Exception $e) {
        DB::rollBack();
        throw $e;
    }
}
```

### 3.3 幂等（Idempotency）

**场景描述**：因为网络超时、协调者重试等原因，Confirm 或 Cancel 可能被多次调用。

**问题**：如果 Confirm 执行了"冻结资源转为真实扣减"，但被调用了两次，会导致重复扣减。

**解决方案**：通过事务状态表实现幂等控制。Confirm/Cancel 执行前检查状态，只有处于正确前置状态时才执行，并通过乐观锁或唯一约束防止并发重复执行。

```php
public function confirm(string $xid, array $params): bool
{
    return DB::transaction(function () use ($xid, $params) {
        // 使用悲观锁保证幂等
        $log = TccTransactionLog::where('xid', $xid)
            ->lockForUpdate()
            ->first();

        if (!$log || $log->status !== TccStatus::TRIED) {
            // 已确认或未Try过，幂等返回
            if ($log && $log->status === TccStatus::CONFIRMED) {
                return true; // 幂等
            }
            throw new TccException("无效的Confirm操作: xid={$xid}");
        }

        $this->doConfirm($log, $params);

        $log->update(['status' => TccStatus::CONFIRMED]);
        return true;
    });
}
```

---

## 四、Laravel 实战：订单 + 支付 + 库存的 TCC 编排

下面我们将通过一个完整的电商下单场景来演示 TCC 在 Laravel 中的实现。场景如下：

```
用户下单流程：
1. 订单服务：创建订单（Try: 冻结订单 / Confirm: 确认订单 / Cancel: 取消订单）
2. 库存服务：扣减库存（Try: 冻结库存 / Confirm: 扣减库存 / Cancel: 释放冻结库存）
3. 支付服务：扣款（Try: 冻结余额 / Confirm: 确认扣款 / Cancel: 解冻余额）
```

### 4.1 数据库设计

首先设计 TCC 事务日志表和各业务表：

```php
// database/migrations/create_tcc_transaction_logs_table.php
Schema::create('tcc_transaction_logs', function (Blueprint $table) {
    $table->id();
    $table->string('xid', 64)->comment('全局事务ID');
    $table->string('branch_id', 64)->comment('分支事务ID');
    $table->string('service', 50)->comment('服务名称');
    $table->string('method', 20)->comment('方法: try/confirm/cancel');
    $table->string('status', 20)->comment('状态: TRIED/CONFIRMED/ROLLBACKED');
    $table->boolean('is_empty_rollback')->default(false);
    $table->json('params')->nullable()->comment('业务参数');
    $table->timestamps();

    $table->unique(['xid', 'branch_id', 'method']);
    $table->index('xid');
    $table->index('status');
});
```

```php
// 库存表（含冻结字段）
Schema::create('inventories', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('product_id')->unique();
    $table->unsignedInteger('total_stock')->comment('总库存');
    $table->unsignedInteger('frozen_stock')->default(0)->comment('冻结库存');
    $table->timestamps();

    // 业务约束：冻结库存不能超过总库存
});
```

```php
// 用户余额表（含冻结字段）
Schema::create('user_balances', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id')->unique();
    $table->decimal('balance', 12, 2)->comment('总余额');
    $table->decimal('frozen_amount', 12, 2)->default(0)->comment('冻结金额');
    $table->timestamps();
});
```

```php
// 订单表
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->string('order_no', 64)->unique();
    $table->unsignedBigInteger('user_id');
    $table->unsignedBigInteger('product_id');
    $table->unsignedInteger('quantity');
    $table->decimal('total_amount', 12, 2);
    $table->string('status', 20)->default('PENDING'); // PENDING/CONFIRMED/CANCELLED
    $table->string('xid', 64)->comment('关联的全局事务ID');
    $table->timestamps();
});
```

### 4.2 定义 TCC 接口契约

```php
// app/Contracts/TccParticipantInterface.php
namespace App\Contracts;

interface TccParticipantInterface
{
    /**
     * Try 阶段：资源预留
     */
    public function try(string $xid, array $params): bool;

    /**
     * Confirm 阶段：确认提交
     */
    public function confirm(string $xid, array $params): bool;

    /**
     * Cancel 阶段：取消回滚
     */
    public function cancel(string $xid, array $params): bool;
}
```

### 4.3 库存服务实现

```php
// app/Services/Tcc/InventoryTccService.php
namespace App\Services\Tcc;

use App\Contracts\TccParticipantInterface;
use App\Enums\TccStatus;
use App\Models\Inventory;
use App\Models\TccTransactionLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class InventoryTccService implements TccParticipantInterface
{
    public function try(string $xid, array $params): bool
    {
        $productId = $params['product_id'];
        $quantity = $params['quantity'];

        // 悬挂防护
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        if ($log && $log->status === TccStatus::ROLLBACKED) {
            Log::warning("库存TCC悬挂防护: xid={$xid}");
            return false;
        }

        if ($log && $log->status === TccStatus::TRIED) {
            return true; // 幂等
        }

        return DB::transaction(function () use ($xid, $params, $productId, $quantity) {
            // 悲观锁查询库存
            $inventory = Inventory::where('product_id', $productId)
                ->lockForUpdate()
                ->firstOrFail();

            $availableStock = $inventory->total_stock - $inventory->frozen_stock;
            if ($availableStock < $quantity) {
                throw new \RuntimeException(
                    "库存不足: 需要{$quantity}, 可用{$availableStock}"
                );
            }

            // 冻结库存
            $inventory->increment('frozen_stock', $quantity);

            // 记录TCC日志
            TccTransactionLog::create([
                'xid' => $xid,
                'branch_id' => $params['branch_id'],
                'service' => 'inventory',
                'method' => 'try',
                'status' => TccStatus::TRIED,
                'params' => $params,
            ]);

            Log::info("库存Try成功: xid={$xid}, 产品={$productId}, 数量={$quantity}");
            return true;
        });
    }

    public function confirm(string $xid, array $params): bool
    {
        return DB::transaction(function () use ($xid, $params) {
            $log = TccTransactionLog::where('xid', $xid)
                ->where('branch_id', $params['branch_id'])
                ->lockForUpdate()
                ->first();

            if (!$log || $log->status !== TccStatus::TRIED) {
                if ($log && $log->status === TccStatus::CONFIRMED) {
                    return true; // 幂等
                }
                throw new \RuntimeException("无效的Confirm: xid={$xid}");
            }

            $inventory = Inventory::where('product_id', $params['product_id'])
                ->lockForUpdate()
                ->firstOrFail();

            // 将冻结库存转为真实扣减
            $inventory->decrement('total_stock', $params['quantity']);
            $inventory->decrement('frozen_stock', $params['quantity']);

            $log->update(['status' => TccStatus::CONFIRMED]);

            Log::info("库存Confirm成功: xid={$xid}");
            return true;
        });
    }

    public function cancel(string $xid, array $params): bool
    {
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        // 空回滚处理
        if (!$log || $log->status !== TccStatus::TRIED) {
            if (!$log) {
                TccTransactionLog::create([
                    'xid' => $xid,
                    'branch_id' => $params['branch_id'],
                    'service' => 'inventory',
                    'method' => 'cancel',
                    'status' => TccStatus::ROLLBACKED,
                    'is_empty_rollback' => true,
                    'params' => $params,
                ]);
                Log::warning("库存空回滚: xid={$xid}");
            }
            return true;
        }

        return DB::transaction(function () use ($xid, $params, $log) {
            $log->lockForUpdate();

            $inventory = Inventory::where('product_id', $params['product_id'])
                ->lockForUpdate()
                ->firstOrFail();

            // 释放冻结库存
            $inventory->decrement('frozen_stock', $params['quantity']);

            $log->update(['status' => TccStatus::ROLLBACKED]);

            Log::info("库存Cancel成功: xid={$xid}");
            return true;
        });
    }
}
```

### 4.4 支付服务实现

```php
// app/Services/Tcc/PaymentTccService.php
namespace App\Services\Tcc;

use App\Contracts\TccParticipantInterface;
use App\Enums\TccStatus;
use App\Models\UserBalance;
use App\Models\TccTransactionLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PaymentTccService implements TccParticipantInterface
{
    public function try(string $xid, array $params): bool
    {
        $userId = $params['user_id'];
        $amount = $params['amount'];

        // 悬挂防护
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        if ($log && $log->status === TccStatus::ROLLBACKED) {
            Log::warning("支付TCC悬挂防护: xid={$xid}");
            return false;
        }

        if ($log && $log->status === TccStatus::TRIED) {
            return true;
        }

        return DB::transaction(function () use ($xid, $params, $userId, $amount) {
            $balance = UserBalance::where('user_id', $userId)
                ->lockForUpdate()
                ->firstOrFail();

            $availableBalance = $balance->balance - $balance->frozen_amount;
            if (bccomp($availableBalance, $amount, 2) < 0) {
                throw new \RuntimeException(
                    "余额不足: 需要{$amount}, 可用{$availableBalance}"
                );
            }

            // 冻结余额
            $balance->increment('frozen_amount', $amount);

            TccTransactionLog::create([
                'xid' => $xid,
                'branch_id' => $params['branch_id'],
                'service' => 'payment',
                'method' => 'try',
                'status' => TccStatus::TRIED,
                'params' => $params,
            ]);

            Log::info("支付Try成功: xid={$xid}, 用户={$userId}, 金额={$amount}");
            return true;
        });
    }

    public function confirm(string $xid, array $params): bool
    {
        return DB::transaction(function () use ($xid, $params) {
            $log = TccTransactionLog::where('xid', $xid)
                ->where('branch_id', $params['branch_id'])
                ->lockForUpdate()
                ->first();

            if (!$log || $log->status !== TccStatus::TRIED) {
                if ($log && $log->status === TccStatus::CONFIRMED) {
                    return true;
                }
                throw new \RuntimeException("无效的支付Confirm: xid={$xid}");
            }

            $balance = UserBalance::where('user_id', $params['user_id'])
                ->lockForUpdate()
                ->firstOrFail();

            // 冻结金额转为真实扣减
            $balance->decrement('balance', $params['amount']);
            $balance->decrement('frozen_amount', $params['amount']);

            $log->update(['status' => TccStatus::CONFIRMED]);

            Log::info("支付Confirm成功: xid={$xid}");
            return true;
        });
    }

    public function cancel(string $xid, array $params): bool
    {
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        // 空回滚
        if (!$log || $log->status !== TccStatus::TRIED) {
            if (!$log) {
                TccTransactionLog::create([
                    'xid' => $xid,
                    'branch_id' => $params['branch_id'],
                    'service' => 'payment',
                    'method' => 'cancel',
                    'status' => TccStatus::ROLLBACKED,
                    'is_empty_rollback' => true,
                    'params' => $params,
                ]);
                Log::warning("支付空回滚: xid={$xid}");
            }
            return true;
        }

        return DB::transaction(function () use ($xid, $params, $log) {
            $log->lockForUpdate();

            $balance = UserBalance::where('user_id', $params['user_id'])
                ->lockForUpdate()
                ->firstOrFail();

            // 释放冻结金额
            $balance->decrement('frozen_amount', $params['amount']);

            $log->update(['status' => TccStatus::ROLLBACKED]);

            Log::info("支付Cancel成功: xid={$xid}");
            return true;
        });
    }
}
```

### 4.5 订单服务实现

```php
// app/Services/Tcc/OrderTccService.php
namespace App\Services\Tcc;

use App\Contracts\TccParticipantInterface;
use App\Enums\TccStatus;
use App\Models\Order;
use App\Models\TccTransactionLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrderTccService implements TccParticipantInterface
{
    public function try(string $xid, array $params): bool
    {
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        if ($log && $log->status === TccStatus::ROLLBACKED) {
            return false;
        }

        if ($log && $log->status === TccStatus::TRIED) {
            return true;
        }

        return DB::transaction(function () use ($xid, $params) {
            // 创建订单，状态为 PENDING
            Order::create([
                'order_no' => $params['order_no'],
                'user_id' => $params['user_id'],
                'product_id' => $params['product_id'],
                'quantity' => $params['quantity'],
                'total_amount' => $params['amount'],
                'status' => 'PENDING',
                'xid' => $xid,
            ]);

            TccTransactionLog::create([
                'xid' => $xid,
                'branch_id' => $params['branch_id'],
                'service' => 'order',
                'method' => 'try',
                'status' => TccStatus::TRIED,
                'params' => $params,
            ]);

            Log::info("订单Try成功: xid={$xid}, 订单号={$params['order_no']}");
            return true;
        });
    }

    public function confirm(string $xid, array $params): bool
    {
        return DB::transaction(function () use ($xid, $params) {
            $log = TccTransactionLog::where('xid', $xid)
                ->where('branch_id', $params['branch_id'])
                ->lockForUpdate()
                ->first();

            if (!$log || $log->status !== TccStatus::TRIED) {
                if ($log && $log->status === TccStatus::CONFIRMED) {
                    return true;
                }
                throw new \RuntimeException("无效的订单Confirm: xid={$xid}");
            }

            // 确认订单
            Order::where('xid', $xid)->update(['status' => 'CONFIRMED']);
            $log->update(['status' => TccStatus::CONFIRMED]);

            Log::info("订单Confirm成功: xid={$xid}");
            return true;
        });
    }

    public function cancel(string $xid, array $params): bool
    {
        $log = TccTransactionLog::where('xid', $xid)
            ->where('branch_id', $params['branch_id'])
            ->first();

        if (!$log || $log->status !== TccStatus::TRIED) {
            if (!$log) {
                TccTransactionLog::create([
                    'xid' => $xid,
                    'branch_id' => $params['branch_id'],
                    'service' => 'order',
                    'method' => 'cancel',
                    'status' => TccStatus::ROLLBACKED,
                    'is_empty_rollback' => true,
                    'params' => $params,
                ]);
            }
            return true;
        }

        return DB::transaction(function () use ($xid, $params, $log) {
            $log->lockForUpdate();

            Order::where('xid', $xid)->update(['status' => 'CANCELLED']);
            $log->update(['status' => TccStatus::ROLLBACKED]);

            Log::info("订单Cancel成功: xid={$xid}");
            return true;
        });
    }
}
```

### 4.6 TCC 协调者（事务管理器）

协调者是 TCC 模式的核心，负责编排所有参与者按序执行 Try/Confirm/Cancel：

```php
// app/Services/Tcc/TccCoordinator.php
namespace App\Services\Tcc;

use App\Contracts\TccParticipantInterface;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TccCoordinator
{
    private array $participants = [];

    /**
     * 注册参与者
     */
    public function registerParticipant(string $name, TccParticipantInterface $participant): self
    {
        $this->participants[$name] = $participant;
        return $this;
    }

    /**
     * 执行 TCC 事务
     */
    public function execute(array $tryParams): string
    {
        $xid = $this->generateXid();
        $triedParticipants = [];

        Log::info("TCC事务开始: xid={$xid}");

        try {
            // 阶段一：Try —— 依次执行所有参与者的 Try
            foreach ($this->participants as $name => $participant) {
                $params = $tryParams[$name] ?? [];
                $params['branch_id'] = $name . '_' . $xid;

                Log::info("TCC Try阶段: xid={$xid}, participant={$name}");

                $result = $participant->try($xid, $params);

                if (!$result) {
                    throw new \RuntimeException("Try 失败: {$name}");
                }

                $triedParticipants[] = [
                    'name' => $name,
                    'participant' => $participant,
                    'params' => $params,
                ];
            }

            // 阶段二：Confirm —— 所有 Try 成功后，依次 Confirm
            foreach ($triedParticipants as $tried) {
                Log::info("TCC Confirm阶段: xid={$xid}, participant={$tried['name']}");
                $tried['participant']->confirm($xid, $tried['params']);
            }

            Log::info("TCC事务完成: xid={$xid}");
            return $xid;

        } catch (\Exception $e) {
            Log::error("TCC事务异常: xid={$xid}, error={$e->getMessage()}");

            // 阶段三：Cancel —— 逆序回滚已 Try 的参与者
            foreach (array_reverse($triedParticipants) as $tried) {
                try {
                    Log::info("TCC Cancel阶段: xid={$xid}, participant={$tried['name']}");
                    $tried['participant']->cancel($xid, $tried['params']);
                } catch (\Exception $cancelException) {
                    // Cancel 失败需要告警，后续由定时任务重试
                    Log::critical("TCC Cancel失败，需要人工介入: xid={$xid}, "
                        . "participant={$tried['name']}, error={$cancelException->getMessage()}");
                }
            }

            throw $e;
        }
    }

    private function generateXid(): string
    {
        return 'TCC_' . date('YmdHis') . '_' . Str::random(16);
    }
}
```

### 4.7 业务编排层

在 Controller 或 Service 层调用协调者完成下单：

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Services\Tcc\TccCoordinator;
use App\Services\Tcc\OrderTccService;
use App\Services\Tcc\InventoryTccService;
use App\Services\Tcc\PaymentTccService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class OrderService
{
    public function __construct(
        private TccCoordinator $coordinator,
        private OrderTccService $orderTcc,
        private InventoryTccService $inventoryTcc,
        private PaymentTccService $paymentTcc,
    ) {}

    /**
     * 下单入口
     */
    public function placeOrder(int $userId, int $productId, int $quantity, float $amount): string
    {
        $orderNo = 'ORD' . date('YmdHis') . strtoupper(Str::random(6));

        // 注册参与者（注意顺序：先创建订单 → 扣库存 → 扣款）
        $this->coordinator
            ->registerParticipant('order', $this->orderTcc)
            ->registerParticipant('inventory', $this->inventoryTcc)
            ->registerParticipant('payment', $this->paymentTcc);

        // 执行 TCC 事务
        $xid = $this->coordinator->execute([
            'order' => [
                'order_no' => $orderNo,
                'user_id' => $userId,
                'product_id' => $productId,
                'quantity' => $quantity,
                'amount' => $amount,
            ],
            'inventory' => [
                'product_id' => $productId,
                'quantity' => $quantity,
            ],
            'payment' => [
                'user_id' => $userId,
                'amount' => $amount,
            ],
        ]);

        Log::info("下单成功: xid={$xid}, order_no={$orderNo}");
        return $orderNo;
    }
}
```

### 4.8 控制器入口

```php
// app/Http/Controllers/OrderController.php
namespace App\Http\Controllers;

use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function __construct(private OrderService $orderService) {}

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|integer',
            'product_id' => 'required|integer',
            'quantity' => 'required|integer|min:1',
            'amount' => 'required|numeric|min:0.01',
        ]);

        try {
            $orderNo = $this->orderService->placeOrder(
                $request->input('user_id'),
                $request->input('product_id'),
                $request->input('quantity'),
                $request->input('amount'),
            );

            return response()->json([
                'code' => 0,
                'message' => '下单成功',
                'data' => ['order_no' => $orderNo],
            ]);
        } catch (\RuntimeException $e) {
            return response()->json([
                'code' => 1,
                'message' => $e->getMessage(),
            ], 400);
        }
    }
}
```

---

## 五、使用 Laravel 队列实现异步 Confirm/Cancel

在生产环境中，同步执行 Confirm/Cancel 可能遇到服务抖动。我们可以利用 Laravel 队列实现异步重试机制，提升系统的容错能力。

### 5.1 定义 TCC 补偿任务

```php
// app/Jobs/TccConfirmJob.php
namespace App\Jobs;

use App\Enums\TccStatus;
use App\Models\TccTransactionLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class TccConfirmJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 10; // 重试间隔 10 秒

    public function __construct(
        private string $xid,
        private string $serviceName,
        private array $params,
    ) {}

    public function handle(): void
    {
        $log = TccTransactionLog::where('xid', $this->xid)
            ->where('branch_id', $this->params['branch_id'])
            ->first();

        // 幂等检查
        if ($log && $log->status === TccStatus::CONFIRMED) {
            Log::info("TCC Confirm已执行(幂等跳过): xid={$this->xid}");
            return;
        }

        $participant = app()->make($this->getServiceClass());
        $participant->confirm($this->xid, $this->params);

        Log::info("TCC异步Confirm成功: xid={$this->xid}, service={$this->serviceName}");
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical("TCC Confirm最终失败，需人工介入: xid={$this->xid}, "
            . "service={$this->serviceName}, error={$exception->getMessage()}");

        // 发送告警通知
        // Notification::send(...);
    }

    private function getServiceClass(): string
    {
        return match ($this->serviceName) {
            'order' => \App\Services\Tcc\OrderTccService::class,
            'inventory' => \App\Services\Tcc\InventoryTccService::class,
            'payment' => \App\Services\Tcc\PaymentTccService::class,
            default => throw new \InvalidArgumentException("Unknown service: {$this->serviceName}"),
        };
    }
}
```

```php
// app/Jobs/TccCancelJob.php
namespace App\Jobs;

use App\Enums\TccStatus;
use App\Models\TccTransactionLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class TccCancelJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 10;

    public function __construct(
        private string $xid,
        private string $serviceName,
        private array $params,
    ) {}

    public function handle(): void
    {
        $participant = app()->make($this->getServiceClass());
        $participant->cancel($this->xid, $this->params);

        Log::info("TCC异步Cancel成功: xid={$this->xid}, service={$this->serviceName}");
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical("TCC Cancel最终失败，需人工介入: xid={$this->xid}, "
            . "service={$this->serviceName}, error={$exception->getMessage()}");
    }

    private function getServiceClass(): string
    {
        return match ($this->serviceName) {
            'order' => \App\Services\Tcc\OrderTccService::class,
            'inventory' => \App\Services\Tcc\InventoryTccService::class,
            'payment' => \App\Services\Tcc\PaymentTccService::class,
            default => throw new \InvalidArgumentException("Unknown service: {$this->serviceName}"),
        };
    }
}
```

### 5.2 协调者中使用队列

修改协调者的 Cancel 逻辑，使用队列异步执行：

```php
// 在 TccCoordinator 的 catch 块中
catch (\Exception $e) {
    Log::error("TCC事务异常，异步Cancel: xid={$xid}");

    foreach (array_reverse($triedParticipants) as $tried) {
        TccCancelJob::dispatch($xid, $tried['name'], $tried['params'])
            ->onQueue('tcc-compensation')
            ->delay(now()->addSeconds(5)); // 延迟 5 秒执行
    }

    throw $e;
}
```

### 5.3 定时任务兜底

除了队列重试，还需要一个定时任务扫描超时未完成的事务，作为最终兜底：

```php
// app/Console/Commands/TccTimeoutCompensateCommand.php
namespace App\Console\Commands;

use App\Enums\TccStatus;
use App\Jobs\TccCancelJob;
use App\Models\TccTransactionLog;
use Illuminate\Console\Command;

class TccTimeoutCompensateCommand extends Command
{
    protected $signature = 'tcc:timeout-compensate';
    protected $description = '扫描超时的TCC事务并触发补偿';

    public function handle(): int
    {
        // 扫描超过 60 秒仍处于 TRIED 状态的事务
        $timeoutLogs = TccTransactionLog::where('status', TccStatus::TRIED)
            ->where('created_at', '<', now()->subSeconds(60))
            ->get();

        $this->info("发现 {$timeoutLogs->count()} 条超时事务");

        foreach ($timeoutLogs as $log) {
            $this->warn("补偿事务: xid={$log->xid}, branch={$log->branch_id}");

            TccCancelJob::dispatch(
                $log->xid,
                $log->service,
                $log->params ?? []
            )->onQueue('tcc-compensation');
        }

        return self::SUCCESS;
    }
}
```

在 Kernel 中注册定时任务：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('tcc:timeout-compensate')->everyTenSeconds();
}
```

---

## 六、异常处理与补偿机制

### 6.1 完整异常处理策略

TCC 模式下的异常处理需要分层考虑：

```php
// app/Exceptions/TccExceptionHandler.php
namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class TccExceptionHandler
{
    /**
     * 分层异常处理策略
     */
    public static function handle(\Throwable $e, string $xid, string $phase): JsonResponse
    {
        match (true) {
            // 业务异常（余额不足、库存不足等）——直接返回，不需要重试
            $e instanceof TccBusinessException => Log::warning(
                "TCC业务异常: xid={$xid}, phase={$phase}, msg={$e->getMessage()}"
            ),

            // 网络超时 —— 可重试，由队列保证最终一致性
            $e instanceof \Illuminate\Http\Client\ConnectionException => Log::error(
                "TCC网络异常: xid={$xid}, phase={$phase}，将异步重试"
            ),

            // 数据库死锁 —— 重试
            $e instanceof \Illuminate\Database\QueryException => Log::error(
                "TCC数据库异常: xid={$xid}, phase={$phase}, code={$e->getCode()}"
            ),

            // 未知异常 —— 告警 + 人工介入
            default => Log::critical(
                "TCC未知异常: xid={$xid}, phase={$phase}", [
                    'exception' => $e,
                    'trace' => $e->getTraceAsString(),
                ]
            ),
        };

        return response()->json([
            'code' => 1,
            'message' => $e instanceof TccBusinessException
                ? $e->getMessage()
                : '系统繁忙，请稍后重试',
        ], $e instanceof TccBusinessException ? 400 : 500);
    }
}
```

### 6.2 补偿日志与监控

建议在 `TccTransactionLog` 模型上封装监控方法：

```php
// app/Models/TccTransactionLog.php
class TccTransactionLog extends Model
{
    /**
     * 获取需要补偿的事务列表
     */
    public static function getPendingCompensations(int $timeoutSeconds = 60): \Illuminate\Database\Eloquent\Collection
    {
        return static::where('status', TccStatus::TRIED)
            ->where('created_at', '<', now()->subSeconds($timeoutSeconds))
            ->get();
    }

    /**
     * 获取异常事务统计
     */
    public static function getExceptionStats(): array
    {
        return [
            'pending' => static::where('status', TccStatus::TRIED)
                ->where('created_at', '<', now()->subSeconds(60))
                ->count(),
            'empty_rollback' => static::where('is_empty_rollback', true)->count(),
            'failed_confirm' => static::where('method', 'confirm')
                ->where('status', '!=', TccStatus::CONFIRMED)
                ->count(),
        ];
    }
}
```

---

## 七、生产环境踩坑与最佳实践

### 7.1 踩坑记录

**坑 1：数据库连接超时导致事务不一致**

在 Try 阶段执行了数据库操作但还没来得及写 TCC 日志时，数据库连接断开。导致资源已预留但日志未记录，Cancel 时触发空回滚，资源永远冻结。

**解决**：TCC 日志的写入必须和业务操作在同一个本地事务中：

```php
DB::transaction(function () use ($params) {
    $this->doTry($params);                    // 业务操作
    TccTransactionLog::create([...]);          // 日志写入（同一事务）
});
```

**坑 2：Confirm 阶段数据库乐观锁冲突**

并发场景下，Confirm 和定时补偿任务可能同时触发，导致乐观锁版本冲突。

**解决**：使用悲观锁（`lockForUpdate`）+ 幂等状态检查：

```php
$log = TccTransactionLog::where('xid', $xid)->lockForUpdate()->first();
if ($log->status !== TccStatus::TRIED) {
    return true; // 已处理，幂等返回
}
```

**坑 3：跨服务调用超时设置不当**

Try 阶段 HTTP 调用超时设置太短（如 1 秒），导致下游已成功但上游判定失败，触发 Cancel。下游资源被错误回滚。

**解决**：超时时间要大于下游服务的最大响应时间，并设置合理重试：

```php
Http::timeout(10)          // 10 秒超时
    ->retry(3, 1000)        // 重试 3 次，间隔 1 秒
    ->post($url, $params);
```

**坑 4：冻结资源长期不释放**

某些异常场景下，冻结的资源没有被释放，长期累积导致可用资源为零。

**解决**：为冻结记录增加过期时间，定时任务扫描过期冻结并释放：

```php
// 定时释放超过 30 分钟的冻结资源
$expiredLogs = TccTransactionLog::where('status', TccStatus::TRIED)
    ->where('created_at', '<', now()->subMinutes(30))
    ->get();

foreach ($expiredLogs as $log) {
    TccCancelJob::dispatch($log->xid, $log->service, $log->params ?? []);
}
```

### 7.2 最佳实践清单

1. **TCC 日志与业务操作同事务**：确保不会出现"业务成功但日志丢失"的情况。

2. **所有 Confirm/Cancel 必须幂等**：这是铁律。任何违反幂等的操作都会在重试时造成数据错乱。

3. **Cancel 必须处理空回滚，Try 必须防悬挂**：这是一对互相配合的防护机制。

4. **冻结字段要有数据库约束**：`CHECK (frozen_stock >= 0)`、`CHECK (frozen_amount >= 0)`，防止程序 bug 导致负数。

5. **合理设置超时和重试策略**：Try 的 HTTP 调用超时要足够长，Cancel 的队列重试要指数退避。

6. **监控告警必不可少**：对超时未完成的事务、Cancel 失败的事务、空回滚频繁出现的情况都要告警。

7. **做好压力测试**：TCC 涉及的锁竞争比普通操作更多，必须在生产负载下测试性能表现。

8. **考虑服务降级**：当下游服务不可用时，TCC 整体失败。考虑在 Try 阶段对非核心服务做降级处理（如库存为本地服务可以同步，支付为外部服务可以异步）。

9. **事务日志定期归档**：TCC 日志表会快速增长，建议定期归档到历史表，保持主表查询性能。

10. **使用唯一索引防并发**：`UNIQUE(xid, branch_id, method)` 可以从数据库层面防止并发写入冲突。

---

## 八、总结与架构图描述

### 8.1 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                     API Gateway / Controller              │
│                          │                                │
│                          ▼                                │
│                   TccCoordinator (协调者)                   │
│                    │           │           │              │
│            ┌──────┘           │           └──────┐       │
│            ▼                  ▼                  ▼       │
│   ┌─────────────┐   ┌──────────────┐   ┌──────────────┐ │
│   │ 订单服务     │   │ 库存服务      │   │ 支付服务      │ │
│   │             │   │              │   │              │ │
│   │ Try: 冻结订单│   │ Try: 冻结库存 │   │ Try: 冻结余额 │ │
│   │ Confirm: 确认│   │ Confirm: 扣减 │   │ Confirm: 扣款 │ │
│   │ Cancel: 取消 │   │ Cancel: 释放  │   │ Cancel: 解冻  │ │
│   └──────┬──────┘   └──────┬───────┘   └──────┬───────┘ │
│          │                 │                  │          │
│          ▼                 ▼                  ▼          │
│   ┌─────────────────────────────────────────────────┐   │
│   │            TCC Transaction Log (事务日志)          │   │
│   │        xid | branch_id | status | params         │   │
│   └──────────────────────┬──────────────────────────┘   │
│                          │                               │
│          ┌───────────────┼───────────────┐              │
│          ▼               ▼               ▼              │
│   ┌──────────┐   ┌──────────┐   ┌──────────────┐       │
│   │ 订单DB    │   │ 库存DB    │   │ 用户余额DB    │       │
│   └──────────┘   └──────────┘   └──────────────┘       │
└──────────────────────────────────────────────────────────┘

                     异步补偿层
┌──────────────────────────────────────────────────────────┐
│   ┌──────────────────────────────────────────────────┐  │
│   │              Laravel Queue (Redis)                │  │
│   │    TccConfirmJob / TccCancelJob (tcc-compensation)│  │
│   └──────────────────────────────────────────────────┘  │
│                          │                               │
│   ┌──────────────────────────────────────────────────┐  │
│   │        定时任务: tcc:timeout-compensate            │  │
│   │        每 10 秒扫描超时 TRIED 状态的事务            │  │
│   └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 8.2 一次完整下单流程

```
1. 用户请求下单
2. 协调者生成全局事务ID (xid)
3. Try 阶段（同步）:
   a. 订单服务 Try → 创建 PENDING 订单 ✓
   b. 库存服务 Try → 冻结库存 ✓
   c. 支付服务 Try → 冻结余额 ✓
4. Confirm 阶段（同步或异步）:
   a. 订单服务 Confirm → 订单状态改为 CONFIRMED ✓
   b. 库存服务 Confirm → 冻结库存转为真实扣减 ✓
   c. 支付服务 Confirm → 冻结金额转为真实扣款 ✓
5. 返回下单成功
```

如果步骤 3c 支付 Try 失败（余额不足）：

```
3. Try 阶段:
   a. 订单服务 Try → 创建 PENDING 订单 ✓
   b. 库存服务 Try → 冻结库存 ✓
   c. 支付服务 Try → 余额不足 ✗ (抛出异常)
4. Cancel 阶段（逆序回滚）:
   a. 库存服务 Cancel → 释放冻结库存 ✓
   b. 订单服务 Cancel → 订单状态改为 CANCELLED ✓
5. 返回下单失败
```

### 8.3 核心要点回顾

| 要点 | 说明 |
|------|------|
| **资源预留** | Try 不执行真正的业务，只冻结/预留资源 |
| **同事务写日志** | 业务操作和 TCC 日志必须在同一本地事务中 |
| **空回滚防护** | Cancel 前检查 Try 是否执行过 |
| **悬挂防护** | Try 前检查 Cancel 是否已执行 |
| **幂等保证** | Confirm/Cancel 必须支持重复调用 |
| **异步补偿** | 队列 + 定时任务双保险 |
| **告警监控** | 超时事务、失败事务必须及时告警 |

### 8.4 TCC 适用场景总结

TCC 模式虽然实现复杂，但在以下场景中是最佳选择：

- **电商下单**：订单 + 库存 + 支付的原子性保证
- **金融转账**：A 账户扣款 + B 账户入账的一致性
- **票务系统**：选座 + 锁票 + 支付的事务一致性
- **优惠券核销**：领取 + 使用 + 扣减库存的原子操作

如果你的业务场景对一致性要求不高，或者事务周期较长（分钟级以上），Saga 模式可能是更好的选择。如果只需要数据库层面的事务，可以直接使用 2PC/XA。

---

**总结**：TCC 是分布式事务方案中一致性保障最强的柔性事务模式，但也是实现复杂度最高的。在 Laravel 中落地 TCC，关键在于做好事务日志的管理、空回滚/悬挂/幂等的三重防护，以及异步补偿机制。希望本文的完整代码示例和踩坑经验能帮助你在实际项目中顺利完成 TCC 的落地。

## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/架构/Saga-编排模式深度实战-Choreography-vs-Orchestration-vs-Temporal-Laravel分布式事务三种实现路线对比/)
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/categories/架构/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/)
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd——PHP 开发者的分布式互斥选型](/categories/架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/)
