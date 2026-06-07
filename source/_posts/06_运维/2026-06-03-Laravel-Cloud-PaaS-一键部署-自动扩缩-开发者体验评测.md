---
title: Laravel Cloud 实战：Laravel 官方 PaaS 平台——一键部署、自动扩缩与开发者体验评测
date: 2026-06-03 08:00:00
tags: [laravel-cloud, paas, serverless, 部署, developer-experience]
description: Laravel Cloud 是 Laravel 官方推出的全托管 PaaS 平台，专为 Laravel 应用打造一键部署、自动扩缩和零运维体验。本文从实际使用出发，深度评测 Laravel Cloud 的架构设计、配置流程、数据库与队列管理、Preview 环境、定价模型，并与 Forge、Vapor、传统 VPS 方案进行多维度对比，涵盖冷启动、文件存储等常见踩坑案例，帮助开发者判断 Laravel Cloud 是否适合自己的 Serverless 部署需求。
categories: [运维]
cover: /images/covers/laravel-cloud-paas-cover.jpg
---

## 前言

2025 年，Laravel 官方发布了 **Laravel Cloud**——一个专为 Laravel 应用打造的 PaaS 平台。这是 Laravel 生态系统中继 Forge（服务器管理）和 Vapor（AWS Serverless）之后的第三大部署方案。

Laravel Cloud 的野心很大：**让 Laravel 部署像 Vercel 部署 Next.js 一样简单——推送代码，自动部署，零运维。** 但它真的能做到吗？与 Forge、Vapor、Railway、Fly.io 等方案相比，它的优势和劣势在哪里？

本文将从实际使用出发，全面评测 Laravel Cloud 的功能、性能、定价和开发者体验，帮助你判断它是否适合你的项目。

<!-- more -->

---

## 一、Laravel Cloud 是什么？

### 1.1 定位

Laravel Cloud 是一个 **全托管的 PaaS 平台**，专为 Laravel 应用设计。它解决了 Laravel 开发者面临的一个核心痛点：**部署和运维 Laravel 应用的认知负荷太高。**

对比传统方式：

| 步骤 | 传统 VPS | Laravel Forge | Laravel Vapor | Laravel Cloud |
|------|----------|---------------|---------------|---------------|
| 服务器配置 | 手动 | 一键 | 不需要 | 不需要 |
| PHP 配置 | 手动 | 面板操作 | 不需要 | 不需要 |
| 数据库 | 手动 | 手动 | RDS | 内置 |
| Redis | 手动 | 手动 | ElastiCache | 内置 |
| 队列 | Supervisor 手动配 | 一键 | SQS/Lambda | 内置 |
| SSL | Let's Encrypt 手动 | 自动 | ACM | 自动 |
| CI/CD | GitHub Actions 手动配 | Envoyer | Vapor CLI | Git Push |
| 自动扩缩 | 手动/脚本 | 手动 | 自动 | 自动 |
| 日志 | 手动 | Papertrail | CloudWatch | 内置 |
| 部署时间 | 10-30 分钟 | 5 分钟 | 2-3 分钟 | 1 分钟 |

### 1.2 架构概览

Laravel Cloud 的底层架构基于容器化技术，但对用户完全抽象：

