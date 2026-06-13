---
title: Swift 6 实战：PHP 开发者的 iOS/macOS 原生开发入门——async/await、SwiftUI 与 Combine
date: 2026-06-02 10:00:00
tags: [Swift, SwiftUI, iOS, macOS, async/await, Combine]
keywords: [Swift, PHP, iOS, macOS, async, await, SwiftUI, Combine, 开发者的, 原生开发入门]
categories:
  - macos
description: 为 Laravel/PHP 后端开发者量身定制的 Swift 6 入门实战，通过对比 PHP 的 nullable/Interface/Fiber 等概念快速理解 Swift 的 Optional/Protocol/async。覆盖 SwiftUI 声明式 UI、Combine 响应式编程、MVVM 架构、URLSession 网络请求、Codable JSON 解析等核心知识点，并附带完整的 iOS 待办应用实战代码，帮助全栈开发者独立构建原生 iOS/macOS 应用。
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
---


# Swift 6 实战：PHP 开发者的 iOS/macOS 原生开发入门——async/await、SwiftUI 与 Combine

## 前言：PHP 开发者为什么要学 Swift？

作为一名 Laravel 后端开发者，你可能已经掌握了 PHP、JavaScript/TypeScript、SQL，偶尔还会写一些 Docker 和 Shell 脚本。但当你的产品需要一个原生 iOS 或 macOS 应用时，你面临两个选择：

1. **外包给 iOS 开发者**：沟通成本高，迭代慢
2. **自己学 Swift**：学习曲线陡峭，但长期回报大

如果你选择了第二条路，这篇文章就是为你准备的。

Swift 6 是 Apple 在 2024 年推出的最新版本，引入了完整的并发安全检查、改进的宏系统和更好的 C++ 互操作性。对于 PHP 开发者来说，Swift 的很多概念似曾相识：

- Swift 的 Optional ≈ PHP 的 nullable 类型（但更安全）
- Swift 的 async/await ≈ PHP 8.1 的 Fiber
- SwiftUI 的声明式 UI ≈ Laravel Blade 模板（思路类似）
- Swift 的 Protocol ≈ PHP 的 Interface（但更强大）

本文将带你从 PHP 开发者的视角理解 Swift，通过对比和类比的方式，快速上手 iOS/macOS 原生开发。

---

## 一、Swift 基础语法：PHP 开发者的视角

### 1.1 变量和常量

**PHP：**
```php
<?php
$name = "Michael";         // 变量
const MAX_SIZE = 100;      // 编译时常量
$greeting = "Hello {$name}"; // 字符串插值
```

**Swift：**
```swift
var name = "Michael"           // 变量（可变）
let maxSize = 100              // 常量（不可变）
let greeting = "Hello \(name)" // 字符串插值

// 类型注解
var age: Int = 30
var pi: Double = 3.14159
var isActive: Bool = true
var message: String = "Hello"
```

**关键区别：**
- Swift 用 `var` 声明变量，`let` 声明常量
- Swift 是强类型语言，类型一旦确定不能改变
- Swift 用 `\(expression)` 进行字符串插值

### 1.2 类型系统

**PHP 类型：**
```php
<?php
function add(int $a, int $b): int {
    return $a + $b;
}

// PHP 的类型系统是运行时检查
add("1", 2); // 可能报错，取决于严格模式
```

**Swift 类型：**
```swift
func add(_ a: Int, _ b: Int) -> Int {
    return a + b
}

// Swift 的类型系统是编译时检查
add("1", 2) // 编译错误！类型不匹配

// 类型推断
let x = 10        // Swift 自动推断为 Int
let y = 3.14      // Swift 自动推断为 Double
let name = "John" // Swift 自动推断为 String
```

### 1.3 Optional：Swift 最重要的概念

Optional 是 Swift 类型系统中最重要也最容易让 PHP 开发者困惑的概念。

**PHP 的 null 处理：**
```php
<?php
function getUser(int $id): ?array {
    // 可能返回 null
    return $users[$id] ?? null;
}

$user = getUser(1);
echo $user['name']; // 如果 $user 是 null，运行时报错
```

