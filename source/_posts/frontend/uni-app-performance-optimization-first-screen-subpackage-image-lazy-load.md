---

cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
title: uni-app 性能优化实战：首屏加载、分包加载、图片懒加载的工程化治理
date: 2026-06-01 12:00:00
categories:
  - frontend
  - engineering
  - mobile
keywords: [uni, app, 性能优化实战, 首屏加载, 分包加载, 图片懒加载的工程化治理]
tags:
- uni-app
- 性能优化
- 首屏加载
- 分包加载
- 图片懒加载
- 微信小程序
- H5
- Vue
description: uni-app 多端项目的性能瓶颈往往不在业务逻辑，而在资源加载策略。本文从首屏白屏治理、分包架构设计、图片懒加载三个维度，结合奇乐 MAX 电商系统和 KKday B2C 项目的真实踩坑经验，详细讲解骨架屏实现、接口并行化与字段裁剪、小程序分包预下载与独立分包配置、自定义懒加载组件与 WebP/CDN 图片优化等工程化方案，附带对比分析表与常见反模式总结，帮助开发者系统性地提升 uni-app 应用的首屏加载速度与用户体验。
---


# uni-app 性能优化实战：首屏加载、分包加载、图片懒加载的工程化治理

## 一、问题背景：为什么 uni-app 的性能问题这么难搞？

uni-app 的核心卖点是"一套代码，多端运行"。但在实际的 B2C 电商项目中（奇乐 MAX 系列、KKday B2C），我们发现**性能问题是跨端开发最大的隐性成本**。

### 1.1 真实数据：优化前的性能基线

在优化之前，我们在三个端上的首屏性能数据如下：

| 指标 | H5 (Chrome) | 微信小程序 | App (Android) |
|------|-------------|-----------|---------------|
| 首屏 FCP | 3.2s | 2.8s | 2.1s |
| 首屏 LCP | 5.8s | 4.5s | 3.2s |
| JS Bundle 大小 | 1.8MB | 1.2MB | 1.5MB |
| 图片资源总量 | 4.2MB | 3.8MB | 4.0MB |
| 首屏请求数 | 28 | 22 | 25 |

**核心痛点**：
- **小程序**：包体限制（主包 2MB，总包 20MB），超出直接无法上传
- **H5**：首屏白屏时间长，SEO 不友好
- **App**：低端 Android 设备内存溢出，列表滚动掉帧

### 1.2 性能瓶颈的三个层次

```
┌─────────────────────────────────────────────────────────────┐
│                    性能瓶颈分层模型                           │
├─────────────────────────────────────────────────────────────┤
│  第一层：资源加载瓶颈                                         │
│  ├── JS Bundle 过大（主包包含所有页面代码）                      │
│  ├── 图片资源未压缩、未懒加载                                  │
│  └── 首屏包含非关键资源（如商品推荐、评论区）                     │
│                                                             │
│  第二层：渲染瓶颈                                             │
│  ├── 长列表一次性渲染所有 DOM 节点                              │
│  ├── 复杂组件嵌套导致重排重绘                                   │
│  └── 图片解码阻塞主线程                                       │
│                                                             │
│  第三层：数据瓶颈                                             │
│  ├── 首屏接口串行请求                                         │
│  ├── 接口返回数据过大（未分页、未裁剪字段）                       │
│  └── 缺少本地缓存策略                                         │
└─────────────────────────────────────────────────────────────┘
```

本文聚焦**第一层：资源加载瓶颈**，这是投入产出比最高的优化方向。

---

## 二、首屏加载优化：从白屏到秒开

### 2.1 首屏加载的完整链路

要优化首屏，首先要理解从用户点击到首屏渲染完成的完整链路：

```
用户点击 App 图标
    │
    ▼
┌──────────────┐
│  应用启动     │  ← 冷启动：加载框架运行时
│  (App Launch) │  ← 热启动：恢复页面栈
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  页面加载     │  ← 加载页面 JS/CSS/模板
│  (onLoad)    │  ← 触发页面生命周期
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  数据请求     │  ← 调用首屏接口
│  (API Call)  │  ← 等待服务端响应
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  渲染完成     │  ← setData 触发视图更新
│  (onReady)   │  ← 首屏可见
└──────────────┘
```

**关键指标**：
- **FCP (First Contentful Paint)**：首次内容绘制，用户看到第一个像素的时间
- **LCP (Largest Contentful Paint)**：最大内容绘制，首屏主要内容可见的时间
- **TTI (Time to Interactive)**：可交互时间，用户可以点击操作的时间

