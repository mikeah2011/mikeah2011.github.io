---

title: Swift Structured Concurrency 实战：async/await、TaskGroup、Actor 模型——与 PHP Fibers/Go
keywords: [Swift Structured Concurrency, async, await, TaskGroup, Actor, PHP Fibers, Go, 模型]
date: 2026-06-02 12:00:00
tags:
- Swift
- Concurrency
- async-await
- TaskGroup
- Actor
- PHP Fibers
- Go
categories:
- misc
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
description: 深入解析 Swift Structured Concurrency 的 async/await、TaskGroup、Actor 三大核心机制，通过实战代码与 PHP Fibers 和 Go goroutine 进行并发模型深度对比。涵盖编译器安全保障、数据竞争检测、性能基准测试、并发陷阱排查，帮助开发者理解不同语言的并发哲学，为 iOS、后端和微服务架构做出正确的并发选型决策。
---



## 引言：为什么并发编程如此重要？

在现代软件开发中，并发编程已经从"高级话题"变成了"日常必备"。无论是 iOS 应用的 UI 响应性、后端服务的高吞吐处理，还是微服务架构中的异步通信，并发模型的选择直接决定了应用的性能上限和代码的可维护性。

Swift 5.5 引入的 Structured Concurrency 是 Apple 对并发编程的一次彻底革新。它不仅仅是语法糖，更是一种编译器强制保证安全性的并发范式。与 PHP 的 Fibers 和 Go 的 goroutine 相比，Swift 的方案在安全性、可组合性和类型系统集成方面走了一条独特的道路。

本文将深入探讨 Swift Structured Concurrency 的三大核心机制——`async/await`、`TaskGroup` 和 `Actor` 模型，并通过实战代码与 PHP Fibers、Go goroutine 进行深度对比，帮助你理解不同语言的并发哲学和选型决策。

---

## 第一章：并发模型的哲学差异

### 1.1 三种并发哲学

在深入代码之前，我们先理解三种语言的并发设计哲学：

**Go 的 CSP（Communicating Sequential Processes）模型**：
- 核心理念："Don't communicate by sharing memory; share memory by communicating."
- goroutine 是极其轻量的绿色线程（初始栈仅 2KB，可动态增长）
- channel 是 goroutine 之间通信的一等公民
- 调度器（GMP 模型）对开发者完全透明
- 没有编译时安全保证，数据竞争在运行时检测

**PHP 的协作式并发模型**：
- Fibers 是 PHP 8.1 引入的底层原语
- 本质上是协程（coroutine），需要手动挂起和恢复
- 没有内置的并发原语（如 channel），依赖第三方库（ReactPHP、Amp）
- 单线程模型，真正的并行需要多进程或 Swoole
- 设计目标是 I/O 并发，而非 CPU 并行

**Swift 的 Structured Concurrency 模型**：
- 核心理念：并发代码的结构应该和同步代码一样清晰
- 编译器强制保证数据竞争安全（Swift 6 的严格并发检查）
- 通过 Sendable 协议标记可安全跨并发域传递的类型
- Actor 模型提供状态隔离，而非共享内存
- 与类型系统深度集成，编译时捕获并发错误

### 1.2 结构化 vs 非结构化

Swift 的"结构化"体现在任务的生命周期管理上：

```swift
// 结构化并发：子任务的生命周期绑定到父作用域
func fetchUserData() async throws -> UserProfile {
    async let name = fetchName()        // 子任务 1
    async let avatar = fetchAvatar()    // 子任务 2
    async let orders = fetchOrders()    // 子任务 3
    
    // 等待所有子任务完成，自动取消未完成的任务
    return try await UserProfile(
        name: name,
        avatar: avatar,
        orders: orders
    )
}
```

Go 中类似的并发需要手动管理：

```go
func fetchUserData(ctx context.Context) (*UserProfile, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel() // 需要手动管理取消
    
    var (
        name    string
        avatar  string
        orders  []Order
        errs    = make(chan error, 3)
    )
    
    go func() { /* fetch name */ }()
    go func() { /* fetch avatar */ }()
    go func() { /* fetch orders */ }()
    
    // 需要手动等待和错误处理
    for i := 0; i < 3; i++ {
        if err := <-errs; err != nil {
            return nil, err
        }
    }
    return &UserProfile{Name: name, Avatar: avatar, Orders: orders}, nil
}
```

PHP 中则需要依赖扩展库：

```php
// 使用 ReactPHP
function fetchUserData(): PromiseInterface {
    return all([
        fetchName(),
        fetchAvatar(),
        fetchOrders(),
    ])->then(function ($results) {
        return new UserProfile(...$results);
    });
}
```

