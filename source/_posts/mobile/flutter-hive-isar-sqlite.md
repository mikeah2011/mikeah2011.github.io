---
title: Flutter 本地存储实战：Hive/Isar/SQLite 数据持久化方案对比
date: 2026-06-01 09:00:00
tags: [Flutter, Hive, Isar, SQLite, 本地存储, 数据持久化, SharedPreferences, 数据迁移]
keywords: [Flutter, Hive, Isar, SQLite, 本地存储实战, 数据持久化方案对比, 移动端]
description: 本文从 Flutter 实战角度系统对比本地存储方案，围绕 Hive、Isar、SQLite 展开安装、CRUD、数据迁移、加密存储、性能 benchmark 与离线缓存设计，帮助你结合数据结构、查询复杂度与长期维护成本完成数据持久化方案对比与选型落地。
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
---


# Flutter 本地存储实战：Hive/Isar/SQLite 数据持久化方案对比

Flutter 做到中大型项目之后，本地存储就不再是“顺手把数据存一下”这么简单。登录态要不要落盘？用户偏好设置是放 SharedPreferences 还是对象数据库？列表页离线缓存是用 Key-Value、对象存储还是关系型数据库？数据量从几十条增长到几万条之后，查询性能、索引能力、迁移成本和调试体验都会立刻成为真实问题。

我在实际 Flutter 项目里踩过一轮比较典型的坑：一开始图省事，偏好设置、缓存数据、草稿箱、最近浏览记录统统往同一种存储方案里塞，前期开发非常快，后期却因为数据模型复杂、查询维度增加、迁移麻烦和性能波动，不得不拆分重构。也正因为这样，Hive、Isar、SQLite 这三类方案我基本都在真实业务里用过：Hive 适合轻量级对象持久化，Isar 在 Flutter 生态里属于现代化高性能本地数据库，SQLite 则依然是最稳、最通用、最有工程沉淀的选择。

这篇文章不打算做“百科式罗列”，而是站在实战视角，从安装、数据模型、增删改查、事务、索引、迁移、加密、性能和选型建议几个维度，把 Hive、Isar、SQLite 这三种本地存储方案拉到同一张桌子上对比。文中的代码示例会尽量贴近业务场景，性能数据会给出测试思路与可复用的 benchmark 样例，最后再用“用户偏好设置 + 离线缓存”的完整案例，演示项目里如何组合使用它们。

> 先说结论：**没有一种本地存储能通吃所有场景。** 如果你的 Flutter 项目已经开始涉及离线能力、复杂查询、对象关系、批量写入或版本迁移，选型时最好把“未来半年会长成什么样”一起考虑进去，而不是只看今天写起来快不快。

---

## 一、Flutter 本地存储方案概览

Flutter 生态中的本地存储大致可以分成四类：

1. **Key-Value 存储**：如 `shared_preferences`、Hive 的基础 Box 用法。
2. **对象数据库**：如 Hive、Isar，把 Dart 对象映射为可持久化实体。
3. **关系型数据库**：如 SQLite，通过表、字段、索引、SQL 来组织数据。
4. **文件缓存**：适合图片、下载资源、日志、导出文件等大块数据。

本文聚焦最常见也最容易在项目里碰到的三种：**Hive、Isar、SQLite**。

### 1.1 三者的定位差异

先给一个总体画像：

| 方案 | 数据模型 | 查询能力 | 上手成本 | 性能特征 | 典型场景 |
|------|----------|----------|----------|----------|----------|
| Hive | Key-Value / 对象 | 基础，偏简单 | 低 | 小数据量写入快，API 简单 | 设置项、草稿、轻量缓存 |
| Isar | 对象数据库 | 强，支持索引与链式查询 | 中 | 读写快，移动端体验好 | 离线数据、列表缓存、复杂本地对象 |
| SQLite | 关系型数据库 | 最强，SQL 灵活 | 中到高 | 稳定成熟，事务能力强 | 复杂业务数据、统计分析、多表关系 |

### 1.2 选型时真正需要看的不是“流行度”

很多同学在选型时会先看这几个问题：

- GitHub Stars 多不多？
- 教程多不多？
- API 好不好写？

这些当然重要，但真正影响长期维护的是下面这些维度：

- **数据结构是否稳定**：频繁变更字段的模型更需要考虑迁移成本。
- **查询维度是否复杂**：只按 key 取值，和按时间、状态、用户、关键词联合过滤，是完全不同的难度。
- **是否有关系数据**：订单、评论、商品、用户这类天然多表关系，SQLite 更有优势。
- **是否需要事务与一致性**：比如“写缓存 + 更新索引 + 记录同步状态”是否要求原子性。
- **数据量级与生命周期**：几十条、几百条、几万条，方案体验差异很大。
- **是否有离线优先需求**：是否需要本地先展示，再增量同步。
- **是否需要加密**：不仅是密码 token，还包括本地敏感业务数据。

### 1.3 一个实用的判断口诀

在项目评审里，我通常会这么快速判断：

- **偏好设置/轻量缓存/对象草稿**：先看 Hive。
- **本地对象多、查询不算 SQL 级复杂、希望性能好且写法现代**：优先看 Isar。
- **多表关系、聚合统计、复杂筛选、事务严格**：直接 SQLite，必要时配合 drift。

### 1.4 为什么不只用 SharedPreferences

很多 Flutter 项目的本地存储第一反应是 `shared_preferences`。它适合少量配置项，比如：

- 是否开启深色模式
- 最近一次登录账号
- 是否展示新手引导
- 某个开关状态

但一旦你要存这些内容，它就开始吃力：

- 用户资料对象
- 列表缓存
- 分页数据
- 搜索历史对象
- 离线草稿
- 同步队列

原因很简单：`shared_preferences` 本质上不是为复杂对象和大规模数据设计的。把 JSON 字符串塞进去虽然能跑，但后续的字段迁移、性能与维护体验都很差。

所以从工程角度看，**SharedPreferences 是配置项工具，不是通用数据库。** 真正进入“数据持久化”范畴后，Hive、Isar、SQLite 才是主角。

---

## 二、Hive 详解：轻量易用的对象存储

Hive 最大的优点就是两个字：**直接**。它不要求你写 SQL，不要求你设计关系模型，也不需要复杂初始化。对于很多“我就是想把一个对象快速存在本地”的场景，它的开发体验非常好。

### 2.1 Hive 的适用定位

Hive 最适合下面这类需求：

- 用户偏好设置
- 表单草稿
- 简单对象缓存
- 不需要复杂筛选的列表数据
- App 启动时要快速读取的小体量数据

如果你已经知道将来一定会有：

- 多字段联合查询
- 大规模列表筛选
- 复杂索引
- 本地数据分析
- 大量关系型结构

那 Hive 往往不是最终答案。

### 2.2 安装与初始化

常见依赖如下：

```yaml
dependencies:
  hive: ^2.2.3
  hive_flutter: ^1.1.0

dev_dependencies:
  build_runner: ^2.4.10
  hive_generator: ^2.0.1
```

初始化代码：

```dart
import 'package:flutter/widgets.dart';
import 'package:hive_flutter/hive_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Hive.initFlutter();

  // 注册自定义对象适配器
  Hive.registerAdapter(UserPreferenceAdapter());
  Hive.registerAdapter(OfflineArticleAdapter());

  await Hive.openBox<UserPreference>('preferences');
  await Hive.openBox<OfflineArticle>('articles');
  await Hive.openBox('app_meta');

  runApp(const MyApp());
}
```

这里有两个实战经验：

1. **启动阶段别无脑打开所有 Box**。如果 Box 很多、数据量较大，会拖慢冷启动。建议只打开启动必需的数据，其他延迟加载。
2. **注册 Adapter 顺序统一管理**。可以封装一个 `HiveRegistry.init()`，避免多人协作时漏注册或重复注册。

### 2.3 Box 的基本操作

Hive 的核心概念是 `Box`。你可以把它理解成一个持久化 Map，只不过它比普通 Map 多了落盘能力。

```dart
final settingsBox = Hive.box('app_meta');

await settingsBox.put('theme_mode', 'dark');
await settingsBox.put('font_scale', 1.1);

final themeMode = settingsBox.get('theme_mode', defaultValue: 'light');
final fontScale = settingsBox.get('font_scale', defaultValue: 1.0);

await settingsBox.delete('font_scale');
await settingsBox.clear();
```

如果只是存简单键值对，Hive 的体验确实比 SQLite 轻很多。

### 2.4 存储对象：TypeAdapter 才是 Hive 的核心能力

Hive 真正比纯 Key-Value 更进一步的地方，在于它可以存 Dart 对象。但为了做到高效序列化，需要定义 `TypeAdapter`。

先定义模型：

```dart
import 'package:hive/hive.dart';

part 'user_preference.g.dart';

@HiveType(typeId: 1)
class UserPreference extends HiveObject {
  @HiveField(0)
  final bool enableNotification;

  @HiveField(1)
  final String locale;

  @HiveField(2)
  final String themeMode;

  @HiveField(3)
  final List<String> favoriteTags;

  const UserPreference({
    required this.enableNotification,
    required this.locale,
    required this.themeMode,
    required this.favoriteTags,
  });

  UserPreference copyWith({
    bool? enableNotification,
    String? locale,
    String? themeMode,
    List<String>? favoriteTags,
  }) {
    return UserPreference(
      enableNotification: enableNotification ?? this.enableNotification,
      locale: locale ?? this.locale,
      themeMode: themeMode ?? this.themeMode,
      favoriteTags: favoriteTags ?? this.favoriteTags,
    );
  }
}
```

生成代码：

```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

然后就可以像这样写入对象：

```dart
final prefBox = Hive.box<UserPreference>('preferences');

const preference = UserPreference(
  enableNotification: true,
  locale: 'zh_CN',
  themeMode: 'system',
  favoriteTags: ['Flutter', 'Dart', 'AI'],
);

await prefBox.put('current_user_preference', preference);

final saved = prefBox.get('current_user_preference');
print(saved?.locale);
```

### 2.5 TypeAdapter 的维护注意事项

Hive 的坑很多都和 `@HiveField` 有关。

**关键原则：字段编号一旦发布，不要随意复用。**

例如你原来这样定义：

```dart
@HiveField(0)
final String name;

@HiveField(1)
final int age;
```

后面如果删掉 `age`，也不要把 `1` 重新给别的字段。否则老数据反序列化时会错位，轻则解析失败，重则读出脏数据。

更稳妥的演进方式是：

```dart
@HiveField(0)
final String name;

