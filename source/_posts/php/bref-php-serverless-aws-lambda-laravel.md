---
title: Bref 实战：PHP Serverless 框架——AWS Lambda 上运行 Laravel 的无服务器工程化方案
date: 2026-06-03 09:00:00
tags: [Bref, Serverless, AWS-Lambda, PHP, Laravel, 无服务器]
keywords: [Bref, PHP Serverless, AWS Lambda, Laravel, 上运行, 的无服务器工程化方案, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "Bref 是让 PHP 运行在 AWS Lambda 上的开源框架，本文深入实战 Bref + Laravel 的无服务器部署全流程。涵盖 Lambda 运行时原理、冷启动优化、RDS Proxy 数据库连接池、SQS 队列异步处理、S3 文件存储、CloudWatch 监控告警、成本估算与优化策略。对比传统 EC2 部署方案，提供 serverless.yml 完整配置模板和 CI/CD 集成方案，帮助 PHP 团队低成本拥抱 Serverless 架构。"
---


# Bref 实战：PHP Serverless 框架——AWS Lambda 上运行 Laravel 的无服务器工程化方案

## 一、Serverless 对 PHP 的意义

Serverless（无服务器）并不意味着没有服务器——而是开发者不再需要管理服务器。你只需上传代码，云平台负责运行、扩缩、高可用。

### 1.1 传统部署 vs Serverless

```
传统部署（EC2/ECS）：
┌─────────────────────────────────────────────┐
│  购买服务器 → 安装环境 → 部署代码 → 配置    │
│  Nginx → 配置 PHP-FPM → 配置 Supervisor    │
│  → 监控 → 扩缩容 → 安全补丁 → 日志管理     │
│                                              │
│  运维负担：████████████████████ 90%         │
│  业务开发：████ 10%                          │
└─────────────────────────────────────────────┘

Serverless（Lambda）：
┌─────────────────────────────────────────────┐
│  编写代码 → 上传 → 自动运行                  │
│                                              │
│  运维负担：██ 10%                            │
│  业务开发：████████████████████ 90%          │
└─────────────────────────────────────────────┘
```

### 1.2 PHP Serverless 的挑战

PHP 天生不是为 Serverless 设计的：

1. **冷启动慢**：每次调用需要启动 PHP 解释器 + 加载框架
2. **无状态**：Lambda 函数执行完即销毁，无法保持连接
3. **文件系统只读**：Lambda 只有 /tmp 可写（512MB）
4. **执行时间限制**：最大 15 分钟
5. **包大小限制**：部署包 250MB（解压后）

### 1.3 Bref 如何解决这些问题

Bref（法语"简单"的意思）是一个开源项目，它为 AWS Lambda 提供了 PHP 运行时（Layer），让 PHP 应用可以无缝运行在 Lambda 上。

```
┌──────────────────────────────────────────────────┐
│                Bref 架构                          │
├──────────────────────────────────────────────────┤
│                                                   │
│  开发者                                           │
│    │                                              │
│    ▼                                              │
│  serverless.yml（声明式配置）                     │
│    │                                              │
│    ▼                                              │
│  Serverless Framework（部署工具）                 │
│    │                                              │
│    ▼                                              │
│  AWS CloudFormation（基础设施编排）               │
│    ├── API Gateway（HTTP 入口）                  │
│    ├── Lambda 函数（PHP Runtime via Bref Layer） │
│    ├── S3（静态资源/部署包）                     │
│    ├── CloudWatch（日志/监控）                   │
│    └── IAM（权限管理）                           │
│                                                   │
└──────────────────────────────────────────────────┘
```

## 二、Bref 架构与原理

### 2.1 PHP Lambda Layer

Bref 的核心是为 AWS Lambda 提供了 PHP 运行时层（Layer）：

```
┌──────────────────────────────────────────┐
│         Lambda 执行环境                   │
├──────────────────────────────────────────┤
│                                           │
│  ┌──────────────────────────────────┐    │
│  │  Bref PHP Layer                  │    │
│  │  ┌────────────────────────────┐  │    │
│  │  │  PHP 8.3 (CLI/FPM)        │  │    │
│  │  │  + 扩展：pdo_mysql, redis, │  │    │
│  │  │    opcache, mbstring, ...  │  │    │
│  │  └────────────────────────────┘  │    │
│  │  ┌────────────────────────────┐  │    │
│  │  │  Bref Runtime (bootstrap) │  │    │
│  │  │  - 事件转换               │  │    │
│  │  │  - 响应格式化             │  │    │
│  │  │  - 错误处理               │  │    │
│  │  └────────────────────────────┘  │    │
│  └──────────────────────────────────┘    │
│                                           │
│  ┌──────────────────────────────────┐    │
│  │  应用代码（vendor + src）        │    │
│  └──────────────────────────────────┘    │
│                                           │
│  ┌──────────────────────────────────┐    │
│  │  Lambda Runtime API              │    │
│  │  (与 AWS 通信)                   │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### 2.2 Bref Layer 类型

| Layer | 用途 | PHP 模式 |
|-------|------|---------|
| `php-83` | CLI 任务（Artisan/Queue） | CLI |
| `php-83-fpm` | HTTP 请求处理 | FPM |
| `php-83-console` | 控制台命令 | CLI |

## 三、安装与项目初始化

### 3.1 创建新项目

```bash
# 方法 1：从模板创建
composer create-project --prefer-dist bref/laravel my-serverless-app
cd my-serverless-app

# 方法 2：在现有 Laravel 项目中集成
cd my-laravel-app
composer require bref/bref bref/laravel-bridge
php artisan vendor:publish --tag=bref-config
```

### 3.2 安装 Serverless Framework

```bash
# 安装 Node.js（如果没有）
# brew install node

# 安装 Serverless Framework
npm install -g serverless

# 配置 AWS 凭据
aws configure
# AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name: ap-northeast-1
# Default output format: json
```

## 四、serverless.yml 配置详解

### 4.1 完整配置示例

```yaml
# serverless.yml
service: my-laravel-app

provider:
  name: aws
  region: ap-northeast-1
  runtime: provided.al2023
  memorySize: 512
  timeout: 28
  stage: ${opt:stage, 'production'}

  # 环境变量
  environment:
    APP_ENV: production
    APP_KEY: ${ssm:/myapp/${self:provider.stage}/APP_KEY}
    APP_DEBUG: 'false'
    LOG_CHANNEL: stderr
    SESSION_DRIVER: dynamodb
    CACHE_STORE: dynamodb
    QUEUE_CONNECTION: sqs
    DB_HOST: ${ssm:/myapp/${self:provider.stage}/DB_HOST}
    DB_DATABASE: ${ssm:/myapp/${self:provider.stage}/DB_DATABASE}
    DB_USERNAME: ${ssm:/myapp/${self:provider.stage}/DB_USERNAME}
    DB_PASSWORD: ${ssm:/myapp/${self:provider.stage}/DB_PASSWORD}
    AWS_BUCKET: ${self:custom.assetsBucket}

  # IAM 权限
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - s3:GetObject
            - s3:PutObject
            - s3:DeleteObject
          Resource: "arn:aws:s3:::${self:custom.assetsBucket}/*"
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:GetItem
            - dynamodb:DeleteItem
            - dynamodb:Scan
            - dynamodb:Query
            - dynamodb:UpdateItem
          Resource:
            - !GetAtt SessionsTable.Arn
            - !GetAtt CacheTable.Arn
        - Effect: Allow
          Action:
            - sqs:SendMessage
            - sqs:ReceiveMessage
            - sqs:DeleteMessage
            - sqs:GetQueueAttributes
          Resource: !GetAtt Queue.Arn

# Bref 插件
plugins:
  - ./vendor/bref/bref

package:
  patterns:
    - '!node_modules/**'
    - '!tests/**'
    - '!resources/js/**'
    - '!resources/sass/**'
    - '!storage/**'
    - '!docker/**'
    - '!.env*'
    - '!*.md'

functions:
  # === HTTP 函数（Web 请求） ===
  web:
    handler: public/index.php
    description: Laravel HTTP handler
    layers:
      - ${bref:layer.php-83-fpm}
    events:
      - httpApi: '*'  # HTTP API (v2)

  # === Artisan 命令 ===
  artisan:
    handler: artisan
    description: Laravel Artisan command
    layers:
      - ${bref:layer.php-83}
    events:
      - httpApi:
          path: /artisan/{command}
          method: POST
      # 也可以直接通过 CLI 调用
      # serverless invoke -f artisan --data '{"cli": "migrate --force"}'

  # === Queue Worker ===
  queue:
    handler: artisan
    description: Laravel Queue Worker
    timeout: 510  # 最大超时
    layers:
      - ${bref:layer.php-83}
    events:
      - sqs:
          arn: !GetAtt Queue.Arn
          batchSize: 1
          maximumBatchingWindow: 5
    reservedConcurrency: 10  # 最大并发 worker 数

  # === 定时任务（Scheduler） ===
  scheduler:
    handler: artisan
    description: Laravel Scheduler
    layers:
      - ${bref:layer.php-83}
    events:
      - schedule:
          rate: rate(1 minute)
          input:
            cli: "schedule:run"

# 自定义资源
custom:
  assetsBucket: ${self:service}-${self:provider.stage}-assets

resources:
  Resources:
    # DynamoDB Sessions 表
    SessionsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:service}-${self:provider.stage}-sessions
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: id
            AttributeType: S
        KeySchema:
          - AttributeName: id
            KeyType: HASH
        TimeToLiveSpecification:
          AttributeName: ttl
          Enabled: true

    # DynamoDB Cache 表
    CacheTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:service}-${self:provider.stage}-cache
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: key
            AttributeType: S
        KeySchema:
          - AttributeName: key
            KeyType: HASH
        TimeToLiveSpecification:
          AttributeName: ttl
          Enabled: true

    # SQS 队列
    Queue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-${self:provider.stage}-queue
        VisibilityTimeout: 600
        MessageRetentionPeriod: 1209600  # 14 days
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt DeadLetterQueue.Arn
          maxReceiveCount: 3

    # 死信队列
    DeadLetterQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-${self:provider.stage}-dead-letters
        MessageRetentionPeriod: 1209600

    # S3 静态资源桶
    AssetsBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:custom.assetsBucket}
        CorsConfiguration:
          CorsRules:
            - AllowedHeaders: ['*']
              AllowedMethods: [GET, HEAD]
              AllowedOrigins: ['*']
              MaxAge: 3600

    # CloudFront 分发（CDN）
    CDN:
      Type: AWS::CloudFront::Distribution
      Properties:
        DistributionConfig:
          Origins:
            - DomainName: !GetAtt AssetsBucket.DomainName
              Id: S3Origin
              S3OriginConfig:
                OriginAccessIdentity: !Sub "origin-access-identity/cloudfront/${CDNIdentity}"
          DefaultCacheBehavior:
            TargetOriginId: S3Origin
            ViewerProtocolPolicy: redirect-to-https
            CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6  # CachingOptimized
          Enabled: true

  Outputs:
    ApiUrl:
      Description: API Gateway URL
      Value: !Sub "https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com"