---

## 第二章：async/await 深入剖析

### 2.1 Swift 的 async/await

Swift 的 `async/await` 不仅仅是语法转换，它与 Swift 的类型系统深度集成：

```swift
// 异步函数是类型系统的一部分
func fetchUser(id: Int) async throws -> User {
    let url = URL(string: "https://api.example.com/users/\(id)")!
    let (data, response) = try await URLSession.shared.data(from: url)
    
    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw NetworkError.invalidResponse
    }
    
    return try JSONDecoder().decode(User.self, from: data)
}

// 异步序列
func processUserStream() async {
    for await user in userStream {
        await processUser(user)
    }
}
```

**关键特性：**
- `async` 标记函数可能挂起，编译器强制调用者使用 `await`
- 异步序列（`AsyncSequence`）提供流式数据处理
- 与 `throws` 组合使用，类型签名明确表达可能的失败
- 编译器会检查所有 `await` 点的上下文安全性

### 2.2 Go 的 goroutine 和 channel

Go 的并发基于 goroutine 和 channel，没有 async/await 语法：

```go
// Go 的并发是启动 goroutine + channel 通信
func fetchUser(ctx context.Context, id int) (*User, error) {
    ch := make(chan result, 1)
    
    go func() {
        url := fmt.Sprintf("https://api.example.com/users/%d", id)
        resp, err := http.Get(url)
        if err != nil {
            ch <- result{err: err}
            return
        }
        defer resp.Body.Close()
        
        var user User
        if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
            ch <- result{err: err}
            return
        }
        ch <- result{user: &user}
    }()
    
    select {
    case r := <-ch:
        return r.user, r.err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

**Go 的特点：**
- goroutine 极其轻量，可以轻松启动数十万个
- channel 是类型安全的通信管道
- `select` 语句处理多个 channel 操作
- context 包提供取消传播和超时控制
- 没有编译时的数据竞争检测，依赖 `go run -race` 运行时检测

### 2.3 PHP 的 Fibers

PHP 8.1 的 Fibers 是最底层的协程原语：

```php
// PHP Fibers 是非常底层的原语
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('fiber started');
    echo "Fiber resumed with: $value\n";
    
    $value = Fiber::suspend('fiber paused again');
    echo "Fiber resumed with: $value\n";
});

// 手动控制执行流
$result = $fiber->start();       // "fiber started"
echo "Main got: $result\n";

$result = $fiber->resume('hello'); // "Fiber resumed with: hello"
echo "Main got: $result\n";

$fiber->resume('world');          // "Fiber resumed with: world"
```

在实际的异步框架中，Fibers 被封装成更高级的 API：

```php
// 使用 Amp v3 (基于 Fibers)
async function fetchUser(int $id): User {
    $response = await(
        HttpClient::request("GET", "https://api.example.com/users/$id")
    );
    return User::fromJson($response->getBody());
}

// 并发执行
$userA = async(fn() => fetchUser(1));
$userB = async(fn() => fetchUser(2));

// 等待结果
$resultA = await($userA);
$resultB = await($userB);
```

### 2.4 三者对比

| 特性 | Swift async/await | Go goroutine | PHP Fibers |
|------|------------------|-------------|-----------|
| 调度方式 | 协作式 + 运行时调度 | GMP 抢占式调度 | 协作式手动调度 |
| 内存开销 | ~512 bytes/task | ~2KB 初始栈 | ~几KB |
| 编译时安全 | ✅ 强制检查 | ❌ 运行时检测 | ❌ 无检查 |
| 取消传播 | ✅ 结构化自动取消 | ⚠️ 手动 context | ❌ 手动管理 |
| 背压支持 | ✅ AsyncSequence | ⚠️ 手动实现 | ⚠️ 依赖框架 |
| 学习曲线 | 中等 | 低 | 高（底层原语） |

---

## 第三章：TaskGroup —— 动态并发任务管理

### 3.1 Swift TaskGroup

`TaskGroup` 是 Swift 中处理动态数量并发任务的核心工具：

```swift
// 使用 TaskGroup 并发处理多个任务
func fetchAllUsers(ids: [Int]) async throws -> [User] {
    try await withThrowingTaskGroup(of: User.self) { group in
        for id in ids {
            group.addTask {
                try await self.fetchUser(id: id)
            }
        }
        
        var users: [User] = []
        for try await user in group {
            users.append(user)
        }
        return users
    }
}

