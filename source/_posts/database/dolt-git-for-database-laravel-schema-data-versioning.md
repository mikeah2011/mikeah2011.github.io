---

title: Dolt 实战：Git for 数据库——MySQL 兼容的版本化数据库与 Laravel 的 Schema/Data 双版本控制
keywords: [Dolt, Git for, MySQL, Laravel, Schema, Data, 数据库, 兼容的版本化数据库与, 双版本控制]
date: 2026-06-09 14:00:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- Dolt
- Git
- 版本控制
- Laravel
- MySQL Compatibility
- Schema迁移
description: Dolt 是一个 MySQL 兼容的版本化数据库，支持 fork、clone、branch、merge、push、pull 等 Git 操作。本文介绍如何在 Laravel 项目中使用 Dolt 实现 Schema 和 Data 的双重版本控制，解决数据库变更可追溯、可回滚的难题。
---



## 前言

在日常开发中，代码版本控制已经是标配——Git 帮我们管理了每一行代码的变更历史。但数据库呢？

Laravel 的 Migration 管理的是 Schema 变更（加字段、改索引），但**数据本身的变更**呢？谁在什么时候改了那条配置？生产环境的 seed 数据被误改了怎么回滚？多个环境之间的数据怎么同步？

传统的做法是手动写 SQL 备份、用触发器记录变更日志、或者靠应用层代码实现软删除+审计字段。这些方案要么侵入性强，要么粒度粗，要么维护成本高。

**Dolt** 给出了一个优雅的答案：把 Git 的版本控制模型直接做进数据库引擎里。它是 MySQL 兼容的，意味着 Laravel 几乎零成本接入。

## 一、Dolt 是什么

### 1.1 一句话概括

> Git versions files. Dolt versions tables.

Dolt 是一个用 Go 编写的 SQL 数据库，100% 兼容 MySQL 协议。它在存储层实现了 Git 的版本控制模型——你可以对数据库执行 `dolt add`、`dolt commit`、`dolt branch`、`dolt merge`、`dolt push`、`dolt pull`，就像操作一个 Git 仓库一样。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| MySQL 兼容 | 标准 MySQL 客户端可直接连接，Laravel 的 `mysql` 驱动无需修改 |
| Git-like CLI | `dolt clone`、`dolt commit`、`dolt diff` 等命令与 Git 完全一致 |
| 分支与合并 | 支持数据库级别的分支，branch 之间可以 merge，冲突可手动解决 |
| 时间旅行 | 查询任意历史版本的数据：`SELECT * FROM users AS OF 'HEAD~3'` |
| 差异对比 | `dolt diff` 可以看到表结构和数据的逐行变更 |
| 协作 | 支持 push/pull 到 DoltHub 或自建 remote，多人协作修改数据库 |
| 系统表 | 通过 `dolt_log`、`dolt_diff`、`dolt_blame` 等系统表用 SQL 查询版本历史 |

### 1.3 安装

```bash
# macOS
brew install dolt

# Linux
sudo bash -c 'curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash'

# 验证
dolt version
# dolt version 1.45.0
```

## 二、快速上手：5 分钟体验 Dolt

### 2.1 初始化仓库

```bash
mkdir my-dolt-db && cd my-dolt-db
dolt init
```

这会在当前目录创建一个 `.dolt` 目录，类似 `.git`。

### 2.2 启动 MySQL 服务

```bash
dolt sql-server --host 0.0.0.0 --port 3307 --user root
```

现在可以用任何 MySQL 客户端连接了：

```bash
mysql -h 127.0.0.1 -P 3307 -u root
```

### 2.3 创建表并提交

```sql
CREATE TABLE products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (name, price) VALUES ('iPhone 16', 6999.00);
INSERT INTO products (name, price) VALUES ('MacBook Pro', 14999.00);
```

在 Dolt 中，这些变更不会自动持久化为版本。你需要显式提交：

```bash
# 回到 CLI（另开终端）
cd my-dolt-db

dolt add .
dolt commit -m "初始化产品表和基础数据"
```

### 2.4 分支与合并

