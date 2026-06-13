---
title: 盲盒抽奖业务-概率算法与合规设计-B2C电商公平性验证踩坑记录
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
date: 2026-05-05 08:55:36
updated: 2026-05-05 09:01:09
categories:
  - misc
tags: [KKday, Laravel, PHP, 安全]
keywords: [B2C, 盲盒抽奖业务, 概率算法与合规设计, 电商公平性验证踩坑记录, 技术杂谈]
description: 在 B2C 电商中，盲盒与抽奖是提升用户活跃度的核心玩法，但看似简单的随机出结果背后涉及复杂的概率算法设计、防作弊验证与法律合规要求。本文从加权随机算法、概率池动态归一化、蓄水池抽样三大概率模型出发，深入讲解 Provably Fair 可验证随机性、链式哈希审计日志等公平性验证方案，并结合《规范促销行为暂行规定》《反不正当竞争法》等法规，分享概率公示、奖品价值上限、未成年人保护等合规设计要点，附带高并发超卖、缓存不一致、伪随机可预测性等真实踩坑记录与完整测试策略。



---

# 盲盒/抽奖业务：概率算法与合规设计

## 为什么写这篇文章？

盲盒和抽奖机制已经成为 B2C 电商的标配——从每日签到抽奖、新人礼包、到商品盲盒，几乎每个电商平台都有类似玩法。但这个看似简单的「随机出结果」背后，涉及的概率算法设计、防作弊验证、法律合规要求，远比大多数开发者想象的复杂。

在参与多个电商项目后，我踩了不少坑：概率加起来不是 100% 导致奖品永远抽不到、用 `rand()` 生成随机数被安全审计打回、概率不公示被监管点名……这篇文章把这些真实经验整理出来，希望能帮到做类似业务的同学。

## 一、整体架构

```
┌─────────────────────────────────────────────────┐
│                    客户端 (App/H5)                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 抽奖页面  │  │ 概率公示  │  │ 中奖记录/晒单 │  │
│  └─────┬────┘  └──────────┘  └───────────────┘  │
└────────┼─────────────────────────────────────────┘
         │ API 请求
         ▼
┌─────────────────────────────────────────────────┐
│              BFF 层 (Laravel API)                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 抽奖服务  │  │ 概率引擎  │  │ 合规校验服务  │  │
│  └─────┬────┘  └─────┬────┘  └───────┬───────┘  │
└────────┼─────────────┼───────────────┼───────────┘
         │             │               │
         ▼             ▼               ▼
┌─────────────────────────────────────────────────┐
│                   数据层                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ MySQL    │  │ Redis    │  │ 审计日志存储   │  │
│  │ 奖品配置  │  │ 限流/缓存 │  │ 不可篡改记录  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────┘
```

## 二、概率算法设计

### 2.1 基础：加权随机算法

最常用的概率算法是**加权随机**（Weighted Random Selection）。核心思路：每个奖品有一个权重值，随机数落在哪个权重区间，就命中哪个奖品。

```php
<?php

namespace App\Services\Lottery;

class WeightedRandom
{
    /**
     * 加权随机选取
     *
     * @param array<int, array{name: string, weight: int, prize_id: int}> $items
     *   每项包含 name, weight(权重), prize_id
     * @return array 选中的奖品
     * @throws \InvalidArgumentException
     */
    public static function draw(array $items): array
    {
        if (empty($items)) {
            throw new \InvalidArgumentException('奖品列表不能为空');
        }

        // 计算总权重
        $totalWeight = array_sum(array_column($items, 'weight'));

        if ($totalWeight <= 0) {
            throw new \InvalidArgumentException('总权重必须大于 0');
        }

        // 生成 [1, totalWeight] 范围内的安全随机整数
        $random = random_int(1, $totalWeight);

        // 累加权重，找到命中的奖品
        $cumulative = 0;
        foreach ($items as $item) {
            $cumulative += $item['weight'];
            if ($random <= $cumulative) {
                return $item;
            }
        }

        // 理论上不会走到这里，兜底返回最后一项
        return end($items);
    }
}
```

**踩坑 #1：用 `rand()` 还是 `random_int()`？**

早期我用 `rand()` 生成随机数，被安全审计团队打回来了。`rand()` 使用的伪随机数生成器（PRNG）是可预测的——如果攻击者知道种子值，就能推算出每次抽奖结果。

PHP 7+ 提供的 `random_int()` 底层调用操作系统的密码学安全随机源（Linux 的 `/dev/urandom`，Windows 的 `CryptGenRandom`），**不可预测、不可重现**。在任何涉及金钱或奖品的场景，必须用 `random_int()`。

