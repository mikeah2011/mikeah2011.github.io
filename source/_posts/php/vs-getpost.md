---

title: GET 与 POST的区别
keywords: [GET, POST, 的区别]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- HTTP
- get
- post
- RESTful
- PHP
- 网络编程
categories:
- php
date: 2019-03-20 15:05:07
description: 深入解析 HTTP 协议中 GET 与 POST 请求方法的本质区别，涵盖语义与幂等性、TCP 数据包发送机制、请求体大小限制真相、RESTful API 设计规范、安全性分析及常见误区纠正，并提供 PHP $_GET/$_POST 使用示例与 cURL 测试方法，帮助开发者全面理解两种请求方法的正确使用场景与安全最佳实践。
---




## 基本对比

|     比较     |                GET                 |          POST          |
| :----------: | :--------------------------------: | :--------------------: |
| 浏览器回退时 |                无害                |     会再次提交请求     |
|   BookMark   |       URL地址可以被BookMark        |         不可以         |
|     编码     |           仅支持URL编码            |      多种编码方式      |
|     缓存     |         会被浏览器主动缓存         | 不会缓存，除非手动设置 |
|   历史记录   | 参数会被完整的保留在浏览器历史记录 |     参数不会被保留     |
|     限制     |      根据各浏览器会被限制长度      |          没有          |
|   数据类型   |          仅支持ASCII字符           |        没有限制        |
|    安全性    |          低，暴露在URL上           |        相对较高        |
|   传递方式   |            拼接在URL上             |   放在Request Body中   |
|  TCP数据包   |                1个                 |          2个           |

## HTTP 协议层面的本质区别

### 语义与幂等性

GET 和 POST 在 HTTP/1.1 规范（RFC 7231）中有明确定义的语义：

- **GET**：用于**获取资源**，是一个**安全**且**幂等**的操作。安全意味着不会修改服务器状态，幂等意味着无论请求多少次，结果都相同。
- **POST**：用于**提交数据**，既**不安全**也**不幂等**。每次请求都可能在服务器端产生不同的结果（如重复创建订单）。

```text
GET  /api/users/1    → 获取 ID 为 1 的用户信息（安全、幂等）
POST /api/users      → 创建一个新用户（不安全、不幂等）
```

> **幂等性**是 API 设计中的关键概念。GET、PUT、DELETE 都是幂等的，而 POST 不是。这意味着网络超时重试时，GET 请求可以安全地重发，而 POST 可能导致重复操作。

### 请求报文结构差异

GET 请求的报文：

```text
GET /api/users?page=1 HTTP/1.1
Host: example.com
Accept: application/json
```

POST 请求的报文：

```text
POST /api/users HTTP/1.1
Host: example.com
Content-Type: application/json
Content-Length: 42

{"name":"张三","email":"zhangsan@test.com"}
```

POST 请求多了一个 **Request Body**，并需要通过 `Content-Type` 声明数据格式。

## PHP cURL 实战：GET 与 POST 的真实差异

命令行的 `curl` 与 PHP 的 `curl_*` 函数族可以让你在服务端模拟不同的 HTTP 请求方法。以下示例展示了两者在底层行为上的关键差异。

### PHP cURL 发送 GET 请求

```php
<?php
$ch = curl_init();

// GET 请求：参数编码到 URL 中
$params = http_build_query(['page' => 1, 'limit' => 10, 'keyword' => 'PHP']);
$url = "https://api.example.com/users?" . $params;

curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,    // 将响应以字符串返回，不直接输出
    CURLOPT_HEADER         => true,    // 包含响应头
    CURLOPT_VERBOSE        => true,    // 打印调试信息（包含请求报文）
    CURLOPT_TIMEOUT        => 10,
]);

$response = curl_exec($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$header = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);

echo "=== 请求报文（GET） ===\n";
echo $header;
echo "=== 响应体 ===\n";
echo $body;

// 输出：GET /api/users?page=1&limit=10&keyword=PHP HTTP/1.1
//       参数全部在 URL 中，Body 为空

curl_close($ch);
```

### PHP cURL 发送 POST 请求

```php
<?php
$ch = curl_init();

// POST 请求：参数放在 Request Body 中
$url = "https://api.example.com/users";
$data = json_encode([
    'name'  => '张三',
    'email' => 'zhangsan@test.com',
    'role'  => 'admin'
]);

curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_POST           => true,     // 核心：声明为 POST 请求
    CURLOPT_POSTFIELDS     => $data,    // Request Body 数据
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_VERBOSE        => true,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($data),
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT        => 10,
]);

$response = curl_exec($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$header = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);

echo "=== 请求报文（POST） ===\n";
echo $header;
echo "=== 响应体 ===\n";
echo $body;

// 输出：POST /api/users HTTP/1.1
//       Content-Type: application/json
//       {"name":"张三","email":"zhangsan@test.com","role":"admin"}
//       URL 不含参数，数据在 Body 中

curl_close($ch);
```

### 用 cURL 对比两种方法的响应差异

