---
title: Litestream 实战：SQLite 流式复制与灾难恢复——本地优先应用的零依赖高可用方案
keywords: [Litestream, SQLite, 流式复制与灾难恢复, 本地优先应用的零依赖高可用方案, DevOps]
date: 2026-06-09 19:57:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - SQLite
  - Litestream
  - 灾难恢复
  - 流式复制
  - 本地优先
description: Litestream 是 SQLite 的流式复制工具，通过持续复制 WAL 日志实现灾难恢复。本文从原理到实战，覆盖安装配置、S3/MinIO 备份、Docker/Systemd 部署、恢复流程，以及 PHP/Laravel 集成方案，让你在本地优先架构中获得企业级数据安全保障。
---


## 概述

SQLite 是世界上最广泛部署的数据库引擎，运行在从手机到服务器的数十亿设备上。但在生产环境中，它的致命短板是**没有原生复制能力**——数据只存在于单个文件，磁盘损坏就意味着全盘丢失。

Litestream 解决了这个问题。它是一个独立的后台进程，通过持续复制 SQLite 的 WAL（Write-Ahead Log）日志到 S3、GCS、Azure Blob 或本地文件，实现近乎实时的灾难恢复。**零依赖、零侵入**——不需要修改任何应用代码。

为什么选择 Litestream 而不是其他方案？

- **不需要修改应用代码**：Litestream 通过 SQLite API 读取 WAL，应用完全无感知
- **流式复制**：不是定时快照，而是持续复制变更，RPO（恢复点目标）接近零
- **原子恢复**：基于快照 + WAL 重放，保证数据一致性
- **极低资源消耗**：单进程，内存占用极小，适合 VPS 和边缘设备
- **多后端支持**：S3、GCS、Azure、SFTP、本地文件系统

对于 PHP/Laravel 项目，特别是小型 API、内部工具、SaaS MVP，Litestream 提供了一个优雅的方案：用 SQLite 替代 MySQL/PostgreSQL，同时获得生产级的数据安全保障。

## 核心概念

### SQLite 的 WAL 机制

理解 Litestream，首先要理解 SQLite 的 WAL 模式。

SQLite 默认使用 rollback journal 模式，但生产环境推荐启用 WAL（Write-Ahead Log）模式。在 WAL 模式下：

1. **写操作先进入 WAL 文件**：所有变更先追加到 `-wal` 文件，而不是直接修改数据库文件
2. **读操作不受写阻塞**：读事务可以看到自己启动时的快照，不需要等待写完成
3. **定期 checkpoint**：当 WAL 文件积累到一定大小后，SQLite 会将 WAL 中的页面合并回主数据库文件

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  数据库文件   │ ◄── │  WAL 文件    │ ◄── │  写操作      │
│  (持久化)     │     │  (临时)      │     │  (追加)      │
└─────────────┘     └─────────────┘     └─────────────┘
       ▲
       │ checkpoint
       └─────────────── 定期合并
