---
title: EasySwoole
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags: [PHP, Swoole, 架构, 高并发]
keywords: [EasySwoole, PHP]
categories:
  - php
  - runtime
date: 2020-03-20 15:05:07
description: 'EasySwoole 是基于 Swoole 扩展的高性能 PHP 常驻内存协程框架，采用 Master-Manager-Worker 多进程模型，内置协程连接池、WebSocket、定时任务等企业级组件。相比传统 PHP-FPM 的"请求即销毁"模式，EasySwoole 框架仅加载一次，配合 Swoole 协程实现高并发异步 I/O，QPS 提升 5-10 倍。本文从架构原理、数据库连接池、WebSocket 聊天室、定时任务、进程间通信到性能对比与踩坑笔记，全面深入讲解 EasySwoole 协程框架的实战技巧与生产部署经验。'



---

## 一、为什么是 EasySwoole

传统 PHP-FPM 模型每个请求都要：**加载框架 → 建连接 → 处理 → 销毁**，框架启动占了请求大头时间。

Swoole 把 PHP 变成**常驻内存**的 CLI 服务，框架只加载一次，每个请求只跑业务逻辑。EasySwoole 在 Swoole 之上做了开箱即用的封装：路由、ORM、协程客户端、定时任务、进程管理 —— 不用自己拼。

> 适合：API 网关、IM 服务、推送系统、爬虫调度。
> 不适合：纯模板渲染的传统 Web，ROI 不高。

---

## 二、核心特性

| 特性 | 说明 |
|------|------|
| **常驻内存** | 框架只加载一次，请求处理纯业务，QPS 比 FPM 高 5-10 倍 |
| **协程** | 单线程内 IO 并发，写同步代码享受异步性能 |
| **多进程模型** | Master + Manager + Worker + TaskWorker，自带稳定性 |
| **WebSocket / TCP / UDP** | 一套框架同时挂 HTTP + 长连接服务 |
| **定时器 / 异步任务** | 不依赖 crontab 和队列就能做 |

---

## 三、快速开始

```bash
composer require easyswoole/easyswoole=3.x
php vendor/easyswoole/easyswoole/bin/easyswoole install
php easyswoole start
```

控制器示例：

```php
<?php
namespace App\HttpController;

use EasySwoole\Http\AbstractInterface\Controller;

class Index extends Controller
{
    public function index()
    {
        $this->writeJson(200, ['msg' => 'hello swoole']);
    }
}
```

访问 `http://127.0.0.1:9501/index/index` 即返回 JSON。

---

## 四、协程客户端示例

```php
use EasySwoole\HttpClient\HttpClient;

// 并发请求 3 个接口，总耗时 ≈ 最慢那个
go(function () {
    $urls = ['http://a.com', 'http://b.com', 'http://c.com'];
    $chan = new \Swoole\Coroutine\Channel(count($urls));
    foreach ($urls as $url) {
        go(function () use ($url, $chan) {
            $chan->push((new HttpClient($url))->get()->getBody());
        });
    }
    $results = [];
    for ($i = 0; $i < count($urls); $i++) {
        $results[] = $chan->pop();
    }
});
```

---

## 五、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **全局变量污染** | 单例改了状态，下个请求还在 | Worker 内禁止改全局；用 `Context` 存请求级数据 |
| **改代码不生效** | 常驻内存，需要重启 | 开发开 `hotReload`，生产用 `php easyswoole reload` |
| **DB 连接断开** | "MySQL server has gone away" | 用连接池（EasySwoole 自带 Pool 组件），别裸连 |
| **不能用 die/exit** | 整个 Worker 退出 | 用 `throw new Exception` 或 `return` |
| **不能 `header()`** | FPM 函数无效 | 用 `$response->withHeader()` |
| **PSR-4 自动加载慢** | 启动时全加载 | 启用 `composer dump-autoload -o` |

---

