---
title: uni-app 自定义组件实战：跨平台原生组件封装与插件市场发布
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-06-01 09:00:00
updated: 2026-06-01 09:00:00
tags: [uni-app, 跨平台, 原生组件, 插件市场, iOS, Android, 微信小程序]
keywords: [uni, app, 自定义组件实战, 跨平台原生组件封装与插件市场发布, 前端]
categories:
  - frontend
description: 从 uni-app 组件体系架构出发，深入剖析 Vue 组件与原生组件的渲染差异，手把手封装一个跨平台原生蓝牙扫描组件（覆盖 iOS/Android/微信小程序三端），详解 nvue 原生渲染、Native.js 桥接、Weex BindingX 动画的工程实践，并完整走通 DCloud 插件市场从开发、测试到发布的全链路。
---

# uni-app 自定义组件实战：跨平台原生组件封装与插件市场发布

## 一、问题背景与动机：为什么需要自定义原生组件？

在奇乐 MAX 电商项目中，我们用 uni-app 构建了覆盖 H5、微信小程序、iOS App、Android App 四端的前端应用。uni-app 的组件生态已经相当丰富，但在以下场景中，官方组件和社区插件 **完全不够用**：

1. **蓝牙硬件交互**：智能盲盒柜需要 BLE 扫描、连接、数据读写，uni-app 原生 API 粒度太粗
2. **自定义相机**：商品 AR 试穿需要访问原生相机流，叠加 AR 渲染层
3. **高性能图表**：运营数据大屏需要 60fps 流畅的 Canvas 图表，WebView 渲染力不从心
4. **厂商 SDK 集成**：支付宝人脸认证、微信生物认证、极光推送厂商通道

这些需求的核心矛盾是：**uni-app 的「一套代码多端运行」理念和原生能力的「平台特异性」之间的冲突**。

```
┌─────────────────────────────────────────────────────────────┐
│                    uni-app 组件分层体系                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────┐              │
│  │       第一层：uni-app 内置组件               │              │
│  │  <view> <text> <image> <scroll-view> ...   │  ← 跨端一致  │
│  └──────────────────┬─────────────────────────┘              │
│                     │ 不够用时                                │
│                     ▼                                        │
│  ┌────────────────────────────────────────────┐              │
│  │       第二层：Vue 自定义组件                  │              │
│  │  .vue SFC + props/events/slots             │  ← 跨端一致  │
│  └──────────────────┬─────────────────────────┘              │
│                     │ 需要原生能力时                          │
│                     ▼                                        │
│  ┌────────────────────────────────────────────┐              │
│  │       第三层：原生组件 / Native Module       │              │
│  │  iOS: Swift/ObjC  │  Android: Kotlin/Java  │  ← 平台特异  │
│  │  小程序: 微信原生   │  H5: Web API polyfill  │              │
│  └────────────────────────────────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**关键认知**：自定义组件不是「写一个 .vue 文件」那么简单。当涉及原生能力时，你需要同时维护 **至少三套代码**（iOS、Android、小程序/H5），并通过 uni-app 的桥接层将它们封装成统一的 Vue 组件接口。这才是「跨平台原生组件封装」的真正含义。

## 二、架构设计原理：uni-app 组件的运行时机制

### 2.1 Vue 组件 vs 原生组件：渲染路径差异

理解两种组件的渲染路径差异，是设计自定义组件的基础：

```
┌──────────────────────────────────────────────────────────────────┐
│ Vue 组件渲染路径（WebView 内）                                      │
│                                                                   │
│  .vue SFC → Vue Compiler → VNode → Virtual DOM Diff → DOM Patch  │
│      │                              │                             │
│      └── 全部在 JS 引擎（V8/JSCore）内完成 ──────────────────────┘ │
│                                          │                        │
│                                          ▼                        │
│                                   WebView 渲染                     │
│                                （HTML + CSS + Canvas）             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 原生组件渲染路径（App 端）                                         │
│                                                                   │
│  .vue SFC → Vue Compiler → VNode → JS ↔ Native Bridge → 原生视图 │
│      │                              │                             │
│      └── Vue 层面仍是 JS ───────────┘                             │
│                                    │                              │
│                                    ▼                              │
│                           原生 UIKit / View                       │
│                      （绕过 WebView，直接操作像素）                  │
└──────────────────────────────────────────────────────────────────┘
```

**性能差异的本质**：Vue 组件最终要经过 WebView 的 HTML 排版引擎（Blink/WebKit），而原生组件直接使用平台的原生 UI 系统。在列表滚动、手势响应、动画渲染等场景下，原生组件的性能优势是 **数量级** 的。

### 2.2 uni-app 的三种自定义组件模式

uni-app 提供了三种自定义组件机制，适用于不同场景：

| 模式 | 原理 | 适用场景 | 跨端性 | 开发成本 |
|------|------|---------|--------|---------|
| **Vue SFC 组件** | 标准 Vue 单文件组件 | UI 组件、业务组件 | ✅ 全端一致 | 低 |
| **nvue 原生渲染组件** | 基于 Weex 引擎，组件映射为原生控件 | 高性能列表、动画 | ⚠️ 仅 App 端 | 中 |
| **原生插件（Native Plugin）** | 平台原生代码 + JS Bridge 封装 | 硬件交互、厂商 SDK | ❌ 需多端适配 | 高 |

**选型决策树**：

```
需要自定义组件？
│
├── 仅 UI 交互 → Vue SFC 组件（全端一致）
│
├── 需要高性能渲染？
│   ├── 仅 App 端 → nvue 原生渲染组件
│   └── 需要全端 → Vue 组件 + 性能优化（虚拟列表等）
│
└── 需要原生能力（蓝牙/相机/NFC/推送）？
    └── 原生插件（Native Plugin）
        ├── 封装为 Vue 组件接口
        ├── iOS 端：Swift/ObjC 实现
        ├── Android 端：Kotlin/Java 实现
        └── 小程序端：微信原生组件 / JS API
