---

title: Core Web Vitals 实战：LCP/FID/CLS 优化——Vue 3 + Laravel 前后端协同性能治理
keywords: [Core Web Vitals, LCP, FID, CLS, Vue, Laravel, 前后端协同性能治理]
date: 2026-06-02 00:00:00
tags:
- Core Web Vitals
- LCP
- FID
- CLS
- Vue
- Laravel
- 性能优化
- 前端
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: Google Core Web Vitals（LCP/INP/CLS）已成为搜索排名的关键因素，直接影响电商转化率。本文从 Vue 3 + Laravel 全栈视角出发，系统性治理性能指标。涵盖关键资源预加载、JavaScript 代码分割与懒加载、图片格式优化（WebP/AVIF）、服务端响应加速、CLS 布局稳定性防护等实战方案，附完整优化清单与 Grafana 监控配置，助你持续保持优秀的用户体验指标。
---



# Core Web Vitals 实战：LCP/FID/CLS 优化——Vue 3 + Laravel 前后端协同性能治理

## 前言

Google Core Web Vitals 已成为搜索排名的关键因素。对于 B2C 电商平台来说，LCP 每慢 100ms，转化率下降 1%；CLS 每增加 0.1，跳出率上升 5%。

性能优化不是前端单独的事——后端响应速度、资源压缩、CDN 配置、图片格式都直接影响 CWV 指标。本文将从 Vue 3 + Laravel 全栈视角，系统性地治理 Core Web Vitals。

---

## 一、Core Web Vitals 指标详解

### 1.1 三大核心指标

| 指标 | 全称 | 衡量维度 | 优秀阈值 | 需改进 | 差 |
|------|------|---------|---------|--------|-----|
| **LCP** | Largest Contentful Paint | 加载性能 | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| **INP** | Interaction to Next Paint | 交互响应 | ≤ 200ms | ≤ 500ms | > 500ms |
| **CLS** | Cumulative Layout Shift | 视觉稳定性 | ≤ 0.1 | ≤ 0.25 | > 0.25 |

> 注：2024 年起 FID（First Input Delay）已被 INP（Interaction to Next Paint）取代。

### 1.2 LCP 的关键元素

LCP 测量的是最大内容元素的渲染时间，常见 LCP 元素：

- Hero 图片（电商首页大图）
- `<img>` 标签的图片
- `<video>` 的封面帧
- 包含文本的块级元素（标题、段落）

### 1.3 CLS 的常见成因

- 未设置尺寸的图片/视频
- 动态插入的广告/banners
- Web 字体加载导致的文字重排
- 动态注入的内容（推荐商品流）

---

## 二、Laravel 后端优化

### 2.1 响应压缩

```php
// app/Http/Kernel.php
protected $middleware = [
    // Gzip/Brotli 压缩
    \App\Http\Middleware\CompressResponse::class,
];
```

```php
// app/Http/Middleware/CompressResponse.php
class CompressResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 检查客户端是否支持 Brotli
        $encoding = str_contains($request->header('Accept-Encoding', ''), 'br')
            ? 'br'
            : 'gzip';

        if ($response instanceof BinaryFileResponse) {
            return $response; // 静态文件由 Nginx 处理
        }

        $content = $response->getContent();

        if (strlen($content) < 1024) {
            return $response; // 小于 1KB 不压缩
        }

        if ($encoding === 'br' && function_exists('brotli_compress')) {
            $compressed = brotli_compress($content, 4);
            $response->headers->set('Content-Encoding', 'br');
        } else {
            $compressed = gzencode($content, 6);
            $response->headers->set('Content-Encoding', 'gzip');
        }

        $response->setContent($compressed);
        $response->headers->set('Content-Length', strlen($compressed));
        $response->headers->set('Vary', 'Accept-Encoding');

        return $response;
    }
}
```

Nginx 层面的压缩配置（推荐，比 PHP 层面高效得多）：

```nginx
# nginx.conf
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/json
    application/javascript
    application/xml
    application/rss+xml
    image/svg+xml;

# Brotli（需要 ngx_brotli 模块）
brotli on;
brotli_comp_level 4;
brotli_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
```

### 2.2 HTTP/2 Server Push（已弃用，改用 103 Early Hints）

