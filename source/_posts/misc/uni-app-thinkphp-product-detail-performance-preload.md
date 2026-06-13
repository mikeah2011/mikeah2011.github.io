---

title: uni-app + ThinkPHP 商品详情页性能优化与预加载策略实战踩坑记录
keywords: [uni, app, ThinkPHP, 商品详情页性能优化与预加载策略实战踩坑记录]
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
date: 2026-06-01 12:00:00
categories:
- misc
tags:
- uni-app
- ThinkPHP
- 性能优化
- 预加载
- 商品详情页
- 奇乐MAX
- 盲盒电商
description: 基于奇乐 MAX（qile-max）盲盒电商真实项目，深度拆解 uni-app 商品详情页从 3.2s 降到 800ms 的性能优化全链路：ThinkPHP 后端聚合接口设计、前端骨架屏 + 数据预加载 + 图片懒加载 + 虚拟列表、Redis 缓存分层策略，以及 6 个真实生产踩坑记录。
---



## 一、问题背景：盲盒电商的商品详情页为什么这么慢？

奇乐 MAX 是一个盲盒/抽奖电商平台，用户打开一个盲盒活动的详情页时，需要加载的内容远比传统电商复杂：

```
┌───────────────────────────────────────────────────┐
│                  盲盒详情页数据需求                   │
├───────────────────────────────────────────────────┤
│  1. 盲盒基础信息（标题/价格/描述/封面图/视频）         │
│  2. 奖品池（可能有 20-100 个奖品，含图片+概率+稀有度） │
│  3. 用户已抽记录（最近 10-20 次抽取结果）              │
│  4. 全平台滚动播报（最近 50 条中奖记录，实时更新）      │
│  5. 用户剩余次数/积分/优惠券                          │
│  6. 相关推荐盲盒（6-8 个）                           │
│  7. 评论/弹幕区（最近 20 条）                        │
│  8. 分享配置（海报/链接/二维码）                      │
└───────────────────────────────────────────────────┘
```

在早期版本中，前端在 `onLoad` 中串行调用了 **7 个独立 API**，每个 API 平均耗时 200-500ms，加上网络抖动和图片渲染，首次有意义绘制（FMP）高达 **3.2 秒**。用户点击盲盒到看到详情页，中间有一个明显的白屏等待——在移动端，这是致命的跳出率杀手。

本文记录了我们如何将详情页加载时间从 **3.2s → 800ms**（含图片渐进加载）的完整优化过程，覆盖后端接口聚合、前端渲染优化、缓存分层、预加载策略四个维度。

---

## 二、架构设计：优化前后的数据流对比

### 2.1 优化前：7 次串行请求

```mermaid
sequenceDiagram
    participant U as uni-app 客户端
    participant T as ThinkPHP API

    U->>T: 1. GET /api/blindbox/{id} (基础信息)
    T-->>U: 200 OK [280ms]
    U->>T: 2. GET /api/blindbox/{id}/prizes (奖品池)
    T-->>U: 200 OK [350ms]
    U->>T: 3. GET /api/blindbox/{id}/records (用户记录)
    T-->>U: 200 OK [200ms]
    U->>T: 4. GET /api/blindbox/{id}/broadcast (全平台播报)
    T-->>U: 200 OK [180ms]
    U->>T: 5. GET /api/user/wallet (用户余额)
    T-->>U: 200 OK [150ms]
    U->>T: 6. GET /api/blindbox/{id}/recommend (推荐)
    T-->>U: 200 OK [320ms]
    U->>T: 7. GET /api/blindbox/{id}/comments (评论)
    T-->>U: 200 OK [250ms]

    Note over U,T: 总耗时 ≈ 1730ms (纯网络) + JS解析/渲染 ≈ 3200ms
```

**核心问题**：

| 问题 | 影响 | 量化 |
|------|------|------|
| 串行请求 | 前一个完成才发下一个 | 7 次 RTT 累加 |
| 无缓存策略 | 每次进页面都重新请求 | 重复数据占 60% |
| 图片一次性加载 | 100 个奖品图片同时请求 | 首屏被图片阻塞 |
| 无骨架屏 | 白屏等待 | 用户感知极差 |
| 数据全量返回 | 不需要的字段也传了 | 响应体过大 |

### 2.2 优化后：聚合接口 + 分层加载

```mermaid
sequenceDiagram
    participant U as uni-app 客户端
    participant C as 本地缓存层
    participant T as ThinkPHP 聚合 API
    participant R as Redis

    Note over U: 页面跳转前（预加载）
    U->>C: 检查缓存
    C-->>U: 命中 → 直接渲染骨架屏+基础数据

    U->>T: POST /api/blindbox/{id}/detail (聚合接口)
    T->>R: MGET blindbox:info / prizes / broadcast
    R-->>T: 缓存命中 [5ms]
    T-->>U: 聚合响应 [80ms]

    Note over U: 首屏渲染完成 [≈300ms]

    U->>T: GET /api/blindbox/{id}/user-context (用户态)
    T-->>U: [120ms]

    Note over U: 用户态数据填充 [≈500ms]

    U->>T: GET /api/blindbox/{id}/recommend (懒加载)
    T-->>U: [200ms]

    Note over U: 推荐区渲染 [≈800ms]
```

**核心优化策略**：

```
┌─────────────────────────────────────────────────────────────┐
│                    四层优化架构                                │
├──────────────┬──────────────────────────────────────────────┤
│  第一层       │ 后端接口聚合（7→2 个请求）                     │
│  接口层       │ 公共数据 + 用户态数据分离                      │
├──────────────┼──────────────────────────────────────────────┤
│  第二层       │ Redis 三级缓存（热数据 / 温数据 / 冷数据）     │
│  缓存层       │ 不同 TTL 策略 + 主动失效机制                   │
├──────────────┼──────────────────────────────────────────────┤
│  第三层       │ 骨架屏 + 图片懒加载 + 虚拟列表                 │
│  渲染层       │ 渐进式渲染，首屏优先                           │
├──────────────┼──────────────────────────────────────────────┤
│  第四层       │ 页面跳转前预加载 + 本地缓存                     │
│  预加载层     │ uni.navigateTo 预请求 + Storage 缓存          │
└──────────────┴──────────────────────────────────────────────┘
```

