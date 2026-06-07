# Redis 事务与脚本

## 定义

Redis 提供三种将多条命令打包执行的机制：**事务（MULTI/EXEC）**、**Lua 脚本** 和 **Pipeline（管道）**。它们解决的核心问题是**原子性**和**性能优化**，但各自适用场景不同。

## 核心原理

### 1. 事务（MULTI/EXEC）

Redis 事务通过 `MULTI` 和 `EXEC` 命令实现，将多条命令打包为一个操作序列。

**基本用法**：
```bash
> MULTI
OK
> SET user:1:name "Alice"
QUEUED
> SET user:1:age 30
QUEUED
> EXEC
1) OK
2) OK
```

**事务流程**：
```
MULTI → 开始事务
  命令 1 → QUEUED（入队，不执行）
  命令 2 → QUEUED
  ...
EXEC → 执行所有 QUEUED 命令，返回结果
```

**关键特性**：

| 特性 | 说明 |
|------|------|
| 顺序执行 | 所有命令按入队顺序执行 |
| 不会被打断 | EXEC 期间不会被其他客户端命令插入 |
| 不支持回滚 | 命令执行失败后其他命令继续执行 |
| 语法错误检测 | MULTI 期间语法错误会导致整个事务被拒绝 |

**为什么不支持回滚？**
Redis 的设计哲学是**保持简单和快速**。回滚需要额外的复杂逻辑，而 Redis 认为：
- 语法错误可以在程序层面捕获
- 运行时错误（如对 String 执行 LPUSH）不应该发生，属于编程错误
- 不支持回滚使得 Redis 内部更简单高效

**WATCH 命令（乐观锁）**：
```bash
> WATCH user:1:balance
> MULTI
> DECRBY user:1:balance 100
> EXEC
# 如果 user:1:balance 在 WATCH 后被其他客户端修改，EXEC 返回 nil（事务失败）
```

### 2. Lua 脚本

Lua 脚本是 Redis 事务的**增强版**，提供真正的原子执行能力。

**核心优势**：

| 优势 | 说明 |
|------|------|
| 原子执行 | 脚本内的命令不会被其他命令插入 |
| 条件逻辑 | 支持 if/else/循环等复杂逻辑 |
| 减少网络开销 | 多条命令打包为一次 EVAL 调用 |
| 可复用 | 通过 EVALSHA 缓存脚本，按 SHA1 调用 |

**基本用法**：
```bash
# EVAL 语法：EVAL script numkeys key [key ...] arg [arg ...]
> EVAL "return redis.call('SET', KEYS[1], ARGV[1])" 1 user:1:name "Alice"
OK
```

**秒杀库存扣减示例**：
```lua
-- KEYS[1]: 库存 Key, KEYS[2]: 预热标记 Key
-- ARGV[1]: 扣减数量

-- 库存未预热
if redis.call('exists', KEYS[2]) == 1 then
    return -9
end

-- 库存 Key 存在
if redis.call('exists', KEYS[1]) == 1 then
    local stock = tonumber(redis.call('get', KEYS[1]))
    local num = tonumber(ARGV[1])
    
    -- 库存不足
    if stock < num then
        return -3
    end
    
    -- 扣减库存
    redis.call('incrby', KEYS[1], 0 - num)
    return 1
end

-- 库存 Key 不存在
return -1
```

**脚本管理**：
```bash
# 加载脚本并返回 SHA1
> SCRIPT LOAD "return redis.call('SET', KEYS[1], ARGV[1])"
"e0e1f9fabfc9d4800c877a703b823ac0578ff831"

# 通过 SHA1 执行（脚本已缓存）
> EVALSHA "e0e1f9fabfc9d4800c877a703b823ac0578ff831" 1 user:1:name "Alice"

# 检查脚本是否存在
> SCRIPT EXISTS "e0e1f9fabfc9d4800c877a703b823ac0578ff831"
1) (integer) 1
```

**注意事项**：
- 脚本执行期间 Redis 会阻塞，避免编写耗时脚本
- Redis 5.0+ 支持脚本只读模式（`EVALSHA_RO`），允许在从节点执行
- 脚本内不能使用随机命令（如 RANDOMKEY），否则主从复制不一致

### 3. Pipeline（管道）

Pipeline 是最简单的批量执行方式，**不保证原子性**，但性能最优。

**工作原理**：
```
客户端 → 打包 N 条命令 → 一次性发送 → 服务端顺序执行 → 一次性返回结果
```

**性能对比**：

