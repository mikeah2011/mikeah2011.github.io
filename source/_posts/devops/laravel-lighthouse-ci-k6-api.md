---

title: Laravel 性能预算实战：用 Lighthouse CI + k6 设定 API 响应时间预算——从"事后优化"到"预算驱动开发"的范式转变
keywords: [Laravel, Lighthouse CI, k6, API, 性能预算实战, 设定, 响应时间预算, 事后优化, 预算驱动开发, 的范式转变]
date: 2026-06-06 18:00:00
tags:
- 性能预算
- lighthouse ci
- k6
- Laravel
- 性能优化
- CI/CD
- API
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文以 Laravel B2C API 项目为例，完整搭建性能预算驱动开发的工程化方案。通过 k6 设定 API 响应时间预算（p95<200ms、p99<500ms），利用 Lighthouse CI 管控前端核心 Web 指标（LCP<2.5s、CLS<0.1），并在 GitHub Actions 中构建三阶段性能门禁流水线——快速体积检查、API 负载预算、前端渲染预算，任一环节超标即阻断合并。涵盖预算脚本编写、阈值配置、Slack 告警、N+1 查询优化、缓存策略、队列化改造等实战技巧，附带 4 个真实踩坑案例与解决方案，帮助团队从"事后救火"转向"预算驱动开发"。
---



## 前言：为什么性能优化总是"救火"？

在大多数 Laravel 项目中，性能问题的处理模式惊人地相似：

1. 功能开发完成，上线
2. 用户量增长，系统变慢
3. 紧急排查，加索引、加缓存、加机器
4. 恢复正常，继续开发新功能
5. 回到第 2 步

这是一个**被动响应**的循环。性能优化永远在"事后"发生，团队永远在"救火"。

**性能预算（Performance Budget）** 提出了一种截然不同的思路：**在代码合入之前，就设定并强制执行性能指标的上限**。如果新代码导致性能劣化，CI 直接拒绝合并——就像财务预算一样，超支了就不能花钱。

本文将以一个 Laravel B2C API 项目为例，完整搭建一套**性能预算驱动开发**的工程化方案。

---

## 一、什么是性能预算

### 1.1 核心概念

性能预算是一组**可量化的性能指标阈值**，当指标超出阈值时，自动阻止代码合入。

```yaml
# 性能预算示例
performance_budget:
  api:
    p95_response_time: 200ms    # 95% 的请求响应时间不超过 200ms
    p99_response_time: 500ms    # 99% 的请求响应时间不超过 500ms
    error_rate: 0.1%            # 错误率不超过 0.1%
    throughput: 1000rps         # 吞吐量不低于 1000 rps
  frontend:
    LCP: 2.5s                   # 最大内容绘制
    FID: 100ms                  # 首次输入延迟
    CLS: 0.1                    # 累积布局偏移
    bundle_size: 250KB          # JS 包体积不超过 250KB
```

### 1.2 性能预算 vs 传统性能测试

| 维度 | 传统性能测试 | 性能预算 |
|------|------------|---------|
| 时机 | 上线前/问题发生后 | 每次代码合入前 |
| 执行者 | QA/运维 | CI 自动执行 |
| 反馈速度 | 天/周 | 分钟 |
| 责任归属 | 模糊（"运维应该优化"） | 清晰（"你提交的代码导致超预算"） |
| 文化影响 | 被动救火 | 预防性开发 |

---

## 二、API 性能预算：k6 负载测试

### 2.1 为什么选择 k6

