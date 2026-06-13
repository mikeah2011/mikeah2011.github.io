---
title: 'PHP Security Hardening 实战：生产环境的完整加固清单'
keywords: [PHP Security Hardening, 生产环境的完整加固清单]
date: 2026-06-10 09:09:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - PHP
  - Security
  - 生产环境
  - disable_functions
  - open_basedir
  - Session
description: '从 php.ini 配置到代码层防御，覆盖 disable_functions、open_basedir、Session 安全、错误信息隐藏等关键加固项，附带可直接复用的配置模板和 Laravel 实战代码。'
---


## 概述

PHP 应用上线后，很多团队只关注功能，忽略了运行时层面的安全加固。一旦服务器被突破，缺少加固的 PHP 环境会让攻击者轻松执行系统命令、读取敏感文件、横向移动到其他服务。

本文覆盖生产环境最关键的加固项：

- `disable_functions`：禁用危险函数
- `open_basedir`：限制文件系统访问范围
- Session 安全：防劫持、防 fixation
- 错误信息隐藏：不暴露内部实现
- 文件上传加固
- PHP-FPM 进程隔离

每一项都附带可直接使用的配置和代码。

---

## 1. disable_functions：禁用危险函数

### 为什么必须禁用

PHP 内置的很多函数在开发环境有用，但在生产环境是纯粹的攻击面。一旦出现 RCE 漏洞，攻击者拿到 webshell 后最常用的就是 `system()`、`exec()`、`passthru()` 来执行系统命令。

### 推荐禁用列表

```ini
; php.ini
disable_functions = exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source,pcntl_exec,pcntl_fork,pcntl_wait,pcntl_signal,pcntl_alarm,pcntl_async_signals
```

### 各函数风险说明

| 函数 | 风险 | 说明 |
|------|------|------|
| `exec()` | 高 | 执行外部命令，返回最后一行 |
| `passthru()` | 高 | 执行命令并将原始输出直接传给浏览器 |
| `shell_exec()` | 高 | 通过 shell 执行命令并返回完整输出 |
| `system()` | 高 | 执行命令并直接输出 |
| `proc_open()` | 高 | 更底层的进程执行，支持 stdin/stdout/stderr |
| `popen()` | 高 | 打开进程文件指针 |
| `pcntl_exec()` | 高 | 替换当前进程镜像 |
| `show_source()` | 中 | 暴露 PHP 源代码 |
| `parse_ini_file()` | 中 | 可读取配置文件泄露敏感信息 |

### 常见陷阱

**Composer 依赖用了 `exec` 怎么办？**

很多包（比如 `symfony/process`）底层调用 `exec()`。解决方案：

1. 在 CI/CD 阶段跑 `composer install`，生产环境只部署 vendor 目录
2. 如果必须在生产运行 Composer，临时允许 `exec`，跑完立刻恢复

```bash
# 临时允许 exec 运行 composer
php -d disable_functions="" composer.phar install --no-dev
```

**Laravel 队列 worker 用了 `pcntl` 系列函数？**

Laravel 的 `queue:work` 依赖 `pcntl_fork` 和 `pcntl_signal` 来实现平滑重启。如果禁用了这些函数，worker 只能用 `--once` 模式或改用 Supervisor 管理的单进程模式。

解决方案：把 `pcntl_fork,pcntl_signal,pcntl_alarm,pcntl_async_signals` 从禁用列表中移除，或者用 `queue:listen` 替代（它不依赖 pcntl）。

### 验证配置生效

```php
<?php
// test-disable-functions.php
$disabled = ini_get('disable_functions');
echo "Disabled functions: " . $disabled . "\n\n";

// 测试是否真的被禁用了
$funcs = ['exec', 'passthru', 'shell_exec', 'system'];
foreach ($funcs as $fn) {
    if (function_exists($fn)) {
        echo "⚠️  $fn is available\n";
    } else {
        echo "✅ $fn is disabled\n";
    }
}
```

---

## 2. open_basedir：限制文件系统访问

### 原理

`open_basedir` 让 PHP 只能访问指定目录及其子目录。攻击者即使拿到 webshell，也无法读取 `/etc/passwd`、其他站点的代码、SSH 密钥等。

### 配置方式

```ini
; php.ini — 全局设置
open_basedir = /var/www/html:/tmp:/var/lib/php/sessions
```

### 多站点隔离（PHP-FPM Pool 级别）

全局 `open_basedir` 对多站点不够灵活。更好的做法是在每个 FPM pool 里单独设置：

```ini
; /etc/php/8.x/fpm/pool.d/site-a.conf
[site-a]
user = site-a
group = site-a
listen = /run/php/site-a.sock

; 每个站点只能访问自己的目录 + 共享的 session 和 tmp
php_admin_value[open_basedir] = /var/www/site-a:/tmp:/var/lib/php/sessions
php_admin_flag[allow_url_fopen] = off
php_admin_flag[allow_url_include] = off
```