```

### Litestream 的 Shadow WAL

Litestream 的核心技巧是**接管了 SQLite 的 checkpoint 过程**。

它启动一个长时间运行的读事务，阻止 SQLite 自动执行 checkpoint。然后它手动复制 WAL 页面到一个叫 "Shadow WAL" 的目录，再手动触发 checkpoint。

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  SQLite WAL  │ ──► │ Shadow WAL  │ ──► │  S3/本地     │
│  (实时读取)   │     │  (分段存储)   │     │  (持续上传)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

Shadow WAL 的文件命名规则：
- `00000000.wal`：第一个 WAL 段
- `00000001.wal`：checkpoint 后的下一个段
- 以此类推，递增的 8 位十六进制数

### Generation（代）的概念

Litestream 使用 "generation" 来组织备份数据：

- 每个 generation 是一个 16 字符的随机十六进制字符串
- 包含一个**快照**（数据库在某个时间点的完整副本）+ 后续的**连续 WAL 文件**
- 如果检测到 WAL 帧断裂，会自动创建新的 generation
- 不同服务器意外共享同一个 replica 路径时，generation 机制能防止数据互相覆盖

### 保留策略

备份时间与 WAL 文件数量直接相关。Litestream 的保留策略分两步：

1. **快照间隔**：定期重新快照，保留多个时间点的数据库副本
2. **保留执行**：删除超过保留时间的快照和对应的 WAL 文件

默认保留 24 小时。可以配置为每天快照、保留一周等策略。

## 实战：安装与基础配置

### 安装 Litestream

**macOS（Homebrew）：**

```bash
brew install litestream
```

**Linux（二进制安装）：**

```bash
# 下载最新版本（以 v0.5.3 为例）
wget https://github.com/benbjohnson/litestream/releases/download/v0.5.3/litestream-v0.5.3-linux-amd64.tar.gz
tar -xzf litestream-v0.5.3-linux-amd64.tar.gz
sudo mv litestream /usr/local/bin/

# 验证安装
litestream version
```

**Docker：**

```bash
# 拉取官方镜像
docker pull litestream/litestream
```

### 验证 SQLite WAL 模式

确保你的 SQLite 数据库启用了 WAL 模式：

```bash
# 检查当前 journal 模式
sqlite3 myapp.db "PRAGMA journal_mode;"

# 如果不是 WAL，手动启用
sqlite3 myapp.db "PRAGMA journal_mode=WAL;"
```

在 PHP 中启用 WAL 模式：

```php
<?php

use Illuminate\Support\Facades\DB;

// Laravel 中启用 WAL 模式
DB::statement('PRAGMA journal_mode=WAL');

// 验证
$mode = DB::select('PRAGMA journal_mode')[0]->journal_mode ?? '';
if ($mode !== 'wal') {
    throw new \RuntimeException("WAL 模式未启用，当前: {$mode}");
}

// 推荐的生产级 PRAGMA 设置
DB::statement('PRAGMA synchronous=NORMAL');      // 正常同步，性能与安全的平衡
DB::statement('PRAGMA busy_timeout=5000');        // 忙等待超时 5 秒
DB::statement('PRAGMA wal_autocheckpoint=1000');  // 每 1000 页自动 checkpoint
DB::statement('PRAGMA foreign_keys=ON');          // 启用外键约束
```

## 实战：S3 备份配置

### 配置文件方式

创建 Litestream 配置文件 `/etc/litestream.yml`：

```yaml
# 数据库路径
dbs:
  - path: /var/www/myapp/database/database.sqlite
    replicas:
      # S3 备份
      - type: s3
        bucket: my-backups
        path: litestream/myapp-db
        endpoint: https://s3.ap-southeast-1.amazonaws.com
        region: ap-southeast-1
        access-key-id: ${AWS_ACCESS_KEY_ID}
        secret-access-key: ${AWS_SECRET_ACCESS_KEY}
        # 保留 7 天
        retention: 168h
        # 每 24 小时重新快照一次
        snapshot-interval: 24h
        # 上传前校验
        validation-interval: 200

      # 本地副本（可选，双重保障）
      - type: file
        path: /backup/myapp-db.litestream
        retention: 72h
```

### 环境变量方式（快速测试）

```bash
# 设置 AWS 凭据
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# 直接启动复制（不使用配置文件）
litestream replicate \
  /var/www/myapp/database/database.sqlite \
  s3://my-backups/litestream/myapp-db \
  -endpoint https://s3.ap-southeast-1.amazonaws.com \
  -region ap-southeast-1
```

### 使用 MinIO 本地测试

```bash
# 启动 MinIO
docker run -p 9000:9000 -p 9001:9001 \
  -v minio-data:/data \
  minio/minio server /data --console-address ":9001"

# 访问 http://localhost:9001 创建 bucket "mybkt"
# 默认凭据：minioadmin / minioadmin