### 2.2 骨架屏：感知性能的利器

骨架屏（Skeleton Screen）不是真正的性能优化，但它是**感知性能**最有效的手段。用户看到骨架屏时，心理等待时间会显著缩短。

**实现方案**：uni-app 条件编译 + 自定义骨架屏组件

```vue
<!-- components/SkeletonScreen.vue -->
<template>
  <view class="skeleton" v-if="loading">
    <!-- 头部导航骨架 -->
    <view class="skeleton-navbar">
      <view class="skeleton-avatar"></view>
      <view class="skeleton-title"></view>
    </view>
    
    <!-- Banner 骨架 -->
    <view class="skeleton-banner"></view>
    
    <!-- 商品列表骨架 -->
    <view class="skeleton-product-list">
      <view 
        class="skeleton-product-item" 
        v-for="i in 4" 
        :key="i"
      >
        <view class="skeleton-image"></view>
        <view class="skeleton-text"></view>
        <view class="skeleton-text short"></view>
        <view class="skeleton-price"></view>
      </view>
    </view>
  </view>
</template>

<script setup>
defineProps({
  loading: {
    type: Boolean,
    default: true
  }
})
</script>

<style scoped>
.skeleton {
  padding: 20rpx;
}

.skeleton-navbar {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
}

.skeleton-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-title {
  width: 300rpx;
  height: 40rpx;
  margin-left: 20rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-banner {
  width: 100%;
  height: 360rpx;
  border-radius: 16rpx;
  margin: 20rpx 0;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-product-list {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}

.skeleton-product-item {
  width: calc(50% - 10rpx);
  border-radius: 12rpx;
  overflow: hidden;
}

.skeleton-image {
  width: 100%;
  height: 340rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-text {
  height: 32rpx;
  margin: 16rpx 12rpx 0;
  border-radius: 6rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-text.short {
  width: 60%;
}

.skeleton-price {
  width: 120rpx;
  height: 36rpx;
  margin: 16rpx 12rpx;
  border-radius: 6rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
```

**使用方式**：

```vue
<!-- pages/index/index.vue -->
<template>
  <SkeletonScreen :loading="pageLoading" />
  <view v-show="!pageLoading">
    <!-- 真实内容 -->
    <Banner :list="bannerList" />
    <ProductList :list="productList" />
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'

const pageLoading = ref(true)

onMounted(async () => {
  try {
    // 并行请求首屏数据
    const [bannerRes, productRes] = await Promise.all([
      uni.request({ url: '/api/banner/list' }),
      uni.request({ url: '/api/product/hot', data: { page: 1, size: 10 } })
    ])
    
    bannerList.value = bannerRes.data
    productList.value = productRes.data
  } finally {
    pageLoading.value = false
  }
})
</script>
```

### 2.3 首屏接口并行化：从串行到并行

**反模式**：串行请求

```javascript
// ❌ 错误：串行请求，总耗时 = 200ms + 300ms + 150ms = 650ms
const bannerRes = await uni.request({ url: '/api/banner/list' })      // 200ms
const productRes = await uni.request({ url: '/api/product/hot' })     // 300ms
const categoryRes = await uni.request({ url: '/api/category/tree' })  // 150ms
```

**最佳实践**：并行请求

```javascript
// ✅ 正确：并行请求，总耗时 = max(200ms, 300ms, 150ms) = 300ms
const [bannerRes, productRes, categoryRes] = await Promise.all([
  uni.request({ url: '/api/banner/list' }),
  uni.request({ url: '/api/product/hot', data: { page: 1, size: 10 } }),
  uni.request({ url: '/api/category/tree' })
])
```

**进阶方案**：首屏数据预拉取

在 App 场景下，可以利用 `onLaunch` 生命周期预拉取首屏数据：

```javascript
// App.vue
export default {
  onLaunch() {
    // 预拉取首屏数据，存入全局状态
    this.prefetchHomeData()
  },
  methods: {
    async prefetchHomeData() {
      try {
        const [bannerRes, productRes] = await Promise.all([
          uni.request({ url: '/api/banner/list' }),
          uni.request({ url: '/api/product/hot', data: { page: 1, size: 10 } })
        ])
        
        // 存入全局状态，首页直接使用
        getApp().globalData.homeData = {
          banners: bannerRes.data,
          products: productRes.data,
          timestamp: Date.now()
        }
      } catch (e) {
        console.error('预拉取失败:', e)
      }
    }
  }
}
```

