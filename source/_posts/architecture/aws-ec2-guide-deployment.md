---
title: "AWS EC2 实战：实例管理、安全组与自动扩展——Laravel B2C API 部署踩坑记录"
date: 2026-05-17 01:55:35
updated: 2026-05-17 02:02:35
categories:
  - architecture
  - aws
tags: [AWS, DevOps, KKday, Kubernetes, Laravel, 架构]
keywords: [AWS EC2, Laravel B2C API, 实例管理, 安全组与自动扩展, 部署踩坑记录, 架构]
description: 从 KKday B2C Backend Team 的真实部署经验出发，深度讲解 AWS EC2 实例选型、安全组精细化配置、Auto Scaling Group 扩缩容策略，以及 Laravel 应用在 EC2 上的生产级部署架构，附带多个真实踩坑案例。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - /images/content/architecture-002-content-1.jpg
  - /images/content/architecture-002-content-2.jpg

---

# AWS EC2 实战：实例管理、安全组与自动扩展——Laravel B2C API 部署踩坑记录

## 📌 前言

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 微服务跑在 AWS 基础设施上。虽然现在 Kubernetes 是主流，但 **EC2 仍然是中小规模服务、定时任务机、跳板机、批处理节点的首选**——不是每个服务都需要 K8s 的复杂度。

这篇文章记录的是我在 EC2 上部署和运维 Laravel B2C API 的实战经验：**怎么选实例、怎么配安全组才不会被扫、怎么用 ASG 做自动扩缩容、以及那些踩过的坑**。

> 💡 **关键词**：`AWS EC2` `安全组` `Auto Scaling Group` `Laravel 部署` `B2C API`

---

## 🏗️ 一、架构总览：EC2 在 Laravel 部署中的位置

```
                    ┌─────────────────────────────────────────────┐
                    │              CloudFront (CDN)                │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │          Application Load Balancer           │
                    │         (ALB → Target Group :80)            │
                    └──────────┬──────────────┬───────────────────┘
                               │              │
                ┌──────────────▼──┐  ┌───────▼──────────────┐
                │  ASG - API Pods  │  │  ASG - Worker Pods   │
                │  (EC2 t3.large)  │  │  (EC2 t3.medium)     │
                │  min:2 max:10   │  │  min:1 max:5         │
                │  CPU > 60% 扩容  │  │  SQS 积压 > 1000 扩容│
                └───────┬─────────┘  └──────┬───────────────┘
                        │                    │
                ┌───────▼────────────────────▼───────────────┐
                │            共享层 (不在 ASG 内)              │
                │  ┌─────────┐  ┌─────────┐  ┌────────────┐ │
                │  │  RDS     │  │  Redis   │  │  EFS       │ │
                │  │ (MySQL)  │  │ (Elastic-│  │ (共享文件)  │ │
                │  │ Multi-AZ │  │  Cache)  │  │            │ │
                │  └─────────┘  └─────────┘  └────────────┘ │
                └───────────────────────────────────────────┘
```

关键决策：**API 服务和队列 Worker 分开部署在不同的 ASG 中**，因为它们的负载特征完全不同——API 是 CPU + 网络密集型，Worker 是内存 + IO 密集型。

![AWS EC2 服务器与数据中心架构](/images/content/architecture-002-content-1.jpg)

---

## 🖥️ 二、EC2 实例选型：Laravel 应用到底需要什么？

### 2.1 实例类型选择

在 B2C 场景下，我们的经验是：

| 场景 | 推荐实例 | vCPU | 内存 | 月成本（us-east-1） | 说明 |
|------|---------|------|------|-------------------|------|
| API 服务（小流量） | `t3.medium` | 2 | 4 GB | ~$30 | 突发性能，适合日均 <10 万请求 |
| API 服务（中流量） | `t3.large` | 2 | 8 GB | ~$60 | **最常用**，平衡性价比 |
| API 服务（高流量） | `c6i.xlarge` | 4 | 8 GB | ~$120 | 计算优化，适合 CPU 密集型 API |
| Queue Worker | `t3.medium` | 2 | 4 GB | ~$30 | 内存够用即可，IO 等待多 |
| 定时任务 (Scheduler) | `t3.small` | 2 | 2 GB | ~$15 | 只跑 artisan schedule |