# 设置环境变量
export LITESTREAM_ACCESS_KEY_ID=minioadmin
export LITESTREAM_SECRET_ACCESS_KEY=minioadmin

# 创建测试数据库
sqlite3 test.db "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);"
sqlite3 test.db "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');"

# 启动复制
litestream replicate test.db \
  s3://mybkt.localhost:9000/test.db \
  -endpoint http://localhost:9000

# 验证：在 MinIO 控制台查看是否生成了 test.db 目录
```

## 实战：Docker 部署（Sidecar 模式）

在 Docker Compose 中以 sidecar 模式部署 Litestream：

```yaml
version: "3.8"

services:
  app:
    image: php:8.2-fpm-alpine
    volumes:
      - app-data:/var/www/app
      - sqlite-data:/var/www/app/database
    environment:
      DB_CONNECTION: sqlite
      DB_DATABASE: /var/www/app/database/database.sqlite
    depends_on:
      - litestream

  litestream:
    image: litestream/litestream
    # 以 sidecar 方式运行，监控同一个 SQLite 文件
    entrypoint: >
      litestream replicate
      /var/www/app/database/database.sqlite
      s3://my-backups/litestream/app-db
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      LITESTREAM_S3_ENDPOINT: https://s3.ap-southeast-1.amazonaws.com
    volumes:
      - sqlite-data:/var/www/app/database:ro
    # 关键：共享同一存储卷，Litestream 只读取 WAL 文件
    # 不会修改数据库，不会干扰应用的写操作

  # 恢复时的临时容器
  litestream-restore:
    image: litestream/litestream
    entrypoint: >
      litestream restore
      -o /var/www/app/database/database.sqlite
      s3://my-backups/litestream/app-db
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      LITESTREAM_S3_ENDPOINT: https://s3.ap-southeast-1.amazonaws.com
    volumes:
      - sqlite-data:/var/www/app/database

volumes:
  app-data:
  sqlite-data:
```

### 使用配置文件的 Docker Compose

更推荐的方式是使用配置文件：

```yaml
version: "3.8"

services:
  app:
    image: php:8.2-fpm-alpine
    volumes:
      - sqlite-data:/var/www/app/database
      - ./litestream.yml:/etc/litestream.yml:ro
    environment:
      DB_CONNECTION: sqlite
      DB_DATABASE: /var/www/app/database/database.sqlite

  litestream:
    image: litestream/litestream
    entrypoint: litestream replicate -config /etc/litestream.yml
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    volumes:
      - sqlite-data:/var/www/app/database:ro
      - ./litestream.yml:/etc/litestream.yml:ro

volumes:
  sqlite-data:
```

## 实战：Systemd 部署

在裸机或 VPS 上用 Systemd 管理 Litestream：

```bash
# 创建 systemd 服务文件
sudo tee /etc/systemd/system/litestream.service > /dev/null << 'EOF'
[Unit]
Description=Litestream SQLite Replication
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/litestream replicate -config /etc/litestream.yml
Restart=always
RestartSec=10
User=www-data
Group=www-data

# 安全加固
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/www/app/database
ReadOnlyPaths=/etc/litestream.yml

# 资源限制
MemoryMax=256M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

# 重载 systemd 并启动
sudo systemctl daemon-reload
sudo systemctl enable litestream
sudo systemctl start litestream

# 检查状态
sudo systemctl status litestream

# 查看日志
sudo journalctl -u litestream -f
```

## 实战：灾难恢复操作

### 从 S3 恢复数据库

```bash
# 恢复到指定文件
litestream restore \
  -config /etc/litestream.yml \
  -o /var/www/app/database/database.sqlite.restored

# 恢复到原始路径（会覆盖）
litestream restore \
  -config /etc/litestream.yml \
  -o /var/www/app/database/database.sqlite