---

## 三、后端优化：ThinkPHP 聚合接口设计

### 3.1 聚合接口的核心思想

将 7 个独立接口合并为 2 个：

- **公共聚合接口** (`/api/blindbox/{id}/detail`)：基础信息 + 奖品池 + 全平台播报 + 推荐——这些数据对所有用户相同，可深度缓存
- **用户态接口** (`/api/blindbox/{id}/user-context`)：用户记录、余额、优惠券——这些数据需要鉴权且因人而异

**为什么分成 2 个而不是 1 个？**

公共数据的缓存命中率极高（所有用户共享），而用户态数据无法缓存。混合在一起会导致：
1. 整个响应无法 CDN 缓存（含用户私有数据）
2. 每次请求都要走鉴权中间件（即使看公共数据）
3. 用户态数据变更会污染公共数据缓存

### 3.2 聚合接口实现代码

```php
<?php
// app/controller/api/BlindBoxDetailController.php

declare(strict_types=1);

namespace app\controller\api;

use app\service\BlindBox\BlindBoxDetailService;
use app\service\Cache\BlindBoxCacheService;
use app\middleware\AuthOptional; // 可选鉴权

class BlindBoxDetailController extends BaseController
{
    public function __construct(
        private readonly BlindBoxDetailService $detailService,
        private readonly BlindBoxCacheService  $cacheService,
    ) {}

    /**
     * 公共聚合接口：盲盒详情（基础 + 奖品 + 播报 + 推荐）
     * 
     * 设计要点：
     * 1. 不强制鉴权（游客也能看）
     * 2. 数据从 Redis 三级缓存读取
     * 3. 响应体带 ETag，支持客户端条件请求
     */
    public function detail(int $id): \think\response\Json
    {
        // 1. 尝试从 Redis 读取聚合缓存
        $cacheKey = "blindbox:detail:aggregate:{$id}";
        $cached = $this->cacheService->getAggregate($cacheKey);

        if ($cached !== null) {
            // 生成 ETag（基于内容 hash）
            $etag = '"' . md5($cached) . '"';

            // 支持 304 条件请求
            if (request()->header('If-None-Match') === $etag) {
                return response('', 304)
                    ->header('ETag', $etag)
                    ->header('Cache-Control', 'public, max-age=10');
            }

            return json([
                'code'    => 0,
                'message' => 'success',
                'data'    => json_decode($cached, true),
            ])
            ->header('ETag', $etag)
            ->header('Cache-Control', 'public, max-age=10');
        }

        // 2. 缓存未命中，聚合查询
        $data = $this->detailService->aggregateDetail($id);

        // 3. 写入缓存（TTL 根据盲盒状态动态调整）
        $ttl = $this->cacheService->calculateTTL($data['status']);
        $this->cacheService->setAggregate($cacheKey, json_encode($data), $ttl);

        return json([
            'code'    => 0,
            'message' => 'success',
            'data'    => $data,
        ]);
    }

    /**
     * 用户态接口：用户特定数据（记录/余额/优惠券）
     *
     * 设计要点：
     * 1. 必须鉴权
     * 2. 不缓存（或极短缓存 5s）
     * 3. 轻量化响应，只返回必要字段
     */
    public function userContext(int $id): \think\response\Json
    {
        $userId = $this->getUserId(); // 从 JWT 中获取

        $data = $this->detailService->getUserContext($id, $userId);

        return json([
            'code'    => 0,
            'message' => 'success',
            'data'    => $data,
        ]);
    }
}
```

### 3.3 聚合服务层：并发查询 + 结果组装

```php
<?php
// app/service/BlindBox/BlindBoxDetailService.php

declare(strict_types=1);

namespace app\service\BlindBox;

use app\model\BlindBox;
use app\model\BlindBoxPrize;
use app\model\BlindBoxRecord;
use app\model\BroadcastRecord;
use app\model\UserWallet;

class BlindBoxDetailService
{
    public function __construct(
        private readonly BlindBoxPrizeService   $prizeService,
        private readonly BroadcastService       $broadcastService,
        private readonly RecommendService       $recommendService,
    ) {}

    /**
     * 聚合盲盒详情数据
     *
     * 关键优化：使用 ThinkPHP 的 Db::async() 并发查询（ThinkPHP 8.x 特性）
     * 或者退化为顺序查询 + Redis Pipeline 批量读取
     */
    public function aggregateDetail(int $blindBoxId): array
    {
        // 方案 A：Redis Pipeline 批量读取（推荐，延迟最低）
        $redis = app()->cache->store('redis')->handler();
        
        $pipeline = $redis->pipeline();
        $pipeline->hGetAll("blindbox:info:{$blindBoxId}");
        $pipeline->lRange("blindbox:prizes:{$blindBoxId}", 0, -1);
        $pipeline->lRange("blindbox:broadcast:{$blindBoxId}", 0, 49);
        $pipeline->lRange("blindbox:recommend:{$blindBoxId}", 0, 7);
        $results = $pipeline->exec();

        [$infoRaw, $prizesRaw, $broadcastRaw, $recommendRaw] = $results;

        // 如果 Redis 中有任何数据缺失，走 DB 兜底
        if (empty($infoRaw)) {
            return $this->aggregateFromDB($blindBoxId);
        }

        return [
            'info'      => $this->parseInfo($infoRaw),
            'prizes'    => $this->parsePrizes($prizesRaw),
            'broadcast' => $this->parseBroadcast($broadcastRaw),
            'recommend' => $this->parseRecommend($recommendRaw),
            'cached_at' => time(),
        ];
    }

    /**
     * DB 兜底查询（Redis 缓存 miss 时使用）
     */
    private function aggregateFromDB(int $blindBoxId): array
    {
        // 顺序查询（此时 Redis 为空，需要回写缓存）
        $info = BlindBox::with(['category', 'coverImage'])
            ->find($blindBoxId);

        if (!$info || $info->status === BlindBox::STATUS_DELETED) {
            throw new \app\exception\BusinessException('盲盒不存在', 40401);
        }

        $prizes = BlindBoxPrize::where('blind_box_id', $blindBoxId)
            ->with(['image'])
            ->order('sort_order', 'asc')
            ->select()
            ->toArray();

        $broadcast = BroadcastRecord::where('blind_box_id', $blindBoxId)
            ->order('created_at', 'desc')
            ->limit(50)
            ->select()
            ->toArray();

        $recommend = $this->recommendService->getRecommendBlindBoxes($blindBoxId);

        // 回写 Redis 缓存（异步，不阻塞响应）
        $this->writeBackCache($blindBoxId, $info, $prizes, $broadcast, $recommend);

        return [
            'info'      => $this->formatInfo($info),
            'prizes'    => $this->formatPrizes($prizes),
            'broadcast' => $this->formatBroadcast($broadcast),
            'recommend' => $this->formatRecommend($recommend),
            'cached_at' => time(),
        ];
    }

    /**
     * 根据盲盒状态计算缓存 TTL
     *
     * 设计权衡：
     * - 未开始：长缓存（数据不变）
     * - 进行中：短缓存（播报/库存实时变化）
     * - 已结束：长缓存（数据冻结）
     */
    private function calculateTTL(string $status): int
    {
        return match ($status) {
            'pending'   => 3600,    // 1 小时
            'active'    => 10,      // 10 秒（高频更新）
            'finished'  => 86400,   // 24 小时
            default     => 60,
        };
    }
}
```