### 2.2 踩坑：Burstable 实例的 CPU Credit 陷阱

```bash
# 查看 CPU Credit 余额
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUCreditBalance \
  --dimensions Name=InstanceId,Value=i-0abc123def456 \
  --start-time 2026-05-16T00:00:00Z \
  --end-time 2026-05-17T00:00:00Z \
  --period 3600 \
  --statistics Average
```

**踩坑记录**：我们有一台 `t3.medium` 跑 Laravel API，白天 CPU credit 够用，但 **促销活动期间流量突然飙高，CPU credit 2 小时内耗尽**，性能直接跌到 baseline（`t3.medium` 的 baseline 是 20% CPU）。P95 延迟从 200ms 飙到 3 秒。

**解决方案**：
1. 生产环境 API 服务用 **`c6i` 系列**（非 burstable）或 `t3` + **T3 Unlimited** 模式
2. 如果用 T3 Unlimited，超出 credit 的部分按 $0.05/vCPU-hour 收费——小流量时省钱，大流量时自动兜底

```bash
# 启用 T3 Unlimited 模式
aws ec2 modify-instance-credit-specification \
  --instance-credit-specifications \
    "InstanceId=i-0abc123def456,CpuCredits=unlimited"
```

---

## 🔐 三、安全组精细化配置

### 3.1 最小权限原则

安全组是 EC2 的第一道防火墙。我们踩过一个大坑：**为了方便调试，把安全组的 22 端口开放到 0.0.0.0/0，结果被自动化扫描器暴力破解**。

正确的安全组分层设计：

```hcl
# Terraform 配置示例
# 1. ALB 安全组：只允许 HTTP/HTTPS 入站
resource "aws_security_group" "alb_sg" {
  name        = "b2c-alb-sg"
  description = "ALB Security Group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 2. EC2 API 安全组：只允许来自 ALB 的流量
resource "aws_security_group" "api_sg" {
  name        = "b2c-api-sg"
  description = "API EC2 Security Group"
  vpc_id      = aws_vpc.main.id

  # 只允许 ALB 安全组的流量进来
  ingress {
    description     = "From ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  # SSH 只允许通过 VPN/跳板机
  ingress {
    description = "SSH from Bastion"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.100.0/24"]  # 跳板机子网
  }
}

# 3. RDS 安全组：只允许 API 安全组访问 3306
resource "aws_security_group" "rds_sg" {
  name        = "b2c-rds-sg"
  description = "RDS Security Group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "MySQL from API"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.api_sg.id]
  }
}
```

### 3.2 安全组架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        VPC (10.0.0.0/16)                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  公有子网 (10.0.1.0/24)                               │    │
│  │  ┌──────────────────┐                                │    │
│  │  │  ALB              │  ← sg: alb-sg                 │    │
│  │  │  (80/443 from *)  │    入站: 80, 443 (0.0.0.0/0)  │    │
│  │  └──────────────────┘                                │    │
│  │  ┌──────────────────┐                                │    │
│  │  │  Bastion Host     │  ← sg: bastion-sg             │    │
│  │  │  (跳板机)          │    入站: 22 (VPN IP only)     │    │
│  │  └──────────────────┘                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  私有子网 (10.0.2.0/24)                               │    │
│  │  ┌──────────────────┐                                │    │
│  │  │  EC2 API Pods     │  ← sg: api-sg                 │    │
│  │  │  (PHP-FPM + Nginx)│    入站: 80 (from alb-sg only)│    │
│  │  └──────────────────┘    入站: 22 (from bastion-sg)   │    │
│  │  ┌──────────────────┐                                │    │
│  │  │  RDS (MySQL)       │  ← sg: rds-sg                │    │
│  │  │  Multi-AZ          │    入站: 3306 (from api-sg)   │    │
│  │  └──────────────────┘                                │    │
│  │  ┌──────────────────┐                                │    │
│  │  │  ElastiCache       │  ← sg: redis-sg              │    │
│  │  │  (Redis Cluster)   │    入站: 6379 (from api-sg)   │    │
│  │  └──────────────────┘                                │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 踩坑：安全组规则数量上限