# 恢复到特定时间点（PITR）
litestream restore \
  -config /etc/litestream.yml \
  -timestamp "2026-06-09T18:00:00Z" \
  -o /var/www/app/database/database.sqlite
```

### 恢复脚本（自动化）

```bash
#!/bin/bash
# /usr/local/bin/restore-sqlite.sh
set -euo pipefail

DB_PATH="/var/www/app/database/database.sqlite"
BACKUP_PATH="${DB_PATH}.backup.$(date +%Y%m%d%H%M%S)"
CONFIG="/etc/litestream.yml"

echo "[$(date)] 开始数据库恢复..."

# 1. 备份当前数据库（以防万一）
if [ -f "$DB_PATH" ]; then
    cp "$DB_PATH" "$BACKUP_PATH"
    echo "[$(date)] 当前数据库已备份到: $BACKUP_PATH"
fi

# 2. 从 S3 恢复
litestream restore -config "$CONFIG" -o "$DB_PATH"

# 3. 验证数据库完整性
sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | grep -q "ok" || {
    echo "[$(date)] 错误: 数据库完整性检查失败"
    # 回滚到备份
    cp "$BACKUP_PATH" "$DB_PATH"
    exit 1
}

echo "[$(date)] 数据库恢复完成，完整性检查通过"
```

### PHP 应用中的恢复流程

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;

class SQLiteRecoveryService
{
    private string $dbPath;
    private string $litestreamConfig;

    public function __construct()
    {
        $this->dbPath = config('database.connections.sqlite.database');
        $this->litestreamConfig = config('services.litestream.config_path', '/etc/litestream.yml');
    }

    /**
     * 执行灾难恢复
     */
    public function restore(string $timestamp = null): bool
    {
        Log::warning('开始 SQLite 灾难恢复流程');

        // 1. 关闭当前数据库连接
        DB::purge('sqlite');

        // 2. 备份当前损坏的数据库
        $damagedBackup = $this->dbPath . '.damaged.' . date('YmdHis');
        if (file_exists($this->dbPath)) {
            copy($this->dbPath, $damagedBackup);
            Log::info("损坏的数据库已备份到: {$damagedBackup}");
        }

        // 3. 构建恢复命令
        $cmd = [
            'litestream', 'restore',
            '-config', $this->litestreamConfig,
            '-o', $this->dbPath,
        ];

        if ($timestamp) {
            $cmd[] = '-timestamp';
            $cmd[] = $timestamp;
        }

        // 4. 执行恢复
        $process = new Process($cmd);
        $process->setTimeout(300); // 5 分钟超时
        $process->run();

        if (!$process->isSuccessful()) {
            Log::error("恢复失败: {$process->getErrorOutput()}");
            // 尝试回滚
            if (file_exists($damagedBackup)) {
                copy($damagedBackup, $this->dbPath);
            }
            return false;
        }

        // 5. 验证数据库完整性
        $integrity = DB::select('PRAGMA integrity_check');
        if ($integrity[0]->integrity_check !== 'ok') {
            Log::error('数据库完整性检查失败');
            return false;
        }

        Log::info('SQLite 灾难恢复成功');
        return true;
    }

    /**
     * 检查 Litestream 复制状态
     */
    public function checkReplicationStatus(): array
    {
        $process = new Process([
            'litestream', 'databases',
            '-config', $this->litestreamConfig,
        ]);
        $process->run();

        return [
            'running' => $process->isSuccessful(),
            'output' => $process->getOutput(),
        ];
    }
}
```

## 实战：Laravel 集成