```

### 4.2 配置分环境

```yaml
# serverless.yml - 多环境配置
custom:
  stages:
    production:
      memorySize: 1024
      timeout: 28
      reservedConcurrency: 100
    staging:
      memorySize: 512
      timeout: 28
      reservedConcurrency: 10

provider:
  memorySize: ${self:custom.stages.${self:provider.stage}.memorySize, 512}
  timeout: ${self:custom.stages.${self:provider.stage}.timeout, 28}
```

## 五、HTTP/API/Queue Worker/Artisan 函数类型

### 5.1 HTTP 函数

HTTP 函数是最常用的，它处理所有 Web 请求：

```php
<?php
// public/index.php（Bref 入口）

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$response = $kernel->handle(
    $request = Illuminate\Http\Request::capture()
);

$response->send();

$kernel->terminate($request, $response);
```

Bref 的 FPM Layer 会自动将 Lambda 事件转换为 PHP-FPM 请求，应用代码完全不需要修改。

### 5.2 Queue Worker 函数

```php
<?php
// app/Jobs/ProcessOrder.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 60;
    public int $timeout = 300; // Lambda 最大 510s

    public function __construct(
        public int $orderId
    ) {}

    public function handle(): void
    {
        $order = \App\Models\Order::findOrFail($this->orderId);

        // 处理订单逻辑
        $order->update(['status' => 'processing']);

        // 调用支付网关
        $paymentResult = $this->processPayment($order);

        if ($paymentResult->isSuccessful()) {
            $order->update(['status' => 'paid']);
            Log::info("Order {$this->orderId} processed successfully");
        } else {
            $this->fail(new \RuntimeException("Payment failed for order {$this->orderId}"));
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("Order processing failed", [
            'order_id' => $this->orderId,
            'error' => $exception->getMessage(),
        ]);

        \App\Models\Order::where('id', $this->orderId)
            ->update(['status' => 'failed']);
    }

    private function processPayment($order): object
    {
        // 支付处理逻辑
        return (object) ['isSuccessful' => true];
    }
}
```

### 5.3 Artisan 命令函数

```bash
# 本地调用 Artisan 命令
serverless invoke -f artisan --data '{"cli": "migrate --force"}'
serverless invoke -f artisan --data '{"cli": "cache:clear"}'
serverless invoke -f artisan --data '{"cli": "db:seed --class=ProductionSeeder"}'

