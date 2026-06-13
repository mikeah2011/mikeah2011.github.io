---

title: Terraform 实战：Laravel 应用基础设施即代码（IaC）— 从手动点 AWS 控制台到代码化部署的踩坑记录
keywords: [Terraform, Laravel, IaC, AWS, 应用基础设施即代码, 从手动点, 控制台到代码化部署的踩坑记录]
date: 2026-06-01
categories:
- devops
tags:
- IaC
- Laravel
- AWS
- Infrastructure-as-Code
- EC2
- RDS
- S3
- VPC
description: 这篇文章系统记录如何用 Terraform 为 Laravel 应用在 AWS 上实现 IaC 落地，涵盖 VPC、EC2、RDS、S3、State 管理、模块拆分、版本锁定、资源导入与团队协作等实战细节，帮助你把基础设施即代码真正用于可复现、可审计、可扩展的生产部署。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
- /images/content/devops-01-content-1.jpg
- /images/content/devops-01-content-2.jpg
---



## 一、为什么写这篇？

### 1.1 痛点：手动在 AWS 控制台点点点

我在 KKday 的 B2C 后端团队负责 30+ Laravel 仓库，每个项目都要面对「部署基础设施」这件事。早期的做法是：

- **开发环境**：同事拿着一个 Word 文档，照着步骤在 AWS 控制台手动创建 VPC → Subnet → EC2 → RDS → S3 → Security Group...
- **Staging/Production**：运维同事在控制台操作，然后用截图记录配置，存在 Confluence 里
- **灾难恢复**：真出事的时候才发现，文档里的配置已经过期了——3 个月前有人改了 Security Group 但没更新文档

这种模式有三个致命问题：

| 问题 | 影响 | 真实案例 |
|------|------|----------|
| **配置漂移** | 环境之间不一致 | Staging 用了 db.r5.large，Production 还是 db.r4.large，但没人知道 |
| **无法复现** | 新环境搭建靠人肉 | 新开一个 Affiliate 项目，花了 2 天才搭好基础设施 |
| **变更不可追溯** | 出问题无法回滚 | 有人误删了 Nginx 的 SSL 配置，不知道谁改的、什么时候改的 |

### 1.2 Infrastructure as Code 的承诺

Terraform 的核心理念：**用代码定义基础设施，用版本控制管理变更，用 Plan 预览影响，用 Apply 自动执行**。

```
手动操作：人 → AWS 控制台 → 资源（不可追溯、不可复现）
Terraform：代码 → Plan → Apply → 资源（可追溯、可复现、可回滚）
```

---

## 二、核心概念/原理


![Terraform 核心概念 — 云基础设施架构](/images/content/devops-01-content-1.jpg)
### 2.1 Terraform 工作流

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Write HCL  │───→│  terraform   │───→│  Review      │───→│  terraform   │
│  (.tf files)│    │    plan      │    │  Changes     │    │   apply      │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                                  │
                                                          ┌───────▼───────┐
                                                          │  State File   │
                                                          │  (tfstate)    │
                                                          └───────────────┘
```

### 2.2 核心概念对照表

| 概念 | 说明 | Laravel 类比 |
|------|------|-------------|
| **Provider** | 云厂商插件（AWS/GCP/Azure） | Eloquent 的 Database Driver |
| **Resource** | 要创建的资源（EC2/RDS/S3） | Migration 里的 Schema::create |
| **Module** | 可复用的资源组合 | Service Provider / Package |
| **State** | 基础设施的当前状态记录 | 数据库里的数据 |
| **Variable** | 输入变量 | .env 配置 |
| **Output** | 输出值（如 IP、域名） | Route::get 返回值 |
| **Data Source** | 查询已有资源 | DB::table()->find() |

### 2.3 Terraform vs 其他 IaC 工具

| 特性 | Terraform | AWS CDK | CloudFormation | Pulumi |
|------|-----------|---------|----------------|--------|
| 语言 | HCL（声明式） | TypeScript/Python 等 | YAML/JSON | TypeScript/Python/Go |
| 多云支持 | ✅ 最强 | ❌ AWS Only | ❌ AWS Only | ✅ 强 |
| 学习曲线 | 中等 | 较低（你已会 TS） | 中等 | 较低 |
| 社区生态 | 最大（Registry） | 大 | 大 | 中等 |
| 状态管理 | 本地/S3/Terraform Cloud | CloudFormation | CloudFormation | Pulumi Cloud/S3 |
| 适合场景 | 多云/混合云 | AWS + TypeScript 团队 | 纯 AWS + 简单场景 | 已有 TS/Python 技能栈 |

**我们的选择**：Terraform，因为 KKday 的基础设施跨 AWS 和阿里云，Terraform 的多云支持是决定性优势。

---

## 三、实战代码


![Terraform 实战代码 — 基础设施模块化部署](/images/content/devops-01-content-2.jpg)
### 3.1 项目结构

```
terraform-laravel-infra/
├── main.tf                  # 主入口
├── variables.tf             # 变量定义
├── outputs.tf               # 输出定义
├── providers.tf             # Provider 配置
├── terraform.tfvars         # 变量值（不提交到 Git）
├── environments/
│   ├── dev.tfvars
│   ├── staging.tfvars
│   └── production.tfvars
└── modules/
    ├── vpc/                 # VPC 模块
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── ec2/                 # EC2 + Laravel 部署
    │   ├── main.tf
    │   ├── user_data.sh
    │   ├── variables.tf
    │   └── outputs.tf
    ├── rds/                 # MySQL RDS
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── s3/                  # S3 + CloudFront
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── security/            # Security Groups
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### 3.2 Provider 配置