**坑**：AWS 安全组默认最多 60 条入站 + 60 条出站规则。当我们有 30+ 微服务互相调用时，用「每对服务一个安全组规则」的方式很快就超限了。

**解决方案**：
1. 用 **安全组引用**（`security_groups = [sg-xxx]`）代替 CIDR 白名单——一个规则就能放行整个安全组的所有实例
2. 把同类服务归到同一个安全组（如所有 API 服务共用 `api-sg`）
3. 超复杂场景用 **AWS Network Firewall** 或 **服务网格 (Istio)** 做更细粒度的流量控制

---

## 📈 四、Auto Scaling Group (ASG)：自动扩缩容实战

### 4.1 ASG 基础配置

```hcl
# Launch Template：定义 EC2 启动模板
resource "aws_launch_template" "api_lt" {
  name          = "b2c-api-lt"
  image_id      = "ami-0abcdef1234567890"  # 自定义 AMI
  instance_type = "t3.large"
  key_name      = "deploy-key"

  vpc_security_group_ids = [aws_security_group.api_sg.id]

  # User Data：实例启动时自动部署
  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # 安装 CloudWatch Agent
    yum install -y amazon-cloudwatch-agent

    # 拉取最新代码
    cd /var/www/html
    git pull origin main
    composer install --no-dev --optimize-autoloader

    # Laravel 优化
    php artisan config:cache
    php artisan route:cache
    php artisan view:cache
    php artisan opcache:clear

    # 启动服务
    systemctl restart php-fpm
    systemctl restart nginx
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = "b2c-api"
      Service = "api"
      Team    = "backend"
    }
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "api_asg" {
  name                = "b2c-api-asg"
  desired_capacity    = 2
  max_size            = 10
  min_size            = 2
  vpc_zone_identifier = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  target_group_arns   = [aws_lb_target_group.api_tg.arn]
  health_check_type   = "ELB"       # 用 ALB 健康检查，而非 EC2 状态
  health_check_grace_period = 120   # 给 Laravel 足够的启动时间

  launch_template {
    id      = aws_launch_template.api_lt.id
    version = "$Latest"
  }

  # 实例刷新策略：滚动更新
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 80
      instance_warmup        = 180  # 新实例 warmup 3 分钟
    }
  }
}
```

### 4.2 扩缩容策略

```hcl
# 策略 1：基于 CPU 的目标追踪
resource "aws_autoscaling_policy" "cpu_target" {
  name                   = "b2c-api-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.api_asg.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60.0  # CPU 维持在 60%
  }
}

# 策略 2：基于 ALB 请求数的扩缩容（更贴近实际负载）
resource "aws_autoscaling_policy" "request_count" {
  name                   = "b2c-api-request-count"
  autoscaling_group_name = aws_autoscaling_group.api_asg.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api_tg.arn_suffix}"
    }
    target_value = 1000  # 每个实例每分钟处理 1000 请求
  }
}

# 策略 3：预测性扩容（适合可预测的流量模式，如每天 9 点流量高峰）
resource "aws_autoscaling_policy" "predictive" {
  name                   = "b2c-api-predictive"
  autoscaling_group_name = aws_autoscaling_group.api_asg.name
  policy_type            = "PredictiveScaling"

  predictive_scaling_configuration {
    mode = "ForecastAndScale"
    metric_specification {
      target_value = 60
      predefined_metric_pair_specification {
        predefined_metric_type = "ASGCPUUtilization"
      }
    }
  }
}
```

### 4.3 踩坑：ASG 缩容时 Laravel Session 丢失

![EC2 部署与代码终端操作](/images/content/architecture-002-content-2.jpg)

**现象**：用户在结账流程中，ASG 缩容把某台 EC2 干掉了，用户被登出，购物车清空。

**根因**：Laravel 默认用 `file` session driver，session 文件存在本地 EC2 磁盘上。缩容时实例被终止，session 文件一起消失。

**解决方案**：

```php
// config/session.php
'driver' => env('SESSION_DRIVER', 'redis'),  // 改用 Redis

// .env
SESSION_DRIVER=redis
SESSION_CONNECTION=session
SESSION_LIFETIME=120

// config/database.php 中定义 session 连接
'redis' => [
    'session' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => 1,  // session 专用 db
        'prefix' => 'sess:',
    ],
],
```

