---
title: 'Laravel Forge vs Ploi vs Deployer 实战：三种部署方案深度对比——自动化运维、队列管理与多环境治理的选型决策'
date: 2026-06-06 12:00:00
description: '深入对比 Laravel Forge、Ploi、Deployer 三大 Laravel 部署方案的服务器配置、零停机部署、队列管理、多环境治理、SSL 证书、数据库备份与监控告警能力，结合生产级代码示例与选型决策矩阵，帮助团队做出最适合的部署方案对比与技术选型决策。'
tags: [Laravel Forge, Ploi, Deployer, 部署, DevOps, Laravel]
categories:
  - devops
cover: /images/covers/forge-ploi-deployer-comparison-cover.jpg
---

在 Laravel 生态系统中，部署方案的选择往往决定了团队的运维效率与项目的可维护性。从 Laravel Forge 的全托管面板、Ploi 的现代云运维体验，到 Deployer 的极致可编程性，三条路径各有所长，也各有取舍。本文将从实际项目经验出发，深入对比三种部署方案在服务器配置、零停机部署、队列管理、多环境治理、SSL 证书、数据库备份、监控告警及团队协作等方面的能力，帮助你做出最适合团队和项目阶段的选型决策。

<!-- more -->

## 一、三种工具概览

### 1.1 Laravel Forge——Laravel 之父亲自打造的部署平台

Laravel Forge 由 Taylor Otwell 创建，是最早且最知名的 Laravel 服务器管理与部署平台。自 2014 年发布以来，Forge 已经成为 Laravel 社区中最广泛使用的基础设施管理工具之一。它本质上是一个**服务器即服务（Server-as-a-Service）**控制面板，用户通过 Web 界面配置 DigitalOcean、AWS、Linode、Vultr、Hetzner 等云服务商的 VPS，Forge 通过 SSH 连接到目标服务器，自动完成 Nginx、PHP、MySQL、Redis、Node.js、Composer 等全部组件的安装与配置。整个过程通常只需要几分钟，即使是没有 Linux 运维经验的 PHP 开发者，也能快速搭建起一台生产级别的 Web 服务器。

Forge 的设计哲学是"约定优于配置"——它为 Laravel 应用做了大量默认优化，比如 Nginx 的 `fastcgi_cache` 配置、PHP-FPM 的进程管理参数、MySQL 的查询缓存设置等。这些默认值基于社区的最佳实践和 Taylor 的长期运维经验，对于大多数中小型项目来说已经足够优秀。如果你有特殊需求，也可以在站点级别自定义 Nginx 配置、PHP 版本以及各种参数。

值得注意的是，Forge 并不是传统意义上的"部署工具"——它更像是一个全面的服务器运维平台。除了代码部署之外，Forge 还处理数据库管理、SSH 密钥管理、防火墙配置、PHP-FPM 进程监控等运维层面的工作。这种"一站式"的设计理念使得 Forge 成为中小团队的理想选择，因为开发者不需要在多个工具之间来回切换。

**定价：**
- Hobby：$12/月，管理 1 台服务器
- Pro：$24/月，无限服务器 + 多用户协作
- Business：$48/月，优先支持 + Webhook + 通知渠道

**核心特性：** 服务器自动化配置、一键站点创建、Git Push 部署、Let's Encrypt SSL、队列管理、计划任务、数据库备份到 S3、部署通知（Slack/Discord/邮件）、多用户团队。

### 1.2 Ploi——后来居上的现代运维平台

Ploi 由荷兰开发者 Dennis Smink 创建，定位为"更好的 Forge"。自 2019 年发布以来，Ploi 凭借其现代化的界面设计、更丰富的功能集成和更频繁的更新节奏，迅速在 Laravel 社区中获得了大量拥趸。它在 UI/UX、功能深度和云服务商集成上做了大量改进，尤其在零停机部署、健康检查、多环境管理等方面超越了 Forge 的原生能力。

Ploi 的一个显著优势在于其对零停机部署的原生支持。不同于 Forge 需要手动编写脚本来实现 symlink 切换模式，Ploi 将零停机部署作为默认选项内置在部署流程中。这意味着只要你勾选一个复选框，就能获得与 Deployer 相同水平的部署原子性保障。此外，Ploi 的健康检查机制可以在部署后自动验证应用状态，如果检测到异常则立即触发自动回滚，极大地降低了发布风险。

在云服务商支持方面，Ploi 同样表现出色。除了 Forge 支持的主流云平台之外，Ploi 还原生支持 Hetzner、OVH、Vultr 等欧洲市场常用的 VPS 提供商，甚至支持"自带服务器"（BYOS）模式——你可以将任何已有的 Linux 服务器接入 Ploi 管理面板。这种灵活性使得 Ploi 在国际化团队和混合云架构中具有明显优势。

**定价：**
- Starter：€10/月，1 台服务器
- Pro：€22/月，无限服务器 + 协作
- Unlimited：€44/月，全部功能 + 优先支持

**核心特性：** 与 Forge 类似的基础能力 + 零停机部署（原生内置）、健康检查端点验证、多 PHP 版本切换、内置数据库备份调度器、自定义部署脚本模板、WP-CLI 支持（对 WordPress 友好）、更丰富的 API、IO 插件生态。

### 1.3 Deployer——PHP 界的 Capistrano

Deployer 是一个开源的 PHP 部署工具（MIT 协议），由俄罗斯开发者 Anton Medvedev 创建和维护，目前在 GitHub 上拥有超过 10,000 颗星。Deployer 完全以 PHP 代码（recipe）定义部署流程，所有的部署逻辑都是可编程的、可版本化的、可代码审查的。它不依赖任何 SaaS 服务，完全运行在你自己的 CI/CD 环境或开发者终端中。

Deployer 的核心设计理念是"Capistrano for PHP"——借鉴了 Ruby 社区 Capistrano 的 symlink 发布模式，将每次部署创建为一个独立的 release 目录，然后通过原子 symlink 切换来实现零停机发布。这种模式已经被证明是 Web 应用部署的最佳实践之一，几乎所有的现代部署工具（包括 Forge 和 Ploi 的零停机功能）都采用了这一模式。