首页读取预拉取数据：

```javascript
// pages/index/index.vue
onLoad() {
  const homeData = getApp().globalData.homeData
  // 缓存有效期 5 分钟
  if (homeData && Date.now() - homeData.timestamp < 5 * 60 * 1000) {
    bannerList.value = homeData.banners
    productList.value = homeData.products
    pageLoading.value = false
    return
  }
  
  // 缓存过期，重新请求
  this.fetchHomeData()
}
```

### 2.4 首屏接口字段裁剪

**反模式**：接口返回所有字段

```json
// ❌ /api/product/hot 返回了 30+ 个字段，首屏只需要 6 个
{
  "id": 12345,
  "name": "商品名称",
  "price": 99.00,
  "original_price": 199.00,
  "description": "商品描述...",
  "detail_html": "<p>商品详情 HTML...</p>",  // ❌ 首屏不需要
  "sku_list": [...],                          // ❌ 首屏不需要
  "reviews": [...],                           // ❌ 首屏不需要
  "shipping_info": {...},                     // ❌ 首屏不需要
  "seo_meta": {...}                           // ❌ 首屏不需要
}
```

**最佳实践**：首屏接口只返回必要字段

```json
// ✅ /api/product/hot?fields=id,name,price,original_price,thumb,sales_count
{
  "id": 12345,
  "name": "商品名称",
  "price": 99.00,
  "original_price": 199.00,
  "thumb": "https://cdn.example.com/product/12345/thumb.jpg",
  "sales_count": 1234
}
```

服务端实现（Laravel）：

```php
// ProductController.php
public function hot(Request $request)
{
    $fields = $request->input('fields', 'id,name,price,original_price,thumb,sales_count');
    $fieldList = explode(',', $fields);
    
    $products = Product::query()
        ->where('is_hot', true)
        ->orderByDesc('sales_count')
        ->limit($request->input('size', 10))
        ->select($fieldList)
        ->get();
    
    return response()->json($products);
}
```

**效果**：接口响应体从 45KB 降至 8KB，减少 82%。

---

## 三、分包加载：突破包体限制的关键策略

### 3.1 为什么需要分包？

**小程序的包体限制**：

| 平台 | 主包限制 | 总包限制 | 分包大小限制 |
|------|---------|---------|-------------|
| 微信小程序 | 2MB | 20MB | 单个分包 2MB |
| 支付宝小程序 | 2MB | 8MB | 单个分包 2MB |
| 抖音小程序 | 2MB | 16MB | 单个分包 2MB |
| H5 | 无限制 | 无限制 | 建议首屏 < 200KB |
| App | 无限制 | 无限制 | 建议首屏 < 500KB |

**不分包的后果**：
- 主包超过 2MB → 小程序无法上传
- 所有页面代码打入主包 → 首屏加载时间过长
- 用户访问页面 A，但页面 B/C/D 的代码也被加载 → 浪费流量和内存

### 3.2 分包架构设计

**分包策略**：按业务模块划分

```
project/
├── pages/                    # 主包（首页、登录、TabBar 页面）
│   ├── index/               # 首页
│   ├── login/               # 登录
│   └── mine/                # 我的
│
├── pages-sub/                # 分包目录
│   ├── product/             # 商品模块分包
│   │   ├── list/            # 商品列表
│   │   ├── detail/          # 商品详情
│   │   └── search/          # 商品搜索
│   │
│   ├── order/               # 订单模块分包
│   │   ├── create/          # 创建订单
│   │   ├── list/            # 订单列表
│   │   ├── detail/          # 订单详情
│   │   └── pay/             # 支付
│   │
│   ├── cart/                # 购物车分包
│   │   └── index/           # 购物车页面
│   │
│   └── activity/            # 活动模块分包
│       ├── flash-sale/      # 秒杀
│       ├── blind-box/       # 盲盒
│       └── coupon/          # 优惠券
│
└── static/                   # 静态资源（独立分包）
    ├── images/
    └── fonts/
```

**pages.json 配置**：