```hcl
# providers.tf
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State 存储在 S3（团队协作必须）
  backend "s3" {
    bucket         = "kkday-terraform-state"
    key            = "laravel-b2c/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"  # 防止并发操作
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Team        = "B2C-Backend"
    }
  }
}
```

### 3.3 变量定义

```hcl
# variables.tf
variable "project_name" {
  description = "项目名称"
  type        = string
  default     = "laravel-b2c-api"
}

variable "environment" {
  description = "环境名称"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "环境必须是 dev、staging 或 production"
  }
}

variable "aws_region" {
  description = "AWS 区域"
  type        = string
  default     = "ap-southeast-1"
}

variable "db_password" {
  description = "数据库密码"
  type        = string
  sensitive   = true  # 不会在 plan/apply 输出中显示
}

variable "instance_type" {
  description = "EC2 实例类型"
  type        = string
  default     = "t3.medium"
}

variable "db_instance_class" {
  description = "RDS 实例类型"
  type        = string
  default     = "db.t3.medium"
}
```

```hcl
# environments/production.tfvars
project_name     = "laravel-b2c-api"
environment      = "production"
aws_region       = "ap-southeast-1"
instance_type    = "t3.large"
db_instance_class = "db.r6g.large"
# db_password 通过 AWS Secrets Manager 或环境变量传入，不写在文件里
```

### 3.4 VPC 模块（网络基础）

```hcl
# modules/vpc/main.tf
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc"
  }
}

# 公有子组（放 ALB / NAT Gateway）
resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-${var.environment}-public-${var.availability_zones[count.index]}"
    Tier = "Public"
  }
}

# 私有子组（放 EC2 Laravel 应用 + RDS）
resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 100)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-private-${var.availability_zones[count.index]}"
    Tier = "Private"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "${var.project_name}-${var.environment}-igw"
  }
}

# NAT Gateway（让私有子网的 EC2 能访问外网，如调用第三方 API）
resource "aws_eip" "nat" {
  domain = "vpc"
  tags = {
    Name = "${var.project_name}-${var.environment}-nat-eip"
  }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "${var.project_name}-${var.environment}-nat"
  }

  depends_on = [aws_internet_gateway.main]
}

# 路由表
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-public-rt"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-private-rt"
  }
}

# 路由表关联
resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
```

### 3.5 Security Groups（安全组）

```hcl
# modules/security/main.tf

# ALB 安全组：只允许 80/443
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  vpc_id      = var.vpc_id

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

  lifecycle {
    create_before_destroy = true  # 避免更新时断服
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-alb-sg"
  }
}

# EC2 安全组：只允许来自 ALB 的流量
resource "aws_security_group" "ec2" {
  name_prefix = "${var.project_name}-${var.environment}-ec2-"
  vpc_id      = var.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description = "SSH (Bastion Only)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.bastion_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ec2-sg"
  }
}

# RDS 安全组：只允许来自 EC2 的 3306
resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-${var.environment}-rds-"
  vpc_id      = var.vpc_id

  ingress {
    description     = "MySQL from EC2"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-rds-sg"
  }
}
```

### 3.6 RDS MySQL（数据库）

