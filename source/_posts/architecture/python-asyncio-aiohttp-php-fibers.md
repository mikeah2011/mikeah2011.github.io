---

title: Python asyncio 深度实战：事件循环、协程调度与 aiohttp——PHP Fibers 开发者的异步编程对比
keywords: [Python asyncio, aiohttp, PHP Fibers, 深度实战, 事件循环, 协程调度与, 开发者的异步编程对比]
date: 2026-06-02 10:00:00
tags:
- Python
- asyncio
- aiohttp
- 协程
- PHP Fibers
- 异步编程
- 事件循环
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: Python asyncio 事件循环、协程调度与 aiohttp 的深度实战指南，从 PHP Fibers 开发者视角解析异步编程核心概念。涵盖协程调度原理、异步上下文管理、aiohttp HTTP 客户端、异步数据库操作、并发控制模式，以及与 PHP Fibers 和 Go goroutine 的全面对比，帮助后端开发者掌握 Python 高并发编程。
---



# Python asyncio 深度实战：事件循环、协程调度与 aiohttp——PHP Fibers 开发者的异步编程对比

## 前言

异步编程是现代后端开发中不可回避的课题。作为 Laravel 开发者，我在 PHP 8.1 引入 Fibers 之前，对异步的理解仅限于「在命令行跑一个 Laravel Queue Worker」。PHP 的传统模型是：一个请求对应一个进程，处理完毕后销毁。这种模型简单可靠，但在高并发场景下，每个请求占用一个进程的代价太高。

Python 的 asyncio 则完全不同。它基于事件循环（Event Loop）和协程（Coroutine）模型，允许单个进程同时处理数千个 I/O 密集型任务。这种模型在处理大量并发 API 调用、数据库查询、WebSocket 连接时特别有效。

这篇文章将从 PHP Fibers 开发者的视角出发，深入 Python asyncio 的核心概念。我们会从事件循环的底层原理开始，逐步讲解协程调度、异步上下文管理、aiohttp HTTP 客户端、异步数据库操作，最后与 PHP Fibers 和 Go goroutine 进行对比。无论你是从 PHP 迁移到 Python，还是想在 Python 项目中实现高并发，这篇文章都能给你实用的参考。

---

## 第一章：异步编程基础概念

### 1.1 同步 vs 异步 vs 并行 vs 并发

在开始之前，我们需要厘清几个容易混淆的概念：

```python
# 同步执行 - 顺序执行，阻塞等待
def sync_fetch():
    response1 = requests.get("https://api1.com/data")  # 等待 2 秒
    response2 = requests.get("https://api2.com/data")  # 等待 2 秒
    response3 = requests.get("https://api3.com/data")  # 等待 2 秒
    # 总耗时：6 秒

# 异步执行 - 交替执行，非阻塞等待
async def async_fetch():
    response1 = await aiohttp.get("https://api1.com/data")  # 不阻塞
    response2 = await aiohttp.get("https://api2.com/data")  # 不阻塞
    response3 = await aiohttp.get("https://api3.com/data")  # 不阻塞
    # 总耗时：约 2 秒（取决于最慢的那个）

# 并发执行 - 使用 gather 同时发起多个请求
async def concurrent_fetch():
    async with aiohttp.ClientSession() as session:
        tasks = [
            session.get("https://api1.com/data"),
            session.get("https://api2.com/data"),
            session.get("https://api3.com/data"),
        ]
        responses = await asyncio.gather(*tasks)
        # 总耗时：约 2 秒（取决于最慢的那个）
```

| 概念 | 说明 | Python | PHP | Go |
|------|------|--------|-----|-----|
| 同步 | 顺序执行，阻塞等待 | 默认模式 | 默认模式 | 默认模式 |
| 异步 | 非阻塞，事件驱动 | asyncio | Fibers (8.1+) | select/poll |
| 并发 | 同时处理多个任务 | asyncio | Swoole/Fibers | goroutine |
| 并行 | 真正的同时执行 | multiprocessing | 多进程 | 多 goroutine 多核 |

### 1.2 协程（Coroutine）是什么？

协程是一种可以暂停和恢复的函数。与普通函数不同，协程可以在执行过程中让出控制权，让其他协程运行，然后在适当的时候恢复执行：

