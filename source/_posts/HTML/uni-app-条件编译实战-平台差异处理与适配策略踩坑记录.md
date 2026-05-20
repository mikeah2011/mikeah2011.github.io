---
title: uni-app 条件编译实战：平台差异处理与适配策略踩坑记录
date: 2026-05-17 06:35:34
updated: 2026-05-17 06:38:35
categories:
  - HTML
tags:
  - uni-app
  - 条件编译
  - 多端适配
  - 微信小程序
  - Vue 3
description: >
  在 uni-app 多端开发中，条件编译是处理平台差异的核心机制。本文基于奇乐MAX电商系统和 KKday B2C 项目的实战经验，深入讲解 #ifdef、#ifndef 的使用技巧、平台专属 API 差异处理、组件级条件编译、CSS 平台适配策略，以及如何用架构设计减少条件编译的维护成本。包含真实代码示例、踩坑记录和最佳实践。
---

## 前言

uni-app 号称"一套代码，多端运行"，但实际项目中你会发现，**不同平台之间的差异远比想象中大**。支付接口不同、导航栏 API 不同、文件系统 API 不同、甚至 CSS 属性的支持范围都不一样。

条件编译（Conditional Compilation）是 uni-app 解决平台差异的核心机制。它允许你在同一份代码中，针对不同平台编译出不同的产物。听起来很简单，但在 30+ 仓库的实际使用中，我们踩了无数坑。

本文将从原理到实战，系统讲解条件编译的正确用法、常见陷阱和架构优化策略。

---

## 一、条件编译基础语法

### 1.1 核心指令

uni-app 的条件编译使用特殊的注释语法，在编译阶段被处理：

```javascript
// JavaScript 中的条件编译
// #ifdef MP-WEIXIN
console.log('这段代码只在微信小程序中编译')
// #endif

// #ifdef H5
console.log('这段代码只在 H5 中编译')
// #endif

// #ifdef APP-PLUS
console.log('这段代码只在 App 中编译')
// #endif
```

### 1.2 平台标识符全表

| 标识符 | 说明 |
|--------|------|
| `H5` | Web 浏览器端 |
| `MP-WEIXIN` | 微信小程序 |
| `MP-ALIPAY` | 支付宝小程序 |
| `MP-BAIDU` | 百度小程序 |
| `MP-TOUTIAO` | 抖音小程序 |
| `APP-PLUS` | App（含 Vue 和 nvue） |
| `APP-PLUS-NVUE` 或 `APP-NVUE` | 仅 App 的 nvue 页面 |
| `MP` | 所有小程序 |
| `APP-PLUS || MP` | App 或小程序 |

### 1.3 逻辑运算符

```javascript
// OR: 满足任一条件
// #ifdef H5 || MP-WEIXIN
// 仅 H5 和微信小程序编译
// #endif

// AND: 同时满足
// #ifdef APP-PLUS && APP-NVUE
// 仅 App 的 nvue 环境
// #endif

// NOT: 排除某平台
// #ifndef MP-WEIXIN
// 除微信小程序外的所有平台
// #endif
```

---

## 二、JavaScript 中的条件编译实战

### 2.1 平台专属 API 调用

这是最常见的使用场景。不同平台的 API 差异巨大：

```javascript
// utils/platform.js

/**
 * 获取系统信息 - 平台差异封装
 * 踩坑记录：wx.getSystemInfoSync() 和 uni.getSystemInfoSync()
 * 返回的字段名不同（如 SDKVersion 在 H5 中不存在）
 */
export function getSystemInfo() {
  // #ifdef MP-WEIXIN
  const info = wx.getSystemInfoSync()
  return {
    platform: 'mp-weixin',
    sdkVersion: info.SDKVersion,      // 微信小程序独有
    version: info.version,             // 微信版本号
    brand: info.brand,
    model: info.model,
    system: info.system,
    statusBarHeight: info.statusBarHeight,
    safeArea: info.safeArea,
  }
  // #endif

  // #ifdef H5
  return {
    platform: 'h5',
    sdkVersion: null,
    version: null,
    brand: navigator.userAgent,
    model: null,
    system: navigator.platform,
    statusBarHeight: 0,
    safeArea: null,
  }
  // #endif

  // #ifdef APP-PLUS
  const info = uni.getSystemInfoSync()
  return {
    platform: 'app',
    sdkVersion: plus.runtime.version,
    version: plus.runtime.version,
    brand: info.brand,
    model: info.model,
    system: info.system,
    statusBarHeight: info.statusBarHeight,
    safeArea: info.safeArea,
  }
  // #endif
}
```

