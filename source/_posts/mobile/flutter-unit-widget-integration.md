---
title: Flutter 测试实战：Unit/Widget/Integration 三层测试体系
date: 2026-06-01 10:00:00
tags: [Flutter, 测试, Unit Test, Widget Test, Integration Test]
keywords: [Flutter, Unit, Widget, Integration, 测试实战, 三层测试体系, 移动端]
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: 这篇 Flutter 测试实战指南系统讲透 Unit Test、Widget Test、Integration Test 的分层策略，覆盖率治理、mockito/mock 使用、CI 落地与避坑经验，帮你建立高质量、可维护的自动化测试体系。
---


Flutter 项目写到后期，很多团队都会遇到一个很尴尬的阶段：功能越来越多，页面越来越复杂，回归越来越慢，改一处状态管理或者网络层封装，结果登录页、购物车、详情页、埋点链路全都可能跟着炸。最可怕的不是报错，而是“看起来没报错，但其实已经坏了”。

我自己在 Flutter 项目里真正建立起测试体系，不是因为一开始就有很强的工程洁癖，而是因为踩过太多坑：

- 某次重构仓储层，把 JSON 字段名改了，单测没补，线上用户列表直接空白；
- 某次把 `pumpAndSettle()` 写进一个带无限动画的 Widget Test，CI 永远不结束；
- 某次集成测试在本地稳定通过，到了 Android 模拟器的 GitHub Actions 环境里，因为系统动画和权限弹窗全部挂掉；
- 某次为了追求“高覆盖率”，写了一堆对实现细节高度耦合的测试，结果每次重构都要把测试一起推倒重来。

所以这篇文章不打算只讲 API 用法，而是从真实工程出发，系统梳理 Flutter 中 **Unit Test、Widget Test、Integration Test** 三层测试体系怎么搭、怎么落地、怎么避坑。文章会覆盖：

1. 为什么要按测试金字塔分层，而不是全靠人工点点点；
2. Unit Test 如何测试纯 Dart 逻辑、Repository、UseCase，以及如何用 `mockito`、Fake、依赖注入控制边界；
3. Widget Test 如何用 `pump`、`find`、`expect`、`matchers` 验证 UI 与交互；
4. Integration Test 如何跑通端到端流程，以及 `integration_test`、`patrol`、`flutter_driver` 的关系；
5. Golden Test、覆盖率、性能测试、CI 接入怎么做；
6. 一堆真实踩坑记录，告诉你为什么“会写测试”和“能把测试体系跑稳”是两回事。

如果你所在团队目前的测试现状是“只有手测”或者“只有零散单测”，这篇文章的目标不是让你一夜之间覆盖 100%，而是帮你建立一套可持续演进的工程化测试思路。

为了把文章写得更接近真实项目，我会在每一层都穿插“为什么这样设计”“什么时候不该这么测”“线上事故通常从哪里冒出来”这些经验视角，而不是只罗列一串 API。因为测试真正困难的地方，从来不是记住函数名，而是知道边界该怎么切、依赖该怎么抽、失败该怎么复现。

---

## 一、先说结论：Flutter 测试不是三种工具，而是三层防线

很多人第一次接触 Flutter 测试，会把重点放在命令上：

- `flutter test`
- `flutter test integration_test`
- Golden Test
- `patrol test`

但从工程角度看，这些不是重点。重点是你要回答三个问题：

1. **哪一层问题应该在哪一层被发现？**
2. **什么样的测试写起来便宜、跑起来快、维护成本低？**
3. **什么样的测试必须跑真环境，哪怕贵一点也值得？**

这就是测试金字塔的核心。

如果团队里有人质疑“为什么还要额外写测试”，你可以直接换算成本：一次支付流程回归靠人工完整走一遍，可能要十几分钟；而一个稳定的 Unit Test 或 Widget Test，几秒钟就能给出反馈。测试体系的本质，是把高频的人工成本前置成一次性的自动化建设。

### 1.1 测试金字塔在 Flutter 中的映射

经典测试金字塔分三层：

- 底层：大量、快速、便宜的单元测试；
- 中层：适量的组件/界面测试；
- 顶层：少量但关键的端到端集成测试。

映射到 Flutter 项目里，大致是：

- **Unit Test**：测试纯 Dart 逻辑、工具函数、格式化、状态机、UseCase、Repository 映射逻辑；
- **Widget Test**：测试单个页面、局部组件、交互行为、状态变化、路由跳转、异步渲染；
- **Integration Test**：测试真实 App 启动、登录、下单、支付前流程、权限、导航、原生桥接等完整链路。

为了更直观地判断“这段代码到底该放哪一层测”，可以先用下面这张表快速做取舍：

| 测试类型 | 典型使用场景 | 执行速度 | 覆盖范围 | 编写/维护成本 |
| --- | --- | --- | --- | --- |
| Unit Test | 业务规则、金额计算、Repository 映射、状态机、UseCase | 很快，通常毫秒级到秒级 | 单个函数/类/模块 | 低 |
| Widget Test | 页面三态、按钮点击、表单校验、列表渲染、路由跳转 | 较快，通常秒级 | 单个 Widget 到页面级交互 | 中 |
| Integration Test | 登录、下单、支付前链路、权限申请、原生交互 | 最慢，通常几十秒到分钟级 | 多页面到真实应用链路 | 高 |

如果一句话概括选择原则，就是：**先问这是不是纯逻辑，再问是不是单页交互，最后才问是否必须跑真环境。** 这样做能同时兼顾反馈速度、覆盖价值和长期维护成本。

我自己的经验是，一个中型 Flutter 项目如果完全健康，通常应该接近下面的比例：

- 70%：Unit Test
- 20%：Widget Test
- 10%：Integration Test

这不是死规定，但它代表一种很重要的工程原则：

> 能在下层便宜地测出来的问题，不要等到上层才发现。

举个很现实的例子：

- 金额计算错误，应该由 Unit Test 拦住；
- “购物车为空时按钮禁用”这种交互逻辑，应该由 Widget Test 拦住；
- “用户从登录到提交订单整条流程是否真的走通”，才应该交给 Integration Test。

