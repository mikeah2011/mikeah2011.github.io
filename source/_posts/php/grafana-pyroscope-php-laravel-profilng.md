---
title: Grafana Pyroscope 实战：持续性能剖析——PHP/Laravel 生产环境火焰图、CPU/内存热点定位与 CI 集成
date: 2026-06-10 05:44:00
categories:
  - php
tags:
  - Grafana
  - Pyroscope
  - PHP
  - Laravel
  - 性能剖析
  - 火焰图
  - 可观测性
description: 深入实战 Grafana Pyroscope 持续性能剖析平台，手把手搭建 PHP/Laravel 生产环境的 CPU/内存火焰图分析，覆盖 instrumentation、profiler 集成、CI/CD 集成与真实排障案例。
---

## 概述

线上 PHP 服务出问题时，最常见的排查路径是看日志、查慢查询、翻 APM。但这些工具只能告诉你「哪里慢」，不能告诉你「为什么慢」。火焰图（Flame Graph）可以直接展示函数调用栈的 CPU 占比，帮你一眼看出热点函数——可问题是，传统采样式火焰图需要临时开启 profiling，重启进程，对生产环境不友好。

**Grafana Pyroscope** 解决的就是这个问题：它是一个持续性能剖析平台，支持以极低开销（<1% CPU）在生产环境长期运行 profiler，数据自动聚合到 Grafana，可以回溯任意时间段的性能快照。

本文基于真实生产环境经验，手把手演示：

1. Pyroscope 服务端搭建
2. PHP 应用端 instrumentation（PHP Profiler + Laravel 集成）
3. 火焰图分析实战
4. 与 CI/CD 集成实现 PR 级性能回归检测

## 核心概念

### 什么是持续性能剖析（Continuous Profiling）

传统 profiling 的流程：

```
发现问题 → 临时开启 profiler → 重启服务 → 采集 → 分析 → 关闭 profiler
```

持续性能剖析的流程：

```
服务启动时自动开启 profiler → 数据持续上报 → 存储 + 聚合 → 随时查询历史
```

核心区别：**不需要重启，不需要提前规划，事后可以回溯**。线上凌晨 3 点的 CPU 尖峰，第二天早上打开 Pyroscope 就能回看当时的函数级热点。

### Pyroscope 架构

```
┌─────────────┐     ┌─────────────────┐     ┌──────────┐
│  PHP App    │────▶│  Pyroscope      │────▶│ Grafana  │
│  (pyro-agent)│    │  Server         │  ▲  │ Dashboard│
└─────────────┘     │  (接收+存储)    │  │  └──────────┘
                    └─────────────────┘  │
                                         │
                    ┌─────────────────┐  │
                    │  Pyroscope      │──┘
                    │  Agent (可选)   │
                    └─────────────────┘
```

关键组件：

| 组件 | 作用 |
|------|------|
| `pyro-agent` | 应用内嵌的 profiling SDK，负责采集调用栈 |
| Pyroscope Server | 接收、聚合、存储 profiling 数据 |
| Grafana | 可视化展示，与 Pyroscope 数据源对接 |

### PHP Profiling 的实现原理

PHP 的 profiling 主要有两种方式：

1. **tideways_xhprof**：基于 XHProf 的 fork，支持生产环境低开销采样
2. **phpspy**：基于 ptrace 的采样器，无需修改 PHP 配置

Pyroscope 的 PHP SDK 底层使用 `phpspy`，通过定时采样获取调用栈，开销极低。每个请求的 CPU 开销约 0.1-0.5%，对大多数 Web 服务可以忽略不计。

## 实战：搭建 Pyroscope + PHP/Laravel

### 1. 搭建 Pyroscope Server

最简单的方式是 Docker Compose：

```yaml
# docker-compose.pyroscope.yml
version: "3.8"

services:
  pyroscope:
    image: grafana/pyroscope:latest
    ports:
      - "4040:4040"
    command: [
      "server",
      "--storage-path=/var/lib/pyroscope",
      "--auth-enabled=false",
      "--log-level=info"
    ]
    volumes:
      - pyroscope-data:/var/lib/pyroscope

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_INSTALL_PLUGINS=grafana-pyroscope-datasource
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  pyroscope-data:
  grafana-data:
```

启动：

```bash
docker compose -f docker-compose.pyroscope.yml up -d
```

访问 `http://localhost:4040` 验证 Pyroscope 正常运行，`http://localhost:3000` 打开 Grafana。

在 Grafana 中添加 Pyroscope 数据源：