### 2.2 支付模块的条件编译

在奇乐MAX电商项目中，支付是最典型的平台差异场景：

```javascript
// services/payment.js

/**
 * 统一支付接口
 * 踩坑记录：
 * 1. 微信小程序必须使用 wx.requestPayment
 * 2. H5 端微信支付需要引入微信 JS-SDK
 * 3. App 端可以使用 uni.requestPayment 但参数格式不同
 */
export async function processPayment(orderInfo) {
  const { orderId, amount, channel } = orderInfo

  // 调用后端创建支付单
  const { data } = await uni.request({
    url: `/api/v2/payment/create`,
    method: 'POST',
    data: { orderId, amount, channel },
  })

  if (!data.success) {
    throw new Error(data.message || '创建支付单失败')
  }

  // #ifdef MP-WEIXIN
  // 微信小程序支付
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: data.payment.timeStamp,
      nonceStr: data.payment.nonceStr,
      package: data.payment.package,
      signType: data.payment.signType || 'MD5',
      paySign: data.payment.paySign,
      success: (res) => {
        resolve({ success: true, orderId })
      },
      fail: (err) => {
        // 踩坑：用户取消支付 err.errCode = 2，不能当作错误处理
        if (err.errMsg && err.errMsg.includes('cancel')) {
          resolve({ success: false, cancelled: true, orderId })
        } else {
          reject(new Error(err.errMsg || '支付失败'))
        }
      },
    })
  })
  // #endif

  // #ifdef H5
  // H5 微信支付（JSAPI）
  if (channel === 'wechat_h5') {
    // 踩坑：H5 端微信支付需要在微信浏览器内
    if (!isWechatBrowser()) {
      // 非微信浏览器，跳转 H5 支付链接
      window.location.href = data.payment.mweb_url
      return { success: true, orderId, pending: true }
    }

    // 微信浏览器内，使用 JSAPI
    return new Promise((resolve, reject) => {
      if (typeof WeixinJSBridge === 'undefined') {
        reject(new Error('微信 JS-SDK 未加载'))
        return
      }
      WeixinJSBridge.invoke('getBrandWCPayRequest', {
        appId: data.payment.appId,
        timeStamp: data.payment.timeStamp,
        nonceStr: data.payment.nonceStr,
        package: data.payment.package,
        signType: data.payment.signType,
        paySign: data.payment.paySign,
      }, (res) => {
        if (res.err_msg === 'get_brand_wcpay_request:ok') {
          resolve({ success: true, orderId })
        } else {
          resolve({ success: false, cancelled: true, orderId })
        }
      })
    })
  }

  // 支付宝 H5 支付
  if (channel === 'alipay_h5') {
    window.location.href = data.payment.payUrl
    return { success: true, orderId, pending: true }
  }
  // #endif

  // #ifdef APP-PLUS
  // App 端支付
  return new Promise((resolve, reject) => {
    uni.requestPayment({
      provider: channel === 'alipay' ? 'alipay' : 'wxpay',
      orderInfo: data.payment.orderInfo,
      success: (res) => {
        resolve({ success: true, orderId })
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '支付失败'))
      },
    })
  })
  // #endif
}
```

### 2.3 文件操作的平台差异

