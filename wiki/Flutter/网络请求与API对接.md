# 网络请求与API对接

## 定义

网络请求与API对接是移动应用开发中的核心环节，指客户端（Flutter应用）与服务器端通过HTTP协议进行数据交互的过程。在Flutter生态中，`Dio` 是最主流的HTTP客户端库，提供了丰富的功能来处理网络请求、响应拦截、错误处理及Token刷新等场景。与后端（如Laravel）的RESTful API对接是常见的全栈开发模式，涉及认证、分页、错误处理等多个层面。

## 核心原理

### 1. Dio HTTP 客户端基础

Dio是一个强大的Dart HTTP客户端库，支持：
- **拦截器（Interceptors）**：在请求发出前和响应返回后进行统一处理
- **请求/响应转换**：自动序列化和反序列化数据
- **取消请求**：支持请求取消和超时控制
- **文件上传/下载**：支持Multipart文件上传和进度回调
- **FormData**：支持表单数据提交

```dart
// Dio 基础配置
final dio = Dio(BaseOptions(
  baseUrl: 'https://api.example.com',
  connectTimeout: Duration(seconds: 10),
  receiveTimeout: Duration(seconds: 10),
  headers: {'Content-Type': 'application/json'},
));
```

### 2. 拦截器机制

拦截器是Dio的核心特性之一，允许在请求生命周期的关键节点插入自定义逻辑：

- **onRequest**：请求发出前，用于添加认证Token、公共参数等
- **onResponse**：响应返回后，用于统一数据格式处理
- **onError**：请求失败时，用于统一错误处理和日志记录

```dart
// 请求拦截器：自动添加Token
dio.interceptors.add(InterceptorsWrapper(
  onRequest: (options, handler) async {
    final token = await StorageService.getToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  },
  onError: (error, handler) async {
    // 统一错误处理
    if (error.response?.statusCode == 401) {
      // Token过期处理
    }
    handler.next(error);
  },
));
```

### 3. Token 刷新机制

Token刷新是移动应用认证中的关键问题，常见方案包括：

- **单次刷新锁**：使用锁机制确保同一时间只有一个刷新请求
- **请求队列**：Token刷新期间，将其他请求排队等待
- **自动重试**：Token刷新成功后，自动重试失败的请求

```dart
// Token刷新拦截器
class TokenInterceptor extends Interceptor {
  final Dio dio;
  bool _isRefreshing = false;
  final List<_RetryRequest> _pendingRequests = [];

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401 && !_isRefreshing) {
      _isRefreshing = true;
      try {
        await _refreshToken();
        // 重试原请求
        final response = await dio.fetch(err.requestOptions);
        handler.resolve(response);
      } catch (e) {
        handler.reject(err);
      } finally {
        _isRefreshing = false;
      }
    } else {
      handler.next(err);
    }
  }
}
```

### 4. 错误处理策略

统一的错误处理是网络请求封装的重要部分：

- **网络错误**：无网络连接、超时等
- **业务错误**：后端返回的业务逻辑错误（如参数校验失败）
- **认证错误**：Token过期、无权限等
- **服务器错误**：500等服务器内部错误

```dart
// 自定义异常类
class ApiException implements Exception {
  final int? code;
  final String message;
  final dynamic data;

  ApiException({this.code, required this.message, this.data});

  factory ApiException.fromDioError(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
        return ApiException(code: -1, message: '连接超时');
      case DioExceptionType.receiveTimeout:
        return ApiException(code: -1, message: '接收超时');
      case DioExceptionType.badResponse:
        return _handleBadResponse(error.response!);
      default:
        return ApiException(code: -1, message: '网络异常');
    }
  }
}
```

### 5. RESTful API 与 Laravel 后端对接

与Laravel后端的RESTful API对接涉及：

- **认证**：使用Laravel Sanctum或Passport进行Token认证
- **分页**：Laravel分页格式与Flutter分页组件的配合
- **CSRF**：Web端需要处理CSRF Token
- **版本控制**：API版本管理（如`/api/v1/`）

```dart
// RESTful API 服务基类
abstract class ApiService {
  final Dio _dio;

  ApiService(this._dio);

  Future<T> get<T>(String path, {Map<String, dynamic>? params}) async {
    final response = await _dio.get(path, queryParameters: params);
    return _parseResponse<T>(response);
  }

  Future<T> post<T>(String path, {dynamic data}) async {
    final response = await _dio.post(path, data: data);
    return _parseResponse<T>(response);
  }

  // ... put, delete 等方法
}
```

## 实战案例

### 实战博客

深入学习网络请求与API对接，推荐阅读以下实战文章：

- **[Flutter 网络请求实战：Dio 封装拦截器错误处理与 Token 刷新踩坑记录](/categories/Flutter/Flutter-网络请求实战-Dio-封装拦截器错误处理与-Token-刷新踩坑记录/)** — 详细记录了Dio封装、拦截器配置、Token刷新机制的实现过程和踩坑经验

- **[Flutter Laravel API 实战：RESTful 对接认证分页错误处理](/categories/Flutter/Flutter-Laravel-API-实战-RESTful-对接-认证-分页-错误处理/)** — 完整演示了Flutter与Laravel后端RESTful API对接的全流程，包括认证、分页、错误处理等

### 典型应用场景

1. **用户认证流程**：登录 → 获取Token → 自动刷新Token → 登出
2. **分页列表加载**：下拉刷新 + 上拉加载更多，配合Laravel的`paginate()`
3. **文件上传**：头像上传、图片上传等场景
4. **WebSocket实时通信**：配合Laravel Echo进行实时消息推送

## 相关概念

- **[本地存储方案](./本地存储方案.md)** — Token和缓存数据的本地持久化存储
- **[状态管理](./状态管理.md)** — 网络请求结果的状态管理与UI更新
- **[响应式布局](./响应式布局.md)** — 不同屏幕尺寸下的网络请求优化策略
- **[异步编程](./异步编程.md)** — Dart异步编程与Future/Stream在请求中的应用

## 常见问题

### Q1: Token刷新时其他请求怎么办？
使用请求队列机制：Token刷新期间，将所有携带过期Token的请求加入队列，刷新成功后依次重试。

### Q2: 如何处理并发请求的Token刷新？
使用锁机制（如`Completer`）确保同一时间只有一个刷新请求在进行，其他请求等待刷新结果。

### Q3: Dio和http包如何选择？
Dio功能更丰富（拦截器、取消请求、FormData等），推荐用于复杂场景；`http`包更轻量，适合简单场景。

### Q4: 如何处理网络断开重连？
监听网络状态变化（使用`connectivity_plus`包），网络恢复后自动重试失败的请求。

### Q5: Laravel分页数据如何在Flutter中处理？
Laravel返回的分页数据格式为`{data: [], current_page, last_page, ...}`，在Flutter中可配合`ListView.builder`实现无限滚动加载。

### Q6: 如何避免重复请求？
使用请求标识和去重机制，或利用Dio的`CancelToken`取消重复请求。
