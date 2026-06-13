---
title: 蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚
date: 2026-06-02 10:00:00
tags: [蓝绿部署, Laravel, 零停机, DevOps, 运维]
keywords: [Laravel, 蓝绿部署实战, 应用零停机发布, 流量切换, 数据库迁移与一键回滚, DevOps]
categories:
  - devops
description: Laravel 应用蓝绿部署实战指南，详解零停机发布架构设计、Nginx 负载均衡流量切换、数据库向前兼容迁移策略、队列与会话处理、一键回滚脚本编写，结合真实生产踩坑案例，帮助运维和开发团队掌握蓝绿部署核心技能，实现秒级发布与秒级回滚。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---


## 前言

每次部署 Laravel 应用时，用户是否经历过"网站正在维护"的 502 错误？数据库迁移期间的请求失败、队列任务丢失、会话中断——这些都是传统部署方式的常见痛点。

蓝绿部署（Blue-Green Deployment）通过维护两个完全相同的生产环境来解决这些问题：一个对外服务（活跃环境），另一个用于部署和测试新版本。部署完成后，通过负载均衡器瞬间切换流量，实现零停机发布。如果新版本有问题，只需一键切回旧环境。

本文将从理论到实践，完整讲解如何为 Laravel 应用实现蓝绿部署，包括流量切换、数据库迁移策略、队列处理和一键回滚。

---

## 第一章：蓝绿部署理论基础

### 1.1 部署策略对比

```
┌───────────────────────────────────────────────────────────────┐
│                    部署策略对比                                  │
├─────────────┬──────────────┬──────────────┬──────────────────┤
│             │  重建部署     │  滚动更新    │  蓝绿部署          │
│             │ (Recreate)   │ (Rolling)    │ (Blue-Green)     │
├─────────────┼──────────────┼──────────────┼──────────────────┤
│ 停机时间     │ 长           │ 无           │ 无               │
│ 回滚速度     │ 慢           │ 慢           │ 极快（秒级）       │
│ 资源消耗     │ 1x           │ 1.1x         │ 2x              │
│ 数据库兼容性  │ 无需考虑     │ 需向后兼容    │ 需向后兼容        │
│ 复杂度       │ 低           │ 中           │ 中高              │
│ 风险         │ 高           │ 中           │ 低               │
│ 适用场景     │ 开发/测试    │ 大多数场景    │ 关键业务          │
└─────────────┴──────────────┴──────────────┴──────────────────┘
```

### 1.2 蓝绿部署架构

```
                    ┌─────────────┐
                    │   用户请求    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  负载均衡器   │  ← 流量切换点
                    │ (Nginx/ALB)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐    │    ┌───────▼─────┐
       │  Blue 环境   │    │    │  Green 环境  │
       │ (当前版本)   │    │    │  (新版本)    │
       │             │    │    │             │
       │ ┌─────────┐ │    │    │ ┌─────────┐ │
       │ │ Laravel │ │    │    │ │ Laravel │ │
       │ │ App v1  │ │    │    │ │ App v2  │ │
       │ └─────────┘ │    │    │ └─────────┘ │
       │ ┌─────────┐ │    │    │ ┌─────────┐ │
       │ │ Queue   │ │    │    │ │ Queue   │ │
       │ │ Worker  │ │    │    │ │ Worker  │ │
       │ └─────────┘ │    │    │ └─────────┘ │
       └──────┬──────┘    │    └──────┬──────┘
              │           │           │
              └───────────┼───────────┘
                          │
                   ┌──────▼──────┐
                   │  共享数据库   │  ← 两个环境共享
                   │  (PostgreSQL)│
                   │  + Redis    │
                   └─────────────┘
```

### 1.3 蓝绿部署的核心原则

1. **环境完全对等**：Blue 和 Green 环境的配置、资源、依赖完全相同
2. **共享数据层**：数据库、Redis、文件存储等数据层被两个环境共享
3. **瞬间切换**：流量切换通过负载均衡器配置变更实现，通常在 1-2 秒内完成
4. **快速回滚**：发现问题后，切回旧环境只需几秒
5. **向后兼容**：新版本的数据库迁移必须与旧版本代码兼容

---

## 第二章：基础设施搭建

### 2.1 服务器架构

假设我们使用 2 台应用服务器 + 1 台数据库服务器 + 1 台 Redis 服务器：