```php
// app/Http/Middleware/EarlyHints.php
class EarlyHints
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 关键资源的 Link 头
        $hints = [
            '</css/app.css>; rel=preload; as=style',
            '</js/app.js>; rel=preload; as=script',
            '</images/hero.webp>; rel=preload; as=image',
        ];

        $response->headers->set('Link', implode(', ', $hints));

        return $response;
    }
}
```

Nginx 配置 103 Early Hints：

```nginx
# 需要 Nginx 1.23+
location / {
    early_hints "Link: </css/app.css>; rel=preload; as=style";
    early_hints "Link: </js/app.js>; rel=preload; as=script";

    proxy_pass http://laravel_backend;
}
```

### 2.3 API 响应缓存与 ETag

```php
// app/Http/Middleware/ETagMiddleware.php
class ETagMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$response->isOk() || $request->isMethod('POST')) {
            return $response;
        }

        // 生成 ETag
        $etag = '"' . md5($response->getContent()) . '"';
        $response->headers->set('ETag', $etag);

        // 304 Not Modified
        $requestETag = $request->header('If-None-Match');
        if ($requestETag === $etag) {
            return new Response('', 304, $response->headers->all());
        }

        // Cache-Control
        $cacheTtl = $this->getCacheTtl($request);
        $response->headers->set('Cache-Control', "public, max-age={$cacheTtl}");

        return $response;
    }

    protected function getCacheTtl(Request $request): int
    {
        return match (true) {
            $request->is('api/products*') => 60,
            $request->is('api/categories*') => 300,
            $request->is('api/banners*') => 120,
            default => 0,
        };
    }
}
```

### 2.4 数据预取与分块传输

```php
// app/Http/Controllers/HomeController.php
class HomeController extends Controller
{
    public function index(): Response
    {
        // 关键数据（首屏需要）立即加载
        $heroBanners = Cache::remember('hero_banners', 300, fn() => Banner::hero()->get());
        $categories = Cache::remember('categories', 600, fn() => Category::root()->get());

        // 非关键数据通过 API 异步加载
        return view('home', compact('heroBanners', 'categories'));
    }
}
```

---

## 三、Vue 3 前端优化

### 3.1 代码分割与懒加载

```javascript
// router/index.js
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    {
        path: '/',
        component: () => import(/* webpackChunkName: "home" */ '@/views/Home.vue'),
    },
    {
        path: '/products/:id',
        // 预加载：用户悬停时就开始加载
        component: () => import(
            /* webpackChunkName: "product" */
            /* webpackPrefetch: true */
            '@/views/Product.vue'
        ),
    },
    {
        path: '/checkout',
        // 只在访问时加载（购物结算权重低）
        component: () => import(/* webpackChunkName: "checkout" */ '@/views/Checkout.vue'),
    },
]
```

### 3.2 组件懒加载 + Suspense

```vue
<!-- App.vue -->
<template>
    <router-view v-slot="{ Component }">
        <Suspense>
            <template #default>
                <component :is="Component" />
            </template>
            <template #fallback>
                <div class="skeleton-loader">
                    <div class="skeleton-hero"></div>
                    <div class="skeleton-grid">
                        <div v-for="i in 8" :key="i" class="skeleton-card"></div>
                    </div>
                </div>
            </template>
        </Suspense>
    </router-view>
</template>
```

### 3.3 LCP 优化：关键资源优先加载

```vue
<!-- components/HeroBanner.vue -->
<template>
    <section class="hero">
        <!-- LCP 元素：图片使用 fetchpriority="high" -->
        <img
            :src="banner.image"
            :alt="banner.title"
            fetchpriority="high"
            loading="eager"
            decoding="async"
            :width="banner.width"
            :height="banner.height"
            class="hero-image"
        />
    </section>
</template>

<script setup>
// 预加载 LCP 图片
const link = document.createElement('link')
link.rel = 'preload'
link.as = 'image'
link.href = props.banner.image
link.fetchpriority = 'high'
document.head.appendChild(link)
</script>
```

### 3.4 INP 优化：减少主线程阻塞