### 自定义 Litestream Artisan 命令

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class LitestreamRestore extends Command
{
    protected $signature = 'litestream:restore
                            {--timestamp= : 恢复到指定时间点 (ISO 8601)}
                            {--dry-run : 只检查不执行}';

    protected $description = '从 Litestream 备份恢复 SQLite 数据库';

    public function handle(): int
    {
        $timestamp = $this->option('timestamp');
        $dryRun = $this->option('dry-run');

        $dbPath = config('database.connections.sqlite.database');

        if ($dryRun) {
            $this->info("将会恢复数据库: {$dbPath}");
            if ($timestamp) {
                $this->info("恢复到时间点: {$timestamp}");
            }
            return self::SUCCESS;
        }

        if (!$this->confirm('确认恢复数据库？当前数据将被覆盖。')) {
            return self::FAILURE;
        }

        $this->info('开始恢复...');

        // 1. 停止队列 worker（如果有）
        $this->call('queue:restart');

        // 2. 关闭数据库连接
        DB::purge('sqlite');

        // 3. 备份当前数据库
        $backup = $dbPath . '.' . date('Y-m-d_His');
        copy($dbPath, $backup);
        $this->info("当前数据库已备份: {$backup}");

        // 4. 执行恢复
        $cmd = [
            'litestream', 'restore',
            '-config', '/etc/litestream.yml',
            '-o', $dbPath,
        ];

        if ($timestamp) {
            array_push($cmd, '-timestamp', $timestamp);
        }

        $process = new Process($cmd);
        $process->setTimeout(300);
        $process->run();

        if (!$process->isSuccessful()) {
            $this->error("恢复失败: {$process->getErrorOutput()}");
            // 回滚
            copy($backup, $dbPath);
            return self::FAILURE;
        }

        // 5. 验证
        $integrity = DB::select('PRAGMA integrity_check');
        if ($integrity[0]->integrity_check === 'ok') {
            $this->info('恢复成功，数据库完整性验证通过');
            return self::SUCCESS;
        }

        $this->error('数据库完整性检查失败');
        return self::FAILURE;
    }
}
```

### Cron 监控脚本

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class LitestreamMonitor extends Command
{
    protected $signature = 'litestream:monitor';
    protected $description = '监控 Litestream 复制状态并发送告警';

    public function handle(): int
    {
        $config = config('services.litestream');
        $alertEmail = $config['alert_email'] ?? 'admin@example.com';

        // 检查 Litestream 进程是否在运行
        $process = new \Symfony\Component\Process\Process(['pgrep', '-f', 'litestream']);
        $process->run();

        if (!$process->isSuccessful()) {
            Log::critical('Litestream 进程未运行！');

            // 尝试重启
            $restart = new \Symfony\Component\Process\Process(['sudo', 'systemctl', 'restart', 'litestream']);
            $restart->run();

            if ($restart->isSuccessful()) {
                Log::info('Litestream 已自动重启');
                $this->sendAlert($alertEmail, 'Litestream 已自动重启');
            } else {
                Log::critical('Litestream 重启失败');
                $this->sendAlert($alertEmail, 'Litestream 重启失败，请手动处理');
            }

            return self::FAILURE;
        }

        // 检查最后复制时间
        $dbPath = config('database.connections.sqlite.database');
        $walPath = $dbPath . '-wal';

        if (file_exists($walPath)) {
            $mtime = filemtime($walPath);
            $diff = time() - $mtime;

            if ($diff > 300) { // 5 分钟没有 WAL 更新
                Log::warning("WAL 文件超过 5 分钟未更新（{$diff} 秒前）");
            }
        }

        $this->info('Litestream 监控检查完成');
        return self::SUCCESS;
    }

    private function sendAlert(string $email, string $message): void
    {
        // 使用 Laravel 的 Mail 发送告警
        // Mail::to($email)->send(new LitestreamAlert($message));
    }
}
```

## 踩坑记录

### 踩坑 1：SQLite 并发写入限制

**问题**：SQLite 只支持一个写入者。当 Litestream 启动读事务时，虽然不阻止写入，但如果应用有多个写入进程，会出现 `SQLITE_BUSY` 错误。

**解决**：