```php
<?php
/**
 * 同一 API 端点，GET 和 POST 的行为差异对比
 * GET: 查询用户列表（幂等，安全）
 * POST: 创建新用户（不幂等，不安全）
 */

function curlRequest(string $method, string $url, ?string $body = null): array
{
    $ch = curl_init();

    $options = [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 15,
    ];

    if ($method === 'POST') {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = $body;
        $options[CURLOPT_HTTPHEADER] = [
            'Content-Type: application/json',
        ];
    }

    curl_setopt_array($ch, $options);
    $response = curl_exec($ch);

    $info = [
        'http_code'    => curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'total_time'   => curl_getinfo($ch, CURLINFO_TOTAL_TIME),
        'request_size' => curl_getinfo($ch, CURLINFO_REQUEST_SIZE),
    ];
    curl_close($ch);

    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $info['body'] = substr($response, $headerSize);
    return $info;
}

// GET 请求 —— 幂等：无论调用多少次，结果相同
$get = curlRequest('GET', 'https://api.example.com/users?page=1');
echo "GET 响应码: {$get['http_code']}，耗时: {$get['total_time']}s\n";
// GET 重复调用：结果一致，可安全重试

// POST 请求 —— 非幂等：每次调用可能创建不同资源
$post = curlRequest('POST', 'https://api.example.com/users', json_encode([
    'name'  => '李四',
    'email' => 'lisi@test.com',
]));
echo "POST 响应码: {$post['http_code']}，耗时: {$post['total_time']}s\n";
// POST 重复调用：可能创建多个用户！网络超时重试需格外小心
```

> **踩坑提醒**：网络超时时 POST 请求被重试，可能导致重复下单、重复支付等严重问题。解决方案是使用 **幂等键（Idempotency Key）**：客户端生成唯一 key 放入请求头，服务端检查是否已处理过该 key。

### 常见踩坑案例

#### 踩坑 1：GET 参数中有特殊字符导致请求截断

URL 中的特殊字符（如 `&`、`=`、`+`、中文）必须经过编码，否则会被服务器错误解析。很多开发者在拼接 URL 时直接拼接用户输入，导致参数被截断。

```php
<?php
// ❌ 错误做法：直接拼接用户输入
$keyword = $_GET['keyword']; // 用户输入: "PHP & MySQL"
$url = "https://api.example.com/search?keyword=" . $keyword;
// 实际请求: /search?keyword=PHP & MySQL
// & 之后的 MySQL 被解析为另一个参数！

// ✅ 正确做法：使用 http_build_query 自动编码
$params = http_build_query(['keyword' => $keyword]);
$url = "https://api.example.com/search?" . $params;
// 实际请求: /search?keyword=PHP+%26+MySQL
// 编码后安全传输
```

#### 踩坑 2：POST JSON 但未设置 Content-Type

PHP 的 `$_POST` 超全局变量只解析 `application/x-www-form-urlencoded` 和 `multipart/form-data` 两种编码。发送 JSON 时如果不设置 `Content-Type: application/json`，服务端的 `$_POST` 会是空数组。

```php
<?php
// 客户端发送 JSON（未设置 Content-Type）
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
// 缺少 Content-Type: application/json

// 服务端接收
var_dump($_POST);  // 结果: array(0) {}  —— 空数组！

// ✅ 正确做法：客户端必须设置 Content-Type
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
]);

// 服务端用 php://input 手动解析
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
var_dump($data);   // 结果: 正确获取到数据
```

#### 踩坑 3：GET 请求缓存导致数据过期

GET 请求会被浏览器和 CDN 缓存，导致用户看到旧数据。这在实时性要求高的场景（如股票行情、未读消息数）中是严重问题。

```php
<?php
// ❌ 问题场景：GET 接口被缓存，用户看到旧数据
echo json_encode(['unread_count' => $count]);

// ✅ 解决方案 1：禁用缓存
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
echo json_encode(['unread_count' => $count]);

// ✅ 解决方案 2：URL 加时间戳（前端方案）
// fetch('/api/messages?_t=' + Date.now())

// ✅ 解决方案 3：使用 POST 替代（牺牲语义换缓存控制）
// POST 默认不缓存，适合实时数据查询
```

#### 踩坑 4：超大 POST 请求导致 PHP 超时

PHP 的 `max_execution_time` 默认为 30 秒，大文件上传或大批量数据提交容易超时。此外 `post_max_size` 限制可能导致数据静默丢失。

```php
<?php
// 检查 POST 数据是否因超出限制被截断
if (empty($_POST) && !empty($_SERVER['CONTENT_LENGTH'])) {
    $maxPost = ini_get('post_max_size');  // 如 "8M"
    $maxBytes = intval($maxPost) * (strpos($maxPost, 'M') ? 1048576 : 1);

    if ($_SERVER['CONTENT_LENGTH'] > $maxBytes) {
        throw new RuntimeException(
            "POST 数据超出限制：请求 {$maxBytes} bytes，" .
            "超过 post_max_size={$maxPost}"
        );
    }
}

// 配置建议：php.ini
// post_max_size = 50M          ; 根据业务需求调整
// max_execution_time = 120     ; 大文件上传需要更长时间
// max_input_time = 120         ; 接收数据的时间限制
```