```vue
<!-- composables/useDebouncedSearch.js -->
<script setup>
import { ref, watch } from 'vue'

const searchQuery = ref('')
const results = ref([])
const isSearching = ref(false)

// 使用 requestIdleCallback 避免阻塞主线程
const debouncedSearch = useDebounce(async (query) => {
    if (!query.trim()) {
        results.value = []
        return
    }

    isSearching.value = true

    // 使用 requestIdleCallback 确保不阻塞交互
    await new Promise(resolve => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(resolve)
        } else {
            setTimeout(resolve, 0)
        }
    })

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        results.value = await response.json()
    } finally {
        isSearching.value = false
    }
}, 300)

watch(searchQuery, debouncedSearch)
</script>
```

**使用 Web Worker 处理重计算**

```javascript
// workers/filter.worker.js
self.addEventListener('message', (e) => {
    const { products, filters } = e.data

    const filtered = products.filter(product => {
        return Object.entries(filters).every(([key, value]) => {
            if (!value) return true
            if (key === 'priceRange') {
                return product.price >= value[0] && product.price <= value[1]
            }
            return product[key] === value
        })
    })

    self.postMessage(filtered)
})

// 在组件中使用
const worker = new Worker(
    new URL('./workers/filter.worker.js', import.meta.url),
    { type: 'module' }
)

const filterProducts = (products, filters) => {
    return new Promise((resolve) => {
        worker.onmessage = (e) => resolve(e.data)
        worker.postMessage({ products, filters })
    })
}
```

### 3.5 CLS 优化：预留空间

```vue
<!-- components/ProductImage.vue -->
<template>
    <div
        class="product-image-wrapper"
        :style="{
            aspectRatio: `${width}/${height}`,
            backgroundColor: dominantColor || '#f0f0f0',
        }"
    >
        <img
            v-if="loaded"
            :src="src"
            :alt="alt"
            class="product-image"
            loading="lazy"
            decoding="async"
        />
        <!-- 骨架屏占位 -->
        <div v-else class="image-skeleton"></div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
    src: String,
    alt: String,
    width: { type: Number, default: 400 },
    height: { type: Number, default: 400 },
    dominantColor: String,
})

const loaded = ref(false)

onMounted(() => {
    const img = new Image()
    img.onload = () => { loaded.value = true }
    img.src = props.src
})
</script>

<style scoped>
.product-image-wrapper {
    position: relative;
    overflow: hidden;
    /* 关键：aspect-ratio 保证图片加载前容器尺寸固定 */
}

.product-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>
```

**字体优化避免 CLS**

```vue
<!-- 使用 font-display: optional 避免字体切换导致的布局偏移 -->
<style>
@font-face {
    font-family: 'NotoSansSC';
    src: url('/fonts/NotoSansSC-Regular.woff2') format('woff2');
    font-display: optional; /* 字体加载失败时使用系统字体，不触发重排 */
    font-weight: 400;
    unicode-range: U+4E00-9FFF; /* 只加载中文字符 */
}

/* 备选：font-display: swap + 尺寸匹配 */
@font-face {
    font-family: 'Inter';
    src: url('/fonts/Inter-Regular.woff2') format('woff2');
    font-display: swap;
    font-weight: 400;
    size-adjust: 105%; /* 调整尺寸使 fallback 字体与目标字体尺寸匹配 */
    ascent-override: 90%;
    descent-override: 20%;
    line-gap-override: 0%;
}
</style>
```

---

## 四、图片优化

### 4.1 现代图片格式

```php
// app/Services/ImageOptimizer.php
class ImageOptimizer
{
    public function convertToModernFormats(string $sourcePath, string $outputDir): array
    {
        $results = [];

        // WebP
        $webpPath = $outputDir . '/' . pathinfo($sourcePath, PATHINFO_FILENAME) . '.webp';
        $this->convertToWebP($sourcePath, $webpPath, quality: 80);
        $results['webp'] = $webpPath;

        // AVIF（更小的体积）
        $avifPath = $outputDir . '/' . pathinfo($sourcePath, PATHINFO_FILENAME) . '.avif';
        $this->convertToAvif($sourcePath, $avifPath, quality: 65);
        $results['avif'] = $avifPath;

        return $results;
    }

    protected function convertToWebP(string $source, string $dest, int $quality): void
    {
        $image = imagecreatefromstring(file_get_contents($source));
        imagewebp($image, $dest, $quality);
        imagedestroy($image);
    }

    protected function convertToAvif(string $source, string $dest, int $quality): void
    {
        if (!function_exists('imageavif')) {
            Log::warning('AVIF 不支持：PHP 编译时未包含 libavif');
            return;
        }

        $image = imagecreatefromstring(file_get_contents($source));
        imageavif($image, $dest, $quality);
        imagedestroy($image);
    }
}
```