```php
// ❌ 错误：可预测
$random = rand(1, $totalWeight);

// ✅ 正确：密码学安全
$random = random_int(1, $totalWeight);
```

### 2.2 进阶：概率池 + 库存联动

真实业务中，奖品有库存限制。S 级大奖只有 1 个，抽完就没了。需要在概率计算时动态排除库存为 0 的奖品，并重新归一化概率。

```php
<?php

namespace App\Services\Lottery;

use App\Models\Prize;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LotteryEngine
{
    private const CACHE_KEY_POOL = 'lottery:pool:{campaign_id}';
    private const CACHE_TTL = 60; // 秒

    /**
     * 执行一次抽奖
     */
    public function draw(int $campaignId, int $userId): ?array
    {
        // 1. 获取当前可用奖品池（带库存）
        $pool = $this->getAvailablePool($campaignId);

        if (empty($pool)) {
            return null; // 奖品池为空
        }

        // 2. 加权随机抽取
        $selected = WeightedRandom::draw($pool);

        // 3. 原子扣减库存（防超卖）
        $deducted = $this->deductInventory($selected['prize_id']);

        if (!$deducted) {
            // 库存竞争失败，递归重试（限制次数防死循环）
            return $this->retryDraw($campaignId, $userId, retries: 3);
        }

        // 4. 记录中奖结果
        return $this->recordWin($campaignId, $userId, $selected);
    }

    /**
     * 获取可用奖品池，排除库存为 0 的奖品
     */
    private function getAvailablePool(int $campaignId): array
    {
        $cacheKey = str_replace('{campaign_id}', $campaignId, self::CACHE_KEY_POOL);

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($campaignId) {
            return Prize::query()
                ->where('campaign_id', $campaignId)
                ->where('remaining_stock', '>', 0)
                ->where('is_active', true)
                ->select(['prize_id', 'name', 'weight', 'remaining_stock', 'level'])
                ->get()
                ->toArray();
        });
    }

    /**
     * 原子扣减库存，用 UPDATE ... WHERE remaining_stock > 0 防超卖
     */
    private function deductInventory(int $prizeId): bool
    {
        $affected = DB::table('prizes')
            ->where('prize_id', $prizeId)
            ->where('remaining_stock', '>', 0)
            ->decrement('remaining_stock', 1);

        return $affected > 0;
    }

    private function retryDraw(int $campaignId, int $userId, int $retries): ?array
    {
        if ($retries <= 0) {
            return null;
        }

        // 刷新缓存，确保拿到最新库存
        $cacheKey = str_replace('{campaign_id}', $campaignId, self::CACHE_KEY_POOL);
        Cache::forget($cacheKey);

        return $this->draw($campaignId, $userId);
    }

    private function recordWin(int $campaignId, int $userId, array $prize): array
    {
        // 写入中奖记录 + 清除奖品池缓存
        DB::table('lottery_records')->insert([
            'campaign_id' => $campaignId,
            'user_id'     => $userId,
            'prize_id'    => $prize['prize_id'],
            'prize_name'  => $prize['name'],
            'prize_level' => $prize['level'],
            'created_at'  => now(),
        ]);

        // 清除缓存，让下次请求拿到最新库存
        $cacheKey = str_replace('{campaign_id}', $campaignId, self::CACHE_KEY_POOL);
        Cache::forget($cacheKey);

        return $prize;
    }
}
```

**踩坑 #2：概率归一化问题**

当某个奖品库存清零后，剩余奖品的概率之和不再等于 100%。例如：

| 奖品 | 权重 | 库存 |
|------|------|------|
| S 级手机 | 1 | 0（已抽完） |
| A 级耳机 | 10 | 50 |
| B 级优惠券 | 89 | 999 |

如果不过滤库存为 0 的奖品，总权重 = 100，但 S 级的 1% 概率会命中一个不存在的奖品。**必须在计算前过滤，让剩余奖品的权重重新归一化**。

### 2.3 高级：蓄水池抽样（Reservoir Sampling）

当奖品数量非常大（比如百万级优惠券池），不适合一次性加载到内存。此时可以用蓄水池抽样算法：

```php
/**
 * 蓄水池抽样：从流式数据中等概率选取 K 个元素
 * 适用于奖品池过大无法一次加载的场景
 */
class ReservoirSampling
{
    public static function sample(\Generator $stream, int $k): array
    {
        $reservoir = [];
        $i = 0;

        foreach ($stream as $item) {
            if ($i < $k) {
                $reservoir[$i] = $item;
            } else {
                // 以 k/i 的概率替换蓄水池中的元素
                $j = random_int(0, $i);
                if ($j < $k) {
                    $reservoir[$j] = $item;
                }
            }
            $i++;
        }

        return $reservoir;
    }
}
```

