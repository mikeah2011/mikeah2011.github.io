---

title: Spot Instance 实战：Laravel 工作负载用竞价实例省钱——中断处理、混合调度与 K8s 自动迁移踩坑记录
keywords: [Spot Instance, Laravel, K8s, 工作负载用竞价实例省钱, 中断处理, 混合调度与, 自动迁移踩坑记录]
date: 2026-06-03 11:00:00
tags:
- spot-instance
- AWS
- Kubernetes
- Laravel
- 成本优化
- 云计算
description: Spot Instance 实战省钱指南：Laravel 工作负载如何利用 AWS 竞价实例降低 60%-90% 计算成本。详解 Spot 定价机制、中断信号处理（SIGTERM + 两分钟窗口）、Laravel Queue Worker 优雅关闭改造、Karpenter 智能调度、K8s Pod Disruption Budget 配置，以及混合 On-Demand/Spot 调度比例设计。附带完整 Helm Chart 配置、Grafana 监控面板与 9 个真实踩坑案例，帮助团队安全落地 Spot Instance 成本优化。
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



## 前言

在云原生时代，计算资源的成本优化一直是技术团队面临的核心挑战之一。对于使用 Laravel 框架构建的 Web 应用来说，随着业务规模的不断扩大，EC2 实例的费用往往占据了云计算支出的大头。根据 AWS 官方数据，Spot Instance 相比 On-Demand 实例可以节省高达 60%-90% 的计算成本——这意味着如果你每月在 EC2 上花费 10 万元，合理使用 Spot Instance 有可能节省 6-9 万元。

然而，Spot Instance 的"代价"是其不确定性的中断风险。AWS 可以在提前两分钟通知的情况下随时回收你的实例。对于面向用户的 Web 请求处理来说，这无疑是一个巨大的风险；但对于异步任务处理、后台队列消费等场景，Spot Instance 简直是"天作之合"。

本文将详细分享我们团队在 Laravel 项目中落地 Spot Instance 的完整实战经验，涵盖 Spot 原理分析、适合与不适合的工作负载判断、AWS Spot Fleet 配置、Kubernetes 中的 Spot 调度策略、中断信号处理、Laravel 队列 Worker 改造、混合调度比例设计、自动迁移机制、监控告警体系，以及一系列踩坑记录。希望这篇文章能帮助你少走弯路，在享受成本红利的同时确保服务的稳定可靠。

---

## 第一章：Spot Instance 原理与定价机制

### 1.1 什么是 Spot Instance

AWS 的 EC2 实例按照计费模式分为四种类型：On-Demand（按需实例）、Reserved（预留实例）、Spot Instance（竞价实例）和 Savings Plans（节省计划）。其中，Spot Instance 是 AWS 将其数据中心中闲置未使用的计算资源以折扣价格提供给用户的一种方式。

Spot Instance 的核心特点可以总结为以下几点：

- **价格极低**：相比 On-Demand 实例，Spot Instance 的价格通常只有 10%-40%，极端情况下甚至可以低至 1 折。
- **中断风险**：当 AWS 需要回收这些闲置资源时（比如 On-Demand 需求增加），你的 Spot Instance 会在收到两分钟通知后被终止。
- **价格波动**：Spot 价格随市场供需实时变化，不同的实例类型、不同的可用区（AZ）、不同的时间段，价格都可能不同。
- **容量限制**：不是任何时候都能申请到你想要的 Spot Instance，取决于可用区的空闲容量。

### 1.2 Spot 定价机制详解

Spot 价格并不是用户"出价最高者得"的传统竞价模式——AWS 在 2017 年已经取消了这种机制。现在的 Spot 价格由 AWS 根据长期供需趋势自动设定，用户无法自定义出价，只能选择接受当前价格或者不使用。

理解 Spot 定价机制的关键点：

```
┌─────────────────────────────────────────────────────────┐
│                  Spot 定价机制示意                        │
│                                                         │
│  On-Demand 价格: $0.096/hour (m5.xlarge)               │
│       ▲                                                 │
│       │  ┌──────────────────────────┐                   │
│       │  │  Spot 价格历史波动范围     │                   │
│       │  │  $0.03 ~ $0.05 /hour     │                   │
│       │  └──────────────────────────┘                   │
│       │                                                 │
│       │  平均节省: 60-70%                                │
│       │                                                 │
│  价格由 AWS 自动调整，基于:                              │
│  - 长期供需趋势                                         │
│  - 实例类型受欢迎程度                                    │
│  - 可用区容量                                           │
│  - 季节性因素                                           │
└─────────────────────────────────────────────────────────┘
```

### 1.3 中断机制与中断频率

AWS 提供了 **Spot Instance Advisor** 工具，可以查看不同实例类型的中断频率。中断频率分为四个等级：

- **<5%**：中断概率极低
- **5-10%**：中断概率较低
- **10-15%**：中断概率中等
- **15-20%**：中断概率较高

通过 AWS CLI 查询 Spot 中断频率：

```bash
# 查询特定实例类型的 Spot 价格历史
aws ec2 describe-spot-price-history \
  --instance-types m5.xlarge m5.2xlarge c5.xlarge r5.xlarge \
  --product-descriptions "Linux/UNIX" \
  --start-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --query 'SpotPriceHistory[*].{AZ:AvailabilityZone,Type:InstanceType,Price:SpotPrice}' \
  --output table

# 查询 Spot 中断通知（需要 EventBridge 配合）
aws ec2 describe-spot-instance-requests \
  --query 'SpotInstanceRequests[*].{ID:SpotInstanceRequestId,State:State,Status:Status}'

# 使用 Spot Instance Advisor API 获取推荐
aws ec2 get-spot-placement-scores \
  --instance-types m5.xlarge c5.xlarge r5.xlarge \
  --region us-east-1 \
  --single-availability-zone \
  --target-capacity 10
```

### 1.4 两分钟中断通知

当 AWS 决定回收 Spot Instance 时，会通过以下渠道提前两分钟通知用户：

1. **EC2 Instance Metadata Service (IMDS)**：实例元数据中会出现 `spot/instance-action` 端点
2. **CloudWatch Events / EventBridge**：触发 `EC2 Spot Instance Interruption` 事件
3. **SQS 队列通知**（需提前配置）

```bash
# 在实例内部检查是否收到中断通知
curl -s http://169.254.169.254/latest/meta-data/spot/instance-action

# 如果收到中断通知，返回类似：
# {"action":"terminate","time":"2026-06-03T12:00:00Z"}

# 没有收到通知时返回 404
```

这两分钟是整个 Spot 实践的核心——所有优雅关闭、任务迁移、状态保存的策略，都必须在这 120 秒内完成。

---

## 第二章：适合 Spot 的 Laravel 工作负载类型

### 2.1 判断标准：什么工作负载适合 Spot？

在决定是否将某类工作负载迁移到 Spot Instance 之前，需要评估以下几个维度：

```
┌─────────────────────────────────────────────────────────────┐
│              工作负载 Spot 适配性评估矩阵                      │
├──────────────────┬──────────────┬───────────────────────────┤
│ 评估维度          │ 适合 Spot    │ 不适合 Spot               │
├──────────────────┼──────────────┼───────────────────────────┤
│ 可中断性          │ 可随时中断    │ 需要持续运行              │
│ 状态管理          │ 无状态        │ 有状态/需持久化           │
│ 时间敏感性        │ 允许延迟      │ 实时响应                  │
│ 任务原子性        │ 可重试/幂等   │ 不可中断                  │
│ 恢复成本          │ 低            │ 高                       │
└──────────────────┴──────────────┴───────────────────────────┘
```

### 2.2 适合 Spot 的 Laravel 工作负载

#### 2.2.1 队列 Worker（Queue Worker）

Laravel 的队列系统天然适合 Spot Instance。队列 Worker 从消息队列（如 SQS、Redis、RabbitMQ）中取出任务逐个执行，即使 Worker 被中断，未完成的任务可以通过 **visibility timeout** 自动回到队列中，由其他 Worker 重新消费。

```php
// app/Jobs/ProcessOrder.php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    // 设置任务最大尝试次数，Spot 中断后可自动重试
    public int $tries = 5;

    // 设置任务超时时间（秒），确保不会因为中断而卡住
    public int $timeout = 120;

    // 指定重试延迟（秒），使用指数退避
    public function retryAfter(): int
    {
        return $this->attempts() * 30;
    }

    public function __construct(
        public int $orderId
    ) {
        // 使用 Redis SQS 时，设置任务唯一性锁
        $this->onQueue('orders');
    }

    public function handle(): void
    {
        Log::info("Processing order {$this->orderId}", [
            'attempt' => $this->attempts(),
            'worker_host' => gethostname(),
        ]);

        // 订单处理逻辑...
        // 即使 Spot 中断导致任务失败，最多重试 5 次
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("Order {$this->orderId} processing failed permanently", [
            'exception' => $exception->getMessage(),
            'attempts' => $this->attempts(),
        ]);
    }
}
```

#### 2.2.2 定时任务（Scheduled Tasks）

Laravel 的调度器（Scheduler）中有很多不需要精确到秒级执行的任务，例如数据统计、报表生成、缓存预热等。这些任务完全可以放在 Spot Instance 上运行。

```php
// app/Console/Kernel.php
<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 日报生成 - 每天凌晨执行，Spot 中断后手动触发即可
        $schedule->command('reports:generate-daily')
            ->dailyAt('02:00')
            ->withoutOverlapping(30)
            ->onOneServer()   // 多实例环境下只在一个节点执行
            ->after(function () {
                // 执行完成后发送通知
                \Log::info('Daily report generated successfully');
            });

        // 数据同步任务 - 每小时执行
        $schedule->command('data:sync-external-api')
            ->hourly()
            ->runInBackground()
            ->withoutOverlapping()
            ->after(function () {
                cache()->put('last_sync_at', now()->toDateTimeString());
            });

        // 缓存预热 - 每 6 小时
        $schedule->command('cache:warmup')
            ->cron('0 */6 * * *')
            ->onOneServer();
    }
}
```

#### 2.2.3 批处理作业（Batch Processing）

