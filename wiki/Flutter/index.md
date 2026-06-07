# Flutter 知识图谱索引

> 基于 21 篇实战博文构建的 Flutter 开发知识网络。按主题域组织，标注核心知识点与博文间的前置/关联关系。

---

## 知识域总览

| # | 知识域 | 篇数 | 关键词 |
|---|--------|------|--------|
| 1 | 语言与 UI 基础 | 4 | Dart, Widget, 动画, 布局 |
| 2 | 状态管理 | 1 | Riverpod, Bloc, GetX |
| 3 | 路由与导航 | 1 | GoRouter, 深链接 |
| 4 | 网络与数据 | 3 | Dio, REST API, 本地存储 |
| 5 | 平台集成与混合开发 | 2 | Platform Channel, 原生模块 |
| 6 | 后端服务集成 | 2 | Firebase, Laravel API |
| 7 | 功能模块 | 4 | 推送通知, WebSocket, 国际化, 暗黑模式 |
| 8 | 工程化与质量保障 | 4 | CI/CD, 测试, Crashlytics, 性能优化 |
| 9 | 发布与运维 | 2 | 多平台打包, 应用内更新 |

---

## 1. 语言与 UI 基础

### 📄 Flutter 3.x 实战：Dart 语言基础与 Widget 体系详解

- **文件**: `Flutter-3x-实战-Dart-语言基础与-Widget-体系详解.md`
- **关键词**: `Dart`, `Widget`, `StatelessWidget`, `StatefulWidget`, `InheritedWidget`, `生命周期`
- **知识点**:
  - Dart 语言核心语法（类型系统、异步编程、泛型）
  - Widget 树 / Element 树 / RenderObject 树三棵树原理
  - StatelessWidget vs StatefulWidget 生命周期
  - 常用基础 Widget 分类与使用场景