**附加加固**：在 ASG 的 lifecycle hook 中，缩容前优雅地排空连接：

```bash
#!/bin/bash
# lifecycle-hook-drain.sh
# 缩容前：告诉 Nginx 不再接受新连接，等现有请求处理完

# 1. 从 Target Group 中注销（ALB 不再发新请求）
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
aws elbv2 deregister-targets \
  --target-group-arn $TARGET_GROUP_ARN \
  --targets Id=$INSTANCE_ID

# 2. 等待现有请求处理完毕（最多等 60 秒）
sleep 30

# 3. 完成 lifecycle hook
aws autoscaling complete-lifecycle-action \
  --lifecycle-hook-name $LIFECYCLE_HOOK_NAME \
  --auto-scaling-group-name $ASG_NAME \
  --instance-id $INSTANCE_ID \
  --lifecycle-action-result CONTINUE
```

---

## 🔧 五、生产部署 Checklist

### 5.1 AMI 管理

```bash
# 从运行中的实例创建 Golden AMI
aws ec2 create-image \
  --instance-id i-0abc123def456 \
  --name "b2c-api-$(date +%Y%m%d)" \
  --description "Laravel B2C API Golden AMI" \
  --no-reboot

# AMI 包含：PHP 8.2 + Nginx + Composer + Supervisor + CloudWatch Agent
# 好处：新实例启动时不需要再 install 一堆东西，启动时间从 5 分钟降到 30 秒
```

### 5.2 日志与监控

```json
// CloudWatch Agent 配置（/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json）
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/www/html/storage/logs/laravel.log",
            "log_group_name": "/ec2/b2c-api/laravel",
            "log_stream_name": "{instance_id}",
            "timezone": "UTC",
            "timestamp_format": "[%Y-%m-%d %H:%M:%S]"
          },
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/ec2/b2c-api/nginx-access",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  },
  "metrics": {
    "metrics_collected": {
      "statsd": {
        "service_address": ":8125"
      }
    }
  }
}
```

```php
// Laravel 中通过 StatsD 发送自定义指标
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Event;

public function boot(): void
{
    // 队列任务完成时发送指标
    Queue::after(function ($event) {
        $metrics = app(\App\Services\MetricsService::class);
        $metrics->increment('queue.job.completed');
        $metrics->timing('queue.job.processing_time', $event->job->job->time());
    });

    // API 请求延迟
    Event::listen(RequestHandled::class, function ($event) {
        $duration = (microtime(true) - LARAVEL_START) * 1000;
        app(\App\Services\MetricsService::class)
            ->timing('api.response_time', $duration);
    });
}
```

### 5.3 健康检查端点

```php
// routes/web.php
Route::get('/health', function () {
    $checks = [
        'database' => false,
        'redis' => false,
        'storage' => false,
    ];

    try {
        DB::connection()->getPdo();
        $checks['database'] = true;
    } catch (\Exception $e) {
        report($e);
    }

    try {
        Redis::ping();
        $checks['redis'] = true;
    } catch (\Exception $e) {
        report($e);
    }

    $checks['storage'] = is_writable(storage_path('logs'));

    $allHealthy = !in_array(false, $checks, true);

    return response()->json([
        'status' => $allHealthy ? 'healthy' : 'unhealthy',
        'checks' => $checks,
        'timestamp' => now()->toIso8601String(),
    ], $allHealthy ? 200 : 503);
})->withoutMiddleware(['auth', 'throttle']);
```

**踩坑**：ALB 健康检查默认超时 5 秒，间隔 30 秒。如果 Laravel 的 `/health` 端点需要连数据库 + Redis，冷启动时可能超过 5 秒，导致健康检查失败 → 实例被标记为 unhealthy → ASG 重启实例 → 死循环。

**解决**：`health_check_grace_period` 设为 120 秒，health 端点做轻量检查或缓存。

---

## ⚠️ 六、踩坑大全

### 坑 1：跨可用区延迟

```
┌─────────── AZ-a ───────────┐    ┌─────────── AZ-b ───────────┐
│  EC2 API (PHP-FPM)         │    │  RDS Primary               │
│  ─── 查询 ──────────────────┼───→│  (写入)                     │
│  latency: 0.5ms (同 AZ)     │    │  latency: 1.2ms (跨 AZ)    │
└─────────────────────────────┘    └────────────────────────────┘
```