```
┌─────────────────────────────────────────────────────────┐
│                   Laravel Cloud                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │   Git Push   │───▶│  Build &     │                   │
│  │   Webhook    │    │  Deploy      │                   │
│  └──────────────┘    │  Pipeline    │                   │
│                       └──────┬───────┘                   │
│                              │                           │
│         ┌────────────────────┼────────────────────┐     │
│         ▼                    ▼                    ▼     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐  │
│  │  Web Workers │    │ Queue Workers│    │ Scheduler│  │
│  │  (Auto-scale)│    │ (Auto-scale) │    │          │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────┘  │
│         │                    │                           │
│         ▼                    ▼                           │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │   Managed    │    │   Managed    │                   │
│  │   Database   │    │   Redis      │                   │
│  │   (MySQL/Pg) │    │              │                   │
│  └──────────────┘    └──────────────┘                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Built-in Services                       │   │
│  │  SSL · CDN · Logs · Metrics · Alerts · DNS        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

关键特点：
- **无需管理服务器：** 没有 SSH、没有 Nginx 配置、没有 Supervisor
- **Git Push 部署：** 推送到 main 分支即触发部署
- **内置数据库和缓存：** MySQL、PostgreSQL、Redis 全托管
- **自动扩缩：** 根据 CPU/内存/请求量自动调整实例数
- **队列和调度器：** Laravel Queue 和 Scheduler 开箱即用

---

## 二、快速开始：5 分钟部署

### 2.1 连接仓库

1. 访问 cloud.laravel.com，使用 GitHub 或 GitLab 账号登录
2. 点击「New Project」
3. 选择你的 Git 仓库和分支
4. Laravel Cloud 自动检测到这是一个 Laravel 项目

### 2.2 环境变量配置

Laravel Cloud 提供了一个可视化界面来管理 `.env` 配置：

```
APP_NAME=MyApp
APP_ENV=production
APP_KEY=base64:...
APP_DEBUG=false
APP_URL=https://myapp.laravel.cloud

# 数据库自动配置（Laravel Cloud 自动注入）
DB_CONNECTION=mysql
DB_HOST=自动注入
DB_PORT=自动注入
DB_DATABASE=自动注入
DB_USERNAME=自动注入
DB_PASSWORD=自动注入

# Redis 自动配置
REDIS_HOST=自动注入
REDIS_PASSWORD=自动注入
```

**亮点：** 数据库和 Redis 的连接信息由 Laravel Cloud 自动注入，你不需要手动配置。这消除了「数据库连接字符串写错」这类低级错误。

### 2.3 一键部署

```bash
# 方式一：Git Push（推荐）
git push origin main

# 方式二：Laravel Cloud CLI
# 安装 CLI
composer global require laravel/cloud-cli

# 部署
cloud deploy

# 查看部署日志
cloud logs --follow
```

**部署过程：**
1. 收到 Git Push Webhook
2. 拉取代码
3. 运行 `composer install --no-dev`
4. 运行 `npm ci && npm run build`
5. 缓存配置：`php artisan config:cache route:cache view:cache`
6. 运行数据库迁移：`php artisan migrate --force`
7. 切换流量到新版本
8. 健康检查通过后，停止旧版本

**典型部署时间：** 60-90 秒（取决于依赖安装时间）

### 2.4 自定义域名

在项目设置中添加自定义域名，Laravel Cloud 自动处理：
- DNS 验证
- SSL 证书申请和续期（Let's Encrypt）
- CDN 配置

---

## 三、核心功能深度评测

### 3.1 数据库管理

Laravel Cloud 提供全托管的数据库服务：

**支持的数据库：**
- MySQL 8.0+
- PostgreSQL 16+
- SQLite（适合小型应用和开发环境）

**管理功能：**
- 自动备份（每日，保留 7 天）
- 手动备份点
- 数据库回滚
- 性能监控（查询分析、慢查询日志）
- 存储空间监控

**评测：**

```php
// 使用 Laravel Cloud 的数据库，代码完全不变
// 这是它最大的优势之一——零代码修改

// 但是，如果你想用一些高级功能，可能需要适配：
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained();
    $table->decimal('total', 10, 2);
    $table->json('metadata'); // JSON 列支持良好
    $table->timestamps();
    
    // Laravel Cloud 的 MySQL 支持全文索引
    $table->fullText(['notes']);
});
```

**不足：**
- 没有直接的 phpMyAdmin/pgAdmin 访问（需要通过 SSH 隧道或 CLI）
- 数据库版本选择有限（不能指定小版本号）
- 没有只读副本选项（截至 2026 年初）

### 3.2 队列管理

Laravel Cloud 对 Laravel Queue 的支持是其最大亮点之一：

**配置方式：**

```php
// config/queue.php — Laravel Cloud 自动配置
// 你只需要在 Cloud Dashboard 中设置 Worker 数量

// 支持的队列驱动：
// - redis（推荐）
// - database
// - sqs（可选）

