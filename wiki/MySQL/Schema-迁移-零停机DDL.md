# Schema 迁移与零停机 DDL

## 定义

Schema 迁移是指对数据库表结构（DDL）进行变更的操作，包括加列、改列、加索引、改字段类型等。在大表（千万级以上）上执行 DDL 会导致长时间锁表，影响线上服务。零停机 DDL 工具通过各种策略避免或最小化锁表时间。

## 核心原理

### MySQL DDL 的锁表问题

| MySQL 版本 | DDL 行为 |
|-----------|---------|
| 5.5 及之前 | `ALTER TABLE` 全程锁表，复制整张表 |
| 5.6 | 引入 Online DDL（`ALGORITHM=INPLACE`），部分操作不锁表 |
| 8.0 | Instant DDL（`ALGORITHM=INSTANT`），加列瞬间完成 |

### 零停机 DDL 工具对比

| 工具 | 原理 | 停写时间 | 资源消耗 | 适用场景 |
|------|------|---------|---------|---------|
| `ALGORITHM=INSTANT` | 元数据变更，不改数据 | 无 | 极低 | 8.0+ 加列、加默认值 |
| `ALGORITHM=INPLACE` | 原地变更，重建索引 | 短暂（metadata lock） | 中 | 加索引、改列名 |
| gh-ost | 影子表 + binlog 回放 | 极短（最终切换） | 低（节流） | 大表任意变更 |
| pt-osc | 影子表 + 触发器 | 短（触发器切换） | 高（触发器开销） | 通用变更 |

### gh-ost 工作原理

```
1. 创建影子表 _orders_gho
2. 在影子表上执行 ALTER
3. 从 binlog 实时回放增量变更到影子表
4. 同时复制存量数据到影子表
5. 存量复制完成后，原子切换表名（LOCK + RENAME）
```

```bash
gh-ost \
  --host=localhost \
  --database=shop \
  --table=orders \
  --alter="ADD COLUMN status TINYINT DEFAULT 0" \
  --chunk-size=1000 \
  --max-load=Threads_running=25 \
  --critical-load=Threads_running=1000 \
  --initially-drop-ghost-table \
  --execute
```

### pt-osc 工作原理

```
1. 创建影子表 _orders_new
2. 在影子表上执行 ALTER
3. 在原表上创建 AFTER INSERT/UPDATE/DELETE 触发器
4. 复制存量数据（触发器同步增量变更）
5. 原子切换表名
```

```bash
pt-online-schema-change \
  --alter "ADD COLUMN status TINYINT DEFAULT 0" \
  --host=localhost,D=shop,t=orders \
  --chunk-size=1000 \
  --max-lag=1s \
  --critical-load Threads_running:1000 \
  --execute
```

## Laravel 集成

### Migration 中使用 Online DDL

```php
// database/migrations/2026_06_07_add_status_to_orders.php
public function up()
{
    // 使用 ALGORITHM=INSTANT（MySQL 8.0+）
    DB::statement('ALTER TABLE orders ADD COLUMN status TINYINT DEFAULT 0, ALGORITHM=INSTANT');
}

// 对于不支持 INSTANT 的变更，使用 gh-ost
public function up()
{
    // 记录 gh-ost 命令，在部署脚本中执行
    $this->command->info('请执行: gh-ost --table=orders --alter="ADD INDEX idx_status (status)" --execute');
}
```

### CI/CD 集成

```yaml
# .github/workflows/schema-migration.yml
- name: Run DDL migration
  run: |
    if [[ "$MIGRATION_TYPE" == "instant" ]]; then
      php artisan migrate --force
    else
      gh-ost --table=$TABLE --alter="$ALTER_SQL" --execute
    fi
```

## 最佳实践

1. **优先用 Instant DDL**：MySQL 8.0+ 的 `ALGORITHM=INSTANT` 支持加列、加默认值，瞬间完成
2. **大表用 gh-ost**：千万级以上表的索引变更、列类型修改，使用 gh-ost 避免锁表
3. **避开高峰期**：即使是 Online DDL，也建议在低峰期执行
4. **监控进度**：gh-ost 支持 Unix socket 交互，可实时查看进度和暂停
5. **回滚方案**：gh-ost 保留原表（`_orders_del`），出问题可快速 rename 回去

## 实战案例

来自博客文章：
- [Schema Migration 零停机 DDL 实战：gh-ost vs pt-osc 生产环境无锁表变更](/01_MySQL/2026-06-07-Schema-Migration-Zero-Downtime-gh-ost-pt-osc-Laravel/)
- [Migration-Free Schema Evolution 实战：Atlas/Bytebase 数据库 Schema 即代码](/2026/06/05/Migration-Free-Schema-Evolution-实战-Atlas-Bytebase数据库Schema即代码-对比Laravel-Migrations的DDL管理新范式/)

## 相关概念

- [Migration-Free Schema Evolution](Migration-Free-Schema-Evolution.md) - 声明式 Schema 管理
- [Database Branching](Database-Branching.md) - 数据库分支工作流
- [Group Replication 高可用](Group-Replication高可用.md) - MySQL 集群 DDL 协调
- [MySQL 9.x 新特性](MySQL%209.x新特性.md) - Instant DDL 增强

## 常见问题

**Q: gh-ost vs pt-osc 如何选型？**
A: gh-ost 不需要触发器，对线上写入性能影响更小，推荐首选。pt-osc 在某些边缘场景（如外键约束）下兼容性更好。

**Q: gh-ost 切换表名时会锁表多久？**
A: 切换时需要获取 metadata lock，通常在毫秒级。但在有长事务未提交的情况下，可能阻塞等待。

**Q: 如何处理有外键引用的表？**
A: gh-ost 不支持有外键引用的表。需要先删除外键，用 gh-ost 完成变更后重新创建。或使用 `--skip-foreign-key-checks` 选项。