Deployer 最大的优势在于其极致的可编程性。你可以用 PHP 代码定义任意复杂的部署流程，包括条件判断、循环、错误处理、异步任务等。这意味着无论你的部署需求多么特殊——比如需要在部署过程中进行数据库 schema 兼容性检查、多阶段数据库迁移、灰度发布、金丝雀发布等——Deployer 都能完美胜任。此外，Deployer 内置了 Laravel、Symfony、WordPress、Drupal、Magento、Yii2 等几十种框架的开箱即用配方，对于 Laravel 项目来说，只需要几行配置就能启动零停机部署。

在多服务器场景下，Deployer 的并行部署能力是其杀手级特性。当你有多台应用服务器时，Deployer 可以同时向所有服务器发起 SSH 连接并并行执行部署任务，大幅缩短部署时间。这对于高流量应用和微服务架构来说至关重要——想象一下，你需要在 30 秒内将新版本同步到 10 台服务器上，只有 Deployer 能做到这一点。

**定价：** 完全免费开源。Deployer Pro（商业版）提供 Deployer Cloud 托管面板，$10/月起，但核心 CLI 工具永久免费。

**核心特性：** 零停机部署（symlink 切换模式）、原子回滚、并行执行、SSH 多服务器编排、内置 Laravel recipe、可自定义任意复杂流程、与任何 CI/CD 系统集成。

---

## 二、服务器配置与管理

### 2.1 Forge 的服务器配置

Forge 采用"一键配置"模式：在 Forge 面板中选择云服务商、服务器规格、PHP 版本、数据库类型等几个选项后，点击创建按钮，Forge 就会通过 SSH 连接到目标服务器，自动执行一系列脚本来安装和配置所有必要的组件。这个过程通常需要 5-10 分钟，完成后你会得到一台完全配置好的生产服务器。Forge 自动安装的组件包括：

```
Nginx (最新稳定版)
PHP-FPM 8.2/8.3/8.4
MySQL 8.0 / MariaDB / PostgreSQL
Redis 7.x
Node.js + NPM (可选)
Supervisor (队列 Worker)
Composer 2.x
UFW 防火墙
```

Forge 的配置是**声明式**的——你选择选项，Forge 执行脚本。如果你想自定义 Nginx 配置，可以在站点级别编辑，但不能自由编排整个配置流程。这种设计的优点是简单、安全，对于大多数项目来说已经足够。但缺点也很明显：当你有非常特殊的服务器配置需求时（比如需要安装自定义的系统服务、配置内核参数、设置复杂的网络规则等），Forge 的灵活性就显得不足了。在团队中，初级运维工程师可以轻松驾驭 Forge，但有经验的 DevOps 工程师可能会觉得受到限制。

### 2.2 Ploi 的服务器配置

Ploi 的服务器配置流程与 Forge 非常相似，但在细节上做了大量优化，提供了更细粒度的控制。Ploi 的服务器创建界面设计得更加现代化，信息层次更清晰，对于云服务商的资源类型和规格展示了更完整的列表。它提供的细粒度控制包括：

- 支持在创建服务器时选择**预安装软件包**（Meilisearch、MinIO、RabbitMQ 等）
- 提供"自定义脚本"钩子，允许在服务器配置的**每个阶段**注入自定义命令
- 内置服务器安全加固选项（自动更新、fail2ban 配置）

### 2.3 Deployer 的服务器配置

Deployer **不负责服务器配置**——这是它的核心哲学。Deployer 的设计理念是"单一职责"：它只专注于做好代码部署这一件事，而将服务器配置交给更专业的工具。Deployer 假设服务器已经准备好（PHP 已安装、Nginx 已配置、数据库已就绪），它只负责将代码从 Git 仓库拉取到服务器上，并通过 symlink 切换实现零停机发布。因此，Deployer 通常需要配合 Ansible、Terraform、Chef、Puppet 或上述面板工具来完成基础设施层的工作。

这种设计在实际项目中的好处是明显的：服务器配置和代码部署是两个关注点完全不同的工作。服务器配置变更的频率很低（通常只在扩容、升级、安全补丁时进行），而代码部署的频率很高（可能每天多次）。将两者解耦后，你可以用最适合的工具分别处理这两个关注点，避免任何一方的变更影响到另一方。这正是现代 DevOps 实践中"关注点分离"原则的最佳体现。

当然，Deployer 的 `provision` task 允许你在需要时将服务器配置也纳入版本控制，但这通常只适用于简单场景：

但你可以用 Deployer 的 `provision` task 来扩展：

```php
// deploy.php
task('provision', function () {
    run('apt-get update');
    run('apt-get install -y nginx php8.3-fpm php8.3-mysql redis-server');
    run('systemctl enable php8.3-fpm nginx redis-server');
    // ... 更多配置
})->desc('Provision server');
```

> **结论：** 如果你不想写任何服务器配置脚本，Forge 和 Ploi 是显而易见的选择。Deployer 更适合已经有一套成熟的基础设施配置体系（如 Ansible + Terraform）的团队。

---

## 三、部署工作流——零停机与回滚

这是三种工具差异最显著的地方，也是我们在项目中进行选型时最需要仔细评估的维度。零停机部署（Zero-Downtime Deployment）意味着在代码更新的过程中，用户不会感知到任何服务中断或错误页面。这在面向 C 端用户的互联网产品中至关重要——每一次服务中断都意味着用户流失和收入损失。回滚能力则是在部署出现问题时的"救命稻草"，一个可靠的回滚机制可以将故障恢复时间从小时级降低到秒级。

接下来，我们分别看看三种工具在这方面的具体表现。

### 3.1 Forge 的部署流程

Forge 使用经典的 **Git Pull + Composer Install + Artisan 命令**模式：

```bash
cd /home/forge/example.com
git pull origin main
composer install --no-interaction --prefer-dist --optimize-autoloader --no-dev
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan queue:restart
```