# 通过 HTTP 调用（需要认证）
curl -X POST https://api.example.com/artisan/migrate \
  -H "Authorization: Bearer ${TOKEN}"
```

## 六、Laravel Vapor vs Bref 对比

### 6.1 Vapor 简介

Laravel Vapor 是 Taylor Otwell 官方出品的 Serverless 部署平台，它提供了一个漂亮的 Dashboard 和简化的部署体验。

### 6.2 功能对比

| 特性 | Bref | Laravel Vapor |
|------|------|--------------|
| 价格 | 免费（开源） | $39/月/项目 |
| AWS 账户 | 自己管理 | 需要授权 Vapor |
| 部署方式 | Serverless Framework | Vapor CLI |
| Dashboard | 无（用 CloudWatch） | ✅ 漂亮的 Web UI |
| 队列管理 | 手动配置 SQS | ✅ 内置管理 |
| 缓存/Session | 手动配置 DynamoDB | ✅ 自动配置 |
| 自定义域名 | 手动配置 | ✅ 一键配置 |
| 数据库 | 手动配置 RDS | ✅ 内置 RDS Proxy |
| 日志 | CloudWatch | ✅ Vapor Dashboard |
| 监控 | CloudWatch | ✅ 内置监控 |
| 灵活性 | 高（完全控制） | 中（受平台限制） |
| 学习曲线 | 中 | 低 |
| 社区支持 | 活跃 | 官方支持 |

### 6.3 选择建议

```
选 Bref 如果：
├─ 你想完全控制 AWS 资源
├─ 预算有限（不想付 $39/月）
├─ 需要自定义 Lambda 配置
├─ 已经有 AWS 运维经验
└─ 需要多云支持