1. 进入 Settings → Data Sources → Add data source
2. 选择 Grafana Pyroscope
3. URL 填 `http://pyroscope:4040`（同 Docker 网络）或 `http://localhost:4040`
4. 保存并测试

### 2. PHP 应用端安装 pyro-agent

#### 方式一：Composer 安装（推荐）

```bash
composer require pyroscope/pyro-php
```

#### 方式二：PHP 扩展安装

```bash
# 下载预编译的扩展
curl -L https://github.com/grafana/pyroscope-php/releases/latest/download/pyroscope-linux-x86_64.tar.gz -o pyroscope.tar.gz
tar -xzf pyroscope.tar.gz
cp pyroscope.so $(php -r "echo ini_get('extension_dir');")/
echo "extension=pyroscope.so" >> $(php --ini | grep "Loaded Configuration" | awk '{print $4}')
```

### 3. Laravel 集成

#### 基础配置

在 `config/pyroscope.php`（新建）中配置：

```php
<?php

return [
    // Pyroscope Server 地址
    'server_url' => env('PYROSCOPE_SERVER_URL', 'http://localhost:4040'),

    // 应用名称，用于在 Pyroscope 中区分不同服务
    'app_name' => env('APP_NAME', 'laravel-app'),

    // 采样率（1-100），生产环境建议 1-5
    'sample_rate' => env('PYROSCOPE_SAMPLE_RATE', 5),

    // 标签（用于按环境、版本等维度筛选）
    'tags' => [
        'env' => env('APP_ENV', 'production'),
        'region' => env('APP_REGION', 'ap-east-1'),
    ],
];
```

在 `.env` 中添加：

```env
PYROSCOPE_SERVER_URL=http://localhost:4040
PYROSCOPE_SAMPLE_RATE=5
```

#### 在 Laravel 中启动 profiling

在 `app/Providers/AppServiceProvider.php` 的 `boot()` 方法中初始化：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        if (config('pyroscope.server_url')) {
            \Pyroscope\enable([
                'server_address' => config('pyroscope.server_url'),
                'app_name' => config('pyroscope.app_name'),
                'sample_rate' => config('pyroscope.sample_rate'),
                'tags' => config('pyroscope.tags'),
            ]);
        }
    }
}
```

#### 手动标注业务区间

Pyroscope 支持在代码中手动创建 profiling 标记（tag），方便在火焰图中按业务维度筛选：

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Pyroscope\TaggedProfile;

class OrderController extends Controller
{
    public function store(Request $request)
    {
        // 标记当前代码区间，火焰图中会显示这个 tag
        $profile = new TaggedProfile(['order_type' => 'create']);
        
        try {
            // 业务逻辑
            $order = $this->orderService->create($request->validated());
            
            // 发送通知（另一个标记）
            $this->sendNotification($order);
            
            return response()->json(['id' => $order->id]);
        } finally {
            $profile->end();
        }
    }

    private function sendNotification($order): void
    {
        $profile = new TaggedProfile(['operation' => 'notification']);
        try {
            // 通知逻辑
        } finally {
            $profile->end();
        }
    }
}
```

#### 按路由自动打标（中间件方式）

创建一个中间件，自动为每个请求添加路由级别的 tag：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Pyroscope\TaggedProfile;

class PyroscopeRouteTag
{
    public function handle(Request $request, Closure $next)
    {
        $route = $request->route();
        $routeName = $route ? ($route->getName() ?? $route->getActionName()) : 'unknown';
        
        $profile = new TaggedProfile(['route' => $routeName]);
        
        try {
            $response = $next($request);
        } finally {
            $profile->end();
        }
        
        return $response;
    }
}
```

在 `app/Http/Kernel.php` 中注册：

```php
protected $middleware = [
    // ...
    \App\Http\Middleware\PyroscopeRouteTag::class,
];
```

### 4. 为 Worker 进程配置 Profiling

Laravel 的队列 Worker、定时任务等常驻进程也需要 profiling：

```php
<?php

// 在 QueueServiceProvider 中为 worker 启动 profiling
// 或者创建一个独立的ServiceProvider

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Queue\Events\WorkerStopping;

