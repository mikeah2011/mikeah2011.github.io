---
title: Flutter + Laravel API 实战：RESTful 对接、认证、分页、错误处理
date: 2026-06-02 10:00:00
tags: [Flutter, Laravel, RESTful, API, Dio, Freezed]
keywords: [Flutter, Laravel API, RESTful, 对接, 认证, 分页, 错误处理, 移动端]
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: 本文系统讲解 Flutter Laravel API 项目中的 RESTful 对接实践，覆盖 Dio 封装、认证鉴权、Token 刷新、分页加载、错误处理与接口建模，帮助你搭建稳定可维护的前后端协作方案。
---


在移动端项目里，Flutter 负责界面与交互，Laravel 负责业务接口与后台管理，是一种非常常见、也非常实用的技术组合。很多团队刚开始做 Flutter + Laravel 对接时，往往以为“只要接口能通就行”，结果真正进入开发阶段后，很快就会遇到一连串问题：接口字段不统一、列表分页不稳定、登录态频繁失效、错误提示无法复用、Loading 满天飞、网络抖动后页面状态混乱、离线场景体验差，最后导致客户端和服务端都在互相“背锅”。

这篇文章不讲空泛概念，而是从一套真实项目的实战视角出发，完整梳理 Flutter 与 Laravel API 协作时最容易遇到、也最值得提前设计好的几个关键点：Laravel 端如何设计 Resource 和返回结构，Flutter 端如何基于 Dio 做统一封装，Token 认证应该怎样选择 Sanctum 或 Passport，分页加载如何在 cursor 和 offset 之间权衡，错误码如何统一处理，Loading 状态怎么管理，离线缓存如何落地，以及项目推进中踩过的坑和对应的规避方案。

如果你正在做一个前后端分离的 App，后端使用 Laravel，客户端使用 Flutter，希望把“能跑”的接口对接提升为“可维护、可扩展、可排障”的工程化方案，这篇文章会比较适合你。

## 一、为什么 Flutter + Laravel 是一套高性价比组合

Flutter 的优势在于一套代码覆盖多端、UI 表现力强、开发效率高；Laravel 的优势在于生态成熟、ORM 友好、权限与验证体系完整、开发体验非常顺手。对于中小型业务、内容型应用、电商、会员系统、工具类产品，这套组合非常容易快速搭建起一条完整链路。

但也正因为两边都“上手快”，很多项目在早期容易忽略协议层设计。常见现象包括：

1. 后端接口虽然是 RESTful 路由，但实际返回格式完全不统一。
2. 同一个错误在不同接口里 message 和 code 结构不同。
3. Flutter 页面直接拼接 URL、直接调用 Dio、直接在 Widget 里写解析逻辑。
4. 登录接口返回 token，刷新页面后 token 存储和 Header 注入又是另一套逻辑。
5. 分页列表第一页正常，加载更多时数据重复、漏数据或者无法判断是否到底。
6. 接口慢一点时，页面出现多个叠层 Loading，用户体验很差。
7. 弱网或断网状态没有降级策略，用户只能反复重试。

这些问题并不难解决，难的是很多团队在项目后期才意识到需要统一，届时改动成本已经非常高。所以比较理想的做法是：在项目开始阶段，就把“接口契约”和“客户端网络层”作为基础设施来建设。

## 二、Laravel API Resource 设计：先统一协议，再谈客户端封装

Flutter 对接 Laravel 时，最核心的一条原则是：**不要让客户端去猜接口结构**。客户端要做的是消费接口，而不是推理接口。为了做到这一点，Laravel 端首先要把 API 的输出格式尽可能标准化。

### 2.1 RESTful 路由只是入口，真正关键是返回结构

很多人以为用了 `Route::apiResource()` 就算 RESTful 了，实际上那只是路由风格统一。真正决定客户端开发体验的是返回的数据结构、字段命名、状态码语义和分页元信息是否一致。