### 3.4 接口响应体精简

**优化前**的响应体（单个接口，全量字段）：

```json
{
    "id": 1234,
    "title": "超值盲盒A",
    "description": "很长很长的描述文本...",
    "price": 9.90,
    "currency": "CNY",
    "status": "active",
    "category_id": 5,
    "category_name": "数码",
    "cover_image_url": "https://cdn.example.com/...",
    "video_url": "https://cdn.example.com/...",
    "rules": "很长的规则文本...",
    "prizes": [
        {
            "id": 1,
            "name": "iPhone 15",
            "description": "很长的描述...",
            "image_url": "https://cdn.example.com/...",
            "probability": 0.001,
            "rarity": "legendary",
            "stock": 1,
            "total_stock": 100,
            "market_price": 7999.00,
            "weight": 0.001,
            "tags": ["数码", "苹果", "手机"]
        }
    ]
}
```

**优化后**——奖品只返回首屏需要的字段：

```json
{
    "info": {
        "id": 1234,
        "title": "超值盲盒A",
        "price": 9.90,
        "status": "active",
        "cover": "https://cdn.example.com/sm.webp",
        "total_prizes": 28
    },
    "prizes": [
        {
            "id": 1,
            "name": "iPhone 15",
            "img": "https://cdn.example.com/sm.webp",
            "rarity": 3
        }
    ],
    "broadcast": [
        {"user": "138****1234", "prize": "AirPods", "ago": "刚刚"}
    ],
    "recommend": [
        {"id": 456, "title": "盲盒B", "cover": "...", "price": 19.90}
    ]
}
```

**体积对比**：原始 ~12KB → 优化后 ~3KB（gzip 后 ~1KB）

---

## 四、前端优化：uni-app 渲染性能全链路

### 4.1 骨架屏：消除白屏感知

骨架屏的核心思想是在数据到达前，先展示一个与实际布局一致的灰色占位，避免白屏。

```vue
<!-- components/ProductDetailSkeleton.vue -->
<template>
  <view class="skeleton-wrapper">
    <!-- 封面图骨架 -->
    <view class="skeleton-cover" />

    <!-- 标题区骨架 -->
    <view class="skeleton-title-block">
      <view class="skeleton-line skeleton-line--long" />
      <view class="skeleton-line skeleton-line--short" />
    </view>

    <!-- 价格区骨架 -->
    <view class="skeleton-price-block">
      <view class="skeleton-line skeleton-line--price" />
      <view class="skeleton-btn" />
    </view>

    <!-- 奖品网格骨架 -->
    <view class="skeleton-prize-grid">
      <view
        v-for="i in 8"
        :key="i"
        class="skeleton-prize-item"
      >
        <view class="skeleton-img" />
        <view class="skeleton-line skeleton-line--tiny" />
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 骨架屏组件
 *
 * 设计要点：
 * 1. 布局与真实页面完全一致（避免布局抖动）
 * 2. 使用 CSS animation 模拟「流光」效果
 * 3. 组件化，可在多个页面复用
 */
</script>

<style lang="scss" scoped>
.skeleton-wrapper {
  padding: 24rpx;
}

.skeleton-cover {
  width: 100%;
  height: 600rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 16rpx;
}

.skeleton-line {
  height: 32rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8rpx;
  margin-top: 16rpx;

  &--long { width: 80%; }
  &--short { width: 50%; }
  &--price { width: 30%; height: 48rpx; }
  &--tiny { width: 60%; height: 24rpx; }
}

.skeleton-prize-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;
}

.skeleton-prize-item {
  width: calc(25% - 12rpx);

  .skeleton-img {
    width: 100%;
    height: 160rpx;
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 12rpx;
  }
}

.skeleton-btn {
  width: 200rpx;
  height: 72rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 36rpx;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
```

### 4.2 图片懒加载：奖品列表按需加载

盲盒详情页的奖品池可能有 20-100 个奖品图片，一次性加载会导致：
- 网络带宽被挤占（100 张缩略图 ≈ 2-5MB）
- JS 主线程被图片解码阻塞
- 内存占用飙升（低端机直接 OOM）