```ini
; /etc/php/8.x/fpm/pool.d/site-b.conf
[site-b]
user = site-b
group = site-b
listen = /run/php/site-b.sock

php_admin_value[open_basedir] = /var/www/site-b:/tmp:/var/lib/php/sessions
php_admin_flag[allow_url_fopen] = off
php_admin_flag[allow_url_include] = off
```

### Laravel 项目的典型配置

```ini
; Laravel 项目需要访问的目录
open_basedir = /var/www/laravel-app:/tmp:/var/lib/php/sessions:/dev/urandom
```

注意 `/dev/urandom`：很多随机数生成库（`random_bytes()`）需要读取这个设备文件。

### 常见问题

**`file_get_contents('php://input')` 被阻断？**

`open_basedir` 不影响 `php://input` 和 `php://temp` 这类内存流。如果遇到问题，检查是否有路径拼接错误。

**Composer 报 `file_put_contents` 权限错误？**

Composer 的缓存在 `~/.composer/cache`，需要把它加入 `open_basedir`，或者在 CI 阶段完成依赖安装。

---

## 3. Session 安全加固

Session 是 Web 应用中最常被攻击的认证机制。三个核心威胁：Session Fixation、Session Hijacking、Session Data 泄露。

### 3.1 php.ini 层面

```ini
; 使用更安全的 session name，不暴露 PHP 身份
session.name = SID

; 只通过 cookie 传递 session ID，禁止 URL 参数
session.use_only_cookies = 1
session.use_trans_sid = 0

; Cookie 安全属性
session.cookie_httponly = 1    ; JS 无法读取
session.cookie_secure = 1     ; 只在 HTTPS 下发送
session.cookie_samesite = Lax ; 防 CSRF

; Session ID 生成参数
session.sid_length = 48
session.sid_bits_per_character = 6

; Session 存储路径（配合 open_basedir）
session.save_path = /var/lib/php/sessions

; 垃圾回收
session.gc_maxlifetime = 1800    ; 30 分钟过期
session.gc_probability = 1
session.gc_divisor = 100
```

### 3.2 代码层面的防御

**登录成功后必须再生 Session ID：**

```php
<?php
// 登录成功后
public function login(Request $request)
{
    $credentials = $request->only('email', 'password');

    if (Auth::attempt($credentials)) {
        // 关键：登录成功后重新生成 session ID
        // 防止 Session Fixation 攻击
        $request->session()->regenerate();

        return redirect()->intended('/dashboard');
    }

    return back()->withErrors(['email' => '认证失败']);
}
```

**注销时销毁整个 Session：**

```php
<?php
public function logout(Request $request)
{
    Auth::logout();

    // 销毁 session 数据
    $request->session()->invalidate();

    // 重新生成 CSRF token
    $request->session()->regenerateToken();

    return redirect('/');
}
```

### 3.3 Laravel 中间件强化 Session

```php
<?php
// app/Http/Middleware/SessionSecurity.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class SessionSecurity
{
    // 敏感操作后要求重新验证的时间窗口（秒）
    protected int $authTimeout = 1800; // 30 分钟

    public function handle(Request $request, Closure $next)
    {
        $session = $request->session();

        // 1. 检测 Session 是否过期（敏感操作路径）
        if ($this->isSensitiveRoute($request)) {
            $lastActivity = $session->get('last_auth_check', 0);
            if (time() - $lastActivity > $this->authTimeout) {
                // Session 超时，要求重新认证
                if ($request->expectsJson()) {
                    return response()->json(['error' => 'Session expired'], 401);
                }
                return redirect()->route('login')
                    ->with('status', '请重新登录');
            }
        }

        // 2. 绑定 Session 到 User Agent（基础防劫持）
        $currentUA = $request->userAgent();
        $storedUA = $session->get('session_ua');
        if ($storedUA && $storedUA !== $currentUA) {
            // UA 变化，可能被劫持
            $session->invalidate();
            if ($request->expectsJson()) {
                return response()->json(['error' => 'Session invalid'], 401);
            }
            return redirect()->route('login');
        }
        if (!$storedUA) {
            $session->put('session_ua', $currentUA);
        }

        // 3. 绑定 IP（可选，注意移动网络会变 IP）
        // 生产环境建议只做记录，不做强制阻断
        $currentIP = $request->ip();
        $storedIP = $session->get('session_ip');
        if (!$storedIP) {
            $session->put('session_ip', $currentIP);
        } elseif ($storedIP !== $currentIP) {
            // 记录日志但不阻断（移动用户 IP 会变）
            logger()->warning('Session IP changed', [
                'user_id' => $request->user()?->id,
                'old_ip' => $storedIP,
                'new_ip' => $currentIP,
            ]);
            $session->put('session_ip', $currentIP);
        }

        return $next($request);
    }

    protected function isSensitiveRoute(Request $request): bool
    {
        $sensitivePatterns = [
            'admin/*',
            'settings/*',
            'payment/*',
            'user/*/edit',
        ];

        foreach ($sensitivePatterns as $pattern) {
            if ($request->is($pattern)) {
                return true;
            }
        }
        return false;
    }
}
```