```python
import asyncio

# 定义协程函数
async def say_hello():
    print("Hello")
    await asyncio.sleep(1)  # 暂停 1 秒，让出控制权
    print("World")

# 定义另一个协程
async def say_bye():
    print("Bye")
    await asyncio.sleep(0.5)
    print("See you")

# 并发执行两个协程
async def main():
    await asyncio.gather(say_hello(), say_bye())

# 运行
asyncio.run(main())
# 输出：
# Hello
# Bye
# See you  (0.5 秒后)
# World    (1 秒后)
```

### 1.3 与 PHP Fibers 对比

PHP 8.1 引入的 Fibers 是 PHP 的协程实现：

```php
// PHP Fibers
$fiber = new Fiber(function (): void {
    echo "Start\n";
    Fiber::suspend("中间结果");  // 暂停
    echo "End\n";
});

// 启动 fiber
$result = $fiber->start();  // 输出 "Start"，返回 "中间结果"
echo $result . "\n";

// 恢复 fiber
$fiber->resume();  // 输出 "End"
```

| 特性 | Python asyncio | PHP Fibers | Go goroutine |
|------|---------------|------------|--------------|
| 创建方式 | `async def` | `new Fiber(fn)` | `go func()` |
| 暂停 | `await` | `Fiber::suspend()` | channel/`runtime.Gosched()` |
| 恢复 | 事件循环自动调度 | `$fiber->resume()` | Go runtime 自动调度 |
| 调度器 | 事件循环 | 手动 | Go runtime（抢占式） |
| 并发模型 | 协作式 | 协作式 | 抢占式 |
| 适用场景 | I/O 密集型 | I/O 密集型 | 通用 |

---

## 第二章：事件循环深度解析

### 2.1 事件循环原理

事件循环是 asyncio 的核心。它的工作原理：

```python
import asyncio

# 事件循环的核心逻辑（简化版）
class SimpleEventLoop:
    def __init__(self):
        self.ready = []  # 就绪队列
        self.scheduled = []  # 定时任务
    
    def run_until_complete(self, coro):
        """运行直到协程完成"""
        self.ready.append(coro)
        while self.ready:
            task = self.ready.pop(0)
            try:
                # 执行协程，直到遇到 await
                result = task.send(None)
                if isinstance(result, Sleep):
                    # 如果是 sleep，放入定时队列
                    self.scheduled.append((time.time() + result.seconds, task))
                else:
                    # 其他 await，放入就绪队列
                    self.ready.append(task)
            except StopIteration:
                pass  # 协程完成
    
    def run_forever(self):
        """永久运行事件循环"""
        while True:
            # 检查定时任务
            now = time.time()
            for scheduled_time, task in self.scheduled[:]:
                if now >= scheduled_time:
                    self.ready.append(task)
                    self.scheduled.remove((scheduled_time, task))
            
            # 执行就绪任务
            if self.ready:
                task = self.ready.pop(0)
                try:
                    task.send(None)
                except StopIteration:
                    pass
            else:
                time.sleep(0.01)  # 避免 CPU 空转
```

### 2.2 获取和运行事件循环

```python
import asyncio

# Python 3.10+ 推荐方式
async def main():
    print("Hello from coroutine")
    await asyncio.sleep(1)
    print("Coroutine completed")

asyncio.run(main())  # 自动创建、运行、关闭事件循环

# Python 3.7-3.9 方式
loop = asyncio.get_event_loop()
loop.run_until_complete(main())
loop.close()

# 获取当前事件循环
async def get_loop_info():
    loop = asyncio.get_running_loop()
    print(f"Loop: {loop}")
    print(f"Is running: {loop.is_running()}")
    print(f"Is closed: {loop.is_closed()}")
```

### 2.3 事件循环的执行顺序

```python
import asyncio

async def task(name, delay):
    print(f"Task {name} started")
    await asyncio.sleep(delay)
    print(f"Task {name} finished after {delay}s")
    return f"{name} result"

async def main():
    # 顺序执行（串行）
    print("=== 顺序执行 ===")
    result1 = await task("A", 2)  # 等待 2 秒
    result2 = await task("B", 1)  # 再等待 1 秒
    # 总耗时：3 秒
    
    # 并发执行
    print("\n=== 并发执行 ===")
    results = await asyncio.gather(
        task("C", 2),
        task("D", 1),
        task("E", 3),
    )
    # 总耗时：3 秒（取决于最慢的）
    
    # 创建任务（立即调度）
    print("\n=== 创建任务 ===")
    t1 = asyncio.create_task(task("F", 2))
    t2 = asyncio.create_task(task("G", 1))
    
    # 等待所有任务完成
    results = await asyncio.gather(t1, t2)

asyncio.run(main())
```