#### 踩坑 5：GET 参数长度超限导致 414 错误

虽然 HTTP 协议没有限制 URL 长度，但 Nginx 默认 `large_client_header_buffers` 为 8KB，超过后返回 `414 Request-URI Too Large`。很多开发者在搜索功能中拼接大量筛选条件，容易触发此限制。

```php
<?php
// ❌ 错误：将复杂筛选条件全部放入 GET 参数
$url = '/api/products?' . http_build_query([
    'category'   => 'electronics',
    'brand'      => ['apple', 'samsung', 'huawei'],
    'price_min'  => 1000,
    'price_max'  => 8000,
    'features'   => ['5g', 'nfc', 'wireless_charging'],
    'sort'       => 'price_asc',
    'in_stock'   => true,
    'warranty'   => '2years',
    // ... 更多参数
]);
// URL 可能超过 2KB，触发 414 错误

// ✅ 正确做法：复杂查询使用 POST
$url = '/api/products/search';
$data = [
    'category'   => 'electronics',
    'brand'      => ['apple', 'samsung', 'huawei'],
    'price_min'  => 1000,
    'price_max'  => 8000,
    'features'   => ['5g', 'nfc', 'wireless_charging'],
    'sort'       => 'price_asc',
    'in_stock'   => true,
    'warranty'   => '2years',
];
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
```

#### 踩坑 6：使用 file_get_contents 发送 POST 请求的陷阱

PHP 的 `file_get_contents` 配合 `stream_context_create` 可以发送 POST 请求，但默认不处理 HTTPS 证书验证，且错误处理不直观。

```php
<?php
// ❌ 常见问题：SSL 验证失败但没有报错信息
$context = stream_context_create([
    'http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\n",
        'content' => json_encode($data),
    ],
]);
$response = file_get_contents('https://api.example.com/users', false, $context);
// 如果 SSL 证书验证失败，$response 可能为 false，但无错误信息

// ✅ 推荐：使用 cURL（更完善的错误处理）
$ch = curl_init('https://api.example.com/users');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($data),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_SSL_VERIFYPEER => true,     // 验证 SSL 证书
    CURLOPT_SSL_VERIFYHOST => 2,        // 验证主机名
    CURLOPT_TIMEOUT        => 10,
]);
$response = curl_exec($ch);
if (curl_errno($ch)) {
    throw new RuntimeException('cURL 错误: ' . curl_error($ch));
}
curl_close($ch);
```

### GET 与 POST 选择决策流程

在实际开发中，如何选择 GET 还是 POST？可以遵循以下决策流程：

```text
需要查询数据？ ──→ 使用 GET
    │
    ├── 参数少且简单？ ──→ GET + URL 参数 ✅
    ├── 参数多或复杂？ ──→ POST + JSON Body ✅
    │
需要提交/修改数据？ ──→ 使用 POST / PUT / DELETE
    │
    ├── 创建资源？ ──→ POST
    ├── 更新资源？ ──→ PUT（全量） / PATCH（部分）
    └── 删除资源？ ──→ DELETE
    │
需要上传文件？ ──→ 使用 POST + multipart/form-data
    │
    ├── 小文件（< 1MB） ──→ 直接上传 ✅
    └── 大文件（> 1MB） ──→ 分片上传 + 断点续传 ✅
    │
对实时性要求高？ ──→ 避免 GET 缓存
    ├── 禁用缓存头 ──→ GET + Cache-Control: no-cache
    └── 改用 POST ──→ POST 默认不缓存
```

> **一句话总结**：GET 用于获取资源（查询），POST 用于提交数据（创建/修改）。不确定时问自己：这个操作是否安全且幂等？是则用 GET，否则用 POST。

## TCP 数据包发送机制详解

上表中提到 GET 发送 1 个 TCP 数据包，POST 发送 2 个，这个说法需要更准确地理解。

### GET 的 TCP 行为

GET 请求将请求头和数据一起发送，服务器收到后直接返回响应。整个过程只需要**一次 TCP 往返**。

### POST 的 TCP 行为（两阶段）

1. **第一阶段**：浏览器先发送请求头（Headers），不包含 Body 数据。
2. **第二阶段**：服务器返回 `100 Continue` 状态码后，浏览器再发送 Body 数据。

这就是所谓"POST 发送 2 个 TCP 数据包"的由来。

### 真实情况

> ⚠️ **重要澄清**：这是浏览器对 HTTP 协议的**实现行为**，而非协议的硬性规定。现代 HTTP 客户端（如 cURL）和 HTTP/2 协议可能会合并发送。`Expect: 100-continue` 头部可以控制此行为，不是所有 POST 请求都会触发两阶段发送。

## 请求体大小限制的真相

### GET 的大小限制

GET 请求的参数附在 URL 上，URL 的长度限制**不是 HTTP 协议规定的**，而是：

- **IE 浏览器**：URL 最大 2083 个字符
- **Firefox**：约 65536 个字符
- **Chrome**：约 2MB（实际取决于服务器）
- **Nginx 默认**：`large_client_header_buffers` 限制为 8KB
- **Apache 默认**：`LimitRequestLine` 限制为 8190 字节

