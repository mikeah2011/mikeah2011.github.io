---

title: Kamal 2 深度实战：DHH 部署哲学的工程化——Laravel 应用的零停机滚动更新、健康检查与回滚策略
keywords: [Kamal, DHH, Laravel, 深度实战, 部署哲学的工程化, 应用的零停机滚动更新, 健康检查与回滚策略]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-06-09 16:45:00
updated: 2026-06-09 16:45:00
categories:
- architecture
tags:
- Kamal
- kamal2
- dhh
- Docker
- 零停机
- 滚动更新
- 健康检查
- 回滚
- Laravel
- deploy
description: Kamal 2 零停机滚动更新、健康检查与回滚策略的深度实战。从 DHH 的「极简部署」哲学出发，深入拆解 Kamal 2 的 role/sequencing/stopping 三大部署编排机制，讲解如何配置健康检查（HTTP/TCP/自定义脚本）、如何实现真正零停机的滚动更新，以及部署失败时的自动回滚与手动回滚两种策略。以 Laravel 11 应用为例，覆盖 Redis 会话保持、数据库迁移协调、多服务器协调等真实场景。附 Kamal 2 vs Docker Compose 部署脚本 vs K8s 的三方案对比、踩坑清单与生产环境 Checklist。
---




## 前言：为什么需要这篇文章？

上一篇《Kamal 2 实战》讲了 Kamal 的安装、配置和一键发布——那是「能用」的阶段。但生产环境真正考验的是：

1. **零停机**：用户正在下单，你更新了代码，订单丢了怎么办？
2. **健康检查**：新容器启动了，但 PHP-FPM 还没 ready，流量打进来直接 502
3. **回滚**：新版本有 bug，怎么秒回上一版本？

DHH 在 Kamal 的设计哲学里反复强调「Deployment should be boring」——部署应该无聊到让人打瞌睡。但如果这三个问题没处理好，部署会变成一场噩梦。

本文以 Laravel 11 应用为例，完整拆解 Kamal 2 的深度部署策略。

---

## 第一部分：DHH 的部署哲学

### 1.1 「极简」不等于「简陋」

DHH 对 Kubernetes 的批评众所周知——他觉得 K8s 对大多数 Web 应用来说是杀鸡用牛刀。Kamal 的设计哲学是：

- **一台服务器就能跑**：不需要 K8s 的集群、Pod、Service、Ingress 一大堆概念
- **Docker 是实现细节**：你写的是 Ruby/Rails/Laravel 应用，不是 Dockerfile
- **SSH 够了**：不需要 etcd、Consul、Vault 这些分布式基础设施

但「极简」不是「简陋」。Kamal 2 补上了之前缺失的关键能力：

| 能力 | Kamal 1 | Kamal 2 |
|------|---------|---------|
| Role 编排 | ❌ 无 | ✅ web/worker/cron 分角色部署 |
| 顺序控制 | ❌ 无 | ✅ `rolling` + `stop_wait_time` |
| 健康检查 | 仅容器级 | HTTP/TCP/脚本三层 |
| 回滚 | 手动 `docker rollback` | 内置 `kamal rollback` |
| 多服务器 | 支持但无编排 | role-based rolling across hosts |
| 零停机 | 依赖 Nginx 缓冲 | 内置 connection draining |

### 1.2 零停机的本质问题

零停机更新的核心矛盾：**新容器还没 ready，旧容器就要停**。如果同时切换，就有短暂的空窗期。

传统方案是在 Nginx 层面做缓冲——请求打到 Nginx，Nginx 转发给 upstream。Kamal 2 的方案更直接：

```
新容器启动 → 健康检查通过 → 注册到 Traefik → 旧容器停止接受新连接 → 旧容器排空现有连接 → 旧容器停止
```

这不是「秒切」，而是「渐切」——旧连接继续处理完，新连接全部走新容器。

---

## 第二部分：Role 编排——让部署有章法

### 2.1 什么是 Role？

Role 是 Kamal 2 的核心概念。它把「部署」从「把所有容器全部更新」变成了「按角色分步更新」。