**Swift 的 Optional：**
```swift
// ? 表示这个值可能是 nil
func getUser(_ id: Int) -> User? {
    return users[id]  // 可能返回 nil
}

let user = getUser(1)
// user 的类型是 User?（Optional<User>）

// ❌ 错误：不能直接访问 Optional 的值
// print(user.name)  // 编译错误！

// ✅ 正确：使用 Optional 解包
// 方式 1：if let（安全解包）
if let user = user {
    print(user.name)  // 这里 user 是 User 类型，不是 User?
}

// 方式 2：guard let（提前返回）
guard let user = user else {
    print("User not found")
    return
}
print(user.name)  // 这里 user 是 User 类型

// 方式 3：可选链
let userName = user?.name  // 类型是 String?

// 方式 4：空合运算符
let userName = user?.name ?? "Unknown"  // 类型是 String
```

**对比总结：**

| 概念 | PHP | Swift |
|------|-----|-------|
| 可空类型 | `?Type` | `Type?` |
| 空值 | `null` | `nil` |
| 访问空值 | 运行时报错 | 编译错误 |
| 安全访问 | `?->` | `?.`（可选链） |
| 空合并 | `??` | `??`（相同） |

### 1.4 集合类型

**PHP：**
```php
<?php
$names = ["Alice", "Bob", "Charlie"];  // 索引数组
$scores = ["Alice" => 95, "Bob" => 87]; // 关联数组

foreach ($names as $name) {
    echo $name;
}

$filtered = array_filter($names, fn($n) => strlen($n) > 3);
$mapped = array_map(fn($n) => strtoupper($n), $names);
```

**Swift：**
```swift
// 数组（Array）
var names: [String] = ["Alice", "Bob", "Charlie"]
names.append("David")
names.insert("Eve", at: 0)

// 字典（Dictionary）
var scores: [String: Int] = ["Alice": 95, "Bob": 87]

// 遍历
for name in names {
    print(name)
}

// 高阶函数
let filtered = names.filter { $0.count > 3 }
let mapped = names.map { $0.uppercased() }
let total = scores.values.reduce(0, +)

// 链式调用
let result = names
    .filter { $0.count > 3 }
    .map { $0.uppercased() }
    .sorted()
```

### 1.5 结构体 vs 类

Swift 有结构体（struct）和类（class），这是 PHP 中没有的重要区别：

```swift
// 结构体：值类型（拷贝传递）
struct Point {
    var x: Double
    var y: Double
}

var p1 = Point(x: 1, y: 2)
var p2 = p1        // p2 是 p1 的拷贝
p2.x = 10
print(p1.x)        // 输出 1（p1 没有改变）

// 类：引用类型（引用传递）
class Person {
    var name: String
    init(name: String) {
        self.name = name
    }
}

var person1 = Person(name: "Alice")
var person2 = person1  // person2 和 person1 指向同一个对象
person2.name = "Bob"
print(person1.name)    // 输出 "Bob"（person1 也改变了）
```

**PHP 开发者指南：**
- 优先使用 struct（Swift 的 Array、String、Dictionary 都是 struct）
- 只在需要继承或引用语义时使用 class
- struct 是栈分配，class 是堆分配，struct 性能更好

---

## 二、async/await：并发编程的新范式

### 2.1 PHP 的并发演化

PHP 的并发处理经历了几个阶段：

```php
<?php
// 阶段 1：同步阻塞
$result1 = fetchFromAPI1();  // 阻塞 1 秒
$result2 = fetchFromAPI2();  // 阻塞 1 秒
// 总耗时 2 秒

// 阶段 2：cURL Multi
$mh = curl_multi_init();
// 复杂的回调管理...

// 阶段 3：PHP 8.1 Fiber
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('fiber started');
    echo "Fiber resumed with: $value";
});
$fiber->start();
$fiber->resume('hello');

// 阶段 4：Laravel Promises (类似)
$promises = [
    Http::async()->get('https://api1.example.com'),
    Http::async()->get('https://api2.example.com'),
];
$results = Promise::all($promises)->wait();
```

### 2.2 Swift 的 async/await

Swift 5.5 引入了原生的 async/await，Swift 6 对并发安全做了全面改进：