实际上 GET 请求**也可以携带 Body**（虽然不推荐），协议并未禁止。

### POST 的大小限制

POST 请求体的大小同样**没有协议层面的限制**，但实际受限于：

- **Nginx**：`client_max_body_size`（默认 1MB）
- **Apache**：`LimitRequestBody`（默认无限制）
- **PHP**：`post_max_size`（默认 8MB）、`upload_max_filesize`（默认 2MB）

```nginx
# Nginx 配置示例：允许上传 50MB
client_max_body_size 50m;
```

```ini
; PHP 配置示例
post_max_size = 50M
upload_max_filesize = 50M
max_file_uploads = 20
```

## HTTP/2 与 HTTP/3 下 GET/POST 的变化

### HTTP/2 的多路复用消除了 POST 的延迟劣势

在 HTTP/1.1 中，每个请求独占一个 TCP 连接（或需要排队等待 keep-alive 连接），POST 的两阶段发送会增加延迟。HTTP/2 引入了**多路复用（Multiplexing）**机制，多个请求可以在同一个 TCP 连接上并行传输，数据帧可以交错发送，因此 POST 的两阶段行为不再成为性能瓶颈。

```text
HTTP/1.1：GET 快，POST 慢（两个 TCP 往返）
    Request 1 ──── GET ────→ Response 1
    Request 2 ──── POST ───→ (等 100-continue) ───→ Response 2

HTTP/2：GET 和 POST 速度差异几乎消失
    ┌─ Stream 1: GET 帧 ────────→ Response 帧 ─┐
    ├─ Stream 2: POST 帧 ──────→ Response 帧 ─┤
    └─ 同一个 TCP 连接，帧交错传输 ──────────────┘
```

### HTTP/3 基于 QUIC 协议的进一步优化

HTTP/3 使用 QUIC 协议（基于 UDP），建立了 0-RTT 连接建立能力。首次连接时，GET 和 POST 都可以在建立连接的同时发送请求数据，进一步降低了延迟。这对移动端场景尤为重要——弱网环境下 QUIC 的丢包恢复机制比 TCP 更高效。

```php
<?php
// PHP 中检测客户端是否支持 HTTP/2 或 HTTP/3
$protocol = $_SERVER['SERVER_PROTOCOL'] ?? 'HTTP/1.1';
$h2Supported = strpos($protocol, 'HTTP/2') !== false;
$h3Supported = isset($_SERVER['HTTP_ALT_USED']); // Alt-Svc 升级

if ($h2Supported) {
    // HTTP/2 下可以放心使用 POST，延迟不再是问题
    header('HTTP/2 200 OK');
}
```

## RESTful API 设计中 GET/POST 的正确使用

RESTful 架构风格对 HTTP 方法有明确的使用规范：

| HTTP 方法 | 操作     | 幂等 | 安全 | 示例                       |
| :-------- | :------- | :--- | :--- | :------------------------- |
| GET       | 读取     | ✅   | ✅   | `GET /api/articles`        |
| POST      | 创建     | ❌   | ❌   | `POST /api/articles`       |
| PUT       | 全量更新 | ✅   | ❌   | `PUT /api/articles/1`      |
| PATCH     | 部分更新 | ❌   | ❌   | `PATCH /api/articles/1`    |
| DELETE    | 删除     | ✅   | ❌   | `DELETE /api/articles/1`   |

### 常见的反模式

```text
❌  POST /api/getUserList        → 应该用 GET /api/users
❌  GET  /api/deleteUser?id=1    → 应该用 DELETE /api/users/1
❌  POST /api/users?action=update → 应该用 PUT /api/users/1
```

遵循 RESTful 规范可以让 API 更具语义化、可预测性和一致性。

## 常见误区纠正

### 误区一：GET 一定安全？

**不对。** GET 的"安全"是指语义上不修改服务器状态，但不代表数据传输安全。GET 参数暴露在 URL 中：

- 会被浏览器历史记录保存
- 会被服务器访问日志记录
- 会被代理服务器日志记录
- 可能通过 Referer 头泄露给第三方

因此，**敏感数据（密码、Token、个人信息）永远不要通过 GET 传输**，即使用了 HTTPS。

### 误区二：POST 不能被缓存？

**不对。** 虽然浏览器默认不会缓存 POST 响应，但：

- HTTP 规范允许缓存 POST 响应（如果响应包含 `Cache-Control` 或 `Expires` 头）
- 可以通过 `Cache-Control: max-age=3600` 显式设置
- 反向代理（如 Nginx、Varnish）可以配置缓存 POST 请求

### 误区三：POST 比 GET 安全得多？

**也不完全正确。** POST 只是参数不在 URL 中，但：

- 使用 HTTPS 时，URL 和 Body 都会被加密
- 不使用 HTTPS 时，POST Body 同样是明文传输
- 真正的安全保障是 **HTTPS + 合法的认证鉴权**，而非选择 GET 还是 POST

## PHP 中 $_GET 和 $_POST 的使用示例

