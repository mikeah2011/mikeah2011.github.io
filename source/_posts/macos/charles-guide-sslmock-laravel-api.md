
title: Charles-抓包工具高级用法实战-SSL代理Mock断点调试与-Laravel-API-联调踩坑记录
keywords: [Charles, SSL, Mock]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-05 08:11:02
updated: 2026-05-05 08:13:59
categories:
  - macos
  - php
tags:
- Laravel
- macOS
- Charles
- 抓包
- api调试
- Mock
- SSL
- proxyman
- fiddler
- mitmproxy
description: '本文是一份面向 macOS 开发者的 Charles 抓包工具深度实战指南，全面覆盖 HTTPS SSL 代理配置与证书信任、Breakpoints 断点调试实时篡改请求响应、Map Local 与 Map Remote 两种 Mock API 方案、Bandwidth Throttle 弱网模拟、Advanced Repeat 并发压测等高级功能。结合 Laravel BFF 聚合接口联调、Stripe 支付回调签名验证、Android/iOS 移动端抓包等真实踩坑场景，附带完整代码示例与工具对比表格，帮助前后端团队用 Charles 实现从开发 Mock 到联调排障的全流程提效。

  '
---


## 前言：为什么 Charles 在 B2C 团队中不可替代？

在 KKday B2C Backend Team 的日常开发中，调试工具链是这样的：

```
开发者 → IDE (Cursor/PhpStorm)
         ↓
     Laravel BFF API → Search / Recommend / Member 微服务
         ↓
     前端 (Vue 3) / 移动端 (iOS / Android) / 第三方回调 (Stripe / AliPay)
```

当你需要回答这些问题时，Charles 就成了唯一的答案：

- **前端说 API 返回 500，但 Postman 测试正常** → Charles 抓真实请求头和 Body
- **支付回调签名验证失败** → Charles Breakpoint 篡改请求体测试边界
- **后端还没写好，前端要联调** → Map Local 直接返回 Mock JSON
- **用户反馈 App 加载慢** → Bandwidth Throttle 模拟 3G 网络复现

> **Postman/Apifox 测的是"你构造的请求"，Charles 抓的是"真实发生的请求"。** 这个区别在排查 SSL Pinning、CORS、Cookie 传递等问题时至关重要。

---

## 一、Charles 安装与基础配置

### 1.1 安装方式

```bash
# Homebrew 安装（推荐）
brew install --cask charles

# 或者直接下载 https://www.charlesproxy.com/download/
# 注册码请支持正版：单用户 License $50/年
```

### 1.2 macOS 系统代理配置

Charles 启动后会自动设置系统代理，但有时需要手动确认：

```bash
# 查看当前系统代理设置
networksetup -getwebproxy Wi-Fi
networksetup -getsecurewebproxy Wi-Fi

# 手动设置（一般 Charles 自动处理）
networksetup -setwebproxy Wi-Fi 127.0.0.1 8888
networksetup -setsecurewebproxy Wi-Fi 127.0.0.1 8888
```

**踩坑 #1**：macOS Ventura 之后，系统偏好设置路径变了。如果 Charles 无法抓取 Safari 流量，去 **System Settings → Network → Wi-Fi → Details → Proxies** 手动检查。

### 1.3 Charles 界面速览

```
┌─────────────────────────────────────────────────────┐
│ Structure 视图 (按域名分组)    │  Sequence 视图 (按时间排序) │
├─────────────────────────────────────────────────────┤
│ api.kkday.com                                         │
│   ├── /v3/orders        GET    200   128ms           │
│   ├── /v3/orders        POST   201   342ms           │
│   └── /v2_1/products    GET    200   89ms            │
│ recommend.kkday.com                                   │
│   └── /v1/suggestions   GET    200   156ms           │
├─────────────────────────────────────────────────────┤
│ Overview | Request | Response | Summary | Chart       │
└─────────────────────────────────────────────────────┘
```