```
服务器规划：
├── App Server 1 (Blue)   - 10.0.1.10
│   ├── Nginx + Laravel App
│   └── Queue Worker
├── App Server 2 (Green)  - 10.0.1.11
│   ├── Nginx + Laravel App
│   └── Queue Worker
├── DB Server              - 10.0.1.20
│   └── PostgreSQL 16
├── Cache Server           - 10.0.1.21
│   └── Redis 7
└── Load Balancer          - 10.0.1.1 (公网 IP)
    └── Nginx / HAProxy
```

### 2.2 Nginx 负载均衡配置

```nginx
# /etc/nginx/conf.d/laravel-lb.conf

# 上游服务器组定义
upstream blue_backend {
    server 10.0.1.10:8080;
    # 可以添加多个 Blue 服务器实现水平扩展
    # server 10.0.1.12:8080;
}

upstream green_backend {
    server 10.0.1.11:8080;
    # server 10.0.1.13:8080;
}

# 当前活跃环境（通过 include 文件实现快速切换）
# active_env.conf 内容：set $active_env blue; 或 set $active_env green;
include /etc/nginx/conf.d/active_env.conf;

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.example.com.pem;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 根据活跃环境选择上游
    location / {
        if ($active_env = "blue") {
            proxy_pass http://blue_backend;
        }
        if ($active_env = "green") {
            proxy_pass http://green_backend;
        }

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 会话亲和性（如果需要）
        # ip_hash;

        # 超时配置
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查端点
    location /health {
        proxy_pass http://$active_env_backend/health;
        access_log off;
    }
}
```

更优雅的实现方式使用 map 指令：

```nginx
# /etc/nginx/conf.d/laravel-lb.conf

map $active_env $backend {
    "blue"   blue_backend;
    "green"  green_backend;
}

upstream blue_backend {
    server 10.0.1.10:8080;
}

upstream green_backend {
    server 10.0.1.11:8080;
}

include /etc/nginx/conf.d/active_env.conf;

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.example.com.pem;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;

    location / {
        proxy_pass http://$backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Active-Env $active_env;
    }
}
```

### 2.3 环境配置管理

两个环境使用相同的 `.env` 配置（因为共享数据库和 Redis）：

```bash
# /var/www/laravel/.env（两个环境相同）

APP_NAME="My Laravel App"
APP_ENV=production
APP_KEY=base64:xxx
APP_DEBUG=false
APP_URL=https://api.example.com

DB_CONNECTION=pgsql
DB_HOST=10.0.1.20
DB_PORT=5432
DB_DATABASE=myapp
DB_USERNAME=myapp
DB_PASSWORD=secure_password

REDIS_HOST=10.0.1.21
REDIS_PORT=6379
REDIS_PASSWORD=redis_password

CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

# 蓝绿部署标识（用于日志和监控）
DEPLOY_ENV=blue  # 或 green
```

---

## 第三章：部署脚本

### 3.1 完整的蓝绿部署脚本

