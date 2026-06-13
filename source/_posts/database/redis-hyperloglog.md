---
title: "Redis HyperLogLog 的正确用法与常见误区"
keywords: [Redis HyperLogLog, 的正确用法与常见误区, 数据库]
date: 2026-06-10 04:52:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - Redis
  - HyperLogLog
  - 基数统计
  - 大数据
description: 深入解析 Redis HyperLogLog 的底层原理与正确使用姿势，附 PHP/Laravel 实战代码，避开常见坑点。
---


## 前言

在后端开发中，"统计不重复用户数"是一个经典需求——UV（Unique Visitor）统计、DAU（日活跃用户）计算、商品独立访客数等场景无处不在。当数据量达到千万甚至亿级时，传统的 `SELECT COUNT(DISTINCT user_id)` 或 Redis Set 去重方案都会遇到内存瓶颈。

Redis 的 HyperLogLog 正是为解决这类问题而生的数据结构。它用 **12KB 内存** 就能统计 2^64 个不同元素的基数（近似值），误差率仅 0.81%。听起来很美好，但实际使用中有不少陷阱。

本文将深入 HyperLogLog 的底层原理，通过可运行的 PHP/Laravel 代码演示正确用法，并总结最常见的误区。

## 核心概念

### 什么是 HyperLogLog

HyperLogLog（HLL）是 Redis 2.8.9 引入的概率数据结构，用于**基数估算**（cardinality estimation）。它的核心特点是：

- **极低内存占用**：无论存储多少元素，固定占用 12KB（2^14 × 6 bit）
- **极快的写入速度**：`PFADD` 命令时间复杂度 O(1)
- **近似结果**：标准误差 0.81%，即 100 万个独立用户，实际结果可能在 991,900 到 1,008,100 之间

### 底层原理（简化版）

HyperLogLog 的算法基于一个数学观察：**均匀随机哈希值的前导零个数服从几何分布**。

1. 对每个元素做哈希，取前若干位作为桶编号（bucket index）
2. 在桶内，统计哈希值剩余位中连续前导零的最大数量（max leading zeros）
3. 基数估算公式：`result = α × m × 2^max_zeros`，其中 m 是桶数量，α 是修正系数

Redis 使用 16,384 个桶（2^14），每个桶用 6 bit 存储 max leading zeros（最大值 63），所以总内存 = 16,384 × 6 / 8 = 12,288 bytes ≈ 12KB。

### 关键命令

| 命令 | 作用 | 说明 |
|------|------|------|
| `PFADD key element [element ...]` | 添加元素 | 如果 key 不存在会自动创建 |
| `PFCOUNT key [key ...]` | 获取基数 | 单个或多个 key 的并集基数 |
| `PFMERGE destkey sourcekey [sourcekey ...]` | 合并多个 HLL | 结果存入 destkey |

## 实战代码（PHP/Laravel）

