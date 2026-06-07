# CI/CD 与发布

## 定义

CI/CD（持续集成/持续部署）是 Flutter 应用从代码提交到上架应用商店的自动化工程实践。
在 Flutter 多平台开发场景下，CI/CD 涵盖自动构建、自动化测试、代码签名、多平台打包、
应用商店提交等全流程自动化。

- **CI（Continuous Integration）**：每次代码提交自动运行测试、lint、构建验证
- **CD（Continuous Delivery/Deployment）**：自动打包、签名、发布到测试/生产环境

### 主流 CI/CD 平台

| 平台 | 特点 | 适用场景 |
|------|------|---------|
| GitHub Actions | 与 GitHub 深度集成、免费额度充足 | 开源项目、中小团队 |
| Codemagic | Flutter 专属 CI/CD、图形化配置 | Flutter 项目首选 |
| Fastlane | 专注移动端打包发布 | iOS/Android 发布 |
| Bitrise | 移动端 CI/CD 平台 | 企业级项目 |
| GitLab CI | 与 GitLab 集成 | 使用 GitLab 的团队 |

## 核心原理

### 1. GitHub Actions CI/CD 基础架构

```yaml
# .github/workflows/ci.yml
name: Flutter CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  FLUTTER_VERSION: '3.22.0'

jobs:
  # ─── 分析与测试 ───
  analyze-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - name: Install dependencies
        run: flutter pub get

      - name: Analyze
        run: flutter analyze --fatal-infos

      - name: Run tests
        run: flutter test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage/lcov.info

  # ─── 构建 Android ───
  build-android:
    needs: analyze-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}

      - run: flutter pub get
      - run: flutter build appbundle --release

      - uses: actions/upload-artifact@v4
        with:
          name: android-release
          path: build/app/outputs/bundle/release/app-release.aab

  # ─── 构建 iOS ───
  build-ios:
    needs: analyze-and-test
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}

      - run: flutter pub get
      - run: flutter build ipa --release --no-codesign

      - uses: actions/upload-artifact@v4
        with:
          name: ios-release
          path: build/ios/ipa/*.ipa

  # ─── 构建 Web ───
  build-web:
    needs: analyze-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
      - run: flutter pub get
      - run: flutter build web --release --web-renderer canvaskit

      - uses: actions/upload-artifact@v4
        with:
          name: web-release
          path: build/web/
```

### 2. 代码签名

#### Android 签名
```bash
# 生成 Keystore
keytool -genkey -v -keystore ~/upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload -storepass <password>
```

```properties
# android/key.properties
storePassword=<password>
keyPassword=<password>
keyAlias=upload
storeFile=/path/to/upload-keystore.jks
```

```groovy
// android/app/build.gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
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
        }
    }
}
```

#### iOS 签名（CI 环境）
```yaml
# 使用 Fastlane match 管理证书
- name: Setup iOS certificates
  run: |
    cd ios
    bundle exec fastlane match appstore --readonly
```

```ruby
# ios/fastlane/Matchfile
git_url("git@github.com:your-org/certificates.git")
storage_mode("git")
type("appstore")
app_identifier("com.example.myapp")
```

### 3. 应用打包命令

```bash
# ─── Android ───
flutter build apk --release                          # APK
flutter build appbundle --release                    # AAB（推荐上架）
flutter build apk --split-per-abi                    # 分架构 APK

# ─── iOS ───
flutter build ipa --release                          # IPA（需 macOS + Xcode）

# ─── Web ───
flutter build web --release --web-renderer canvaskit # Web（CanvasKit 渲染）
flutter build web --release --web-renderer html      # Web（HTML 渲染）

# ─── 桌面 ───
flutter build macos --release                        # macOS
flutter build windows --release                      # Windows
flutter build linux --release                        # Linux
```

### 4. Fastlane 自动发布

```ruby
# android/fastlane/Fastfile
platform :android do
  desc "Deploy to Google Play Internal Testing"
  lane :internal do
    upload_to_play_store(
      track: 'internal',
      aab: '../build/app/outputs/bundle/release/app-release.aab',
      json_key_file: 'play-store-credentials.json',
      package_name: 'com.example.myapp',
    )
  end

  desc "Promote internal to production"
  lane :production do
    upload_to_play_store(
      track: 'production',
      track_promote_to: 'production',
      json_key_file: 'play-store-credentials.json',
      package_name: 'com.example.myapp',
    )
  end
end
```

```ruby
# ios/fastlane/Fastfile
platform :ios do
  desc "Upload to TestFlight"
  lane :beta do
    build_app(
      workspace: "Runner.xcworkspace",
      scheme: "Runner",
      export_method: "app-store",
    )
    upload_to_testflight
  end

  desc "Deploy to App Store"
  lane :release do
    build_app(
      workspace: "Runner.xcworkspace",
      scheme: "Runner",
      export_method: "app-store",
    )
    upload_to_app_store(
      submit_for_review: true,
      automatic_release: true,
    )
  end
end
```

