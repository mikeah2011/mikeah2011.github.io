---

title: Kotlin Multiplatform (KMP) 实战：跨平台共享业务逻辑——与 Flutter/uni-app 的互补定位
keywords: [Kotlin Multiplatform, KMP, Flutter, uni, app, 跨平台共享业务逻辑, 的互补定位]
date: 2026-06-02 00:00:00
tags:
- kotlin multiplatform
- kmp
- 跨平台
- Flutter
- uni-app
categories:
- frontend
description: Kotlin Multiplatform (KMP) 跨平台开发实战指南，详解 expect/actual 机制、Gradle 多目标构建配置、Ktor 网络请求层与 kotlinx.serialization 数据模型、Shared ViewModel 状态管理、Jetpack Compose 与 SwiftUI 原生 UI 集成。深度对比 KMP/Flutter/uni-app 三者在原生体验、开发效率、生态成熟度、CPU 性能、内存占用等维度的差异，提供选型决策树与 KMP+Flutter 混合架构方案。适合有原生开发经验的 Android/iOS 团队用 Kotlin 共享业务逻辑、保留各平台原生 UI 的跨平台落地参考。
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



# Kotlin Multiplatform (KMP) 实战：跨平台共享业务逻辑——与 Flutter/uni-app 的互补定位

## 前言

跨平台开发一直是移动端开发的热门话题。Flutter 用 Dart 统一了 UI 层，uni-app 用 Vue 语法覆盖了小程序生态，React Native 用 JavaScript 桥接原生组件。但 Kotlin Multiplatform (KMP) 走了一条不同的路——它不试图统一 UI，而是专注于共享业务逻辑。

这意味着什么？你的网络请求、数据序列化、业务规则、数据库操作、状态管理——这些与平台无关的代码可以写一次，在 Android、iOS、Web、Desktop 上复用。而 UI 层仍然使用各平台的原生技术栈（Jetpack Compose、SwiftUI、React），享受最原生的体验。

本文将深入讲解 KMP 的架构原理、实际开发流程、与 Flutter/uni-app 的定位对比，帮助你做出正确的技术选型。

## 一、KMP 架构原理

### 1.1 expect/actual 机制

KMP 的核心机制是 `expect`/`actual` 声明。你在公共模块中声明一个 `expect` 类或函数，在每个平台模块中提供对应的 `actual` 实现：

```kotlin
// commonMain - 公共模块（所有平台共享）
expect class PlatformLogger() {
    fun log(message: String)
    fun getPlatformName(): String
}

// androidMain - Android 平台实现
actual class PlatformLogger actual constructor() {
    actual fun log(message: String) {
        android.util.Log.d("KMP", message)
    }
    
    actual fun getPlatformName(): String = "Android"
}

// iosMain - iOS 平台实现
actual class PlatformLogger actual constructor() {
    actual fun log(message: String) {
        NSLog("KMP: %@", message)
    }
    
    actual fun getPlatformName(): String = "iOS"
}
```

### 1.2 模块结构

```
my-kmp-project/
├── build.gradle.kts              # 根构建文件
├── settings.gradle.kts
│
├── shared/                        # 共享模块
│   ├── build.gradle.kts
│   └── src/
│       ├── commonMain/            # 公共代码（所有平台共享）
│       │   └── kotlin/
│       │       └── com/example/shared/
│       │           ├── api/       # 网络请求
│       │           ├── model/     # 数据模型
│       │           ├── repository/# 仓库层
│       │           ├── usecase/   # 业务用例
│       │           └── platform/  # expect 声明
│       │
│       ├── androidMain/           # Android 特有实现
│       │   └── kotlin/
│       │       └── com/example/shared/
│       │           └── platform/
│       │               └── PlatformLogger.kt
│       │
│       ├── iosMain/               # iOS 特有实现
│       │   └── kotlin/
│       │       └── com/example/shared/
│       │           └── platform/
│       │               └── PlatformLogger.kt
│       │
│       └── commonTest/            # 公共测试
│           └── kotlin/
│               └── com/example/shared/
│                   └── ApiTest.kt
│
├── androidApp/                    # Android 应用
│   ├── build.gradle.kts
│   └── src/main/
│       └── kotlin/
│           └── com/example/android/
│               └── MainActivity.kt
│
└── iosApp/                        # iOS 应用
    └── iosApp/
        ├── ContentView.swift
        └── iosApp.xcodeproj
```