```bash
#!/usr/bin/env bash
#
# Laravel 蓝绿部署脚本
# 用法: ./deploy.sh [blue|green] <git-tag-or-branch>
#

set -euo pipefail

# ============================================================
# 配置
# ============================================================

LOAD_BALANCER="10.0.1.1"
BLUE_SERVER="10.0.1.10"
GREEN_SERVER="10.0.1.11"
SSH_USER="deploy"
SSH_KEY="~/.ssh/deploy_key"
APP_DIR="/var/www/laravel"
NGINX_CONF_DIR="/etc/nginx/conf.d"
HEALTH_CHECK_URL="https://api.example.com/health"
HEALTH_CHECK_RETRIES=10
HEALTH_CHECK_INTERVAL=3

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 函数定义
# ============================================================

# SSH 远程执行
remote_exec() {
    local server=$1
    shift
    ssh -i $SSH_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$SSH_USER@$server" "$@"
}

# 获取当前活跃环境
get_active_env() {
    ssh -i $SSH_KEY "$SSH_USER@$LOAD_BALANCER" \
        "grep 'active_env' $NGINX_CONF_DIR/active_env.conf | awk '{print \$NF}' | tr -d ';'"
}

# 获取非活跃环境
get_inactive_env() {
    local active=$(get_active_env)
    if [ "$active" = "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# 获取环境对应的服务器 IP
get_server_ip() {
    local env=$1
    if [ "$env" = "blue" ]; then
        echo "$BLUE_SERVER"
    else
        echo "$GREEN_SERVER"
    fi
}

# 健康检查
health_check() {
    local server=$1
    local retries=$HEALTH_CHECK_RETRIES

    log_info "开始健康检查: $server"

    for i in $(seq 1 $retries); do
        local status=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout 5 \
            "http://$server:8080/health" 2>/dev/null || echo "000")

        if [ "$status" = "200" ]; then
            log_success "健康检查通过 ($i/$retries)"
            return 0
        fi

        log_warn "健康检查失败 ($i/$retries): HTTP $status"
        sleep $HEALTH_CHECK_INTERVAL
    done

    log_error "健康检查失败，已重试 $retries 次"
    return 1
}

# 切换负载均衡器
switch_traffic() {
    local target_env=$1

    log_info "切换流量到 ${target_env} 环境..."

    ssh -i $SSH_KEY "$SSH_USER@$LOAD_BALANCER" bash <<EOF
        # 更新活跃环境配置
        echo 'set \$active_env ${target_env};' > $NGINX_CONF_DIR/active_env.conf

        # 测试 Nginx 配置
        nginx -t

        # 平滑重载
        nginx -s reload
EOF

    log_success "流量已切换到 ${target_env} 环境"
}

# 部署代码到指定环境
deploy_to_env() {
    local env=$1
    local version=$2
    local server=$(get_server_ip $env)

    log_info "部署版本 ${version} 到 ${env} 环境 ($server)..."

    remote_exec $server bash <<REMOTE_EOF
        set -euo pipefail
        cd $APP_DIR

        # 1. 维护模式（仅影响当前非活跃环境，用户无感知）
        php artisan down --render='errors::503' --retry=60 || true

        # 2. 拉取代码
        git fetch --all --tags
        git checkout $version
        git pull origin $version

        # 3. 安装依赖
        composer install --no-dev --optimize-autoloader --no-interaction

        # 4. 运行数据库迁移
        php artisan migrate --force

        # 5. 清除和重建缓存
        php artisan config:cache
        php artisan route:cache
        php artisan view:cache
        php artisan event:cache

        # 6. 重启队列工作者
        php artisan queue:restart

        # 7. 重启 OPcache
        php artisan opcache:clear || true

        # 8. 关闭维护模式
        php artisan up

        # 9. 记录部署信息
        echo "$version" > $APP_DIR/.current_version
        echo "$(date '+%Y-%m-%d %H:%M:%S')" > $APP_DIR/.last_deploy
        echo "$env" > $APP_DIR/.deploy_env
REMOTE_EOF

    log_success "代码部署完成: $env ($server)"
}

# 快照当前版本（用于回滚）
snapshot_version() {
    local env=$1
    local server=$(get_server_ip $env)

    local current_version=$(remote_exec $server "cat $APP_DIR/.current_version 2>/dev/null || echo 'unknown'")
    echo "$current_version"
}

# ============================================================
# 主流程
# ============================================================

main() {
    local target_env=${1:-""}
    local version=${2:-"main"}

    # 如果未指定目标环境，自动选择非活跃环境
    if [ -z "$target_env" ]; then
        target_env=$(get_inactive_env)
        log_info "未指定目标环境，自动选择非活跃环境: $target_env"
    fi

    local active_env=$(get_active_env)
    local active_server=$(get_server_ip $active_env)
    local target_server=$(get_server_ip $target_env)

    log_info "=========================================="
    log_info "蓝绿部署开始"
    log_info "=========================================="
    log_info "当前活跃环境: $active_env ($active_server)"
    log_info "部署目标环境: $target_env ($target_server)"
    log_info "部署版本: $version"
    log_info "=========================================="

    # 确认部署
    read -p "确认部署? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log_warn "部署已取消"
        exit 0
    fi

    # Step 1: 记录当前版本（用于回滚）
    local rollback_version=$(snapshot_version $active_env)
    log_info "当前版本: $rollback_version (用于回滚)"

    # Step 2: 部署代码到非活跃环境
    deploy_to_env $target_env $version

    # Step 3: 健康检查
    if ! health_check $target_server; then
        log_error "部署失败：健康检查未通过"
        log_error "执行回滚..."
        deploy_to_env $target_env $rollback_version
        exit 1
    fi

    # Step 4: 切换流量
    switch_traffic $target_env

    # Step 5: 最终验证
    sleep 3
    local final_status=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 5 "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

    if [ "$final_status" = "200" ]; then
        log_success "=========================================="
        log_success "部署成功！"
        log_success "活跃环境: $target_env"
        log_success "版本: $version"
        log_success "=========================================="

        # 记录部署历史
        echo "$(date '+%Y-%m-%d %H:%M:%S') | $active_env → $target_env | $version" >> /var/log/deployments.log
    else
        log_error "最终验证失败 (HTTP $final_status)"
        log_error "执行回滚..."
        switch_traffic $active_env
        exit 1
    fi
}

# ============================================================
# 命令行参数处理
# ============================================================

case "${1:-deploy}" in
    deploy)
        main "${2:-}" "${3:-main}"
        ;;
    status)
        active=$(get_active_env)
        echo "当前活跃环境: $active"
        echo "Blue 服务器: $BLUE_SERVER"
        echo "Green 服务器: $GREEN_SERVER"
        ;;
    switch)
        if [ -z "${2:-}" ]; then
            echo "用法: $0 switch [blue|green]"
            exit 1
        fi
        switch_traffic $2
        ;;
    rollback)
        active=$(get_active_env)
        if [ "$active" = "blue" ]; then
            switch_traffic "green"
        else
            switch_traffic "blue"
        fi
        ;;
    *)
        echo "用法: $0 {deploy|status|switch|rollback} [参数]"
        exit 1
        ;;
esac
```

