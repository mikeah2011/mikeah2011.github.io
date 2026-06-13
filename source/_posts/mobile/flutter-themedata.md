---
title: Flutter 暗黑模式实战：ThemeData 动态切换与主题持久化
date: 2026-06-01 10:00:00
tags: [Flutter, 暗黑模式, ThemeData, 动态主题, 主题持久化]
keywords: [Flutter, ThemeData, 暗黑模式实战, 动态切换与主题持久化, 移动端]
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: 本文系统讲解 Flutter暗黑模式 在真实项目中的落地方案，涵盖 ThemeData 与 ColorScheme 设计、动态主题切换、跟随系统、主题持久化、状态管理集成、测试验收与常见坑位排查，帮助你建立可扩展的主题架构。
---


# Flutter 暗黑模式实战：ThemeData 动态切换与主题持久化

在 Flutter 项目里做暗黑模式，表面上看只是 `themeMode: ThemeMode.dark` 这么一行配置，真正落地到生产环境之后，你很快就会发现事情远没有这么简单：Material 3 的 `ThemeData` 到底该怎么组织？`ColorScheme` 是不是还要自己手配一堆颜色？用户手动切换和系统跟随冲突时谁优先？主题配置怎么持久化？SVG、位图、阴影、分割线、弹窗、SnackBar、系统状态栏颜色为什么总有一两个地方“不听话”？

这篇文章我就按照真实项目的推进顺序，完整讲一次 Flutter 暗黑模式的实战方案。重点不是“怎么把页面变黑”，而是如何构建**可扩展、可持久化、可维护、可与状态管理集成**的主题系统。

文章会覆盖这些核心内容：

- Material 3 下 `ThemeData` / `ColorScheme` 的架构理解
- 亮色 / 暗色主题动态切换的完整实现
- 跟随系统主题的处理方式
- 使用 `shared_preferences` / `hive` 做主题持久化
- 与 Riverpod / Bloc 的集成方式
- 图片、SVG、图标、状态栏等自适应策略
- 真实踩坑记录与排查思路

如果你现在的项目还停留在“在 `MaterialApp` 里塞两个 ThemeData，然后祈祷所有组件自动适配”，那这篇文章会帮你把这一块彻底搭顺。

---

## 一、先搞清楚：Flutter 的主题系统到底怎么分层

很多人第一次接触 Flutter 主题，最容易混淆三个概念：

1. `ThemeMode`
2. `ThemeData`
3. `ColorScheme`

它们分别解决的是三个层面的问题。

### 1.1 ThemeMode：决定当前用亮还是暗

`ThemeMode` 只有三个常见值：

```dart
enum ThemeMode {
  system,
  light,
  dark,
}
```

它不定义颜色，只负责告诉 `MaterialApp`：

- 强制亮色
- 强制暗色
- 跟随系统

也就是说，`ThemeMode` 更像“策略层”。

### 1.2 ThemeData：定义整个组件库怎么长

`ThemeData` 是 Flutter Material 组件的主题容器，里面不只是颜色，还有：

- 字体体系 `textTheme`
- 按钮样式 `elevatedButtonTheme`
- AppBar 样式 `appBarTheme`
- 输入框样式 `inputDecorationTheme`
- 底部导航栏样式
- 卡片、对话框、Divider、Chip 等组件样式

如果说 `ThemeMode` 是“开关”，那 `ThemeData` 就是“整套 UI 规则”。

### 1.3 ColorScheme：Material 3 的颜色语义核心

到了 Material 3，颜色设计的核心已经不再是“直接给 primary / accent 一顿配”，而是围绕 `ColorScheme` 这一套**语义化颜色系统**来组织。

例如：

- `primary`
- `onPrimary`
- `secondary`
- `surface`
- `onSurface`
- `error`
- `outline`
- `surfaceContainer`
- `inverseSurface`

Material 组件在大多数情况下，会优先读取 `ColorScheme` 中的语义颜色来绘制自己。所以实际项目里，**最重要的不是先写一堆组件级 Theme，而是先把 ColorScheme 架好**。

---

## 二、Material 3 下正确的 ThemeData 架构方式

我自己踩过的第一个坑，就是一开始手工往 `ThemeData` 里塞非常多的颜色：

```dart
ThemeData(
  primaryColor: Colors.blue,
  scaffoldBackgroundColor: Colors.white,
  cardColor: Colors.white,
  dividerColor: Colors.grey,
  appBarTheme: const AppBarTheme(...),
)
```

这样写短期能跑，长期会很痛苦，原因有三个：

1. 颜色分散，维护成本高
2. 深色主题要整体切换时很难保证一致性
3. Material 3 的很多组件根本不优先看这些旧字段

更合理的方式是：

- **先生成一套亮色 `ColorScheme`**
- **再生成一套暗色 `ColorScheme`**
- 再基于它们分别扩展出亮色 `ThemeData` / 暗色 `ThemeData`

### 2.1 建立统一的 AppThemeFactory

先定义一个主题工厂类：

```dart
import 'package:flutter/material.dart';

class AppThemeFactory {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF6750A4),
      brightness: Brightness.light,
    );

    return _buildTheme(scheme);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF6750A4),
      brightness: Brightness.dark,
    );

    return _buildTheme(scheme);
  }

  static ThemeData _buildTheme(ColorScheme colorScheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
        centerTitle: false,
        elevation: 0,
      ),
      cardTheme: CardTheme(
        color: colorScheme.surfaceContainerLow,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant,
        thickness: 1,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surfaceContainerHighest,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: colorScheme.primary, width: 1.5),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
      ),
      textTheme: Typography.material2021().black.apply(
            bodyColor: colorScheme.onSurface,
            displayColor: colorScheme.onSurface,
          ),
    );
  }
}
```

### 2.2 一个真实坑：textTheme 不能无脑用 black.apply

上面这段代码在亮色主题里看起来没问题，但暗色主题会有隐患。

因为 `Typography.material2021().black` 这套文字基础色是偏亮背景设计的，如果你在暗色主题里还强行从 `black` 派生，某些组件内部文字颜色可能会出现层级不对、disabled 态过深的问题。

更稳妥的做法是根据亮暗分别选基底：

```dart
static ThemeData _buildTheme(ColorScheme colorScheme) {
  final baseTextTheme = colorScheme.brightness == Brightness.dark
      ? Typography.material2021().white
      : Typography.material2021().black;

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    textTheme: baseTextTheme.apply(
      bodyColor: colorScheme.onSurface,
      displayColor: colorScheme.onSurface,
    ),
  );
}
```

这类细节在深色主题里非常常见：不是“颜色反过来”就结束了，而是要尊重组件本身对层级、对比度、禁用态、状态色的设计。

---

## 三、ColorScheme 与动态颜色：Material 3 的关键能力

### 3.1 为什么推荐 ColorScheme.fromSeed

Material 3 的一个优势，就是你不需要手工维护几十个颜色槽位。只要给一个种子色，就能推导出一整套亮暗主题语义色。

```dart
final lightScheme = ColorScheme.fromSeed(
  seedColor: const Color(0xFF0061A4),
  brightness: Brightness.light,
);

final darkScheme = ColorScheme.fromSeed(
  seedColor: const Color(0xFF0061A4),
  brightness: Brightness.dark,
);
```

这样生成的主题有几个好处：

- 亮暗配色天然成套
- 语义颜色层级更接近 Material 3 规范
- 主题扩展时不容易出现“这个组件突兀地蓝、那个组件突兀地灰”

### 3.2 什么时候需要手工覆写 ColorScheme