选 Vapor 如果：
├─ 你想最快上手
├─ 不想管理 AWS 基础设施
├─ 需要漂亮的 Dashboard
├─ 团队没有 AWS 经验
└─ 预算不是问题
```

## 七、文件存储（S3/Redis Session）

### 7.1 S3 文件存储

```php
<?php
// config/filesystems.php

return [
    'default' => env('FILESYSTEM_DISK', 's3'),

    'disks' => [
        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // 本地临时存储（Lambda /tmp）
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'throw' => false,
        ],

        // Lambda 临时目录
        'tmp' => [
            'driver' => 'local',
            'root' => '/tmp',
            'throw' => false,
        ],
    ],
];
```

```php
<?php
// 文件上传控制器

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        $request->validate([
            'file' => 'required|file|max:10240', // 10MB
        ]);

        $file = $request->file('file');
        $path = $file->store('uploads/' . date('Y/m'), 's3');

        // 生成临时 URL（有效期 1 小时）
        $temporaryUrl = Storage::disk('s3')->temporaryUrl(
            $path,
            now()->addHour()
        );

        return response()->json([
            'path' => $path,
            'url' => $temporaryUrl,
            'size' => $file->getSize(),
        ]);
    }

    public function download(string $path)
    {
        // 重定向到 S3 临时 URL
        $temporaryUrl = Storage::disk('s3')->temporaryUrl(
            $path,
            now()->addMinutes(5)
        );

        return redirect($temporaryUrl);
    }
}
```

### 7.2 DynamoDB Session

```php
<?php
// config/session.php

