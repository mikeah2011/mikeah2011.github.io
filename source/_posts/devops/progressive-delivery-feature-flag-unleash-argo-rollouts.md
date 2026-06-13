---

title: Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 的完整工程化工作流
keywords: [Progressive Delivery, Feature Flag, Unleash, Argo Rollouts, 渐进式发布, 的完整工程化工作流, DevOps]
date: 2026-06-09 20:20:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- progressive-delivery
- Feature Flags
- unleach
- argo-rollouts
- canary
- Kubernetes
description: 以 PHP/Laravel 项目为例，完整演示如何用 Unleash 做 Feature Flag 管理，再结合 Argo Rollouts 在 Kubernetes 上实现 Canary/Beta 渐进式发布。涵盖本地开发、CI 集成、多阶段发布策略、自动回滚和真实踩坑记录，可直接落地到生产环境。
---


渐进式发布不是"上线后观察一下"，而是一套从代码提交到生产流量切换的工程化能力。它回答三个问题：**怎么小范围验证**、**怎么逐步放量**、**出问题怎么回滚**。

本文以一个 Laravel API 项目为例，手把手演示从 Feature Flag 管理（Unleash）到 Kubernetes 渐进式发布（Argo Rollouts）的完整工作流。

<!-- more -->

## 为什么需要渐进式发布

传统的发布流程是"推一把，祈祷一下"：

```
git push → CI 构建 → 部署到全部 Pod → 观察日志 → 发现问题 → 回滚
```

每一步都有风险，而且发现问题时流量已经全部切过去了。渐进式发布把"部署"拆成多个阶段：

1. **代码发布**：新版本镜像部署到少量 Pod，但不接流量
2. **流量切换**：先导 5% 流量到新版本
3. **逐步放量**：监控指标正常，逐步提升到 100%
4. **自动回滚**：任何阶段指标异常，自动切回旧版本

整个过程中，Feature Flag 控制"新功能对谁可见"，Argo Rollouts 控制"流量怎么分配"。两者配合，既有代码级别的开关，又有流量级别的控制。

## 核心架构

```
┌─────────────────────────────────────────────────────┐
│                    开发者提交代码                      │
│                       ↓                              │
│              CI 构建镜像 + 推送                       │
│                       ↓                              │
│         Argo Rollouts 检测到新镜像                    │
│                       ↓                              │
│    ┌──────────────────────────────────────────┐     │
│    │         Canary 阶段（5% 流量）            │     │
│    │   ┌─────────┐    ┌──────────────┐       │     │
│    │   │ 新 Pod   │←──│  Argo Router │←─用户─│     │
│    │   └─────────┘    │  (流量分配)   │       │     │
│    │   ┌─────────┐    └──────────────┘       │     │
│    │   │ 旧 Pod   │←─────────────────────────│     │
│    │   └─────────┘                            │     │
│    └──────────────────────────────────────────┘     │
│                       ↓                              │
│          Prom/Prometheus 自动验证指标                 │
│                       ↓                              │
│    ┌──────────────────────────────────────────┐     │
│    │      跑赢 → 放量 / 挂了 → 回滚            │     │
│    └──────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

## 实战：从零搭建

### 第一步：部署 Unleash

本地开发用 Docker Compose 最简单：

```yaml
# docker-compose.yml
version: '3.8'

services:
  unleash:
    image: unleashorg/unleash-server:5
    ports:
      - "4242:4242"
    environment:
      DATABASE_URL: postgres://unleash:unleash@postgres:5432/unleash
      DATABASE_SSL: "false"
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: unleash
      POSTGRES_USER: unleash
      POSTGRES_PASSWORD: unleash
    volumes:
      - unleash-data:/var/lib/postgresql/data

volumes:
  unleash-data:
```

```bash
docker-compose up -d
# 访问 http://localhost:4242
# 默认账号: admin / unleash4all
```

在 Unleash 中创建项目 `laravel-app`，添加 Feature Flag：

```
名称: new-checkout-flow
类型: release
启用: true
```

### 第二步：Laravel 集成 Unleash

安装官方 PHP SDK：

```bash
composer require unleash/unleash-client
```

配置 `.env`：

```env
UNLEASH_URL=http://localhost:4242/api
UNLEASH_APP_NAME=laravel-app
UNLEASH_HEADER_AUTHORIZATION=development
UNLEASH_POLLING_INTERVAL=5
```

创建配置文件：

```php
<?php
// config/unleash.php

