---
title: Flutter + CI/CD 实战：GitHub Actions 自动化构建、测试、发布
date: 2026-06-01 10:00:00
tags: [Flutter, CI/CD, GitHub Actions, 自动化]
keywords: [Flutter, CI, CD, GitHub Actions, 自动化构建, 发布, 移动端]
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: 本文系统拆解 Flutter CI/CD 落地方案，基于 GitHub Actions 实现自动化构建、测试、发布与覆盖率上报，涵盖 FVM、Fastlane、签名、缓存、矩阵构建与常见踩坑，帮你快速搭建稳定可复用的工程化流水线。
---


在 Flutter 项目进入多人协作和版本化发布阶段之后，单纯依赖本地手工打包、人工执行测试、人工上传应用商店，很快就会暴露出三个典型问题：第一，构建结果不可复现，同样一份代码在不同开发机、不同 Flutter SDK 版本、不同 JDK 和 CocoaPods 环境下可能得出不同结果；第二，发布过程强依赖某个“会配环境的人”，一旦证书、签名、Fastlane 或商店凭据集中在个人电脑里，团队风险就会迅速放大；第三，流程不可观测，测试是否完整执行、覆盖率是否下降、Release 是否附带正确版本号、构建产物是否来自 tag 对应提交，往往没人说得清。

所以，Flutter 项目做 CI/CD，不是“把打包脚本搬到云上”这么简单，而是要把环境、测试、构建、签名、发布、版本管理、回滚依据全部纳入自动化体系。本文结合一个较完整的 Flutter 企业项目流水线实践，重点讲清楚如何基于 GitHub Actions 搭建一条可落地、可维护、能排查问题的 CI/CD 流程：从 FVM 固定 Flutter 版本、依赖与缓存策略、单元测试 / Widget 测试 / 集成测试流水线，到 Android APK/AAB 构建与签名、iOS IPA 构建与 TestFlight、Fastlane 集成、矩阵构建、多平台发布、Codecov 覆盖率上报，以及最后最关键的“踩坑记录”。

如果你已经写过一些最基础的 GitHub Actions YAML，那么本文更适合你，因为我不会只停留在 `flutter test`、`flutter build apk` 这种 Hello World 级别示例，而会重点讲为什么要这么设计、哪些步骤一定要拆开、哪些缓存会让你表面变快实际上更脆，以及我在真实项目里遇到过的坑。

## 一、先明确目标：Flutter 项目的 CI/CD 到底要解决什么

在开始写 YAML 之前，先把目标定义清楚。一个工程化的 Flutter CI/CD，不应该只是“push 代码自动跑测试”，而应该至少覆盖下面几类需求：

1. **代码质量门禁**：提交代码后自动执行格式化校验、静态分析、单元测试、Widget 测试。
2. **构建一致性**：通过固定 Flutter 版本、Dart 依赖锁定、JDK 版本、Xcode 版本，让任意构建节点输出一致产物。
3. **多平台产物生成**：Android 输出 APK/AAB，iOS 输出 IPA，必要时扩展到 Web、macOS、Windows、Linux。
4. **发布自动化**：tag 或 release 触发生产构建，自动上传 Google Play / TestFlight，避免手工上传。
5. **版本语义化**：版本号、build number、git tag、changelog 要一致，不能出现应用里显示 1.2.0，商店上传是 1.2.0+87，GitHub Release 写着 1.1.9 这种混乱情况。
6. **可回溯**：每个发布包都能追溯到具体 commit、workflow run、测试结果、覆盖率与构建日志。

一个典型的分层设计是：

- `pull_request`：只做快速校验，不做重型发布动作；
- `push` 到主分支：跑完整测试和候选构建；
- `tag` 或 `release`：执行签名、打正式包、上传商店、创建 Release；
- 手工 `workflow_dispatch`：允许在特定场景下重试构建或按参数触发。

这里第一个经验就是：**不要把所有逻辑都写进一个超长 workflow 文件里**。GitHub Actions 支持把职责拆分为多个工作流，例如：

- `ci.yml`：格式化、分析、测试、覆盖率；
- `android-release.yml`：Android 发布；
- `ios-release.yml`：iOS 发布；
- `release.yml`：统一版本与 GitHub Release；
- `reusable-build.yml`：给多个 workflow 复用的公共构建逻辑。

这样拆分的好处是失败定位更清晰，权限边界也更明确。比如 iOS 发布通常需要更多 secrets，完全没必要让普通 PR 也接触到这些配置。

## 二、仓库基础准备：版本固定、目录约定、密钥治理

在写 GitHub Actions 之前，先把仓库准备好。下面是一套比较推荐的 Flutter 项目目录与工具约定：

```text
project/
├── .fvm/
│   └── fvm_config.json
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── android-release.yml
│       ├── ios-release.yml
│       └── reusable-flutter-setup.yml
├── android/
├── ios/
├── integration_test/
├── lib/
├── test/
├── fastlane/
│   ├── Fastfile
│   ├── Appfile
│   └── Matchfile
├── pubspec.yaml
├── pubspec.lock
└── melos.yaml   # 多包仓库可选
```

### 1. Flutter 版本固定：推荐 FVM

很多团队 CI 失败的根源不是代码，而是 Flutter SDK 漂移。尤其是直接在 Actions 里写死 `flutter-version: stable`，看起来省事，实际上非常危险。因为 stable channel 本身会滚动更新，你今天构建通过，不代表明天也会通过。

