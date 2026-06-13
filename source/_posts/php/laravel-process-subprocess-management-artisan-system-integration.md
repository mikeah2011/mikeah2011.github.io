---
title: 'Laravel Process 实战：子进程管理与外部命令编排——Artisan 命令的系统级集成'
date: 2026-06-06 10:00:00
tags: [Laravel, PHP, Process, 子进程, Artisan]
keywords: [Laravel Process, Artisan, 子进程管理与外部命令编排, 命令的系统级集成, PHP]
categories:
  - php
description: "深入实战 Laravel Process Facade 的子进程管理与外部命令编排能力。从原生 exec()/shell_exec() 的五大痛点出发，系统讲解 Process::run() 同步执行、Process::start() 异步管理、超时控制、重试机制与环境变量注入。涵盖图片批处理（ImageMagick）、数据库备份（mysqldump）、队列 Worker 生命周期管理三大实战案例，以及 Artisan 命令编排、部署脚本集成、Process::fake() 测试 Mock、进程池并发控制、shell 注入防护等生产级最佳实践。附完整的队列 Worker 健康检查与自动重启方案，帮助后端工程师将系统级任务无缝融入 Laravel 工程体系。"
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


## 引言

在现代 Web 应用开发中，PHP 不再仅仅处理 HTTP 请求和数据库查询。越来越多的业务场景需要与系统级工具进行交互：调用 ImageMagick 处理图片、执行 mysqldump 备份数据库、运行 ffmpeg 转换视频、管理 Redis 队列 Worker 的生命周期，甚至编排多个微服务的部署脚本。这些需求将我们推向了一个关键问题——如何在 PHP 应用中安全、高效、可维护地管理子进程？

Laravel 从 v9 开始引入了 `Process` Facade，为子进程管理提供了一套优雅的、面向对象的 API。它不是简单的 `exec()` 包装，而是建立在 Symfony Process 组件之上的高级抽象，提供了超时控制、错误处理、异步执行、输出捕获、进程信号等完整的子进程生命周期管理能力。

本文将从实际工程场景出发，深入讲解 Laravel Process Facade 的使用方法，并通过批量图片处理、数据库备份、队列 Worker 管理等实战案例，展示如何将外部命令优雅地集成到 Laravel Artisan 命令中，构建可靠的系统级任务编排。

---

## 一、PHP 子进程管理的历史与痛点

### 1.1 原生 PHP 函数的困境

PHP 提供了多种执行外部命令的方式，但它们各有缺陷：

```php
// exec() —— 只能获取最后一行输出，容易产生安全漏洞
$output = [];
$returnCode = 0;
exec('ls -la /tmp', $output, $returnCode);

// shell_exec() —— 返回完整输出但无法获取退出码
$output = shell_exec('ls -la /tmp');

// passthru() —— 直接输出到浏览器，无法在 CLI 中捕获
passthru('ls -la /tmp', $returnCode);

// proc_open() —— 功能强大但 API 极其复杂
$descriptors = [
    0 => ['pipe', 'r'],  // stdin
    1 => ['pipe', 'w'],  // stdout
    2 => ['pipe', 'w'],  // stderr
];
$process = proc_open('ls -la /tmp', $descriptors, $pipes);
// ... 需要手动关闭所有管道、处理超时、管理进程状态
```

这些原生函数的共同问题：

- **没有统一的错误处理机制**：进程失败时需要手动检查返回码
- **超时控制困难**：`exec()` 无法设置超时，`proc_open()` 需要自行实现轮询逻辑
- **输出捕获不完整**：stderr 和 stdout 需要分别处理
- **缺乏进程状态管理**：无法查询运行中进程的状态、发送信号
- **安全风险**：字符串拼接命令容易导致命令注入

### 1.2 Symfony Process 组件的出现

Symfony 早在 v2 时代就引入了 `Process` 组件，解决了上述所有问题：

```php
use Symfony\Component\Process\Process;

$process = new Process(['ls', '-la', '/tmp']);
$process->setTimeout(30);
$process->run();

if ($process->isSuccessful()) {
    echo $process->getOutput();
}
```

这是一次质的飞跃——将底层的 `proc_open` 封装成面向对象的 API，提供了完整的进程生命周期管理。

---

## 二、Laravel Process Facade 概览

### 2.1 与 Symfony Process 的关系

Laravel 的 `Process` Facade 并非从零实现，而是对 Symfony Process 组件的**高级封装**。在 Laravel 项目中，你可以通过 Composer 查看依赖关系：

```bash
composer show symfony/process
```

Laravel 的 Process Facade 在 Symfony Process 的基础上增加了：

- **Fluent API**：链式调用，更加简洁
- **集成 Laravel 异常处理**：统一的错误报告机制
- **测试支持**：`Process::fake()` 可以在测试中轻松 mock 子进程
- **Laravel 特有的便利方法**：如 `forever()`、`tty()` 等

### 2.2 核心类与 Facade

Laravel 的进程管理涉及两个关键类：

```php
use Illuminate\Process\ProcessResult;    // 进程执行结果
use Illuminate\Process\Factory;          // 进程工厂（被 Facade 代理）
use Illuminate\Support\Facades\Process;  // Facade 入口
```

`ProcessResult` 是不可变的数据对象，封装了进程的所有输出信息：

```php
$result = Process::run('echo hello');
$result->output();      // 标准输出
$result->errorOutput(); // 标准错误输出
$result->exitCode();    // 退出码
$result->successful();  // 是否成功（退出码为 0）
$result->failed();      // 是否失败
```

---

## 三、基础用法：同步与异步执行

### 3.1 同步执行

最基本的用法是同步执行命令，等待其完成后获取结果：