return [
    'driver' => env('SESSION_DRIVER', 'dynamodb'),
    'lifetime' => 120,
    'expire_on_close' => false,

    'dynamodb' => [
        'table' => env('DYNAMODB_SESSION_TABLE', 'sessions'),
        'connection' => null,
        'endpoint' => env('DYNAMODB_ENDPOINT'),
        'attributes' => [
            'key' => 'id',
            'last_activity' => 'last_activity',
            'user_id' => 'user_id',
        ],
    ],
];
```

```php
<?php
// config/cache.php

return [
    'default' => env('CACHE_STORE', 'dynamodb'),

    'stores' => [
        'dynamodb' => [
            'driver' => 'dynamodb',
            'table' => env('DYNAMODB_CACHE_TABLE', 'cache'),
            'connection' => null,
            'endpoint' => env('DYNAMODB_ENDPOINT'),
        ],

        // Redis（如果需要通过 ElastiCache）
        'redis' => [
            'driver' => 'redis',
            'connection' => 'cache',
            'lock_connection' => 'default',
        ],
    ],
];
```

## 八、数据库连接（RDS Proxy）

### 8.1 连接池问题

Lambda 的并发可能瞬间创建数百个实例，每个实例都需要数据库连接。传统 RDS 有最大连接数限制（通常 100-500），很容易被打满。

```
问题：
  Lambda 并发 1000 → 每个 1 个连接 → 1000 个连接 → RDS 爆了！

解决方案：RDS Proxy
  Lambda 并发 1000 → RDS Proxy（连接池） → RDS（50 个连接）
```

### 8.2 RDS Proxy 配置

```yaml
# serverless.yml 中添加 RDS Proxy
resources:
  Resources:
    # RDS Proxy
    DBProxy:
      Type: AWS::RDS::DBProxy
      Properties:
        DBProxyName: ${self:service}-${self:provider.stage}-proxy
        EngineFamily: MYSQL
        RoleArn: !GetAtt DBProxyRole.Arn
        Auth:
          - AuthScheme: SECRETS
            IAMAuth: DISABLED
            SecretArn: !Ref DBSecret
        VpcSubnetIds:
          - subnet-xxxxxx
          - subnet-yyyyyy
        VpcSecurityGroupIds:
          - sg-xxxxxx
        RequireTLS: true
        MaxConnectionsPercent: 90
        MaxIdleConnectionsPercent: 50

    # RDS Proxy 目标组
    DBProxyTargetGroup:
      Type: AWS::RDS::DBProxyTargetGroup
      Properties:
        DBProxyName: !Ref DBProxy
        TargetGroupName: default
        DBInstanceIdentifiers:
          - !Ref DBInstance
        ConnectionPoolConfigurationInfo:
          MaxConnectionsPercent: 90
          MaxIdleConnectionsPercent: 50
          ConnectionBorrowTimeout: 120
          SessionPinningFilters: []
