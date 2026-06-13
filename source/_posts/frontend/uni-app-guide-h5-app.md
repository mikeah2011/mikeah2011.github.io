---

cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
title: uni-app 多端适配实战：H5/微信小程序/App 一套代码搞定踩坑记录
date: 2026-05-05 10:10:56
updated: 2026-05-05 10:13:47
categories:
  - frontend
keywords: [uni, app, H5, 多端适配实战, 微信小程序, 一套代码搞定踩坑记录]
tags:
- Vue
- uni-app
- 前端
description: uni-app 跨平台前端开发实战指南：基于奇乐MAX电商项目，深度拆解 uni-app H5、微信小程序、App 三端适配中的架构设计、条件编译技巧、平台差异踩坑与性能优化方案。涵盖网络请求封装、支付登录多端适配、rich-text 兼容处理、分包加载策略等核心痛点，附 uni-app H5 与原生 H5 的全面对比表格，从 Vue 3 + Vite 项目搭建到多端生产部署的完整工程化工作流。
---


# uni-app 多端适配实战：H5/微信小程序/App 一套代码搞定踩坑记录

## 一、背景：为什么选 uni-app？

在奇乐MAX（qile-max）电商项目中，我们需要同时覆盖 **H5 网页版**、**微信小程序**和 **App（iOS/Android）** 三个端。最初考虑过三套代码分别维护，但评估后发现：

| 方案 | 开发成本 | 维护成本 | 一致性 |
|------|---------|---------|--------|
| 三套原生代码 | 3x | 3x | 差 |
| React Native + Web | 2x | 2.5x | 中 |
| uni-app | 1x | 1.2x | 好 |

最终选择 uni-app 的核心原因：
1. **Vue 3 生态**：团队已有 Vue 3 经验（vue-pure-admin 管理后台）
2. **条件编译**：一套代码通过 `#ifdef` 处理平台差异
3. **微信小程序原生支持**：国内电商场景小程序是必选项
4. **插件市场丰富**：支付、地图、推送等原生能力封装完善

## 二、项目架构设计

### 2.1 目录结构

```
qile-max-uni/
├── src/
│   ├── pages/                    # 页面
│   │   ├── index/                # 首页
│   │   ├── product/              # 商品详情
│   │   ├── blindbox/             # 盲盒业务
│   │   ├── order/                # 订单
│   │   └── user/                 # 个人中心
│   ├── components/               # 公共组件
│   │   ├── ProductCard.vue       # 商品卡片（多端适配）
│   │   ├── PayButton.vue         # 支付按钮（条件编译）
│   │   └── ImageUploader.vue     # 图片上传
│   ├── api/                      # 接口层
│   │   ├── request.ts            # 统一请求封装
│   │   ├── product.ts
│   │   └── order.ts
│   ├── store/                    # Pinia 状态管理
│   │   ├── user.ts
│   │   ├── cart.ts
│   │   └── blindbox.ts
│   ├── utils/                    # 工具函数
│   │   ├── platform.ts           # 平台检测
│   │   ├── payment.ts            # 支付适配层
│   │   └── storage.ts            # 存储适配层
│   ├── static/                   # 静态资源
│   └── uni_modules/              # uni-app 插件
├── pages.json                    # 页面路由配置
├── manifest.json                 # 应用配置
├── uni.scss                      # 全局样式变量
└── vite.config.ts                # Vite 构建配置
```

### 2.2 核心架构图

```
┌─────────────────────────────────────────────────┐
│                   Vue 3 页面层                   │
│  pages/index  pages/product  pages/blindbox      │
├─────────────────────────────────────────────────┤
│              组件层 (条件编译)                     │
│  ProductCard.vue    PayButton.vue                │
│  ┌──────────┬──────────┬──────────┐             │
│  │ #ifdef   │ #ifdef   │ #ifdef   │             │
│  │ H5       │ MP-WEIXIN│ APP-PLUS │             │
│  └──────────┴──────────┴──────────┘             │
├─────────────────────────────────────────────────┤
│              适配层 (utils/)                      │
│  platform.ts  payment.ts  storage.ts             │
├─────────────────────────────────────────────────┤
│              API 层 (api/request.ts)              │
│  uni.request + 拦截器 + Token 管理                │
├─────────────────────────────────────────────────┤
│         uni-app 原生桥接 (uni.*)                  │
│  uni.request  uni.login  uni.requestPayment      │
└─────────────────────────────────────────────────┘
        │               │               │
    ┌───┴───┐     ┌─────┴─────┐   ┌────┴────┐
    │  H5   │     │微信小程序  │   │  App    │
    │WebView│     │  WXML/WXSS│   │ Weex/WebView│
    └───────┘     └───────────┘   └─────────┘
```