```json
{
  "pages": [
    { "path": "pages/index/index", "style": { "navigationBarTitleText": "首页" } },
    { "path": "pages/login/index", "style": { "navigationBarTitleText": "登录" } },
    { "path": "pages/mine/index", "style": { "navigationBarTitleText": "我的" } }
  ],
  "subPackages": [
    {
      "root": "pages-sub/product",
      "pages": [
        { "path": "list/index", "style": { "navigationBarTitleText": "商品列表" } },
        { "path": "detail/index", "style": { "navigationBarTitleText": "商品详情" } },
        { "path": "search/index", "style": { "navigationBarTitleText": "搜索" } }
      ]
    },
    {
      "root": "pages-sub/order",
      "pages": [
        { "path": "create/index", "style": { "navigationBarTitleText": "创建订单" } },
        { "path": "list/index", "style": { "navigationBarTitleText": "订单列表" } },
        { "path": "detail/index", "style": { "navigationBarTitleText": "订单详情" } },
        { "path": "pay/index", "style": { "navigationBarTitleText": "支付" } }
      ]
    },
    {
      "root": "pages-sub/cart",
      "pages": [
        { "path": "index/index", "style": { "navigationBarTitleText": "购物车" } }
      ]
    },
    {
      "root": "pages-sub/activity",
      "pages": [
        { "path": "flash-sale/index", "style": { "navigationBarTitleText": "秒杀" } },
        { "path": "blind-box/index", "style": { "navigationBarTitleText": "盲盒" } },
        { "path": "coupon/index", "style": { "navigationBarTitleText": "优惠券" } }
      ]
    }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pages-sub/product"]
    },
    "pages-sub/product/detail/index": {
      "network": "all",
      "packages": ["pages-sub/order"]
    }
  }
}
```

### 3.3 分包预下载：预测用户行为

`preloadRule` 是小程序提供的**分包预下载**机制。当用户进入某个页面时，框架会自动下载指定的分包，用户点击时分包已经加载完成。

**预下载策略设计**：

```
用户进入首页
    │
    ├── 预下载商品分包（用户大概率会浏览商品）
    │
    ▼
用户进入商品详情
    │
    ├── 预下载订单分包（用户大概率会下单）
    │
    ▼
用户进入创建订单
    │
    ├── 预下载支付分包（用户需要支付）
```

**注意**：预下载有大小限制（微信小程序限制 2MB），不要预下载过多分包。

### 3.4 独立分包：完全独立的入口

独立分包（Independent Subpackage）是可以在不下载主包的情况下独立运行的分包。适用于**活动页面、分享落地页**等场景。

```json
{
  "subPackages": [
    {
      "root": "pages-sub/activity",
      "independent": true,
      "pages": [
        { "path": "flash-sale/index", "style": { "navigationBarTitleText": "限时秒杀" } },
        { "path": "blind-box/index", "style": { "navigationBarTitleText": "盲盒抽奖" } }
      ]
    }
  ]
}
```

**使用场景**：
- 用户通过分享链接直接进入活动页面，不需要加载主包
- 活动页面的生命周期独立于主应用
- 减少活动页面的首屏加载时间

**踩坑记录**：
- 独立分包不能使用主包的组件和 API，需要独立引入
- 独立分包的 `App.vue` 是独立的，不共享主包的全局状态
- 微信小程序的独立分包需要单独配置权限

### 3.5 分包体积分析与优化

**分析工具**：uni-app 自带的 `webpack-bundle-analyzer`

```bash
# 生成分析报告
npm run build -- --report

# 或者使用 vue.config.js 配置
```

```javascript
// vue.config.js
module.exports = {
  configureWebpack: {
    plugins: [
      new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)({
        analyzerMode: 'static',
        reportFilename: 'bundle-report.html',
        openAnalyzer: false
      })
    ]
  }
}
```

**常见优化手段**：

| 优化手段 | 效果 | 实施难度 |
|---------|------|---------|
| 按业务模块分包 | 主包减少 40-60% | 中 |
| 移除未使用的 npm 包 | 减少 100-500KB | 低 |
| 图片资源 CDN 化 | 主包减少 50-80% | 低 |
| 使用小程序插件替代大型 SDK | 减少 200-800KB | 高 |
| Tree Shaking 移除死代码 | 减少 5-15% | 低 |

**真实案例**：奇乐 MAX 电商项目分包优化

| 阶段 | 主包大小 | 总包大小 | 首屏加载时间 |
|------|---------|---------|-------------|
| 优化前 | 2.8MB ❌ | 18MB | 3.2s |
| 分包后 | 1.2MB ✅ | 16MB | 2.1s |
| CDN 化后 | 0.8MB ✅ | 16MB | 1.8s |
| 最终 | 0.6MB ✅ | 12MB | 1.5s |

---

## 四、图片懒加载：从全量加载到按需加载