`fromSeed` 很方便，但不是万金油。真实项目里通常还会覆写一部分字段，例如：

- 业务品牌色要求极强
- 暗色模式下 `surface` 太灰或太黑，不符合视觉预期
- `outlineVariant` 对比度不够
- 警告 / 成功 / 信息色要接业务设计系统

示例：

```dart
static ColorScheme buildLightScheme(Color seed) {
  final base = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: Brightness.light,
  );

  return base.copyWith(
    surface: const Color(0xFFF8F9FD),
    surfaceContainerLow: Colors.white,
    surfaceContainerHighest: const Color(0xFFF0F2F8),
    outlineVariant: const Color(0xFFDCE0EA),
  );
}

static ColorScheme buildDarkScheme(Color seed) {
  final base = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: Brightness.dark,
  );

  return base.copyWith(
    surface: const Color(0xFF121417),
    surfaceContainerLow: const Color(0xFF1A1D22),
    surfaceContainerHighest: const Color(0xFF23272F),
    outlineVariant: const Color(0xFF3A404A),
  );
}
```

### 3.3 Android 12+ 动态颜色接入

如果你的 App 想更进一步，Material 3 还支持 Android 12+ 的动态颜色（Monet）。Flutter 里常见做法是借助 `dynamic_color` 包。

```yaml
dependencies:
  flutter:
    sdk: flutter
  dynamic_color: ^1.7.0
```

在入口中接入：

```dart
import 'package:dynamic_color/dynamic_color.dart';
import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return DynamicColorBuilder(
      builder: (ColorScheme? lightDynamic, ColorScheme? darkDynamic) {
        final lightScheme = lightDynamic ??
            ColorScheme.fromSeed(
              seedColor: const Color(0xFF6750A4),
              brightness: Brightness.light,
            );
        final darkScheme = darkDynamic ??
            ColorScheme.fromSeed(
              seedColor: const Color(0xFF6750A4),
              brightness: Brightness.dark,
            );

        return MaterialApp(
          theme: AppThemeFactory.fromScheme(lightScheme),
          darkTheme: AppThemeFactory.fromScheme(darkScheme),
          themeMode: ThemeMode.system,
          home: const HomePage(),
        );
      },
    );
  }
}
```

这里的经验是：

- 不要把动态颜色作为唯一路径，必须有 fallback
- 动态颜色适合系统感强的应用，不一定适合品牌色要求特别严的产品
- 接了动态颜色后，最好仍然保留你自己的 `ThemeExtension` 业务色体系，否则业务模块会很乱

---

## 四、亮色 / 暗色主题动态切换的完整实现

真正可用的暗黑模式，一般都不止有“亮”和“暗”，而是有三种状态：

- 用户选择亮色
- 用户选择暗色
- 用户选择跟随系统

所以推荐先定义一个自己的主题枚举，而不是业务代码里到处直接判断 `ThemeMode`。

### 4.1 定义主题偏好枚举

```dart
enum AppThemePreference {
  system,
  light,
  dark,
}

extension AppThemePreferenceX on AppThemePreference {
  ThemeMode get themeMode {
    switch (this) {
      case AppThemePreference.system:
        return ThemeMode.system;
      case AppThemePreference.light:
        return ThemeMode.light;
      case AppThemePreference.dark:
        return ThemeMode.dark;
    }
  }

  String get storageValue {
    switch (this) {
      case AppThemePreference.system:
        return 'system';
      case AppThemePreference.light:
        return 'light';
      case AppThemePreference.dark:
        return 'dark';
    }
  }

  static AppThemePreference fromStorage(String? value) {
    switch (value) {
      case 'light':
        return AppThemePreference.light;
      case 'dark':
        return AppThemePreference.dark;
      case 'system':
      default:
        return AppThemePreference.system;
    }
  }
}
```

### 4.2 用 ChangeNotifier 做一个最基础版本

先上最容易理解的实现：

```dart
import 'package:flutter/material.dart';

class ThemeController extends ChangeNotifier {
  ThemeController(this._preference);

  AppThemePreference _preference;

  AppThemePreference get preference => _preference;

  ThemeMode get themeMode => _preference.themeMode;

  Future<void> updatePreference(AppThemePreference next) async {
    if (_preference == next) return;
    _preference = next;
    notifyListeners();
    await _savePreference(next);
  }

  Future<void> _savePreference(AppThemePreference preference) async {
    // 持久化逻辑后面补
  }
}
```

接入 `MaterialApp`：

```dart
class MyApp extends StatelessWidget {
  final ThemeController controller;

  const MyApp({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        return MaterialApp(
          theme: AppThemeFactory.light(),
          darkTheme: AppThemeFactory.dark(),
          themeMode: controller.themeMode,
          home: SettingsPage(controller: controller),
        );
      },
    );
  }
}
```

设置页切换：

```dart
class SettingsPage extends StatelessWidget {
  final ThemeController controller;

  const SettingsPage({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('主题设置')),
      body: Column(
        children: [
          RadioListTile<AppThemePreference>(
            title: const Text('跟随系统'),
            value: AppThemePreference.system,
            groupValue: controller.preference,
            onChanged: (value) {
              if (value != null) {
                controller.updatePreference(value);
              }
            },
          ),
          RadioListTile<AppThemePreference>(
            title: const Text('浅色模式'),
            value: AppThemePreference.light,
            groupValue: controller.preference,
            onChanged: (value) {
              if (value != null) {
                controller.updatePreference(value);
              }
            },
          ),
          RadioListTile<AppThemePreference>(
            title: const Text('深色模式'),
            value: AppThemePreference.dark,
            groupValue: controller.preference,
            onChanged: (value) {
              if (value != null) {
                controller.updatePreference(value);
              }
            },
          ),
        ],
      ),
    );
  }
}
```

这个版本已经够你快速上线，但复杂项目一般还会往状态管理收口。

---

## 五、系统主题跟随：不是 ThemeMode.system 就完事了

很多文章写到这里就停了：`themeMode: ThemeMode.system`。但真实项目里，“跟随系统”常见的坑其实更多。

### 5.1 跟随系统时，如何判断当前到底处于亮还是暗

当用户选择的是 `ThemeMode.system`，业务代码里有时候需要知道当前实际生效的是亮色还是暗色，比如：

- 选择深浅不同图片资源
- 上报埋点
- 某些图表主题需要自己配置

这时不要去猜，直接读系统亮度：

```dart
Brightness brightnessOf(BuildContext context) {
  return MediaQuery.platformBrightnessOf(context);
}

bool isDarkMode(BuildContext context) {
  final themeMode = Theme.of(context).brightness;
  return themeMode == Brightness.dark;
}
```

这里有个容易混淆的点：

- `MediaQuery.platformBrightnessOf(context)`：平台当前亮度
- `Theme.of(context).brightness`：当前 Widget 树实际应用后的主题亮度

大多数业务判断，更推荐使用 `Theme.of(context).brightness`，因为它反映的是**最终生效结果**。

### 5.2 系统切换后界面不更新？看你是不是把状态写死了

有一次我在一个项目里遇到这样的问题：

- `themeMode` 已经是 `ThemeMode.system`
- 系统从亮切暗
- 页面大部分组件变了
- 但某个自定义图表颜色没变

排查后发现问题出在这里：

```dart
class MyChart extends StatefulWidget {
  const MyChart({super.key});

  @override
  State<MyChart> createState() => _MyChartState();
}

class _MyChartState extends State<MyChart> {
  late final Color lineColor;

  @override
  void initState() {
    super.initState();
    lineColor = Theme.of(context).colorScheme.primary;
  }
}
```

