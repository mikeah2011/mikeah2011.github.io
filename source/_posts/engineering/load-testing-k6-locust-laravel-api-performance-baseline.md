---
title: "负载测试实战：k6/Locust 对 Laravel API 进行压力测试与性能基线"
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-06-01 12:00:00
categories:
  - testing
  - performance
keywords: [k6, Locust, Laravel API, 负载测试实战, 进行压力测试与性能基线, 测试]
tags:
  - k6
  - Locust
  - 负载测试
  - Laravel
  - 性能基线
  - 压力测试
  - API
  - Grafana
description: "深度实战 k6 与 Locust 两大负载测试工具，针对 Laravel B2C API 进行压力测试与性能基线建立。涵盖架构原理、阶梯式加压、多场景混合测试、CI/CD 门禁集成、InfluxDB+Grafana 可视化、真实踩坑记录（OOM/连接池/限流）与最佳实践，附完整可运行代码示例。"
---
# 负载测试实战：k6/Locust 对 Laravel API 进行压力测试与性能基线

## 1. 问题背景与动机：为什么 B2C API 必须做负载测试？

### 1.1 一次真实的线上事故

2025 年 Q4，KKday B2C API 在一次促销活动中遭遇了严重的性能退化：

```
正常时段：P99 延迟 ~120ms，QPS ~800
促销开始：P99 延迟飙升至 8000ms，QPS 降至 ~200
结果：订单转化率下降 40%，客服工单暴增
```

事后复盘发现，问题根源是一个新上线的「商品推荐接口」在高并发下触发了 N+1 查询，导致 MySQL 连接池耗尽。**如果上线前做了负载测试，这个问题完全可以提前发现。**

### 1.2 负载测试的核心目标

负载测试不是「跑个压测看看能扛多少 QPS」这么简单。它的核心价值是：

```
┌─────────────────────────────────────────────────────────┐
│                   负载测试四层目标                         │
├─────────────────────────────────────────────────────────┤
│  ① 性能基线  → 建立正常状态的延迟/吞吐量基准              │
│  ② 容量规划  → 确定系统在 SLA 内能承受的最大 QPS          │
│  ③ 回归检测  → 每次部署自动检测性能退化                    │
│  ④ 瓶颈定位  → 找到系统的薄弱环节（DB/Cache/网络/代码）    │
└─────────────────────────────────────────────────────────┘
```

### 1.3 为什么选 k6 和 Locust？

市面上的负载测试工具众多（JMeter、Gatling、wrk、ab、Vegeta），但 k6 和 Locust 在现代 API 测试场景中脱颖而出：

| 维度 | k6 (Grafana) | Locust (Python) | JMeter | wrk |
|------|-------------|-----------------|--------|-----|
| **脚本语言** | JavaScript | Python | XML/Java | Lua |
| **协议支持** | HTTP/gRPC/WebSocket/浏览器 | HTTP（可扩展） | 广泛 | HTTP |
| **分布式** | k6-operator (K8s) | 原生分布式 | 需要插件 | 不支持 |
| **CI/CD 集成** | 原生支持（JSON 输出） | 需要包装 | 插件支持 | 基础 |
| **Grafana 集成** | 原生（k6 Cloud/InfluxDB） | 需要导出 | 插件 | 不支持 |
| **学习曲线** | 低（JS） | 低（Python） | 高 | 低 |
| **真实浏览器** | k6 Browser（实验性） | 不支持 | 不支持 | 不支持 |
| **资源消耗** | 极低（Go runtime） | 中等（Python） | 高（JVM） | 极低 |

**对于 Laravel B2C API 场景，我们的选型结论是：k6 为主力，Locust 为补充。** 原因：
- k6 的 Go runtime 在单机能产生更高并发，资源消耗更低
- k6 的 `thresholds` 机制天然适合 CI/CD 中的性能门禁
- Locust 的 Python 生态适合复杂业务逻辑编排（如多步骤下单流程）

---

## 2. 架构设计原理：负载测试工具如何工作？

