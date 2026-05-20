---
title: Laravel Pennant 特性开关实战：多租户分桶、灰度放量与回滚兜底踩坑记录
date: 2026-05-03 11:20:06
updated: 2026-05-03 11:21:23
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - Pennant
  - Feature Flag
  - 灰度发布
  - 多租户
  - Octane
description: 结合 Laravel 后台灰度发布的真实落地经验，记录如何用 Pennant 做多租户分桶、稳定放量、紧急回滚与链路观测，并总结几个在线上很容易踩中的一致性问题。
---

我们把结算页重构成 `checkout-v2` 之后，真正难的不是把新页面写出来，而是**怎么只放给 5% 用户、怎么按租户回滚、怎么让队列和 API 看到同一份开关结果**。早期我用过 `.env + if/else`，发布一次要改一次配置；也用过后台表直接查库，结果高峰期每个请求都多打一条 SQL。后来把这件事收口到 **Laravel Pennant**，并补上“稳定分桶 + 手工覆盖 + 日志观测”三件套，灰度才算真正可控。

## 一、线上可用的结构不是“一个布尔值”

```text
Admin Console
    │ 修改租户白名单 / 紧急关闭
    ▼
tenant_feature_overrides
    │
    ├── API Request ──> ResolveRolloutScope Middleware
    │                       │
    │                       ▼
    │                 Laravel Pennant
    │                       │
    │             hash 分桶 + override 兜底
    │                       │
    ▼                       ▼
CheckoutController     Queue Job / Listener
    │                       │
    └────────── 写入统一日志与 response header
```

关键点是：**Pennant 负责算结果，业务库里的 override 负责救火**。只靠代码分桶，线上临时要“给某个租户全开 / 全关”会非常痛苦。

## 二、分桶一定要稳定，别用随机数

我第一次做灰度时，直接写了 `mt_rand(1, 100) <= 5`。结果同一个用户今天命中新页面，下一次请求又回旧页面，客服说“页面在闪”。后面改成稳定 hash：同一个租户、同一个用户，命中结果固定。

```php
<?php

namespace App\Support\Feature;

final readonly class RolloutScope
{
    public function __construct(
        public int $tenantId,
        public int $actorId,
        public bool $isInternal,
    ) {}
}
```

```php
<?php

namespace App\Providers;

use App\Models\TenantFeatureOverride;
use App\Support\Feature\RolloutScope;
use Illuminate\Support\ServiceProvider;
use Laravel\Pennant\Feature;

class FeatureServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Feature::define('checkout-v2', function (RolloutScope $scope): bool {
            if ($scope->isInternal) {
                return true;
            }

            $override = TenantFeatureOverride::query()
                ->where('tenant_id', $scope->tenantId)
                ->where('feature', 'checkout-v2')
                ->value('status');

            if ($override === 'on') {
                return true;
            }

            if ($override === 'off') {
                return false;
            }

            return crc32("checkout-v2:{$scope->tenantId}:{$scope->actorId}") % 100 < 5;
        });
    }
}
```

这里我故意把 override 放在 hash 前面：因为生产事故里最重要的是**先让人能一键止血**，不是追求“配置绝对优雅”。

## 三、Scope 不要偷懒只传 User

多租户后台里，同一个账号可能切不同租户；队列任务里甚至没有登录用户。如果你把 scope 简化成 `User`，接口命中开关，异步任务却命不中，最后就会出现“页面走了 v2，异步补单还在走 v1”的裂脑。

```php
<?php

namespace App\Http\Middleware;

use App\Support\Feature\RolloutScope;
use Closure;
use Illuminate\Http\Request;
use Laravel\Pennant\Feature;
use Symfony\Component\HttpFoundation\Response;

class ResolveRolloutScope
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $tenantId = (int) $request->attributes->get('tenant_id');

        app()->instance(
            RolloutScope::class,
            new RolloutScope(
                tenantId: $tenantId,
                actorId: (int) ($user?->id ?? 0),
                isInternal: str_ends_with((string) ($user?->email ?? ''), '@company.com'),
            )
        );

        /** @var Response $response */
        $response = $next($request);
        $enabled = Feature::for(app(RolloutScope::class))->active('checkout-v2');
        $response->headers->set('X-Feature-Checkout-V2', $enabled ? 'on' : 'off');

        return $response;
    }
}
```

Controller、Job、Listener 全部从容器里拿同一个 `RolloutScope`，这样请求链路和异步链路才能对齐。