这是非常典型的暗黑模式 bug：**在 `initState` 里缓存主题颜色**。

因为系统主题变化后，Widget 会重建，但 `late final` 不会重新赋值。正确做法应该是：

```dart
@override
Widget build(BuildContext context) {
  final lineColor = Theme.of(context).colorScheme.primary;
  return CustomPaint(
    painter: ChartPainter(lineColor: lineColor),
  );
}
```

结论很简单：**主题相关颜色尽量在 build 阶段读取，不要过早缓存。**

### 5.3 监听系统主题变化的底层方式

如果你确实需要在非 Widget 层监听平台主题变化，可以用：

```dart
class PlatformThemeObserver with WidgetsBindingObserver {
  void start() {
    WidgetsBinding.instance.addObserver(this);
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangePlatformBrightness() {
    final brightness = WidgetsBinding.instance.platformDispatcher.platformBrightness;
    debugPrint('platform brightness changed: $brightness');
  }
}
```

适用于：

- 服务层缓存刷新
- 日志上报
- 非 Widget 容器层同步状态

但如果只是普通 UI 主题切换，不要过度设计，`MaterialApp + themeMode` 已经够了。

### 5.4 用 `MediaQuery.platformBrightnessOf` 做“跟随系统”分支处理

前面提到平台亮度和最终生效亮度不是一回事，但在某些场景里，你确实需要显式感知“系统当前是亮还是暗”，尤其是当用户选择了“跟随系统”时，需要决定是否加载某一组资源、初始化某个非 Material 组件，或者给日志系统附带当前系统主题。

一个比较稳妥的写法，是把“用户偏好”和“平台亮度”组合起来统一计算：

```dart
Brightness resolveEffectiveBrightness(
  BuildContext context,
  AppThemePreference preference,
) {
  switch (preference) {
    case AppThemePreference.light:
      return Brightness.light;
    case AppThemePreference.dark:
      return Brightness.dark;
    case AppThemePreference.system:
      return MediaQuery.platformBrightnessOf(context);
  }
}

class ThemeAwareBanner extends StatelessWidget {
  final AppThemePreference preference;

  const ThemeAwareBanner({
    super.key,
    required this.preference,
  });

  @override
  Widget build(BuildContext context) {
    final brightness = resolveEffectiveBrightness(context, preference);
    final isDark = brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F7FA),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        isDark ? '当前跟随系统深色主题' : '当前跟随系统浅色主题',
        style: TextStyle(
          color: isDark ? Colors.white : Colors.black87,
        ),
      ),
    );
  }
}
```

这个模式特别适合两类场景：

- 业务代码需要知道“平台亮度”而不是单纯 ThemeData
- 用户设置保留三态，但某个局部逻辑必须在 `system` 下进一步分流

不过还是强调一次：**普通组件渲染优先读 `Theme.of(context)`，只有当你真的在处理“系统态”逻辑时，再去读 `MediaQuery.platformBrightnessOf(context)`。**

---

## 六、主题持久化：shared_preferences 与 Hive 两种方案

暗黑模式真正能称得上“产品能力”，持久化是必做项。用户上次明明切成深色，第二次打开又变回默认，这体验非常糟糕。

### 6.1 用 shared_preferences 持久化主题模式

如果你只是存一个枚举值，`shared_preferences` 是最省心的方案。

```yaml
dependencies:
  shared_preferences: ^2.3.2
```

封装存储仓库：

```dart
import 'package:shared_preferences/shared_preferences.dart';

class ThemePreferenceStorage {
  static const _keyThemePreference = 'theme_preference';

  Future<AppThemePreference> read() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_keyThemePreference);
    return AppThemePreferenceX.fromStorage(value);
  }

  Future<void> write(AppThemePreference preference) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyThemePreference, preference.storageValue);
  }
}
```

把它接回 `ThemeController`：

```dart
class ThemeController extends ChangeNotifier {
  ThemeController(this._storage, this._preference);

  final ThemePreferenceStorage _storage;
  AppThemePreference _preference;

  AppThemePreference get preference => _preference;
  ThemeMode get themeMode => _preference.themeMode;

  Future<void> updatePreference(AppThemePreference next) async {
    if (_preference == next) return;
    _preference = next;
    notifyListeners();

    try {
      await _storage.write(next);
    } catch (e, st) {
      debugPrint('save theme preference failed: $e\n$st');
    }
  }
}
```

启动时先读取：

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final storage = ThemePreferenceStorage();
  final initialPreference = await storage.read();
  final controller = ThemeController(storage, initialPreference);

  runApp(MyApp(controller: controller));
}
```

### 6.2 一个很常见的坑：没等 ensureInitialized 就读 prefs

错误写法通常长这样：

```dart
void main() async {
  final prefs = await SharedPreferences.getInstance();
  runApp(const MyApp());
}
```

有些环境下它也许“看起来能跑”，但这是不规范的。涉及插件初始化时，入口应该先：

```dart
WidgetsFlutterBinding.ensureInitialized();
```

否则在某些平台、某些时机、某些测试环境中会翻车。

### 6.3 用 Hive 存更复杂的自定义主题数据

如果你不仅要记住 `light/dark/system`，还要记住：

- 用户自定义主色
- 字体缩放偏好
- 是否开启 AMOLED 纯黑模式
- 高对比度模式
- 卡片圆角尺寸

那 `shared_preferences` 就开始显得吃力了。这时更适合上 `Hive`。

```yaml
dependencies:
  hive: ^2.2.3
  hive_flutter: ^1.1.0
```

定义主题设置模型：

```dart
class ThemeSettings {
  final AppThemePreference preference;
  final int seedColorValue;
  final bool pureBlackEnabled;

  const ThemeSettings({
    required this.preference,
    required this.seedColorValue,
    required this.pureBlackEnabled,
  });

  ThemeSettings copyWith({
    AppThemePreference? preference,
    int? seedColorValue,
    bool? pureBlackEnabled,
  }) {
    return ThemeSettings(
      preference: preference ?? this.preference,
      seedColorValue: seedColorValue ?? this.seedColorValue,
      pureBlackEnabled: pureBlackEnabled ?? this.pureBlackEnabled,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'preference': preference.storageValue,
      'seedColorValue': seedColorValue,
      'pureBlackEnabled': pureBlackEnabled,
    };
  }

  factory ThemeSettings.fromJson(Map json) {
    return ThemeSettings(
      preference: AppThemePreferenceX.fromStorage(json['preference'] as String?),
      seedColorValue: json['seedColorValue'] as int? ?? 0xFF6750A4,
      pureBlackEnabled: json['pureBlackEnabled'] as bool? ?? false,
    );
  }
}
```

初始化 Hive：

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();

  final box = await Hive.openBox('settings');
  final raw = box.get('theme_settings');
  final settings = raw is Map
      ? ThemeSettings.fromJson(Map<String, dynamic>.from(raw))
      : const ThemeSettings(
          preference: AppThemePreference.system,
          seedColorValue: 0xFF6750A4,
          pureBlackEnabled: false,
        );

  runApp(MyApp(initialSettings: settings, box: box));
}
```

仓库封装：

```dart
import 'package:hive/hive.dart';

class ThemeSettingsRepository {
  ThemeSettingsRepository(this._box);

  final Box _box;
  static const _key = 'theme_settings';

  Future<ThemeSettings> read() async {
    final raw = _box.get(_key);
    if (raw is Map) {
      return ThemeSettings.fromJson(Map<String, dynamic>.from(raw));
    }
    return const ThemeSettings(
      preference: AppThemePreference.system,
      seedColorValue: 0xFF6750A4,
      pureBlackEnabled: false,
    );
  }

  Future<void> write(ThemeSettings settings) async {
    await _box.put(_key, settings.toJson());
  }
}
```