如果你把所有事情都堆到集成测试里，测试会非常慢、脆弱、难维护，而且 CI 很容易红得一塌糊涂。

### 1.2 反模式：测试冰淇淋

很多 Flutter 团队最容易走向的是“测试冰淇淋”结构：

- 底层单测少；
- 中间 Widget Test 几乎没有；
- 顶层全靠人工回归或者少量端到端脚本。

为什么会这样？

1. Flutter UI 可见即所得，团队天然更想直接点页面；
2. 业务代码和 Widget 强耦合，导致纯逻辑很难单测；
3. 很多人不会拆依赖，写测试时发现到处都是单例和静态方法；
4. Widget Test 一开始不熟，觉得不如手动跑一遍来得快。

但项目一旦做大，这种结构必然出问题：

而且问题往往不是立刻爆炸，而是缓慢累积：前两个月看不出区别，半年后每次发版都要半天人工回归，一旦骨干开发离职，谁也不敢动关键模块。测试体系真正解决的，是“团队是否具备可持续修改代码的能力”。

- 回归成本线性上升；
- 重构阻力变大；
- 线上问题常常是“一个看起来很小的改动引发连锁故障”。

所以测试体系不是“补充工作”，它本质上是为了给重构和迭代买保险。

---

## 二、一个可测试的 Flutter 项目应该长什么样

在讲具体测试之前，先说一句大实话：

> 很多测试写不出来，不是测试框架不行，而是你的代码结构根本不可测试。

我见过最常见的坏味道有这些：

- Widget 里直接 new Dio、直接调接口；
- 页面 `initState` 里把业务逻辑写满；
- 仓储层返回裸 Map，页面自己解析；
- 大量静态方法和单例，无法替换依赖；
- 异步代码里到处 `Future.delayed`、Timer、全局事件总线；
- 状态管理层直接依赖 BuildContext。

### 2.1 推荐的分层方式

一个更利于测试的典型结构大概是这样：

```dart
lib/
  core/
    network/
    errors/
    utils/
  data/
    datasource/
    models/
    repositories/
  domain/
    entities/
    repositories/
    usecases/
  presentation/
    pages/
    widgets/
    viewmodels/
```

然后依赖方向保持单向：

- `presentation` 依赖 `domain`
- `domain` 不依赖 Flutter UI
- `data` 实现 `domain` 的抽象接口

这时测试就会自然很多：

- `domain/usecases` 适合写 Unit Test；
- `data/repositories` 适合写 Unit Test，重点测映射和错误处理；
- `presentation/widgets` 适合写 Widget Test；
- 跨页面主流程用 Integration Test。

### 2.2 用依赖注入给测试留后门

测试想稳定，依赖注入几乎是必修课。你不一定非得上 `get_it`、`riverpod`、`provider`、`injectable`，但至少要做到：

很多人把依赖注入理解成“再加一层框架”，其实更准确地说，它是把“构造对象”和“使用对象”拆开。只要这一步完成，测试就有机会把真实依赖换成 mock、fake 或测试专用实现；反之，如果对象在 Widget 内部被直接 new 出来，后续几乎所有测试都会变得别扭。

- 页面依赖的服务可以替换；
- 测试时可以注入 mock/fake；
- 不依赖全局单例状态。

例如一个登录用例：

```dart
abstract class AuthRepository {
  Future<User> login({required String email, required String password});
}

class LoginUseCase {
  LoginUseCase(this._repository);

  final AuthRepository _repository;

  Future<User> call(String email, String password) {
    if (email.isEmpty || password.isEmpty) {
      throw const FormatException('email/password cannot be empty');
    }
    return _repository.login(email: email, password: password);
  }
}
```

这个结构下，`LoginUseCase` 的测试不需要 Flutter 环境、不需要真网络、不需要真页面。

如果你写成下面这样：

```dart
class LoginPageState extends State<LoginPage> {
  final Dio dio = Dio();

  Future<void> submit() async {
    final result = await dio.post('/login', data: {
      'email': emailController.text,
      'password': passwordController.text,
    });
    // ...
  }
}
```

那后面的单测、Widget Test、集成测试都会变得又重又脆。

---

## 三、Unit Test：先把纯逻辑守住，这是性价比最高的一层

Flutter 的单元测试本质上还是 Dart 测试。对于 `test` 目录里的很多场景，你甚至不需要 `flutter_test`，只用 `package:test/test.dart` 就够了。

### 3.1 适合写 Unit Test 的对象

我通常会优先覆盖下面这些：

1. 工具函数：日期格式化、金额换算、校验器；
2. Domain 层：UseCase、状态机、业务规则；
3. Data 层：Repository 映射逻辑、错误转换；
4. ViewModel/Notifier/BLoC 的纯状态转换；
5. 序列化/反序列化。

一个经典误区是：

> 只有“纯函数”才值得写单测。

其实不是。只要某段逻辑满足“输入可控、输出可验证、依赖可替换”，它就非常适合单测。

### 3.2 例子：购物车金额计算

先看一段非常典型的业务逻辑：

```dart
class CartItem {
  CartItem({
    required this.price,
    required this.quantity,
    this.discount = 0,
    this.selected = true,
  });

  final double price;
  final int quantity;
  final double discount;
  final bool selected;
}

class CartCalculator {
  double subtotal(List<CartItem> items) {
    return items
        .where((e) => e.selected)
        .fold(0, (sum, item) => sum + item.price * item.quantity);
  }

  double totalDiscount(List<CartItem> items) {
    return items
        .where((e) => e.selected)
        .fold(0, (sum, item) => sum + item.discount);
  }

  double total(List<CartItem> items) {
    final value = subtotal(items) - totalDiscount(items);
    return value < 0 ? 0 : value;
  }
}
```

对应测试：