### 4.1 图片加载的性能瓶颈

在电商项目中，图片资源通常占页面总体积的 60-80%。一个商品列表页可能包含 20-50 张商品图片，每张 100-300KB，总图片体积可达 5-15MB。

**问题**：
- 用户只看到首屏 4-6 张图片，但加载了全部 50 张
- 图片解码阻塞主线程，导致滚动卡顿
- 低端设备内存溢出（OOM）

### 4.2 uni-app 原生懒加载

uni-app 的 `image` 组件支持 `lazy-load` 属性：

```vue
<template>
  <view class="product-list">
    <view class="product-item" v-for="item in productList" :key="item.id">
      <!-- 使用 lazy-load 属性 -->
      <image 
        :src="item.thumb" 
        mode="aspectFill" 
        lazy-load
        class="product-image"
      />
      <text class="product-name">{{ item.name }}</text>
      <text class="product-price">¥{{ item.price }}</text>
    </view>
  </view>
</template>
```

**原理**：当 `image` 组件进入可视区域（默认距离底部 200px）时，才开始加载图片。

**局限性**：
- 只在微信小程序和 App 端生效，H5 不支持
- 无法自定义占位图
- 无法控制加载时机（如提前 500px 开始加载）
- 无法实现渐进式加载（先加载模糊图，再加载清晰图）

### 4.3 自定义懒加载组件

为了跨端兼容和更精细的控制，我们实现了一个自定义的懒加载组件：

```vue
<!-- components/LazyImage.vue -->
<template>
  <view ref="containerRef" class="lazy-image-wrapper" :style="{ width, height }">
    <!-- 占位图 -->
    <image 
      v-if="!loaded && !error"
      :src="placeholder"
      mode="aspectFill"
      class="lazy-image placeholder"
    />
    
    <!-- 实际图片 -->
    <image 
      v-show="loaded"
      :src="currentSrc"
      :mode="mode"
      class="lazy-image"
      @load="onLoad"
      @error="onError"
    />
    
    <!-- 错误状态 -->
    <view v-if="error" class="lazy-image-error">
      <text class="error-text">加载失败</text>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  placeholder: { type: String, default: '/static/images/placeholder.png' },
  mode: { type: String, default: 'aspectFill' },
  width: { type: String, default: '100%' },
  height: { type: String, default: '400rpx' },
  // 提前加载的距离（px）
  rootMargin: { type: Number, default: 200 },
  // 是否启用渐进式加载
  progressive: { type: Boolean, default: false },
  // 模糊图 URL（渐进式加载时使用）
  blurSrc: { type: String, default: '' }
})

const loaded = ref(false)
const error = ref(false)
const currentSrc = ref(props.progressive ? props.blurSrc : '')
const observer = ref(null)
const containerRef = ref(null)

// 检查元素是否在可视区域内
function isInViewport(rect) {
  const windowHeight = uni.getSystemInfoSync().windowHeight
  return rect.top < windowHeight + props.rootMargin && rect.bottom > -props.rootMargin
}

// 开始加载图片
function startLoad() {
  if (loaded.value || error.value) return
  
  if (props.progressive && props.blurSrc) {
    // 渐进式加载：先显示模糊图
    currentSrc.value = props.blurSrc
    // 延迟加载清晰图
    setTimeout(() => {
      currentSrc.value = props.src
    }, 100)
  } else {
    currentSrc.value = props.src
  }
}

// 图片加载成功
function onLoad() {
  loaded.value = true
  error.value = false
}

// 图片加载失败
function onError() {
  error.value = true
  loaded.value = false
}

// 使用 IntersectionObserver（H5 和部分小程序支持）
function setupObserver() {
  // #ifdef H5
  if (typeof IntersectionObserver !== 'undefined') {
    observer.value = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            startLoad()
            observer.value?.disconnect()
          }
        })
      },
      { rootMargin: `${props.rootMargin}px` }
    )
    
    // 需要在 nextTick 后获取 DOM
    setTimeout(() => {
      const el = containerRef.value?.$el || containerRef.value
      if (el) observer.value.observe(el)
    }, 100)
    return
  }
  // #endif
  
  // 降级方案：使用 uni.createIntersectionObserver
  // #ifdef MP-WEIXIN || MP-ALIPAY
  const query = uni.createSelectorQuery()
  query.select('.lazy-image-wrapper').boundingClientRect(rect => {
    if (rect && isInViewport(rect)) {
      startLoad()
    } else {
      // 使用页面级 IntersectionObserver
      const pageObserver = uni.createIntersectionObserver()
      pageObserver.relativeToViewport({ bottom: props.rootMargin })
      pageObserver.observe('.lazy-image-wrapper', (res) => {
        if (res.intersectionRatio > 0) {
          startLoad()
          pageObserver.disconnect()
        }
      })
    }
  }).exec()
  // #endif
  
  // App 端降级：直接加载
  // #ifdef APP-PLUS
  startLoad()
  // #endif
}

onMounted(() => {
  setupObserver()
})

onUnmounted(() => {
  observer.value?.disconnect()
})

watch(() => props.src, (newSrc) => {
  if (newSrc && newSrc !== currentSrc.value) {
    loaded.value = false
    error.value = false
    currentSrc.value = ''
    setupObserver()
  }
})
</script>

<style scoped>
.lazy-image-wrapper {
  position: relative;
  overflow: hidden;
  background-color: #f5f5f5;
}

.lazy-image {
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;
}

.lazy-image.placeholder {
  opacity: 0.6;
}

.lazy-image-error {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f5f5f5;
}

.error-text {
  color: #999;
  font-size: 24rpx;
}
</style>
```