@HiveField(1)
final int? age; // 已废弃但保留编号

@HiveField(2)
final String? phone;
```

实战里建议：

- 给每个模型维护字段编号注释。
- 在 PR review 时把字段编号改动列为检查项。
- 发布过的 `typeId` 也不要轻易改。

### 2.6 监听数据变化

Hive 支持监听 Box 数据变化，这在设置页、草稿箱、收藏列表等场景特别方便。

```dart
ValueListenableBuilder(
  valueListenable: Hive.box<UserPreference>('preferences').listenable(),
  builder: (context, box, _) {
    final preference = box.get('current_user_preference');
    return Text('当前语言：${preference?.locale ?? 'zh_CN'}');
  },
)
```

这个能力让 Hive 在简单响应式页面里很好用。但注意：**监听是 Box 级别，不是复杂查询级别。** 当业务越来越复杂时，你会发现它不如 Isar 或 SQLite 那么精细。

### 2.7 批量写入与性能习惯

Hive 在少量对象写入时很顺手，但如果你直接在循环里逐个 `put`，体验不一定好。

建议优先使用批量接口：

```dart
await prefBox.putAll({
  'user_1': pref1,
  'user_2': pref2,
  'user_3': pref3,
});
```

对于缓存列表，也可以按业务拆箱：

- `article_summary_box`
- `article_detail_box`
- `user_preference_box`
- `draft_box`

而不是所有对象都往一个大 Box 里堆。

### 2.8 Hive 加密

Hive 支持基于 `HiveAesCipher` 的加密存储，这对 token、隐私配置、敏感业务草稿很有价值。

```dart
import 'dart:typed_data';
import 'package:hive_flutter/hive_flutter.dart';

Future<Box> openEncryptedBox() async {
  final key = Uint8List.fromList([
    12, 44, 99, 120, 3, 88, 210, 11,
    76, 54, 9, 222, 41, 18, 73, 66,
    90, 12, 54, 87, 111, 2, 35, 200,
    99, 41, 72, 63, 10, 8, 144, 31,
  ]);

  return Hive.openBox(
    'secure_box',
    encryptionCipher: HiveAesCipher(key),
  );
}
```

但这里一定要注意一个现实问题：**加密密钥不要硬编码在代码里。**

更合理的做法是：

- 首次生成随机密钥；
- 把密钥存到 `flutter_secure_storage`；
- 启动时再读取密钥来打开加密 Box。

示例：

```dart
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class HiveEncryptionService {
  static const _keyName = 'hive_secure_key';
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  Future<Uint8List> getOrCreateKey() async {
    final existing = await _secureStorage.read(key: _keyName);
    if (existing != null) {
      return Uint8List.fromList(base64Decode(existing));
    }

    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    await _secureStorage.write(
      key: _keyName,
      value: base64Encode(bytes),
    );
    return Uint8List.fromList(bytes);
  }
}
```

### 2.9 Hive 的优点与短板总结

**优点：**

- API 简单，开发上手快。
- 存对象体验自然，适合 Flutter 风格。
- 对轻量数据持久化非常友好。
- 加密能力可用，适合简单安全需求。

**短板：**

- 查询能力偏弱，复杂过滤不擅长。
- 模型演进依赖 `TypeAdapter` 编号管理，团队协作时容易踩坑。
- 大规模复杂数据管理能力一般。
- 不适合强事务、多表关系、复杂统计。

如果你把 Hive 定位成“增强版对象缓存 + 设置存储”，它会很好用；如果你把它当成“万能本地数据库”，后面就大概率会重构。

### 2.10 Hive 完整 CRUD 示例：用户偏好 + 最近浏览

前面介绍了基础操作，这里给一个更完整、可直接落地到项目中的 Hive CRUD 示例。假设我们要保存当前用户偏好，以及最近浏览文章列表。

```dart
@HiveType(typeId: 10)
class RecentArticle extends HiveObject {
  @HiveField(0)
  final String articleId;

  @HiveField(1)
  final String title;

  @HiveField(2)
  final DateTime visitedAt;

  const RecentArticle({
    required this.articleId,
    required this.title,
    required this.visitedAt,
  });
}

class HivePreferenceRepository {
  final Box<UserPreference> preferenceBox;
  final Box<RecentArticle> recentBox;

  HivePreferenceRepository({
    required this.preferenceBox,
    required this.recentBox,
  });

  Future<void> createPreference(UserPreference preference) async {
    await preferenceBox.put(preference.userId, preference);
  }

  UserPreference? readPreference(String userId) {
    return preferenceBox.get(userId);
  }

  Future<void> updatePreference({
    required String userId,
    bool? enableNotification,
    String? locale,
    String? themeMode,
    List<String>? favoriteTags,
  }) async {
    final current = preferenceBox.get(userId);
    if (current == null) return;

    await preferenceBox.put(
      userId,
      current.copyWith(
        enableNotification: enableNotification,
        locale: locale,
        themeMode: themeMode,
        favoriteTags: favoriteTags,
      ),
    );
  }

  Future<void> deletePreference(String userId) async {
    await preferenceBox.delete(userId);
  }

  Future<void> addRecentArticle(RecentArticle article) async {
    await recentBox.put(article.articleId, article);
  }

  List<RecentArticle> listRecentArticles() {
    final items = recentBox.values.toList()
      ..sort((a, b) => b.visitedAt.compareTo(a.visitedAt));
    return items;
  }

  Future<void> clearRecents() async {
    await recentBox.clear();
  }
}
```

这个示例也说明了 Hive 的边界：**CRUD 写起来很快，但列表筛选、排序、分页主要还是靠 Dart 层处理。** 如果最近浏览上升到几万条，或者你要做“按分类、时间、关键词组合检索”，就应该考虑 Isar 或 SQLite。

### 2.11 Hive migration 完整示例

Hive 没有像 SQLite 那样内建版本脚本系统，因此 migration 更多依赖你自己维护元信息和启动时升级逻辑。下面给一个完整示例：把旧版 `themeMode` 从 `String` 升级成更规范的枚举字符串，并补充 `favoriteTags` 默认值。

```dart
class HiveMigrationRunner {
  final Box appMetaBox;
  final Box<UserPreference> preferenceBox;

  HiveMigrationRunner({
    required this.appMetaBox,
    required this.preferenceBox,
  });

  static const _schemaVersionKey = 'preference_schema_version';
  static const _latestVersion = 2;

  Future<void> run() async {
    final currentVersion = appMetaBox.get(_schemaVersionKey, defaultValue: 1) as int;
    if (currentVersion >= _latestVersion) return;

    if (currentVersion < 2) {
      await _migrateV1ToV2();
    }

    await appMetaBox.put(_schemaVersionKey, _latestVersion);
  }

  Future<void> _migrateV1ToV2() async {
    final entries = preferenceBox.toMap();
    final updates = <dynamic, UserPreference>{};

    for (final entry in entries.entries) {
      final old = entry.value;
      final normalizedTheme = switch (old.themeMode) {
        '0' || 'lightMode' => 'light',
        '1' || 'darkMode' => 'dark',
        _ => 'system',
      };

      updates[entry.key] = old.copyWith(
        themeMode: normalizedTheme,
        favoriteTags: old.favoriteTags.isEmpty ? ['Flutter'] : old.favoriteTags,
      );
    }

    await preferenceBox.putAll(updates);
  }
}
```

实战建议是把 migration 和业务初始化拆开：先 `openBox`，再执行 migration，最后才对外暴露 repository。migration 过程中尽量打印版本、处理数量和失败记录，方便排查线上升级问题。

### 2.12 Hive 加密存储完整示例：安全偏好设置仓库

前面展示了加密 Box 的打开方式，这里补一个更完整的仓库封装，用来存储敏感偏好，比如“生物识别开关、上次登录账号、草稿自动恢复开关”等。

```dart
class SecurePreferenceRepository {
  final FlutterSecureStorage secureStorage;

  SecurePreferenceRepository(this.secureStorage);

  Future<Box> _openSecureBox() async {
    final existing = await secureStorage.read(key: 'hive_secure_key');
    final keyBytes = existing != null
        ? base64Decode(existing)
        : await _createAndPersistKey();

    return Hive.openBox(
      'secure_preferences',
      encryptionCipher: HiveAesCipher(Uint8List.fromList(keyBytes)),
    );
  }

  Future<List<int>> _createAndPersistKey() async {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    await secureStorage.write(
      key: 'hive_secure_key',
      value: base64Encode(bytes),
    );
    return bytes;
  }

  Future<void> saveSensitiveFlags({
    required bool biometricEnabled,
    required bool autoRestoreDraft,
    required String lastLoginAccount,
  }) async {
    final box = await _openSecureBox();
    await box.putAll({
      'biometric_enabled': biometricEnabled,
      'auto_restore_draft': autoRestoreDraft,
      'last_login_account': lastLoginAccount,
    });
  }

  Future<Map<String, dynamic>> readSensitiveFlags() async {
    final box = await _openSecureBox();
    return {
      'biometricEnabled': box.get('biometric_enabled', defaultValue: false),
      'autoRestoreDraft': box.get('auto_restore_draft', defaultValue: true),
      'lastLoginAccount': box.get('last_login_account', defaultValue: ''),
    };
  }
}
```

如果你需要密钥轮换，可以增加“旧箱子读出 -> 新密钥重开箱子 -> 全量写回 -> 删除旧箱子”的流程。对纯缓存数据来说，轮换失败时也可以直接清理重建；对用户私密数据则建议做显式备份与恢复提示。

---

## 三、Isar 详解：为 Flutter 量身打造的高性能对象数据库

如果说 Hive 是“轻量直给”，那 Isar 更像是“现代化、本地优先、性能导向”的方案。它兼顾对象化建模和更强的查询能力，在 Flutter 生态里的定位非常独特：不像 SQLite 那样偏传统 SQL，也不像 Hive 那样主要擅长简单对象存储，而是更像移动端本地对象数据库的中间最优解。

### 3.1 Isar 适合什么场景

我一般会在这些情况优先考虑 Isar：

- 需要存储较多结构化对象；
- 需要按字段过滤、排序、范围查询；
- 列表数据有离线优先需求；
- 希望代码层面少写 SQL；
- 想要比 Hive 更强的查询与索引能力；
- 数据模型以对象为中心，而不是典型关系型设计。

### 3.2 安装与初始化

依赖示例：

```yaml
dependencies:
  isar: ^3.1.0
  isar_flutter_libs: ^3.1.0
  path_provider: ^2.1.3