注册中间件：

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'web' => [
        // ... 其他中间件
        \App\Http\Middleware\SessionSecurity::class,
    ],
];
```

---

## 4. 错误信息与日志安全

### 4.1 禁止错误输出到浏览器

```ini
; php.ini
display_errors = Off
display_startup_errors = Off

; 生产环境日志级别：只记录 warning 及以上
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
log_errors = On
error_log = /var/log/php/error.log
```

### 4.2 Laravel `.env` 配置

```env
APP_DEBUG=false
APP_ENV=production
LOG_LEVEL=warning
LOG_CHANNEL=daily
LOG_SLACK_WEBHOOK_URL=  # 可接入 Slack 告警
```

### 4.3 自定义错误处理器（防止信息泄露）

```php
<?php
// app/Exceptions/Handler.php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
        'token',         // API token
        'secret',        // 各类 secret
        'credit_card',   // 信用卡号
    ];

    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            // 生产环境：记录完整堆栈但不暴露给用户
            logger()->error('Unhandled exception', [
                'exception' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString(),
                // 不要记录 $_POST / $_GET，可能包含密码
                'url' => request()->url(),
                'method' => request()->method(),
                'user_id' => auth()->id(),
                'ip' => request()->ip(),
            ]);
        });
    }
}
```

### 4.4 关闭 PHP 版本暴露

```ini
; php.ini
expose_php = Off
```

配合 Nginx：

```nginx
# nginx.conf
fastcgi_hide_header X-Powered-By;
server_tokens off;
```

---

## 5. 文件上传加固

### 5.1 php.ini 配置

```ini
; 限制上传大小
upload_max_filesize = 10M
post_max_size = 12M  ; 略大于 upload_max_filesize

; 限制同时上传文件数
max_file_uploads = 5
```

### 5.2 代码层面严格验证

```php
<?php
// app/Http/Controllers/UploadController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\File;

class UploadController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'file' => [
                'required',
                File::types(['jpg', 'jpeg', 'png', 'pdf', 'docx'])
                    ->max(10 * 1024) // 10MB
                    ->dimensions(Rule::dimensions()->maxWidth(4096)->maxHeight(4096)),
            ],
        ]);

        $file = $request->file('file');

        // 1. 检查 MIME 类型（不信任客户端 Content-Type）
        $allowedMimes = [
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'application/pdf' => 'pdf',
        ];
        $realMime = $file->getMimeType();
        if (!array_key_exists($realMime, $allowedMimes)) {
            abort(422, '不允许的文件类型');
        }

        // 2. 生成随机文件名，防止路径穿越
        $extension = $allowedMimes[$realMime];
        $filename = Str::uuid() . '.' . $extension;

        // 3. 存储到非 web 可访问目录
        $path = $file->storeAs('uploads', $filename, 'local');

        // 4. 如果是图片，重新编码（清除潜在的恶意 payload）
        if (str_starts_with($realMime, 'image/')) {
            $this->reencodeImage(storage_path('app/' . $path), $realMime);
        }

        return response()->json([
            'path' => $path,
            'filename' => $filename,
        ]);
    }

    protected function reencodeImage(string $path, string $mime): void
    {
        $image = match ($mime) {
            'image/jpeg' => imagecreatefromjpeg($path),
            'image/png'  => imagecreatefrompng($path),
            default => null,
        };

        if ($image) {
            match ($mime) {
                'image/jpeg' => imagejpeg($image, $path, 90),
                'image/png'  => imagepng($image, $path, 9),
            };
            imagedestroy($image);
        }
    }
}
```

### 5.3 Nginx 禁止上传目录执行 PHP

```nginx
# 上传目录禁止执行任何脚本
location ~* /storage/uploads/ {
    # 只允许静态文件
    location ~* \.php$ {
        deny all;
    }
}
```

---

## 6. PHP-FPM 进程隔离

### 6.1 使用独立用户运行每个站点

```bash
# 创建专用用户
useradd -r -s /sbin/nologin -d /var/www/laravel-app laravel-app
chown -R laravel-app:laravel-app /var/www/laravel-app
```

### 6.2 FPM Pool 配置

```ini
; /etc/php/8.x/fpm/pool.d/laravel-app.conf
[laravel-app]
user = laravel-app
group = laravel-app
listen = /run/php/laravel-app.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; 进程管理
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 10
pm.max_requests = 500