**使用方式**：

```vue
<template>
  <view class="product-list">
    <view class="product-item" v-for="item in productList" :key="item.id">
      <LazyImage 
        :src="item.thumb"
        :blur-src="item.thumb_blur"
        :progressive="true"
        width="100%"
        height="400rpx"
        mode="aspectFill"
      />
      <text class="product-name">{{ item.name }}</text>
    </view>
  </view>
</template>
```

### 4.4 图片 CDN 优化策略

除了懒加载，图片本身的优化也至关重要：

**1. WebP 格式**

```javascript
// utils/image.js
export function getImageUrl(url, options = {}) {
  const {
    width = 0,
    height = 0,
    quality = 80,
    format = 'webp'
  } = options
  
  // 如果是 CDN 地址，使用图片处理参数
  if (url.includes('cdn.example.com')) {
    const params = []
    if (width) params.push(`w_${width}`)
    if (height) params.push(`h_${height}`)
    params.push(`q_${quality}`)
    params.push(`f_${format}`)
    
    return `${url}?x-oss-process=image/resize,${params.join(',')}`
  }
  
  return url
}

// 使用
const thumbUrl = getImageUrl(product.thumb, {
  width: 750,
  height: 750,
  quality: 80,
  format: 'webp'
})
```

**2. 响应式图片**

```vue
<template>
  <image 
    :src="responsiveSrc"
    mode="aspectFill"
    class="product-image"
  />
</template>

<script setup>
import { computed } from 'vue'
import { getImageUrl } from '@/utils/image'

const props = defineProps({
  src: { type: String, required: true }
})

const screenWidth = uni.getSystemInfoSync().screenWidth

const responsiveSrc = computed(() => {
  // 根据屏幕宽度加载不同尺寸的图片
  const width = Math.min(screenWidth * 2, 1080) // 2x 分辨率，最大 1080px
  return getImageUrl(props.src, { width, quality: 80, format: 'webp' })
})
</script>
```

**3. 图片压缩策略**

| 场景 | 格式 | 质量 | 尺寸 | 预期大小 |
|------|------|------|------|---------|
| 商品列表缩略图 | WebP | 75% | 400x400 | 15-30KB |
| 商品详情主图 | WebP | 85% | 750x750 | 50-80KB |
| Banner 轮播图 | WebP | 80% | 750x360 | 30-50KB |
| 用户头像 | WebP | 70% | 200x200 | 5-10KB |
| 背景图 | WebP | 60% | 750x200 | 10-20KB |

---

## 五、对比分析：不同优化方案的效果对比

### 5.1 首屏优化方案对比

| 方案 | 实施成本 | FCP 提升 | LCP 提升 | 适用场景 |
|------|---------|---------|---------|---------|
| 骨架屏 | 低 | 感知提升 40% | 感知提升 30% | 所有页面 |
| 接口并行化 | 低 | 30-50% | 20-40% | 多接口页面 |
| 字段裁剪 | 中 | 10-20% | 15-25% | 数据密集型页面 |
| 数据预拉取 | 中 | 40-60% | 30-50% | 首页、活动页 |
| SSR/预渲染 | 高 | 60-80% | 50-70% | SEO 需求页面 |

### 5.2 分包方案对比