```swift
// 定义异步函数
func fetchUser(id: Int) async throws -> User {
    let url = URL(string: "https://api.example.com/users/\(id)")!
    let (data, _) = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode(User.self, from: data)
}

// 调用异步函数
func loadDashboard() async throws {
    // 顺序执行（类似 PHP 同步调用）
    let user = try await fetchUser(id: 1)
    let orders = try await fetchOrders(userId: user.id)
    // 总耗时 = fetchUser + fetchOrders
}

// 并发执行（关键优化）
func loadDashboardConcurrently() async throws {
    async let user = fetchUser(id: 1)
    async let orders = fetchOrders(userId: 1)
    async let notifications = fetchNotifications(userId: 1)
    
    // 三个请求同时发出，总耗时 = max(三个请求的时间)
    let result = try await (user, orders, notifications)
}
```

### 2.3 Task 和 TaskGroup

对于动态数量的并发任务，使用 TaskGroup：

```swift
// 并发获取多个用户
func fetchUsers(ids: [Int]) async throws -> [User] {
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

// 带超时的并发任务
func fetchWithTimeout<T>(_ operation: @escaping () async throws -> T, timeout: TimeInterval) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            throw TimeoutError()
        }
        
        let result = try await group.next()!
        group.cancelAll()
        return result
    }
}
```

### 2.4 Swift 6 的并发安全

Swift 6 引入了严格的并发安全检查（Sendable 协议）：

```swift
// Swift 6 要求跨并发边界传递的数据必须是 Sendable
struct UserData: Sendable {
    let id: Int
    let name: String
}

// ❌ Swift 6 编译错误：非 Sendable 类型不能跨并发边界传递
class MutableState {
    var value = 0  // 可变状态不是 Sendable
}

// ✅ 使用 actor 保护可变状态
actor SafeState {
    var value = 0
    
    func increment() {
        value += 1
    }
}

// 使用 actor
let state = SafeState()
await state.increment()
let current = await state.value
```

---

## 三、SwiftUI：声明式 UI 框架

### 3.1 声明式 vs 命令式

**PHP/Laravel Blade（命令式 + 模板）：**
```blade
{{-- resources/views/dashboard.blade.php --}}
@extends('layouts.app')

@section('content')
    <div class="dashboard">
        <h1>Welcome, {{ $user->name }}</h1>
        
        @if($orders->isEmpty())
            <p>No orders yet</p>
        @else
            @foreach($orders as $order)
                <div class="order">
                    <span>{{ $order->id }}</span>
                    <span>{{ $order->total }}</span>
                </div>
            @endforeach
        @endif
    </div>
@endsection
```

**SwiftUI（声明式）：**
```swift
struct DashboardView: View {
    let user: User
    let orders: [Order]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Welcome, \(user.name)")
                .font(.largeTitle)
            
            if orders.isEmpty {
                Text("No orders yet")
                    .foregroundColor(.secondary)
            } else {
                ForEach(orders) { order in
                    HStack {
                        Text("#\(order.id)")
                        Spacer()
                        Text("$\(order.total, specifier: "%.2f")")
                    }
                }
            }
        }
        .padding()
    }
}
```

### 3.2 基础 UI 组件

```swift
import SwiftUI

struct ContentView: View {
    @State private var name = ""
    @State private var isOn = false
    @State private var selectedColor = 0
    
    var body: some View {
        VStack(spacing: 20) {
            // 文本
            Text("Hello, World!")
                .font(.title)
                .foregroundColor(.blue)
            
            // 输入框
            TextField("Enter your name", text: $name)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            // 按钮
            Button("Submit") {
                print("Hello, \(name)")
            }
            .buttonStyle(.borderedProminent)
            
            // 开关
            Toggle("Dark Mode", isOn: $isOn)
                .padding(.horizontal)
            
            // 选择器
            Picker("Color", selection: $selectedColor) {
                Text("Red").tag(0)
                Text("Green").tag(1)
                Text("Blue").tag(2)
            }
            .pickerStyle(.segmented)
            
            // 图片
            Image(systemName: "star.fill")
                .resizable()
                .frame(width: 50, height: 50)
                .foregroundColor(.yellow)
        }
    }
}
```

### 3.3 列表和导航