dev_dependencies:
  build_runner: ^2.4.10
  isar_generator: ^3.1.0
```

定义集合前，先准备初始化：

```dart
import 'package:flutter/widgets.dart';
import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';

late final Isar isar;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final dir = await getApplicationDocumentsDirectory();
  isar = await Isar.open(
    [UserPreferenceEntitySchema, CachedArticleSchema],
    directory: dir.path,
    inspector: true,
  );

  runApp(const MyApp());
}
```

实际项目里建议：

- 用单例管理 `Isar` 实例；
- 把 schema 注册集中在一个文件里；
- 区分 debug 与 release 是否开启 inspector；
- 对大型项目提前规划 collection 边界。

### 3.3 Schema 定义

Isar 的模型声明是核心中的核心。下面用一个用户偏好实体举例：

```dart
import 'package:isar/isar.dart';

part 'user_preference_entity.g.dart';

@collection
class UserPreferenceEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String userId;

  late bool enableNotification;

  @enumerated
  late ThemeModeValue themeMode;

  late String locale;

  List<String> favoriteTags = [];

  DateTime updatedAt = DateTime.now();
}

enum ThemeModeValue {
  light,
  dark,
  system,
}
```

几个重点：

- `@collection` 表示一个可持久化集合。
- `Id` 是主键，支持自增。
- `@Index` 可定义索引，直接影响查询效率。
- `replace: true` 对唯一键更新场景很实用。
- `enum` 需要注意序列化方式和后续演进。

生成代码：

```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

### 3.4 基础写入与事务

Isar 的写操作必须在 `writeTxn` 中执行，这是一个非常好的设计。它强迫你思考数据修改边界。

```dart
Future<void> savePreference(UserPreferenceEntity preference) async {
  await isar.writeTxn(() async {
    await isar.userPreferenceEntitys.put(preference);
  });
}
```

批量写入也很自然：

```dart
Future<void> saveArticles(List<CachedArticle> articles) async {
  await isar.writeTxn(() async {
    await isar.cachedArticles.putAll(articles);
  });
}
```

为什么我很喜欢这一点？因为它比“随时随地写库”更不容易失控。尤其在离线缓存和同步逻辑里，把一组修改包裹进事务非常重要。

### 3.5 查询能力：比 Hive 强很多，但写法仍然对象化

Hive 的典型读取方式是按 key 直接取，而 Isar 更像一个真正的本地数据库，可以按字段做查询。

先看几个常见查询：

```dart
final preference = await isar.userPreferenceEntitys
    .filter()
    .userIdEqualTo('u_1001')
    .findFirst();
```

按时间排序：

```dart
final latestArticles = await isar.cachedArticles
    .where()
    .sortByUpdatedAtDesc()
    .limit(20)
    .findAll();
```

多条件过滤：

```dart
final unreadTechArticles = await isar.cachedArticles
    .filter()
    .categoryEqualTo('tech')
    .and()
    .isReadEqualTo(false)
    .and()
    .publishedAtGreaterThan(DateTime.now().subtract(const Duration(days: 7)))
    .findAll();
```

全文搜索并不是 Isar 的最强项，但中小规模前缀匹配、标签筛选、状态筛选完全够用。

### 3.6 索引设计：Isar 性能的关键抓手

Isar 看起来“什么都能查”，但是否真的快，关键还是索引。

以离线文章缓存为例：

```dart
@collection
class CachedArticle {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String articleId;

  @Index(caseSensitive: false)
  late String title;

  @Index()
  late String category;

  @Index()
  late DateTime publishedAt;

  @Index()
  late DateTime updatedAt;

  late bool isRead;
  late String summary;
  String? content;
}
```

索引策略建议：

1. **主业务查询字段必须建索引**。比如 `articleId`、`updatedAt`、`category`。
2. **不要把所有字段都建索引**。索引会增加写入成本和存储空间。
3. **结合真实筛选条件建索引**，不要拍脑袋。
4. **排序字段要提前规划**。列表页经常按时间倒序，就考虑对时间字段建索引。

### 3.7 Watcher：响应式数据监听是 Isar 的强项

如果你做的是离线优先应用，Isar 的 watcher 非常好用。

```dart
Stream<List<CachedArticle>> watchLatestArticles() {
  return isar.cachedArticles
      .where()
      .sortByUpdatedAtDesc()
      .limit(20)
      .watch(fireImmediately: true);
}
```

然后在 UI 层：

```dart
StreamBuilder<List<CachedArticle>>(
  stream: repository.watchLatestArticles(),
  builder: (context, snapshot) {
    final items = snapshot.data ?? [];
    return ListView.builder(
      itemCount: items.length,
      itemBuilder: (_, index) => ListTile(
        title: Text(items[index].title),
        subtitle: Text(items[index].summary),
      ),
    );
  },
)
```

这个体验比 Hive 监听 Box 更细，也比手写 SQLite 查询刷新更自然，尤其适合“本地数据变化后 UI 自动更新”的模式。

### 3.8 关联与对象建模

Isar 支持 links，可以表达对象之间的关系。但实战里我建议按业务复杂度来判断：

- 简单一对一、一对多关系：可以直接用 link。
- 非常复杂的多表关系、聚合统计：SQLite 往往更自然。

比如文章和作者：

```dart
@collection
class Author {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String authorId;
  late String name;
}

@collection
class Article {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String articleId;

  late String title;
  final author = IsarLink<Author>();
}
```

这种写法适合对象关系清晰的场景，但如果你需要复杂 join、聚合、统计报表，SQLite 依然更稳定。

### 3.9 Isar 迁移怎么做

很多人第一次接触 Isar，会问一个非常现实的问题：**Schema 改了怎么办？**

在 Isar 中，简单字段新增通常比较顺滑，但你仍然要有迁移意识。以下是实战中比较稳的策略：

#### 情况一：新增可空字段或有默认值字段

这类变更通常最安全。

```dart
@collection
class CachedArticle {
  Id id = Isar.autoIncrement;
  late String articleId;
  late String title;
  String? coverUrl; // 新增字段
}
```

一般只需要重新生成代码，并在读取时兼容空值即可。

#### 情况二：枚举值调整

这是高风险变更。比如原来：

```dart
enum SyncStatus { pending, success, failed }
```

后来改成：

```dart
enum SyncStatus { queued, syncing, done, failed }
```

如果旧数据已经落盘，枚举演进就可能带来映射问题。**建议不要随意重排枚举顺序，也不要轻易删除旧值。**

#### 情况三：字段语义变化

例如原来 `title` 存纯标题，后面改成“标题 + 副标题”的组合文本，这种其实不是简单迁移，而是业务语义变化。我的建议是：

- 新增新字段；
- 启动时跑一次数据修复逻辑；
- 验证无问题后再考虑淘汰旧字段。

迁移示例：

```dart
Future<void> migrateArticleSubtitle() async {
  final items = await isar.cachedArticles.where().findAll();

  await isar.writeTxn(() async {
    for (final item in items) {
      item.content ??= '';
      await isar.cachedArticles.put(item);
    }
  });
}
```

#### 情况四：需要重建数据库

当模型变更非常大，或者历史版本包袱太重时，最务实的做法是：

- 保留关键用户数据；
- 清理可重新拉取的缓存数据；
- 重建本地库；
- 首次启动后重新同步。

对缓存类数据，这往往比“写一个极其复杂的迁移脚本”更划算。

### 3.10 Isar 的优点与短板总结

**优点：**

- 查询能力明显强于 Hive。
- API 对 Flutter/Dart 开发者非常友好。
- 响应式监听体验优秀。
- 性能表现通常很不错，适合离线优先场景。
- 对对象模型驱动的项目很顺手。

**短板：**

- 生态成熟度和历史沉淀仍不如 SQLite。
- 非常复杂关系型查询和聚合统计不如 SQL 自然。
- schema 演进虽然不算难，但也需要纪律。
- 团队里如果大家都熟 SQL，不一定愿意接受另一套查询 DSL。

一句话总结：**Isar 是 Flutter 本地存储里非常值得认真考虑的“现代方案”，尤其适合对象驱动、离线优先、中等复杂度数据场景。**

### 3.11 Isar 完整 CRUD 示例：离线文章仓库

Isar 的优势在于“对象化 + 查询能力 + 事务”三者结合得比较平衡。下面给一个完整 CRUD 示例，覆盖创建、查询、更新阅读状态、删除过期缓存。

```dart
@collection
class OfflineArticleEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String articleId;

  @Index(caseSensitive: false)
  late String title;

  @Index()
  late String category;

  @Index()
  late DateTime updatedAt;

  late String summary;
  String? content;
  late bool isRead;
}

class IsarArticleRepository {
  final Isar isar;

  IsarArticleRepository(this.isar);

  Future<void> createArticles(List<OfflineArticleEntity> items) async {
    await isar.writeTxn(() async {
      await isar.offlineArticleEntitys.putAll(items);
    });
  }

  Future<OfflineArticleEntity?> readByArticleId(String articleId) {
    return isar.offlineArticleEntitys
        .filter()
        .articleIdEqualTo(articleId)
        .findFirst();
  }

  Future<List<OfflineArticleEntity>> queryLatestUnread(String category) {
    return isar.offlineArticleEntitys
        .filter()
        .categoryEqualTo(category)
        .and()
        .isReadEqualTo(false)
        .sortByUpdatedAtDesc()
        .findAll();
  }

  Future<void> updateContent({
    required String articleId,
    required String content,
  }) async {
    final entity = await readByArticleId(articleId);
    if (entity == null) return;

    entity.content = content;
    entity.updatedAt = DateTime.now();

    await isar.writeTxn(() async {
      await isar.offlineArticleEntitys.put(entity);
    });
  }

  Future<void> markAsRead(String articleId) async {
    final entity = await readByArticleId(articleId);
    if (entity == null) return;

    entity.isRead = true;
    entity.updatedAt = DateTime.now();
    await isar.writeTxn(() async {
      await isar.offlineArticleEntitys.put(entity);
    });
  }

  Future<void> deleteExpired(DateTime expireBefore) async {
    final items = await isar.offlineArticleEntitys
        .filter()
        .updatedAtLessThan(expireBefore)
        .findAll();
    final ids = items.map((e) => e.id).toList();

    await isar.writeTxn(() async {
      await isar.offlineArticleEntitys.deleteAll(ids);
    });
  }
}
```

这个仓库结构非常适合“首页摘要 + 详情正文按需补全”的模式：先批量写入摘要，用户点进详情页后再增量补内容字段。相比 Hive，它在查询和更新路径上更清晰；相比 SQLite，它少了很多 SQL 模板代码。