// 特殊功能：
// - 优先队列：dashboard 中可视化配置
// - 重试策略：可配置最大重试次数和退避策略
// - 死信队列：失败任务自动进入死信队列
// - Worker 自动扩缩：根据队列深度自动增加/减少 Worker
```

**Worker 自动扩缩策略：**

```yaml
# 在 Laravel Cloud Dashboard 中配置
autoscaling:
  min_workers: 1
  max_workers: 10
  scale_up_threshold: 100    # 队列中超过 100 个任务时扩容
  scale_down_threshold: 10   # 队列中少于 10 个任务时缩容
  cooldown_seconds: 300      # 扩缩冷却时间
```

**评测：** 队列管理是 Laravel Cloud 最省心的功能。不需要配置 Supervisor、不需要写 systemd service 文件、不需要手动监控 Worker 进程。Dashboard 上可以看到实时的队列深度、处理速度和失败率。

### 3.3 调度器（Scheduler）

```php
// app/Console/Kernel.php — 代码完全不变
protected function schedule(Schedule $schedule): void
{
    $schedule->command('orders:process-pending')->everyFifteenMinutes();
    $schedule->command('reports:generate-daily')->dailyAt('02:00');
    $schedule->command('cache:clear-stale')->hourly();
    $schedule->command('notifications:send-batch')->everyFiveMinutes();
}
```

Laravel Cloud 自动运行 `schedule:run`，不需要配置 Cron Job。调度器的执行日志在 Dashboard 中可查看。

### 3.4 日志与监控

**日志查看：**

```bash
# 通过 CLI 查看实时日志
cloud logs --follow

# 按类型过滤
cloud logs --type=queue
cloud logs --type=scheduler
cloud logs --type=deploy

# 通过 API 查询历史日志（集成第三方工具）
curl -H "Authorization: Bearer $CLOUD_TOKEN" \
  https://api.laravel.cloud/v1/projects/{id}/logs?since=2026-06-01
```

**内置监控指标：**
- 请求数（按状态码分组）
- 响应时间（P50、P95、P99）
- CPU 和内存使用率
- 队列深度和处理速度
- 数据库连接数和查询时间
- 错误率

**不足：**
- 没有内置 APM（Application Performance Monitoring）——需要集成 New Relic 或 Datadog
- 自定义指标（custom metrics）支持有限
- 日志保留时间较短（7 天），长期存储需要导出

### 3.5 缓存（Redis）

```php
// 使用 Laravel Cloud 的 Redis，代码不变
Cache::remember('products:featured', 3600, function () {
    return Product::where('featured', true)->get();
});

// Redis 直接使用也支持
Redis::hset('user:1:cart', 'product_5', json_encode([
    'quantity' => 2,
    'price' => 99.00,
]));
```

**管理功能：**
- Redis 内存使用监控
- Key 浏览器（可以查看和删除特定 Key）
- 慢查询日志

### 3.6 文件存储

Laravel Cloud 内置了对象存储服务，兼容 S3 API：

```php
// config/filesystems.php
'disks' => [
    'local' => [
        'driver' => 'local',
        'root' => storage_path('app/private'),
    ],
    'cloud' => [
        'driver' => 's3',
        // Laravel Cloud 自动注入以下配置
        'bucket' => env('CLOUD_STORAGE_BUCKET'),
        'url' => env('CLOUD_STORAGE_URL'),
        'endpoint' => env('CLOUD_STORAGE_ENDPOINT'),
        'region' => env('CLOUD_STORAGE_REGION'),
    ],
],

// 使用方式完全标准
Storage::disk('cloud')->put('avatars/1.jpg', $imageContent);
$url = Storage::disk('cloud')->url('avatars/1.jpg');
```

---

## 四、高级功能

### 4.1 Preview Environments（预览环境）

Laravel Cloud 支持为每个 Pull Request 自动创建预览环境：

```yaml
# 在项目设置中启用
preview_environments:
  enabled: true
  auto_deploy: true
  auto_destroy: true       # PR 关闭后自动销毁
  destroy_after_hours: 48  # 闲置 48 小时后销毁
  include_database: true   # 预览环境包含独立数据库
  include_redis: true