## 六、架构原理：Master-Manager-Worker 模型

EasySwoole 底层基于 Swoole 的多进程架构，启动后分为三个层级：

```
Master 进程（1个）
  ├── 主 Reactor 线程 —— 负责 accept 连接
  ├── Reactor 线程 x N —— 负责网络 I/O 事件分发
  └── Manager 进程（1个）
        ├── Worker 进程 x N —— 处理业务逻辑（HTTP / WebSocket / TCP）
        ├── Task Worker 进程 x M —— 处理异步任务
        └── User Process —— 自定义进程（如定时任务进程）
```

**事件循环机制**：Master 进程的 Reactor 线程基于 epoll/kqueue 事件循环，当 TCP 连接有数据到达时，Reactor 线程读取数据并投递给 Worker 进程；Worker 内部启动协程处理请求，单个 Worker 可同时处理成百上千个协程（协程由 Swoole 调度器管理，非操作系统线程），这就是 EasySwoole 高并发的核心。

> `Worker_num` 建议设为 CPU 核心数；`Task_worker_num` 根据异步任务量调整，一般为 Worker 数的 1~2 倍。

```php
// dev.php 或 produce.php 配置
'SERVER' => [
    'worker_num'       => 4,    // Worker 进程数
    'task_worker_num'  => 2,    // Task Worker 数
    'max_coroutine'    => 1000, // 单 Worker 最大协程数
    'reload_async'     => true, // 异步重启，不中断连接
]
```

当 Worker 进程异常退出时，Manager 会自动 fork 新的 Worker 保证服务连续性。开发环境下修改代码后执行 `php easyswoole reload`，Manager 会向所有 Worker 发送 SIGTERM 信号，Worker 处理完当前请求后优雅退出并由 Manager 重新拉起。

---

## 七、数据库连接池实战

裸连 MySQL 在常驻内存场景下会遇到 `MySQL server has gone away`，因为连接长时间空闲后被服务端断开。EasySwoole 内置连接池组件解决此问题：

```php
<?php
namespace EasySwoole\EasySwoole;

use EasySwoole\ORM\Db\Config;
use EasySwoole\ORM\Db\Connection;
use EasySwoole\ORM\DbManager;
use EasySwoole\EasySwoole\AbstractInterface\Event;
use EasySwoole\EasySwoole\Swoole\EventRegister;

class EasySwooleEvent implements Event
{
    public static function initialize()
    {
        // 注册 MySQL 连接池，连接数 20，空闲回收 30 秒
        $config = new Config([
            'host'          => '127.0.0.1',
            'port'          => 3306,
            'user'          => 'root',
            'password'      => '123456',
            'database'      => 'test',
            'charset'       => 'utf8mb4',
            'timeout'       => 5.0,
            'POOL_MAX_NUM'  => 20,   // 最大连接数
            'POOL_MIN_NUM'  => 5,    // 最小连接数（预热）
            'POOL_TIME_OUT' => 0.1,  // 获取连接超时
        ]);
        DbManager::getInstance()->addConnection(new Connection($config));
    }

    public static function mainServerCreate(EventRegister $eventRegister)
    {
        // 可在此处注册连接池心跳检测
        $eventRegister->add($eventRegister::onWorkerStart, function () {
            // Worker 启动时预热连接池
            DbManager::getInstance()->getConnection()->preheat();
        });
    }
}
```

**连接回收机制**：Swoole 底层使用 `onClose` 回调检测连接断开，EasySwoole 的 Pool 组件在 Worker 进程退出时会自动归还连接。如果连接池已满，新请求会排队等待 `POOL_TIME_OUT` 秒后超时报错，因此高并发场景需合理设置池大小。

使用 ORM 查询：

```php
use EasySwoole\ORM\AbstractModel\Model;

class UserModel extends Model
{
    protected $tableName = 'user';
}

// 控制器中
$users = UserModel::create()->where('status', 1)->limit(10)->all();
```