**问题：** Forge 的默认部署流程**不是零停机的**。在 `git pull` 执行到 `composer install` 完成之间的窗口期内，网站可能因为缺少依赖而返回 500 错误。这个窗口期的长短取决于 Composer 依赖的数量和服务器的网络状况，通常在 10-60 秒之间。对于个人项目或内部系统来说，这个短暂的服务中断可能可以接受；但对于面向公众的生产级应用来说，这是一个严重的问题。

虽然你可以通过自定义脚本实现零停机（手动创建 release 目录、执行 symlink 切换），但 Forge 不提供原生的零停机部署机制，需要你对 Linux 文件系统操作和 symlink 管理有相当深入的理解才能正确实现。在实际项目中，很多开发者尝试自己写零停机脚本时会踩到各种坑——比如 storage 目录权限问题、`.env` 文件不共享、缓存文件路径错误等。

**回滚：** Forge 支持通过部署历史记录触发"重新部署"某个旧版本，但这实际上是重新执行一次 `git checkout <commit>` + `composer install`，不是原子性的回滚操作。回滚过程本身也可能导致短暂的服务中断。

### 3.2 Ploi 的零停机部署

Ploi 原生内置了零停机部署，这是 Ploi 相比 Forge 最大的卖点之一。其核心机制基于经典的 symlink 切换模式，完整的部署流程如下：

```
1. git clone 到新目录：releases/20260606120000/
2. composer install --no-dev
3. php artisan config:cache / route:cache / view:cache
4. php artisan storage:link
5. 原子 symlink 切换：ln -sfn releases/20260606120000 current
6. php artisan migrate --force
7. php artisan queue:restart
8. 清理旧 releases（保留最近 N 个）
```

Ploi 还内置了**健康检查**机制——在 symlink 切换完成后，Ploi 会自动向配置的健康检查端点（如 `/api/health` 或 `/up`）发送 HTTP 请求。如果返回的 HTTP 状态码不是 200，Ploi 会立即将 symlink 切换回上一个 release，实现自动回滚。这个机制对于生产环境来说非常重要，因为它能够在用户完全无感知的情况下，自动处理由于代码缺陷导致的部署失败。

在实际使用中，建议结合 Laravel 内置的健康检查功能来实现更完善的健康检查策略。Laravel 10+ 提供了 `/up` 路由，当应用启动成功时返回 200；你还可以在 `App\Http\Controllers\HealthCheckController` 中添加数据库连接、Redis 连接、队列 Worker 状态等更深层次的健康检查逻辑。这样，Ploi 的健康检查就能覆盖更多的故障场景。

### 3.3 Deployer 的零停机部署

Deployer 是零停机部署的"教科书级"实现，也是目前 PHP 社区中最成熟的零停机部署方案。它的 Laravel recipe 开箱即用，只需要极少的配置就能启动完整的零停机部署流程：

```php
// deploy.php
namespace Deployer;

require 'recipe/laravel.php';
require 'recipe/slack.php';  // 可选：Slack 通知

// 服务器配置
host('production')
    ->set('hostname', 'your-server.com')
    ->set('remote_user', 'forge')
    ->set('deploy_path', '/var/www/example.com')
    ->set('branch', 'main');

// 项目配置
set('repository', 'git@github.com:your-org/your-app.git');
set('keep_releases', 5);
set('shared_files', ['.env']);
set('shared_dirs', ['storage', 'node_modules']);
set('writable_dirs', ['bootstrap/cache', 'storage']);

// Slack 通知（可选）
set('slack_webhook', 'https://hooks.slack.com/services/xxx');

// 自定义任务：队列重启
task('queue:restart', function () {
    run('cd {{release_path}} && php artisan queue:restart');
});

// 部署流程
task('deploy', [
    'deploy:prepare',
    'deploy:vendors',
    'deploy:publish',
    'artisan:migrate',
    'artisan:config:cache',
    'artisan:route:cache',
    'artisan:view:cache',
    'artisan:storage:link',
    'queue:restart',
    'deploy:cleanup',
]);

// 回滚任务
task('rollback', [
    'deploy:rollback',
]);
```

Deployer 的 `deploy:prepare` 任务是整个部署流程的起点，它自动完成以下操作：
- 在远端创建 `releases/<timestamp>/` 目录
- `git clone` 到该目录
- 创建 `shared/` 目录（存放 `.env`、`storage/`）
- 安装 Composer 依赖

`deploy:publish` 任务是整个流程的关键步骤，它自动完成：
- 创建 symlink：`current -> releases/<latest>`
- 设置权限

这种设计保证了**在任何一步失败时，旧版本的 `current` symlink 不受影响**，已经在线上运行的应用不会出现任何异常。唯一的副作用是磁盘空间的占用——每部署一次就会创建一个新的 release 目录，但 Deployer 的 `deploy:cleanup` 任务会自动清理旧的 release，默认保留最近 5 个。这既保证了快速回滚的能力，又避免了磁盘空间的无限增长。

Deployer 的回滚操作同样简单高效——只需要执行 `dep rollback` 命令，Deployer 会将 `current` symlink 指向前一个 release，整个过程是原子性的，耗时不到 1 秒。回滚后，你仍然需要执行 `php artisan queue:restart` 来让 Worker 加载新（旧）版本的代码。

**并行部署多台服务器：**

```bash
dep deploy production --parallel -o worker_count=4
```

Deployer 可以同时向多台应用服务器部署，这在 Forge 和 Ploi 中需要额外的负载均衡器配置。

---

## 四、队列管理与计划任务

### 4.1 Forge 的队列与 Scheduler

Forge 通过 Supervisor 管理 Laravel 队列 Worker。Supervisor 是 Linux 系统上最常用的进程管理工具，它能够确保 Worker 进程在崩溃后自动重启。Forge 提供了一个简洁的 Web 界面来管理 Supervisor 配置，操作步骤如下：

1. 进入站点 → Queue 选项卡
2. 选择 Connection（redis/sqs/database 等）
3. 选择 Queue 名称（default, high, low）
4. 设置 Worker 数量（默认 3）
5. 设置 Max Tries 和 Max Time