### 基础用法

```php
<?php
// 获取 GET 参数
$page = $_GET['page'] ?? 1;
$keyword = $_GET['keyword'] ?? '';

// 获取 POST 参数
$username = $_POST['username'] ?? '';
$password = $_POST['password'] ?? '';

// 获取 JSON Body（RESTful API 常用）
$json = file_get_contents('php://input');
$data = json_decode($json, true);
```

### 安全处理

```php
<?php
// ✅ 正确做法：验证、过滤、转义

// 1. 类型转换（适合数字参数）
$page = (int)($_GET['page'] ?? 1);
$limit = (int)($_GET['limit'] ?? 20);

// 2. 白名单过滤
$sort = $_GET['sort'] ?? 'created_at';
$allowed = ['created_at', 'updated_at', 'title'];
$sort = in_array($sort, $allowed, true) ? $sort : 'created_at';

// 3. 使用 filter_input
$email = filter_input(INPUT_POST, 'email', FILTER_VALIDATE_EMAIL);
$url = filter_input(INPUT_POST, 'url', FILTER_SANITIZE_URL);

// 4. XSS 防护：输出时转义
echo htmlspecialchars($userInput, ENT_QUOTES, 'UTF-8');

// 5. SQL 注入防护：使用预处理语句
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
```

### 接收文件上传

```php
<?php
// POST 方式上传文件
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($_FILES['avatar'])) {
    $file = $_FILES['avatar'];
    
    // 验证文件类型
    $allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!in_array($file['type'], $allowedTypes)) {
        die('不支持的文件类型');
    }
    
    // 验证文件大小（5MB）
    if ($file['size'] > 5 * 1024 * 1024) {
        die('文件大小超过限制');
    }
    
    move_uploaded_file($file['tmp_name'], 'uploads/' . basename($file['name']));
}
```

## cURL / Postman 测试示例

### cURL 发送 GET 请求

```bash
# 基本 GET 请求
curl https://api.example.com/users?page=1&limit=10

# 带请求头
curl -H "Accept: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     "https://api.example.com/users?page=1"
```

### cURL 发送 POST 请求

```bash
# 发送表单数据
curl -X POST https://api.example.com/users \
     -d "username=zhangsan&email=zhangsan@test.com"

# 发送 JSON 数据
curl -X POST https://api.example.com/users \
     -H "Content-Type: application/json" \
     -d '{"name":"张三","email":"zhangsan@test.com"}'

# 上传文件
curl -X POST https://api.example.com/upload \
     -F "file=@/path/to/image.jpg" \
     -F "description=头像"
```

### Postman 测试技巧

1. **GET 请求**：在 Params 标签页添加 Key-Value 参数
2. **POST 表单**：Body → `x-www-form-urlencoded` 或 `form-data`
3. **POST JSON**：Body → `raw` → 选择 `JSON` 类型
4. **查看请求报文**：Postman Console（Ctrl+Alt+C）可以看到完整的请求头和 Body

## 实战：用 PHP 实现简单的 GET/POST 路由分发

以下是一个精简的路由分发示例，展示如何在 PHP 中根据请求方法自动路由到不同的处理函数，这是 RESTful API 的基础模式。

```php
<?php
/**
 * 简易 RESTful 路由分发器
 * GET /api/users     → 用户列表（分页、搜索）
 * GET /api/users/1   → 单个用户详情
 * POST /api/users    → 创建用户
 */

// 解析请求信息
$method = $_SERVER['REQUEST_METHOD'];
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $uri)));
$resource = $segments[1] ?? '';
$id = $segments[2] ?? null;

// 设置 JSON 响应头
header('Content-Type: application/json; charset=utf-8');

// 路由分发
if ($resource === 'users') {
    switch ($method) {
        case 'GET':
            if ($id) {
                // GET /api/users/{id} —— 获取单个用户
                $user = findUserById((int)$id);
                if ($user) {
                    echo json_encode($user);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => '用户不存在']);
                }
            } else {
                // GET /api/users —— 获取用户列表
                $page = max(1, (int)($_GET['page'] ?? 1));
                $limit = min(100, max(1, (int)($_GET['limit'] ?? 20)));
                $users = findUsers($page, $limit);
                echo json_encode([
                    'data'  => $users,
                    'page'  => $page,
                    'limit' => $limit,
                    'total' => countUsers(),
                ]);
            }
            break;

        case 'POST':
            // POST /api/users —— 创建用户
            verifyCsrfToken();  // 防 CSRF
            $input = json_decode(file_get_contents('php://input'), true);

            // 参数验证
            $errors = validateUser($input);
            if (!empty($errors)) {
                http_response_code(422);
                echo json_encode(['errors' => $errors]);
                break;
            }

            $user = createUser($input);
            http_response_code(201);
            echo json_encode($user);
            break;

        default:
            http_response_code(405);
            echo json_encode(['error' => 'Method Not Allowed']);
    }
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Not Found']);
}

// === 辅助函数 ===

function validateUser(array $input): array
{
    $errors = [];
    if (empty($input['name']) || strlen($input['name']) > 50) {
        $errors['name'] = '用户名不能为空且不超过50字符';
    }
    if (empty($input['email']) || !filter_var($input['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = '邮箱格式不正确';
    }
    return $errors;
}

function createUser(array $input): array
{
    // 实际项目中应使用预处理语句防 SQL 注入
    global $pdo;
    $stmt = $pdo->prepare('INSERT INTO users (name, email, created_at) VALUES (:name, :email, NOW())');
    $stmt->execute([
        ':name'  => $input['name'],
        ':email' => $input['email'],
    ]);
    return ['id' => $pdo->lastInsertId()] + $input;
}
```

