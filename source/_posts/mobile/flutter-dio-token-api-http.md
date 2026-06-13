---

title: Flutter 网络请求实战：Dio 封装、拦截器、错误处理与 Token 刷新——从裸调 API 到企业级 HTTP 客户端的踩坑记录
keywords: [Flutter, Dio, Token, API, HTTP, 网络请求实战, 封装, 拦截器, 错误处理与, 刷新]
description: 系统拆解 Flutter 中 Dio 网络请求封装的完整实战方案，覆盖 BaseOptions 配置、拦截器链设计、统一错误处理、Token 自动刷新、请求重试、文件上传下载、测试 Mock 与常见踩坑，帮助你搭建可维护、可扩展的企业级 HTTP 客户端。
date: 2026-06-01 22:30:00
tags:
- Flutter
- Dio
- Dart
- HTTP
- 网络请求
- token刷新
- 移动端
categories:
- mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
---




# Flutter 网络请求实战：Dio 封装、拦截器、错误处理与 Token 刷新

> 在 B2C 电商项目中，移动端 API 对接是每天都在做的事。从最初的 `http` 包裸调，到迁移到 Dio 再到企业级封装，本文记录了完整的演进路径与踩坑经验。

## 📌 为什么选 Dio？

在 Flutter 生态中，HTTP 请求方案主要有三个：

| 特性 | `http` (官方) | `dio` | `chopper` |
|------|:---:|:---:|:---:|
| 拦截器 | ❌ | ✅ | ✅ |
| 请求取消 | 手动 | ✅ | ✅ |
| 文件上传/下载进度 | ❌ | ✅ | ✅ |
| 超时控制 | 基础 | 细粒度 | 基础 |
| Token 刷新 | 手动实现 | 拦截器自动 | 需手动 |
| 适配器（Mock/Test） | 需额外工作 | ✅ HttpClientAdapter | ✅ |
| 社区活跃度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |

**结论：** 对于需要 Token 刷新、统一错误处理、请求/响应拦截的 B2C 项目，Dio 是事实上的标准选择。

---

## 🏗️ 架构设计：分层封装

```
┌──────────────────────────────────────────┐
│              UI / ViewModel              │
│         (调用 apiClient.getXxx())         │
├──────────────────────────────────────────┤
│            ApiService (业务层)            │
│     /users, /products, /orders ...       │
├──────────────────────────────────────────┤
│          ApiClient (封装层)               │
│   Dio 实例 + 拦截器 + 错误映射            │
├──────────────────────────────────────────┤
│         Dio Interceptors                  │
│  AuthInterceptor / LogInterceptor /      │
│  ErrorInterceptor / RetryInterceptor     │
├──────────────────────────────────────────┤
│       HttpClientAdapter (可选)            │
│      Mock 适配器 / 自定义底层              │
└──────────────────────────────────────────┘
```

---

## 🔧 Step 1：基础 Dio 实例配置

```dart
// lib/core/network/api_client.dart
import 'package:dio/dio.dart';

class ApiClient {
  late final Dio _dio;

  ApiClient({String? baseUrl}) {
    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl ?? 'https://api.example.com/v2',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    // 拦截器注册顺序很重要！
    _dio.interceptors.addAll([
      LogInterceptor(
        requestBody: true,
        responseBody: true,
        logPrint: (obj) => print('🌐 [DIO] $obj'),
      ),
      AuthInterceptor(_dio),
      ErrorInterceptor(),
      RetryInterceptor(_dio),
    ]);
  }

  Dio get dio => _dio;
}
```

### 踩坑记录 #1：超时设置的陷阱

```dart
// ❌ 错误：超时为 Duration.zero 表示永不超时（不是 0 秒！）
connectTimeout: Duration.zero,

// ❌ 错误：旧版本用 int（毫秒），新版本用 Duration
connectTimeout: 15000,  // 编译错误

// ✅ 正确
connectTimeout: const Duration(seconds: 15),
```

