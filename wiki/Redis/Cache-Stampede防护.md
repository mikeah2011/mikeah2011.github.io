# Cache Stampede 防护

## 定义

Cache Stampede（缓存击穿/缓存惊群）是指**单个热点 Key 在高并发访问下恰好过期**，导致大量请求同时穿透缓存直达数据库的现象。与缓存穿透（查询不存在的数据）和缓存雪崩（大量 Key 同时过期）不同，Cache Stampede 的核心特征是：**单点失效 × 高并发 = 数据库瞬时压力暴增**。

量化示例：QPS 5000 的接口，缓存命中率 99% 时仅 50 QPS 打到数据库；热点 Key 过期瞬间，5000 QPS 全部涌入数据库，压力暴增 **100 倍**。

## 与缓存穿透、缓存雪崩的区别

| 问题类型 | 触发条件 | 影响范围 | 典型防御 |
|---------|---------|---------|---------|
| 穿透 | 查询不存在的数据 | 任意 key | 布隆过滤器、空值缓存 |
| **击穿** | **单个热点 key 过期** | **单个 key** | **互斥锁、XFetch、异步刷新** |
| 雪崩 | 大量 key 同时过期 | 批量 key | 随机 TTL、多级缓存、集群 |

## 三重纵深防御体系

### 第一层：分布式锁互斥重建（Cache::lock）

核心思路：缓存未命中时，只有一个请求能获取锁去重建缓存，其余请求等待或返回旧数据。

```php
// Laravel 实现
$lock = Cache::lock("lock:rebuild:{$key}", 10);
if ($lock->get()) {
    try {
        $value = Cache::get($key); // 双重检查
        if ($value !== null) return $value;
        
        $value = $callback();
        Cache::put($key, $value, $ttl);
        return $value;
    } finally {
        $lock->release();
    }
}
// 未获取到锁：等待后重试或返回旧值
```

**优点**：实现简单，保证同一时刻只有一个回源请求。
**缺点**：锁等待期间其他请求被阻塞；锁超时设置不当可能导致并发穿透。

### 第二层：概率性提前过期（XFetch 算法）

XFetch 在缓存即将过期时，以**概率方式**触发后台重建，避免所有请求集中在过期瞬间。

核心原理：当缓存 TTL 剩余时间小于阈值时，每个请求有 P 概率触发异步重建，其余请求仍返回旧缓存。

```php
// XFetch 核心逻辑
$remainingTtl = Redis::ttl($key);
if ($remainingTtl < $beta * sqrt($logN)) {
    // 概率性触发后台重建
    if (mt_rand() / mt_getrandmax() < 1 / sqrt($retryCount++)) {
        $this->backgroundRefresh($key, $callback, $ttl);
    }
}
return Cache::get($key); // 返回旧值
```

**优点**：无锁等待，请求不阻塞；重建分散在时间轴上。
**缺点**：需要业务能容忍短暂的旧数据返回；参数调优需要基准测试。

### 第三层：后台异步刷新（Stale-While-Revalidate）

SWR 模式在缓存过期后仍返回旧值，同时在后台异步刷新缓存。

```php
// SWR 实现
$value = Cache::get($key);
if ($value !== null) {
    // 检查是否需要后台刷新
    $expiresAt = Cache::get("{$key}:expires_at");
    if ($expiresAt && now()->timestamp > $expiresAt) {
        // 异步刷新，不阻塞当前请求
        dispatch(fn() => $this->refresh($key, $callback, $ttl));
    }
    return $value;
}
// 缓存完全不存在时才同步回源
return $this->syncRefresh($key, $callback, $ttl);
```

**优点**：用户始终能快速获取数据（旧值或新值）；刷新对用户透明。
**缺点**：实现复杂度高；需要维护过期时间元数据。

## 三重防御选型

| 维度 | 分布式锁 | XFetch | SWR |
|------|---------|--------|-----|
| 实现复杂度 | 低 | 中 | 高 |
| 请求延迟 | 等待锁 | 无等待 | 无等待 |
| 数据新鲜度 | 高（重建后立即生效） | 中（概率性延迟） | 中（异步延迟） |
| 并发压力 | 低（互斥） | 低（分散） | 低（异步） |
| 适用场景 | 强一致性要求 | 高并发热点 | 用户体验优先 |

**生产建议**：三层防御可以组合使用——SWR 作为默认策略，XFetch 作为热点 Key 的概率性预热，分布式锁作为最后的安全网。

## 实战案例

来自博客文章：
- [Cache Stampede 防护深度实战：Lock + Probabilistic Early Expiration + Background Refresh——Laravel 高并发缓存击穿的三重防御](/2026/06/07/Cache-Stampede-防护深度实战-Lock-Probabilistic-Early-Expiration-Background-Refresh-Laravel高并发缓存击穿三重防御/)
- [Cache Stampede 防护深度实战：Lock + Probabilistic Expiration + Background Refresh——Laravel 三重防御](/2026/06/07/2026-06-07-Cache-Stampede防护深度实战-Lock-Probabilistic-Expiration-Background-Refresh-Laravel三重防御/)

## 相关概念

- [缓存策略](缓存策略.md) — 缓存穿透/击穿/雪崩的全景防御
- [分布式锁](分布式锁.md) — 锁的实现细节与失效场景
- [缓存写入模式](缓存写入模式.md) — Cache-Aside/Write-Through/Write-Back 选型
- [Redis 事务与脚本](Redis事务与脚本.md) — Lua 脚本原子化操作
- [Laravel集成](Laravel集成.md) — Laravel Cache::lock API
- [性能优化](性能优化.md) — Pipeline、热点 Key 治理

## 常见问题

### Q: Cache Stampede 和缓存雪崩有什么区别？
A: 击穿是**单个热点 Key** 失效导致的瞬时穿透；雪崩是**大量 Key 同时过期**或 Redis 整体不可用。防御策略也不同：击穿侧重互斥和异步刷新，雪崩侧重 TTL 随机化和集群高可用。

### Q: 分布式锁方案中，锁超时设置多少合适？
A: 锁超时必须大于缓存重建耗时，但不能过长。建议：正常重建耗时 × 2 + 网络缓冲。例如重建耗时 200ms，锁超时设 500ms-1s。同时配合看门狗续期机制处理长尾请求。

### Q: XFetch 的概率参数如何调优？
A: 核心参数是 β（beta）和重试次数。β 控制提前刷新的时间窗口（通常设为 1-5），重试次数影响触发概率。建议通过基准测试找到最优组合：模拟目标 QPS，逐步调整参数直到数据库穿透 QPS 在可接受范围内。

### Q: 三层防御都需要同时开启吗？
A: 不一定。小规模系统用分布式锁即可；高并发场景建议 SWR + 分布式锁；超大规模系统可以三层都开启。关键是根据业务 QPS、延迟容忍度和数据新鲜度要求选择合适的组合。