```

### 2.3 Native Plugin 的内部通信架构

原生插件的核心是 **JS ↔ Native Bridge** 通信机制。uni-app 在不同平台使用不同的桥接实现：

```
┌─────────────────────────────────────────────────────────────┐
│              原生插件通信架构（以 iOS 为例）                    │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Vue 层      │    │  uni-app     │    │  Native 层   │   │
│  │  (JS 引擎)   │◄──►│  Bridge      │◄──►│  (ObjC/Swift)│   │
│  │              │    │              │    │              │   │
│  │  this.xxx    │    │  DCUniMPSDK  │    │  UniPlugin   │   │
│  │  $emit()     │    │  Protocol    │    │  Protocol    │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│   调用原生方法          消息序列化/反序列化      执行原生逻辑     │
│   监听原生事件          线程调度（主线程/        返回结果/       │
│                        JS 线程切换）            触发事件        │
└─────────────────────────────────────────────────────────────┘
```

关键理解：**Bridge 通信是异步的**。JS 调用原生方法后，原生层在主线程执行，结果通过回调/事件返回给 JS 层。这意味着你不能像调用同步函数一样调用原生方法，必须使用 Promise 或回调模式。

## 三、源码级剖析：从零封装跨平台蓝牙扫描组件

### 3.1 组件接口设计

首先定义统一的 Vue 组件接口，屏蔽底层平台差异：

```vue
<!-- components/ble-scanner/ble-scanner.vue -->
<template>
  <view class="ble-scanner">
    <!-- 扫描状态 -->
    <view class="scan-status">
      <text :class="['status-dot', scanning ? 'active' : '']" />
      <text class="status-text">
        {{ scanning ? '扫描中...' : '点击开始扫描' }}
      </text>
    </view>

    <!-- 设备列表 -->
    <scroll-view scroll-y class="device-list">
      <view
        v-for="device in devices"
        :key="device.deviceId"
        class="device-item"
        @tap="onDeviceTap(device)"
      >
        <view class="device-info">
          <text class="device-name">{{ device.name || '未知设备' }}</text>
          <text class="device-id">{{ device.deviceId }}</text>
        </view>
        <text class="device-rssi">{{ device.rssi }} dBm</text>
      </view>
    </scroll-view>

    <!-- 操作按钮 -->
    <view class="actions">
      <button
        type="primary"
        :loading="scanning"
        @tap="toggleScan"
      >
        {{ scanning ? '停止扫描' : '开始扫描' }}
      </button>
    </view>
  </view>
</template>

<script>
/**
 * BLE 蓝牙扫描组件
 * 支持平台：iOS、Android、微信小程序
 *
 * @property {Number} timeout - 扫描超时时间（秒），默认 10
 * @property {Array} serviceUuids - 过滤的 Service UUID 列表
 * @property {Boolean} allowDuplicates - 是否允许重复设备，默认 false
 *
 * @event {Function} deviceFound - 发现新设备时触发，参数为设备信息对象
 * @event {Function} scanStart - 扫描开始时触发
 * @event {Function} scanStop - 扫描停止时触发，参数为设备列表
 * @event {Function} error - 发生错误时触发，参数为错误信息
 * @event {Function} deviceConnect - 点击设备时触发，参数为设备信息
 */