### 5. GitHub Actions 完整发布流水线

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'

      - run: flutter pub get
      - run: flutter build appbundle --release

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.2'
          bundler-cache: true
          working-directory: android

      - name: Deploy to Play Store
        working-directory: android
        env:
          PLAY_STORE_CREDENTIALS: ${{ secrets.PLAY_STORE_CREDENTIALS }}
        run: |
          echo "$PLAY_STORE_CREDENTIALS" > play-store-credentials.json
          bundle exec fastlane internal

  release-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'

      - run: flutter pub get

      - name: Setup certificates
        env:
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          MATCH_GIT_BASIC_AUTHORIZATION: ${{ secrets.MATCH_GIT_AUTH }}
        run: |
          cd ios
          bundle exec fastlane match appstore --readonly

      - name: Build and deploy
        working-directory: ios
        env:
          APP_STORE_CONNECT_API_KEY: ${{ secrets.ASC_API_KEY }}
        run: bundle exec fastlane beta
```

### 6. 版本管理自动化

```yaml
# 自动递增 build number
- name: Get build number
  id: build_number
  run: echo "BUILD_NUMBER=${{ github.run_number }}" >> $GITHUB_OUTPUT

- name: Update version
  run: |
    flutter build ipa --release \
      --build-name=${{ github.ref_name }} \
      --build-number=${{ steps.build_number.outputs.BUILD_NUMBER }}
```

## 实战案例

详细实战教程请参阅博客文章：

- [Flutter CI/CD 实战：GitHub Actions 自动化构建测试发布](/categories/Flutter/Flutter-CICD-实战-GitHub-Actions-自动化构建测试发布/)
  — 完整的 GitHub Actions CI/CD 流水线搭建，包含测试、构建、签名、发布全流程

- [Flutter App 打包实战：iOS/Android/Web/桌面多平台发布流程](/categories/Flutter/Flutter-App-打包实战-iOS-Android-Web-桌面多平台发布流程/)
  — 各平台打包命令、签名配置、应用商店提交的详细操作指南

## 相关概念

- **测试体系** — CI 流水线中运行的 [测试体系](/wiki/Flutter/测试体系/)（Unit/Widget/Integration）
- **性能优化** — CI 中可集成 [性能优化](/wiki/Flutter/性能优化/) 基准测试和包体积检查
- **Firebase与BaaS** — [Firebase App Distribution](/wiki/Flutter/Firebase与BaaS/) 可用于测试版分发
- **架构模式** — CI 中的 flavor 配置与 [架构模式](/wiki/Flutter/架构模式/) 中的环境管理相关

## 常见问题

### Q1: GitHub Actions 中 Flutter 缓存如何配置？
```yaml
- uses: subosito/flutter-action@v2
  with:
    flutter-version: '3.22.0'
    cache: true  # 自动缓存 pub 依赖

# 手动缓存 Gradle
- uses: actions/cache@v4
  with:
    path: |
      ~/.gradle/caches
      ~/.gradle/wrapper
    key: gradle-${{ runner.os }}-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
```

### Q2: iOS 签名在 CI 中如何处理？
推荐方案：
1. **Fastlane Match**：集中管理证书和 Provisioning Profile，存储在私有 Git 仓库
2. **App Store Connect API Key**：替代 Apple ID 登录，更安全可靠
3. GitHub Secrets 存储敏感信息（密码、API Key）

### Q3: AAB 和 APK 的区别？
- **AAB (Android App Bundle)**：Google 推荐格式，Play Store 自动按设备生成优化 APK
- **APK**：通用安装包，适合直接分发或第三方应用商店
- 上架 Google Play 必须使用 AAB

### Q4: Flutter Web 部署到哪里？
常见选择：
1. **Firebase Hosting**：`firebase deploy --only hosting`
2. **GitHub Pages**：推送到 `gh-pages` 分支
3. **Netlify / Vercel**：连接 Git 仓库自动部署
4. **自建 Nginx**：部署 `build/web/` 目录

### Q5: 多 flavor 环境如何配置？
```yaml
# CI 中切换 flavor
- run: flutter build apk --release --flavor production -t lib/main_production.dart
- run: flutter build apk --release --flavor staging -t lib/main_staging.dart
```

### Q6: 构建太慢怎么优化？
1. 启用 `--split-debug-info` 和 `--obfuscate`
2. 使用 `flutter build` 而非 `flutter run` 进行 CI 构建
3. 利用 Runner 机器缓存（Pub cache、Gradle cache、CocoaPods cache）
4. 并行执行 Android/iOS/Web 构建
5. 考虑使用 `flutter build apk --split-per-abi` 减少单次构建体积

### Q7: 如何自动发布 Changelog？
```yaml
- name: Generate changelog
  id: changelog
  uses: mindsers/changelog-reader-action@v2
  with:
    path: ./CHANGELOG.md

- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    body: ${{ steps.changelog.outputs.changes }}
    files: |
      build/app/outputs/bundle/release/app-release.aab
      build/ios/ipa/*.ipa
```