### 2.4 与 PHP 的事件循环对比

PHP 本身没有内置事件循环，需要借助 Swoole 或 ReactPHP：

```php
// ReactPHP 事件循环
$loop = React\EventLoop\Loop::getLoop();

$loop->addTimer(1, function () {
    echo "Timer fired after 1 second\n";
});

$loop->addPeriodicTimer(0.5, function () {
    echo "Periodic timer fired\n";
});

$loop->run();
```

---

## 第三章：asyncio 核心 API

### 3.1 asyncio.gather — 并发执行多个协程

```python
import asyncio

async def fetch_user(user_id: int) -> dict:
    await asyncio.sleep(0.1)  # 模拟 API 调用
    return {"id": user_id, "name": f"User {user_id}"}

async def fetch_order(order_id: int) -> dict:
    await asyncio.sleep(0.2)  # 模拟 API 调用
    return {"id": order_id, "total": 100.0}

async def fetch_product(product_id: int) -> dict:
    await asyncio.sleep(0.15)  # 模拟 API 调用
    return {"id": product_id, "name": f"Product {product_id}"}

async def get_dashboard_data(user_id: int):
    """并发获取仪表盘所需的所有数据"""
    user, orders, products = await asyncio.gather(
        fetch_user(user_id),
        fetch_order(1),
        fetch_product(1),
    )
    
    return {
        "user": user,
        "orders": orders,
        "products": products,
    }

# 总耗时约 0.2 秒（取决于最慢的 fetch_order）
result = asyncio.run(get_dashboard_data(1))
```

### 3.2 asyncio.wait — 灵活等待

```python
import asyncio

async def fetch_with_timeout(urls: list[str]):
    """带超时的并发请求"""
    tasks = [asyncio.create_task(fetch_url(url)) for url in urls]
    
    # 等待第一个完成
    done, pending = await asyncio.wait(
        tasks,
        return_when=asyncio.FIRST_COMPLETED,
    )
    
    # 处理完成的任务
    for task in done:
        result = task.result()
        print(f"Completed: {result}")
    
    # 取消未完成的任务
    for task in pending:
        task.cancel()
    
    return [task.result() for task in done]

async def fetch_all_or_timeout(urls: list[str], timeout: float):
    """所有任务完成或超时"""
    tasks = [asyncio.create_task(fetch_url(url)) for url in urls]
    
    try:
        done, pending = await asyncio.wait(
            tasks,
            timeout=timeout,
            return_when=asyncio.ALL_COMPLETED,
        )
    except asyncio.TimeoutError:
        print("Timeout!")
        for task in tasks:
            if not task.done():
                task.cancel()
    
    return [task.result() for task in tasks if task.done()]
```

### 3.3 asyncio.create_task — 手动创建任务

```python
import asyncio

async def background_task():
    """后台任务"""
    while True:
        print("Background task running...")
        await asyncio.sleep(5)

async def main():
    # 创建后台任务
    task = asyncio.create_task(background_task())
    
    # 主逻辑继续执行
    for i in range(3):
        print(f"Main task: {i}")
        await asyncio.sleep(1)
    
    # 取消后台任务
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("Background task cancelled")

asyncio.run(main())
```

### 3.4 asyncio.Queue — 异步队列

```python
import asyncio

async def producer(queue: asyncio.Queue, name: str):
    """生产者"""
    for i in range(5):
        item = f"{name}-item-{i}"
        await queue.put(item)
        print(f"[{name}] Produced: {item}")
        await asyncio.sleep(0.5)

async def consumer(queue: asyncio.Queue, name: str):
    """消费者"""
    while True:
        item = await queue.get()
        print(f"[{name}] Consumed: {item}")
        await asyncio.sleep(1)  # 模拟处理时间
        queue.task_done()

async def main():
    queue = asyncio.Queue(maxsize=10)
    
    # 创建生产者和消费者
    producers = [
        asyncio.create_task(producer(queue, f"Producer-{i}"))
        for i in range(2)
    ]
    consumers = [
        asyncio.create_task(consumer(queue, f"Consumer-{i}"))
        for i in range(3)
    ]
    
    # 等待所有生产者完成
    await asyncio.gather(*producers)
    
    # 等待队列被完全消费
    await queue.join()
    
    # 取消消费者
    for c in consumers:
        c.cancel()

asyncio.run(main())
```