---

## 八、WebSocket 实战：聊天室

EasySwoole 可同时监听 HTTP 和 WebSocket 端口，以下是完整聊天室示例：

```php
<?php
namespace App\WebSocket;

use EasySwoole\Component\Table\TableManager;
use EasySwoole\Socket\AbstractInterface\ParserInterface;
use EasySwoole\Socket\Client\WebSocket as WebSocketClient;
use EasySwoole\WebSocket\WebSocket;

// WebSocket 控制器
class Chat
{
    // 连接建立
    public function onOpen(WebSocket $server, \Swoole\Http\Request $request): void
    {
        $fd = $request->fd;
        // 广播上线消息
        $this->broadcast($server, "用户 #{$fd} 加入聊天室");
    }

    // 收到消息
    public function onMessage(WebSocket $server, WebSocketClient $client, string $data): void
    {
        $fd = $client->getFd();
        $payload = json_decode($data, true);
        $msg = $payload['msg'] ?? '';
        if ($msg) {
            $this->broadcast($server, "用户 #{$fd}: {$msg}");
        }
    }

    // 连接关闭
    public function onClose(WebSocket $server, int $fd, int $reactorId): void
    {
        $this->broadcast($server, "用户 #{$fd} 离开聊天室");
    }

    private function broadcast(WebSocket $server, string $msg): void
    {
        $frame = new \Swoole\WebSocket\Frame;
        $frame->data = json_encode(['type' => 'chat', 'msg' => $msg]);
        $frame->finish = true;
        $connections = $server->connections ?? [];
        foreach ($connections as $fd) {
            if ($server->isEstablished($fd)) {
                $server->push($fd, $frame->data);
            }
        }
    }
}
```

在 `EasySwooleEvent` 中注册 WebSocket 服务：

```php
use EasySwoole\WebSocket\WebSocket;

public static function mainServerCreate(EventRegister $eventRegister)
{
    $ws = new WebSocket(new \EasySwoole\Socket\Config());
    $ws->registerEvent($eventRegister);
    $ws->getSubProtocol()->setController(Chat::class, 'chat');
}
```

前端连接：

```javascript
const ws = new WebSocket('ws://127.0.0.1:9502/');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send(JSON.stringify({ msg: '大家好！' }));
```

---

## 九、定时任务（CronTimer）

EasySwoole 提供 `CronTimer` 组件，不依赖系统 crontab，运行在独立进程中：

```php
<?php
namespace EasySwoole\EasySwoole;

use EasySwoole\EasySwoole\Crontab\Crontab;
use EasySwoole\EasySwoole\Swoole\EventRegister;

class EasySwooleEvent
{
    public static function mainServerCreate(EventRegister $eventRegister)
    {
        // 每 60 秒执行一次：清理过期会话
        Crontab::getInstance()->addTask('clear_sessions', '*/60 * * * * *', function () {
            echo "清理过期会话：" . date('Y-m-d H:i:s') . PHP_EOL;
            // 实际业务：删除 Redis 中过期的 session key
        });
        // 每天凌晨 2 点执行：生成日报
        Crontab::getInstance()->addTask('daily_report', '0 0 2 * * *', function () {
            echo "生成日报：" . date('Y-m-d') . PHP_EOL;
        });
        // 每 5 秒执行一次：上报心跳
        Crontab::getInstance()->addTask('heartbeat', '*/5 * * * * *', function () {
            // 向监控中心发送心跳包
        });
    }
}
```

> Cron 表达式格式：`秒 分 时 日 月 周`（6 位），比系统 crontab 多了「秒」字段。运行在独立的 User Process 中，不会阻塞 Worker。

如果任务执行时间超过间隔，下一个周期的任务会跳过（不会叠加），避免任务堆积。

---

## 十、进程间通信

### 10.1 Channel（协程通道）