```javascript
// utils/file.js

/**
 * 保存文件到本地
 * 踩坑记录：
 * 1. 小程序的文件系统 API 与 H5 完全不同
 * 2. App 端有 plus.io 可用，但路径处理特殊
 * 3. H5 端只能用 Blob + URL.createObjectURL
 */
export async function saveFile(url, filename) {
  // #ifdef MP-WEIXIN
  // 小程序：先下载，再保存到相册/文件
  try {
    const downloadRes = await new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: resolve,
        fail: reject,
      })
    })

    // 踩坑：图片和非图片保存路径不同
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
      return new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: downloadRes.tempFilePath,
          success: () => resolve({ success: true }),
          fail: (err) => {
            // 踩坑：用户拒绝授权后需要引导打开设置
            if (err.errMsg.includes('deny') || err.errMsg.includes('auth')) {
              reject({ needAuth: true, message: '请授权相册访问权限' })
            } else {
              reject(new Error(err.errMsg))
            }
          },
        })
      })
    } else {
      return new Promise((resolve, reject) => {
        wx.saveFile({
          tempFilePath: downloadRes.tempFilePath,
          filePath: `${wx.env.USER_DATA_PATH}/${filename}`,
          success: () => resolve({ success: true }),
          fail: reject,
        })
      })
    }
  } catch (err) {
    throw new Error(`保存文件失败: ${err.message}`)
  }
  // #endif

  // #ifdef H5
  // H5 端：使用 Blob 下载
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
    return { success: true }
  } catch (err) {
    throw new Error(`下载文件失败: ${err.message}`)
  }
  // #endif

  // #ifdef APP-PLUS
  // App 端：使用 plus.io
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(
      `_downloads/${filename}`,
      (entry) => {
        // 文件已存在，直接返回
        resolve({ success: true, path: entry.fullPath })
      },
      () => {
        // 文件不存在，下载
        const downloadTask = plus.downloader.createDownload(
          url,
          { filename: `_downloads/${filename}` },
          (task, status) => {
            if (status === 200) {
              resolve({ success: true, path: task.filename })
            } else {
              reject(new Error('下载失败'))
            }
          }
        )
        downloadTask.start()
      }
    )
  })
  // #endif
}
```

---

## 三、模板（template）中的条件编译

### 3.1 组件级条件渲染

```vue
<template>
  <view class="container">
    <!-- 通用内容 -->
    <view class="content">
      <slot />
    </view>

    <!-- #ifdef MP-WEIXIN -->
    <!-- 微信小程序专属：使用原生导航栏更流畅 -->
    <custom-navigation-bar
      :title="pageTitle"
      :back="showBack"
      @back="handleBack"
    />
    <!-- #endif -->

    <!-- #ifdef H5 -->
    <!-- H5 端：使用自定义顶部导航 -->
    <nav-bar :title="pageTitle">
      <template #right>
        <slot name="nav-right" />
      </template>
    </nav-bar>
    <!-- #endif -->

    <!-- #ifdef APP-PLUS -->
    <!-- App 端：沉浸式状态栏 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <!-- 分享按钮：仅小程序和 App 支持 -->
    <!-- #ifdef MP-WEIXIN || APP-PLUS -->
    <button
      class="share-btn"
      open-type="share"
      @click="handleShare"
    >
      分享给好友
    </button>
    <!-- #endif -->

    <!-- H5 端的分享引导 -->
    <!-- #ifdef H5 -->
    <view v-if="showShareTip" class="share-tip">
      点击右上角分享给好友
    </view>
    <!-- #endif -->
  </view>
</template>
```

### 3.2 踩坑：条件编译不能嵌套

```vue
<!-- ❌ 错误写法：条件编译不支持嵌套 -->
<!-- #ifdef H5 -->
<div>
  <!-- #ifdef MP-WEIXIN -->   <!-- 这行会被忽略！ -->
  <view>微信</view>
  <!-- #endif -->
</div>
<!-- #endif -->

<!-- ✅ 正确写法：平铺条件编译块 -->
<!-- #ifdef H5 -->
<div>H5 内容</div>
<!-- #endif -->
<!-- #ifdef MP-WEIXIN -->
<view>微信内容</view>
<!-- #endif -->
```

---

## 四、CSS 条件编译与平台样式适配