### 1.3 构建配置

```kotlin
// shared/build.gradle.kts
plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization") version "1.9.22"
    id("com.android.library")
}

kotlin {
    // 目标平台
    androidTarget {
        compilations.all {
            kotlinOptions {
                jvmTarget = "17"
            }
        }
    }
    
    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64()
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }
    
    // JS 目标（用于 Web）
    js(IR) {
        browser()
        nodejs()
    }
    
    sourceSets {
        val commonMain by getting {
            dependencies {
                // 网络请求
                implementation("io.ktor:ktor-client-core:2.3.7")
                implementation("io.ktor:ktor-client-content-negotiation:2.3.7")
                implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.7")
                
                // 序列化
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
                
                // 协程
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
                
                // 日期时间
                implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.5.0")
            }
        }
        
        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
            }
        }
        
        val androidMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-okhttp:2.3.7")
                implementation("io.ktor:ktor-client-logging:2.3.7")
            }
        }
        
        val iosMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-darwin:2.3.7")
            }
        }
        
        val jsMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-js:2.3.7")
            }
        }
    }
}

android {
    namespace = "com.example.shared"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
```

## 二、KMP 实战开发

### 2.1 数据模型定义

使用 `kotlinx.serialization` 定义跨平台的数据模型：

```kotlin
// shared/src/commonMain/kotlin/com/example/shared/model/Product.kt
package com.example.shared.model

import kotlinx.serialization.Serializable

@Serializable
data class Product(
    val id: Long,
    val name: String,
    val description: String,
    val price: Double,
    val originalPrice: Double,
    val currency: String = "CNY",
    val categoryId: Long,
    val categoryName: String,
    val imageUrl: String,
    val images: List<String> = emptyList(),
    val rating: Double = 0.0,
    val reviewCount: Int = 0,
    val salesCount: Int = 0,
    val stock: Int = 0,
    val status: ProductStatus = ProductStatus.ACTIVE,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
enum class ProductStatus {
    ACTIVE,
    INACTIVE,
    SOLD_OUT,
    DELETED
}

@Serializable
data class ProductListResponse(
    val code: Int,
    val message: String,
    val data: ProductListData,
)

@Serializable
data class ProductListData(
    val items: List<Product>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
    val hasMore: Boolean,
)
```

### 2.2 网络请求层

```kotlin
// shared/src/commonMain/kotlin/com/example/shared/api/ApiClient.kt
package com.example.shared.api

import io.ktor.client.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

class ApiClient(
    private val baseUrl: String,
    private val tokenProvider: TokenProvider,
) {
    val httpClient = HttpClient {
        // JSON 序列化配置
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                isLenient = true
                encodeDefaults = true
            })
        }
        
        // 日志
        install(Logging) {
            level = LogLevel.BODY
            logger = object : Logger {
                override fun log(message: String) {
                    platformLogger.log(message)
                }
            }
        }
        
        // 超时
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 15_000
        }
        
        // 默认请求头
        defaultRequest {
            url(baseUrl)
            contentType(ContentType.Application.Json)
            header("X-Platform", platformLogger.getPlatformName())
            header("X-App-Version", getAppVersion())
        }
        
        // 认证拦截器
        install("AuthInterceptor") {
            requestPipeline.intercept(HttpRequestPipeline.State) {
                val token = tokenProvider.getToken()
                if (token != null) {
                    context.headers.append("Authorization", "Bearer $token")
                }
            }
        }
        
        // 重试
        install("RetryInterceptor") {
            // Ktor 没有内置重试，需要自己实现
        }
    }
    
    companion object {
        lateinit var platformLogger: PlatformLogger
        lateinit var getAppVersion: () -> String
    }
}

// Token Provider 接口
interface TokenProvider {
    suspend fun getToken(): String?
    suspend fun refreshToken(): String?
}
```

### 2.3 Repository 层