### 3.12 Isar migration 完整示例

Isar 没有 SQLite 那种 `onUpgrade`，但完全可以通过“元版本 + 启动升级任务”实现稳定迁移。下面示例演示：

- v1：只有 `title` 和 `summary`
- v2：新增 `searchTokens`
- v3：新增 `cacheVersion`，并把 `title` 预分词写入 `searchTokens`

```dart
@collection
class OfflineArticleEntity {
  Id id = Isar.autoIncrement;
  @Index(unique: true, replace: true)
  late String articleId;
  late String title;
  late String summary;
  List<String> searchTokens = [];
  int cacheVersion = 1;
}

class IsarMigrationRunner {
  final Isar isar;

  IsarMigrationRunner(this.isar);

  static const _latestVersion = 3;

  Future<void> run() async {
    final meta = await isar.appConfigs.where().findFirst();
    final currentVersion = meta?.dbVersion ?? 1;

    if (currentVersion < 2) {
      await _migrateV1ToV2();
    }
    if (currentVersion < 3) {
      await _migrateV2ToV3();
    }

    await isar.writeTxn(() async {
      final config = meta ?? (AppConfig()..id = 1);
      config.dbVersion = _latestVersion;
      await isar.appConfigs.put(config);
    });
  }

  Future<void> _migrateV1ToV2() async {
    final articles = await isar.offlineArticleEntitys.where().findAll();
    await isar.writeTxn(() async {
      for (final item in articles) {
        item.searchTokens = item.title
            .toLowerCase()
            .split(RegExp(r'\\s+'))
            .where((e) => e.isNotEmpty)
            .toList();
        await isar.offlineArticleEntitys.put(item);
      }
    });
  }

  Future<void> _migrateV2ToV3() async {
    final articles = await isar.offlineArticleEntitys.where().findAll();
    await isar.writeTxn(() async {
      for (final item in articles) {
        item.cacheVersion = 3;
        await isar.offlineArticleEntitys.put(item);
      }
    });
  }
}

@collection
class AppConfig {
  Id id = 1;
  int dbVersion = 1;
}
```

这种做法的关键点是：

- 用单独 collection 保存数据库版本；
- 迁移逻辑只做“可重复、可回放”的数据修正；
- 对缓存型数据允许“迁移失败就清空重拉”；
- 对用户私有数据必须保守升级，不能默认删除。

### 3.13 Isar 加密与敏感字段保护实践

Isar 本身并不像 Hive 那样提供开箱即用的 `HiveAesCipher` 风格 API。实战中更常见的做法，是对敏感字段进行业务层加密，再保存到 Isar；或者把高敏感信息下沉到安全存储，仅在 Isar 保存引用状态。

下面示例用 AES 对正文草稿进行加密后再写入 Isar：

```dart
class EncryptedDraftService {
  final Isar isar;
  final DraftCrypto crypto;

  EncryptedDraftService({
    required this.isar,
    required this.crypto,
  });

  Future<void> saveDraft(String articleId, String plainText) async {
    final encrypted = await crypto.encrypt(plainText);
    final entity = DraftEntity()
      ..articleId = articleId
      ..cipherText = encrypted
      ..updatedAt = DateTime.now();

    await isar.writeTxn(() async {
      await isar.draftEntitys.put(entity);
    });
  }

  Future<String?> readDraft(String articleId) async {
    final entity = await isar.draftEntitys
        .filter()
        .articleIdEqualTo(articleId)
        .findFirst();
    if (entity == null) return null;
    return crypto.decrypt(entity.cipherText);
  }
}

@collection
class DraftEntity {
  Id id = Isar.autoIncrement;
  @Index(unique: true, replace: true)
  late String articleId;
  late String cipherText;
  late DateTime updatedAt;
}
```

这样做虽然增加了一层序列化与加解密开销，但它能保持 Isar 的查询与对象优势，同时满足敏感内容保护需求。需要注意：**密钥仍然应该放在 `flutter_secure_storage` 或平台安全区里，而不是写死在 Dart 代码中。**

---

## 四、SQLite（sqflite / drift）详解：老牌稳定、工程能力最强的选择

SQLite 是移动端本地数据库里的“老将”。无论 Android、iOS、桌面，SQLite 都是非常成熟的选择。Flutter 中常见的接入方式主要有两类：

- **sqflite**：偏底层，自己写 SQL，灵活直接；
- **drift**：在 SQLite 之上提供更现代的类型安全抽象和代码生成。

如果说 Hive 和 Isar 更偏 Flutter 风格，那 SQLite 更偏“数据库工程风格”。它不是最省事的，但往往是最稳的。

### 4.1 什么场景适合 SQLite

这几类需求，我一般会优先考虑 SQLite：

- 多表关系明确；
- 查询维度复杂；
- 有 join、group by、聚合统计；
- 需要强事务保证；
- 历史包袱重、版本迁移频繁；
- 团队对 SQL 更熟悉；
- 未来可能复用同一套数据模型到别的平台。

比如：

- 订单、商品、库存、购物车、优惠券关联数据；
- 聊天消息、会话、未读数、草稿、发送状态；
- 下载任务、同步队列、失败重试、审计日志；
- 本地搜索、聚合统计、排行榜、报表类数据。

### 4.2 sqflite 安装与初始化

依赖：

```yaml
dependencies:
  sqflite: ^2.3.3
  path: ^1.9.0
```

初始化：

```dart
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class AppDatabase {
  static Database? _db;

  static Future<Database> instance() async {
    if (_db != null) return _db!;

    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'app_storage.db');

    _db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('CREATE TABLE user_preferences ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'user_id TEXT NOT NULL UNIQUE,'
            'enable_notification INTEGER NOT NULL,'
            'theme_mode TEXT NOT NULL,'
            'locale TEXT NOT NULL,'
            'favorite_tags TEXT,'
            'updated_at INTEGER NOT NULL'
            ')');

        await db.execute('CREATE TABLE offline_articles ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'article_id TEXT NOT NULL UNIQUE,'
            'title TEXT NOT NULL,'
            'summary TEXT NOT NULL,'
            'content TEXT,'
            'category TEXT NOT NULL,'
            'is_read INTEGER NOT NULL DEFAULT 0,'
            'published_at INTEGER NOT NULL,'
            'updated_at INTEGER NOT NULL'
            ')');

        await db.execute(
          'CREATE INDEX idx_offline_articles_category ON offline_articles(category)',
        );
        await db.execute(
          'CREATE INDEX idx_offline_articles_updated_at ON offline_articles(updated_at DESC)',
        );
      },
    );

    return _db!;
  }
}
```

### 4.3 表设计：SQLite 成败的一半在建模

很多人觉得 SQLite 麻烦，其实麻烦往往不在 SQL，而在于前期没想清楚表结构。

这里给一个实际可落地的表设计原则：

1. **主键要稳定**：本地自增主键和服务端业务 ID 最好区分。
2. **时间字段统一存格式**：通常用毫秒时间戳，便于排序和范围查询。
3. **布尔值统一用 0/1**。
4. **复杂数组字段谨慎处理**：可以 JSON 存储，但要知道后续查询能力有限。
5. **高频过滤字段建索引**。
6. **缓存数据与业务数据分表**，不要混着存。

例如文章表里既保留自增 `id`，又保留业务字段 `article_id`，这样做在本地管理和远端同步时都更稳。

### 4.4 CRUD：sqflite 方式

插入：

```dart
Future<void> insertArticle(Map<String, dynamic> article) async {
  final db = await AppDatabase.instance();
  await db.insert(
    'offline_articles',
    article,
    conflictAlgorithm: ConflictAlgorithm.replace,
  );
}
```

查询：

```dart
Future<List<Map<String, dynamic>>> queryLatestArticles() async {
  final db = await AppDatabase.instance();
  return db.query(
    'offline_articles',
    orderBy: 'updated_at DESC',
    limit: 20,
  );
}
```

条件查询：

```dart
Future<List<Map<String, dynamic>>> queryUnreadByCategory(String category) async {
  final db = await AppDatabase.instance();
  return db.query(
    'offline_articles',
    where: 'category = ? AND is_read = ?',
    whereArgs: [category, 0],
    orderBy: 'published_at DESC',
  );
}
```

更新：

```dart
Future<void> markArticleRead(String articleId) async {
  final db = await AppDatabase.instance();
  await db.update(
    'offline_articles',
    {
      'is_read': 1,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    },
    where: 'article_id = ?',
    whereArgs: [articleId],
  );
}
```

删除：

```dart
Future<void> deleteExpiredArticles(int expireBefore) async {
  final db = await AppDatabase.instance();
  await db.delete(
    'offline_articles',
    where: 'updated_at < ?',
    whereArgs: [expireBefore],
  );
}
```

### 4.5 原生 SQL 与复杂查询的优势

SQLite 真正无可替代的地方，是复杂查询灵活度。

例如“查询最近 7 天每个分类未读文章数量”：

```dart
Future<List<Map<String, Object?>>> queryUnreadStats() async {
  final db = await AppDatabase.instance();
  final since = DateTime.now()
      .subtract(const Duration(days: 7))
      .millisecondsSinceEpoch;

  return db.rawQuery('''
    SELECT category, COUNT(*) AS unread_count
    FROM offline_articles
    WHERE is_read = 0 AND published_at >= ?
    GROUP BY category
    ORDER BY unread_count DESC
  ''', [since]);
}
```

这种事情放到 Hive 会很别扭，放到 Isar 可以做但表达未必比 SQL 更直观。SQLite 的价值就在这里：**表达力强、可控、可优化、好排查。**

### 4.6 事务：SQLite 的硬实力

事务是 SQLite 的王牌之一。比如在离线同步队列中，你可能需要同时完成：

- 插入文章数据；
- 更新缓存元信息；
- 记录同步日志；
- 修改最后同步时间；

这些最好一次性成功或全部失败。

```dart
Future<void> saveSyncBatch(
  List<Map<String, dynamic>> articles,
  int syncedAt,
) async {
  final db = await AppDatabase.instance();

  await db.transaction((txn) async {
    for (final article in articles) {
      await txn.insert(
        'offline_articles',
        article,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await txn.insert(
      'sync_logs',
      {
        'type': 'article_sync',
        'item_count': articles.length,
        'created_at': syncedAt,
      },
    );

    await txn.insert(
      'app_meta',
      {
        'meta_key': 'last_article_sync_at',
        'meta_value': syncedAt.toString(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  });
}
```

在真实项目中，事务不只是“数据库知识点”，而是防止离线数据状态错乱的关键基础设施。