### 3.2 一键回滚脚本

```bash
#!/usr/bin/env bash
#
# 一键回滚脚本
# 将流量切回上一个环境
#

set -euo pipefail

LOAD_BALANCER="10.0.1.1"
NGINX_CONF_DIR="/etc/nginx/conf.d"
SSH_USER="deploy"
SSH_KEY="~/.ssh/deploy_key"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()    { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# 获取当前活跃环境
active_env=$(ssh -i $SSH_KEY "$SSH_USER@$LOAD_BALANCER" \
    "grep 'active_env' $NGINX_CONF_DIR/active_env.conf | awk '{print \$NF}' | tr -d ';'")

# 计算回滚目标
if [ "$active_env" = "blue" ]; then
    rollback_env="green"
else
    rollback_env="blue"
fi

log_info "当前活跃环境: $active_env"
log_info "回滚目标环境: $rollback_env"

read -p "⚠️  确认回滚? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    log_info "回滚已取消"
    exit 0
fi

# 切换流量
log_info "正在切换流量..."

ssh -i $SSH_KEY "$SSH_USER@$LOAD_BALANCER" bash <<EOF
    echo 'set \$active_env ${rollback_env};' > $NGINX_CONF_DIR/active_env.conf
    nginx -t && nginx -s reload
EOF

# 验证
sleep 3
status=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 5 "https://api.example.com/health" 2>/dev/null || echo "000")

if [ "$status" = "200" ]; then
    log_success "回滚成功！活跃环境已切换到: $rollback_env"
    echo "$(date '+%Y-%m-%d %H:%M:%S') | ROLLBACK $active_env → $rollback_env" >> /var/log/deployments.log
else
    log_error "回滚后验证失败 (HTTP $status)，请手动检查！"
    exit 1
fi
```

---

## 第四章：数据库迁移策略

### 4.1 向后兼容迁移——Expand-Contract 模式

蓝绿部署最大的挑战是数据库迁移。因为两个环境共享同一个数据库，新版本的迁移必须与旧版本代码兼容。

**Expand-Contract 模式**分为三个阶段：

```
阶段 1: Expand（扩展）
  添加新列/表，不删除旧的
  旧代码和新代码都能正常运行

阶段 2: Migrate（迁移）
  将数据从旧结构迁移到新结构
  两个版本的代码继续兼容

阶段 3: Contract（收缩）
  删除旧列/表
  确保只有新代码在运行
```

### 4.2 实战示例：添加新列

**需求**：用户表添加 `display_name` 字段，替代 `name` 字段。

**❌ 错误方式（一步完成，会导致旧代码失败）**：

```php
// 这样做会导致回滚时旧代码找不到 name 字段
Schema::table('users', function (Blueprint $table) {
    $table->renameColumn('name', 'display_name');
});
```

**✅ 正确方式（Expand-Contract 三阶段）**：

**阶段 1：Expand 迁移**（部署新版本时执行）

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // 添加新列（允许 null，旧代码不写这个字段）
            $table->string('display_name')->nullable()->after('name');
        });

        // 将现有数据复制到新列
        DB::statement('UPDATE users SET display_name = name WHERE display_name IS NULL');
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('display_name');
        });
    }
};
```

**应用层同时读写两个字段**：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    protected $fillable = ['name', 'display_name', 'email'];

    /**
     * 获取显示名称
     * 过渡期：优先读 display_name，fallback 到 name
     */
    public function getDisplayNameAttribute(): string
    {
        return $this->attributes['display_name']
            ?? $this->attributes['name']
            ?? 'Unknown';
    }

    /**
     * 设置显示名称
     * 过渡期：同时写两个字段
     */
    public function setDisplayNameAttribute(string $value): void
    {
        $this->attributes['display_name'] = $value;
        $this->attributes['name'] = $value; // 同步写入旧字段
    }
}
```