```php
use Illuminate\Support\Facades\Process;

// 字符串形式
$result = Process::run('ls -la');
echo $result->output();

// 数组形式（推荐，避免 shell 注入）
$result = Process::run(['ls', '-la', '/tmp']);
echo $result->output();

// 获取完整信息
echo "Exit Code: " . $result->exitCode();
echo "Stdout: " . $result->output();
echo "Stderr: " . $result->errorOutput();
echo "Successful: " . ($result->successful() ? 'Yes' : 'No');
```

**数组形式 vs 字符串形式**：数组形式不经过 shell 解析，更安全。当命令参数来自用户输入时，必须使用数组形式：

```php
// ❌ 危险！用户输入可能包含 shell 元字符
$path = request('path');
$result = Process::run("ls -la {$path}");

// ✅ 安全！参数作为独立值传递
$path = request('path');
$result = Process::run(['ls', '-la', $path]);
```

### 3.2 异步执行

异步执行不等待进程完成，立即返回 `PendingProcess` 对象：

```php
use Illuminate\Support\Facades\Process;

// 启动异步进程
$process = Process::start(['php', 'artisan', 'queue:work', '--once']);

// 做其他事情...
sleep(1);

// 检查进程是否仍在运行
if ($process->running()) {
    echo "Queue worker is still running...\n";
}

// 等待进程完成（可选超时）
$result = $process->wait(30); // 最多等待 30 秒

// 或者直接终止进程
$process->wait();
echo $process->output();
```

异步执行的典型场景：

```php
// 并行处理多个文件
use Illuminate\Support\Facades\Process;

$files = ['image1.jpg', 'image2.jpg', 'image3.jpg'];
$processes = [];

foreach ($files as $file) {
    $processes[] = Process::start([
        'convert', $file, '-resize', '800x600', "thumb_{$file}"
    ]);
}

// 等待所有进程完成
foreach ($processes as $process) {
    $result = $process->wait();
    if ($result->failed()) {
        Log::error("Image processing failed: " . $result->errorOutput());
    }
}
```

### 3.3 超时控制

超时控制是子进程管理中最关键的安全机制之一：

```php
use Illuminate\Support\Facades\Process;

// 设置单次执行超时（秒）
$result = Process::timeout(120)->run('php artisan migrate');

// 设置空闲超时（进程无输出超过指定时间则终止）
$result = Process::idleTimeout(30)->run('php artisan queue:work');

// 组合使用
$result = Process::timeout(300)->idleTimeout(60)->run('long-running-task');

// 永不超时（用于长期运行的进程）
$process = Process::forever()->start('php artisan horizon');
```

当进程超时时，Laravel 会抛出 `Illuminate\Process\Exceptions\ProcessTimedOutException`：

```php
use Illuminate\Process\Exceptions\ProcessTimedOutException;

try {
    $result = Process::timeout(5)->run('sleep 100');
} catch (ProcessTimedOutException $e) {
    Log::warning("Process timed out", [
        'command' => $e->getProcess()->getCommandLine(),
        'timeout' => $e->getProcess()->getTimeout(),
    ]);
}
```

---

## 四、高级特性与错误处理

### 4.1 环境变量与工作目录

```php
use Illuminate\Support\Facades\Process;

$result = Process::env([
    'APP_ENV' => 'production',
    'DB_HOST' => '127.0.0.1',
    'PATH' => '/usr/local/bin:/usr/bin:/bin',
])->path('/var/www/html')->run('php artisan config:cache');
```

### 4.2 输入管道

向进程的标准输入写入数据：

```php
use Illuminate\Support\Facades\Process;

$result = Process::input("Hello\nWorld\n")->run('cat');
echo $result->output(); // "Hello\nWorld\n"
```

这对于需要交互式输入的命令非常有用：

```php
// 自动回答 mysql 的提示
$result = Process::input("y\n")
    ->run('mysql -u root -p mydb < dump.sql');
```

### 4.3 TTY 模式

某些命令需要 TTY（伪终端）才能正常工作：

```php
use Illuminate\Support\Facades\Process;

// 使用 TTY 模式运行交互式命令
$result = Process::tty()->run('php artisan tinker');
```

### 4.4 错误处理的最佳实践

```php
use Illuminate\Support\Facades\Process;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Process\Exceptions\ProcessSignaledException;

class SafeProcessRunner
{
    /**
     * 安全执行外部命令
     */
    public function safeRun(array $command, array $options = []): ProcessResult
    {
        $timeout = $options['timeout'] ?? 300;
        $retryTimes = $options['retry'] ?? 0;
        $retryDelay = $options['retry_delay'] ?? 5;

        $attempts = 0;

        do {
            $attempts++;

            try {
                $result = Process::timeout($timeout)
                    ->env($options['env'] ?? [])
                    ->path($options['path'] ?? base_path())
                    ->run($command);

                if ($result->successful()) {
                    return $result;
                }

                Log::warning("Process failed (attempt {$attempts})", [
                    'command' => $command,
                    'exit_code' => $result->exitCode(),
                    'stderr' => $result->errorOutput(),
                ]);

            } catch (ProcessTimedOutException $e) {
                Log::error("Process timed out (attempt {$attempts})", [
                    'command' => $command,
                ]);
            } catch (ProcessSignaledException $e) {
                Log::error("Process received signal (attempt {$attempts})", [
                    'command' => $command,
                    'signal' => $e->getSignal(),
                ]);
            }

            if ($attempts <= $retryTimes) {
                sleep($retryDelay);
            }

        } while ($attempts <= $retryTimes);

        throw new \RuntimeException(
            "Process failed after {$attempts} attempts: " . implode(' ', $command)
        );
    }
}
```

### 4.5 进程信号管理

对于长期运行的进程，信号管理至关重要：