### 4.1 基础用法

```vue
<style>
/* 通用样式 */
.container {
  padding: 20rpx;
}

/* #ifdef MP-WEIXIN */
/* 小程序专属：rpx 在小程序中表现最稳定 */
.container {
  padding-top: calc(var(--status-bar-height, 25px) + 10rpx);
}
/* #endif */

/* #ifdef H5 */
/* H5 端：使用 rem 或 vw 更合适 */
.container {
  padding-top: calc(env(safe-area-inset-top) + 10px);
}
/* #endif */

/* #ifdef APP-PLUS */
/* App 端：nvue 和 vue 的 CSS 支持差异大 */
.container {
  /* 踩坑：nvue 不支持 flex-wrap、position: fixed 等 */
  padding-top: calc(var(--status-bar-height) + 10px);
}
/* #endif */
</style>
```

### 4.2 rpx 与响应式单位的平台差异

这是前端同学最常踩的坑之一：

```vue
<style>
/*
 * 踩坑记录：rpx 在不同平台的换算逻辑不同
 *
 * 微信小程序：rpx = 屏幕宽度 / 750
 * H5：rpx 默认按 750 设计稿换算，但 1rpx 在 H5 中可能被转为 0.5px
 * App：与小程序类似，但 nvue 中需要显式设置
 *
 * 实际问题：1rpx 在某些设备上渲染为 0，导致边框消失
 */
.border-line {
  /* ❌ 问题：1rpx 在某些 iOS 设备上不显示 */
  border-bottom: 1rpx solid #eee;

  /* ✅ 推荐：使用 0.5px 或 transform 模拟 */
  border-bottom: 0.5px solid #eee;
  /* 或者 */
  position: relative;
}
.border-line::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  height: 1px;
  background: #eee;
  transform: scaleY(0.5);
}
</style>
```

### 4.3 安全区域适配

```vue
<style>
/*
 * 安全区域适配是多端开发的重灾区
 * iPhone X 之后的底部安全区域、刘海屏适配
 */

/* 底部安全区域容器 */
.safe-area-bottom {
  /* #ifdef H5 */
  padding-bottom: constant(safe-area-inset-bottom); /* iOS < 11.2 */
  padding-bottom: env(safe-area-inset-bottom);      /* iOS >= 11.2 */
  /* #endif */

  /* #ifdef APP-PLUS */
  padding-bottom: var(--safe-area-bottom);
  /* 踩坑：需要在 onReady 中动态获取 */
  /* #endif */

  /* #ifdef MP-WEIXIN */
  padding-bottom: env(safe-area-inset-bottom);
  /* #endif */
}

/* 底部固定操作栏 */
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;

  /* #ifdef H5 */
  bottom: env(safe-area-inset-bottom);
  /* #endif */
}
</style>
```

---

## 五、页面配置（pages.json）中的条件编译

### 5.1 不同平台的页面配置

```jsonc
// pages.json
{
  "pages": [
    {
      "path": "pages/index/index",
      "style": {
        "navigationBarTitleText": "首页",
        // #ifdef MP-WEIXIN
        "navigationStyle": "custom",
        "enablePullDownRefresh": true,
        "backgroundColor": "#f5f5f5"
        // #endif
        // #ifdef H5
        "navigationStyle": "default",
        "navigationBarBackgroundColor": "#ffffff"
        // #endif
        // #ifdef APP-PLUS
        "navigationStyle": "custom",
        "bounce": "none",
        "app-plus": {
          "titleNView": false,
          "bounce": "none"
        }
        // #endif
      }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "奇乐MAX",
    "navigationBarBackgroundColor": "#ffffff",
    "backgroundColor": "#f5f5f5"
    // #ifdef APP-PLUS
    ,
    "app-plus": {
      "titleNView": {
        "buttons": []
      }
    }
    // #endif
  }
}
```

**踩坑记录**：`pages.json` 中的条件编译注释格式与 JS 不同，JSON 注释会被标准 JSON 解析器报错，但 uni-app 的编译器会预处理。**切记不要用标准 JSON 校验工具检查 `pages.json`**。