数据导入导出、图片处理、视频转码、PDF 生成等 CPU 密集型任务，非常适合使用 Spot Instance。这些任务通常耗时较长，但对中断有较好的容忍度。

```php
// app/Jobs/BatchProcessImages.php
<?php

namespace App\Jobs;

use Illuminate\Batch\Batch;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Storage;

class BatchProcessImages
{
    public function handle(): void
    {
        $images = Storage::disk('s3')->files('uploads/raw/');
        $jobs = collect($images)->map(fn($image) => new ProcessSingleImage($image));

        // Laravel Batch API - 支持部分失败后继续
        Bus::batch($jobs)
            ->then(fn(Batch $batch) => Log::info("All {$batch->totalJobs} images processed"))
            ->catch(fn(Batch $batch, Throwable $e) => Log::error("Batch failed"))
            ->onQueue('batch-processing')
            ->dispatch();
    }
}
```

### 2.3 不适合 Spot 的场景

#### 2.3.1 Web 请求处理

面向用户的 HTTP 请求绝对不能运行在 Spot Instance 上。中断会导致用户请求失败、页面加载超时、表单提交丢失等问题。

```
⚠️ 不适合 Spot 的场景：

1. Nginx/Apache Web 服务器
   - 用户请求中断 = 直接 502/504 错误
   - WebSocket 连接断开
   - 上传中断，文件损坏

2. 数据库实例
   - MySQL/PostgreSQL 在中断时可能导致数据损坏
   - 主从复制链路断裂
   - 事务回滚不完整

3. Session 存储
   - 如果使用 file session，中断导致所有在线用户 session 丢失
   - 购物车等业务数据丢失

4. 长连接服务
   - WebSocket 服务器
   - gRPC 流式传输
   - 实时推送服务
```

#### 2.3.2 正确的做法：Web 层使用 On-Demand

```yaml
# Web 层必须使用 On-Demand 实例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-web
spec:
  replicas: 3
  template:
    spec:
      # Web 层不使用 Spot
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node.kubernetes.io/capacity-type
                    operator: NotIn
                    values:
                      - spot    # 排除 Spot 节点
      containers:
        - name: laravel-app
          image: laravel-app:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
```

---

## 第三章：AWS Spot Fleet 配置实战

### 3.1 Spot Fleet 概念

**Spot Fleet**（Spot 队列）是 AWS 提供的一种管理和自动扩展 Spot Instance 的方式。与单独创建 Spot Instance 不同，Spot Fleet 允许你定义一组实例的容量需求，AWS 会自动帮你维护这些实例的数量，并在实例被中断时自动补充。

Spot Fleet 的核心优势：

- **多实例类型混用**：同时请求多种实例类型，降低全部中断的风险
- **跨可用区分布**：自动在多个 AZ 中分配实例
- **自动维护容量**：中断后自动补充新实例
- **灵活的分配策略**：支持 lowestPrice、diversified、capacityOptimized 等策略

### 3.2 使用 Terraform 配置 Spot Fleet

```hcl
# terraform/spot-fleet.tf

# 创建 IAM 角色用于 Spot Fleet
resource "aws_iam_role" "spot_fleet_role" {
  name = "laravel-spot-fleet-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "spotfleet.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "spot_fleet_policy" {
  role       = aws_iam_role.spot_fleet_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2SpotFleetTaggingRole"
}

# Spot Fleet 请求配置
resource "aws_spot_fleet_request" "laravel_workers" {
  iam_fleet_role                      = aws_iam_role.spot_fleet_role.arn
  target_capacity                     = 4          # 目标容量：4 个实例
  allocation_strategy                = "capacityOptimized"  # 容量优化策略
  terminate_instances_with_expiration = true
  instance_interruption_behavior     = "terminate"
  valid_until                         = "2027-01-01T00:00:00Z"

  # 多种实例类型配置，降低全部中断风险
  launch_template_config {
    launch_template_specification {
      id      = aws_launch_template.laravel_worker.id
      version = "$Latest"
    }

    # 覆盖不同的实例类型
    overrides {
      instance_type     = "m5.xlarge"
      subnet_id         = aws_subnet.private_az_a.id
      weighted_capacity = 1
      spot_price        = "0.05"
    }

    overrides {
      instance_type     = "m5.xlarge"
      subnet_id         = aws_subnet.private_az_b.id
      weighted_capacity = 1
      spot_price        = "0.05"
    }

    overrides {
      instance_type     = "m5.xlarge"
      subnet_id         = aws_subnet.private_az_c.id
      weighted_capacity = 1
      spot_price        = "0.05"
    }

    overrides {
      instance_type     = "m5a.xlarge"
      subnet_id         = aws_subnet.private_az_a.id
      weighted_capacity = 1
    }

    overrides {
      instance_type     = "m5a.xlarge"
      subnet_id         = aws_subnet.private_az_b.id
      weighted_capacity = 1
    }

    overrides {
      instance_type     = "c5.xlarge"
      subnet_id         = aws_subnet.private_az_a.id
      weighted_capacity = 1
    }

    overrides {
      instance_type     = "c5.xlarge"
      subnet_id         = aws_subnet.private_az_b.id
      weighted_capacity = 1
    }

    overrides {
      instance_type     = "c5a.xlarge"
      subnet_id         = aws_subnet.private_az_a.id
      weighted_capacity = 1
    }

    overrides {
      instance_type     = "r5.xlarge"
      subnet_id         = aws_subnet.private_az_a.id
      weighted_capacity = 2   # r5.xlarge 算 2 个容量单位
    }
  }

  # 同时维护一定数量的 On-Demand 实例作为保底
  launch_template_config {
    launch_template_specification {
      id      = aws_launch_template.laravel_worker.id
      version = "$Latest"
    }

    overrides {
      instance_type = "m5.xlarge"
      subnet_id     = aws_subnet.private_az_a.id
    }
  }

  # Spot Fleet 维护的 On-Demand 容量
  # 通过 target_capacity_specification 实现混合
}

# Launch Template
resource "aws_launch_template" "laravel_worker" {
  name_prefix   = "laravel-worker-"
  image_id      = data.aws_ami.ubuntu_lts.id
  instance_type = "m5.xlarge"

  iam_instance_profile {
    name = aws_iam_instance_profile.worker_profile.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.worker_sg.id]
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -euxo pipefail

    # 安装必要软件
    apt-get update && apt-get install -y docker.io supervisor php8.3-cli php8.3-mbstring php8.3-xml php8.3-curl

    # 配置 Spot 中断处理脚本
    cat > /usr/local/bin/spot-interrupt-handler.sh << 'HANDLER'
    #!/bin/bash
    while true; do
      RESPONSE=$(curl -s -o /dev/null -w "%%{http_code}" http://169.254.169.254/latest/meta-data/spot/instance-action 2>/dev/null)
      if [ "$RESPONSE" -eq 200 ]; then
        echo "$(date): Spot interruption notice received" >> /var/log/spot-handler.log
        # 优雅关闭 Laravel 队列 worker
        supervisorctl stop laravel-worker:*
        # 等待当前任务完成
        sleep 30
        # 关闭 Supervisor
        supervisorctl shutdown
        exit 0
      fi
      sleep 5
    done
    HANDLER

    chmod +x /usr/local/bin/spot-interrupt-handler.sh
    nohup /usr/local/bin/spot-interrupt-handler.sh &

    # 部署 Laravel 应用和 Supervisor 配置
    # ... (部署逻辑)
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "laravel-worker-spot"
      Environment = "production"
      ManagedBy   = "spot-fleet"
    }
  }
}
```

### 3.3 分配策略选择

AWS Spot Fleet 支持多种分配策略，选择合适的策略直接影响你的可用性和成本：

```
┌──────────────────────────────────────────────────────────────────┐
│                    Spot 分配策略对比                               │
├──────────────────────┬───────────────────────────────────────────┤
│ 策略名称              │ 适用场景与特点                             │
├──────────────────────┼───────────────────────────────────────────┤
│ lowestPrice          │ 选择当前最便宜的实例类型                    │
│                      │ 适合成本敏感、对中断容忍度高的场景           │
│                      │ 风险：可能集中在一个 AZ，容易全部中断        │
├──────────────────────┼───────────────────────────────────────────┤
│ diversified          │ 在所有配置的实例类型和 AZ 中均匀分配        │
│                      │ 适合需要高可用的场景                        │
│                      │ 风险：可能用到较贵的实例类型                 │
├──────────────────────┼───────────────────────────────────────────┤
│ capacityOptimized   │ 选择中断概率最低的实例池 ⭐推荐             │
│                      │ 综合考虑价格和容量稳定性                    │
│                      │ 适合生产环境的 Laravel 队列 Worker          │
├──────────────────────┼───────────────────────────────────────────┤
│ capacityOptimized   │ capacityOptimized 的优先级版本              │
│ -prioritized        │ 允许你通过 priority 字段指定实例类型偏好      │
│                      │ 适合对特定实例类型有偏好的场景               │
└──────────────────────┴───────────────────────────────────────────┘
```

**我们的选择**：对于 Laravel 队列 Worker，推荐使用 `capacityOptimized` 策略。这个策略会自动选择当前容量最充裕的实例池，从而降低中断概率。虽然价格可能不是最低的，但稳定性的提升远大于成本差异。

---

## 第四章：Kubernetes 中的 Spot 调度

### 4.1 Node Selector 与标签

在 Kubernetes 集群中使用 Spot Instance，第一步是为 Spot 节点打上标签，让调度器知道哪些节点是 Spot 的。

```bash
# 为 Spot 节点打标签
kubectl label nodes spot-node-1 \
  node.kubernetes.io/capacity-type=spot \
  node.kubernetes.io/instance-type=m5.xlarge

kubectl label nodes spot-node-2 \
  node.kubernetes.io/capacity-type=spot \
  node.kubernetes.io/instance-type=c5.xlarge

# 验证标签
kubectl get nodes -L node.kubernetes.io/capacity-type,node.kubernetes.io/instance-type
```

在 Pod 调度时使用 NodeSelector：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-queue-worker
  namespace: production