**教训：** Dio 5.x 的 `connectTimeout` 从 `int?` 改为 `Duration?`。迁移时别忘了修改。

---

## 🔐 Step 2：Auth 拦截器 + Token 自动刷新

这是最核心也最容易踩坑的部分。

```dart
// lib/core/network/interceptors/auth_interceptor.dart
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../token_storage.dart';

class AuthInterceptor extends Interceptor {
  final Dio _dio;
  final TokenStorage _tokenStorage = TokenStorage();
  
  // 刷新 Token 的锁机制
  bool _isRefreshing = false;
  final List<RequestOptions> _pendingRequests = [];

  AuthInterceptor(this._dio);

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // 不需要 Token 的接口直接放行
    if (options.extra['noAuth'] == true) {
      return handler.next(options);
    }

    final token = await _tokenStorage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }

    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    // 只处理 401 Unauthorized
    if (err.response?.statusCode != 401) {
      return handler.next(err);
    }

    // 如果已经在刷新中，把请求挂起
    if (_isRefreshing) {
      _pendingRequests.add(err.requestOptions);
      return; // 不调用 handler.next()，等刷新完成
    }

    _isRefreshing = true;

    try {
      final newToken = await _refreshToken();
      
      if (newToken != null) {
        // 刷新成功，重试当前请求
        err.requestOptions.headers['Authorization'] = 'Bearer $newToken';
        
        // 重试所有挂起的请求
        for (final pending in _pendingRequests) {
          pending.headers['Authorization'] = 'Bearer $newToken';
          _dio.fetch(pending);
        }
        _pendingRequests.clear();

        // 重试当前请求
        final response = await _dio.fetch(err.requestOptions);
        handler.resolve(response);
      } else {
        // 刷新失败，清除 Token，跳转登录
        await _tokenStorage.clear();
        _handleForceLogout();
        handler.next(err);
      }
    } catch (e) {
      await _tokenStorage.clear();
      _handleForceLogout();
      handler.next(err);
    } finally {
      _isRefreshing = false;
    }
  }

  Future<String?> _refreshToken() async {
    final refreshToken = await _tokenStorage.getRefreshToken();
    if (refreshToken == null) return null;

    try {
      // ⚠️ 关键：用独立的 Dio 实例避免拦截器循环！
      final refreshDio = Dio(
        BaseOptions(
          baseUrl: _dio.options.baseUrl,
          headers: {'Content-Type': 'application/json'},
        ),
      );

      final response = await refreshDio.post(
        '/auth/refresh',
        data: {'refresh_token': refreshToken},
      );

      final newAccessToken = response.data['data']['access_token'];
      final newRefreshToken = response.data['data']['refresh_token'];

      await _tokenStorage.saveTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );

      return newAccessToken;
    } on DioException {
      return null;
    }
  }

  void _handleForceLogout() {
    // 通过 GlobalKey<NavigatorState> 或 EventBus 通知 UI 层
    debugPrint('🔒 Token 过期，强制登出');
  }
}
```

### 踩坑记录 #2：刷新 Token 的循环调用地狱

```dart
// ❌ 致命错误：用同一个 Dio 实例刷新 Token
// 当 refresh 接口也返回 401 时，会无限递归！
final response = await _dio.post('/auth/refresh', ...);

// ✅ 正确：创建独立的 Dio 实例，绕过拦截器
final refreshDio = Dio(BaseOptions(baseUrl: _dio.options.baseUrl));
final response = await refreshDio.post('/auth/refresh', ...);
```

### 踩坑记录 #3：并发请求同时刷新 Token

假设同时有 10 个请求返回 401：

```
请求1 → 401 → 开始刷新 Token → 拿到新 Token → 重试请求1
请求2 → 401 → 发现正在刷新 → 挂起等待
请求3 → 401 → 发现正在刷新 → 挂起等待
...
请求10 → 401 → 发现正在刷新 → 挿起等待

刷新完成 → 按序重试请求2~10
```