```hcl
# modules/rds/main.tf

# DB 子网组（必须跨至少 2 个 AZ）
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.project_name}-${var.environment}-db-subnet"
  }
}

# RDS 参数组
resource "aws_db_parameter_group" "mysql8" {
  name_prefix = "${var.project_name}-${var.environment}-mysql8-"
  family      = "mysql8.0"
  description = "Custom MySQL 8.0 parameter group for Laravel"

  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }

  parameter {
    name  = "collation_server"
    value = "utf8mb4_unicode_ci"
  }

  parameter {
    name  = "slow_query_log"
    value = "1"
  }

  parameter {
    name  = "long_query_time"
    value = "1"  # 超过 1 秒的查询记录到慢查询日志
  }

  parameter {
    name  = "innodb_buffer_pool_size"
    value = "{DBInstanceClassMemory*3/4}"  # 75% 内存给 InnoDB
  }

  lifecycle {
    create_before_destroy = true
  }
}

# RDS 实例
resource "aws_db_instance" "main" {
  identifier = "${var.project_name}-${var.environment}"

  engine               = "mysql"
  engine_version       = "8.0"
  instance_class       = var.db_instance_class
  allocated_storage    = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage  # 自动扩容
  storage_type         = "gp3"
  storage_encrypted    = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = var.rds_security_group_ids
  parameter_group_name   = aws_db_parameter_group.mysql8.name

  multi_az            = var.multi_az            # Production: true
  publicly_accessible = false
  skip_final_snapshot = var.environment == "dev" ? true : false
  final_snapshot_identifier = var.environment == "dev" ? null : "${var.project_name}-${var.environment}-final"

  backup_retention_period = var.environment == "production" ? 30 : 7
  backup_window          = "03:00-04:00"       # UTC，对应新加坡 11:00-12:00
  maintenance_window     = "Mon:04:00-Mon:05:00"

  deletion_protection = var.environment == "production" ? true : false

  tags = {
    Name = "${var.project_name}-${var.environment}-rds"
  }
}
```

### 3.7 EC2 + Laravel 部署

```hcl
# modules/ec2/main.tf

# 最新 Amazon Linux 2023 AMI
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# IAM Role（让 EC2 能访问 S3、SSM、CloudWatch）
resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy_attachment" "s3_access" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"  # 生产环境建议缩小范围
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# Launch Template（推荐方式，替代直接创建 EC2）
resource "aws_launch_template" "laravel" {
  name_prefix   = "${var.project_name}-${var.environment}-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.instance_type
  key_name      = var.key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  vpc_security_group_ids = var.ec2_security_group_ids

  # User Data：自动安装 PHP + Nginx + Laravel
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    db_host     = var.db_host
    db_name     = var.db_name
    db_username = var.db_username
    db_password = var.db_password
    app_env     = var.environment
    app_url     = var.app_url
    s3_bucket   = var.s3_bucket
    aws_region  = var.aws_region
  }))

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = var.environment == "production" ? 100 : 30
      volume_type = "gp3"
      encrypted   = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-${var.environment}-ec2"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "laravel" {
  name                = "${var.project_name}-${var.environment}-asg"
  desired_capacity    = var.desired_capacity
  max_size            = var.max_capacity
  min_size            = var.min_capacity
  vpc_zone_identifier = var.private_subnet_ids
  target_group_arns   = [var.alb_target_group_arn]
  health_check_type   = "ELB"

  launch_template {
    id      = aws_launch_template.laravel.id
    version = "$Latest"
  }

  # 实例刷新策略（零停机部署）
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-${var.environment}-ec2"
    propagate_at_launch = true
  }
}
```

### 3.8 User Data 脚本（自动部署 Laravel）