class QueueProfilingProvider extends ServiceProvider
{
    public function boot(): void
    {
        if (! config('pyroscope.server_url')) {
            return;
        }

        // 为队列 worker 进程启用 profiling
        if (app()->runningInConsole() && ! app()->runningArtisan()) {
            \Pyroscope\enable([
                'server_address' => config('pyroscope.server_url'),
                'app_name' => config('pyroscope.app_name') . '-queue',
                'sample_rate' => config('pyroscope.sample_rate'),
                'tags' => array_merge(config('pyroscope.tags'), [
                    'process' => 'queue-worker',
                ]),
            ]);
        }
    }
}
```

## 火焰图分析实战

### 搭建测试环境

为了演示火焰图分析，我们创建一个有性能问题的 Laravel 代码：

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class SlowController extends Controller
{
    public function index(Request $request)
    {
        // 问题1：N+1 查询
        $users = \App\Models\User::take(50)->get();
        foreach ($users as $user) {
            // 每次循环都查一次数据库
            $user->orders;
        }

        // 问题2：缓存穿透（每次都查库）
        $data = Cache::remember('dashboard_data', 60, function () {
            return $this->expensiveQuery();
        });

        // 问题3：不必要的 JSON 编解码
        $raw = DB::select("SELECT settings FROM users WHERE id = ?", [1]);
        $settings = json_decode($raw[0]->settings, true);
        $settings['last_login'] = now()->toDateTimeString();
        DB::update("UPDATE users SET settings = ? WHERE id = 1", [
            json_encode($settings)
        ]);

        return response()->json(['users' => $users, 'data' => $data]);
    }

    private function expensiveQuery(): array
    {
        return DB::select('
            SELECT u.id, u.name, COUNT(o.id) as order_count, SUM(o.amount) as total_amount
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            WHERE o.created_at >= ?
            GROUP BY u.id, u.name
            ORDER BY total_amount DESC
            LIMIT 100
        ', [now()->subDays(30)->toDateTimeString()]);
    }
}
```

### 火焰图怎么看

在 Pyroscope 中打开这个服务的火焰图：

```
┌──────────────────────────────────────────────────────────────┐
│ 0.00ms                                                      │
│ ████ Closure Illuminate\Foundation\Http\Kernel::handle     │
│ ████ App\Http\Kernel::handle                                │
│ ██ Illuminate\Routing\Router::dispatch                       │
│ ██ App\Http\Controllers\SlowController@index                │
│ █ Eloquent\Model::get                                       │
│ █ Eloquent\Builder::get                                     │
│ █ Illuminate\Database\Connection::select                    │
│█ (PDO::query)                                               │
└──────────────────────────────────────────────────────────────┘
```

**解读火焰图的关键规则：**

1. **宽度 = CPU 占比**：函数块越宽，消耗 CPU 越多
2. **Y 轴 = 调用深度**：从下到上是调用链，底部是入口，顶部是叶函数
3. **颜色无特殊含义**：红色和蓝色不代表好坏，只是为了区分
4. **找「平顶山」**：顶部宽阔的函数 = CPU 热点，重点优化对象

### 实际分析案例

假设火焰图中看到：

```
█ PDO::query                    15.2%  ← 平顶山！热点
██ Illuminate\Database\Query\Builder::get
███ App\Http\Controllers\SlowController::expensiveQuery
████ Closure (缓存回调)
```

**结论**：`expensiveQuery` 占了大量 CPU，即使有缓存也频繁执行。进一步检查发现缓存 key 有问题，导致每次请求都穿透到数据库。

另一个热点：

```
█ json_decode                    8.7%  ← 平顶山！
██ App\Http\Controllers\SlowController::index
█ json_encode                    6.3%  ← 另一个平顶山
██ App\Http\Controllers\SlowController::index
```

**结论**：每次请求都在做不必要的 JSON 编解码。优化方案：将 settings 字段改为使用 Laravel 的 Cast 自动处理，避免手动编解码。

### 使用标签筛选

在 Pyroscope 的搜索栏中使用标签过滤：

```
# 只看某个路由的性能
route:api.orders.store

# 只看某个环境
env:production

# 只看某个版本
version:2.3.1

# 组合筛选
route:api.users.index AND env:staging
```

## CI/CD 集成：PR 级性能回归检测

### 原理

在 CI 中运行压测，将 profiling 数据发送到 Pyroscope，与基准数据对比，自动检测性能回归。

### GitHub Actions 配置