### 2.1 k6 的架构与执行模型

k6 使用 Go 编写，核心是一个高效的事件循环引擎：

```
┌──────────────────────────────────────────────────────────┐
│                      k6 执行引擎                          │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │   VU 调度器  │───→│  虚拟用户池   │───→│  HTTP 客户端 │ │
│  │  (Scheduler) │    │  (VU Pool)   │    │  (net/http)  │ │
│  └─────────────┘    └──────────────┘    └─────────────┘ │
│         │                                       │        │
│         ▼                                       ▼        │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │  场景配置    │    │  指标收集器   │───→│  输出管线    │ │
│  │  (Scenarios) │    │  (Collector) │    │  (Output)    │ │
│  └─────────────┘    └──────────────┘    └─────────────┘ │
│                                            │             │
│                              ┌─────────────┼──────────┐  │
│                              ▼             ▼          ▼  │
│                          JSON         InfluxDB     k6 Cloud│
└──────────────────────────────────────────────────────────┘
```

**关键设计决策：**
- **VU（Virtual User）模型**：每个 VU 运行一个独立的 JS runtime（goja 引擎），VU 之间完全隔离
- **场景（Scenarios）**：支持 `constant-vus`、`ramping-vus`、`constant-arrival-rate`、`ramping-arrival-rate` 等多种负载模型
- **阈值（Thresholds）**：内置性能断言机制，可直接作为 CI 门禁

### 2.2 Locust 的架构与执行模型

Locust 使用 Python + gevent（协程）实现并发：

```
┌──────────────────────────────────────────────────────────┐
│                   Locust 分布式架构                        │
│                                                          │
│  ┌─────────────────┐         ┌─────────────────┐        │
│  │   Master 节点    │◄───────►│  Worker 节点 1   │        │
│  │  (Web UI/API)   │  ZMQ    │  (gevent loop)   │        │
│  └────────┬────────┘         └─────────────────┘        │
│           │              ┌─────────────────┐             │
│           ├─────────────►│  Worker 节点 2   │             │
│           │              │  (gevent loop)   │             │
│           │              └─────────────────┘             │
│           │              ┌─────────────────┐             │
│           └─────────────►│  Worker 节点 N   │             │
│                          │  (gevent loop)   │             │
│                          └─────────────────┘             │
│                                                          │
│  特点：原生分布式，Python 生态，Web UI 实时监控            │
└──────────────────────────────────────────────────────────┘
```

**与 k6 的核心差异：**
- Locust 使用 `gevent` 协程而非独立 runtime，单机并发上限低于 k6
- Locust 的分布式是原生的（Master-Worker via ZMQ），不需要 Kubernetes
- Locust 的 Web UI 提供实时监控，适合开发环境手动调试

---

## 3. k6 实战：Laravel B2C API 压力测试

### 3.1 基础测试脚本

首先安装 k6：

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

针对 Laravel B2C API 的商品列表接口编写测试：

```javascript
// tests/load/k6-product-list.js
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 自定义指标
const errorRate = new Rate('errors');
const productLatency = new Trend('product_list_latency', true);

// 测试配置
export const options = {
  scenarios: {
    // 阶梯式加压：从 10 VU 到 200 VU
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },   // 30s 内升到 50 VU
        { duration: '1m', target: 100 },   // 1min 内升到 100 VU
        { duration: '2m', target: 200 },   // 2min 内升到 200 VU
        { duration: '1m', target: 200 },   // 维持 200 VU 1min
        { duration: '30s', target: 0 },    // 30s 内降到 0
      ],
    },
  },
  // 性能阈值（CI 门禁）
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // P95 < 500ms, P99 < 1s
    errors: ['rate<0.01'],                            // 错误率 < 1%
    product_list_latency: ['p(95)<400'],              // 商品列表 P95 < 400ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  group('商品列表 API', function () {
    // 带分页的商品列表请求
    const page = Math.floor(Math.random() * 10) + 1;
    const res = http.get(`${BASE_URL}/api/v2/products?page=${page}&per_page=20`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Request-ID': `k6-${__VU}-${__ITER}`,
      },
      tags: { name: 'ProductList' },
    });

    // 记录延迟
    productLatency.add(res.timings.duration);

    // 断言检查
    const passed = check(res, {
      'status is 200': (r) => r.status === 200,
      'response has data': (r) => JSON.parse(r.body).data !== undefined,
      'response time < 500ms': (r) => r.timings.duration < 500,
      'has pagination': (r) => JSON.parse(r.body).meta !== undefined,
    });

    errorRate.add(!passed);
  });

  sleep(1); // 模拟用户思考时间
}
```