**解决方案**：Intersection Observer + 渐进式图片加载

```vue
<!-- components/LazyImage.vue -->
<template>
  <view class="lazy-image-wrapper" :style="{ width, height }">
    <!-- 占位图（低质量占位） -->
    <image
      v-if="!loaded"
      :src="placeholder"
      class="lazy-image lazy-image--placeholder"
      mode="aspectFill"
    />

    <!-- 真实图片（懒加载） -->
    <image
      v-if="inView"
      :src="realSrc"
      :class="['lazy-image', { 'lazy-image--loaded': loaded }]"
      mode="aspectFill"
      @load="onLoad"
      @error="onError"
    />
  </view>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  placeholder: {
    type: String,
    default: '/static/images/placeholder-200x200.png'
  },
  width: { type: String, default: '100%' },
  height: { type: String, default: '160rpx' },
  // 距离视口多远开始加载（提前量）
  rootMargin: { type: String, default: '200px' },
})

const inView = ref(false)
const loaded = ref(false)
let observer = null

/**
 * 使用 Intersection Observer 实现懒加载
 *
 * 关键参数：
 * - rootMargin: '200px' → 距离视口 200px 时就开始加载
 *   为什么不是 0px？因为要提前加载，避免用户看到图片「闪烁」
 * - threshold: 0.01 → 只要 1% 进入就算可见
 */
onMounted(() => {
  // #ifdef H5
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          inView.value = true
          observer?.disconnect()
        }
      },
      { rootMargin: props.rootMargin, threshold: 0.01 }
    )
    // 注意：需要通过 ref 获取 DOM 元素
    // 在 uni-app 中，H5 端可以用 querySelector
  }
  // #endif

  // #ifdef APP-PLUS || MP-WEIXIN
  // 小程序/App 端使用 uni.createIntersectionObserver
  observer = uni.createIntersectionObserver(this, { thresholds: [0.01] })
  observer.relativeToViewport({ bottom: 200 })
  observer.observe('.lazy-image-wrapper', (res) => {
    if (res.intersectionRatio > 0) {
      inView.value = true
      observer?.disconnect()
    }
  })
  // #endif

  // 兜底：如果 IntersectionObserver 不可用，直接加载
  // #ifdef H5
  if (!('IntersectionObserver' in window)) {
    inView.value = true
  }
  // #endif
})

onUnmounted(() => {
  observer?.disconnect()
})

const onLoad = () => {
  loaded.value = true
}

const onError = () => {
  // 加载失败时回退到占位图
  loaded.value = false
}
</script>

<style lang="scss" scoped>
.lazy-image-wrapper {
  position: relative;
  overflow: hidden;
  border-radius: 12rpx;
  background-color: #f5f5f5;
}

.lazy-image {
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;

  &--placeholder {
    position: absolute;
    top: 0;
    left: 0;
    filter: blur(20px);
    transform: scale(1.1); // 避免模糊后的白边
  }

  &--loaded {
    opacity: 1;
  }

  &:not(&--loaded):not(&--placeholder) {
    opacity: 0;
  }
}
</style>
```

### 4.3 虚拟列表：全平台播报的长列表优化

全平台播报区域需要展示最近 50 条中奖记录，而且还在实时滚动更新。如果用 `v-for` 直接渲染 50 条 DOM，在低端安卓机上会出现明显卡顿。

```vue
<!-- components/VirtualBroadcastList.vue -->
<template>
  <scroll-view
    class="broadcast-scroll"
    scroll-y
    :scroll-top="scrollTop"
    @scrolltolower="loadMore"
  >
    <!-- 只渲染可见区域的 item（虚拟列表核心） -->
    <view
      v-for="item in visibleItems"
      :key="item.id"
      class="broadcast-item"
    >
      <image :src="item.avatar" class="broadcast-avatar" mode="aspectFill" />
      <view class="broadcast-info">
        <text class="broadcast-user">{{ item.maskedPhone }}</text>
        <text class="broadcast-text">抽中了</text>
        <text class="broadcast-prize">{{ item.prizeName }}</text>
      </view>
      <text class="broadcast-time">{{ item.timeAgo }}</text>
    </view>
  </scroll-view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  blindBoxId: { type: Number, required: true },
})

const allItems = ref([])
const scrollTop = ref(0)
const containerHeight = 300 // rpx → 转换为实际像素
const itemHeight = 88       // 每条播报的高度 (rpx)

/**
 * 虚拟列表核心：只计算可见区域的 item
 *
 * 为什么不用 uni-app 的 <virtual-list> 组件？
 * 1. 小程序端不完全支持 virtual-list
 * 2. 播报列表项高度固定，计算简单
 * 3. 自定义实现更灵活（支持实时插入新数据）
 */
const visibleItems = computed(() => {
  // 简化版：直接返回全部（50条以内性能OK）
  // 如果条数 > 200，才需要真正的虚拟滚动
  return allItems.value.slice(0, 30) // 只渲染前30条
})

// WebSocket 实时推送新播报
let wsConnection = null

onMounted(() => {
  loadInitialData()
  connectWebSocket()
})

onUnmounted(() => {
  wsConnection?.close()
})

async function loadInitialData() {
  const res = await uni.request({
    url: `/api/blindbox/${props.blindBoxId}/broadcast`,
    method: 'GET',
  })
  allItems.value = res.data.data.list
}

function connectWebSocket() {
  // 使用 uni.connectSocket 建立 WebSocket 连接
  wsConnection = uni.connectSocket({
    url: `wss://api.example.com/ws/broadcast/${props.blindBoxId}`,
    success() { console.log('WebSocket connected') }
  })

  wsConnection.onMessage((res) => {
    const newRecord = JSON.parse(res.data)
    // 插入到列表头部，保持最新在前
    allItems.value.unshift(newRecord)
    // 保持列表不超过 50 条
    if (allItems.value.length > 50) {
      allItems.value.pop()
    }
  })
}
</script>
```

---

## 五、Redis 缓存分层策略

### 5.1 三级缓存架构

盲盒详情页的数据有明显的「冷热分层」特征：

```
┌───────────────────────────────────────────────────────────┐
│                   Redis 三级缓存策略                        │
├──────────┬────────────┬────────────┬──────────────────────┤
│  层级    │  数据类型    │  TTL       │  Key 模式            │
├──────────┼────────────┼────────────┼──────────────────────┤
│  热数据  │  盲盒基础信息│  10s       │  blindbox:info:{id}  │
│          │  当前库存   │  (高频更新) │  blindbox:stock:{id} │
├──────────┼────────────┼────────────┼──────────────────────┤
│  温数据  │  奖品池     │  60s       │  blindbox:prizes:{id}│
│          │  全平台播报 │  (偶尔更新) │  blindbox:broadcast  │
├──────────┼────────────┼────────────┼──────────────────────┤
│  冷数据  │  推荐盲盒   │  3600s     │  blindbox:recommend  │
│          │  分类/标签  │  (很少变化) │  category:{id}       │
└──────────┴────────────┴────────────┴──────────────────────┘
```

### 5.2 缓存预热与主动失效

```php
<?php
// app/service/Cache/BlindBoxCacheService.php

