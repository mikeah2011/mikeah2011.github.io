---
title: "Uptime Kuma 实战：开源监控面板——自托管服务健康检查、状态页面、通知集成与 Laravel API 端点监控"
keywords: [Uptime Kuma, Laravel API, 开源监控面板, 自托管服务健康检查, 状态页面, 通知集成与, 端点监控, DevOps]
date: 2026-06-10 05:51:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - Uptime-Kuma
  - 监控
  - Docker
  - Laravel
  - 状态页面
  - 告警通知
description: "从零搭建 Uptime Kuma 监控面板，覆盖 HTTP/TCP/DNS/Ping 多种探针类型，配置公开状态页面，集成 Telegram/Slack/飞书等通知渠道，并实战监控 Laravel API 端点的健康状态。"
---


## 前言

监控是运维的基础设施。商业方案（Pingdom、UptimeRobot、Better Uptime）功能完善但价格不菲，尤其在需要监控几十个端点时费用会快速累积。

Uptime Kuma 是一个开源的自托管监控工具，界面现代、部署简单、功能覆盖面广。它支持 HTTP(S)、TCP、Ping、DNS、Docker 容器等多种探针类型，内置状态页面和通知集成，足以替代大多数中小型场景下的商业监控服务。

本文从实际部署出发，覆盖安装配置、探针类型详解、状态页面搭建、通知渠道对接，以及如何用它监控 Laravel API 端点。

## 核心概念

### 监控类型

Uptime Kuma 支持以下探针类型：

| 类型 | 用途 | 典型场景 |
|------|------|----------|
| HTTP(S) | 检查网页/API 可用性 | 网站存活检测、API 健康检查 |
| TCP Port | 检查端口是否开放 | MySQL 3306、Redis 6379 |
| Ping | ICMP 心跳检测 | 服务器存活 |
| DNS | DNS 解析检查 | 域名解析是否正常 |
| Docker | 容器运行状态 | 容器是否 crash |
| Keyword | 页面包含特定关键词 | 检查页面内容是否被篡改 |
| gRPC | gRPC 服务健康检查 | 微服务健康探针 |
| Push | 被动监控（客户端主动上报） | 定时任务是否正常执行 |

### 状态页面

Uptime Kuma 内置公开状态页面功能，可以将多个监控项聚合到一个页面展示，支持自定义域名、CSS 样式、维护公告。不需要额外部署 Statuspage.io 之类的服务。

### 通知集成

支持 90+ 种通知渠道：Telegram、Slack、Discord、飞书、企业微信、钉钉、邮件（SMTP）、Webhook 等。可以针对不同监控项配置不同的通知策略。

## 部署

### Docker Compose（推荐）

```yaml
# docker-compose.yml
version: '3.8'

services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: always
    ports:
      - "3001:3001"
    volumes:
      - uptime-kuma-data:/app/data
    environment:
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true

volumes:
  uptime-kuma-data:
```

启动：

```bash
docker compose up -d
```

访问 `http://your-server:3001`，首次访问会要求创建管理员账号。

### 反向代理（Nginx）

生产环境通常需要通过 Nginx 反代并配置 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name status.example.com;

    ssl_certificate     /etc/letsencrypt/live/status.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

关键点：WebSocket 代理配置必须正确，否则仪表盘的实时状态推送会失效。

### 数据备份

Uptime Kuma 的数据存储在 SQLite 数据库中（`/app/data/kuma.db`），备份直接拷贝 volume 即可：

```bash
# 备份
docker cp uptime-kuma:/app/data/kuma.db ./backup/kuma-$(date +%Y%m%d).db

# 恢复
docker cp ./backup/kuma-20260610.db uptime-kuma:/app/data/kuma.db
docker restart uptime-kuma
```

建议配合 cron 定时备份：

```bash
# 每天凌晨 3 点备份
0 3 * * * docker cp uptime-kuma:/app/data/kuma.db /backup/uptime-kuma/kuma-$(date +\%Y\%m\%d).db
```

## 实战：配置各类监控

### HTTP(S) 监控

最常见的用法。在 Uptime Kuma 面板中：

1. 点击「Add New Monitor」
2. 选择 Monitor Type 为 `HTTP(s)`
3. 填入 URL，例如 `https://api.example.com/health`
4. 设置心跳间隔（Heartbeat Interval）：推荐 60 秒
5. 设置重试次数（Retries）：推荐 3 次

**高级选项：**

- **Method**：GET/POST/PUT/DELETE/HEAD/PATCH
- **Body**：POST 请求体（JSON）
- **Headers**：自定义请求头
- **Accepted Status Codes**：默认 `200-299`，可自定义
- **Keyword**：响应体中必须包含的关键词
- **Ignore SSL Error**：跳过证书验证（不推荐）