我更建议用 FVM（Flutter Version Management）固定版本。例如：

```json
{
  "flutterSdkVersion": "3.24.5"
}
```

如果项目本地已经使用 FVM，那么 CI 也应该跟它保持一致，而不是本地一套、CI 一套。否则你会遇到一种非常经典的问题：开发机上 `flutter gen-l10n` 生成的代码与 CI 的 `dart format` 或 analyzer 行为不一致，导致 PR 永远红灯。

### 2. 依赖锁定：`pubspec.lock` 是否提交？

对 App 项目来说，建议提交 `pubspec.lock`。这样 CI 每次拉取依赖时都能保证一致版本。如果不提交，Flutter 包生态里某个间接依赖小版本更新，就可能让昨天能过的测试今天突然挂掉。

### 3. Secrets 管理：不要把证书和密钥散落在个人机器

CI/CD 里最敏感的部分通常是：

- Android keystore 文件
- keystore alias / password
- Google Play service account JSON
- iOS 证书、provisioning profile 或 App Store Connect API Key
- Fastlane match 仓库访问令牌
- Codecov token

推荐做法：

- 小文本凭据直接存 GitHub Actions Secrets；
- 二进制文件如 `.jks`、`.p12`，通常转成 base64 再存 secret；
- 发布相关 secret 放到 GitHub Environments，例如 `staging`、`production`，用环境级审批和隔离；
- 严禁把签名文件直接提交仓库，尤其不要侥幸认为“这是私有仓库没事”。

Android keystore 的 base64 生成示例：

```bash
base64 -i upload-keystore.jks | pbcopy
```

在 CI 中恢复：

```bash
echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > android/upload-keystore.jks
```

这里有个跨平台坑：macOS 和 Linux 的 `base64` 参数有差异，本地生成没问题，不代表在 GitHub Runner 上也能直接复用。为了避免脚本两边不兼容，我建议把“编码”步骤只在本地执行，CI 侧只保留最简单的解码逻辑。

## 三、GitHub Actions workflow 设计：从快反馈到可发布

### 先做平台选型：为什么本文以 GitHub Actions 为主

如果你的团队还在 GitHub Actions、GitLab CI、Bitbucket Pipelines 之间犹豫，建议先根据仓库托管位置、移动端发布复杂度和团队维护成本来选，而不是只看“谁也能跑 YAML”。对 Flutter 项目来说，GitHub Actions 通常不是唯一选择，但在 GitHub 托管仓库场景下，往往是集成成本最低、生态最成熟的一种。

| 维度 | GitHub Actions | GitLab CI | Bitbucket Pipelines |
| --- | --- | --- | --- |
| 与代码仓库集成 | 与 GitHub 原生集成，权限、PR、Release 串联顺滑 | 适合 GitLab 仓库与一体化 DevOps | 更适合 Bitbucket 仓库场景 |
| Flutter 社区示例 | 最多，现成 Action 与案例丰富 | 有较多模板，但移动端细节通常要自己补 | 示例相对少，Flutter 最佳实践沉淀有限 |
| iOS/macOS 支持体验 | 社区资料丰富，便于接 Fastlane/TestFlight | 可做，但很多团队要自行补更多脚本 | 能做但配置与成本通常不如 GitHub Actions 直观 |
| 复用与生态 | Marketplace 丰富，复用 Action 成本低 | 更偏向企业级流水线编排 | 生态相对轻量，移动端插件选择较少 |
| 适合什么团队 | 代码已在 GitHub、想快速落地 Flutter CI/CD 的团队 | 已深度使用 GitLab、需要统一 DevOps 平台的团队 | 已使用 Atlassian 套件且流程较轻的团队 |

如果你的 Flutter 仓库本身就在 GitHub，且目标是尽快把测试、覆盖率、自动化构建和发布串起来，那么 GitHub Actions 往往是投入产出比最高的起点；而本文后续所有实践，也都基于这个判断展开。

### 1. 一条成熟流水线通常拆成三层

我在实际项目中常用下面这种分层：

#### 第一层：PR 质量门禁

触发条件：`pull_request`

执行内容：

- checkout
- Flutter 环境准备
- pub get
- `dart format --set-exit-if-changed`
- `flutter analyze`
- `flutter test --coverage`
- Widget 测试
- 可选：轻量级 integration test

目标：在 10 分钟内给开发者反馈。

#### 第二层：主分支候选构建

触发条件：`push` 到 `main` / `master`

执行内容：

- 全量测试
- Android debug/release 构建
- iOS no-codesign 构建验证
- 上传 artifact
- 覆盖率上报 Codecov

目标：验证主分支始终可构建。

#### 第三层：正式发布

触发条件：Git tag，例如 `v1.4.0`

执行内容：

- 解析版本号
- Android AAB 签名构建
- 上传 Google Play internal / beta / production
- iOS archive + export IPA
- 上传 TestFlight
- 创建 GitHub Release
- 附带 changelog / release note

目标：让“发版”从一次危险的手工操作，变成可重复的流水线动作。

### 2. 典型的 CI workflow 示例

下面是一份更接近生产的 `ci.yml`：