declare(strict_types=1);

namespace app\service\Cache;

use think\facade\Cache;

class BlindBoxCacheService
{
    /**
     * 缓存预热：活动开始前主动加载数据到 Redis
     *
     * 在盲盒活动状态从 pending → active 时触发
     * 避免活动开始瞬间大量请求穿透到 DB
     */
    public function warmUp(int $blindBoxId): void
    {
        $info = BlindBox::find($blindBoxId);
        $prizes = BlindBoxPrize::where('blind_box_id', $blindBoxId)->select();

        // 使用 Redis Hash 存储基础信息（支持部分更新）
        $redis = $this->getRedis();

        $redis->hMSet("blindbox:info:{$blindBoxId}", [
            'id'        => $info->id,
            'title'     => $info->title,
            'price'     => $info->price,
            'status'    => $info->status,
            'cover'     => $info->cover_image_url,
            'stock'     => $info->total_stock,
        ]);
        $redis->expire("blindbox:info:{$blindBoxId}", 3600);

        // 奖品池用 List 存储（有序）
        $redis->del("blindbox:prizes:{$blindBoxId}");
        foreach ($prizes as $prize) {
            $redis->rPush("blindbox:prizes:{$blindBoxId}", json_encode([
                'id'     => $prize->id,
                'name'   => $prize->name,
                'img'    => $prize->image_url,
                'rarity' => $prize->rarity_level,
            ]));
        }
        $redis->expire("blindbox:prizes:{$blindBoxId}", 3600);
    }

    /**
     * 局部失效：只刷新变化的字段
     *
     * 场景：用户抽中奖品后，只需要更新库存和播报
     * 不需要清除整个聚合缓存
     */
    public function invalidateStock(int $blindBoxId, int $prizeId): void
    {
        $redis = $this->getRedis();

        // 只更新库存字段（HSET 局部更新的优势）
        $redis->hIncrBy("blindbox:info:{$blindBoxId}", 'stock', -1);

        // 更新中奖播报（LPUSH 新记录到头部）
        $redis->lPush("blindbox:broadcast:{$blindBoxId}", json_encode([
            'id'        => uniqid(),
            'user'      => $this->maskPhone(auth()->user()->phone),
            'prize'     => $this->getPrizeName($prizeId),
            'timestamp' => time(),
        ]));

        // 裁剪播报列表（只保留最新 50 条）
        $redis->lTrim("blindbox:broadcast:{$blindBoxId}", 0, 49);
    }

    /**
     * 全量失效：活动状态变更时
     */
    public function invalidateAll(int $blindBoxId): void
    {
        $redis = $this->getRedis();
        $keys = [
            "blindbox:info:{$blindBoxId}",
            "blindbox:prizes:{$blindBoxId}",
            "blindbox:broadcast:{$blindBoxId}",
            "blindbox:detail:aggregate:{$blindBoxId}",
        ];

        // 使用 UNLINK（异步删除，不阻塞 Redis）
        $redis->unlink($keys);
    }
}
```

### 5.3 缓存穿透防护

盲盒活动结束后，大量不存在的 ID 可能被请求（爬虫/竞品分析），直接穿透到数据库。

```php
<?php
// 缓存空值防护（Bloom Filter + 空值缓存）

class BlindBoxCacheService
{
    /**
     * 布隆过滤器：快速判断盲盒 ID 是否存在
     *
     * 为什么不用数据库查询？
     * - 布隆过滤器内存占用极低（100 万个 ID ≈ 1.2MB）
     * - 查询时间 O(k)，k 为哈希函数数量
     * - 可以拦截 99% 的无效请求
     */
    public function mightExist(int $blindBoxId): bool
    {
        $redis = $this->getRedis();
        // 使用 Redis 的 BF.ADD / BF.EXISTS（RedisBloom 模块）
        return $redis->bfExists('blindbox:bloom', $blindBoxId);
    }

    /**
     * 缓存空值：防止缓存穿透
     *
     * 当查询一个不存在的盲盒 ID 时，在缓存中写入一个特殊标记
     * 后续请求直接返回「不存在」，不再查询数据库
     */
    public function cacheNull(int $blindBoxId): void
    {
        $redis = $this->getRedis();
        $redis->set(
            "blindbox:null:{$blindBoxId}",
            '1',
            ['EX' => 300] // 5 分钟过期
        );
    }

    public function isNull(int $blindBoxId): bool
    {
        return $this->getRedis()->exists("blindbox:null:{$blindBoxId}");
    }
}
```

---

## 六、预加载策略：页面跳转前就开始请求

### 6.1 列表页预加载详情数据

当用户在盲盒列表页浏览时，我们可以在用户点击跳转 **之前** 就开始预请求详情数据。

```javascript
// utils/preload.js