例如一个文章列表接口，不建议直接返回 Eloquent 集合原始结构，而是建议通过 Resource 包一层：

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('posts', PostController::class);
});
```

```php
// app/Http/Resources/PostResource.php
class PostResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'summary' => $this->summary,
            'content' => $this->content,
            'cover_url' => $this->cover_url,
            'author' => [
                'id' => $this->author?->id,
                'name' => $this->author?->name,
            ],
            'created_at' => $this->created_at?->toDateTimeString(),
            'updated_at' => $this->updated_at?->toDateTimeString(),
        ];
    }
}
```

这样做有几个直接收益：

- 对外暴露字段是受控的，不会把内部字段无意透出。
- 后端即使调整数据库结构，也能尽量保持 API 返回稳定。
- Flutter 端的 Model 解析不需要兼容一堆历史字段。
- 关联字段可以在 Resource 内部被整理成更适合客户端消费的格式。

### 2.2 统一响应包裹结构

最常见的问题之一，就是有些接口返回：

```json
{"data": {...}}
```

有些接口返回：

```json
{"message": "success", "result": {...}}
```

还有些接口干脆直接返回数组。客户端只能不断做特判。建议 Laravel 统一成以下风格：

```json
{
  "success": true,
  "message": "获取成功",
  "data": {...},
  "meta": {...}
}
```

失败时：

```json
{
  "success": false,
  "message": "参数校验失败",
  "error_code": "VALIDATION_ERROR",
  "errors": {
    "email": ["邮箱格式不正确"]
  }
}
```

你可以在 Laravel 中封装一个统一的响应 Trait 或基类控制器：

```php
trait ApiResponse
{
    protected function success($data = null, string $message = 'success', array $meta = [], int $status = 200)
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => $data,
            'meta' => (object) $meta,
        ], $status);
    }

    protected function error(string $message = 'error', string $errorCode = 'UNKNOWN_ERROR', $errors = null, int $status = 400)
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'error_code' => $errorCode,
            'errors' => $errors,
        ], $status);
    }
}
```

这一步看起来普通，实际上对 Flutter 端价值极大，因为客户端可以围绕 `success / message / data / meta / error_code / errors` 建立统一解析逻辑。

### 2.3 Resource Collection 与分页元数据

如果列表接口需要分页，不要只返回数据数组，应该把分页信息一起明确返回。Laravel 本身分页器会带很多字段，但直接原样给客户端有时过于冗余，建议二次整理。

例如 offset 分页：

```php
public function index(Request $request)
{
    $perPage = min((int) $request->get('per_page', 20), 50);
    $posts = Post::query()
        ->latest()
        ->paginate($perPage);

    return $this->success(
        PostResource::collection($posts->items()),
        '获取成功',
        [
            'pagination' => [
                'current_page' => $posts->currentPage(),
                'per_page' => $posts->perPage(),
                'total' => $posts->total(),
                'last_page' => $posts->lastPage(),
                'has_more' => $posts->hasMorePages(),
            ]
        ]
    );
}
```

如果是 cursor 分页：

```php
public function index(Request $request)
{
    $perPage = min((int) $request->get('per_page', 20), 50);
    $posts = Post::query()
        ->orderByDesc('id')
        ->cursorPaginate($perPage);

    return $this->success(
        PostResource::collection($posts->items()),
        '获取成功',
        [
            'pagination' => [
                'per_page' => $perPage,
                'next_cursor' => optional($posts->nextCursor())->encode(),
                'prev_cursor' => optional($posts->previousCursor())->encode(),
                'has_more' => $posts->hasMorePages(),
            ]
        ]
    );
}
```

Flutter 端只要认准 `meta.pagination` 就可以了，不需要理解 Laravel 分页器内部所有原始字段。

### 2.4 字段命名要尽量稳定

客户端最怕的不是字段多，而是字段今天叫 `avatar`，明天叫 `avatar_url`，后天又变成 `headimg`。建议一开始就定好命名规范：

- 接口字段统一使用 snake_case，Flutter Model 再映射为 camelCase。
- 时间字段统一使用 `created_at`、`updated_at`、`deleted_at`。
- 图片类字段统一后缀 `_url`。
- 布尔值统一使用 `is_`、`has_` 前缀或者干脆自然语义，但必须一致。

稳定的命名会显著降低 Flutter 端 `fromJson` 的复杂度。

## 三、Laravel 认证方案：Sanctum 还是 Passport

Flutter App 对接 Laravel 时，最常见的是 Token 认证。Laravel 里大家最常比较的是 Sanctum 和 Passport。

### 3.1 Sanctum 适合大多数自有 App

如果你的场景是“自家 Flutter App 对接自家 Laravel API”，通常优先推荐 Sanctum。原因很简单：

- 配置相对轻量。
- 使用 Personal Access Token 简洁直接。
- 不需要完整 OAuth2 体系。
- 对移动端来说已经足够实用。

登录接口示例：

```php
public function login(LoginRequest $request)
{
    if (!Auth::attempt($request->only('email', 'password'))) {
        return $this->error('账号或密码错误', 'AUTH_INVALID_CREDENTIALS', null, 401);
    }

    $user = $request->user();
    $token = $user->createToken('flutter-app')->plainTextToken;

    return $this->success([
        'token' => $token,
        'token_type' => 'Bearer',
        'user' => new UserResource($user),
    ], '登录成功');
}
```

退出登录：

```php
public function logout(Request $request)
{
    $request->user()->currentAccessToken()?->delete();
    return $this->success(null, '退出成功');
}
```

对于多数业务系统，这一套已经很够用。

### 3.2 Passport 适合更复杂的授权体系

如果你有第三方接入、多个客户端、OAuth2 授权码模式、刷新令牌、细粒度授权范围等复杂需求，那么 Passport 更合适。但它的成本也更高：

- 配置更复杂。
- 理解门槛更高。
- 客户端认证流程也更长。

如果只是做一个 Flutter App，不要为了“看起来专业”而强上 Passport。架构选型不是功能越多越好，而是越匹配越好。

### 3.3 Token 生命周期怎么设计

实战中另一个高频问题是：token 要不要过期？多久过期？要不要 refresh token？

一个比较务实的策略是：

1. 自有业务 App + 中低安全场景：Sanctum 长期 token，服务端支持主动失效即可。
2. 中高安全场景：短期 access token + refresh token 机制。
3. 多终端登录：服务端记录 token 设备信息，支持按设备注销。

如果项目初期还在快速迭代，不建议先上过于复杂的刷新机制。最容易落地的是先让登录、退出、401 处理闭环跑通，再逐步引入 refresh token。

## 四、Flutter Dio 封装：不要在页面里直接请求接口

Flutter 端最忌讳的一种写法，是在 Widget 的 `initState`、按钮点击或者 Provider/Bloc 里直接到处写：

```dart
final response = await Dio().get('https://example.com/api/posts');
```

这种方式看似快，实际上会带来几个问题：

- Base URL、超时、Header 注入分散在各处。
- 错误处理无法统一。
- 日志、重试、认证失效拦截难以收敛。
- 页面层和网络层耦合太重。

所以比较推荐的结构是：

- `ApiClient`：负责 Dio 初始化与通用拦截。
- `ApiService`：按业务模块组织接口。
- `Repository`：把网络数据转换成业务实体，并结合缓存策略。
- `Controller/ViewModel/Bloc`：只负责状态和交互。

### 4.1 封装基础 Dio Client

```dart
class ApiClient {
  late final Dio dio;
  final TokenStorage tokenStorage;

  ApiClient(this.tokenStorage) {
    dio = Dio(
      BaseOptions(
        baseUrl: 'https://api.example.com/api',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await tokenStorage.getToken();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          handler.next(response);
        },
        onError: (error, handler) async {
          handler.next(error);
        },
      ),
    );
  }
}
```

如果你已经进入正式项目阶段，这里建议继续往前走一步：把鉴权头注入、日志、设备信息、401 拦截和请求追踪一次性收口到同一个 Client 中。下面是一份更接近生产环境的 Dio 初始化示例：

```dart
class ApiClient {
  ApiClient({
    required this.tokenStorage,
    required this.authRepository,
  }) {
    dio = Dio(_options())
      ..interceptors.addAll([
        QueuedInterceptorsWrapper(
          onRequest: _onRequest,
          onError: _onError,
        ),
        if (kDebugMode)
          LogInterceptor(
            requestBody: true,
            responseBody: true,
          ),
      ]);
  }

  late final Dio dio;
  final TokenStorage tokenStorage;
  final AuthRepository authRepository;