; 安全限制
php_admin_value[open_basedir] = /var/www/laravel-app:/tmp:/var/lib/php/sessions:/dev/urandom
php_admin_flag[allow_url_fopen] = off
php_admin_flag[allow_url_include] = off
php_admin_value[disable_functions] = exec,passthru,shell_exec,system,proc_open,popen,show_source,parse_ini_file
php_admin_flag[display_errors] = off
php_admin_value[error_log] = /var/log/php/laravel-app.error.log

; 慢日志（排查性能问题）
slowlog = /var/log/php/laravel-app.slow.log
request_slowlog_timeout = 5s
```

---

## 7. 其他加固项

### 7.1 禁用危险的 PHP 配置

```ini
; 禁止通过 URL 包含远程文件
allow_url_fopen = Off
allow_url_include = Off

; 限制脚本执行时间
max_execution_time = 30
max_input_time = 60

; 限制内存
memory_limit = 256M

; 禁用短标签（防止模板解析问题）
short_open_tag = Off

; 限制 POST 数据大小
post_max_size = 12M

; 限制最大输入变量数（防止 HashDoS）
max_input_vars = 1000
```

### 7.2 数据库连接安全

```php
<?php
// config/database.php — Laravel
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    // 强制 SSL 连接（云数据库场景）
    'options' => [
        PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
    ],
    // 禁止多语句执行（防 SQL 注入扩大化）
    'options' => array_filter([
        PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
    ]),
],
```

### 7.3 Composer 依赖审计

```bash
# 定期检查依赖中的已知漏洞
composer audit

# 自动修复（升级到安全版本）
composer audit --fix
```

---

## 踩坑记录

### 坑 1：禁用 `exec` 后 Laravel 队列崩了

**现象**：`php artisan queue:work` 启动后立即退出，日志无报错。

**原因**：Laravel Queue Worker 用 `pcntl_fork` 创建子进程，`pcntl_signal` 处理信号。

**解决**：从 `disable_functions` 中移除 `pcntl_fork,pcntl_signal,pcntl_alarm,pcntl_async_signals`。

### 坑 2：`open_basedir` 导致 Composer 报错

**现象**：`file_put_contents(/home/user/.composer/cache/...)` permission denied。

**原因**：Composer 缓存目录不在 `open_basedir` 范围内。

**解决**：CI/CD 中完成 `composer install`，生产环境只部署打包好的 vendor。或者临时设置 `open_basedir` 为空。

### 坑 3：Session 文件权限问题

**现象**：切换 FPM pool 用户后，Session 读写失败，用户反复被踢出登录。

**原因**：Session 目录 `/var/lib/php/sessions` 的 owner 是 `www-data`，新 pool 用户无法写入。

**解决**：

```bash
# 为每个 pool 创建独立 session 目录
mkdir -p /var/lib/php/sessions/laravel-app
chown laravel-app:laravel-app /var/lib/php/sessions/laravel-app
chmod 700 /var/lib/php/sessions/laravel-app
```

然后在 pool 配置中指定：

```ini
php_admin_value[session.save_path] = /var/lib/php/sessions/laravel-app
```

### 坑 4：`expose_php = Off` 但响应头还有 `X-Powered-By`

**现象**：`curl -I` 仍然看到 `X-Powered-By: PHP/8.x`。

**原因**：Nginx 的 `fastcgi_param` 或者 PHP 扩展（如 Zend OPcache）重新设置了头。

**解决**：在 Nginx 配置中加 `fastcgi_hide_header X-Powered-By;`。

---

## 完整加固清单速查

```
✅ disable_functions 已配置，exec/system 已禁用
✅ open_basedir 已限制到项目目录
✅ display_errors = Off
✅ expose_php = Off
✅ Session cookie_httponly + secure + samesite
✅ 登录后 regenerate session ID
✅ 文件上传已做 MIME 验证和随机重命名
✅ 上传目录禁止执行 PHP
✅ PHP-FPM 每站点独立用户
✅ Composer audit 定期运行
✅ error_log 路径已设置，日志不暴露给用户
✅ allow_url_fopen / allow_url_include 已关闭
✅ PDO 多语句执行已关闭
✅ Nginx 隐藏 X-Powered-By
✅ Nginx server_tokens off
✅ max_execution_time 已限制
✅ memory_limit 已限制
```

---

## 总结

PHP 安全加固不是一次性的事，而是一个持续的过程。核心原则：

1. **最小权限**：进程只能访问它需要的目录和函数
2. **纵深防御**：php.ini + FPM pool + 代码层面多层防护
3. **不信任输入**：文件上传的 MIME 类型、Session 的 UA 绑定，都要服务端验证
4. **隐藏实现**：错误信息、PHP 版本、服务器版本，一律不暴露

建议将上述配置模板化，在项目初始化脚本中自动应用，而不是靠人肉记住每一项。