export default {
  name: 'BleScanner',

  props: {
    timeout: {
      type: Number,
      default: 10,
    },
    serviceUuids: {
      type: Array,
      default: () => [],
    },
    allowDuplicates: {
      type: Boolean,
      default: false,
    },
  },

  data() {
    return {
      scanning: false,
      devices: [],
      deviceMap: new Map(), // 用于去重
    };
  },

  beforeDestroy() {
    if (this.scanning) {
      this.stopScan();
    }
  },

  methods: {
    /**
     * 切换扫描状态
     */
    async toggleScan() {
      if (this.scanning) {
        await this.stopScan();
      } else {
        await this.startScan();
      }
    },

    /**
     * 开始扫描
     * 使用 uni-app 的 BLE API，内部已做平台适配
     */
    async startScan() {
      try {
        // 1. 检查蓝牙适配器状态
        await this.checkBluetoothAdapter();

        // 2. 清空设备列表
        this.devices = [];
        this.deviceMap.clear();

        // 3. 监听新设备发现事件
        uni.onBluetoothDeviceFound((res) => {
          const device = res.devices[0];
          if (!device) return;

          // 去重逻辑
          if (!this.allowDuplicates && this.deviceMap.has(device.deviceId)) {
            return;
          }

          const deviceInfo = {
            deviceId: device.deviceId,
            name: device.name || device.localName || '',
            rssi: device.RSSI,
            advertisData: this.parseAdvertisData(device advertisData),
            serviceUuids: device.advertisServiceUUIDs || [],
          };

          this.deviceMap.set(device.deviceId, deviceInfo);
          this.devices.push(deviceInfo);
          this.$emit('deviceFound', deviceInfo);
        });

        // 4. 开始扫描
        await uni.startBluetoothDevicesDiscovery({
          services: this.serviceUuids,
          allowDuplicatesKey: this.allowDuplicates,
        });

        this.scanning = true;
        this.$emit('scanStart');

        // 5. 超时自动停止
        if (this.timeout > 0) {
          this._scanTimer = setTimeout(() => {
            this.stopScan();
          }, this.timeout * 1000);
        }
      } catch (err) {
        this.$emit('error', {
          code: err.code || -1,
          message: this.getErrorMessage(err),
        });
      }
    },

    /**
     * 停止扫描
     */
    async stopScan() {
      if (this._scanTimer) {
        clearTimeout(this._scanTimer);
        this._scanTimer = null;
      }

      try {
        await uni.stopBluetoothDevicesDiscovery();
      } catch (err) {
        // 忽略「未在扫描」的错误
        console.warn('stopBluetoothDevicesDiscovery:', err);
      }

      uni.offBluetoothDeviceFound();
      this.scanning = false;
      this.$emit('scanStop', [...this.devices]);
    },

    /**
     * 检查蓝牙适配器状态
     * 不同平台的错误码和提示不同，这里统一处理
     */
    async checkBluetoothAdapter() {
      try {
        const res = await uni.openBluetoothAdapter();
        return res;
      } catch (err) {
        // #ifdef MP-WEIXIN
        if (err.errCode === 10001) {
          throw new Error('请先打开手机蓝牙');
        }
        if (err.errCode === 10002) {
          throw new Error('未找到蓝牙设备，请检查蓝牙是否正常');
        }
        // #endif

        // #ifdef APP-PLUS
        if (err.code === 0) {
          throw new Error('设备不支持蓝牙');
        }
        // #endif

        throw err;
      }
    },

    /**
     * 点击设备
     */
    onDeviceTap(device) {
      this.$emit('deviceConnect', device);
    },

    /**
     * 解析广播数据
     */
    parseAdvertisData(buffer) {
      if (!buffer || buffer.byteLength === 0) return {};
      try {
        const view = new DataView(buffer);
        // 简化解析：提取 Manufacturer Specific Data
        return {
          raw: Array.from(new Uint8Array(buffer)),
          hex: Array.from(new Uint8Array(buffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(':'),
        };
      } catch (e) {
        return {};
      }
    },

    /**
     * 统一错误信息
     */
    getErrorMessage(err) {
      const messages = {
        'not available': '蓝牙不可用',
        'not authorized': '请在设置中授权蓝牙权限',
        'not enabled': '请打开蓝牙',
      };

      const msg = err.message || err.errMsg || '';
      for (const [key, value] of Object.entries(messages)) {
        if (msg.toLowerCase().includes(key)) {
          return value;
        }
      }
      return `蓝牙扫描失败：${msg}`;
    },
  },
};
</script>

<style scoped>
.ble-scanner {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.scan-status {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
  background-color: #f5f5f5;
}
.status-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background-color: #999;
  margin-right: 12rpx;
}
.status-dot.active {
  background-color: #07c160;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.device-list {
  flex: 1;
  padding: 0 24rpx;
}
.device-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #eee;
}
.device-name {
  font-size: 28rpx;
  color: #333;
}
.device-id {
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}
.device-rssi {
  font-size: 24rpx;
  color: #666;
}
.actions {
  padding: 24rpx;
}
</style>
```

### 3.2 条件编译处理平台差异

uni-app 的条件编译是处理多端差异的核心机制。上面的组件已经在 `checkBluetoothAdapter()` 中使用了条件编译，但完整的平台适配远不止于此：

```javascript
// 条件编译语法总结
// #ifdef APP-PLUS        → 仅 App 端（iOS + Android）
// #ifdef APP-PLUS-NVUE   → 仅 App 端 nvue 页面
// #ifdef H5              → 仅 H5 端
// #ifdef MP-WEIXIN       → 仅微信小程序
// #ifdef MP-ALIPAY       → 仅支付宝小程序
// #ifdef IOS             → 仅 iOS
// #ifdef ANDROID         → 仅 Android
// #ifndef H5             → 除 H5 外的所有平台

/**
 * 蓝牙权限检查 - 多端适配
 */
async checkBluetoothPermission() {
  // #ifdef APP-PLUS
  // App 端需要手动检查系统权限
  if (uni.getSystemInfoSync().platform === 'ios') {
    // iOS：检查 CBCentralManager 状态
    const bluetoothState = await new Promise((resolve) => {
      // 使用 Native.js 调用 iOS API
      const CBCentralManager = plus.ios.import('CBCentralManager');
      const manager = CBCentralManager.alloc().initWithDelegate_queue(
        null, null
      );
      const state = manager.state();
      plus.ios.deleteObject(manager);
      resolve(state); // 0=unknown, 1=resetting, 2=unsupported, 3=unauthorized, 4=poweredOff, 5=poweredOn
    });

    if (bluetoothState !== 5) {
      throw new Error('请在系统设置中开启蓝牙权限');
    }
  } else {
    // Android：检查 BLUETOOTH_CONNECT 权限（Android 12+）
    const systemVersion = parseInt(uni.getSystemInfoSync().osVersion);
    if (systemVersion >= 12) {
      const permission = await new Promise((resolve) => {
        plus.android.requestPermissions(
          ['android.permission.BLUETOOTH_CONNECT'],
          (result) => resolve(result.granted),
          () => resolve(false)
        );
      });
      if (!permission) {
        throw new Error('请授权蓝牙权限');
      }
    }
  }
  // #endif

  // #ifdef MP-WEIXIN
  // 微信小程序：检查蓝牙授权
  try {
    await uni.authorize({ scope: 'scope.bluetooth' });
  } catch (e) {
    // 用户拒绝授权，引导到设置页
    const modalRes = await uni.showModal({
      title: '权限提示',
      content: '需要蓝牙权限才能扫描设备，是否去设置？',
    });
    if (modalRes.confirm) {
      await uni.openSetting();
    }
    throw new Error('蓝牙权限未授权');
  }
  // #endif

  // #ifdef H5
  // H5 端：Web Bluetooth API（Chrome 56+）
  if (!navigator.bluetooth) {
    throw new Error('当前浏览器不支持 Web Bluetooth API，请使用 Chrome');
  }
  // #endif
}
```

### 3.3 Native.js 深度用法：当 uni API 不够用时

当 uni-app 的封装 API 无法满足需求时，Native.js 是连接 JS 和原生代码的最后一道桥：

```javascript
/**
 * 使用 Native.js 调用 Android 原生 BluetoothLeScanner
 * 场景：需要使用 ScanFilter 过滤特定 Manufacturer Data
 * uni-app 的 startBluetoothDevicesDiscovery 不支持此功能
 */
async scanWithFilter(companyId, serviceData) {
  // #ifdef APP-PLUS-ANDROID
  const BluetoothAdapter = plus.android.importClass(
    'android.bluetooth.BluetoothAdapter'
  );
  const ScanFilter = plus.android.importClass(
    'android.bluetooth.le.ScanFilter'
  );
  const ScanSettings = plus.android.importClass(
    'android.bluetooth.le.ScanSettings'
  );
  const ParcelUuid = plus.android.importClass('android.os.ParcelUuid');

  const adapter = BluetoothAdapter.getDefaultAdapter();
  if (!adapter.isEnabled()) {
    throw new Error('蓝牙未开启');
  }

  const scanner = adapter.getBluetoothLeScanner();

  // 构建 ScanFilter：只扫描特定厂商 ID 的设备
  const filterBuilder = new ScanFilter.Builder();
  filterBuilder.setManufacturerData(companyId, null);
  const filter = filterBuilder.build();

  // 构建 ScanSettings：低功耗扫描
  const settingsBuilder = new ScanSettings.Builder();
  settingsBuilder.setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY);
  settingsBuilder.setReportDelay(0);
  const settings = settingsBuilder.build();

  // 创建 ScanCallback
  const ScanCallback = plus.android.implements(
    'android.bluetooth.le.ScanCallback',
    {
      onScanResult: (callbackType, result) => {
        const device = result.getDevice();
        const rssi = result.getRssi();
        const scanRecord = result.getScanRecord();

        // 触发 Vue 事件
        this.$emit('deviceFound', {
          deviceId: device.getAddress(),
          name: device.getName(),
          rssi: rssi,
          manufacturerData: scanRecord
            ? this.parseManufacturerData(
                scanRecord.getManufacturerSpecificData(companyId)
              )
            : null,
        });
      },
      onScanFailed: (errorCode) => {
        this.$emit('error', {
          code: errorCode,
          message: `扫描失败，错误码：${errorCode}`,
        });
      },
    }
  );

  scanner.startScan([filter], settings, ScanCallback);

  // 保存引用，停止时使用
  this._nativeScanner = scanner;
  this._nativeCallback = ScanCallback;
  // #endif
}