```yaml
# config/deploy.yml
service: myapp
image: myuser/myapp

servers:
  web:
    hosts:
      - 192.168.1.10
      - 192.168.1.11
    options:
      network: "private"

  worker:
    hosts:
      - 192.168.1.10
    cmd: "php artisan queue:work --sleep=3 --tries=3"

  cron:
    hosts:
      - 192.168.1.10
    cmd: "php artisan schedule:work"
```

### 2.2 Role 的部署顺序

Kamal 2 默认的部署顺序：

1. **web** → 先更新 Web 服务器（流量入口）
2. **worker** → 再更新队列 worker
3. **cron** → 最后更新定时任务

这个顺序很重要。如果你先停了 worker，正在处理的消息会丢失。先更新 web，再更新 worker，保证消息始终有 worker 在处理。

### 2.3 自定义 Role 顺序

```yaml
# config/deploy.yml
roles:
  - web
  - worker
  - cron

# 更精细的控制
servers:
  web:
    hosts:
      - 192.168.1.10
    rolling: true  # 滚动更新
    limit: 1       # 每次只更新 1 台
```

### 2.4 滚动更新实战

```bash
# 查看当前部署状态
kamal status

# 滚动更新（默认行为）
kamal deploy

# 强制重置（跳过健康检查）
kamal deploy --force

# 只更新某个 role
kamal app exec --role=worker "php artisan queue:restart"
```

---

## 第三部分：健康检查——确认新容器真的 ready

### 3.1 三种健康检查方式

Kamal 2 支持三种健康检查：

#### HTTP 健康检查（推荐）

```yaml
# config/deploy.yml
healthcheck:
  path: /up
  port: 8000
  interval: 5
  timeout: 3
  retries: 3
  start_period: 10
```

Laravel 11 默认提供了 `/up` 路由：

```php
// routes/web.php
Route::get('/up', function () {
    // 可以加更多检查
    return response('OK', 200);
});
```

#### TCP 健康检查

```yaml
healthcheck:
  port: 8000
  type: tcp
```

#### 自定义脚本健康检查

```yaml
healthcheck:
  command: "php artisan health:check"
```

```php
// app/Console/Commands/HealthCheckCommand.php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class HealthCheckCommand extends Command
{
    protected $signature = 'health:check';

    public function handle(): int
    {
        // 检查数据库
        try {
            DB::connection()->getPdo();
        } catch (\Exception $e) {
            $this->error('Database connection failed: ' . $e->getMessage());
            return 1;
        }

        // 检查 Redis
        try {
            Redis::ping();
        } catch (\Exception $e) {
            $this->error('Redis connection failed: ' . $e->getMessage());
            return 1;
        }

        // 检查队列连接
        try {
            config('queue.default');
        } catch (\Exception $e) {
            $this->error('Queue check failed: ' . $e->getMessage());
            return 1;
        }

        $this->info('All checks passed');
        return 0;
    }
}
```

### 3.2 健康检查的时机

```
容器启动
    ↓
等待 start_period（10s）→ 给 PHP-FPM/Worker 启动时间
    ↓
每 interval（5s）检查一次
    ↓
连续 retries（3次）都成功 → 标记为 healthy
    ↓
如果 retries 次失败 → 标记为 unhealthy → 不注入流量 → 触发回滚
```

### 3.3 健康检查失败的处理

```yaml
# config/deploy.yml
healthcheck:
  path: /up
  port: 8000
  interval: 5
  timeout: 3
  retries: 3
  start_period: 10

# 失败后的处理
deploy:
  max_attempts: 3          # 最多重试 3 次
  wait: 5                  # 每次等待 5 秒
  rollback_on_error: true  # 失败自动回滚
```

### 3.4 生产环境健康检查增强

```php
// app/Http/Middleware/HealthCheck.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class HealthCheck
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->path() !== 'up') {
            return $next($request);
        }

        $checks = [
            'database' => fn() => DB::connection()->getPdo(),
            'redis'    => fn() => Redis::ping(),
            'disk'     => fn() => disk_free_percent() > 10,
        ];

        $results = [];
        foreach ($checks as $name => $check) {
            try {
                $check();
                $results[$name] = 'ok';
            } catch (\Exception $e) {
                $results[$name] = 'failed: ' . $e->getMessage();
            }
        }

        $failed = array_filter($results, fn($r) => $r !== 'ok');

        if (!empty($failed)) {
            return response()->json([
                'status'  => 'unhealthy',
                'checks'  => $results,
                'failed'  => array_keys($failed),
            ], 503);
        }

        return response()->json([
            'status' => 'healthy',
            'checks' => $results,
        ]);
    }
}
```