```kotlin
// shared/src/commonMain/kotlin/com/example/shared/repository/ProductRepository.kt
package com.example.shared.repository

import com.example.shared.api.ApiClient
import com.example.shared.model.*
import io.ktor.client.call.*
import io.ktor.client.request.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

class ProductRepository(
    private val apiClient: ApiClient,
) {
    /**
     * 获取商品列表
     */
    fun getProducts(
        page: Int = 1,
        pageSize: Int = 20,
        categoryId: Long? = null,
        keyword: String? = null,
    ): Flow<Resource<ProductListData>> = flow {
        emit(Resource.Loading)
        
        try {
            val response = apiClient.httpClient.get("api/v1/products") {
                parameter("page", page)
                parameter("page_size", pageSize)
                if (categoryId != null) parameter("category_id", categoryId)
                if (keyword != null) parameter("keyword", keyword)
            }.body<ProductListResponse>()
            
            if (response.code == 0) {
                emit(Resource.Success(response.data))
            } else {
                emit(Resource.Error(response.message))
            }
        } catch (e: Exception) {
            emit(Resource.Error(e.message ?: "Unknown error"))
        }
    }
    
    /**
     * 获取商品详情
     */
    suspend fun getProductDetail(productId: Long): Resource<Product> {
        return try {
            val response = apiClient.httpClient.get("api/v1/products/$productId")
                .body<ProductDetailResponse>()
            
            if (response.code == 0) {
                Resource.Success(response.data)
            } else {
                Resource.Error(response.message)
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Unknown error")
        }
    }
    
    /**
     * 搜索商品
     */
    suspend fun searchProducts(
        keyword: String,
        page: Int = 1,
        pageSize: Int = 20,
    ): Resource<ProductListData> {
        return try {
            val response = apiClient.httpClient.get("api/v1/products/search") {
                parameter("q", keyword)
                parameter("page", page)
                parameter("page_size", pageSize)
            }.body<ProductListResponse>()
            
            if (response.code == 0) {
                Resource.Success(response.data)
            } else {
                Resource.Error(response.message)
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Unknown error")
        }
    }
}

// 通用资源封装
sealed class Resource<out T> {
    data object Loading : Resource<Nothing>()
    data class Success<T>(val data: T) : Resource<T>()
    data class Error(val message: String) : Resource<Nothing>()
}
```

### 2.4 Use Case 层

```kotlin
// shared/src/commonMain/kotlin/com/example/shared/usecase/GetProductsUseCase.kt
package com.example.shared.usecase

import com.example.shared.model.Product
import com.example.shared.model.ProductListData
import com.example.shared.repository.ProductRepository
import com.example.shared.repository.Resource
import kotlinx.coroutines.flow.Flow

class GetProductsUseCase(
    private val productRepository: ProductRepository,
) {
    /**
     * 获取首页商品列表
     */
    operator fun invoke(
        page: Int = 1,
        categoryId: Long? = null,
    ): Flow<Resource<ProductListData>> {
        return productRepository.getProducts(
            page = page,
            pageSize = 20,
            categoryId = categoryId,
        )
    }
    
    /**
     * 获取推荐商品（包含业务逻辑）
     */
    suspend fun getRecommendedProducts(userId: Long): Resource<List<Product>> {
        // 这里可以包含复杂的业务逻辑
        // 比如：根据用户偏好过滤、排序、去重等
        
        val result = productRepository.getProducts(page = 1, pageSize = 50)
        
        // 收集 Flow 的第一个结果
        var resource: Resource<ProductListData> = Resource.Loading
        result.collect { resource = it }
        
        return when (resource) {
            is Resource.Success -> {
                val products = (resource as Resource.Success<ProductListData>).data.items
                
                // 业务逻辑：按评分和销量综合排序
                val ranked = products
                    .filter { it.stock > 0 }
                    .sortedByDescending { it.rating * 0.6 + (it.salesCount / 1000.0) * 0.4 }
                    .take(10)
                
                Resource.Success(ranked)
            }
            is Resource.Error -> Resource.Error((resource as Resource.Error).message)
            Resource.Loading -> Resource.Loading
        }
    }
}
```

### 2.5 ViewModel（Shared）