```dart
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('CartCalculator', () {
    late CartCalculator calculator;

    setUp(() {
      calculator = CartCalculator();
    });

    test('should calculate subtotal for selected items only', () {
      final items = [
        CartItem(price: 100, quantity: 2, selected: true),
        CartItem(price: 50, quantity: 1, selected: false),
      ];

      expect(calculator.subtotal(items), 200);
    });

    test('should return zero when discount exceeds subtotal', () {
      final items = [
        CartItem(price: 20, quantity: 1, discount: 50),
      ];

      expect(calculator.total(items), 0);
    });

    test('should calculate total correctly', () {
      final items = [
        CartItem(price: 100, quantity: 2, discount: 20),
        CartItem(price: 50, quantity: 1, discount: 10),
      ];

      expect(calculator.total(items), 220);
    });
  });
}
```

看起来简单，但这类测试价值极高，因为：

更重要的是，这类测试能逼着你把业务规则从 UI 中剥离出来。很多团队写不出稳定测试，本质不是不会用 `test()`，而是金额、折扣、校验、排序这些规则全都散落在页面回调里。一旦你想给它们写单测，就会发现先要重构结构；而这恰恰说明测试在反向推动架构变干净。

- 它跑得快；
- 它几乎不受 UI 变更影响；
- 一旦金额规则调整，能第一时间告诉你有没有破坏旧逻辑。

### 3.3 使用 mockito：验证依赖交互

当单元测试对象依赖外部接口时，可以用 `mockito`。例如测试 `LoginUseCase`：

```dart
abstract class AuthRepository {
  Future<User> login({required String email, required String password});
}

class User {
  User({required this.id, required this.name});

  final String id;
  final String name;
}

class LoginUseCase {
  LoginUseCase(this.repository);

  final AuthRepository repository;

  Future<User> call(String email, String password) async {
    if (!email.contains('@')) {
      throw const FormatException('invalid email');
    }

    return repository.login(email: email, password: password);
  }
}
```

使用 `mockito` 的测试：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  group('LoginUseCase', () {
    late MockAuthRepository repository;
    late LoginUseCase useCase;

    setUp(() {
      repository = MockAuthRepository();
      useCase = LoginUseCase(repository);
    });

    test('should throw FormatException when email is invalid', () async {
      expect(
        () => useCase('invalid-email', '123456'),
        throwsA(isA<FormatException>()),
      );

      verifyNever(repository.login(
        email: anyNamed('email'),
        password: anyNamed('password'),
      ));
    });

    test('should call repository and return user', () async {
      final user = User(id: '1', name: 'Mike');

      when(repository.login(email: 'mike@test.com', password: '123456'))
          .thenAnswer((_) async => user);

      final result = await useCase('mike@test.com', '123456');

      expect(result.name, 'Mike');
      verify(repository.login(email: 'mike@test.com', password: '123456'))
          .called(1);
      verifyNoMoreInteractions(repository);
    });
  });
}
```

这里 `mockito` 的价值不是“造假数据”，而是：

- 控制依赖返回值；
- 验证依赖有没有被调用；
- 验证参数是否正确；
- 验证错误路径。

### 3.4 Fake 比 Mock 更稳的场景

Mock 很强，但很多场景下我更推荐优先考虑 Fake。

原因很简单：Mock 测的是“交互”，Fake 更偏向测“行为”。

例如一个本地缓存仓库：

```dart
abstract class TokenStore {
  Future<void> save(String token);
  Future<String?> read();
  Future<void> clear();
}

class FakeTokenStore implements TokenStore {
  String? _token;

  @override
  Future<void> save(String token) async {
    _token = token;
  }

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> clear() async {
    _token = null;
  }
}
```

如果你要测试 `AuthService` 登录后是否保存 token，用 Fake 往往更直观：

```dart
class AuthService {
  AuthService(this.store);

  final TokenStore store;

  Future<void> persistToken(String token) async {
    await store.save(token);
  }
}

void main() {
  test('should persist token', () async {
    final store = FakeTokenStore();
    final service = AuthService(store);

    await service.persistToken('abc123');

    expect(await store.read(), 'abc123');
  });
}
```

Fake 的好处：

在真实项目里，Fake 往往特别适合这些依赖：内存缓存、简化版 DAO、内存事件总线、测试专用仓储。它们既比 Mock 更接近真实行为，又不像真数据库或真网络那样沉重。我后来越来越少在状态型依赖上滥用 Mock，就是因为很多失败其实不是业务错了，而是 `verify()` 把内部调用次数卡得过死。

- 测试语义更像真实使用；
- 不容易因为内部调用次数变化而误报；
- 更适合状态型依赖。

我自己的经验是：

- 关注“是否调用、调用参数、调用次数”时，用 Mock；
- 关注“替代一个简单可运行实现”时，用 Fake。

### 3.5 Repository 单测：重点测映射和异常转换

Repository 是 Flutter 项目里最容易被低估的一层。很多线上 bug 不在页面，而在：

- 字段解析错误；
- null 处理遗漏；
- 网络异常未转换；
- DTO 到 Entity 映射丢字段。

示例：

```dart
class UserDto {
  UserDto({required this.id, required this.nickname});

  final int id;
  final String nickname;

  factory UserDto.fromJson(Map<String, dynamic> json) {
    return UserDto(
      id: json['id'] as int,
      nickname: json['nickname'] as String,
    );
  }
}

class UserEntity {
  UserEntity({required this.id, required this.name});

  final String id;
  final String name;
}

abstract class UserRemoteDataSource {
  Future<Map<String, dynamic>> fetchProfile();
}

class UserRepositoryImpl {
  UserRepositoryImpl(this.remoteDataSource);

  final UserRemoteDataSource remoteDataSource;

  Future<UserEntity> getProfile() async {
    try {
      final json = await remoteDataSource.fetchProfile();
      final dto = UserDto.fromJson(json);
      return UserEntity(id: dto.id.toString(), name: dto.nickname);
    } catch (e) {
      throw RepositoryException('failed to load profile: $e');
    }
  }
}

class RepositoryException implements Exception {
  RepositoryException(this.message);
  final String message;
}
```

测试时建议覆盖：

- 正常返回；
- 字段缺失；
- 类型错误；
- 远端抛错；
- 异常包装是否符合约定。

```dart
class MockUserRemoteDataSource extends Mock implements UserRemoteDataSource {}