```bash
#!/bin/bash
# modules/ec2/user_data.sh
set -euo pipefail

# ========== 系统更新 ==========
dnf update -y
dnf install -y nginx php8.2-fpm php8.2-mysqlnd php8.2-xml php8.2-mbstring \
  php8.2-curl php8.2-zip php8.2-gd php8.2-intl php8.2-bcmath php8.2-redis \
  php8.2-opcache php8.2-pdo mysql unzip

# ========== PHP-FPM 配置 ==========
cat > /etc/php-fpm.d/www.conf <<'PHPCONF'
[www]
user = nginx
group = nginx
listen = /run/php-fpm/www.sock
listen.owner = nginx
listen.group = nginx
pm = dynamic
pm.max_children = 50
pm.start_servers = 5
pm.min_spare_servers = 5
pm.max_spare_servers = 35
pm.max_requests = 500
PHPCONF

systemctl enable php-fpm nginx
systemctl start php-fpm

# ========== Composer ==========
curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# ========== Nginx 配置 ==========
cat > /etc/nginx/conf.d/laravel.conf <<'NGINX'
server {
    listen 80;
    server_name _;
    root /var/www/laravel/public;
    index index.php;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php-fpm/www.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

# ========== 拉取代码 ==========
mkdir -p /var/www/laravel
cd /var/www/laravel

# 从 S3 或 Git 拉取代码（这里用 S3 示例）
aws s3 cp s3://${s3_bucket}/releases/latest.tar.gz /tmp/latest.tar.gz
tar -xzf /tmp/latest.tar.gz -C /var/www/laravel

# ========== Laravel 配置 ==========
cat > /var/www/laravel/.env <<ENV
APP_NAME="Laravel B2C API"
APP_ENV=${app_env}
APP_KEY=
APP_DEBUG=$([ "${app_env}" = "production" ] && echo "false" || echo "true")
APP_URL=${app_url}

DB_CONNECTION=mysql
DB_HOST=${db_host}
DB_PORT=3306
DB_DATABASE=${db_name}
DB_USERNAME=${db_username}
DB_PASSWORD=${db_password}

CACHE_STORE=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

FILESYSTEM_DISK=s3
AWS_DEFAULT_REGION=${aws_region}
AWS_BUCKET=${s3_bucket}

LOG_CHANNEL=stack
LOG_LEVEL=$([ "${app_env}" = "production" ] && echo "error" || echo "debug")
ENV

# ========== Laravel 初始化 ==========
composer install --no-dev --optimize-autoloader
php artisan key:generate
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan storage:link

chown -R nginx:nginx /var/www/laravel
chmod -R 755 /var/www/laravel/storage
chmod -R 755 /var/www/laravel/bootstrap/cache

# ========== OPcache 预热 ==========
php artisan opcache:clear 2>/dev/null || true

# ========== 启动 Nginx ==========
systemctl start nginx

# ========== CloudWatch Agent ==========
dnf install -y amazon-cloudwatch-agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<CW
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/www/laravel/storage/logs/laravel.log",
            "log_group_name": "/aws/ec2/${app_env}/laravel",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
CW
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json
```

### 3.9 主入口文件（组合所有模块）

```hcl
# main.tf
module "vpc" {
  source = "./modules/vpc"

  project_name     = var.project_name
  environment      = var.environment
  vpc_cidr         = "10.0.0.0/16"
  availability_zones = ["ap-southeast-1a", "ap-southeast-1b"]
}

module "security" {
  source = "./modules/security"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  bastion_cidr = "10.0.0.0/16"  # 限制 SSH 只能从 VPC 内部
}

module "rds" {
  source = "./modules/rds"

  project_name          = var.project_name
  environment           = var.environment
  private_subnet_ids    = module.vpc.private_subnet_ids
  rds_security_group_ids = [module.security.rds_security_group_id]
  db_instance_class     = var.db_instance_class
  db_name               = "laravel_b2c"
  db_username           = "laravel"
  db_password           = var.db_password
  allocated_storage     = var.environment == "production" ? 100 : 20
  max_allocated_storage = var.environment == "production" ? 500 : 50
  multi_az              = var.environment == "production"
}

module "s3" {
  source = "./modules/s3"

  project_name = var.project_name
  environment  = var.environment
}

module "ec2" {
  source = "./modules/ec2"

  project_name          = var.project_name
  environment           = var.environment
  instance_type         = var.instance_type
  private_subnet_ids    = module.vpc.private_subnet_ids
  ec2_security_group_ids = [module.security.ec2_security_group_id]
  alb_target_group_arn  = module.alb.target_group_arn
  key_name              = var.key_name
  db_host               = module.rds.endpoint
  db_name               = "laravel_b2c"
  db_username           = "laravel"
  db_password           = var.db_password
  app_url               = var.environment == "production" ? "https://api.kkday.com" : "https://${var.environment}.api.kkday.com"
  s3_bucket             = module.s3.bucket_name
  aws_region            = var.aws_region
  desired_capacity      = var.environment == "production" ? 2 : 1
  max_capacity          = var.environment == "production" ? 6 : 2
  min_capacity          = var.environment == "production" ? 2 : 1
}
```

### 3.10 输出

```hcl
# outputs.tf
output "alb_dns" {
  description = "ALB DNS 名称"
  value       = module.alb.dns_name
}

output "rds_endpoint" {
  description = "RDS 连接端点"
  value       = module.rds.endpoint
  sensitive   = true
}

output "s3_bucket" {
  description = "S3 存储桶名称"
  value       = module.s3.bucket_name
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}
```

### 3.10.1 完整可运行的模块接口示例