return [
    'url' => env('UNLEASH_URL', 'http://localhost:4242/api'),
    'app_name' => env('UNLEASH_APP_NAME', 'laravel-app'),
    'header_auth' => env('UNLEASH_HEADER_AUTHORIZATION', ''),
    'polling_interval' => env('UNLEASH_POLLING_INTERVAL', 15),
    'cache' => env('UNLEASH_CACHE_DRIVER', 'file'),
    'cache_ttl' => env('UNLEASH_CACHE_TTL', 60),
];
```

创建门面 Facade 和 ServiceProvider：

```php
<?php
// app/Providers/UnleashServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Unleash\Client\Unleash;
use Unleash\Client\Configuration\UnleashConfiguration;
use Unleash\Client\UnleashClientBuilder;
use Unleash\Client\UnleashClient;

class UnleashServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Unleash::class, function () {
            $config = config('unleash');

            $configuration = UnleashConfiguration::create()
                ->setUrl($config['url'])
                ->setAppName($config['app_name'])
                ->setCustomHeaders([
                    'Authorization' => $config['header_auth'],
                ])
                ->setPollingInterval($config['polling_interval']);

            // 生产环境用 Redis 缓存
            if ($this->app->environment('production')) {
                $cacheAdapter = new \Unleash\Client\Cache\RedisCacheAdapter(
                    \Illuminate\Support\Facades\Redis::connection()->getClient()
                );
                $configuration->setCache($cacheAdapter);
            }

            return (new UnleashClientBuilder())
                ->setConfiguration($configuration)
                ->build();
        });
    }

    public function boot(): void
    {
        //
    }
}
```

注册到 `config/app.php`：

```php
'providers' => [
    // ...
    App\Providers\UnleashServiceProvider::class,
],
```

### 第三步：在代码中使用 Feature Flag

创建一个可复用的 Trait：

```php
<?php
// app/Traits/HasFeatureFlags.php

namespace App\Traits;

use Illuminate\Support\Facades\App;
use Unleash\Client\Unleash;

trait HasFeatureFlags
{
    protected function isEnabled(string $flagName, array $context = []): bool
    {
        /** @var Unleash $unleash */
        $unleash = App::make(Unleash::class);

        $context = array_merge([
            'userId' => auth()->id() ?? 'anonymous',
            'properties' => [
                'plan' => auth()->user()?->plan ?? 'free',
            ],
        ], $context);

        return $unleash->isEnabled($flagName, $context);
    }
}
```

在实际业务中使用：

```php
<?php
// app/Services/CheckoutService.php

namespace App\Services;

use App\Traits\HasFeatureFlags;

class CheckoutService
{
    use HasFeatureFlags;

    public function processCheckout(array $cartData): array
    {
        if ($this->isEnabled('new-checkout-flow')) {
            return $this->processNewCheckout($cartData);
        }

        return $this->processLegacyCheckout($cartData);
    }

    protected function processNewCheckout(array $cartData): array
    {
        // 新版结账逻辑：支持分期、优惠券叠加、地址自动补全
        $order = $this->createOrder($cartData);
        $this->applyDiscounts($order);
        $this->calculateShipping($order);

        return [
            'order_id' => $order->id,
            'version' => 'v2',
            'features' => ['installments', 'coupon_stack', 'address_autocomplete'],
        ];
    }

    protected function processLegacyCheckout(array $cartData): array
    {
        // 旧版结账逻辑
        $order = $this->createOrder($cartData);

        return [
            'order_id' => $order->id,
            'version' => 'v1',
        ];
    }

    // ... 其他方法
}
```

创建路由中间件，支持 URL 级别的 Flag 控制：

```php
<?php
// app/Http/Middleware/FeatureFlagMiddleware.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Unleash\Client\Unleash;

class FeatureFlagMiddleware
{
    public function handle(Request $request, Closure $next, string $flagName)
    {
        /** @var Unleash $unleash */
        $unleash = App::make(Unleash::class);

        if (!$unleash->isEnabled($flagName)) {
            abort(404, 'Feature not available');
        }

        // 将 flag 状态注入请求
        $request->merge(['_feature_flag_' . $flagName => true]);

        return $next($request);
    }
}
```

路由注册：

```php
// routes/web.php
Route::middleware(['feature-flag:new-checkout-flow'])->group(function () {
    Route::get('/checkout/v2', [CheckoutController::class, 'showV2']);
    Route::post('/checkout/v2/process', [CheckoutController::class, 'processV2']);
});
```

### 第四步：配置 Argo Rollouts

Argo Rollouts 是 Kubernetes 的渐进式发布控制器。先在集群中安装：

```bash
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
```

创建 Rollout 配置替代 Deployment：

```yaml
# k8s/rollout.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: laravel-app
  namespace: production