```

**工作流：**
1. 开发者创建 PR → 自动创建预览环境
2. 预览环境获得独立的 URL：`pr-123.myapp.laravel.cloud`
3. QA 在预览环境中测试
4. PR 合并 → 预览环境自动销毁

**这是 Laravel Cloud 相比 Forge 和 Vapor 的杀手级功能。** 每个 PR 都有独立的完整环境，测试再也不会互相干扰。

### 4.2 多环境管理

```
environments/
├── production/
│   ├── 环境变量（加密）
│   ├── 数据库配置
│   └── 自动扩缩配置
├── staging/
│   ├── 环境变量（加密）
│   ├── 数据库配置
│   └── 自动扩缩配置
└── development/
    ├── 环境变量
    └── 数据库配置
```

**分支 → 环境映射：**
- `main` 分支 → production 环境
- `staging` 分支 → staging 环境
- `feature/*` → preview 环境（可选）

### 4.3 团队协作

```yaml
# 团队权限模型
team:
  members:
    - email: lead@example.com
      role: admin          # 完全控制
    - email: dev1@example.com
      role: developer      # 部署权限，无配置修改权限
    - email: dev2@example.com
      role: developer
    - email: qa@example.com
      role: viewer         # 只读权限
    - email: contractor@example.com
      role: deployer       # 只有部署权限
```

### 4.4 API 和 CLI

```bash
# 安装 CLI
composer global require laravel/cloud-cli

# 项目操作
cloud init                    # 初始化项目
cloud deploy                  # 部署当前分支
cloud deploy --branch=staging # 部署指定分支
cloud rollback               # 回滚到上一个版本

# 环境变量
cloud env:list               # 列出所有环境变量
cloud env:set APP_DEBUG=true # 设置环境变量
cloud env:get APP_KEY        # 获取单个变量

# 日志
cloud logs --follow          # 实时日志
cloud logs --since=1h        # 最近1小时

# 数据库
cloud db:shell               # 打开数据库 CLI
cloud db:backup              # 手动备份
cloud db:restore backup-id   # 恢复备份

# SSH（进入容器）
cloud ssh                    # SSH 到运行容器
cloud ssh --queue-worker     # SSH 到队列 Worker

# 监控
cloud metrics                # 查看当前指标
cloud scale --min=2 --max=10 # 设置扩缩范围
```

**API 示例：**

```php
// 使用 API 集成到你的内部工具中
$response = Http::withToken(config('services.laravel_cloud.token'))
    ->get('https://api.laravel.cloud/v1/projects/{id}/deployments');

$deployments = $response->json('data');
```

---

## 五、定价分析

### 5.1 价格结构

Laravel Cloud 采用 **按使用量计费** 的模式（2026 年初价格，可能有变动）：

| 资源 | 单价 | 说明 |
|------|------|------|
| Web Worker | $0.01/小时/实例 | 最低 1 个实例 |
| Queue Worker | $0.01/小时/实例 | 可设置 0 |
| MySQL（基础版） | $15/月 | 1 vCPU, 1GB RAM, 10GB 存储 |
| MySQL（标准版） | $45/月 | 2 vCPU, 4GB RAM, 50GB 存储 |
| MySQL（高级版） | $120/月 | 4 vCPU, 8GB RAM, 100GB 存储 |
| PostgreSQL | 同上 | — |
| Redis | $10/月起 | 256MB |
| 对象存储 | $0.02/GB/月 | — |
| 带宽 | $0.10/GB | 出站流量 |
| Preview Environment | $0.005/小时 | 按实际使用时间计费 |

### 5.2 不同规模的成本估算

**小型项目（月访问量 10 万）：**
- Web Worker: 1 实例 × 730 小时 × $0.01 = $7.30
- Queue Worker: 1 实例 × 730 小时 × $0.01 = $7.30
- MySQL 基础版: $15
- Redis: $10
- 带宽: 50GB × $0.10 = $5
- **总计: ~$45/月**

**中型项目（月访问量 100 万）：**
- Web Worker: 3 实例平均 × 730 × $0.01 = $21.90
- Queue Worker: 2 实例 × 730 × $0.01 = $14.60
- MySQL 标准版: $45
- Redis: $20
- 带宽: 200GB × $0.10 = $20
- Preview Environments: ~$10
- **总计: ~$132/月**

**大型项目（月访问量 1000 万）：**
- Web Worker: 10 实例平均 × 730 × $0.01 = $73
- Queue Worker: 5 实例 × 730 × $0.01 = $36.50
- MySQL 高级版: $120
- Redis: $50
- 带宽: 1TB × $0.10 = $100
- Preview Environments: ~$30
- **总计: ~$410/月**

### 5.3 与其他方案的成本对比

| 方案 | 中型项目月成本 | 管理成本（人力） |
|------|---------------|----------------|
| VPS（自管理） | $50-100 | 高（需要运维人员） |
| Laravel Forge | $80-150 | 中（仍需管理服务器） |
| Laravel Vapor | $100-200 | 低（但 Cold Start 可能影响体验） |
| Railway | $80-150 | 低 |
| Fly.io | $60-120 | 低 |
| **Laravel Cloud** | **$100-150** | **最低** |

---

## 六、与其他方案深度对比

### 6.1 Laravel Cloud vs Laravel Forge

| 维度 | Laravel Cloud | Laravel Forge |
|------|---------------|---------------|
| 服务器管理 | 完全托管 | 需要管理 DigitalOcean/Hetzner 服务器 |
| 自动扩缩 | 内置 | 需要手动或脚本 |
| 数据库 | 全托管 | 需要单独配置 |
| Preview 环境 | 内置 | 不支持（需要额外工具） |
| 灵活性 | 中等 | 高（可以 SSH、自定义 Nginx） |
| 价格 | 按使用量 | 固定 $12-39/月 + 服务器费用 |
| 适合场景 | 标准 Laravel 应用 | 需要深度自定义的场景 |

**选择建议：** 如果你的应用是标准的 Laravel Web/API 应用，选 Laravel Cloud。如果你需要自定义 Nginx 配置、运行非 Laravel 服务、或需要完整的服务器控制，选 Forge。

### 6.2 Laravel Cloud vs Laravel Vapor

| 维度 | Laravel Cloud | Laravel Vapor |
|------|---------------|---------------|
| 底层架构 | 容器化 | AWS Lambda（Serverless） |
| Cold Start | 无（常驻容器） | 有（可能影响用户体验） |
| 最大并发 | 取决于实例数 | 理论无限（Lambda 自动扩缩） |
| 数据库 | 内置全托管 | RDS（需要 AWS 知识） |
| 学习曲线 | 低 | 中（需要了解 AWS 概念） |
| 价格模式 | 按实例时间 | 按请求数 + Lambda 执行时间 |
| 适合场景 | 大多数 Laravel 应用 | 突发流量、高并发 API |

**选择建议：** 如果你的流量比较平稳或可预测，选 Laravel Cloud。如果你的流量有极端突发（如秒杀活动），Vapor 的 Serverless 架构更有优势。

### 6.3 Laravel Cloud vs Railway

| 维度 | Laravel Cloud | Railway |
|------|---------------|---------|
| 语言支持 | 专为 Laravel | 通用（Go、Node、Python 等） |
| Laravel 特化 | 是（队列、调度器、迁移） | 否（通用容器） |
| 数据库 | 内置 MySQL/PostgreSQL | 内置 MySQL/PostgreSQL/Redis |
| 价格 | 类似 | 类似（$5 起/月） |
| 生态 | Laravel 原生 | Nixpacks 构建 |

**选择建议：** 如果你是纯 Laravel 项目，Laravel Cloud 更好。如果你的项目包含 Laravel + Go 微服务 + Python 数据处理，Railway 的通用性更强。

### 6.4 Laravel Cloud vs Fly.io

| 维度 | Laravel Cloud | Fly.io |
|------|---------------|--------|
| 部署方式 | Git Push | CLI（flyctl deploy） |
| 全球分布 | 有限区域 | 30+ 全球区域 |
| 边缘计算 | 否 | 是（Fly Machines） |
| 学习曲线 | 低 | 中（需要理解 Docker、Machines） |
| 价格 | 类似 | 更灵活（可以极低成本运行小应用） |

**选择建议：** 如果你的用户主要在单一区域，Laravel Cloud 更简单。如果你需要全球分布和边缘计算，Fly.io 更强。

---

## 七、迁移指南

### 7.1 从 VPS/Forge 迁移

**步骤 1：评估兼容性**

```bash
# 检查是否有不兼容的特性
# 1. SSH 相关操作 → 需要替换为 Laravel Cloud 的方式
# 2. 文件系统写入 → 改用对象存储
# 3. 自定义 Nginx 配置 → Laravel Cloud 不支持，需要调整
# 4. 本地队列/Redis → 使用 Laravel Cloud 提供的
# 5. 自定义 Supervisor 配置 → 通过 Dashboard 配置 Worker
```

**步骤 2：代码修改**

```php
// 如果你之前把文件存在本地磁盘：
// 之前
Storage::disk('local')->put('avatars/' . $user->id . '.jpg', $image);

// 之后
Storage::disk('cloud')->put('avatars/' . $user->id . '.jpg', $image);

// 如果你之前用 file_get_contents 读取本地文件：
// 之前
$content = file_get_contents(storage_path('app/templates/email.html'));

// 之后
$content = Storage::disk('cloud')->get('templates/email.html');
```

**步骤 3：数据库迁移**

```bash
# 1. 从当前数据库导出
mysqldump -u root -p mydb > dump.sql

# 2. 导入到 Laravel Cloud 数据库
# 通过 CLI 或 Dashboard 的导入功能
cloud db:import dump.sql

# 3. 验证数据完整性
cloud db:shell
> SELECT COUNT(*) FROM users;
> SELECT COUNT(*) FROM orders;
```

**步骤 4：DNS 切换**

```bash
# 1. 在 Laravel Cloud 中添加自定义域名
# 2. 等待 SSL 证书签发
# 3. 修改 DNS 记录指向 Laravel Cloud
# 4. 验证网站可访问
# 5. 监控 24 小时后，下线旧服务器
```

### 7.2 从 Vapor 迁移

从 Vapor 迁移到 Laravel Cloud 相对简单，因为都是 Laravel 生态：

```php
// 1. 移除 Vapor 特有的代码
// 如果你用了 Vapor 的 Facades：
// use Laravel\Vapor\Vapor; → 删除

// 2. 修改存储配置
// Vapor 用 S3，Laravel Cloud 用自己的对象存储
// 修改 config/filesystems.php

// 3. 队列配置
// Vapor 用 SQS，Laravel Cloud 用自己的队列
// 修改 config/queue.php

// 4. 环境变量
// 从 Vapor 的环境变量导出，导入到 Laravel Cloud
```

---

## 八、局限性与注意事项

### 8.1 已知限制

1. **区域有限：** 截至 2026 年初，Laravel Cloud 的数据中心区域有限（美国、欧洲），亚太区域尚在规划中
2. **无法 SSH 到底层服务器：** 调试时只能通过日志和 `cloud ssh`（进入容器）
3. **自定义扩展受限：** 不能安装自定义 PHP 扩展（需要官方支持的扩展列表）
4. **非 Laravel 服务不支持：** 如果你需要同时运行 Go 服务、Python 脚本等，Laravel Cloud 无法满足
5. **数据库高级功能有限：** 没有只读副本、没有分片、没有自定义参数组
6. **文件系统限制：** 容器文件系统是临时的，不能持久化写入

### 8.2 不适合的场景

- 需要运行非 PHP 服务的微服务架构
- 需要自定义内核参数或系统级配置
- 数据库需要只读副本或分片的高读取场景
- 需要 GPU 计算或特殊硬件
- 需要极度细粒度的成本控制（如 Spot 实例）

### 8.3 适合的场景

- 标准的 Laravel Web 应用和 API
- Laravel + Livewire / Inertia.js 全栈应用
- 中小型团队，不想投入运维人力
- 需要快速部署和 Preview 环境的团队
- 从 Heroku 迁移的 Laravel 项目

---

## 九、最佳实践

### 9.1 项目结构

```
my-laravel-app/
├── .github/
│   └── workflows/
│       └── cloud-preview.yml    # PR 预览环境配置
├── app/
├── config/
│   └── cloud.php               # Laravel Cloud 特定配置
├── cloud.yaml                  # Laravel Cloud 项目配置
└── ...
```

### 9.2 cloud.yaml 配置

```yaml
# cloud.yaml — Laravel Cloud 项目配置文件
project: my-app
region: us-east-1

web:
  instances:
    min: 1
    max: 10
  resources:
    cpu: 1000    # mCPU
    memory: 512  # MB
  
queue:
  workers:
    min: 1
    max: 5
  queues:
    - name: default
      max_time: 3600
    - name: notifications
      max_time: 300
    - name: exports
      max_time: 7200

scheduler:
  enabled: true

database:
  engine: mysql
  version: "8.0"
  plan: standard
  
redis:
  plan: basic

storage:
  provider: s3-compat
  cors:
    - origin: https://myapp.com
      methods: [GET, PUT, POST]
```

### 9.3 部署策略

```bash
# 生产环境部署（main 分支）
git push origin main

# Staging 环境部署
git push origin staging

# 紧急回滚
cloud rollback

# 金丝雀部署（需要在 Dashboard 中配置）
cloud deploy --canary=10   # 先部署到 10% 的流量
cloud deploy --canary=50   # 扩大到 50%
cloud deploy --canary=100  # 全量发布
```

### 9.4 监控和告警

```php
// 在 Laravel 应用中集成自定义监控
use Illuminate\Support\Facades\Http;

class DeploymentNotifier
{
    public function notify(string $version, string $status): void
    {
        // 发送到 Slack
        Http::post(config('services.slack.webhook'), [
            'text' => "🚀 Deploy {$version}: {$status}",
        ]);
    }
}

// app/Providers/AppServiceProvider.php
Event::listen(DeploymentFinished::class, function ($event) {
    app(DeploymentNotifier::class)->notify(
        $event->version,
        'success'
    );
});
```

---

## 十、总结

Laravel Cloud 是 Laravel 生态系统中一个重要的里程碑。它第一次让 Laravel 开发者能够以 **最低的认知负荷** 部署和运维应用。

**核心优势：**
1. **零运维：** 不需要管理服务器、数据库、Redis
2. **Laravel 原生：** 队列、调度器、迁移都是开箱即用
3. **Preview 环境：** 每个 PR 独立环境，测试不再互相干扰
4. **自动扩缩：** 根据负载自动调整资源
5. **开发者体验：** CLI 和 Dashboard 设计精良

**核心劣势：**
1. 灵活性不如自管理服务器
2. 数据中心区域有限
3. 非 Laravel 服务不支持
4. 数据库高级功能有限
5. 长期成本可能高于自管理方案

**最终建议：** 如果你是一个 Laravel 为主的团队，不想在运维上投入精力，Laravel Cloud 是 2026 年最值得尝试的部署方案。它让你把时间花在写业务代码上，而不是花在配置 Nginx 和 Supervisor 上。

---

## 参考资料

1. Laravel. "Laravel Cloud Documentation." cloud.laravel.com/docs
2. Laravel. "Laravel Forge Documentation." forge.laravel.com/docs
3. Laravel. "Laravel Vapor Documentation." docs.vapor.build
4. Railway. "Documentation." docs.railway.app
5. Fly.io. "Documentation." fly.io/docs

---

## 相关阅读

- [Laravel Vapor 实战：AWS Serverless 部署——Lambda、API Gateway 无服务器 PHP 生产架构与成本分析](/devops/Laravel-Vapor-实战-AWS-Serverless-部署-Lambda-API-Gateway-无服务器PHP生产架构与成本分析/) — 如果你对 Laravel Cloud vs Vapor 的 Serverless 架构差异感兴趣，这篇深入对比了 Lambda 冷启动、SQS 队列和 AWS 成本模型。
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/06_运维/Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/) — 想要完全掌控部署基础设施？Coolify 是自托管 PaaS 的最佳选择，本文对比了它与 Laravel Cloud 在灵活性和运维成本上的取舍。
- [Railway vs Fly.io vs Render：2026 年 Laravel 应用云部署平台选型对比](/06_运维/Railway-vs-Fly-io-vs-Render-2026年Laravel应用云部署平台选型对比/) — 更多云部署平台的横向评测，帮助你在 Laravel Cloud 之外找到最适合自己团队的方案。