```

### 8.3 Laravel 数据库配置

```php
<?php
// config/database.php

return [
    'connections' => [
        'mysql' => [
            'driver' => 'mysql',
            'host' => env('DB_HOST'),  // RDS Proxy endpoint
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE'),
            'username' => env('DB_USERNAME'),
            'password' => env('DB_PASSWORD'),
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'prefix_indexes' => true,
            'strict' => true,
            'engine' => null,

            // Lambda 优化
            'options' => array_filter([
                PDO::ATTR_PERSISTENT => false,  // Lambda 不支持持久连接
                PDO::ATTR_TIMEOUT => 5,
            ]),
        ],
    ],
];
```

## 九、冷启动优化策略

### 9.1 冷启动分析

```
Lambda 冷启动组成：
┌───────────────────────────────────────────┐
│ 1. 容器启动          │ ~100-200ms        │
│ 2. 下载代码包        │ ~200-500ms        │
│ 3. PHP 解释器启动    │ ~50-100ms         │
│ 4. 加载扩展          │ ~100-300ms        │
│ 5. Composer autoload │ ~50-100ms         │
│ 6. 框架初始化        │ ~200-500ms        │
│ 7. 路由解析          │ ~50-100ms         │
│ 8. 首次请求处理      │ ~100-300ms        │
├───────────────────────────────────────────┤
│ 总计                 │ ~850-2100ms       │
└───────────────────────────────────────────┘
```

### 9.2 优化策略

```yaml
# 1. 使用 ARM64 架构（Graviton2，更快更便宜）
provider:
  architecture: arm64
  runtime: provided.al2023

# 2. 减小部署包大小
package:
  patterns:
    - '!node_modules/**'
    - '!tests/**'
    - '!resources/js/**'
    - '!resources/sass/**'
    - '!.git/**'
    - '!docker/**'
    - '!*.md'

# 3. Provisioned Concurrency（预热实例）
functions:
  web:
    handler: public/index.php
    layers:
      - ${bref:layer.php-83-fpm}
    provisionedConcurrency: 5  # 始终保持 5 个预热实例
```

```php
<?php
// 4. 精简 Composer autoload
// composer.json
{
    "autoload": {
        "classmap": [
            "database/seeders",
            "database/factories"
        ],
        "psr-4": {
            "App\\": "app/"
        },
        "files": []
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true
    },
    "scripts": {
        "post-autoload-dump": [
            "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
            "@php artisan package:discover --ansi"
        ]
    }
}
```

```php
<?php
// 5. 使用 OPcache（Bref Layer 已内置）
// php/conf.d/bref.ini
opcache.enable=1
opcache.memory_consumption=128
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=10000
opcache.validate_timestamps=0  // 生产环境禁用文件检查
opcache.save_comments=1
opcache.fast_shutdown=1
```

### 9.3 冷启动基准测试

```
优化前 vs 优化后：

┌────────────────────────┬──────────┬──────────┐
│ 配置                   │ 冷启动   │ 热调用   │
├────────────────────────┼──────────┼──────────┤
│ 默认（x86, 512MB）     │ 2100ms   │ 80ms     │
│ ARM64 + 512MB          │ 1500ms   │ 65ms     │
│ ARM64 + 1024MB         │ 1100ms   │ 45ms     │
│ ARM64 + 1024MB + 精简  │ 850ms    │ 35ms     │
│ + Provisioned (5)      │ 0ms*     │ 30ms     │
└────────────────────────┴──────────┴──────────┘
* Provisioned Concurrency 消除冷启动
```

## 十、本地测试

### 10.1 Bref Dev Server

```bash
# 安装 bref/dev-server
composer require --dev bref/dev-server

# 启动本地开发服务器
vendor/bin/bref dev