spec:
  replicas: 6
  selector:
    matchLabels:
      app: laravel-queue-worker
  template:
    metadata:
      labels:
        app: laravel-queue-worker
        workload-type: queue
    spec:
      # 只调度到 Spot 节点
      nodeSelector:
        node.kubernetes.io/capacity-type: spot

      containers:
        - name: worker
          image: laravel-app:v2.3.1
          command: ["php", "artisan", "queue:work", "sqs", "--sleep=3", "--tries=3", "--timeout=90"]
          env:
            - name: QUEUE_NAME
              value: "default,emails,notifications"
            - name: DB_CONNECTION
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: connection-string
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          # 优雅关闭配置
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - "php artisan queue:restart && sleep 15"
          terminationGracePeriodSeconds: 60
```

### 4.2 Taint 与 Toleration

使用 Taint/Toleration 机制可以更精细地控制 Spot 节点的调度行为：

```bash
# 为 Spot 节点添加 Taint
kubectl taint nodes spot-node-1 spot=true:PreferNoSchedule
kubectl taint nodes spot-node-2 spot=true:PreferNoSchedule
```

```yaml
# Spot 容忍配置
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-scheduler-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: laravel-scheduler
  template:
    spec:
      # 容忍 Spot Taint
      tolerations:
        - key: "spot"
          operator: "Equal"
          value: "true"
          effect: "PreferNoSchedule"
      
      # 同时使用 NodeSelector 精确匹配
      nodeSelector:
        node.kubernetes.io/capacity-type: spot
      
      # 反亲和性：分散到不同节点
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: laravel-scheduler
                topologyKey: kubernetes.io/hostname

      containers:
        - name: scheduler
          image: laravel-app:v2.3.1
          command: ["/bin/sh", "-c"]
          args:
            - |
              # 启动定时任务处理器
              while true; do
                php artisan schedule:run --no-interaction
                sleep 60
              done
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
```

### 4.3 Karpenter 配置

**Karpenter** 是 AWS 推出的 Kubernetes 自动扩缩器，相比 Cluster Autoscaler，它对 Spot Instance 的支持更加智能和灵活。Karpenter 能够自动选择最优的实例类型组合，并在 Spot 中断时快速替换节点。

```yaml
# karpenter/nodepool-spot.yaml
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: laravel-spot-pool
spec:
  template:
    metadata:
      labels:
        workload-type: laravel-worker
        capacity-type: spot
    spec:
      # Spot 节点的 taint
      taints:
        - key: spot
          value: "true"
          effect: PreferNoSchedule

      requirements:
        # 允许的实例类型族
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["m5", "m5a", "m5d", "m6i", "m6a", "c5", "c5a", "c6i", "r5", "r5a"]
        
        # 允许的实例大小
        - key: karpenter.k8s.aws/instance-size
          operator: In
          values: ["xlarge", "2xlarge", "4xlarge"]
        
        # 要求必须是 Spot
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot"]
        
        # 允许的可用区
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["us-east-1a", "us-east-1b", "us-east-1c"]
        
        # 架构要求
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]

      # 节点 IAM 角色
      nodeClassRef:
        name: laravel-spot-nodeclass

  # 扩缩配置
  disruption:
    consolidationPolicy: WhenEmpty
    consolidateAfter: 30s
    expireAfter: 720h   # 节点 30 天后自动替换

  # 限制范围
  limits:
    cpu: "100"
    memory: "200Gi"

---
# karpenter/nodeclass-spot.yaml
apiVersion: karpenter.k8s.aws/v1beta1
kind: EC2NodeClass
metadata:
  name: laravel-spot-nodeclass
spec:
  amiFamily: Ubuntu
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: "laravel-cluster"
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: "laravel-cluster"
  
  # 使用压缩镜像加速启动
  amiSelectorTerms:
    - alias: ubuntu@22.04

  # 节点存储配置
  blockDeviceMappings:
    - deviceName: /dev/sda1
      ebs:
        volumeSize: 100Gi
        volumeType: gp3
        iops: 3000
        throughput: 125
        deleteOnTermination: true

  # 实例元数据配置（安全加固）
  metadataOptions:
    httpEndpoint: enabled
    httpProtocolIPv6: disabled
    httpPutResponseHopLimit: 2
    httpTokens: required    # 强制使用 IMDSv2

  # 节点标签
  tags:
    Environment: production
    Team: backend
    ManagedBy: karpenter
```

部署 Karpenter 后，它会自动完成以下工作：

1. 根据 Pod 的资源请求自动选择合适的实例类型
2. 从 Spot 价格最低的实例池中选择
3. 在节点被中断时自动创建替换节点
4. 空闲节点自动回收（consolidation）

---

## 第五章：中断信号处理与优雅关闭

### 5.1 理解 Spot 中断流程

当 Spot Instance 被中断时，以下事件序列会在 2 分钟内发生：

```
时间线 (秒):
  0s    AWS 发送中断通知
        ├── IMDS 中出现 spot/instance-action
        ├── EventBridge 发送事件
        └── SQS 发送消息（如果配置了）
  
  0-10s 检测到中断通知
        ├── 监控脚本检测到 IMDS 变化
        └── K8s node-termination-handler 检测到
  
  10-30s 优雅关闭开始
        ├── 标记节点为不可调度
        ├── 驱逐 Pod
        ├── 发送 SIGTERM 到容器
        └── Laravel Worker 停止接收新任务
  
  30-90s 等待当前任务完成
        ├── 执行中的任务继续处理
        ├── 未完成的任务放回队列
        └── 状态持久化
  
  90-110s 强制关闭
        ├── 发送 SIGKILL
        └── 实例终止
  
  120s  实例被终止
```

### 5.2 Linux 级别的 SIGTERM 处理

```bash
#!/bin/bash
# /usr/local/bin/spot-interrupt-handler.sh
# Spot 中断处理守护进程

set -euo pipefail

METADATA_URL="http://169.254.169.254/latest/meta-data/spot/instance-action"
CHECK_INTERVAL=5
LOG_FILE="/var/log/spot-interrupt-handler.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
    echo "[spot-handler] $*"
}

graceful_shutdown() {
    log "Starting graceful shutdown..."
    
    # 1. 停止接收新的队列任务
    log "Stopping Laravel queue workers..."
    supervisorctl stop laravel-worker:* 2>/dev/null || true
    
    # 2. 给当前正在执行的任务一些时间完成
    log "Waiting for running tasks to complete (30s)..."
    sleep 30
    
    # 3. 执行应用级别的清理
    log "Running cleanup scripts..."
    cd /var/www/html
    php artisan queue:cleanup --graceful 2>/dev/null || true
    
    # 4. 关闭 Supervisor
    log "Shutting down supervisor..."
    supervisorctl shutdown 2>/dev/null || true
    
    log "Graceful shutdown completed"
    exit 0
}

log "Spot interrupt handler started (PID: $$)"

while true; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$METADATA_URL" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        ACTION=$(curl -s "$METADATA_URL" 2>/dev/null)
        log "Spot interruption detected: $ACTION"
        graceful_shutdown
    fi
    
    sleep "$CHECK_INTERVAL"
done
```

创建 Systemd 服务来管理中断处理器：

```ini
# /etc/systemd/system/spot-interrupt-handler.service
[Unit]
Description=AWS Spot Instance Interrupt Handler
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/spot-interrupt-handler.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable spot-interrupt-handler
sudo systemctl start spot-interrupt-handler
```

### 5.3 AWS Node Termination Handler（K8s 环境）

在 Kubernetes 环境中，推荐使用 AWS 官方的 **Node Termination Handler** 来处理 Spot 中断：

```yaml
# k8s/node-termination-handler.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kube-system

---
# 使用 Helm 安装 node-termination-handler
# helm repo add eks https://aws.github.io/eks-charts
# helm install aws-node-termination-handler eks/aws-node-termination-handler \
#   --namespace kube-system \
#   --set enableSpotInterruptionDraining=true \
#   --set enableRebalanceMonitoring=true \
#   --set enableScheduledEventDraining=true \
#   --set queueURL=<SQS_QUEUE_URL>

# 或者手动部署 DaemonSet
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: aws-node-termination-handler
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: aws-node-termination-handler
  template:
    metadata:
      labels:
        app: aws-node-termination-handler
    spec:
      # 只在 Spot 节点上运行
      nodeSelector:
        node.kubernetes.io/capacity-type: spot
      serviceAccountName: aws-node-termination-handler
      hostNetwork: true
      containers:
        - name: handler
          image: public.ecr.aws/aws-ec2/aws-node-termination-handler:v1.21.0
          env:
            # 使用 IMDS 模式（推荐）
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: INSTANCE_METADATA_URL
              value: "http://169.254.169.254"
            # 启用 Spot 中断监控
            - name: ENABLE_SPOT_INTERRUPTION_DRAINING
              value: "true"
            # 启用 Rebalance 监控
            - name: ENABLE_REBALANCE_MONITORING
              value: "true"
            # 节点排空超时
            - name: NODE_TERMINATION_GRACE_PERIOD
              value: "120"
            # 是否在排空前发送 Pod 事件
            - name: EMIT_KUBERNETES_EVENTS
              value: "true"
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "100m"
              memory: "128Mi"