```php
// 在 SQLite 连接中设置 busy timeout
DB::statement('PRAGMA busy_timeout=5000');

// 使用 IMMEDIATE 事务（默认行为）
DB::beginTransaction();
try {
    // 业务逻辑
    DB::commit();
} catch (\Exception $e) {
    DB::rollBack();
    throw $e;
}

// 或者使用 WAL 模式下的 concurrent reads
// WAL 模式允许一个写 + 多个读同时进行
```

### 踩坑 2：NFS / Docker 卷的 WAL 问题

**问题**：在 NFS 或某些 Docker 卷配置下，Litestream 无法正确读取 WAL 文件。

**解决**：

```yaml
# 确保 SQLite 数据库文件和 WAL 文件在同一文件系统
# 使用 Docker named volumes 而非 bind mounts

# 错误示例（可能导致问题）
volumes:
  - ./data:/var/www/app/database  # bind mount

# 正确示例
volumes:
  - sqlite-data:/var/www/app/database  # named volume
```

### 踩坑 3：恢复后数据库锁

**问题**：恢复数据库后，如果有其他进程持有数据库锁，恢复操作会失败。

**解决**：

```bash
#!/bin/bash
# 恢复前确保没有其他进程使用数据库

# 1. 停止应用服务
sudo systemctl stop php8.2-fpm

# 2. 停止队列 worker
php artisan queue:restart

# 3. 等待所有 worker 停止
sleep 10

# 4. 执行恢复
litestream restore -config /etc/litestream.yml -o /var/www/app/database/database.sqlite

# 5. 启动服务
sudo systemctl start php8.2-fpm
```

### 踩坑 4：S3 上传延迟

**问题**：Litestream 将 WAL 页面打包后上传，如果网络不稳定，可能导致复制延迟。

**解决**：

```yaml
dbs:
  - path: /var/www/app/database/database.sqlite
    replicas:
      - type: s3
        bucket: my-backups
        # 增加超时时间
        upload-timeout: 30s
        # 增加重试次数
        max-sync-buffer: 10MB
```

### 踩坑 5：大数据库恢复时间过长

**问题**：当数据库文件超过 1GB 时，恢复时间可能超过预期。

**解决**：

```bash
# 使用 WAL 级别的恢复（只恢复最近的 WAL）
# 这需要应用自己处理恢复前的逻辑

# 1. 只下载最新的快照和 WAL
litestream restore \
  -config /etc/litestream.yml \
  -o /tmp/restored.db

# 2. 验证数据
sqlite3 /tmp/restored.db "SELECT COUNT(*) FROM users;"

# 3. 替换
mv /tmp/restored.db /var/www/app/database/database.sqlite
```

## 总结

Litestream 为 SQLite 提供了企业级的灾难恢复能力，同时保持了极简的设计哲学：

**核心价值**：
- **零侵入**：不修改应用代码，通过 SQLite API 透明复制
- **流式复制**：RPO 接近零，不是定时快照
- **多后端**：S3、GCS、Azure、本地文件，灵活选择
- **原子恢复**：快照 + WAL 重放，保证数据一致性

**适用场景**：
- 个人项目、Side Project、MVP
- 内部工具、管理后台
- 边缘设备、IoT 数据采集
- 单用户或小团队的 SaaS

**最佳实践**：
1. 始终启用 WAL 模式
2. 设置合理的 busy_timeout
3. 使用命名卷而非 bind mount（Docker 环境）
4. 定期执行恢复演练
5. 监控 Litestream 进程和 WAL 文件时间戳

对于 PHP/Laravel 项目，SQLite + Litestream 是一个值得认真考虑的技术选型。当你不需要 MySQL/PostgreSQL 的复杂特性时，SQLite 的简单性加上 Litestream 的数据保障，能让你用最少的基础设施获得生产级的可靠性。

---

**参考资源**：
- [Litestream 官方文档](https://litestream.io/)
- [Litestream GitHub](https://github.com/benbjohnson/litestream)
- [SQLite WAL 模式文档](https://www.sqlite.org/wal.html)