运行测试：

```bash
# 本地运行
k6 run tests/load/k6-product-list.js

# 输出到 InfluxDB（配合 Grafana 可视化）
k6 run --out influxdb=http://localhost:8086/k6 tests/load/k6-product-list.js

# 输出 JSON 报告
k6 run --out json=results.json tests/load/k6-product-list.js
```

### 3.2 多场景混合测试

真实 B2C 场景中，不同接口的访问比例不同。k6 的 `scenarios` 支持精确控制：

```javascript
// tests/load/k6-mixed-scenarios.js
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  scenarios: {
    // 场景1：浏览商品（70% 流量，均匀分布）
    browse_products: {
      executor: 'constant-arrival-rate',
      rate: 70,              // 每秒 70 个请求
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'browseProducts',
    },
    // 场景2：搜索商品（20% 流量，均匀分布）
    search_products: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 30,
      maxVUs: 60,
      exec: 'searchProducts',
    },
    // 场景3：下单流程（10% 流量，模拟突发）
    place_order: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages: [
        { duration: '1m', target: 5 },
        { duration: '1m', target: 15 },  // 突发增长
        { duration: '1m', target: 5 },
      ],
      exec: 'placeOrder',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    errors: ['rate<0.02'],
    'http_req_duration{name:BrowseProduct}': ['p(95)<300'],
    'http_req_duration{name:SearchProduct}': ['p(95)<600'],
    'http_req_duration{name:PlaceOrder}': ['p(95)<1000'],
  },
};

const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-bearer-token';

export function browseProducts() {
  const page = Math.floor(Math.random() * 20) + 1;
  const res = http.get(`${BASE_URL}/api/v2/products?page=${page}`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    tags: { name: 'BrowseProduct' },
  });
  check(res, { 'browse OK': (r) => r.status === 200 }) || errorRate.add(1);
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s 随机间隔
}

export function searchProducts() {
  const keywords = ['機票', '酒店', '門票', '行程', '交通'];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const res = http.get(`${BASE_URL}/api/v2/products/search?q=${keyword}`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    tags: { name: 'SearchProduct' },
  });
  check(res, { 'search OK': (r) => r.status === 200 }) || errorRate.add(1);
  sleep(Math.random() * 3 + 1);
}

export function placeOrder() {
  group('下单流程', function () {
    // Step 1: 获取商品详情
    const productRes = http.get(`${BASE_URL}/api/v2/products/1`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      tags: { name: 'PlaceOrder' },
    });
    check(productRes, { 'product detail OK': (r) => r.status === 200 });

    // Step 2: 加入购物车
    const cartRes = http.post(`${BASE_URL}/api/v2/cart/items`, JSON.stringify({
      product_id: 1,
      quantity: 1,
      date: '2026-07-01',
    }), {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      tags: { name: 'PlaceOrder' },
    });
    check(cartRes, { 'add to cart OK': (r) => r.status === 201 });

    // Step 3: 创建订单
    const orderRes = http.post(`${BASE_URL}/api/v2/orders`, JSON.stringify({
      cart_ids: [JSON.parse(cartRes.body).data.id],
      payment_method: 'credit_card',
    }), {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `k6-order-${__VU}-${__ITER}`,
      },
      tags: { name: 'PlaceOrder' },
    });
    const orderPassed = check(orderRes, {
      'order created': (r) => r.status === 201,
      'order has id': (r) => JSON.parse(r.body).data.order_id !== undefined,
    });
    errorRate.add(!orderPassed);
  });
  sleep(2);
}
```