```

---

## 第六章：Laravel 队列 Worker 的 Spot 友好改造

### 6.1 Supervisor 配置优化

Laravel 队列 Worker 通常由 Supervisor 管理。为了适配 Spot 环境，需要对 Supervisor 配置进行以下改造：

```ini
# /etc/supervisor/conf.d/laravel-worker.conf
[program:laravel-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/html/artisan queue:work sqs --sleep=3 --tries=3 --max-time=3600 --max-jobs=1000 --memory=512 --timeout=90 --verbose
autostart=true
autorestart=true
; 关键：Spot 环境下设置为 true，让 Supervisor 在 worker 停止后自动重启
; 但配合 queue:restart 命令，可以实现优雅停止
stopasgroup=true
killasgroup=true
; 优雅停止信号
stopsignal=QUIT
; 等待 worker 完成当前任务的时间
stopwaitsecs=60
; 并发 worker 数量
numprocs=4
redirect_stderr=true
stdout_logfile=/var/log/laravel-worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
; 环境变量
environment=HOME="/var/www/html",QUEUE_CONNECTION="sqs",APP_ENV="production"
```

### 6.2 优雅关闭的实现原理

Laravel 的 `queue:work` 命令内置了优雅关闭机制。当接收到 `SIGTERM` 信号时：

1. Worker 停止从队列拉取新任务
2. 等待当前正在执行的任务完成
3. 任务完成后退出进程
4. 如果任务执行超过 `stopwaitsecs`，Supervisor 发送 `SIGKILL` 强制终止

```php
// app/Console/Commands/SpotAwareQueueWorker.php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Queue\Worker;
use Illuminate\Queue\WorkerOptions;
use Illuminate\Support\Facades\Log;

class SpotAwareQueueWorker extends Command
{
    protected $signature = 'queue:work-spot
                            {connection? : The name of the queue connection to work}
                            {--queue= : The names of the queues to work}
                            {--daemon : Run the worker in daemon mode}
                            {--once : Only process the next job on the queue}
                            {--stop-when-empty : Stop when the queue is empty}
                            {--delay=0 : The number of seconds to delay failed jobs}
                            {--max-jobs=0 : The number of jobs to process before stopping}
                            {--max-time=0 : The maximum seconds the worker should run}
                            {--max-memory=128 : The maximum memory the worker may consume}
                            {--sleep=3 : Number of seconds to sleep when no job is available}
                            {--timeout=60 : The number of seconds a child process can run}
                            {--tries=1 : Number of times to attempt a job before logging it failed}
                            {--backoff=0 : Seconds before retrying a job that encountered an uncaught exception}
                            {--force : Force the worker to run even in maintenance mode}';

    protected $description = 'Spot-aware queue worker with graceful shutdown';

    public function handle(Worker $worker): int
    {
        // 注册 Spot 中断信号处理
        $this->registerSpotSignalHandlers($worker);

        $connection = $this->argument('connection') ?: config('queue.default');
        $queue = $this->getQueue($connection);

        $options = new WorkerOptions(
            backoff: $this->option('backoff'),
            delay: $this->option('delay'),
            maxJobs: $this->option('max-jobs'),
            maxTime: $this->option('max-time'),
            maxMemory: $this->option('max-memory'),
            sleep: $this->option('sleep'),
            timeout: $this->option('timeout'),
            tries: $this->option('tries'),
            force: $this->option('force'),
            stopWhenEmpty: $this->option('stop-when-empty'),
        );

        Log::info('Spot-aware queue worker starting', [
            'connection' => $connection,
            'queue' => $queue,
            'host' => gethostname(),
            'pid' => getmypid(),
        ]);

        $worker->daemon($connection, $queue, $options);

        return static::SUCCESS;
    }

    protected function registerSpotSignalHandlers(Worker $worker): void
    {
        // 监听 SIGTERM（Spot 中断会先触发 SIGTERM）
        pcntl_signal(SIGTERM, function () use ($worker) {
            Log::info('Spot interruption signal received, starting graceful shutdown', [
                'host' => gethostname(),
                'pid' => getmypid(),
            ]);
            
            // 通知 worker 停止
            $worker->shouldQuit = true;
            
            // 记录中断事件到 Redis，供监控使用
            $this->recordInterruptionEvent();
        });

        // 监听 SIGQUIT（Supervisor 优雅停止）
        pcntl_signal(SIGQUIT, function () use ($worker) {
            Log::info('SIGQUIT received, queue worker will stop after current job');
            $worker->shouldQuit = true;
        });

        // 设置时钟信号处理器
        pcntl_async_signals(true);
    }

    protected function recordInterruptionEvent(): void
    {
        try {
            $data = [
                'host' => gethostname(),
                'pid' => getmypid(),
                'timestamp' => now()->toIso8601String(),
                'type' => 'spot_interruption',
            ];

            \Illuminate\Support\Facades\Redis::lpush('spot:interruption:events', json_encode($data));
            \Illuminate\Support\Facades\Redis::ltrim('spot:interruption:events', 0, 99);
        } catch (\Throwable $e) {
            // 记录失败不影响关闭流程
            error_log("Failed to record interruption event: " . $e->getMessage());
        }
    }

    protected function getQueue(string $connection): string
    {
        return $this->option('queue')
            ?: config("queue.connections.{$connection}.queue", 'default');
    }
}
```

### 6.3 重试队列与死信队列

为了处理因 Spot 中断而失败的任务，我们需要配置专用的重试队列：

```php
// config/queue.php
<?php

return [
    'connections' => [
        'sqs' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => env('SQS_QUEUE', 'default'),
            'suffix' => env('SQS_SUFFIX'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'group' => env('SQS_GROUP'),
            'after_commit' => false,
        ],

        // 专用的重试队列 - 优先级更高
        'sqs-retry' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => 'retry',
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => false,
        ],

        // 死信队列 - 多次重试失败后进入
        'sqs-dead-letter' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => 'dead-letter',
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => false,
        ],
    ],
];
```

SQS 队列配置中启用死信队列：

```bash
# 创建 SQS 队列并配置死信队列
aws sqs create-queue --queue-name laravel-default --attributes '{
  "VisibilityTimeout": "180",
  "MessageRetentionPeriod": "1209600",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:123456789:laravel-dead-letter\",\"maxReceiveCount\":5}"
}'

aws sqs create-queue --queue-name laravel-retry --attributes '{
  "VisibilityTimeout": "60",
  "DelaySeconds": "0",
  "MessageRetentionPeriod": "86400"
}'

aws sqs create-queue --queue-name laravel-dead-letter --attributes '{
  "MessageRetentionPeriod": "1209600"
}'
```

### 6.4 任务幂等性改造

Spot 中断可能导致任务被执行两次（Worker 在标记完成前被中断），因此任务的幂等性至关重要：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProcessPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        public string $paymentId,
        public string $idempotencyKey  // 幂等键
    ) {}

    public function handle(): void
    {
        // 使用 Redis 分布式锁确保幂等性
        $lockKey = "payment:lock:{$this->idempotencyKey}";
        $lock = Cache::lock($lockKey, 300); // 5 分钟锁

        if (!$lock->get()) {
            Log::info("Payment {$this->paymentId} already being processed, skipping", [
                'idempotency_key' => $this->idempotencyKey,
            ]);
            return;
        }

        try {
            // 检查是否已经处理过
            $existing = DB::table('payment_logs')
                ->where('idempotency_key', $this->idempotencyKey)
                ->where('status', 'completed')
                ->first();

            if ($existing) {
                Log::info("Payment {$this->paymentId} already completed, skipping");
                return;
            }

            // 处理支付逻辑
            DB::transaction(function () {
                // 业务逻辑...
                
                // 记录处理日志（幂等标记）
                DB::table('payment_logs')->updateOrInsert(
                    ['idempotency_key' => $this->idempotencyKey],
                    [
                        'payment_id' => $this->paymentId,
                        'status' => 'completed',
                        'processed_at' => now(),
                        'worker_host' => gethostname(),
                    ]
                );
            });

        } finally {
            $lock->release();
        }
    }
}
```

---

## 第七章：混合调度策略设计

### 7.1 On-Demand + Spot + Reserved 三层架构

一个成熟的 Spot 实践不是"全量使用 Spot"，而是根据工作负载特点设计合理的混合比例：

```
┌────────────────────────────────────────────────────────────────────┐
│                   混合调度架构图                                     │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    流量入口 (ALB/NLB)                        │  │
│  └───────────────┬─────────────────────┬───────────────────────┘  │
│                  │                     │                           │
│         ┌────────▼────────┐   ┌────────▼────────┐                 │
│         │  Web 层 (请求)   │   │  Worker 层      │                 │
│         │                 │   │  (异步任务)      │                 │
│         └────────┬────────┘   └────────┬────────┘                 │
│                  │                     │                           │
│  ┌───────────────┼─────────────────────┼───────────────────────┐  │
│  │               │                     │                       │  │
│  │  ┌────────────▼────────┐  ┌────────▼────────────────────┐  │  │
│  │  │  On-Demand / RI     │  │  Spot Instance              │  │  │
│  │  │  (Reserved 按年付费) │  │  (按需竞价，成本低)          │  │  │
│  │  │                     │  │                             │  │  │
│  │  │  - Web 请求处理      │  │  - 队列 Worker              │  │  │
│  │  │  - API 网关          │  │  - 定时任务                  │  │  │
│  │  │  - 核心服务          │  │  - 批处理                    │  │  │
│  │  │                     │  │  - 日志处理                  │  │  │
│  │  │  约占总容量 30%      │  │  约占总容量 70%              │  │  │
│  │  └─────────────────────┘  └─────────────────────────────┘  │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │  数据库 & 缓存层 (全部 On-Demand / RI)               │   │  │
│  │  │  - RDS MySQL / PostgreSQL (Multi-AZ)                │   │  │
│  │  │  - ElastiCache Redis (Cluster Mode)                 │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 比例设计公式

根据我们的实践，混合比例的设计需要考虑以下因素：

```python
# 混合比例计算脚本
# scripts/calculate_spot_ratio.py

"""
混合调度比例计算工具

根据以下因素计算最优的 Spot:On-Demand 比例：
1. 工作负载的可中断性
2. 预算约束
3. 中断频率
4. 任务重试能力
"""