```yaml
name: Flutter CI

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

concurrency:
  group: flutter-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Setup Flutter with FVM config
        uses: subosito/flutter-action@v2
        with:
          flutter-version-file: .fvm/fvm_config.json
          cache: true

      - name: Cache pub dependencies
        uses: actions/cache@v4
        with:
          path: |
            ~/.pub-cache
            .dart_tool
          key: ${{ runner.os }}-pub-${{ hashFiles('**/pubspec.lock') }}
          restore-keys: |
            ${{ runner.os }}-pub-

      - name: Install dependencies
        run: flutter pub get

      - name: Verify formatting
        run: dart format --output=none --set-exit-if-changed .

      - name: Analyze
        run: flutter analyze --fatal-infos

      - name: Run unit and widget tests with coverage
        run: flutter test --coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: coverage/lcov.info
          fail_ci_if_error: true
          token: ${{ secrets.CODECOV_TOKEN }}

      - name: Build Android debug APK
        run: flutter build apk --debug

      - name: Build iOS without codesign
        run: flutter build ios --simulator
```

这份 YAML 看起来不复杂，但里面有几个关键点值得展开。

### 3. `concurrency` 一定要配

如果你不给 workflow 配 `concurrency`，同一个 PR 连续 push 多次时，GitHub Actions 会并行跑多个旧任务，既浪费 runner 资源，也会让你看到过期结果。尤其 Flutter 构建比较重，老任务不取消，几次提交后 CI 队列会非常难看。

### 4. `fetch-depth: 0` 的必要性

很多人默认 shallow clone，但如果后续流程要读取 git tag、生成 changelog、计算语义化版本、执行某些依赖历史信息的脚本，没有完整历史会直接踩坑。我的经验是：如果项目包含 release 流程，除非你特别确定不需要 git 历史，否则直接 `fetch-depth: 0`。

## 四、Flutter CI 环境搭建：FVM、JDK、CocoaPods 与缓存策略

Flutter CI 最容易被低估的就是环境问题。真正的难点不是“让 CI 能跑起来”，而是“让它跑得稳、跑得快，还能复现本地问题”。

### 1. 为什么建议用 `subosito/flutter-action`

它在 GitHub Actions 里已经很成熟，支持：

- 直接指定 Flutter 版本
- 从 FVM 配置文件读取版本
- 自带 SDK 缓存
- 多平台 runner 兼容性较好

示例：

```yaml
- name: Setup Flutter
  uses: subosito/flutter-action@v2
  with:
    flutter-version-file: .fvm/fvm_config.json
    channel: stable
    cache: true
```

注意这里虽然配置了 `channel: stable`，真正固定的是 `flutter-version-file` 里的版本号。不要只写 channel。

### 2. pub cache 不要无脑缓存所有东西

很多教程上来就是：

```yaml
path: ~/.pub-cache
```

这没错，但如果你把 `.dart_tool`、build cache、甚至 Android Gradle cache 全部揉在一起，缓存命中率会变差，损坏概率会上升，恢复时间也未必更短。

比较合理的做法是分层缓存：

- Flutter SDK 缓存：交给 `subosito/flutter-action`
- Dart / pub 依赖缓存：`~/.pub-cache` + `.dart_tool/package_config.json` 相关目录
- Gradle 缓存：`~/.gradle/caches`、`~/.gradle/wrapper`
- CocoaPods 缓存：只在 iOS job 单独处理

Android 构建缓存示例：

```yaml
- name: Cache Gradle
  uses: actions/cache@v4
  with:
    path: |
      ~/.gradle/caches
      ~/.gradle/wrapper
    key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
    restore-keys: |
      ${{ runner.os }}-gradle-
```

### 3. iOS 环境比 Android 更脆

iOS 发布通常要跑在 `macos-latest` 或指定版本如 `macos-14`。这部分有几个必须关注的点：

- Xcode 版本变化会影响编译与签名
- CocoaPods 版本不同可能导致 `Podfile.lock` 解析不一致
- 某些 Flutter 插件会依赖特定 Ruby / pod 行为

因此建议显式选择 Xcode，例如：

```yaml
- name: Select Xcode
  run: sudo xcode-select -s /Applications/Xcode_15.4.app
```

如果 Runner 镜像版本更新导致 Xcode 路径变化，这一步会立即报错，至少你能快速感知，而不是在后面 archive 时看到一串难定位的签名失败。

### 4. FVM 在 CI 中的两种方式

#### 方式 A：直接让 Actions 按 FVM 文件装 Flutter

最简单，也最推荐。

#### 方式 B：CI 里先安装 FVM，再执行 `fvm flutter ...`

适用于你本地脚本高度依赖 `fvm flutter` 命令的场景，例如 Makefile、Melos 或自定义脚本全都写的是 `fvm flutter pub get`。

示例：

```yaml
- name: Activate FVM
  run: dart pub global activate fvm

- name: Install Flutter SDK by FVM
  run: fvm install

- name: Use FVM Flutter
  run: fvm flutter --version
```

但我要强调，CI 里为了少一层不确定性，能不用“再套一层 FVM 命令”就尽量不用。**最稳的方式通常是让 Action 直接按 FVM 配置装 SDK，后续仍用 `flutter` 命令。**

## 五、测试流水线设计：单元测试、Widget 测试、集成测试怎么分层

Flutter 测试经常被误解为“反正 `flutter test` 都能跑”。实际上单元测试、Widget 测试、集成测试的目标、速度、稳定性都不同，应该分层处理。

### 1. 单元测试：最适合做 PR 门禁

例如对仓储层、UseCase、工具类做纯 Dart 测试：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:my_app/core/version.dart';