### 3.3 k6 阈值与 CI/CD 集成

k6 的 `thresholds` 是其最强大的特性之一——它让负载测试成为 CI/CD 流水线中的性能门禁：

```yaml
# .github/workflows/load-test.yml
name: Load Test

on:
  pull_request:
    paths:
      - 'app/Http/Controllers/**'
      - 'app/Services/**'
      - 'routes/api.php'
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨 2 点

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start Laravel app
        run: |
          docker-compose -f docker-compose.loadtest.yml up -d
          sleep 30  # 等待服务就绪

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C47E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6

      - name: Run load test
        run: |
          k6 run \
            --out json=k6-results.json \
            --out influxdb=http://localhost:8086/k6 \
            -e BASE_URL=http://localhost:8000 \
            -e AUTH_TOKEN=${{ secrets.TEST_API_TOKEN }} \
            tests/load/k6-mixed-scenarios.js

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-results
          path: k6-results.json
```

**关键点：** 当 `thresholds` 中定义的条件不满足时，k6 会返回非零退出码，CI 流水线自动失败。这就是「性能门禁」。

---

## 4. Locust 实战：复杂业务场景测试

### 4.1 Locust 基础配置

```python
# tests/load/locustfile.py
"""
Laravel B2C API 负载测试 - Locust 版本
特点：Python 生态，适合复杂业务逻辑编排
"""
import json
import random
import time
from locust import HttpUser, task, between, tag, events
from locust.runners import MasterRunner


class B2CProductBrowser(HttpUser):
    """模拟浏览商品的用户行为"""
    
    # 请求间隔：1-3 秒（模拟真实用户思考时间）
    wait_time = between(1, 3)
    
    # 用户权重：浏览用户是搜索用户的 3 倍
    weight = 3
    
    def on_start(self):
        """用户启动时执行登录"""
        response = self.client.post("/api/v2/auth/login", json={
            "email": f"loadtest_{random.randint(1, 10000)}@example.com",
            "password": "test-password"
        })
        if response.status_code == 200:
            token = response.json().get("data", {}).get("token")
            self.client.headers.update({
                "Authorization": f"Bearer {token}",
                "Accept": "application/json"
            })
    
    @tag('browse')
    @task(5)
    def list_products(self):
        """浏览商品列表（最高频操作）"""
        page = random.randint(1, 20)
        with self.client.get(
            f"/api/v2/products?page={page}&per_page=20",
            name="/api/v2/products?page=[page]",
            catch_response=True
        ) as response:
            if response.status_code != 200:
                response.failure(f"Status code: {response.status_code}")
            elif response.elapsed.total_seconds() > 1.0:
                response.failure(f"Response too slow: {response.elapsed.total_seconds()}s")
            else:
                data = response.json()
                if "data" not in data:
                    response.failure("Missing data field")
    
    @tag('detail')
    @task(3)
    def view_product_detail(self):
        """查看商品详情"""
        product_id = random.randint(1, 1000)
        self.client.get(
            f"/api/v2/products/{product_id}",
            name="/api/v2/products/[id]"
        )
    
    @tag('search')
    @task(2)
    def search_products(self):
        """搜索商品"""
        keywords = ["機票", "酒店", "門票", "行程", "交通", "美食", "SPA"]
        keyword = random.choice(keywords)
        self.client.get(
            f"/api/v2/products/search?q={keyword}",
            name="/api/v2/products/search?q=[keyword]"
        )


class B2COrderUser(HttpUser):
    """模拟下单用户（高价值操作）"""
    
    wait_time = between(2, 5)
    weight = 1  # 权重低：下单用户比例小
    
    def on_start(self):
        response = self.client.post("/api/v2/auth/login", json={
            "email": f"buyer_{random.randint(1, 1000)}@example.com",
            "password": "test-password"
        })
        if response.status_code == 200:
            token = response.json().get("data", {}).get("token")
            self.client.headers.update({
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json"
            })
    
    @tag('order')
    @task
    def place_order_flow(self):
        """完整的下单流程（多步骤）"""
        # Step 1: 获取商品详情
        product_id = random.randint(1, 100)
        self.client.get(
            f"/api/v2/products/{product_id}",
            name="/api/v2/products/[id] (pre-order)"
        )
        
        # Step 2: 加入购物车
        cart_response = self.client.post("/api/v2/cart/items", json={
            "product_id": product_id,
            "quantity": random.randint(1, 3),
            "date": "2026-07-15"
        }, name="/api/v2/cart/items")
        
        if cart_response.status_code != 201:
            return
        
        cart_item_id = cart_response.json().get("data", {}).get("id")
        
        # Step 3: 创建订单
        order_response = self.client.post("/api/v2/orders", json={
            "cart_ids": [cart_item_id],
            "payment_method": "credit_card",
            "coupon_code": None
        }, name="/api/v2/orders", headers={
            "Idempotency-Key": f"locust-{int(time.time() * 1000)}-{random.randint(1, 99999)}"
        })
        
        if order_response.status_code == 201:
            order_id = order_response.json().get("data", {}).get("order_id")
            # Step 4: 查询订单状态
            self.client.get(
                f"/api/v2/orders/{order_id}",
                name="/api/v2/orders/[id] (status check)"
            )
```