**阶段 2：Migrate 迁移**（确保所有数据已同步后）

```php
<?php

return new class extends Migration
{
    public function up(): void
    {
        // 确保所有记录都有 display_name
        DB::statement('UPDATE users SET display_name = name WHERE display_name IS NULL');

        // 添加 NOT NULL 约束
        Schema::table('users', function (Blueprint $table) {
            $table->string('display_name')->nullable(false)->change();
        });
    }
};
```

**阶段 3：Contract 迁移**（确认只有新版本在运行后）

```php
<?php

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('name'); // 删除旧列
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('name')->after('id');
        });
        DB::statement('UPDATE users SET name = display_name');
    }
};
```

### 4.3 实战示例：重命名列

**需求**：将 `phone` 重命名为 `phone_number`。

```php
// 阶段 1: Expand
Schema::table('users', function (Blueprint $table) {
    $table->string('phone_number')->nullable()->after('phone');
});
DB::statement('UPDATE users SET phone_number = phone WHERE phone_number IS NULL');

// 应用层：读 phone_number，fallback 到 phone；写两个字段

// 阶段 2: Migrate
DB::statement('UPDATE users SET phone_number = phone WHERE phone_number IS NULL');
Schema::table('users', function (Blueprint $table) {
    $table->string('phone_number')->nullable(false)->change();
});

// 阶段 3: Contract（只有新版本运行后）
Schema::table('users', function (Blueprint $table) {
    $table->dropColumn('phone');
});
```

### 4.4 实战示例：拆分表

**需求**：将 `users` 表中的地址字段拆分到 `user_addresses` 表。

```php
// 阶段 1: Expand
Schema::create('user_addresses', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('address_line');
    $table->string('city');
    $table->string('province');
    $table->string('postal_code');
    $table->boolean('is_default')->default(false);
    $table->timestamps();
});

// 迁移现有数据
DB::statement("
    INSERT INTO user_addresses (user_id, address_line, city, province, postal_code, created_at, updated_at)
    SELECT id, address, city, province, postal_code, NOW(), NOW()
    FROM users
    WHERE address IS NOT NULL
");

// 应用层：同时读写两个位置

// 阶段 3: Contract
Schema::table('users', function (Blueprint $table) {
    $table->dropColumn(['address', 'city', 'province', 'postal_code']);
});
```

### 4.5 迁移安全检查清单

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class MigrationSafetyCheck extends Command
{
    protected $signature = 'migrate:safety-check';

    protected $description = '检查待执行的迁移是否满足蓝绿部署兼容性';

    public function handle(): int
    {
        $pendingMigrations = $this->getPendingMigrations();
        $issues = [];

        foreach ($pendingMigrations as $migration) {
            $path = database_path("migrations/{$migration}");
            $content = file_get_contents($path);

            // 检查危险操作
            if (str_contains($content, 'dropColumn')) {
                $issues[] = "{$migration}: 包含 dropColumn —— 可能不兼容回滚";
            }

            if (str_contains($content, 'renameColumn')) {
                $issues[] = "{$migration}: 包含 renameColumn —— 考虑使用 Expand-Contract 模式";
            }

            if (str_contains($content, 'dropTable')) {
                $issues[] = "{$migration}: 包含 dropTable —— 不可逆操作";
            }

            if (str_contains($content, '->change()') && str_contains($content, 'nullable(false)')) {
                $issues[] = "{$migration}: 修改列为 NOT NULL —— 确保旧代码不会插入 NULL";
            }
        }

        if (empty($issues)) {
            $this->info('✅ 所有待执行迁移通过安全检查');
            return self::SUCCESS;
        }

        $this->warn('⚠️  发现以下潜在问题：');
        foreach ($issues as $issue) {
            $this->warn("  • {$issue}");
        }

        return self::FAILURE;
    }

    private function getPendingMigrations(): array
    {
        $ran = $this->call('migrate:status', ['--pending' => true]);
        // 解析输出获取待执行迁移列表
        return [];
    }
}
```

---

## 第五章：队列与定时任务处理

### 5.1 队列工作者切换策略

蓝绿部署时，队列工作者需要特别处理：

```
问题场景：
1. Blue 环境的工作者正在处理任务
2. 流量切换到 Green
3. Blue 工作者仍在运行旧代码处理新任务
4. 新任务可能使用了新版本的数据结构

解决方案：
1. 部署前停止目标环境的旧工作者
2. 部署后启动新版本的工作者
3. 切换流量前等待队列清空（或设置超时）
```

### 5.2 队列安全切换脚本

```bash
#!/usr/bin/env bash
#
# 安全切换队列工作者
#