### 1. 基础用法：统计 UV

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class UvTracker
{
    private const PREFIX = 'uv:';
    private const HLL_KEY_PREFIX = 'hll:uv:';

    /**
     * 记录用户访问（去重）
     */
    public function recordVisit(string $pageId, int $userId): void
    {
        $key = self::HLL_KEY_PREFIX . $pageId;
        Redis::pfadd($key, (string) $userId);

        // 设置 30 天过期
        Redis::expire($key, 86400 * 30);
    }

    /**
     * 获取页面 UV
     */
    public function getUv(string $pageId): int
    {
        $key = self::HLL_KEY_PREFIX . $pageId;
        return (int) Redis::pfcount($key);
    }

    /**
     * 获取日期范围内的 UV（需要提前按天存储）
     */
    public function getDateRangeUv(string $pageId, int $days): int
    {
        $keys = [];
        for ($i = 0; $i < $days; $i++) {
            $date = date('Ymd', strtotime("-{$i} days"));
            $keys[] = self::HLL_KEY_PREFIX . $pageId . ':' . $date;
        }

        if (empty($keys)) {
            return 0;
        }

        return (int) Redis::pfcount($keys);
    }
}
```

### 2. Laravel 封装：带按天存储的完整方案

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class DailyUvService
{
    private string $prefix;

    public function __construct(string $prefix = 'dau')
    {
        $this->prefix = $prefix;
    }

    /**
     * 记录每日访问
     */
    public function track(string $biz, int $userId, ?string $date = null): void
    {
        $date = $date ?? date('Y-m-d');
        $key = "{$this->prefix}:{$biz}:{$date}";

        // 使用 pipeline 减少网络往返
        Redis::pipeline(function ($pipe) use ($key, $userId) {
            $pipe->pfadd($key, (string) $userId);
            $pipe->expire($key, 86400 * 90); // 保留 90 天
        });
    }

    /**
     * 获取某天的 DAU
     */
    public function getDaily(string $biz, string $date): int
    {
        $key = "{$this->prefix}:{$biz}:{$date}";
        return (int) Redis::pfcount($key);
    }

    /**
     * 获取日期范围内的去重 DAU
     */
    public function getRange(string $biz, string $startDate, string $endDate): int
    {
        $keys = $this->generateDateKeys($biz, $startDate, $endDate);

        if (empty($keys)) {
            return 0;
        }

        // Redis 的 pfcount 多 key 模式会计算并集
        return (int) Redis::pfcount($keys);
    }

    /**
     * 合并多个日期的 HLL 到一个目标 key
     */
    public function mergeInto(string $biz, string $targetDate, array $sourceDates): void
    {
        $destKey = "{$this->prefix}:{$biz}:merged:{$targetDate}";
        $sourceKeys = array_map(
            fn($date) => "{$this->prefix}:{$biz}:{$date}",
            $sourceDates
        );

        Redis::pfmerge($destKey, ...$sourceKeys);
        Redis::expire($destKey, 86400 * 30);
    }

    private function generateDateKeys(string $biz, string $startDate, string $endDate): array
    {
        $keys = [];
        $start = new \DateTime($startDate);
        $end = new \DateTime($endDate);

        while ($start <= $end) {
            $keys[] = "{$this->prefix}:{$biz}:{$start->format('Y-m-d')}";
            $start->modify('+1 day');
        }

        return $keys;
    }
}
```

### 3. 使用示例

```php
// 在 Controller 或 Job 中使用
$dauService = new DailyUvService('shop');

// 记录用户访问
$dauService->track('homepage', $userId);

// 查询今日 DAU
$todayUv = $dauService->getDaily('shop', '2026-06-10');

// 查询过去 7 天的独立用户数（注意：这是 7 天的并集，不是日均）
$weekUv = $dauService->getRange('shop', '2026-06-03', '2026-06-10');
```