**如果不加锁**，10 个请求会同时发起 10 次 `refresh` 调用，后端返回 10 个新 Token，旧的被覆盖，导致部分请求使用的 Token 失效。

---

## 🚨 Step 3：统一错误处理

```dart
// lib/core/network/interceptors/error_interceptor.dart
import 'package:dio/dio.dart';

class ApiException implements Exception {
  final int? statusCode;
  final String message;
  final String? errorCode;
  final dynamic data;

  ApiException({
    this.statusCode,
    required this.message,
    this.errorCode,
    this.data,
  });

  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiException = _mapToApiException(err);
    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: apiException,
      ),
    );
  }

  ApiException _mapToApiException(DioException err) {
    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException(
          statusCode: 408,
          message: '网络连接超时，请检查网络',
          errorCode: 'TIMEOUT',
        );

      case DioExceptionType.connectionError:
        return ApiException(
          statusCode: 0,
          message: '无法连接服务器，请检查网络',
          errorCode: 'NO_CONNECTION',
        );

      case DioExceptionType.badResponse:
        return _handleBadResponse(err.response!);

      case DioExceptionType.cancel:
        return ApiException(
          statusCode: 0,
          message: '请求已取消',
          errorCode: 'CANCELLED',
        );

      default:
        return ApiException(
          statusCode: 0,
          message: '未知错误：${err.message}',
          errorCode: 'UNKNOWN',
        );
    }
  }

  ApiException _handleBadResponse(Response response) {
    final statusCode = response.statusCode ?? 0;
    final data = response.data;

    // 尝试解析后端统一错误格式
    String message = '服务器错误';
    String? errorCode;

    if (data is Map<String, dynamic>) {
      message = data['message'] ?? data['error'] ?? message;
      errorCode = data['error_code']?.toString();
    }

    switch (statusCode) {
      case 400:
        return ApiException(
          statusCode: 400,
          message: message,
          errorCode: errorCode ?? 'BAD_REQUEST',
          data: data,
        );
      case 401:
        return ApiException(
          statusCode: 401,
          message: '登录已过期，请重新登录',
          errorCode: 'UNAUTHORIZED',
        );
      case 403:
        return ApiException(
          statusCode: 403,
          message: '没有权限访问',
          errorCode: 'FORBIDDEN',
        );
      case 404:
        return ApiException(
          statusCode: 404,
          message: '请求的资源不存在',
          errorCode: 'NOT_FOUND',
        );
      case 422:
        return ApiException(
          statusCode: 422,
          message: message,
          errorCode: errorCode ?? 'VALIDATION_ERROR',
          data: data,
        );
      case 429:
        return ApiException(
          statusCode: 429,
          message: '请求过于频繁，请稍后再试',
          errorCode: 'RATE_LIMITED',
        );
      case 500:
      case 502:
      case 503:
        return ApiException(
          statusCode: statusCode,
          message: '服务器暂时不可用，请稍后再试',
          errorCode: 'SERVER_ERROR',
        );
      default:
        return ApiException(
          statusCode: statusCode,
          message: message,
          errorCode: errorCode ?? 'HTTP_$statusCode',
        );
    }
  }
}
```

---

## 🔄 Step 4：请求重试机制

```dart
// lib/core/network/interceptors/retry_interceptor.dart
import 'package:dio/dio.dart';

class RetryInterceptor extends Interceptor {
  final Dio _dio;
  final int maxRetries;
  final Duration retryDelay;

  RetryInterceptor(
    this._dio, {
    this.maxRetries = 3,
    this.retryDelay = const Duration(seconds: 1),
  });

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final retryCount = err.requestOptions.extra['retryCount'] ?? 0;

    // 只重试网络错误和 5xx 错误，不重试 4xx
    if (!_shouldRetry(err) || retryCount >= maxRetries) {
      return handler.next(err);
    }

    // 指数退避：1s → 2s → 4s
    final delay = retryDelay * (1 << retryCount);
    await Future.delayed(delay);

    err.requestOptions.extra['retryCount'] = retryCount + 1;

    try {
      final response = await _dio.fetch(err.requestOptions);
      handler.resolve(response);
    } on DioException (e) {
      handler.next(e);
    }
  }

  bool _shouldRetry(DioException err) {
    // 网络层错误
    if (err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout) {
      return true;
    }

    // 5xx 服务器错误
    final statusCode = err.response?.statusCode;
    if (statusCode != null && statusCode >= 500) {
      return true;
    }

    return false;
  }
}
```