Forge 生成的 Supervisor 配置：

```ini
[program:example-com-default-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /home/forge/example.com/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=forge
numprocs=3
redirect_stderr=true
stdout_logfile=/home/forge/example.com/worker.log
stopwaitsecs=3600
```

Scheduler 的配置非常简单——Forge 在创建站点时会自动添加 Cron 条目，这是 Forge 最贴心的细节之一：

```cron
* * * * * cd /home/forge/example.com && php artisan schedule:run >> /dev/null 2>&1
```

**局限：** Forge 的队列管理是基础级别的，适合中小型项目，但对于高流量应用来说可能不够用。具体来说，你无法：
- 按队列名称分别配置不同数量的 Worker
- 设置内存限制的自动重启策略
- 查看队列积压情况或 Worker 运行状态

如果需要更高级的队列监控，需要配合 Laravel Horizon（Horizon 需要 Redis 驱动）。

### 4.2 Ploi 的队列管理

Ploi 的队列管理比 Forge 更灵活，提供了更丰富的配置选项和更精细的控制能力。以下是 Ploi 在队列管理方面的主要优势：

- 支持为不同的 Queue 分别创建 Worker 配置（如 `default` 用 3 个 Worker，`high` 用 5 个）
- 支持设置 `--memory` 限制（Worker 内存超限自动重启）
- 支持 `--max-jobs` 和 `--max-time` 策略
- 内置 Horizon 管理支持——可以直接在面板中启动/停止 Horizon

Ploi 的 Scheduler 配置与 Forge 类似，但提供了更完善的管理界面和额外功能：

- 自定义 Cron 表达式
- 多个 Scheduler 条目
- Cron 执行的超时控制

### 4.3 Deployer 的队列与 Scheduler

Deployer 本身不管理 Supervisor 进程——它在部署时负责重启队列 Worker 以加载新代码，但不负责进程的持续守护和监控。这种设计遵循了 Deployer 的"单一职责"原则：进程管理应该交给 Supervisor、systemd 或 PM2 等专用工具。在实际项目中，通常的做法是在服务器的 Supervisor 配置中定义 Worker，然后在 Deployer 的部署流程中添加重启任务：

```php
// deploy.php 中添加任务
task('supervisor:restart', function () {
    run('sudo supervisorctl restart all');
    // 或更精细地：
    run('sudo supervisorctl restart laravel-worker:*');
});

task('deploy', [
    // ... 其他任务
    'supervisor:restart',
    'deploy:cleanup',
]);
```

对于 Scheduler，Deployer 通常配合 CI/CD 或服务器的系统 Cron 来实现。一个优雅的做法是在 `provision` 任务中配置 Cron，将调度器的配置也纳入版本控制管理：

```php
task('provision:scheduler', function () {
    $cronLine = "* * * * * cd {{deploy_path}}/current && php artisan schedule:run >> /dev/null 2>&1";
    run("echo '$cronLine' | crontab -");
});
```

**如果团队使用 Deployer + Laravel Horizon：** Laravel Horizon 是一个基于 Redis 的队列管理仪表盘，它提供了队列积压监控、Job 处理速度统计、失败任务分析等高级功能。在使用 Deployer 时，Horizon 的重启需要特别注意——由于 Horizon 是一个常驻进程（不像普通的 `queue:work` 可以由 Supervisor 管理），你需要在部署后主动终止它，让 Supervisor 自动重启并加载新代码：

```php
task('horizon:restart', function () {
    run('cd {{release_path}} && php artisan horizon:terminate');
});
```

`horizon:terminate` 会优雅地停止当前的 Horizon 进程，Supervisor 会自动重启它（指向新的 `current` release），确保零停机。

---

## 五、多环境支持

### 5.1 Forge 的多环境方案

Forge 支持为同一个 Git 仓库创建多个站点（staging、production），每个站点独立配置部署分支和环境变量。

**典型部署结构如下表所示：**

| 环境 | 服务器 | 站点 | 分支 | 数据库 |
|------|--------|------|------|--------|
| Production | prod-server | app.example.com | main | app_prod |
| Staging | staging-server | staging.example.com | develop | app_staging |

Forge 的局限：**staging 环境通常需要单独的服务器**，这意味着额外的服务器成本。虽然你可以在同一台服务器上创建多个站点指向不同分支，但数据库和配置的隔离不够干净。在同一台服务器上运行 Production 和 Staging 可能会导致资源竞争——比如一个压力测试脚本可能会拖慢 Production 站点的响应速度。此外，Forge 没有提供环境之间的配置同步功能，你需要手动确保两个环境的 Nginx 配置、PHP 设置等保持一致。

### 5.2 Ploi 的多环境方案

Ploi 的多环境支持比 Forge 更成熟，在产品设计上做了大量针对多环境场景的优化。Ploi 的开发者显然深入理解了开发者在管理多个环境时遇到的实际痛点，并在产品层面提供了解决方案。以下是其核心优势：

- **环境管理器（Site Environments）：** 允许将多个站点关联为同一个项目的不同环境，统一管理
- **环境变量同步：** 可以从 production 的 `.env` 同步变量到 staging（排除敏感值）
- **一键创建 staging：** 从 production 数据库快速创建 staging 数据库副本

### 5.3 Deployer 的多环境方案

Deployer 天然支持多环境管理，而且这是其最引以为豪的特性之一。Deployer 的多环境管理是完全声明式的——环境定义跟随代码仓库，任何时候都可以查看某个环境的历史配置，这比通过 Web 界面手动操作要可靠得多。只需在 `deploy.php` 中定义不同的 host group：

```php
// deploy.php
host('production')
    ->set('hostname', 'prod-server.com')
    ->set('deploy_path', '/var/www/app')
    ->set('branch', 'main')
    ->set('env', [
        'APP_ENV' => 'production',
        'APP_DEBUG' => 'false',
    ]);

host('staging')
    ->set('hostname', 'staging-server.com')
    ->set('deploy_path', '/var/www/app')
    ->set('branch', 'develop')
    ->set('env', [
        'APP_ENV' => 'staging',
        'APP_DEBUG' => 'true',
    ]);

// 环境特定任务
task('deploy:staging', [
    'deploy',
    'artisan:migrate',
    'artisan:db:seed',  // staging 环境自动 seed
]);

task('deploy:production', [
    'deploy',
    'artisan:migrate',
]);
```