---

## 第四部分：零停机滚动更新——完整流程

### 4.1 更新前的准备

```bash
# 1. 检查当前状态
kamal status

# 2. 预热新镜像
kamal app build

# 3. 测试新镜像
docker run --rm -it myuser/myapp:latest sh -c "php artisan --version"

# 4. 备份当前版本信息
kamal app current > /tmp/current-version.txt
```

### 4.2 执行零停机更新

```bash
# 标准部署（包含零停机处理）
kamal deploy

# 指定版本部署
kamal deploy --version=abc123

# 预览部署（dry-run）
kamal deploy --dry-run
```

### 4.3 更新过程中的连接处理

Kamal 2 的零停机流程：

```
时间线：
0s   → 新容器启动
3s   → 健康检查开始
8s   → 健康检查通过（连续3次）
8s   → 新容器注册到 Traefik
8s   → 新连接开始路由到新容器
8s   → 旧容器停止接受新连接
8-13s → 旧容器继续处理现有连接（draining）
13s  → 旧容器完全停止
```

关键配置：

```yaml
# config/deploy.yml
# 停止等待时间（旧容器排空连接的最长时间）
servers:
  web:
    options:
      stop_wait_time: 30  # 等待 30 秒让旧连接完成

# Traefik 配置
proxy:
  ssl: true
  host: example.com
  healthcheck:
    path: /up
    port: 8000
```

### 4.4 会话保持问题

如果 Laravel 使用文件 Session，零停机更新没问题。但如果你用 Redis/Database Session：

```php
// config/session.php
'driver' => env('SESSION_DRIVER', 'redis'),  // Redis 默认支持
'connection' => env('SESSION_CONNECTION', 'default'),
```

Redis Session 天然支持多容器共享——新旧容器都连同一个 Redis，会话不会丢失。

但如果用 Cookie Session：

```php
// 旧容器生成的 Cookie 在新容器上也能解密
// 前提是 APP_KEY 不变
```

### 4.5 数据库迁移协调

零停机更新时，数据库迁移是最危险的环节：

```bash
# Kamal 2 默认在部署前执行迁移
# config/deploy.yml
run:
  - "php artisan migrate --force"

# 更安全的方式：分离迁移和部署
# 方案一：手动先迁移
kamal app exec "php artisan migrate --force"
kamal deploy

# 方案二：使用 --no-migrate
kamal deploy --no-migrate
```

**迁移安全规则**：

1. **新增表/字段** → 安全，旧代码忽略新字段
2. **删除字段** → 危险，旧代码可能还在用
3. **重命名字段** → 危险，需要分步迁移

```php
// 安全的迁移策略：分三步
// 第一步：添加新字段（deploy v1）
Schema::table('orders', function (Blueprint $table) {
    $table->string('new_status')->nullable();
});

// 第二步：数据填充（deploy v1 后手动执行）
DB::table('orders')->update(['new_status' => DB::raw('status')]);

// 第三步：删除旧字段（deploy v2）
Schema::table('orders', function (Blueprint $table) {
    $table->dropColumn('status');
});
```

---

## 第五部分：回滚策略——当新版本出问题

### 5.1 自动回滚

```yaml
# config/deploy.yml
deploy:
  max_attempts: 3
  wait: 5
  rollback_on_error: true  # 健康检查失败自动回滚
```

自动回滚触发条件：

1. 健康检查连续失败 3 次
2. 新容器启动超时
3. Traefik 无法连接到新容器

### 5.2 手动回滚

```bash
# 查看部署历史
kamal app versions

# 回滚到上一个版本
kamal rollback

# 回滚到指定版本
kamal rollback abc123

# 回滚后验证
kamal status
curl -I https://example.com/up
```

### 5.3 回滚的底层原理

Kamal 回滚本质是：

1. 用上一个版本的镜像重新部署
2. 执行健康检查
3. 注册到 Traefik
4. 停止当前（有问题的）容器