| 方式 | RTT 次数 | 上下文切换 | 原子性 |
|------|---------|-----------|--------|
| 逐条执行 | N 次 | N 次 | 否 |
| Pipeline | 1 次 | 1 次 | 否 |
| 事务 | 1 次 | 1 次 | 是 |
| Lua 脚本 | 1 次 | 1 次 | **是** |

**Laravel 中使用 Pipeline**：
```php
// Predis
$redis->pipeline(function ($pipe) {
    $pipe->set('key1', 'value1');
    $pipe->set('key2', 'value2');
    $pipe->set('key3', 'value3');
});

// phpredis
$redis->multi(Redis::PIPELINE);
$redis->set('key1', 'value1');
$redis->set('key2', 'value2');
$redis->set('key3', 'value3');
$redis->exec();
```

### 4. 三种方式选型对比

| 维度 | 事务 | Lua 脚本 | Pipeline |
|------|------|---------|----------|
| 原子性 | ✅ 是 | ✅ 是 | ❌ 否 |
| 条件逻辑 | ❌ 不支持 | ✅ 支持 | ❌ 不支持 |
| 性能 | 好 | 好 | **最好** |
| 复杂度 | 低 | 中 | 低 |
| 适用场景 | 简单批量操作 | 需要条件判断的原子操作 | 纯批量写入/读取 |

**选型建议**：
- **纯批量操作**（批量 SET/GET）→ Pipeline
- **需要原子性**（扣减库存、转移余额）→ Lua 脚本
- **简单事务**（批量写入无条件）→ MULTI/EXEC
- **需要乐观锁**（CAS 操作）→ WATCH + MULTI/EXEC

## 原子性问题与解决方案

Redis 的"先读后写"操作在高并发下存在竞态条件：

```bash
# 问题：检查余额并扣减（非原子）
balance = GET user:1:balance
if balance >= 100:
    DECRBY user:1:balance 100  # 并发下可能超扣
```

**解决方案**：

| 方案 | 实现 | 适用场景 |
|------|------|---------|
| Lua 脚本 | `EVAL "if tonumber(redis.call('GET',KEYS[1])) >= tonumber(ARGV[1]) then redis.call('DECRBY',KEYS[1],ARGV[1]) return 1 else return 0 end"` | 库存扣减、余额操作 |
| 分布式锁 | `SET lock:xxx uuid NX EX 30` + 业务逻辑 + Lua 解锁 | 缓存重建、热点任务串行化 |
| WATCH 乐观锁 | `WATCH` + `MULTI` + `EXEC` | 读多写少的 CAS 场景 |

## 相关概念

- [分布式锁](分布式锁.md) - SET NX EX、Lua 解锁、RedLock
- [性能优化](性能优化.md) - Pipeline 批量命令优化
- [分布式限流算法](分布式限流算法.md) - Lua 脚本实现滑动窗口
- [Laravel集成](Laravel集成.md) - Laravel 中使用事务与脚本

## 常见问题

### Q: Redis 事务和数据库事务有什么区别？
A: Redis 事务不支持回滚，只保证命令按顺序执行且不被打断。数据库事务支持 ACID 完整语义。Redis 事务更接近"批量命令执行"。

### Q: Lua 脚本为什么是原子的？
A: Redis 使用单线程执行命令，Lua 脚本在执行期间不会被其他命令插入。脚本内的所有 Redis 操作要么全部执行，要么全部不执行。

### Q: Pipeline 和事务有什么区别？
A: Pipeline 只是减少网络 RTT，不保证原子性。事务保证命令不被打断。Pipeline 内的命令可能被其他客户端的命令插入执行。

### Q: Lua 脚本执行时间过长会怎样？
A: Redis 会阻塞直到脚本执行完成。建议脚本执行时间不超过 5 秒。Redis 5.0+ 支持 `lua-time-limit` 配置脚本超时，但超时后只允许 SCRIPT KILL 命令，不支持自动中断。

## 相关文章

来源博客文章：
- [Redis-Lua-脚本原子操作实战](/2026/06/01/redis-lua-guide-distributedrate-limiting/) - Lua 脚本实现分布式限流与库存扣减
- [Redis Pipeline 实战](/2026/06/01/redis-pipeline-guide-commandsoptimization/) - Pipeline 批量命令优化
- [Laravel Redis 分布式锁失效场景实战](/2026/06/01/laravel-redis-distributedlockguide/) - 分布式锁与原子性
- [Redis全部](/2026/06/01/redis-interview/) - Redis 面试题全集，含事务与 Lua 详解