部署命令：

```bash
dep deploy production   # 部署到生产环境
dep deploy staging      # 部署到测试环境
dep rollback production # 回滚生产环境
```

Deployer 的多环境方案是**声明式的、版本化的**——环境定义跟随代码仓库，任何时候都可以查看某个环境的历史配置。这种设计的优点在于：环境配置的变更与代码变更一起经历 Code Review、CI 测试、版本标签等完整的开发流程，极大地降低了"人在面板上误操作"的风险。此外，Deployer 还支持在 host group 之间共享任务，避免重复代码——比如 "部署前备份数据库" 这个任务只需要写一次，就能在所有环境中复用。Deployer 还支持通过 `-o` 参数传递运行时选项，实现环境级别的配置覆盖，这种灵活性是基于面板的工具难以实现的。

---

## 六、SSL 证书管理

### 6.1 Forge 和 Ploi

两者都内置了 Let's Encrypt 自动化：

- 一键申请 Let's Encrypt 证书
- 自动续期（通过 Cron 或 systemd timer）
- 支持 Wildcard 证书（需要 DNS API 验证）
- 支持上传自定义证书

Ploi 在 SSL 证书管理方面比 Forge 更全面，额外支持以下功能：
- Cloudflare Origin CA 证书自动部署
- 自动 HTTPS 重定向配置

### 6.2 Deployer

Deployer 本身不管理 SSL 证书，这与其"单一职责"的设计哲学一致。在实际项目中，使用 Deployer 的团队通常采用以下三种方式之一来处理 SSL 证书：

1. **使用 Caddy 作为反向代理**——Caddy 自动管理 Let's Encrypt 证书
2. **在 provision 阶段用 certbot：**

```php
task('provision:ssl', function () {
    run('apt-get install -y certbot python3-certbot-nginx');
    run('certbot --nginx -d {{hostname}} --non-interactive --agree-tos --email admin@example.com');
});

// 续期 cron
task('provision:ssl-renew', function () {
    run("echo '0 3 * * * certbot renew --quiet --post-hook \"systemctl reload nginx\"' | crontab -");
});
```

3. **配合 Forge/Ploi——** 很多团队使用 Forge 或 Ploi 管理服务器和 SSL，但用 Deployer 处理部署流程，取两者之长。

---

## 七、数据库备份策略

### 7.1 Forge 的备份

Forge 提供原生的数据库备份功能：

- 支持 MySQL / PostgreSQL
- 备份目标：S3 / S3 兼容存储（DigitalOcean Spaces、MinIO、Backblaze B2）
- 自动调度：每天/每周/自定义
- 保留策略：保留最近 N 个备份
- 手动触发备份

**局限：** Forge 的备份功能覆盖了基本需求，但对于数据量较大的应用来说，存在一些明显的不足：不支持增量备份（每次都是全量备份，对于大型数据库来说耗时较长且占用存储空间）、不支持 Point-in-Time Recovery（PITR，即无法将数据库恢复到某个特定的精确时间点）、不支持加密备份文件（如果备份存储在第三方云服务上，可能存在数据泄露风险）。对于数据安全要求较高的金融、医疗等行业应用来说，这些局限可能会成为合规性审查的障碍。

### 7.2 Ploi 的备份

Ploi 的备份功能在 Forge 的基础上做了显著增强，解决了 Forge 在备份管理方面的多个痛点。无论是备份的灵活性、安全性还是可观测性，Ploi 都提供了更全面的解决方案：

- 支持所有 Forge 的备份能力
- 额外支持 **自定义备份脚本钩子**（备份前/后执行自定义命令）
- 备份文件压缩（gzip/lz4）
- 备份文件加密（可选 AES-256）
- 备份状态通知（成功/失败 → Slack/邮件）
- 支持备份到多个目标位置

### 7.3 Deployer 的备份

Deployer 不提供备份功能，但可以在部署流程中集成：

```php
task('db:backup', function () {
    $timestamp = date('Y-m-d_H-i-s');
    $filename = "backup_{{hostname}}_{$timestamp}.sql.gz";
    run("mysqldump -u root {{database}} | gzip > /tmp/{$filename}");
    run("aws s3 cp /tmp/{$filename} s3://my-backups/{$filename}");
    run("rm /tmp/{$filename}");
})->desc('Backup database before deployment');
```

**最佳实践：** 在部署前自动执行数据库备份：

```php
task('deploy', [
    'deploy:prepare',
    'db:backup',           // 部署前备份
    'deploy:vendors',
    'deploy:publish',
    'artisan:migrate',
    // ...
]);
```

---

## 八、监控与告警

### 8.1 Forge 的监控

Forge 的监控能力较为基础，但覆盖了最核心的需求。作为一个以服务器管理为核心的平台，Forge 的监控重点放在了基础设施层面：

- **服务器监控：** CPU、内存、磁盘使用率（面板图表）
- **站点监控：** 部署状态（成功/失败）
- **告警：** 磁盘空间不足邮件通知

Forge 不提供应用层监控，这在实际项目中是一个明显的短板。当生产环境出现 500 错误、API 响应时间异常或队列积压时，Forge 的面板上不会显示任何相关信息，你需要登录 Sentry 或 New Relic 才能获得这些信息。这意味着在使用 Forge 时，你的运维工具链至少需要两个以上的系统来覆盖不同层面的监控需求，增加了运维复杂度。

### 8.2 Ploi 的监控

Ploi 的监控能力显著优于 Forge，在多个维度上提供了更全面、更深入的监控覆盖。Ploi 的监控设计体现了"内置优于外挂"的理念，将很多通常需要第三方工具才能实现的功能直接集成到了面板中，使得开发者可以在一个界面中同时查看服务器状态和应用健康状况：

