# Firebase 与 BaaS (Backend as a Service)

## 定义

Firebase 是 Google 提供的一套 BaaS（Backend as a Service）平台，为移动和 Web 应用提供后端基础设施服务，
无需开发者自行搭建和维护服务器。在 Flutter 生态中，Firebase 是最主流的后端解决方案之一，
通过官方插件 `firebase_core`、`cloud_firestore`、`firebase_auth`、`firebase_messaging` 等实现深度集成。

BaaS 的核心理念是将后端复杂性抽象为 SDK 调用，让前端开发者能够快速构建具有用户认证、数据存储、
推送通知等功能的完整应用。

### 核心服务组件

| 服务 | 用途 | Flutter 插件 |
|------|------|-------------|
| Firebase Auth | 用户认证（邮箱、手机号、社交登录） | `firebase_auth` |
| Cloud Firestore | NoSQL 实时数据库 | `cloud_firestore` |
| Realtime Database | 轻量级实时数据库 | `firebase_database` |
| Cloud Storage | 文件存储（图片、视频等） | `firebase_storage` |
| Cloud Functions | 无服务器函数（Node.js/Python） | `cloud_functions` |
| FCM | 推送通知 | `firebase_messaging` |
| Analytics | 用户行为分析 | `firebase_analytics` |
| Crashlytics | 崩溃报告 | `firebase_crashlytics` |
| Remote Config | 远程配置 | `firebase_remote_config` |

## 核心原理

### 1. Firebase Auth 认证体系

Firebase Auth 提供多因素、多方式的用户认证：

```dart
// 邮箱密码注册
await FirebaseAuth.instance.createUserWithEmailAndPassword(
  email: 'user@example.com',
  password: 'securePassword123',
);

// 邮箱密码登录
final credential = await FirebaseAuth.instance.signInWithEmailAndPassword(
  email: 'user@example.com',
  password: 'securePassword123',
);

// Google 登录
final googleUser = await GoogleSignIn().signIn();
final googleAuth = await googleUser!.authentication;
final credential = GoogleAuthProvider.credential(
  accessToken: googleAuth.accessToken,
  idToken: googleAuth.idToken,
);
await FirebaseAuth.instance.signInWithCredential(credential);

// 监听认证状态变化
FirebaseAuth.instance.authStateChanges().listen((User? user) {
  if (user == null) {
    print('用户已登出');
  } else {
    print('用户已登录: ${user.uid}');
  }
});
```

**认证流程**：
1. 客户端通过 SDK 发起认证请求
2. Firebase Auth 服务器验证凭据
3. 返回 ID Token（JWT）给客户端
4. 客户端使用 ID Token 访问其他 Firebase 服务
5. Security Rules 根据 Token 中的 uid 进行权限校验

### 2. Cloud Firestore 数据模型

Firestore 采用文档-集合（Document-Collection）的 NoSQL 数据模型：

```
Collection: users
  └── Document: user_abc123
        ├── name: "张三"
        ├── email: "zhangsan@example.com"
        └── SubCollection: posts
              └── Document: post_xyz789
                    ├── title: "Hello World"
                    └── createdAt: Timestamp
```

```dart
// 写入数据
await FirebaseFirestore.instance.collection('users').doc('user_abc123').set({
  'name': '张三',
  'email': 'zhangsan@example.com',
  'createdAt': FieldValue.serverTimestamp(),
});

// 实时监听数据变化
FirebaseFirestore.instance
    .collection('users')
    .doc('user_abc123')
    .snapshots()
    .listen((snapshot) {
  final data = snapshot.data();
  print('用户数据更新: $data');
});

// 复合查询
final query = FirebaseFirestore.instance
    .collection('posts')
    .where('authorId', isEqualTo: 'user_abc123')
    .orderBy('createdAt', descending: true)
    .limit(20);

// 批量写入
final batch = FirebaseFirestore.instance.batch();
batch.set(docRef1, data1);
batch.update(docRef2, data2);
batch.delete(docRef3);
await batch.commit();

// 事务
await FirebaseFirestore.instance.runTransaction((transaction) async {
  final snapshot = await transaction.get(docRef);
  final newLikes = snapshot.get('likes') + 1;
  transaction.update(docRef, {'likes': newLikes});
});
```

**安全规则（Security Rules）**：
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /posts/{postId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if request.auth.uid == resource.data.authorId;
      allow delete: if request.auth.uid == resource.data.authorId;
    }
  }
}
```

### 3. FCM 推送通知

Firebase Cloud Messaging 实现跨平台推送：

```dart
// 初始化并获取 Token
final messaging = FirebaseMessaging.instance;

// 请求权限（iOS 必需）
final settings = await messaging.requestPermission(
  alert: true,
  badge: true,
  sound: true,
);

// 获取设备 Token
final token = await messaging.getToken();
print('FCM Token: $token');

// 监听前台消息
FirebaseMessaging.onMessage.listen((RemoteMessage message) {
  print('收到前台消息: ${message.notification?.title}');
});

// 监听后台消息点击
FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
  print('用户点击通知: ${message.data}');
});