---

## 六、架构优化：减少条件编译的维护成本

### 6.1 适配器模式（Adapter Pattern）

当条件编译散落在各处时，维护成本会指数级增长。推荐使用适配器模式收口：

```javascript
// adapters/index.js
// 统一的平台适配器入口

// #ifdef MP-WEIXIN
import { WeixinAdapter } from './weixin.js'
// #endif
// #ifdef H5
import { H5Adapter } from './h5.js'
// #endif
// #ifdef APP-PLUS
import { AppAdapter } from './app.js'
// #endif

export function getPlatformAdapter() {
  // #ifdef MP-WEIXIN
  return new WeixinAdapter()
  // #endif
  // #ifdef H5
  return new H5Adapter()
  // #endif
  // #ifdef APP-PLUS
  return new AppAdapter()
  // #endif
}
```

```javascript
// adapters/weixin.js
export class WeixinAdapter {
  async getSystemInfo() {
    return wx.getSystemInfoSync()
  }

  async showToast(message, icon = 'none') {
    wx.showToast({ title: message, icon })
  }

  async showModal(title, content) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        success: (res) => resolve(res.confirm),
      })
    })
  }

  async navigateTo(url) {
    uni.navigateTo({ url })
  }

  async share(options) {
    // 微信小程序分享通过 onShareAppMessage 实现
    // 这里只是触发分享面板
    return { success: true }
  }

  getStoragePath() {
    return wx.env.USER_DATA_PATH
  }
}
```

```javascript
// adapters/h5.js
export class H5Adapter {
  async getSystemInfo() {
    return {
      brand: navigator.userAgent,
      system: navigator.platform,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    }
  }

  async showToast(message) {
    // H5 端用自定义 Toast 组件
    uni.showToast({ title: message, icon: 'none', duration: 2000 })
  }

  async showModal(title, content) {
    return confirm(`${title}\n${content}`)
  }

  async navigateTo(url) {
    uni.navigateTo({ url })
  }

  async share(options) {
    if (navigator.share) {
      await navigator.share(options)
      return { success: true }
    }
    // 降级：复制链接
    await navigator.clipboard.writeText(options.url)
    return { success: true, fallback: 'copy' }
  }

  getStoragePath() {
    return null // H5 端使用 localStorage
  }
}
```

### 6.2 策略模式封装平台差异

```javascript
// strategies/upload.js

/**
 * 文件上传策略
 * 不同平台的上传 API 差异很大，用策略模式收口
 */
const uploadStrategies = {
  // #ifdef MP-WEIXIN
  'mp-weixin': {
    upload(filePath, url, formData) {
      return new Promise((resolve, reject) => {
        const uploadTask = wx.uploadFile({
          url,
          filePath,
          name: 'file',
          formData,
          success: (res) => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(res.data))
            } else {
              reject(new Error(`上传失败: ${res.statusCode}`))
            }
          },
          fail: reject,
        })

        // 踩坑：进度回调需要用 uploadTask.onProgressUpdate
        // 而不是 success 回调中的 progress
        uploadTask.onProgressUpdate((res) => {
          emitProgress(res.progress)
        })
      })
    },
  },
  // #endif

  // #ifdef H5
  'h5': {
    upload(filePath, url, formData) {
      // H5 端 filePath 是 File 对象
      const form = new FormData()
      form.append('file', filePath)
      Object.entries(formData).forEach(([key, value]) => {
        form.append(key, value)
      })

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            emitProgress(Math.round((event.loaded / event.total) * 100))
          }
        }

        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(new Error(`上传失败: ${xhr.status}`))
          }
        }

        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.send(form)
      })
    },
  },
  // #endif

  // #ifdef APP-PLUS
  'app': {
    upload(filePath, url, formData) {
      return new Promise((resolve, reject) => {
        const task = uni.uploadFile({
          url,
          filePath,
          name: 'file',
          formData,
          success: (res) => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(res.data))
            } else {
              reject(new Error(`上传失败: ${res.statusCode}`))
            }
          },
          fail: reject,
        })

        task.onProgressUpdate((res) => {
          emitProgress(res.progress)
        })
      })
    },
  },
  // #endif
}

function emitProgress(progress) {
  uni.$emit('upload-progress', progress)
}

export function getUploader() {
  // #ifdef MP-WEIXIN
  return uploadStrategies['mp-weixin']
  // #endif
  // #ifdef H5
  return uploadStrategies['h5']
  // #endif
  // #ifdef APP-PLUS
  return uploadStrategies['app']
  // #endif
}
```