ENV=$1
SERVER=$2

echo "[$ENV] 停止旧版本队列工作者..."

# 发送 SIGTERM 信号，让工作者完成当前任务后退出
ssh -i $SSH_KEY "$SSH_USER@$SERVER" bash <<'EOF'
    # 查找所有 queue:work 进程
    PIDS=$(pgrep -f "artisan queue:work" || true)

    if [ -n "$PIDS" ]; then
        echo "发现工作者进程: $PIDS"
        # 发送 SIGTERM（优雅关闭）
        kill -TERM $PIDS
        # 等待最多 60 秒
        TIMEOUT=60
        while [ $TIMEOUT -gt 0 ] && pgrep -f "artisan queue:work" > /dev/null; do
            sleep 1
            TIMEOUT=$((TIMEOUT - 1))
        done
        if pgrep -f "artisan queue:work" > /dev/null; then
            echo "强制终止剩余工作者"
            pkill -9 -f "artisan queue:work"
        fi
        echo "所有工作者已停止"
    else
        echo "未发现运行中的工作者"
    fi
EOF

echo "[$ENV] 启动新版本队列工作者..."

ssh -i $SSH_KEY "$SSH_USER@$SERVER" bash <<'EOF'
    cd /var/www/laravel

    # 使用 Supervisor 管理工作者
    sudo supervisorctl restart laravel-worker:*

    # 或者手动启动（不推荐生产环境）
    # nohup php artisan queue:work redis --sleep=3 --tries=3 --max-time=3600 >> storage/logs/queue.log 2>&1 &

    echo "新版本工作者已启动"
EOF
```

### 5.3 定时任务处理

```bash
# 两个环境的 Crontab 配置

# Blue 环境 (10.0.1.10) crontab
* * * * * cd /var/www/laravel && php artisan schedule:run >> /dev/null 2>&1

# Green 环境 (10.0.1.11) crontab
# 注意：定时任务只在活跃环境运行
# 通过检查 .deploy_env 文件判断
* * * * * cd /var/www/laravel && if [ "$(cat .deploy_env)" = "green" ]; then php artisan schedule:run >> /dev/null 2>&1; fi
```

更好的方案是在部署脚本中动态切换：

```bash
# 在 deploy.sh 中切换定时任务
switch_cron() {
    local active_env=$1
    local active_server=$(get_server_ip $active_env)
    local inactive_env=$(get_inactive_env)
    local inactive_server=$(get_server_ip $inactive_env)

    # 在活跃环境启用定时任务
    remote_exec $active_server "echo '* * * * * cd $APP_DIR && php artisan schedule:run >> /dev/null 2>&1' | crontab -"

    # 在非活跃环境禁用定时任务
    remote_exec $inactive_server "echo '# Disabled - not active environment' | crontab -"
}
```

---

## 第六章：AWS ALB 蓝绿部署

### 6.1 使用 AWS ALB Target Group 切换

```bash
#!/usr/bin/env bash
#
# AWS ALB 蓝绿部署脚本
#

ALB_LISTENER_ARN="arn:aws:elasticloadbalancing:ap-northeast-1:123456789:listener/app/my-alb/xxx/xxx"
BLUE_TG_ARN="arn:aws:elasticloadbalancing:ap-northeast-1:123456789:targetgroup/blue-tg/xxx"
GREEN_TG_ARN="arn:aws:elasticloadbalancing:ap-northeast-1:123456789:targetgroup/green-tg/xxx"

# 获取当前活跃 Target Group
get_active_tg() {
    aws elbv2 describe-rules --listener-arn $ALB_LISTENER_ARN \
        --query 'Rules[0].Actions[0].TargetGroupArn' \
        --output text
}

# 切换 Target Group
switch_tg() {
    local target_tg_arn=$1

    aws elbv2 modify-rule \
        --rule-arn $(aws elbv2 describe-rules --listener-arn $ALB_LISTENER_ARN --query 'Rules[0].RuleArn' --output text) \
        --actions "Type=forward,TargetGroupArn=$target_tg_arn"

    echo "已切换到 Target Group: $target_tg_arn"
}