# 访问 http://localhost:8000
```

### 10.2 SAM 本地测试

```bash
# 安装 AWS SAM CLI
brew install aws-sam-cli

# 构建
sam build

# 本地调用
sam local invoke web --event events/http.json

# 本地 API 网关
sam local start-api
# 访问 http://localhost:3000
```

### 10.3 Docker 本地测试

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.lambda
    ports:
      - "9000:8080"
    environment:
      - APP_ENV=local
      - DB_HOST=mysql
      - DB_DATABASE=laravel
      - DB_USERNAME=root
      - DB_PASSWORD=secret
    volumes:
      - .:/var/task

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: laravel
    ports:
      - "3306:3306"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  # DynamoDB Local（模拟 DynamoDB）
  dynamodb:
    image: amazon/dynamodb-local
    ports:
      - "8000:8000"
    command: "-jar DynamoDBLocal.jar -sharedDb"

  # SQS Local（模拟 SQS）
  elasticmq:
    image: softwaremill/elasticmq
    ports:
      - "9324:9324"
```

```bash
# 使用 Docker 模拟 Lambda 运行
docker run --rm -it \
  -v $(pwd):/var/task \
  -v $(pwd)/vendor/bref/bref/layers:/opt \
  -p 9000:8080 \
  public.ecr.aws/lambda/provided:al2023 \
  public/index.php
```

## 十一、CI/CD 部署流水线

### 11.1 GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS Lambda

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: testing
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql, pdo_mysql
          coverage: none

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Run tests
        run: php artisan test
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: testing
          DB_USERNAME: root
          DB_PASSWORD: password

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'

      - name: Install dependencies
        run: |
          composer install --no-dev --optimize-autoloader --no-interaction
          npm ci
          npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1

      - name: Install Serverless Framework
        run: npm install -g serverless

      - name: Deploy
        run: serverless deploy --stage production --verbose

      - name: Run migrations
        run: serverless invoke -f artisan --data '{"cli": "migrate --force"}' --stage production

      - name: Clear cache
        run: serverless invoke -f artisan --data '{"cli": "cache:clear"}' --stage production
```

## 十二、成本分析与适用场景

### 12.1 成本对比

```
场景：月均 100 万次请求，平均每次 200ms，512MB 内存

EC2 (t3.medium)：
  实例费用：$30.37/月
  数据传输：~$5/月
  ALB：~$16/月
  总计：~$51/月

Lambda (Bref)：
  请求数费用：1,000,000 × $0.20/百万 = $0.20
  计算时间：1,000,000 × 0.2s × 512MB = 100,000 GB-秒
  费用：100,000 × $0.0000166667 = $1.67
  API Gateway：1,000,000 × $1.00/百万 = $1.00
  总计：~$2.87/月

Vapor (Laravel Vapor)：
  平台费：$39/月
  Lambda 费用：~$2.87/月
  总计：~$41.87/月
```

```
成本与请求量关系：

请求量        EC2        Lambda     Lambda+Provisioned
10万/月       $51        $0.3       $50+
100万/月      $51        $2.87      $55+
1000万/月     $150       $28.7      $120+
1亿/月        $500       $287       $350+
```

### 12.2 适用场景

```
✅ 适合 Serverless 的场景：
├─ API 服务（请求量波动大）
├─ Webhook 处理
├─ 定时任务（Cron）
├─ 后台队列处理
├─ 内部工具/Dashboard
└─ 原型验证/MVP

❌ 不适合 Serverless 的场景：
├─ WebSocket 长连接
├─ 实时通信（游戏、聊天）
├─ 大文件处理（>512MB）
├─ 长时间运行任务（>15分钟）
├─ 需要本地文件系统持久化
└─ 稳定高并发（EC2 更便宜）
```

## 十三、生产踩坑记录

### 13.1 常见问题与解决方案

```
问题 1：冷启动超时
  症状：首次请求返回 502
  原因：PHP 框架初始化超过 28 秒
  解决：
    - 使用 Provisioned Concurrency
    - 精简 Composer autoload
    - 减少服务提供者