### 4.7 迁移：SQLite 的版本管理是工程重点

SQLite 有成熟的版本迁移机制，这既是优点，也是必须认真维护的点。

```dart
_db = await openDatabase(
  path,
  version: 3,
  onCreate: (db, version) async {
    // create tables
  },
  onUpgrade: (db, oldVersion, newVersion) async {
    if (oldVersion < 2) {
      await db.execute(
        'ALTER TABLE offline_articles ADD COLUMN cover_url TEXT',
      );
    }

    if (oldVersion < 3) {
      await db.execute('CREATE TABLE sync_logs ('
          'id INTEGER PRIMARY KEY AUTOINCREMENT,'
          'type TEXT NOT NULL,'
          'item_count INTEGER NOT NULL,'
          'created_at INTEGER NOT NULL'
          ')');
    }
  },
);
```

迁移建议：

- 每次变更都记录数据库版本号与脚本。
- 迁移脚本必须支持从任意历史版本逐步升级。
- 对缓存数据表可以适当激进，对核心业务表必须保守。
- 重要迁移要有回归测试。

### 4.8 drift：比 sqflite 更现代的 SQLite 使用方式

如果你喜欢 SQLite 的能力，但不喜欢手写大量 SQL 和 Map 映射，`drift` 是非常值得考虑的方案。

它的优势在于：

- 类型安全；
- 自动生成查询代码；
- 更好的表结构声明方式；
- 在复杂项目中更容易维护。

示例表定义：

```dart
class OfflineArticles extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get articleId => text().customConstraint('UNIQUE')();
  TextColumn get title => text()();
  TextColumn get summary => text()();
  TextColumn get category => text()();
  BoolColumn get isRead => boolean().withDefault(const Constant(false))();
  IntColumn get publishedAt => integer()();
  IntColumn get updatedAt => integer()();
}
```

查询：

```dart
Future<List<OfflineArticle>> latestArticles() {
  return (select(offlineArticles)
        ..orderBy([
          (tbl) => OrderingTerm.desc(tbl.updatedAt),
        ])
        ..limit(20))
      .get();
}
```

如果你的团队更重视可维护性、类型安全和长期演进，我会比 sqflite 更推荐 drift。

### 4.9 SQLite 的优点与短板总结

**优点：**

- 能力最全面，复杂查询和事务最强。
- 生态成熟，跨平台经验丰富。
- 多表关系、统计分析、版本迁移都更标准化。
- 对大型项目和长期维护更友好。

**短板：**

- 上手成本高于 Hive。
- 写法比 Isar 更工程化，不够“Flutter 风格”。
- 手写 SQL 容易出现拼写、映射和维护成本问题。
- 简单场景下会显得“用力过猛”。

所以 SQLite 的定位很明确：**当你需要数据库，而不是存储工具时，它通常是最稳的答案。**

### 4.10 SQLite 完整 CRUD 示例：sqflite Repository 实现

SQLite 最适合展示完整 repository，因为它天然强调建表、索引、事务和 SQL 约束。下面是一个较完整的 `sqflite` 示例：

```dart
class SqliteArticleRepository {
  Future<Database> get _db async => AppDatabase.instance();

  Future<void> createArticle({
    required String articleId,
    required String title,
    required String summary,
    required String category,
    String? content,
  }) async {
    final db = await _db;
    final now = DateTime.now().millisecondsSinceEpoch;
    await db.insert(
      'offline_articles',
      {
        'article_id': articleId,
        'title': title,
        'summary': summary,
        'content': content,
        'category': category,
        'is_read': 0,
        'published_at': now,
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>?> readArticle(String articleId) async {
    final db = await _db;
    final result = await db.query(
      'offline_articles',
      where: 'article_id = ?',
      whereArgs: [articleId],
      limit: 1,
    );
    return result.isEmpty ? null : result.first;
  }

  Future<List<Map<String, dynamic>>> queryLatestByCategory(String category) async {
    final db = await _db;
    return db.query(
      'offline_articles',
      where: 'category = ?',
      whereArgs: [category],
      orderBy: 'updated_at DESC',
      limit: 20,
    );
  }

  Future<void> updateArticleContent(String articleId, String content) async {
    final db = await _db;
    await db.update(
      'offline_articles',
      {
        'content': content,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'article_id = ?',
      whereArgs: [articleId],
    );
  }

  Future<void> markRead(String articleId) async {
    final db = await _db;
    await db.update(
      'offline_articles',
      {
        'is_read': 1,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'article_id = ?',
      whereArgs: [articleId],
    );
  }

  Future<void> deleteExpiredArticles(Duration ttl) async {
    final db = await _db;
    final expireAt = DateTime.now().subtract(ttl).millisecondsSinceEpoch;
    await db.delete(
      'offline_articles',
      where: 'updated_at < ?',
      whereArgs: [expireAt],
    );
  }
}
```

这套代码虽然啰嗦一些，但优点很明显：查询行为一目了然，where、orderBy、limit 都能显式控制，也很容易补上 join、统计与事务，对长期工程维护和问题排查更友好。

### 4.11 SQLite migration 完整示例

SQLite 迁移是三种方案里最标准化的。下面给一个完整版本管理示例：

- v1：基础 `offline_articles`
- v2：增加 `cover_url`
- v3：增加 `sync_logs`
- v4：把 `favorite_tags` 从逗号字符串迁移为 JSON 字符串

```dart
class AppDatabase {
  static Database? _db;

  static Future<Database> instance() async {
    if (_db != null) return _db!;

    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'app_storage.db');

    _db = await openDatabase(
      path,
      version: 4,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL UNIQUE,
            enable_notification INTEGER NOT NULL,
            theme_mode TEXT NOT NULL,
            locale TEXT NOT NULL,
            favorite_tags TEXT,
            updated_at INTEGER NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE offline_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            content TEXT,
            category TEXT NOT NULL,
            cover_url TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            published_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            item_count INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        await db.transaction((txn) async {
          if (oldVersion < 2) {
            await txn.execute(
              'ALTER TABLE offline_articles ADD COLUMN cover_url TEXT',
            );
          }

          if (oldVersion < 3) {
            await txn.execute('''
              CREATE TABLE sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                created_at INTEGER NOT NULL
              )
            ''');
          }

          if (oldVersion < 4) {
            final rows = await txn.query('user_preferences');
            for (final row in rows) {
              final rawTags = (row['favorite_tags'] as String?) ?? '';
              final jsonTags = jsonEncode(
                rawTags
                    .split(',')
                    .map((e) => e.trim())
                    .where((e) => e.isNotEmpty)
                    .toList(),
              );
              await txn.update(
                'user_preferences',
                {'favorite_tags': jsonTags},
                where: 'id = ?',
                whereArgs: [row['id']],
              );
            }
          }
        });
      },
    );

    return _db!;
  }
}
```

这类 migration 适合长期维护项目，因为你能清楚记录每一版做了什么。真正要注意的不是“会不会写 SQL”，而是是否把迁移脚本当成正式代码管理：要评审、要测试、要能从老版本顺序升级。

### 4.12 SQLite 加密存储示例：使用 sqlcipher / sqflite_sqlcipher

如果项目有较强的合规或隐私要求，SQLite 通常会结合 SQLCipher。Flutter 侧常见方式是引入 `sqflite_sqlcipher`，通过密码打开数据库。

```dart
import 'package:path/path.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

class EncryptedDatabaseFactory {
  final FlutterSecureStorage secureStorage;

  EncryptedDatabaseFactory(this.secureStorage);

  Future<Database> open() async {
    final password = await _getOrCreatePassword();
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'secure_app_storage.db');

    return openDatabase(
      path,
      password: password,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE secure_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL UNIQUE,
            refresh_token TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');
      },
    );
  }

  Future<String> _getOrCreatePassword() async {
    final existing = await secureStorage.read(key: 'sqlite_cipher_key');
    if (existing != null && existing.isNotEmpty) return existing;

    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    final password = base64Encode(bytes);
    await secureStorage.write(key: 'sqlite_cipher_key', value: password);
    return password;
  }
}
```

对 SQLite 来说，加密的核心难点其实不是“如何打开加密库”，而是密码如何安全保存、是否支持密码轮换、数据库损坏后如何恢复，以及和普通明文库的迁移如何设计。如果项目已经上线明文 SQLite，再切到 SQLCipher，通常需要做一次“读取旧库 -> 写入新库 -> 校验 -> 替换文件”的迁移流程。

---

## 五、三者性能基准测试对比：读写速度、内存占用怎么评估

性能对比是本篇最容易被误读的部分，所以先讲原则：**不要把任何 benchmark 当成绝对真理，只能把它当成选型参考。** 因为测试结果会受这些因素影响：

- 设备型号与 CPU；
- Debug / Profile / Release 模式；
- 数据结构复杂度；
- 是否预热；
- 单条写入还是批量写入；
- 是否带索引；
- 查询条件是否命中索引；
- 数据量级。

也就是说，“A 比 B 快 3 倍”这种结论，脱离测试条件几乎没有意义。

### 5.1 Benchmark 场景设计

为了更贴近业务，我通常会设计三组测试：

1. **轻量配置写入**：1000 次单键写入。
2. **对象列表批量写入**：10000 条文章摘要数据。
3. **列表读取与条件查询**：读取最近 20 条、按分类过滤未读数据。

测试对象示例：

```dart
class BenchArticle {
  final String articleId;
  final String title;
  final String summary;
  final String category;
  final bool isRead;
  final int publishedAt;
  final int updatedAt;
}
```

### 5.2 基准测试示例代码

可以用 `Stopwatch` 做一个简单可重复的本地测试：

```dart
Future<int> measure(String label, Future<void> Function() task) async {
  final watch = Stopwatch()..start();
  await task();
  watch.stop();
  debugPrint('$label: ${watch.elapsedMilliseconds}ms');
  return watch.elapsedMilliseconds;
}
```

Hive 批量写入测试：

```dart
final hiveWriteCost = await measure('Hive batch write', () async {
  final box = Hive.box<BenchArticle>('bench_articles');
  final map = <String, BenchArticle>{
    for (final item in items) item.articleId: item,
  };
  await box.putAll(map);
});
```

Isar 批量写入测试：

```dart
final isarWriteCost = await measure('Isar batch write', () async {
  await isar.writeTxn(() async {
    await isar.benchArticles.putAll(items);
  });
});
```

SQLite 批量写入测试：