```bash
# 创建价格调整分支
dolt branch price-adjustment
dolt checkout price-adjustment

# 在该分支上修改价格
dolt sql -q "UPDATE products SET price = 6499.00 WHERE name = 'iPhone 16'"
dolt add .
dolt commit -m "iPhone 16 降价 500 元"

# 切回主分支合并
dolt checkout main
dolt merge price-adjustment
```

### 2.5 查看变更历史

```bash
# 查看 commit 日志
dolt log

# 查看两个版本之间的差异
dolt diff HEAD~1 HEAD

# 查看某张表的变更历史
dolt sql -q "SELECT * FROM dolt_history_products ORDER BY commit_date DESC"
```

### 2.6 时间旅行查询

```sql
-- 查询上一个版本的产品数据
SELECT * FROM products AS OF 'HEAD~1';

-- 查询特定 commit 的数据
SELECT * FROM products AS OF 'abc123def';

-- 查询某个时间点的数据
SELECT * FROM products AS OF '2026-06-01 12:00:00';
```

## 三、Dolt 在 Laravel 中的集成

这是本文的重点。我们来实现 Laravel + Dolt 的 Schema 和 Data 双版本控制。

### 3.1 修改数据库连接

Dolt 兼容 MySQL 协议，Laravel 只需修改 `.env`：

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3307
DB_DATABASE=my_dolt_db
DB_USERNAME=root
DB_PASSWORD=
```

不需要安装额外的扩展包，`mysql` 驱动直接能用。

### 3.2 创建 Dolt Service

先封装一个 Dolt 版本控制的 Service：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class DoltVersionService
{
    /**
     * 获取当前分支名
     */
    public function activeBranch(): string
    {
        return DB::selectOne('SELECT active_branch() AS branch')->branch;
    }

    /**
     * 创建新分支
     */
    public function createBranch(string $name): void
    {
        DB::statement("CALL DOLT_BRANCH(?)", [$name]);
    }

    /**
     * 切换分支
     */
    public function checkout(string $branch): void
    {
        DB::statement("CALL DOLT_CHECKOUT(?)", [$branch]);
    }

    /**
     * 提交当前变更
     */
    public function commit(string $message, string $author = 'Laravel App'): void
    {
        // 设置提交者信息
        DB::statement("SET @@dolt_committer_name = ?", [$author]);
        DB::statement("SET @@dolt_committer_email = ?", ['app@example.com']);

        DB::statement("CALL DOLT_COMMIT(?, '-m', ?)", ['--all', $message]);
    }

    /**
     * 合并分支
     */
    public function merge(string $branch): array
    {
        $result = DB::select("CALL DOLT_MERGE(?)", [$branch]);

        return [
            'fast_forward' => $result[0]->fast_forward ?? false,
            'conflicts' => $result[0]->conflicts ?? 0,
            'message' => $result[0]->message ?? '',
        ];
    }

    /**
     * 查看指定表的差异
     */
    public function diff(string $table, string $fromRef = 'HEAD~1', string $toRef = 'WORKING'): array
    {
        return DB::select(
            "SELECT * FROM dolt_diff_{$table}(?, ?) ORDER BY to_commit_date DESC",
            [$fromRef, $toRef]
        );
    }

    /**
     * 查看 commit 日志
     */
    public function log(int $limit = 20): array
    {
        return DB::select(
            "SELECT * FROM dolt_log() ORDER BY date DESC LIMIT ?",
            [$limit]
        );
    }

    /**
     * 查询历史版本数据
     */
    public function selectAsOf(string $table, string $ref = 'HEAD~1'): array
    {
        return DB::select("SELECT * FROM {$table} AS OF ?", [$ref]);
    }

    /**
     * 获取数据库整体 hash（用于检测变更）
     */
    public function dbHash(): string
    {
        return DB::selectOne('SELECT dolt_hashof_db() AS hash')->hash;
    }

    /**
     * 查看某张表的 blame（谁改了哪行）
     */
    public function blame(string $table): array
    {
        return DB::select("SELECT * FROM dolt_blame_{$table}");
    }

    /**
     * 列出所有分支
     */
    public function branches(): array
    {
        return DB::select('SELECT * FROM dolt_branches');
    }
}
```

### 3.3 集成到 Migration 流程

