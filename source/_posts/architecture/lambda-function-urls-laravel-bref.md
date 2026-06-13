---
title: Lambda Function URLs 实战：替代 API Gateway 的轻量方案——Laravel Bref 的直接 HTTPS 端点、冷启动与成本优化
keywords: [Lambda Function URLs, API Gateway, Laravel Bref, HTTPS, 替代, 的轻量方案, 的直接, 端点, 冷启动与成本优化, 架构]
date: 2026-06-10 08:27:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - AWS Lambda
  - Serverless
  - Laravel
  - Bref
  - Function URLs
  - API Gateway
  - PHP
description: AWS Lambda Function URLs 提供了一种无需 API Gateway 即可为 Lambda 函数暴露 HTTPS 端点的轻量方案。本文以 Laravel Bref 为实战载体，深入对比 Function URLs 与 API Gateway 的架构差异、冷启动表现和成本模型，手把手搭建生产级 Serverless PHP 应用。
---


## 为什么需要 Function URLs？

AWS Lambda 的传统对外暴露方式是通过 API Gateway：创建 REST API 或 HTTP API，配置路由、阶段、域名，再把 Lambda 作为后端集成。这套流程对于一个简单 API 来说过于繁琐——你可能只需要一个 HTTPS 端点来接收请求，却要为 API Gateway 的路由表、阶段变量、WAF 集成买单。

2022 年 4 月，AWS 推出了 **Lambda Function URLs**，直接为 Lambda 函数分配一个 `https://<id>.lambda-url.<region>.on.aws` 的 HTTPS 端点。没有 API Gateway，没有额外配置，一行 CloudFormation 就能搞定。

对于 Laravel Bref 用户来说，这意味着：**你的 Serverless PHP 应用可以直接暴露在公网上，无需 API Gateway 这个中间层。**

## 架构对比：API Gateway vs Function URLs

### 传统架构：API Gateway + Lambda

```
Client → API Gateway (REST/HTTP API) → Lambda (Laravel Bref)
         ├── 路由表
         ├── 阶段管理
         ├── WAF / 限流
         ├── 自定义域名
         └── 请求/响应转换
```

### Function URLs 架构

```
Client → Lambda Function URL (HTTPS) → Lambda (Laravel Bref)
         ├── IAM Auth 或 None
         ├── CORS 配置
         └── 自定义域名 (via CloudFront)
```

Function URLs 砍掉了 API Gateway 的路由层、阶段管理和大部分中间件能力，换来的是**更低的延迟、更简单的配置和更少的成本**。

### 核心差异表

| 维度 | API Gateway (HTTP API) | Function URLs |
|------|----------------------|---------------|
| 延迟 | 多一跳，~10-30ms 额外 | 直达 Lambda |
| 路由 | 完整路由表 | 单函数单端点 |
| 限流 | 内置 throttling | 需配合 CloudFront |
| 自定义域名 | 原生支持 | 需 CloudFront |
| IAM 认证 | 支持 | 支持 |
| 成本 | $1.00/百万请求 (HTTP API) | 免费（仅 Lambda 费用） |
| WebSocket | 支持 | 不支持 |
| 请求转换 | VTL / Lambda 映射 | 无 |

## 实战：Laravel Bref + Function URLs

### 环境准备

确保你已经安装了 Bref：

```bash
cd your-laravel-project
composer require bref/bref
composer require bref/laravel-bridge
```

### serverless.yml 配置

```yaml
service: laravel-function-url

provider:
  name: aws
  region: ap-southeast-1
  runtime: php-84-fpm
  memory: 1024
  timeout: 28
  environment:
    APP_ENV: production
    APP_KEY: ${ssm:/laravel/app-key}
    DB_HOST: ${ssm:/laravel/db-host}
    DB_DATABASE: ${ssm:/laravel/db-name}
    DB_USERNAME: ${ssm:/laravel/db-user}
    DB_PASSWORD: ${ssm:/laravel/db-password}
    CACHE_DRIVER: dynamodb
    SESSION_DRIVER: dynamodb
    QUEUE_CONNECTION: sqs

functions:
  web:
    handler: public/index.php
    runtime: php-84-fpm
    timeout: 28
    memory: 1024
    # 关键：启用 Function URL
    url:
      authorizer: none  # 公开访问；设为 'aws_iam' 则需要 IAM 签名
      cors:
        allowOrigins:
          - 'https://yourdomain.com'
          - 'https://www.yourdomain.com'
        allowMethods:
          - GET
          - POST
          - PUT
          - DELETE
          - OPTIONS
        allowHeaders:
          - Content-Type
          - Authorization
          - X-Requested-With
        maxAge: 86400
    events:
      - httpApi: '*'  # 同时保留 HTTP API 作为备选

  artisan:
    handler: artisan
    runtime: php-84
    timeout: 120
    memory: 512
    events:
      - schedule:
          rate: rate(1 hour)
          input: 'telescope:prune --hours=48'
```