/**
 * 预加载管理器
 *
 * 核心思想：
 * 1. 用户手指触摸列表项时（touchstart），开始预请求
 * 2. 请求结果存入 uni.setStorageSync
 * 3. 详情页 onLoad 时优先读取 Storage
 *
 * 为什么用 touchstart 而不是 click？
 * - touchstart 比 click 早 100-300ms（移动端 touch delay）
 * - 这 100-300ms 差异在慢网络下可能是 50% 的首屏时间
 */

class PreloadManager {
  constructor() {
    this.pendingRequests = new Map()
    this.CACHE_PREFIX = 'preload_detail_'
    this.CACHE_TTL = 30000 // 30秒过期
  }

  /**
   * 触发预加载
   * @param {number} blindBoxId - 盲盒 ID
   */
  async preload(blindBoxId) {
    const cacheKey = `${this.CACHE_PREFIX}${blindBoxId}`

    // 检查是否已有缓存
    const cached = uni.getStorageSync(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return // 缓存未过期，跳过
    }

    // 避免重复请求
    if (this.pendingRequests.has(blindBoxId)) {
      return
    }

    const requestPromise = new Promise((resolve, reject) => {
      uni.request({
        url: `${API_BASE}/api/blindbox/${blindBoxId}/detail`,
        method: 'GET',
        timeout: 5000,
        success: (res) => {
          if (res.data.code === 0) {
            uni.setStorageSync(cacheKey, {
              data: res.data.data,
              timestamp: Date.now(),
            })
            resolve(res.data.data)
          } else {
            reject(new Error(res.data.message))
          }
        },
        fail: (err) => {
          reject(err)
        },
        complete: () => {
          this.pendingRequests.delete(blindBoxId)
        }
      })
    })

    this.pendingRequests.set(blindBoxId, requestPromise)
    return requestPromise
  }

  /**
   * 获取预加载数据
   * @param {number} blindBoxId
   * @returns {object|null}
   */
  getPreloaded(blindBoxId) {
    const cacheKey = `${this.CACHE_PREFIX}${blindBoxId}`
    const cached = uni.getStorageSync(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // 读取后清除，避免占用 Storage
      uni.removeStorageSync(cacheKey)
      return cached.data
    }

    return null
  }

  /**
   * 取消所有进行中的预请求
   * 页面销毁时调用，避免内存泄漏
   */
  cancelAll() {
    // uni.request 不支持 AbortController
    // 但可以通过标记来忽略回调
    this.pendingRequests.clear()
  }
}

// 全局单例
export const preloadManager = new PreloadManager()
```

### 6.2 列表页集成预加载

```vue
<!-- pages/blindbox/list.vue -->
<template>
  <view class="blindbox-list">
    <view
      v-for="item in list"
      :key="item.id"
      class="blindbox-card"
      @touchstart="onTouchItem(item.id)"
      @click="goToDetail(item.id)"
    >
      <image :src="item.cover" class="card-cover" mode="aspectFill" />
      <view class="card-info">
        <text class="card-title">{{ item.title }}</text>
        <text class="card-price">¥{{ item.price }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onUnmounted } from 'vue'
import { preloadManager } from '@/utils/preload'

/**
 * touchstart 时触发预加载
 *
 * 关键：用户从手指触摸到实际跳转有 100-300ms 的时间差
 * 利用这段时间发起预请求，详情页拿到数据的概率约 60-70%
 */
function onTouchItem(id) {
  preloadManager.preload(id)
}

function goToDetail(id) {
  uni.navigateTo({
    url: `/pages/blindbox/detail?id=${id}`,
  })
}

onUnmounted(() => {
  preloadManager.cancelAll()
})
</script>
```

### 6.3 详情页消费预加载数据

```vue
<!-- pages/blindbox/detail.vue -->
<template>
  <view class="detail-page">
    <!-- 骨架屏（数据未到达时显示） -->
    <ProductDetailSkeleton v-if="loading" />

    <!-- 真实内容 -->
    <view v-else class="detail-content">
      <!-- 封面 -->
      <image :src="detail.info.cover" class="detail-cover" mode="aspectFill" />

      <!-- 标题 + 价格 -->
      <view class="detail-header">
        <text class="detail-title">{{ detail.info.title }}</text>
        <text class="detail-price">¥{{ detail.info.price }}</text>
      </view>

      <!-- 奖品网格（懒加载图片） -->
      <view class="prize-grid">
        <view v-for="prize in detail.prizes" :key="prize.id" class="prize-item">
          <LazyImage :src="prize.img" height="160rpx" />
          <text class="prize-name">{{ prize.name }}</text>
        </view>
      </view>

      <!-- 全平台播报（虚拟列表） -->
      <VirtualBroadcastList :blind-box-id="blindBoxId" />

      <!-- 推荐区（延迟加载） -->
      <RecommendSection
        v-if="showRecommend"
        :items="detail.recommend"
      />
    </view>
  </view>
</template>

<script setup>
import { ref, onLoad } from '@dcloudio/uni-app'
import { preloadManager } from '@/utils/preload'

const blindBoxId = ref(0)
const detail = ref(null)
const loading = ref(true)
const showRecommend = ref(false)

onLoad(async (options) => {
  blindBoxId.value = parseInt(options.id)

  // 1. 优先读取预加载数据
  const preloaded = preloadManager.getPreloaded(blindBoxId.value)

  if (preloaded) {
    // 预加载命中 → 直接渲染，跳过骨架屏
    detail.value = preloaded
    loading.value = false
    console.log('[Preload] Cache hit, skip skeleton')
  } else {
    // 预加载未命中 → 展示骨架屏 + 正常请求
    console.log('[Preload] Cache miss, showing skeleton')
    await fetchDetail()
  }

  // 2. 延迟加载推荐区（不阻塞首屏）
  setTimeout(() => {
    showRecommend.value = true
  }, 1000)
})