### 为什么 Laravel 框架默认使用 POST 处理表单？

Laravel 的 `Route::post()` 用于处理表单提交，这背后有几个原因：

1. **CSRF 保护**：Laravel 的 CSRF 中间件只验证 POST/PUT/PATCH/DELETE 请求，GET 请求不验证（因为 GET 不应产生副作用）
2. **自动解析请求体**：`$request->input()` 可以统一获取 POST Body 数据，无需区分 URL 参数和 Body 数据
3. **路由模型绑定**：POST 请求配合表单验证可以自动绑定到 Eloquent 模型

```php
<?php
// Laravel 中 GET/POST 的典型用法
Route::get('/users', [UserController::class, 'index']);       // 查询列表
Route::get('/users/{user}', [UserController::class, 'show']); // 查询详情
Route::post('/users', [UserController::class, 'store']);      // 创建用户
Route::put('/users/{user}', [UserController::class, 'update']); // 更新用户
Route::delete('/users/{user}', [UserController::class, 'destroy']); // 删除用户
```

## 安全最佳实践

1. **始终使用 HTTPS**：无论 GET 还是 POST，加密传输是基础安全要求
2. **敏感数据用 POST**：密码、Token、个人信息等不应出现在 URL 中
3. **输入验证**：永远不要信任客户端传来的数据，服务端必须做校验
4. **防止 CSRF**：POST 请求配合 CSRF Token 防止跨站请求伪造
5. **限制请求速率**：对登录、注册等接口实施 Rate Limiting
6. **正确设置 Content-Type**：POST JSON 数据时设置 `application/json`，避免解析漏洞
7. **避免敏感信息泄露**：检查错误信息中是否包含堆栈跟踪或数据库结构

## 常见面试追问解答

### Q1：GET 请求可以携带 Body 吗？

**可以。** HTTP 协议并未禁止 GET 请求携带 Request Body，但这是一个反模式。大多数 HTTP 客户端（如浏览器）会忽略 GET 请求的 Body，且很多代理服务器和 CDN 会丢弃 GET Body。如果需要传递大量数据，应该使用 POST。在 PHP 中，GET Body 的数据不会出现在 `$_GET` 超全局数组中，需要通过 `file_get_contents('php://input')` 手动读取。

### Q2：POST 一定比 GET 安全吗？

**不一定。** 安全取决于两点：(1) 是否使用 HTTPS —— 无论 GET 还是 POST，明文传输都不安全；(2) 数据是否包含敏感信息 —— POST 只是将参数从 URL 移到了 Body 中，但在 HTTP 明文模式下，Body 同样会被窃听。真正保障安全的是 **HTTPS + 输入验证 + 鉴权授权** 的组合，而非单纯选择请求方法。

### Q3：文件上传为什么只能用 POST？

因为 `multipart/form-data` 编码格式需要 Request Body 来承载二进制文件数据。虽然理论上 GET 也可以携带 Body，但浏览器的 `<form>` 标签中 `enctype="multipart/form-data"` 必须配合 `method="POST"` 使用，这是 HTML 规范的硬性要求。此外，GET URL 长度有限制，无法容纳大文件的 Base64 编码。

### Q4：幂等性的实际意义是什么？

幂等性在网络不可靠时尤为重要。当网络超时导致客户端收不到响应时，可以安全地重试 GET 请求而不会产生副作用，但重试 POST 请求可能导致重复创建资源（重复订单、重复扣款）。生产环境中，PUT 和 DELETE 同样需要幂等性保障。实现幂等性的常见方案包括：幂等键（Idempotency Key）、唯一索引约束、数据库乐观锁等。

### Q5：如何在 PHP 中区分请求是 GET 还是 POST？

通过 `$_SERVER['REQUEST_METHOD']` 获取当前请求方法。最佳实践是在代码入口处统一处理：

```php
<?php
// 入口文件统一处理请求方法
switch ($_SERVER['REQUEST_METHOD']) {
    case 'GET':
        // 查询操作：参数验证、缓存读取
        handleGetRequest();
        break;
    case 'POST':
        // 创建操作：CSRF 校验、数据验证
        verifyCsrfToken();
        handlePostRequest();
        break;
    case 'PUT':
        // 更新操作
        handlePutRequest();
        break;
    case 'DELETE':
        // 删除操作
        handleDeleteRequest();
        break;
    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method Not Allowed']);
}
```

### Q6：RESTful API 中 GET 和 POST 的缓存策略有何不同？