```swift
// 数据模型
struct Product: Identifiable {
    let id: Int
    let name: String
    let price: Double
}

// 列表视图
struct ProductListView: View {
    let products: [Product]
    
    var body: some View {
        NavigationStack {
            List(products) { product in
                NavigationLink(destination: ProductDetailView(product: product)) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(product.name)
                                .font(.headline)
                            Text("$\(product.price, specifier: "%.2f")")
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundColor(.gray)
                    }
                }
            }
            .navigationTitle("Products")
        }
    }
}

// 详情视图
struct ProductDetailView: View {
    let product: Product
    
    var body: some View {
        VStack(spacing: 16) {
            Text(product.name)
                .font(.largeTitle)
            Text("$\(product.price, specifier: "%.2f")")
                .font(.title)
                .foregroundColor(.green)
            Button("Add to Cart") {
                // 处理添加购物车
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .navigationTitle(product.name)
    }
}
```

### 3.4 MVVM 架构

SwiftUI 推荐使用 MVVM（Model-View-ViewModel）架构，这对 Laravel 开发者来说类似于 MVC：

```swift
// Model
struct User: Codable, Identifiable {
    let id: Int
    let name: String
    let email: String
}

// ViewModel
@Observable
class UserViewModel {
    var users: [User] = []
    var isLoading = false
    var errorMessage: String?
    
    private let apiService: APIService
    
    init(apiService: APIService = APIService()) {
        self.apiService = apiService
    }
    
    func loadUsers() async {
        isLoading = true
        errorMessage = nil
        
        do {
            users = try await apiService.fetchUsers()
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isLoading = false
    }
}

// View
struct UserListView: View {
    @State private var viewModel = UserViewModel()
    
    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView("Loading...")
                } else if let error = viewModel.errorMessage {
                    VStack {
                        Text("Error: \(error)")
                        Button("Retry") {
                            Task { await viewModel.loadUsers() }
                        }
                    }
                } else {
                    List(viewModel.users) { user in
                        VStack(alignment: .leading) {
                            Text(user.name)
                                .font(.headline)
                            Text(user.email)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Users")
            .task {
                await viewModel.loadUsers()
            }
        }
    }
}
```

---

## 四、Combine：响应式编程框架

### 4.1 什么是 Combine？

Combine 是 Apple 的响应式编程框架，类似于：

- JavaScript 的 RxJS
- PHP 的 RxPHP
- Kotlin 的 Flow

它通过 **发布者（Publisher）** 和 **订阅者（Subscriber）** 的模式处理异步数据流。

### 4.2 基本概念

```swift
import Combine

// 发布者
let publisher = [1, 2, 3, 4, 5].publisher

// 订阅者
let cancellable = publisher
    .filter { $0 % 2 == 0 }       // 过滤偶数
    .map { $0 * 10 }              // 转换
    .sink { value in
        print("Received: \(value)")
    }
// 输出: Received: 20, Received: 40

// 记得取消订阅
cancellable.cancel()
```

### 4.3 在 SwiftUI 中使用 Combine

```swift
import Combine

@Observable
class SearchViewModel {
    var searchText = ""
    var results: [Product] = []
    
    private var cancellables = Set<AnyCancellable>()
    private let apiService: APIService
    
    init(apiService: APIService = APIService()) {
        self.apiService = apiService
        setupSearch()
    }
    
    private func setupSearch() {
        // 监听 searchText 的变化，自动搜索
        $searchText
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)  // 防抖
            .removeDuplicates()  // 去重
            .filter { !$0.isEmpty }  // 过滤空搜索
            .flatMap { [weak self] query -> AnyPublisher<[Product], Never> in
                guard let self = self else {
                    return Just([]).eraseToAnyPublisher()
                }
                return self.apiService.searchProducts(query: query)
                    .catch { _ in Just([]) }
                    .eraseToAnyPublisher()
            }
            .receive(on: DispatchQueue.main)
            .assign(to: &$results)
    }
}
```

### 4.4 Combine vs async/await

| 特性 | Combine | async/await |
|------|---------|-------------|
| 语法复杂度 | 较高（操作符链） | 较低（线性代码） |
| 单次值 | ✅ | ✅ |
| 多次值（流） | ✅ | ✅ (AsyncSequence) |
| 取消支持 | ✅ (AnyCancellable) | ✅ (Task.cancel) |
| SwiftUI 集成 | 原生 | .task modifier |
| 学习曲线 | 陡峭 | 平缓 |

**建议**：新项目优先使用 async/await，只在需要复杂的响应式数据流时使用 Combine。

---

## 五、实战：构建一个 Laravel API 客户端 App

### 5.1 项目结构