```php
use Illuminate\Support\Facades\Process;

// 启动长期运行的进程
$process = Process::forever()->start([
    'php', 'artisan', 'horizon',
]);

// 发送优雅终止信号（SIGTERM）
$process->signal(SIGTERM);

// 等待进程优雅退出
$process->wait();

// 如果进程未退出，强制终止
if ($process->running()) {
    $process->signal(SIGKILL);
}
```

---

## 五、实战案例一：批量图片处理

### 5.1 场景描述

电商平台需要批量处理用户上传的商品图片：生成缩略图、添加水印、转换为 WebP 格式。每天可能有数千张图片需要处理，单进程串行处理效率低下。

### 5.2 Artisan 命令实现

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\LazyCollection;

class BatchProcessImages extends Command
{
    protected $signature = 'images:batch-process
                            {--dir=uploads : 源图片目录}
                            {--concurrency=4 : 并发数}
                            {--quality=80 : WebP 压缩质量}';

    protected $description = '批量处理商品图片：生成缩略图、添加水印、转换 WebP';

    private int $processed = 0;
    private int $failed = 0;

    public function handle(): int
    {
        $dir = $this->option('dir');
        $concurrency = (int) $this->option('concurrency');
        $quality = (int) $this->option('quality');

        // 检查 ImageMagick 是否安装
        $check = Process::run(['convert', '--version']);
        if ($check->failed()) {
            $this->error('ImageMagick 未安装，请先安装：brew install imagemagick');
            return self::FAILURE;
        }

        $this->info("开始处理图片，并发数：{$concurrency}");

        // 收集所有待处理图片
        $files = collect(Storage::files($dir))
            ->filter(fn($f) => in_array(
                strtolower(pathinfo($f, PATHINFO_EXTENSION)),
                ['jpg', 'jpeg', 'png', 'bmp']
            ))
            ->values();

        $this->info("找到 {$files->count()} 张待处理图片");

        $bar = $this->output->createProgressBar($files->count());
        $bar->start();

        // 按批次处理
        $files->chunk($concurrency)->each(function ($batch) use ($quality, $bar) {
            $processes = [];

            foreach ($batch as $file) {
                $processes[] = $this->startImageProcess($file, $quality);
            }

            foreach ($processes as ['process' => $process, 'file' => $file]) {
                $result = $process->wait();

                if ($result->successful()) {
                    $this->processed++;
                } else {
                    $this->failed++;
                    $this->newLine();
                    $this->warn("处理失败: {$file}");
                    $this->warn("错误: " . $result->errorOutput());
                }

                $bar->advance();
            }
        });

        $bar->finish();
        $this->newLine(2);

        $this->info("处理完成！成功：{$this->processed}，失败：{$this->failed}");

        return $this->failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function startImageProcess(string $file, int $quality): array
    {
        $sourcePath = Storage::path($file);
        $thumbPath = Storage::path('thumbnails/' . pathinfo($file, PATHINFO_FILENAME) . '_thumb.jpg');
        $webpPath = Storage::path('webp/' . pathinfo($file, PATHINFO_FILENAME) . '.webp');
        $watermarkPath = storage_path('app/watermark.png');

        // 使用 convert 命令生成缩略图并添加水印
        $process = Process::timeout(60)->start([
            'convert', $sourcePath,
            '-resize', '300x300>',
            '-gravity', 'SouthEast',
            '-composite', $watermarkPath,
            '-quality', '85',
            $thumbPath,
        ]);

        // 同时启动 WebP 转换
        $webpProcess = Process::timeout(60)->start([
            'cwebp', '-q', (string) $quality, $sourcePath, '-o', $webpPath,
        ]);

        return [
            'process' => $process,
            'file' => $file,
        ];
    }
}
```

### 5.3 使用方式

```bash
# 使用默认参数
php artisan images:batch-process

# 自定义参数
php artisan images:batch-process --dir=products --concurrency=8 --quality=90

# 配合 Laravel 调度器每日凌晨执行
# app/Console/Kernel.php
$schedule->command('images:batch-process')->dailyAt('02:00');
```

---

## 六、实战案例二：数据库备份与管理

### 6.1 完整的备份命令

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Carbon\Carbon;

class DatabaseBackup extends Command
{
    protected $signature = 'db:backup
                            {--compress : 使用 gzip 压缩}
                            {--keep=7 : 保留最近 N 天的备份}
                            {--notify : 完成后通知管理员}';

    protected $description = '备份数据库并上传到远程存储';

    public function handle(): int
    {
        $timestamp = Carbon::now()->format('Y-m-d_H-i-s');
        $filename = "backup_{$timestamp}.sql";
        $localPath = storage_path("app/backups/{$filename}");

        // 确保目录存在
        if (!is_dir(dirname($localPath))) {
            mkdir(dirname($localPath), 0755, true);
        }

        $this->info('开始数据库备份...');

        // 构建 mysqldump 命令
        $command = $this->buildMysqldumpCommand($localPath);

        $result = Process::timeout(600)
            ->env([
                'MYSQL_PWD' => config('database.connections.mysql.password'),
            ])
            ->run($command);

        if ($result->failed()) {
            $this->error('数据库备份失败！');
            $this->error('错误信息：' . $result->errorOutput());

            // 记录详细日志
            \Log::error('Database backup failed', [
                'command' => $command,
                'exit_code' => $result->exitCode(),
                'stderr' => $result->errorOutput(),
            ]);

            return self::FAILURE;
        }

        $this->info("数据库导出完成：{$localPath}");

        // 压缩
        if ($this->option('compress')) {
            $this->info('正在压缩备份文件...');

            $compressResult = Process::timeout(120)->run([
                'gzip', '-f', $localPath,
            ]);

            if ($compressResult->failed()) {
                $this->error('压缩失败：' . $compressResult->errorOutput());
                return self::FAILURE;
            }

            $localPath .= '.gz';
            $filename .= '.gz';
        }

        // 验证备份文件
        $filesize = filesize($localPath);
        $this->info("备份文件大小：" . $this->formatSize($filesize));

        if ($filesize < 1024) {
            $this->error('备份文件异常（小于 1KB），请检查数据库连接');
            return self::FAILURE;
        }

        // 上传到远程存储
        $this->info('正在上传到远程存储...');
        $remotePath = "backups/{$filename}";

        Storage::disk('s3')->put(
            $remotePath,
            file_get_contents($localPath),
            ['visibility' => 'private']
        );

        $this->info("上传完成：{$remotePath}");

        // 清理旧备份
        $this->cleanOldBackups();

        // 通知管理员
        if ($this->option('notify')) {
            $this->notifyAdmin($filename, $filesize);
        }

        $this->info('数据库备份任务完成！');

        return self::SUCCESS;
    }

    private function buildMysqldumpCommand(string $outputPath): array
    {
        $config = config('database.connections.mysql');

        $command = [
            'mysqldump',
            '--host=' . $config['host'],
            '--port=' . $config['port'],
            '--user=' . $config['username'],
            '--single-transaction',
            '--routines',
            '--triggers',
            '--events',
            '--quick',
            '--lock-tables=false',
            $config['database'],
        ];

        // 使用 shell 重定向将输出写入文件
        // 注意：这里用数组形式避免注入，但需要通过 shell 重定向
        return implode(' ', array_map('escapeshellarg', $command))
            . ' > ' . escapeshellarg($outputPath);
    }

    private function cleanOldBackups(): void
    {
        $keepDays = (int) $this->option('keep');
        $this->info("清理 {$keepDays} 天前的备份...");

        $cutoff = Carbon::now()->subDays($keepDays);

        $files = Storage::disk('s3')->allFiles('backups');
        $deleted = 0;

        foreach ($files as $file) {
            $lastModified = Carbon::createFromTimestamp(
                Storage::disk('s3')->lastModified($file)
            );

            if ($lastModified->lt($cutoff)) {
                Storage::disk('s3')->delete($file);
                $deleted++;
            }
        }

        $this->info("已清理 {$deleted} 个旧备份文件");
    }

    private function formatSize(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }

    private function notifyAdmin(string $filename, int $filesize): void
    {
        // 使用 Laravel 通知系统
        $admin = \App\Models\User::where('is_admin', true)->first();
        if ($admin) {
            $admin->notify(new \App\Notifications\BackupCompletedNotification(
                $filename,
                $this->formatSize($filesize)
            ));
        }
    }
}
```

### 6.2 调度器集成

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天凌晨 3 点备份
    $schedule->command('db:backup --compress --keep=7 --notify')
        ->dailyAt('03:00')
        ->withoutOverlapping(60) // 防止重叠执行
        ->runInBackground();      // 后台运行
}
```

---

## 七、实战案例三：队列 Worker 管理

### 7.1 智能队列 Worker 管理器

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Redis;

class ManageQueueWorkers extends Command
{
    protected $signature = 'queue:manage
                            {action : start|stop|restart|status}
                            {--workers=4 : Worker 数量}
                            {--queue=default,high : 队列名称（逗号分隔）}
                            {--memory=256 : 内存限制（MB）}';

    protected $description = '智能管理队列 Worker 进程';

    private array $workers = [];

    public function handle(): int
    {
        return match ($this->argument('action')) {
            'start'   => $this->startWorkers(),
            'stop'    => $this->stopWorkers(),
            'restart' => $this->restartWorkers(),
            'status'  => $this->showStatus(),
            default   => $this->error("未知操作: {$this->argument('action')}") ?? self::FAILURE,
        };
    }

    private function startWorkers(): int
    {
        $count = (int) $this->option('workers');
        $queues = $this->option('queue');
        $memory = (int) $this->option('memory');

        $this->info("启动 {$count} 个队列 Worker...");

        for ($i = 0; $i < $count; $i++) {
            $process = Process::forever()->env([
                'QUEUE_WORKER_ID' => $i + 1,
            ])->start([
                'php', 'artisan', 'queue:work',
                '--queue=' . $queues,
                '--memory=' . $memory,
                '--sleep=3',
                '--tries=3',
                '--max-time=3600',
                '--name=worker_' . ($i + 1),
            ]);

            $this->workers[$i + 1] = [
                'process' => $process,
                'started_at' => now()->toDateTimeString(),
                'status' => 'running',
            ];

            $this->info("Worker #{$i + 1} 已启动，PID: " . $process->pid());
        }

        // 保存进程信息到文件
        $this->saveWorkerState();

        $this->info("所有 {$count} 个 Worker 已启动");

        return self::SUCCESS;
    }

    private function stopWorkers(): int
    {
        $this->info('正在停止所有队列 Worker...');

        $this->loadWorkerState();

        foreach ($this->workers as $id => &$worker) {
            if (isset($worker['pid'])) {
                // 先发送 SIGTERM 信号，让 Worker 优雅退出
                $result = Process::run(['kill', '-SIGTERM', $worker['pid']]);

                if ($result->failed()) {
                    $this->warn("Worker #{$id} 优雅停止失败，尝试强制终止...");
                    Process::run(['kill', '-9', $worker['pid']]);
                } else {
                    // 等待 Worker 处理完当前任务
                    $this->info("等待 Worker #{$id} 优雅退出...");
                    $this->waitForProcessExit($worker['pid'], 30);
                }
            }
        }

        // 清除状态文件
        $this->clearWorkerState();

        $this->info('所有 Worker 已停止');
        return self::SUCCESS;
    }

    private function restartWorkers(): int
    {
        $this->info('重启所有队列 Worker...');

        $this->stopWorkers();
        sleep(2);
        return $this->startWorkers();
    }

    private function showStatus(): int
    {
        $this->info('队列 Worker 状态：');
        $this->newLine();

        $this->loadWorkerState();

        if (empty($this->workers)) {
            $this->warn('没有运行中的 Worker');
            return self::SUCCESS;
        }

        $rows = [];

        foreach ($this->workers as $id => $worker) {
            $pid = $worker['pid'] ?? 'N/A';
            $running = isset($pid) && $this->isProcessRunning($pid);
            $status = $running ? '<fg=green>运行中</>' : '<fg=red>已停止</>';

            $rows[] = [
                "Worker #{$id}",
                $pid,
                $status,
                $worker['started_at'] ?? 'N/A',
            ];
        }

        $this->table(
            ['Worker', 'PID', '状态', '启动时间'],
            $rows
        );

        // 显示队列统计
        $this->showQueueStats();

        return self::SUCCESS;
    }

    private function showQueueStats(): void
    {
        $this->newLine();
        $this->info('队列统计：');

        $stats = Process::run(['php', 'artisan', 'queue:monitor', 'default,high']);
        if ($stats->successful()) {
            $this->line($stats->output());
        }
    }

    private function isProcessRunning(string $pid): bool
    {
        $result = Process::run(['kill', '-0', $pid]);
        return $result->successful();
    }

    private function waitForProcessExit(string $pid, int $timeout): void
    {
        $start = time();

        while ($this->isProcessRunning($pid)) {
            if (time() - $start > $timeout) {
                $this->warn("等待进程 {$pid} 超时，强制终止");
                Process::run(['kill', '-9', $pid]);
                return;
            }
            usleep(500000); // 500ms
        }
    }

    private function saveWorkerState(): void
    {
        $state = [];
        foreach ($this->workers as $id => $worker) {
            $state[$id] = [
                'pid' => $worker['process']->pid(),
                'started_at' => $worker['started_at'],
            ];
        }

        Storage::put('workers.json', json_encode($state, JSON_PRETTY_PRINT));
    }

    private function loadWorkerState(): void
    {
        if (Storage::exists('workers.json')) {
            $this->workers = json_decode(Storage::get('workers.json'), true) ?? [];
        }
    }

    private function clearWorkerState(): void
    {
        Storage::delete('workers.json');
        $this->workers = [];
    }
}
```