### 4.2 响应式图片

```vue
<!-- components/ResponsiveImage.vue -->
<template>
    <picture>
        <!-- AVIF 优先 -->
        <source
            :srcset="avifSrcset"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            type="image/avif"
        />
        <!-- WebP 备选 -->
        <source
            :srcset="webpSrcset"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            type="image/webp"
        />
        <!-- 原始格式兜底 -->
        <img
            :src="fallbackSrc"
            :alt="alt"
            :width="width"
            :height="height"
            loading="lazy"
            decoding="async"
            class="responsive-image"
        />
    </picture>
</template>

<script setup>
const props = defineProps({
    src: String,
    alt: String,
    width: Number,
    height: Number,
})

const sizes = [320, 640, 960, 1280, 1920]

const generateSrcset = (format) => {
    return sizes
        .map(size => `${props.src}?w=${size}&fmt=${format} ${size}w`)
        .join(', ')
}

const avifSrcset = computed(() => generateSrcset('avif'))
const webpSrcset = computed(() => generateSrcset('webp'))
const fallbackSrc = computed(() => `${props.src}?w=960`)
</script>
```

### 4.3 Laravel 图片处理 API

```php
// app/Http/Controllers/ImageController.php
class ImageController extends Controller
{
    public function resize(Request $request, string $path): Response
    {
        $validated = $request->validate([
            'w' => 'integer|min:100|max:2000',
            'h' => 'integer|min:100|max:2000',
            'fmt' => 'in:webp,avif,jpg,png',
            'q' => 'integer|min:10|max:100',
        ]);

        $width = $validated['w'] ?? 800;
        $height = $validated['h'] ?? null;
        $format = $validated['fmt'] ?? 'webp';
        $quality = $validated['q'] ?? 80;

        $sourcePath = storage_path("app/public/{$path}");

        if (!file_exists($sourcePath)) {
            abort(404);
        }

        // 缓存键
        $cacheKey = "img:{$path}:{$width}:{$height}:{$format}:{$quality}";
        $cachedPath = storage_path("app/cache/{$cacheKey}");

        if (file_exists($cachedPath)) {
            return response()->file($cachedPath, [
                'Content-Type' => "image/{$format}",
                'Cache-Control' => 'public, max-age=31536000, immutable',
            ]);
        }

        // 使用 Intervention Image 处理
        $image = Image::make($sourcePath);

        if ($height) {
            $image->fit($width, $height);
        } else {
            $image->resize($width, null, fn($constraint) => $constraint->aspectRatio());
        }

        $image->encode($format, $quality)->save($cachedPath);

        return response()->file($cachedPath, [
            'Content-Type' => "image/{$format}",
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]);
    }
}
```

---

## 五、Real User Monitoring (RUM)

### 5.1 Web Vitals 库集成

```javascript
// utils/vitals.js
import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals'

function sendToAnalytics(metric) {
    const body = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
        delta: metric.delta,
        id: metric.id,
        navigationType: metric.navigationType,
        url: window.location.href,
        userAgent: navigator.userAgent,
        connection: navigator.connection?.effectiveType,
        deviceMemory: navigator.deviceMemory,
        timestamp: Date.now(),
    })

    // 使用 sendBeacon 避免阻塞页面卸载
    if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/vitals', body)
    } else {
        fetch('/api/vitals', { body, method: 'POST', keepalive: true })
    }
}

export function initVitals() {
    onLCP(sendToAnalytics)
    onINP(sendToAnalytics)
    onCLS(sendToAnalytics)
    onFCP(sendToAnalytics)
    onTTFB(sendToAnalytics)
}
```

### 5.2 Laravel Vitals 收集端点