```
LaravelApp/
├── Models/
│   ├── User.swift
│   ├── Product.swift
│   └── Order.swift
├── Services/
│   └── APIService.swift
├── ViewModels/
│   ├── ProductListViewModel.swift
│   └── CartViewModel.swift
├── Views/
│   ├── ContentView.swift
│   ├── ProductListView.swift
│   ├── ProductDetailView.swift
│   └── CartView.swift
└── LaravelApp.swift
```

### 5.2 API 服务层

```swift
// Services/APIService.swift
import Foundation

class APIService {
    private let baseURL: URL
    private let session: URLSession
    private var authToken: String?
    
    init(baseURL: String = "https://api.your-laravel-app.com") {
        self.baseURL = URL(string: baseURL)!
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }
    
    func setAuthToken(_ token: String) {
        self.authToken = token
    }
    
    // 通用请求方法
    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> T {
        var urlRequest = URLRequest(url: baseURL.appendingPathComponent(path))
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if let token = authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        if let body = body {
            urlRequest.httpBody = try JSONEncoder().encode(body)
        }
        
        let (data, response) = try await session.data(for: urlRequest)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        switch httpResponse.statusCode {
        case 200...299:
            return try JSONDecoder().decode(T.self, from: data)
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        case 422:
            let errorResponse = try JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.validation(errorResponse.message)
        default:
            throw APIError.serverError(httpResponse.statusCode)
        }
    }
    
    // 具体 API 方法
    func fetchProducts() async throws -> [Product] {
        try await request(path: "/api/products")
    }
    
    func fetchProduct(id: Int) async throws -> Product {
        try await request(path: "/api/products/\(id)")
    }
    
    func login(email: String, password: String) async throws -> AuthResponse {
        try await request(
            path: "/api/login",
            method: "POST",
            body: LoginRequest(email: email, password: password)
        )
    }
    
    func createOrder(items: [CartItem]) async throws -> Order {
        try await request(
            path: "/api/orders",
            method: "POST",
            body: CreateOrderRequest(items: items.map { OrderItemRequest(productId: $0.product.id, quantity: $0.quantity) })
        )
    }
}

// 错误类型
enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case notFound
    case validation(String)
    case serverError(Int)
    
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response"
        case .unauthorized: return "Please log in again"
        case .notFound: return "Resource not found"
        case .validation(let message): return message
        case .serverError(let code): return "Server error: \(code)"
        }
    }
}
```

### 5.3 数据模型

```swift
// Models/Product.swift
struct Product: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String
    let price: Double
    let imageURL: String?
    let stock: Int
    
    enum CodingKeys: String, CodingKey {
        case id, name, description, price, stock
        case imageURL = "image_url"
    }
}

// Models/Order.swift
struct Order: Codable, Identifiable {
    let id: Int
    let items: [OrderItem]
    let total: Double
    let status: String
    let createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id, items, total, status
        case createdAt = "created_at"
    }
}

struct OrderItem: Codable {
    let productId: Int
    let productName: String
    let quantity: Int
    let price: Double
    
    enum CodingKeys: String, CodingKey {
        case productId = "product_id"
        case productName = "product_name"
        case quantity, price
    }
}
```

### 5.4 商品列表视图

```swift
// Views/ProductListView.swift
import SwiftUI

struct ProductListView: View {
    @State private var viewModel = ProductListViewModel()
    
    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView("Loading products...")
                } else if let error = viewModel.errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundColor(.orange)
                        Text(error)
                            .multilineTextAlignment(.center)
                        Button("Retry") {
                            Task { await viewModel.loadProducts() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding()
                } else {
                    List(viewModel.products) { product in
                        NavigationLink(destination: ProductDetailView(product: product)) {
                            ProductRowView(product: product)
                        }
                    }
                    .refreshable {
                        await viewModel.loadProducts()
                    }
                }
            }
            .navigationTitle("Products")
            .searchable(text: $viewModel.searchText, prompt: "Search products")
            .task {
                await viewModel.loadProducts()
            }
        }
    }
}

struct ProductRowView: View {
    let product: Product
    
    var body: some View {
        HStack(spacing: 12) {
            // 商品图片（使用 AsyncImage）
            AsyncImage(url: URL(string: product.imageURL ?? "")) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(.gray)
                    )
            }
            .frame(width: 80, height: 80)
            .cornerRadius(8)
            
            // 商品信息
            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(.headline)
                Text(product.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                HStack {
                    Text("$\(product.price, specifier: "%.2f")")
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                    Spacer()
                    Text("Stock: \(product.stock)")
                        .font(.caption)
                        .foregroundColor(product.stock > 0 ? .green : .red)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
```