- **服务器监控：** CPU、内存、磁盘、网络 I/O（更详细的图表）
- **健康检查：** HTTP 健康端点定期探测（可配置频率和超时）
- **进程监控：** Supervisor Worker 状态检查
- **告警渠道：** Slack、Discord、Telegram、邮件、PagerDuty
- **自定义 Webhook：** 告警事件发送到任意 HTTP 端点
- **宕机检测：** 自动检测站点是否可达，宕机即告警

### 8.3 Deployer 的监控

Deployer 不提供监控功能，这与其"只管部署"的设计哲学一致。但在实际项目中，通过灵活的 task 组合和第三方服务集成，我们可以构建出完整的部署监控和告警方案：

**部署通知集成：**

```php
// Slack 通知
set('slack_webhook', 'https://hooks.slack.com/services/xxx');
set('slack_channel', '#deployments');
set('slack_title', 'Deployment');
set('slack_text', '_{{user}}_ deployed `{{branch}}` to *{{target}}*');

// Deployer 内置的 notify 任务
after('deploy:success', 'slack:notify:success');
after('deploy:failed', 'slack:notify:failure');
```

**自定义部署后健康检查：**

```php
task('deploy:healthcheck', function () {
    $url = "https://{{hostname}}/api/health";
    $response = run("curl -sf {$url} || echo 'FAILED'");
    if (str_contains($response, 'FAILED')) {
        writeln('<error>Health check failed! Rolling back...</error>');
        invoke('rollback');
        throw new \RuntimeException('Health check failed');
    }
    writeln('<info>Health check passed ✓</info>');
});

task('deploy', [
    // ...
    'deploy:healthcheck',
]);
```

---

## 九、团队协作

### 9.1 Forge

- Pro 计划支持邀请团队成员
- 可设置权限级别（Owner、Admin、User）
- 支持 SSH Key 管理
- 部署历史记录
- **不支持** 审批流程或部署权限矩阵

### 9.2 Ploi

- 支持细粒度的团队权限管理
- 可按站点/服务器分配权限
- 部署审批钩子（Webhook）
- 操作审计日志
- 支持 OAuth/SAML 集成（企业功能）

### 9.3 Deployer

Deployer 的协作方式与 Forge/Ploi 截然不同——它完全依赖版本控制系统和 CI/CD 平台来实现团队协作。这种方式的优势在于权限管理与代码仓库的权限体系天然统一，不需要额外维护一套用户权限系统，而且所有操作都有 Git 提交记录作为审计依据：

- `deploy.php` 跟随 Git 仓库，所有人都能看到和审查
- CI/CD 流水线控制谁有权限触发部署
- 部署日志在 CI/CD 系统中保留

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options: [staging, production]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer require deployer/deployer
      - run: vendor/bin/dep deploy ${{ inputs.environment }}
        env:
          DEPLOYER_SSH_KEY: ${{ secrets.DEPLOYER_SSH_KEY }}
```

---

## 十、综合对比表

| 功能维度 | Laravel Forge | Ploi | Deployer |
|---------|:---:|:---:|:---:|
| **服务器配置** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **零停机部署** | ⭐⭐ (手动) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **原子回滚** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **并行多服务器** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **队列管理** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (需配合) |
| **Scheduler** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (需配合) |
| **多环境管理** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **SSL 证书** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ (需配合) |
| **数据库备份** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ (需自建) |
| **监控告警** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐ (需集成) |
| **团队协作** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (CI/CD) |
| **定价** | $12-48/月 | €10-44/月 | 免费 |
| **学习曲线** | 低 | 低 | 中等 |
| **可定制性** | 中 | 中高 | 极高 |
| **技术锁定** | 高 (SaaS) | 高 (SaaS) | 无 (开源) |

---

## 十一、选型决策矩阵

### 场景一：小型团队 / 独立开发者 / 预算敏感

**推荐：Ploi**

理由：Ploi 的入门价格（€10/月）比 Forge（$12/月）略低，但功能更丰富。原生零停机部署、健康检查、更好的队列管理等都是实实在在的价值。对于独立开发者或 2-3 人的小团队，Ploi 的性价比最高。

### 场景二：深度 Laravel 生态集成 / 已在使用 Laravel 生态工具链

**推荐：Forge**

理由：Forge 是 Taylor Otwell 的产品，与 Laravel 生态深度集成。如果你已经是 Laravel Vapor（Serverless）用户，从 Forge 迁移到 Vapor 的路径最短。Forge 的文档和社区资源也最丰富，遇到问题最容易找到解决方案。

### 场景三：多服务器架构 / 微服务 / 高流量应用

**推荐：Deployer**

理由：Deployer 的并行部署能力在多服务器场景下无与伦比。想象一下你有 8 台应用服务器、需要在 30 秒内完成全部部署并确保零停机——Deployer 是唯一能做到这一点的方案。同时，Deployer 的无技术锁定特性也意味着你可以自由切换基础设施提供商。

```php
// 8台服务器并行部署
host('web-1')->set('hostname', '10.0.1.1');
host('web-2')->set('hostname', '10.0.1.2');
// ... 到 web-8
host('web-1', 'web-2', 'web-3', 'web-4', 'web-5', 'web-6', 'web-7', 'web-8');

set('worker_count', 4); // 并行 4 个 SSH 连接
```

### 场景四：严格合规要求 / 企业级审计

**推荐：Deployer + CI/CD 平台**

理由：Deployer 的 `deploy.php` 是代码，可以代码审查、版本控制、权限管控。配合 GitHub Actions、GitLab CI 等平台，可以实现完整的审计链路：谁提的 PR → 谁审批的 → 谁触发的部署 → 部署了哪个 commit → 部署日志在哪。SaaS 面板工具在这方面天然不足。

### 场景五：混合方案——最务实的选择

**推荐：Forge/Ploi（服务器管理）+ Deployer（部署流程）**

这是我在实际项目中见过的最常见、也是最务实的组合：

1. **Forge/Ploi** 负责：服务器配置、Nginx、PHP、数据库安装、SSL 证书、数据库备份、基础监控
2. **Deployer** 负责：代码部署、零停机切换、回滚、队列重启

配置方式：在 Forge/Ploi 中关闭自动部署（禁用 Git Push Webhook），然后用 Deployer 从 CI/CD 触发部署。

```php
// deploy.php
host('production')
    ->set('hostname', 'forge-server.com')
    ->set('remote_user', 'forge')
    ->set('deploy_path', '/home/forge/example.com');