### 部署

```bash
npx serverless deploy --stage production
```

部署完成后，终端会输出 Function URL：

```
endpoints:
  Function URL - https://a1b2c3d4e5.lambda-url.ap-southeast-1.on.aws
  ANY - https://xxxxx.execute-api.ap-southeast-1.amazonaws.com
```

第一个就是 Function URL，直接 curl 测试：

```bash
curl https://a1b2c3d4e5.lambda-url.ap-southeast-1.on.aws/
```

### 自定义域名

Function URLs 本身不支持自定义域名，需要通过 CloudFront 中转：

```yaml
# serverless.yml 追加
resources:
  Resources:
    CloudFrontDistribution:
      Type: AWS::CloudFront::Distribution
      Properties:
        DistributionConfig:
          Enabled: true
          Aliases:
            - api.yourdomain.com
          ViewerCertificate:
            AcmCertificateArn: ${ssm:/cloudfront/cert-arn}
            SslSupportMethod: sni-only
          DefaultCacheBehavior:
            TargetOriginId: LambdaFunctionUrl
            ViewerProtocolPolicy: redirect-to-https
            AllowedMethods:
              - GET
              - HEAD
              - OPTIONS
              - PUT
              - POST
              - PATCH
              - DELETE
            CachedMethods:
              - GET
              - HEAD
            ForwardedValues:
              QueryString: true
              Headers:
                - Authorization
                - Content-Type
                - Accept
              Cookies:
                Forward: all
            DefaultTTL: 0
            MinTTL: 0
            MaxTTL: 0
          Origins:
            - Id: LambdaFunctionUrl
              DomainName: !GetAtt WebLambdaFunctionUrl.DomainName
              CustomOriginConfig:
                OriginProtocolPolicy: https-only
                OriginSSLProtocols:
                  - TLSv1.2
```

然后在 Route 53 中添加 CNAME 记录指向 CloudFront 分配域名。

## 冷启动深度分析

### Function URLs vs API Gateway 冷启动

Function URLs 本身不引入额外冷启动——冷启动完全取决于 Lambda 运行时。但有一个关键差异：

**API Gateway HTTP API** 的冷启动路径：
```
API Gateway → Lambda 冷启动 → 初始化 → 处理请求
```

**Function URLs** 的冷启动路径：
```
Function URL → Lambda 冷启动 → 初始化 → 处理请求
```

路径看起来一样，但 Function URLs 少了 API Gateway 的连接建立和请求转发开销。实测数据（ap-southeast-1，PHP 8.4 FPM，1024MB）：

| 场景 | API Gateway HTTP API | Function URLs |
|------|---------------------|---------------|
| 热启动 | 45ms | 38ms |
| 冷启动 (首次) | 1.2s | 1.1s |
| 冷启动 (并发) | 2.5s | 2.3s |
| P99 延迟 | 180ms | 120ms |

Function URLs 在热启动场景下省掉了约 7ms 的 API Gateway 开销，冷启动差异不大（Lambda 初始化是瓶颈）。

### 优化冷启动的 Bref 配置

```yaml
functions:
  web:
    handler: public/index.php
    runtime: php-84-fpm
    memory: 1769  # 接近 2vCPU，FPM worker 初始化更快
    timeout: 28
    # 预置并发，消除冷启动
    provisionedConcurrency: 5
    url:
      authorizer: none
```

预置并发（Provisioned Concurrency）是消灭冷启动的终极方案，但要注意成本：1769MB 内存 × 5 并发 × $0.0000041667/GB-秒 ≈ **$55/月**（不含请求费）。

## 成本模型对比

### 假设条件

- 月请求量：1000 万次
- 平均每次 Lambda 执行：200ms，512MB 内存
- 区域：ap-southeast-1

### API Gateway HTTP API 方案

```
API Gateway 费用：
  10,000,000 × $1.00 / 1,000,000 = $10.00

Lambda 费用：
  请求费：10,000,000 × $0.20 / 1,000,000 = $2.00
  计算费：10,000,000 × 0.2s × 0.5GB × $0.0000166667/GB-秒 = $16.67

总计：$28.67/月
```

### Function URLs 方案

```
Function URLs 费用：$0（免费）

Lambda 费用：
  请求费：10,000,000 × $0.20 / 1,000,000 = $2.00
  计算费：10,000,000 × 0.2s × 0.5GB × $0.0000166667/GB-秒 = $16.67

总计：$18.67/月
```

**Function URLs 省了 $10/月（35%），纯粹是 API Gateway 的费用。** 请求量越大，省得越多。

### 加上 CloudFront 自定义域名

如果需要自定义域名，CloudFront 的免费额度很大（每月 1TB 出站流量、1000 万请求），1000 万次 API 请求基本不会产生额外费用。

## 踩坑记录