运行 Locust：

```bash
# 命令行模式（无 Web UI）
locust -f tests/load/locustfile.py \
  --host=http://localhost:8000 \
  --users=200 \
  --spawn-rate=10 \
  --run-time=5m \
  --headless \
  --csv=results \
  --html=report.html

# 分布式模式
# Master 节点
locust -f tests/load/locustfile.py --master --host=http://localhost:8000

# Worker 节点（可在多台机器上启动）
locust -f tests/load/locustfile.py --worker --master-host=192.168.1.100
```

### 4.2 Locust 事件钩子与指标导出

Locust 支持事件钩子，可以在测试过程中收集自定义指标：

```python
# tests/load/custom_metrics.py
"""
自定义指标收集：将 Locust 指标导出到 InfluxDB
"""
import time
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
from locust import events

# InfluxDB 配置
INFLUXDB_URL = "http://localhost:8086"
INFLUXDB_TOKEN = "your-token"
INFLUXDB_ORG = "your-org"
INFLUXDB_BUCKET = "loadtest"

client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
write_api = client.write_api(write_options=SYNCHRONOUS)


@events.request.add_listener
def on_request(request_type, name, response_time, response_length, response,
               context, exception, **kwargs):
    """每个请求完成后触发"""
    point = Point("http_request") \
        .tag("method", request_type) \
        .tag("endpoint", name) \
        .tag("status", str(response.status_code) if response else "error") \
        .field("response_time_ms", response_time) \
        .field("response_length", response_length) \
        .field("success", exception is None) \
        .time(int(time.time() * 1e9))
    
    write_api.write(bucket=INFLUXDB_BUCKET, record=point)


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """测试开始时记录标记"""
    point = Point("test_events") \
        .tag("event", "test_start") \
        .field("target_host", environment.host) \
        .time(int(time.time() * 1e9))
    write_api.write(bucket=INFLUXDB_BUCKET, record=point)


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """测试结束时记录标记"""
    point = Point("test_events") \
        .tag("event", "test_stop") \
        .time(int(time.time() * 1e9))
    write_api.write(bucket=INFLUXDB_BUCKET, record=point)
    client.close()
```

---

## 5. 性能基线建立与回归检测

### 5.1 什么是性能基线？

性能基线是系统在「正常状态」下的性能指标基准值。它是判断性能是否退化的参照物：