**问题**：EC2 和 RDS 不在同一个 AZ，每次数据库查询多 0.5-1ms 的网络延迟。对于一个 API 请求可能有 5-10 次 DB 查询，累积起来就是 5-10ms 的额外延迟。

**解决**：ASG 配置 `vpc_zone_identifier` 时，确保和 RDS Primary 在同一个 AZ 列表中优先分布。或者用 RDS **Read Replica** 做读写分离，Read Replica 放在 EC2 所在的 AZ。

### 坑 2：EBS 卷 IOPS 不足

**现象**：Laravel 日志写入变慢，artisan migrate 卡住。

**根因**：默认 `gp3` 卷的 IOPS 是 3000，但日志量大时（debug 模式没关……）可能打满。

**解决**：
```bash
# 修改 EBS 卷的 IOPS
aws ec2 modify-volume \
  --volume-id vol-0abc123def456 \
  --volume-type gp3 \
  --iops 6000 \
  --throughput 250

# 或者在 Launch Template 中预设
```

### 坑 3：时区不一致导致定时任务混乱

```bash
# EC2 默认 UTC，但业务用 Asia/Taipei
# 在 User Data 中设置
timedatectl set-timezone Asia/Taipei

# Laravel config/app.php
'timezone' => 'Asia/Taipei',
```

**踩坑**：EC2 用 UTC，Laravel 用 Asia/Taipei，Cron 用 UTC，导致 scheduled tasks 在错误的时间执行。

---

## 📊 七、成本优化建议

| 策略 | 节省幅度 | 适用场景 |
|------|---------|---------|
| Reserved Instance (1年) | 30-40% | 稳定流量的 API 服务 |
| Spot Instance | 60-70% | Queue Worker（可中断） |
| Savings Plans | 20-30% | 多种实例类型混合使用 |
| Graviton (ARM) 实例 | 20% | t4g/c7g 比同级 Intel 便宜 |
| 定时开关机 | 50%+ | 开发/测试环境 |

**踩坑**：Spot Instance 会被 AWS 随时回收（2 分钟通知）。Queue Worker 如果用 Spot，必须配合 SQS 的 **visibility timeout** 和 **dead letter queue**，确保任务不会因为实例回收而丢失。

```php
// config/queue.php
'sqs' => [
    'driver' => 'sqs',
    'queue' => env('SQS_QUEUE', 'default'),
    'retry_after' => 120,           // 任务执行超时 120 秒后重新入队
    'timeout' => 90,                 // 单任务超时
    'after_commit' => false,         // 不等事务提交（提高吞吐）
],
```

---

## 🎯 总结

| 决策点 | 推荐方案 | 理由 |
|--------|---------|------|
| API 实例类型 | t3.large + T3 Unlimited | 性价比最优，突发场景兜底 |
| Session 存储 | Redis（非 file） | ASG 缩容不丢失 session |
| 安全组 | 分层设计，安全组引用 | 避免规则爆炸，最小权限 |
| 健康检查 | ELB 类型 + 120s grace period | 给 Laravel 足够启动时间 |
| 扩容指标 | ALB Request Count > CPU | PHP 瓶颈不一定是 CPU |
| Queue Worker | 独立 ASG + Spot Instance | 省钱 + 与 API 互不影响 |

**核心经验**：EC2 不过时。不是所有服务都需要 K8s——当你有 5 个以下的 Laravel 服务、日均请求量在百万级以内时，EC2 + ALB + ASG 的组合在运维成本和灵活性之间是最好的平衡点。

> 📖 **相关阅读**：
> - [负载均衡实战：Nginx Upstream + Laravel Session 共享方案](/00_架构/负载均衡实战-Nginx-Upstream-Laravel-Session-共享方案踩坑记录)
> - [云服务器选型：AWS/阿里云/腾讯云 B2C 电商场景对比](/00_架构/云服务器选型实战-AWS-阿里云-腾讯云-B2C电商场景对比与踩坑记录)
> - [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚](/07_CICD/ArgoCD-GitOps-实战-Laravel-应用持续部署与回滚踩坑记录)