```kotlin
// shared/src/commonMain/kotlin/com/example/shared/viewmodel/ProductListViewModel.kt
package com.example.shared.viewmodel

import com.example.shared.model.Product
import com.example.shared.model.ProductListData
import com.example.shared.repository.Resource
import com.example.shared.usecase.GetProductsUseCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class ProductListViewModel(
    private val getProductsUseCase: GetProductsUseCase,
    private val coroutineScope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ProductListState())
    val state: StateFlow<ProductListState> = _state.asStateFlow()
    
    private val _effects = MutableSharedFlow<ProductListEffect>()
    val effects: SharedFlow<ProductListEffect> = _effects.asSharedFlow()
    
    init {
        loadProducts()
    }
    
    fun loadProducts(page: Int = 1) {
        coroutineScope.launch {
            getProductsUseCase(page = page).collect { resource ->
                when (resource) {
                    is Resource.Loading -> {
                        _state.update { it.copy(isLoading = true) }
                    }
                    is Resource.Success -> {
                        _state.update { currentState ->
                            currentState.copy(
                                isLoading = false,
                                products = if (page == 1) {
                                    resource.data.items
                                } else {
                                    currentState.products + resource.data.items
                                },
                                currentPage = page,
                                hasMore = resource.data.hasMore,
                                error = null,
                            )
                        }
                    }
                    is Resource.Error -> {
                        _state.update { it.copy(isLoading = false, error = resource.message) }
                        _effects.emit(ProductListEffect.ShowError(resource.message))
                    }
                }
            }
        }
    }
    
    fun loadMore() {
        val currentState = _state.value
        if (!currentState.isLoading && currentState.hasMore) {
            loadProducts(currentState.currentPage + 1)
        }
    }
    
    fun refresh() {
        loadProducts(1)
    }
    
    fun selectProduct(product: Product) {
        coroutineScope.launch {
            _effects.emit(ProductListEffect.NavigateToDetail(product.id))
        }
    }
}

data class ProductListState(
    val isLoading: Boolean = false,
    val products: List<Product> = emptyList(),
    val currentPage: Int = 1,
    val hasMore: Boolean = true,
    val error: String? = null,
)

sealed class ProductListEffect {
    data class ShowError(val message: String) : ProductListEffect()
    data class NavigateToDetail(val productId: Long) : ProductListEffect()
}
```

## 三、平台集成

### 3.1 Android 集成（Jetpack Compose）

```kotlin
// androidApp/src/main/java/com/example/android/ProductListScreen.kt
package com.example.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.shared.model.Product
import com.example.shared.viewmodel.ProductListViewModel
import com.example.shared.viewmodel.ProductListState
import com.example.shared.viewmodel.ProductListEffect

@Composable
fun ProductListScreen(
    viewModel: ProductListViewModel,
    onProductClick: (Long) -> Unit,
) {
    val state by viewModel.state.collectAsState()
    
    // 处理副作用
    LaunchedEffect(Unit) {
        viewModel.effects.collect { effect ->
            when (effect) {
                is ProductListEffect.NavigateToDetail -> onProductClick(effect.productId)
                is ProductListEffect.ShowError -> {
                    // 显示 Toast
                }
            }
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("商品列表") })
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            if (state.isLoading && state.products.isEmpty()) {
                CircularProgressIndicator(
                    modifier = Modifier.align(androidx.compose.ui.Alignment.Center)
                )
            } else {
                LazyColumn {
                    items(state.products) { product ->
                        ProductItem(
                            product = product,
                            onClick = { viewModel.selectProduct(product) }
                        )
                    }
                    
                    if (state.hasMore) {
                        item {
                            LaunchedEffect(Unit) {
                                viewModel.loadMore()
                            }
                            CircularProgressIndicator(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProductItem(product: Product, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clickable(onClick = onClick)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = product.name,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "¥${product.price}",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = product.categoryName,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
```

### 3.2 iOS 集成（SwiftUI）