## 三、条件编译实战

uni-app 的核心能力是**条件编译**，通过 `#ifdef` 和 `#ifndef` 注释实现平台差异化代码。

### 3.1 支付模块的条件编译

这是多端差异最大的模块。微信小程序用 `wx.requestPayment`，H5 用支付宝/微信 H5 支付，App 用原生支付 SDK。

```typescript
// utils/payment.ts
import { PlatformType } from './platform'

interface PayOptions {
  orderNo: string
  amount: number
  payMethod: 'wechat' | 'alipay'
}

interface PayResult {
  success: boolean
  message: string
}

export async function unifiedPay(options: PayOptions): Promise<PayResult> {
  const { orderNo, amount, payMethod } = options

  // #ifdef MP-WEIXIN
  // 微信小程序支付
  return await wechatMiniProgramPay(orderNo, amount)
  // #endif

  // #ifdef H5
  // H5 支付（微信 H5 / 支付宝 H5）
  return await h5Pay(orderNo, amount, payMethod)
  // #endif

  // #ifdef APP-PLUS
  // App 原生支付
  return await appNativePay(orderNo, amount, payMethod)
  // #endif
}

// #ifdef MP-WEIXIN
async function wechatMiniProgramPay(
  orderNo: string, 
  amount: number
): Promise<PayResult> {
  try {
    // 1. 调用后端获取支付参数
    const { data } = await uni.request({
      url: '/api/payment/wechat/mini-program',
      method: 'POST',
      data: { order_no: orderNo, amount }
    })

    // 2. 调起微信支付
    const payResult = await new Promise<UniApp.RequestPaymentSuccess>(
      (resolve, reject) => {
        uni.requestPayment({
          provider: 'wxpay',
          timeStamp: data.timeStamp,
          nonceStr: data.nonceStr,
          package: data.package,
          signType: data.signType,
          paySign: data.paySign,
          success: resolve,
          fail: reject
        })
      }
    )

    return { success: true, message: '支付成功' }
  } catch (error: any) {
    if (error.errMsg?.includes('cancel')) {
      return { success: false, message: '用户取消支付' }
    }
    return { success: false, message: `支付失败: ${error.errMsg}` }
  }
}
// #endif

// #ifdef H5
async function h5Pay(
  orderNo: string, 
  amount: number, 
  payMethod: string
): Promise<PayResult> {
  try {
    const { data } = await uni.request({
      url: `/api/payment/${payMethod}/h5`,
      method: 'POST',
      data: { 
        order_no: orderNo, 
        amount,
        return_url: window.location.origin + '/pages/order/result'
      }
    })

    // H5 支付通常返回一个跳转 URL
    if (data.pay_url) {
      window.location.href = data.pay_url
      return { success: true, message: '正在跳转支付页面...' }
    }

    // 微信 H5 支付可能返回 deep link
    if (data.mweb_url) {
      window.location.href = data.mweb_url
      return { success: true, message: '正在跳转微信支付...' }
    }

    return { success: false, message: '获取支付链接失败' }
  } catch (error) {
    return { success: false, message: '支付请求失败' }
  }
}
// #endif
```

### 3.2 样式条件编译

不同端的 CSS 能力差异很大。小程序不支持 `position: fixed` 在某些组件上，H5 需要处理安全区。