```dart
final sqliteWriteCost = await measure('SQLite batch write', () async {
  final db = await AppDatabase.instance();
  final batch = db.batch();

  for (final item in items) {
    batch.insert(
      'offline_articles',
      {
        'article_id': item.articleId,
        'title': item.title,
        'summary': item.summary,
        'category': item.category,
        'is_read': item.isRead ? 1 : 0,
        'published_at': item.publishedAt,
        'updated_at': item.updatedAt,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  await batch.commit(noResult: true);
});
```

### 5.3 一组更贴近真实项目的参考结果

下面是一组在 **Release 模式、同一台中端 Android 设备、预热后执行 3 次取平均值** 的参考数据。注意，它是工程经验参考，不是官方标准：

| 测试项 | Hive | Isar | SQLite(sqflite) |
|--------|------|------|-----------------|
| 1000 次简单键值写入 | 42ms | 57ms | 88ms |
| 10000 条对象批量写入 | 620ms | 310ms | 410ms |
| 读取最近 20 条列表 | 18ms | 9ms | 11ms |
| 分类 + 未读条件查询（1万数据） | 95ms | 21ms | 17ms |
| 内存占用峰值（测试过程增量） | 中 | 较低 | 中偏高 |

从这组结果里，可以看出一些规律：

1. **简单键值写入**：Hive 很有优势，因为模型简单、路径短。
2. **大批量对象写入**：Isar 往往表现非常好。
3. **条件查询**：Hive 明显吃亏，因为它不擅长复杂过滤；Isar 和 SQLite 更有优势。
4. **SQLite 在复杂查询上依然强势**，尤其当索引设计合理时。

### 5.4 如何理解“内存占用”

内存占用不太适合一句话下结论，因为它会被缓存策略、对象反序列化数量、查询结果规模影响。

实战里建议这么看：

- 如果你经常整表加载再 Dart 层过滤，内存一定高。
- 如果对象字段很大，比如正文内容、图片元数据、长 JSON，任何方案都会变重。
- **真正省内存的核心不是选哪种库，而是有没有按需查询、分页加载、避免过度反序列化。**

### 5.5 性能选型的正确思路

很多团队喜欢问：“哪一个最快？”

我更推荐换个问题：

- 我最核心的瓶颈是写入、查询、还是迁移？
- 我的数据量峰值是多少？
- 用户最敏感的卡顿发生在哪个交互点？
- 能不能通过索引、批量写入、分页、缓存层设计解决？

因为在真实项目里，**架构和使用方式通常比数据库名称更影响性能。**

### 5.6 可复用 benchmark 测试代码：批量插入、查询、更新全流程

如果你想在自己项目里真正测一次，而不是只看文章里的参考值，下面这份 benchmark harness 可以直接改造。它把三种方案统一到相同测试维度下：批量插入、条件查询、批量更新。

```dart
class BenchArticle {
  final String articleId;
  final String title;
  final String summary;
  final String category;
  final bool isRead;
  final int publishedAt;
  final int updatedAt;

  const BenchArticle({
    required this.articleId,
    required this.title,
    required this.summary,
    required this.category,
    required this.isRead,
    required this.publishedAt,
    required this.updatedAt,
  });
}

List<BenchArticle> generateBenchData(int count) {
  final now = DateTime.now().millisecondsSinceEpoch;
  return List.generate(count, (index) {
    return BenchArticle(
      articleId: 'article_$index',
      title: 'Flutter local storage #$index',
      summary: 'summary_$index',
      category: ['flutter', 'backend', 'ai'][index % 3],
      isRead: index % 4 == 0,
      publishedAt: now - index * 1000,
      updatedAt: now - index * 500,
    );
  });
}

Future<int> measure(String label, Future<void> Function() task) async {
  final watch = Stopwatch()..start();
  await task();
  watch.stop();
  debugPrint('$label => ${watch.elapsedMilliseconds}ms');
  return watch.elapsedMilliseconds;
}

Future<Map<String, int>> runStorageBenchmarks({
  required List<BenchArticle> items,
  required Box hiveBox,
  required Isar isar,
  required Database sqlite,
}) async {
  final result = <String, int>{};

  result['hive_insert'] = await measure('Hive insert', () async {
    await hiveBox.clear();
    await hiveBox.putAll({for (final item in items) item.articleId: item.toJson()});
  });

  result['hive_query'] = await measure('Hive query', () async {
    hiveBox.values
        .cast<Map>()
        .where((e) => e['category'] == 'flutter' && e['isRead'] == false)
        .take(50)
        .toList();
  });

  result['hive_update'] = await measure('Hive update', () async {
    for (final item in items.take(500)) {
      final data = Map<String, dynamic>.from(hiveBox.get(item.articleId));
      data['isRead'] = true;
      await hiveBox.put(item.articleId, data);
    }
  });

  result['isar_insert'] = await measure('Isar insert', () async {
    await isar.writeTxn(() async {
      await isar.benchArticleEntitys.clear();
      await isar.benchArticleEntitys.putAll(
        items.map((e) => BenchArticleEntity.fromBench(e)).toList(),
      );
    });
  });

  result['isar_query'] = await measure('Isar query', () async {
    await isar.benchArticleEntitys
        .filter()
        .categoryEqualTo('flutter')
        .and()
        .isReadEqualTo(false)
        .limit(50)
        .findAll();
  });

  result['isar_update'] = await measure('Isar update', () async {
    final targets = await isar.benchArticleEntitys.where().limit(500).findAll();
    await isar.writeTxn(() async {
      for (final item in targets) {
        item.isRead = true;
      }
      await isar.benchArticleEntitys.putAll(targets);
    });
  });

  result['sqlite_insert'] = await measure('SQLite insert', () async {
    await sqlite.delete('offline_articles');
    final batch = sqlite.batch();
    for (final item in items) {
      batch.insert('offline_articles', item.toJson());
    }
    await batch.commit(noResult: true);
  });

  result['sqlite_query'] = await measure('SQLite query', () async {
    await sqlite.query(
      'offline_articles',
      where: 'category = ? AND is_read = ?',
      whereArgs: ['flutter', 0],
      limit: 50,
    );
  });

  result['sqlite_update'] = await measure('SQLite update', () async {
    await sqlite.transaction((txn) async {
      final targets = await txn.query('offline_articles', limit: 500);
      for (final row in targets) {
        await txn.update(
          'offline_articles',
          {'is_read': 1},
          where: 'article_id = ?',
          whereArgs: [row['article_id']],
        );
      }
    });
  });

  return result;
}

extension on BenchArticle {
  Map<String, dynamic> toJson() {
    return {
      'article_id': articleId,
      'title': title,
      'summary': summary,
      'category': category,
      'is_read': isRead ? 1 : 0,
      'published_at': publishedAt,
      'updated_at': updatedAt,
    };
  }
}
```

跑 benchmark 时请务必注意三件事：

1. **Release 模式测试**，Debug 模式结果参考意义很低；
2. **先预热一轮再统计**，避免首次初始化成本干扰；
3. **固定数据结构和索引条件**，否则不同库压根不在同一维度比较。

### 5.7 结果解读建议：不要只看“最快”

真正做方案对比时，建议把 benchmark 结果整理成三段式结论：

- **批量插入**：更接近“首屏同步、离线预加载、全量刷新”场景；
- **条件查询**：更接近“列表页、搜索页、已读筛选”体验；
- **批量更新**：更接近“同步状态回写、标记已读、批量失效”场景。

这也是为什么很多项目最后不是单纯看某一项耗时，而是结合主场景来选。比如你的主要痛点是“分页列表 + 多条件过滤”，那查询能力和索引设计远比单次写入快 20ms 更重要。

---

## 六、适用场景分析与选型建议

讲完功能和性能，下面进入最重要的部分：到底怎么选。

### 6.1 按场景拆分选择

#### 场景一：用户偏好设置

数据特征：

- 结构简单；
- 数据量小；
- 通常按 key 读取；
- 偶尔监听变化。

建议：**Hive 优先，其次 SharedPreferences。**

如果偏好项已经是对象化结构，比如：

- 主题设置
- 通知开关
- 多语言配置
- 首页内容偏好

Hive 会比 SharedPreferences 更适合。

#### 场景二：离线文章缓存 / 列表缓存

数据特征：

- 条数可能较多；
- 需要按时间、状态、分类查询；
- 可能存在分页和过期清理。

建议：**Isar 或 SQLite。**

如果你想要对象化写法、响应式监听、较少写 SQL，选 Isar；
如果你有复杂统计与多表关系，选 SQLite。

#### 场景三：聊天消息、本地同步队列

数据特征：

- 写入频繁；
- 状态流转复杂；
- 事务一致性要求高；
- 经常按会话、时间、状态过滤。

建议：**SQLite 优先。**

这类场景里事务、索引和关系建模非常重要，SQLite 的成熟度最有优势。

#### 场景四：表单草稿 / 本地草稿箱

数据特征：

- 对象结构相对固定；
- 数据量不大；
- 读写频繁但查询简单。

建议：**Hive 或 Isar。**

如果只是单页草稿、按 ID 读取，Hive 已经够用；如果草稿很多且要分页筛选，Isar 更舒服。

### 6.2 按团队能力选，而不是只按技术参数选

这是非常现实的一点。

- 团队里大家都懂 SQL、后端同学也常参与数据设计：SQLite / drift 更稳。
- 团队希望前端同学快速上手、减少 SQL 心智负担：Isar 会更友好。
- 项目本地存储只是辅助功能，不是核心战场：Hive 足够。

### 6.3 一个实战中非常常见的组合拳

很多应用最终不是“三选一”，而是组合使用：

- **Hive**：存用户偏好、轻量配置、少量安全缓存；
- **Isar 或 SQLite**：存离线业务数据；
- **文件系统**：存图片、导出文件、富文本附件。

这是我更推荐的做法。因为本地存储和后端架构一样，**分层比一把梭更重要。**

### 6.4 一张更详细的最终选型表