[k6](https://k6.io/) 是 Grafana 开源的负载测试工具，特别适合 CI/CD 集成：

- **脚本即代码**：用 JavaScript 编写测试场景
- **阈值机制**：内置性能预算功能
- **CI 友好**：命令行执行，exit code 表示通过/失败
- **低资源占用**：比 JMeter 轻量得多

#### k6 vs JMeter vs Locust 对比

| 维度 | k6 | JMeter | Locust |
|------|-----|--------|--------|
| 脚本语言 | JavaScript | XML/Java | Python |
| 内存占用（1000 VU） | ~150MB | ~1.5GB | ~300MB |
| CI/CD 集成 | ⭐ 原生支持 | 需要插件 | 需要封装 |
| 阈值/预算机制 | ✅ 内置 thresholds | ❌ 需要额外断言 | ❌ 需要自定义 |
| 分布式支持 | k6 Cloud / 自建 | 原生支持 | 原生支持 |
| 学习曲线 | 低 | 高 | 中 |
| 实时指标输出 | JSON / InfluxDB / StatsD | JTL / 插件 | Web UI / CSV |
| 适合场景 | CI 门禁、API 预算 | 复杂协议测试 | Python 团队、快速原型 |

> **选型建议**：如果你的核心需求是"在 CI 中设置性能预算并自动阻断"，k6 是最佳选择——它的 `thresholds` 机制天然就是为性能预算设计的。如果团队更熟悉 Python，Locust 也是不错的替代方案。

### 2.2 安装 k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### 2.3 编写性能预算脚本

创建 `tests/performance/api-budget.js`：

```javascript
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 自定义指标
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency', true);

// 性能预算配置
export const options = {
  // 负载场景：阶梯式加压
  scenarios: {
    // 场景 1：常规负载
    normal_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // 升到 50 VU
        { duration: '1m', target: 50 },     // 保持 50 VU
        { duration: '30s', target: 100 },   // 升到 100 VU
        { duration: '1m', target: 100 },    // 保持 100 VU
        { duration: '30s', target: 0 },     // 降回 0
      ],
    },
    // 场景 2：突发流量
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '5s', target: 500 },    // 突发 500 rps
        { duration: '10s', target: 500 },
        { duration: '5s', target: 10 },
      ],
      startTime: '3m',
    },
  },

  // ⭐ 性能预算（阈值）—— 这就是"预算"
  thresholds: {
    // API 响应时间预算
    'http_req_duration{name:homepage}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{name:product_list}': ['p(95)<300', 'p(99)<800'],
    'http_req_duration{name:product_detail}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{name:search}': ['p(95)<400', 'p(99)<1000'],
    'http_req_duration{name:checkout}': ['p(95)<500', 'p(99)<1200'],

    // 全局预算
    'http_req_duration': ['p(95)<300', 'p(99)<800'],
    'http_req_failed': ['rate<0.01'],       // 错误率 < 1%
    'errors': ['rate<0.01'],                 // 业务错误率 < 1%

    // 吞吐量预算
    'http_reqs': ['rate>500'],               // 至少 500 rps
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${__ENV.API_TOKEN || 'test-token'}`,
  };

  group('Homepage API', function () {
    const res = http.get(`${BASE_URL}/api/homepage`, {
      headers,
      tags: { name: 'homepage' },
    });

    check(res, {
      'homepage status 200': (r) => r.status === 200,
      'homepage response time < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(res.status !== 200);
    apiLatency.add(res.timings.duration);
  });

  group('Product List API', function () {
    const res = http.get(`${BASE_URL}/api/products?page=1&per_page=20`, {
      headers,
      tags: { name: 'product_list' },
    });

    check(res, {
      'product list status 200': (r) => r.status === 200,
      'product list has pagination': (r) => {
        const body = JSON.parse(r.body);
        return body.meta && body.meta.total > 0;
      },
    });

    errorRate.add(res.status !== 200);
  });

  group('Search API', function () {
    const res = http.get(`${BASE_URL}/api/search?q=手机&page=1`, {
      headers,
      tags: { name: 'search' },
    });

    check(res, {
      'search status 200': (r) => r.status === 200,
      'search response time < 400ms': (r) => r.timings.duration < 400,
    });

    errorRate.add(res.status !== 200);
  });

  sleep(1);
}
```

### 2.4 本地运行

```bash
# 运行性能测试
k6 run tests/performance/api-budget.js

# 指定目标 URL
BASE_URL=https://staging.example.com k6 run tests/performance/api-budget.js

# 输出 JSON 报告（供 CI 解析）
k6 run --out json=results.json tests/performance/api-budget.js

# 如果预算超标，exit code 为非零
echo $?  # 1 = 超预算，0 = 在预算内
```

### 2.5 输出解读

```
     ✓ homepage status 200
     ✗ homepage response time < 200ms
      ↳  85% — OK

     █ THRESHOLDS

     http_req_duration{name:homepage}
     ✗ p(95)<200  : p(95)=234.5ms  ❌ 超预算！
     ✓ p(99)<500  : p(99)=456.2ms

     http_req_failed
     ✓ rate<0.01  : rate=0.002
```

当 p(95) 超过 200ms 阈值时，k6 会标记 ❌ 并以 exit code 1 退出，CI 流水线自动失败。

### 2.6 高级技巧：自定义指标与趋势分析

在实际项目中，光看响应时间往往不够。以下是一些实用的高级配置：

```javascript
// 自定义业务指标
import { Counter, Gauge, Trend, Rate } from 'k6/metrics';

const orderCreated = new Counter('orders_created');       // 创建订单数
const cartAbandoned = new Rate('cart_abandonment_rate');   // 购物车放弃率
const dbQueryTime = new Trend('db_query_duration');        // 数据库查询时间
const cacheHitRate = new Rate('cache_hit_rate');           // 缓存命中率

export default function () {
  // ... 请求逻辑 ...

  // 追踪业务指标
  if (res.status === 201 && url.includes('/orders')) {
    orderCreated.add(1);
  }

  // 从响应头获取后端性能数据
  const dbTime = parseFloat(res.headers['X-DB-Duration'] || '0');
  const cacheHit = res.headers['X-Cache'] === 'HIT';
  dbQueryTime.add(dbTime);
  cacheHitRate.add(cacheHit);
}

// 为自定义指标设置预算
export const options = {
  thresholds: {
    'db_query_duration': ['p(95)<50'],       // 数据库查询 < 50ms
    'cache_hit_rate': ['rate>0.8'],          // 缓存命中率 > 80%
    'cart_abandonment_rate': ['rate<0.05'],  // 放弃率 < 5%
  },
};
```

配合 Laravel 后端暴露性能指标头：

```php
// app/Http/Middleware/ExposePerformanceMetrics.php
class ExposePerformanceMetrics
{
    public function handle($request, Closure $next)
    {
        $start = microtime(true);

        $response = $next($request);

        $duration = (microtime(true) - $start) * 1000; // ms
        $response->headers->set('X-DB-Duration', number_format(DB::getQueryLog() ? array_sum(array_column(DB::getQueryLog(), 'time')) : 0, 2));
        $response->headers->set('X-Response-Time', number_format($duration, 2));
        $response->headers->set('X-Cache', Cache::get("request:{$request->path()}:hit") ? 'HIT' : 'MISS');

        return $response;
    }
}
```

### 2.7 生成可视化 HTML 报告

CI 中的文本输出对开发者不够友好，可以自动生成可视化报告：

```bash
# 安装 k6-reporter
npm install -g k6-reporter

# 运行测试并生成报告
k6 run --out json=results.json tests/performance/api-budget.js
npx k6-reporter results.json --output performance-report.html
```

在 GitHub Actions 中将报告作为 artifact 上传：

```yaml
- name: Upload Performance Report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: performance-report
    path: performance-report.html
    retention-days: 30
```

报告包含：响应时间分布直方图、各接口 P50/P90/P95/P99 对比、吞吐量趋势图、错误率统计等，方便在 PR Review 时直观查看性能变化。

---

## 三、前端性能预算：Lighthouse CI

### 3.1 为什么需要 Lighthouse CI

Lighthouse 是 Google 的网页质量评估工具。Lighthouse CI 将其集成到 CI/CD 中，每次 PR 自动运行 Lighthouse 审计。

### 3.2 安装 Lighthouse CI

```bash
npm install -g @lhci/cli

# 在项目中初始化
lhci init
```

### 3.3 配置文件

创建 `lighthouserc.js`：

```javascript
module.exports = {
  ci: {
    collect: {
      // 收集配置
      url: [
        'http://localhost:8000/',
        'http://localhost:8000/products',
        'http://localhost:8000/products/1',
        'http://localhost:8000/search?q=手机',
      ],
      startServerCommand: 'php artisan serve --port=8000',
      startServerReadyPattern: 'Development Server',
      numberOfRuns: 3, // 每个页面运行 3 次取中位数
      settings: {
        preset: 'desktop', // or 'mobile'
      },
    },
    assert: {
      // ⭐ 性能预算断言
      assertions: {
        // 核心 Web 指标预算
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],  // LCP < 2.5s
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],   // CLS < 0.1
        'total-blocking-time': ['error', { maxNumericValue: 300 }],        // TBT < 300ms

        // 性能评分预算
        'categories:performance': ['error', { minScore: 0.9 }],           // 性能评分 ≥ 90
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],

        // 资源体积预算
        'resource-summary:script:size': ['error', { maxNumericValue: 250000 }],  // JS < 250KB
        'resource-summary:document:size': ['error', { maxNumericValue: 50000 }], // HTML < 50KB
        'resource-summary:total:size': ['error', { maxNumericValue: 1000000 }],  // 总资源 < 1MB
      },
    },
    upload: {
      target: 'temporary-public-storage',
      // 或者上传到 LHCI Server
      // target: 'lhci',
      // serverBaseUrl: 'https://lhci.example.com',
    },
  },
};
```

### 3.4 CI 集成

```yaml
# .github/workflows/lighthouse-ci.yml
name: Lighthouse CI