// 带超时控制
func fetchWithTimeout<T>(
    timeout: Duration,
    operation: @escaping () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T?.self) { group in
        group.addTask {
            try await operation()
        }
        
        group.addTask {
            try await Task.sleep(for: timeout)
            return nil
        }
        
        for try await result in group {
            if let result {
                group.cancelAll()
                return result
            }
        }
        throw TimeoutError()
    }
}

// 限制并发数
func fetchUsersWithLimit(
    ids: [Int],
    maxConcurrent: Int = 5
) async throws -> [User] {
    try await withThrowingTaskGroup(of: User.self) { group in
        var results: [User] = []
        var index = 0
        
        // 启动初始批次
        let initialBatch = min(maxConcurrent, ids.count)
        for i in 0..<initialBatch {
            group.addTask {
                try await self.fetchUser(id: ids[i])
            }
        }
        index = initialBatch
        
        // 每完成一个任务，启动下一个
        for try await user in group {
            results.append(user)
            if index < ids.count {
                group.addTask {
                    try await self.fetchUser(id: ids[index])
                }
                index += 1
            }
        }
        return results
    }
}
```

### 3.2 Go 的 WaitGroup 和 errgroup

Go 中实现类似功能需要使用 `sync.WaitGroup` 或 `errgroup`：

```go
// 使用 errgroup 并发处理多个任务
func fetchAllUsers(ctx context.Context, ids []int) ([]User, error) {
    g, ctx := errgroup.WithContext(ctx)
    users := make([]User, len(ids))
    
    for i, id := range ids {
        i, id := i, id // Go 1.22 之前需要此捕获
        g.Go(func() error {
            user, err := fetchUser(ctx, id)
            if err != nil {
                return err
            }
            users[i] = *user
            return nil
        })
    }
    
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return users, nil
}

// 限制并发数（使用 semaphore）
func fetchUsersWithLimit(ctx context.Context, ids []int, maxConcurrent int) ([]User, error) {
    g, ctx := errgroup.WithContext(ctx)
    sem := make(chan struct{}, maxConcurrent)
    users := make([]User, len(ids))
    
    for i, id := range ids {
        i, id := i, id
        sem <- struct{}{} // 获取信号量
        g.Go(func() error {
            defer func() { <-sem }() // 释放信号量
            user, err := fetchUser(ctx, id)
            if err != nil {
                return err
            }
            users[i] = *user
            return nil
        })
    }
    
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return users, nil
}
```

### 3.3 PHP 的并发处理

PHP 中使用 Amp 框架实现类似功能：

```php
// 使用 Amp 并发处理
function fetchAllUsers(array $ids): array {
    $futures = [];
    foreach ($ids as $id) {
        $futures[$id] = async(fn() => fetchUser($id));
    }
    
    $users = [];
    foreach ($futures as $id => $future) {
        $users[$id] = await($future);
    }
    return $users;
}

// 限制并发数
function fetchUsersWithLimit(array $ids, int $maxConcurrent = 5): array {
    $semaphore = new LocalSemaphore($maxConcurrent);
    $futures = [];
    
    foreach ($ids as $id) {
        $futures[$id] = async(function() use ($id, $semaphore) {
            $lock = await($semaphore->acquire());
            try {
                return fetchUser($id);
            } finally {
                $lock->release();
            }
        });
    }
    
    $users = [];
    foreach ($futures as $id => $future) {
        $users[$id] = await($future);
    }
    return $users;
}
```

### 3.4 对比分析

| 特性 | Swift TaskGroup | Go errgroup | PHP Amp |
|------|----------------|-------------|---------|
| 类型安全 | ✅ 泛型约束 | ✅ 泛型 | ⚠️ 动态类型 |
| 取消传播 | ✅ 自动 | ⚠️ 通过 context | ❌ 手动 |
| 错误处理 | ✅ throw 自动取消其他 | ✅ 第一个错误 | ⚠️ 需手动聚合 |
| 结果收集 | ✅ AsyncSequence | ⚠️ 手动收集 | ⚠️ 手动收集 |
| 并发限制 | ⚠️ 手动实现 | ⚠️ semaphore 模式 | ✅ Semaphore |

---

## 第四章：Actor 模型 —— 状态隔离

### 4.1 Swift Actor

Actor 是 Swift Structured Concurrency 的核心创新之一，它提供了编译时强制的状态隔离：

```swift
// Actor 定义
actor BankAccount {
    let id: String
    private var balance: Decimal
    
    init(id: String, balance: Decimal) {
        self.id = id
        self.balance = balance
    }
    
    // 所有访问都需要 await（即使是读取）
    func getBalance() -> Decimal {
        return balance
    }
    
    // 可变状态自动保护
    func transfer(to other: BankAccount, amount: Decimal) async throws {
        guard balance >= amount else {
            throw BankError.insufficientFunds
        }
        
        balance -= amount
        await other.deposit(amount: amount)
    }
    
    func deposit(amount: Decimal) {
        balance += amount
    }
}