GET 请求默认会被浏览器、CDN、反向代理等多层缓存。可以通过 `Cache-Control`、`ETag`、`Last-Modified` 等头部精确控制缓存行为。POST 请求默认不被缓存，因为 POST 通常用于状态变更操作。如果需要缓存 POST 响应（不推荐），必须在响应中设置 `Cache-Control: max-age=<seconds>` 或使用 `Vary` 头部进行区分。在 PHP 中：

```php
<?php
// 控制 GET 响应缓存
header('Cache-Control: public, max-age=3600');  // 缓存 1 小时
header('ETag: "' . md5($responseBody) . '"');

if (isset($_SERVER['HTTP_IF_NONE_MATCH']) &&
    $_SERVER['HTTP_IF_NONE_MATCH'] === '"' . md5($responseBody) . '"') {
    http_response_code(304);
    exit;  // 内容未变，返回 304 Not Modified
}

echo $responseBody;
```
## 补充面试追问

### Q7：GET 请求能被浏览器预加载（Prefetch）吗？

**可以。** 浏览器的 `<link rel="prefetch">` 和 `<link rel="preconnect">` 会预先建立 TCP 连接。更重要的是，Chrome 等浏览器会对 GET 请求进行**预解析（Speculative Parsing）**——在解析 HTML 时提前发现链接并预加载。这意味着 GET 请求的响应可能在用户点击之前就已经被缓存。因此，设计 RESTful API 时需要注意：GET 接口不应该有副作用，因为浏览器可能在用户不知情的情况下发起请求。

### Q8：为什么有些框架用 POST 来模拟 PUT 和 DELETE？

这是因为 HTML 表单只支持 GET 和 POST 两种方法，不支持 PUT 和 DELETE。一些早期的 PHP 框架（如 CodeIgniter）通过隐藏字段 `_method=PUT` 来模拟：客户端发送 POST 请求，在表单中添加 `<input type="hidden" name="_method" value="PUT">`，服务端读取 `_method` 后转换为对应的 HTTP 方法处理。Laravel 的 `Route::resource()` 和 `HtmlServiceProvider` 已经内置了这种支持。

```html
<!-- HTML 表单模拟 DELETE 请求 -->
<form method="POST" action="/api/users/1">
    <input type="hidden" name="_method" value="DELETE">
    <input type="hidden" name="_token" value="{{ csrf_token() }}">
    <button type="submit">删除用户</button>
</form>
```

### Q9：并发请求时 GET 和 POST 有什么区别？

在高并发场景下，GET 请求因为会被 CDN 和浏览器缓存，可以大幅减轻服务器压力。而 POST 请求不走缓存，每个请求都会到达服务器处理，因此对服务器的计算资源要求更高。但在分布式系统中，GET 请求的缓存一致性更难保证——用户 A 的修改可能因为 CDN 缓存而对用户 B 不可见。解决方案包括：使用 `Vary` 头部区分用户、设置合理的 `Cache-Control` 过期时间、或者使用 WebSocket 等推送机制替代轮询。

### Q10：GraphQL 为什么不区分 GET 和 POST？

GraphQL 规范允许 GET 和 POST 两种方式发送查询，但实际上大多数 GraphQL 服务只使用 POST。原因是 GraphQL 的查询可以非常复杂（嵌套查询、批量操作），GET URL 长度限制无法满足需求。使用 POST 时，GraphQL 查询放在 Request Body 中，不受 URL 长度限制。此外，GraphQL 的单端点设计（所有查询都发到 `/graphql`）使得 HTTP 方法的语义区分变得不那么重要。

```php
<?php
// GraphQL 服务端处理示例
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $query = $input['query'] ?? '';
    $variables = $input['variables'] ?? [];

    // 解析并执行 GraphQL 查询
    $result = GraphQL::executeQuery($schema, $query, null, $context, $variables);
    echo json_encode($result->toArray());
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 部分 GraphQL 服务也支持 GET（用于查询操作）
    $query = $_GET['query'] ?? '';
    $variables = json_decode($_GET['variables'] ?? '{}', true);
    $result = GraphQL::executeQuery($schema, $query, null, $context, $variables);
    echo json_encode($result->toArray());
}
```

## 总结：GET 与 POST 对照速查表

| 维度 | GET | POST |
|:-----|:----|:-----|
| 语义 | 获取资源 | 提交数据 |
| 幂等 | ✅ 幂等 | ❌ 非幂等 |
| 安全（语义） | ✅ 安全 | ❌ 不安全 |
| 参数位置 | URL 查询字符串 | Request Body |
| 浏览器缓存 | ✅ 默认缓存 | ❌ 默认不缓存 |
| 书签可保存 | ✅ 可以 | ❌ 不可以 |
| 浏览器历史 | 暴露参数 | 隐藏参数 |
| 数据类型 | 仅 ASCII | 无限制 |
| URL 长度限制 | 浏览器/服务器限制 | 无限制 |
| 适用场景 | 查询、筛选、分页 | 创建、更新、上传 |
| HTTP/2 性能 | 多路复用，优势缩小 | 多路复用，延迟消除 |
| CSRF 防护 | 通常不需要 | 必须携带 CSRF Token |