on:
  pull_request:
    branches: [main]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Dependencies
        run: |
          composer install --no-interaction
          npm ci && npm run build

      - name: Setup Database
        run: |
          php artisan migrate:fresh --seed
          php artisan config:cache

      - name: Run Lighthouse CI
        run: lhci autorun
        env:
          LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

---

## 四、CI 中的性能预算门禁

将 k6 和 Lighthouse CI 整合到一个完整的性能门禁流程：

```yaml
# .github/workflows/performance-budget.yml
name: Performance Budget Gate

on:
  pull_request:
    branches: [main]
  push:
    branches: [main, develop]

jobs:
  # 第一阶段：快速检查（< 2 分钟）
  quick-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run build

      # 检查前端包体积
      - name: Check Bundle Size
        run: |
          JS_SIZE=$(find public/js -name "*.js" -exec cat {} + | wc -c)
          MAX_SIZE=250000  # 250KB
          echo "JS Bundle Size: ${JS_SIZE} bytes (limit: ${MAX_SIZE})"
          if [ $JS_SIZE -gt $MAX_SIZE ]; then
            echo "::error::JS bundle exceeds ${MAX_SIZE} bytes budget!"
            exit 1
          fi

  # 第二阶段：API 性能预算（~3 分钟）
  api-performance:
    needs: quick-checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - uses: grafana/setup-k6-action@v1

      - name: Setup App
        run: |
          composer install --no-interaction
          cp .env.ci .env
          php artisan key:generate
          php artisan migrate:fresh --seed
          php artisan serve --port=8000 &
          sleep 3

      - name: Run k6 Performance Budget
        run: k6 run tests/performance/api-budget.js
        env:
          BASE_URL: http://localhost:8000
          API_TOKEN: test-token

  # 第三阶段：前端性能预算（~3 分钟）
  frontend-performance:
    needs: quick-checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Lighthouse CI
        run: npm install -g @lhci/cli

      - name: Setup & Run Lighthouse
        run: |
          composer install --no-interaction
          npm ci && npm run build
          cp .env.ci .env
          php artisan key:generate
          php artisan migrate:fresh --seed
          lhci autorun

  # 性能门禁汇总
  performance-gate:
    needs: [api-performance, frontend-performance]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Check Performance Budget
        run: |
          API_RESULT="${{ needs.api-performance.result }}"
          FE_RESULT="${{ needs.frontend-performance.result }}"

          echo "API Performance: $API_RESULT"
          echo "Frontend Performance: $FE_RESULT"

          if [ "$API_RESULT" != "success" ] || [ "$FE_RESULT" != "success" ]; then
            echo "::error::Performance budget exceeded! Please optimize before merging."
            exit 1
          fi
          echo "✅ All performance budgets met!"
```