void main() {
  group('Version parser', () {
    test('should parse semantic version', () {
      final version = AppVersion.parse('1.4.2+103');
      expect(version.major, 1);
      expect(version.minor, 4);
      expect(version.patch, 2);
      expect(version.build, 103);
    });
  });
}
```

这类测试快、稳定、可并发，是 CI 最值得优先保障的部分。

### 2. Widget 测试：验证 UI 逻辑，不要把它写成集成测试

示例：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_app/login/login_page.dart';

void main() {
  testWidgets('login button enabled after input', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginPage()));

    final loginButton = find.byKey(const Key('loginButton'));
    expect(tester.widget<ElevatedButton>(loginButton).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('phoneInput')), '13800138000');
    await tester.enterText(find.byKey(const Key('passwordInput')), '123456');
    await tester.pumpAndSettle();

    expect(tester.widget<ElevatedButton>(loginButton).onPressed, isNotNull);
  });
}
```

我的踩坑经验是：很多团队把 Widget 测试写得过重，依赖真实网络、真实数据库、复杂 Provider 初始化，结果 CI 上经常 timeout。**Widget 测试的边界应该是“验证组件树与交互逻辑”，不是把整个 App 跑一遍。**

### 3. 集成测试：放到独立 job，不要拖慢所有 PR

Flutter 新版集成测试通常使用 `integration_test`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('full login flow', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('phoneInput')), '13800138000');
    await tester.enterText(find.byKey(const Key('passwordInput')), '123456');
    await tester.tap(find.byKey(const Key('loginButton')));
    await tester.pumpAndSettle(const Duration(seconds: 3));

    expect(find.text('首页'), findsOneWidget);
  });
}
```

在 CI 中，如果跑 Android Emulator 或 iOS Simulator，建议单独 job 处理，并允许只在 nightly、主分支或手工触发时运行。示例：

```yaml
integration-test-android:
  runs-on: macos-14
  if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'run-integration-test')
  steps:
    - uses: actions/checkout@v4
    - uses: subosito/flutter-action@v2
      with:
        flutter-version-file: .fvm/fvm_config.json
        cache: true
    - uses: reactivecircus/android-emulator-runner@v2
      with:
        api-level: 34
        arch: x86_64
        profile: pixel_7
        script: |
          flutter pub get
          flutter test integration_test
```
```

### 4. 测试结果可视化

`flutter test` 默认控制台输出对 CI 还行，但如果你想把结果上传为 JUnit XML 供 GitHub 或第三方平台展示，可以结合 `tojunit`：

```yaml
- name: Run tests and export junit
  run: |
    flutter test --machine | tojunit -o report.xml
```

当然这里要注意 `--machine` 输出和普通日志不同，如果你的流水线还依赖标准输出做分析，就要分开处理。

## 六、Android 构建与签名：APK/AAB、keystore、Gradle 参数怎么放进流水线

Android 的自动化构建相对 iOS 友好很多，但也有一些典型坑。

### 1. Release 构建的前置准备

`android/key.properties` 不建议提交仓库，可以在 CI 里动态生成：

```yaml
- name: Decode Android keystore
  run: |
    echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 --decode > android/upload-keystore.jks

- name: Create key.properties
  run: |
    cat > android/key.properties <<EOF
    storePassword=${{ secrets.ANDROID_STORE_PASSWORD }}
    keyPassword=${{ secrets.ANDROID_KEY_PASSWORD }}
    keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}
    storeFile=upload-keystore.jks
    EOF
```

然后在 `build.gradle` 或 `build.gradle.kts` 中读取：

```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
        }
    }
}
```

### 2. APK 和 AAB 的定位不同

- **APK**：适合测试分发、内部验证、快速安装。
- **AAB**：上架 Google Play 的标准产物。

所以我的建议是：

- CI 候选构建输出 APK 便于测试下载；
- 正式发布输出 AAB 上传商店；
- 两者都可以作为 artifact 保存。

构建示例：

```yaml
- name: Build APK
  run: flutter build apk --release --build-name=${{ env.VERSION_NAME }} --build-number=${{ env.BUILD_NUMBER }}

- name: Build App Bundle
  run: flutter build appbundle --release --build-name=${{ env.VERSION_NAME }} --build-number=${{ env.BUILD_NUMBER }}
```

### 3. Android artifact 上传

```yaml
- name: Upload APK artifact
  uses: actions/upload-artifact@v4
  with:
    name: android-apk
    path: build/app/outputs/flutter-apk/app-release.apk

- name: Upload AAB artifact
  uses: actions/upload-artifact@v4
  with:
    name: android-aab
    path: build/app/outputs/bundle/release/app-release.aab
```

### 4. 我踩过的坑：`build-number` 与 Play Console 冲突

有一次团队把 `build-number` 固定写在 `pubspec.yaml`，CI 发版时没有自动递增，结果上传 Google Play 直接失败：

> Version code 102 has already been used.

后来改成：

- `versionName` 来自 git tag，如 `1.6.0`
- `versionCode` 来自 GitHub Actions run number 或基于时间戳生成

例如：

```yaml
env:
  VERSION_NAME: ${{ github.ref_name }}
  BUILD_NUMBER: ${{ github.run_number }}
```

但注意 tag 通常是 `v1.6.0`，还要做一次去前缀处理，后文会讲。