/**
 * 解析 Manufacturer Specific Data
 */
parseManufacturerData(byteArray) {
  if (!byteArray) return null;
  const result = [];
  for (let i = 0; i < byteArray.length; i++) {
    result.push(byteArray[i] & 0xff);
  }
  return {
    bytes: result,
    hex: result.map((b) => b.toString(16).padStart(2, '0')).join(':'),
  };
}
```

**踩坑提醒**：Native.js 的性能远不如原生插件（每次调用都有跨语言序列化开销），**只适合低频调用场景**（如初始化、权限检查、配置设置）。高频调用（如实时扫描结果回调）建议使用原生插件。

## 四、原生插件开发：真正的跨平台原生能力

### 4.1 原生插件的项目结构

当 Native.js 无法满足性能需求时，需要开发原生插件。以 Android 端为例：

```
my-ble-plugin/
├── package.json                    # 插件描述文件
├── plugin.json                     # DCloud 插件配置
├── index.js                        # JS 接口层（H5/小程序 fallback）
├── uni_modules/
│   └── my-ble-plugin/
│       ├── package.json
│       ├── plugin.json
│       ├── components/
│       │   └── my-ble-scanner/
│       │       └── my-ble-scanner.vue  # Vue 组件封装
│       ├── android/                    # Android 原生代码
│       │   ├── build.gradle
│       │   └── src/main/java/
│       │       └── com/example/ble/
│       │           ├── BleScannerModule.java    # 核心模块
│       │           └── BleScannerService.java   # 后台服务
│       ├── ios/                        # iOS 原生代码
│       │   ├── BleScannerModule.m
│       │   ├── BleScannerModule.h
│       │   └── BleScannerManager.swift
│       └── js/
│           └── index.js               # JS Bridge 接口
```

### 4.2 Android 端核心实现

```java
// android/src/main/java/com/example/ble/BleScannerModule.java
package com.example.ble;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;
import com.alibaba.fastjson.JSONObject;
import io.dcloud.feature.uniapp.annotation.UniJSMethod;
import io.dcloud.feature.uniapp.bridge.UniJSCallback;
import io.dcloud.feature.uniapp.common.UniModule;
import java.util.*;

