
title: uni-app 条件编译实战：平台差异处理与适配策略踩坑记录
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 06:35:34
updated: 2026-05-17 06:38:35
categories:
  - frontend
tags:
- Vue
- uni-app
- 跨平台
- 条件编译
- 前端开发
description: 'uni-app 跨平台开发中，条件编译是处理微信小程序、App、H5 等多端差异的核心机制。本文基于 Vue 3 + uni-app 实战经验，深入讲解 #ifdef 条件编译语法、平台专属 API 差异处理（支付/文件/导航）、组件级与 CSS 平台适配策略，以及用适配器模式减少维护成本的架构设计。附真实代码示例与踩坑记录，适合跨平台开发者进阶。'
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

## 七、网络请求的跨平台封装

### 7.1 统一请求拦截器

网络请求是跨平台差异最大的领域之一。不同平台的请求库、拦截器机制、cookie 处理完全不同：

```javascript
// utils/request.js
// 统一的请求封装，处理平台差异

const BASE_URL = 'https://api.example.com'
const TIMEOUT = 15000

// 请求拦截器
function interceptRequest(config) {
  // 添加 token
  const token = uni.getStorageSync('access_token')
  if (token) {
    config.header = config.header || {}
    config.header['Authorization'] = `Bearer ${token}`
  }

  // 添加平台标识
  // #ifdef MP-WEIXIN
  config.header['X-Platform'] = 'mp-weixin'
  // #endif
  // #ifdef H5
  config.header['X-Platform'] = 'h5'
  // #endif
  // #ifdef APP-PLUS
  config.header['X-Platform'] = 'app'
  // #endif

  return config
}

// 响应拦截器
function interceptResponse(response) {
  const { statusCode, data } = response

  // 401 未授权
  if (statusCode === 401) {
    uni.removeStorageSync('access_token')
    uni.navigateTo({ url: '/pages/login/index' })
    return Promise.reject(new Error('未授权，请重新登录'))
  }

  // 业务错误
  if (data.code !== 0 && data.code !== 200) {
    return Promise.reject(new Error(data.message || '请求失败'))
  }

  return data
}

// 核心请求函数
export function request(options) {
  const config = interceptRequest({
    url: `${BASE_URL}${options.url}`,
    method: options.method || 'GET',
    data: options.data,
    header: options.header,
    timeout: TIMEOUT,
  })

  return new Promise((resolve, reject) => {
    uni.request({
      ...config,
      success: (res) => {
        try {
          const result = interceptResponse(res)
          resolve(result)
        } catch (err) {
          reject(err)
        }
      },
      fail: (err) => {
        // 踩坑：小程序网络超时的错误信息与 H5 不同
        // #ifdef MP-WEIXIN
        if (err.errMsg && err.errMsg.includes('timeout')) {
          uni.showToast({ title: '网络超时，请检查网络', icon: 'none' })
        }
        // #endif
        // #ifdef H5
        if (err.errMsg && err.errMsg.includes('Failed to fetch')) {
          uni.showToast({ title: '网络连接失败', icon: 'none' })
        }
        // #endif
        reject(new Error(err.errMsg || '网络请求失败'))
      },
    })
  })
}

export const http = {
  get: (url, data) => request({ url, method: 'GET', data }),
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  delete: (url, data) => request({ url, method: 'DELETE', data }),
}
```

### 7.2 各平台网络差异速查表

| 差异项 | 微信小程序 | H5 | App |
|--------|-----------|-----|-----|
| **请求 API** | `wx.request` / `uni.request` | `fetch` / `axios` / `uni.request` | `uni.request` |
| **Cookie** | 自动管理，每个域名独立 | 浏览器自动管理 | 需手动管理 `uni.setStorageSync` |
| **并发限制** | 同域名最大 10 个 | 浏览器 6 个（HTTP/2 无限制） | 无限制 |
| **HTTPS** | 必须（开发工具可关闭验证） | 非强制但推荐 | 必须 |
| **超时默认** | 60s | 无默认 | 60s |
| **文件上传** | `wx.uploadFile` | `XMLHttpRequest` / `fetch` | `uni.uploadFile` |
| **WebSocket** | `wx.connectSocket` | `WebSocket` | `uni.connectSocket` |
| **证书校验** | 可配置信任自签证书 | 由浏览器处理 | 可自定义证书校验 |

### 7.3 踩坑：请求超时处理策略

```javascript
// utils/retry.js
// 带重试的请求封装（适用于弱网场景）

export async function requestWithRetry(options, maxRetries = 3) {
  let lastError

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await request(options)
    } catch (err) {
      lastError = err

      // 只对网络错误重试，业务错误不重试
      if (err.message && !err.message.includes('网络') && !err.message.includes('timeout')) {
        throw err
      }

      // 指数退避
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}
```