## 七、iOS IPA 构建与 TestFlight：签名、证书、导出配置是最容易翻车的部分

iOS 发布自动化的难度主要在签名与苹果生态工具链。最常见的问题不是 Flutter 本身，而是：

- 证书过期
- profile 不匹配
- Team ID 错误
- ExportOptions.plist 配置不对
- API Key 权限不足

### 1. 最好用 Fastlane 管理 iOS 发布

虽然你可以直接在 Actions 脚本里调用 `xcodebuild archive`、`xcodebuild -exportArchive`、`altool` 或 `xcrun notarytool` 之类命令，但维护成本极高。**iOS 发布强烈建议交给 Fastlane**，它是 CI 中很成熟的一层抽象。

### 2. 使用 App Store Connect API Key

相比 Apple ID + 密码 + 二次验证，API Key 更适合 CI。你需要在 App Store Connect 创建：

- Issuer ID
- Key ID
- `.p8` 私钥文件

然后存入 GitHub Secrets，例如：

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`

恢复方式：

```yaml
- name: Restore App Store Connect API Key
  run: |
    mkdir -p ~/private_keys
    echo "${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}" | base64 --decode > ~/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_KEY_ID }}.p8
```

### 3. no-codesign 构建用于日常验证

并不是所有 CI 都要签名。主分支验证时可以先跑：

```yaml
- name: Build iOS without codesign
  run: flutter build ios --release --no-codesign
```

它的价值在于：

- 提前发现 CocoaPods / Swift 编译问题；
- 不需要暴露敏感签名信息给普通构建；
- 让 iOS 编译问题更早暴露，而不是等到发布当天才发现。

### 4. Fastlane 打包上传 TestFlight 示例

`fastlane/Fastfile`：

```ruby
def app_store_connect_api_key_config
  app_store_connect_api_key(
    key_id: ENV['APP_STORE_CONNECT_KEY_ID'],
    issuer_id: ENV['APP_STORE_CONNECT_ISSUER_ID'],
    key_filepath: ENV['APP_STORE_CONNECT_API_KEY_PATH'],
    duration: 1200,
    in_house: false
  )
end

platform :ios do
  desc "Build and upload to TestFlight"
  lane :beta do
    api_key = app_store_connect_api_key_config

    increment_build_number(
      xcodeproj: "ios/Runner.xcodeproj",
      build_number: ENV['BUILD_NUMBER']
    )

    build_app(
      workspace: "ios/Runner.xcworkspace",
      scheme: "Runner",
      export_method: "app-store",
      output_directory: "build/ios",
      output_name: "Runner.ipa"
    )

    upload_to_testflight(
      api_key: api_key,
      skip_waiting_for_build_processing: true,
      changelog: ENV['RELEASE_NOTE']
    )
  end
end
```

GitHub Actions 调用：

```yaml
jobs:
  ios-release:
    runs-on: macos-14
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version-file: .fvm/fvm_config.json
          cache: true

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true

      - name: Install pods
        run: |
          cd ios
          pod repo update
          pod install

      - name: Restore API key
        run: |
          mkdir -p ~/private_keys
          echo "${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}" | base64 --decode > ~/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_KEY_ID }}.p8
          echo "APP_STORE_CONNECT_API_KEY_PATH=$HOME/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_KEY_ID }}.p8" >> $GITHUB_ENV

      - name: Build and upload TestFlight
        run: bundle exec fastlane ios beta
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          BUILD_NUMBER: ${{ github.run_number }}
          RELEASE_NOTE: ${{ github.event.head_commit.message }}
```

### 5. 我踩过的坑：证书导入成功但还是签名失败

这是 iOS CI 里特别恶心的一类问题。日志看起来像：

> No signing certificate "iOS Distribution" found

但你明明已经导入了 `.p12`。最终排查发现是 keychain 没有正确设置 partition list，导致 codesign 无法访问私钥。解决方式之一：

```bash
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" build.keychain
```

如果你不用 Fastlane match，而是手工导入证书，这一步经常是必须的。

## 八、Fastlane 集成：把平台发布逻辑沉淀成可维护脚本

GitHub Actions 擅长编排，Fastlane 擅长移动端发布。我的经验是：**不要把所有发布细节硬编码在 Actions YAML 中**，而是让 YAML 负责调度，把平台相关逻辑下沉到 Fastlane。

### 1. Android Fastlane 示例

`fastlane/Fastfile`：

```ruby
platform :android do
  desc "Build and upload Android bundle to Play"
  lane :beta do
    gradle(
      task: "clean bundle",
      build_type: "Release",
      project_dir: "android/"
    )

    upload_to_play_store(
      track: "internal",
      aab: "build/app/outputs/bundle/release/app-release.aab",
      json_key_data: ENV['PLAY_STORE_JSON_KEY'],
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      release_status: "completed"
    )
  end
end
```

GitHub Actions 中：

```yaml
- name: Deploy Android to Play Internal
  run: bundle exec fastlane android beta
  env:
    PLAY_STORE_JSON_KEY: ${{ secrets.PLAY_STORE_JSON_KEY }}
```

### 2. 为什么 Fastlane 值得引入

- 发布逻辑可以本地调试，不必每次都提交到 Actions 才验证；
- lane 可读性更好，特别是 iOS 签名流程；
- Android / iOS 共用 release note、版本号处理更方便；
- 团队交接成本更低，不会只剩一坨 YAML 谁都不敢动。

### 3. 但 Fastlane 也有坑

- Ruby 生态有时依赖地狱明显，建议提交 `Gemfile.lock`；
- `fastlane` 某些插件版本升级会引发行为变化；
- macOS runner 上 Ruby 版本变动时，bundle install 可能突然失败。

所以建议配上：

```ruby
source "https://rubygems.org"