上面展示了核心资源，但如果你真的想把这套配置 `terraform init && terraform plan` 跑起来，模块的 `variables.tf` 与 `outputs.tf` 也必须补齐。很多教程只贴 `main.tf`，结果读者复制后第一步就卡在「变量未声明」或「output 不存在」。下面我把关键模块接口也补完整。

```hcl
# modules/vpc/variables.tf
variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "availability_zones" {
  type = list(string)
}
```

```hcl
# modules/vpc/outputs.tf
output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}
```

```hcl
# modules/security/variables.tf
variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "bastion_cidr" {
  type = string
}
```

```hcl
# modules/security/outputs.tf
output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ec2_security_group_id" {
  value = aws_security_group.ec2.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}
```

```hcl
# modules/rds/variables.tf
variable "project_name" { type = string }
variable "environment" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "rds_security_group_ids" { type = list(string) }
variable "db_instance_class" { type = string }
variable "db_name" { type = string }
variable "db_username" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "allocated_storage" { type = number }
variable "max_allocated_storage" { type = number }
variable "multi_az" { type = bool }
```

```hcl
# modules/rds/outputs.tf
output "endpoint" {
  value     = aws_db_instance.main.address
  sensitive = true
}

output "port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}
```

```hcl
# modules/s3/main.tf
resource "aws_s3_bucket" "assets" {
  bucket = "${var.project_name}-${var.environment}-assets"
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

```hcl
# modules/s3/variables.tf
variable "project_name" { type = string }
variable "environment" { type = string }
```

```hcl
# modules/s3/outputs.tf
output "bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.assets.arn
}
```

```hcl
# modules/ec2/variables.tf
variable "project_name" { type = string }
variable "environment" { type = string }
variable "instance_type" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "ec2_security_group_ids" { type = list(string) }
variable "alb_target_group_arn" { type = string }
variable "key_name" { type = string }
variable "db_host" { type = string }
variable "db_name" { type = string }
variable "db_username" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "app_url" { type = string }
variable "s3_bucket" { type = string }
variable "aws_region" { type = string }
variable "desired_capacity" { type = number }
variable "max_capacity" { type = number }
variable "min_capacity" { type = number }
```

```hcl
# modules/ec2/outputs.tf
output "launch_template_id" {
  value = aws_launch_template.laravel.id
}

output "autoscaling_group_name" {
  value = aws_autoscaling_group.laravel.name
}
```

如果你是第一次做模块拆分，我强烈建议遵循一个原则：**模块只暴露必要的输入输出，不要把内部实现细节泄漏到 root module**。例如 root module 只关心 `module.rds.endpoint`，而不应该依赖 `aws_db_instance.main.resource_id` 这种内部字段，否则后续重构模块时会非常痛苦。

### 3.10.2 补齐 ALB 模块，避免示例“看得懂却跑不起来”

前面的 `main.tf` 实际引用了 `module.alb.target_group_arn` 与 `module.alb.dns_name`，但如果文章里不把 ALB 模块补出来，这份代码其实并不完整。下面给出一个最小但可用的 ALB 模块示例：

```hcl
# modules/alb/main.tf
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "laravel" {
  name     = "${var.project_name}-${var.environment}-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.laravel.arn
  }
}
```

```hcl
# modules/alb/variables.tf
variable "project_name" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
```

```hcl
# modules/alb/outputs.tf
output "dns_name" {
  value = aws_lb.main.dns_name
}

output "target_group_arn" {
  value = aws_lb_target_group.laravel.arn
}
```

然后 root module 要记得补上：

```hcl
module "alb" {
  source = "./modules/alb"

  project_name          = var.project_name
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  public_subnet_ids     = module.vpc.public_subnet_ids
  alb_security_group_id = module.security.alb_security_group_id
}
```

这样一来，整篇文章里的引用关系才真正闭环。对我来说，这也是写 Terraform 教程时最容易忽略的一点：**示例不是能“看”，而是最好能“跑”**。

### 3.11 常用命令

```bash
# 初始化（拉取 Provider）
terraform init

# 格式化代码
terraform fmt -recursive

# 校验语法
terraform validate

# 预览变更（生产环境必看！）
terraform plan -var-file="environments/production.tfvars"

# 应用变更
terraform apply -var-file="environments/production.tfvars"

# 查看当前状态
terraform state list
terraform state show aws_db_instance.main

# 导入已有资源（从手动管理迁移到 Terraform）
terraform import aws_instance.existing i-0123456789abcdef0