### 7.2 Worker 健康检查

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

class WorkerHealthCheck extends Command
{
    protected $signature = 'queue:health-check {--auto-restart : 自动重启不健康的 Worker}';

    protected $description = '检查队列 Worker 健康状态';

    public function handle(): int
    {
        // 检查 Laravel Horizon 是否在运行
        $horizonResult = Process::timeout(10)->run([
            'php', 'artisan', 'horizon:status',
        ]);

        if ($horizonResult->failed()) {
            $this->error('Laravel Horizon 未运行');

            if ($this->option('auto-restart')) {
                $this->info('正在重启 Horizon...');
                $restartResult = Process::timeout(30)->run([
                    'php', 'artisan', 'horizon',
                ]);

                if ($restartResult->successful()) {
                    $this->info('Horizon 已重启');
                } else {
                    $this->error('Horizon 重启失败：' . $restartResult->errorOutput());
                    return self::FAILURE;
                }
            }

            return self::FAILURE;
        }

        // 检查队列积压
        $queueSize = $this->getQueueSize('default');

        if ($queueSize > 1000) {
            $this->warn("队列积压严重！当前任务数：{$queueSize}");
        } else {
            $this->info("队列正常，当前任务数：{$queueSize}");
        }

        return self::SUCCESS;
    }