async function fetchDetail() {
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/blindbox/${blindBoxId.value}/detail`,
      method: 'GET',
    })

    if (res.data.code === 0) {
      detail.value = res.data.data
      loading.value = false
    }
  } catch (err) {
    uni.showToast({ title: '加载失败', icon: 'error' })
  }
}
</script>
```

---

## 七、性能对比数据

### 7.1 优化前后指标对比

```
┌─────────────────────────────────────────────────────────────┐
│                性能优化对比（真实数据）                        │
├──────────────────────┬──────────────┬───────────────────────┤
│  指标                 │  优化前       │  优化后               │
├──────────────────────┼──────────────┼───────────────────────┤
│  API 请求数           │  7 个         │  2 个（公共+用户态）   │
│  接口总耗时           │  1730ms       │  200ms (预加载后80ms) │
│  首次有意义绘制(FMP)  │  3200ms       │  800ms               │
│  预加载命中时         │  -            │  300ms               │
│  首屏请求数           │  7            │  2                   │
│  首屏传输体积         │  45KB         │  8KB (gzip 2.5KB)    │
│  图片并发加载数       │  100+         │  8 (首屏可见区域)    │
│  低端安卓(FMP)       │  5800ms       │  1500ms              │
│  iOS(FMP)            │  2100ms       │  600ms               │
│  跳出率               │  23%          │  8%                  │
└──────────────────────┴──────────────┴───────────────────────┘
```

### 7.2 不同网络环境下的表现

| 网络条件 | 优化前 | 优化后 | 提升 |
|---------|--------|--------|------|
| WiFi (10ms RTT) | 2.1s | 500ms | 76% |
| 4G (50ms RTT) | 3.2s | 800ms | 75% |
| 3G (200ms RTT) | 8.5s | 2.2s | 74% |
| 弱网 (500ms RTT) | 15s+ | 4.5s | 70% |

---

## 八、真实踩坑记录

### 踩坑 1：预加载数据与实际数据不一致

**现象**：用户从列表页点击进入详情页，看到的价格是 ¥9.9，但实际已经是 ¥12.9。

**原因**：预加载请求发生在列表页渲染时，此时数据可能已经有几秒到几分钟的延迟。期间盲盒价格/库存发生变化。

**解决方案**：预加载数据作为「乐观展示」，详情页加载完成后立即发起一次轻量级的 `If-None-Match` 条件请求：

```javascript
// 如果预加载数据存在，用 ETag 做条件请求
if (preloaded) {
  detail.value = preloaded // 先展示旧数据
  loading.value = false

  // 后台静默检查数据是否过期
  const checkRes = await uni.request({
    url: `/api/blindbox/${id}/detail`,
    method: 'GET',
    header: { 'If-None-Match': preloaded._etag },
  })

  if (checkRes.statusCode === 200) {
    // 数据有更新，替换
    detail.value = checkRes.data.data
  }
  // 304 → 数据没变，不用更新
}
```

### 踩坑 2：骨架屏布局抖动（Layout Shift）

**现象**：骨架屏消失后，页面内容「跳一下」。

**原因**：骨架屏的高度与真实内容不完全一致（奖品数量不同、文字行数不同）。

**解决方案**：
1. 骨架屏的容器高度用 `min-height` 而非固定 `height`
2. 骨架屏与真实内容共享同一套 CSS Grid 布局
3. 使用 `aspect-ratio` 固定图片区域比例

```scss
// 共享布局变量
$prize-grid-columns: 4;
$prize-item-ratio: 1 / 1.2; // 宽高比

.prize-grid {
  display: grid;
  grid-template-columns: repeat($prize-grid-columns, 1fr);
  gap: 16rpx;
}

.prize-item {
  aspect-ratio: $prize-item-ratio; // 骨架屏和真实内容用同一个比例
}
```

### 踩坑 3：图片懒加载在 swiper 组件中失效

**现象**：盲盒封面图使用 uni-app 的 `swiper` 组件，里面的图片懒加载不生效。

**原因**：`swiper` 的 `swiper-item` 使用 `visibility: hidden` 而非 `display: none`，导致 Intersection Observer 认为所有 slide 都「可见」。

**解决方案**：对 swiper 内的图片，使用 `current` 索引手动控制加载：

```vue
<swiper :current="currentSlide" @change="onSlideChange">
  <swiper-item v-for="(img, index) in coverImages" :key="index">
    <!-- 只加载当前 + 前后一张 -->
    <image
      v-if="Math.abs(index - currentSlide) <= 1"
      :src="img"
      mode="aspectFill"
      class="slide-image"
    />
    <!-- 其他 slide 用占位图 -->
    <view v-else class="slide-placeholder" />
  </swiper-item>
</swiper>
```

### 踩坑 4：Redis Pipeline 在 ThinkPHP 中的行为差异

**现象**：本地开发（Redis 单机）正常，生产环境（Redis Cluster）Pipeline 返回结果顺序错乱。

**原因**：Redis Cluster 的 Pipeline 命令会根据 key 的 hash slot 分发到不同节点，返回顺序与发送顺序不一致。

**解决方案**：使用 `{hash_tag}` 确保相关 key 在同一个 slot：

```php
// ❌ 这些 key 可能分散在不同 slot
$redis->hGetAll("blindbox:info:{$id}");
$redis->lRange("blindbox:prizes:{$id}", 0, -1);

// ✅ 使用 hash_tag 确保同一 slot
$redis->hGetAll("{blindbox:{$id}}:info");
$redis->lRange("{blindbox:{$id}}:prizes", 0, -1);
// {blindbox:{$id}} 部分决定 hash slot
```

### 踩坑 5：小程序端 uni.setStorageSync 超出大小限制

**现象**：预加载缓存过多，微信小程序报 `setStorage:fail the storage limit is 10MB`。

**原因**：每个盲盒详情数据约 3-5KB，列表页 20 个盲盒 × 5KB = 100KB。加上其他缓存，累积超限。

**解决方案**：
1. 预加载数据设置 30 秒过期
2. 详情页读取后立即清除
3. 只缓存关键字段（去除图片 base64 等大字段）

```javascript
// 精简缓存数据
function compressForCache(data) {
  return {
    info: {
      id: data.info.id,
      title: data.info.title,
      price: data.info.price,
      cover: data.info.cover, // 只保留缩略图 URL
      status: data.info.status,
    },
    // 奖品只缓存前 12 个（首屏可见数量）
    prizes: data.prizes.slice(0, 12).map(p => ({
      id: p.id,
      name: p.name,
      img: p.img,
      rarity: p.rarity,
    })),
    // 不缓存 broadcast 和 recommend（实时性要求高）
    _etag: data._etag,
    _compressed: true,
  }
}
```

### 踩坑 6：首屏图片 WebP 兼容性

**现象**：部分安卓机型（Android 8 以下）无法显示 WebP 格式的图片。

**原因**：WebP 需要 Android 4.0+ / iOS 14+ 才原生支持。低版本系统需要解码库。

**解决方案**：后端根据 `Accept` header 返回不同格式，CDN 层做图片格式协商：

```nginx
# nginx 配置：图片格式协商
map $http_accept $image_suffix {
    "~*webp"    ".webp";
    default     ".jpg";
}

# CDN 回源时带格式后缀
location ~* ^/images/(.+\.(jpg|png))$ {
    proxy_pass http://oss_backend/images/$1$image_suffix;
}
```

---

## 九、最佳实践与反模式

### ✅ 最佳实践

| 策略 | 做法 | 收益 |
|------|------|------|
| 接口聚合 | 7 个请求 → 2 个 | 减少 5 次 RTT |
| 预加载 | touchstart 触发 | 节省 100-300ms |
| 骨架屏 | 与真实布局一致 | 消除白屏感知 |
| 图片懒加载 | IntersectionObserver | 减少 90% 图片并发 |
| Redis Pipeline | 批量读取 | 1 次 RTT 读多个 key |
| ETag 条件请求 | 304 Not Modified | 节省带宽 |
| 缓存分层 | 不同 TTL 策略 | 平衡实时性与性能 |

### ❌ 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 一个接口返回所有数据 | 无法分层缓存 | 公共数据 + 用户态数据分离 |
| 图片 URL 不带尺寸参数 | 无法做 CDN 裁剪 | URL 带 `?w=200&h=200` |
| 骨架屏用 GIF 动画 | 增加 1 个 HTTP 请求 | 用 CSS animation |
| 预加载缓存不过期 | Storage 膨胀 | 设置 30s TTL |
| 全量字段返回 | 响应体过大 | 只返回首屏必要字段 |
| 串行请求 | 累加 RTT | Promise.all 或接口聚合 |

---

## 十、扩展思考

### 10.1 SSR / 预渲染是否更适合？

对于 SEO 要求高的场景（如 H5 分享落地页），可以考虑 **服务端预渲染**：

```
方案对比：
┌──────────────┬──────────────────┬──────────────────┐
│              │  CSR（当前方案）   │  SSR（预渲染）     │
├──────────────┼──────────────────┼──────────────────┤
│  FCP         │  500ms           │  200ms            │
│  SEO         │  差               │  好               │
│  服务器成本   │  低               │  高（需 Node.js） │
│  复杂度       │  低               │  高               │
│  适合场景     │  App/小程序       │  H5 分享页        │
└──────────────┴──────────────────┴──────────────────┘
```

ThinkPHP 可以通过 `think-swoole` 启动 HTTP 服务，配合 Vue 的 SSR 能力实现服务端渲染。但在盲盒电商的场景下，主要流量来自 App 和小程序，SSR 的 ROI 不高。

### 10.2 HTTP/3 (QUIC) 对性能的影响

HTTP/3 基于 QUIC 协议，解决了 TCP 的队头阻塞问题。对于详情页这种「多个小请求」的场景，HTTP/3 的优势尤其明显：

- **0-RTT 连接建立**：重复访问时无需握手
- **多路复用无队头阻塞**：2 个聚合接口可以完全并行
- **连接迁移**：用户从 WiFi 切到 4G 不会断连

### 10.3 与 GraphQL 的对比

如果未来详情页字段需求变化频繁（比如 A/B 测试不同字段组合），可以考虑引入 GraphQL：

| 维度 | REST 聚合接口（当前） | GraphQL |
|------|---------------------|---------|
| 字段灵活性 | 需要后端改接口 | 前端自选字段 |
| 缓存友好度 | 高（URL 维度） | 低（需要 Apollo Cache） |
| 学习成本 | 低 | 高 |
| 团队适配 | 当前 3 人团队 | 需要额外基础设施 |

**建议**：在当前团队规模下（3 人），REST 聚合接口 + 字段参数化（`?fields=id,title,price`）已经足够。GraphQL 可以在团队扩大后考虑。

---

## 参考资料

- [uni-app 官方文档 - 性能优化](https://uniapp.dcloud.net.cn/tutorial/performance.html)
- [ThinkPHP 8.x 官方文档 - 缓存](https://doc.thinkphp.cn/v8_0/cache.html)
- [Web.dev - Optimize LCP](https://web.dev/articles/optimize-lcp)
- [MDN - Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Redis 官方文档 - Pipeline](https://redis.io/docs/latest/develop/use/pipelining/)

## 相关阅读

- [ThinkPHP 事件驱动架构实战：观察者模式与领域事件解耦业务逻辑](/categories/business/thinkphp-event-driven-architecture-observer-pattern-domain-event/)
- [ThinkPHP 8 多租户架构设计：数据隔离、权限分级、资源配额实战踩坑记录](/categories/business/thinkphp-8-multi-tenant-architecture-design/)
- [ThinkPHP 电商后端架构设计：盲盒抽奖业务的核心逻辑实战踩坑记录](/categories/business/thinkphp-architecture/)