```bash
# Kamal 内部等价于
docker pull myuser/myapp:previous-version
docker stop myapp-web-current
docker run -d myuser/myapp:previous-version
# 注册到 Traefik → 流量切回旧版本
```

### 5.4 回滚时的数据库兼容性

回滚代码容易，回滚数据库难。如果新版本改了数据库结构：

```php
// 回滚策略：保持数据库向前兼容
// 规则：新版本的迁移应该能被旧版本容忍

// 好的迁移：新增字段，旧代码忽略
Schema::table('orders', function (Blueprint $table) {
    $table->string('payment_method')->nullable()->after('status');
});

// 坏的迁移：删除字段，旧代码报错
Schema::table('orders', function (Blueprint $table) {
    $table->dropColumn('payment_method');  // 旧代码还在用！
});
```

### 5.5 完整回滚 SOP

```bash
#!/bin/bash
# rollback.sh — 生产环境回滚标准操作

echo "=== Kamal 生产回滚 SOP ==="
echo ""

# 1. 确认当前状态
echo "1. 当前部署状态："
kamal status
echo ""

# 2. 查看可用版本
echo "2. 可用版本列表："
kamal app versions
echo ""

# 3. 确认回滚目标
read -p "回滚到哪个版本？(直接回车=上一版本): " VERSION

if [ -z "$VERSION" ]; then
    echo "执行回滚到上一版本..."
    kamal rollback
else
    echo "回滚到 $VERSION..."
    kamal rollback "$VERSION"
fi

# 4. 验证回滚
echo ""
echo "4. 验证回滚结果："
kamal status
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://example.com/up

# 5. 通知
echo ""
echo "回滚完成。请检查监控系统确认服务正常。"
```

---

## 第六部分：多服务器场景

### 6.1 多服务器滚动更新

当有 2+ 台服务器时，Kamal 2 的滚动更新更加精细：

```yaml
# config/deploy.yml
servers:
  web:
    hosts:
      - 192.168.1.10
      - 192.168.1.11
      - 192.168.1.12
    rolling: true  # 逐台更新
    limit: 1       # 每次只更新 1 台
```

更新流程：

```
Server 1 (1.10) → 新容器启动 → 健康检查通过 → 注册到 Traefik
                                    ↓
Server 2 (1.11) → 旧容器继续服务 → 等待 5 秒（观察 Server 1）
                                    ↓
                              确认 Server 1 正常 → 更新 Server 2
                                    ↓
Server 3 (1.12) → 同理...
```

### 6.2 权重分配

```yaml
servers:
  web:
    hosts:
      - 192.168.1.10:
          options:
            role: primary    # 主服务器，优先接收流量
      - 192.168.1.11:
          options:
            role: secondary
```

### 6.3 部署锁定

```bash
# 锁定部署（防止并发部署）
kamal deploy --lock

# 查看锁状态
kamal lock status

# 手动解锁
kamal lock release
```

---

## 第七部分：实战完整配置

### 7.1 生产环境 config/deploy.yml

```yaml
# config/deploy.yml — 生产环境完整配置
service: myapp
image: myuser/myapp

# 服务器配置
servers:
  web:
    hosts:
      - 192.168.1.10
      - 192.168.1.11
    options:
      network: "private"
      stop_wait_time: 30
      log_level: "debug"

  worker:
    hosts:
      - 192.168.1.10
      - 192.168.1.11
    cmd: "php artisan queue:work --sleep=3 --tries=3 --max-time=3600"

  cron:
    hosts:
      - 192.168.1.10
    cmd: "php artisan schedule:work"

# 健康检查
healthcheck:
  path: /up
  port: 8000
  interval: 5
  timeout: 3
  retries: 3
  start_period: 10

# 构建配置
builder:
  arch: amd64
  cache:
    type: gha
    options: ignore-mutable-contents

# 代理配置
proxy:
  ssl: true
  host: example.com
  app_port: 8000
  healthcheck:
    path: /up
    port: 8000

# 环境变量
env:
  clear:
    APP_ENV: production
    APP_DEBUG: false
    APP_URL: https://example.com
    DB_HOST: db.example.com
    DB_DATABASE: myapp
    REDIS_HOST: redis.example.com
  secret:
    - APP_KEY
    - DB_PASSWORD
    - MAIL_PASSWORD

# 挂载卷
volumes:
  - "storage:/var/www/html/storage"

# 数据库迁移
run:
  - "php artisan migrate --force"

# 部署配置
deploy:
  max_attempts: 3
  wait: 5
  rollback_on_error: true
```