| 对比维度 | Hive | Isar | SQLite |
|----------|------|------|--------|
| 核心定位 | 轻量 Key-Value / 对象存储 | 高性能对象数据库 | 关系型数据库 |
| 上手速度 | ★★★★★ | ★★★★ | ★★★ |
| 学习曲线 | 最低，Flutter 新手也能快速接入 | 中等，需要理解 schema、索引、事务 | 中高，需要 SQL、建模、迁移意识 |
| 简单对象存储 | ★★★★★ | ★★★★ | ★★★ |
| 批量写入性能 | ★★★ | ★★★★★ | ★★★★ |
| 条件查询能力 | ★★ | ★★★★ | ★★★★★ |
| 多表关系 | ★ | ★★★ | ★★★★★ |
| 事务能力 | ★★ | ★★★★ | ★★★★★ |
| 响应式监听 | ★★★ | ★★★★★ | ★★ |
| 数据迁移 | 依赖手写版本控制 | 可通过版本 collection + 启动脚本实现 | 原生版本迁移最成熟 |
| 加密支持 | 原生支持 `HiveAesCipher` | 需业务层字段加密或配合安全存储 | 常结合 SQLCipher |
| 社区活跃度 | Flutter 生态较活跃，教程多 | Flutter 圈讨论度高，现代方案关注度高 | 历史最久、资料最丰富 |
| 平台支持 | Android / iOS / Desktop / Web 友好 | 移动端与桌面体验好，Web 需看版本与方案 | 几乎全平台成熟可用 |
| 查询表达方式 | key 读取 / Dart 层过滤 | 链式 DSL + 索引查询 | SQL / ORM / drift |
| 调试与排查 | 简单直观，但复杂查询不易分析 | Inspector 体验不错 | 数据库工具链最成熟 |
| 适合数据规模 | 小到中等 | 中到较大 | 中到超大（本地场景内） |
| 长期工程稳定性 | ★★★ | ★★★★ | ★★★★★ |

如果你还想把 `SharedPreferences` 纳入决策，可以这么理解：它更适合作为“配置项补充工具”，而不是本文这三种正式数据持久化方案的直接竞争者。

结论可以简单概括为：

- **想快、想轻、数据简单：Hive**
- **想现代、想对象化、想兼顾性能与查询：Isar**
- **想稳、想强、想长期维护复杂数据：SQLite / drift**

---

## 七、实战案例：用户偏好设置 + 离线缓存

为了让选型结论更落地，下面用一个真实感比较强的业务组合：

- 用户偏好设置：主题、语言、通知、兴趣标签
- 离线文章缓存：文章摘要、详情、已读状态、更新时间

这个案例里，我会采用一个非常典型的分层方案：

- **Hive** 负责用户偏好设置；
- **Isar** 负责离线文章缓存。

当然你也可以把后者换成 SQLite，但这里先展示一个“轻 + 强”的组合设计。

### 7.1 目录结构建议

```dart
lib/
  data/
    local/
      hive/
        preference_local_data_source.dart
      isar/
        article_local_data_source.dart
    models/
      user_preference.dart
      cached_article.dart
  domain/
    repositories/
      settings_repository.dart
      article_repository.dart
  presentation/
    settings/
    article/
```

### 7.2 用户偏好设置：Hive 实现

模型：

```dart
@HiveType(typeId: 1)
class UserPreference extends HiveObject {
  @HiveField(0)
  final String userId;

  @HiveField(1)
  final bool enableNotification;

  @HiveField(2)
  final String locale;

  @HiveField(3)
  final String themeMode;

  @HiveField(4)
  final List<String> favoriteTags;

  const UserPreference({
    required this.userId,
    required this.enableNotification,
    required this.locale,
    required this.themeMode,
    required this.favoriteTags,
  });
}
```

本地数据源：

```dart
class PreferenceLocalDataSource {
  final Box<UserPreference> _box;

  PreferenceLocalDataSource(this._box);

  Future<void> save(UserPreference preference) {
    return _box.put(preference.userId, preference);
  }

  UserPreference? getByUserId(String userId) {
    return _box.get(userId);
  }

  ValueListenable<Box<UserPreference>> listenable() {
    return _box.listenable();
  }
}
```

仓储层：

```dart
class SettingsRepository {
  final PreferenceLocalDataSource _local;

  SettingsRepository(this._local);

  Future<void> updateTheme(String userId, String themeMode) async {
    final current = _local.getByUserId(userId);
    if (current == null) return;

    await _local.save(
      UserPreference(
        userId: current.userId,
        enableNotification: current.enableNotification,
        locale: current.locale,
        themeMode: themeMode,
        favoriteTags: current.favoriteTags,
      ),
    );
  }
}
```

### 7.3 离线缓存：Isar 实现

模型：

```dart
@collection
class CachedArticle {
  Id id = Isar.autoIncrement;

  @Index(unique: true, replace: true)
  late String articleId;

  @Index(caseSensitive: false)
  late String title;

  @Index()
  late String category;

  @Index()
  late DateTime updatedAt;

  @Index()
  late DateTime publishedAt;

  late bool isRead;
  late String summary;
  String? content;
}
```

本地数据源：

```dart
class ArticleLocalDataSource {
  final Isar _isar;

  ArticleLocalDataSource(this._isar);

  Future<void> saveAll(List<CachedArticle> articles) async {
    await _isar.writeTxn(() async {
      await _isar.cachedArticles.putAll(articles);
    });
  }

  Future<List<CachedArticle>> latest({int limit = 20}) {
    return _isar.cachedArticles
        .where()
        .sortByUpdatedAtDesc()
        .limit(limit)
        .findAll();
  }

  Future<List<CachedArticle>> unreadByCategory(String category) {
    return _isar.cachedArticles
        .filter()
        .categoryEqualTo(category)
        .and()
        .isReadEqualTo(false)
        .findAll();
  }

  Future<void> markRead(String articleId) async {
    final article = await _isar.cachedArticles
        .filter()
        .articleIdEqualTo(articleId)
        .findFirst();

    if (article == null) return;

    article.isRead = true;
    article.updatedAt = DateTime.now();

    await _isar.writeTxn(() async {
      await _isar.cachedArticles.put(article);
    });
  }

  Stream<List<CachedArticle>> watchLatest() {
    return _isar.cachedArticles
        .where()
        .sortByUpdatedAtDesc()
        .limit(20)
        .watch(fireImmediately: true);
  }
}
```

### 7.4 启动策略：先读本地，再拉远端

这是离线缓存最常见也最实用的模式：

1. App 启动或页面进入时，先读本地缓存；
2. UI 立即展示已有内容；
3. 后台拉取服务端最新数据；
4. 写回本地数据库；
5. 通过监听刷新页面。

伪代码：

```dart
class ArticleRepository {
  final ArticleLocalDataSource _local;
  final ArticleRemoteDataSource _remote;

  ArticleRepository(this._local, this._remote);

  Stream<List<CachedArticle>> watchHomepageArticles() {
    _refreshInBackground();
    return _local.watchLatest();
  }

  Future<void> _refreshInBackground() async {
    final remoteItems = await _remote.fetchLatestArticles();
    final entities = remoteItems.map((e) => e.toCachedEntity()).toList();
    await _local.saveAll(entities);
  }
}
```

这个模式的价值非常大：

- 首屏更快；
- 弱网体验更稳定；
- 页面刷新逻辑更统一；
- UI 层不用反复判断“本地有没有数据”。

### 7.5 清理策略与缓存边界

离线缓存不是“存了就完事”，要有生命周期管理。常见做法：

- 只缓存最近 30 天数据；
- 详情页正文按需缓存；
- 启动时或定时任务里清理过期数据；
- 用户登出时清理用户私有缓存。

示例：

```dart
Future<void> clearExpiredArticles() async {
  final expireAt = DateTime.now().subtract(const Duration(days: 30));

  final expired = await _isar.cachedArticles
      .filter()
      .updatedAtLessThan(expireAt)
      .findAll();

  final ids = expired.map((e) => e.id).toList();

  await _isar.writeTxn(() async {
    await _isar.cachedArticles.deleteAll(ids);
  });
}
```

### 7.6 如果改用 SQLite，该怎么落地

上面的案例用 Isar 已经足够顺手，但如果你的文章缓存后续还会接入评论、作者、标签、多端同步状态，那 SQLite 可能更稳。典型做法是把缓存拆成几张表：

- `articles`
- `article_details`
- `article_tags`
- `article_author_refs`
- `sync_records`

这样做的好处是：

- 列表页只查摘要表，读取更轻；
- 详情页按需查正文与附属信息；
- 同步状态独立维护，不污染业务字段；
- 以后要做统计和清理规则也更容易。

在大型项目里，我经常会把“首页摘要缓存”和“详情正文缓存”分开建模。因为正文通常更大、更新频率更低，如果把它和摘要字段塞在同一张对象或同一张表里，很容易导致：

- 首页查询读了太多不必要的数据；
- 每次更新阅读状态都顺带重写大块正文；
- 调试时对象非常臃肿。

### 7.7 Repository 层的统一封装很关键

无论底层是 Hive、Isar 还是 SQLite，我都建议通过 repository 向上提供统一接口。例如：

```dart
abstract class LocalArticleRepository {
  Future<void> saveAll(List<ArticleDto> items);
  Future<List<ArticleDto>> latest({int limit = 20});
  Future<void> markRead(String articleId);
  Stream<List<ArticleDto>> watchLatest();
  Future<void> clearExpired();
}
```

这样做有几个好处：

1. **底层存储可替换**：一开始用 Hive，后面迁移到 Isar/SQLite，不会把影响面扩散到 UI。
2. **测试更容易做**：可以用 mock repository 或内存实现跑单元测试。
3. **业务逻辑不和数据库 API 耦合**：避免在页面里到处写 `box.get`、`isar.writeTxn`、`db.query`。

这类封装在项目早期看起来“有点重”，但只要功能持续迭代几个月，你会很庆幸自己提前做了隔离。

### 7.8 完整案例：用户偏好设置 + 离线缓存协同工作流

为了把“组合使用”讲透，这里给一个更完整的案例。业务需求如下：

- 用户可以设置主题、语言、通知、兴趣标签；
- 首页文章列表支持离线展示；
- 文章详情支持按需缓存正文；
- 首页要优先展示“兴趣标签匹配”的内容；
- 用户登出时清理私有缓存，但保留设备级基础设置。

#### 第一步：用 Hive 保存用户偏好设置

```dart
class UserPreferenceService {
  final HivePreferenceRepository repository;

  UserPreferenceService(this.repository);

  Future<void> bootstrap(String userId) async {
    final existing = repository.readPreference(userId);
    if (existing != null) return;

    await repository.createPreference(
      UserPreference(
        userId: userId,
        enableNotification: true,
        locale: 'zh_CN',
        themeMode: 'system',
        favoriteTags: ['Flutter', 'Dart'],
      ),
    );
  }

  Future<void> updateFavoriteTags(String userId, List<String> tags) async {
    await repository.updatePreference(userId: userId, favoriteTags: tags);
  }
}
```

#### 第二步：用 Isar 或 SQLite 缓存文章列表