| 方案 | 主包减少 | 首屏提升 | 维护成本 | 适用场景 |
|------|---------|---------|---------|---------|
| 按业务模块分包 | 40-60% | 30-50% | 低 | 所有小程序 |
| 独立分包 | 20-30% | 50-70% | 中 | 活动页、分享落地页 |
| 分包预下载 | 0% | 20-40% | 低 | 用户行为可预测 |
| npm 包优化 | 10-30% | 10-20% | 中 | 依赖大型 SDK |

### 5.3 图片优化方案对比

| 方案 | 体积减少 | 加载速度 | 视觉体验 | 兼容性 |
|------|---------|---------|---------|--------|
| 原生 lazy-load | 0% | 提升 50% | 一般 | 小程序/App |
| 自定义懒加载 | 0% | 提升 60% | 好 | 全端 |
| WebP 格式 | 25-35% | 提升 30% | 无损 | H5/小程序/App |
| 响应式图片 | 40-60% | 提升 40% | 无损 | 全端 |
| 渐进式加载 | 0% | 感知提升 50% | 好 | H5/小程序 |

---

## 六、真实踩坑记录

### 6.1 踩坑 1：分包后的组件引用问题

**问题**：分包后，主包的组件在分包页面中无法使用。

**原因**：uni-app 的分包机制要求分包内的页面只能引用本分包和主包的组件。

**解决方案**：将共享组件放在主包的 `components` 目录下：

```
project/
├── components/              # 主包共享组件
│   ├── LazyImage.vue
│   ├── ProductCard.vue
│   └── PriceTag.vue
│
├── pages-sub/
│   ├── product/
│   │   ├── components/      # 分包私有组件
│   │   │   ├── ProductGallery.vue
│   │   │   └── SkuSelector.vue
│   │   ├── detail/
│   │   └── list/
```

### 6.2 踩坑 2：图片懒加载在 H5 端不生效

**问题**：`image` 组件的 `lazy-load` 属性在 H5 端不生效。

**原因**：uni-app 的 H5 端不支持原生的 `lazy-load`。

**解决方案**：使用自定义的 `IntersectionObserver` 实现：

```javascript
// #ifdef H5
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target
        img.src = img.dataset.src
        observer.unobserve(img)
      }
    })
  }, { rootMargin: '200px' })
  
  document.querySelectorAll('img[data-src]').forEach(img => {
    observer.observe(img)
  })
}
// #endif
```

### 6.3 踩坑 3：预下载导致内存溢出

**问题**：配置了过多的预下载规则，导致小程序内存溢出。

**原因**：预下载的分包会占用内存，如果预下载过多，会导致内存不足。

**解决方案**：只预下载用户最可能访问的下一个分包：

```json
{
  "preloadRule": {
    "pages/index/index": {
      "network": "wifi",
      "packages": ["pages-sub/product"]
    }
  }
}
```

### 6.4 踩坑 4：WebP 图片在低版本 Android 不显示

**问题**：WebP 格式的图片在 Android 4.x 设备上不显示。

**原因**：Android 4.0 以下不支持 WebP 格式。

**解决方案**：使用 CDN 的图片处理能力，根据设备自动选择格式：

```javascript
function getImageUrl(url) {
  const systemInfo = uni.getSystemInfoSync()
  const isAndroidLow = systemInfo.platform === 'android' && 
    parseInt(systemInfo.system.split(' ')[1]) < 5
  
  if (isAndroidLow) {
    // 低版本 Android 使用 JPEG
    return `${url}?x-oss-process=image/resize,w_750/format,jpg/quality,q_80`
  }
  
  // 其他设备使用 WebP
  return `${url}?x-oss-process=image/resize,w_750/format,webp/quality,q_80`
}
```

---

## 七、性能优化后的效果

经过以上优化，我们在三个端上的首屏性能数据如下：

| 指标 | H5 (Chrome) | 微信小程序 | App (Android) |
|------|-------------|-----------|---------------|
| 首屏 FCP | 3.2s → 1.2s | 2.8s → 1.0s | 2.1s → 0.8s |
| 首屏 LCP | 5.8s → 2.1s | 4.5s → 1.8s | 3.2s → 1.2s |
| JS Bundle 大小 | 1.8MB → 0.6MB | 1.2MB → 0.5MB | 1.5MB → 0.7MB |
| 图片资源总量 | 4.2MB → 0.8MB | 3.8MB → 0.6MB | 4.0MB → 0.7MB |
| 首屏请求数 | 28 → 12 | 22 → 8 | 25 → 10 |