// 处理应用终止状态下的通知
final initialMessage = await messaging.getInitialMessage();
if (initialMessage != null) {
  // 从通知冷启动应用
}
```

**推送架构**：
- 客户端 → Token 注册 → FCM 服务器
- 服务端 → 发送请求（指定 Token/Topic/Condition） → FCM 服务器 → 客户端
- 支持：单播、组播、主题订阅、条件推送

### 4. 离线同步机制

Firestore 内置离线持久化：

```dart
// 启用离线持久化（默认开启）
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);

// 离线写入 — 即使无网络也会写入本地缓存
await docRef.set({'title': '离线创建的文章'});

// 网络恢复后自动同步到服务器
// 通过 snapshot 监听获取同步状态
docRef.snapshots().listen((snapshot) {
  print('数据来源: ${snapshot.metadata.isFromCache ? "缓存" : "服务器"}');
  print('是否有待同步写入: ${snapshot.metadata.hasPendingWrites}');
});
```

### 5. Cloud Functions 无服务器逻辑

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 触发器：新用户注册时初始化数据
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
  await admin.firestore().collection('users').doc(user.uid).set({
    email: user.email,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    role: 'user',
  });
});

// HTTP 函数：可通过 Flutter 调用
exports.processPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '请先登录');
  }
  // 处理支付逻辑...
  return { success: true, orderId: '...' };
});
```

Flutter 调用：
```dart
final result = await FirebaseFunctions.instance
    .httpsCallable('processPayment')
    .call({'amount': 99.00, 'currency': 'CNY'});
print(result.data); // {success: true, orderId: '...'}
```

### 6. 数据流架构

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Flutter App │────▶│ Firebase SDK │────▶│  Firebase    │
│  (UI Layer)  │◀────│  (Local      │◀────│  Backend     │
│              │     │   Cache)     │     │  (Cloud)     │
└─────────────┘     └──────────────┘     └──────────────┘
       │                    │                     │
       │              Offline Sync          Cloud Functions
       │                                    Security Rules
       │                                         │
       ▼                                         ▼
  State Management                    External Services
  (Riverpod/Bloc)                    (Stripe, SendGrid...)
```

## 实战案例

详细实战教程请参阅博客文章：

- [Flutter Firebase 实战：Auth/Firestore/FCM 一体化后端方案](/categories/Flutter/Flutter-Firebase-实战-Auth-Firestore-FCM-一体化后端方案/)

该文章完整演示了如何构建一个集用户认证、实时数据同步、推送通知于一体的 Flutter 应用后端方案。

## 相关概念

- **状态管理** — Firebase 数据流需要与 [状态管理](/wiki/Flutter/状态管理/) 方案（如 Riverpod、Bloc）配合使用
- **网络与数据层** — Firebase 作为 [网络与数据层](/wiki/Flutter/网络与数据层/) 的重要实现之一
- **架构模式** — BaaS 模式影响 [架构模式](/wiki/Flutter/架构模式/) 的分层设计
- **CICD与发布** — Firebase App Distribution 可用于 [CI/CD 与发布](/wiki/Flutter/CICD与发布/) 流程中的测试分发
- **测试体系** — Firebase 服务的 mock 测试是 [测试体系](/wiki/Flutter/测试体系/) 中的重要环节
- **性能优化** — Firestore 查询优化属于 [性能优化](/wiki/Flutter/性能优化/) 范畴

## 常见问题

### Q1: Firestore 免费额度是多少？
Firestore 免费套餐（Spark Plan）包含：每天 50,000 次读取、20,000 次写入、20,000 次删除、1 GB 存储。
超出需使用 Blaze Plan（按量付费）。

### Q2: 如何选择 Firestore 还是 Realtime Database？
- **Firestore**：更强大的查询、更好的扩展性、支持复合索引、推荐新项目使用
- **Realtime Database**：更适合简单数据结构、低延迟实时同步、数据量较小时更便宜

### Q3: Firebase Auth 的 Token 何时过期？如何刷新？
ID Token 默认 1 小时过期，SDK 会自动刷新。手动刷新：
```dart
final user = FirebaseAuth.instance.currentUser;
final newToken = await user?.getIdToken(true); // force refresh
```

### Q4: FCM 推送在 iOS 上不工作怎么办？
1. 确保已配置 APNs 证书并上传到 Firebase Console
2. 确保请求了通知权限
3. 在真机上测试（模拟器不支持推送）
4. 检查 `GoogleService-Info.plist` 配置正确

### Q5: 如何减少 Firestore 读取次数（控制成本）？
1. 使用 `withConverter` 类型安全查询
2. 合理设置缓存策略
3. 使用聚合查询（`count()`、`sum()`、`average()`）替代完整文档读取
4. 避免在 `build` 方法中创建监听器
5. 使用 `limit()` 限制查询结果

### Q6: Cloud Functions 冷启动延迟如何优化？
1. 使用最小实例数（`minInstances: 1`）— 会产生额外费用
2. 减少依赖包体积
3. 使用全局变量复用连接池
4. 选择更接近用户的区域部署

### Q7: 如何实现 Firebase 的多环境（dev/staging/prod）？
使用 Firebase Projects 分离环境，通过 `--dart-define` 或 flavor 机制切换：
```dart
// 使用 --dart-define=FIREBASE_ENV=prod
const env = String.fromEnvironment('FIREBASE_ENV', defaultValue: 'dev');
```