## 三、公平性验证：让用户（和监管）信服

### 3.1 可验证随机性（Provably Fair）

区块链领域常用的 Provably Fair 机制，可以应用到电商抽奖中。核心思路：

1. 服务端生成一个 **Server Seed**（密钥）
2. 客户端生成一个 **Client Seed**（用户输入或自动）
3. 抽奖结果 = Hash(Server Seed + Client Seed + Nonce)
4. 抽奖后，公开 Server Seed，任何人都可以验证结果

```php
<?php

namespace App\Services\Lottery;

class ProvablyFair
{
    /**
     * 生成可验证的抽奖结果
     */
    public static function generateResult(
        string $serverSeed,
        string $clientSeed,
        int $nonce
    ): int {
        // 组合种子
        $combined = sprintf('%s:%s:%d', $serverSeed, $clientSeed, $nonce);

        // HMAC-SHA256 生成确定性哈希
        $hash = hash_hmac('sha256', $combined, $serverSeed);

        // 取前 8 字节，转为整数
        $hexSubstring = substr($hash, 0, 8);
        $intValue = hexdec($hexSubstring);

        // 映射到 [0, PHP_INT_MAX] 范围
        return $intValue;
    }

    /**
     * 验证一次抽奖结果是否被篡改
     */
    public static function verify(
        string $serverSeed,     // 抽奖后公开的 Server Seed
        string $clientSeed,     // 用户当时提交的 Client Seed
        int $nonce,             // 递增计数器
        int $claimedResult      // 声称的抽奖结果
    ): bool {
        $actualResult = self::generateResult($serverSeed, $clientSeed, $nonce);
        return $actualResult === $claimedResult;
    }

    /**
     * 生成 Server Seed（抽奖前哈希后公开，原始值保密）
     */
    public static function generateServerSeed(): array
    {
        $seed = bin2hex(random_bytes(32)); // 64 字符十六进制
        $hash = hash('sha256', $seed);     // 公开的哈希值

        return [
            'seed' => $seed,     // 抽奖后才公开
            'hash' => $hash,     // 抽奖前就公开（承诺）
        ];
    }
}
```

**架构图：可验证抽奖流程**

```
抽奖前                    抽奖中                    抽奖后
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ 服务端:       │      │ 服务端:       │      │ 服务端:       │
│ 生成 Seed    │      │ Hash(Seed +  │      │ 公开 Seed    │
│ 公开 Hash    │─────▶│ Client +     │─────▶│ 用户可验证   │
│ (承诺)       │      │ Nonce)       │      │ 结果未篡改   │
└──────────────┘      └──────┬───────┘      └──────────────┘
                             │
┌──────────────┐             │
│ 客户端:       │             │
│ 提交 Client  │─────────────┘
│ Seed         │
└──────────────┘
```

### 3.2 审计日志：不可篡改的抽奖记录

合规要求所有抽奖记录必须可追溯、不可篡改。实现方式：

```php
<?php

namespace App\Services\Lottery;

use Illuminate\Support\Facades\DB;

class AuditLogger
{
    /**
     * 记录抽奖审计日志（带链式哈希防篡改）
     */
    public static function log(array $data): void
    {
        // 获取上一条日志的哈希
        $lastHash = DB::table('lottery_audit_logs')
            ->orderBy('id', 'desc')
            ->value('content_hash') ?? 'genesis';

        // 当前记录内容
        $content = json_encode($data, JSON_UNESCAPED_UNICODE);

        // 链式哈希：当前哈希 = Hash(上一条哈希 + 当前内容)
        $contentHash = hash('sha256', $lastHash . $content);

        DB::table('lottery_audit_logs')->insert([
            'campaign_id'   => $data['campaign_id'],
            'user_id'       => $data['user_id'],
            'action'        => $data['action'], // draw/win/verify
            'content'       => $content,
            'content_hash'  => $contentHash,
            'prev_hash'     => $lastHash,
            'ip_address'    => $data['ip'] ?? null,
            'user_agent'    => $data['user_agent'] ?? null,
            'created_at'    => now(),
        ]);
    }

    /**
     * 验证审计日志链完整性
     */
    public static function verifyChain(int $campaignId): bool
    {
        $logs = DB::table('lottery_audit_logs')
            ->where('campaign_id', $campaignId)
            ->orderBy('id')
            ->get();

        $prevHash = 'genesis';

        foreach ($logs as $log) {
            $expectedHash = hash('sha256', $prevHash . $log->content);

            if ($expectedHash !== $log->content_hash) {
                return false; // 日志被篡改
            }

            $prevHash = $log->content_hash;
        }

        return true;
    }
}
```