void main() {
  group('UserRepositoryImpl', () {
    late MockUserRemoteDataSource remote;
    late UserRepositoryImpl repository;

    setUp(() {
      remote = MockUserRemoteDataSource();
      repository = UserRepositoryImpl(remote);
    });

    test('should map dto to entity', () async {
      when(remote.fetchProfile()).thenAnswer((_) async => {
            'id': 101,
            'nickname': 'Hermes',
          });

      final result = await repository.getProfile();

      expect(result.id, '101');
      expect(result.name, 'Hermes');
    });

    test('should wrap exception into RepositoryException', () async {
      when(remote.fetchProfile()).thenThrow(Exception('network error'));

      expect(
        repository.getProfile(),
        throwsA(isA<RepositoryException>()),
      );
    });
  });
}
```

### 3.6 单元测试里的真实踩坑记录

#### 坑一：只测 happy path，不测 bad case

很多项目单测覆盖率看着不错，但其实只断言“正常输入时正常输出”。一上线，空数组、null 字段、接口返回 `"1"` 而不是 `1` 就全崩。

我的经验是：**坏输入比好输入更值得写测试。**

#### 坑二：对私有实现细节测得太细

比如 BLoC 内部用了几个 `map`、几个 `copyWith`，测试里全都写死。一重构实现，行为没变，测试先炸。

正确思路是多测：

- 输入
- 输出
- 对外可观察行为

少测内部实现步骤。

#### 坑三：时间、随机数、UUID 不可控

如果代码里直接写 `DateTime.now()`、`Random()`、`Uuid().v4()`，测试就容易变成不稳定。

解决方式：

- 注入 `Clock`；
- 抽象随机数生成器；
- 给 ID 生成器做接口。

例如：

```dart
abstract class Clock {
  DateTime now();
}

class SystemClock implements Clock {
  @override
  DateTime now() => DateTime.now();
}
```

测试时就能传一个固定时间的 FakeClock。

---

## 四、Widget Test：验证 UI 行为，而不是截图式自嗨

很多人第一次接触 Widget Test，会误以为它只是“页面能不能显示出来”。其实 Widget Test 的核心价值在于：

> 在一个比真机更轻、更快、更可控的环境里，验证 UI 结构、状态变化和交互行为。

它比 Integration Test 快很多，又比 Unit Test 更贴近真实界面，是 Flutter 测试体系里非常关键的一层。

### 4.1 Widget Test 到底测什么

如果你把 Widget Test 理解为“截图前的烟雾测试”，那它的价值会被大幅低估。真正高质量的 Widget Test，是在一个高度可控的 Flutter 渲染环境里验证：状态变化能不能准确映射到界面、用户交互会不会触发正确动作、错误态和边界态有没有被页面正确接住。它不是端到端测试的廉价替代品，而是 UI 行为验证的主力。

最适合 Widget Test 的内容包括：

- 页面初始状态；
- 加载/成功/失败三态；
- 表单输入与按钮启用；
- 列表渲染是否正确；
- 点击事件是否触发正确回调；
- 路由跳转；
- SnackBar/Dialog/BottomSheet 是否出现；
- 状态管理驱动的 UI 变化。

不太适合 Widget Test 的内容：

- 真网络；
- 真数据库；
- 真平台能力；
- 系统权限弹窗；
- 多 App 间交互。

### 4.2 最常用的三板斧：pump、find、expect

示例登录页：

```dart
class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.onLogin,
  });

  final Future<bool> Function(String email, String password) onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  bool loading = false;
  String? error;

  Future<void> submit() async {
    setState(() {
      loading = true;
      error = null;
    });

    final ok = await widget.onLogin(
      emailController.text,
      passwordController.text,
    );

    if (!mounted) return;

    setState(() {
      loading = false;
      error = ok ? null : '登录失败';
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Column(
          children: [
            TextField(key: const Key('email'), controller: emailController),
            TextField(key: const Key('password'), controller: passwordController),
            ElevatedButton(
              key: const Key('login_button'),
              onPressed: loading ? null : submit,
              child: loading
                  ? const CircularProgressIndicator()
                  : const Text('登录'),
            ),
            if (error != null) Text(error!),
          ],
        ),
      ),
    );
  }
}
```

对应 Widget Test：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets('should show error text when login fails', (tester) async {
    await tester.pumpWidget(
      LoginPage(
        onLogin: (email, password) async => false,
      ),
    );

    await tester.enterText(find.byKey(const Key('email')), 'mike@test.com');
    await tester.enterText(find.byKey(const Key('password')), '123456');
    await tester.tap(find.byKey(const Key('login_button')));

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('登录失败'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });
}
```

这里最重要的几个动作：

刚开始写 Widget Test 时，我最不适应的一点是：所有“等待 UI 稳定”的动作都必须显式描述出来。手工点页面时，我们天然会等它渲染；而在测试里，框架不会替你猜“什么时候该等一会儿”。正是这种显式性，让 Widget Test 在复杂异步场景里比人工回归更可靠。

- `pumpWidget`：把待测 Widget 挂载起来；
- `find`：查找节点；
- `enterText` / `tap`：模拟交互；
- `pump`：推动一帧或一段时间；
- `expect`：做断言。

### 4.3 `pump()`、`pumpAndSettle()`、定时动画的区别

这是 Widget Test 最容易踩坑的点之一。

#### `pump()`

推动一帧，适合：

- 首次渲染；
- 一次 setState；
- 触发一个微任务后的更新。

#### `pump(Duration)`

推动指定时间，适合：

- `Future.delayed`；
- 动画推进；
- 等待异步状态结束。

#### `pumpAndSettle()`

持续 pump，直到没有待处理帧为止。

看起来很方便，但它有个大坑：

> 如果页面上存在无限动画、循环计时器、Lottie、持续 spinner，`pumpAndSettle()` 可能永远不返回。