// Forge 已配置好 Nginx、PHP、MySQL、SSL、备份
// Deployer 只管部署代码
task('deploy', [
    'deploy:prepare',
    'deploy:vendors',
    'deploy:publish',
    'artisan:migrate',
    'artisan:config:cache',
    'artisan:queue:restart',
    'deploy:cleanup',
    'deploy:healthcheck',
]);
```

这样做的好处是：**服务器运维用面板（省心），部署流程用代码（可控）**，各取所长。

---

## 十二、高级实战：Deployer 进阶用法

### 12.1 自定义 Deployer Recipe：包含完整生命周期

以下是一个生产级别的 Deployer 配置，涵盖了本文讨论的所有方面：

```php
<?php

namespace Deployer;

require 'recipe/laravel.php';

// ========== 基础配置 ==========
set('application', 'my-laravel-app');
set('repository', 'git@github.com:org/repo.git');
set('keep_releases', 5);
set('default_timeout', 600);

set('shared_files', ['.env']);
set('shared_dirs', [
    'storage',
    'public/uploads',
]);
set('writable_dirs', [
    'bootstrap/cache',
    'storage',
    'storage/app',
    'storage/framework',
    'storage/logs',
]);

// ========== 服务器定义 ==========
host('production')
    ->set('hostname', 'prod.example.com')
    ->set('remote_user', 'forge')
    ->set('deploy_path', '/var/www/example.com')
    ->set('branch', 'main')
    ->set('env', ['APP_ENV' => 'production']);

host('staging')
    ->set('hostname', 'staging.example.com')
    ->set('remote_user', 'forge')
    ->set('deploy_path', '/var/www/example.com')
    ->set('branch', 'develop')
    ->set('env', ['APP_ENV' => 'staging']);

// ========== 自定义任务 ==========

// 部署前数据库备份
task('db:backup', function () {
    $ts = date('Y-m-d_His');
    $name = "backup_{{hostname}}_{$ts}.sql.gz";
    run("mysqldump -u root -p'{{db_password}}' {{database}} | gzip > /tmp/{$name}");
    run("aws s3 cp /tmp/{$name} s3://backups-db/{{application}}/{$name}");
    run("rm /tmp/{$name}");
    writeln("<info>Database backup completed: {$name}</info>");
});

// Supervisor 重启（优雅模式）
task('queue:restart', function () {
    run('cd {{release_path}} && php artisan queue:restart');
    run('sudo supervisorctl reread && sudo supervisorctl update');
});

// Horizon 重启
task('horizon:restart', function () {
    run('cd {{release_path}} && php artisan horizon:terminate');
    info('Horizon terminated. Supervisor will restart it automatically.');
});

// 部署后健康检查
task('deploy:healthcheck', function () {
    $url = "https://{{hostname}}/up";  // Laravel 内置健康检查
    $retries = 5;
    for ($i = 1; $i <= $retries; $i++) {
        $result = run("curl -sf -o /dev/null -w '%{http_code}' {$url} || echo '000'");
        if (trim($result) === '200') {
            writeln("<info>Health check passed (attempt {$i}/{$retries})</info>");
            return;
        }
        writeln("<comment>Health check attempt {$i}/{$retries} failed (HTTP {$result})</comment>");
        if ($i < $retries) {
            sleep(3);
        }
    }
    writeln("<error>Health check failed after {$retries} attempts!</error>");
    writeln("<error>Rolling back...</error>");
    invoke('rollback');
    throw new \RuntimeException('Deployment failed: health check did not pass.');
});

// CDN 缓存清除
task('cdn:purge', function () {
    run('curl -X POST "https://api.cloudflare.com/client/v4/zones/{{cf_zone_id}}/purge_cache" '
        . '-H "Authorization: Bearer {{cf_api_token}}" '
        . '-H "Content-Type: application/json" '
        . \'--data \'{"purge_everything":true}\'');
    info('CDN cache purged.');
});

// 编译前端资源
task('build:assets', function () {
    run('cd {{release_path}} && npm ci && npm run build');
    run('cd {{release_path}} && rm -rf node_modules');  // 节省空间
});

// ========== 部署流程定义 ==========
task('deploy:production', [
    'db:backup',
    'deploy:prepare',
    'deploy:vendors',
    'build:assets',
    'deploy:publish',
    'artisan:migrate',
    'artisan:config:cache',
    'artisan:route:cache',
    'artisan:view:cache',
    'artisan:storage:link',
    'queue:restart',
    'deploy:healthcheck',
    'deploy:cleanup',
    'cdn:purge',
]);

task('deploy:staging', [
    'deploy:prepare',
    'deploy:vendors',
    'build:assets',
    'deploy:publish',
    'artisan:migrate:fresh',   // Staging 环境重建数据库
    'artisan:db:seed',
    'artisan:config:cache',
    'artisan:route:cache',
    'artisan:view:cache',
    'artisan:storage:link',
    'queue:restart',
    'deploy:cleanup',
]);

// 默认 deploy 任务
task('deploy', [
    'deploy:production',
]);

// 通知 hook
after('deploy:success', function () {
    writeln('<info>✅ Deployment to {{hostname}} succeeded!</info>');
    // 可集成 Slack 通知
});
```

### 12.2 Forge API 使用示例

Forge 提供了完整的 REST API，可以通过脚本自动化管理：

```php
<?php
// forge-api-example.php
// 安装: composer require laravel/forge-sdk

use Laravel\Forge\Forge;
use Laravel\Forge\Resources\Server;

$forge = new Forge(env('FORGE_API_KEY'));