  BaseOptions _options() => BaseOptions(
        baseUrl: 'https://api.example.com/api',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        headers: const {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Client-Platform': 'flutter',
          'X-App-Version': '1.0.0',
        },
      );

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await tokenStorage.getAccessToken();
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }

    options.headers['X-Request-Id'] = const Uuid().v4();
    handler.next(options);
  }

  Future<void> _onError(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    if (error.response?.statusCode != 401 ||
        error.requestOptions.path.contains('/auth/refresh')) {
      handler.next(error);
      return;
    }

    final refreshed = await authRepository.tryRefreshToken();
    if (!refreshed) {
      await tokenStorage.clear();
      handler.next(error);
      return;
    }

    final cloned = await _retry(error.requestOptions);
    handler.resolve(cloned);
  }

  Future<Response<dynamic>> _retry(RequestOptions requestOptions) async {
    return dio.fetch<dynamic>(
      requestOptions.copyWith(
        headers: {
          ...requestOptions.headers,
          'Authorization': 'Bearer ${await tokenStorage.getAccessToken()}',
        },
      ),
    );
  }
}
```

这类完整封装有几个好处：

- 页面层不需要知道 Header 是何时注入的；
- 鉴权头、请求 ID、App 版本等横切逻辑只维护一份；
- 后续接入 refresh token、埋点、A/B 实验、灰度 Header 时，不会满项目散落修改；
- 通过 `QueuedInterceptorsWrapper` 可以显式控制串行化处理，减少并发刷新时的竞态问题。

这还只是最基础的一层。真正的关键在于：**把返回值和异常都包装成统一模型**。

### 4.2 统一响应模型

可以定义一个通用的接口响应对象：

```dart
class ApiResponse<T> {
  final bool success;
  final String message;
  final T? data;
  final Map<String, dynamic>? meta;
  final String? errorCode;
  final dynamic errors;

  ApiResponse({
    required this.success,
    required this.message,
    this.data,
    this.meta,
    this.errorCode,
    this.errors,
  });

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic json)? fromJsonT,
  ) {
    return ApiResponse<T>(
      success: json['success'] == true,
      message: json['message']?.toString() ?? '',
      data: fromJsonT != null && json['data'] != null
          ? fromJsonT(json['data'])
          : json['data'],
      meta: json['meta'] is Map<String, dynamic>
          ? json['meta'] as Map<String, dynamic>
          : null,
      errorCode: json['error_code']?.toString(),
      errors: json['errors'],
    );
  }
}
```

配合一个统一异常对象：

```dart
class ApiException implements Exception {
  final int? statusCode;
  final String message;
  final String? errorCode;
  final dynamic errors;

  ApiException({
    this.statusCode,
    required this.message,
    this.errorCode,
    this.errors,
  });

  @override
  String toString() => 'ApiException($statusCode, $message, $errorCode)';
}
```

### 4.3 请求方法二次封装

```dart
class NetworkService {
  final Dio dio;

  NetworkService(this.dio);

  Future<ApiResponse<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? parser,
  }) async {
    try {
      final response = await dio.get(path, queryParameters: queryParameters);
      return _handleResponse(response, parser);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  Future<ApiResponse<T>> post<T>(
    String path, {
    dynamic data,
    T Function(dynamic json)? parser,
  }) async {
    try {
      final response = await dio.post(path, data: data);
      return _handleResponse(response, parser);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  ApiResponse<T> _handleResponse<T>(
    Response response,
    T Function(dynamic json)? parser,
  ) {
    final json = response.data as Map<String, dynamic>;
    final apiResponse = ApiResponse<T>.fromJson(json, parser);
    if (!apiResponse.success) {
      throw ApiException(
        statusCode: response.statusCode,
        message: apiResponse.message,
        errorCode: apiResponse.errorCode,
        errors: apiResponse.errors,
      );
    }
    return apiResponse;
  }

  ApiException _mapDioException(DioException e) {
    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      return ApiException(
        statusCode: e.response?.statusCode,
        message: data['message']?.toString() ?? '请求失败',
        errorCode: data['error_code']?.toString(),
        errors: data['errors'],
      );
    }

    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return ApiException(message: '网络请求超时，请稍后重试');
      case DioExceptionType.connectionError:
        return ApiException(message: '网络连接失败，请检查网络');
      case DioExceptionType.cancel:
        return ApiException(message: '请求已取消');
      default:
        return ApiException(
          statusCode: e.response?.statusCode,
          message: '服务异常，请稍后重试',
        );
    }
  }
}
```

到这里，页面层基本已经不用直接关心 Dio 的细节，而是统一接收成功数据或统一格式的 `ApiException`。

## 五、业务接口组织：Service + Repository 的分层更稳

假设我们有文章列表、文章详情、登录接口，比较清晰的组织方式如下：

```dart
class AuthService {
  final NetworkService network;

  AuthService(this.network);

  Future<LoginResult> login(String email, String password) async {
    final response = await network.post<LoginResult>(
      '/login',
      data: {
        'email': email,
        'password': password,
      },
      parser: (json) => LoginResult.fromJson(json),
    );
    return response.data!;
  }
}
```

```dart
class PostService {
  final NetworkService network;

  PostService(this.network);

  Future<PostPageResponse> getPosts({
    int page = 1,
    int perPage = 20,
  }) async {
    final response = await network.get<PostPageResponse>(
      '/posts',
      queryParameters: {
        'page': page,
        'per_page': perPage,
      },
      parser: (json) => PostPageResponse.fromEnvelope(json, responseMeta: null),
    );
    return PostPageResponse.fromApiResponse(response);
  }
}
```

实际项目里，很多人会问：为什么还需要 Repository？因为 Service 更偏向“接口调用器”，而 Repository 更偏向“数据协调层”。比如：

- 先读本地缓存，再请求网络。
- 请求成功后落库。
- 合并多个接口结果。
- 把 DTO 转为页面更适合的实体。

例如：

```dart
class PostRepository {
  final PostService service;
  final PostCache cache;

  PostRepository(this.service, this.cache);

  Future<List<Post>> getFirstPage() async {
    try {
      final pageData = await service.getPosts(page: 1);
      await cache.savePosts(pageData.items);
      return pageData.items;
    } catch (e) {
      final local = await cache.getPosts();
      if (local.isNotEmpty) return local;
      rethrow;
    }
  }
}
```

这层分离会让你的 Flutter 项目在后期维护时轻松很多。

## 六、Token 认证在 Flutter 端如何落地

服务端返回 token 只是第一步，客户端真正要解决的是：存、读、注入、失效处理、退出时清理。

### 6.1 Token 存储建议

敏感数据建议优先使用：

- `flutter_secure_storage`：适合 token、refresh token。
- `shared_preferences`：适合非敏感轻量配置。

不要把 token 和普通缓存数据混在一起，最好单独抽一个 `TokenStorage`：

```dart
class TokenStorage {
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  static const _tokenKey = 'access_token';

  Future<void> saveToken(String token) async {
    await storage.write(key: _tokenKey, value: token);
  }

  Future<String?> getToken() async {
    return storage.read(key: _tokenKey);
  }

  Future<void> clearToken() async {
    await storage.delete(key: _tokenKey);
  }
}
```

### 6.2 登录成功后的处理流程

一个完整的登录成功流程通常包括：

1. 调用登录接口。
2. 保存 token。
3. 保存用户信息。
4. 更新内存态登录状态。
5. 跳转首页。

很多项目出问题，是因为只做了第 1 步和第 5 步。页面跳转成功了，但 App 冷启动后发现没有恢复登录态，或者 Header 注入晚于首屏请求，导致首页一进来就 401。

所以推荐在 App 启动时做统一初始化：

- 先读取本地 token。
- 再构建网络层。
- 最后再决定进入登录页还是主页。

### 6.3 401 统一拦截

如果 token 失效，不应该每个页面都自己判断一次 401，而是交给拦截器统一处理。

```dart
onError: (error, handler) async {
  if (error.response?.statusCode == 401) {
    await tokenStorage.clearToken();
    eventBus.fire(SessionExpiredEvent());
  }
  handler.next(error);
}
```

然后在全局监听登录失效事件，跳回登录页，并给出统一提示，例如“登录已过期，请重新登录”。

### 6.4 要不要自动刷新 Token

如果你的 Laravel 使用 Passport 或自定义 refresh token，那么 Flutter 端可以在 401 时尝试静默刷新，再重放原请求。但这件事在工程上并不简单，主要难点在于：

- 多个请求同时 401 时要避免并发刷新。
- 刷新失败要防止死循环。
- 原请求重放要保证幂等性。

如果当前项目还没有强需求，先把“401 清理登录态 + 跳登录页”做好，通常比仓促上刷新机制更稳。

如果你已经确定 Laravel 端提供了 refresh token 或刷新接口，那么 Flutter 端最好把“静默刷新 + 原请求重放 + 并发闸门”一次性设计完整，而不是在拦截器里临时拼逻辑。下面是一套可直接落地的思路：

```dart
class AuthRepository {
  AuthRepository({
    required this.dio,
    required this.tokenStorage,
  });

  final Dio dio;
  final TokenStorage tokenStorage;

  Completer<bool>? _refreshCompleter;

  Future<bool> tryRefreshToken() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }

    _refreshCompleter = Completer<bool>();

    try {
      final refreshToken = await tokenStorage.getRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        _refreshCompleter!.complete(false);
        return false;
      }

      final response = await dio.post(
        '/auth/refresh',
        data: {'refresh_token': refreshToken},
        options: Options(
          headers: {'Authorization': null},
        ),
      );

      final data = response.data['data'] as Map<String, dynamic>;
      await tokenStorage.saveTokens(
        accessToken: data['access_token'] as String,
        refreshToken: data['refresh_token'] as String,
      );

      _refreshCompleter!.complete(true);
      return true;
    } on DioException {
      await tokenStorage.clear();
      _refreshCompleter!.complete(false);
      return false;
    } finally {
      _refreshCompleter = null;
    }
  }
}
```

`TokenStorage` 也要同步升级，不再只存一个 access token：

```dart
class TokenStorage {
  const TokenStorage(this.storage);