// 使用 Actor
let accountA = BankAccount(id: "A", balance: 1000)
let accountB = BankAccount(id: "B", balance: 500)

// 所有访问都通过 await
Task {
    let balance = await accountA.getBalance()
    print("Balance: \(balance)")
    
    try await accountA.transfer(to: accountB, amount: 100)
}

// nonisolated：不需要 actor 隔离的方法
extension BankAccount {
    nonisolated var description: String {
        return "Account \(id)"
    }
}

// GlobalActor：全局隔离域
@MainActor
class ViewModel: ObservableObject {
    @Published var users: [User] = []
    @Published var isLoading = false
    
    func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            users = try await userService.fetchAll()
        } catch {
            // 错误处理
        }
    }
}
```

### 4.2 Actor 的重入问题

Swift Actor 的一个重要特性是默认允许重入，这可能导致意想不到的行为：

```swift
actor ImageDownloader {
    private var cache: [URL: Image] = [:]
    private var inProgress: [URL: Task<Image, Error>] = [:]
    
    // ⚠️ 有重入风险的版本
    func download(url: URL) async throws -> Image {
        if let cached = cache[url] {
            return cached
        }
        
        // 在这里，其他任务可能已经开始下载同一个 URL
        // 因为 await 会挂起，允许其他任务执行
        
        let image = try await downloadFromNetwork(url)
        cache[url] = image
        return image
    }
    
    // ✅ 使用 Task 缓存防止重复下载
    func downloadSafe(url: URL) async throws -> Image {
        if let cached = cache[url] {
            return cached
        }
        
        if let existingTask = inProgress[url] {
            return try await existingTask.value
        }
        
        let task = Task {
            try await downloadFromNetwork(url)
        }
        inProgress[url] = task
        
        do {
            let image = try await task.value
            cache[url] = image
            inProgress[url] = nil
            return image
        } catch {
            inProgress[url] = nil
            throw error
        }
    }
}
```

### 4.3 Go 的并发安全：Mutex 和 Channel

Go 没有 Actor 概念，需要使用 mutex 或 channel 来保护共享状态：

```go
// 使用 Mutex 保护共享状态
type BankAccount struct {
    mu      sync.RWMutex
    id      string
    balance decimal.Decimal
}

func (a *BankAccount) GetBalance() decimal.Decimal {
    a.mu.RLock()
    defer a.mu.RUnlock()
    return a.balance
}

func (a *BankAccount) Deposit(amount decimal.Decimal) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.balance = a.balance.Add(amount)
}

func (a *BankAccount) Transfer(to *BankAccount, amount decimal.Decimal) error {
    // ⚠️ 需要小心锁顺序以避免死锁
    a.mu.Lock()
    if a.balance.LessThan(amount) {
        a.mu.Unlock()
        return ErrInsufficientFunds
    }
    a.balance = a.balance.Sub(amount)
    a.mu.Unlock()
    
    to.Deposit(amount)
    return nil
}

// 使用 Channel 模式（更 Go 风格）
type BankCommand struct {
    action  string
    amount  decimal.Decimal
    reply   chan decimal.Decimal
    errCh   chan error
}

type BankAccountWithChannel struct {
    id      string
    balance decimal.Decimal
    cmdCh   chan BankCommand
}

func NewBankAccountWithChannel(id string, balance decimal.Decimal) *BankAccountWithChannel {
    acc := &BankAccountWithChannel{
        id:      id,
        balance: balance,
        cmdCh:   make(chan BankCommand, 100),
    }
    go acc.run() // 单独的 goroutine 处理命令
    return acc
}

func (a *BankAccountWithChannel) run() {
    for cmd := range a.cmdCh {
        switch cmd.action {
        case "deposit":
            a.balance = a.balance.Add(cmd.amount)
            cmd.reply <- a.balance
        case "get":
            cmd.reply <- a.balance
        }
    }
}
```

### 4.4 PHP 中的状态隔离

PHP 是单线程的，通常不需要 Actor 模式，但在 Swoole 协程环境中需要考虑：

```php
// PHP Swoole 协程环境下的状态保护
class BankAccount
{
    private string $id;
    private Decimal $balance;
    private Swoole\Coroutine\Channel $lock;
    
    public function __construct(string $id, Decimal $balance)
    {
        $this->id = $id;
        $this->balance = $balance;
        $this->lock = new Swoole\Coroutine\Channel(1);
    }
    