# 部署流程
main() {
    local active_tg=$(get_active_tg)

    if [ "$active_tg" = "$BLUE_TG_ARN" ]; then
        local deploy_tg=$GREEN_TG_ARN
        local deploy_env="green"
    else
        local deploy_tg=$BLUE_TG_ARN
        local deploy_env="blue"
    fi

    echo "当前活跃: $active_tg"
    echo "部署目标: $deploy_env ($deploy_tg)"

    # 部署到目标环境的 EC2/ECS
    # ... (SSH 部署或 ECS 更新)

    # 健康检查
    echo "等待目标健康..."
    aws elbv2 wait target-in-service --target-group-arn $deploy_tg \
        --targets Id=i-xxxxxxxx

    # 切换流量
    switch_tg $deploy_tg

    echo "部署完成: $deploy_env"
}
```

### 6.2 Docker Compose 蓝绿部署

```yaml
# docker-compose.yml

version: "3.8"

services:
  # Blue 环境
  app-blue:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: laravel-blue
    ports:
      - "8080:8080"
    environment:
      - DEPLOY_ENV=blue
      - DB_HOST=db
      - REDIS_HOST=redis
    volumes:
      - storage-blue:/app/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Green 环境
  app-green:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: laravel-green
    ports:
      - "8081:8080"
    environment:
      - DEPLOY_ENV=green
      - DB_HOST=db
      - REDIS_HOST=redis
    volumes:
      - storage-green:/app/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # Nginx 负载均衡
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/active_env.conf:/etc/nginx/conf.d/active_env.conf
    depends_on:
      - app-blue
      - app-green

  # 数据库
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass secret
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "secret", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  storage-blue:
  storage-green:
```

```bash
#!/usr/bin/env bash
#
# Docker Compose 蓝绿部署
#

COMPOSE_FILE="docker-compose.yml"

# 获取当前活跃环境
get_active_env() {
    grep 'set $active_env' nginx/active_env.conf | awk '{print $NF}' | tr -d ';'
}

# 部署
deploy() {
    local target_env=${1:-$(if [ "$(get_active_env)" = "blue" ]; then echo "green"; else echo "blue"; fi)}

    echo "部署到 $target_env 环境..."

    # 构建新镜像
    docker compose build app-$target_env

    # 运行迁移
    docker compose run --rm app-$target_env php artisan migrate --force

    # 启动新环境
    docker compose up -d app-$target_env

    # 等待健康检查
    echo "等待健康检查..."
    local retries=30
    while [ $retries -gt 0 ]; do
        local status=$(docker compose exec app-$target_env curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
        if [ "$status" = "200" ]; then
            echo "健康检查通过"
            break
        fi
        retries=$((retries - 1))
        sleep 2
    done

    if [ $retries -eq 0 ]; then
        echo "健康检查失败，中止部署"
        docker compose stop app-$target_env
        exit 1
    fi

    # 切换流量
    echo "set \$active_env $target_env;" > nginx/active_env.conf
    docker compose exec nginx nginx -s reload

    # 重启队列工作者
    docker compose exec app-$target_env php artisan queue:restart

    echo "部署完成！活跃环境: $target_env"
}

# 回滚
rollback() {
    local current=$(get_active_env)
    local target=$(if [ "$current" = "blue" ]; then echo "green"; else echo "blue"; fi)

    echo "回滚: $current → $target"

    echo "set \$active_env $target;" > nginx/active_env.conf
    docker compose exec nginx nginx -s reload

    echo "回滚完成！活跃环境: $target"
}

case "${1:-deploy}" in
    deploy) deploy "${2:-}" ;;
    rollback) rollback ;;
    status) echo "当前活跃环境: $(get_active_env)" ;;
    *) echo "用法: $0 {deploy|rollback|status}" ;;
esac
```

---

## 第七章：监控与告警

### 7.1 部署期间的监控指标

```yaml
# Prometheus 告警规则
# deploy_alerts.yml

groups:
  - name: deployment_alerts
    rules:
      # 部署期间错误率上升
      - alert: HighErrorRateDuringDeployment
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[1m]))
          /
          sum(rate(http_requests_total[1m]))
          > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "部署期间错误率超过 5%"
          description: "当前错误率: {{ $value | humanizePercentage }}"

      # 响应时间异常
      - alert: HighLatencyDuringDeployment
        expr: |
          histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))
          > 2
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "P99 延迟超过 2 秒"

      # 健康检查失败
      - alert: HealthCheckFailure
        expr: up{job="laravel-app"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.instance }} 健康检查失败"
```

### 7.2 自动回滚策略

```bash
#!/usr/bin/env bash
#
# 自动回滚监控脚本
# 部署后持续监控，如果错误率超过阈值自动回滚
#

ACTIVE_ENV=$1
ERROR_THRESHOLD=5    # 错误率阈值 (%)
MONITOR_DURATION=300 # 监控时长 (秒)
CHECK_INTERVAL=10    # 检查间隔 (秒)