### 踩坑记录 #4：幂等性问题

```dart
// ❌ 危险：POST 请求重试可能导致重复下单！
// 用户下单 POST /orders → 超时 → 重试 → 产生两笔订单

// ✅ 解决方案：
// 1. 后端实现幂等键（Idempotency-Key）
// 2. 前端在重试时携带同一个 Key
options.headers['Idempotency-Key'] = const Uuid().v4();

// 3. 或者只对 GET/PUT/DELETE 重试，POST 不重试
bool _shouldRetry(DioException err) {
  final method = err.requestOptions.method.toUpperCase();
  if (method == 'POST') return false; // POST 不自动重试
  // ...
}
```

---

## 📡 Step 5：业务层 ApiService 封装

```dart
// lib/core/network/api_service.dart
import 'package:dio/dio.dart';

class ApiService {
  final Dio _dio;

  ApiService(this._dio);

  // ============ 通用请求方法 ============

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    T Function(Map<String, dynamic>)? fromJson,
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      path,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    );
    return _parseResponse<T>(response, fromJson);
  }

  Future<T> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    T Function(Map<String, dynamic>)? fromJson,
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.post(
      path,
      data: data,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    );
    return _parseResponse<T>(response, fromJson);
  }

  Future<T> put<T>(
    String path, {
    dynamic data,
    T Function(Map<String, dynamic>)? fromJson,
  }) async {
    final response = await _dio.put(path, data: data);
    return _parseResponse<T>(response, fromJson);
  }

  Future<void> delete<T>(String path, {dynamic data}) async {
    await _dio.delete(path, data: data);
  }

  // ============ 文件上传 ============

  Future<T> uploadFile<T>(
    String path, {
    required String filePath,
    required String fieldName,
    Map<String, dynamic>? extraData,
    T Function(Map<String, dynamic>)? fromJson,
    void Function(int, int)? onSendProgress,
  }) async {
    final formData = FormData.fromMap({
      fieldName: await MultipartFile.fromFile(filePath),
      if (extraData != null) ...extraData,
    });

    final response = await _dio.post(
      path,
      data: formData,
      onSendProgress: onSendProgress,
    );
    return _parseResponse<T>(response, fromJson);
  }

  // ============ 文件下载 ============

  Future<void> downloadFile(
    String urlPath,
    String savePath, {
    void Function(int, int)? onReceiveProgress,
    CancelToken? cancelToken,
  }) async {
    await _dio.download(
      urlPath,
      savePath,
      onReceiveProgress: onReceiveProgress,
      cancelToken: cancelToken,
    );
  }

  // ============ 响应解析 ============

  T _parseResponse<T>(
    Response response,
    T Function(Map<String, dynamic>)? fromJson,
  ) {
    final data = response.data;

    // 假设后端统一格式：{ "code": 200, "data": {...}, "message": "ok" }
    if (data is Map<String, dynamic>) {
      final code = data['code'];
      if (code != 200 && code != 0) {
        throw ApiException(
          statusCode: code,
          message: data['message'] ?? '业务错误',
          errorCode: data['error_code']?.toString(),
          data: data['data'],
        );
      }

      if (fromJson != null && data['data'] != null) {
        return fromJson(data['data'] as Map<String, dynamic>);
      }
      return data['data'] as T;
    }

    return data as T;
  }
}
```

### 使用示例：用户模块