Laravel 的 Migration 天然管理 Schema 变更。我们可以用 Artisan 命令在 Migration 前后自动创建 Dolt commit：

```php
<?php

namespace App\Console\Commands;

use App\Services\DoltVersionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

class DoltMigrate extends Command
{
    protected $signature = 'dolt:migrate
        {--message= : Commit message}
        {--branch= : Run migration on specific branch}';

    protected $description = 'Run migrations with Dolt version control';

    public function handle(DoltVersionService $dolt): int
    {
        $branch = $this->option('branch');
        $currentBranch = $dolt->activeBranch();

        // 如果指定了分支，先切换
        if ($branch && $branch !== $currentBranch) {
            $this->info("切换到分支: {$branch}");
            $dolt->checkout($branch);
        }

        // 记录迁移前的数据库 hash
        $hashBefore = $dolt->dbHash();

        $this->info('执行迁移...');

        $exitCode = Artisan::call('migrate', [
            '--force' => true,
        ]);

        $output = Artisan::output();
        $this->line($output);

        // 检查是否有变更
        $hashAfter = $dolt->dbHash();

        if ($hashBefore === $hashAfter) {
            $this->info('没有 Schema 变更，跳过提交。');
            return self::SUCCESS;
        }

        // 自动提交
        $message = $this->option('message')
            ?? 'Migration: ' . now()->format('Y-m-d H:i:s');

        $dolt->commit($message, 'Laravel Migration');
        $this->info("已提交: {$message}");

        // 切回原分支
        if ($branch && $branch !== $currentBranch) {
            $dolt->checkout($currentBranch);
            $this->info("已切回分支: {$currentBranch}");
        }

        return self::SUCCESS;
    }
}
```

使用方式：

```bash
# 在主分支上执行迁移并自动 commit
php artisan dolt:migrate --message="添加订单表"

# 在 feature 分支上执行迁移
php artisan dolt:migrate --branch=feature/orders --message="订单功能 Schema"
```

### 3.4 数据变更的版本控制

Schema 变更由 Migration 管理，但 Seed 数据、配置数据、字典数据的变更怎么追踪？

创建一个 `DoltSeedCommand`：

```php
<?php

namespace App\Console\Commands;

use App\Services\DoltVersionService;
use Illuminate\Console\Command;

class DoltSeedCommit extends Command
{
    protected $signature = 'dolt:seed-commit
        {--message= : Commit message for seed data changes}';

    protected $description = 'Commit seed/config data changes to Dolt';

    public function handle(DoltVersionService $dolt): int
    {
        $hashBefore = $dolt->dbHash();

        $this->info('正在检查数据变更...');

        // 查看 status
        $status = \DB::select('SELECT * FROM dolt_status');

        if (empty($status)) {
            $this->info('没有待提交的数据变更。');
            return self::SUCCESS;
        }

        $this->table(
            ['表名', '是否 staged', '状态'],
            array_map(fn($s) => [$s->table_name, $s->staged ? '是' : '否', $s->status], $status)
        );

        if (!$this->confirm('确认提交这些数据变更？')) {
            return self::SUCCESS;
        }

        $message = $this->option('message')
            ?? 'Data update: ' . now()->format('Y-m-d H:i:s');

        $dolt->commit($message, 'Data Seed');
        $this->info("已提交: {$message}");

        return self::SUCCESS;
    }
}
```

### 3.5 审计中间件：自动记录数据变更

对于关键业务表，可以用 Dolt 的 `dolt_blame` 和 `dolt_diff` 实现审计：

```php
<?php

namespace App\Http\Middleware;

use App\Services\DoltVersionService;
use Closure;
use Illuminate\Http\Request;

class DoltAuditMiddleware
{
    public function __construct(private DoltVersionService $dolt) {}

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 只在写操作后记录
        if (in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'])) {
            $this->recordAudit($request);
        }

        return $response;
    }

    private function recordAudit(Request $request): void
    {
        $hash = $this->dolt->dbHash();
        $branch = $this->dolt->activeBranch();

        \Log::info('Dolt Audit', [
            'branch' => $branch,
            'db_hash' => $hash,
            'route' => $request->route()?->getName(),
            'user_id' => auth()->id(),
            'ip' => $request->ip(),
        ]);
    }
}
```