问题 2：文件上传失败
  症状：上传大文件返回 413
  原因：API Gateway 有 10MB 限制
  解决：
    - 使用 S3 Presigned URL 直传
    - 分片上传

问题 3：数据库连接超时
  症状：间歇性数据库连接失败
  原因：Lambda 并发过高，RDS 连接数打满
  解决：
    - 使用 RDS Proxy
    - 降低 Lambda reservedConcurrency

问题 4：/tmp 空间不足
  症状：写入 /tmp 报错
  原因：Lambda /tmp 默认 512MB
  解决：
    - 配置 ephemeralStorageSize（最大 10GB）
    - 使用 S3 存储临时文件

问题 5：队列任务重复执行
  症状：同一任务执行多次
  原因：Lambda 超时导致 SQS 重试
  解决：
    - 增加 Lambda timeout
    - 设置 SQS VisibilityTimeout > Lambda timeout
    - 实现幂等性
```

### 13.2 监控与告警

```yaml
# serverless.yml - CloudWatch 告警
resources:
  Resources:
    # Lambda 错误率告警
    LambdaErrorAlarm:
      Type: AWS::CloudWatch::Alarm
      Properties:
        AlarmName: ${self:service}-${self:provider.stage}-errors
        MetricName: Errors
        Namespace: AWS/Lambda
        Statistic: Sum
        Period: 300
        EvaluationPeriods: 1
        Threshold: 5
        ComparisonOperator: GreaterThanThreshold
        Dimensions:
          - Name: FunctionName
            Value: !Ref WebLambdaFunction
        AlarmActions:
          - !Ref AlertSNSTopic

    # Lambda 超时告警
    LambdaDurationAlarm:
      Type: AWS::CloudWatch::Alarm
      Properties:
        AlarmName: ${self:service}-${self:provider.stage}-duration
        MetricName: Duration
        Namespace: AWS/Lambda
        Statistic: Average
        Period: 300
        EvaluationPeriods: 2
        Threshold: 20000  # 20 秒
        ComparisonOperator: GreaterThanThreshold
        Dimensions:
          - Name: FunctionName
            Value: !Ref WebLambdaFunction
        AlarmActions:
          - !Ref AlertSNSTopic

    # SNS 通知主题
    AlertSNSTopic:
      Type: AWS::SNS::Topic
      Properties:
        TopicName: ${self:service}-${self:provider.stage}-alerts
        Subscription:
          - Protocol: email
            Endpoint: alerts@example.com
```

## 总结

Bref 让 PHP 拥抱 Serverless 变得简单而实用。对于 Laravel 应用来说：

1. **小项目/原型**：Bref 免费方案，成本极低（月均 < $5）
2. **中型项目**：Bref + RDS Proxy + DynamoDB，成本可控
3. **追求体验**：Laravel Vapor，省心但需要付费

Serverless 不是银弹，但对于 **请求量波动大、不需要长连接、想减少运维负担** 的项目，Bref + AWS Lambda 是一个非常有吸引力的选择。

> 下一篇文章我们将探讨如何使用 Laravel Vapor 实现更高级的 Serverless 部署，包括蓝绿部署、灰度发布和多区域部署。

## 相关阅读

- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 进程模型与选型决策](/categories/PHP/Laravel/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策/)
- [PHP Fiber 深度实战：协程调度器与 Swoole/Octane 底层原理](/categories/PHP/Laravel/2026-06-02-php-fiber-deep-dive-coroutine-scheduler-swoole-octane-internals/)
- [FrankenPHP 实战：Go 驱动的 PHP 应用服务器——替代 PHP-FPM 的现代部署方案与 Laravel 集成](/categories/运维/2026-06-03-FrankenPHP-实战-Go驱动的PHP应用服务器-替代PHP-FPM与Laravel集成/)