```vue
<!-- components/TabBar.vue -->
<template>
  <view class="tab-bar">
    <view 
      v-for="tab in tabs" 
      :key="tab.id"
      class="tab-item"
      :class="{ active: currentTab === tab.id }"
      @tap="switchTab(tab)"
    >
      <image :src="currentTab === tab.id ? tab.activeIcon : tab.icon" />
      <text>{{ tab.label }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.tab-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 100rpx;
  background: #fff;
  
  /* #ifdef H5 */
  // H5 端需要处理 iPhone X 安全区
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  /* #endif */

  /* #ifdef APP-PLUS */
  // App 端同样需要安全区处理
  padding-bottom: var(--status-bar-height);
  /* #endif */
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  
  /* #ifdef MP-WEIXIN */
  // 小程序端图标尺寸需要调整
  image {
    width: 48rpx;
    height: 48rpx;
  }
  /* #endif */
  
  /* #ifndef MP-WEIXIN */
  // 非小程序端用更大的图标
  image {
    width: 56rpx;
    height: 56rpx;
  }
  /* #endif */
}
</style>
```

## 四、核心踩坑记录

### 踩坑 #1：小程序 `uni.request` 域名配置

**现象**：H5 端接口正常，小程序端所有请求报 `url not in domain list`。

**原因**：微信小程序要求所有请求域名必须在后台配置白名单。

**解决方案**：

```typescript
// utils/platform.ts
export function getBaseUrl(): string {
  // #ifdef MP-WEIXIN
  // 小程序必须用已备案域名
  return 'https://api.qile-max.com'
  // #endif

  // #ifdef H5
  // H5 开发环境可以用 localhost
  if (import.meta.env.DEV) {
    return 'http://localhost:8080/api'
  }
  return 'https://api.qile-max.com'
  // #endif

  // #ifdef APP-PLUS
  // App 可以用任意域名，但生产环境建议用正式域名
  return 'https://api.qile-max.com'
  // #endif
}
```

**踩坑教训**：开发阶段用微信开发者工具的「不校验合法域名」选项跳过检查，但上线前必须配置。另外，小程序只支持 HTTPS（开发环境除外）。

### 踩坑 #2：`uni.login` 各端返回值不一致

**现象**：封装统一登录逻辑时，三个端返回的 code/token 结构完全不同。

```typescript
// ❌ 错误写法：假设所有端返回一致
async function login() {
  const res = await uni.login()
  await api.login({ code: res.code }) // 小程序有 code，H5 没有
}

// ✅ 正确写法：按端处理
async function unifiedLogin() {
  // #ifdef MP-WEIXIN
  const { code } = await uni.login({ provider: 'weixin' })
  const { data } = await api.post('/auth/wechat-mini-login', { code })
  // #endif

  // #ifdef H5
  // H5 端走 OAuth 跳转流程
  const redirectUri = encodeURIComponent(
    window.location.origin + '/pages/auth/callback'
  )
  window.location.href = 
    `https://open.weixin.qq.com/connect/oauth2/authorize` +
    `?appid=${APPID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=snsapi_userinfo` +
    `&state=STATE#wechat_redirect`
  return // 跳转后在 callback 页面处理
  // #endif

  // #ifdef APP-PLUS
  const oauthRes: any = await new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: resolve,
      fail: reject
    })
  })
  const { data } = await api.post('/auth/wechat-app-login', {
    code: oauthRes.code,
    access_token: oauthRes.authResult?.access_token,
    openid: oauthRes.authResult?.openid
  })
  // #endif

  // 保存 token
  uni.setStorageSync('token', data.token)
}
```

### 踩坑 #3：图片上传在小程序端的 `filePath` 问题

**现象**：`uni.chooseImage` 返回的 `tempFilePath` 在不同端格式不同。H5 返回 Blob URL，小程序返回本地临时路径，App 返回文件 URI。

```typescript
// utils/upload.ts
export async function uploadImage(count: number = 1): Promise<string[]> {
  const chooseResult = await uni.chooseImage({
    count,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera']
  })

  const urls: string[] = []

  for (const filePath of chooseResult.tempFilePaths) {
    // #ifdef MP-WEIXIN
    // 小程序端：直接用 tempFilePath
    const uploadRes = await new Promise<UniApp.UploadFileSuccess>(
      (resolve, reject) => {
        uni.uploadFile({
          url: getBaseUrl() + '/api/upload',
          filePath,
          name: 'file',
          header: {
            Authorization: `Bearer ${uni.getStorageSync('token')}`
          },
          success: resolve,
          fail: reject
        })
      }
    )
    const { url } = JSON.parse(uploadRes.data)
    urls.push(url)
    // #endif

    // #ifdef H5
    // H5 端：filePath 是 Blob URL，需要转成 File 对象
    const blob = await fetch(filePath).then(r => r.blob())
    const file = new File([blob], 'upload.jpg', { type: 'image/jpeg' })
    const formData = new FormData()
    formData.append('file', file)
    
    const uploadRes = await uni.request({
      url: getBaseUrl() + '/api/upload',
      method: 'POST',
      data: formData,
      header: {
        Authorization: `Bearer ${uni.getStorageSync('token')}`
      }
    })
    urls.push(uploadRes.data.url)
    // #endif

    // #ifdef APP-PLUS
    // App 端：需要压缩后再上传
    const compressedPath = await compressImage(filePath)
    const uploadRes = await new Promise<UniApp.UploadFileSuccess>(
      (resolve, reject) => {
        uni.uploadFile({
          url: getBaseUrl() + '/api/upload',
          filePath: compressedPath,
          name: 'file',
          header: {
            Authorization: `Bearer ${uni.getStorageSync('token')}`
          },
          success: resolve,
          fail: reject
        })
      }
    )
    const { url } = JSON.parse(uploadRes.data)
    urls.push(url)
    // #endif
  }

  return urls
}