## 四、合规设计：法律红线不能碰

### 4.1 概率公示（必须）

中国《规范促销行为暂行规定》（2020 年）明确要求：**抽奖式有奖销售必须公示奖品名称、奖品数量、中奖概率**。

```php
<?php

namespace App\Services\Lottery;

class ProbabilityDisclosure
{
    /**
     * 生成概率公示数据（对外 API 使用）
     */
    public static function getDisclosure(int $campaignId): array
    {
        $prizes = \App\Models\Prize::where('campaign_id', $campaignId)
            ->where('is_active', true)
            ->select(['name', 'weight', 'total_stock', 'level'])
            ->get();

        $totalWeight = $prizes->sum('weight');

        return [
            'campaign_id'  => $campaignId,
            'total_weight' => $totalWeight,
            'prizes'       => $prizes->map(function ($prize) use ($totalWeight) {
                return [
                    'name'        => $prize->name,
                    'level'       => $prize->level,
                    'probability' => round($prize->weight / $totalWeight, 6),
                    'stock'       => $prize->total_stock,
                ];
            })->toArray(),
            'disclaimer'   => '以上概率为理论概率，实际中奖概率随库存变化可能略有浮动。',
        ];
    }
}
```

**踩坑 #3：概率公示 ≠ 实际概率**

这是一个合规陷阱。如果 S 级大奖只有 1 个，理论概率 0.01%，但被抽完后实际概率变为 0%。监管部门看的是**初始概率**，但用户感知的是**实时概率**。解决方案：

- 公示时注明「理论概率，实际随库存变化」
- 在前端实时显示当前可用奖品的概率
- 保留历史概率快照，供审计使用

### 4.2 参与限制

```php
<?php

namespace App\Services\Lottery\Rules;

use App\Models\User;

class ParticipationRules
{
    /**
     * 检查用户是否满足参与条件
     */
    public static function validate(int $userId, int $campaignId): array
    {
        $errors = [];
        $user = User::find($userId);

        // 规则 1: 年龄验证（未成年人保护）
        if ($user->birthday && $user->birthday->diffInYears(now()) < 18) {
            $errors[] = '未成年人不可参与抽奖活动';
        }

        // 规则 2: 每日参与次数限制
        $todayCount = \DB::table('lottery_records')
            ->where('user_id', $userId)
            ->where('campaign_id', $campaignId)
            ->whereDate('created_at', today())
            ->count();

        $maxDaily = \DB::table('lottery_campaigns')
            ->where('campaign_id', $campaignId)
            ->value('max_daily_draws') ?? 10;

        if ($todayCount >= $maxDaily) {
            $errors[] = "今日已参与 {$todayCount} 次，达到上限 {$maxDaily} 次";
        }

        // 规则 3: 实名认证检查（高价值奖品）
        if (!$user->is_verified) {
            $errors[] = '请先完成实名认证';
        }

        return $errors;
    }
}
```

### 4.3 奖品价值合规

根据《反不正当竞争法》，抽奖式有奖销售的最高奖品价值**不得超过五万元**。

```php
// 在奖品配置时校验
class PrizeValidator
{
    private const MAX_PRIZE_VALUE = 50000; // 5 万元

    public static function validate(array $prizeData): void
    {
        if ($prizeData['market_value'] > self::MAX_PRIZE_VALUE) {
            throw new \DomainException(
                "奖品价值 {$prizeData['market_value']} 超过法定上限 " . self::MAX_PRIZE_VALUE
            );
        }
    }
}
```

## 五、踩坑记录汇总

### 坑 1：高并发下的超卖问题

**现象**：活动高峰期，S 级大奖库存只有 1 个，但被抽出了 3 个。

**根因**：用 `SELECT + UPDATE` 两步操作扣减库存，存在竞态条件。

**解决**：用 `UPDATE ... WHERE remaining_stock > 0` 原子操作，通过 `affected_rows` 判断是否扣减成功。

```php
// ❌ 竞态条件
$prize = Prize::find($prizeId);
if ($prize->remaining_stock > 0) {
    $prize->decrement('remaining_stock'); // 另一个请求可能已经扣减了
}

// ✅ 原子操作
$affected = DB::table('prizes')
    ->where('prize_id', $prizeId)
    ->where('remaining_stock', '>', 0)
    ->decrement('remaining_stock', 1);
```

### 坑 2：缓存与数据库不一致