**实用技巧**：Structure 视图适合看整体架构调用链，Sequence 视图适合排查请求顺序和时序问题。调试 BFF 聚合请求时，我通常先用 Structure 看域名分布，再切到 Sequence 看调用时序。

---

## 二、SSL Proxying：抓取 HTTPS 流量

这是 Charles 最核心也最容易踩坑的功能。

### 2.1 开启 SSL Proxying

```
步骤：
1. Proxy → SSL Proxying Settings → 勾选 "Enable SSL Proxying"
2. 点击 "Add" 添加域名：
   Host: *.kkday.com    Port: 443
   Host: *.stripe.com   Port: 443
   Host: *              Port: 443   （调试时可以全放开）
3. 安装 Charles Root Certificate：
   Help → SSL Proxying → Install Charles Root Certificate
4. 在 Keychain Access 中找到 Charles 证书，双击 → Trust → Always Trust
```

### 2.2 移动端 SSL 证书安装

iOS 和 Android 需要额外安装 Charles CA 证书才能抓取 App 的 HTTPS 流量：

```bash
# 在 Charles 中开启移动端代理录制
Help → SSL Proxying → Install Charles Root Certificate on a Mobile Device

# 会弹出提示：在手机浏览器访问 chls.pro/ssl 下载证书
# iOS 14+ 还需要：Settings → General → VPN & Device Management → 启用证书
# iOS 还需要：Settings → General → About → Certificate Trust Settings → 启用
```

**踩坑 #2**：**Android 7+ 默认不信任用户安装的 CA 证书。** 如果你在调试 Android App 的 API 调用，需要 App 的 `network_security_config.xml` 配置：

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
            <certificates src="system" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
```

### 2.3 SSL Pinning 场景

如果 App 使用了 SSL Pinning（证书锁定），Charles 即使安装了 CA 证书也无法抓包。解决方式：

```swift
// iOS - 临时关闭 Pinning（仅 Debug 模式）
#if DEBUG
URLSession.shared.delegate = self // 信任所有证书
#endif
```

```kotlin
// Android - OkHttp 跳过证书验证（仅 Debug）
val client = OkHttpClient.Builder()
    .certificatePinner(CertificatePinner.Builder().build()) // 空 Pinning
    .build()
```

> **安全提醒**：SSL Pinning 绕过代码绝对不能进入生产构建。建议用 `BuildConfig.DEBUG` 或编译标志严格隔离。

---

## 三、Breakpoints 断点调试：实时篡改请求与响应

这是 Charles 最强大的功能之一，也是 Postman/Apifox 完全无法替代的场景。

### 3.1 配置 Breakpoints

```
步骤：
1. Proxy → Breakpoints Settings → Add
2. 配置匹配规则：
   Protocol: https
   Host: api.kkday.com
   Path: /v3/orders*
   勾选 Request 和/或 Response
3. 确认后，当匹配的请求发生时，Charles 会自动暂停
```

### 3.2 实战场景：模拟 API 错误返回

**场景**：前端需要处理 `503 Service Unavailable`，但你不想在 Laravel 代码里临时改返回。

```
1. 在 Charles Breakpoints 配置中匹配 API 路径
2. 当请求被拦截时，在 Response 面板中修改：
   - Status Code: 200 → 503
   - Body: 替换为 {"error": "Service Unavailable", "retry_after": 30}
3. 点击 "Execute" 放行修改后的响应
4. 前端立即收到 503 错误，可以验证错误处理逻辑
```

### 3.3 实战场景：模拟支付回调签名验证

**场景**：Stripe Webhook 回调的签名头 `Stripe-Signature` 被篡改后，Laravel 应该返回 400。

```php
// Laravel 端的 Webhook 签名验证
// app/Http/Controllers/StripeWebhookController.php
class StripeWebhookController extends Controller
{
    public function handleWebhook(Request $request)
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');
        