// #ifdef APP-PLUS
async function compressImage(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    plus.zip.compressImage(
      { src: path, quality: 80, width: '1024px' },
      (res) => resolve(res.target),
      (err) => reject(err)
    )
  })
}
// #endif
```

### 踩坑 #4：小程序 `scroll-view` 与页面滚动冲突

**现象**：盲盒商品列表使用 `scroll-view` 做横向滑动，但在小程序端滑动时页面跟着滚动。

```vue
<!-- ❌ 问题代码 -->
<scroll-view scroll-x class="blindbox-list">
  <view v-for="box in blindboxList" :key="box.id" class="box-card">
    <!-- 卡片内容 -->
  </view>
</scroll-view>

<!-- ✅ 修复：添加 catchtouchmove 阻止冒泡 -->
<scroll-view 
  scroll-x 
  class="blindbox-list"
  @touchmove.stop.prevent="() => {}"
>
  <view v-for="box in blindboxList" :key="box.id" class="box-card">
    <!-- 卡片内容 -->
  </view>
</scroll-view>
```

**但注意**：`@touchmove.stop.prevent` 会阻止所有触摸事件，如果列表内有点击事件需要特别处理。更好的方案是用 CSS：

```scss
.blindbox-list {
  // #ifdef MP-WEIXIN
  // 小程序端禁止父容器滚动
  touch-action: pan-x;
  overflow: hidden;
  // #endif
}
```

### 踩坑 #5：`rich-text` 组件在各端渲染差异

**现象**：后端返回的商品详情 HTML，在 H5 端正常，但小程序端样式丢失、图片不显示。

**原因**：小程序的 `rich-text` 组件不支持外部样式表和 `<script>` 标签，且对 CSS 支持有限。

```typescript
// utils/htmlParser.ts
export function sanitizeHtmlForMiniProgram(html: string): string {
  return html
    // 移除 script 标签
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 移除 style 标签
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 移除外部链接
    .replace(/<link[\s\S]*?\/?>/gi, '')
    // 图片添加宽度限制（小程序不支持 max-width）
    .replace(/<img/gi, '<img style="max-width:100%;height:auto;"')
    // 移除不支持的 CSS 属性
    .replace(/position:\s*fixed/gi, 'position:relative')
    // 处理视频标签（小程序用不同的方式）
    .replace(
      /<video[\s\S]*?src="([^"]*)"[\s\S]*?<\/video>/gi,
      '<video src="$1" controls style="width:100%;"></video>'
    )
}

// pages/product/detail.vue
<template>
  <view class="product-detail">
    <!-- #ifdef H5 -->
    <div class="rich-content" v-html="productDetail"></div>
    <!-- #endif -->

    <!-- #ifdef MP-WEIXIN -->
    <rich-text :nodes="sanitizedHtml"></rich-text>
    <!-- #endif -->

    <!-- #ifdef APP-PLUS -->
    <!-- App 端可以使用 web-view 加载完整 HTML -->
    <web-view :src="detailUrl"></web-view>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtmlForMiniProgram } from '@/utils/htmlParser'