### 7.2 .kamal/secrets

```bash
# .kamal/secrets — 敏感信息
KAMAL_REGISTRY_PASSWORD=your_registry_password
KAMAL_SERVER_PASSWORD=your_server_password
KAMAL_REGISTRY_USERNAME=your_username
KAMAL_REGISTRY_HOST=registry.example.com
KAMAL_REGISTRY_BASE=registry.example.com/myapp

# 环境变量
APP_KEY=base64:your_app_key_here
DB_PASSWORD=your_db_password
MAIL_PASSWORD=your_mail_password
```

### 7.3 Dockerfile 优化

```dockerfile
# Dockerfile — 生产优化版
FROM --platform=linux/amd64 php:8.3-fpm-alpine

# 安装依赖
RUN apk add --no-cache \
    libzip-dev \
    oniguruma-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    icu-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_mysql mbstring zip exif pcntl bcmath gd intl opcache

# 安装 Redis 扩展
RUN apk add --no-cache $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis

# 安装 Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# 设置工作目录
WORKDIR /var/www/html

# 复制依赖文件
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

# 复制应用代码
COPY . .

# 生成优化后的 autoloader
RUN composer dump-autoload --optimize --classmap-authoritative

# 设置权限
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# 复制启动脚本
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 9000
CMD ["php-fpm"]
```

```bash
#!/bin/bash
# docker-entrypoint.sh
set -e

# 运行迁移（如果启用）
if [ "$RUN_MIGRATIONS" = "true" ]; then
    php artisan migrate --force
fi

# 清理缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache

# 启动 PHP-FPM
exec php-fpm
```

---

## 第八部分：踩坑记录

### 坑 1：健康检查通过但应用实际不可用

**症状**：`/up` 返回 200，但用户请求 500 错误。

**原因**：`/up` 只检查了基础连通性，没有检查应用核心功能。

**修复**：增强健康检查：

```php
Route::get('/up', function () {
    // 不只是检查连通性
    $checks = [
        'database' => fn() => DB::select('SELECT 1'),
        'redis'    => fn() => Redis::ping(),
        'storage'  => fn() => is_writable(storage_path()),
    ];

    foreach ($checks as $name => $check) {
        try {
            $check();
        } catch (\Exception $e) {
            abort(503, "Health check failed: {$name}");
        }
    }

    return response('OK', 200);
});
```

### 坑 2：滚动更新时队列消息丢失

**症状**：更新过程中有消息从队列消失。

**原因**：worker 容器被强制停止，正在处理的消息丢失。

**修复**：

```yaml
# 配置优雅停止
servers:
  worker:
    cmd: "php artisan queue:work --sleep=3 --tries=3 --max-time=3600"
    options:
      stop_wait_time: 60  # 等待 60 秒让当前消息处理完
```

```php
// app/Providers/AppServiceProvider.php
public function boot()
{
    // 注册关闭回调
    app()->terminating(function () {
        // 等待当前任务完成
        sleep(5);
    });
}
```

### 坑 3：回滚后数据库不兼容

**症状**：回滚代码后，数据库报「column not found」。

**原因**：新版本的迁移删除了旧版本使用的字段。

**修复**：

```php
// 规则：迁移必须向前兼容
// 好的迁移：只增不删
Schema::table('orders', function (Blueprint $table) {
    $table->string('new_field')->nullable()->after('existing_field');
});

// 分离部署：先部署代码（忽略新字段），再迁移
// 而不是同时部署代码+迁移
```

### 坑 4：多服务器时角色顺序错误

**症状**：worker 更新了，但 web 还在用旧代码，导致 Redis 队列格式不兼容。

**原因**：role 顺序不对，应该先更新 web 再更新 worker。

**修复**：

```yaml
# 明确指定顺序
roles:
  - web      # 先更新 Web 服务器
  - worker   # 再更新队列 Worker
  - cron     # 最后更新定时任务
```