- **后续关联** → [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践) · [自定义 Widget](#-flutter-自定义-widget-实战custompainter-动画-手势处理) · [响应式布局](#-flutter-响应式布局实战屏幕适配折叠屏平板适配策略)

### 📄 Flutter 自定义 Widget 实战：CustomPainter 动画与手势处理

- **文件**: `Flutter-自定义-Widget-实战-CustomPainter-动画-手势处理.md`
- **关键词**: `CustomPainter`, `Canvas`, `Animation`, `GestureDetector`, `Tween`
- **知识点**:
  - CustomPainter 与 Canvas 绑定绘制
  - AnimationController / Tween 动画体系
  - 手势识别与冲突处理（GestureDetector vs Listener）
  - 自绘组件性能优化（RepaintBoundary）
- **前置依赖** ← [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → [性能优化](#-flutter-性能优化实战devtools-分析-渲染优化-包体积裁剪)

### 📄 Flutter 响应式布局实战：屏幕适配、折叠屏与平板适配策略

- **文件**: `Flutter-响应式布局实战-屏幕适配-折叠屏-平板适配策略.md`
- **关键词**: `MediaQuery`, `LayoutBuilder`, `屏幕适配`, `折叠屏`, `平板`, `断点`
- **知识点**:
  - MediaQuery 与 LayoutBuilder 获取约束信息
  - 断点系统设计（mobile / tablet / desktop）
  - 折叠屏铰链状态处理
  - 自适应布局模式（单栏 / 双栏 / 侧边栏）
- **前置依赖** ← [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → [国际化](#-flutter-国际化实战flutter_localizations-多语言与-rtl-支持) · [暗黑模式](#-flutter-暗黑模式实战themedata-动态切换与主题持久化)

### 📄 Flutter 暗黑模式实战：ThemeData 动态切换与主题持久化

- **文件**: `Flutter-暗黑模式实战-ThemeData-动态切换与主题持久化.md`
- **关键词**: `ThemeData`, `暗黑模式`, `Material Design 3`, `主题持久化`, `动态切换`
- **知识点**:
  - ThemeData 构建与语义化颜色体系
  - 亮/暗主题动态切换（ValueNotifier / Provider）
  - 主题持久化存储方案
  - Material 3 ColorScheme 适配
- **前置依赖** ← [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践) · [本地存储](#-flutter-本地存储实战hive-isar-sqlite-数据持久化方案对比)
- **后续关联** → [国际化](#-flutter-国际化实战flutter_localizations-多语言与-rtl-支持)

---

## 2. 状态管理

### 📄 Flutter 状态管理实战：Riverpod/Bloc/GetX 选型对比与最佳实践

- **文件**: `Flutter-状态管理实战-Riverpod-Bloc-GetX-选型对比与最佳实践.md`
- **关键词**: `Riverpod`, `Bloc`, `GetX`, `状态管理`, `依赖注入`, `Provider`
- **知识点**:
  - 三种方案架构设计对比（声明式 vs 响应式 vs 侵入式）
  - 分页加载、状态共享的各自实现模式
  - 依赖注入与作用域管理
  - 测试友好度与团队协作成本评估
  - 选型策略：小/中/大型项目推荐
- **前置依赖** ← [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → 被多个模块依赖：路由 · 网络请求 · 暗黑模式 · Firebase · 推送通知

---

## 3. 路由与导航

### 📄 Flutter 路由实战：GoRouter 声明式路由与深链接集成踩坑记录

- **文件**: `Flutter-路由实战-GoRouter-声明式路由与深链接集成踩坑记录.md`
- **关键词**: `GoRouter`, `声明式路由`, `深链接`, `App Links`, `Universal Links`, `路由守卫`
- **知识点**:
  - GoRouter 声明式路由配置与路由表设计
  - 嵌套导航（ShellRoute / StatefulShellRoute）
  - 路由守卫与重定向（登录态校验）
  - Android App Links / iOS Universal Links 集成
  - Flutter Web URL 策略（Hash vs Path）
- **前置依赖** ← [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解) · [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践)
- **后续关联** → [混合开发](#-flutter-混合开发实战与原生-ios-android-模块集成platform-channel)

---

## 4. 网络与数据

### 📄 Flutter 网络请求实战：Dio 封装、拦截器、错误处理与 Token 刷新

- **文件**: `Flutter-网络请求实战-Dio-封装拦截器错误处理与-Token-刷新踩坑记录.md`
- **关键词**: `Dio`, `HTTP`, `拦截器`, `Token 刷新`, `请求重试`, `错误处理`
- **知识点**:
  - Dio 实例配置（BaseOptions、超时、日志）
  - 拦截器链设计（认证 → 日志 → 错误处理 → 重试）
  - Token 自动刷新与请求队列并发控制
  - 统一错误模型与 UI 层错误映射
  - 文件上传下载与进度回调
  - 测试 Mock 策略
- **前置依赖** ← [Dart 基础](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → [Laravel API 对接](#-flutter-laravel-api-实战restful-对接-认证-分页-错误处理) · [Firebase](#-flutter-firebase-实战-auth-firestore-fcm-一体化后端方案)

### 📄 Flutter Laravel API 实战：RESTful 对接、认证、分页与错误处理

- **文件**: `Flutter-Laravel-API-实战-RESTful-对接-认证-分页-错误处理.md`
- **关键词**: `Laravel`, `RESTful API`, `Sanctum`, `分页`, `认证`, `后端对接`
- **知识点**:
  - Laravel Sanctum 认证流程与 Flutter 端实现
  - RESTful 分页（Cursor / Offset）客户端处理
  - 统一错误码体系与异常映射
  - 文件上传与多图片处理
  - 与 Dio 封装层的整合实践
- **前置依赖** ← [Dio 网络请求](#-flutter-网络请求实战dio-封装拦截器错误处理与-token-刷新) · [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践)
- **后续关联** → [WebSocket](#-flutter-websocket-实战实时聊天-通知推送-长连接管理)

### 📄 Flutter 本地存储实战：Hive / Isar / SQLite 数据持久化方案对比

- **文件**: `Flutter-本地存储实战-Hive-Isar-SQLite-数据持久化方案对比.md`
- **关键词**: `Hive`, `Isar`, `SQLite`, `本地存储`, `数据持久化`, `NoSQL`
- **知识点**:
  - 三种方案特性对比（KV / 文档 / 关系型）
  - 数据模型定义与迁移策略
  - 读写性能基准测试
  - 加密存储方案
  - 选型建议：轻量缓存 vs 结构化查询 vs 全文搜索
- **前置依赖** ← [Dart 基础](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → [暗黑模式主题持久化](#-flutter-暗黑模式实战themedata-动态切换与主题持久化) · [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)

---

## 5. 平台集成与混合开发

### 📄 Flutter 混合开发实战：与原生 iOS/Android 模块集成（Platform Channel）

- **文件**: `Flutter-混合开发实战-与原生-iOS-Android-模块集成-Platform-Channel.md`
- **关键词**: `Platform Channel`, `MethodChannel`, `EventChannel`, `原生模块`, `混合开发`
- **知识点**:
  - MethodChannel / EventChannel / BasicMessageChannel 选型
  - 数据类型编解码与自定义 Codec
  - iOS (Swift/ObjC) 与 Android (Kotlin/Java) 端实现
  - 线程模型与主线程调度
  - PlatformView 嵌入原生视图
- **前置依赖** ← [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
- **后续关联** → [推送通知](#-flutter-推送通知实战fcm-apns-双通道集成与厂商通道适配) · [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略) · [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程)

---

## 6. 后端服务集成

### 📄 Flutter Firebase 实战：Auth / Firestore / FCM 一体化后端方案

- **文件**: `Flutter-Firebase-实战-Auth-Firestore-FCM-一体化后端方案.md`
- **关键词**: `Firebase`, `Auth`, `Firestore`, `FCM`, `云函数`, `BaaS`
- **知识点**:
  - Firebase Auth 集成（邮箱/密码、Google、Apple 登录）
  - Firestore 数据模型设计与实时监听
  - Firebase Cloud Messaging 推送集成
  - 安全规则（Security Rules）编写
  - 离线持久化与同步策略
- **前置依赖** ← [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践)
- **后续关联** → [FCM 推送通知](#-flutter-推送通知实战fcm-apns-双通道集成与厂商通道适配) · [Crashlytics](#-flutter-crashlytics-实战sentry-firebase-crashlytics-错误监控集成)

### 📄 Flutter Laravel API 实战：RESTful 对接、认证、分页与错误处理

- *(见 [网络与数据](#-flutter-laravel-api-实战restful-对接-认证-分页-错误处理))*

---

## 7. 功能模块

### 📄 Flutter 推送通知实战：FCM / APNs 双通道集成与厂商通道适配

- **文件**: `Flutter-推送通知实战-FCM-APNs-双通道集成与厂商通道适配.md`
- **关键词**: `FCM`, `APNs`, `推送通知`, `厂商通道`, `华为`, `小米`, `OPPO`
- **知识点**:
  - FCM（Android）与 APNs（iOS）双通道配置
  - 前台/后台/终止状态下的消息处理
  - 国内厂商通道（华为 HMS、小米 MiPush、OPPO Push）适配
  - 通知分组、富媒体通知、动作按钮
  - 推送 Token 管理与后端注册
- **前置依赖** ← [混合开发/Platform Channel](#-flutter-混合开发实战与原生-ios-android-模块集成platform-channel) · [Firebase](#-flutter-firebase-实战-auth-firestore-fcm-一体化后端方案)
- **后续关联** → [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)

### 📄 Flutter WebSocket 实战：实时聊天、通知推送与长连接管理

- **文件**: `Flutter-WebSocket-实战-实时聊天-通知推送-长连接管理.md`
- **关键词**: `WebSocket`, `实时通信`, `心跳机制`, `断线重连`, `长连接`
- **知识点**:
  - WebSocket 连接生命周期管理
  - 心跳保活与断线重连策略（指数退避）
  - 消息队列与离线消息缓存
  - 实时聊天 UI 实现（消息列表、输入状态）
  - 与 REST API 混合架构
- **前置依赖** ← [Dio 网络请求](#-flutter-网络请求实战dio-封装拦截器错误处理与-token-刷新) · [Laravel API](#-flutter-laravel-api-实战restful-对接-认证-分页-错误处理)
- **后续关联** → [应用内更新版本检测](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)

### 📄 Flutter 国际化实战：flutter_localizations 多语言与 RTL 支持

- **文件**: `Flutter-国际化实战-flutter_localizations-多语言与-RTL-支持.md`
- **关键词**: `国际化`, `i18n`, `flutter_localizations`, `ARB`, `RTL`, `多语言`
- **知识点**:
  - flutter_localizations 与 intl 集成配置
  - ARB 文件管理与代码生成
  - RTL（从右到左）布局适配
  - 动态语言切换与持久化
  - 日期/数字/货币本地化格式
- **前置依赖** ← [Dart 基础](#-flutter-3x-实战dart-语言基础与-widget-体系详解) · [响应式布局](#-flutter-响应式布局实战屏幕适配折叠屏平板适配策略)
- **后续关联** → [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程)

### 📄 Flutter 暗黑模式实战：ThemeData 动态切换与主题持久化

- *(见 [语言与 UI 基础](#-flutter-暗黑模式实战themedata-动态切换与主题持久化))*

---

## 8. 工程化与质量保障

### 📄 Flutter 测试实战：Unit / Widget / Integration 三层测试体系

- **文件**: `Flutter-测试实战-Unit-Widget-Integration-三层测试体系.md`
- **关键词**: `Unit Test`, `Widget Test`, `Integration Test`, `Mockito`, `测试驱动`
- **知识点**:
  - Unit Test：纯逻辑单元测试与 Mockito/Build_runner 生成 Mock
  - Widget Test：pumpWidget / pumpAndSettle / Finder 体系
  - Integration Test：端到端自动化（patrol / integration_test 包）
  - 测试覆盖率报告与 CI 集成
  - 测试金字塔策略与优先级
- **前置依赖** ← [Dart 基础](#-flutter-3x-实战dart-语言基础与-widget-体系详解) · [状态管理](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践)
- **后续关联** → [CI/CD](#-flutter-cicd-实战github-actions-自动化构建测试发布)

### 📄 Flutter CI/CD 实战：GitHub Actions 自动化构建测试发布

- **文件**: `Flutter-CICD-实战-GitHub-Actions-自动化构建测试发布.md`
- **关键词**: `CI/CD`, `GitHub Actions`, `自动化构建`, `Fastlane`, `发布流水线`
- **知识点**:
  - GitHub Actions Flutter 工作流配置
  - 多平台并行构建矩阵（iOS / Android / Web / Desktop）
  - 自动化测试 Gate（Unit + Widget + Integration）
  - Fastlane 集成与 App Store / Play Store 自动发布
  - 构建缓存与 Artifacts 管理
  - 环境变量与签名文件安全注入
- **前置依赖** ← [测试体系](#-flutter-测试实战unit-widget-integration-三层测试体系) · [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程)
- **后续关联** → [热更新](#-flutter-热更新实战shorebird-code-push-方案与风险控制)

### 📄 Flutter Crashlytics 实战：Sentry / Firebase Crashlytics 错误监控集成

- **文件**: `Flutter-Crashlytics-实战-Sentry-Firebase-Crashlytics-错误监控集成.md`
- **关键词**: `Sentry`, `Firebase Crashlytics`, `错误监控`, `崩溃收集`, `符号表`
- **知识点**:
  - Sentry 与 Firebase Crashlytics 功能对比与选型
  - Flutter 端 SDK 初始化与配置
  - dSYM / ProGuard 映射文件上传
  - 自定义面包屑（Breadcrumbs）与用户上下文
  - 告警规则与 On-Call 集成
- **前置依赖** ← [Firebase 集成](#-flutter-firebase-实战-auth-firestore-fcm-一体化后端方案) · [CI/CD](#-flutter-cicd-实战github-actions-自动化构建测试发布)
- **后续关联** → [性能优化](#-flutter-性能优化实战devtools-分析-渲染优化-包体积裁剪)

### 📄 Flutter 性能优化实战：DevTools 分析、渲染优化与包体积裁剪

- **文件**: `Flutter-性能优化实战-DevTools-分析-渲染优化-包体积裁剪.md`
- **关键词**: `DevTools`, `性能优化`, `渲染优化`, `包体积`, `帧率`, `内存`
- **知识点**:
  - Flutter DevTools 性能面板深度使用
  - Widget 重建分析与优化（const / RepaintBoundary）
  - 图片加载优化（缓存 / WebP / 渐进加载）
  - 包体积裁剪（Tree-shaking / 代码分割 / 资源压缩）
  - 启动时间优化（延迟初始化 / 预热）
  - 内存泄漏检测与修复
- **前置依赖** ← [自定义 Widget/动画](#-flutter-自定义-widget-实战custompainter-动画-手势处理) · [Crashlytics](#-flutter-crashlytics-实战sentry-firebase-crashlytics-错误监控集成)
- **后续关联** → [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程)

---

## 9. 发布与运维

### 📄 Flutter App 打包实战：iOS / Android / Web / 桌面多平台发布流程

- **文件**: `Flutter-App-打包实战-iOS-Android-Web-桌面多平台发布流程.md`
- **关键词**: `打包`, `iOS`, `Android`, `Web`, `macOS`, `Windows`, `Linux`, `签名`, `发布`
- **知识点**:
  - Android APK/AAB 签名与构建配置
  - iOS Provisioning Profile / Xcode 签名体系
  - Flutter Web 构建与部署（Nginx / Firebase Hosting / Vercel）
  - macOS / Windows / Linux 桌面打包与分发
  - 多 Flavor / 多环境配置（dev / staging / prod）
  - 应用商店元数据与审核要点
- **前置依赖** ← [国际化](#-flutter-国际化实战flutter_localizations-多语言与-rtl-支持) · [性能优化](#-flutter-性能优化实战devtools-分析-渲染优化-包体积裁剪)
- **后续关联** → [CI/CD 自动发布](#-flutter-cicd-实战github-actions-自动化构建测试发布) · [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)

### 📄 Flutter 应用内更新实战：版本检测、强制更新与灰度发布策略

- **文件**: `Flutter-应用内更新实战-版本检测-强制更新-灰度发布策略.md`
- **关键词**: `应用内更新`, `版本检测`, `强制更新`, `灰度发布`, `A/B Test`
- **知识点**:
  - 服务端版本管理 API 设计
  - 客户端版本对比与更新弹窗
  - 强制更新 vs 可选更新策略
  - 灰度发布（按比例 / 按设备 / 按地区）
  - 差量更新方案（Android / Shorebird）
  - 与推送通知联动触发更新
- **前置依赖** ← [本地存储](#-flutter-本地存储实战hive-isar-sqlite-数据持久化方案对比) · [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程) · [推送通知](#-flutter-推送通知实战fcm-apns-双通道集成与厂商通道适配)

### 📄 Flutter 热更新实战：Shorebird Code Push 方案与风险控制

- **文件**: `Flutter-热更新实战-Shorebird-Code-Push-方案与风险控制.md`
- **关键词**: `Shorebird`, `热更新`, `Code Push`, `Dart AOT`, `风险控制`, `回滚`
- **知识点**:
  - Shorebird 工作原理（Dart AOT patching）
  - 集成配置与 CLI 使用
  - 灰度发布与回滚机制
  - 合规风险（App Store / Google Play 审核政策）
  - 与 CI/CD 流水线集成
  - 热更新 vs 强制更新 vs 静默更新选型
- **前置依赖** ← [CI/CD](#-flutter-cicd-实战github-actions-自动化构建测试发布) · [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)

---

## 知识依赖关系图（文字版）

```
                        ┌─────────────────────┐
                        │  Dart 基础 & Widget  │
                        │       体系详解        │
                        └──────┬───┬───┬───┬──┘
                               │   │   │   │
              ┌────────────────┘   │   │   └──────────────┐
              ▼                    ▼   ▼                   ▼
     ┌────────────┐      ┌──────────┐ ┌──────────────┐ ┌──────────────┐
     │ 自定义Widget│      │  状态管理 │ │  本地存储     │ │  响应式布局   │
     │ 动画/手势   │      │Riverpod/ │ │  Hive/Isar/  │ │  屏幕适配    │
     └─────┬──────┘      │Bloc/GetX │ │  SQLite      │ └──────┬───────┘
           │              └──┬──┬──┬┘ └──────┬───────┘        │
           │                 │  │  │         │                │
           ▼                 │  │  │         ▼                ▼
     ┌────────────┐         │  │  │   ┌──────────┐    ┌───────────┐
     │  性能优化    │         │  │  │   │ 暗黑模式   │    │  国际化    │
     │  DevTools   │         │  │  │   │  ThemeData │    │ i18n/RTL  │
     └─────┬──────┘         │  │  │   └──────────┘    └─────┬─────┘
           │                 │  │  │                         │
           │          ┌──────┘  │  └──────┐                  │
           ▼          ▼         ▼         ▼                  ▼
     ┌──────────┐ ┌────────┐ ┌───────┐ ┌────────┐   ┌────────────┐
     │Crashlytics│ │路由/导航│ │Firebase│ │网络请求 │   │ 多平台打包  │
     │Sentry/FC │ │GoRouter│ │Auth/  │ │Dio封装  │   │iOS/Android │
     └─────┬────┘ └────┬───┘ │FCM/FS │ └──┬──┬──┘   │Web/Desktop │
           │           │     └───┬───┘    │  │       └─────┬──────┘
           │           │         │        │  │             │
           ▼           ▼         ▼        │  │             ▼
     ┌──────────┐ ┌────────┐ ┌────────┐  │  │       ┌──────────┐
     │  CI/CD    │ │混合开发 │ │ 推送通知│  │  │       │ 应用内更新│
     │ GitHub   │ │Platform│ │FCM/APNs│  │  │       │ 版本检测  │
     │ Actions  │ │Channel │ │厂商适配 │  │  │       │ 灰度发布  │
     └─────┬────┘ └────────┘ └───┬────┘  │  │       └─────┬────┘
           │                     │        │  │             │
           │                     │        ▼  ▼             │
           │                     │  ┌─────────────┐       │
           │                     │  │ Laravel API  │       │
           │                     │  │ RESTful对接  │       │
           │                     │  └──────┬──────┘       │
           │                     │         │              │
           ▼                     │         ▼              │
     ┌──────────┐               │   ┌───────────┐        │
     │  热更新    │               │   │ WebSocket  │        │
     │ Shorebird │               │   │ 实时通信    │        │
     └──────────┘               │   └───────────┘        │
                                │                        │
                                └────────────────────────┘
```

---

## 推荐学习路径

### 🚀 新手入门路线（6 篇）

1. [Dart 基础与 Widget 体系](#-flutter-3x-实战dart-语言基础与-widget-体系详解)
2. [状态管理（Riverpod/Bloc/GetX）](#-flutter-状态管理实战riverpodblocgetx-选型对比与最佳实践)
3. [GoRouter 路由](#-flutter-路由实战gorouter-声明式路由与深链接集成踩坑记录)
4. [Dio 网络请求](#-flutter-网络请求实战dio-封装拦截器错误处理与-token-刷新)
5. [本地存储](#-flutter-本地存储实战hive-isar-sqlite-数据持久化方案对比)
6. [多平台打包](#-flutter-app-打包实战ios-android-web-桌面多平台发布流程)

### 🏗️ 进阶架构路线（7 篇）

1. [自定义 Widget 与动画](#-flutter-自定义-widget-实战custompainter-动画-手势处理)
2. [响应式布局](#-flutter-响应式布局实战屏幕适配折叠屏平板适配策略)
3. [国际化](#-flutter-国际化实战flutter_localizations-多语言与-rtl-支持)
4. [暗黑模式](#-flutter-暗黑模式实战themedata-动态切换与主题持久化)
5. [混合开发（Platform Channel）](#-flutter-混合开发实战与原生-ios-android-模块集成platform-channel)
6. [Laravel API 对接](#-flutter-laravel-api-实战restful-对接-认证-分页-错误处理)
7. [WebSocket 实时通信](#-flutter-websocket-实战实时聊天-通知推送-长连接管理)

### 🔧 工程化运维路线（8 篇）

1. [测试三层体系](#-flutter-测试实战unit-widget-integration-三层测试体系)
2. [CI/CD 自动化](#-flutter-cicd-实战github-actions-自动化构建测试发布)
3. [Crashlytics 错误监控](#-flutter-crashlytics-实战sentry-firebase-crashlytics-错误监控集成)
4. [性能优化](#-flutter-性能优化实战devtools-分析-渲染优化-包体积裁剪)
5. [Firebase 一体化后端](#-flutter-firebase-实战-auth-firestore-fcm-一体化后端方案)
6. [推送通知](#-flutter-推送通知实战fcm-apns-双通道集成与厂商通道适配)
7. [应用内更新](#-flutter-应用内更新实战版本检测-强制更新-灰度发布策略)
8. [热更新（Shorebird）](#-flutter-热更新实战shorebird-code-push-方案与风险控制)

---

## 按技术栈速查

| 技术栈 | 涉及博文 |
|--------|----------|
| **Dart** | Dart 基础 · 自定义 Widget · 测试体系 |
| **Riverpod** | 状态管理 · Firebase · 暗黑模式 |
| **Bloc** | 状态管理 · 网络请求 |
| **GetX** | 状态管理 |
| **GoRouter** | 路由导航 · 混合开发 |
| **Dio** | 网络请求 · Laravel API · WebSocket |
| **Hive / Isar / SQLite** | 本地存储 · 暗黑模式 |
| **Firebase** | Firebase 一体化 · 推送通知 · Crashlytics |
| **Sentry** | Crashlytics |
| **Shorebird** | 热更新 |
| **GitHub Actions** | CI/CD · 测试体系 |
| **Platform Channel** | 混合开发 · 推送通知 · 应用内更新 |
| **Laravel** | Laravel API · WebSocket |
| **Material 3 / ThemeData** | 暗黑模式 · 国际化 · 响应式布局 |

---

*本索引基于 21 篇 Flutter 实战博文生成，覆盖从入门基础到工程化运维的完整知识体系。*