### 6.4 Hive 的一个踩坑：Color 不能直接随手存对象

我见过不少人这么写：

```dart
await box.put('seed_color', Colors.blue);
```

这通常不是一个好的习惯。`Color` 对象序列化方式不统一时，很容易在类型适配、跨版本、JSON/Hive 混合存储时出问题。

最稳妥的是存 `value`：

```dart
await box.put('seed_color', Colors.blue.toARGB32());
```

读取时：

```dart
final color = Color(value);
```

如果你项目 Flutter SDK 较新，注意 `Color.value`、`toARGB32()` 在不同 lint / API 建议下可能会有差异，统一一种方案即可，核心是：**存原始整数，不要直接存 UI 对象。**

---

## 七、把主题能力抽象成可扩展架构

如果主题系统只影响 `ThemeMode`，你很快就会在业务代码里到处写：

```dart
Theme.of(context).colorScheme.primary
Theme.of(context).colorScheme.surfaceContainerLow
Theme.of(context).colorScheme.outlineVariant
```

这虽然没错，但当业务中出现：

- 品牌成功色 success
- 业务告警色 warning
- VIP 金色
- 图表涨跌色
- 骨架屏颜色

这些字段都不属于 Material 官方 `ColorScheme`，如果你继续硬编码，会越来越乱。

### 7.1 用 ThemeExtension 扩展业务主题

这是 Flutter 主题系统里非常值得长期使用的能力。

```dart
import 'package:flutter/material.dart';

@immutable
class AppExtraColors extends ThemeExtension<AppExtraColors> {
  final Color success;
  final Color warning;
  final Color skeleton;
  final Color profit;
  final Color loss;

  const AppExtraColors({
    required this.success,
    required this.warning,
    required this.skeleton,
    required this.profit,
    required this.loss,
  });

  @override
  AppExtraColors copyWith({
    Color? success,
    Color? warning,
    Color? skeleton,
    Color? profit,
    Color? loss,
  }) {
    return AppExtraColors(
      success: success ?? this.success,
      warning: warning ?? this.warning,
      skeleton: skeleton ?? this.skeleton,
      profit: profit ?? this.profit,
      loss: loss ?? this.loss,
    );
  }

  @override
  AppExtraColors lerp(ThemeExtension<AppExtraColors>? other, double t) {
    if (other is! AppExtraColors) return this;
    return AppExtraColors(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      skeleton: Color.lerp(skeleton, other.skeleton, t)!,
      profit: Color.lerp(profit, other.profit, t)!,
      loss: Color.lerp(loss, other.loss, t)!,
    );
  }
}
```

在主题里注册：

```dart
ThemeData _buildTheme(ColorScheme colorScheme) {
  final isDark = colorScheme.brightness == Brightness.dark;

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    extensions: [
      AppExtraColors(
        success: const Color(0xFF18B566),
        warning: const Color(0xFFFFA726),
        skeleton: isDark ? const Color(0xFF2C313A) : const Color(0xFFECEFF4),
        profit: const Color(0xFF12B76A),
        loss: const Color(0xFFF04438),
      ),
    ],
  );
}
```

读取时：

```dart
extension ThemeX on BuildContext {
  AppExtraColors get extraColors => Theme.of(this).extension<AppExtraColors>()!;
}
```

使用：

```dart
Container(
  color: context.extraColors.skeleton,
)
```

这套方式最大的价值在于：**Material 官方色系统和业务色系统解耦**。

### 7.2 局部组件覆写主题：不要为了一个卡片去污染全局 ThemeData

真实项目里经常会遇到这种需求：

- 首页营销卡片想要更强的品牌色
- 某个设置分组需要更淡的分割线
- 某个弹窗在暗色模式下需要更高对比度

这时候不要第一反应就去改全局 `ThemeData`，因为它很容易牵一发动全身。更好的方式是对局部 Widget 树做主题覆写。

```dart
class PromoCard extends StatelessWidget {
  const PromoCard({super.key});

  @override
  Widget build(BuildContext context) {
    final parentTheme = Theme.of(context);
    final parentScheme = parentTheme.colorScheme;

    final localTheme = parentTheme.copyWith(
      colorScheme: parentScheme.copyWith(
        primary: const Color(0xFFFF7A00),
        surfaceContainerLow: parentScheme.brightness == Brightness.dark
            ? const Color(0xFF2A1F18)
            : const Color(0xFFFFF3E8),
      ),
      cardTheme: parentTheme.cardTheme.copyWith(
        color: parentScheme.brightness == Brightness.dark
            ? const Color(0xFF2A1F18)
            : const Color(0xFFFFF3E8),
      ),
    );

    return Theme(
      data: localTheme,
      child: Builder(
        builder: (context) {
          final scheme = Theme.of(context).colorScheme;

          return Card(
            child: ListTile(
              leading: Icon(Icons.local_fire_department, color: scheme.primary),
              title: const Text('限时活动'),
              subtitle: const Text('这个卡片使用了局部主题覆写'),
              trailing: FilledButton(
                onPressed: () {},
                child: const Text('查看'),
              ),
            ),
          );
        },
      ),
    );
  }
}
```

经验上我会这样区分：

- **全局一致的设计规则** 放进 `AppThemeFactory`
- **单个业务模块的视觉例外** 用 `Theme(data: ..., child: ...)`
- **大量重复出现的局部规则** 再考虑抽成单独主题函数

这样做能显著降低“为了一个页面改坏全站颜色”的风险。

---

## 八、与 Riverpod 集成：推荐用于新项目

如果你的项目本来就在用 Riverpod，那主题系统完全可以做得很优雅。

### 8.1 StateNotifier / Notifier 建模

这里给一个偏实战的 Riverpod 版本。

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum AppThemePreference { system, light, dark }

extension AppThemePreferenceX on AppThemePreference {
  ThemeMode get mode {
    switch (this) {
      case AppThemePreference.system:
        return ThemeMode.system;
      case AppThemePreference.light:
        return ThemeMode.light;
      case AppThemePreference.dark:
        return ThemeMode.dark;
    }
  }
}

class ThemeState {
  final AppThemePreference preference;
  final Color seedColor;
  final bool pureBlack;

  const ThemeState({
    required this.preference,
    required this.seedColor,
    required this.pureBlack,
  });

  ThemeState copyWith({
    AppThemePreference? preference,
    Color? seedColor,
    bool? pureBlack,
  }) {
    return ThemeState(
      preference: preference ?? this.preference,
      seedColor: seedColor ?? this.seedColor,
      pureBlack: pureBlack ?? this.pureBlack,
    );
  }
}

class ThemeNotifier extends Notifier<ThemeState> {
  @override
  ThemeState build() {
    return const ThemeState(
      preference: AppThemePreference.system,
      seedColor: Color(0xFF6750A4),
      pureBlack: false,
    );
  }

  Future<void> setPreference(AppThemePreference preference) async {
    state = state.copyWith(preference: preference);
    // 持久化
  }

  Future<void> setSeedColor(Color color) async {
    state = state.copyWith(seedColor: color);
    // 持久化
  }

  Future<void> setPureBlack(bool value) async {
    state = state.copyWith(pureBlack: value);
    // 持久化
  }
}

final themeNotifierProvider =
    NotifierProvider<ThemeNotifier, ThemeState>(ThemeNotifier.new);