### 3.5 对比 PHP 的异步工具

| 功能 | Python asyncio | PHP (Swoole/ReactPHP) |
|------|---------------|----------------------|
| 并发执行 | `asyncio.gather()` | `Co\run()` / `Promise::all()` |
| 等待第一个 | `asyncio.wait(FIRST_COMPLETED)` | `Promise::race()` |
| 超时控制 | `asyncio.wait_for()` | `Timer::add()` |
| 队列 | `asyncio.Queue()` | `Channel` (Swoole) |
| 锁 | `asyncio.Lock()` | `Co::Mutex()` |
| 信号量 | `asyncio.Semaphore()` | `Co::Semaphore()` |
| 事件 | `asyncio.Event()` | `Channel` |

---

## 第四章：aiohttp 异步 HTTP 客户端

### 4.1 基础用法

```python
import aiohttp
import asyncio

async def fetch_url(session: aiohttp.ClientSession, url: str) -> dict:
    """异步获取 URL 内容"""
    async with session.get(url) as response:
        return {
            "url": url,
            "status": response.status,
            "data": await response.json(),
        }

async def main():
    async with aiohttp.ClientSession() as session:
        # 单个请求
        async with session.get("https://api.github.com/user") as response:
            data = await response.json()
            print(data)
        
        # 并发多个请求
        urls = [
            "https://api.github.com/users/1",
            "https://api.github.com/users/2",
            "https://api.github.com/users/3",
        ]
        
        tasks = [fetch_url(session, url) for url in urls]
        results = await asyncio.gather(*tasks)
        
        for result in results:
            print(f"{result['url']}: {result['status']}")

asyncio.run(main())
```

### 4.2 请求配置

```python
import aiohttp
import asyncio

async def advanced_requests():
    # 自定义连接器
    connector = aiohttp.TCPConnector(
        limit=100,  # 最大连接数
        limit_per_host=10,  # 每个主机最大连接数
        ttl_dns_cache=300,  # DNS 缓存 TTL
        enable_cleanup_closed=True,
    )
    
    # 自定义超时
    timeout = aiohttp.ClientTimeout(
        total=30,  # 总超时
        connect=10,  # 连接超时
        sock_read=10,  # 读取超时
    )
    
    async with aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers={"User-Agent": "MyApp/1.0"},
    ) as session:
        # GET 请求
        async with session.get(
            "https://api.example.com/data",
            params={"page": 1, "limit": 20},
        ) as response:
            data = await response.json()
        
        # POST 请求
        async with session.post(
            "https://api.example.com/users",
            json={"name": "张三", "email": "zhangsan@example.com"},
        ) as response:
            result = await response.json()
        
        # PUT 请求
        async with session.put(
            "https://api.example.com/users/1",
            json={"name": "李四"},
        ) as response:
            pass
        
        # DELETE 请求
        async with session.delete("https://api.example.com/users/1") as response:
            pass
        
        # 带认证的请求
        async with session.get(
            "https://api.example.com/protected",
            headers={"Authorization": "Bearer ***"},
        ) as response:
            data = await response.json()

asyncio.run(advanced_requests())
```

### 4.3 重试机制

```python
import aiohttp
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
)
async def fetch_with_retry(session: aiohttp.ClientSession, url: str) -> dict:
    """带重试的异步请求"""
    async with session.get(url) as response:
        if response.status >= 500:
            raise aiohttp.ClientError(f"Server error: {response.status}")
        return await response.json()

async def main():
    async with aiohttp.ClientSession() as session:
        try:
            data = await fetch_with_retry(session, "https://api.example.com/data")
            print(data)
        except Exception as e:
            print(f"Failed after retries: {e}")

asyncio.run(main())
```

### 4.4 并发限制（信号量）

```python
import aiohttp
import asyncio

async def fetch_with_semaphore(
    semaphore: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    url: str,
) -> dict:
    """带并发限制的请求"""
    async with semaphore:  # 限制并发数
        async with session.get(url) as response:
            return await response.json()

async def fetch_all(urls: list[str], max_concurrent: int = 10):
    """并发获取多个 URL，限制并发数"""
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async with aiohttp.ClientSession() as session:
        tasks = [
            fetch_with_semaphore(semaphore, session, url)
            for url in urls
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)

# 使用示例
urls = [f"https://api.example.com/users/{i}" for i in range(100)]
results = asyncio.run(fetch_all(urls, max_concurrent=10))
```