**关键提升**：
- **FCP 平均提升 60%**：从 2.7s 降至 1.0s
- **LCP 平均提升 62%**：从 4.5s 降至 1.7s
- **JS Bundle 平均减少 58%**：从 1.5MB 降至 0.6MB
- **图片资源平均减少 82%**：从 4.0MB 降至 0.7MB

---

## 八、最佳实践与反模式

### 8.1 最佳实践

1. **首屏数据预拉取**：在 `onLaunch` 中预拉取首屏数据，减少首屏等待时间
2. **接口并行化**：使用 `Promise.all` 并行请求多个接口
3. **字段裁剪**：首屏接口只返回必要字段，减少数据传输量
4. **骨架屏**：所有首屏页面都使用骨架屏，提升感知性能
5. **分包预下载**：预下载用户最可能访问的下一个分包
6. **图片懒加载**：所有非首屏图片都使用懒加载
7. **WebP 格式**：优先使用 WebP 格式，减少图片体积
8. **响应式图片**：根据屏幕宽度加载不同尺寸的图片

### 8.2 反模式

1. **❌ 所有页面打入主包**：导致主包过大，首屏加载慢
2. **❌ 串行请求首屏数据**：导致首屏等待时间过长
3. **❌ 接口返回所有字段**：浪费带宽，增加解析时间
4. **❌ 不使用骨架屏**：用户看到白屏，体验差
5. **❌ 全量加载图片**：浪费流量，占用内存
6. **❌ 使用 PNG/JPG 格式**：图片体积大，加载慢
7. **❌ 预下载所有分包**：占用内存，可能导致 OOM
8. **❌ 不分析分包体积**：无法发现体积异常

---

## 九、扩展思考

### 9.1 与 SSR 的结合

对于 SEO 要求高的 H5 页面，可以考虑 SSR（Server-Side Rendering）：

```
用户请求
    │
    ▼
┌──────────────┐
│  服务端渲染   │  ← 返回完整的 HTML
│  (SSR)       │  ← 首屏立即可见
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  客户端激活   │  ← Vue 水合（Hydration）
│  (Hydration) │  ← 页面可交互
└──────────────┘
```

### 9.2 与 PWA 的结合

H5 端可以考虑 PWA（Progressive Web App）：

- **Service Worker**：缓存静态资源，减少网络请求
- **App Shell**：应用外壳缓存，首屏秒开
- **离线访问**：无网络时也能访问缓存内容

### 9.3 与小程序云开发的结合

小程序云开发提供了云函数、云数据库、云存储等能力：

- **云函数**：减少首屏接口的网络延迟（同机房调用）
- **云数据库**：数据就近访问，减少跨区域延迟
- **云存储**：图片 CDN 自动加速，支持 WebP

### 9.4 未来趋势

1. **小程序 Skyline 渲染引擎**：微信正在推出的新渲染引擎，性能提升 30-50%
2. **WebAssembly**：将计算密集型逻辑编译为 WASM，提升执行性能
3. **HTTP/3**：基于 QUIC 协议，减少连接建立时间
4. **WebGPU**：下一代图形 API，提升渲染性能

---

## 总结

uni-app 性能优化的核心是**资源加载策略**：

1. **首屏优化**：骨架屏 + 接口并行化 + 字段裁剪 + 数据预拉取
2. **分包优化**：按业务模块分包 + 预下载 + 独立分包
3. **图片优化**：懒加载 + WebP + 响应式图片 + CDN

这三个维度的优化可以显著提升用户体验，同时降低服务器成本。在实际项目中，建议先分析性能瓶颈，再针对性优化，避免过度优化。

---

## 相关阅读

- [uni-app 微信小程序实战：登录、支付、分享完整流程](/post/uni-app-guide-1/)
- [uni-app + Vue 3 + Vite 现代跨平台开发工作流实战踩坑记录](/post/uni-app-vue3-vite/)
- [uni-app Native.js 原生插件开发实战](/post/uni-app-native-js-guide-sdk/)
- [uni-app + ThinkPHP 商品详情页性能优化与预加载策略](/post/uni-app-thinkphp-product-detail-performance-preload/)

---

**参考资料**：
- [uni-app 官方文档 - 分包加载](https://uniapp.dcloud.net.cn/collocation/pages.html#subpackages)
- [微信小程序 - 分包加载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html)
- [Web.dev - Lazy Loading Images](https://web.dev/lazy-loading-images/)
- [MDN - IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver)