const props = defineProps<{
  html: string
  productId: string
}>()

// #ifdef MP-WEIXIN
const sanitizedHtml = computed(() => sanitizeHtmlForMiniProgram(props.html))
// #endif

// #ifdef APP-PLUS
const detailUrl = computed(
  () => `https://api.qile-max.com/product/${props.productId}/detail-html`
)
// #endif
</script>
```

## 五、网络请求统一封装

三个端的网络请求 API 有微妙差异，统一封装是必须的：

```typescript
// api/request.ts
import { getBaseUrl } from '@/utils/platform'

interface RequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
  header?: Record<string, string>
  timeout?: number
}

interface Response<T = any> {
  code: number
  data: T
  message: string
}

const BASE_URL = getBaseUrl()

// 请求拦截器
function interceptRequest(config: RequestConfig): RequestConfig {
  const token = uni.getStorageSync('token')
  if (token) {
    config.header = {
      ...config.header,
      Authorization: `Bearer ${token}`
    }
  }

  // #ifdef MP-WEIXIN
  // 小程序添加平台标识，后端可做差异化处理
  config.header = {
    ...config.header,
    'X-Platform': 'wechat-mini'
  }
  // #endif

  // #ifdef H5
  config.header = {
    ...config.header,
    'X-Platform': 'h5'
  }
  // #endif

  return config
}

// 响应拦截器
function interceptResponse<T>(
  response: UniApp.RequestSuccessCallbackResult
): Response<T> {
  const statusCode = response.statusCode
  const data = response.data as Response<T>

  if (statusCode === 401) {
    // Token 过期，跳转登录
    uni.removeStorageSync('token')
    uni.reLaunch({ url: '/pages/auth/login' })
    throw new Error('登录已过期，请重新登录')
  }

  if (statusCode >= 400) {
    throw new Error(data.message || `请求失败: ${statusCode}`)
  }

  return data
}

// 统一请求方法
export async function request<T = any>(
  config: RequestConfig
): Promise<Response<T>> {
  const finalConfig = interceptRequest({
    ...config,
    url: BASE_URL + config.url,
    timeout: config.timeout || 15000,
    header: {
      'Content-Type': 'application/json',
      ...config.header
    }
  })

  try {
    const response = await uni.request({
      url: finalConfig.url,
      method: finalConfig.method || 'GET',
      data: finalConfig.data,
      header: finalConfig.header,
      timeout: finalConfig.timeout
    })

    return interceptResponse<T>(response)
  } catch (error: any) {
    // #ifdef MP-WEIXIN
    if (error.errMsg?.includes('timeout')) {
      uni.showToast({ title: '网络超时，请重试', icon: 'none' })
    }
    // #endif
    throw error
  }
}

// 便捷方法
export const api = {
  get: <T>(url: string, data?: any) => 
    request<T>({ url, method: 'GET', data }),
  post: <T>(url: string, data?: any) => 
    request<T>({ url, method: 'POST', data }),
  put: <T>(url: string, data?: any) => 
    request<T>({ url, method: 'PUT', data }),
  del: <T>(url: string, data?: any) => 
    request<T>({ url, method: 'DELETE', data })
}
```

## 六、性能优化

### 6.1 分包加载

小程序主包限制 2MB，必须做分包：

```json
// pages.json
{
  "pages": [
    { "path": "pages/index/index", "style": { "navigationBarTitleText": "首页" } },
    { "path": "pages/auth/login", "style": { "navigationBarTitleText": "登录" } }
  ],
  "subPackages": [
    {
      "root": "pages/product",
      "pages": [
        { "path": "detail", "style": { "navigationBarTitleText": "商品详情" } },
        { "path": "list", "style": { "navigationBarTitleText": "商品列表" } }
      ]
    },
    {
      "root": "pages/blindbox",
      "pages": [
        { "path": "index", "style": { "navigationBarTitleText": "盲盒" } },
        { "path": "result", "style": { "navigationBarTitleText": "开奖结果" } }
      ]
    },
    {
      "root": "pages/order",
      "pages": [
        { "path": "list", "style": { "navigationBarTitleText": "订单列表" } },
        { "path": "detail", "style": { "navigationBarTitleText": "订单详情" } }
      ]
    }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pages/product"]
    }
  }
}
```

### 6.2 图片懒加载与 CDN

```vue
<!-- components/LazyImage.vue -->
<template>
  <image 
    :src="finalSrc" 
    :mode="mode"
    lazy-load
    @error="onError"
    class="lazy-image"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  src: string
  mode?: string
  width?: number
  height?: number
}>()