### 4.5 对比 Laravel HTTP Client

```php
// Laravel HTTP Client（同步）
$response = Http::get('https://api.example.com/data');
$data = $response->json();

// 并发请求
$responses = Http::pool(fn ($pool) => [
    $pool->get('https://api1.com/data'),
    $pool->get('https://api2.com/data'),
    $pool->get('https://api3.com/data'),
]);

// 带重试
$response = Http::retry(3, 1000)->get('https://api.example.com/data');
```

| 功能 | Python aiohttp | Laravel HTTP Client |
|------|---------------|---------------------|
| 异步请求 | 原生支持 | 同步（curl_multi 模拟） |
| 连接池 | TCPConnector | 底层 curl |
| 并发限制 | Semaphore | 无内置支持 |
| 超时控制 | ClientTimeout | `timeout()` |
| 重试 | tenacity 库 | `retry()` |
| 流式响应 | `response.content.iter_any()` | `response()->stream()` |

---

## 第五章：异步数据库操作

### 5.1 asyncpg — PostgreSQL 异步驱动

```python
import asyncpg
import asyncio

async def main():
    # 创建连接池
    pool = await asyncpg.create_pool(
        "postgresql://user:***@localhost:5432/mydb",
        min_size=5,
        max_size=20,
    )
    
    async with pool.acquire() as conn:
        # 查询
        rows = await conn.fetch("SELECT * FROM users WHERE age > $1", 18)
        for row in rows:
            print(f"User: {row['name']}, Age: {row['age']}")
        
        # 查询单条
        row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", 1)
        if row:
            print(f"User: {row['name']}")
        
        # 查询单个值
        count = await conn.fetchval("SELECT COUNT(*) FROM users")
        print(f"Total users: {count}")
        
        # 执行（INSERT/UPDATE/DELETE）
        result = await conn.execute(
            "INSERT INTO users (name, email, age) VALUES ($1, $2, $3)",
            "张三", "zhangsan@example.com", 25
        )
        print(f"Result: {result}")
        
        # 事务
        async with conn.transaction():
            await conn.execute(
                "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
                100, 1
            )
            await conn.execute(
                "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
                100, 2
            )
    
    await pool.close()

asyncio.run(main())
```

### 5.2 SQLAlchemy 异步模式

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, Integer, String, select

DATABASE_URL = "postgresql+asyncpg://user:***@localhost:5432/mydb"

engine = create_async_engine(DATABASE_URL, pool_size=20, max_overflow=10)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    email = Column(String(255))

async def get_users():
    async with async_session() as session:
        result = await session.execute(select(User).where(User.id > 0))
        users = result.scalars().all()
        return users

async def create_user(name: str, email: str):
    async with async_session() as session:
        async with session.begin():
            user = User(name=name, email=email)
            session.add(user)
        return user

asyncio.run(get_users())
```

---

## 第六章：异步上下文管理器与生成器

### 6.1 异步上下文管理器

```python
import aiohttp
import asyncio