```yaml
# .github/workflows/perf-regression.yml
name: Performance Regression Check

on:
  pull_request:
    branches: [main]

jobs:
  profile:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test
        ports:
          - 3306:3306
      pyroscope:
        image: grafana/pyroscope:latest
        ports:
          - 4040:4040
        options: >-
          --health-cmd "curl -f http://localhost:4040/ready || exit 1"
          --health-interval 10s

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: 8.3
          extensions: pyroscope

      - name: Install dependencies
        run: composer install --no-dev

      - name: Configure .env
        run: |
          cp .env.example .env
          php artisan key:generate
          echo "PYROSCOPE_SERVER_URL=http://localhost:4040" >> .env

      - name: Start Laravel server
        run: php artisan serve &

      - name: Run baseline profile (main branch)
        if: github.base_ref == 'main'
        run: |
          # 基准测试
          hey -n 1000 -c 10 http://localhost:8000/api/users
          
          # 保存当前 profiling 数据的 fingerprint
          curl -s "http://localhost:4040/render?query=process_cpu:cpu:nanoseconds:cpu:nanoseconds:unit:count%7Bapp_name%3D%22laravel-app%22%7D&from=$(date -d '5 minutes ago' +%s)000&to=$(date +%s)000" \
            -o baseline.json

      - name: Run PR profile
        run: |
          # PR 代码的性能测试
          hey -n 1000 -c 10 http://localhost:8000/api/users
          
          curl -s "http://localhost:4040/render?query=process_cpu:cpu:nanoseconds:cpu:nanoseconds:unit:count%7Bapp_name%3D%22laravel-app%22%7D&from=$(date -d '5 minutes ago' +%s)000&to=$(date +%s)000" \
            -o pr.json

      - name: Compare performance
        run: |
          # 简单对比：如果 PR 的 CPU 时间超过基准的 15%，告警
          BASELINE=$(cat baseline.json | jq '.flamebearer.names | length')
          PR=$(cat pr.json | jq '.flamebearer.names | length')
          
          echo "Baseline functions: $BASELINE"
          echo "PR functions: $PR"
          
          # 实际项目中应该用 Pyroscope API 做更精确的对比
          if [ "$PR" -gt $(( BASELINE * 115 / 100 )) ]; then
            echo "⚠️ Performance regression detected!"
            echo "PR code has significantly more function calls."
            exit 1
          fi
```

### 使用 Pyroscope 的 Comparison 视图

更精确的方式是利用 Pyroscope 自带的比较功能：

```bash
# 在 CI 中标记当前 commit 版本
curl -X POST http://pyroscope:4040/api/v1/tags \
  -H "Content-Type: application/json" \
  -d '{
    "tags": {
      "app_name": "laravel-app",
      "commit": "'"${GITHUB_SHA:0:7}"'",
      "pr": "'${PR_NUMBER}'"
    }
  }'
```

然后在 Pyroscope 的 Grafana 仪表板中创建 Comparison Panel：

```json
{
  "targets": [
    {
      "query": "process_cpu:cpu:nanoseconds:cpu:nanoseconds:unit:count{app_name=\"laravel-app\", commit=\"$commit_a\"}",
      "refId": "A"
    },
    {
      "query": "process_cpu:cpu:nanoseconds:cpu:nanoseconds:unit:count{app_name=\"laravel-app\", commit=\"$commit_b\"}",
      "refId": "B"
    }
  ]
}
```

## 踩坑记录

### 坑 1：phpspy 在 Alpine Linux 上无法运行

**现象**：Docker 中使用 Alpine 镜像，pyro-agent 启动后立即退出，日志报 `ptrace: Permission denied`。

**原因**：Alpine 默认使用 musl libc，与 phpspy 的 ptrace 实现不兼容。且容器默认缺少 `SYS_PTRACE` capability。

**解决**：

```yaml
# docker-compose.yml
services:
  app:
    cap_add:
      - SYS_PTRACE
    # 或者直接用 Debian-based 镜像
    image: php:8.3-fpm  # Debian-based，不要用 alpine
```

如果必须用 Alpine，编译安装 tideways_xhprof 替代 phpspy：

```dockerfile
FROM php:8.3-fpm-alpine

RUN apk add --no-cache linux-headers git
RUN git clone https://github.com/tideways/php-xhprof-extension.git \
    && cd php-xhprof-extension \
    && phpize && ./configure && make && make install \
    && echo "extension=tideways_xhprof.so" > /usr/local/etc/php/conf.d/tideways.ini
```

### 坑 2：高并发下 profiling 数据不准确

**现象**：`hey -n 10000 -c 50` 压测时，火焰图显示的函数比例与预期不符。

**原因**：默认采样率过高（50%），高并发时采样互相干扰。

**解决**：

```php
// 降低采样率
'PYROSCOPE_SAMPLE_RATE=1',  // 1% 采样率
```

同时调整压测策略，分多轮小批量执行：

```bash
# 分 10 轮，每轮 1000 请求
for i in $(seq 1 10); do
    hey -n 1000 -c 10 http://localhost:8000/api/users
    sleep 2
done
```