```swift
// iosApp/iosApp/ProductListView.swift
import SwiftUI
import Shared

struct ProductListView: View {
    @StateObject private var viewModel = ProductListViewModelWrapper()
    
    var body: some View {
        NavigationView {
            Group {
                if viewModel.isLoading && viewModel.products.isEmpty {
                    ProgressView()
                } else {
                    List(viewModel.products, id: \.id) { product in
                        ProductRow(product: product)
                            .onTapGesture {
                                viewModel.selectProduct(product: product)
                            }
                    }
                    .refreshable {
                        viewModel.refresh()
                    }
                }
            }
            .navigationTitle("商品列表")
            .alert(item: $viewModel.errorMessage) { error in
                Alert(title: Text("错误"), message: Text(error))
            }
        }
    }
}

struct ProductRow: View {
    let product: Product
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(product.name)
                .font(.headline)
            
            Text("¥\(String(format: "%.2f", product.price))")
                .font(.title3)
                .foregroundColor(.blue)
            
            Text(product.categoryName)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

// ViewModel 包装器
@MainActor
class ProductListViewModelWrapper: ObservableObject {
    private let viewModel: Shared.ProductListViewModel
    
    @Published var products: [Product] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    init() {
        let scope = CoroutineScopeKt.MainScope()
        let apiClient = ApiClient(
            baseUrl: "https://api.example.com/",
            tokenProvider: IOSTokenProvider()
        )
        let repository = ProductRepository(apiClient: apiClient)
        let useCase = GetProductsUseCase(productRepository: repository)
        
        self.viewModel = ProductListViewModel(
            getProductsUseCase: useCase,
            coroutineScope: scope
        )
        
        // 收集状态
        Task {
            for await state in viewModel.state {
                self.products = state.products
                self.isLoading = state.isLoading
                self.error = state.error
            }
        }
        
        // 收集副作用
        Task {
            for await effect in viewModel.effects {
                switch effect {
                case let effect as ProductListEffect.NavigateToDetail:
                    // 导航到详情页
                    break
                case let effect as ProductListEffect.ShowError:
                    self.errorMessage = effect.message
                default:
                    break
                }
            }
        }
    }
    
    func loadMore() {
        viewModel.loadMore()
    }
    
    func refresh() {
        viewModel.refresh()
    }
    
    func selectProduct(product: Product) {
        viewModel.selectProduct(product: product)
    }
}
```

## 四、KMP vs Flutter vs uni-app 对比

### 4.1 核心定位差异

| 维度 | KMP | Flutter | uni-app |
|------|-----|---------|---------|
| **核心理念** | 共享业务逻辑 | 统一 UI 渲染 | 多端统一开发 |
| **UI 方案** | 各平台原生 UI | 自绘引擎 (Skia) | WebView + 原生组件 |
| **编程语言** | Kotlin | Dart | Vue.js (JavaScript) |
| **共享范围** | 业务逻辑层 | UI + 业务逻辑 | UI + 业务逻辑 |
| **原生体验** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **开发效率** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **生态成熟度** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 4.2 性能对比

| 场景 | KMP | Flutter | uni-app |
|------|-----|---------|---------|
| CPU 密集计算 | 原生性能 | 接近原生 | 较慢（JS 引擎） |
| 网络请求 | 原生性能 | 接近原生 | 一般 |
| 列表滚动 | 原生（各平台） | 优秀（自绘引擎） | 一般（WebView） |
| 动画 | 原生（各平台） | 优秀（自绘引擎） | 一般 |
| 内存占用 | 低 | 中 | 高 |
| 启动速度 | 快 | 中 | 慢 |

### 4.3 开发体验对比

**KMP 开发体验**：
- ✅ 使用 Kotlin 语言，类型安全，IDE 支持优秀
- ✅ 业务逻辑一次编写，单元测试一次编写
- ✅ 渐进式采用，可以先共享部分逻辑
- ❌ 需要维护多个 UI 层
- ❌ iOS 端调试体验不如原生 Xcode
- ❌ 生态相对较小

**Flutter 开发体验**：
- ✅ Hot Reload，开发效率高
- ✅ 一套代码覆盖所有平台
- ✅ Widget 丰富，自定义能力强
- ❌ Dart 语言生态较小
- ❌ 平台特定功能需要 Platform Channel
- ❌ Web 端体验一般