```

接入：

```dart
class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeNotifierProvider);

    return MaterialApp(
      theme: AppThemeFactory.lightFromSeed(themeState.seedColor),
      darkTheme: AppThemeFactory.darkFromSeed(
        themeState.seedColor,
        pureBlack: themeState.pureBlack,
      ),
      themeMode: themeState.preference.mode,
      home: const HomePage(),
    );
  }
}
```

### 8.2 Riverpod 的一个坑：异步初始化时页面闪主题

很多人会把持久化读取写在 `build()` 之后异步加载，导致 App 首帧先亮后暗，或者先默认紫色再跳成用户自定义颜色。

解决思路有两个：

#### 方案 A：启动前预加载

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  await container.read(themeBootstrapProvider.future);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const ProviderScope(child: MyApp()),
    ),
  );
}
```

#### 方案 B：加启动页 / Splash 过渡

如果启动链路复杂，允许短暂过渡，那就不要让 `MaterialApp` 在主题未就绪时直接渲染业务首页。

核心原则是：**主题初始化属于启动关键路径，别让它在首屏之后再慢悠悠补。**

---

## 九、与 Bloc 集成：适合已有中大型项目

如果项目已经全量基于 Bloc / Cubit，不建议为了一个主题切换单独引入 Riverpod。Bloc 做这件事同样非常自然。

### 9.1 ThemeCubit 实现

```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class ThemeState {
  final AppThemePreference preference;
  final Color seedColor;
  final bool pureBlack;

  const ThemeState({
    required this.preference,
    required this.seedColor,
    required this.pureBlack,
  });

  ThemeState copyWith({
    AppThemePreference? preference,
    Color? seedColor,
    bool? pureBlack,
  }) {
    return ThemeState(
      preference: preference ?? this.preference,
      seedColor: seedColor ?? this.seedColor,
      pureBlack: pureBlack ?? this.pureBlack,
    );
  }
}

class ThemeCubit extends Cubit<ThemeState> {
  ThemeCubit()
      : super(
          const ThemeState(
            preference: AppThemePreference.system,
            seedColor: Color(0xFF6750A4),
            pureBlack: false,
          ),
        );

  Future<void> setPreference(AppThemePreference preference) async {
    emit(state.copyWith(preference: preference));
    // await repository.save(...)
  }

  Future<void> setSeedColor(Color color) async {
    emit(state.copyWith(seedColor: color));
  }

  Future<void> setPureBlack(bool value) async {
    emit(state.copyWith(pureBlack: value));
  }
}
```

接入方式：

```dart
class AppView extends StatelessWidget {
  const AppView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ThemeCubit, ThemeState>(
      buildWhen: (previous, current) => previous != current,
      builder: (context, state) {
        return MaterialApp(
          theme: AppThemeFactory.lightFromSeed(state.seedColor),
          darkTheme: AppThemeFactory.darkFromSeed(
            state.seedColor,
            pureBlack: state.pureBlack,
          ),
          themeMode: state.preference.mode,
          home: const HomePage(),
        );
      },
    );
  }
}
```

### 9.2 Bloc 场景下的踩坑：不要把整个 App 高频重建得太重

主题切换本来就会触发应用顶层重建，这是正常的。但有些项目会把：

- 多语言
- 登录态
- 远程配置
- 首页 Tab 状态

全绑在同一个 `BlocBuilder` 上，导致每次切主题都把一堆昂贵 widget 重建一遍。

建议：

- `MaterialApp` 所需的最小状态放最外层
- 大型列表、复杂图表尽量依赖局部 build
- 避免在顶层 builder 中执行额外副作用

---

## 十、自适应图片、图标与 SVG：暗黑模式最容易漏的地方

文字和背景切了，图片不适配，用户第一眼就能看出“这 App 暗黑模式没做完整”。

### 10.1 位图资源：准备双份资源是最稳的

如果图片本身包含：

- 黑色 logo
- 深色边框
- 浅灰阴影
- 文案说明

那么仅仅加个 `ColorFilter` 大概率会翻车。最稳的方法是准备亮 / 暗两套资源。

```dart
class ThemeAwareAsset extends StatelessWidget {
  final String light;
  final String dark;
  final double? width;
  final double? height;

  const ThemeAwareAsset({
    super.key,
    required this.light,
    required this.dark,
    this.width,
    this.height,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      isDark ? dark : light,
      width: width,
      height: height,
    );
  }
}
```

使用：

```dart
const ThemeAwareAsset(
  light: 'assets/images/logo_light.png',
  dark: 'assets/images/logo_dark.png',
  width: 120,
)
```

### 10.2 SVG 资源：尽量用 currentColor 思路

很多图标与插画使用 `flutter_svg`。这块的关键经验是：

- 如果 SVG 是纯图标，优先让它支持主题染色
- 如果 SVG 是复杂插画，不要硬染色，准备双份资源

图标式 SVG：

```dart
import 'package:flutter_svg/flutter_svg.dart';

SvgPicture.asset(
  'assets/icons/notification.svg',
  width: 24,
  height: 24,
  colorFilter: ColorFilter.mode(
    Theme.of(context).colorScheme.onSurface,
    BlendMode.srcIn,
  ),
)
```

### 10.3 一个真实踩坑：设计给的 SVG 自带 fill，导致主题染色失效

这类问题非常常见。代码明明写了 `colorFilter`，结果图标就是不变色。原因通常是原始 SVG 文件里：

```xml
<path fill="#1A1A1A" d="..." />
```

某些 SVG 内容结构下，强指定 fill 后渲染结果和预期会不一致，尤其是多层 path、mask、clipPath 场景。解决方式通常有三类：

1. 让设计导出适合染色的单色 SVG
2. 手工清理 fill/stroke 写法
3. 直接拆成亮暗两套 SVG

如果这个图标要在很多地方复用，我的经验是：**别在运行时跟复杂 SVG 对抗，资源治理比代码魔改更省时间。**

### 10.4 网络图片与暗色背景对比问题

一些内容型页面会展示用户上传图片，这些资源你没法提供亮暗双份。此时只能从容器层补救：

- 给图片加背景卡片色
- 暗色模式下加轻微边框
- 对透明 PNG 提供棋盘格或浅轮廓处理

```dart
Container(
  decoration: BoxDecoration(
    color: Theme.of(context).colorScheme.surfaceContainerLow,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(
      color: Theme.of(context).colorScheme.outlineVariant,
    ),
  ),
  clipBehavior: Clip.antiAlias,
  child: Image.network(imageUrl, fit: BoxFit.cover),
)
```

---

## 十一、状态栏、导航栏、弹窗：主题切换时的外围系统适配

暗黑模式做一半的项目，经常会漏掉系统 UI。

### 11.1 状态栏图标颜色

很多人切了深色背景，但状态栏图标还是深色，直接看不清。

可以在页面级或全局设置：

```dart
import 'package:flutter/services.dart';

void updateSystemUiOverlay(BuildContext context) {
  final isDark = Theme.of(context).brightness == Brightness.dark;

  SystemChrome.setSystemUIOverlayStyle(
    SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
      statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
      systemNavigationBarColor: Theme.of(context).colorScheme.surface,
      systemNavigationBarIconBrightness:
          isDark ? Brightness.light : Brightness.dark,
    ),
  );
}
```

### 11.2 踩坑：iOS 和 Android 的 Brightness 语义别记反

这是个老坑了：

- `statusBarIconBrightness` 主要对应 Android 图标颜色
- `statusBarBrightness` 主要影响 iOS 状态栏内容风格

而且它们的语义常常让人容易记反。最稳妥的方式不是死记，而是：

- 真机验证 Android
- 真机验证 iOS
- 做一次亮暗主题来回切换测试