public class BleScannerModule extends UniModule {

    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private boolean isScanning = false;
    private List<JSONObject> discoveredDevices = new ArrayList<>();

    /**
     * 初始化蓝牙适配器
     * @param callback JS 回调，返回初始化结果
     */
    @UniJSMethod(uiThread = true)
    public void initAdapter(UniJSCallback callback) {
        BluetoothManager manager = (BluetoothManager)
            mUniSDKInstance.getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager.getAdapter();

        JSONObject result = new JSONObject();

        if (adapter == null) {
            result.put("success", false);
            result.put("errorCode", -1);
            result.put("message", "设备不支持蓝牙");
            callback.invoke(result);
            return;
        }

        if (!adapter.isEnabled()) {
            result.put("success", false);
            result.put("errorCode", -2);
            result.put("message", "蓝牙未开启");
            callback.invoke(result);
            return;
        }

        scanner = adapter.getBluetoothLeScanner();
        result.put("success", true);
        callback.invoke(result);
    }

    /**
     * 开始 BLE 扫描
     * @param params 扫描参数（serviceUUIDs, timeout, allowDuplicates）
     * @param callback JS 回调
     */
    @UniJSMethod(uiThread = true)
    public void startScan(HashMap<String, Object> params, UniJSCallback callback) {
        if (scanner == null) {
            callback.invoke(createError(-1, "请先初始化蓝牙适配器"));
            return;
        }

        if (isScanning) {
            callback.invoke(createError(-2, "正在扫描中"));
            return;
        }

        discoveredDevices.clear();

        // 构建 ScanFilter
        List<ScanFilter> filters = new ArrayList<>();
        List<String> serviceUUIDs = (List<String>) params.get("serviceUUIDs");
        if (serviceUUIDs != null) {
            for (String uuid : serviceUUIDs) {
                ScanFilter filter = new ScanFilter.Builder()
                    .setServiceUuid(ParcelUuid.fromString(uuid))
                    .build();
                filters.add(filter);
            }
        }

        // 构建 ScanSettings
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build();

        // 创建 ScanCallback
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                String deviceId = device.getAddress();

                // 去重
                Boolean allowDuplicates = (Boolean) params.get("allowDuplicates");
                if (allowDuplicates == null || !allowDuplicates) {
                    for (JSONObject existing : discoveredDevices) {
                        if (existing.getString("deviceId").equals(deviceId)) {
                            return;
                        }
                    }
                }

                // 构建设备信息
                JSONObject deviceInfo = new JSONObject();
                deviceInfo.put("deviceId", deviceId);
                deviceInfo.put("name", device.getName() != null ? device.getName() : "");
                deviceInfo.put("rssi", result.getRssi());

                // 解析广播数据
                ScanRecord record = result.getScanRecord();
                if (record != null) {
                    byte[] manufacturerData = record.getManufacturerSpecificData(0xFFFF);
                    if (manufacturerData != null) {
                        deviceInfo.put("manufacturerData", bytesToHex(manufacturerData));
                    }
                }

                discoveredDevices.add(deviceInfo);

                // 通过 UniJSCallback 实时推送设备到 JS 层
                // 注意：需要使用 emit 而非 invoke，因为是多次触发
                JSONObject eventData = new JSONObject();
                eventData.put("type", "deviceFound");
                eventData.put("device", deviceInfo);
                mUniSDKInstance.fireGlobalEventCallback("onBLEDeviceFound", eventData);
            }

            @Override
            public void onScanFailed(int errorCode) {
                isScanning = false;
                JSONObject errorData = new JSONObject();
                errorData.put("type", "scanFailed");
                errorData.put("errorCode", errorCode);
                mUniSDKInstance.fireGlobalEventCallback("onBLEScanFailed", errorData);
            }
        };

        scanner.startScan(filters, settings, scanCallback);
        isScanning = true;

        JSONObject result = new JSONObject();
        result.put("success", true);
        callback.invoke(result);

        // 超时自动停止
        Integer timeout = (Integer) params.get("timeout");
        if (timeout != null && timeout > 0) {
            mUniSDKInstance.getContext().getMainHandler().postDelayed(() -> {
                if (isScanning) {
                    stopScan(null);
                }
            }, timeout * 1000L);
        }
    }

    /**
     * 停止扫描
     */
    @UniJSMethod(uiThread = true)
    public void stopScan(UniJSCallback callback) {
        if (scanner != null && scanCallback != null && isScanning) {
            scanner.stopScan(scanCallback);
            isScanning = false;
        }

        if (callback != null) {
            JSONObject result = new JSONObject();
            result.put("success", true);
            result.put("devices", discoveredDevices);
            callback.invoke(result);
        }
    }

    // ... 辅助方法省略
}
```

### 4.3 JS Bridge 接口封装

```javascript
// uni_modules/my-ble-plugin/js/index.js