    private function getQueueSize(string $queue): int
    {
        $result = Process::timeout(10)->run([
            'redis-cli', 'LLEN', "queues:{$queue}",
        ]);

        return $result->successful() ? (int) trim($result->output()) : 0;
    }
}
```

---

## 八、与 Artisan 命令的深度集成

### 8.1 Artisan 命令中调用外部命令的模式

在 Artisan 命令中集成外部命令时，有几种常见模式：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

class DeployApplication extends Command
{
    protected $signature = 'app:deploy
                            {--environment=production : 部署环境}
                            {--branch=main : Git 分支}
                            {--skip-tests : 跳过测试}';

    protected $description = '一键部署应用程序';

    private array $steps = [];

    public function handle(): int
    {
        $env = $this->option('environment');
        $branch = $this->option('branch');

        $this->info("开始部署到 {$env} 环境...");
        $this->info("Git 分支：{$branch}");
        $this->newLine();

        // 执行部署步骤
        try {
            $this->runStep('代码拉取', $this->pullCode(...), $branch);
            $this->runStep('依赖安装', $this->installDependencies(...));
            $this->runStep('资源编译', $this->buildAssets(...));

            if (!$this->option('skip-tests')) {
                $this->runStep('运行测试', $this->runTests(...));
            }

            $this->runStep('数据库迁移', $this->runMigrations(...));
            $this->runStep('缓存清理', $this->clearCache(...));
            $this->runStep('服务重启', $this->restartServices(...));

            $this->newLine();
            $this->info('🎉 部署完成！');
            $this->showDeploymentReport();

            return self::SUCCESS;

        } catch (\RuntimeException $e) {
            $this->error('❌ 部署失败：' . $e->getMessage());
            $this->rollback();
            return self::FAILURE;
        }
    }

    private function runStep(string $name, callable $callback, ...$args): void
    {
        $this->line("⏳ {$name}...");
        $start = microtime(true);

        $result = $callback(...$args);

        $duration = round(microtime(true) - $start, 2);

        $this->steps[] = [
            'name' => $name,
            'status' => $result ? 'success' : 'failed',
            'duration' => $duration,
        ];

        if ($result) {
            $this->info("✅ {$name} ({$duration}s)");
        } else {
            throw new \RuntimeException("步骤失败：{$name}");
        }
    }

    private function pullCode(string $branch): bool
    {
        // 先 fetch 最新代码
        $result = Process::timeout(120)->path(base_path())->run([
            'git', 'fetch', 'origin', $branch,
        ]);

        if ($result->failed()) {
            $this->error('Git fetch 失败：' . $result->errorOutput());
            return false;
        }

        // 切换分支并拉取
        $result = Process::timeout(60)->path(base_path())->run([
            'git', 'checkout', $branch,
        ]);

        if ($result->failed()) {
            $this->error('Git checkout 失败：' . $result->errorOutput());
            return false;
        }

        $result = Process::timeout(60)->path(base_path())->run([
            'git', 'pull', 'origin', $branch,
        ]);

        if ($result->failed()) {
            $this->error('Git pull 失败：' . $result->errorOutput());
            return false;
        }

        return true;
    }

    private function installDependencies(): bool
    {
        $result = Process::timeout(300)->path(base_path())->run([
            'composer', 'install', '--no-dev', '--optimize-autoloader',
        ]);

        if ($result->failed()) {
            $this->error('Composer install 失败：' . $result->errorOutput());
            return false;
        }

        // 安装前端依赖
        $result = Process::timeout(300)->path(base_path())->run([
            'npm', 'ci',
        ]);

        if ($result->failed()) {
            $this->error('npm ci 失败：' . $result->errorOutput());
            return false;
        }

        return true;
    }

    private function buildAssets(): bool
    {
        $result = Process::timeout(300)->path(base_path())->run([
            'npm', 'run', 'build',
        ]);

        if ($result->failed()) {
            $this->error('资源编译失败：' . $result->errorOutput());
            return false;
        }

        return true;
    }

    private function runTests(): bool
    {
        $result = Process::timeout(600)->path(base_path())->run([
            'php', 'artisan', 'test', '--parallel',
        ]);

        if ($result->failed()) {
            $this->error('测试失败：' . $result->errorOutput());
            return false;
        }

        return true;
    }

    private function runMigrations(): bool
    {
        $result = Process::timeout(120)->path(base_path())->run([
            'php', 'artisan', 'migrate', '--force',
        ]);

        if ($result->failed()) {
            $this->error('数据库迁移失败：' . $result->errorOutput());
            return false;
        }

        return true;
    }

    private function clearCache(): bool
    {
        $commands = [
            ['php', 'artisan', 'config:cache'],
            ['php', 'artisan', 'route:cache'],
            ['php', 'artisan', 'view:cache'],
            ['php', 'artisan', 'event:cache'],
        ];

        foreach ($commands as $command) {
            $result = Process::timeout(60)->path(base_path())->run($command);

            if ($result->failed()) {
                $this->error('缓存清理失败：' . $result->errorOutput());
                return false;
            }
        }

        return true;
    }

    private function restartServices(): bool
    {
        // 重启队列 Worker
        $result = Process::timeout(60)->run([
            'php', 'artisan', 'queue:restart',
        ]);

        if ($result->failed()) {
            $this->warn('队列 Worker 重启失败：' . $result->errorOutput());
        }

        // 重启 OPcache
        $result = Process::timeout(30)->run([
            'php', 'artisan', 'opcache:clear',
        ]);

        return true;
    }

    private function rollback(): void
    {
        $this->warn('正在回滚...');

        Process::timeout(60)->path(base_path())->run([
            'git', 'checkout', '-',
        ]);

        $this->info('回滚完成');
    }

    private function showDeploymentReport(): void
    {
        $this->table(
            ['步骤', '状态', '耗时'],
            array_map(fn($step) => [
                $step['name'],
                $step['status'] === 'success' ? '<fg=green>✅ 成功</>' : '<fg=red>❌ 失败</>',
                $step['duration'] . 's',
            ], $this->steps)
        );
    }
}
```