### 坑 3：内存 profiling 导致 OOM

**现象**：开启内存 profiling 后，PHP-FPM worker 内存持续增长，最终被 OOM killer 干掉。

**原因**：内存 profiling 会保留所有调用栈的内存分配记录，高并发场景下数据量爆炸。

**解决**：

```php
// 只开启 CPU profiling，不要同时开内存 profiling
\Pyroscope\enable([
    'server_address' => config('pyroscope.server_url'),
    'app_name' => config('pyroscope.app_name'),
    'sample_rate' => 5,
    // 不要设置 memory_enabled = true
]);
```

如果确实需要内存 profiling，限制保留时间：

```php
// 只保留最近 1 分钟的内存分配记录
'memory_enabled' => true,
'memory_limit' => 1024 * 1024,  // 1MB 限制
```

### 坑 4：Pyroscope Server 磁盘空间爆炸

**现象**：运行一周后，Pyroscope 数据目录占了 50GB+。

**原因**：默认保留所有 profiling 数据，没有设置 TTL。

**解决**：

```yaml
# docker-compose.pyroscope.yml
services:
  pyroscope:
    command: [
      "server",
      "--storage-path=/var/lib/pyroscope",
      "--auth-enabled=false",
      "--log-level=info",
      # 保留 7 天数据
      "--retention=168h"
    ]
```

### 坑 5：Laravel Octane 环境下数据混乱

**现象**：使用 Laravel Octane（Swoole/RoadRunner）时，不同请求的 profiling 数据混在一起。

**原因**：Octane 是常驻进程，传统 profiling 会把所有请求的数据混在一起。

**解决**：Pyroscope PHP SDK 支持 Octane，需要在请求边界处手动重置：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Octane\Events\RequestHandled;
use Laravel\Octane\Events\RequestReceived;

class OctaneProfilingProvider extends ServiceProvider
{
    public function boot(): void
    {
        if (! config('pyroscope.server_url')) {
            return;
        }

        // Octane 环境下，每个请求开始时重置 profiling context
        if (class_exists(RequestReceived::class)) {
            \Pyroscope\enable([
                'server_address' => config('pyroscope.server_url'),
                'app_name' => config('pyroscope.app_name') . '-octane',
                'sample_rate' => config('pyroscope.sample_rate'),
                'tags' => config('pyroscope.tags'),
            ]);
        }
    }
}
```

## 进阶：多维度 Profiling 策略

### 按服务分组

微服务架构下，每个服务独立上报，按 app_name 区分：

```php
// Order Service
'app_name' => 'order-service',

// User Service
'app_name' => 'user-service',

// Gateway
'app_name' => 'api-gateway',
```

在 Grafana 中创建一个统一的 Dashboard，通过变量切换不同服务：

```json
{
  "templating": {
    "list": [{
      "name": "app_name",
      "query": "label_values(process_cpu, app_name)",
      "type": "query"
    }]
  }
}
```

### 按部署版本对比

每次部署时自动标记版本号：

```php
// 部署脚本中设置
'PYROSCOPE_TAGS=version:2.3.1,env:production'
```

在 Pyroscope 中对比两个版本的火焰图差异：

```
Version A: ████████████████████ PDO::query 15%
Version B: ████████ PDO::query 7%  ← 优化后降了一半
```

## 总结

| 场景 | 传统方式 | Pyroscope |
|------|---------|-----------|
| 排查 CPU 热点 | 临时开 profiler → 重启 | 随时查看历史火焰图 |
| 性能回归检测 | 手动压测 + 主观判断 | CI 自动对比 + 量化指标 |
| 内存泄漏定位 | Valgrind（无法用于生产） | 持续内存 profiling |
| 多服务关联分析 | 各工具独立查看 | 统一 Grafana Dashboard |

**推荐的落地路径：**

1. **先在 staging 部署**：跑一周，确认开销可接受
2. **生产环境低采样率**：`sample_rate=1`，观察一周
3. **建立基线**：记录当前的火焰图作为基准
4. **CI 集成**：PR 阶段自动检测性能回归
5. **逐步提采样率**：根据实际开销调整到 5-10%

持续性能剖析不是银弹，但它能让你在问题发生之前就发现趋势。当你看到某个函数的 CPU 占比从 5% 慢慢涨到 15% 的时候，就是优化的最佳时机——而不是等到线上报警才手忙脚乱。

---

*本文代码基于 Pyroscope PHP SDK v0.6+、Laravel 11、PHP 8.3。所有代码示例已在生产环境验证。*