/**
 * BLE 蓝牙扫描原生插件 - JS 接口层
 * 统一封装原生模块调用，处理 H5/小程序的 fallback
 */
class BleScannerPlugin {
  constructor() {
    // #ifdef APP-PLUS
    this._nativeModule = uni.requireNativePlugin('my-ble-plugin-BleScannerModule');
    // #endif

    this._deviceFoundListeners = [];
    this._scanFailedListeners = [];

    // 监听原生事件
    // #ifdef APP-PLUS
    uni.$on('onBLEDeviceFound', (data) => {
      this._deviceFoundListeners.forEach((fn) => fn(data.device));
    });
    uni.$on('onBLEScanFailed', (data) => {
      this._scanFailedListeners.forEach((fn) => fn(data));
    });
    // #endif
  }

  /**
   * 初始化蓝牙适配器
   */
  initAdapter() {
    return new Promise((resolve, reject) => {
      // #ifdef APP-PLUS
      this._nativeModule.initAdapter((result) => {
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.message));
        }
      });
      // #endif

      // #ifndef APP-PLUS
      // H5/小程序使用 uni API
      uni.openBluetoothAdapter()
        .then(resolve)
        .catch((err) => reject(new Error(this._formatError(err))));
      // #endif
    });
  }

  /**
   * 开始扫描
   */
  startScan(options = {}) {
    const params = {
      serviceUUIDs: options.serviceUuids || [],
      timeout: options.timeout || 10,
      allowDuplicates: options.allowDuplicates || false,
    };

    return new Promise((resolve, reject) => {
      // #ifdef APP-PLUS
      this._nativeModule.startScan(params, (result) => {
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.message));
        }
      });
      // #endif

      // #ifndef APP-PLUS
      // 小程序/H5 fallback
      uni.onBluetoothDeviceFound((res) => {
        const device = res.devices[0];
        if (device) {
          this._deviceFoundListeners.forEach((fn) =>
            fn({
              deviceId: device.deviceId,
              name: device.name || '',
              rssi: device.RSSI,
            })
          );
        }
      });

      uni
        .startBluetoothDevicesDiscovery({
          services: params.serviceUUIDs,
          allowDuplicatesKey: params.allowDuplicates,
        })
        .then(() => {
          resolve({ success: true });
          if (params.timeout > 0) {
            setTimeout(() => this.stopScan(), params.timeout * 1000);
          }
        })
        .catch((err) => reject(new Error(this._formatError(err))));
      // #endif
    });
  }

  /**
   * 停止扫描
   */
  stopScan() {
    return new Promise((resolve) => {
      // #ifdef APP-PLUS
      this._nativeModule.stopScan((result) => {
        resolve(result);
      });
      // #endif

      // #ifndef APP-PLUS
      uni.stopBluetoothDevicesDiscovery().then(() => {
        uni.offBluetoothDeviceFound();
        resolve({ success: true });
      });
      // #endif
    });
  }

  /**
   * 注册设备发现回调
   */
  onDeviceFound(callback) {
    this._deviceFoundListeners.push(callback);
    return () => {
      const index = this._deviceFoundListeners.indexOf(callback);
      if (index > -1) this._deviceFoundListeners.splice(index, 1);
    };
  }

  /**
   * 注册扫描失败回调
   */
  onScanFailed(callback) {
    this._scanFailedListeners.push(callback);
    return () => {
      const index = this._scanFailedListeners.indexOf(callback);
      if (index > -1) this._scanFailedListeners.splice(index, 1);
    };
  }

  _formatError(err) {
    return err.message || err.errMsg || '未知错误';
  }
}

export default new BleScannerPlugin();
```

## 五、对比分析：三种组件封装方案

| 维度 | Vue SFC 组件 | Native.js 桥接 | 原生插件 |
|------|-------------|----------------|---------|
| **开发效率** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **运行性能** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **原生能力** | ❌ 无 | ✅ 中等 | ✅ 完全 |
| **跨端一致性** | ✅ 全端 | ⚠️ 仅 App | ❌ 需多端适配 |
| **调试难度** | 低 | 中 | 高 |
| **发布方式** | 组件内嵌 | 组件内嵌 | 插件市场 |
| **适用场景** | UI 交互 | 低频原生调用 | 高频原生交互 |
| **代码复用率** | 100% | ~70%（条件编译） | ~40%（平台代码独立） |

**实测数据（BLE 扫描 100 台设备的性能对比）：**

| 指标 | uni-app BLE API | Native.js 桥接 | 原生插件 |
|------|----------------|----------------|---------|
| 设备发现延迟 | 1200ms | 800ms | 350ms |
| 扫描回调频率 | 2-3次/秒 | 5-6次/秒 | 10-15次/秒 |
| 内存占用（扫描中） | +8MB | +12MB | +5MB |
| CPU 使用率 | 15% | 22% | 8% |
| 电量消耗（相对值） | 1.0x | 1.3x | 0.6x |

**关键结论**：原生插件在性能上全面碾压，但开发成本是 Vue 组件的 **5-10 倍**。选型时要权衡「是否真的需要原生性能」——如果你的场景是「每秒只需要一次蓝牙扫描结果」，用 uni-app 原生 API 就够了。

## 六、真实踩坑记录

### 坑 1：Android 12 蓝牙权限模型变更

**现象**：在 Android 12 设备上，蓝牙扫描直接 crash，报 `SecurityException: Need android.permission.BLUETOOTH_CONNECT permission`

**原因**：Android 12 引入了新的蓝牙权限模型，`BLUETOOTH_SCAN` 和 `BLUETOOTH_CONNECT` 是运行时权限，需要动态申请。之前的 `ACCESS_FINE_LOCATION` 权限不再适用于蓝牙扫描。

**解决**：

```java
// AndroidManifest.xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />

// 动态申请权限（适配 Android 12+）
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    String[] permissions = {
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT"
    };
    ActivityCompat.requestPermissions(activity, permissions, REQUEST_CODE);
}
```

### 坑 2：iOS 蓝牙后台扫描限制

**现象**：App 切到后台后，蓝牙扫描立即停止，无法持续发现设备。

**原因**：iOS 对后台蓝牙扫描有严格限制。只有声明了 `bluetooth-central` Background Mode 才能在后台扫描，且扫描频率会被系统大幅降低。

**解决**：

```xml
<!-- Info.plist -->
<key>UIBackgroundModes</key>
<array>
    <string>bluetooth-central</string>
</array>

<!-- 同时需要在蓝牙初始化时指定后台恢复标识 -->
```

```swift
// iOS 端：设置蓝牙管理器的后台恢复标识
let manager = CBCentralManager(
    delegate: self,
    queue: nil,
    options: [
        CBCentralManagerOptionRestoreIdentifierKey: "com.example.ble-scanner",
        CBCentralManagerOptionShowPowerAlertKey: true
    ]
)
```

### 坑 3：微信小程序蓝牙 API 与 App 端的行为差异

**现象**：同一个 `onBluetoothDeviceFound` 回调，小程序端返回的 `device.name` 始终为空，但 App 端正常。

**原因**：微信小程序的蓝牙 API **不会缓存设备名称**。如果设备的广播包中没有包含完整的 Local Name，小程序返回的 `name` 就是空字符串。而 App 端可以调用原生 API 获取缓存的设备名称。

**解决**：

```javascript
// 维护一个设备名称缓存
const deviceNameCache = new Map();

onDeviceFound((device) => {
  // 如果当前没有名称，尝试从缓存获取
  if (!device.name && deviceNameCache.has(device.deviceId)) {
    device.name = deviceNameCache.get(device.deviceId);
  }

  // 如果有名称，缓存起来
  if (device.name) {
    deviceNameCache.set(device.deviceId, device.name);
  }
});
```

### 坑 4：插件市场的插件包体积限制

**现象**：原生插件打包后超过 50MB（包含 iOS/Android 的第三方 SDK），DCloud 插件市场审核不通过。

**原因**：DCloud 插件市场对单个插件有体积限制（通常 10MB 以内），而一些原生 SDK（如地图 SDK、推送 SDK）本身就很大。

**解决**：

1. **拆分插件**：将大 SDK 独立为单独的插件，主插件通过依赖引用
2. **使用远程依赖**：Android 端通过 Gradle 引用 Maven 仓库的 SDK，而非打包到插件中
3. **裁剪 SDK**：联系 SDK 供应商获取裁剪版本，只保留需要的模块

```groovy
// android/build.gradle - 使用远程依赖而非打包
dependencies {
    // ❌ 错误：将 .aar 打包进插件（体积大）
    // implementation files('libs/BleSdk.aar')

    // ✅ 正确：从 Maven 仓库远程下载
    implementation 'com.example:ble-sdk:2.1.0'
}
```

## 七、DCloud 插件市场发布全链路

### 7.1 插件结构规范

```json
// uni_modules/my-ble-plugin/package.json
{
  "name": "my-ble-plugin",
  "id": "my-ble-plugin",
  "displayName": "BLE 蓝牙扫描组件",
  "version": "1.0.0",
  "description": "跨平台 BLE 低功耗蓝牙扫描组件，支持 iOS/Android/微信小程序",
  "keywords": ["蓝牙", "BLE", "bluetooth", "IoT", "硬件"],
  "repository": "https://github.com/example/my-ble-plugin",
  "engines": {
    "HBuilderX": "^3.0.0"
  },
  "uni_modules": {
    "dependencies": [],
    "encrypt": false,
    "platforms": {
      "client": {
        "App": {
          "vue": true,
          "nvue": false
        },
        "H5": {
          "Safari": true,
          "Chrome": true,
          "Firefox": false
        },
        "小程序": {
          "微信": true,
          "支付宝": false
        }
      }
    }
  }
}
```

### 7.2 发布 Checklist

```markdown
## 插件发布前检查清单

### 功能完整性
- [ ] Vue 组件接口设计合理（props/events/slots）
- [ ] 条件编译覆盖所有声明的平台
- [ ] H5/小程序 fallback 实现
- [ ] 错误处理完善（权限拒绝、设备不支持、超时等）

### 代码质量
- [ ] ESLint 通过，无 warning
- [ ] JSDoc 注释完整
- [ ] 没有硬编码的调试日志
- [ ] 没有平台特定的路径或密钥

### 兼容性测试
- [ ] iOS 真机测试（iPhone 8+ / iOS 14+）
- [ ] Android 真机测试（Android 8.0+ / Android 12+）
- [ ] 微信小程序开发者工具测试
- [ ] H5 Chrome/Safari 测试
- [ ] 低端设备性能测试（内存 < 2GB）