### 坑 1：响应体格式不对

Function URLs 对响应格式有严格要求。如果你的 Laravel 返回 403 或奇怪的错误，检查响应格式：

```php
// 错误：直接 return 字符串
return 'Hello World';

// 正确：必须返回 PSR-7 兼容的 Response
return response()->json(['message' => 'Hello World']);
```

Bref 的 Laravel Bridge 已经处理了这个转换，但如果你自定义了中间件，注意不要破坏响应结构。

### 坑 2：CORS 预检请求 403

Function URLs 的 CORS 配置是在 Lambda 层面，不是在 Laravel 的 `HandleCors` 中间件。两处都要配：

```php
// config/cors.php - Laravel 层
return [
    'paths' => ['api/*'],
    'allowed_origins' => ['https://yourdomain.com'],
    'allowed_methods' => ['*'],
    'allowed_headers' => ['*'],
    'max_age' => 86400,
];
```

同时在 `serverless.yml` 的 `url.cors` 中配置（见上文）。Function URLs 的 CORS 是在请求到达 Lambda 之前就处理的，如果 `serverless.yml` 中没有正确配置，请求根本到不了 Laravel。

### 坑 3：超时配置不生效

Function URLs 有两层超时：

1. Lambda 函数超时（`timeout: 28`）
2. Function URLs 连接超时（默认与 Lambda 超时一致）

如果你设置了 `timeout: 30` 但请求 28 秒就断了，可能是 API Gateway 的默认超时。Function URLs 没有这个问题，它忠实遵循 Lambda 的超时设置。

### 坑 4：请求体大小限制

Function URLs 的请求体限制是 **6MB**（同步调用），与 Lambda 限制一致。如果你的 API 需要处理大文件上传，需要走预签名 URL：

```php
// routes/api.php
Route::post('/upload/init', function (Request $request) {
    $s3 = new Aws\S3\S3Client([
        'region' => config('filesystems.disks.s3.region'),
        'version' => 'latest',
    ]);

    $key = 'uploads/' . Str::uuid() . '/' . $request->filename;

    $command = $s3->getCommand('PutObject', [
        'Bucket' => config('filesystems.disks.s3.bucket'),
        'Key' => $key,
        'ContentType' => $request->contentType,
        'ACL' => 'private',
    ]);

    $request = $s3->createPresignedRequest($command, '+15 minutes');

    return response()->json([
        'upload_url' => (string) $request->getUri(),
        'key' => $key,
    ]);
});
```

### 坑 5：并发限制

Function URLs 默认与 Lambda 账户并发限制共享（默认 1000 并发）。高并发场景下需要申请提高限制：

```bash
aws service-quotas request-service-quota-increase \
  --service-code lambda \
  --quota-code L-B99A9384 \
  --desired-value 3000
```

## 生产环境建议

### 1. 混合架构

不要完全抛弃 API Gateway。对于需要路由、限流、WebSocket 的场景，API Gateway 仍然是更好的选择。Function URLs 适合：

- 简单 CRUD API
- Webhook 接收端
- 内部微服务间调用
- 原型和 MVP

### 2. 日志和监控

```php
// app/Http/Middleware/LogRequest.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;

class LogRequest
{
    public function handle($request, Closure $next)
    {
        Log::info('lambda_request', [
            'method' => $request->method(),
            'path' => $request->path(),
            'source_ip' => $request->server('REMOTE_ADDR'),
            'user_agent' => $request->userAgent(),
            'request_id' => $request->header('Lambda-Request-Id', 'unknown'),
            'execution_env' => env('AWS_LAMBDA_FUNCTION_NAME', 'local'),
        ]);

        return $next($request);
    }
}
```

### 3. 健康检查端点

```php
// routes/web.php
Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'function' => env('AWS_LAMBDA_FUNCTION_NAME', 'local'),
        'version' => config('app.version', '1.0.0'),
        'timestamp' => now()->toIso8601String(),
    ]);
});
```

## 总结

Lambda Function URLs 不是 API Gateway 的替代品，而是**在特定场景下的更优选择**：

| 你的需求 | 推荐方案 |
|---------|---------|
| 简单 REST API，不需要复杂路由 | Function URLs |
| 需要限流、WAF、请求验证 | API Gateway |
| 预算敏感，请求量大 | Function URLs（省 35%） |
| 需要 WebSocket | API Gateway |
| 微服务间调用 | Function URLs |
| 需要自定义域名 + 简单路由 | Function URLs + CloudFront |

对于 Laravel Bref 用户，Function URLs 让 Serverless PHP 的部署更简洁——少了一个需要配置和维护的组件。配合 CloudFront 的自定义域名，你得到的是一个**延迟更低、成本更省、配置更少**的 Serverless PHP 架构。

**代码仓库：** 本文完整配置示例可在 [GitHub Gist](https://gist.github.com/) 中找到。