这坑我在 CI 上踩过很多次。一个加载组件里用了无限旋转动画，本地调试没问题，测试里 `pumpAndSettle()` 直接卡死。

解决方式：

1. 优先用明确时长的 `pump(Duration)`；
2. 对无限动画组件做可测试开关；
3. 在测试环境中用 Fake Widget 替代复杂动画。

### 4.4 find 的常用姿势

常用查找方式：

```dart
find.text('登录');
find.byType(ElevatedButton);
find.byKey(const Key('login_button'));
find.byIcon(Icons.add);
find.widgetWithText(TextButton, '确定');
find.descendant(of: find.byType(ListView), matching: find.text('商品A'));
```

我自己的建议是：

- 业务关键控件优先加 `Key`；
- 不要过度依赖层级路径；
- 文案会改、样式会变，Key 更稳定；
- 但 Key 也别满天飞，只给关键元素加。

### 4.5 matchers：不要只会 `findsOneWidget`

很多人写 Widget Test，断言永远只有：

```dart
expect(find.text('xxx'), findsOneWidget);
```

这当然有用，但太浅了。你还可以断言：

```dart
expect(find.byType(CircularProgressIndicator), findsNothing);
expect(find.textContaining('失败'), findsOneWidget);
expect(tester.widget<ElevatedButton>(find.byType(ElevatedButton)).enabled, isTrue);
expect(someValue, equals(3));
expect(list, isEmpty);
expect(exception, isA<FormatException>());
```

对于 Widget 属性，你可以直接拿实例出来验证：

```dart
testWidgets('button should be disabled when loading', (tester) async {
  await tester.pumpWidget(
    MaterialApp(
      home: ElevatedButton(
        onPressed: null,
        child: const Text('提交'),
      ),
    ),
  );

  final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
  expect(button.onPressed, isNull);
});
```

### 4.6 测试异步状态：加载、成功、失败三态

真实页面最值得测的，一般不是“能显示标题”，而是异步状态切换。

例如：

```dart
class UserProfilePage extends StatefulWidget {
  const UserProfilePage({super.key, required this.loader});

  final Future<String> Function() loader;

  @override
  State<UserProfilePage> createState() => _UserProfilePageState();
}

class _UserProfilePageState extends State<UserProfilePage> {
  bool loading = true;
  String? name;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.loader();
      if (!mounted) return;
      setState(() {
        name = result;
        loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        error = '加载失败';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Material(child: CircularProgressIndicator());
    if (error != null) return Material(child: Text(error!));
    return Material(child: Text(name!));
  }
}
```

测试：

```dart
testWidgets('should show loading then content', (tester) async {
  await tester.pumpWidget(
    UserProfilePage(
      loader: () async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
        return 'Mike';
      },
    ),
  );

  expect(find.byType(CircularProgressIndicator), findsOneWidget);

  await tester.pump(const Duration(milliseconds: 60));

  expect(find.text('Mike'), findsOneWidget);
  expect(find.byType(CircularProgressIndicator), findsNothing);
});

testWidgets('should show error text when loader throws', (tester) async {
  await tester.pumpWidget(
    UserProfilePage(
      loader: () async => throw Exception('boom'),
    ),
  );

  await tester.pump();
  await tester.pump();

  expect(find.text('加载失败'), findsOneWidget);
});
```

### 4.7 路由跳转测试

Flutter 页面跳转非常适合 Widget Test，因为不一定非要上真机。

```dart
class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      routes: {
        '/detail': (_) => const Scaffold(body: Text('详情页')),
      },
      home: Builder(
        builder: (context) {
          return Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).pushNamed('/detail'),
              child: const Text('去详情'),
            ),
          );
        },
      ),
    );
  }
}
```

测试：

```dart
testWidgets('should navigate to detail page', (tester) async {
  await tester.pumpWidget(const HomePage());

  await tester.tap(find.text('去详情'));
  await tester.pumpAndSettle();

  expect(find.text('详情页'), findsOneWidget);
});
```

### 4.8 Golden Test：把视觉回归也纳入测试

Golden Test 本质是截图对比测试。它适合发现：

- 布局错位；
- 字体溢出；
- 样式回退；
- 深色模式异常；
- 不同尺寸下的 UI 变形。

一个简单示例：

```dart
testWidgets('login page golden test', (tester) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));

  await tester.pumpWidget(
    const MaterialApp(
      home: Scaffold(
        body: Center(child: Text('登录页面')),
      ),
    ),
  );

  await expectLater(
    find.byType(Scaffold),
    matchesGoldenFile('goldens/login_page.png'),
  );
});
```

Golden Test 非常好用，但也很容易踩坑：

我会把 Golden Test 主要用于“视觉稳定性很重要、但逻辑又不复杂”的组件，比如卡片、列表项、空状态页、深浅色主题切换后的容器布局。它不适合替代交互测试，也不适合拿来证明业务正确，只适合解决一个问题：样式有没有悄悄变坏。

1. **字体不一致**：本地和 CI 的字体渲染可能不同；
2. **平台差异**：macOS 和 Linux 的抗锯齿结果可能不一致；
3. **动态内容**：时间、随机头像、网络图片会导致 golden 漂移；
4. **屏幕尺寸没固定**：不设定 SurfaceSize，结果可能不可复现。

我的做法通常是：

- 固定 `SurfaceSize`；
- 固定主题、字体、Locale、TextScaleFactor；
- 替换网络图片；
- 对动画组件先停住再截图。

### 4.9 Widget Test 的真实踩坑记录

#### 坑一：找不到 Widget，不是没渲染，而是你没包 `MaterialApp`

很多组件依赖：

- `Theme`
- `Navigator`
- `MediaQuery`
- `Localizations`
- `ScaffoldMessenger`

如果测试时直接 `pumpWidget(MyPage())`，可能就报错：

- No Material widget found
- No Directionality widget found
- Navigator operation requested with a context that does not include a Navigator

解决方式：为测试构建统一的 wrapper：

```dart
Widget buildTestableWidget(Widget child) {
  return MaterialApp(
    home: Scaffold(body: child),
  );
}
```