不要只在模拟器看一眼就提交。

### 11.3 Dialog / BottomSheet 颜色不统一

有些项目暗黑模式时弹窗会明显“浮起来一块灰”，通常是因为：

- `dialogTheme`
- `bottomSheetTheme`
- `modalBottomSheet` 背景色

没有统一到 `ColorScheme.surfaceContainer*` 体系。

推荐集中配置：

```dart
bottomSheetTheme: BottomSheetThemeData(
  backgroundColor: colorScheme.surfaceContainerLow,
  modalBackgroundColor: colorScheme.surfaceContainerLow,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
  ),
),
dialogTheme: DialogTheme(
  backgroundColor: colorScheme.surfaceContainerLow,
  shape: RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(20),
  ),
),
```

---

## 十二、一个更完整的生产级主题实现示例

下面给一个比较完整的主题管理示例，把前面讲的东西串起来。

### 12.1 主题状态定义

```dart
enum AppThemePreference { system, light, dark }

class ThemeConfig {
  final AppThemePreference preference;
  final int seedColorValue;
  final bool pureBlack;

  const ThemeConfig({
    required this.preference,
    required this.seedColorValue,
    required this.pureBlack,
  });

  Color get seedColor => Color(seedColorValue);

  ThemeConfig copyWith({
    AppThemePreference? preference,
    int? seedColorValue,
    bool? pureBlack,
  }) {
    return ThemeConfig(
      preference: preference ?? this.preference,
      seedColorValue: seedColorValue ?? this.seedColorValue,
      pureBlack: pureBlack ?? this.pureBlack,
    );
  }

  Map<String, dynamic> toJson() => {
        'preference': preference.name,
        'seedColorValue': seedColorValue,
        'pureBlack': pureBlack,
      };

  factory ThemeConfig.fromJson(Map<String, dynamic> json) {
    return ThemeConfig(
      preference: AppThemePreference.values.firstWhere(
        (e) => e.name == json['preference'],
        orElse: () => AppThemePreference.system,
      ),
      seedColorValue: json['seedColorValue'] as int? ?? 0xFF6750A4,
      pureBlack: json['pureBlack'] as bool? ?? false,
    );
  }
}
```

### 12.2 ThemeFactory

```dart
class AppThemeFactory {
  static ThemeData lightFromSeed(Color seed) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
    ).copyWith(
      surface: const Color(0xFFF7F8FA),
      surfaceContainerLow: Colors.white,
      surfaceContainerHighest: const Color(0xFFEEF1F6),
    );

    return _build(scheme, pureBlack: false);
  }

  static ThemeData darkFromSeed(Color seed, {required bool pureBlack}) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    ).copyWith(
      surface: pureBlack ? Colors.black : const Color(0xFF111318),
      surfaceContainerLow:
          pureBlack ? const Color(0xFF0D0D0D) : const Color(0xFF1A1D24),
      surfaceContainerHighest:
          pureBlack ? const Color(0xFF171717) : const Color(0xFF262B34),
      outlineVariant:
          pureBlack ? const Color(0xFF2D2D2D) : const Color(0xFF3A404A),
    );

    return _build(scheme, pureBlack: pureBlack);
  }

  static ThemeData _build(ColorScheme scheme, {required bool pureBlack}) {
    final textBase = scheme.brightness == Brightness.dark
        ? Typography.material2021().white
        : Typography.material2021().black;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      brightness: scheme.brightness,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,
      cardTheme: CardTheme(
        color: scheme.surfaceContainerLow,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        scrolledUnderElevation: 0,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        modalBackgroundColor: scheme.surfaceContainerLow,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: TextStyle(color: scheme.onInverseSurface),
        actionTextColor: scheme.primary,
      ),
      textTheme: textBase.apply(
        bodyColor: scheme.onSurface,
        displayColor: scheme.onSurface,
      ),
      extensions: [
        AppExtraColors(
          success: const Color(0xFF18B566),
          warning: const Color(0xFFFFA726),
          skeleton: scheme.brightness == Brightness.dark
              ? const Color(0xFF2D3138)
              : const Color(0xFFECEFF4),
          profit: const Color(0xFF12B76A),
          loss: const Color(0xFFF04438),
        ),
      ],
    );
  }
}
```

### 12.3 主题仓库与控制器

```dart
class ThemeRepository {
  ThemeRepository(this._prefs);

  final SharedPreferences _prefs;
  static const _key = 'theme_config';

  ThemeConfig read() {
    final raw = _prefs.getString(_key);
    if (raw == null || raw.isEmpty) {
      return const ThemeConfig(
        preference: AppThemePreference.system,
        seedColorValue: 0xFF6750A4,
        pureBlack: false,
      );
    }
    return ThemeConfig.fromJson(
      Map<String, dynamic>.from(jsonDecode(raw) as Map),
    );
  }

  Future<void> write(ThemeConfig config) async {
    await _prefs.setString(_key, jsonEncode(config.toJson()));
  }
}
```

```dart
class ThemeController extends ChangeNotifier {
  ThemeController(this._repository, this._config);

  final ThemeRepository _repository;
  ThemeConfig _config;

  ThemeConfig get config => _config;
  ThemeMode get themeMode {
    switch (_config.preference) {
      case AppThemePreference.system:
        return ThemeMode.system;
      case AppThemePreference.light:
        return ThemeMode.light;
      case AppThemePreference.dark:
        return ThemeMode.dark;
    }
  }

  ThemeData get lightTheme => AppThemeFactory.lightFromSeed(_config.seedColor);

  ThemeData get darkTheme => AppThemeFactory.darkFromSeed(
        _config.seedColor,
        pureBlack: _config.pureBlack,
      );

  Future<void> updatePreference(AppThemePreference value) async {
    _config = _config.copyWith(preference: value);
    notifyListeners();
    await _repository.write(_config);
  }

  Future<void> updateSeedColor(Color color) async {
    _config = _config.copyWith(seedColorValue: color.toARGB32());
    notifyListeners();
    await _repository.write(_config);
  }

  Future<void> updatePureBlack(bool enabled) async {
    _config = _config.copyWith(pureBlack: enabled);
    notifyListeners();
    await _repository.write(_config);
  }
}
```

---

## 十三、真实踩坑记录：这些问题我都实际遇到过

这一节我专门用“踩坑记录”的方式来写，因为暗黑模式最难的地方往往不是 API，而是细节一致性。

### 坑 1：背景色改了，但 ListTile / Card 仍然发灰

现象：

- `Scaffold` 已经是深色
- 页面主容器也是深色
- 但列表项、卡片、弹窗还是一种奇怪的灰

原因：

Material 3 里很多组件默认会用 `surfaceContainer*` 系列颜色，而不是你手工设置的 `scaffoldBackgroundColor`。

解决：

- 优先统一 `colorScheme.surface`、`surfaceContainerLow`、`surfaceContainerHighest`
- 再检查 `cardTheme`、`listTileTheme`、`dialogTheme`

经验：**不要只盯着 `scaffoldBackgroundColor`。**

### 坑 2：某些第三方组件不跟 ThemeData

比如图表库、富文本编辑器、日历组件、代码高亮组件，这些第三方库往往有自己的一套颜色配置，不会自动响应 Flutter 全局主题。

解决思路：

- 查组件是否支持 dark theme 参数
- 没有的话自己封装一层适配
- 必要时在 `build` 中根据 `Theme.of(context).brightness` 传不同颜色

真实经验：一个 App 是否真正“支持暗黑模式”，最花时间的往往是第三方组件清点，而不是 Flutter 原生组件配置。

### 坑 3：主题切换后图片闪烁