def calculate_optimal_ratio(
    total_capacity: int,           # 总所需容量（实例数）
    interruption_rate: float,      # Spot 中断率 (0-1)
    retry_capability: int,         # 任务重试次数
    budget_constraint: float,      # 预算约束（相对 On-Demand 价格的比例）
    on_demand_price: float,        # On-Demand 单价
    spot_price: float,            # Spot 单价
) -> dict:
    """计算最优混合比例"""
    
    spot_ratio = 0.7  # 基础比例：70% Spot
    on_demand_ratio = 0.3  # 30% On-Demand
    
    # 根据中断率调整
    if interruption_rate > 0.15:
        spot_ratio -= 0.2  # 中断率太高，降低 Spot 比例
    elif interruption_rate < 0.05:
        spot_ratio += 0.1  # 中断率低，可以增加 Spot 比例
    
    # 根据重试能力调整
    if retry_capability >= 5:
        spot_ratio += 0.1  # 强重试能力，可以增加 Spot
    elif retry_capability <= 2:
        spot_ratio -= 0.1  # 重试能力弱，降低 Spot
    
    # 根据预算约束调整
    avg_spot_cost = spot_price * spot_ratio + on_demand_price * on_demand_ratio
    if avg_spot_cost > budget_constraint * on_demand_price:
        spot_ratio += 0.1  # 还有预算空间
    
    # 边界约束
    spot_ratio = max(0.3, min(0.9, spot_ratio))
    on_demand_ratio = 1 - spot_ratio
    
    spot_count = int(total_capacity * spot_ratio)
    on_demand_count = total_capacity - spot_count
    
    # 计算月度成本
    monthly_spot_cost = spot_count * spot_price * 730  # 730 小时/月
    monthly_od_cost = on_demand_count * on_demand_price * 730
    total_monthly = monthly_spot_cost + monthly_od_cost
    on_demand_monthly = total_capacity * on_demand_price * 730
    
    return {
        "spot_ratio": round(spot_ratio, 2),
        "on_demand_ratio": round(on_demand_ratio, 2),
        "spot_count": spot_count,
        "on_demand_count": on_demand_count,
        "monthly_cost": round(total_monthly, 2),
        "monthly_savings": round(on_demand_monthly - total_monthly, 2),
        "savings_percentage": round((1 - total_monthly / on_demand_monthly) * 100, 1),
    }


# 使用示例
result = calculate_optimal_ratio(
    total_capacity=10,
    interruption_rate=0.08,
    retry_capability=5,
    budget_constraint=0.5,
    on_demand_price=0.192,   # m5.xlarge On-Demand 价格
    spot_price=0.058,        # m5.xlarge 平均 Spot 价格
)

print(f"推荐比例: Spot {result['spot_ratio']*100}% / On-Demand {result['on_demand_ratio']*100}%")
print(f"Spot 实例: {result['spot_count']} 台")
print(f"On-Demand 实例: {result['on_demand_count']} 台")
print(f"月度成本: ${result['monthly_cost']}")
print(f"月度节省: ${result['monthly_savings']} ({result['savings_percentage']}%)")
```

### 7.3 K8s 中的混合调度实现

```yaml
# k8s/mixed-scheduling-config.yaml

# 方式一：使用 Deployment 副本数控制比例
---
# Web 层 - 全部 On-Demand
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-web
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: laravel-web
  template:
    metadata:
      labels:
        app: laravel-web
    spec:
      nodeSelector:
        node.kubernetes.io/capacity-type: on-demand  # 只用 On-Demand
      containers:
        - name: laravel-web
          image: laravel-app:v2.3.1
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 20

---
# 队列 Worker - 全部 Spot
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-queue-worker-spot
  namespace: production
spec:
  replicas: 8
  selector:
    matchLabels:
      app: laravel-queue-worker
      capacity-type: spot
  template:
    metadata:
      labels:
        app: laravel-queue-worker
        capacity-type: spot
    spec:
      nodeSelector:
        node.kubernetes.io/capacity-type: spot
      tolerations:
        - key: "spot"
          operator: "Equal"
          value: "true"
          effect: "PreferNoSchedule"
      containers:
        - name: worker
          image: laravel-app:v2.3.1
          command: ["php", "artisan", "queue:work-spot", "sqs", "--sleep=3", "--tries=3", "--timeout=90"]
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"

---
# 队列 Worker 备份 - On-Demand（Spot 全中断时兜底）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-queue-worker-ondemand
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: laravel-queue-worker
      capacity-type: on-demand
  template:
    metadata:
      labels:
        app: laravel-queue-worker
        capacity-type: on-demand
    spec:
      nodeSelector:
        node.kubernetes.io/capacity-type: on-demand
      containers:
        - name: worker
          image: laravel-app:v2.3.1
          command: ["php", "artisan", "queue:work-spot", "sqs", "--sleep=3", "--tries=5", "--timeout=90"]
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
```

---

## 第八章：K8s Pod 自动迁移机制

### 8.1 Spot Interruption Handler 与 PDB 配合

**PodDisruptionBudget (PDB)** 确保在节点被中断排空时，始终有足够数量的 Pod 在运行：

```yaml
# k8s/pod-disruption-budget.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: laravel-queue-worker-pdb
  namespace: production
spec:
  # 确保至少 60% 的 Pod 可用
  minAvailable: "60%"
  selector:
    matchLabels:
      app: laravel-queue-worker

---
# 更严格的 PDB - 确保至少有 N 个 Pod
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: laravel-critical-worker-pdb
  namespace: production
spec:
  # 确保至少 4 个 Pod 可用
  minAvailable: 4
  selector:
    matchLabels:
      app: laravel-critical-worker

---
# 防止同时排空太多 Pod
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: laravel-batch-pdb
  namespace: production
spec:
  maxUnavailable: 1  # 最多只有 1 个 Pod 不可用
  selector:
    matchLabels:
      app: laravel-batch-processor
```

### 8.2 自动迁移流程

当 Spot 中断发生时，完整的自动迁移流程如下：

```
┌────────────────────────────────────────────────────────────────┐
│                   Pod 自动迁移流程                               │
│                                                                │
│  1. AWS 发送 Spot 中断通知                                      │
│     │                                                          │
│  2. Node Termination Handler 检测到中断                         │
│     │                                                          │
│  3. 标记节点为 cordoned（不可调度）                               │
│     │   kubectl cordon <node>                                  │
│     │                                                          │
│  4. 检查 PDB 约束                                              │
│     │   ├── PDB 允许排空 → 继续                                │
│     │   └── PDB 不允许 → 等待其他 Pod 就绪                      │
│     │                                                          │
│  5. 驱逐 Pod                                                   │
│     │   kubectl drain <node> --ignore-daemonsets               │
│     │                                                          │
│  6. 容器内收到 SIGTERM                                          │
│     │   ├── Laravel Worker 停止拉取新任务                       │
│     │   ├── 等待当前任务完成 (最长 90s)                         │
│     │   └── 队列任务自动回滚 (visibility timeout)              │
│     │                                                          │
│  7. Karpenter / Cluster Autoscaler 创建新节点                  │
│     │                                                          │
│  8. 新 Pod 被调度到新节点                                       │
│     │                                                          │
│  9. 新 Worker 开始处理队列任务                                   │
│     │                                                          │
│  10. 原节点被 AWS 终止                                          │
│                                                                │
│  总耗时: 约 2-5 分钟                                            │
└────────────────────────────────────────────────────────────────┘
```

### 8.3 Karpenter 中断处理配置

Karpenter v0.32+ 原生支持 Spot 中断处理：

```yaml
# karpenter/interruption-handling.yaml
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: laravel-spot
spec:
  template:
    spec:
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot"]
  
  # 中断与替换配置
  disruption:
    # 空节点 30 秒后自动回收
    consolidationPolicy: WhenEmpty
    consolidateAfter: 30s
    
    # 节点 30 天后强制替换（刷新 AMI 等）
    expireAfter: 720h

    # 中断预算 - 控制同时排空的节点数
    budgets:
      # 正常情况下最多 10% 的节点可以同时排空
      - nodes: "10%"
      # 工作时间（UTC 9-17 点）更保守
      - nodes: "0"
        schedule: "0 9 * * 1-5"
        duration: 8h
      # 允许最多 1 个节点同时排空
      - nodes: "1"
```

---

## 第九章：监控与告警体系

### 9.1 Spot 中断率监控

使用 CloudWatch 监控 Spot 中断率：

```python
# monitoring/spot_metrics.py
"""
Spot Instance 监控指标收集器
定期收集 Spot 中断事件，计算中断率，并推送到 CloudWatch
"""

import boto3
from datetime import datetime, timedelta
from collections import Counter

cloudwatch = boto3.client('cloudwatch')
ec2 = boto3.client('ec2')

def publish_spot_metrics(namespace='Laravel/SpotInstance'):
    """发布 Spot 实例监控指标到 CloudWatch"""
    
    now = datetime.utcnow()
    one_hour_ago = now - timedelta(hours=1)
    
    # 获取 Spot 实例中断事件
    events = ec2.describe_spot_instance_requests(
        Filters=[
            {'Name': 'status-code', 'Values': ['instance-terminated-by-user']},
        ]
    )
    
    # 统计中断次数
    interruption_count = 0
    for request in events['SpotInstanceRequests']:
        status = request.get('Status', {})
        if status.get('Code') in ['instance-terminated-by-user', 'instance-stopped-by-user']:
            interruption_count += 1
    
    # 发送中断次数指标
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[
            {
                'MetricName': 'SpotInterruptionCount',
                'Dimensions': [
                    {'Name': 'Environment', 'Value': 'production'},
                    {'Name': 'WorkloadType', 'Value': 'queue-worker'},
                ],
                'Value': interruption_count,
                'Unit': 'Count',
                'Timestamp': now,
            },
            {
                'MetricName': 'SpotSavingsPercent',
                'Dimensions': [
                    {'Name': 'Environment', 'Value': 'production'},
                ],
                'Value': calculate_savings_percentage(),
                'Unit': 'Percent',
                'Timestamp': now,
            },
            {
                'MetricName': 'SpotWorkerAvailability',
                'Dimensions': [
                    {'Name': 'Environment', 'Value': 'production'},
                ],
                'Value': get_worker_availability(),
                'Unit': 'Percent',
                'Timestamp': now,
            },
        ]
    )

def calculate_savings_percentage() -> float:
    """计算成本节省百分比"""
    # 这里接入实际的成本计算逻辑
    # 可以使用 AWS Cost Explorer API
    return 65.0  # 示例值

def get_worker_availability() -> float:
    """获取 Worker 可用性百分比"""
    # 查询 K8s API 或 CloudWatch 指标
    return 98.5  # 示例值