### 坑 5：Traefik 路由延迟导致短暂 502

**症状**：部署后有 1-2 秒的 502 错误。

**原因**：新容器注册到 Traefik 后，Traefik 需要时间更新路由表。

**修复**：

```yaml
# 增加 start_period 给 Traefik 更多时间
healthcheck:
  path: /up
  port: 8000
  interval: 5
  timeout: 3
  retries: 5          # 增加重试次数
  start_period: 15    # 增加启动等待时间
```

### 坑 6：部署时存储目录权限问题

**症状**：部署后 storage 目录无法写入。

**原因**：新容器的存储卷权限不对。

**修复**：

```bash
# 在部署后执行权限修复
kamal app exec "chmod -R 775 storage bootstrap/cache"
kamal app exec "chown -R www-data:www-data storage bootstrap/cache"
```

---

## 第九部分：Kamal 2 vs Docker Compose vs K8s

| 特性 | Kamal 2 | Docker Compose 部署脚本 | Kubernetes |
|------|---------|------------------------|------------|
| 学习曲线 | ⭐⭐ 低 | ⭐⭐ 低 | ⭐⭐⭐⭐⭐ 高 |
| 零停机 | ✅ 内置 | ⚠️ 需自行实现 | ✅ 内置 |
| 健康检查 | ✅ HTTP/TCP/脚本 | ⚠️ 需额外配置 | ✅ 丰富 |
| 自动回滚 | ✅ 内置 | ❌ 需手动 | ✅ 原生支持 |
| 多服务器 | ✅ role-based | ⚠️ 需额外编排 | ✅ 原生支持 |
| 角色分离 | ✅ web/worker/cron | ❌ 无 | ✅ Deployment/StatefulSet |
| 运维复杂度 | 低 | 低 | 高 |
| 适合规模 | 1-20 台 | 1-5 台 | 50+ 台 |
| 生态系统 | 中等 | Docker 生态 | 极丰富 |

**结论**：

- **1-5 台服务器** → Kamal 2 或 Docker Compose + 脚本
- **5-20 台服务器** → Kamal 2
- **20+ 台服务器** → 考虑 Kubernetes

---

## 第十部分：生产环境 Checklist

### 部署前

- [ ] `APP_KEY` 已配置
- [ ] `.env.production` 环境变量正确
- [ ] 数据库迁移已测试（`php artisan migrate --pretend`）
- [ ] 镜像已构建并测试通过
- [ ] 健康检查端点 `/up` 已实现
- [ ] `stop_wait_time` 已配置（至少 30 秒）
- [ ] Redis Session 配置正确

### 部署中

- [ ] 监控系统已就绪（Sentry/日志）
- [ ] 通知渠道已配置（飞书/Discord/Slack）
- [ ] 数据库备份已执行
- [ ] 部署锁已获取

### 部署后

- [ ] 健康检查通过
- [ ] 关键功能已验证（登录/下单/支付）
- [ ] 队列 worker 正常运行
- [ ] 定时任务正常执行
- [ ] 日志无异常
- [ ] 监控无告警

### 回滚准备

- [ ] 上一版本镜像可用
- [ ] 回滚脚本已准备
- [ ] 数据库迁移支持回滚

---

## 总结

Kamal 2 的深度部署策略可以总结为三个核心能力：

1. **Role 编排**：按角色分步更新，避免更新过程中功能缺失
2. **健康检查**：确保新容器真正 ready 才注入流量
3. **回滚机制**：失败时快速回到上一个稳定版本

DHH 的「极简部署」哲学不是逃避复杂性，而是把复杂性封装在简单的接口后面。你不需要理解 K8s 的 Pod/Service/Ingress，只需要理解 role、healthcheck、rollback 这三个概念。

生产环境部署的核心原则：

- **永远不要在高峰期部署**
- **永远先测试再部署**
- **永远有回滚方案**
- **永远监控部署后状态**

部署应该无聊到让人打瞌睡——这才是 Kamal 2 的终极目标。

---

**下一篇预告**：《Kamal 2 高级配置：多环境管理、密钥轮换与部署流水线》

---

*本文基于 Kamal 2.5+、Laravel 11、PHP 8.3 编写。Kamal 版本更新可能导致配置差异，请以官方文档为准。*