const error = ref(false)
const placeholder = '/static/images/placeholder.png'

const finalSrc = computed(() => {
  if (error.value) return placeholder
  if (!props.src) return placeholder
  
  // CDN 图片处理：添加尺寸参数减少传输量
  const cdnBase = 'https://cdn.qile-max.com'
  const separator = props.src.includes('?') ? '&' : '?'
  
  // #ifdef MP-WEIXIN
  // 小程序端用 rpx 尺寸
  const width = props.width ? props.width * 2 : 750
  return `${cdnBase}${props.src}${separator}w=${width}&q=75&f=webp`
  // #endif
  
  // #ifndef MP-WEIXIN
  return `${cdnBase}${props.src}${separator}w=${props.width || 400}&q=80&f=webp`
  // #endif
})

function onError() {
  error.value = true
}
</script>
```

## 七、构建与发布流程

```
开发流程：
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 本地开发 │───→│ H5 预览   │───→│ 小程序预览│───→│ 真机测试 │
│ npm dev │    │ 浏览器    │    │开发者工具 │    │ 各端设备 │
└─────────┘    └──────────┘    └──────────┘    └──────────┘
                                                    │
发布流程：                                          ▼
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│ 代码合并 │───→│ CI 构建   │───→│ 自动化测试│───→│ 各端发布 │
│ PR Merge │    │ 三端产物  │    │ E2E/单元  │    │          │
└──────────┘    └───────────┘    └──────────┘    └──────────┘
                                                ├── H5: Nginx 部署
                                                ├── 小程序: 上传代码 → 提审
                                                └── App: 云打包 → 应用商店
```

```bash
# 构建命令
npm run build:h5          # H5 产物 → dist/build/h5
npm run build:mp-weixin   # 微信小程序 → dist/build/mp-weixin
npm run build:app         # App 产物 → dist/build/app