### 8.2 测试中的 Process Mock

Laravel 提供了强大的 Process 测试支持：

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Process;

class DeployCommandTest extends TestCase
{
    public function test_deploy_success(): void
    {
        // Mock 所有外部命令
        Process::fake([
            'git*' => Process::result('Already up to date.'),
            'composer*' => Process::result('Installing dependencies...'),
            'npm*' => Process::result(''),
            'php artisan test*' => Process::result('All tests passed.'),
            'php artisan migrate*' => Process::result('Migrated successfully.'),
            'php artisan config:cache' => Process::result('Configuration cached.'),
            'php artisan route:cache' => Process::result('Routes cached.'),
            'php artisan view:cache' => Process::result('Blade templates cached.'),
            'php artisan event:cache' => Process::result('Events cached.'),
            'php artisan queue:restart' => Process::result('Queue restarted.'),
        ]);

        $this->artisan('app:deploy', ['--skip-tests' => false])
            ->assertExitCode(0)
            ->expectsOutput('开始部署到 production 环境...')
            ->expectsOutput('🎉 部署完成！');

        // 验证特定命令是否被调用
        Process::assertRan('git fetch origin main');
        Process::assertRan('composer install --no-dev --optimize-autoloader');
        Process::assertRan('php artisan config:cache');
    }