```php
// app/Http/Controllers/VitalsController.php
class VitalsController extends Controller
{
    public function store(Request $request): Response
    {
        $data = json_decode($request->getContent(), true);

        // 写入时序数据库（InfluxDB / Prometheus）
        $point = [
            'measurement' => 'web_vitals',
            'tags' => [
                'name' => $data['name'],
                'rating' => $data['rating'],
                'url' => $this->normalizeUrl($data['url']),
                'connection' => $data['connection'] ?? 'unknown',
                'device' => $this->getDeviceType($data['userAgent']),
            ],
            'fields' => [
                'value' => (float)$data['value'],
                'delta' => (float)$data['delta'],
            ],
            'time' => $data['timestamp'],
        ];

        // 异步写入避免影响响应速度
        dispatch(fn() => InfluxDbClient::write($point));

        return response('', 204);
    }

    protected function normalizeUrl(string $url): string
    {
        // 归一化 URL，去除查询参数和动态路由参数
        $path = parse_url($url, PHP_URL_PATH);
        return preg_replace('#/\d+#', '/:id', $path);
    }
}
```

### 5.3 Grafana Dashboard 配置

```json
{
    "panels": [
        {
            "title": "LCP 分布",
            "type": "histogram",
            "targets": [{
                "query": "SELECT mean(\"value\") FROM \"web_vitals\" WHERE \"name\" = 'LCP' GROUP BY time(1h), \"rating\""
            }],
            "thresholds": [
                { "value": 2500, "color": "green" },
                { "value": 4000, "color": "yellow" },
                { "value": 999999, "color": "red" }
            ]
        },
        {
            "title": "CLS P75 趋势",
            "type": "timeseries",
            "targets": [{
                "query": "SELECT percentile(\"value\", 75) FROM \"web_vitals\" WHERE \"name\" = 'CLS' GROUP BY time(1h)"
            }]
        },
        {
            "title": "INP 按设备类型",
            "type": "barchart",
            "targets": [{
                "query": "SELECT mean(\"value\") FROM \"web_vitals\" WHERE \"name\" = 'INP' GROUP BY \"device\""
            }]
        }
    ]
}
```

---

## 六、Lighthouse CI 集成

### 6.1 GitHub Actions 配置

```yaml
# .github/workflows/lighthouse.yml
name: Lighthouse CI

on:
  pull_request:
    branches: [main]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Lighthouse CI
        uses: treosh/lighthouse-ci-action@v11
        with:
          urls: |
            https://staging.example.com/
            https://staging.example.com/products
            https://staging.example.com/products/1
          budgetPath: ./lighthouse-budget.json
          uploadArtifacts: true

      - name: Check Performance Budget
        run: |
          lhci assert --config=.lighthouserc.json
```

### 6.2 性能预算配置

```json
// lighthouse-budget.json
[
    {
        "path": "/*",
        "timings": [
            { "metric": "largest-contentful-paint", "budget": 2500 },
            { "metric": "cumulative-layout-shift", "budget": 0.1 },
            { "metric": "total-blocking-time", "budget": 200 }
        ],
        "resourceSizes": [
            { "resourceType": "total", "budget": 300 },
            { "resourceType": "script", "budget": 150 },
            { "resourceType": "stylesheet", "budget": 50 },
            { "resourceType": "image", "budget": 100 },
            { "resourceType": "font", "budget": 50 }
        ],
        "resourceCounts": [
            { "resourceType": "total", "budget": 30 },
            { "resourceType": "script", "budget": 10 },
            { "resourceType": "third-party", "budget": 5 }
        ]
    }
]
```

---

## 七、实战案例：电商首页 CWV 优化

### 7.1 优化前指标

| 指标 | 数值 | 评级 |
|------|------|------|
| LCP | 4.2s | 🔴 差 |
| INP | 350ms | 🟡 需改进 |
| CLS | 0.28 | 🔴 差 |
| FCP | 1.8s | 🟡 需改进 |

### 7.2 优化措施

**LCP 优化（4.2s → 1.9s）**
1. Hero 图片使用 WebP 格式 + 响应式尺寸
2. 预加载关键图片（`<link rel="preload">`）
3. 内联关键 CSS
4. 延迟非关键 JavaScript