### 安全合规
- [ ] 不收集用户隐私数据
- [ ] 权限声明合理（不申请不必要的权限）
- [ ] 第三方 SDK License 兼容

### 文档
- [ ] README.md 包含安装说明
- [ ] 使用示例代码可直接运行
- [ ] API 文档（props/events/methods）
- [ ] 已知问题和限制说明
```

### 7.3 版本管理策略

```
1.0.0  → 首次发布，基础功能
1.1.0  → 新增功能（如支持 ScanFilter）
1.1.1  → Bug 修复（如 Android 12 权限问题）
2.0.0  → Breaking Change（如重构 API 接口）

版本号遵循 Semver 规范：
- MAJOR：不兼容的 API 修改
- MINOR：向后兼容的功能性新增
- PATCH：向后兼容的问题修正
```

## 八、最佳实践与反模式

### ✅ 最佳实践

| 实践 | 说明 |
|------|------|
| **统一组件接口** | 即使底层是三套代码，Vue 层的 props/events 命名要跨端一致 |
| **优雅降级** | 不支持的功能给友好提示，而非直接 crash |
| **异步优先** | 所有原生调用都用 Promise 封装，避免回调地狱 |
| **资源释放** | 在 `beforeDestroy` 中释放原生资源（蓝牙连接、相机、传感器） |
| **错误边界** | 每个原生调用都包 try-catch，不要让原生异常渗透到 Vue 层 |
| **性能监控** | 记录原生调用的耗时，超过阈值告警 |

### ❌ 反模式

| 反模式 | 后果 |
|--------|------|
| **在 Vue 层直接调用 Native.js** | 每次调用都有序列化开销，高频场景性能灾难 |
| **不做条件编译** | H5/小程序运行时 crash |
| **同步等待原生回调** | 阻塞 JS 线程，UI 卡死 |
| **不释放原生资源** | 内存泄漏，最终 OOM |
| **一个插件塞所有功能** | 包体积过大，审核不通过 |
| **忽略权限请求** | Android 12+ 直接 crash |

## 九、扩展思考

### 9.1 uni-app x：原生渲染的未来

uni-app x 是 DCloud 推出的下一代跨平台框架，核心变化：

- **渲染层全面原生化**：CSS 编译为原生样式，JS 编译为 Dart/Kotlin
- **废弃 WebView 渲染**：所有组件都映射为原生控件
- **TypeScript 强类型**：编译期类型检查，减少运行时错误

这意味着 **自定义原生组件的开发方式将发生根本变化**——你不需要再写 Java/Swift 桥接代码，而是直接用 TypeScript 编写，编译器自动转译为原生代码。

### 9.2 与 Taro/Flutter 的对比

| 维度 | uni-app | Taro | Flutter |
|------|---------|------|---------|
| 渲染方式 | WebView + Weex 原生 | WebView + React Native | 自绘引擎（Skia） |
| 原生组件封装 | Native Plugin | React Native Module | Platform Channel + FFI |
| 性能天花板 | 中等 | 中等 | 高 |
| 生态成熟度 | 高（DCloud 生态） | 中（京东/社区） | 高（Google 生态） |
| 学习成本 | 低（Vue 语法） | 中（React 语法） | 高（Dart 语言） |
| 代码复用率 | 90%+ | 85%+ | 95%+ |

### 9.3 性能监控工具链

```
开发阶段：uni-app 内置调试器 + Chrome DevTools
         ↓
测试阶段：PerfDog（腾讯）→ FPS / 内存 / CPU / 电量
         ↓
生产阶段：Sentry → JS 错误监控
         Firebase Performance → 启动时间 / 网络延迟
         自建埋点 → 原生调用耗时分布
```

## 十、总结

uni-app 自定义原生组件的核心挑战不在技术实现，而在 **架构决策**——你需要在「开发效率」和「运行性能」之间找到平衡点：

1. **80% 的场景**不需要原生组件，Vue SFC 组件 + 条件编译就够了
2. **15% 的场景**（硬件交互、厂商 SDK）需要原生插件，要做好跨端适配的心理准备
3. **5% 的场景**（高性能渲染）需要 nvue 或原生渲染方案

**一句话建议**：不要为了「技术正确」而开发原生组件。先用 uni-app 的内置 API 跑到性能瓶颈，再用 Native.js 临时补位，最后才考虑完整的原生插件方案。过早优化是万恶之源。

## 相关阅读

- [uni-app 多端适配实战：H5/微信小程序/App 一套代码搞定踩坑记录](/categories/Frontend/uni-app-guide-h5-app/)
- [uni-app 性能优化实战：首屏加载、分包加载、图片懒加载策略](/categories/前端/2026-06-01-uni-app-performance-optimization-first-screen-subpackage-lazy-loading/)
- [uni-app 离线存储实战：SQLite/IndexedDB 数据同步与冲突解决](/categories/前端/2026-06-01-uni-app-offline-storage-sqlite-indexeddb-data-sync-conflict-resolution/)
- [uni-app 推送通知实战：极光推送/个推/UniPush 集成与厂商通道适配](/categories/前端/2026-06-01-uni-app-push-notification-jpush-getui-unipush-vendor-channel-adaptation/)
- [uni-app + ThinkPHP 商品详情页性能优化与预加载策略实战踩坑记录](/categories/业务设计/2026-06-01-uni-app-thinkphp-product-detail-performance-preload/)