if __name__ == '__main__':
    publish_spot_metrics()
```

### 9.2 Prometheus + Grafana 监控仪表盘

```yaml
# k8s/servicemonitor-spot.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: spot-metrics
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: spot-metrics-collector
  endpoints:
    - port: metrics
      interval: 30s

---
# Spot 中断事件收集器 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spot-metrics-collector
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: spot-metrics-collector
  template:
    metadata:
      labels:
        app: spot-metrics-collector
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: spot-metrics-sa
      containers:
        - name: collector
          image: spot-metrics-collector:latest
          ports:
            - containerPort: 9090
              name: metrics
          env:
            - name: AWS_REGION
              value: "us-east-1"
```

Grafana 仪表盘 JSON 配置：

```json
{
  "dashboard": {
    "title": "Spot Instance 监控仪表盘",
    "panels": [
      {
        "title": "Spot 中断率",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(spot_interruptions_total[1h]) / spot_instances_total * 100",
            "legendFormat": "中断率 %"
          }
        ],
        "thresholds": {
          "steps": [
            {"value": 0, "color": "green"},
            {"value": 10, "color": "yellow"},
            {"value": 20, "color": "red"}
          ]
        }
      },
      {
        "title": "成本节省比例",
        "type": "gauge",
        "targets": [
          {
            "expr": "(1 - spot_monthly_cost / on_demand_equivalent_cost) * 100",
            "legendFormat": "节省比例"
          }
        ],
        "max": 100
      },
      {
        "title": "Spot Worker 数量",
        "type": "timeseries",
        "targets": [
          {
            "expr": "kube_pod_status_ready{namespace='production', pod=~'laravel-queue-worker-spot.*'}",
            "legendFormat": "Spot Workers"
          },
          {
            "expr": "kube_pod_status_ready{namespace='production', pod=~'laravel-queue-worker-ondemand.*'}",
            "legendFormat": "On-Demand Workers"
          }
        ]
      },
      {
        "title": "队列积压深度",
        "type": "timeseries",
        "targets": [
          {
            "expr": "sqs_approximate_number_of_messages_visible{queue_name='laravel-default'}",
            "legendFormat": "待处理任务"
          }
        ]
      },
      {
        "title": "Spot 价格趋势",
        "type": "timeseries",
        "targets": [
          {
            "expr": "spot_price{instance_type='m5.xlarge', availability_zone='us-east-1a'}",
            "legendFormat": "m5.xlarge (AZ-a)"
          },
          {
            "expr": "spot_price{instance_type='c5.xlarge', availability_zone='us-east-1a'}",
            "legendFormat": "c5.xlarge (AZ-a)"
          }
        ]
      }
    ]
  }
}
```

### 9.3 告警规则配置

```yaml
# k8s/prometheus-rules-spot.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: spot-instance-alerts
  namespace: monitoring
spec:
  groups:
    - name: spot-instance.rules
      rules:
        # Spot 中断率过高告警
        - alert: SpotInterruptionRateHigh
          expr: |
            rate(spot_interruptions_total[1h]) > 0.2
          for: 5m
          labels:
            severity: warning
            team: backend
          annotations:
            summary: "Spot 中断率超过 20%"
            description: "过去 1 小时 Spot 中断率为 {{ $value | humanizePercentage }}，请检查是否需要增加 On-Demand 比例"

        # Spot Worker 不足告警
        - alert: SpotWorkerInsufficient
          expr: |
            count(kube_pod_status_ready{
              namespace="production",
              pod=~"laravel-queue-worker-spot.*",
              condition="true"
            }) < 4
          for: 3m
          labels:
            severity: critical
            team: backend
          annotations:
            summary: "Spot Worker 数量不足"
            description: "当前 Spot Worker 数量为 {{ $value }}，低于最低要求 4 个"

        # 队列积压告警
        - alert: QueueBacklogHigh
          expr: |
            sqs_approximate_number_of_messages_visible{queue_name="laravel-default"} > 10000
          for: 10m
          labels:
            severity: warning
            team: backend
          annotations:
            summary: "队列积压严重"
            description: "队列积压 {{ $value }} 条消息，可能需要增加 Worker 数量"

        # Spot 成本节省低于预期
        - alert: SpotSavingsLow
          expr: |
            (1 - spot_monthly_cost / on_demand_equivalent_cost) * 100 < 40
          for: 1h
          labels:
            severity: info
            team: backend
          annotations:
            summary: "Spot 成本节省低于预期"
            description: "当前成本节省仅为 {{ $value | humanizePercentage }}，低于目标 40%"
```

### 9.4 自定义 Laravel Spot 监控中间件

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;

class SpotMonitoringServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 每分钟收集 Spot 实例元数据
        $this->app->booted(function () {
            if (app()->environment('production')) {
                $this->collectSpotMetadata();
            }
        });

        // 定时上报指标
        Schedule::call(function () {
            $this->reportMetrics();
        })->everyFiveMinutes();
    }

    protected function collectSpotMetadata(): void
    {
        try {
            // 检查是否在 Spot 实例上运行
            $action = @file_get_contents(
                'http://169.254.169.254/latest/meta-data/spot/instance-action',
                false,
                stream_context_create(['http' => ['timeout' => 2]])
            );

            if ($action !== false) {
                Cache::put('spot:interruption:pending', true, 300);
                Cache::put('spot:interruption:details', json_decode($action, true), 300);
                
                // 触发中断事件
                event(new \App\Events\SpotInterruptionDetected(json_decode($action, true)));
            }

            // 收集实例类型信息
            $instanceType = @file_get_contents(
                'http://169.254.169.254/latest/meta-data/instance-type',
                false,
                stream_context_create(['http' => ['timeout' => 2]])
            );

            Cache::put('spot:instance:type', $instanceType ?: 'unknown', 3600);

        } catch (\Throwable $e) {
            // 元数据服务不可用，可能不在 EC2 上
        }
    }

    protected function reportMetrics(): void
    {
        $metrics = [
            'queue_depth' => $this->getQueueDepth(),
            'worker_count' => $this->getWorkerCount(),
            'jobs_processed' => $this->getJobsProcessed(),
            'is_spot' => Cache::get('spot:instance:type', 'unknown') !== 'unknown',
            'interruption_pending' => Cache::get('spot:interruption:pending', false),
        ];

        // 推送到 CloudWatch 或 Prometheus
        \Log::info('Spot metrics collected', $metrics);
    }

    protected function getQueueDepth(): int
    {
        // SQS 队列深度查询
        try {
            $sqs = app('aws')->createClient('sqs');
            $result = $sqs->getQueueAttributes([
                'QueueUrl' => config('queue.connections.sqs.prefix') . '/laravel-default',
                'AttributeNames' => ['ApproximateNumberOfMessages'],
            ]);
            return (int) $result['Attributes']['ApproximateNumberOfMessages'];
        } catch (\Throwable $e) {
            return -1;
        }
    }

    protected function getWorkerCount(): int
    {
        return (int) shell_exec('pgrep -c "queue:work" 2>/dev/null') ?: 0;
    }

    protected function getJobsProcessed(): int
    {
        return (int) Cache::get('stats:jobs:processed:hourly', 0);
    }
}
```

---

## 第十章：踩坑记录与实战经验

### 10.1 坑一：中断风暴（Interruption Storm）

**现象**：在某个特定时间段（如 AWS 促销季或黑色星期五），大量 Spot Instance 在短时间内被同时中断，导致队列 Worker 集群几乎全军覆没。

**根因分析**：当 AWS 的 On-Demand 需求激增时，会大规模回收 Spot 资源。如果你的 Spot Fleet 过于集中在一个实例类型或一个可用区，就很容易受到"中断风暴"的影响。

**解决方案**：

```yaml
# 防中断风暴策略一：最大程度分散实例类型和可用区
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: laravel-spot-diversified
spec:
  template:
    spec:
      requirements:
        # 至少 8 种不同的实例类型族
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: 
            - m5    # Intel 通用型
            - m5a   # AMD 通用型
            - m5d   # 带本地存储
            - m6i   # Intel 第六代
            - m6a   # AMD 第六代
            - c5    # Intel 计算优化
            - c5a   # AMD 计算优化
            - c6i   # Intel 第六代计算优化
            - r5    # Intel 内存优化
            - r5a   # AMD 内存优化
        
        # 多种实例大小
        - key: karpenter.k8s.aws/instance-size
          operator: In
          values: ["large", "xlarge", "2xlarge"]
        
        # 全部可用区
        - key: topology.kubernetes.io/zone
          operator: In
          values: 
            - us-east-1a
            - us-east-1b
            - us-east-1c
            - us-east-1d
            - us-east-1e
            - us-east-1f
```

```bash
# 防中断风暴策略二：Spot 中断率告警 + 自动切换
#!/bin/bash
# scripts/check_spot_storm.sh

THRESHOLD=5  # 5 分钟内超过 5 次中断
INTERVAL=300  # 检查间隔 5 分钟

interruption_count=$(kubectl get events --field-selector reason=SpotTermination \
  --sort-by='.lastTimestamp' | tail -n +2 | wc -l)

if [ "$interruption_count" -gt "$THRESHOLD" ]; then
    echo "Interruption storm detected! Count: $interruption_count"
    
    # 临时增加 On-Demand Worker 比例
    kubectl scale deployment laravel-queue-worker-ondemand --replicas=6 -n production
    
    # 发送告警
    aws sns publish \
      --topic-arn arn:aws:sns:us-east-1:123456789:ops-alerts \
      --message "Interruption storm detected! Scaling up On-Demand workers."
    
    # 设置冷却期标记
    kubectl create configmap spot-storm-cooldown \
      --from-literal=start=$(date +%s) \
      --from-literal=duration=3600 \
      -n production --dry-run=client -o yaml | kubectl apply -f -
fi
```

### 10.2 坑二：价格尖峰（Price Spike）

**现象**：某些热门实例类型（如 GPU 实例）的 Spot 价格偶尔会突然飙升，接近甚至超过 On-Demand 价格，导致"省钱"变成了"亏钱"。