        try {
            $event = \Stripe\Webhook::constructEvent(
                $payload,
                $sigHeader,
                config('services.stripe.webhook_secret')
            );
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            // Charles Breakpoint 篡改签名后，应该走到这里
            Log::warning('Stripe webhook signature invalid', [
                'signature' => $sigHeader,
                'ip' => $request->ip(),
            ]);
            return response()->json(['error' => 'Invalid signature'], 400);
        }
        
        // 正常处理...
    }
}
```

**用 Charles 测试**：

```
1. Breakpoint 匹配 POST /webhooks/stripe
2. 拦截后，在 Request Headers 中修改 Stripe-Signature:
   原始: t=1621234567,v1=abc123...
   修改: t=1621234567,v1=TAMPERED_SIGNATURE
3. Execute → Laravel 应该返回 400
```

**踩坑 #3**：Breakpoint 拦截后如果不及时点 Execute，请求会超时。Charles 默认超时是 60 秒，可以在 **Proxy → Recording Settings → Limit** 中调整。调试复杂场景时，建议先想好要修改什么，再触发请求。

---

## 四、Map Local / Map Remote：Mock 响应

### 4.1 Map Local：本地文件替代远程响应

**场景**：后端 API 还没开发完，前端需要用 Mock 数据联调。

**步骤**：

```
1. 准备本地 JSON 文件：
   ~/mocks/api/v3/orders/detail.json
   
   {
     "code": 200,
     "data": {
       "order_id": "ORD-20260505-001",
       "status": "confirmed",
       "items": [
         {
           "product_name": "东京铁塔门票",
           "quantity": 2,
           "unit_price": 1500,
           "currency": "TWD"
         }
       ],
       "total_amount": 3000,
       "created_at": "2026-05-05T08:00:00+08:00"
     }
   }