```
┌──────────────────────────────────────────────────────────────┐
│                    性能基线 vs 实际表现                        │
│                                                              │
│  延迟(ms)                                                    │
│  1000 ┤                                          ╭──── 实际  │
│   800 ┤                                    ╭─────╯           │
│   600 ┤                              ╭─────╯                 │
│   400 ┤                        ╭─────╯                       │
│   200 ┤──────────────────────────────────────────── 基线     │
│     0 ┤                                                      │
│       └──┬────┬────┬────┬────┬────┬────┬────┬───            │
│         v1   v2   v3   v4   v5   v6   v7   v8               │
│                                                              │
│  当实际 P95 延迟 > 基线 × 1.5 时，触发性能告警               │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 k6 自动化基线管理

```javascript
// tests/load/baseline-manager.js
import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// 加载历史基线数据
const baseline = new SharedArray('baseline', function () {
  try {
    return [JSON.parse(open('./baseline.json'))];
  } catch (e) {
    return [{ p95: 300, p99: 800, error_rate: 0.01 }]; // 默认基线
  }
});

export const options = {
  scenarios: {
    baseline_check: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 30,
      maxVUs: 100,
    },
  },
  thresholds: {
    // 基线对比阈值
    http_req_duration: [
      `p(95)<${baseline[0].p95 * 1.5}`,  // 不超过基线的 1.5 倍
      `p(99)<${baseline[0].p99 * 1.5}`,
    ],
    errors: [`rate<${baseline[0].error_rate * 2}`],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  const endpoints = [
    '/api/v2/products?page=1',
    '/api/v2/products/1',
    '/api/v2/products/search?q=test',
    '/api/v2/categories',
  ];
  
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${endpoint}`, {
    headers: { 'Accept': 'application/json' },
  });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

// 测试结束时输出对比报告
export function handleSummary(data) {
  const currentP95 = data.metrics.http_req_duration.values['p(95)'];
  const currentP99 = data.metrics.http_req_duration.values['p(99)'];
  const baseP95 = baseline[0].p95;
  const baseP99 = baseline[0].p99;
  
  const p95Diff = ((currentP95 - baseP95) / baseP95 * 100).toFixed(1);
  const p99Diff = ((currentP99 - baseP99) / baseP99 * 100).toFixed(1);
  
  const summary = `
╔══════════════════════════════════════════════════════════╗
║                 性能基线对比报告                          ║
╠══════════════════════════════════════════════════════════╣
║  指标          基线        实际        差异              ║
║  ─────────────────────────────────────────────────────  ║
║  P95 延迟      ${baseP95}ms       ${currentP95.toFixed(0)}ms       ${p95Diff}%             ║
║  P99 延迟      ${baseP99}ms       ${currentP99.toFixed(0)}ms       ${p99Diff}%             ║
║  ─────────────────────────────────────────────────────  ║
║  状态: ${Math.abs(parseFloat(p95Diff)) < 20 ? '✅ 正常' : '⚠️ 需要关注'}                      ║
╚══════════════════════════════════════════════════════════╝
`;

  return {
    'stdout': summary,
    './results/summary.json': JSON.stringify(data, null, 2),
    // 更新基线文件（仅在 main 分支时）
    ...(exec.vu.idInInstance === 1 ? {
      './baseline.json': JSON.stringify({
        p95: currentP95,
        p99: currentP99,
        error_rate: data.metrics.errors.values.rate,
        updated_at: new Date().toISOString(),
      }, null, 2)
    } : {}),
  };
}
```

---

## 6. 对比分析：k6 vs Locust 深度对比

| 维度 | k6 | Locust | 推荐场景 |
|------|-----|--------|---------|
| **单机并发能力** | 极高（Go runtime，1000+ VU） | 中等（Python gevent，200-500 VU） | 高并发压测选 k6 |
| **分布式方案** | k6-operator (K8s) / k6 Cloud | 原生 Master-Worker | K8s 环境选 k6，裸机选 Locust |
| **脚本复杂度** | JS，适合简单场景 | Python，适合复杂逻辑 | 复杂业务流选 Locust |
| **CI/CD 集成** | 原生（thresholds + exit code） | 需要自定义包装 | CI 门禁选 k6 |
| **实时监控** | Grafana + InfluxDB | 内置 Web UI | 开发调试选 Locust |
| **浏览器测试** | k6 Browser（实验性） | 不支持 | 需要浏览器选 k6 |
| **社区生态** | Grafana 生态，文档完善 | Python 生态，插件丰富 | 看团队技术栈 |
| **学习曲线** | 低 | 低 | 都很容易上手 |

**我们的实践选择：**
- **CI/CD 性能门禁** → k6（thresholds 机制天然支持）
- **复杂业务流测试** → Locust（Python 的表达力更强）
- **日常回归测试** → k6（资源消耗低，速度快）
- **开发环境调试** → Locust（Web UI 直观）

---

## 7. 真实踩坑记录

### 7.1 坑1：k6 VU 数量设太高导致目标服务器 OOM

**现象：** k6 设置 500 VU，Laravel 应用容器 OOM 被 kill。

**根因：** 每个请求创建一个新的 PHP-FPM worker，500 并发 = 500 个 worker × 32MB 内存 ≈ 16GB。

**解决方案：**
```javascript
// 错误：直接设置 500 VU
export const options = {
  vus: 500,
  duration: '5m',
};

// 正确：阶梯式加压，观察服务器指标
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // 先用小流量验证
    { duration: '1m', target: 50 },    // 逐步增加
    { duration: '1m', target: 100 },   // 观察 CPU/内存
    { duration: '1m', target: 200 },   // 找到拐点
    { duration: '30s', target: 0 },
  ],
};
```

### 7.2 坑2：Locust 的 gevent monkey-patch 导致 Laravel HTTP 客户端异常

**现象：** Locust 测试中，使用 `requests` 库调用外部 API 时出现 `ConnectionError`。

**根因：** Locust 启动时会执行 `gevent.monkey.patch_all()`，影响所有 socket 操作。

**解决方案：**
```python
# 在 locustfile.py 顶部显式控制 patch
import gevent.monkey
gevent.monkey.patch_all(socket=True, dns=True, time=True, select=True, 
                         thread=False, os=False, ssl=True, subprocess=False)
```

### 7.3 坑3：k6 的 `http_req_duration` 包含了 DNS 解析时间

**现象：** k6 报告的 P95 延迟比 Nginx access log 高 50ms。

**根因：** k6 的 `http_req_duration` 包含 DNS 解析 + TCP 连接 + TLS 握手 + 数据传输的完整时间。

**解决方案：**
```javascript
// 使用分解指标
export function handleSummary(data) {
  const reqDuration = data.metrics.http_req_duration.values;
  const connecting = data.metrics.http_req_connecting.values;
  const tlsHandshaking = data.metrics.http_req_tls_handshaking.values;
  
  console.log(`总延迟 P95: ${reqDuration['p(95)']}ms`);
  console.log(`TCP 连接 P95: ${connecting['p(95)']}ms`);
  console.log(`TLS 握手 P95: ${tlsHandshaking['p(95)']}ms`);
  console.log(`纯服务端处理 P95: ${reqDuration['p(95)'] - connecting['p(95)'] - tlsHandshaking['p(95)']}ms`);
  
  return {};
}
```

### 7.4 坑4：Laravel 的 throttle 中间件干扰压测结果

**现象：** 压测开始 1 分钟后，大量 429 Too Many Requests。

**根因：** Laravel 默认的 `ThrottleRequests` 中间件限制了每分钟 60 次请求。

**解决方案：**
```php
// tests/load/LoadTestServiceProvider.php
namespace Tests\Load;

use Illuminate\Support\ServiceProvider;

class LoadTestServiceProvider extends ServiceProvider
{
    public function boot()
    {
        if (app()->environment('testing', 'loadtest')) {
            // 压测环境禁用限流
            \Illuminate\Routing\Router::flushMiddlewareGroups();
        }
    }
}

// 或者在 .env.loadtest 中配置
// APP_ENV=loadtest
// 然后针对压测环境单独配置路由中间件
```

---

## 8. 最佳实践与反模式

### ✅ 最佳实践

1. **阶梯式加压**：永远不要一开始就用最大并发，先用小流量验证脚本正确性
2. **设置思考时间**：`sleep()` 模拟真实用户行为，避免「机器人式」请求模式
3. **使用 `arrival-rate` 模式**：比 `vus` 模式更接近真实场景（控制 RPS 而非并发数）
4. **隔离测试环境**：压测环境应与开发/生产环境隔离，避免影响其他服务
5. **监控目标服务器**：压测时同步监控 CPU/内存/DB 连接/慢查询
6. **保存历史数据**：每次压测结果存入 InfluxDB/Prometheus，用于趋势分析

### ❌ 反模式

1. **直接对生产环境压测**：除非你有完善的限流和回滚机制
2. **只关注 QPS 忽略延迟**：高 QPS 下延迟飙升 = 用户体验崩溃
3. **固定 VU 模式压测**：不能模拟真实的流量波动
4. **不清理测试数据**：压测产生的脏数据会影响后续测试
5. **一次性压测**：负载测试应该是持续的，集成到 CI/CD 中

---

## 9. 扩展思考

### 9.1 k6 + Grafana 可视化

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   k6     │────►│ InfluxDB │◄────│ Grafana  │
│  (数据源) │     │  (存储)   │     │ (可视化)  │
└──────────┘     └──────────┘     └──────────┘
```

Grafana 提供了官方的 k6 Dashboard 模板（ID: 18030），可以实时展示：
- 请求速率（RPS）
- 延迟分布（P50/P90/P95/P99）
- 错误率
- VU 数量变化

### 9.2 性能测试的未来趋势

- **混沌工程 + 负载测试**：在压测的同时注入故障（网络延迟、服务宕机），验证系统的韧性
- **AI 驱动的负载生成**：基于生产环境的真实流量模式，自动生成压测脚本
- **eBPF 无侵入式性能分析**：在内核层面采集延迟数据，无需修改应用代码

### 9.3 局限性

- 负载测试结果受测试环境影响大，不能直接等同于生产环境表现
- 模拟的用户行为始终与真实用户有差距
- 分布式压测的网络延迟可能掩盖真实瓶颈

---

## 总结

| 场景 | 推荐工具 | 关键配置 |
|------|---------|---------|
| CI/CD 性能门禁 | k6 | `thresholds` + exit code |
| 复杂业务流测试 | Locust | Python + gevent |
| 高并发压测 | k6 | Go runtime，单机 1000+ VU |
| 开发环境调试 | Locust | 内置 Web UI |
| 持续性能监控 | k6 + Grafana | InfluxDB + Dashboard |

负载测试不是一次性的任务，而是持续的工程实践。将 k6/Locust 集成到 CI/CD 流水线中，建立性能基线，设置回归检测阈值，才能真正守护 API 的性能质量。

---

## 相关阅读

- [Postman/Apifox 实战：API 测试、Mock、自动化测试 — Laravel B2C API 踩坑记录](/categories/Engineering/postman-apifox-guide-apitesting-mock-automationtesting/)
- [Pest PHP API 测试、Feature 测试、浏览器测试实战：Laravel B2C API 测试金字塔落地踩坑记录](/categories/Engineering/pest-php-apitesting-featuretesting-testingguide/)
- [API 契约测试实战：Pact/Schemathesis 前后端接口一致性保障](/categories/工程化/2026-06-01-api-contract-testing-pact-schemathesis-frontend-backend-consistency/)
- [PHPUnit 11.x 实战：新特性与最佳实践——从 Laravel B2C API 的断言、属性到测试架构演进踩坑记录](/categories/05_PHP/Laravel/phpunit-11-x-guide-best-practices/)
- [Ktor 实战：Kotlin 原生 HTTP 框架异步服务端客户端开发与 Laravel API 性能基准对比](/categories/00_架构/Ktor-实战-Kotlin原生HTTP框架-异步服务端客户端开发与Laravel-API性能基准对比/)