原因通常有两个：

1. 切主题时资源路径变化，触发重新解码
2. 大图未缓存，切换时重新加载

优化策略：

- 首页关键主题资源提前 `precacheImage`
- 重要 logo 资源尽量控制尺寸
- 不要为一张小图引入过重的运行时变换逻辑

### 坑 4：Hero 动画在亮暗切换时显得很怪

如果某个卡片使用 `Hero`，切主题瞬间背景和前景颜色都在变，动画过渡容易产生违和感。

解决：

- 减少切主题时正在进行的复杂转场
- 尽量使用语义一致的容器色
- 需要时给主题切换加短暂淡入淡出，而不是硬切

### 坑 5：Web 端首屏闪白

Flutter Web 上，即使你的 App 首帧是暗色，浏览器初始背景也可能先白一下。

解决方向：

- 调整 `web/index.html` 初始背景色
- 启动阶段尽量提前读取本地主题偏好
- Splash / loading 页也要做暗色版本

### 坑 6：纯黑模式不是简单把所有灰都改成黑

很多 OLED 机型用户很喜欢“纯黑模式”，省电也更酷，但千万别直接：

```dart
surface = Colors.black;
surfaceContainerLow = Colors.black;
surfaceContainerHighest = Colors.black;
```

这样最后整个界面会失去层次，卡片和背景粘在一起，分隔线也看不见。

正确做法是：

- 背景接近黑
- 容器保留轻微层次
- outline / divider 提供极弱对比

否则视觉会非常糊。

### 坑 7：把主题对象做成 const 或全局静态后，动态种子色不生效

例如：

```dart
class AppThemes {
  static final lightTheme = AppThemeFactory.lightFromSeed(Colors.blue);
}
```

这样当用户修改主色时，`lightTheme` 已经构建好了，不会自动随配置变化。

正确做法：**主题对象应该从当前配置实时生成，而不是偷懒做成固定单例。**

### 坑 8：自定义 CustomPainter 忘了响应亮暗变化

这类问题在图表、进度环、时间轴、波形图、自定义背景装饰里非常常见。很多人会把颜色写死在 Painter 构造时，结果主题切换以后，Flutter 组件本身都变了，唯独自绘区域还是旧颜色。

一个更稳的做法是显式把亮暗相关颜色作为 painter 参数传入，并正确实现 `shouldRepaint`：

```dart
class ThemeAwareChart extends StatelessWidget {
  const ThemeAwareChart({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return CustomPaint(
      size: const Size(double.infinity, 160),
      painter: TrendPainter(
        lineColor: scheme.primary,
        gridColor: scheme.outlineVariant,
        fillColor: scheme.primary.withValues(alpha: 0.12),
        labelColor: scheme.onSurfaceVariant,
      ),
    );
  }
}

class TrendPainter extends CustomPainter {
  TrendPainter({
    required this.lineColor,
    required this.gridColor,
    required this.fillColor,
    required this.labelColor,
  });

  final Color lineColor;
  final Color gridColor;
  final Color fillColor;
  final Color labelColor;

  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;

    final linePaint = Paint()
      ..color = lineColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    final fillPaint = Paint()
      ..color = fillColor
      ..style = PaintingStyle.fill;

    final path = Path()
      ..moveTo(0, size.height * 0.7)
      ..quadraticBezierTo(
        size.width * 0.25,
        size.height * 0.25,
        size.width * 0.5,
        size.height * 0.45,
      )
      ..quadraticBezierTo(
        size.width * 0.75,
        size.height * 0.65,
        size.width,
        size.height * 0.2,
      );

    canvas.drawLine(
      Offset(0, size.height - 1),
      Offset(size.width, size.height - 1),
      gridPaint,
    );

    final fillPath = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();

    canvas.drawPath(fillPath, fillPaint);
    canvas.drawPath(path, linePaint);

    final textPainter = TextPainter(
      text: TextSpan(
        text: 'Dark-aware chart',
        style: TextStyle(color: labelColor, fontSize: 12),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    textPainter.paint(canvas, const Offset(0, 0));
  }

  @override
  bool shouldRepaint(covariant TrendPainter oldDelegate) {
    return lineColor != oldDelegate.lineColor ||
        gridColor != oldDelegate.gridColor ||
        fillColor != oldDelegate.fillColor ||
        labelColor != oldDelegate.labelColor;
  }
}
```

这里的关键点有三个：

- 颜色从 `Theme.of(context)` 的最新值传入
- 不在 painter 内部偷偷读取全局静态颜色
- `shouldRepaint` 要覆盖颜色变化，否则切主题后可能不触发重绘

---

## 十四、测试与验收：如何确认你的暗黑模式真的可上线

我一般会把暗黑模式验收拆成四层。

### 14.1 基础页面检查

至少检查：

- 首页
- 列表页
- 详情页
- 设置页
- 登录页
- 搜索页
- 空状态页
- 弹窗 / BottomSheet / SnackBar / Toast

### 14.2 组件级检查

逐项确认：

- TextField 光标、hint、border
- Checkbox / Switch / Radio
- AppBar / TabBar / NavigationBar
- Card / Divider / Chip
- Skeleton / Loading / ProgressIndicator
- 日期选择器、时间选择器

### 14.3 资源检查

重点看：

- logo
- 启动图
- 空状态插画
- SVG 图标
- 用户上传透明图
- 地图底图或图表颜色

### 14.4 场景切换检查

重点测试这几条链路：

1. 系统亮色 → 系统暗色，App 前台是否即时切换
2. App 设置为跟随系统时，冷启动是否正确恢复
3. App 强制暗色时，系统切回亮色是否仍保持暗色
4. 切换主题后返回前一页，是否有缓存色未更新
5. 横竖屏切换、后台恢复后，主题是否一致

这一步千万别省，因为暗黑模式 bug 经常都出现在状态边界，而不是静态页面。

### 14.5 Widget Test：把亮暗切换写进自动化测试

很多团队会手动点一遍主题切换就算验收，但对于设置页、主题持久化、跟随系统这几类关键链路，最好至少补几条 Widget Test。这样以后改 `ThemeController`、替换状态管理方案、升级 Flutter 版本时，不容易把已有行为改坏。

下面是一个针对主题切换的简化测试示例：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('切换到深色主题后页面背景应更新', (tester) async {
    final controller = ThemeController(
      FakeThemeRepository(),
      const ThemeConfig(
        preference: AppThemePreference.light,
        seedColorValue: 0xFF6750A4,
        pureBlack: false,
      ),
    );

    await tester.pumpWidget(
      AnimatedBuilder(
        animation: controller,
        builder: (context, _) {
          return MaterialApp(
            theme: controller.lightTheme,
            darkTheme: controller.darkTheme,
            themeMode: controller.themeMode,
            home: const Scaffold(
              body: ColoredBox(
                key: Key('page-bg'),
                color: Colors.transparent,
                child: SizedBox.expand(),
              ),
            ),
          );
        },
      ),
    );

    expect(Theme.of(tester.element(find.byKey(const Key('page-bg')))).brightness,
        Brightness.light);

    await controller.updatePreference(AppThemePreference.dark);
    await tester.pumpAndSettle();

    expect(Theme.of(tester.element(find.byKey(const Key('page-bg')))).brightness,
        Brightness.dark);
  });

  testWidgets('跟随系统时应根据平台亮度切换', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppThemeFactory.lightFromSeed(const Color(0xFF6750A4)),
        darkTheme: AppThemeFactory.darkFromSeed(
          const Color(0xFF6750A4),
          pureBlack: false,
        ),
        themeMode: ThemeMode.system,
        home: Builder(
          builder: (context) {
            return Text(
              Theme.of(context).brightness.name,
              textDirection: TextDirection.ltr,
            );
          },
        ),
      ),
    );

    expect(find.text('dark'), findsOneWidget);
  });
}