```dart
// lib/features/user/data/user_api.dart
import 'package:dio/dio.dart';

class UserApi {
  final ApiService _api;

  UserApi(this._api);

  /// 获取用户信息
  Future<UserModel> getProfile() {
    return _api.get<UserModel>(
      '/user/profile',
      fromJson: UserModel.fromJson,
    );
  }

  /// 更新用户头像
  Future<UserModel> updateAvatar({
    required String filePath,
    void Function(int sent, int total)? onProgress,
  }) {
    return _api.uploadFile<UserModel>(
      '/user/avatar',
      filePath: filePath,
      fieldName: 'avatar',
      fromJson: UserModel.fromJson,
      onSendProgress: onProgress,
    );
  }

  /// 获取订单列表（带分页）
  Future<PaginatedResponse<OrderModel>> getOrders({
    int page = 1,
    int perPage = 20,
    CancelToken? cancelToken,
  }) {
    return _api.get<PaginatedResponse<OrderModel>>(
      '/user/orders',
      queryParameters: {'page': page, 'per_page': perPage},
      fromJson: (json) => PaginatedResponse.fromJson(
        json,
        (item) => OrderModel.fromJson(item),
      ),
      cancelToken: cancelToken,
    );
  }
}
```

---

## 🧪 Step 6：测试友好的 HttpClientAdapter

```dart
// lib/core/network/mock_adapter.dart
import 'package:dio/dio.dart';

/// 自定义适配器，用于单元测试
class MockAdapter extends HttpClientAdapter {
  final Map<String, dynamic> Function(RequestOptions) handler;

  MockAdapter({required this.handler});

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final responseData = handler(options);

    return ResponseBody.fromString(
      jsonEncode(responseData),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

// 测试用法
void main() {
  test('getProfile returns user', () async {
    final dio = Dio();
    dio.httpClientAdapter = MockAdapter(
      handler: (options) {
        if (options.path == '/user/profile') {
          return {
            'code': 200,
            'data': {'id': 1, 'name': 'Test User', 'email': 'test@example.com'},
            'message': 'ok',
          };
        }
        return {'code': 404, 'message': 'Not found'};
      },
    );

    final api = ApiService(dio);
    final user = await api.get<UserModel>(
      '/user/profile',
      fromJson: UserModel.fromJson,
    );

    expect(user.name, 'Test User');
  });
}
```

---

## 🔌 Step 7：依赖注入（Riverpod）

```dart
// lib/core/network/providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

final dioProvider = Provider<Dio>((ref) {
  return ApiClient(baseUrl: 'https://api.example.com/v2').dio;
});

final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService(ref.read(dioProvider));
});

final userApiProvider = Provider<UserApi>((ref) {
  return UserApi(ref.read(apiServiceProvider));
});

final productApiProvider = Provider<ProductApi>((ref) {
  return ProductApi(ref.read(apiServiceProvider));
});

// 在 Widget 中使用
class ProfilePage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(userProfileProvider);

    return profileAsync.when(
      data: (user) => Text(user.name),
      loading: () => const CircularProgressIndicator(),
      error: (err, _) => Text('加载失败: ${(err as ApiException).message}'),
    );
  }
}

// 使用 FutureProvider 自动管理加载状态
final userProfileProvider = FutureProvider<UserModel>((ref) {
  return ref.read(userApiProvider).getProfile();
});
```

---

## 📋 核心拦截器对比总结

| 拦截器 | 触发时机 | 职责 | 关键注意点 |
|--------|---------|------|-----------|
| **AuthInterceptor** | 请求前 + 401错误后 | 注入 Token / 自动刷新 | 用独立 Dio 实例刷新，加锁防并发 |
| **LogInterceptor** | 请求/响应时 | 日志记录 | 生产环境关闭 `requestBody` |
| **ErrorInterceptor** | 错误时 | 统一错误映射 | 区分网络错误 / HTTP 错误 / 业务错误 |
| **RetryInterceptor** | 错误后 | 指数退避重试 | POST 请求注意幂等性 |

## 📊 Dio、http、Retrofit 怎么选？