# 微信小程序发布
# 1. 构建后用微信开发者工具打开 dist/build/mp-weixin
# 2. 上传代码
# 3. 微信公众平台提交审核
```

## 八、uni-app H5 与原生 H5 对比

在实际开发中，很多团队会纠结"直接写原生 H5"还是"用 uni-app 输出 H5"。以下从多个维度对比：

| 对比维度 | uni-app H5 | 原生 H5（Vue 3 SPA） |
|---------|-----------|-------------------|
| **开发语言** | Vue 3 + uni-app API（需遵守 uni-app 组件规范） | Vue 3 / React，自由选择 |
| **组件体系** | `<view>` `<text>` `<image>` 等 uni-app 组件 | 标准 HTML 标签 `<div>` `<span>` `<img>` |
| **路由** | `pages.json` 声明式路由，不支持 vue-router | vue-router / react-router，灵活度高 |
| **CSS 能力** | 限制较多（不支持部分选择器），rpx 自动转换 | 完整 CSS 能力，任意预处理器 |
| **第三方库** | 不能直接用 DOM 类库（jQuery、D3 等） | 自由引入任意 npm 包 |
| **跨端能力** | ✅ 一套代码输出 H5 + 小程序 + App | ❌ 仅 H5 |
| **SEO** | SPA 模式，SEO 较差（可集成 uni-app SSR） | 可用 Nuxt SSR/SSG，SEO 灵活 |
| **性能** | 框架层有额外开销，首屏略慢 | 原生性能，Vite 极速构建 |
| **包体积** | 框架运行时 + 组件库，基础包 200KB+ | 按需引入，可做到 50KB 以内 |
| **调试体验** | HBuilderX + Chrome DevTools | Chrome DevTools，生态成熟 |
| **适用场景** | 多端项目，H5 作为补充渠道 | 纯 Web 项目，对 SEO/性能有极致要求 |

**结论**：如果你的项目**只做 H5**，原生 Vue 3 SPA 是更好的选择；如果需要**H5 + 小程序 + App 多端覆盖**，uni-app 的 H5 输出是性价比最高的方案。

## 九、常见兼容性问题与解决方案

### 9.1 CSS 兼容性问题

| 问题 | 平台 | 解决方案 |
|-----|------|---------|
| `rpx` 在 H5 端的换算误差 | H5 | 配置 `designWidth`（默认 750），在 `manifest.json` 中调整 |
| `position: fixed` 在小程序 `scroll-view` 内失效 | MP-WEIXIN | 用 `position: absolute` + 外层容器 `transform` 模拟 |
| `overflow: scroll` 在 iOS 小程序端卡顿 | MP-WEIXIN | 改用 `<scroll-view>` 组件，添加 `-webkit-overflow-scrolling: touch` |
| `env(safe-area-inset-bottom)` 部分机型不生效 | H5/APP | 同时写 `constant()` 和 `env()` 两个版本 |
| 字体图标在小程序端不显示 | MP-WEIXIN | 将字体文件转为 base64 内联，或用图片替代 |
| `1px` 边框在 Retina 屏显示过粗 | 全端 | 使用 `transform: scaleY(0.5)` 方案或 rpx 单位 |

```scss
/* 1px 边框 Retina 适配 mixin */
@mixin hairline-bottom($color: #e5e5e5) {
  position: relative;
  &::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 1px;
    background: $color;
    transform: scaleY(0.5);
    transform-origin: 0 100%;
  }
}
```

### 9.2 JavaScript API 兼容性问题

| 问题 | 平台 | 解决方案 |
|-----|------|---------|
| `window` / `document` 对象在小程序端不存在 | MP-WEIXIN | 用条件编译隔离 DOM 操作，或使用 `uni.` API 替代 |
| `localStorage` 在小程序端映射为同步存储 | 全端 | 统一使用 `uni.setStorageSync` / `uni.getStorageSync` |
| `FormData` 在小程序端不可用 | MP-WEIXIN | 文件上传用 `uni.uploadFile`，不要手动构建 FormData |
| `Promise.allSettled` 在低版本 WebView 不支持 | H5 | 引入 polyfill 或自行实现 |
| `crypto.randomUUID()` 部分环境不支持 | 全端 | 使用第三方 `uuid` 库替代 |

```typescript
// utils/uuid.ts — 跨端 UUID 生成
export function generateUUID(): string {
  // #ifdef H5
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // #endif

  // 通用 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
```

### 9.3 真机调试中的典型坑

| 问题 | 现象 | 解决方案 |
|-----|------|---------|
| 小程序真机调试白屏 | 开发者工具正常，真机白屏 | 检查基础库版本，降低 `miniprogramRoot` 兼容版本 |
| H5 端微信 OAuth 回调丢失 | 微信授权后页面空白 | 检查 `redirect_uri` 是否已备案，URL 是否正确 encode |
| App 端相机权限弹窗不触发 | Android 12+ 权限模型变化 | 使用 `uni.authorize` 预请求权限，配合 `manifest.json` 声明 |

## 十、H5 端专项性能优化

### 10.1 首屏加载优化

uni-app H5 端首屏加载通常比原生 SPA 慢，因为框架运行时 + 组件库体积较大。以下策略可显著改善：

```typescript
// vite.config.ts — H5 端构建优化
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  build: {
    // #ifdef H5
    rollupOptions: {
      output: {
        // 分包策略：框架运行时单独一个 chunk，长期缓存
        manualChunks: {
          'uni-vendor': [
            '@dcloudio/uni-h5',
            'vue',
            'pinia'
          ],
          'ui-vendor': [
            '@dcloudio/uni-ui'
          ]
        }
      }
    },
    // 开启 gzip 预压缩
    // 配合 Nginx 的 gzip_static on 使用
    // #endif
  }
})
```

### 10.2 路由懒加载与预加载

```typescript
// pages.json 中配置分包预加载（小程序端生效）
// H5 端需自行实现路由级别的代码分割