  final FlutterSecureStorage storage;

  static const _accessTokenKey = 'access_token';
  static const _refreshTokenKey = 'refresh_token';

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await Future.wait([
      storage.write(key: _accessTokenKey, value: accessToken),
      storage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<String?> getAccessToken() => storage.read(key: _accessTokenKey);

  Future<String?> getRefreshToken() => storage.read(key: _refreshTokenKey);

  Future<void> clear() async {
    await Future.wait([
      storage.delete(key: _accessTokenKey),
      storage.delete(key: _refreshTokenKey),
    ]);
  }
}
```

实现时尤其要注意三点：

1. **刷新接口本身不能再走普通 401 重试逻辑**，否则会递归死循环；
2. **多个请求同时 401 时必须共用同一个 refresh Future**，否则会并发刷新并互相覆盖 token；
3. **重放请求前要确认请求是否可重复提交**，例如支付、创建订单这类接口要特别谨慎。

## 七、分页加载：offset 与 cursor 如何选择

分页是内容型 App、订单列表、消息列表、商品列表最常见的需求之一。看起来只是“加载更多”，实际上很容易踩坑。

### 7.1 offset 分页：简单直观，适合常规后台列表

offset 分页就是大家最熟悉的 `page + per_page` 或者 `offset + limit`。优点是：

- 理解成本低。
- Flutter 端实现简单。
- 支持跳页和页码展示。
- 适合数据变化不剧烈的管理类列表。

缺点是：

- 当数据频繁新增或删除时，翻页可能出现重复和漏项。
- 深分页性能往往不如 cursor。

如果你的场景是后台管理列表、稳定的资讯列表，offset 分页完全够用。

### 7.2 cursor 分页：更适合移动端无限滚动

cursor 分页的核心思想不是“你在第几页”，而是“从某个位置之后继续取”。这种方式在动态数据场景下更稳定。

优点包括：

- 更适合无限下拉加载。
- 大数据量下性能更好。
- 新增数据时，后续翻页不容易错位。

缺点是：

- 不适合直接跳到任意页。
- 前后端都要更严格地保证排序字段稳定。
- 调试时不如 page 模式直观。

如果你的 App 是信息流、评论流、消息流，通常更推荐 cursor 分页。

### 7.3 Flutter 端分页状态建模

不管 offset 还是 cursor，页面都不应该只用一个 `List<T>` 加一个 `bool isLoading` 就完事。更完整的分页状态至少应该包括：

- 当前数据列表 `items`
- 是否首次加载 `isInitialLoading`
- 是否正在加载更多 `isLoadingMore`
- 是否刷新中 `isRefreshing`
- 是否还有更多 `hasMore`
- 当前页码或 nextCursor
- 是否首屏出错 `initialError`
- 是否加载更多出错 `loadMoreError`

例如：

```dart
class PaginationState<T> {
  final List<T> items;
  final bool isInitialLoading;
  final bool isLoadingMore;
  final bool isRefreshing;
  final bool hasMore;
  final int page;
  final String? nextCursor;
  final String? error;

  const PaginationState({
    this.items = const [],
    this.isInitialLoading = false,
    this.isLoadingMore = false,
    this.isRefreshing = false,
    this.hasMore = true,
    this.page = 1,
    this.nextCursor,
    this.error,
  });
}
```

### 7.4 offset 分页加载逻辑

```dart
Future<void> loadMore() async {
  if (state.isLoadingMore || !state.hasMore) return;

  state = state.copyWith(isLoadingMore: true);
  try {
    final result = await repository.getPosts(page: state.page + 1);
    state = state.copyWith(
      items: [...state.items, ...result.items],
      page: state.page + 1,
      hasMore: result.hasMore,
      isLoadingMore: false,
    );
  } catch (e) {
    state = state.copyWith(
      isLoadingMore: false,
      error: e.toString(),
    );
  }
}
```

这里最关键的一点是：**防重入**。如果用户快速滚动到底部，多次触发加载更多，必须防止并发请求，不然很容易出现重复数据。

### 7.5 cursor 分页加载逻辑

```dart
Future<void> loadMore() async {
  if (state.isLoadingMore || !state.hasMore) return;

  state = state.copyWith(isLoadingMore: true);
  try {
    final result = await repository.getPostsByCursor(cursor: state.nextCursor);
    state = state.copyWith(
      items: [...state.items, ...result.items],
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      isLoadingMore: false,
    );
  } catch (e) {
    state = state.copyWith(
      isLoadingMore: false,
      error: e.toString(),
    );
  }
}
```

cursor 分页里，前后端约定必须非常清楚：

- 排序字段必须固定，比如 `id desc` 或 `created_at desc, id desc`。
- 不能前端传一个排序、后端再动态改排序。
- 不能一会按时间，一会按热度，否则 cursor 失去意义。

如果你希望把“分页状态”和“分页 UI”彻底收敛，推荐再补上一层通用分页组件。这样首屏 loading、加载更多 loading、底部错误重试、空态都可以复用：

```dart
class PaginationListView<T> extends StatelessWidget {
  const PaginationListView({
    super.key,
    required this.state,
    required this.itemBuilder,
    required this.onRefresh,
    required this.onLoadMore,
    this.padding = const EdgeInsets.symmetric(vertical: 8),
  });

  final PaginationState<T> state;
  final Widget Function(BuildContext context, T item, int index) itemBuilder;
  final Future<void> Function() onRefresh;
  final VoidCallback onLoadMore;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    if (state.isInitialLoading && state.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.error!),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: onLoadMore,
              child: const Text('重新加载'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: NotificationListener<ScrollNotification>(
        onNotification: (notification) {
          if (notification.metrics.pixels >=
                  notification.metrics.maxScrollExtent - 160 &&
              !state.isLoadingMore &&
              state.hasMore) {
            onLoadMore();
          }
          return false;
        },
        child: ListView.separated(
          padding: padding,
          itemCount: state.items.length + 1,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, index) {
            if (index == state.items.length) {
              if (state.isLoadingMore) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()),
                );
              }

              if (!state.hasMore) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: Text('没有更多了')),
                );
              }