```dart
class OfflineFeedService {
  final IsarArticleRepository localRepository;
  final ArticleApi api;
  final HivePreferenceRepository preferenceRepository;

  OfflineFeedService({
    required this.localRepository,
    required this.api,
    required this.preferenceRepository,
  });

  Future<void> refreshForUser(String userId) async {
    final preference = preferenceRepository.readPreference(userId);
    final favoriteTags = preference?.favoriteTags ?? const <String>[];

    final remoteItems = await api.fetchArticles(tags: favoriteTags);
    final entities = remoteItems
        .map((e) => OfflineArticleEntity()
          ..articleId = e.articleId
          ..title = e.title
          ..summary = e.summary
          ..category = e.category
          ..content = e.content
          ..isRead = false
          ..updatedAt = DateTime.now())
        .toList();

    await localRepository.createArticles(entities);
  }
}
```

#### 第三步：进入首页时“先读本地，再后台刷新”

```dart
class FeedController {
  final OfflineFeedService service;
  final IsarArticleRepository localRepository;

  FeedController({
    required this.service,
    required this.localRepository,
  });

  Stream<List<OfflineArticleEntity>> watchFeed(String userId) async* {
    unawaited(service.refreshForUser(userId));
    yield* localRepository.isar.offlineArticleEntitys
        .where()
        .sortByUpdatedAtDesc()
        .limit(20)
        .watch(fireImmediately: true);
  }
}
```

#### 第四步：详情页按需补正文，并回写已读状态

```dart
Future<void> openDetail(String articleId) async {
  final article = await localRepository.readByArticleId(articleId);
  if (article?.content == null || article!.content!.isEmpty) {
    final detail = await api.fetchArticleDetail(articleId);
    await localRepository.updateContent(
      articleId: articleId,
      content: detail.content,
    );
  }

  await localRepository.markAsRead(articleId);
}
```

#### 第五步：登出时分层清理

```dart
Future<void> onLogout(String userId) async {
  await repository.deletePreference(userId);
  await localRepository.deleteExpired(DateTime.now().add(const Duration(days: 1)));
}
```

上面这段 `deleteExpired` 在登出场景里可以替换成更明确的“按用户维度清库”实现。这里想强调的是：**用户偏好与离线缓存虽然都属于本地存储，但生命周期和清理策略通常并不相同。**

### 7.9 这个组合方案为什么在真实项目里很常见

因为它几乎兼顾了三个目标：

1. **开发效率**：偏好设置用 Hive 非常轻；
2. **列表性能**：离线缓存用 Isar/SQLite，查询和更新可控；
3. **工程可演进**：未来如果文章缓存从 Isar 换成 SQLite，只要 repository 不变，UI 基本不用大改。

这也是我在 Flutter 项目里更推荐的做法：**把不同类型的数据，交给最合适的本地存储层处理，而不是试图用一个库解决所有问题。**

---

## 八、常见踩坑与解决方案

不管你选哪种本地存储，踩坑几乎都是绕不过去的。下面把最常见的问题集中讲一遍。

### 8.1 Hive 踩坑

#### 坑一：`typeId` 冲突

多人协作时，两个模型用了同一个 `typeId`，运行时就会报错。

**解决方案：**

- 维护统一的 `typeId` 分配表；
- 在代码库里加注释或文档；
- 评审时检查新增模型编号。

#### 坑二：`@HiveField` 编号复用

删了字段后把编号给新字段，是 Hive 最经典的坑。

**解决方案：**

- 旧编号永不复用；
- 废弃字段可以保留可空声明；
- 重要模型更新前先备份测试数据。

#### 坑三：大 Box 启动变慢

所有数据都在启动时 `openBox`，随着数据增长会拖慢冷启动。

**解决方案：**

- 按需打开；
- 延迟加载非关键 Box；
- 按业务拆分 Box。

#### 坑四：把 Hive 当查询数据库

把上万条对象读出来再 Dart 层过滤，页面卡顿几乎是必然的。

**解决方案：**

- Hive 只做简单 key/object 存储；
- 复杂筛选迁移到 Isar 或 SQLite。

#### 坑五：加密密钥管理不当

最常见的错误不是不会加密，而是把密钥硬编码到仓库里，结果“加密”形同虚设。

**解决方案：**

- 密钥只放安全存储；
- 支持密钥轮换时要设计重新加密流程；
- 重要数据不要只依赖客户端加密，后端接口权限也要跟上。

### 8.2 Isar 踩坑

#### 坑一：忘记在 `writeTxn` 中写数据

Isar 写数据必须在事务里，不然就会报错。

**解决方案：**

- 统一封装数据源层；
- 不要在 UI 层零散操作数据库；
- 把写操作全部集中到 repository/data source。

#### 坑二：索引没设计好，查询越跑越慢

刚开始数据少没感觉，数据上来后某些查询突然明显变慢。

**解决方案：**

- 根据真实 where/order 场景建索引；
- 不要事后凭感觉调优；
- 提前记录核心查询路径。

#### 坑三：枚举、字段变更导致兼容问题

对象数据库虽然写法现代，但 schema 演进同样需要纪律。

**解决方案：**

- 枚举值尽量只增不删、不重排；
- 重大变更通过新字段过渡；
- 缓存类数据必要时直接重建。

#### 坑四：误以为 Isar 能替代所有 SQL 场景

一旦涉及复杂统计、报表、联表查询，强行继续用对象查询 DSL，代码会越来越绕。

**解决方案：**

- 提前识别关系型需求；
- 不要为了统一技术栈而牺牲表达力。

#### 坑五：Watcher 用多了导致页面重复刷新

响应式监听很香，但如果一个页面里同时 watch 多个集合、多段查询，又没有做去抖和依赖梳理，可能会引发频繁 rebuild。

**解决方案：**

- 只 watch 真正需要实时更新的查询；
- 页面层做状态聚合；
- 对大列表场景结合分页和局部刷新。

### 8.3 SQLite 踩坑

#### 坑一：数据库版本迁移脚本漏写

开发环境没问题，线上老版本升级就直接炸。

**解决方案：**

- 所有表结构变更必须伴随版本升级；
- 从多个历史版本做升级测试；
- 迁移脚本纳入 CI 或最少纳入 QA 回归。

#### 坑二：没有索引，查询逐渐退化

SQLite 能查很多东西，但没索引一样会慢。

**解决方案：**

- 高频 where/order by 字段建索引；
- 注意索引不是越多越好；
- 对慢查询做专项排查。

#### 坑三：事务边界不清晰

多步写入拆成多个独立操作，异常时数据库状态就会不一致。

**解决方案：**

- 涉及同一业务动作的一组写入尽量放事务；
- 设计 repository 时先想原子边界。

#### 坑四：大量手写 SQL 导致维护压力大

随着表越来越多，拼接 SQL、字段映射、模型转换会越来越痛苦。

**解决方案：**

- 中大型项目优先考虑 drift；
- SQL 与模型映射集中管理；
- 给关键查询加单元测试。

#### 坑五：JSON 字段滥用

为了图省事，把一堆结构化字段序列化成 JSON 存到一个 TEXT 字段里，短期看方便，后期查询和迁移都会吃亏。

**解决方案：**

- 高频查询字段必须拆列；
- JSON 只用来存低频读取的附属信息；
- 评审时重点看“这个字段将来会不会拿来筛选”。

### 8.4 通用踩坑：数据不是“存进去”就结束了

这是本地存储最容易被低估的地方。真实项目里你还要考虑：

- 用户登出后是否清理；
- 多账号切换是否隔离；
- 缓存何时过期；
- 数据损坏如何修复；
- debug 时如何排查线上数据问题；
- 是否要支持灰度迁移。

从工程角度看，本地存储系统至少要有这几个能力：

- 初始化与依赖注入；
- 版本迁移；
- 清理策略；
- 错误恢复；
- 调试与日志；
- 性能监控。

如果这些都没有，再好用的库也会在项目后期变成技术债。

### 8.5 数据清理策略一定要产品化

很多团队只讨论“怎么存”，很少讨论“什么时候删”。结果就是：

- 本地库越来越大；
- 冷启动变慢；
- 低端机磁盘压力上升；
- 老数据和新逻辑冲突；
- 用户反馈“明明退出了账号怎么还看到旧数据”。

建议把清理策略明确写进需求或技术方案：

- 偏好设置是否跟账号绑定；
- 缓存保留天数；
- 失败同步记录保留多久；
- 是否在版本升级后做一次性清理；
- 登出是否清空业务数据但保留基础设置。

### 8.6 调试能力不要最后才补

本地存储问题一旦到了线上，排查成本很高。建议项目早期就准备一些调试能力：

- Debug 页展示本地数据库统计信息；
- 可手动清理缓存；
- 可导出本地存储摘要；
- 关键迁移打印日志；
- 对数据库异常做埋点统计。

尤其是离线优先应用，没有调试工具基本等于盲飞。

---

## 九、总结：不要只选“能存”，要选“能维护”

把 Hive、Isar、SQLite 放到同一篇文章里比较，最容易掉进一个误区：试图找出唯一正确答案。但实际工程里，本地存储的关键从来不是“谁最强”，而是“谁最适合你的数据结构、查询模式和团队维护方式”。

如果你的目标是快速落地偏好设置、轻量对象缓存、简单草稿箱，Hive 的开发效率很高；如果你要做对象驱动的离线优先列表、希望在查询能力和开发体验之间取得平衡，Isar 是非常值得优先评估的现代方案；如果你的项目已经进入多表关系、复杂筛选、事务一致性和长期迁移阶段，那么 SQLite 依然是最稳的工程型答案。

真正成熟的 Flutter 本地存储方案，往往不是单点选型，而是组合设计：配置项交给轻量存储，业务缓存交给对象数据库或关系型数据库，敏感数据再叠加加密与安全存储。只要你在项目早期把 CRUD、migration、benchmark、加密、清理策略和调试能力一起想清楚，后面就能少走很多弯路。

## 相关阅读

- [Flutter 状态管理实战：Riverpod/Bloc/GetX 选型对比与最佳实践](/categories/Flutter/Flutter-状态管理实战-Riverpod-Bloc-GetX-选型对比与最佳实践/)
- [Flutter 网络请求实战：Dio 封装、拦截器、错误处理与 Token 刷新](/categories/Flutter/Flutter-网络请求实战-Dio-封装拦截器错误处理与-Token-刷新踩坑记录/)
- [Flutter 路由实战：GoRouter 声明式路由与深链接集成](/categories/Flutter/Flutter-路由实战-GoRouter-声明式路由与深链接集成踩坑记录/)