很多团队会在项目初期纠结：是直接用 `http`，还是上 `dio`，或者进一步叠加 `retrofit` 代码生成。我的实际建议是：**先按复杂度选，再按团队协作方式选**。

| 维度 | `http` | `dio` | `retrofit + dio` |
|------|--------|-------|------------------|
| 学习成本 | 最低 | 中等 | 较高 |
| 请求封装自由度 | 中等 | 高 | 高 |
| 拦截器能力 | 弱 | 强 | 依赖 dio |
| Token 刷新 | 手写 | 容易实现 | 容易实现 |
| 文件上传下载 | 基础 | 完整 | 完整 |
| 代码生成 | 无 | 无 | 有 |
| 适合场景 | Demo / 简单接口 | 中大型业务项目 | 接口多、团队规范强 |
| 调试体验 | 简单直接 | 最均衡 | 生成代码需要维护 |

### 什么时候只用 `http`

- 项目非常小，只有 2~3 个简单接口
- 没有 Token 刷新、重试、上传下载进度等需求
- 你只想快速验证一个原型

### 什么时候优先选 `dio`

- 需要统一拦截器、统一错误处理、统一日志
- 需要处理 401 自动刷新 Token
- 需要下载、上传、取消请求、重试等企业项目能力

### 什么时候叠加 `retrofit`

- 后端接口非常多，希望把请求声明写成接口风格
- 团队希望减少手写样板代码
- 你可以接受构建时的代码生成和额外维护成本

---

## 🧪 可直接运行的最小示例

如果你想先验证思路，而不是一上来就接业务项目，建议先跑一个最小 Demo。下面这个例子可以直接放进 Flutter 或 Dart 项目中执行。

### `pubspec.yaml`

```yaml
dependencies:
  dio: ^5.7.0
```

### `main.dart`

```dart
import 'package:dio/dio.dart';

Future<void> main() async {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'https://jsonplaceholder.typicode.com',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        print('[REQ] ${options.method} ${options.uri}');
        handler.next(options);
      },
      onResponse: (response, handler) {
        print('[RES] ${response.statusCode} ${response.requestOptions.path}');
        handler.next(response);
      },
      onError: (error, handler) {
        print('[ERR] ${error.message}');
        handler.next(error);
      },
    ),
  );

  try {
    final response = await dio.get('/posts/1');
    print(response.data);
  } on DioException catch (e) {
    print('请求失败: ${e.message}');
  }
}
```

### 运行方式

```bash
dart pub add dio
dart run main.dart
```

### 预期输出

```text
[REQ] GET https://jsonplaceholder.typicode.com/posts/1
[RES] 200 /posts/1
{id: 1, userId: 1, title: ..., body: ...}
```

这个最小例子的价值在于：**先确认 Dio 的请求、响应、错误链路能跑通，再逐步往里加 Token、重试、业务封装。**

## 🧱 更稳的 Token 刷新实现

前面的实现已经能说明思路，但如果你要上生产，建议把“挂起请求”从 `RequestOptions` 升级为 `Completer<Response>` 队列，这样等待刷新的请求不会丢失回调，也更容易统一 resolve/reject。