## PHP 中常见的 GET/POST 数据处理封装

在实际项目中，建议封装统一的数据获取方法，避免散落在各处的 `$_GET` 和 `$_POST` 直接调用，这不仅提高代码可维护性，还能统一进行安全过滤和类型转换。

```php
<?php
/**
 * 统一请求数据获取类
 * 自动根据请求方法获取参数，支持类型转换和默认值
 */
class Request
{
    private static ?array $parsedBody = null;

    /**
     * 获取参数（自动判断 GET/POST）
     * 支持点号语法：get('user.name') 等价于 $data['user']['name']
     */
    public static function input(string $key, mixed $default = null): mixed
    {
        $data = self::all();
        $keys = explode('.', $key);

        foreach ($keys as $k) {
            if (!is_array($data) || !array_key_exists($k, $data)) {
                return $default;
            }
            $data = $data[$k];
        }

        return $data;
    }

    /**
     * 获取所有参数
     */
    public static function all(): array
    {
        $get = $_GET;
        $post = self::getParsedBody();
        return array_merge($get, $post);
    }

    /**
     * 获取 POST Body 数据（支持 JSON 和表单）
     */
    private static function getParsedBody(): array
    {
        if (self::$parsedBody !== null) {
            return self::$parsedBody;
        }

        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';

        if (strpos($contentType, 'application/json') !== false) {
            $raw = file_get_contents('php://input');
            self::$parsedBody = json_decode($raw, true) ?? [];
        } else {
            self::$parsedBody = $_POST;
        }

        return self::$parsedBody;
    }

    /**
     * 获取指定键值并强制类型转换
     */
    public static function string(string $key, string $default = ''): string
    {
        return (string) self::input($key, $default);
    }

    public static function int(string $key, int $default = 0): int
    {
        return (int) self::input($key, $default);
    }

    public static function bool(string $key, bool $default = false): bool
    {
        return (bool) self::input($key, $default);
    }

    /**
     * 获取数组类型参数（适用于多选、标签等场景）
     */
    public static function array(string $key, array $default = []): array
    {
        $value = self::input($key, $default);
        return is_array($value) ? $value : $default;
    }

    /**
     * 验证必填参数
     */
    public static function required(array $keys): void
    {
        $missing = [];
        foreach ($keys as $key) {
            if (self::input($key) === null) {
                $missing[] = $key;
            }
        }
        if (!empty($missing)) {
            http_response_code(422);
            echo json_encode([
                'error'   => '参数验证失败',
                'missing' => $missing,
            ]);
            exit;
        }
    }
}

// 使用示例
// GET  /api/users?page=1&limit=10
// POST /api/users (Body: {"name":"王五","email":"wangwu@test.com"})

$page = Request::int('page', 1);          // 获取分页，自动转为整数
$limit = Request::int('limit', 20);       // 获取每页条数
$keyword = Request::string('keyword', ''); // 获取搜索关键词
$name = Request::input('name');            // 自动从 GET 或 POST 获取

// 验证必填字段
Request::required(['name', 'email']);     // 缺少任一参数则返回 422

// 获取数组参数
$tags = Request::array('tags', []);       // 获取标签数组

// 点号语法获取嵌套数据
$city = Request::input('address.city', '未知');  // 从嵌套数组中取值
```

> **封装建议**：在生产项目中，建议使用框架提供的 `Request` 对象（如 Laravel 的 `$request->input()`、Symfony 的 `Request` 类），而非直接操作 `$_GET`/`$_POST`。框架的 Request 对象已经处理了安全过滤、类型转换、CSRF 防护等常见问题，避免了手动处理可能引入的安全漏洞。

```php
<?php
// 幂等键防重复提交示例
$idempotencyKey = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';

if (empty($idempotencyKey)) {
    http_response_code(400);
    echo json_encode(['error' => '缺少 Idempotency-Key']);
    exit;
}

// 检查是否已处理（存入 Redis）
$redis = new Redis();
$redis->connect('127.0.0.1');
$cacheKey = "idempotency:{$idempotencyKey}";

if ($redis->exists($cacheKey)) {
    $cached = json_decode($redis->get($cacheKey), true);
    http_response_code($cached['code']);
    echo $cached['body'];
    exit;
}

// 处理请求...
$result = processOrder($_POST);
// 存储结果，设置 24 小时过期
$redis->setex($cacheKey, 86400, json_encode([
    'code' => 200,
    'body' => json_encode($result),
]));
echo json_encode($result);
```

## 相关阅读
- [HTTP](/network/http/) - HTTP 协议基础与报文结构详解
- [HTTP 状态码](/network/status-codes/) - 常用 HTTP 状态码分类与使用场景
- [PHP 安全](/php/security/) - PHP 安全编程最佳实践与常见漏洞防护
- [TCP 三次握手](/network/three-way-handshake/) - 理解 GET/POST 的 TCP 数据包机制底层原理
- [网络安全基础](/network/network-security/) - XSS / CSRF / SQL 注入等 Web 安全防护