### TCP Port 监控

检查端口是否可达，适合数据库、Redis 等服务：

```
Monitor Type: TCP Port
Hostname: 192.168.1.100
Port: 3306
```

实际场景：监控 MySQL 主从复制中的从库是否正常接受连接。

### Ping 监控

最基本的存活检测：

```
Monitor Type: Ping
Hostname: 10.0.0.1
```

适合监控内网服务器、VPN 节点。

### DNS 监控

检查域名解析是否正常：

```
Monitor Type: DNS
Hostname: example.com
Resolve Type: A
Expected Value: 1.2.3.4
```

可以检测 DNS 劫持或解析异常。

### Push 监控（被动）

对于定时任务（cron job），无法主动探测，需要客户端主动上报。Uptime Kuma 提供 Push 类型：

1. 创建 Monitor，类型选 `Push`
2. 系统会生成一个唯一的 Push URL，格式：`http://your-server:3001/api/push/xxxxx`
3. 在定时任务中，执行完成后调用这个 URL

```bash
# 在 crontab 的任务末尾追加
0 2 * * * /usr/bin/php /var/www/app/artisan schedule:run && curl -s "http://status.example.com/api/push/xxxxx" > /dev/null
```

如果 Uptime Kuma 在指定时间内没有收到 Push，就会触发告警。

### Docker 容器监控

监控宿主机上的 Docker 容器运行状态：

1. 在 Uptime Kuma 设置中，将 Docker Socket 挂载到容器内：

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
  - uptime-kuma-data:/app/data
```

2. 创建 Monitor，类型选 `Docker Container`，选择目标容器

这样当容器 crash 或被停止时，会立即收到通知。

## 状态页面搭建

### 创建公开状态页面

1. 左侧菜单 → Status Pages → 「Add Status Page」
2. 填入页面标题（如「KKday API Status」）和自定义 slug（如 `kkday`）
3. 添加要展示的监控项，可以分组（如「核心服务」「辅助服务」）
4. 发布后访问 `https://status.example.com/kkday`

### 自定义域名

状态页面支持自定义域名，需要在 Nginx 中配置：

```nginx
server {
    listen 443 ssl http2;
    server_name status.kkday.com;

    ssl_certificate     /etc/letsencrypt/live/status.kkday.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.kkday.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 维护公告

在状态页面中可以发布维护公告（Incident），支持 Markdown 格式，会显示在页面顶部。适合计划内维护时提前通知用户。

### 自定义 CSS

状态页面支持自定义样式，可以在页面设置中注入 CSS：

```css
/* 自定义品牌色 */
:root {
    --up-color: #00c853;
    --down-color: #ff1744;
    --warn-color: #ff9100;
}

/* 隐藏 footer */
footer { display: none; }
```

## 通知集成

### Telegram

1. 找 @BotFather 创建 Bot，获取 Token
2. 找 @userinfobot 获取你的 Chat ID
3. 在 Uptime Kuma → Settings → Notifications → Setup Notification：
   - Type: `Telegram`
   - Bot Token: `123456:ABC-DEF...`
   - Chat ID: `your_chat_id`

### 飞书

1. 飞书群 → 设置 → 群机器人 → 添加自定义机器人
2. 获取 Webhook URL
3. Uptime Kuma 通知配置：
   - Type: `Feishu`
   - Webhook URL: `https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx`

### Slack

1. Slack App → Incoming Webhooks → 获取 Webhook URL
2. Uptime Kuma 通知配置：
   - Type: `Slack`
   - Webhook URL: `https://hooks.slack.com/services/T.../B.../xxx`

### 企业微信

```
Type: WeCom
Webhook URL: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx
```

### 钉钉

```
Type: DingDing
Webhook URL: https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKENxx
```

### 通知策略

可以在每个 Monitor 上单独配置通知规则：

- **Up**：服务恢复时通知
- **Down**：服务宕机时通知
- **Certificate Expiry**：SSL 证书即将过期时通知
- **Testing**：测试通知是否正常

推荐策略：核心服务 Down 立即通知，非核心服务 Down 延迟 2 分钟再通知（避免短暂抖动误报）。

## 实战：监控 Laravel API 端点

### 健康检查端点设计

在 Laravel 中创建一个专用的健康检查端点：