    public function getBalance(): Decimal
    {
        $this->lock->push(true);
        try {
            return $this->balance;
        } finally {
            $this->lock->pop();
        }
    }
    
    public function deposit(Decimal $amount): void
    {
        $this->lock->push(true);
        try {
            $this->balance = $this->balance->add($amount);
        } finally {
            $this->lock->pop();
        }
    }
}
```

### 4.5 Actor 模型对比

| 特性 | Swift Actor | Go Mutex/Channel | PHP Swoole |
|------|------------|------------------|------------|
| 编译时安全 | ✅ 强制隔离 | ❌ 运行时 | ❌ 运行时 |
| 重入保护 | ✅ 自动排队 | ⚠️ 手动管理 | ⚠️ 手动管理 |
| 死锁风险 | ✅ 无死锁 | ⚠️ 锁顺序问题 | ⚠️ Channel 死锁 |
| 性能开销 | 中（消息传递） | 低（直接锁） | 低（协程切换） |
| 全局 Actor | ✅ @MainActor | ❌ 需手动实现 | ❌ 无 |

---

## 第五章：实战案例 —— 并发 HTTP 服务

### 5.1 Swift HTTP 服务（使用 Actor）

```swift
import Foundation

actor RequestHandler {
    private var cache: [String: CachedResponse] = [:]
    private let database: DatabasePool
    private let httpClient: URLSession
    
    init(database: DatabasePool) {
        self.database = database
        self.httpClient = URLSession.shared
    }
    
    func handleRequest(_ request: HTTPRequest) async throws -> HTTPResponse {
        // 1. 检查缓存
        if let cached = cache[request.path],
           !cached.isExpired {
            return cached.response
        }
        
        // 2. 并发获取数据
        async let dbData = database.query(request.query)
        async let apiData = fetchExternalAPI(request.externalEndpoint)
        
        let (db, api) = try await (dbData, apiData)
        
        // 3. 合并结果
        let response = try composeResponse(db: db, api: api)
        
        // 4. 缓存
        cache[request.path] = CachedResponse(
            response: response,
            expiry: Date().addingTimeInterval(300)
        )
        
        return response
    }
}

// 使用 TaskGroup 处理批量请求
func handleBatchRequests(
    handler: RequestHandler,
    requests: [HTTPRequest]
) async -> [HTTPResponse] {
    await withTaskGroup(of: HTTPResponse?.self) { group in
        for request in requests {
            group.addTask {
                do {
                    return try await handler.handleRequest(request)
                } catch {
                    print("Request failed: \(error)")
                    return nil
                }
            }
        }
        
        var responses: [HTTPResponse] = []
        for await response in group {
            if let response {
                responses.append(response)
            }
        }
        return responses
    }
}
```

### 5.2 Go HTTP 服务

```go
type RequestHandler struct {
    cache      sync.Map
    db         *sql.DB
    httpClient *http.Client
}