`Channel` 是 Swoole 协程间通信的核心，类似 Go 的 chan：

```php
use Swoole\Coroutine\Channel;

$chan = new Channel(10); // 缓冲区大小 10

go(function () use ($chan) {
    // 生产者：每秒写入一条消息
    for ($i = 0; $i < 100; $i++) {
        $chan->push(['id' => $i, 'data' => "msg_{$i}"]);
        \Swoole\Coroutine::sleep(0.1);
    }
    $chan->close(); // 关闭通道
});

go(function () use ($chan) {
    // 消费者：阻塞读取
    while (true) {
        $msg = $chan->pop(1.0); // 超时 1 秒
        if ($msg === false) break;
        echo "消费：{$msg['data']}" . PHP_EOL;
    }
});
```

### 10.2 Atomic（原子计数器）

`Atomic` 是进程安全的计数器，常用于统计 QPS、限流计数：

```php
use Swoole\Atomic;

// 在 Server 启动前创建（共享内存）
$atomic = new Atomic(0);

// Worker 内原子自增
$atomic->add(1);   // +1
$atomic->sub(1);   // -1
$atomic->get();    // 获取当前值

// 典型用法：统计每秒请求数
go(function () use ($atomic) {
    while (true) {
        $count = $atomic->get();
        $atomic->set(0);
        echo "QPS: {$count}" . PHP_EOL;
        \Swoole\Coroutine::sleep(1);
    }
});
```

### 10.3 Table（高性能内存表）

`Table` 基于共享内存，支持多进程并发读写，常用于在线用户统计、分布式锁：

```php
use Swoole\Table;

$table = new Table(1024);
$table->column('fd', Table::TYPE_INT, 4);
$table->column('name', Table::TYPE_STRING, 64);
$table->column('last_active', Table::TYPE_INT, 4);
$table->create();

// 写入（key 唯一，相同 key 覆盖）
$table->set('user_1001', [
    'fd'          => 1001,
    'name'        => 'Alice',
    'last_active' => time(),
]);

// 读取
$user = $table->get('user_1001');

// 删除
$table->del('user_1001');

// 遍历在线用户
foreach ($table as $key => $row) {
    echo "{$key}: {$row['name']}" . PHP_EOL;
}
```

> Table 的内存大小在 `create()` 时固定分配，行数 × 每行字节数 ≈ 总内存。`1024 行 × 72 字节 ≈ 72KB`，适合高频小数据场景。

---

## 十一、踩坑笔记（扩展）

| 坑 | 现象 | 解法 |
|----|------|------|
| **全局变量污染** | 单例改了状态，下个请求还在 | Worker 内禁止改全局；用 `Context` 存请求级数据 |
| **改代码不生效** | 常驻内存，需要重启 | 开发开 `hotReload`，生产用 `php easyswoole reload` |
| **DB 连接断开** | "MySQL server has gone away" | 用连接池（EasySwoole 自带 Pool 组件），别裸连 |
| **不能用 die/exit** | 整个 Worker 退出 | 用 `throw new Exception` 或 `return` |
| **不能 `header()`** | FPM 函数无效 | 用 `$response->withHeader()` |
| **PSR-4 自动加载慢** | 启动时全加载 | 启用 `composer dump-autoload -o` |
| **内存泄漏** | 进程 RSS 持续增长不释放 | 用 `memory_get_usage()` 定位热点；检查是否有数组/对象未 unset；用 `Coroutine::defer()` 注册清理逻辑 |
| **协程死锁** | 请求超时但 CPU 空闲 | 两个协程互相等 Channel 导致死锁；用 `Channel::pop($timeout)` 加超时兜底；用 `Coroutine::listCoroutines()` 排查 |
| **PDO 跨协程复用** | 随机报错 "MySQL server has gone away" | PDO 连接对象不能跨协程共享，必须用协程上下文隔离；推荐使用 ORM 连接池 |
| **文件句柄泄漏** | too many open files | `fopen()` 后必须 `fclose()`；协程中用 `defer(function(){ fclose($fp); })` 自动关闭 |