              return const SizedBox.shrink();
            }

            return itemBuilder(context, state.items[index], index);
          },
        ),
      ),
    );
  }
}
```

它的价值在于：

- 分页交互逻辑不需要每个页面都重复实现；
- 加载更多触发阈值、底部状态、空态文案可以统一；
- 后续你切换 Riverpod、Bloc、GetX，本质上只需要替换状态来源，不用重写 UI 骨架。

## 八、错误码统一处理：真正减少页面层样板代码的关键

很多 Flutter 项目会统一封装 Dio，但最后还是在页面层写大量这样的代码：

```dart
try {
  await xxx();
} catch (e) {
  if (e.toString().contains('401')) {
    // ...
  } else if (e.toString().contains('422')) {
    // ...
  }
}
```

这是不对的。错误处理能不能工程化，关键取决于后端有没有给出稳定的错误语义，以及客户端有没有做错误映射。

### 8.1 HTTP 状态码与业务错误码要分层

建议分成两层：

1. **HTTP 状态码**：用于表示请求整体结果，比如 200、401、403、404、422、500。
2. **业务错误码 `error_code`**：用于表示具体业务含义，比如 `AUTH_INVALID_CREDENTIALS`、`INSUFFICIENT_STOCK`、`PROFILE_INCOMPLETE`。

例如：

- 401：登录失效
- 422 + `VALIDATION_ERROR`：参数校验失败
- 403 + `PERMISSION_DENIED`：权限不足
- 409 + `RESOURCE_CONFLICT`：资源冲突
- 429 + `TOO_MANY_REQUESTS`：请求过频

Flutter 页面只看 HTTP 状态码往往不够，真正决定文案和交互的是业务错误码。

### 8.2 Flutter 端错误映射层

```dart
class ErrorMapper {
  static String map(ApiException e) {
    switch (e.errorCode) {
      case 'AUTH_INVALID_CREDENTIALS':
        return '账号或密码错误';
      case 'VALIDATION_ERROR':
        return '请检查输入内容';
      case 'PERMISSION_DENIED':
        return '您暂无权限执行此操作';
      case 'RESOURCE_NOT_FOUND':
        return '请求的内容不存在或已删除';
    }

    switch (e.statusCode) {
      case 401:
        return '登录已过期，请重新登录';
      case 403:
        return '访问被拒绝';
      case 404:
        return '接口不存在';
      case 422:
        return '提交数据有误';
      case 500:
        return '服务器开小差了，请稍后再试';
      default:
        return e.message.isNotEmpty ? e.message : '请求失败';
    }
  }
}
```

这样页面层就可以简化为：

```dart
catch (e) {
  if (e is ApiException) {
    showToast(ErrorMapper.map(e));
  } else {
    showToast('发生未知错误');
  }
}
```

### 8.3 422 表单错误要支持字段级展示

在登录、注册、资料编辑场景中，后端如果返回：

```json
{
  "success": false,
  "message": "参数校验失败",
  "error_code": "VALIDATION_ERROR",
  "errors": {
    "email": ["邮箱不能为空"],
    "password": ["密码至少8位"]
  }
}
```

Flutter 端不要只弹一个 Toast，而是应该尽量把字段错误映射到表单项上。用户体验会好很多。

### 8.4 不要把所有异常都 toast 掉

错误处理还有一个常见误区：任何错误都弹 Toast。正确做法应该区分场景：

- 首屏加载失败：展示错误占位页 + 重试按钮。
- 加载更多失败：列表底部展示“加载失败，点击重试”。
- 表单提交失败：字段级提示或按钮附近提示。
- 全局登录失效：统一跳登录页。
- 瞬时提示：再使用 Toast/SnackBar。

如果全靠 Toast，用户往往都来不及理解发生了什么。

如果项目已经进入多人协作阶段，建议再把异常从 `Exception` 升级成更强类型的失败模型。Dart 3 的 sealed class 或者 Either 风格都很适合做这一层。比如：

```dart
sealed class Failure {
  const Failure();
}

class NetworkFailure extends Failure {
  const NetworkFailure(this.message);
  final String message;
}

