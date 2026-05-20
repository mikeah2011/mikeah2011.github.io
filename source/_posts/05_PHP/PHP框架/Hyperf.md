---
title: Hyperf
tags: [PHP, 架构]
categories:
  - PHP
  - PHP框架
date: 2020-03-20 15:05:07
description: 'Hyperf 是基于 Swoole 4.5+ 的高性能、协程、企业级 PHP 微服务框架，深度依赖注解 + DI 容器 + AOP，对标 Java Spring Boot。'
---

## 一、Hyperf 的定位

如果说 EasySwoole 是「Swoole 的极简封装」，那 Hyperf 就是「**PHP 版的 Spring Boot**」。

它的核心理念：

- **基于 Swoole 协程**，常驻内存 + 协程 IO，性能压榨到位
- **注解驱动**：路由、依赖注入、AOP、限流、缓存全部走注解
- **DI 容器 + AOP**：写业务时不用关心实例化和拦截
- **微服务套件齐全**：服务注册、配置中心、链路追踪、熔断限流、RPC，开箱即用

适合**中大型团队**做微服务架构 —— 学习曲线陡，但工程化收益大。

---

## 二、核心组件一览

| 组件 | 对标 | 用途 |
|------|------|------|
| `hyperf/di` | Spring DI | 依赖注入 + AOP |
| `hyperf/database` | Eloquent | ORM（基于 Laravel illuminate/database） |
| `hyperf/grpc` | gRPC | 微服务间通信 |
| `hyperf/json-rpc` | - | 轻量 RPC |
| `hyperf/config-nacos` | Spring Cloud Config | 配置中心 |
| `hyperf/service-governance` | Eureka/Nacos | 服务注册发现 |
| `hyperf/circuit-breaker` | Hystrix | 熔断 |
| `hyperf/tracer` | Zipkin/Jaeger | 链路追踪 |

---

## 三、快速开始

```bash
composer create-project hyperf/hyperf-skeleton my-app
cd my-app
php bin/hyperf.php start
```

控制器（注解驱动路由）：

```php
<?php
namespace App\Controller;

use Hyperf\HttpServer\Annotation\AutoController;
use Hyperf\HttpServer\Annotation\GetMapping;
use Hyperf\HttpServer\Contract\RequestInterface;

#[AutoController(prefix: "/user")]
class UserController
{
    #[GetMapping(path: "info")]
    public function info(RequestInterface $request): array
    {
        return ['id' => $request->input('id'), 'name' => 'Mike'];
    }
}
```

访问 `GET /user/info?id=1` 即返回 JSON。

---

## 四、依赖注入 + AOP

**构造器注入**：

```php
class OrderService
{
    public function __construct(
        private UserService $userService,
        private LoggerInterface $logger,
    ) {}
}
```

**注解切面**：

```php
#[Aspect]
class LogAspect extends AbstractAspect
{
    public array $annotations = [Log::class];

    public function process(ProceedingJoinPoint $point)
    {
        $start = microtime(true);
        $result = $point->process();
        // 记录方法执行时间
        return $result;
    }
}
```

业务方法只要打上 `#[Log]`，自动被切面包裹 —— 比手动 `try/finally` 优雅得多。

---

## 五、协程客户端示例

```php
use Hyperf\Utils\Parallel;
use Hyperf\Guzzle\ClientFactory;

$parallel = new Parallel();
foreach (['http://a', 'http://b', 'http://c'] as $url) {
    $parallel->add(function () use ($url) {
        return $this->container->get(ClientFactory::class)
            ->create()->get($url)->getBody()->getContents();
    });
}
$results = $parallel->wait();   // 三个请求并发，总耗时取最慢
```

---

## 六、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **注解扫描慢** | 启动 5s+ | 生产开启 `scan_cacheable=true`，预生成代理类 |
| **改代码不生效** | 常驻内存 | 装 `hyperf/watcher` 自动热重启 |
| **协程下用同步函数** | 整个 Worker 阻塞 | 用 `Hyperf\Guzzle`、协程版 Redis/MySQL，禁用 `curl_*`（除非配 hook） |
| **DI 单例污染** | 上个请求数据串到下个 | 用 `Context::set/get` 存请求级数据 |
| **AOP 不生效** | 切面没拦截到 | 检查 `proxy_class_dir` 是否被打包；继承/接口方法可能不被代理 |
| **MySQL 连接耗尽** | "Too many connections" | 配置 `pool.max_connections`，业务用完归还 |

---

## 七、什么时候选 Hyperf

✅ **选**：团队 5+ 人、做微服务、有 Java 背景想要类似工程化体验、QPS 要求 1k+
❌ **别选**：单人项目、CRUD 后台、对注解 + DI 不熟 —— 用 Webman 或 Laravel 更快

---

## 参考

- 官网：<https://www.hyperf.io>
- 文档：<https://hyperf.wiki>
- 骨架项目：<https://github.com/hyperf/hyperf-skeleton>