```dart
import 'dart:async';
import 'package:dio/dio.dart';

class PendingRequest {
  final RequestOptions options;
  final Completer<Response<dynamic>> completer;

  PendingRequest({required this.options}) : completer = Completer<Response<dynamic>>();
}

class SaferAuthInterceptor extends Interceptor {
  SaferAuthInterceptor(this._dio, this._tokenRepository);

  final Dio _dio;
  final TokenRepository _tokenRepository;
  bool _isRefreshing = false;
  final List<PendingRequest> _queue = [];

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _tokenRepository.accessToken;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401 || err.requestOptions.path == '/auth/refresh') {
      handler.next(err);
      return;
    }

    final pending = PendingRequest(options: err.requestOptions);
    _queue.add(pending);

    if (_isRefreshing) {
      try {
        final response = await pending.completer.future;
        handler.resolve(response);
      } catch (_) {
        handler.next(err);
      }
      return;
    }

    _isRefreshing = true;

    try {
      final newToken = await _refreshToken();
      if (newToken == null) {
        throw Exception('refresh token failed');
      }

      for (final item in _queue) {
        item.options.headers['Authorization'] = 'Bearer $newToken';
        _dio
            .fetch(item.options)
            .then(item.completer.complete)
            .catchError(item.completer.completeError);
      }

      final current = await pending.completer.future;
      handler.resolve(current);
    } catch (e) {
      for (final item in _queue) {
        if (!item.completer.isCompleted) {
          item.completer.completeError(e);
        }
      }
      handler.next(err);
    } finally {
      _queue.clear();
      _isRefreshing = false;
    }
  }

  Future<String?> _refreshToken() async {
    final refreshToken = await _tokenRepository.refreshToken;
    if (refreshToken == null) return null;

    final refreshDio = Dio(BaseOptions(baseUrl: _dio.options.baseUrl));
    final response = await refreshDio.post(
      '/auth/refresh',
      data: {'refresh_token': refreshToken},
      options: Options(headers: {'x-skip-auth': true}),
    );

    final accessToken = response.data['data']['access_token'] as String;
    await _tokenRepository.saveAccessToken(accessToken);
    return accessToken;
  }
}

abstract class TokenRepository {
  Future<String?> get accessToken;
  Future<String?> get refreshToken;
  Future<void> saveAccessToken(String token);
}
```

### 为什么这个版本更稳

| 问题 | 简化版实现 | 改进版实现 |
|------|------------|------------|
| 并发 401 | 只保存 `RequestOptions` | 保存请求 + Future 回调 |
| 等待请求返回 | 可能没有明确回传路径 | 用 `Completer` 显式等待 |
| 刷新失败广播 | 容易漏掉挂起请求 | 队列统一失败通知 |
| 可测试性 | 一般 | 更强 |

## 🧩 常见业务场景补充

### 1. 分页接口统一解析

```dart
class PageResult<T> {
  final List<T> items;
  final int page;
  final int perPage;
  final int total;

  PageResult({
    required this.items,
    required this.page,
    required this.perPage,
    required this.total,
  });

  factory PageResult.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) itemBuilder,
  ) {
    final list = (json['items'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(itemBuilder)
        .toList();

    return PageResult(
      items: list,
      page: json['page'] as int? ?? 1,
      perPage: json['per_page'] as int? ?? 20,
      total: json['total'] as int? ?? 0,
    );
  }
}
```

### 2. 下载接口的错误兜底

```dart
Future<void> safeDownload(Dio dio, String url, String savePath) async {
  try {
    await dio.download(
      url,
      savePath,
      deleteOnError: true,
      onReceiveProgress: (received, total) {
        if (total > 0) {
          final percent = (received / total * 100).toStringAsFixed(1);
          print('下载中: $percent%');
        }
      },
    );
  } on DioException catch (e) {
    throw Exception('下载失败: ${e.message}');
  }
}
```

### 3. 表单接口与 JSON 接口分开处理

```dart
Future<Response<dynamic>> createProduct(
  Dio dio, {
  required String name,
  required int price,
}) {
  return dio.post(
    '/products',
    data: {
      'name': name,
      'price': price,
    },
    options: Options(contentType: Headers.jsonContentType),
  );
}

Future<Response<dynamic>> uploadInvoice(
  Dio dio, {
  required String orderId,
  required String filePath,
}) async {
  final formData = FormData.fromMap({
    'order_id': orderId,
    'file': await MultipartFile.fromFile(filePath),
  });

  return dio.post('/invoices/upload', data: formData);
}
```

---

## 🕳️ 真实踩坑清单

### 1. Dio + `compute` 的 Isolate 问题

```dart
// ❌ 问题：Dio 实例不能跨 Isolate 传递
// compute 函数内部的 Dio 是全新实例，没有拦截器！
final result = await compute(fetchData, dio);  // dio 的拦截器不生效

// ✅ 解决：在 compute 内部重新配置 Dio
Future<Map> fetchData(Dio _) async {
  final dio = Dio(); // 重新配置
  // ...
}
```