#### 坑二：列表懒加载导致 `find.text()` 找不到

`ListView.builder` 默认不会把所有子项都构建出来。如果目标项不在首屏，直接 `find.text('目标项')` 可能失败。

解决方法：

```dart
await tester.scrollUntilVisible(
  find.text('目标项'),
  300,
);
```

#### 坑三：异步回调结束后组件已销毁

如果代码里没有写 `if (!mounted) return;`，测试里非常容易出现：

- `setState() called after dispose()`

这类问题在手动测试里可能不容易复现，但 Widget Test 经常能精准打出来。

---

## 五、Integration Test：少而关键，专门保主链路

到了集成测试这一层，目标已经不是验证某个函数或者某个 Widget，而是验证：

> 用户从启动 App 到完成关键任务，这条真实链路有没有断。

### 5.1 Flutter 集成测试生态怎么选

历史上 Flutter 有过 `flutter_driver`，后来官方更推荐 `integration_test`。现在真实项目里常见三种方案：

1. **integration_test**：Flutter 官方当前主推；
2. **patrol**：在官方方案基础上增强，尤其擅长系统弹窗、原生交互；
3. **flutter_driver**：老方案，很多存量项目还在用，但新项目一般不再优先选择。

我的建议：

- 新项目优先 `integration_test`；
- 如果你需要处理系统权限、通知、原生弹窗，优先考虑 `patrol`；
- `flutter_driver` 只在维护老项目时继续兼容。

### 5.2 一个最小 integration_test 例子

目录结构通常是：

```dart
integration_test/
  app_test.dart
```

示例：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login flow smoke test', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('email')), 'mike@test.com');
    await tester.enterText(find.byKey(const Key('password')), '123456');
    await tester.tap(find.byKey(const Key('login_button')));

    await tester.pumpAndSettle(const Duration(seconds: 3));

    expect(find.text('首页'), findsOneWidget);
  });
}
```

运行方式：

```bash
flutter test integration_test/app_test.dart
```

或者针对真设备：

```bash
flutter test integration_test -d emulator-5554
```

### 5.3 使用 Patrol 处理系统弹窗

如果你的流程涉及：

- 相机权限；
- 定位权限；
- 通知权限；
- 原生日期选择器；
- WebView / 原生页面联动；

单靠 `integration_test` 会很吃力，这时 `patrol` 很有价值。

Patrol 风格的示例代码通常更贴近用户动作：

```dart
import 'package:patrol/patrol.dart';

void main() {
  patrolTest('grant location permission and open map page', ($) async {
    await $.pumpWidgetAndSettle(const MyApp());

    await $('打开地图').tap();
    await $.native.grantPermissionWhenInUse();

    await $('当前位置').waitUntilVisible();
    expect($('当前位置'), findsOneWidget);
  });
}
```

Patrol 的优势在于：

- 对系统权限处理更友好；
- API 更接近端到端测试语义；
- 对真机/模拟器自动化更完整。

### 5.4 `flutter_driver` 还值不值得讲

虽然新项目不推荐优先使用，但很多老 Flutter 项目里仍然保留了 `flutter_driver`。你至少应该知道它的处境：

- 历史包袱重；
- 配置复杂；
- 生态重心已经转向 `integration_test`；
- 若只是新建体系，没有必要再从它入手。

我维护过一个老项目，最开始全套自动化都是 `flutter_driver`。后来切换到 `integration_test` 时，最大的收益不是“API 更新”，而是：

- 测试与 Flutter 测试生态更统一；
- 编写和调试门槛下降；
- CI 配置更自然。

### 5.5 集成测试应该测哪些流程

集成测试最忌讳的，就是把所有人都觉得“重要”的流程不断往里塞，最后形成一个巨大、缓慢、脆弱的回归集。你应该反过来问：如果明天只能保留 5 条端到端用例，哪些失败会直接阻断业务或引发严重事故？这些才是集成测试的候选者。

千万不要把所有页面都写成端到端测试。集成测试最适合覆盖的是“主业务链路”与“高风险路径”：

1. App 冷启动；
2. 登录/退出登录；
3. 新用户引导；
4. 搜索 -> 列表 -> 详情；
5. 加购 -> 下单 -> 支付前确认；
6. 权限申请；
7. WebView 或原生页面跳转；
8. 崩溃历史多发场景。

我一般要求团队给每个核心业务只保留 1~3 条真正有代表性的 smoke flow，而不是贪多。

### 5.6 集成测试里的真实踩坑记录

#### 坑一：本地过、CI 挂，往往不是代码逻辑问题，而是环境问题

最常见原因：

- 模拟器没完全启动；
- 系统动画没关；
- 权限弹窗没处理；
- 网络依赖真实后端，测试环境不稳定；
- 首帧比本地慢得多，导致超时。

解决思路：

- 尽量接 mock server 或 staging 且数据固定；
- 统一模拟器镜像；
- 显式等待关键元素出现，不要盲目 `sleep`；
- 把系统动画关闭；
- 为测试环境准备稳定账号与数据。

#### 坑二：`pumpAndSettle()` 不是万能等待器

在集成测试里也一样，如果首页有无限轮播、广告动画、骨架屏动画，`pumpAndSettle()` 可能卡死。

正确做法是等待明确条件：

```dart
await tester.pump(const Duration(seconds: 1));
expect(find.text('首页'), findsOneWidget);
```

或者 Patrol 的：

```dart
await $('首页').waitUntilVisible();
```

#### 坑三：测试账号污染

我见过一个典型事故：集成测试每天自动把测试账号购物车塞满，结果第二天“购物车为空”场景全部失败。

所以端到端测试一定要考虑：

- 数据隔离；
- 测试前置清理；
- 幂等执行；
- 账号池轮换。

---

## 六、Mock、Fake 与依赖注入：测试稳定性的根基

无论是 Unit、Widget 还是 Integration，最终都绕不开一个问题：

> 你的依赖能不能被替换？

### 6.1 在 Widget Test 中注入假依赖

假设使用 Provider：

```dart
class AuthViewModel extends ChangeNotifier {
  AuthViewModel(this._useCase);