# 销毁所有资源（仅限开发环境！）
terraform destroy -var-file="environments/dev.tfvars"
```

---

## 四、踩坑记录（真实踩坑）

### 踩坑 1：State 文件冲突——两个人同时 apply

**场景**：运维同事 A 在改 Security Group，开发同事 B 同时在改 RDS 规格。两人都执行了 `terraform apply`，后执行的人覆盖了前一个人的变更。

**解决**：使用 DynamoDB 做 State Locking。

```hcl
# 先创建 DynamoDB 表
resource "aws_dynamodb_table" "terraform_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# backend 配置里加上
backend "s3" {
  bucket         = "kkday-terraform-state"
  key            = "laravel-b2c/terraform.tfstate"
  region         = "ap-southeast-1"
  encrypt        = true
  dynamodb_table = "terraform-state-lock"
}
```

**教训**：任何团队使用 Terraform 的第一天就要配好 State Locking。

### 踩坑 2：User Data 脚本报错但 EC2 状态显示 running

**场景**：EC2 启动了，但 Laravel 没有正常部署。查看 EC2 状态显示 `running`，但实际上 User Data 脚本在第 15 行就失败了。

**排查**：

```bash
# SSH 进去查看日志
cat /var/log/cloud-init-output.log

# 或者通过 SSM Session Manager（不需要 SSH key）
aws ssm start-session --target i-0123456789abcdef0
cat /var/log/cloud-init-output.log
```

**根因**：User Data 脚本没有 `set -euo pipefail`，某个命令失败后继续执行，导致后续步骤全部出错。

**解决**：在脚本开头加上 `set -euo pipefail`，并为每个关键步骤加日志。

### 踩坑 3：修改 RDS 参数组导致数据库重启

**场景**：修改了 `innodb_buffer_pool_size` 参数，Terraform 执行了 `apply`，但没注意到这个参数需要重启数据库。Production 数据库突然重启，API 全部 502。

**教训**：

```hcl
# 对于需要重启的参数，使用 apply_method = "pending-reboot"
parameter {
  name         = "innodb_buffer_pool_size"
  value        = "{DBInstanceClassMemory*3/4}"
  apply_method = "pending-reboot"  # 不会立即重启，等维护窗口
}
```

**操作规范**：修改 RDS 相关资源前，必须 `terraform plan` 仔细检查是否有 `force destroy` 或 `replace` 标记。

### 踩坑 4：Security Group 规则循环依赖

**场景**：ALB 允许来自 EC2 的健康检查，EC2 允许来自 ALB 的流量。创建时无法确定先后顺序。

**解决**：分开创建 Security Group，再用 `aws_security_group_rule` 单独添加规则。

```hcl
# 先创建空的 Security Group
resource "aws_security_group" "alb" {
  name_prefix = "alb-"
  vpc_id      = var.vpc_id
}

resource "aws_security_group" "ec2" {
  name_prefix = "ec2-"
  vpc_id      = var.vpc_id
}

# 再单独添加规则（避免循环依赖）
resource "aws_security_group_rule" "ec2_from_alb" {
  type                     = "ingress"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.ec2.id
}
```

### 踩坑 5：terraform destroy 误删生产资源

**场景**：新人在开发环境调试，但 `tfvars` 文件选错了，执行了 `terraform destroy -var-file="environments/production.tfvars"`，Production RDS 被删除。

**防护措施**：

```hcl
# 1. Production 资源开启删除保护
resource "aws_db_instance" "main" {
  deletion_protection = var.environment == "production" ? true : false
}

# 2. 在 CI/CD 中禁止 destroy 操作
# GitHub Actions 示例
# - name: Terraform Destroy
#   if: github.ref == 'refs/heads/dev'  # 只允许 dev 分支执行 destroy
#   run: terraform destroy -auto-approve