## 四、业务代码里只保留一个开关出口

```php
<?php

namespace App\Http\Controllers;

use App\Services\Checkout\CheckoutV1Service;
use App\Services\Checkout\CheckoutV2Service;
use App\Support\Feature\RolloutScope;
use Laravel\Pennant\Feature;

class CheckoutController
{
    public function __construct(
        private CheckoutV1Service $v1,
        private CheckoutV2Service $v2,
    ) {}

    public function show()
    {
        $scope = app(RolloutScope::class);

        $payload = Feature::for($scope)->active('checkout-v2')
            ? $this->v2->buildPayload($scope->tenantId, $scope->actorId)
            : $this->v1->buildPayload($scope->tenantId, $scope->actorId);

        return response()->json($payload);
    }
}
```

我后来强制要求：**一个功能点只允许一个 `Feature::active()` 入口**。否则 View、Service、Listener 各查一次，排障时你根本不知道哪层把逻辑切走了。

## 五、override 表设计不要只存一个 enabled

我现在会单独建一张覆盖表，而不是把开关结果散落在租户配置 JSON 里。原因很简单：灰度回滚往往发生在事故期间，这时候你最需要的是**可查、可审计、可批量修改**。

```sql
create table tenant_feature_overrides (
    id bigint unsigned auto_increment primary key,
    tenant_id bigint unsigned not null,
    feature varchar(100) not null,
    status enum('on', 'off') not null,
    operator_id bigint unsigned not null,
    note varchar(255) null,
    created_at timestamp null,
    updated_at timestamp null,
    unique key uk_tenant_feature (tenant_id, feature)
);
```

这个表我会额外要求两件事：

1. `operator_id` 必填，事后能追是谁改的。
2. `note` 写明原因，比如“支付投诉临时关闭 checkout-v2”。

如果你的后台没有留痕，事故复盘时只会看到“有人改过”，却不知道为什么改、改给了谁。

## 六、日志观测要能回答“为什么这个人命中”

只知道开关开了没开，远远不够。我后来把分桶来源一起打到日志里：是内部账号命中、租户 override 命中，还是 hash 命中。这样客服拿着用户 ID 来问时，研发不用现场猜。

```php
logger()->info('feature.evaluated', [
    'feature' => 'checkout-v2',
    'tenant_id' => $scope->tenantId,
    'actor_id' => $scope->actorId,
    'enabled' => $enabled,
    'source' => $override ? 'override' : ($scope->isInternal ? 'internal' : 'hash'),
    'request_id' => request()->header('X-Request-Id'),
]);
```

如果后面接了 Grafana Loki / ELK，这条日志非常值钱：你可以按 `feature=checkout-v2 AND source=override` 直接把手工兜底的流量全筛出来。

## 七、我在线上踩过的 4 个坑

### 1. 用随机放量，结果用户体验抖动
不是“5% 请求”，而应该是“5% 用户”。稳定 hash 才能保证同一用户在整个灰度周期内结果一致。

### 2. override 查库没有缓存，后台峰值多打一层 SQL
最早 override 每次都查表，结算接口 P95 直接多了十几毫秒。后面把租户级 override 做成短 TTL 缓存，变更时主动失效。

### 3. Octane 下把结果放进静态变量
常驻 Worker 会串请求。某个内部测试账号命中 `true` 后，后续请求被错误复用，这是最阴的 bug。**在 Octane 场景里，别把特性结果存在静态属性里。**

### 4. 只切 API，不切队列消费者
一次回滚时，API 已经关闭 `checkout-v2`，但补偿任务还在消费旧消息并执行 v2 逻辑，最终订单备注和页面展示对不上。后来我把队列入口也统一接入 `RolloutScope`，并在日志里打印 `feature_snapshot`。

## 八、我最后定下来的上线顺序

1. 先让内部账号全开。
2. 再按租户白名单放量。
3. 然后用稳定 hash 从 1%、5%、20% 往上推。
4. 所有响应头和日志都带上 feature 状态。
5. 出现投诉时，优先改 override，而不是立刻发版。

Pennant 真正的价值，不是让代码里多一个布尔判断，而是把**灰度、回滚、排障**变成有纪律的工程动作。我的结论是：如果你的 Laravel 系统已经有多租户、队列、Octane 或者多实例部署，就不要再用配置文件硬切功能了；把 scope、分桶和 override 设计好，特性开关才能在生产环境里真正救命。
