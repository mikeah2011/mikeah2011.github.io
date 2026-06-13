---

title: uni-app Native.js 原生插件开发实战：原生 SDK 集成与多平台踩坑记录
keywords: [uni, app Native.js, SDK, 原生插件开发实战, 原生, 集成与多平台踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 07:00:11
updated: 2026-06-07 00:00:00
categories:
- frontend
tags:
- uni-app
- native.js
- SDK
- 跨平台
- 原生插件
description: uni-app 跨平台开发中遇到原生能力瓶颈？本文从 Native.js 快速调用到原生插件深度开发，覆盖 Android/iOS 双平台 SDK 集成实战，详解支付宝等第三方 SDK 接入、蓝牙通信、自定义相机等场景，附带 9 大常见踩坑案例与调试技巧，助你打通 uni-app 与原生 JS 的最后一公里。
---




## 前言

在 uni-app 跨平台开发中，80% 的业务需求可以通过 Vue 语法 + uni API 搞定。但总有那 20% 的场景——蓝牙硬件通信、自定义相机预览、第三方原生支付 SDK、生物识别认证、自定义地图标注等——需要直接调用平台原生能力。

这时候你有两个选择：

1. **Native.js**：用 JavaScript 直接调用原生 API，轻量快速，适合简单调用
2. **原生插件（Plugin）**：编写完整的原生模块，适合复杂交互

本文以我在 B2C 电商项目中集成多个原生 SDK 的真实经验，从 Native.js 基础到原生插件开发，覆盖 iOS/Android 双平台的完整实战流程。

---

## 架构总览

```
┌─────────────────────────────────────────────┐
│              uni-app Vue 层                  │
│         (业务逻辑 / 页面渲染)                 │
├─────────────────────────────────────────────┤
│           uni Bridge (JSBridge)              │
├──────────────┬──────────────────────────────┤
│   Native.js  │     原生插件 (Plugin)         │
│  (JS → 原生)  │  (Obj-C / Swift / Java/Kt)  │
├──────────────┴──────────────────────────────┤
│         iOS (UIKit) / Android (View)         │
│         系统 API / 第三方 SDK                 │
└─────────────────────────────────────────────┘
```

**选型决策树：**

- 只需要调用一个原生 API（如获取电池电量）→ **Native.js**
- 需要自定义 UI 组件（如相机预览）→ **原生插件**
- 需要集成第三方 SDK（如支付宝 SDK）→ **原生插件**
- 需要后台持续运行（如蓝牙扫描）→ **原生插件**

---

## 一、Native.js 基础实战

Native.js（简称 njs）是 DCloud 提供的桥接方案，允许 JS 直接调用 Objective-C/Java API，无需编写原生代码。

### 1.1 获取系统信息（Android 示例）

```javascript
// 获取 Android 设备的电量信息
function getBatteryInfo() {
  // #ifdef APP-PLUS
  const Context = plus.android.importClass('android.content.Context');
  const IntentFilter = plus.android.importClass('android.content.IntentFilter');
  const Intent = plus.android.importClass('android.content.Intent');

  const mainActivity = plus.android.runtimeMainActivity();
  const registerReceiver = mainActivity.registerReceiver(
    null,
    new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
  );

  const level = registerReceiver.getIntExtra('level', -1);
  const scale = registerReceiver.getIntExtra('scale', -1);
  const batteryPct = Math.round((level / scale) * 100);

  console.log(`当前电量: ${batteryPct}%`);
  return batteryPct;
  // #endif
}
```

### 1.2 调用 iOS 原生 API

```javascript
// 获取 iOS 设备的屏幕亮度
function getScreenBrightness() {
  // #ifdef APP-PLUS
  constUIScreen = plus.ios.importClass('UIScreen');
  const mainScreen = UIScreen.mainScreen();
  const brightness = mainScreen.brightness();
  plus.ios.deleteObject(mainScreen);
  console.log(`屏幕亮度: ${brightness}`);
  return brightness;
  // #endif
}
```

### 1.3 Native.js 的核心 API

```javascript
// ===== Android 侧 =====
// 导入 Java 类
const MyClass = plus.android.importClass('com.example.MyClass');
// 调用静态方法
MyClass.staticMethod();
// 获取实例
const instance = new MyClass();

// ===== iOS 侧 =====
// 导入 ObjC 类
const NSString = plus.ios.importClass('NSString');
// 调用类方法
const str = NSString.stringWithFormat_('Hello %@', 'World');
// 释放内存（重要！）
plus.ios.deleteObject(str);
```

---

## 二、Native.js 实战踩坑记录

### 踩坑 1：iOS 内存泄漏

**问题**：Native.js 创建的 iOS 对象不会被 JavaScript GC 回收，必须手动释放。

```javascript
// ❌ 错误写法：内存泄漏
function readFile(path) {
  const NSString = plus.ios.importClass('NSString');
  const content = NSString.stringWithContentsOfFile_encoding_error_(
    path, 4, null
  );
  return plus.ios.newObject(content); // 返回的对象没人释放
}

// ✅ 正确写法：手动释放
function readFile(path) {
  const NSString = plus.ios.importClass('NSString');
  const content = NSString.stringWithContentsOfFile_encoding_error_(
    path, 4, null
  );
  const result = content.toString(); // 转成 JS 字符串
  plus.ios.deleteObject(content);    // 释放原生对象
  return result;
}
```

**排查方式**：在 Xcode Instruments 中使用 Leaks 工具，可以看到 `CFString` 等对象持续增长。

### 踩坑 2：Android 线程问题

**问题**：Native.js 在某些场景下不在主线程执行，操作 UI 会崩溃。

```javascript
// ❌ 在子线程操作 UI 导致崩溃
function showToast(msg) {
  const Toast = plus.android.importClass('android.widget.Toast');
  const context = plus.android.runtimeMainActivity();
  Toast.makeText(context, msg, Toast.LENGTH_SHORT).show();
}

// ✅ 切到主线程
function showToast(msg) {
  const activity = plus.android.runtimeMainActivity();
  const Runnable = plus.android.importClass('java.lang.Runnable');

  activity.runOnUiThread(
    new Runnable({
      run: function () {
        const Toast = plus.android.importClass('android.widget.Toast');
        Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show();
      }
    })
  );
}
```

### 踩坑 3：权限申请时序

**问题**：Native.js 调用需要权限的 API 时，权限可能还没申请完成。

```javascript
// ✅ 先申请权限，再调用原生 API
async function openCamera() {
  // 使用 uni API 先申请权限
  const result = await new Promise((resolve) => {
    uni.authorize({
      scope: 'scope.camera',
      success: () => resolve(true),
      fail: () => {
        uni.showModal({
          title: '需要相机权限',
          content: '请在设置中开启相机权限',
          success: (res) => {
            if (res.confirm) uni.openSetting();
          }
        });
        resolve(false);
      }
    });
  });

  if (!result) return;

  // 权限已获取，再调用原生 API
  // ... Native.js 调用
}
```

### 踩坑 4：Android 包名冲突

**问题**：导入类时，Android 的 `importClass` 可能和 JavaScript 内置对象冲突。

```javascript
// ❌ 导入 android.text.TextUtils，但 TextUtils 可能已被占用
const TextUtils = plus.android.importClass('android.text.TextUtils');

// ✅ 使用 importMethod 直接调用，避免导入整个类
const mainActivity = plus.android.runtimeMainActivity();
const isEmpty = plus.android.invoke(
  'android.text.TextUtils', 'isEmpty', str
);
```

---

## 三、原生插件开发（Plugin）

当 Native.js 不够用时（需要自定义 UI、复杂回调、后台任务），就需要开发原生插件。

### 3.1 插件目录结构

```
my-native-plugin/
├── package.json                    # 插件描述
├── android/                        # Android 原生代码
│   ├── build.gradle
│   └── src/main/java/com/example/
│       └── MyPlugin.java          # 插件主类
├── ios/                            # iOS 原生代码
│   ├── MyPlugin.h
│   ├── MyPlugin.m
│   └── MyPlugin.podspec           # CocoaPods 依赖
└── js/
    └── index.js                    # JS 接口封装
```

### 3.2 package.json 插件描述

```json
{
  "name": "my-native-plugin",
  "version": "1.0.0",
  "description": "自定义原生插件示例",
  "uni-app": {
    "plugins": {
      "my-plugin": {
        "version": "1.0.0",
        "hooks": "js/index.js",
        "android": {
          "plugins": [
            {
              "type": "module",
              "name": "my-plugin",
              "class": "com.example.MyPlugin"
            }
          ],
          "integrateType": "aar",
          "minSdkVersion": 21,
          "hooks": "android/hooks.js",
          "permissions": [
            "<uses-permission android:name=\"android.permission.CAMERA\"/>"
          ]
        },
        "ios": {
          "plugins": [
            {
              "type": "module",
              "name": "my-plugin",
              "class": "MyPlugin"
            }
          ],
          "hooks": "ios/hooks.js"
        }
      }
    }
  }
}
```

### 3.3 Android 插件实现（Java）

```java
package com.example;

import android.util.Log;
import com.alibaba.fastjson.JSONObject;
import io.dcloud.feature.uniapp.annotation.UniJSMethod;
import io.dcloud.feature.uniapp.bridge.UniJSCallback;
import io.dcloud.feature.uniapp.common.UniModule;

public class MyPlugin extends UniModule {

    private static final String TAG = "MyPlugin";

    /**
     * 同步方法：返回结果直接
     */
    @UniJSMethod(uiThread = true)
    public String getDeviceId() {
        String deviceId = android.os.Build.SERIAL;
        Log.d(TAG, "Device ID: " + deviceId);
        return deviceId;
    }

    /**
     * 异步方法：通过 callback 返回结果
     */
    @UniJSMethod(uiThread = false)
    public void scanBluetooth(UniJSCallback callback) {
        // 在子线程执行耗时操作
        JSONObject result = new JSONObject();
        result.put("status", "scanning");
        result.put("devices", new String[]{"Device-A", "Device-B"});

        // 回调 JS 层
        if (callback != null) {
            callback.invoke(result);
        }
    }

    /**
     * 带 Promise 的方法
     */
    @UniJSMethod(uiThread = false)
    public void connectDevice(String deviceId, UniJSCallback success,
                              UniJSCallback fail) {
        try {
            // 模拟连接逻辑
            boolean connected = doConnect(deviceId);

            JSONObject result = new JSONObject();
            if (connected) {
                result.put("code", 0);
                result.put("message", "连接成功");
                if (success != null) success.invoke(result);
            } else {
                result.put("code", -1);
                result.put("message", "连接超时");
                if (fail != null) fail.invoke(result);
            }
        } catch (Exception e) {
            JSONObject error = new JSONObject();
            error.put("code", -2);
            error.put("message", e.getMessage());
            if (fail != null) fail.invoke(error);
        }
    }

    /**
     * 发送事件到 JS 层（无需 callback）
     */
    @UniJSMethod(uiThread = true)
    public void startMonitor() {
        // 持续监控，通过 mUniSDKFireEvent 发送事件
        new Thread(() -> {
            for (int i = 0; i < 10; i++) {
                try {
                    Thread.sleep(1000);
                    JSONObject data = new JSONObject();
                    data.put("index", i);
                    data.put("timestamp", System.currentTimeMillis());

                    // 发送事件到 JS
                    mUniSDKFireEvent.onFireEvent(
                        "myPluginEvent", data
                    );
                } catch (InterruptedException e) {
                    break;
                }
            }
        }).start();
    }

    private boolean doConnect(String deviceId) {
        // 模拟蓝牙连接
        try { Thread.sleep(2000); } catch (Exception e) {}
        return true;
    }
}
```

### 3.4 iOS 插件实现（Objective-C）

**MyPlugin.h:**

```objc
#import <UIKit/UIKit.h>
#import "DCUniModule.h"

@interface MyPlugin : DCUniModule

@end
```

**MyPlugin.m:**

```objc
#import "MyPlugin.h"
#import <CoreBluetooth/CoreBluetooth.h>

@interface MyPlugin () <CBCentralManagerDelegate>
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, copy) UniModuleKeepAliveCallback scanCallback;
@end

@implementation MyPlugin

// 同步方法
- (NSString *)getDeviceId {
    NSString *deviceId = [UIDevice currentDevice].identifierForVendor.UUIDString;
    NSLog(@"Device ID: %@", deviceId);
    return deviceId;
}

// 异步方法
- (void)scanBluetooth:(UniModuleKeepAliveCallback)callback {
    self.scanCallback = callback;

    // 必须在主线程初始化 CBCentralManager
    dispatch_async(dispatch_get_main_queue(), ^{
        self.centralManager = [[CBCentralManager alloc]
            initWithDelegate:self
            queue:nil
            options:nil];
    });

    // 延迟扫描，等蓝牙状态就绪
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)),
        dispatch_get_main_queue(),
        ^{
            [self.centralManager scanForPeripheralsWithServices:nil
                options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
        }
    );
}

// CBCentralManagerDelegate
- (void)centralManager:(CBCentralManager *)central
    didDiscoverPeripheral:(CBPeripheral *)peripheral
        advertisementData:(NSDictionary *)advertisementData
                     RSSI:(NSNumber *)RSSI {

    NSDictionary *result = @{
        @"status": @"discovered",
        @"name": peripheral.name ?: @"Unknown",
        @"uuid": peripheral.identifier.UUIDString,
        @"rssi": RSSI
    };

    if (self.scanCallback) {
        self.scanCallback(result, YES); // YES = keep alive
    }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central.state != CBManagerStatePoweredOn) {
        if (self.scanCallback) {
            self.scanCallback(@{
                @"status": @"error",
                @"message": @"蓝牙未开启"
            }, NO);
        }
    }
}

// Promise 模式
- (void)connectDevice:(NSString *)deviceId
              success:(UniModuleKeepAliveCallback)success
                 fail:(UniModuleKeepAliveCallback)fail {
    dispatch_async(dispatch_get_global_queue(
        DISPATCH_QUEUE_PRIORITY_DEFAULT, 0
    ), ^{
        // 模拟连接
        [NSThread sleepForTimeInterval:2.0];

        dispatch_async(dispatch_get_main_queue(), ^{
            BOOL connected = YES; // 模拟成功

            if (connected) {
                success(@{@"code": @0, @"message": @"连接成功"}, NO);
            } else {
                fail(@{@"code": @-1, @"message": @"连接超时"}, NO);
            }
        });
    });
}

@end
```

---

## 四、JS 层接口封装

为插件提供简洁的 JS API，对上层业务屏蔽原生细节：

```javascript
// js/index.js - 插件 JS 接口封装

const myPlugin = uni.requireNativePlugin('my-plugin');

/**
 * 插件管理器
 */
class MyPluginManager {
  constructor() {
    this._eventListeners = new Map();
  }

  /**
   * 获取设备 ID（同步）
   */
  getDeviceId() {
    return myPlugin.getDeviceId();
  }

  /**
   * 扫描蓝牙设备（异步 + 事件）
   */
  startScan(onDevice) {
    // 监听原生事件
    uni.$on('myPluginEvent', (data) => {
      onDevice(data);
    });

    myPlugin.startMonitor();
  }

  /**
   * 停止扫描
   */
  stopScan() {
    uni.$off('myPluginEvent');
  }

  /**
   * 连接设备（Promise 包装）
   */
  connectDevice(deviceId) {
    return new Promise((resolve, reject) => {
      myPlugin.connectDevice(
        deviceId,
        (res) => resolve(res),
        (err) => reject(new Error(err.message))
      );
    });
  }

  /**
   * 统一事件监听
   */
  onEvent(eventName, handler) {
    if (!this._eventListeners.has(eventName)) {
      this._eventListeners.set(eventName, []);
    }
    this._eventListeners.get(eventName).push(handler);

    // 注册原生事件
    myPlugin.addEventListener(eventName, (data) => {
      handler(data);
    });
  }

  /**
   * 清除所有监听
   */
  dispose() {
    this._eventListeners.clear();
    myPlugin.removeAllEventListeners();
  }
}

export default new MyPluginManager();
```

### Vue 组件中使用

```vue
<template>
  <view class="bluetooth-page">
    <button @click="startScan" :disabled="scanning">
      {{ scanning ? '扫描中...' : '开始扫描' }}
    </button>

    <view
      v-for="device in devices"
      :key="device.uuid"
      class="device-item"
      @click="connect(device)"
    >
      <text>{{ device.name }}</text>
      <text class="rssi">RSSI: {{ device.rssi }}</text>
    </view>

    <view v-if="connectedDevice" class="status">
      <text>已连接：{{ connectedDevice.name }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import myPlugin from '@/plugins/my-plugin/index.js';

const scanning = ref(false);
const devices = ref([]);
const connectedDevice = ref(null);

const startScan = () => {
  scanning.value = true;
  devices.value = [];

  myPlugin.startScan((data) => {
    if (data.status === 'discovered') {
      // 去重
      const exists = devices.value.find(
        (d) => d.uuid === data.uuid
      );
      if (!exists) {
        devices.value.push(data);
      }
    }
  });
};

const connect = async (device) => {
  try {
    uni.showLoading({ title: '连接中...' });
    const result = await myPlugin.connectDevice(device.uuid);

    if (result.code === 0) {
      connectedDevice.value = device;
      uni.showToast({ title: '连接成功', icon: 'success' });
    }
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' });
  } finally {
    uni.hideLoading();
  }
};

onUnmounted(() => {
  myPlugin.stopScan();
  myPlugin.dispose();
});
</script>
```

---

## 五、插件集成到 HBuilderX 项目

### 5.1 本地插件集成

```bash
# 项目目录结构
your-project/
├── nativeplugins/
│   └── my-plugin/              # 插件目录
│       ├── package.json
│       ├── android/
│       └── ios/
├── pages/
├── manifest.json               # 关键：需要在此声明插件
└── App.vue
```

### 5.2 manifest.json 配置

```json
{
  "app-plus": {
    "modules": {
      "my-plugin": {}
    },
    "distribute": {
      "plugins": {
        "nativePlugins": {
          "my-plugin": {
            "version": "1.0.0"
          }
        }
      }
    }
  }
}
```

### 5.3 云端插件 vs 本地插件

```
┌──────────────────┬──────────────────────────────────┐
│     对比项        │    云端插件       │   本地插件     │
├──────────────────┼──────────────────┼───────────────┤
│ 安装方式          │ DCloud 插件市场  │ nativeplugins │
│ 版本管理          │ 自动更新         │ 手动管理      │
│ 自定义程度        │ 不可修改         │ 完全可控      │
│ 适合场景          │ 通用功能         │ 定制需求      │
│ 离线打包支持      │ 需要解压         │ 直接支持      │
└──────────────────┴──────────────────┴───────────────┘
```

---

## 六、高级实战：集成第三方支付 SDK

以集成支付宝 SDK 为例，演示完整的原生插件开发流程。

### 6.1 Android 侧（引入 AAR）

**build.gradle:**

```groovy
dependencies {
    implementation files('libs/alipaysdk-15.8.11.aar')
    implementation 'com.google.code.gson:gson:2.10.1'
}
```

**AliPayPlugin.java:**

```java
public class AliPayModule extends UniModule {

    @UniJSMethod(uiThread = true)
    public void pay(String orderInfo, UniJSCallback callback) {
        // 必须在主线程调用支付宝 SDK
        final Activity activity = mUniSDKIFE.getActivity();

        Runnable payRunnable = () -> {
            PayTask alipay = new PayTask(activity);
            Map<String, String> result = alipay.payV2(orderInfo, true);

            JSONObject json = new JSONObject();
            json.put("resultStatus", result.get("resultStatus"));
            json.put("result", result.get("result"));
            json.put("memo", result.get("memo"));

            // 回到主线程回调
            activity.runOnUiThread(() -> {
                if (callback != null) {
                    callback.invoke(json);
                }
            });
        };

        // 支付宝 SDK 要求在子线程调用
        new Thread(payRunnable).start();
    }
}
```

### 6.2 iOS 侧（通过 CocoaPods）

**MyPlugin.podspec:**

```ruby
Pod::Spec.new do |s|
  s.name         = "MyPlugin"
  s.version      = "1.0.0"
  s.summary      = "AliPay plugin for uni-app"
  s.dependency "AlipaySDK-iOS", "~> 15.8"
end
```

**iOS 支付调用：**

```objc
- (void)pay:(NSString *)orderInfo
    callback:(UniModuleKeepAliveCallback)callback {

    [[AlipayService defaultService] payOrder:orderInfo
                                  fromScheme:@"yourscheme"
                                    callback:^(NSDictionary *result) {
        NSDictionary *response = @{
            @"resultStatus": result[@"resultStatus"] ?: @"",
            @"result": result[@"result"] ?: @"",
            @"memo": result[@"memo"] ?: @""
        };
        callback(response, NO);
    }];
}
```

### 6.3 处理 iOS URL Scheme 回调

```objc
// AppDelegate.m 中添加
- (BOOL)application:(UIApplication *)app
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {

    // 支付宝回调处理
    if ([url.host isEqualToString:@"safepay"]) {
        [[AlipayService defaultService] processOrderWithPaymentResult:url
            standbyCallback:^(NSDictionary *result) {
            // 通知插件支付结果
        }];
    }

    return YES;
}
```

---

## 七、踩坑记录汇总

### 踩坑 5：离线打包插件不生效

**现象**：云打包正常，离线打包插件方法 undefined。

**原因**：离线打包需要手动将 `.aar` / `.framework` 添加到原生工程。

```bash
# Android 离线打包步骤
# 1. 将 aar 放入 libs/
cp my-plugin.aar YourApp/app/libs/

# 2. 在 build.gradle 中添加
# implementation fileTree(dir: 'libs', include: ['*.aar'])

# 3. 在 DCloud_uniplugins.json 中注册
```

**DCloud_uniplugins.json:**

```json
{
  "nativePlugins": [
    {
      "hooksClass": "com.example.MyPlugin",
      "plugins": [
        {
          "type": "module",
          "name": "my-plugin",
          "class": "com.example.MyPlugin"
        }
      ]
    }
  ]
}
```

### 踩坑 6：Android 12+ 蓝牙权限变更

**现象**：Android 12 设备上蓝牙扫描崩溃 `SecurityException`。

**原因**：Android 12 要求 `BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT` 等新权限。

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

```java
// 运行时权限申请
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    String[] permissions = {
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_CONNECT,
        Manifest.permission.ACCESS_FINE_LOCATION
    };
    ActivityCompat.requestPermissions(activity, permissions, 1001);
}
```

### 踩坑 7：iOS Bitcode 冲突

**现象**：Archive 时报错 `ld: bitcode bundle could not be generated`。

**解决**：在 Xcode Build Settings 中关闭 Bitcode：

```
Build Settings → Enable Bitcode → NO
```

### 踩坑 8：JS 回调只能调用一次

**现象**：插件的 callback 第二次调用时不触发。

**原因**：uni-app 的默认 callback 设计为一次性调用。持续通知需使用 `keep-callback`：

```java
// Android: UniJSCallback 默认只能调一次
// 使用 UniModuleKeepAliveCallback 保持回调
@UniJSMethod(uiThread = false)
public void startMonitor(UniModuleKeepAliveCallback callback) {
    // 可以多次调用 callback
    callback.invoke(data, true); // true = keep alive
}
```

```objc
// iOS 同理
- (void)startMonitor:(UniModuleKeepAliveCallback)callback {
    callback(@{@"status": @"started"}, YES); // YES = keep alive
}
```

### 踩坑 9：Debug 与 Release 表现不一致

**现象**：HBuilderX 真机运行正常，云打包后崩溃。

**常见原因**：

1. **ProGuard 混淆**：插件类被混淆，JSBridge 找不到方法

```proguard
# proguard-rules.pro
-keep class com.example.MyPlugin { *; }
-keep class com.example.** { *; }
```

2. **SDK 版本冲突**：云打包的 SDK 版本与本地开发不一致

3. **未声明权限**：manifest.json 中漏声明权限

---

## 八、性能优化建议

### 8.1 减少 Bridge 调用频次

```javascript
// ❌ 高频调用导致 Bridge 拥堵
setInterval(() => {
  const data = myPlugin.getSensorData(); // 10ms 一次
  updateUI(data);
}, 10);

// ✅ 批量回调，降低频率
myPlugin.startSensorMonitor(100, (batchData) => {
  // 原生侧每 100ms 批量返回数据
  batchData.forEach(updateUI);
});
```

### 8.2 大数据传输优化

```javascript
// ❌ 传输大 JSON 对象
const data = myPlugin.getLargeData(); // 10MB JSON，Bridge 阻塞

// ✅ 使用文件中转
const filePath = myPlugin.saveDataToFile(); // 原生侧写入文件
const data = uni.getFileSystemManager().readFileSync(filePath, 'utf8');
// 或使用 UniPlugin 的 UniSDKEngine.getContext().getFilesDir()
```

### 8.3 线程模型选择

```java
// @UniJSMethod 参数：
// uiThread = true  → 在主线程执行（适合 UI 操作）
// uiThread = false → 在 JS 线程执行（适合数据处理）

@UniJSMethod(uiThread = false) // 数据处理不要占用主线程
public void processData(String json, UniJSCallback callback) {
    // 耗时解析在 JS 线程执行
    JSONObject parsed = JSON.parseObject(json);
    // ...
    callback.invoke(result);
}
```

---

## 九、调试技巧

### 9.1 Android 调试

```bash
# 查看原生插件日志
adb logcat | grep -E "(MyPlugin|uni-jsLog|Console)"

# 过滤 uni-app 桥接日志
adb logcat -s "uni-jsLog" "uni-app" "MyPlugin"
```

### 9.2 iOS 调试

```bash
# Xcode 控制台查看
# Filter: "MyPlugin" 或 "uni-jsLog"

# 设备日志
log stream --process YourApp --predicate 'eventMessage contains "MyPlugin"'
```

### 9.3 JS 层调试

```javascript
// 在 HBuilderX 真机调试中，console.log 会同时输出到：
// 1. HBuilderX 控制台
// 2. 浏览器 DevTools（如果连接了调试）
// 3. adb logcat / Xcode console

// 建议在插件 JS 层加一层日志
const origMethod = myPlugin.scanBluetooth;
myPlugin.scanBluetooth = function (...args) {
  console.log('[Plugin] scanBluetooth called with:', args);
  return origMethod.apply(this, args);
};
```

---

## 总结

| 场景 | 方案 | 优点 | 缺点 |
|------|------|------|------|
| 简单调用原生 API | Native.js | 零编译、快速 | 不支持自定义 UI、iOS 内存管理复杂 |
| 复杂交互/自定义 UI | 原生插件 | 功能完整、性能好 | 需要原生开发能力、打包配置复杂 |
| 第三方 SDK 集成 | 原生插件 | SDK 完整能力 | 需要处理双平台兼容 |
| 纯逻辑计算 | JS + WASM | 跨平台、高性能 | 学习成本高 |

**关键经验总结：**

1. **先查 DCloud 插件市场**：80% 的常见需求已有现成插件
2. **Native.js 先行验证**：快速验证可行性，再决定是否做原生插件
3. **iOS 内存必须手动管理**：每个 `importClass` 都要对应 `deleteObject`
4. **Android 版本适配是大坑**：API 21→33 行为差异巨大，做好版本判断
5. **离线打包一定要测**：云打包能过不代表离线打包能过
6. **Debug/Release 都要测**：ProGuard 混淆和 SDK 版本是常见差异源

---

## 十、进阶实战：Native.js 与原生 SDK 完整交互示例

### 10.1 Android 调用原生 SDK（以 Toast + SharedPreferences 为例）

```javascript
// 封装 Android SharedPreferences 读写
class AndroidStorage {
  // #ifdef APP-PLUS
  constructor() {
    const Context = plus.android.importClass('android.content.Context');
    this.activity = plus.android.runtimeMainActivity();
    this.prefs = this.activity.getSharedPreferences(
      'app_config',
      Context.MODE_PRIVATE
    );
  }

  get(key, defaultVal = '') {
    return this.prefs.getString(key, defaultVal);
  }

  set(key, value) {
    const editor = this.prefs.edit();
    editor.putString(key, value);
    editor.apply(); // 异步写入，commit() 同步但阻塞
  }

  remove(key) {
    this.prefs.edit().remove(key).apply();
  }
  // #endif
}

// 使用
const storage = new AndroidStorage();
storage.set('user_token', 'abc123');
const token = storage.get('user_token');
```

### 10.2 iOS 调用原生 SDK（以 Keychain 存取为例）

```javascript
// iOS Keychain 存储（简化版，生产建议用原生插件）
function setKeychainItem(key, value) {
  // #ifdef APP-PLUS
  const NSMutableDictionary = plus.ios.importClass('NSMutableDictionary');
  const NSData = plus.ios.importClass('NSData');
  const NSString = plus.ios.importClass('NSString');

  const query = new NSMutableDictionary();
  const kSecClass = plus.ios.importClass('kSecClass');
  const kSecClassGenericPassword = NSString.stringWithString_('genp');

  query.setValueForKey_(kSecClassGenericPassword, 'class');
  query.setValueForKey_(NSString.stringWithString_(key), 'acct');

  const valueData = NSString.stringWithString_(value)
    .dataUsingEncoding_(4); // NSUTF8StringEncoding

  query.setValueForKey_(valueData, 'v_Data');

  // 调用 SecItemAdd（需要通过 invoke 方式）
  plus.ios.invoke('Security', 'SecItemAdd', query, null);

  // 手动释放
  plus.ios.deleteObject(query);
  plus.ios.deleteObject(valueData);
  // #endif
}
```

### 10.3 跨平台 SDK 调用封装模式

```javascript
// 统一接口封装：屏蔽 Android/iOS 差异
const platformBridge = {
  // #ifdef APP-PLUS
  async scanQRCode() {
    return new Promise((resolve, reject) => {
      uni.scanCode({
        scanType: ['qrCode'],
        success: (res) => resolve(res.result),
        fail: (err) => reject(err)
      });
    });
  },

  async getDeviceInfo() {
    // uni API 能获取的优先用 uni
    return new Promise((resolve) => {
      uni.getSystemInfo({
        success: (info) => {
          resolve({
            platform: info.platform,
            model: info.model,
            system: info.system,
            // 补充原生层信息
            deviceId: this._getNativeDeviceId()
          });
        }
      });
    });
  },

  _getNativeDeviceId() {
    // #ifdef APP-PLUS-ANDROID
    const Settings = plus.android.importClass('android.provider.Settings');
    return Settings.Secure.getString(
      plus.android.runtimeMainActivity().getContentResolver(),
      Settings.Secure.ANDROID_ID
    );
    // #endif

    // #ifdef APP-PLUS-ANDROID
    const device = plus.ios.importClass('UIDevice');
    const current = device.currentDevice();
    const uuid = current.identifierForVendor().UUIDString();
    plus.ios.deleteObject(current);
    return uuid;
    // #endif
  }
  // #endif
};
```

---

## 十一、调试技巧补充

### 11.1 Native.js 调用异常定位

```javascript
// 包装 Native.js 调用，统一捕获异常
function safeNativeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (e) {
    console.error('[Native.js Error]', {
      message: e.message,
      stack: e.stack,
      // Android 特有的 Java 异常信息
      nativeStack: e.nativeException?.toString?.() || ''
    });
    return fallback;
  }
}

// 使用
const brightness = safeNativeCall(() => {
  const screen = plus.ios.importClass('UIScreen');
  const main = screen.mainScreen();
  const val = main.brightness();
  plus.ios.deleteObject(main);
  return val;
}, 0.5);
```

### 11.2 插件通信数据验证

```javascript
// 原生返回数据可能为 null/undefined，做好防御
function parsePluginResult(result) {
  if (!result) {
    console.warn('[Plugin] 返回空结果');
    return null;
  }

  // Android 可能返回 Java JSONObject，需要转换
  if (typeof result === 'object' && result.toJSONString) {
    return JSON.parse(result.toJSONString());
  }

  // iOS 可能返回 NSDictionary，直接用
  return result;
}
```

### 11.3 真机调试快速排查清单

| 现象 | 检查项 |
|------|--------|
| 插件方法 undefined | manifest.json 是否声明、插件目录名是否正确 |
| 调用无响应 | 是否在主线程（Android uiThread 参数） |
| 崩溃无日志 | 开启 ProGuard 保留规则、检查 logcat 崩溃栈 |
| 真机正常云包崩溃 | ProGuard 混淆、SDK 版本、权限声明 |
| iOS 闪退 | URL Scheme 配置、Bitcode 开关、CocoaPods 版本 |
| 回调不触发 | 检查 callback 是否一次性的（需 keep-alive） |

---

## 相关阅读

- [uni-app 自定义组件实战：跨平台原生组件封装与插件市场发布](/categories/frontend/2026-06-01-uni-app-custom-component-cross-platform-native-plugin-marketplace/)
- [uni-app 性能优化实战：首屏加载、分包加载、图片懒加载](/categories/frontend/2026-06-01-uni-app-performance-optimization-first-screen-subpackage-lazy-loading/)
- [uni-app 离线存储实战：SQLite/IndexedDB 数据同步与冲突解决](/categories/frontend/2026-06-01-uni-app-offline-storage-sqlite-indexeddb-data-sync-conflict-resolution/)