// 创建服务器
$server = $forge->createServer([
    'provider' => 'digitalocean',
    'credential_id' => 1,
    'name' => 'production-app',
    'type' => 'app',
    'size' => 's-2vcpu-4gb',
    'region' => 'sgp1',
    'php_version' => 'php83',
    'database' => 'mysql80',
    'database_name' => 'laravel_app',
]);

// 等待服务器配置完成
while ($forge->server($server->id)->status !== 'installed') {
    sleep(10);
    echo "Provisioning... Status: " . $forge->server($server->id)->status . "\n";
}

// 创建站点
$site = $forge->createSite($server->id, [
    'domain' => 'app.example.com',
    'type' => 'laravel',
    'directory' => '/public',
]);

// 配置部署脚本
$forge->updateSiteDeployScript($server->id, $site->id, <<<SCRIPT
cd /home/forge/app.example.com
git pull origin main
composer install --no-interaction --prefer-dist --optimize-autoloader --no-dev
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan queue:restart
SCRIPT);

// 安装 SSL 证书
$forge->installCertificate($server->id, $site->id, [
    'type' => 'letsencrypt',
    'domains' => ['app.example.com', 'www.app.example.com'],
]);

// 创建队列 Worker
$forge->createQueueWorker($server->id, [
    'connection' => 'redis',
    'queue' => 'default,high',
    'daemon' => true,
    'maxTries' => 3,
    'maxTime' => 3600,
]);

echo "Server provisioned and configured successfully!\n";
```

### 12.3 Ploi API 使用示例

```php
<?php
// ploi-api-example.php
// Ploi 的 API 设计比 Forge 更 RESTful

$apiToken = env('PLOI_API_KEY');
$baseUrl = 'https://ploi.io/api';

function ploiRequest(string $method, string $endpoint, array $data = []): array {
    global $apiToken, $baseUrl;

    $ch = curl_init("{$baseUrl}{$endpoint}");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiToken,
            'Content-Type: application/json',
            'Accept: application/json',
        ],
        CURLOPT_CUSTOMREQUEST => $method,
    ]);

    if ($data && in_array($method, ['POST', 'PUT', 'PATCH'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }

    $response = curl_exec($ch);
    curl_close($ch);
    return json_decode($response, true);
}

// 创建服务器
$result = ploiRequest('POST', '/servers', [
    'provider' => 'hetzner',
    'name' => 'prod-app',
    'type' => 'cx31',  // Hetzner 4GB RAM
    'region' => 'fsn1',
    'php_version' => '8.3',
    'database_type' => 'mysql',
]);

$serverId = $result['data']['id'];

// 创建站点
ploiRequest("POST", "/servers/{$serverId}/sites", [
    'domain' => 'app.example.com',
    'type' => 'laravel',
    'web_directory' => '/public',
    'php_version' => '8.3',
]);

// 配置零停机部署
ploiRequest("PATCH", "/servers/{$serverId}/sites/{$siteId}/deployment", [
    'auto_deploy' => true,
    'branch' => 'main',
    'is_zero_downtime' => true,
    'health_check_url' => 'https://app.example.com/api/health',
]);

// 配置队列 Worker
ploiRequest("POST", "/servers/{$serverId}/sites/{$siteId}/queue-workers", [
    'connection' => 'redis',
    'queue' => 'default,high',
    'max_jobs' => 1000,
    'max_time' => 3600,
    'sleep' => 3,
    'tries' => 3,
    'processes' => 3,
]);

echo "Ploi server and site configured!\n";
```

---

## 十三、迁移指南

### 从 Forge 迁移到 Ploi

迁移相对简单，因为两者的产品模型相似：

1. 在 Ploi 中创建相同的服务器（或关联已有的服务器）
2. 创建站点，配置相同的 Git 仓库和分支
3. 迁移环境变量（`.env` 文件内容）
4. 配置队列 Worker 和 Scheduler
5. 配置 SSL 证书
6. 配置数据库备份
7. 更新 DNS 记录指向新服务器
8. 关闭 Forge 站点

### 从 Forge/Ploi 迁移到 Deployer

迁移需要更多的准备工作：

1. 安装 Deployer：`composer require --dev deployer/deployer`
2. 初始化配置：`dep init`
3. 编写 `deploy.php`（参考上文示例）
4. 配置 CI/CD 流水线
5. 确保服务器上 Supervisor、Cron 等已正确配置
6. 先在 staging 环境测试 Deployer 部署
7. 逐步迁移，最终关闭 Forge/Ploi 的自动部署

---

## 十四、总结

三种部署方案没有绝对的优劣，只有适合与否：

- **Laravel Forge** 适合追求简洁、快速上手、愿意为此付费的 Laravel 团队。它是 Laravel 生态中的"安全选项"。

- **Ploi** 适合想要更多功能、更灵活控制、同时保持面板式操作体验的团队。它是 Forge 的"升级版"，在同等价位上提供了更多价值。

- **Deployer** 适合追求极致可控性、多服务器编排能力、深度 CI/CD 集成的团队。它是开源的、版本化的、无锁定的，但需要更多的技术投入。

- **混合方案（Forge/Ploi + Deployer）** 是我最推荐的实战策略——用面板工具管基础设施，用 Deployer 管部署流程，两者的优势互补，劣势消除。

在技术选型中，最重要的不是"哪个工具最好"，而是"哪个工具最适合你团队当前的能力和项目当前的阶段"。小型团队从 Ploi 起步，随团队成长迁移到 Deployer + 混合方案，这是一条经过验证的演进路径。

记住：**工具是手段，不是目的。** 部署方案的核心目标始终是：让代码安全、快速、可靠地到达生产环境。选择最能实现这一目标的方案，然后把精力放在产品本身上。

---

## 相关阅读

1. [Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录](/categories/DevOps/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
2. [金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存](/categories/CI%2FCD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)
3. [Terraform 实战：Laravel 应用基础设施即代码（IaC）— 从手动点 AWS 控制台到代码化部署的踩坑记录](/categories/DevOps/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