gem "fastlane"
```

并在 CI 里通过 `ruby/setup-ruby` + `bundler-cache` 固定环境。

## 九、矩阵构建：多平台、多环境、多 Flutter 版本如何扩展

GitHub Actions 的 matrix 非常适合 Flutter 这种天然跨平台项目。

### 1. 最实用的矩阵维度

常见矩阵维度包括：

- 平台：android / ios / web
- Runner：ubuntu / macos
- 构建环境：staging / production
- Flutter 版本：当前稳定版 / 下一个候选版

示例：

```yaml
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: android
            os: ubuntu-latest
            command: flutter build appbundle --release
          - platform: ios
            os: macos-14
            command: flutter build ios --release --no-codesign
          - platform: web
            os: ubuntu-latest
            command: flutter build web --release

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version-file: .fvm/fvm_config.json
          cache: true
      - run: flutter pub get
      - run: ${{ matrix.command }}
```

### 2. `fail-fast: false` 的作用

如果 Android 失败了，不代表 iOS 或 Web 也没有参考价值。矩阵构建时我通常把 `fail-fast` 关掉，这样可以一次看到所有平台状态。

### 3. 不建议一上来就做“全矩阵”

很多团队刚上 CI/CD 就把所有维度都塞进去，结果 workflow 既慢又贵，还没人维护。建议从业务价值最高的组合开始，比如：

- PR：只跑 Ubuntu 上的 analyze + test
- main：加 Android 构建
- release：再加 macOS 的 iOS 发布

工程化是逐步演进，不是第一天就搭一个宇宙飞船。

## 十、代码覆盖率与 Codecov：不要只上传数字，要设门槛

`flutter test --coverage` 会生成 `coverage/lcov.info`。如果只是上传到 Codecov 看图表，价值有限；更重要的是给主分支建立趋势与阈值认知。

### 1. 生成覆盖率

```yaml
- name: Run tests with coverage
  run: flutter test --coverage
```

### 2. 过滤自动生成代码

很多 Flutter 项目会有 `.g.dart`、`.freezed.dart`、`generated_plugin_registrant.dart` 等生成文件，不过滤的话覆盖率数字会被严重稀释。

例如：

```bash
lcov --remove coverage/lcov.info \
  '**/*.g.dart' \
  '**/*.freezed.dart' \
  '**/generated_plugin_registrant.dart' \
  -o coverage/lcov.info
```

CI 示例：

```yaml
- name: Remove generated files from coverage
  run: |
    sudo apt-get update
    sudo apt-get install -y lcov
    lcov --remove coverage/lcov.info \
      '**/*.g.dart' \
      '**/*.freezed.dart' \
      '**/generated_plugin_registrant.dart' \
      -o coverage/lcov.info
```

### 3. 上传 Codecov

```yaml
- name: Upload coverage report
  uses: codecov/codecov-action@v4
  with:
    files: coverage/lcov.info
    fail_ci_if_error: true
    token: ${{ secrets.CODECOV_TOKEN }}
```

### 4. 我踩过的坑：覆盖率下降不是因为测试少了，而是路径变了

有一次从单包仓库迁移到 monorepo，Codecov 报告突然掉了 20%，但测试明明没少。最后发现是 `lcov.info` 里的路径前缀变化导致 Codecov 无法正确映射源文件。这个问题很隐蔽，日志看着“上传成功”，但 dashboard 数字就是不对。

经验是：**每次迁移仓库结构或 runner 工作目录变化后，先抽样检查 `lcov.info` 的 `SF:` 路径是否能对上仓库真实路径。**

## 十一、语义化版本与自动发布：tag、build number、Release Note 如何统一

CI/CD 做到最后，如果版本策略混乱，发布仍然会很痛苦。Flutter 项目里至少有四个版本概念：

- `pubspec.yaml` 中的 `version: 1.4.0+120`
- Git tag，例如 `v1.4.0`
- Android versionName/versionCode
- iOS CFBundleShortVersionString/CFBundleVersion

### 1. 推荐的统一原则

- Git tag 是发布源头：`v1.4.0`
- `1.4.0` 作为 versionName / marketing version
- `github.run_number` 或 CI 生成值作为 build number
- release note 从 git log / conventional commits 自动生成

### 2. 在 workflow 中解析版本

```yaml
- name: Parse version
  run: |
    RAW_TAG="${GITHUB_REF_NAME}"
    VERSION_NAME="${RAW_TAG#v}"
    echo "VERSION_NAME=$VERSION_NAME" >> $GITHUB_ENV
    echo "BUILD_NUMBER=${GITHUB_RUN_NUMBER}" >> $GITHUB_ENV
```

### 3. 更新 Flutter 构建版本

```yaml
- name: Build Android release
  run: flutter build appbundle --release --build-name=$VERSION_NAME --build-number=$BUILD_NUMBER
```

对 iOS 也可在 Fastlane 中同步：

```ruby
increment_version_number(
  version_number: ENV['VERSION_NAME'],
  xcodeproj: "ios/Runner.xcodeproj"
)