### 5.5 购物车功能

```swift
// ViewModels/CartViewModel.swift
import Foundation

@Observable
class CartViewModel {
    var items: [CartItem] = []
    
    var total: Double {
        items.reduce(0) { $0 + ($1.product.price * Double($1.quantity)) }
    }
    
    var itemCount: Int {
        items.reduce(0) { $0 + $1.quantity }
    }
    
    func addProduct(_ product: Product, quantity: Int = 1) {
        if let index = items.firstIndex(where: { $0.product.id == product.id }) {
            items[index].quantity += quantity
        } else {
            items.append(CartItem(product: product, quantity: quantity))
        }
    }
    
    func removeProduct(_ product: Product) {
        items.removeAll { $0.product.id == product.id }
    }
    
    func updateQuantity(for product: Product, quantity: Int) {
        if let index = items.firstIndex(where: { $0.product.id == product.id }) {
            if quantity <= 0 {
                items.remove(at: index)
            } else {
                items[index].quantity = quantity
            }
        }
    }
    
    func clear() {
        items.removeAll()
    }
}

struct CartItem: Identifiable {
    let id = UUID()
    let product: Product
    var quantity: Int
}

// Views/CartView.swift
struct CartView: View {
    @Bindable var cartViewModel: CartViewModel
    @State private var isCheckingOut = false
    
    var body: some View {
        NavigationStack {
            Group {
                if cartViewModel.items.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "cart")
                            .font(.system(size: 60))
                            .foregroundColor(.gray)
                        Text("Your cart is empty")
                            .font(.title2)
                            .foregroundColor(.secondary)
                    }
                } else {
                    List {
                        ForEach(cartViewModel.items) { item in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(item.product.name)
                                        .font(.headline)
                                    Text("$\(item.product.price, specifier: "%.2f")")
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                // 数量调整
                                HStack {
                                    Button("-") {
                                        cartViewModel.updateQuantity(for: item.product, quantity: item.quantity - 1)
                                    }
                                    .buttonStyle(.bordered)
                                    
                                    Text("\(item.quantity)")
                                        .frame(minWidth: 30)
                                    
                                    Button("+") {
                                        cartViewModel.updateQuantity(for: item.product, quantity: item.quantity + 1)
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                        .onDelete { indexSet in
                            indexSet.forEach { index in
                                cartViewModel.removeProduct(cartViewModel.items[index].product)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Cart")
            .toolbar {
                if !cartViewModel.items.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Checkout") {
                            isCheckingOut = true
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !cartViewModel.items.isEmpty {
                    HStack {
                        Text("Total:")
                            .font(.headline)
                        Spacer()
                        Text("$\(cartViewModel.total, specifier: "%.2f")")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    .padding()
                    .background(.ultraThinMaterial)
                }
            }
        }
    }
}
```

---

## 六、网络层：与 Laravel API 对接

### 6.1 Laravel API 约定

确保你的 Laravel API 返回一致的 JSON 格式：

```php
<?php
// 成功响应
return response()->json([
    'data' => $products,
    'meta' => [
        'current_page' => $products->currentPage(),
        'last_page' => $products->lastPage(),
        'per_page' => $products->perPage(),
        'total' => $products->total(),
    ],
]);

// 错误响应
return response()->json([
    'message' => 'Validation failed',
    'errors' => $validator->errors(),
], 422);
```

### 6.2 Swift 对应的响应模型

```swift
// 通用响应包装
struct APIResponse<T: Decodable>: Decodable {
    let data: T
    let meta: Meta?
}

struct Meta: Decodable {
    let currentPage: Int
    let lastPage: Int
    let perPage: Int
    let total: Int
    
    enum CodingKeys: String, CodingKey {
        case currentPage = "current_page"
        case lastPage = "last_page"
        case perPage = "per_page"
        case total
    }
}

struct ErrorResponse: Decodable {
    let message: String
    let errors: [String: [String]]?
}

// 分页响应
struct PaginatedResponse<T: Decodable>: Decodable {
    let data: [T]
    let meta: Meta
}
```

---

## 七、开发工具和调试