---

## 八、跨平台框架对比

在选择跨平台方案时，uni-app 常与 React Native、Flutter 进行比较：

| 维度 | uni-app | React Native | Flutter |
|------|---------|-------------|---------|
| **技术栈** | Vue.js + 条件编译 | React + JS Bridge | Dart + 自绘引擎 |
| **小程序支持** | ✅ 微信/支付宝/百度/抖音等 10+ 小程序 | ❌ 不支持 | ❌ 不支持 |
| **H5 支持** | ✅ 原生支持 | ⚠️ 需 react-native-web | ⚠️ Flutter Web 仍在完善 |
| **原生性能** | nvue 接近原生，vue 页面有差距 | 中等，新架构有提升 | 高，自绘引擎无桥接开销 |
| **学习成本** | 低（Vue 开发者上手快） | 中（需了解 React + 原生） | 中高（需学 Dart） |
| **生态插件** | DCloud 插件市场丰富 | npm 生态庞大 | pub.dev 生态完善 |
| **热更新** | ✅ 支持（wgt 包） | ⚠️ 部分支持 | ❌ 受限于商店政策 |
| **适合场景** | 小程序+App+H5 一体化、电商/内容 | 复杂交互、已有 React 团队 | 高性能 UI、品牌级 App |

> **选型建议**：如果团队主力是 Vue 技术栈且需要同时覆盖小程序和 App，uni-app 是性价比最高的选择；追求极致原生体验可选 Flutter；已有 React 技术栈则选 React Native。

---

## 九、常见踩坑总结

### 9.1 条件编译不生效

```
❌ 问题：条件编译注释被当作普通注释
✅ 原因：必须使用 // 或 /* */ 标准注释格式，不能用 <!-- --> 在 JS 中
✅ 检查：编译后查看 dist 目录中的产物，确认目标代码是否被正确包含/排除
```

### 9.2 变量作用域问题

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

### 9.3 import 语句的条件编译

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

### 9.4 第三方库的平台兼容性

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

### 9.5 踩坑：页面路由与生命周期差异

```javascript
// 踩坑记录：
// 1. 微信小程序的页面栈上限为 10 层，超出后 navigateTo 静默失败
// 2. H5 端 navigateTo 不会触发 onUnload（用 beforeRouteLeave 替代）
// 3. App 端的 onBackPress 返回 true 可拦截返回，小程序端不行

// utils/router.js
export function safeNavigateTo(url) {
  // #ifdef MP-WEIXIN
  const pages = getCurrentPages()
  if (pages.length >= 9) {
    // 页面栈接近上限，使用 redirectTo 替代
    uni.redirectTo({ url })
    return
  }
  // #endif
  uni.navigateTo({ url })
}

// 踩坑：Tab 页面只能用 switchTab，navigateTo 对 tab 页无效
export function switchToTab(url) {
  // 必须用 switchTab，其他 API 无效
  uni.switchTab({ url })
}
```

### 9.6 踩坑：Storage API 的序列化差异

```javascript
// 踩坑记录：
// 1. uni.setStorageSync 存对象时自动 JSON.stringify
// 2. 但存储的 key 不能包含特殊字符（小程序限制）
// 3. 单个 key 的 value 大小限制：小程序 1MB，H5 5MB

// ✅ 推荐：统一封装 Storage 工具
// utils/storage.js
export const storage = {
  set(key, value, expireMs = null) {
    const data = {
      value,
      timestamp: Date.now(),
      expire: expireMs ? Date.now() + expireMs : null,
    }
    try {
      uni.setStorageSync(key, JSON.stringify(data))
    } catch (err) {
      // 踩坑：存储满时 setStorageSync 会抛异常，不会静默失败
      console.error(`Storage write failed for key "${key}":`, err)
      // 存储满时清理过期数据
      this._cleanExpired()
      try {
        uni.setStorageSync(key, JSON.stringify(data))
      } catch (retryErr) {
        console.error('Storage still full after cleanup:', retryErr)
      }
    }
  },

  get(key) {
    try {
      const raw = uni.getStorageSync(key)
      if (!raw) return null
      const data = JSON.parse(raw)
      // 检查过期
      if (data.expire && Date.now() > data.expire) {
        uni.removeStorageSync(key)
        return null
      }
      return data.value
    } catch {
      return null
    }
  },

  _cleanExpired() {
    // 清理所有过期 key
    try {
      const { keys } = uni.getStorageInfoSync()
      keys.forEach((key) => {
        const raw = uni.getStorageSync(key)
        if (!raw) return
        try {
          const data = JSON.parse(raw)
          if (data.expire && Date.now() > data.expire) {
            uni.removeStorageSync(key)
          }
        } catch { /* skip non-JSON keys */ }
      })
    } catch { /* ignore */ }
  },
}
```