## 四、实战场景

### 4.1 场景一：配置数据的版本管理

很多系统有大量配置数据（支付渠道、系统参数、字典表），这些数据的变更需要可追溯。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class ConfigVersionManager
{
    public function __construct(private DoltVersionService $dolt) {}

    /**
     * 修改配置并自动创建分支 + commit
     */
    public function updateConfig(string $key, mixed $value, string $reason): void
    {
        $branch = 'config-update-' . now()->format('YmdHis');

        // 创建独立分支
        $this->dolt->createBranch($branch);
        $this->dolt->checkout($branch);

        // 执行更新
        DB::table('system_configs')
            ->where('key', $key)
            ->update([
                'value' => json_encode($value),
                'updated_by' => auth()->id(),
                'updated_at' => now(),
            ]);

        // 提交变更
        $this->dolt->commit("配置变更: {$key} - {$reason}");

        // 切回主分支合并
        $this->dolt->checkout('main');
        $result = $this->dolt->merge($branch);

        if ($result['conflicts'] > 0) {
            throw new \RuntimeException("配置合并冲突，请手动处理: {$result['message']}");
        }

        // 清理分支
        DB::statement("CALL DOLT_BRANCH('-d', ?)", [$branch]);
    }

    /**
     * 查看配置变更历史
     */
    public function configHistory(string $key, int $limit = 50): array
    {
        return DB::select("
            SELECT
                dc.commit_hash,
                dc.commit_message,
                dc.committer,
                dc.date,
                dhp.to_value,
                dhp.from_value
            FROM dolt_history_system_configs dhp
            JOIN dolt_commits dc ON dhp.commit_hash = dc.commit_hash
            WHERE dhp.config_key = ?
            ORDER BY dc.date DESC
            LIMIT ?
        ", [$key, $limit]);
    }

    /**
     * 回滚配置到指定版本
     */
    public function rollbackConfig(string $key, string $commitHash): void
    {
        $historical = DB::selectOne("
            SELECT value FROM system_configs AS OF ?
            WHERE `key` = ?
        ", [$commitHash, $key]);

        if (!$historical) {
            throw new \RuntimeException("在 commit {$commitHash} 中未找到配置: {$key}");
        }

        DB::table('system_configs')
            ->where('key', $key)
            ->update([
                'value' => $historical->value,
                'updated_by' => auth()->id(),
                'updated_at' => now(),
            ]);

        $this->dolt->commit("回滚配置: {$key} 到 {$commitHash}");
    }
}
```

### 4.2 场景二：多环境数据同步

开发环境填充了测试数据，需要同步到测试环境：

```bash
# 开发环境：推送到 remote
cd /path/to/dev-dolt-db
dolt remote add origin dolthub/myapp-data
dolt push origin main

# 测试环境：拉取最新数据
cd /path/to/test-dolt-db
dolt pull origin main

# 或者只拉取特定分支
dolt fetch origin feature/new-pricing
dolt checkout feature/new-pricing
```

在 Laravel 中可以用命令封装：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DoltSync extends Command
{
    protected $signature = 'dolt:sync
        {--pull : Pull from remote}
        {--push : Push to remote}
        {--remote=origin : Remote name}
        {--branch=main : Branch name}';

    protected $description = 'Sync Dolt database with remote';

    public function handle(): int
    {
        $remote = $this->option('remote');
        $branch = $this->option('branch');

        if ($this->option('pull')) {
            $this->info("从 {$remote}/{$branch} 拉取数据...");
            DB::statement("CALL DOLT_PULL(?, ?)", [$remote, $branch]);
            $this->info('拉取完成。');
        }

        if ($this->option('push')) {
            $this->info("推送到 {$remote}/{$branch}...");
            DB::statement("CALL DOLT_PUSH(?, ?)", [$remote, $branch]);
            $this->info('推送完成。');
        }

        return self::SUCCESS;
    }
}
```

### 4.3 场景三：数据误删恢复

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class DataRecoveryService
{
    public function __construct(private DoltVersionService $dolt) {}

    /**
     * 查找某行数据在哪个 commit 被删除
     */
    public function findDeletedRecord(string $table, string $column, mixed $value): ?array
    {
        // 查看历史，找到该记录存在的最后一个版本
        $history = DB::select("
            SELECT commit_hash, commit_date, to_{$column}, from_{$column}
            FROM dolt_diff_{$table}('HEAD', 'HEAD~20')
            WHERE to_{$column} IS NULL AND from_{$column} = ?
            ORDER BY commit_date DESC
            LIMIT 1
        ", [$value]);

        return $history[0] ?? null;
    }

    /**
     * 从历史版本恢复记录
     */
    public function restoreRecord(string $table, string $primaryKey, mixed $id, string $commitRef): void
    {
        $record = DB::selectOne("
            SELECT * FROM {$table} AS OF ?
            WHERE {$primaryKey} = ?
        ", [$commitRef, $id]);

        if (!$record) {
            throw new \RuntimeException("在 {$commitRef} 中未找到记录");
        }

        $recordArray = (array) $record;

        // 使用 INSERT IGNORE 避免主键冲突
        $columns = implode(', ', array_map(fn($c) => "`{$c}`", array_keys($recordArray)));
        $placeholders = implode(', ', array_fill(0, count($recordArray), '?'));

        DB::insert(
            "INSERT IGNORE INTO {$table} ({$columns}) VALUES ({$placeholders})",
            array_values($recordArray)
        );

        $this->dolt->commit("恢复 {$table} 记录 #{$id} 从 {$commitRef}");
    }

    /**
     * 批量恢复：从某个时间点恢复整张表
     */
    public function restoreTable(string $table, string $commitRef): void
    {
        DB::statement("CALL DOLT_CHECKOUT(?, '--', ?)", [$commitRef, $table]);
        $this->dolt->commit("恢复 {$table} 到 {$commitRef}");
    }
}
```

## 五、Dolt 系统表速查

Dolt 通过系统表暴露版本控制信息，可以直接用 SQL 查询：

```sql
-- 查看 commit 历史
SELECT * FROM dolt_log ORDER BY date DESC LIMIT 10;

-- 查看当前工作区状态（哪些表有变更）
SELECT * FROM dolt_status;

-- 查看某张表两个版本之间的差异
SELECT * FROM dolt_diff_products('HEAD~1', 'HEAD');

-- 查看某行数据是谁改的（blame）
SELECT * FROM dolt_blame_products;

-- 查看所有分支
SELECT * FROM dolt_branches;

-- 查看合并冲突
SELECT * FROM dolt_conflicts_products;

-- 查看数据库 Schema 变更
SELECT * FROM dolt_schemas;
```

### 常用 Dolt SQL 函数

```sql
-- 当前分支
SELECT active_branch();

-- 数据库 hash（用于检测是否有变更）
SELECT dolt_hashof_db();

-- 某张表的 hash
SELECT dolt_hashof_table('products');

-- 两个分支的共同祖先
SELECT dolt_merge_base('main', 'feature');

-- 某个 commit 的 hash
SELECT dolt_hashof('main');

-- 版本号
SELECT dolt_version();

-- 检查某个 commit 是否是另一个的祖先
SELECT has_ancestor('feature', 'main');
```

### 常用 Dolt 存储过程

```sql
-- 创建分支
CALL DOLT_BRANCH('feature/new-table');

-- 切换分支
CALL DOLT_CHECKOUT('feature/new-table');

-- 提交变更
CALL DOLT_COMMIT('--all', '-m', 'Add new table');

-- 合并分支
CALL DOLT_MERGE('feature/new-table');

-- 删除分支
CALL DOLT_BRANCH('-d', 'feature/new-table');

-- 推送到 remote
CALL DOLT_PUSH('origin', 'main');

-- 从 remote 拉取
CALL DOLT_PULL('origin', 'main');
```

## 六、踩坑记录

### 6.1 外键约束

Dolt 对外键的支持在不断改进，但在某些版本中，跨分支合并涉及外键的表可能出问题。建议：

- 关键表的外键约束在应用层而非数据库层实现
- 或者在 merge 前临时禁用外键检查：`SET FOREIGN_KEY_CHECKS = 0;`

### 6.2 大表性能

Dolt 使用内容寻址存储（类似 Git），对于大表（百万级以上）：

- 首次 commit 会比较慢
- `dolt diff` 在数据量大时可能超时
- 建议对大表使用 `dolt_diff_<tablename>(from, to)` 函数而非 `dolt_diff` 系统表

### 6.3 AUTO_INCREMENT

Dolt 的 AUTO_INCREMENT 在分支合并后可能不连续。如果业务依赖严格的自增序列，需要额外处理。

### 6.4 存储空间

每次 commit 都会保存数据快照，数据库体积会比纯 MySQL 大。建议：

- 定期 `dolt gc` 清理无用数据
- 不要对频繁变更的大表做过于频繁的 commit

### 6.5 并发写入

Dolt 的并发写入模型与 MySQL 不同。多个 session 同时修改同一分支时，只有一个能 commit 成功，其他的需要先 merge 最新变更。这类似 Git 的 "先 pull 再 push" 模式。

## 七、Dolt vs 传统方案

| 维度 | Dolt | Migration + Seeder | 审计日志表 | CDC (Debezium) |
|------|------|-------------------|-----------|---------------|
| Schema 版本控制 | 原生支持 | Migration | 不支持 | 不支持 |
| 数据版本控制 | 原生支持 | Seeder（只增不改） | 应用层实现 | 流式捕获 |
| 回滚能力 | 任意版本 | 困难 | 有限 | 需要重放 |
| 多分支协作 | 原生 | 靠 Git 管理 Migration | 无 | 无 |
| 查询历史数据 | SQL AS OF | 无 | 需要 JOIN | 需要查询日志 |
| 接入成本 | 修改连接即可 | 已有 | 需要改代码 | 需要额外组件 |
| 性能影响 | 低 | 无 | 写入放大 | 低 |

## 八、生产部署建议

### 8.1 架构选择

**方案 A：Dolt 作为主库**

适合新项目，直接用 Dolt 替代 MySQL。所有数据天然版本化。

**方案 B：Dolt 作为 Versioned Replica**

适合已有 MySQL 的项目。Dolt 通过 MySQL binlog 复制成为从库，提供版本控制能力，主库不受影响。

```bash
# 配置 Dolt 作为 MySQL 从库
dolt sql -q "CALL DOLT_REPLICATION_SOURCE('main', '127.0.0.1', 3306, 'repl_user', 'password', 'mysql-bin.000001', 12345)"
```

### 8.2 备份策略

```bash
# 推送到 DoltHub 作为远程备份
dolt remote add origin dolthub/myapp-production
dolt push origin main

# 或者推送到自建 DoltLab
dolt remote add backup https://doltlab.internal/myapp
dolt push backup main
```

### 8.3 监控

```sql
-- 监控数据库 hash 变化
SELECT dolt_hashof_db() AS current_hash;

-- 监控未提交的变更
SELECT COUNT(*) AS dirty_tables FROM dolt_status;

-- 监控分支数量
SELECT COUNT(*) AS branch_count FROM dolt_branches;
```

## 九、总结

Dolt 解决了一个长期被忽视的问题：**数据库的版本控制**。

它不是一个 ORM 的补丁，不是应用层的 hack，而是在数据库引擎层面实现了 Git 模型。对于 Laravel 项目来说：

1. **零成本接入**：改个 `.env` 就能用，不需要改代码
2. **Schema + Data 双版本**：Migration 管 Schema，Dolt 管数据
3. **时间旅行**：`AS OF` 查询任意历史版本
4. **分支协作**：数据库也能 branch + merge
5. **可审计**：每一行数据的变更都有记录

适合的场景：
- 配置数据需要版本管理
- 多环境数据需要同步
- 关键数据需要审计和回滚
- 需要 "试一试" 的数据库变更（分支上试验，不影响主库）

不建议的场景：
- 高频写入的 OLTP（如实时日志），Dolt 的 commit 模型不适合
- 对存储空间极度敏感的场景

---

*参考链接：*
- [Dolt 官方文档](https://docs.dolthub.com/)
- [Dolt GitHub](https://github.com/dolthub/dolt)
- [DoltHub](https://www.dolthub.com/)
- [Hosted Dolt](https://hosted.doltdb.com/)