```php
// routes/api.php
Route::get('/health', function () {
    $checks = [];
    $healthy = true;

    // 数据库检查
    try {
        DB::connection()->getPdo();
        $checks['database'] = 'ok';
    } catch (Exception $e) {
        $checks['database'] = 'fail: ' . $e->getMessage();
        $healthy = false;
    }

    // Redis 检查
    try {
        Redis::ping();
        $checks['redis'] = 'ok';
    } catch (Exception $e) {
        $checks['redis'] = 'fail: ' . $e->getMessage();
        $healthy = false;
    }

    // 队列检查（可选）
    try {
        $size = Queue::size();
        $checks['queue'] = "ok (size: {$size})";
        if ($size > 1000) {
            $checks['queue'] = "warn: queue backlog {$size}";
            $healthy = false;
        }
    } catch (Exception $e) {
        $checks['queue'] = 'fail: ' . $e->getMessage();
        $healthy = false;
    }

    // 磁盘空间检查
    $diskFree = disk_free_space('/');
    $diskTotal = disk_total_space('/');
    $diskPercent = round(($diskTotal - $diskFree) / $diskTotal * 100, 1);
    $checks['disk'] = "{$diskPercent}% used";
    if ($diskPercent > 90) {
        $healthy = false;
    }

    return response()->json([
        'status' => $healthy ? 'healthy' : 'degraded',
        'timestamp' => now()->toIso8601String(),
        'checks' => $checks,
    ], $healthy ? 200 : 503);
});
```

### 带认证的健康检查

如果健康检查端点暴露了敏感信息（如队列积压数），可以加 Token 认证：

```php
Route::get('/health', function (Request $request) {
    if ($request->bearerToken() !== config('app.health_check_token')) {
        return response()->json(['message' => 'Unauthorized'], 401);
    }

    // ... 同上的检查逻辑
});
```

在 `.env` 中配置：

```
HEALTH_CHECK_TOKEN=your-secret-token-here
```

Uptime Kuma 的 HTTP 监控配置中，在 Headers 里添加：

```
Authorization: Bearer your-secret-token-here
```

### 监控多个 API 端点

除了健康检查端点，还可以监控关键业务 API：

| 端点 | 检查方式 | 预期 |
|------|----------|------|
| `GET /api/health` | HTTP 200 + Keyword "healthy" | 核心服务健康 |
| `GET /api/v1/products?limit=1` | HTTP 200 | 商品接口可用 |
| `POST /api/v1/orders/check` | HTTP 200 + 特定 JSON | 订单流程可用 |
| `GET /api/` | HTTP 200 | API 网关可达 |

在 Uptime Kuma 中为每个端点创建独立的 Monitor，分别配置通知策略。

### 监控 Laravel Horizon

如果使用 Laravel Horizon 管理队列，可以监控 Horizon 的健康状态：

```php
// 在 health 端点中增加 Horizon 检查
try {
    $horizon = app(\Laravel\Horizon\Contracts\MasterSupervisorRepository::class);
    $masters = $horizon->all();
    $checks['horizon'] = count($masters) > 0 ? 'ok' : 'warn: no master supervisor';
} catch (Exception $e) {
    $checks['horizon'] = 'fail: ' . $e->getMessage();
}
```

或者直接监控 Horizon 的 API 端点 `GET /horizon/api/health`（需要认证）。

### 监控定时任务（Push 模式）