### 2. CancelToken 忘记取消导致内存泄漏

```dart
class _PageState extends State<Page> {
  final _cancelToken = CancelToken();

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  // ❌ 遗漏 dispose：页面销毁后请求仍在进行
  // @override
  // void dispose() {
  //   _cancelToken.cancel('页面销毁');
  //   super.dispose();
  // }

  // ✅ 必须在 dispose 中取消
  @override
  void dispose() {
    _cancelToken.cancel('页面已销毁');
    super.dispose();
  }

  Future<void> _loadData() async {
    await api.get('/data', cancelToken: _cancelToken);
  }
}
```

### 3. Content-Type 被覆盖

```dart
// ❌ 错误：FormData 上传时手动设置 Content-Type
Options(contentType: 'application/json')  // 上传文件失败！

// ✅ 正确：Dio 会自动为 FormData 设置 multipart/form-data
// 不要手动设置 contentType
```

### 4. 大文件下载 OOM

```dart
// ❌ 错误：一次性读入内存
final response = await dio.get('/large-file');
final bytes = response.data; // 如果文件 500MB 会 OOM

// ✅ 正确：流式下载
await dio.download(
  '/large-file',
  '/local/path/file.zip',
  onReceiveProgress: (received, total) {
    print('下载进度: ${(received / total * 100).toStringAsFixed(1)}%');
  },
);
```

### 5. Dio 5.x Breaking Changes

```dart
// Dio 4.x → 5.x 迁移常见问题：

// 1. connectTimeout 类型变更
connectTimeout: 15000        // ❌ int 类型不再支持
connectTimeout: Duration(milliseconds: 15000)  // ✅

// 2. 删除了 DefaultHttpClientAdapter
// 3. Interceptor 的 onError 不再是 void，需要 handler.next()
// 4. 删除了 DioError，改名为 DioException
```

---

## 📊 性能优化建议

### 连接池复用

```dart
// Dio 底层使用 HttpClient，天然支持连接池
// 关键：保持同一个 Dio 实例，不要每次请求创建新实例

// ❌ 每次创建新实例 → 每次新建 TCP 连接
final response = await Dio().get('/api/data');

// ✅ 复用实例 → 连接池复用
final response = await _dio.get('/api/data');
```

### 请求去重

```dart
class DedupeInterceptor extends Interceptor {
  final Map<String, Future<Response>> _inflight = {};

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) {
    final key = '${options.method}:${options.uri}';

    if (_inflight.containsKey(key)) {
      // 相同请求正在进行，共享结果
      _inflight[key]!.then((response) {
        handler.resolve(response);
      }).catchError((e) {
        handler.next(options);
      });
      return;
    }

    handler.next(options);
  }
}
```

---

## 🎯 小结

| 场景 | 推荐方案 |
|------|---------|
| 简单 GET 请求 | `http` 包就够了 |
| 需要拦截器/Token刷新 | Dio + 自定义 Interceptor |
| 需要 Mock 测试 | Dio + HttpClientAdapter |
| 大文件上传/下载进度 | Dio 原生支持 |
| 并发请求 Token 刷新 | AuthInterceptor + 锁机制 |

Dio 的核心价值在于**拦截器链**——请求在发出前、响应在返回后都会经过这条链。理解这条链的执行顺序和错误传播机制，是用好 Dio 的关键。

> 💡 **一句话总结：** 用一个 Dio 实例、一套拦截器链、一个 ApiService 封装层，就能覆盖 B2C 项目 90% 的网络请求需求。剩下 10% 的边界情况（幂等、去重、文件断点续传）按需叠加即可。

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录](/categories/DevOps/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Terraform 实战：Laravel 应用基础设施即代码（IaC）— 从手动点 AWS 控制台到代码化部署的踩坑记录](/categories/DevOps/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI/CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