increment_build_number(
  build_number: ENV['BUILD_NUMBER'],
  xcodeproj: "ios/Runner.xcodeproj"
)
```

### 4. 自动生成 GitHub Release

```yaml
- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    tag_name: ${{ github.ref_name }}
    generate_release_notes: true
    files: |
      build/app/outputs/bundle/release/app-release.aab
      build/app/outputs/flutter-apk/app-release.apk
```

### 5. 再进一步：Conventional Commits + 自动推版本

如果团队提交规范已经是 Conventional Commits，可以结合 `semantic-release`、`release-please` 或自定义脚本自动决定是 major / minor / patch。Flutter 项目不一定非要全套 Node 生态工具，但思路是一样的：

- `feat:` -> minor
- `fix:` -> patch
- `BREAKING CHANGE:` -> major

这样可以把版本提升从“靠人记”变成“靠提交语义推导”。

## 十二、把整套流程串起来：一个相对完整的 Release Workflow

下面给出一份较完整的 `release.yml` 思路，方便把前面内容串联起来：

```yaml
name: Flutter Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  release-android:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true

      - uses: subosito/flutter-action@v2
        with:
          flutter-version-file: .fvm/fvm_config.json
          cache: true

      - name: Parse version
        run: |
          RAW_TAG="${GITHUB_REF_NAME}"
          echo "VERSION_NAME=${RAW_TAG#v}" >> $GITHUB_ENV
          echo "BUILD_NUMBER=${GITHUB_RUN_NUMBER}" >> $GITHUB_ENV

      - name: Install dependencies
        run: flutter pub get

      - name: Run tests
        run: flutter test

      - name: Restore keystore
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 --decode > android/upload-keystore.jks

      - name: Create key.properties
        run: |
          cat > android/key.properties <<EOF
          storePassword=${{ secrets.ANDROID_STORE_PASSWORD }}
          keyPassword=${{ secrets.ANDROID_KEY_PASSWORD }}
          keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}
          storeFile=upload-keystore.jks
          EOF

      - name: Build Android bundle
        run: flutter build appbundle --release --build-name=$VERSION_NAME --build-number=$BUILD_NUMBER

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: android-release-aab
          path: build/app/outputs/bundle/release/app-release.aab

  release-ios:
    runs-on: macos-14
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: subosito/flutter-action@v2
        with:
          flutter-version-file: .fvm/fvm_config.json
          cache: true

      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true

      - name: Parse version
        run: |
          RAW_TAG="${GITHUB_REF_NAME}"
          echo "VERSION_NAME=${RAW_TAG#v}" >> $GITHUB_ENV
          echo "BUILD_NUMBER=${GITHUB_RUN_NUMBER}" >> $GITHUB_ENV

      - name: Install dependencies
        run: flutter pub get

      - name: Install pods
        run: |
          cd ios
          pod install

      - name: Restore App Store Connect API Key
        run: |
          mkdir -p ~/private_keys
          echo "${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}" | base64 --decode > ~/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_KEY_ID }}.p8
          echo "APP_STORE_CONNECT_API_KEY_PATH=$HOME/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_KEY_ID }}.p8" >> $GITHUB_ENV

      - name: Build and upload to TestFlight
        run: bundle exec fastlane ios beta
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
          VERSION_NAME: ${{ env.VERSION_NAME }}
          BUILD_NUMBER: ${{ env.BUILD_NUMBER }}

  github-release:
    needs: [release-android, release-ios]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          generate_release_notes: true
```

这份 workflow 不一定适合每个团队直接复制，但它体现了几个重要原则：

- Android / iOS 分开 job，便于定位问题；
- 统一在 tag 触发时解析版本；
- release 之前仍然跑测试，避免“测试在前面 workflow 过了，这次就不测了”的侥幸；
- iOS 发布逻辑尽量交给 Fastlane；
- GitHub Release 放在最后，等平台构建成功再创建。

## 十三、真实踩坑记录：这些问题我建议你在设计阶段就避免

这一节不讲理想路径，只讲真坑。

### 坑 1：缓存让构建更快，也让问题更随机

我们曾经缓存了：

- `~/.pub-cache`
- `.dart_tool`
- `build/`
- `~/.gradle`

最开始看起来速度提升明显，但后面开始出现随机性失败：

- analyzer 报莫名其妙的旧错误
- Gradle task 输入输出缓存污染
- Flutter 插件升级后旧 build 目录残留导致编译异常

最后结论是：**不要缓存 `build/` 目录**，`.dart_tool` 也要谨慎；缓存依赖即可，不要缓存构建产物中间态。

### 坑 2：`pod repo update` 很慢，但不加又可能偶发失败

iOS CI 中，`pod install` 有时会因为 specs 过旧失败；加上 `pod repo update` 又会显著拖慢构建。我的做法通常是：

- PR 和主分支验证：直接 `pod install`
- release job：必要时 `pod repo update`
- 或者通过 `Podfile.lock` 固定后尽量避免每次更新 specs

不要机械照搬教程，应该根据你的依赖稳定性和构建时长预算来定。

### 坑 3：GitHub Secrets 中多行文本换行被吃掉

尤其是 `.p8`、JSON key、私钥这类内容，如果直接复制粘贴，有时会因为换行格式或 shell 展开导致文件损坏。更稳妥的办法通常是：

- 本地先 base64 编码
- CI 中 decode 到文件

这比直接把原文塞进 heredoc 更可靠。

### 坑 4：iOS 模拟器能过，不代表真机 archive 能过

有些 Flutter 插件只在真机架构或 archive 阶段暴露问题。比如：

- arm64 架构冲突
- 某些权限描述缺失
- Release 配置下 Swift 优化导致行为异常

所以主分支如果只跑 `flutter build ios --simulator`，那只是“基础可编译”检查，**不能替代真正的 archive 验证**。

### 坑 5：Workflow 权限不够，Release 创建失败

GitHub 默认 token 权限越来越收紧，如果你要创建 Release、上传 artifact 到某些服务、写回仓库状态，需要显式声明：

```yaml
permissions:
  contents: write