Laravel 的定时任务无法通过 HTTP 探测，用 Push 模式：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule)
{
    $schedule->command('model:prune')->daily();
    $schedule->command('telescope:prune')->daily();

    // 心跳上报
    $schedule->call(function () {
        Http::get('https://status.example.com/api/push/your-push-key');
    })->everyFiveMinutes();
}
```

如果 5 分钟内没有收到心跳，Uptime Kuma 会触发告警。

## 高级用法

### 监控分组

将监控项按业务逻辑分组：

```
📁 核心服务
  ├── API 主站 (https://api.example.com/health)
  ├── 数据库主库 (tcp://db-master:3306)
  └── Redis 缓存 (tcp://redis:6379)

📁 辅助服务
  ├── 管理后台 (https://admin.example.com)
  ├── Horizon (https://api.example.com/horizon)
  └── 定时任务 (push)

📁 外部依赖
  ├── CDN (https://cdn.example.com)
  ├── 支付网关 (https://pay.gateway.com/ping)
  └── 短信服务 (https://sms.provider.com/health)
```

### API 自动化配置

Uptime Kuma 提供 REST API，可以通过脚本批量配置监控：

```bash
# 获取认证 Token
TOKEN=$(curl -s -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' \
  | jq -r '.token')

# 添加监控
curl -s -X POST http://localhost:3001/api/monitor \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "http",
    "name": "API Health",
    "url": "https://api.example.com/health",
    "interval": 60,
    "retryInterval": 30,
    "maxretries": 3,
    "accepted_statuscodes": ["200-299"],
    "keyword": "healthy"
  }'
```

### 证书监控

Uptime Kuma 自动检测 HTTPS 端点的 SSL 证书有效期。可以配置在证书过期前 14 天告警：

在 Monitor 设置中启用「Certificate Expiry Notification」，设置提前天数。

### 多实例监控

对于高可用架构，可以在不同地理位置部署多个 Uptime Kuma 实例，互相监控：

- 北京机房的实例监控上海的服务
- 上海机房的实例监控北京的服务

避免单点故障导致监控系统本身失效。

## 踩坑记录

### 1. WebSocket 连接失败

**症状**：仪表盘打开后状态不实时更新，需要手动刷新。

**原因**：Nginx 反代配置缺少 WebSocket 支持。

**解决**：确保 Nginx 配置中有以下内容：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 2. Docker Socket 权限问题

**症状**：Docker 容器监控报 `Permission denied`。

**原因**：Uptime Kuma 容器内的用户无权访问 Docker Socket。

**解决**：在 docker-compose.yml 中添加 user 配置：

```yaml
services:
  uptime-kuma:
    user: "0:0"  # root
    # 或者更安全的做法：将 docker socket 的 group 加入容器
    group_add:
      - "999"  # docker group id
```

查看 Docker group id：`getent group docker | cut -d: -f3`

### 3. Push 监控误报

**症状**：定时任务正常执行，但 Uptime Kuma 报 Down。

**原因**：Push 间隔和心跳窗口不匹配。如果任务每 5 分钟执行一次，但心跳窗口只有 1 分钟，任何延迟都会触发误报。

**解决**：将心跳窗口设置为任务间隔的 2-3 倍。例如任务每 5 分钟执行，心跳窗口设为 15 分钟。

### 4. 大量监控项导致页面卡顿

**症状**：监控项超过 100 个后，仪表盘加载缓慢。

**解决**：
- 使用分组折叠非关键监控
- 考虑分拆多个 Uptime Kuma 实例
- 升级到 1.21+ 版本（有性能优化）

### 5. 数据库锁定

**症状**：高并发写入时报 `SQLITE_BUSY`。

**原因**：SQLite 在大量并发写入时存在锁竞争。

**解决**：
- 增加心跳间隔（减少写入频率）
- 启用 WAL 模式（Uptime Kuma 1.19+ 默认启用）
- 如果规模很大，考虑等待 Uptime Kuma 支持 MySQL/PostgreSQL

### 6. 反向代理后的 IP 显示错误

**症状**：通知中显示的客户端 IP 是反代的 IP。

**解决**：在 Nginx 中正确设置 `X-Forwarded-For` 和 `X-Real-IP`，并在 Uptime Kuma 环境变量中配置：

```yaml
environment:
  - NODE_ENV=production
```

## 与其他方案对比

| 特性 | Uptime Kuma | UptimeRobot | Better Uptime | Prometheus + Grafana |
|------|-------------|-------------|---------------|---------------------|
| 部署方式 | 自托管 | SaaS | SaaS | 自托管 |
| 费用 | 免费 | 免费 50 监控 | $24/月起 | 免费 |
| 状态页面 | 内置 | 付费 | 内置 | 需额外组件 |
| 通知渠道 | 90+ | ~10 | ~20 | 需 Alertmanager |
| 学习曲线 | 低 | 低 | 低 | 高 |
| 适用规模 | 小到中 | 小 | 中 | 大 |

**选择建议**：
- 个人项目/小团队 → Uptime Kuma（免费、够用）
- 需要指标采集 + 监控面板 → Prometheus + Grafana
- 需要专业 SLA 报告 → Better Uptime
- 预算有限但需要可靠 → UptimeRobot 免费版

## 总结

Uptime Kuma 解决的核心问题是：用最小成本获得可靠的可用性监控。

它不是 Prometheus 那样的指标采集系统，不擅长做 CPU/内存/请求延迟的趋势分析。但它在「这个服务还活着吗」这件事上做得很好，而且状态页面和通知集成是开箱即用的。

对于 Laravel 项目，推荐的监控组合：

1. **Uptime Kuma**：HTTP 健康检查 + 状态页面 + 通知
2. **Laravel Telescope**：开发环境的请求/查询/队列监控
3. **Laravel Horizon**：队列 worker 的运行状态
4. **Sentry/Bugsnag**：异常追踪

这套组合覆盖了从基础设施到应用层的大部分监控需求，且总成本接近零。