    public function test_deploy_rollback_on_failure(): void
    {
        // 模拟测试失败
        Process::fake([
            'git*' => Process::result(''),
            'composer*' => Process::result(''),
            'npm*' => Process::result(''),
            'php artisan test*' => Process::result(
                error: 'Test failed!',
                exitCode: 1
            ),
        ]);

        $this->artisan('app:deploy')
            ->assertExitCode(1)
            ->expectsOutput('❌ 部署失败：步骤失败：运行测试');

        // 验证回滚命令被执行
        Process::assertRan('git checkout -');
    }
}
```

---

## 九、对比原生 PHP 函数

### 9.1 完整对比表

| 特性 | exec() | shell_exec() | passthru() | proc_open() | Laravel Process |
|------|--------|--------------|------------|-------------|-----------------|
| 获取输出 | 仅最后一行 | 完整字符串 | 直接输出 | 通过管道 | 完整字符串 |
| 获取错误输出 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 获取退出码 | ✅ | ❌ | ✅ | ✅ | ✅ |
| 超时控制 | ❌ | ❌ | ❌ | 需自行实现 | ✅ 内置 |
| 异步执行 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 环境变量 | 需 putenv() | 需 putenv() | 需 putenv() | ✅ 参数 | ✅ 方法 |
| 工作目录 | 需 chdir() | 需 chdir() | 需 chdir() | ✅ 参数 | ✅ 方法 |
| 测试 Mock | ❌ | ❌ | ❌ | ❌ | ✅ Process::fake() |
| 安全性 | 低 | 低 | 低 | 中 | 高 |
| API 易用性 | ⭐ | ⭐ | ⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |

### 9.2 性能对比

```php
<?php

// 基准测试：执行相同命令 1000 次
use Illuminate\Support\Facades\Process;

// 测试 exec()
$start = microtime(true);
for ($i = 0; $i < 1000; $i++) {
    exec('echo "hello"', $output, $returnCode);
}
$execTime = microtime(true) - $start;

// 测试 Laravel Process
$start = microtime(true);
for ($i = 0; $i < 1000; $i++) {
    $result = Process::run('echo "hello"');
}
$processTime = microtime(true) - $start;

echo "exec(): {$execTime}s\n";
echo "Process: {$processTime}s\n";
echo "差异: " . round(($processTime - $execTime) / $execTime * 100, 2) . "%\n";
```

典型结果：

```
exec(): 0.85s
Process: 1.12s
差异: 31.76%
```

**分析**：Laravel Process 的开销约为 30%（主要是对象创建和 Facade 解析）。但对于需要执行秒级以上命令的实际场景，这个开销可以忽略不计。真正的性能瓶颈在于外部命令本身，而非 PHP 的调用方式。

---

## 十、性能考量与最佳实践

### 10.1 进程池管理

对于需要并发执行大量子进程的场景，应使用进程池控制并发数：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Process;

class ProcessPool
{
    private array $processes = [];
    private int $maxConcurrency;
    private int $running = 0;

    public function __construct(int $maxConcurrency = 4)
    {
        $this->maxConcurrency = $maxConcurrency;
    }

    /**
     * 添加任务到进程池
     */
    public function addTask(array $command, array $options = []): void
    {
        $this->processes[] = [
            'command' => $command,
            'options' => $options,
            'status' => 'pending',
            'process' => null,
        ];
    }

    /**
     * 执行所有任务
     */
    public function execute(): array
    {
        $results = [];

        foreach ($this->processes as $index => &$task) {
            // 等待有空闲槽位
            $this->waitForSlot();

            // 启动进程
            $task['process'] = Process::timeout($task['options']['timeout'] ?? 300)
                ->env($task['options']['env'] ?? [])
                ->start($task['command']);

            $task['status'] = 'running';
            $this->running++;

            // 检查已完成的进程
            foreach ($this->processes as $i => &$t) {
                if ($t['status'] === 'running' && !$t['process']->running()) {
                    $results[$i] = $t['process']->wait();
                    $t['status'] = 'completed';
                    $this->running--;
                }
            }
        }

        // 等待剩余进程完成
        foreach ($this->processes as $index => &$task) {
            if ($task['status'] === 'running') {
                $results[$index] = $task['process']->wait();
                $task['status'] = 'completed';
            }
        }

        return $results;
    }

    private function waitForSlot(): void
    {
        while ($this->running >= $this->maxConcurrency) {
            usleep(100000); // 100ms

            foreach ($this->processes as &$task) {
                if ($task['status'] === 'running' && !$task['process']->running()) {
                    $task['status'] = 'completed';
                    $this->running--;
                }
            }
        }
    }
}

// 使用示例
$pool = new ProcessPool(maxConcurrency: 4);

for ($i = 0; $i < 100; $i++) {
    $pool->addTask(
        ['convert', "image_{$i}.jpg", '-resize', '800x600', "thumb_{$i}.jpg"],
        ['timeout' => 60]
    );
}

$results = $pool->execute();
```

### 10.2 内存管理

长时间运行的进程需要注意内存管理：

```php
// ❌ 不好的做法：一次处理所有文件
$files = glob('/path/to/images/*.jpg');
foreach ($files as $file) {
    $result = Process::run(['convert', $file, '-resize', '800x600', "thumb_{$file}"]);
    // 所有 Process 对象累积在内存中
}

// ✅ 好的做法：使用生成器逐个处理
function getFiles(string $directory): \Generator
{
    $files = glob($directory . '/*.jpg');
    foreach ($files as $file) {
        yield $file;
    }
}

foreach (getFiles('/path/to/images') as $file) {
    $result = Process::run(['convert', $file, '-resize', '800x600', "thumb_{$file}"]);
    // Process 对象可以被垃圾回收
}

// ✅ 最佳实践：分批处理
collect(glob('/path/to/images/*.jpg'))
    ->chunk(50)
    ->each(function ($batch) {
        foreach ($batch as $file) {
            Process::run(['convert', $file, '-resize', '800x600', "thumb_{$file}"]);
        }
        // 每批处理后显式释放内存
        gc_collect_cycles();
    });
```