spec:
  replicas: 10
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      app: laravel-app
  template:
    metadata:
      labels:
        app: laravel-app
    spec:
      containers:
        - name: laravel
          image: registry.example.com/laravel-app:v1.0.0
          ports:
            - containerPort: 9000
          env:
            - name: APP_ENV
              value: production
            - name: UNLEASH_URL
              valueFrom:
                configMapKeyRef:
                  name: app-config
                  key: unleash-url
          readinessProbe:
            httpGet:
              path: /health
              port: 9000
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi

  strategy:
    canary:
      # Canary 阶段：5% 流量
      canaryService: laravel-canary
      stableService: laravel-stable
      trafficRouting:
        nginx:
          stableIngress: laravel-ingress
          additionalIngressAnnotations:
            canary-by-header: X-Canary
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 80
        - pause: { duration: 5m }

      # 自动回滚条件
      analysis:
        templates:
          - templateName: success-rate
        startingStep: 1
        args:
          - name: service-name
            value: laravel-canary
```

创建配套 Service：

```yaml
# k8s/services.yaml
apiVersion: v1
kind: Service
metadata:
  name: laravel-stable
  namespace: production
spec:
  selector:
    app: laravel-app
  ports:
    - port: 80
      targetPort: 9000
---
apiVersion: v1
kind: Service
metadata:
  name: laravel-canary
  namespace: production
spec:
  selector:
    app: laravel-app
  ports:
    - port: 80
      targetPort: 9000
```

### 第五步：配置自动验证指标

Argo Rollouts 支持多种分析方式。这里用 Prometheus 验证成功率：

```yaml
# k8s/analysis-template.yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
  namespace: production
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      # 最少运行 2 分钟才开始判定
      initialDelay: 2m
      interval: 1m
      # 成功率低于 95% 则失败
      failureLimit: 3
      successCondition: result[0] >= 0.95
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(
              http_requests_total{
                service="{{args.service-name}}",
                status=~"2.."
              }[2m]
            )) /
            sum(rate(
              http_requests_total{
                service="{{args.service-name}}"
              }[2m]
            ))

    - name: error-rate
      initialDelay: 2m
      interval: 1m
      failureLimit: 3
      successCondition: result[0] <= 0.05
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(
              http_requests_total{
                service="{{args.service-name}}",
                status=~"5.."
              }[2m]
            )) /
            sum(rate(
              http_requests_total{
                service="{{args.service-name}}"
              }[2m]
            ))

    - name: p99-latency
      initialDelay: 2m
      interval: 1m
      failureLimit: 3
      successCondition: result[0] <= 500
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(
                http_request_duration_seconds_bucket{
                  service="{{args.service-name}}"
                }[2m]
              )) by (le)
            ) * 1000
```

### 第六步：CI 集成

在 `.github/workflows/deploy.yml` 中集成：

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Tests
        run: |
          composer install --no-progress
          php artisan test

      - name: Build Docker Image
        run: |
          docker build -t registry.example.com/laravel-app:${{ github.sha }} .
          docker push registry.example.com/laravel-app:${{ github.sha }}

      - name: Update Rollout Image
        uses: argoproj/argo-rollouts-action@v2
        with:
          command: kubectl argo rollouts set image laravel-app \
            laravel=registry.example.com/laravel-app:${{ github.sha }} \
            -n production

      - name: Wait for Rollout
        run: |
          kubectl argo rollouts status laravel-app -n production --timeout=300s
```

Dockerfile 确保生产镜像精简：

```dockerfile
# Dockerfile
FROM php:8.3-fpm-alpine AS base

RUN apk add --no-cache \
    icu-libs \
    libzip-dev \
    oniguruma-dev \
    && docker-php-ext-install \
    intl \
    zip \
    mbstring \
    opcache \
    pcntl

# OPcache 配置
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.memory_consumption=128" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.max_accelerated_files=10000" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.validate_timestamps=0" >> /usr/local/etc/php/conf.d/opcache.ini

WORKDIR /var/www

FROM composer:2 AS composer
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts

FROM base AS production

COPY --from=composer /app/vendor /var/www/vendor
COPY . /var/www

RUN chown -R www-data:www-data /var/www/storage /var/www/bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
```

## 发布操作流程

### 正常发布

```bash
# 1. 查看当前 Rollout 状态
kubectl argo rollouts get rollout laravel-app -n production

# 2. 推送新镜像（触发渐进式发布）
kubectl argo rollouts set image laravel-app \
  laravel=registry.example.com/laravel-app:v2.0.0 \
  -n production

# 3. 实时监控发布进度
kubectl argo rollouts status laravel-app -n production

# 4. 查看实时流量分配
kubectl argo rollouts get rollout laravel-app -n production --show-wide
```