```

否则你会在最后一步看到很迷惑的 403。

### 坑 6：同一个 workflow 里同时处理测试、构建、发布，失败后很难复用结果

早期我们把所有逻辑揉进一个 job：

- test
- build android
- build ios
- upload play
- upload testflight

结果 iOS 最后一步失败，前面 Android 的构建成果也白费；重试时又要全部重来。后来拆分 job，并配合 artifact / reusable workflow，整体维护体验提升非常明显。

### 坑 7：版本号取自 tag，但 tag 命名不规范

如果有人打了 `release-1.2.0`、`1.2.0`、`v1.2` 这类不统一 tag，自动化版本解析就会变成灾难。所以在团队层面必须约束：

- 正式发布 tag 统一为 `vMAJOR.MINOR.PATCH`
- 例如 `v2.3.1`

并在 workflow 里只匹配：

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

### 坑 8：Fastlane 本地能跑，CI 不能跑

很多时候不是 Fastlane lane 写错，而是本地有“隐形前提条件”：

- 本地 Ruby 版本不同
- 本地 keychain 已有证书
- 本地 Xcode 选中的版本不同
- 本地登录过 Apple 账户

所以我的经验是：**凡是用于发布的 lane，必须尽早在一台干净机器或 CI 环境里验证一次。** 你越依赖本地已有状态，越难迁移到自动化。

## 十四、我推荐的一套落地策略

如果你现在是从零开始给 Flutter 项目上 CI/CD，不要试图一周内一步到位。更现实的路线是：

### 第一步：先把 CI 跑稳

先完成：

- FVM 固定 Flutter 版本
- `flutter pub get`
- `dart format` 校验
- `flutter analyze`
- `flutter test --coverage`
- Codecov 上传

先保证每个 PR 都有可靠质量门禁。

### 第二步：补上 Android 自动构建

再增加：

- debug APK for PR/main
- release APK/AAB for tag
- keystore secrets 管理
- artifact 上传

Android 链路通常更容易先打通，能快速建立团队信心。

### 第三步：引入 Fastlane，打通 iOS TestFlight

然后做：

- no-codesign build for main
- Fastlane 管理 iOS 发布
- App Store Connect API Key
- TestFlight 上传

### 第四步：再考虑版本自动化与商店全自动发布

最后才是：

- semantic version
- release notes 自动生成
- Google Play 多 track
- App Store / TestFlight 自动分组
- reusable workflow / monorepo matrix 优化

这条路线的核心思想是：**先追求稳定，再追求炫技。** 很多流水线不是死在技术不行，而是死在设计过度、维护不起。

## 十五、结语：CI/CD 的价值，不是“自动”，而是“可复制、可追溯、可演进”

Flutter + GitHub Actions 的组合非常适合中小团队到中大型移动团队做工程化升级。GitHub Actions 足够轻量，和仓库天然集成；Flutter 本身跨平台，适合用矩阵与共享脚本统一流程；Fastlane 则能把移动端最复杂的发布细节从 YAML 中抽离出来。三者结合之后，你可以把原来依赖“某位同学电脑环境”的流程，逐步沉淀成团队资产。

但真正的关键，不是把一堆命令搬进工作流文件，而是建立一套清晰规则：

- SDK 和依赖版本必须固定；
- 测试必须分层，PR 快反馈，发布走重校验；
- 签名和凭据必须集中治理；
- 版本号与 tag 必须统一；
- 发布流程必须能复跑、能回看、能定位失败点。

当这些原则稳定下来之后，CI/CD 才会从“偶尔有人维护的脚本集合”变成项目真正的交付基础设施。

如果你已经有一条能跑的 Flutter GitHub Actions 流水线，我建议你回头再审视三个问题：

1. 如果换一台完全干净的机器，这条流水线还能稳定复现吗？
2. 如果负责发版的人休假了，团队还能在 30 分钟内独立完成发布吗？
3. 如果线上某个包有问题，你能快速定位它对应的 commit、测试结果和构建日志吗？

如果这三个问题里还有一个回答不上来，那就说明你的 CI/CD 还有继续演进的空间。而这，正是工程化最值得投入的地方。

## 相关阅读

- [Flutter 测试实战：Unit/Widget/Integration 三层测试体系](/categories/Flutter/Flutter-测试实战-Unit-Widget-Integration-三层测试体系/)
- [Flutter 性能优化实战：DevTools 分析、渲染优化、包体积裁剪](/categories/Flutter/Flutter-性能优化实战-DevTools-分析-渲染优化-包体积裁剪/)
- [Flutter + Firebase 实战：Auth/Firestore/FCM 一体化后端方案](/categories/Flutter/Flutter-Firebase-实战-Auth-Firestore-FCM-一体化后端方案/)

```