**根因分析**：虽然 AWS 声称 Spot 价格由长期趋势决定，但某些特定实例类型在需求高峰期价格仍会大幅上涨。

**解决方案**：

```python
# monitoring/price_monitor.py
"""
Spot 价格监控器
当 Spot 价格接近 On-Demand 价格时，自动将负载迁移到 On-Demand
"""

import boto3
from datetime import datetime

ec2 = boto3.client('ec2')
asg = boto3.client('autoscaling')

PRICE_THRESHOLD_RATIO = 0.7  # Spot 价格超过 On-Demand 70% 时触发

def check_and_migrate():
    """检查 Spot 价格，必要时迁移到 On-Demand"""
    
    # 获取当前 Spot 价格
    spot_prices = ec2.describe_spot_price_history(
        InstanceTypes=['m5.xlarge', 'c5.xlarge', 'r5.xlarge'],
        ProductDescriptions=['Linux/UNIX'],
        StartTime=datetime.utcnow(),
        MaxResults=20
    )
    
    # On-Demand 价格（可以硬编码或从 API 获取）
    on_demand_prices = {
        'm5.xlarge': 0.192,
        'c5.xlarge': 0.170,
        'r5.xlarge': 0.252,
    }
    
    alerts = []
    for price_record in spot_prices['SpotPriceHistory']:
        instance_type = price_record['InstanceType']
        spot_price = float(price_record['SpotPrice'])
        od_price = on_demand_prices.get(instance_type, 0)
        
        if od_price > 0:
            ratio = spot_price / od_price
            if ratio > PRICE_THRESHOLD_RATIO:
                alerts.append({
                    'instance_type': instance_type,
                    'az': price_record['AvailabilityZone'],
                    'spot_price': spot_price,
                    'on_demand_price': od_price,
                    'ratio': ratio,
                })
    
    if alerts:
        # 触发自动迁移
        trigger_migration_to_ondemand(alerts)
        send_alert(alerts)

def trigger_migration_to_ondemand(alerts):
    """将负载从价格过高的 Spot 迁移到 On-Demand"""
    
    # K8s 中使用 node taint 标记价格过高的 Spot 节点
    # 或者通过 Karpenter NodePool 的 weight 机制调整优先级
    print(f"Price alerts triggered for {len(alerts)} instance pools")
    
    # 增加 On-Demand Worker 副本数
    # kubectl scale deployment laravel-queue-worker-ondemand --replicas=6
```

Karpenter 的权重机制也可以帮助自动选择价格更低的实例类型：

```yaml
apiVersion: karpenter.sh/v1beta1
kind: NodePool
metadata:
  name: laravel-spot-price-aware
spec:
  weight: 50  # 低权重，Karpenter 优先选择其他 NodePool
  
  template:
    spec:
      requirements:
        # 设置实例类型的优先级
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values:
            - c5a   # 通常最便宜
            - m5a   # AMD 版本通常比 Intel 便宜
            - c5
            - m5
            - m6i   # 最新代，可能较贵
```

### 10.3 坑三：可用区容量不足（Insufficient Capacity）

**现象**：某些时间段，特定可用区的 Spot 容量不足，导致新实例无法启动，Karpenter 频繁尝试创建节点但失败。

**根因分析**：某些热门可用区的容量本身就有限，再加上 On-Demand 需求增长，Spot 可用容量进一步缩减。

**解决方案**：

```yaml
# 多可用区分散配置
apiVersion: karpenter.sh/v1beta1
kind: EC2NodeClass
metadata:
  name: laravel-spot-multi-az
spec:
  # 使用多个子网（每个可用区一个）
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: "laravel-cluster"
        # Karpenter 会自动选择所有匹配的子网
        # 覆盖 us-east-1a/b/c/d/e/f
  
  # 当某个可用区容量不足时，Karpenter 自动切换到其他可用区
  # 无需额外配置，Karpenter 内置了重试和回退逻辑
```

```bash
# 手动检查各可用区的 Spot 容量可用性
aws ec2 get-spot-placement-scores \
  --instance-types m5.xlarge c5.xlarge \
  --region us-east-1 \
  --single-availability-zone \
  --target-capacity 10 \
  --query 'SpotPlacementScores[*].{AZ:AvailabilityZone,Score:Score}' \
  --output table
```

### 10.4 坑四：AMI 不兼容问题

**现象**：Spot Fleet 分配到新实例后，User Data 脚本执行失败，导致节点加入 K8s 集群失败。

**根因分析**：不同实例类型可能需要不同的内核模块、驱动程序或 AMI。例如，某些实例类型使用 NVMe 存储而不是传统的 Xen 虚拟化块设备。

**解决方案**：

```bash
#!/bin/bash
# user-data.sh - 兼容多种实例类型的初始化脚本

set -euo pipefail

# 检测实例类型并安装对应的驱动
INSTANCE_TYPE=$(curl -s http://169.254.169.254/latest/meta-data/instance-type)
INSTANCE_FAMILY=$(echo "$INSTANCE_TYPE" | cut -d'.' -f1)

echo "Detected instance type: $INSTANCE_TYPE (family: $INSTANCE_FAMILY)"

# NVMe 驱动（m5d, c5d, r5d 等带本地存储的实例）
if [[ "$INSTANCE_TYPE" =~ [0-9]d[a-z]*\.(xlarge|[0-9]*xlarge) ]]; then
    echo "Instance has NVMe local storage, installing NVMe tools..."
    apt-get install -y nvme-cli || yum install -y nvme-cli
fi

# 安装 ENA 驱动（增强网络适配器）
if [[ "$INSTANCE_FAMILY" =~ ^(c5|m5|r5|c6|m6|r6|i3) ]]; then
    echo "Modern instance family detected, enabling enhanced networking..."
    modprobe ena 2>/dev/null || true
fi

# GPU 实例驱动
if [[ "$INSTANCE_FAMILY" =~ ^(p[0-9]|g[0-9]) ]]; then
    echo "GPU instance detected, installing NVIDIA drivers..."
    apt-get install -y nvidia-driver-535 nvidia-utils-535
fi

# 挂载 NVMe 本地存储（如果有）
if ls /dev/nvme* 2>/dev/null; then
    echo "NVMe devices found, configuring local storage..."
    for nvme_dev in /dev/nvme[0-9]n[0-9]; do
        # 检查是否是本地存储（非根卷）
        if ! mount | grep -q "$nvme_dev"; then
            mkfs.ext4 "$nvme_dev" 2>/dev/null || true
            mkdir -p /mnt/local-storage
            mount "$nvme_dev" /mnt/local-storage
            chmod 1777 /mnt/local-storage
            echo "Mounted $nvme_dev to /mnt/local-storage"
        fi
    done
fi

# 安装 K8s 组件（所有实例通用）
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
apt-get update && apt-get install -y kubelet kubeadm kubectl

# 加入 K8s 集群
kubeadm join <control-plane-endpoint> --token <token> --discovery-token-ca-cert-hash <hash>
```

### 10.5 坑五：任务重复执行

**现象**：Spot 中断导致某些任务被重复执行，特别是涉及支付、通知等业务时产生了严重问题。

**根因分析**：SQS 的 Visibility Timeout 机制在 Worker 中断后会将消息重新投递，但此时 Worker 可能已经完成了部分处理（如数据库写入）但还没来得及删除消息。

**解决方案**：

```php
<?php

namespace App\Jobs;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SendOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;
    public int $timeout = 60;

    public function __construct(
        public string $orderId,
        public string $notificationId  // 唯一标识，用于幂等
    ) {}

    public function handle(): void
    {
        // 方法一：使用 Redis 锁实现幂等
        $lockKey = "notification:lock:{$this->notificationId}";
        if (!Cache::lock($lockKey, 120)->get()) {
            Log::info("Notification {$this->notificationId} already being processed");
            return;
        }

        // 方法二：使用数据库唯一约束
        try {
            DB::table('notification_logs')->insert([
                'notification_id' => $this->notificationId,
                'order_id' => $this->orderId,
                'status' => 'processing',
                'started_at' => now(),
                'worker_host' => gethostname(),
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($e->getCode() == 23000) { // 唯一约束冲突
                Log::info("Notification {$this->notificationId} already recorded");
                return;
            }
            throw $e;
        }

        try {
            // 发送通知
            $result = $this->doSendNotification();

            // 标记完成
            DB::table('notification_logs')
                ->where('notification_id', $this->notificationId)
                ->update([
                    'status' => 'completed',
                    'completed_at' => now(),
                ]);

        } catch (\Throwable $e) {
            DB::table('notification_logs')
                ->where('notification_id', $this->notificationId)
                ->update([
                    'status' => 'failed',
                    'error' => $e->getMessage(),
                    'failed_at' => now(),
                ]);
            throw $e;
        }
    }

    // 当任务最终失败时的回调
    public function failed(\Throwable $exception): void
    {
        DB::table('notification_logs')
            ->where('notification_id', $this->notificationId)
            ->update([
                'status' => 'dead_letter',
                'error' => $exception->getMessage(),
            ]);
    }
}
```

### 10.6 坑六：启动延迟过长

**现象**：Spot Instance 从请求到实例 Ready 需要 3-5 分钟，加上应用启动时间，总共需要 5-8 分钟才能开始处理任务。在中断风暴期间，队列积压可能迅速增长。

**解决方案**：

```bash
# 优化一：预烘焙 AMI（使用 EC2 Image Builder）
# 包含所有依赖项、代码和配置

# terraform/ec2-image-builder.tf
resource "aws_imagebuilder_image_pipeline" "laravel_worker" {
  name                             = "laravel-worker-pipeline"
  image_recipe_arn                 = aws_imagebuilder_image_recipe.laravel_worker.arn
  infrastructure_configuration_arn = aws_imagebuilder_infrastructure_configuration.laravel.arn

  schedule {
    schedule_expression = "cron(0 2 ? * SUN)"  # 每周日凌晨 2 点构建新镜像
  }

  image_tests_configuration {
    image_tests_enabled = true
    timeout_minutes     = 60
  }
}

resource "aws_imagebuilder_image_recipe" "laravel_worker" {
  name         = "laravel-worker-recipe"
  parent_image = "arn:aws:imagebuilder:us-east-1:aws:image/ubuntu-22.04-x86/2024.1.1"
  version      = "1.0.0"

  # 安装 PHP 和 Laravel 依赖
  component {
    component_arn = aws_imagebuilder_component.php_install.arn
  }

  # 部署应用代码
  component {
    component_arn = aws_imagebuilder_component.laravel_deploy.arn
  }

  # 优化启动速度
  component {
    component_arn = aws_imagebuilder_component.optimize_boot.arn
  }
}
```