---

## 七、常见踩坑总结

### 7.1 条件编译不生效

```
❌ 问题：条件编译注释被当作普通注释
✅ 原因：必须使用 // 或 /* */ 标准注释格式，不能用 <!-- --> 在 JS 中
✅ 检查：编译后查看 dist 目录中的产物，确认目标代码是否被正确包含/排除
```

### 7.2 变量作用域问题

```javascript
// ❌ 错误：条件编译块内的 let/const 变量可能影响外部作用域
let platform = 'unknown'
// #ifdef MP-WEIXIN
let platform = 'weixin'  // 重复声明会报错！
// #endif

// ✅ 正确：在条件编译前声明，内部赋值
let platform = 'unknown'
// #ifdef MP-WEIXIN
platform = 'weixin'
// #endif
```

### 7.3 import 语句的条件编译

```javascript
// ✅ 正确：import 也可以条件编译
// #ifdef MP-WEIXIN
import { wxPay } from '@/plugins/wechat-pay.js'
// #endif

// #ifdef H5
import { h5Pay } from '@/plugins/h5-pay.js'
// #endif

// 踩坑：不要在条件编译外引用条件编译内的变量
// 否则在其他平台会报 undefined
export function pay(options) {
  // #ifdef MP-WEIXIN
  return wxPay(options)
  // #endif
  // #ifdef H5
  return h5Pay(options)
  // #endif
}
```

### 7.4 第三方库的平台兼容性

```javascript
// 踩坑记录：某些 npm 包在小程序中无法使用
// 例如 axios 在小程序中不支持，需要用 uni.request

// #ifdef H5
import axios from 'axios'
const http = axios.create({ baseURL: '/api', timeout: 10000 })
// #endif

// #ifdef MP-WEIXIN || APP-PLUS
// 小程序和 App 端使用 uni.request 封装
const http = {
  get: (url, params) => uni.request({ url, data: params, method: 'GET' }),
  post: (url, data) => uni.request({ url, data, method: 'POST' }),
}
// #endif
```

---

## 八、最佳实践清单

1. **收口原则**：将条件编译集中在 `adapters/` 目录，业务代码通过适配器接口调用，避免到处散落 `#ifdef`
2. **测试策略**：每个条件编译块都要在对应平台真机测试，H5 可以用浏览器，小程序用开发者工具，App 用真机调试
3. **注释规范**：在条件编译块开头加一行注释说明为什么需要平台区分
4. **渐进适配**：先做 H5 + 微信小程序两个平台，再逐步扩展到 App 和其他小程序
5. **类型安全**：如果使用 TypeScript，给适配器定义统一的 interface，确保各平台实现一致

---

## 总结

条件编译是 uni-app 多端开发的核心能力，但也是最大的维护负担来源。**关键不是学会语法，而是建立正确的架构模式**：

- **小规模**：直接在代码中用 `#ifdef`，简单直接
- **中等规模**：按功能模块收口到 `services/` 或 `adapters/` 目录
- **大规模**：使用适配器模式 + 策略模式，业务代码零条件编译

在奇乐MAX的实践中，我们将 80% 的条件编译收口到了 5 个适配器文件中，业务页面中几乎看不到 `#ifdef`，大幅降低了维护成本。

---

*本文基于 uni-app 3.x + Vue 3 实践总结，部分 API 细节可能随版本更新变化，请以 [uni-app 官方文档](https://uniapp.dcloud.net.cn/tutorial/platform.html) 为准。*