---

## 五、Laravel API 性能优化：让预算达标

当 k6 报告预算超标时，以下是常见的优化手段：

### 5.1 数据库查询优化

```php
// ❌ N+1 查询问题
$products = Product::all();
foreach ($products as $product) {
    $product->category->name;  // 每次循环都查询一次
}

// ✅ 预加载
$products = Product::with('category')->paginate(20);

// ✅ 只选择需要的字段
$products = Product::select('id', 'name', 'price', 'category_id')
    ->with('category:id,name')
    ->paginate(20);
```

### 5.2 缓存策略

```php
// API 响应缓存
Route::get('/api/products', function () {
    return Cache::remember('products:page:1', 300, function () {
        return Product::with('category')
            ->select('id', 'name', 'price', 'category_id')
            ->paginate(20);
    });
});

// 使用 Redis 缓存复杂查询
$products = Cache::tags(['products'])->remember(
    "products:search:{$query}:{$page}",
    600,
    fn() => Product::search($query)->paginate(20)
);
```

### 5.3 响应压缩

```php
// config/app.php 或中间件
// 使用 Laravel 内置的中间件
// Kernel.php
protected $middleware = [
    \App\Http\Middleware\CompressResponse::class,
];
```

```nginx
# nginx 配置
gzip on;
gzip_types application/json text/plain text/css;
gzip_min_length 1000;
gzip_comp_level 6;
```

