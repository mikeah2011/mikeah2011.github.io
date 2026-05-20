---
title: EasySwoole
tags: [PHP, 架构]categories:
  - PHP
  - PHP框架
date: 2020-03-20 15:05:07
description: 'EasySwoole 是基于 Swoole 的常驻内存 PHP 框架，专门解决传统 PHP-FPM "请求即销毁" 模式带来的性能瓶颈，适合高并发 API、IM、推送等长连接场景。'
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

## 六、和其他框架对比

| 维度 | EasySwoole | Hyperf | Webman |
|------|-----------|--------|--------|
| 上手难度 | 简单 | 中（注解+依赖注入重） | 极简 |
| 生态 | 中 | 强（注解、AOP、微服务全套） | 中（兼容 Composer 包） |
| 适合 | 中小项目快速起步 | 微服务、企业级 | 替代 FPM 的高性能 Web |

---

## 参考

- 官网：<https://www.easyswoole.com>
- Swoole 文档：<https://wiki.swoole.com>