### 内存泄漏排查实战

```php
// 在定时任务中监控内存
Crontab::getInstance()->addTask('memory_check', '*/10 * * * * *', function () {
    $memory = memory_get_usage(true);
    $peak   = memory_get_peak_usage(true);
    $pid    = getmypid();
    echo "[{$pid}] 当前内存: " . round($memory / 1024 / 1024, 2) . "MB";
    echo "，峰值: " . round($peak / 1024 / 1024, 2) . "MB" . PHP_EOL;

    // 超过阈值告警
    if ($memory > 256 * 1024 * 1024) {
        // 发送告警通知
    }
});
```

### 协程死锁检测

```php
// 开启协程死锁检测（dev.php 配置）
'SERVER' => [
    'hook_flags' => SWOOLE_HOOK_ALL,
]

// 手动排查：打印所有协程状态
go(function () {
    \Swoole\Coroutine::sleep(60);
    $list = \Swoole\Coroutine::listCoroutines();
    foreach ($list as $cid) {
        $info = \Swoole\Coroutine::getBacktrace($cid);
        echo "Coroutine #{$cid}:" . PHP_EOL . $info . PHP_EOL;
    }
});
```

---

## 十二、性能对比

| 指标 | EasySwoole | Hyperf | Webman | Laravel Octane |
|------|-----------|--------|--------|----------------|
| **QPS（简单 JSON）** | ~85,000 | ~90,000 | ~95,000 | ~70,000 |
| **QPS（DB 查询）** | ~12,000 | ~14,000 | ~13,000 | ~10,000 |
| **启动时间** | ~0.8s | ~1.2s | ~0.5s | ~2.0s |
| **空载内存** | ~35MB | ~50MB | ~30MB | ~60MB |
| **1000 并发内存** | ~120MB | ~150MB | ~100MB | ~180MB |
| **常驻内存** | ✅ | ✅ | ✅ | ✅ |
| **协程支持** | ✅ Swoole 原生 | ✅ Swoole 原生 | ✅ Swoole 原生 | ✅ Swoole 原生 |
| **微服务生态** | 中 | 强 | 弱 | 弱 |

> 测试环境：8C16G，PHP 8.1 + Swoole 5.0，简单 JSON 指返回 `{"msg":"ok"}`，DB 查询为单表 `SELECT * LIMIT 10`。数据为压测参考值，实际因业务逻辑复杂度有波动。

**选型建议**：
- 追求极简上手 → **Webman**（原生 Workerman 思维，学习成本最低）
- 企业级微服务 → **Hyperf**（注解 + AOP + 服务治理全套）
- 快速中小项目 → **EasySwoole**（文档友好，组件齐全）
- 已有 Laravel 项目 → **Laravel Octane**（迁移成本最低）

---

## 十三、和其他框架对比

| 维度 | EasySwoole | Hyperf | Webman |
|------|-----------|--------|--------|
| 上手难度 | 简单 | 中（注解+依赖注入重） | 极简 |
| 生态 | 中 | 强（注解、AOP、微服务全套） | 中（兼容 Composer 包） |
| 适合 | 中小项目快速起步 | 微服务、企业级 | 替代 FPM 的高性能 Web |

---

## 参考

- 官网：<https://www.easyswoole.com>
- Swoole 文档：<https://wiki.swoole.com>

---

## 相关阅读

- [Hyperf：PHP版Spring Boot](/categories/PHP/Runtime/hyperf-1/)
- [Swoole深入学习](/categories/PHP/swoole/)
- [PHP版本区别](/categories/PHP/vs-php/)
- [Laravel Octane + Swoole高性能方案](/categories/PHP/Laravel/laravel-octane-swoole-high-performancephparchitecture/)