class FakeThemeRepository implements ThemeRepository {
  @override
  ThemeConfig read() {
    return const ThemeConfig(
      preference: AppThemePreference.system,
      seedColorValue: 0xFF6750A4,
      pureBlack: false,
    );
  }

  @override
  Future<void> write(ThemeConfig config) async {}
}
```

如果你想再进一步，建议自动化覆盖这几类断言：

- 设置页切换 light / dark / system 三态
- 冷启动恢复持久化主题值
- `ThemeExtension` 的业务色在亮暗主题下都能正确读取
- 自定义 painter 或图表组件在主题切换后会重绘

测试一旦补上，后续重构主题代码时心里会踏实很多。

### 14.6 平台差异检查：iOS、Android、Web、桌面端关注点不同

暗黑模式验收最好不要只拿 Android 模拟器过一遍，因为 Flutter 是跨平台框架，不同平台的系统栏、窗口背景、滚动效果、输入控件默认样式都会影响最终观感。

可以按下面这张表来做检查：

| 平台 | 重点关注项 | 实战建议 |
| --- | --- | --- |
| Android | 状态栏/导航栏图标、Android 12+ 动态颜色、系统深浅切换回调 | 真机验证 `SystemUiOverlayStyle`，确认是否接入 `dynamic_color` |
| iOS | 状态栏前景色、Cupertino 组件、页面转场时的亮暗一致性 | 混用 CupertinoWidget 时补齐 `CupertinoThemeData` |
| Web | 首屏闪白、浏览器背景色、图片与阴影在深色背景下的对比度 | 同步检查 `web/index.html` 初始背景与 loading 态 |
| macOS / Windows | 窗口标题栏、滚动条、右键菜单、键盘焦点高亮 | 检查桌面端窗口层与 Material 主题是否割裂 |

如果项目里同时用了 `Material` 和 `Cupertino` 组件，尤其要补一层平台主题桥接：

```dart
MaterialApp(
  theme: lightTheme,
  darkTheme: darkTheme,
  themeMode: controller.themeMode,
  builder: (context, child) {
    final materialTheme = Theme.of(context);

    return CupertinoTheme(
      data: CupertinoThemeData(
        brightness: materialTheme.brightness,
        primaryColor: materialTheme.colorScheme.primary,
        scaffoldBackgroundColor: materialTheme.colorScheme.surface,
        barBackgroundColor: materialTheme.colorScheme.surface,
        textTheme: CupertinoTextThemeData(
          primaryColor: materialTheme.colorScheme.onSurface,
        ),
      ),
      child: child ?? const SizedBox.shrink(),
    );
  },
)
```

这样能减少 `CupertinoNavigationBar`、`CupertinoDialog`、`CupertinoSwitch` 在暗色模式下“看起来像另一个 App”的割裂感。

### 14.7 方案选型对比：手写 ThemeData、主题包、系统跟随各适合什么场景

很多团队在做暗黑模式时会纠结：到底应该完全手写 `ThemeData`，还是接入主题管理包，还是只做一个“跟随系统”就够了？这个问题没有绝对答案，更适合按项目复杂度来选。

| 方案 | 优点 | 缺点 | 适合场景 |
| --- | --- | --- | --- |
| 手写 `ThemeData + ColorScheme` | 可控性最高，和设计系统贴合，便于扩展 `ThemeExtension`、品牌色、纯黑模式 | 前期设计与维护成本较高，需要自己处理持久化、测试、第三方组件适配 | 中大型项目、设计规范明确的商业应用 |
| 主题管理包（如 `adaptive_theme`、`flex_color_scheme`） | 上手快，内置较多能力，适合快速落地基础主题切换 | 复杂业务下容易受包的抽象边界限制，定制深时仍需回到原生 ThemeData | 中小项目、原型验证、希望快速搭建主题系统 |
| 仅跟随系统主题 | 成本最低，用户认知负担小，与平台体验一致 | 无法满足手动切换、品牌换肤、纯黑模式、持久化偏好等需求 | 工具类 App、对个性化配置要求不高的项目 |

我的实践建议是：

- **长期维护的正式项目**：优先手写 `ThemeData + ColorScheme`
- **想减少重复造轮子**：可以参考 `flex_color_scheme` 生成主题，再逐步收口成自己的工厂
- **只想快速补齐系统暗黑适配**：先上 `ThemeMode.system`，但要把图片、状态栏、自绘组件一起处理掉

---

## 十五、我的最终建议：怎么做一套不容易烂尾的主题系统

如果你准备在真实 Flutter 项目里落地暗黑模式，我建议按下面这个顺序做：

### 方案建议

1. **先搭统一 ThemeFactory**
   - 所有 `ThemeData` 统一从这里生成
   - 亮色、暗色都基于 `ColorScheme`

2. **引入 ThemeExtension 管业务色**
   - 不要把 success/warning/profit 这些硬塞到业务常量里

3. **主题偏好使用三态：light/dark/system**
   - 不要只做一个 bool `isDark`

4. **持久化至少先落 shared_preferences**
   - 若存在更多自定义配置，再升级到 Hive

5. **主题颜色在 build 中读取，避免缓存**
   - 特别是自定义 painter、图表、controller 初始化

6. **提前清点第三方组件和图片资源**
   - 暗黑模式的 60% 成本常常在这里

7. **做好首屏初始化，避免闪主题**
   - 冷启动体验比你想象中更影响观感

### 架构上的一句话总结

> 把暗黑模式当成“全局设计系统能力”来建设，而不是“设置页里多一个开关”。

只有这样，你的主题系统才不会在后续新增页面、新增业务组件时持续返工。

---

## 十六、结语

Flutter 的暗黑模式，从 API 层面看并不复杂：`theme`、`darkTheme`、`themeMode` 三件套就能启动。但一旦进入生产环境，真正决定质量的不是“能不能切”，而是：

- 切换是否稳定
- 跟随系统是否准确
- 状态是否可持久化
- 组件、图片、SVG、系统栏是否一致
- 主题架构是否支持未来扩展

如果你正在重构一个已有项目，我建议优先做这三件事：

1. 先把 `ColorScheme + ThemeFactory` 统一起来
2. 再把主题偏好做成可持久化状态
3. 最后批量扫组件、资源和第三方库适配

这样推进最稳，也最符合真实项目节奏。

当你把这些基础设施搭好之后，后续不管是接动态颜色、品牌换肤、纯黑模式、高对比度模式，还是做多租户主题，都有可持续演进的空间。

如果只想记住一句话，那就是：

**Flutter 暗黑模式的核心，不是把颜色改黑，而是建立一套围绕 `ThemeData + ColorScheme + 持久化状态` 的完整主题系统。**

## 相关阅读

- [Flutter 本地存储实战：Hive、Isar、SQLite 数据持久化方案对比](/post/flutter-hive-isar-sqlite/)
- [Flutter 响应式布局实战：屏幕适配、折叠屏、平板适配策略](/post/flutter/)
- [Flutter 国际化实战：flutter_localizations 多语言与 RTL 支持](/post/flutter-localizations-rtl/)
- [Flutter 状态管理实战：Riverpod、Bloc、GetX 选型对比与最佳实践](/post/flutter-riverpod-bloc-getx/)
- [Flutter 3.x 实战：Dart 语言基础与 Widget 体系详解](/post/flutter-dart-widget/)