### 4. artisan 命令：定时清理过期 HLL

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class CleanupHyperLogLogs extends Command
{
    protected $signature = 'hll:cleanup {--days=90 : 保留天数}';
    protected $description = '清理过期的 HyperLogLog 数据';

    public function handle(): int
    {
        $days = $this->option('days');
        $cutoff = date('Y-m-d', strtotime("-{$days} days"));
        $pattern = 'hll:*';

        $cursor = null;
        $cleaned = 0;

        do {
            [$cursor, $keys] = Redis::scan($cursor ?? 0, ['match' => $pattern, 'count' => 100]);

            foreach ($keys as $key) {
                // 从 key 中提取日期，格式: hll:xxx:2026-01-01
                if (preg_match('/(\d{4}-\d{2}-\d{2})$/', $key, $matches)) {
                    if ($matches[1] < $cutoff) {
                        Redis::del($key);
                        $cleaned++;
                    }
                }
            }
        } while ($cursor > 0);

        $this->info("已清理 {$cleaned} 个过期 HLL key");
        return Command::SUCCESS;
    }
}
```

## 常见误区与解决方案

### 误区 1：用 HyperLogLog 存储元素

**错误做法：**

```php
// ❌ HyperLogLog 只能统计基数，不能取出元素
Redis::pfadd('user_set', 'user_123', 'user_456');
$users = Redis::pfcount('user_set'); // 这只是数字 2，不是用户列表
```

**正确做法：** HyperLogLog 只能告诉你"有多少个不同的东西"，不能告诉你"具体是哪些东西"。需要获取元素列表时，使用 Set 或 Bitmap。

### 误区 2：PFADD 返回 0 就认为添加失败

**错误做法：**

```php
// ❌ 误认为返回 0 就是添加失败
if (!Redis::pfadd('hll:key', $value)) {
    throw new \Exception('添加失败');
}
```

**实际情况：** `PFADD` 返回 1 表示 HLL 的内部状态发生了变化（即该元素可能是新的），返回 0 表示内部状态没变（即该元素很可能已经存在）。但注意是"很可能"，因为 HLL 本身是近似的。

```php
// ✅ 正确理解
$changed = Redis::pfadd('hll:key', $value);
// $changed = 1: HLL 被修改（元素可能是新的）
// $changed = 0: HLL 未被修改（元素可能已存在）
```

### 误区 3：多个 key 的 PFCOUNT 是简单相加

```php
// ❌ 以为 pfcount 等于各 key 的 pfcount 之和
$count1 = Redis::pfcount('hll:day1'); // 1000
$count2 = Redis::pfcount('hll:day2'); // 1000
$total = Redis::pfcount('hll:day1', 'hll:day2'); // ≠ 2000，因为有重叠
```

`PFCOUNT` 多 key 模式会计算**并集**的基数，自动去重。如果两个 key 有 50% 重叠，结果大约是 1500 而不是 2000。

### 误区 4：HyperLogLog 可以用 PFMERGE 后删除源 key

```php
// ⚠️ 合并后删除源 key 是安全的，但要注意时间窗口
Redis::pfmerge('merged', 'hll:day1', 'hll:day2', 'hll:day3');
Redis::del('hll:day1', 'hll:day2', 'hll:day3'); // ✅ 可以删除
```

这是安全的，因为 `PFMERGE` 是精确合并（不是近似），结果已包含所有源 key 的信息。

### 误区 5：忽略 0.81% 误差

在精确计费、财务对账等场景中，0.81% 的误差是不可接受的。HyperLogLog 适用于：

- UV/DUV 等统计类需求（可接受）
- 活动报名人数（可接受，显示"约 XXX 人"）
- 精确的订单去重（**不可接受**）

### 误区 6：HLL key 没设置过期时间

HyperLogLog 固定 12KB，但如果你每天创建新 key 而不设过期，365 天就是 4.3MB。对于只需要统计近期数据的场景，必须设置 TTL。

## 性能对比

用一个实际测试来感受 HyperLogLog 的优势：

```php
<?php

// 测试环境：Redis 7.0, PHP 8.2, 100 万用户

// 方案 1: Set（精确去重）
$start = microtime(true);
for ($i = 1; $i <= 1000000; $i++) {
    Redis::sadd('test_set', "user_{$i}");
}
$setTime = microtime(true) - $start;
$setMemory = Redis::command('MEMORY', ['USAGE', 'test_set']);

// 方案 2: HyperLogLog（近似去重）
$start = microtime(true);
for ($i = 1; $i <= 1000000; $i++) {
    Redis::pfadd('test_hll', "user_{$i}");
}
$hllTime = microtime(true) - $start;
$hllMemory = Redis::command('MEMORY', ['USAGE', 'test_hll']);

echo "Set:      内存 {$setMemory} bytes, 耗时 {$setTime}s\n";
echo "HyperLogLog: 内存 {$hllMemory} bytes, 耗时 {$hllTime}s\n";
```

典型结果：

| 方案 | 内存 | 耗时（100 万次写入） |
|------|------|---------------------|
| Set | ~45 MB | ~12s |
| HyperLogLog | 12 KB | ~2s |

内存差距约 **3,750 倍**。

## 总结

HyperLogLog 是一个优雅的数据结构，用极小的内存代价换取了高效的基数统计能力。掌握以下要点：

1. **只做基数统计**：不要用它存储元素，需要元素列表时用 Set/Bitmap
2. **理解返回值**：PFADD 返回 0 ≠ 失败，PFCOUNT 多 key = 并集基数
3. **设置 TTL**：即使固定 12KB，也要防止 key 无限累积
4. **场景匹配**：统计类需求用 HLL，精确去重用 Set/Bitmap
5. **合并是精确的**：PFMERGE 后可以安全删除源 key

在实际项目中，建议将 HLL 作为 UV/DAU 统计的首选方案，配合按天存储 + 定期合并清理的策略，既能控制内存又能满足日期范围查询需求。