**uni-app 开发体验**：
- ✅ 前端开发者上手快
- ✅ 小程序生态覆盖广
- ✅ 插件市场丰富
- ❌ 性能瓶颈明显
- ❌ 复杂 UI 定制困难
- ❌ 调试工具不够完善

### 4.4 选型决策矩阵

```
┌─────────────────────────────────────────────────────────────────┐
│                     选型决策树                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Q1: 是否需要小程序支持？                                         │
│  ├── 是 → uni-app                                                │
│  └── 否 ↓                                                        │
│                                                                 │
│  Q2: 是否追求极致原生体验？                                        │
│  ├── 是 → KMP（共享逻辑 + 原生 UI）                               │
│  └── 否 ↓                                                        │
│                                                                 │
│  Q3: 团队技术栈是什么？                                           │
│  ├── Kotlin/Android → KMP                                       │
│  ├── JavaScript/Vue → uni-app / React Native                    │
│  ├── Dart → Flutter                                             │
│  └── 无偏好 ↓                                                    │
│                                                                 │
│  Q4: 项目复杂度如何？                                             │
│  ├── 高（复杂业务逻辑、高性能要求）→ KMP                           │
│  ├── 中（标准 CRUD、中等复杂度）→ Flutter                          │
│  └── 低（简单应用、快速上线）→ uni-app                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 五、KMP 适用场景

### 5.1 最适合 KMP 的场景

1. **已有原生 Android/iOS 应用**：想要共享业务逻辑但不想重写 UI
2. **复杂业务逻辑**：订单状态机、支付流程、数据校验等
3. **高性能要求**：实时计算、大量数据处理
4. **团队有 Kotlin 经验**：Android 团队扩展到 iOS

### 5.2 不太适合 KMP 的场景

1. **纯 UI 密集型应用**：动画丰富、UI 高度定制
2. **快速原型验证**：需要快速上线的 MVP
3. **小程序需求**：需要覆盖微信/支付宝小程序
4. **Web 优先**：主要面向浏览器端

### 5.3 KMP + Flutter 混合方案

在实际项目中，KMP 和 Flutter 并不互斥，可以组合使用：

```
┌─────────────────────────────────────────────────────────────────┐
│                    KMP + Flutter 混合架构                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Flutter (UI Layer)                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │  │
│  │  │ Material │  │  Custom  │  │ Platform │               │  │
│  │  │  Widget  │  │  Widget  │  │  Channel │               │  │
│  │  └──────────┘  └──────────┘  └─────┬────┘               │  │
│  └────────────────────────────────────┼──────────────────────┘  │
│                                       │                         │
│                                       ▼                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              KMP (Business Logic Layer)                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │  │
│  │  │   API    │  │  Domain  │  │   Data   │               │  │
│  │  │  Client  │  │  Models  │  │  Repos   │               │  │
│  │  └──────────┘  └──────────┘  └──────────┘               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

KMP 负责业务逻辑层（API 调用、数据处理、状态管理），Flutter 负责 UI 渲染。通过 FFI 或 Platform Channel 桥接两者。

## 六、总结

KMP 不是要取代 Flutter 或 uni-app，而是为跨平台开发提供了一种新的思路：

- **如果你追求原生体验**：KMP 共享逻辑 + 各平台原生 UI
- **如果你追求开发效率**：Flutter 一套代码覆盖所有平台
- **如果你需要小程序**：uni-app 是唯一选择

在实际项目中，根据团队技术栈、业务复杂度、性能要求、平台覆盖需求来做出选择。很多时候，混合使用多种方案才是最优解。

KMP 的最大价值在于：它让你用最熟悉的方式（Kotlin）编写最核心的代码（业务逻辑），同时保留各平台的原生 UI 能力。对于有原生开发经验的团队来说，这是一条阻力最小的跨平台之路。

## 相关阅读

- [SwiftUI 数据流实战：@State/@Binding/@Observable 与 Combine 响应式编程——前端开发者视角](/categories/前端/SwiftUI-数据流实战-State-Binding-Observable-与-Combine-响应式编程/)
- [Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策](/categories/前端/Deno-2x-实战-安全优先的JavaScript运行时-与Node.js-Bun的三选一决策/)