**现象**：库存已扣减，但缓存中的奖品池还包含该奖品，导致重复抽取已售罄奖品。

**解决**：扣减库存后立即清除缓存，或使用 Redis Lua 脚本保证原子性。

```php
// Redis Lua 脚本：原子检查 + 扣减
$lua = <<<'LUA'
    local stock = redis.call('HGET', KEYS[1], 'stock')
    if tonumber(stock) > 0 then
        redis.call('HINCRBY', KEYS[1], 'stock', -1)
        return 1
    end
    return 0
LUA;

$result = Redis::eval($lua, 1, "lottery:prize:{$prizeId}");
```

### 坑 3：伪随机的可预测性

**现象**：安全审计发现 `mt_rand()` 使用 Mersenne Twister 算法，通过观察 624 个连续输出可以完全预测后续所有输出。

**解决**：所有涉及奖品/金钱的随机数生成，必须使用 `random_int()` 或 `random_bytes()`。

### 坑 4：概率公示后被「算命」

**现象**：公示概率后，有用户发现「连续 100 次没中 S 级，说明概率造假」。

**根因**：用户不理解概率的独立性。0.01% 的概率连续 100 次不中是正常的（概率 ≈ 99%）。

**解决**：
- 在公示页面加「概率说明」，解释独立事件
- 提供「中奖概率计算器」，让用户输入次数查看理论中奖率
- 保留完整的抽奖日志，供监管部门核查

### 坑 5：奖品池动态配置导致概率漂移

**现象**：运营在后台修改了某个奖品的权重，但没有同步更新概率公示页面。

**解决**：
- 概率公示数据从同一数据源生成，不缓存
- 后台修改权重后，自动触发概率公示页面更新
- 记录每次权重变更的操作日志（who/when/old/new）

## 六、测试策略

```php
<?php

namespace Tests\Unit\Services\Lottery;

use Tests\TestCase;
use App\Services\Lottery\WeightedRandom;

class WeightedRandomTest extends TestCase
{
    /** @test */
    public function it_respects_weight_distribution(): void
    {
        $items = [
            ['name' => 'S', 'weight' => 1, 'prize_id' => 1],
            ['name' => 'A', 'weight' => 10, 'prize_id' => 2],
            ['name' => 'B', 'weight' => 89, 'prize_id' => 3],
        ];

        $results = ['S' => 0, 'A' => 0, 'B' => 0];
        $total = 100000;

        for ($i = 0; $i < $total; $i++) {
            $result = WeightedRandom::draw($items);
            $results[$result['name']]++;
        }

        // 允许 1% 的偏差
        $this->assertEqualsWithDelta(1.0, $results['S'] / $total * 100, 0.5);
        $this->assertEqualsWithDelta(10.0, $results['A'] / $total * 100, 1.0);
        $this->assertEqualsWithDelta(89.0, $results['B'] / $total * 100, 1.5);
    }

    /** @test */
    public function it_throws_on_empty_items(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        WeightedRandom::draw([]);
    }

    /** @test */
    public function it_throws_on_zero_total_weight(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        WeightedRandom::draw([
            ['name' => 'A', 'weight' => 0, 'prize_id' => 1],
        ]);
    }
}
```

## 七、总结

| 维度 | 关键点 | 工具/方案 |
|------|--------|-----------|
| 概率算法 | 加权随机 + 动态归一化 | `random_int()` + 权重过滤 |
| 公平性 | 可验证随机 + 审计日志 | Provably Fair + 链式哈希 |
| 防超卖 | 原子扣减 | `UPDATE WHERE > 0` / Redis Lua |
| 合规 | 概率公示 + 价值上限 + 年龄验证 | 自动公示 + 5 万上限 + 实名 |
| 缓存一致性 | 扣减后清除缓存 | Cache::forget + Redis Lua |
| 可预测性 | 密码学安全随机数 | `random_int()` 替代 `rand()` |

盲盒/抽奖看似是简单的「转盘」，背后涉及概率论、分布式一致性、密码学、法律法规多个领域。希望这篇文章能帮到做类似业务的开发者，少踩一些坑。

## 相关阅读

- [ThinkPHP 电商后端架构设计：盲盒抽奖业务的核心逻辑实战踩坑记录](/categories/Business/thinkphp-architecture/)
- [ThinkPHP 电商系统支付集成实战：支付宝微信支付回调幂等与多业务路由踩坑记录](/categories/Business/thinkphp-guide/)
- [会员积分系统设计：积分获取/消耗/过期/兑换的完整业务闭环](/categories/业务架构/2026-06-01-membership-points-system-design-earn-expire-redeem/)