# 3. State 文件定期备份
# S3 版本控制已开启，即使误删也能恢复
```

### 踩坑 6：Provider 版本没锁，团队电脑一升级全员计划漂移

**场景**：同样一份代码，我的电脑 `terraform plan` 只显示 tag 更新，同事的电脑却显示 `aws_db_instance` 要被 replace。最后发现不是代码有问题，而是有人执行 `terraform init -upgrade` 后把 AWS Provider 从 `5.31` 升到 `5.58`，某些字段默认值解释发生变化。

**解决方式**：

1. 在 `required_providers` 明确约束版本范围。
2. 把 `.terraform.lock.hcl` 提交到 Git，让团队和 CI 使用同一组 provider 校验值。
3. 升级 provider 时单独开 PR，不要混在业务资源调整里。

```hcl
terraform {
  required_version = "~> 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.58.0"
    }
  }
}
```

```bash
# 只在升级 Provider 的专门 PR 中执行
terraform init -upgrade
git add .terraform.lock.hcl
```

**教训**：如果不锁版本，Terraform 的“可重复”只是假象。尤其是团队协作、CI/CD、跨环境部署时，版本漂移会让 `plan` 结果失去可信度。

### 踩坑 7：Import 旧资源时地址写错，状态和现实世界对不上

**场景**：团队从“手动点 AWS 控制台”迁移到 Terraform 时，很多资源已经在线上跑了半年，不能直接删掉重建。于是第一步通常是 `terraform import`。问题是 import 最容易出错的不是命令本身，而是**资源地址、模块路径、配置参数必须和真实资源完全对应**。

例如你想把已有的 S3 bucket 导入模块：

```bash
terraform import module.s3.aws_s3_bucket.assets laravel-b2c-production-assets
```

导入成功后不要急着庆祝，下一步必须立刻执行：

```bash
terraform plan
```

如果 `plan` 还显示要新建、替换或删除该 bucket，说明你虽然把资源导入了 state，但 HCL 定义和线上真实配置仍然不一致。常见遗漏包括：

- bucket versioning 没写
- encryption 配置没补
- tag 不一致
- `force_destroy` 与线上行为不符
- bucket policy / public access block 是在别处手动创建的

我后来采用的迁移步骤是：

1. 先在 AWS 控制台或 CLI 把现有资源属性完整盘点出来。
2. 写出尽量贴近真实配置的 HCL。
3. 执行 `terraform import`。
4. 反复 `terraform plan`，直到变更收敛为 0 或只剩你预期的调整。

**教训**：`import` 不是迁移结束，而是迁移开始。真正耗时的是把“线上现实”翻译成“Terraform 代码”。

### 踩坑 8：把 secret 写进 tfvars，State 也会跟着泄漏

很多 Laravel 团队第一次接 Terraform，最自然的做法是把 `db_password`、`APP_KEY`、第三方 API key 全塞进 `terraform.tfvars`。问题是即使你把 `tfvars` 排除在 Git 之外，只要这个值被传给资源属性，它通常仍会出现在 state 中。也就是说，**真正需要保护的不只是 tfvars，而是 state、CI 日志、输出值和运行权限**。

更安全的做法是：

- Terraform 只创建 Secrets Manager Secret 或 SSM Parameter
- 应用实例在启动时再读取 secret
- output 避免直接暴露敏感值
- S3 backend 开启加密与最小权限访问

```hcl
resource "aws_secretsmanager_secret" "db_password" {
  name = "${var.project_name}/${var.environment}/db_password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}
```

在 EC2 user data 或应用启动流程中，再用 IAM Role 去读取 secret，而不是把数据库密码原样展开进模板。这样做虽然多一步，但能显著降低“配置正确却泄密”的风险。

---

## 五、对比/选型建议

### 5.1 Terraform vs CloudFormation vs Pulumi

很多人一开始选 IaC 工具，只会问“哪一个最流行”。但在真实项目里，更应该问的是：**团队会不会长期维护、是否支持现有技术栈、出了问题谁来排查、与现有云平台绑定多深**。下面这张表是我在 Laravel 团队里最常用的选型视角。

| 维度 | Terraform | CloudFormation | Pulumi |
|------|-----------|----------------|--------|
| 定义方式 | HCL 声明式 | YAML / JSON 声明式 | TypeScript / Python / Go / C# |
| 云平台支持 | 多云最强 | AWS 原生 | 多云较强 |
| 状态管理 | S3 / Terraform Cloud / 本地 | AWS 托管 Stack State | Pulumi Cloud / 自管后端 |
| 资源生态 | Provider 最丰富 | AWS 最完整、最快支持新服务 | 依赖 provider 与 SDK |
| 学习门槛 | 中等，需要理解 HCL / state | 中等，模板较冗长 | 对开发者友好，但要懂工程化 |
| 团队协作 | 成熟，PR 看 plan 很直观 | 与 AWS 深度整合 | 代码灵活，但 review 成本更高 |
| 适合 Laravel 团队 | 很适合基础设施标准化 | 适合纯 AWS 且平台团队主导 | 适合强工程团队、偏代码驱动 |
| 典型风险 | state 管理复杂度较高 | 模板冗长、可读性一般 | 容易把 IaC 写成“复杂程序” |

我的经验很直接：

- **Terraform**：最像“团队标准件”，适合把 VPC、EC2、RDS、S3 做成跨项目复用模块。
- **CloudFormation**：如果你 100% 绑定 AWS，而且平台团队已经围绕 Stack、Change Set、IAM 做了治理，它并不差，只是开发者体验没那么友好。
- **Pulumi**：对高级工程团队很有吸引力，特别是你想用 TypeScript/Python 抽象复杂逻辑时，但也更容易过度设计。

对大多数 Laravel 业务团队来说，优先级通常不是“表达能力最强”，而是“谁能稳定落地、低摩擦协作、快速接入 CI/CD”。在这一点上，Terraform 仍然是我最推荐的起点。

### 5.2 Terraform vs AWS CDK

| 维度 | Terraform | AWS CDK |
|------|-----------|---------|
| 适合团队 | 运维/SRE 主导 | 开发主导 |
| 多云需求 | 强需求 | 不需要 |
| 学习成本 | 需要学 HCL | 用已有的 TypeScript/Python |
| 状态管理 | 自己管（S3） | CloudFormation 自动管 |
| 适合场景 | 复杂多环境基础设施 | 纯 AWS + 开发者自助 |

### 5.3 我的选型建议

| 场景 | 推荐工具 | 理由 |
|------|----------|------|
| 多云部署（AWS + 阿里云） | **Terraform** | 唯一真正的多云 IaC |
| 纯 AWS + TypeScript 团队 | AWS CDK | 开发者体验最好 |
| 纯 AWS + 简单架构 | CloudFormation | 无需额外工具 |
| 想用 Python/Go 管理基础设施 | Pulumi | 支持真正的编程语言 |
| Laravel 项目刚起步 | **先用 Terraform** | 生态最大，遇到问题容易找到答案 |

---

## 六、总结与最佳实践

### 6.1 核心原则

1. **一切基础设施皆代码**：不手动改 AWS 控制台，所有变更走 Terraform PR → Review → Apply 流程
2. **State 是命根子**：S3 存储 + DynamoDB Lock + 版本控制，定期备份
3. **环境用 tfvars 隔离**：dev/staging/production 用不同的变量文件，不用不同的代码
4. **模块化复用**：VPC、EC2、RDS、S3 各自独立模块，跨项目复用
5. **Plan 是安全阀**：生产环境 apply 前必须看 plan，设置 `required_reviewers`

### 6.2 安全最佳实践

- **敏感信息**：db_password 用 AWS Secrets Manager 或环境变量传入，**绝不写在 tfvars 里提交到 Git**
- **最小权限**：EC2 IAM Role 只给需要的权限，不用 `AmazonS3FullAccess`
- **加密**：RDS Storage Encrypted = true，S3 默认加密，EBS 加密
- **网络隔离**：数据库在私有子网，只允许 EC2 Security Group 访问

### 6.3 CI/CD 集成

```yaml
# .github/workflows/terraform.yml
name: Terraform
on:
  pull_request:
    branches: [main]

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: terraform init

      - name: Terraform Plan
        run: terraform plan -var-file="environments/${{ github.event.pull_request.base.ref }}.tfvars" -out=tfplan
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Comment Plan on PR
        uses: actions/github-script@v7
        with:
          script: |
            const { execSync } = require('child_process');
            const plan = execSync('terraform show -no-color tfplan').toString();
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Terraform Plan\n\`\`\`\n${plan.substring(0, 60000)}\n\`\`\``
            });
```

### 6.4 Laravel 开发者的 IaC 上手路径

```
Week 1: 学会 terraform init/plan/apply，用官方 Example 创建一个 EC2
Week 2: 为你的 Laravel 项目搭建完整的 VPC + EC2 + RDS + S3
Week 3: 写成 Module，支持 dev/staging/production 三个环境
Week 4: 接入 CI/CD，PR 自动跑 Plan，merge 后自动 Apply
Month 2: 引入 Auto Scaling、CloudWatch 告警、SNS 通知
Month 3: 考虑用 Terragrunt 管理多环境、多项目
```

---

> **一句话总结**：Terraform 让「搭基础设施」从「人肉操作 AWS 控制台」变成了「写代码 + Code Review + 自动部署」。对于 Laravel B2C 后端开发者来说，这是从 Developer 向 DevOps 进化的关键一步。别再手动点控制台了——**把你的基础设施写成代码吧**。

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理](/categories/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [GitHub Actions 自定义 Action 开发实战](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [GitHub Actions 矩阵策略实战](/categories/07_CICD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)
- [Dagger 实战](/categories/07_CICD/Dagger-实战-用代码定义CICD流水线-Go-SDK驱动的可移植Pipeline与GitHub-Actions选型对比/)