### 5.4 数据库索引

```php
// migration
Schema::table('products', function (Blueprint $table) {
    $table->index(['category_id', 'created_at']);  // 联合索引
    $table->index('name');                          // 搜索字段索引
});
```

### 5.5 队列化非关键操作

```php
// ❌ 同步执行，增加响应时间
public function checkout(Request $request)
{
    $order = Order::create($request->validated());
    Mail::to($request->user())->send(new OrderConfirmation($order));
    Inventory::decrement($order->product_id, $order->quantity);
    return response()->json($order);
}

// ✅ 异步处理非关键操作
public function checkout(Request $request)
{
    $order = Order::create($request->validated());
    OrderConfirmationJob::dispatch($order);        // 异步发邮件
    InventoryDecrementJob::dispatch($order);        // 异步扣库存
    return response()->json($order);
}
```

---

## 六、预算管理的最佳实践

### 6.1 预算设定原则

1. **基于实际数据**：先跑一轮基准测试，以当前 p95 的 1.2 倍作为初始预算
2. **分级管理**：核心接口（下单、支付）预算严格，次要接口（后台管理）预算宽松
3. **渐进收紧**：每季度收紧 10%，持续优化
4. **例外机制**：特殊功能需要放宽预算时，必须有审批流程

### 6.2 预算告警

```yaml
# 在 k6 中添加告警
export const options = {
  thresholds: {
    'http_req_duration': ['p(95)<200'],
  },
};

// 在 CI 中发送 Slack 通知
// .github/workflows/performance-budget.yml
- name: Notify on Budget Exceeded
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "⚠️ Performance budget exceeded in PR #${{ github.event.pull_request.number }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "Performance budget exceeded! :rotating_light:\n*PR:* <${{ github.event.pull_request.html_url }}|#${{ github.event.pull_request.number }}>\n*Branch:* ${{ github.head_ref }}"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### 6.3 性能报告

```bash
# 生成 HTML 性能报告
k6 run --out json=results.json tests/performance/api-budget.js