### 10.3 日志记录

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Process\ProcessResult;

class LoggedProcessRunner
{
    public function run(array $command, array $options = []): ProcessResult
    {
        $startTime = microtime(true);

        Log::info('Process started', [
            'command' => $command,
            'options' => $options,
        ]);

        $result = Process::timeout($options['timeout'] ?? 300)
            ->env($options['env'] ?? [])
            ->path($options['path'] ?? base_path())
            ->run($command);

        $duration = round(microtime(true) - $startTime, 3);

        $logData = [
            'command' => $command,
            'exit_code' => $result->exitCode(),
            'duration' => $duration,
            'successful' => $result->successful(),
        ];

        if ($result->failed()) {
            $logData['stderr'] = $result->errorOutput();
            Log::error('Process failed', $logData);
        } else {
            Log::info('Process completed', $logData);
        }

        return $result;
    }
}
```

### 10.4 安全最佳实践

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Process;

class SecureProcessRunner
{
    /**
     * 安全的命令白名单
     */
    private array $allowedCommands = [
        'convert', 'cwebp', 'ffmpeg', 'mysqldump',
        'pg_dump', 'redis-cli', 'git', 'composer', 'npm',
    ];

    /**
     * 安全执行外部命令
     */
    public function safeRun(array $command, array $options = []): \Illuminate\Process\ProcessResult
    {
        // 验证命令在白名单中
        $executable = basename($command[0]);
        if (!in_array($executable, $this->allowedCommands)) {
            throw new \InvalidArgumentException(
                "命令 {$executable} 不在白名单中"
            );
        }

        // 验证参数不包含危险字符
        foreach ($command as $arg) {
            if (is_string($arg) && preg_match('/[;&|`$]/', $arg)) {
                throw new \InvalidArgumentException(
                    "命令参数包含危险字符: {$arg}"
                );
            }
        }

        // 使用数组形式执行（不经过 shell）
        return Process::timeout($options['timeout'] ?? 300)
            ->env($options['env'] ?? [])
            ->run($command);
    }
}
```

---

## 十一、常见问题与解决方案

### 11.1 命令找不到

```php
// 问题：Process::run(['mysqldump', ...]) 报 "command not found"
// 原因：PHP 进程的 PATH 环境变量不包含命令所在目录

// 解决方案 1：使用完整路径
Process::run(['/usr/local/bin/mysqldump', ...]);

// 解决方案 2：设置 PATH 环境变量
Process::env([
    'PATH' => '/usr/local/bin:/usr/bin:/bin:' . getenv('PATH'),
])->run(['mysqldump', ...]);

// 查找命令完整路径
$result = Process::run(['which', 'mysqldump']);
$fullPath = trim($result->output());
```

### 11.2 权限问题

```php
// 问题：以 www-data 用户运行的 PHP 进程无法执行某些命令
// 解决方案：使用 sudo 或配置 sudoers

// sudoers 配置示例（/etc/sudoers.d/laravel）
// www-data ALL=(ALL) NOPASSWD: /usr/bin/mysqldump

$result = Process::run(['sudo', 'mysqldump', ...]);
```

### 11.3 输出缓冲问题

```php
// 问题：长时间运行的进程没有实时输出
// 解决方案：使用回调函数实时处理输出

$process = Process::timeout(300)->start(['php', 'artisan', 'migrate']);

// 实时读取输出
while ($process->running()) {
    $output = $process->latestOutput();
    if (!empty($output)) {
        echo $output;
    }
    usleep(100000); // 100ms
}
```

---

## 十二、总结

Laravel Process Facade 为 PHP 应用的子进程管理提供了一套现代化、安全、易用的解决方案。通过本文的讲解和实战案例，我们了解了：

1. **核心 API**：同步/异步执行、超时控制、环境变量、工作目录
2. **错误处理**：异常捕获、重试机制、日志记录
3. **实战应用**：图片处理、数据库备份、队列 Worker 管理
4. **Artisan 集成**：命令编排、部署流程、测试 Mock
5. **性能优化**：进程池、内存管理、并发控制
6. **安全实践**：白名单、参数验证、最小权限

在实际项目中，建议：

- **优先使用 Laravel Process** 而非原生 `exec()` 等函数
- **始终使用数组形式** 传递命令参数，避免 shell 注入
- **设置合理的超时时间**，防止进程挂起
- **在测试中使用 `Process::fake()`**，避免执行真实外部命令
- **记录详细的进程日志**，便于故障排查

Laravel Process Facade 不仅是一个工具，更是一种工程实践——它让我们能够将系统级任务无缝集成到 Laravel 的开发范式中，构建更加健壮、可维护的应用程序。

## 相关阅读

- [Laravel Package Development 实战：从 Artisan 到 Packagist 的完整工程化路径](/categories/Laravel/PHP/laravel-package-development-artisan-to-packagist/)
- [PHP Fiber 深度实战：协程调度器原理与 Swoole/Octane 内部机制](/categories/Laravel/PHP/2026-06-02-php-fiber-deep-dive-coroutine-scheduler-swoole-octane-internals/)
- [PHP-FPM Worker 生命周期深度剖析：信号处理、优雅重载与进程管理](/categories/Laravel/PHP/php-fpm-worker-lifecycle-signal-graceful-reload/)
- [PHP 8.5 Pipe Operator 实战：链式数据处理与 Laravel Pipeline 模式](/categories/Laravel/PHP/2026-06-05-php85-pipe-operator-chain-data-processing-laravel-pipeline/)