### 7.1 Xcode 必备技巧

| 快捷键 | 功能 |
|--------|------|
| `Cmd + R` | 运行 |
| `Cmd + B` | 构建 |
| `Cmd + .` | 停止 |
| `Cmd + Shift + K` | 清理构建 |
| `Cmd + Shift + O` | 快速打开文件 |
| `Ctrl + I` | 重新缩进代码 |

### 7.2 网络调试

```swift
// 使用 URLSession 的日志功能
let config = URLSessionConfiguration.default
config.waitsForConnectivity = true

// 添加请求日志
class LoggingURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        print("🌐 \(request.httpMethod ?? "GET") \(request.url?.absoluteString ?? "")")
        return false
    }
}
```

### 7.3 Preview 调试

SwiftUI 的 Preview 功能非常强大，可以实时预览 UI：

```swift
#Preview("Product List") {
    ProductListView()
}

#Preview("Empty Cart") {
    CartView(cartViewModel: CartViewModel())
}

#Preview("Cart with Items") {
    let vm = CartViewModel()
    vm.addProduct(Product(id: 1, name: "MacBook", description: "Pro", price: 2499, imageURL: nil, stock: 10))
    return CartView(cartViewModel: vm)
}
```

---

## 八、发布到 App Store

### 8.1 签名和证书

1. 注册 Apple Developer Program（$99/年）
2. 在 Xcode 中配置 Team 和 Signing
3. 创建 App ID 和 Provisioning Profile

### 8.2 Archive 和上传

```
1. Product → Archive
2. Window → Organizer → 选择 Archive
3. Distribute App → App Store Connect
4. 上传到 App Store Connect
5. 在 App Store Connect 中提交审核
```

### 8.3 macOS 应用发布

macOS 应用可以选择 Mac App Store 或直接分发：

```swift
// 配置 entitlements
// YourApp.entitlements
com.apple.security.app-sandbox = true
com.apple.security.network.client = true
```

---

## 九、PHP vs Swift 开发者体验对比

| 方面 | PHP/Laravel | Swift/SwiftUI |
|------|-------------|---------------|
| 类型安全 | 运行时 | 编译时 |
| 代码补全 | 一般 | 优秀 |
| 调试体验 | 好 | 很好 |
| 热重载 | 有（Sail） | 有（Preview） |
| 包管理 | Composer | Swift Package Manager |
| 测试框架 | PHPUnit | XCTest |
| 部署 | 服务器 | App Store |
| 迭代速度 | 快 | 中等 |

---

## 总结

作为 PHP 开发者学习 Swift，你会发现很多概念是相通的：

- **类型系统**：Swift 的类型系统比 PHP 更严格，但更安全
- **异步编程**：Swift 的 async/await 与 PHP 的 Fiber 思路一致
- **声明式 UI**：SwiftUI 的声明式语法与 Blade 模板的理念相似
- **架构模式**：MVVM ≈ MVC，ViewModel ≈ Controller

学习路径建议：

1. **先学基础**：变量、类型、Optional、集合
2. **再学 UI**：SwiftUI 的基础组件和布局
3. **然后学网络**：URLSession、async/await、Codable
4. **最后学架构**：MVVM、依赖注入、Combine

Swift 的学习曲线比 PHP 陡峭，但一旦掌握，你就能独立开发 iOS 和 macOS 应用，不再依赖第三方开发者。这对于全栈 Laravel 开发者来说，是一个巨大的能力提升。

---

> 参考资源：
> - [Swift 官方文档](https://www.swift.org/documentation/)
> - [SwiftUI 教程](https://developer.apple.com/tutorials/swiftui)
> - [Swift 编程语言](https://docs.swift.org/swift-book/)
> - [Hacking with Swift](https://www.hackingwithswift.com/)
> - [Combine 框架文档](https://developer.apple.com/documentation/combine)

## 相关阅读

- [Rust for PHP Developers 实战：从脚本语言到系统编程的思维跃迁——所有权、生命周期与并发模型](/05_PHP/Rust-for-PHP-Developers-实战-从脚本语言到系统编程的思维跃迁/)
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [JetBrains Toolbox 实战：PhpStorm/WebStorm/GoLand 配置同步踩坑记录](/09_macOS/JetBrains-Toolbox-实战-PhpStorm-WebStorm-GoLand-配置同步踩坑记录/)