class AuthFailure extends Failure {
  const AuthFailure(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
}

class ValidationFailure extends Failure {
  const ValidationFailure(this.message, this.fieldErrors);
  final String message;
  final Map<String, List<String>> fieldErrors;
}

class ServerFailure extends Failure {
  const ServerFailure(this.message);
  final String message;
}

typedef Result<T> = Either<Failure, T>;

Failure mapExceptionToFailure(ApiException e) {
  if (e.statusCode == 401) {
    return AuthFailure('登录已过期，请重新登录', statusCode: e.statusCode);
  }

  if (e.statusCode == 422 && e.errors is Map<String, dynamic>) {
    final raw = e.errors as Map<String, dynamic>;
    return ValidationFailure(
      e.message,
      raw.map(
        (key, value) => MapEntry(
          key,
          (value as List).map((item) => item.toString()).toList(),
        ),
      ),
    );
  }

  if (e.statusCode != null && e.statusCode! >= 500) {
    return ServerFailure('服务器异常，请稍后重试');
  }

  return NetworkFailure(e.message);
}
```

Repository 层再统一返回 `Either`：

```dart
class PostRepository {
  const PostRepository(this.service);

  final PostService service;

  Future<Result<List<Post>>> getFirstPage() async {
    try {
      final response = await service.getPosts(page: 1);
      return Right(response.items);
    } on ApiException catch (e) {
      return Left(mapExceptionToFailure(e));
    } catch (_) {
      return const Left(ServerFailure('发生未知异常'));
    }
  }
}
```

这样页面层就不再依赖 `try-catch + runtimeType` 猜测，而是可以显式分发：表单错误走字段提示、鉴权错误走登录态清理、网络错误走重试 UI、服务端错误走统一兜底。

再往前一步，如果你已经在用 `freezed` 和 `json_serializable`，连通用响应模型都可以代码生成，减少手写解析和可空字段错误：

```dart
@Freezed(genericArgumentFactories: true)
class ApiEnvelope<T> with _$ApiEnvelope<T> {
  const factory ApiEnvelope({
    required bool success,
    required String message,
    T? data,
    Map<String, dynamic>? meta,
    @JsonKey(name: 'error_code') String? errorCode,
    Map<String, dynamic>? errors,
  }) = _ApiEnvelope<T>;

  factory ApiEnvelope.fromJson(
    Map<String, dynamic> json,
    T Function(Object?) fromJsonT,
  ) => _$ApiEnvelopeFromJson(json, fromJsonT);
}

@freezed
class PaginationMeta with _$PaginationMeta {
  const factory PaginationMeta({
    @JsonKey(name: 'current_page') int? currentPage,
    @JsonKey(name: 'per_page') int? perPage,
    int? total,
    @JsonKey(name: 'last_page') int? lastPage,
    @JsonKey(name: 'next_cursor') String? nextCursor,
    @JsonKey(name: 'has_more') @Default(false) bool hasMore,
  }) = _PaginationMeta;

  factory PaginationMeta.fromJson(Map<String, dynamic> json) =>
      _$PaginationMetaFromJson(json);
}

@freezed
class PostDto with _$PostDto {
  const factory PostDto({
    required int id,
    required String title,
    String? summary,
    @JsonKey(name: 'cover_url') String? coverUrl,
    @JsonKey(name: 'created_at') String? createdAt,
  }) = _PostDto;

  factory PostDto.fromJson(Map<String, dynamic> json) =>
      _$PostDtoFromJson(json);
}
```

对应生成命令：

```bash
dart run build_runner build --delete-conflicting-outputs
```

这套方式特别适合 Flutter + Laravel API 项目，因为 Laravel Resource 输出一旦稳定，`freezed` 模型几乎可以长期复用，而且重构时比手写 `fromJson` 更安全。

## 九、Loading 状态管理：不是只有一个圈圈

Flutter 项目里关于 Loading 的讨论，看似是 UI 细节，实际上本质是状态建模能力。

### 9.1 先区分不同类型的 Loading

至少要分清楚以下几类：

1. **页面首屏加载**：整个页面数据未就绪。
2. **局部模块加载**：例如某个卡片单独刷新。
3. **按钮提交中**：防止重复点击。
4. **列表加载更多**：底部转圈。
5. **下拉刷新**：RefreshIndicator。

如果你只有一个全局 `isLoading`，那一定会在复杂页面里出问题。

### 9.2 页面状态不要只用布尔值

更建议用枚举或状态对象：

```dart
enum PageStatus {
  initial,
  loading,
  success,
  empty,
  error,
}
```

这样你可以明确地区分：

- `loading`：首屏加载中
- `empty`：接口成功但没数据
- `error`：首屏失败
- `success`：正常展示内容

相比一个 `isLoading + list.isEmpty` 的拼凑方案，这种状态表达更稳定。

### 9.3 按钮提交中一定要防重复

例如登录按钮、提交订单按钮、点赞按钮，如果不做“提交中禁用”，用户连续点击会触发重复请求。轻则产生多次 Toast，重则造成重复订单、重复评论。

推荐写一个通用的防重提交包装：

```dart
class SubmitController extends ChangeNotifier {
  bool _submitting = false;
  bool get submitting => _submitting;