# 使用 k6-reporter 生成可视化报告
npx k6-reporter results.json --output report.html
```

---

## 七、踩坑记录

### 坑 1：k6 在 CI 中因资源不足导致结果不准

**现象**：GitHub Actions 的 runner 只有 2 核 7GB 内存，k6 高并发测试结果波动大。

**解决**：降低 VU 数量，使用 `ramping-arrival-rate` 代替 `constant-vus`，关注相对性能变化而非绝对值。

### 坑 2：Lighthouse CI 分数波动

**现象**：同一代码多次运行 Lighthouse，分数在 85-95 之间波动。

**解决**：
1. 增加 `numberOfRuns` 到 5 次，取中位数
2. 使用 `median` 断言而非单次值
3. 在 CI 中使用 `preset: 'desktop'` 减少网络波动影响

### 坑 3：性能预算阻碍了正常的功能迭代

**现象**：新功能需要加载更多数据，导致 p95 从 180ms 升到 220ms，CI 失败。

**解决**：
1. 建立预算审批流程：PM + Tech Lead 联合签字
2. 设置临时豁免（最多 2 个 sprint）
3. 在豁免期间制定优化计划

### 坑 4：测试环境与生产环境性能差异

**现象**：测试环境 p95=150ms，生产环境 p95=300ms（数据量差异大）。

**解决**：
1. 测试环境使用与生产相似的数据量
2. 使用 production-like 的 staging 环境
3. 预算按生产环境设定，测试环境预留给 50% 余量

### 坑 5：k6 测试中的 TLS/连接复用问题

**现象**：本地测试 p95=120ms，CI 中 p95=350ms，排查发现 CI 每次请求都重新建立 TLS 连接。

**解决**：
```javascript
// 使用 http.batch() 批量请求，复用连接
const responses = http.batch([
  ['GET', `${BASE_URL}/api/products`, null, { tags: { name: 'product_list' } }],
  ['GET', `${BASE_URL}/api/categories`, null, { tags: { name: 'categories' } }],
  ['GET', `${BASE_URL}/api/banner`, null, { tags: { name: 'banner' } }],
]);

// 或者使用 k6 的连接池配置
export const options = {
  userAgent: 'k6/performance-budget',
  noConnectionReuse: false,  // 确保连接复用
  batch: 10,                 // 最多 10 个并发连接
};
```

### 坑 6：Lighthouse CI 的 Chrome 版本不一致

**现象**：团队成员本地运行 Lighthouse 得分 95，CI 中得分 82。

**解决**：
1. 在 CI 中固定 Chrome 版本：`chromeFlags: ['--chrome-flags="--no-sandbox"']`
2. 使用 Docker 镜像确保环境一致
3. 将 Lighthouse 配置版本锁定在 `lighthouserc.js` 中

```javascript
// lighthouserc.js 中固定 Chrome 配置
module.exports = {
  ci: {
    collect: {
      settings: {
        chromeFlags: '--no-sandbox --headless --disable-gpu',
        onlyCategories: ['performance'],
        skipAudits: ['uses-http2'], // CI 环境通常不支持 HTTP/2
      },
    },
  },
};
```

### 坑 7：性能预算与数据库迁移的冲突

**现象**：新 PR 增加了数据库迁移（新增大表），seed 数据后查询变慢，k6 预算超标。

**解决**：
1. 在 CI 中 seed 与生产相似规模的数据（而不是只有 10 条测试数据）
2. 为新表提前创建索引
3. 预算脚本中排除迁移相关的接口测试

---

## 八、生产环境的性能预算监控

CI 中的性能预算只是第一步，生产环境的持续监控同样重要。

### 8.1 使用 Prometheus + Grafana 监控 API 响应时间

```php
// app/Http/Middleware/RecordMetrics.php
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class RecordMetrics
{
    public function handle($request, Closure $next)
    {
        $start = microtime(true);
        $response = $next($request);
        $duration = (microtime(true) - $start) * 1000;

        $registry = CollectorRegistry::getDefault();
        $histogram = $registry->registerHistogram(
            'app', 'http_request_duration_ms',
            'HTTP request duration in milliseconds',
            ['method', 'route', 'status_code']
        );

        $histogram->observe($duration, [
            $request->method(),
            $request->route()?->getName() || 'unknown',
            $response->getStatusCode(),
        ]);

        return $response;
    }
}
```

### 8.2 Grafana 告警规则

```yaml
# grafana/alerts/api-performance-budget.yml
groups:
  - name: api-performance-budget
    rules:
      - alert: APIP95BudgetExceeded
        expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m])) > 200
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API P95 响应时间超过性能预算 (200ms)"
          description: "当前 P95: {{ $value }}ms，已持续 5 分钟超标"

      - alert: APIP99BudgetExceeded
        expr: histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m])) > 500
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API P99 响应时间超过性能预算 (500ms)"
```

### 8.3 性能预算仪表盘核心面板

| 面板名称 | PromQL 查询 | 预算阈值 |
|----------|-------------|---------|
| P50 响应时间 | `histogram_quantile(0.50, rate(http_request_duration_ms_bucket[5m]))` | < 100ms |
| P95 响应时间 | `histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))` | < 200ms |
| P99 响应时间 | `histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m]))` | < 500ms |
| 错误率 | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` | < 1% |
| 吞吐量 | `rate(http_requests_total[5m])` | > 500 rps |