func (h *RequestHandler) HandleRequest(ctx context.Context, req *HTTPRequest) (*HTTPResponse, error) {
    // 1. 检查缓存
    if cached, ok := h.cache.Load(req.Path); ok {
        if resp := cached.(*CachedResponse); !resp.IsExpired() {
            return resp.Response, nil
        }
    }
    
    // 2. 并发获取数据
    type dbResult struct {
        data interface{}
        err  error
    }
    type apiResult struct {
        data interface{}
        err  error
    }
    
    dbCh := make(chan dbResult, 1)
    apiCh := make(chan apiResult, 1)
    
    go func() {
        data, err := h.db.QueryContext(ctx, req.Query)
        dbCh <- dbResult{data, err}
    }()
    
    go func() {
        data, err := h.fetchExternalAPI(ctx, req.ExternalEndpoint)
        apiCh <- apiResult{data, err}
    }()
    
    // 3. 等待两个结果
    var dbData, apiData interface{}
    for i := 0; i < 2; i++ {
        select {
        case r := <-dbCh:
            if r.err != nil {
                return nil, r.err
            }
            dbData = r.data
        case r := <-apiCh:
            if r.err != nil {
                return nil, r.err
            }
            apiData = r.data
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    
    // 4. 合并和缓存
    response := composeResponse(dbData, apiData)
    h.cache.Store(req.Path, &CachedResponse{
        Response: response,
        Expiry:   time.Now().Add(5 * time.Minute),
    })
    
    return response, nil
}
```

### 5.3 PHP HTTP 服务（使用 Amp）

```php
class RequestHandler
{
    private array $cache = [];
    private PDO $db;
    private HttpClient $httpClient;
    
    public function handleRequest(HTTPRequest $request): HTTPResponse
    {
        // 1. 检查缓存
        if (isset($this->cache[$request->path])) {
            $cached = $this->cache[$request->path];
            if (!$cached->isExpired()) {
                return $cached->response;
            }
        }
        
        // 2. 并发获取数据
        $dbFuture = async(fn() => $this->db->query($request->query));
        $apiFuture = async(fn() => $this->fetchExternalAPI($request->externalEndpoint));
        
        $dbData = await($dbFuture);
        $apiData = await($apiFuture);
        
        // 3. 合并和缓存
        $response = $this->composeResponse($dbData, $apiData);
        $this->cache[$request->path] = new CachedResponse(
            response: $response,
            expiry: time() + 300
        );
        
        return $response;
    }
    
    public function handleBatch(array $requests): array
    {
        $futures = [];
        foreach ($requests as $request) {
            $futures[] = async(function() use ($request) {
                try {
                    return $this->handleRequest($request);
                } catch (\Throwable $e) {
                    return null;
                }
            });
        }
        
        $responses = [];
        foreach ($futures as $future) {
            $responses[] = await($future);
        }
        return array_filter($responses);
    }
}
```

---

## 第六章：错误处理与取消机制

### 6.1 Swift 的结构化取消

```swift
// Swift 的取消是协作式的，但有结构化保证
func downloadFile(url: URL) async throws -> Data {
    let (data, _) = try await URLSession.shared.data(from: url)
    
    // 检查取消状态（最佳实践）
    try Task.checkCancellation()
    
    // 或者更优雅地：
    // 某些 API 会自动检查取消
    return data
}

// 使用 withTaskCancellationHandler 处理取消清理
func downloadWithCleanup(url: URL) async throws -> Data {
    let session = URLSession(configuration: .default)
    
    return try await withTaskCancellationHandler {
        let (data, _) = try await session.data(from: url)
        return data
    } onCancel: {
        session.invalidateAndCancel()
    }
}
```

### 6.2 Go 的 context 取消

```go
func downloadFile(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    // 读取时也会检查取消
    data, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    
    return data, nil
}
```

### 6.3 PHP 的取消处理

```php
// PHP Amp 的取消机制
function downloadFile(string $url): string
{
    $deferred = new Deferred();
    $cancellationToken = new CancellationTokenSource();
    
    $promise = async(function() use ($url, $cancellationToken) {
        $response = await(
            HttpClient::request("GET", $url, cancellationToken: $cancellationToken->getToken())
        );
        return $response->getBody();
    });
    
    // 取消操作
    // $cancellationToken->cancel();
    
    return await($promise);
}
```

---

## 第七章：性能对比与选型建议

### 7.1 性能基准对比

基于典型的 Web 服务器场景（并发处理 10,000 个请求）：

| 指标 | Swift (Vapor) | Go (net/http) | PHP (Amp/Swoole) |
|------|--------------|---------------|-------------------|
| 请求吞吐量 | ~50K req/s | ~80K req/s | ~30K req/s |
| 内存占用 | ~150MB | ~100MB | ~200MB |
| P99 延迟 | ~5ms | ~3ms | ~8ms |
| 冷启动时间 | ~200ms | ~50ms | ~100ms |
| CPU 利用率 | 高 | 很高 | 中等 |

### 7.2 选型决策矩阵

**选择 Swift Structured Concurrency 当：**
- 开发 iOS/macOS 应用（原生集成）
- 需要编译时并发安全保证
- 团队有 Swift 经验
- 构建需要类型安全的服务端应用

**选择 Go goroutine 当：**
- 构建高吞吐微服务
- 需要极低的内存开销
- 大规模并发（>100K 连接）
- DevOps 和基础设施工具

**选择 PHP Fibers 当：**
- 已有 PHP 项目需要升级并发能力
- Web API 和后端服务（Laravel/Symfony）
- 团队主要是 PHP 开发者
- I/O 密集型应用（数据库、HTTP 调用）

### 7.3 实际应用中的最佳实践

**Swift：**
```swift
// ✅ 好的做法：使用 structured concurrency
func processData() async throws {
    async let users = fetchUsers()
    async let orders = fetchOrders()
    let (u, o) = try await (users, orders)
    try await save(users: u, orders: o)
}

// ❌ 不好的做法：非结构化任务
func processDataBad() {
    Task { // 这个任务的生命周期不受控制
        try await fetchUsers()
    }
}
```

**Go：**
```go
// ✅ 好的做法：传递 context，使用 errgroup
func processData(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    
    var users []User
    g.Go(func() error {
        var err error
        users, err = fetchUsers(ctx)
        return err
    })
    
    return g.Wait()
}

// ❌ 不好的做法：goroutine 泄漏
func processDataBad() {
    ch := make(chan User)
    go func() {
        users, _ := fetchUsers(context.Background())
        ch <- users // 如果没有接收者，goroutine 泄漏
    }()
}
```

**PHP：**
```php
// ✅ 好的做法：使用 async/await 封装
function processData(): void
{
    $usersFuture = async(fn() => fetchUsers());
    $ordersFuture = async(fn() => fetchOrders());
    
    $users = await($usersFuture);
    $orders = await($ordersFuture);
    
    await(async(fn() => save($users, $orders)));
}

// ❌ 不好的做法：嵌套回调
function processDataBad(): void
{
    fetchUsers()->then(function ($users) {
        fetchOrders()->then(function ($orders) use ($users) {
            save($users, $orders); // Callback hell
        });
    });
}
```

---

## 第八章：Swift 6 的严格并发检查

### 8.1 Sendable 协议

Swift 6 引入了严格的并发安全检查，`Sendable` 协议是核心：

```swift
// 值类型自动满足 Sendable
struct User: Sendable {
    let id: Int
    let name: String
}

// 引用类型需要特别处理
final class AtomicInteger: Sendable {
    private let storage: ManagedBuffer<Int, Void> // 使用原子操作
    
    func increment() -> Int {
        // 原子操作实现
    }
}

// @unchecked Sendable：跳过编译器检查（谨慎使用！）
final class Cache: @unchecked Sendable {
    private var storage: [String: Any] = [:]
    private let lock = NSLock()
    
    func get(_ key: String) -> Any? {
        lock.lock()
        defer { lock.unlock() }
        return storage[key]
    }
}

// region-based 隔离
@Sendable func processOnBackground(_ data: Data) async throws -> Result {
    // 编译器确保 data 可以安全传递到此函数
    return try await processData(data)
}
```

### 8.2 迁移到严格并发模式

```swift
// Swift 5 模式：宽松检查
class ViewModel {
    var users: [User] = [] // ⚠️ 可变状态无保护
    
    func load() {
        Task {
            users = try await fetchUsers() // 可能有数据竞争
        }
    }
}

// Swift 6 模式：严格检查
@MainActor
class ViewModel {
    var users: [User] = [] // ✅ MainActor 保护
    
    func load() async {
        users = try await fetchUsers() // 编译器确保在 MainActor 上执行
    }
}
```

---

## 第九章：综合实战——电商订单处理系统

### 9.1 需求场景

构建一个电商订单处理系统，需要：
1. 并发验证库存、支付、地址
2. 限流控制（每秒最多处理 100 个订单）
3. 失败重试和超时处理
4. 状态隔离（订单状态修改）

### 9.2 Swift 实现

```swift
actor OrderProcessor {
    private let inventoryService: InventoryService
    private let paymentService: PaymentService
    private let addressService: AddressService
    private var processedCount = 0
    private let rateLimiter: RateLimiter
    
    func processOrder(_ order: Order) async throws -> OrderResult {
        // 限流检查
        try await rateLimiter.acquire()
        
        defer {
            Task { await rateLimiter.release() }
        }
        
        // 并发验证
        async let inventoryCheck = inventoryService.validate(order.items)
        async let paymentCheck = paymentService.validate(order.payment)
        async let addressCheck = addressService.validate(order.shippingAddress)
        
        let (inventory, payment, address) = try await (
            inventoryCheck,
            paymentCheck,
            addressCheck
        )
        
        guard inventory.isValid, payment.isValid, address.isValid else {
            return .failed(reason: "Validation failed")
        }
        
        // 处理支付（带重试）
        let paymentResult = try await retry(maxAttempts: 3) {
            try await paymentService.charge(order.payment, amount: order.total)
        }
        
        // 扣减库存
        try await inventoryService.deduct(order.items)
        
        processedCount += 1
        return .success(orderId: order.id, transactionId: paymentResult.id)
    }
    
    func processBatch(_ orders: [Order]) async -> [OrderResult] {
        await withTaskGroup(of: OrderResult.self) { group in
            for order in orders {
                group.addTask {
                    do {
                        return try await self.processOrder(order)
                    } catch {
                        return .failed(reason: error.localizedDescription)
                    }
                }
            }
            
            var results: [OrderResult] = []
            for await result in group {
                results.append(result)
            }
            return results
        }
    }
}

// 重试工具
func retry<T>(
    maxAttempts: Int,
    delay: Duration = .seconds(1),
    operation: () async throws -> T
) async throws -> T {
    var lastError: Error?
    for attempt in 1...maxAttempts {
        do {
            return try await operation()
        } catch {
            lastError = error
            if attempt < maxAttempts {
                try await Task.sleep(for: delay * Double(attempt))
            }
        }
    }
    throw lastError!
}
```

### 9.3 Go 实现

```go
type OrderProcessor struct {
    inventory *InventoryService
    payment   *PaymentService
    address   *AddressService
    limiter   *rate.Limiter
}

func (p *OrderProcessor) ProcessOrder(ctx context.Context, order *Order) (*OrderResult, error) {
    // 限流
    if err := p.limiter.Wait(ctx); err != nil {
        return nil, err
    }
    
    // 并发验证
    g, ctx := errgroup.WithContext(ctx)
    
    var (
        inventoryValid bool
        paymentValid   bool
        addressValid   bool
    )
    
    g.Go(func() error {
        valid, err := p.inventory.Validate(ctx, order.Items)
        inventoryValid = valid
        return err
    })
    g.Go(func() error {
        valid, err := p.payment.Validate(ctx, order.Payment)
        paymentValid = valid
        return err
    })
    g.Go(func() error {
        valid, err := p.address.Validate(ctx, order.ShippingAddress)
        addressValid = valid
        return err
    })
    
    if err := g.Wait(); err != nil {
        return nil, err
    }
    
    if !inventoryValid || !paymentValid || !addressValid {
        return &OrderResult{Status: "failed", Reason: "Validation failed"}, nil
    }
    
    // 带重试的支付
    var paymentResult *PaymentResult
    err := retry(3, 1*time.Second, func() error {
        var err error
        paymentResult, err = p.payment.Charge(ctx, order.Payment, order.Total)
        return err
    })
    if err != nil {
        return nil, err
    }
    
    // 扣减库存
    if err := p.inventory.Deduct(ctx, order.Items); err != nil {
        return nil, err
    }
    
    return &OrderResult{
        Status:        "success",
        OrderID:       order.ID,
        TransactionID: paymentResult.ID,
    }, nil
}

func retry(maxAttempts int, delay time.Duration, fn func() error) error {
    var lastErr error
    for i := 0; i < maxAttempts; i++ {
        if err := fn(); err != nil {
            lastErr = err
            time.Sleep(delay * time.Duration(i+1))
            continue
        }
        return nil
    }
    return lastErr
}
```

---

## 第十章：总结与未来展望

### 10.1 核心要点

1. **Swift Structured Concurrency** 提供了最强的编译时安全保证，Actor 模型实现了零成本的状态隔离
2. **Go goroutine** 在吞吐量和内存效率方面最优，适合构建高并发基础设施
3. **PHP Fibers** 是务实的选择，让现有的 PHP 生态获得异步能力

### 10.2 未来趋势

- **Swift**：展望分布式 Actor、跨进程 Actor
- **Go**：泛型与并发的结合、更高效的调度器
- **PHP**：Swoole 6.0 的改进、Fibers 生态成熟

### 10.3 选型建议

```
需求 → 选型决策树

iOS/macOS 开发？
  └─ 是 → Swift Structured Concurrency
  
高并发微服务 (>100K 连接)？
  └─ 是 → Go goroutine
  
已有 PHP 项目？
  └─ 是 → PHP Fibers + Amp/Swoole
  
需要最强类型安全？
  └─ 是 → Swift
  
团队技术栈？
  └─ Swift 团队 → Swift
  └─ Go 团队 → Go
  └─ PHP 团队 → PHP Fibers
```

并发编程没有银弹，选择最适合你的团队、项目和生态的方案，才是最好的决策。

---

## 参考资料

1. [Swift Concurrency Documentation](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/)
2. [Go Concurrency Patterns](https://go.dev/blog/pipelines)
3. [PHP Fibers RFC](https://wiki.php.net/rfc/fibers)
4. [Amp v3 Documentation](https://amphp.org/)
5. [Swift Evolution: Actors](https://github.com/apple/swift-evolution/blob/main/proposals/0306-actors.md)
6. [Effective Go: Concurrency](https://go.dev/doc/effective_go#concurrency)

## 相关阅读

- [Go Context 深度实战：超时控制、取消传播与请求作用域](/categories/运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)
- [Python asyncio 深度实战：事件循环、协程调度与 aiohttp](/categories/架构/Python-asyncio-深度实战-事件循环-协程调度与-aiohttp/)
- [Go for PHP Developers 实战：goroutine/channel 并发模型](/categories/架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