  final LoginUseCase _useCase;
  bool loading = false;
  String? error;

  Future<void> login(String email, String password) async {
    loading = true;
    error = null;
    notifyListeners();

    try {
      await _useCase(email, password);
    } catch (_) {
      error = '登录失败';
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
```

测试时可以用 Fake UseCase：

```dart
class FakeSuccessLoginUseCase extends LoginUseCase {
  FakeSuccessLoginUseCase() : super(_FakeRepository());

  @override
  Future<User> call(String email, String password) async {
    return User(id: '1', name: 'Mike');
  }
}
```

然后注入页面进行 Widget Test。这样你就不需要真网络，也不需要在页面里乱 mock HTTP。

### 6.2 不要让全局单例污染测试

最让我头疼的一类测试问题就是全局状态残留：

- 上个测试改了 ServiceLocator；
- 单例缓存没清空；
- shared_preferences mock 没 reset；
- Riverpod container 复用导致状态串测试。

建议：

- 每个测试用例独立创建依赖容器；
- `setUp()` 初始化，`tearDown()` 清理；
- 避免在测试进程共享可变全局状态。

例如使用 `get_it` 时：

```dart
final getIt = GetIt.instance;

setUp(() {
  getIt.reset();
  getIt.registerFactory<AuthRepository>(() => MockAuthRepository());
});

tearDown(() async {
  await getIt.reset();
});
```

### 6.3 什么时候该用真依赖

不是所有测试都应该 mock 到底。过度 mock 会让测试失真。

经验原则：

- 数据解析、格式转换：尽量用真对象；
- 状态管理转换：尽量用真状态容器；
- 网络、数据库、平台接口：边界处替换；
- 端到端主流程：尽量接近真实，但控制环境。

换句话说：**不要 mock 你自己的核心业务逻辑，只 mock 外部边界。**

---

## 七、覆盖率：lcov 指标怎么看，才不至于被数字骗了

Flutter 统计测试覆盖率通常会生成 `lcov.info`。

运行方式：

```bash
flutter test --coverage
```

生成后一般在：

```bash
coverage/lcov.info
```

如果本机装了 lcov / genhtml，还可以生成 HTML 报告：

```bash
genhtml coverage/lcov.info -o coverage/html
```

### 7.1 覆盖率高不等于测试质量高

这是一个必须强调的事实。

我见过两个极端：

1. 覆盖率只有 20%，但关键业务逻辑和主流程测得很扎实；
2. 覆盖率 85%，但大量测试只是把页面 pump 出来，几乎不验证真正行为。

所以我更推荐按层看：

- Domain / UseCase / Repository：尽量高；
- 简单样板代码：不必强求；
- 页面：重点覆盖关键交互和状态分支；
- 集成测试：不看覆盖率，看关键链路是否被保住。

### 7.2 覆盖率实践建议

我自己常用的最低标准：

- 核心 domain 逻辑：80%+；
- repository 映射和错误处理：70%+；
- 关键页面：至少有核心状态与交互测试；
- 整体项目：不用为追 100% 去写垃圾测试。

另外，一个真实建议：

> 把“新增代码必须有对应测试”比“全量覆盖率必须上 85%”更有用。

因为后者很容易逼出大量凑数测试。

---

## 八、性能测试：不要等用户说卡再找原因

Flutter 测试不只有正确性，还应该包括性能基线。

### 8.1 性能测试关注什么

在业务项目里，我通常更关注这些：

- 首屏渲染耗时；
- 列表滚动掉帧；
- 某个复杂页面 build 次数异常；
- 大图/动画导致的 raster 卡顿；
- 某次重构后启动时间明显变慢。

### 8.2 用 integration_test 做简单性能采样

Flutter 的 `integration_test` 能结合性能工具输出结果。思路通常是：

- 跑真机/模拟器；
- 执行关键交互；
- 采集 timeline；
- 观察 frame build/raster 情况。

一个简化示例：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized()
      as IntegrationTestWidgetsFlutterBinding;

  testWidgets('scroll performance test', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    await binding.traceAction(() async {
      await tester.fling(find.byType(ListView), const Offset(0, -1000), 3000);
      await tester.pumpAndSettle();
    });
  });
}
```

当然，性能测试比功能测试更依赖稳定环境，所以我一般把它当作：

- 回归对比；
- 趋势观察；
- 性能退化预警。

而不是把某个绝对数值当成教条。

### 8.3 性能测试踩坑

最大的坑是：

- 在本地 debug 模式测性能；
- 用不稳定模拟器结果做硬阈值；
- 把网络抖动当成渲染问题；
- 一边录屏一边跑性能用例。

性能测试一定尽量接近固定环境、固定设备、固定模式，否则结论噪音会非常大。

另外，性能测试非常适合和“历史基线”结合起来看，而不是只看一次结果。比如首页冷启动从 1.8s 退化到 2.6s，虽然都还没到完全不可用的程度，但这类趋势变化往往比某次偶发抖动更值得重视。

---

## 九、CI 集成：没有进流水线的测试，长期看等于没写

如果测试只能在开发者本机运行，那它很快就会失去约束力。真正能产生工程价值的测试，必须进入 CI。

### 9.1 一条典型的 Flutter CI 流水线

至少建议有这些步骤：

1. 拉代码；
2. 安装 Flutter；
3. `flutter pub get`；
4. `dart format --set-exit-if-changed .`；
5. `flutter analyze`；
6. `flutter test --coverage`；
7. 如有需要，执行 Golden Test；
8. 对主分支或 nightly 执行 Integration Test。

例如 GitHub Actions 的简化思路：

```yaml
name: flutter-ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.29.0'
      - run: flutter pub get
      - run: dart format --output=none --set-exit-if-changed .
      - run: flutter analyze
      - run: flutter test --coverage
```

### 9.2 集成测试在 CI 的落地策略

不要一上来就所有 PR 都跑全量真机集成测试，成本太高、速度太慢。

更实用的方式通常是分层：

把所有测试都塞进同一条流水线，通常不是工程化，而是制造拥堵。PR 需要的是快速反馈，所以应该优先跑快而稳的测试；而成本高、环境依赖重的测试，可以放到主干或夜间。这样既保证反馈速度，也不会让团队因为 CI 太慢而逐渐失去耐心。

- **PR 必跑**：格式化、静态分析、Unit Test、Widget Test；
- **主干合并后跑**：关键 smoke integration test；
- **夜间任务跑**：更完整的端到端回归、golden 更新检查、性能采样。

### 9.3 Golden Test 在 CI 的注意事项

Golden Test 很依赖环境一致性，所以建议：

- 固定 CI 平台；
- 固定 Flutter 版本；
- 固定字体和渲染环境；
- Golden 基准图只允许通过专门流程更新。

否则你会遇到一种非常烦躁的场景：代码没变，截图 diff 天天变。

### 9.4 CI 里的真实踩坑记录

#### 坑一：本地通过，CI 全红，因为 locale 不一致

某次表单页面本地用中文环境截图正常，CI 默认英文环境，日期文案长度变化，Golden 全挂。

解决：测试里显式设置 locale，不依赖系统默认值。

#### 坑二：并发测试抢共享资源

例如多个测试同时读写同一个临时目录、同一个测试账号、同一个本地端口，CI 上特别容易炸。

解决：

- 数据隔离；
- 临时目录唯一化；
- 账号池；
- 避免并发共享外部资源。

---

## 十、一个可执行的落地方案：从 0 到 1 建立 Flutter 三层测试体系

如果你的项目目前测试很少，我不建议直接大跃进。更现实的推进方式是下面这样。

### 阶段一：先补底层 Unit Test

优先级：

1. 金额/优惠/库存等核心规则；
2. 登录鉴权与 token 刷新逻辑；
3. Repository 映射和异常转换；
4. 状态管理器的关键状态迁移。

目标：先把最容易出线上事故的逻辑守住。

### 阶段二：给关键页面补 Widget Test

优先级：

1. 登录页；
2. 列表/详情页；
3. 下单确认页；
4. 搜索、筛选、空态、错误态页面。

目标：覆盖加载/成功/失败三态，以及关键交互。

### 阶段三：补少量高价值 Integration Test

优先级：

1. 冷启动；
2. 登录；
3. 搜索到详情；
4. 下单主链路；
5. 权限申请。

目标：用最少的端到端用例保住主业务。

### 阶段四：引入 Golden、覆盖率和 CI 报表

目标：

- 把视觉回归和测试数据透明化；
- 让测试结果持续约束团队，而不是依赖个人自觉。

---

## 十一、我总结的一套测试编写原则

最后给一套我自己在 Flutter 项目里长期使用的“写测试原则”，基本能帮你绕开大多数坑。

### 11.1 测行为，不测实现

- 少关心内部怎么做；
- 多关心输入后输出是否正确；
- 多关心用户可观察到的结果。

### 11.2 能下沉就下沉

- 能用单测验证的，不要写到 Widget Test；
- 能用 Widget Test 验证的，不要拖到 Integration Test。

### 11.3 控制测试数据

- 不要依赖线上环境；
- 不要依赖随机数据；
- 不要依赖当前系统时间；
- 不要依赖不可复现状态。

### 11.4 每次修 bug，优先补回归测试

这是最有效的测试增量策略。

一旦线上出过 bug，第一件事不是“修完就发”，而是：

1. 先写一个能复现 bug 的测试；
2. 看它失败；
3. 修代码；
4. 看测试转绿。

这样测试集就会逐渐沉淀成你的事故免疫系统。

### 11.5 不追求面子覆盖率，追求真实防故障能力

如果你已经在团队里推动测试建设，很可能会遇到一句话：“先把业务做完，测试以后再补。”我的经验是，测试确实可以分阶段推进，但不能无限延期。因为一旦代码规模起来，再补测试的成本会比同步建设高很多。测试不是锦上添花，而是控制复杂度扩散速度的工具。

一套好的测试体系，目标从来不是让报表好看，而是：

- 让你敢重构；
- 让回归更快；
- 让线上事故更少；
- 让团队协作成本更低。

---

## 十二、结语：测试不是负担，而是 Flutter 工程化的分水岭

Flutter 上手很快，所以很多项目早期都容易形成一种错觉：页面写得出来、功能点得通、发版也不慢，好像就够了。

但一旦项目进入多人协作、持续迭代、复杂业务阶段，没有测试体系的代价会越来越明显：

- 改动不敢动；
- 回归靠人肉；
- 重构像拆炸弹；
- 线上事故常常来自“看似微小”的代码修改。

真正成熟的 Flutter 工程实践，不是会不会写某个 `testWidgets`，而是能不能把 **Unit Test、Widget Test、Integration Test** 组合成一套分层明确、成本可控、长期稳定的测试体系。

如果让我把全文压缩成一句话，那就是：

> 用 Unit Test 守住规则，用 Widget Test 守住交互，用 Integration Test 守住主链路；再用覆盖率、Golden、性能测试和 CI，把这套体系真正嵌入团队开发流程。

当你把这套体系建立起来以后，测试就不再是“额外工作”，而会变成 Flutter 项目持续交付能力的一部分。

而且很现实地说，真正让团队从“能写 Flutter”进化到“能稳定交付 Flutter”的，往往也就是这一步。

## 相关阅读

- [Flutter + CI/CD 实战：GitHub Actions 自动化构建、测试、发布](/categories/Flutter/Flutter-CICD-实战-GitHub-Actions-自动化构建测试发布/)
- [Flutter 性能优化实战：DevTools 分析、渲染优化、包体积裁剪](/categories/Flutter/Flutter-性能优化实战-DevTools-分析-渲染优化-包体积裁剪/)
- [Flutter 状态管理实战：Riverpod/Bloc/GetX 选型对比与最佳实践](/categories/Flutter/Flutter-状态管理实战-Riverpod-Bloc-GetX-选型对比与最佳实践/)