```bash
# 优化二：使用 Karpenter 的 NodeClaim 预热
# Karpenter 支持在需求增长前提前创建节点

# 优化三：容器镜像预拉取
# 在节点启动时就拉取常用镜像
cat > /etc/systemd/system/pre-pull-images.service << 'EOF'
[Unit]
Description=Pre-pull container images
After=containerd.service
Requires=containerd.service

[Service]
Type=oneshot
ExecStart=/usr/bin/crictl pull laravel-app:v2.3.1
ExecStart=/usr/bin/crictl pull redis:7-alpine
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
EOF

systemctl enable pre-pull-images.service
```

### 10.7 坑七：网络配置不一致

**现象**：某些 Spot 实例启动后无法访问 RDS 或 Redis，但同子网的 On-Demand 实例正常。

**根因分析**：Spot Fleet 使用了不同的 Launch Template 版本，安全组或子网配置不一致。

**解决方案**：

```hcl
# 确保 Spot 和 On-Demand 使用相同的网络配置
resource "aws_launch_template" "unified" {
  name_prefix   = "laravel-unified-"
  image_id      = data.aws_ami.laravel_worker.id
  instance_type = "m5.xlarge"

  # 统一的安全组
  vpc_security_group_ids = [
    aws_security_group.laravel_worker.id,
    aws_security_group.database_access.id,
  ]

  # 统一的网络接口配置
  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.laravel_worker.id]
    subnet_id                   = null  # 由 Spot Fleet 或 Karpenter 指定
  }

  # 统一的 IAM 角色
  iam_instance_profile {
    name = aws_iam_instance_profile.laravel_worker.name
  }

  # 统一的 User Data
  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    cluster_name = var.cluster_name
    environment  = var.environment
  }))
}
```

---

## 第十一章：成本优化实战数据

### 11.1 我们的成本优化成果

经过 6 个月的 Spot 实践，以下是我们的实际成本数据：

```
┌──────────────────────────────────────────────────────────────────┐
│              成本优化实战数据（月度）                               │
├────────────────────┬──────────────┬──────────────┬──────────────┤
│                    │  优化前       │  优化后       │  节省         │
├────────────────────┼──────────────┼──────────────┼──────────────┤
│ Web 层 (On-Demand) │ $3,200       │ $3,200       │ $0           │
│ Queue Worker       │ $4,800       │ $1,440       │ $3,360 (70%) │
│ Scheduled Tasks    │ $960         │ $288         │ $672  (70%)  │
│ Batch Processing   │ $1,600       │ $320         │ $1,280 (80%) │
│ Database (RDS)     │ $2,400       │ $2,400       │ $0           │
│ Cache (Redis)      │ $800         │ $800         │ $0           │
├────────────────────┼──────────────┼──────────────┼──────────────┤
│ 合计               │ $13,760      │ $8,448       │ $5,312 (39%) │
└────────────────────┴──────────────┴──────────────┴──────────────┘
```

### 11.2 ROI 计算

```
实施成本：
- 工程师时间：约 80 人时（开发 + 测试 + 部署）
- 人力成本：约 $8,000（假设 $100/小时）

月度节省：$5,312
年度节省：$63,744

ROI = ($63,744 - $8,000) / $8,000 = 697%
回本周期：约 1.5 个月
```

---

## 第十二章：总结与最佳实践

### 12.1 核心要点总结

经过大量实践，我们将 Spot Instance 在 Laravel 项目中的使用经验总结为以下核心要点：

#### ✅ DO（推荐做法）

1. **选择正确的工作负载**：只把异步的、可重试的、无状态的工作负载放到 Spot 上。队列 Worker、定时任务、批处理是最佳候选。

2. **最大程度分散**：使用多种实例类型、多个可用区、多种实例族。不要把鸡蛋放在一个篮子里。

3. **实现幂等性**：所有运行在 Spot 上的任务必须是幂等的。Spot 中断可能导致任务部分执行后被重试。

4. **优雅关闭**：确保 Worker 收到 SIGTERM 后能正确停止当前任务，并将未完成的任务放回队列。

5. **混合策略**：Web 层和数据库使用 On-Demand/Reserved，Worker 层使用 Spot。比例建议 70% Spot + 30% On-Demand。

6. **监控先行**：在上线 Spot 之前就建立完整的监控告警体系，包括中断率、成本节省、Worker 可用性等指标。

7. **使用 Karpenter**：相比 Cluster Autoscaler，Karpenter 对 Spot 的支持更好，启动速度更快，选择更智能。

8. **预烘焙 AMI**：使用 EC2 Image Builder 或 Packer 预构建包含所有依赖的 AMI，大幅缩短实例启动时间。

#### ❌ DON'T（避免的做法）

1. **不要把有状态服务放在 Spot 上**：数据库、Session 存储、文件系统等。

2. **不要处理实时请求**：Web 请求、API 调用、WebSocket 连接等对中断零容忍的场景。

3. **不要使用单一实例类型**：避免集中使用某个热门实例类型，中断风暴时会全部受影响。

4. **不要忽略 PDB**：PodDisruptionBudget 是 K8s 环境中使用 Spot 的必备配置。

5. **不要设置过长的 Visibility Timeout**：SQS Visibility Timeout 应略大于任务最长执行时间，但不要设置太长，否则中断后其他 Worker 要等很久才能重试。

6. **不要忽略安全**：Spot Instance 同样需要正确的安全组、IAM 角色和网络配置。

### 12.2 推荐架构模板

```yaml
# 最终推荐架构
infrastructure:
  web_layer:
    instance_type: on-demand 或 reserved
    auto_scaling:
      min: 3
      max: 12
      target_cpu: 60%
    
  queue_worker_layer:
    instance_type: spot (80%) + on-demand (20%)
    auto_scaling:
      min_spot: 4
      min_on_demand: 1
      max: 20
      target_queue_depth: 1000
    
  scheduler_layer:
    instance_type: spot
    auto_scaling:
      min: 1
      max: 3
    note: "定时任务对延迟容忍度高，适合全量 Spot"
    
  batch_processing:
    instance_type: spot
    auto_scaling:
      min: 0
      max: 50
    note: "批处理按需扩缩，完全 Spot"
    
  database:
    instance_type: reserved (3年)
    multi_az: true
    
  cache:
    instance_type: reserved (1年)
    cluster_mode: true
```

### 12.3 Checklist

在将工作负载迁移到 Spot 之前，请确认以下检查项：

```
□ 工作负载评估
  □ 已识别适合 Spot 的工作负载类型
  □ 已排除不适合 Spot 的工作负载（Web、数据库等）
  □ 任务已实现幂等性
  □ 任务支持重试机制
  
□ 基础设施配置
  □ Spot Fleet / Karpenter NodePool 已配置多种实例类型
  □ 已配置多个可用区
  □ 使用 capacityOptimized 分配策略
  □ AMI 已优化（预烘焙、快速启动）
  
□ 中断处理
  □ 已部署 Node Termination Handler
  □ Supervisor 配置了 graceful shutdown
  □ SIGTERM 信号处理器已实现
  □ terminationGracePeriodSeconds 已正确设置
  
□ K8s 配置
  □ PodDisruptionBudget 已创建
  □ nodeSelector / tolerations 已配置
  □ Pod anti-affinity 已配置（分散部署）
  
□ 监控告警
  □ Spot 中断率监控
  □ Worker 可用性监控
  □ 队列积压深度监控
  □ 成本节省比例监控
  □ 告警规则已配置
  
□ 回滚方案
  □ On-Demand Worker 备份集群已就绪
  □ 自动扩容 On-Demand 的规则已配置
  □ 紧急回滚操作手册已准备
```

### 12.4 最后的话

Spot Instance 是 AWS 提供的一个非常强大的成本优化工具，但它不是银弹。成功使用 Spot 的关键在于：

1. **理解你的工作负载**：知道哪些可以中断，哪些不能。
2. **做好容错设计**：幂等性、重试机制、优雅关闭，一个都不能少。
3. **分散风险**：多种实例类型、多个可用区、混合调度。
4. **监控到位**：不监控就是盲人骑瞎马。
5. **循序渐进**：先从小规模试点开始，逐步扩大 Spot 比例。

希望这篇文章能帮助你在 Laravel 项目中成功落地 Spot Instance，在保证服务质量的同时大幅降低云计算成本。如果你有任何问题或经验分享，欢迎在评论区留言讨论。

---

> **参考资料**
>
> - [AWS Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/)
> - [AWS Node Termination Handler](https://github.com/aws/aws-node-termination-handler)
> - [Karpenter Documentation](https://karpenter.sh/docs/)
> - [Laravel Queue Documentation](https://laravel.com/docs/11.x/queues)
> - [Kubernetes Pod Disruption Budget](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)

## 相关阅读

- [FinOps 实战：AWS Cost Explorer + Kubecost 云成本治理——Laravel 微服务的按服务分摊、标签策略与预算告警](/categories/06_运维/FinOps-AWS-Cost-Explorer-Kubecost-Laravel微服务云成本治理/)
- [蓝绿部署实战：Laravel 应用零停机发布——流量切换、数据库迁移与一键回滚](/categories/06_运维/2026-06-02-蓝绿部署实战-Laravel-零停机发布-流量切换-数据库迁移与一键回滚/)
- [Railway vs Fly.io vs Render：2026 年 Laravel 应用云部署平台选型对比](/categories/06_运维/Railway-vs-Fly-io-vs-Render-2026年Laravel应用云部署平台选型对比/)