---

## 十、TypeScript + 条件编译实战

### 10.1 给适配器定义统一类型

在大型项目中，TypeScript 能大幅降低条件编译带来的类型风险：

```typescript
// types/platform.d.ts

/** 统一的平台适配器接口 */
export interface IPlatformAdapter {
  /** 获取系统信息 */
  getSystemInfo(): Promise<SystemInfo>
  /** 显示提示 */
  showToast(message: string, icon?: 'success' | 'error' | 'none'): void
  /** 确认弹窗，返回用户是否点击确认 */
  showModal(title: string, content: string): Promise<boolean>
  /** 文件上传 */
  uploadFile(filePath: string, url: string, formData?: Record<string, string>): Promise<UploadResult>
  /** 获取存储路径（H5 返回 null） */
  getStoragePath(): string | null
}

export interface SystemInfo {
  platform: 'mp-weixin' | 'h5' | 'app'
  brand: string
  model: string | null
  system: string
  windowWidth: number
  windowHeight: number
  statusBarHeight: number
  safeArea: { top: number; bottom: number; left: number; right: number } | null
}

export interface UploadResult {
  success: boolean
  url?: string
  error?: string
}
```

```typescript
// adapters/weixin.ts
import type { IPlatformAdapter, SystemInfo, UploadResult } from '@/types/platform'

export class WeixinAdapter implements IPlatformAdapter {
  async getSystemInfo(): Promise<SystemInfo> {
    const info = wx.getSystemInfoSync()
    return {
      platform: 'mp-weixin',
      brand: info.brand,
      model: info.model,
      system: info.system,
      windowWidth: info.windowWidth,
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      safeArea: info.safeArea ?? null,
    }
  }

  showToast(message: string, icon: 'success' | 'error' | 'none' = 'none'): void {
    wx.showToast({ title: message, icon })
  }

  showModal(title: string, content: string): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
  }

  uploadFile(filePath: string, url: string, formData?: Record<string, string>): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const task = wx.uploadFile({
        url,
        filePath,
        name: 'file',
        formData,
        success: (res) => {
          if (res.statusCode === 200) {
            const data = JSON.parse(res.data)
            resolve({ success: true, url: data.url })
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}` })
          }
        },
        fail: (err) => reject(new Error(err.errMsg)),
      })
    })
  }

  getStoragePath(): string | null {
    return wx.env.USER_DATA_PATH
  }
}
```

**踩坑记录**：如果 `tsconfig.json` 中 `strict: true`，条件编译后的代码树摇（tree-shaking）可能导致类型声明丢失。解决方法是在 `tsconfig.json` 中添加别名映射并关闭 strict 对条件编译文件的检查：

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### 10.2 Vue 2 vs Vue 3 在 uni-app 中的条件编译差异

| 维度 | uni-app + Vue 2 | uni-app + Vue 3 |
|------|-----------------|-----------------|
| **组合式 API** | ❌ 仅 Options API | ✅ Composition API + `<script setup>` |
| **响应式原理** | `Object.defineProperty` | `Proxy`（性能更好） |
| **条件编译语法** | 相同（`#ifdef` / `#endif`） | 相同 |
| **模板指令** | `v-for` 中 `key` 必须绑定 | 同，但 `v-if` 优先级变化 |
| **Pinia 支持** | 需 `vuex` | 原生支持 `pinia` |
| **TypeScript** | 需额外配置 | 内置支持 |
| **nvue 页面** | weex 渲染，CSS 受限大 | 同，但推荐用 Vue 页面替代 |
| **首包大小** | 约 200KB（gzip） | 约 150KB（tree-shaking 优化） |
| **编译速度** | 较慢 | 较快（Vite 支持） |

> **迁移建议**：新项目务必选择 Vue 3 + Vite，Vue 2 已进入维护模式。存量项目可以逐步迁移，条件编译语法无需修改，主要工作在 Options API → Composition API 的重构。

### 10.3 调试条件编译的实用技巧