2. Charles 中：Tools → Map Local → Add
   Protocol: https
   Host: api.kkday.com
   Path: /v3/orders/*
   Local path: ~/mocks/api/v3/orders/detail.json
```

**前端代码验证**：

```javascript
// Vue 3 + axios 调用示例
const { data } = await axios.get('/api/v3/orders/ORD-20260505-001')
console.log(data.data.order_id) // "ORD-20260505-001" — 来自本地文件
console.log(data.data.items[0].product_name) // "东京铁塔门票"
```

### 4.2 Map Remote：请求转发到不同服务器

**场景**：本地开发环境的 Laravel 跑在 `localhost:8000`，但前端配置的 API 地址是 `api.kkday.com`。

```
Tools → Map Remote → Add
  From: https://api.kkday.com:443
  To:   http://localhost:8000

效果：前端请求 api.kkday.com → Charles 转发到 localhost:8000
```

**踩坑 #4**：Map Remote 转发后，`Host` 请求头会变成 `localhost:8000`，如果 Laravel 的 `TrustProxies` 中间件或 `URL::forceRootUrl()` 没配好，生成的 URL 会出错。解决方案：

```php
// app/Http/Middleware/TrustProxies.php
protected $proxies = '*'; // 开发环境信任所有代理

// 或在 .env 中强制 URL
// APP_URL=https://api.kkday.com
```

### 4.3 Map Local 进阶：动态 Mock 响应

Charles 原生 Map Local 不支持动态响应，但可以配合一个简单的本地 Node.js 服务实现：

```javascript
// mock-server.js
const http = require('http')
const url = require('url')

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true)
  
  // 根据请求路径返回不同 Mock
  if (parsed.pathname.match(/\/v3\/orders\/\w+/)) {
    const orderId = parsed.pathname.split('/').pop()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      code: 200,
      data: {
        order_id: orderId,
        status: Math.random() > 0.5 ? 'confirmed' : 'pending', // 动态状态
        random_seed: Math.random() // 每次不同
      }
    }))
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.listen(3001, () => console.log('Mock server on :3001'))
```

然后用 Map Remote 把 `api.kkday.com` 转发到 `localhost:3001`。

---

## 五、Bandwidth Throttle：弱网模拟

### 5.1 配置限速

**场景**：用户在东南亚使用 3G 网络访问 KKday App，需要验证加载体验。

```
Proxy → Throttle Settings → Enable Throttling
选择预设：3G (780 kbps down / 384 kbps up / 200ms latency)

或者自定义：
  Bandwidth: 512 Kbps
  Utilisation: 80%
  Latency: 300ms
  MTU: 1500
  Reliability: 90%    ← 模拟丢包
  Stability: 85%      ← 模拟连接不稳定
```

### 5.2 仅对特定域名限速

```
Throttle Settings → Only for selected hosts → Add:
  api.kkday.com      ← 只限速 API
  cdn.kkday.com      ← 不限速静态资源（CDN 本来就快）
```

**踩坑 #5**：开启 Throttle 后，Charles 自身也会变慢。如果同时开启了 SSL Proxying + Breakpoints + Throttle，调试体验会很痛苦。建议分步骤测试，不要同时开启所有功能。

---

## 六、Repeat / Advanced Repeat：压力测试

### 6.1 Repeat 请求

右键点击任意请求 → **Repeat**（或 Ctrl+R）可以快速重发单个请求。

### 6.2 Advanced Repeat：并发测试

```
右键 → Advanced Repeat
  Iterations: 100     ← 发送 100 次
  Concurrency: 10     ← 同时 10 个并发
  Repeat Delay: 0ms   ← 无延迟
```

**实战场景**：快速验证 Laravel API 的幂等性。

```php
// 测试订单创建的幂等性（防重复提交）
// 同一个 idempotency_key 发送 100 次，应该只创建 1 个订单
Route::post('/v3/orders', function (Request $request) {
    $key = $request->header('Idempotency-Key');
    
    return DB::transaction(function () use ($request, $key) {
        $existing = Order::where('idempotency_key', $key)->first();
        if ($existing) {
            return response()->json([
                'code' => 200,
                'data' => $existing,
                'message' => 'Order already exists (idempotent)'
            ], 200); // 返回 200 而非 201
        }
        
        return Order::create([...]);
    });
});
```

用 Charles Advanced Repeat 并发发送同一个请求 100 次，检查是否只创建了 1 条记录。

---

## 七、实战工作流：BFF 联调完整流程

以 Laravel BFF 聚合 Search + Recommend + Member 三个微服务为例：

```
┌──────────┐    ┌──────────────┐    ┌────────────┐
│  Vue 3   │───→│ Charles Proxy│───→│ Laravel BFF│
│  前端     │    │  (localhost  │    │  (API)     │
└──────────┘    │   :8888)     │    └─────┬──────┘
                └──────────────┘          │
                                    ┌─────┼──────┐
                                    ↓     ↓      ↓
                               Search Recommend Member
```

### Step 1: 抓取前端真实请求

```bash
# 确认 Charles 正在录制
# 在 Vue 3 前端触发页面加载
# Charles 中观察请求链：
# 1. GET /v3/products/search?q=tokyo     → Search Service
# 2. GET /v3/recommend?user_id=123       → Recommend Service  
# 3. GET /v3/member/profile              → Member Service
# 4. GET /v3/bff/homepage?user_id=123    → BFF 聚合接口（包含上面 3 个的结果）
```

### Step 2: Breakpoint 拦截 BFF 响应，注入延迟

```
模拟 Search Service 超时的场景：
1. Breakpoint 匹配 /v3/bff/homepage
2. 拦截 Response
3. 在 Edit Response 中添加 artificial delay 或修改 body
4. 观察前端的 loading 状态和超时处理
```

### Step 3: Map Local 提供 Mock 数据继续开发

```
后端 BFF 接口修改中，前端用 Map Local 继续开发：
~/mocks/bff/homepage.json → 包含聚合后的完整数据结构
前端开发者无需等待后端完成
```

---

## 八、Charles 常见问题与排错

### Q1: Charles 抓不到 Chrome 的流量？

```bash
# Chrome 可能使用了自己的代理设置
# 方案 1：启动 Chrome 时指定代理
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --proxy-server="http://127.0.0.1:8888"

# 方案 2：安装 SwitchyOmega 扩展，配置 Charles 代理
# 方案 3：检查 Chrome 是否开启了 "Secure DNS"（会绕过代理）
# chrome://settings/security → 关闭 "Use secure DNS"
```

### Q2: Charles 启动后报 "Port 8888 already in use"？

```bash
# 找出占用端口的进程
lsof -i :8888
# 或者
netstat -an | grep 8888

# Kill 占用进程
kill -9 $(lsof -t -i :8888)

# 或者修改 Charles 端口
# Proxy → Proxy Settings → HTTP Proxy → Port: 8889
```

### Q3: Charles 证书过期导致无法抓取 HTTPS？

```bash
# 重新生成 Charles 证书
Help → SSL Proxying → Reset Charles Root Certificate

# 然后重新安装到 Keychain
# Keychain Access → Charles Proxy → Trust → Always Trust
```

### Q4: Charles 导出请求数据用于分析？

```
File → Export Session → 选择格式：
  - .chls (Charles Session)  ← 以后可以重新打开
  - .har (HTTP Archive)       ← 兼容 Chrome DevTools
  - .xml / .csv               ← 数据分析
```

---

## 九、Charles vs 其他工具对比

| 特性 | Charles | Proxyman | mitmproxy | Fiddler |
|------|---------|----------|-----------|---------|
| GUI | ✅ 优秀 | ✅ 原生 macOS 设计 | ❌ CLI/Web UI | ✅ Windows 为主 |
| SSL Proxying | ✅ | ✅ 自动安装证书 | ✅ | ✅ |
| Breakpoints | ✅ | ✅ 脚本化 | ✅ (Python 脚本) | ✅ |
| Map Local | ✅ | ✅ 内置 Scripting | ✅ (脚本) | ✅ |
| Map Remote | ✅ | ✅ | ✅ | ✅ |
| 弱网模拟 | ✅ | ✅ | ❌ 需外部工具 | ✅ |
| 跨平台 | macOS/Win/Linux | macOS/iOS only | 全平台 | macOS/Win/Linux |
| 脚本扩展 | 有限 | ✅ JavaScript | ✅ Python Addon | ✅ JScript.NET |
| 价格 | $50/年 | 免费(基础)/付费 | 免费开源 | 免费 |

**如何选择？**

- **macOS + iOS 开发**：首选 **Proxyman**（原生体验、自动证书管理、免费基础版），Charles 作为备选
- **macOS + 全平台调试**：**Charles**（功能全面、跨平台支持好）
- **Linux / CI 环境**：**mitmproxy**（脚本化能力强、适合自动化）
- **Windows 为主**：**Fiddler**（Windows 原生支持好、免费）
- **团队协作**：Charles + Postman/Apifox 互补（Charles 抓真实请求，Postman 构造测试请求）

> **核心区别**：Postman/Apifox 测的是"你构造的请求"，Charles/Proxyman/mitmproxy 抓的是"真实发生的请求"，两者互补而非替代。

---

## 十、移动端 SSL 代理完整配置指南

### 10.1 iOS 设备配置（iOS 16+ 完整流程）

```bash
# 步骤 1：确保 Charles 正在运行并开启 SSL Proxying
# Help → SSL Proxying → Install Charles Root Certificate on a Mobile Device
# 会显示一个临时 URL，格式如：http://charlesproxy.com/getssl

# 步骤 2：在 iPhone 上打开 Safari
# 访问 http://charlesproxy.com/getssl 或 http://chls.pro/ssl
# 系统会提示"此网站正尝试下载一个配置描述文件" → 允许

# 步骤 3：安装描述文件
# Settings → General → VPN & Device Management → 找到 Charles Proxy → 安装
# 输入锁屏密码确认

# 步骤 4：启用信任（关键步骤，很多人遗漏！）
# iOS 15+ 路径：Settings → General → About → Certificate Trust Settings
# 找到 "Charles Proxy" → 开启信任开关

# 步骤 5：验证证书是否生效
# 打开浏览器访问 https://charlesproxy.com
# 如果能看到页面（而非证书错误），说明配置成功
```

**iOS 15+ 特别注意事项**：

> ⚠️ **iOS 15 开始，Apple 引入了更严格的证书信任机制**。即使安装了描述文件，
> 如果没有在 Certificate Trust Settings 中手动启用，所有 HTTPS 请求都会显示
> "无法验证服务器身份"。这是 iOS 15 之后最常见的 Charles 抓包失败原因。

### 10.2 Android 设备配置

```bash
# 步骤 1：手机连接到与 Mac 相同的 Wi-Fi 网络

# 步骤 2：在 Charles 中开启移动端代理录制
# Help → SSL Proxying → Install Charles Root Certificate on a Mobile Device
# 记录显示的 IP 和端口（如 192.168.1.100:8888）

# 步骤 3：手机 Wi-Fi 设置 → 长按当前网络 → 修改网络 → 高级
# 代理设置：手动
#   主机名：192.168.1.100
#   端口：8888
#   必填域：留空

# 步骤 4：安装证书
# 用手机浏览器访问 http://chls.pro/ssl
# 下载 .pem 证书文件
# Android 12+ 路径：Settings → Security → Encryption & Credentials
#   → Install a Certificate → CA Certificate → 选择下载的文件

# 步骤 5（Android 7+ 关键）：修改 App 代码信任用户证书
```

```xml
<!-- res/xml/network_security_config.xml -->
<!-- Android 7+ 必须配置，否则 App 无法抓包 -->
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- 仅 Debug 构建信任用户证书 -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
            <certificates src="system" />
        </trust-anchors>
    </debug-overrides>

    <!-- 或者为特定域名信任（更精确） -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">api.example.com</domain>
        <trust-anchors>
            <certificates src="user" />
        </trust-anchors>
    </domain-config>
</network-security-config>
```

```xml
<!-- AndroidManifest.xml 中引用配置 -->
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ... >
</application>
```

### 10.3 localhost 映射问题

当使用 Map Remote 将远程域名映射到 `localhost` 时，移动端设备无法访问 Mac 的 `localhost`：

```bash
# 解决方案：使用 Mac 的局域网 IP 替代 localhost
# 查看 Mac 的 IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Map Remote 配置：
#   From: https://api.kkday.com:443
#   To:   http://192.168.1.100:8000  ← 使用局域网 IP，不要用 localhost

# 同时确保 Laravel 开发服务器监听 0.0.0.0 而非 127.0.0.1
php artisan serve --host=0.0.0.0 --port=8000

# 或者使用 Laravel Valet（自动处理局域网访问）
```

---

## 十一、常见坑点与排错指南

### SSL 证书相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| iOS 显示"无法验证服务器" | 证书未在 Trust Settings 中启用 | Settings → About → Certificate Trust Settings → 开启 |
| Android App 抓包空白 | Android 7+ 不信任用户 CA | 配置 `network_security_config.xml` |
| Charles 提示 SSL 错误 | 证书过期或被撤销 | Help → SSL Proxying → Reset Certificate |
| 部分域名抓不到 | 未添加到 SSL Proxying 白名单 | Proxy → SSL Proxying Settings → 添加 `*.domain.com` |

### 网络与代理相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Chrome 流量抓不到 | Chrome 使用自己的代理设置 | 启动时加 `--proxy-server=http://127.0.0.1:8888` |
| Safari 抓不到 | macOS Ventura 代理路径变了 | System Settings → Network → Wi-Fi → Details → Proxies |
| 端口 8888 被占用 | 其他程序占用了端口 | `lsof -i :8888` 找到并 kill，或改 Charles 端口 |
| Charles 启动后断网 | 代理配置未正确恢复 | Proxy → macOS Proxy → 取消勾选，或重启网络 |

### iOS 15+ / iOS 16 新增问题

```bash
# 问题：iOS 15+ 新增了 "Private Relay" 功能会绕过代理
# 解决：关闭 iCloud Private Relay
# Settings → Apple ID → iCloud → Private Relay → 关闭

# 问题：iOS 16 Safari 的 "Hide IP Address" 功能
# 可能影响某些代理场景
# Settings → Safari → Hide IP Address → 关闭

# 问题：iOS 16+ 新增的 "iCloud Hide My Email" 
# 不影响 Charles，但某些 App 的 OAuth 登录可能有变化
```

### Certificate Pinning（证书锁定）处理

```bash
# 方案 1：Debug 构建绕过（推荐）
# iOS - 在 AppDelegate 中临时信任所有证书
#if DEBUG
URLSessionDelegate {
    func urlSession(_ session: URLSession, 
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // ⚠️ 仅在 Debug 构建中使用！
        completionHandler(.useCredential, URLCredential(trust: challenge.protectionSpace.serverTrust!))
    }
}
#endif

# 方案 2：使用 Frida 动态绕过（适合第三方 App）
# 需要 root 权限，仅用于安全研究
frida -U -f com.app.bundleid -l bypass.js --no-pause

# 方案 3：使用 Proxyman 的 SSL Proxying 自动绕过（部分 App 有效）
# Proxyman 内置了一些常见 App 的 pinning bypass
```

> **安全提醒**：证书绕过代码绝对不能进入生产构建。建议使用条件编译
> （Swift `#if DEBUG` / Kotlin `BuildConfig.DEBUG`）严格隔离。

---

## 踩坑记录汇总

| # | 踩坑点 | 解决方案 |
|---|--------|---------|
| 1 | macOS Ventura 代理设置路径变了 | System Settings → Network → Wi-Fi → Details → Proxies |
| 2 | Android 7+ 不信任用户 CA 证书 | `network_security_config.xml` 配置 `debug-overrides` |
| 3 | Breakpoint 拦截后忘记 Execute 导致超时 | 先想好修改内容再触发请求，调高 Charles 超时时间 |
| 4 | Map Remote 后 Host 头变了 | Laravel TrustProxies 配置 `'*'` 或 `forceRootUrl` |
| 5 | 同时开启 SSL + Breakpoints + Throttle 导致卡顿 | 分步骤测试，不要同时开启所有功能 |

---

## 总结

Charles 不只是一个"抓包工具"，它是 **B2C 团队前后端联调的核心基础设施**。在我的日常工作流中：

1. **开发阶段**：Map Local Mock 接口，前端不等后端
2. **联调阶段**：Breakpoints 模拟各种异常场景
3. **测试阶段**：Bandwidth Throttle 模拟弱网环境
4. **排查阶段**：SSL Proxying 抓取真实请求定位问题
5. **压测阶段**：Advanced Repeat 快速验证幂等性和并发安全

掌握 Charles 的高级用法，能让你在前后端协作中从"被动等待"变成"主动调试"，这在 30+ 仓库的大团队协作中尤为重要。

---

## 相关阅读

- [PHPStorm-高效开发实战-快捷键-Live-Templates-调试技巧-Laravel-B2C-API踩坑记录](/categories/macOS/Editor/phpstorm-guide-live-templates/)
- [VS Code 高效开发实战：扩展、快捷键、调试配置 - Laravel B2C API 踩坑记录](/categories/macOS/vs-code-guide/)
- [Xdebug 实战：远程调试、性能分析、代码覆盖率——Laravel B2C API 开发者完整指南](/categories/PHP/xdebug-guide/)