**INP 优化（350ms → 150ms）**
1. 搜索防抖 + Web Worker 过滤
2. 虚拟列表渲染长列表
3. 事件委托减少事件监听器数量
4. 拆分长任务（>50ms）使用 `scheduler.yield()`

**CLS 优化（0.28 → 0.05）**
1. 所有图片设置固定 aspect-ratio
2. Web 字体使用 `font-display: optional` + `size-adjust`
3. 动态内容使用占位骨架屏
4. 广告位预留固定空间

### 7.3 优化后指标

| 指标 | 数值 | 评级 | 提升 |
|------|------|------|------|
| LCP | 1.9s | 🟢 优秀 | -55% |
| INP | 150ms | 🟢 优秀 | -57% |
| CLS | 0.05 | 🟢 优秀 | -82% |
| FCP | 0.8s | 🟢 优秀 | -56% |

---

## 八、自动化性能守护

### 8.1 PR 性能回归检测

```yaml
# .github/workflows/performance-guard.yml
name: Performance Guard

on:
  pull_request:
    branches: [main]

jobs:
  perf-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Bundle Size Check
        run: |
          BUNDLE_SIZE=$(du -sk dist/assets/*.js | awk '{sum+=$1} END {print sum}')
          MAX_SIZE=150000  # 150KB gzip
          if [ "$BUNDLE_SIZE" -gt "$MAX_SIZE" ]; then
            echo "❌ Bundle size ($BUNDLE_SIZE KB) exceeds budget ($MAX_SIZE KB)"
            exit 1
          fi
          echo "✅ Bundle size: $BUNDLE_SIZE KB"
```

### 8.2 性能告警

```yaml
# prometheus-rules.yaml
groups:
  - name: web_vitals_alerts
    rules:
      - alert: LCPDegraded
        expr: histogram_quantile(0.75, rate(web_vitals_value{name="LCP"}[30m])) > 4000
        for: 15m
        annotations:
          summary: "LCP P75 超过 4 秒"

      - alert: CLSDegraded
        expr: histogram_quantile(0.75, rate(web_vitals_value{name="CLS"}[30m])) > 0.25
        for: 15m
        annotations:
          summary: "CLS P75 超过 0.25"
```

---

## 九、优化清单

### 9.1 后端 (Laravel)

- [ ] 启用 Gzip/Brotli 压缩
- [ ] 配置 HTTP/2 或 103 Early Hints
- [ ] API 响应设置 Cache-Control + ETag
- [ ] 关键数据服务端缓存（Redis）
- [ ] 静态资源使用 CDN
- [ ] 数据库查询优化（N+1、索引）

### 9.2 前端 (Vue 3)

- [ ] 路由级代码分割
- [ ] LCP 元素 fetchpriority="high"
- [ ] 图片使用 AVIF/WebP + 响应式 srcset
- [ ] 所有图片/视频设置 width/height
- [ ] 字体使用 font-display: optional 或 swap + size-adjust
- [ ] 非关键 JS 使用 defer/async
- [ ] 长任务拆分（scheduler.yield）
- [ ] 虚拟列表处理长列表
- [ ] 搜索/输入防抖

### 9.3 监控

- [ ] 集成 web-vitals 库
- [ ] 配置 RUM 数据收集端点
- [ ] Grafana Dashboard 展示 CWV 指标
- [ ] Lighthouse CI 集成到 PR 流程
- [ ] 设置性能预算和告警

---

## 总结

Core Web Vitals 优化是一个持续的过程，而非一次性任务：

1. **LCP** 主要由服务端响应速度和关键资源加载决定
2. **INP** 与 JavaScript 执行效率和主线程阻塞直接相关
3. **CLS** 需要在设计层面就预留足够的空间

前后端协同优化，配合自动化监控和性能预算，才能持续保持优秀的用户体验指标。

---

## 相关阅读

- [Vite-Laravel 实战：前后端分离开发工作流踩坑记录](/categories/frontend/vite-laravel-guide/)
- [Vue 3 TypeScript 实战：类型安全的前端开发与真实踩坑记录](/categories/frontend/vue-3-typescript-guide/)
- [Webpack/Vite 构建优化实战：Laravel BFF 缓存命中与分包策略踩坑记录](/categories/frontend/vite-optimizationguide-laravel-bff-cache/)