```javascript
// utils/debug-platform.js
// 开发阶段快速确认当前平台编译结果

export function logPlatformInfo() {
  const info = {
    // #ifdef MP-WEIXIN
    platform: 'MP-WEIXIN',
    // #endif
    // #ifdef H5
    platform: 'H5',
    // #endif
    // #ifdef APP-PLUS
    platform: 'APP-PLUS',
    // #endif
    // #ifdef APP-NVUE
    platform: 'APP-NVUE',
    // #endif
    // #ifdef MP-ALIPAY
    platform: 'MP-ALIPAY',
    // #endif
    timestamp: Date.now(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
  }

  console.table(info)
  return info
}
```

**调试清单**：
1. 编译后检查 `dist/dev/mp-weixin`（小程序）或 `dist/dev/h5`（H5）目录，确认 `#ifdef` 块是否被正确裁剪
2. 在 `manifest.json` 中开启 `vueConfig.performance: true` 查看编译耗时
3. 微信小程序真机调试时，打开「调试器 → Console」搜索平台相关变量
4. App 端使用 `uni.getSystemInfoSync().platform` 验证运行时平台判断

### 10.4 跨平台 UI 组件库选型对比

| 组件库 | 小程序 | H5 | App (vue) | App (nvue) | 特点 |
|--------|--------|-----|-----------|------------|------|
| **uni-ui** (官方) | ✅ | ✅ | ✅ | ⚠️ 部分 | DCloud 维护，兼容性最好 |
| **uView UI** | ✅ | ✅ | ✅ | ❌ | 组件丰富，社区活跃，Vue 2 为主 |
| **uView Plus** | ✅ | ✅ | ✅ | ❌ | uView 的 Vue 3 版本 |
| **tmui** | ✅ | ✅ | ✅ | ✅ | 支持 nvue，主题定制强 |
| **ThorUI** | ✅ | ✅ | ✅ | ❌ | 电商场景组件丰富 |
| **Vant Weapp** | ✅ (仅微信) | ❌ | ❌ | ❌ | 有赞出品，仅限微信小程序 |

> **选型建议**：通用场景首选 `uni-ui`（官方维护最稳定）；需要 nvue 支持选 `tmui`；电商类项目可搭配 `ThorUI` 补充业务组件。

---

## 十一、最佳实践清单

1. **收口原则**：将条件编译集中在 `adapters/` 目录，业务代码通过适配器接口调用，避免到处散落 `#ifdef`
2. **测试策略**：每个条件编译块都要在对应平台真机测试，H5 可以用浏览器，小程序用开发者工具，App 用真机调试
3. **注释规范**：在条件编译块开头加一行注释说明为什么需要平台区分
4. **渐进适配**：先做 H5 + 微信小程序两个平台，再逐步扩展到 App 和其他小程序
5. **类型安全**：如果使用 TypeScript，给适配器定义统一的 interface，确保各平台实现一致
6. **CI 集成**：在 CI 流程中分别编译各平台产物，确保条件编译不引入语法错误
7. **文档化差异**：维护一个 `PLATFORM_DIFF.md` 记录已知的平台差异和解决方案，新人 onboarding 时极大降低踩坑成本
8. **性能监控**：条件编译可能导致不同平台的包大小差异显著，定期对比各平台打包体积
9. **版本锁定**：`package.json` 中锁定 uni-app 和相关插件的大版本，避免条件编译行为因版本变化而失效
10. **代码审查**：PR review 时重点关注新增的 `#ifdef` 块，确保有充分的注释和平台测试覆盖

---

## 总结

条件编译是 uni-app 多端开发的核心能力，但也是最大的维护负担来源。**关键不是学会语法，而是建立正确的架构模式**：

- **小规模**：直接在代码中用 `#ifdef`，简单直接
- **中等规模**：按功能模块收口到 `services/` 或 `adapters/` 目录
- **大规模**：使用适配器模式 + 策略模式，业务代码零条件编译

在奇乐MAX的实践中，我们将 80% 的条件编译收口到了 5 个适配器文件中，业务页面中几乎看不到 `#ifdef`，大幅降低了维护成本。

---

*本文基于 uni-app 3.x + Vue 3 实践总结，部分 API 细节可能随版本更新变化，请以 [uni-app 官方文档](https://uniapp.dcloud.net.cn/tutorial/platform.html) 为准。*

---

## 相关阅读

- [uni-app 自定义组件跨平台与原生插件市场实战](/categories/frontend/uni-app-custom-component-cross-platform-native-plugin-marketplace/)
- [uni-app 离线存储方案：SQLite、IndexedDB 与数据同步冲突解决](/categories/frontend/uni-app-offline-storage-sqlite-indexeddb-data-sync-conflict-resolution/)
- [uni-app 性能优化：首屏加载、分包策略与图片懒加载](/categories/frontend/uni-app-performance-optimization-first-screen-subpackage-image-lazy-load/)