  Future<void> run(Future<void> Function() task) async {
    if (_submitting) return;
    _submitting = true;
    notifyListeners();
    try {
      await task();
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }
}
```

### 9.4 Skeleton 比纯 Loading 更友好

如果页面首屏内容结构比较稳定，比如资讯列表、商品详情、用户资料页，推荐优先使用 Skeleton 骨架屏，而不是中间一个转圈。骨架屏的好处是：

- 用户能感知页面结构正在加载。
- 视觉上更自然。
- 能减少“卡住了”的错觉。

这一点在 Flutter + Laravel 的组合里尤其明显，因为后端接口有时会受到数据库查询和网络延迟影响，骨架屏能显著优化体感。

## 十、离线缓存策略：不是把 JSON 存一下就结束了

当接口偶发失败、用户网络不稳定、地铁里断网时，离线缓存能极大改善体验。但缓存不是“有就行”，而是要有策略。

### 10.1 哪些数据适合缓存

适合缓存的数据：

- 首页内容流
- 分类列表
- 用户资料快照
- 配置类数据
- 最近访问内容

不太适合长期缓存的数据：

- 强实时价格
- 库存数量
- 支付状态
- 安全敏感数据

### 10.2 缓存的三个核心问题

做缓存前最好先回答三个问题：

1. **缓存什么**：整包响应、列表项、还是聚合后的实体？
2. **缓存多久**：5 分钟、1 小时、1 天，还是直到主动刷新？
3. **缓存失效后怎么处理**：静默更新、强制刷新、回退到旧数据？

如果这三个问题没想清楚，缓存很容易从“优化”变成“制造幻觉”。

### 10.3 推荐的移动端缓存策略

一个很实用的组合是：

- 首屏优先读缓存快速展示。
- 同时静默请求网络更新。
- 网络成功则刷新页面并更新缓存。
- 网络失败时，如果已有缓存则展示缓存并给出轻提示。
- 如果缓存和网络都失败，再展示错误页。

这其实就是移动端很常见的 **stale-while-revalidate** 思路。

### 10.4 Flutter 本地存储怎么选

- `shared_preferences`：适合轻量配置，不适合复杂结构和大量数据。
- `Hive`：性能好、使用方便，适合本地缓存。
- `Isar`：适合结构化数据更强的场景。
- `sqflite`：需要复杂 SQL 查询时可选。

如果只是做 API 响应缓存，Hive 往往已经足够。

### 10.5 缓存版本与接口版本联动

实战里一个很容易忽略的问题是：后端接口字段改了，本地旧缓存结构还在，结果 Flutter 反序列化崩了。

所以建议：

- 给缓存增加 schema version。
- App 大版本更新时清理关键缓存。
- Model `fromJson` 做必要的空值兜底。
- 尽量避免缓存直接依赖后端随时可能变化的原始字段。

## 十一、实际踩坑记录：这些问题最好提前规避

这一部分是实战里最“值钱”的部分。很多问题不是不会写，而是只有线上跑起来后才暴露。

### 11.1 坑一：Laravel 返回 200，但 success 为 false

有些团队习惯所有请求都返回 200，然后在 body 里放 `success: false`。这样做表面上统一，实际会让客户端异常处理非常混乱。

问题在于：

- 网络库默认会认为请求成功。
- 日志平台按状态码统计时看不出错误比例。
- 重试、埋点、监控都会失真。

更合理的方案是：HTTP 状态码表达传输层和请求结果，`error_code` 表达业务语义。不要把所有失败都包成 200。

### 11.2 坑二：分页排序字段不稳定导致重复数据

曾经遇到过一个资讯流接口，第一页和第二页之间偶发重复数据，最后排查发现后端排序写的是：

```php
->orderByDesc('created_at')
```

问题是多条记录可能拥有完全相同的 `created_at`，尤其在批量导入数据时。最终解决方案是：

```php
->orderByDesc('created_at')->orderByDesc('id')
```

也就是说，分页排序字段必须能形成稳定且唯一的顺序，尤其是 cursor 分页。

### 11.3 坑三：Flutter 首次启动时 Header 注入时机过晚

很多项目把 token 从本地读取放在首页初始化之后，结果首页发起请求时 Header 里还没有 token，直接 401。刷新一下又好了，导致问题特别隐蔽。

解决方式：

- 在 `runApp` 之前完成关键初始化；或者
- 先进入启动页，初始化依赖后再进入主流程。

总之，不要让需要鉴权的首屏请求抢跑。

### 11.4 坑四：表单错误只弹 Toast，用户不知道哪里错了

后端明明返回了字段级校验错误，但客户端图省事只弹一句“参数错误”。结果用户改了半天也不知道哪个字段有问题。

解决方式很明确：

- 422 错误保留 `errors` 字段。
- 表单页面解析字段错误并显示在对应输入框下方。
- 只有无法映射到字段的错误，再用 Toast 补充。

### 11.5 坑五：刷新和加载更多状态混用

有些列表页面只有一个 `isLoading`，下拉刷新时底部 loading 也跟着出现，加载更多失败后整个页面都被错误页替换。用户体验很差。

本质原因是状态建模不清晰。刷新、首屏加载、加载更多应该是三套不同语义的状态。

### 11.6 坑六：离线缓存没有 TTL，旧数据永远不更新

一些项目为了“离线可用”，把首页列表永久缓存，结果线上内容更新了，老用户看到的还是几周前的数据。

缓存一定要有过期策略，至少要做到：

- 进入页面时读缓存。
- 同步请求最新数据。
- 成功后覆盖旧缓存。

缓存的目的应该是“兜底和加速”，不是“取代网络”。

### 11.7 坑七：接口字段空值不统一导致解析频繁崩溃

典型场景：

- 某接口里 `avatar_url` 为空时返回 `null`
- 另一个接口里为空时返回 `''`
- 还有一个接口里直接不返回该字段

Flutter 端如果 Model 写得太理想化，很容易出现类型错误或空指针问题。解决建议：

- Laravel 端尽量统一空值策略。
- Flutter `fromJson` 不要默认所有字段都必定存在。
- UI 层对可空字段做好降级展示。

### 11.8 坑八：并发请求下重复弹登录过期提示

当 token 失效时，多个接口同时返回 401，如果没有统一闸门，就可能连续弹出很多次“登录已过期”，甚至多次跳转登录页。

更好的做法是：

- 在全局维护一个 `isSessionExpiredHandling` 标志。
- 第一个 401 到来时触发处理。
- 后续 401 在本轮处理中直接忽略。

这类问题只有真实复杂页面里才容易暴露，提前处理非常有必要。

### 11.9 坑九：Laravel 端验证失败字段名与 Flutter 表单字段名对不上

比如后端返回的是 `mobile`，前端表单控件命名却是 `phone`，结果 422 错误虽然到了客户端，却无法精确映射到对应输入框，只能退化成全局 Toast。

比较稳的做法是：

- 前后端在接口文档里固定字段名，不要 UI 文案和 API 字段各自起名；
- Repository 层可以维护一层字段映射表，把 `mobile -> phone` 这种历史包袱集中处理；
- 表单组件统一接受 `fieldErrors['email']?.first` 这类结构，避免每页重复转换。

### 11.10 坑十：时间格式、时区和空字符串混用

Laravel 常见输出是 `toDateTimeString()`，但如果某些接口又返回 ISO8601，或者把空时间写成 `''`，Flutter 端在 `DateTime.parse` 时就很容易崩溃。

建议统一约定：

- Laravel 对外统一使用 ISO8601 或统一的字符串格式；
- 为空就返回 `null`，不要返回空字符串；
- Flutter Model 层统一做 `DateTime?` 解析，UI 再格式化展示。

### 11.11 坑十一：接口幂等性不足，重试后产生重复写入

自动重试和 token 刷新会放大这个问题。比如“创建订单”“发送验证码”“提交评论”这类接口，在网络抖动下用户点一次，客户端可能重放两次，最终生成两条数据。

规避思路包括：

- 关键写接口要求服务端支持幂等键；
- Dio 重试策略只针对 GET 或明确可重试的请求；
- refresh token 后重放请求前，检查接口语义是否允许自动重发。

### 11.12 坑十二：接口文档没有同步更新，导致 codegen 模型漂移

一旦团队开始用 `freezed`、`json_serializable` 或 OpenAPI 生成模型，字段变更如果没有同步到文档和联调流程，客户端构建阶段不会立刻发现语义错误，往往要到运行时才暴露。

建议把这件事制度化：

- Laravel Resource 字段调整时，同时更新接口文档；
- 联调阶段保留真实示例响应；
- Flutter 端为关键 DTO 增加 JSON fixture 测试，提前发现字段漂移。

## 十二、常见 API 对接问题排查清单

除了上面的踩坑记录，真正进入联调和线上维护阶段后，建议团队长期保留一份排查清单，出问题时按顺序快速定位：

1. **先看状态码，再看 body**：很多问题不是解析错误，而是服务端其实已经 401/422/500；
2. **确认 Laravel Resource 是否改过字段**：DTO 解析失败通常先怀疑协议漂移；
3. **确认是否命中缓存旧数据**：尤其是首屏明明接口更新了但页面没变化；
4. **检查分页排序是否稳定**：重复数据、漏数据、大概率与排序字段或 cursor 失效有关；
5. **确认 refresh token 是否发生并发竞争**：多个 401 同时出现时最容易暴露；
6. **区分是网络层失败还是业务层失败**：超时、断网、权限不足、参数错误的处理路径不应相同；
7. **检查表单字段名映射**：后端 `errors` 回来了但 UI 没展示，多半是字段对不上；
8. **检查时区、空值、数字类型**：尤其是 `int`/`double`、`null`/`''` 混用问题；
9. **确认写接口是否被重放**：订单、支付、提交类接口要优先排查幂等性；
10. **保留 request id 贯穿前后端日志**：线上排障时效率会高很多。

这份清单的意义不只是“遇到 bug 时能查”，更重要的是帮助前后端在设计阶段就提前规避高频问题。

## 十三、一套更稳的前后端协作约定

如果你准备把 Flutter + Laravel API 长期做下去，我非常建议在团队内建立一份“接口协作约定”，至少包括下面这些内容：

### 13.1 Laravel 侧约定

1. 所有 API 返回统一包裹结构。
2. 所有错误使用标准 HTTP 状态码。
3. 所有业务错误返回明确 `error_code`。
4. 分页统一放在 `meta.pagination`。
5. 时间字段统一格式。
6. Resource 输出字段稳定，不随数据库字段直接漂移。
7. 认证接口返回 token_type、token、user 基础信息。
8. 422 校验错误统一带 `errors`。

### 13.2 Flutter 侧约定

1. 禁止在页面中直接 new Dio 发请求。
2. 所有接口必须经过统一 NetworkService。
3. 所有异常必须映射成统一异常类型。
4. 401 统一由拦截器处理。
5. 分页列表必须区分首屏、刷新、加载更多状态。
6. Token 使用安全存储。
7. 缓存策略由 Repository 统一协调。
8. 页面层只关心展示状态和用户交互。

### 13.3 联调阶段建议重点验证的内容

在接口联调阶段，不要只验证“能不能返回数据”，还要重点验证：

- token 失效后是否能稳定走统一流程
- 422 表单错误结构是否符合预期
- 分页在新增、删除数据时是否有重复或漏项
- 慢网和断网场景是否有降级体验
- 空列表、空字段、图片缺失等边界情况是否正常
- 服务端 500、502、超时等异常时客户端是否可控

这些验证越早做，越能避免后期线上返工。

## 十四、推荐的项目落地节奏

如果你现在正准备从零开始做 Flutter + Laravel API 项目，我建议按下面的顺序推进，而不是一开始就把所有高级能力都堆满：

### 阶段一：先打通最小闭环

- Laravel 统一响应结构
- Flutter Dio 基础封装
- 登录/退出
- token 存储与 Header 注入
- 基础错误提示

### 阶段二：补齐列表体验

- offset 或 cursor 分页
- 下拉刷新
- 加载更多
- 空态/错误态/骨架屏

### 阶段三：工程化增强

- 统一错误码映射
- Repository 层
- 离线缓存
- 日志与请求追踪
- 登录失效全局处理

### 阶段四：优化复杂场景

- refresh token
- 请求去重
- 更细粒度缓存
- 并发控制
- 埋点和性能监控

这样做的好处是，你能在可交付和工程质量之间找到平衡，不会因为“追求完美架构”导致项目迟迟无法落地。

## 十五、结语：真正好用的 API 对接，不是能请求成功，而是出了问题也可控

Flutter + Laravel 的组合非常适合业务落地，但真正决定项目稳定性的，并不是“能不能把接口调通”，而是你有没有把接口协议、认证、分页、错误处理、Loading 状态和缓存机制设计成一套可维护的体系。

回看全文，核心其实只有几件事：

- Laravel 用 Resource 和统一响应结构把协议收敛起来。
- Flutter 用 Dio + NetworkService + Repository 把网络层和页面层解耦。
- Token 认证优先保证存储、注入、401 失效处理闭环。
- 分页不要只会“page++”，而要根据业务场景选择 offset 或 cursor。
- 错误处理不要停留在 try-catch，而要做到 HTTP 状态码、业务错误码、字段错误三层协作。
- Loading 和缓存也不是 UI 点缀，而是用户体验和工程质量的重要组成部分。

很多项目在开发初期图快，把这些能力“先放一放”，结果后期每新增一个页面都要重复造轮子；而如果一开始就把这些基础设施搭好，后续迭代会越来越顺。

希望这篇文章能帮你把 Flutter + Laravel 的接口对接，从“能跑”推进到“稳定、清晰、好维护”。如果你正在做相关项目，不妨先从统一 Laravel 响应结构和 Flutter Dio 封装这两件事开始，这通常是性价比最高的第一步。

## 相关阅读

- [Flutter 网络请求实战：Dio 封装拦截器错误处理与 Token 刷新踩坑记录](/post/flutter-dio-token-api-http/)
- [Flutter 状态管理实战：Riverpod、Bloc、GetX 选型对比与最佳实践](/post/flutter-riverpod-bloc-getx/)
- [Flutter Firebase 实战：Auth、Firestore、FCM 一体化后端方案](/post/flutter-firebase-auth-firestore-fcm/)
- [Flutter WebSocket 实战：实时聊天、通知推送、长连接管理](/post/flutter-websocket/)
- [Flutter 本地存储实战：Hive、Isar、SQLite 数据持久化方案对比](/post/flutter-hive-isar-sqlite/)