> **CI + 生产双保险**：CI 中的性能预算防止代码合入时劣化，生产监控捕捉数据量增长、缓存失效等运行时问题。两者缺一不可。

---

## 总结

性能预算不是银弹，但它改变了团队的思维方式：

| 之前 | 之后 |
|------|------|
| "上线后看看性能怎么样" | "合入前就知道性能会不会超标" |
| "优化是运维的事" | "每个人的 PR 都会影响性能预算" |
| "性能问题是紧急事故" | "性能问题是 CI 红线" |

**工具栈回顾**：

| 层面 | 工具 | 预算类型 |
|------|------|---------|
| API 响应时间 | k6 | p95 < 200ms, p99 < 500ms |
| 前端渲染 | Lighthouse CI | LCP < 2.5s, CLS < 0.1 |
| 包体积 | Bundlephobia + CI 脚本 | JS < 250KB, CSS < 50KB |
| 资源加载 | WebPageTest | 总资源 < 1MB |

从今天开始，让你的 Laravel 项目拥有一份**性能预算**——就像你有代码审查和自动化测试一样，性能也应该是一等公民。

---

*参考资料：*
- [k6 官方文档](https://k6.io/docs/)
- [Lighthouse CI 文档](https://github.com/GoogleChrome/lighthouse-ci)
- [Web Performance Budgets - Google](https://web.dev/performance-budgets-101/)
- [Laravel Performance Optimization](https://laravel.com/docs/11.x/cache)
- [Core Web Vitals](https://web.dev/vitals/)

---

## 相关阅读

- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/categories/CI-CD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)——进一步优化 CI 流水线，用矩阵策略实现多环境并行测试，与性能预算门禁配合形成完整的质量保障体系。
- [负载测试实战：k6/Locust 对 Laravel API 进行压力测试与性能基线](/categories/运维/2026-06-01-load-testing-k6-locust-laravel-api-performance-baseline/)——深入了解 k6 和 Locust 两种负载测试工具的对比与实战，为性能预算提供基线数据。
- [工程效能度量实战：DORA 四大指标在 Laravel 团队中的落地](/categories/运维/工程效能度量实战-DORA四大指标-Laravel团队落地/)——性能预算是工程效能的一部分，结合 DORA 指标构建全方位的 DevOps 度量体系。
