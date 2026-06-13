---

title: uni-app App 打包实战：iOS/Android 原生打包与发布 — 从 HBuilderX 到上架全流程踩坑记录
keywords: [uni, app App, iOS, Android, HBuilderX, 打包实战, 原生打包与发布, 到上架全流程踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 06:40:07
updated: 2026-05-17 06:42:11
categories:
- frontend
tags:
- uni-app
- iOS
- Android
- 跨平台
- 移动开发
- Vue
- App打包
description: uni-app 一套代码跑 iOS、Android 双平台，但跨平台移动开发的打包发布流程远比 H5 和小程序复杂。本文基于奇乐MAX电商项目真实经验，详解 uni-app 云打包、离线打包、iOS 签名证书管理、Android 多渠道打包、自定义基座真机调试、应用市场审核被拒等全流程踩坑记录，附 GitHub Actions CI/CD 自动化打包方案。
---




# uni-app App 打包实战：iOS/Android 原生打包与发布

## 前言

uni-app 宣传「一套代码，多端发布」，H5 和微信小程序的发布确实简单——编译、上传、完事。但 **App 端完全是另一个世界**：签名证书、包名管理、权限声明、应用市场审核……每一步都可能卡你好几天。

本文基于奇乐MAX电商项目的实战经验，记录从开发调试到 iOS/Android 双平台上架的完整流程，以及我们踩过的每一个坑。

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    uni-app 源码工程                       │
│         (Vue 3 + uni_modules + 条件编译)                  │
├─────────┬──────────┬──────────┬─────────────────────────┤
│  H5     │ 微信小程序 │  iOS App │  Android App            │
├─────────┴──────────┴──────────┴─────────────────────────┤
│                  编译层（Vite / Webpack）                  │
├─────────────────────────────────────────────────────────┤
│         原生壳（App.vue + 原生插件 + Native.js）           │
├─────────────┬───────────────────────────────────────────┤
│  云打包      │  离线打包（Xcode / Android Studio）         │
│  (HBuilderX) │  (自定义原生模块时必须)                      │
└─────────────┴───────────────────────────────────────────┘
```

## 一、打包前必做：App 配置清单

在 `manifest.json` 中配置 App 信息，这是打包的基础。以下是关键字段：

```json
{
  "name": "奇乐MAX",
  "appid": "__UNI__XXXXXXX",
  "versionName": "1.2.3",
  "versionCode": 123,
  "app-plus": {
    "distribute": {
      "android": {
        "permissions": [
          "<uses-permission android:name=\"android.permission.INTERNET\"/>",
          "<uses-permission android:name=\"android.permission.CAMERA\"/>",
          "<uses-permission android:name=\"android.permission.ACCESS_FINE_LOCATION\"/>",
          "<uses-permission android:name=\"android.permission.READ_EXTERNAL_STORAGE\"/>",
          "<uses-permission android:name=\"android.permission.WRITE_EXTERNAL_STORAGE\"/>"
        ],
        "minSdkVersion": 21,
        "targetSdkVersion": 34,
        "abiFilters": ["armeabi-v7a", "arm64-v8a"]
      },
      "ios": {
        "dSYMs": true,
        "privacyDescription": {
          "NSCameraUsageDescription": "用于扫码和拍照上传",
          "NSLocationWhenInUseUsageDescription": "用于获取附近门店",
          "NSPhotoLibraryUsageDescription": "用于选择图片上传"
        }
      },
      "sdkConfigs": {
        "maps": {
          "amap": {
            "appkey_ios": "YOUR_IOS_AMAP_KEY",
            "appkey_android": "YOUR_ANDROID_AMAP_KEY"
          }
        },
        "oauth": {
          "weixin": {
            "appid": "wx1234567890",
            "appkey": "your_weixin_appkey"
          },
          "apple": {
            "bundleId": "com.kkday.qlmax"
          }
        }
      }
    }
  }
}
```

### 踩坑记录 #1：versionCode 必须递增

```bash
# ❌ 错误：versionCode 没改，iOS TestFlight 直接拒绝
# ERROR: The bundle version must be higher than the previously uploaded version.

# ✅ 正确做法：每次打包前用脚本自动递增
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
pkg.versionCode = (pkg.versionCode || 0) + 1;
const parts = pkg.versionName.split('.');
parts[2] = parseInt(parts[2] || 0) + 1;
pkg.versionName = parts.join('.');
fs.writeFileSync('manifest.json', JSON.stringify(pkg, null, 2));
console.log('Version bumped to', pkg.versionName, 'code:', pkg.versionCode);
"
```

### 踩坑记录 #2：privacyDescription 是 iOS 必填项

iOS 14+ 要求在 `Info.plist` 中声明每一个隐私权限的用途。如果不填，App 会在调用相机/定位时直接崩溃（不是拒绝，是崩溃）：

```
# 崩溃日志
Termination Reason: TCC, This app has crashed because it attempted to 
access privacy-sensitive data without a usage description. The app's 
Info.plist must contain an NSCameraUsageDescription key...
```

## 二、iOS 打包：签名体系与证书管理

iOS 的签名体系是整个 App 发布中最复杂的部分。以下是核心架构图：

```
┌──────────────────────────────────────────────────┐
│                 Apple Developer 账号               │
├──────────────────────────────────────────────────┤
│  App ID          │  Provisioning Profile          │
│  com.kkday.qlmax │  Development / Distribution     │
├──────────────────┼────────────────────────────────┤
│  Certificate     │  Devices (UDID)                │
│  Dev / Dist      │  测试设备白名单（Ad Hoc）         │
└──────────────────┴────────────────────────────────┘
```

### 方案一：HBuilderX 云打包（推荐新手）

HBuilderX 的云打包内置了 DCloud 的共享证书，适合个人开发者快速上架：

```
步骤：
1. 菜单 → 发行 → 原生App-云打包
2. 选择 iOS（越狱包不勾选）
3. Bundle ID: com.kkday.qlmax
4. 证书：使用 DCloud 共享证书 / 上传自有 .p12 + .mobileprovision
5. 点击打包，等待 10-30 分钟
```

### 方案二：离线打包（团队项目推荐）

当项目集成了原生插件（如支付宝 SDK、高德地图 SDK），必须离线打包：

```bash
# 1. 在 HBuilderX 中生成本地打包资源
# 菜单 → 发行 → 原生App-本地打包 → 生成iOS本地打包资源

# 2. 资源目录结构
# HBuilder-Hello/
# ├── HBuilder-Hello/
# │   ├── Apps/
# │   │   └── __UNI__XXXXXXX/    ← 你的App资源
# │   │       ├── www/
# │   │       └── manifest.json
# │   ├── Control/
# │   ├── Pandora/
# │   └── Support/
# ├── HBuilder-Hello.xcodeproj
# └── Podfile

# 3. 打开 Xcode，配置签名
# 4. Product → Archive → Upload to App Store
```

### 踩坑记录 #3：证书过期导致打包失败

```bash
# 症状：HBuilderX 云打包报错
# Error: Provisioning profile doesn't include signing certificate

# 诊断命令（Mac 本地）
security find-identity -v -p codesigning

# 解决方案
# 1. 到 Apple Developer Portal 续期/重建证书
# 2. 重新生成 Provisioning Profile
# 3. 下载安装到 Keychain
# 4. HBuilderX 云打包时重新上传 .p12 和 .mobileprovision
```

## 三、Android 打包：签名与多渠道

### 生成签名文件

```bash
# 生成 keystore（只做一次，务必安全保管）
keytool -genkey -v \
  -keystore qlmax-release.keystore \
  -alias qlmax \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass your_store_password \
  -keypass your_key_password \
  -dname "CN=QLMax, OU=Tech, O=KKDay, L=Taipei, ST=Taiwan, C=TW"

# 验证 keystore 信息
keytool -list -v -keystore qlmax-release.keystore -storepass your_store_password
```

### HBuilderX 配置 Android 签名

```json
// manifest.json → app-plus → distribute → android
{
  "signature": {
    "keystore": "path/to/qlmax-release.keystore",
    "storePassword": "your_store_password",
    "alias": "qlmax",
    "keyPassword": "your_key_password"
  }
}
```

### 多渠道打包（电商 App 必备）

不同应用市场（华为、小米、应用宝、Google Play）需要不同的渠道标识：

```bash
# uni-app 的多渠道配置在 manifest.json 中
{
  "app-plus": {
    "distribute": {
      "android": {
        "marketChannels": [
          "huawei",
          "xiaomi",
          "tencent",
          "google",
          "official"
        ]
      }
    }
  }
}

# 云打包时选择渠道，或使用 CLI 批量打包
# 批量打包脚本
channels=("huawei" "xiaomi" "tencent" "google" "official")
for channel in "${channels[@]}"; do
  echo "Building for channel: $channel"
  # 使用 uni-app CLI 打包
  npx uni build -p app --channel "$channel"
  mv "dist/build/app.apk" "dist/build/app-${channel}.apk"
done
```

### 踩坑记录 #4：Google Play 要求 AAB 格式

```bash
# ❌ Google Play 自 2021 年起不接受 APK，必须 AAB
# 提交时错误：You uploaded an APK that was signed in debug mode. 
# You need to sign your APK in release mode.

# ✅ 解决方案：使用 Android Studio 离线打包
# Build → Generate Signed Bundle / APK → Android App Bundle

# uni-app 云打包也支持 AAB 输出
# 在 HBuilderX 打包界面勾选「生成AAB」
```

## 四、自定义基座：真机调试的关键

开发阶段不能每次都完整打包，需要使用「自定义调试基座」：

```
┌─────────────────────────────────────────────┐
│           开发调试流程                         │
├─────────────────────────────────────────────┤
│                                             │
│  1. HBuilderX → 运行 → 运行到手机或模拟器     │
│     ├── 使用标准基座（DCloud 共享，有限制）     │
│     └── 使用自定义基座（推荐，完整环境）        │
│                                             │
│  2. 自定义基座 = 用你自己的签名打包的调试包     │
│     └── 包含完整权限 + 原生插件 + 签名         │
│                                             │
│  3. 安装基座后，HBuilderX 热更新到基座中       │
│     └── 修改代码 → 保存 → 自动同步到手机       │
│                                             │
└─────────────────────────────────────────────┘
```

```bash
# 制作自定义基座
# HBuilderX → 运行 → 运行到手机或模拟器 → 制作自定义调试基座

# iOS 基座需要：
# - Apple Developer 账号（付费 99$/年）
# - 设备 UDID 加入开发者账号
# - Ad Hoc Provisioning Profile

# Android 基座：
# - 使用 debug 签名即可
# - 安装到手机后信任该来源
```

### 踩坑记录 #5：自定义基座安装后「应用未安装」

```bash
# Android 症状：提示「应用未安装」或「解析包错误」
# 原因：已安装的 App 和基座签名不一致

# ✅ 解决：先卸载旧版本，再安装基座
adb uninstall io.dcloud.HBuilder

# iOS 症状：提示「无法安装」
# 原因：设备 UDID 未加入 Provisioning Profile
# ✅ 解决：在 Apple Developer Portal 添加设备 UDID，重新生成 Profile
```

## 五、应用市场提交与审核

### iOS App Store 提交流程

```
1. Archive → Upload to App Store Connect
2. App Store Connect 填写：
   - 应用名称、副标题、描述
   - 关键词（100 字符上限）
   - 截图（6.7"、6.5"、5.5" 三种尺寸）
   - 隐私政策 URL
   - App Review 联系信息
3. 提交审核（通常 24-48 小时）
```

### 踩坑记录 #6：iOS 审核被拒常见原因

```markdown
# 我们项目遇到过的审核被拒理由：

## 1. Guideline 2.1 - Performance: App Completeness
# 原因：审核人员无法登录测试
# ✅ 解决：在 App Store Connect 提供演示账号

## 2. Guideline 4.0 - Design
# 原因：App 截图与实际界面不符
# ✅ 解决：截图必须是真实 App 界面，不能用设计稿

## 3. Guideline 5.1.1 - Data Collection and Storage
# 原因：App 要求登录但没有说明为什么需要用户数据
# ✅ 解决：在隐私政策中详细说明数据用途

## 4. 4.3 - Spam（最致命）
# 原因：被认为是马甲包（与其他 App 功能高度相似）
# ✅ 解决：确保 App 有独特功能，UI 差异化
```

### Android 应用市场提交

```bash
# 华为 AppGallery Connect
# - 需要企业开发者账号
# - 需要软件著作权（软著）
# - 审核时间：1-3 个工作日

# 小米应用商店
# - 个人账号可提交
# - 需要实名认证
# - 审核时间：1-5 个工作日

# Google Play
# - 需要 Google Play Developer 账号（$25 一次性）
# - 需要 AAB 格式
# - 需要填写数据安全表单
# - 审核时间：通常 7 天+
```

## 六、持续集成：自动化打包发布

当项目进入稳定迭代期，手动打包效率太低。以下是我们的 CI/CD 方案：

```yaml
# .github/workflows/build-app.yml
name: Build uni-app

on:
  push:
    tags:
      - 'v*'

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      
      # 使用 uni-app CLI 构建
      - name: Build Android
        env:
          UNI_APP_HBUILDERX: /opt/hbuilderx
        run: |
          npx uni build -p app
          
      # 签名 APK
      - name: Sign APK
        uses: r0adkll/sign-android-release@v1
        with:
          releaseDirectory: dist/build/app
          signingKeyBase64: ${{ secrets.ANDROID_SIGNING_KEY }}
          alias: ${{ secrets.ANDROID_ALIAS }}
          keyStorePassword: ${{ secrets.ANDROID_STORE_PASSWORD }}
          keyPassword: ${{ secrets.ANDROID_KEY_PASSWORD }}

      # 上传到蒲公英/fir.im
      - name: Upload to Pgyer
        run: |
          curl -F "file=@dist/build/app.apk" \
               -F "uKey=${{ secrets.PGYER_UKEY }}" \
               -F "_api_key=${{ secrets.PGYER_API_KEY }}" \
               https://www.pgyer.com/apiv2/app/upload
```

## 七、常见问题速查表

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 云打包超时 | 高峰期排队 | 避开工作日 10-16 点，或使用离线打包 |
| iOS 安装后闪退 | Profile 过期 / 设备未注册 | 重新生成 Profile |
| Android 64位兼容 | 只打了 armeabi-v7a | manifest 中添加 arm64-v8a |
| App 图标不显示 | 图标尺寸不对 | 需要 1024x1024 无透明通道的 PNG |
| 权限弹窗崩溃 | iOS privacyDescription 未填 | manifest.json 中补全隐私描述 |
| 热更新失效 | versionCode 未递增 | 每次发布前自动递增 versionCode |
| 原生插件不生效 | 未使用自定义基座调试 | 制作自定义基座后再测试 |

## 八、跨平台框架对比：uni-app vs React Native vs Flutter

选型阶段，团队经常纠结用哪个框架。以下是基于实际项目经验的对比：

| 维度 | uni-app | React Native | Flutter |
|------|---------|-------------|---------|
| **语言** | Vue 3 + TypeScript | JavaScript/TypeScript | Dart |
| **学习曲线** | ⭐ 低（Vue 开发者秒上手） | ⭐⭐ 中（需了解原生桥接） | ⭐⭐⭐ 高（Dart 语言 + Widget 体系） |
| **多端支持** | App + H5 + 小程序 + 快应用 | App + H5（React Native Web） | 仅 App + Web（无小程序） |
| **包体积** | 较小（约 5-8MB 增量） | 中等（约 7-15MB 增量） | 较大（约 10-20MB 增量） |
| **性能** | 接近原生（nvue 模式） | 接近原生（新架构 Hermes） | 高性能（自绘引擎） |
| **生态** | uni_modules 中国市场为主 | npm 全球生态丰富 | pub.dev 国际生态良好 |
| **原生插件** | Native.js + 原生插件市场 | Turbo Modules / 原生模块 | Platform Channels |
| **热更新** | 内置支持（App 热更新） | CodePush（微软方案） | 无官方方案 |
| **适用场景** | 电商/小程序优先/中国市场 | 复杂交互动画/海外市场 | 高性能 UI/定制渲染 |
| **维护状态** | DCloud 持续维护 | Meta 重点投入 | Google 持续投入 |

> **选型建议**：如果项目需要同时覆盖国内微信小程序 + App，uni-app 是唯一选择；如果只做海外 App 且追求极致性能，Flutter 更优；React Native 适合已有 React 技术栈的团队。

## 总结

uni-app 的 App 打包发布是一个系统工程，核心要点：

1. **manifest.json 是灵魂**——所有 App 配置都在这里，版本号、权限、SDK 密钥
2. **iOS 签名体系要理解**——Certificate + App ID + Provisioning Profile 三者缺一不可
3. **自定义基座是调试标配**——标准基座无法测试原生插件和完整权限
4. **审核被拒是常态**——提前准备演示账号、合规截图、隐私政策
5. **CI/CD 是长期收益**——手动打包在 3 次之后就会让你崩溃

从 HBuilderX 云打包入门，到离线打包进阶，再到 CI/CD 自动化，这是一条必经之路。希望本文的踩坑记录能帮你少走弯路。

## 相关阅读

- [uni-app 条件编译实战：平台差异处理与适配策略踩坑记录](/categories/uni-app-conditionally-compile/) — 深入讲解 #ifdef 条件编译语法与多端差异处理
- [uni-app + Vue 3 + Vite 现代跨平台开发工作流实战踩坑记录](/categories/uni-app-vue3-vite/) — 从 Vue 2 迁移到 Vue 3 + Vite 的完整实战经验
- [uni-app Native.js 原生插件开发实战：原生 SDK 集成与多平台踩坑记录](/categories/uni-app-native-js-sdk/) — Native.js + 原生插件开发流程与 iOS/Android 双平台集成
- [HBuilderX 实战：uni-app 官方 IDE 深度使用](/categories/hbuilderx-uni-app-ide/) — 真机调试、插件开发与多端发布踩坑记录
- [uni-app 性能优化实战：首屏加载、分包加载、图片懒加载策略](/categories/uni-app-performance-optimization/) — 从 5s 到 800ms 的性能治理全链路