echo "开始监控部署后指标 (环境: $ACTIVE_ENV, 时长: ${MONITOR_DURATION}s)..."

ELAPSED=0
while [ $ELAPSED -lt $MONITOR_DURATION ]; do
    # 查询错误率 (Prometheus API)
    ERROR_RATE=$(curl -s "http://prometheus:9090/api/v1/query" \
        --data-urlencode 'query=100 * sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))' \
        | jq -r '.data.result[0].value[1] // "0"')

    echo "[$ELAPSED/${MONITOR_DURATION}s] 错误率: ${ERROR_RATE}%"

    # 检查是否超过阈值
    if (( $(echo "$ERROR_RATE > $ERROR_THRESHOLD" | bc -l) )); then
        echo "❌ 错误率超过阈值 (${ERROR_RATE}% > ${ERROR_THRESHOLD}%)"
        echo "执行自动回滚..."

        # 执行回滚
        if [ "$ACTIVE_ENV" = "blue" ]; then
            ./rollback.sh green
        else
            ./rollback.sh blue
        fi

        # 发送告警
        curl -X POST "$SLACK_WEBHOOK" -H 'Content-Type: application/json' \
            -d "{\"text\": \"⚠️ 自动回滚已执行！错误率: ${ERROR_RATE}%\"}"

        exit 1
    fi

    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

echo "✅ 部署监控完成，指标正常"
```

---

## 第八章：Laravel 特有挑战与解决方案

### 8.1 Session 共享

蓝绿部署中，用户的 session 必须在两个环境之间共享：

```php
// config/session.php

return [
    'driver' => 'redis', // 必须使用共享存储
    'connection' => 'session',
    'lifetime' => 120,
    'expire_on_close' => false,
    'encrypt' => true,
];
```

### 8.2 文件存储共享

两个环境必须共享文件存储（用户上传、日志等）：

```php
// config/filesystems.php

return [
    'default' => 's3', // 使用 S3 或 NFS 共享存储

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app'),
            // 注意：本地存储在蓝绿部署中不共享
        ],
        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
        ],
    ],
];
```

### 8.3 OPcache 策略

```php
// 部署后清除 OPcache
// 在部署脚本中调用

// 方式 1: 使用 artisan 命令
php artisan opcache:clear

// 方式 2: 直接调用 PHP
php -r "opcache_reset();"

// 方式 3: 通过 HTTP 端点（需保护）
// routes/web.php
Route::get('/opcache-clear', function () {
    if (app()->environment('production')) {
        abort(403);
    }
    opcache_reset();
    return 'OPcache cleared';
});
```

### 8.4 Horizon 队列管理

如果使用 Laravel Horizon：

```php
// config/horizon.php

return [
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'connection' => 'redis',
                'queue' => ['default', 'emails', 'payments'],
                'balance' => 'auto',
                'autoScalingStrategy' => 'time',
                'maxProcesses' => 10,
                'maxTime' => 3600,
                'maxJobs' => 1000,
                'memory' => 128,
                'tries' => 3,
                'timeout' => 60,
                'nice' => 0,
            ],
        ],
    ],

    // 蓝绿部署时使用不同的 supervisor 名称
    'name' => env('DEPLOY_ENV', 'blue'),
];
```

---

## 总结

蓝绿部署是 Laravel 应用实现零停机发布的可靠方案。核心要点：

1. **基础设施准备**：两套完全对等的环境，共享数据层
2. **流量切换**：通过 Nginx/ALB 瞬间切换，对用户透明
3. **数据库迁移**：使用 Expand-Contract 模式确保向后兼容
4. **队列处理**：部署前停止旧工作者，部署后启动新工作者
5. **一键回滚**：发现问题秒级切回旧环境
6. **持续监控**：部署后监控错误率和延迟，异常自动回滚

虽然蓝绿部署需要 2 倍的服务器资源，但对于关键业务系统来说，零停机和秒级回滚的能力远比服务器成本更有价值。

---

*参考资料*：
- [Martin Fowler - BlueGreenDeployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [AWS Blue/Green Deployments](https://docs.aws.amazon.com/whitepapers/latest/blue-green-deployments/blue-green-deployments.html)
- [Laravel Zero Downtime Deployment](https://laravel.com/docs/11.x/deployment)
- [Envoyer - Zero Downtime Deployment](https://envoyer.io/)

## 相关阅读

- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/06_运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署](/06_运维/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/)
- [Railway vs Fly.io vs Render：2026 年 Laravel 应用云部署平台选型对比](/06_运维/Railway-vs-Fly-io-vs-Render-2026年Laravel应用云部署平台选型对比/)