class AsyncHTTPClient:
    """异步 HTTP 客户端上下文管理器"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get(self, path: str) -> dict:
        async with self.session.get(f"{self.base_url}{path}") as response:
            return await response.json()
    
    async def post(self, path: str, data: dict) -> dict:
        async with self.session.post(f"{self.base_url}{path}", json=data) as response:
            return await response.json()

# 使用
async def main():
    async with AsyncHTTPClient("https://api.example.com") as client:
        users = await client.get("/users")
        new_user = await client.post("/users", {"name": "张三"})

asyncio.run(main())
```

### 6.2 异步生成器

```python
import asyncio

async def async_range(start: int, stop: int, step: int = 1):
    """异步生成器"""
    for i in range(start, stop, step):
        await asyncio.sleep(0.1)  # 模拟异步操作
        yield i

async def main():
    async for num in async_range(0, 10):
        print(num)

asyncio.run(main())
```

---

## 第七章：实战案例——API 聚合网关

### 7.1 BFF 聚合示例

```python
import asyncio
import aiohttp
from fastapi import FastAPI, Depends

app = FastAPI()

class ServiceClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = None
    
    async def get_session(self):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def get(self, path: str) -> dict:
        session = await self.get_session()
        async with session.get(f"{self.base_url}{path}") as response:
            return await response.json()
    
    async def close(self):
        if self.session:
            await self.session.close()

# 服务客户端
user_service = ServiceClient("http://user-service:8001")
order_service = ServiceClient("http://order-service:8002")
product_service = ServiceClient("http://product-service:8003")

@app.get("/dashboard/{user_id}")
async def get_dashboard(user_id: int):
    """聚合仪表盘数据"""
    # 并发请求多个服务
    user_task = user_service.get(f"/users/{user_id}")
    orders_task = order_service.get(f"/users/{user_id}/orders")
    products_task = product_service.get("/products/popular")
    
    user, orders, products = await asyncio.gather(
        user_task,
        orders_task,
        products_task,
        return_exceptions=True,  # 捕获异常而不是抛出
    )
    
    # 处理异常
    if isinstance(user, Exception):
        user = {"error": str(user)}
    if isinstance(orders, Exception):
        orders = {"error": str(orders)}
    if isinstance(products, Exception):
        products = {"error": str(products)}
    
    return {
        "user": user,
        "recent_orders": orders,
        "popular_products": products,
    }

@app.get("/users/{user_id}/detail")
async def get_user_detail(user_id: int):
    """用户详情 - 串行依赖"""
    # 先获取用户信息
    user = await user_service.get(f"/users/{user_id}")
    
    # 然后并发获取关联数据
    orders_task = order_service.get(f"/users/{user_id}/orders")
    addresses_task = user_service.get(f"/users/{user_id}/addresses")
    
    orders, addresses = await asyncio.gather(orders_task, addresses_task)
    
    return {
        "user": user,
        "orders": orders,
        "addresses": addresses,
    }
```

### 7.2 与 Laravel BFF 对比

```php
// Laravel BFF - 同步方式
class DashboardController
{
    public function show(int $userId)
    {
        // 顺序请求 - 总耗时 = 三个请求之和
        $user = Http::get("http://user-service/users/{$userId}")->json();
        $orders = Http::get("http://order-service/users/{$userId}/orders")->json();
        $products = Http::get("http://product-service/products/popular")->json();
        
        return [
            'user' => $user,
            'recent_orders' => $orders,
            'popular_products' => $products,
        ];
    }
    
    // Laravel HTTP Pool - 并发方式
    public function showConcurrent(int $userId)
    {
        $responses = Http::pool(fn ($pool) => [
            $pool->get("http://user-service/users/{$userId}"),
            $pool->get("http://order-service/users/{$userId}/orders"),
            $pool->get("http://product-service/products/popular"),
        ]);
        
        return [
            'user' => $responses[0]->json(),
            'recent_orders' => $responses[1]->json(),
            'popular_products' => $responses[2]->json(),
        ];
    }
}
```

---

## 第八章：异步编程最佳实践

### 8.1 常见陷阱

```python
# 陷阱 1：忘记 await
async def bad_example():
    asyncio.sleep(1)  # 忘记 await，不会实际等待！
    print("This runs immediately")

# 正确
async def good_example():
    await asyncio.sleep(1)
    print("This runs after 1 second")

# 陷阱 2：在异步函数中使用同步阻塞操作
async def bad_blocking():
    import time
    time.sleep(5)  # 阻塞整个事件循环！
    print("Done")

# 正确：使用 asyncio.sleep 或在执行器中运行
async def good_blocking():
    await asyncio.sleep(5)
    print("Done")

# 或者使用执行器
import asyncio
async def run_in_executor():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, time.sleep, 5)

# 陷阱 3：在循环中创建任务但不等待
async def bad_gather():
    for i in range(10):
        asyncio.create_task(some_coroutine(i))  # 任务可能未完成！

# 正确
async def good_gather():
    tasks = [asyncio.create_task(some_coroutine(i)) for i in range(10)]
    await asyncio.gather(*tasks)

# 陷阱 4：异常处理不当
async def bad_exception():
    try:
        await asyncio.gather(
            might_fail_1(),
            might_fail_2(),
        )
    except Exception as e:
        print(f"Error: {e}")  # 一个失败，其他也被取消

# 正确：使用 return_exceptions
async def good_exception():
    results = await asyncio.gather(
        might_fail_1(),
        might_fail_2(),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, Exception):
            print(f"Error: {result}")
        else:
            print(f"Result: {result}")
```

### 8.2 性能优化

```python
import asyncio
import aiohttp

# 优化 1：复用连接池
async def optimized_requests():
    connector = aiohttp.TCPConnector(limit=100)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 所有请求复用同一个 session
        tasks = [session.get(url) for url in urls]
        # ...

# 优化 2：使用信号量控制并发
async def controlled_concurrency():
    semaphore = asyncio.Semaphore(10)  # 最多 10 个并发
    
    async def fetch(url):
        async with semaphore:
            async with session.get(url) as response:
                return await response.json()
    
    tasks = [fetch(url) for url in urls]
    return await asyncio.gather(*tasks)

# 优化 3：批量处理
async def batch_process(items: list, batch_size: int = 100):
    """分批处理大量数据"""
    results = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        batch_results = await asyncio.gather(
            *[process_item(item) for item in batch]
        )
        results.extend(batch_results)
    return results
```

---

## 第九章：Python asyncio vs PHP Fibers vs Go goroutine

### 9.1 并发模型对比

| 维度 | Python asyncio | PHP Fibers | Go goroutine |
|------|---------------|------------|--------------|
| 调度方式 | 协作式（事件循环） | 协作式（手动） | 抢占式（Go runtime） |
| 创建开销 | 低（约 1KB） | 低 | 极低（约 2KB） |
| 并发数量 | 数千（单线程） | 数百（单进程） | 数十万 |
| CPU 密集型 | 需要多进程 | 需要多进程 | 原生支持 |
| I/O 密集型 | 优秀 | 良好 | 优秀 |
| 学习曲线 | 中等 | 低 | 低 |
| 生态系统 | 丰富（aiohttp, asyncpg） | 成长中 | 丰富 |

### 9.2 代码对比

```python
# Python asyncio
async def fetch_all(urls):
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(url) for url in urls]
        return await asyncio.gather(*tasks)
```

```php
// PHP Fibers + Swoole
function fetchAll(array $urls): array {
    $results = [];
    foreach ($urls as $url) {
        $results[] = (new Fiber(function() use ($url) {
            return Swoole\Coroutine\Http\get($url);
        }))->start();
    }
    return $results;
}
```

```go
// Go goroutine
func fetchAll(urls []string) []Result {
    results := make([]Result, len(urls))
    var wg sync.WaitGroup
    
    for i, url := range urls {
        wg.Add(1)
        go func(i int, url string) {
            defer wg.Done()
            results[i] = fetch(url)
        }(i, url)
    }
    
    wg.Wait()
    return results
}
```

### 9.3 选型建议

- **Python asyncio**：适合 I/O 密集型 API 服务、数据处理管道、爬虫
- **PHP Fibers**：适合 Laravel 项目中的并发 API 调用、队列处理
- **Go goroutine**：适合高性能后端服务、微服务、系统级编程

---

## 总结

Python asyncio 提供了一套完整的异步编程解决方案。对于从 PHP 迁移过来的开发者，关键的思维转变是：

1. **从同步到异步**：用 `async def` 和 `await` 替代同步调用
2. **从进程到协程**：单进程内的并发，而不是多进程
3. **从阻塞到非阻塞**：使用异步 I/O 库（aiohttp, asyncpg）
4. **从顺序到并发**：用 `asyncio.gather()` 并发执行多个任务

异步编程不是银弹。它在 I/O 密集型场景下表现出色，但在 CPU 密集型场景下反而可能更慢（因为协程切换有开销）。选择合适的工具，根据场景做正确的权衡，才是工程实践的核心。

---

## 参考资料

- [Python asyncio 官方文档](https://docs.python.org/3/library/asyncio.html)
- [aiohttp 官方文档](https://docs.aiohttp.org/)
- [asyncpg 官方文档](https://magicstack.github.io/asyncpg/)
- [PHP Fibers RFC](https://wiki.php.net/rfc/fibers)
- [Go Concurrency Patterns](https://go.dev/blog/pipelines)

## 相关阅读

- [Swift Structured Concurrency 实战：async/await、TaskGroup、Actor 模型](/categories/Swift/Swift-Structured-Concurrency-async-await-TaskGroup-Actor-PHP-Fibers-Go-goroutine/)
- [Go for PHP Developers 实战：goroutine/channel 并发模型](/categories/架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go Context 深度实战：超时控制、取消传播与请求作用域](/categories/运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)