// utils/preload.ts — H5 端预加载关键资源
export function preloadCriticalResources() {
  // #ifdef H5
  // 预加载首屏关键图片
  const criticalImages = [
    '/static/images/banner-1.webp',
    '/static/images/logo.webp'
  ]

  criticalImages.forEach((src) => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    document.head.appendChild(link)
  })

  // 预连接 API 域名
  const preconnect = document.createElement('link')
  preconnect.rel = 'preconnect'
  preconnect.href = 'https://api.qile-max.com'
  document.head.appendChild(preconnect)
  // #endif
}
```

### 10.3 列表虚拟滚动

商品列表等长列表场景，H5 端需要虚拟滚动避免 DOM 节点过多：

```vue
<!-- components/VirtualProductList.vue -->
<template>
  <!-- #ifdef H5 -->
  <scroll-view
    scroll-y
    :style="{ height: '100vh' }"
    @scrolltolower="loadMore"
  >
    <view
      v-for="item in visibleList"
      :key="item.id"
      class="product-item"
    >
      <ProductCard :product="item" />
    </view>
    <view v-if="loading" class="loading-tip">加载中...</view>
  </scroll-view>
  <!-- #endif -->

  <!-- #ifdef MP-WEIXIN -->
  <!-- 小程序端使用 recycle-view 组件 -->
  <recycle-view :list="productList" :size="20">
    <template #default="{ item }">
      <ProductCard :product="item" />
    </template>
  </recycle-view>
  <!-- #endif -->
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  productList: any[]
  loading: boolean
}>()

const emit = defineEmits<{
  loadMore: []
}>()

// #ifdef H5
// 简单的可视区域裁剪（生产环境建议用 vue-virtual-scroller）
const scrollTop = ref(0)
const visibleList = computed(() => {
  // 实际项目中应根据滚动位置计算可视区域
  return props.productList.slice(0, 50)
})
// #endif

function loadMore() {
  emit('loadMore')
}
</script>
```

### 10.4 长列表图片优化

```typescript
// utils/imageOptimize.ts — H5 端图片优化策略
export function getOptimizedImageUrl(
  src: string,
  options: { width?: number; quality?: number; format?: string } = {}
): string {
  const { width = 400, quality = 80, format = 'webp' } = options
  const cdnBase = 'https://cdn.qile-max.com'

  // #ifdef H5
  // 检测浏览器是否支持 WebP
  const supportsWebP = (() => {
    const canvas = document.createElement('canvas')
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
  })()

  const finalFormat = supportsWebP ? format : 'jpg'
  return `${cdnBase}${src}?w=${width}&q=${quality}&f=${finalFormat}`
  // #endif

  // #ifndef H5
  return `${cdnBase}${src}?w=${width}&q=${quality}&f=${format}`
  // #endif
}
```

## 十一、总结与建议

| 维度 | 建议 |
|------|------|
| 项目初始化 | 用 `npx degit dcloudio/uni-preset-vue#vite-ts` 模板 |
| 状态管理 | Pinia（不要用 Vuex，uni-app 已原生支持 Pinia） |
| UI 框架 | uView Plus（Vue 3 版）或 uni-ui |
| 样式方案 | SCSS + rpx 单位，避免用 px |
| 调试 | H5 用 Chrome DevTools，小程序用微信开发者工具 |
| 真机测试 | 每个版本至少在 1 台 iOS + 1 台 Android 真机测试 |
| H5 性能 | 分包 + 路由懒加载 + 虚拟滚动 + CDN 图片优化 |
| 兼容性 | 避免直接使用 DOM API，统一用 `uni.*` 封装 |

**最重要的一条经验**：不要试图在代码里消灭所有 `#ifdef`。条件编译是 uni-app 的核心范式，接受它而不是绕过它。把平台差异集中在 `utils/` 和 `components/` 里管理，而不是散落在每个页面中，就能保持代码的可维护性。

---

## 相关阅读

- [uni-app 条件编译实战：平台差异处理与适配策略踩坑记录](/categories/Frontend/uni-app-guide/)
- [uni-app 性能优化实战：首屏加载、分包加载、图片懒加载的工程化治理](/categories/Frontend/2026-06-01-uni-app-performance-optimization-first-screen-subpackage-image-lazy-load/)
- [uni-app + Vue 3 + Vite 现代跨平台开发工作流实战踩坑记录](/categories/Frontend/uni-app-vue3-vite/)