### 手动暂停/继续

```bash
# 暂停发布（在某个阶段停住观察）
kubectl argo rollouts pause rollout laravel-app -n production

# 确认没问题后继续
kubectl argo rollouts promote rollout laravel-app -n production

# 手动跳过当前阶段
kubectl argo rollouts skip-step rollout laravel-app -n production --step 2
```

### 紧急回滚

```bash
# 自动回滚（analysis 失败时自动触发）
# 或者手动回滚：
kubectl argo rollouts undo rollout laravel-app -n production

# 回滚到特定版本
kubectl argo rollouts undo rollout laravel-app -n production --to-revision 3

# 重写 Rollout 回滚（更彻底）
kubectl argo rollouts undo rollout laravel-app -n production --rewind
```

## 踩坑记录

### 踩坑 1：OPcache 导致 Feature Flag 不生效

**症状**：Unleash 中关闭了 Feature Flag，但线上仍然走新逻辑。

**原因**：PHP OPcache 配置了 `validate_timestamps=0`，文件修改时间不被检查，导致 Unleash SDK 的缓存行为异常。

**解决**：生产环境的 OPcache 不要关闭 `validate_timestamps`，或者改用 Redis 缓存 Unleash 的 flag 状态：

```php
// 用 Redis 缓存替代文件缓存
$cacheAdapter = new RedisCacheAdapter(
    Redis::connection()->getClient()
);
$configuration->setCache($cacheAdapter);
```

### 踩坑 2：Canary Pod 没有接到流量

**症状**：Argo Rollouts 显示 Canary 已就绪，但没有流量。

**原因**：Nginx Ingress 的 `canary` 注解没有正确配置，流量全部走 Stable Service。

**解决**：确认 Ingress 配置正确：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-stable
                port:
                  number: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-canary-ingress
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "5"
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-canary
                port:
                  number: 80
```

### 踩坑 3：Prometheus 查询超时导致误判

**症状**：Canary 刚启动就回滚，Prometheus 返回空结果。

**原因**：Canary Pod 刚启动时没有足够的请求数据，Prometheus 查询返回 `NaN`，被判定为失败。

**解决**：Analysis Template 中设置合理的 `initialDelay`（至少 2 分钟），并给 `failureLimit` 留够余量：

```yaml
metrics:
  - name: success-rate
    initialDelay: 2m    # 等 2 分钟再开始检查
    interval: 1m        # 每分钟检查一次
    failureLimit: 3     # 连续失败 3 次才判定失败
```

### 踩坑 4：Feature Flag 在队列任务中不生效

**症状**：Web 请求中 Flag 正常，但 Laravel Queue 消费时 Flag 始终返回 false。

**原因**：Queue Worker 启动时 Unleash SDK 会初始化一次，之后使用缓存。如果 Worker 没有正确配置 Redis 连接，缓存会失败。

**解决**：确保 Queue Worker 的 `.env` 中配置了 Unleash 的 Redis 缓存：

```env
UNLEASH_CACHE_DRIVER=redis
REDIS_CACHE_CONNECTION=default
```

### 踩坑 5：回滚后新镜像仍然在集群中

**症状**：执行 `rollout undo` 后，`kubectl get pods` 仍然看到新镜像的 Pod。

**原因**：Argo Rollouts 的回滚是"重新部署旧版本"，旧版本 Pod 需要时间启动，期间新版本 Pod 可能还在运行。

**解决**：使用 `rollout status` 等待回滚完成：

```bash
kubectl argo rollouts undo rollout laravel-app -n production
kubectl argo rollouts status rollout laravel-app -n production --timeout=120s
```

## 完整工作流总结

| 阶段 | 工具 | 作用 |
|------|------|------|
| 代码提交 | Git + CI | 自动构建镜像 |
| 功能开关 | Unleash | 控制新功能可见性 |
| 流量控制 | Argo Rollouts | Canary/Beta 渐进式放量 |
| 指标验证 | Prometheus | 自动检测异常 |
| 回滚 | Argo Rollouts | 自动/手动快速回滚 |

渐进式发布的核心思想是**降低每次变更的风险半径**。Feature Flag 让你可以在不部署代码的情况下控制功能开关，Argo Rollouts 让你可以在部署代码后控制流量分配。两者结合，构成了从代码到生产的完整安全网。

对于中小团队，至少做到 Feature Flag + 手动 Canary。有 Kubernetes 集群的团队，加上 Argo Rollouts 和自动分析，可以把发布风险降到最低。