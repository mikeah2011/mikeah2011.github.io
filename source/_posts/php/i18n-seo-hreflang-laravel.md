---

title: 多语言电商实战：i18n 全链路——翻译管理、SEO hreflang、货币格式与 Laravel 集成
date: 2026-06-02 00:00:00
tags:
- i18n
- Laravel
- 国际化
- SEO
- 多语言
categories:
  - php
keywords: [i18n, SEO hreflang, Laravel, 多语言电商实战, 全链路, 翻译管理, 货币格式与]
description: 多语言电商国际化全链路实战指南，覆盖 Laravel 路径前缀路由策略、翻译文件管理、hreflang SEO 标签配置、货币格式化与汇率处理、日期本地化及 RTL 语言支持，提供完整的 i18n 工程方案，帮助 B2C 电商团队高效实现海外多语言站点上线。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



## 前言

当 B2C 电商从国内走向海外，第一个要解决的技术问题就是**国际化（i18n）**。这不是简单地把中文翻译成英文——它涉及翻译文件管理、URL 路由策略、SEO hreflang 标签、货币格式化、日期本地化、RTL 语言支持等一整套工程问题。本文记录了在 Laravel 项目中实现完整 i18n 方案的实战经验。

<!-- more -->

## 一、架构设计

### 1.1 URL 路由策略

多语言电商有三种常见的 URL 策略：

| 策略 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| 子域名 | en.example.com | 清晰分离 | Cookie 跨域问题 |
| 路径前缀 | example.com/en/ | SEO 友好 | 路由稍复杂 |
| 查询参数 | example.com?lang=en | 实现简单 | SEO 不友好 |

我们选择**路径前缀**方案，因为它对 SEO 最友好且实现复杂度适中。

```php
// routes/web.php
Route::group([
    'prefix' => '{locale}',
    'where' => ['locale' => implode('|', config('app.available_locales'))],
    'middleware' => ['set_locale'],
], function () {
    Route::get('/', [HomeController::class, 'index'])->name('home');
    Route::get('/products/{slug}', [ProductController::class, 'show'])->name('product.show');
    Route::get('/categories/{slug}', [CategoryController::class, 'show'])->name('category.show');
    Route::get('/cart', [CartController::class, 'index'])->name('cart');
    Route::get('/checkout', [CheckoutController::class, 'index'])->name('checkout');
});

// 无 locale 前缀时重定向到默认语言
Route::get('/', fn() => redirect('/' . app()->getLocale()));
```

### 1.2 支持的语言配置

```php
// config/app.php
'available_locales' => ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'th', 'de', 'fr', 'ar'],
'default_locale' => 'en',
'fallback_locale' => 'en',

// config/localization.php
return [
    'currencies' => [
        'en' => 'USD',
        'zh-TW' => 'TWD',
        'zh-CN' => 'CNY',
        'ja' => 'JPY',
        'ko' => 'KRW',
        'th' => 'THB',
        'de' => 'EUR',
        'fr' => 'EUR',
        'ar' => 'SAR',
    ],
    'directions' => [
        'ar' => 'rtl',
        'he' => 'rtl',
        'fa' => 'rtl',
    ],
    'timezones' => [
        'en' => 'America/New_York',
        'zh-TW' => 'Asia/Taipei',
        'ja' => 'Asia/Tokyo',
        // ...
    ],
];
```

## 二、翻译文件管理

### 2.1 文件结构

```
lang/
├── en/
│   ├── common.php        # 通用文案
│   ├── product.php       # 商品相关
│   ├── checkout.php      # 结算相关
│   ├── email.php         # 邮件模板
│   └── validation.php    # 验证消息
├── zh-TW/
│   ├── common.php
│   ├── product.php
│   └── ...
├── ja/
│   └── ...
└── ar/
    └── ...
```

```php
// lang/en/common.php
return [
    'site_name' => 'GlobalShop',
    'search_placeholder' => 'Search products...',
    'add_to_cart' => 'Add to Cart',
    'buy_now' => 'Buy Now',
    'out_of_stock' => 'Out of Stock',
    'in_stock' => ':count items in stock',
    'free_shipping' => 'Free Shipping',
    'currency_selector' => 'Currency',
];

// lang/zh-TW/common.php
return [
    'site_name' => '全球購',
    'search_placeholder' => '搜尋商品...',
    'add_to_cart' => '加入購物車',
    'buy_now' => '立即購買',
    'out_of_stock' => '缺貨中',
    'in_stock' => '庫存 :count 件',
    'free_shipping' => '免運費',
    'currency_selector' => '幣別',
];
```

### 2.2 数据库驱动翻译（商品内容翻译）

文件翻译适合 UI 文案，但商品名称、描述、SEO 内容需要数据库翻译：

```php
// database/migrations/xxx_create_translations_table.php
Schema::create('translations', function (Blueprint $table) {
    $table->id();
    $table->morphs('translatable'); // translatable_type, translatable_id
    $table->string('locale', 10);
    $table->string('field'); // name, description, meta_title, meta_description
    $table->text('value');
    $table->timestamps();

    $table->unique(['translatable_type', 'translatable_id', 'locale', 'field']);
});
```

```php
// app/Models/Concerns/HasTranslations.php
trait HasTranslations
{
    public function translations(): MorphMany
    {
        return $this->morphMany(Translation::class, 'translatable');
    }

    public function getTranslated(string $field, ?string $locale = null): string
    {
        $locale = $locale ?? app()->getLocale();
        $fallback = config('app.fallback_locale');

        $translation = $this->translations()
            ->where('field', $field)
            ->where('locale', $locale)
            ->first();

        // 如果当前语言没有翻译，回退到默认语言
        if (!$translation && $locale !== $fallback) {
            $translation = $this->translations()
                ->where('field', $field)
                ->where('locale', $fallback)
                ->first();
        }

        return $translation?->value ?? '';
    }

    public function setTranslated(string $field, string $value, ?string $locale = null): void
    {
        $locale = $locale ?? app()->getLocale();

        $this->translations()->updateOrCreate(
            ['field' => $field, 'locale' => $locale],
            ['value' => $value]
        );
    }
}

// app/Models/Product.php
class Product extends Model
{
    use HasTranslations;

    protected $translatableFields = ['name', 'description', 'meta_title', 'meta_description'];

    // 便捷访问器
    public function getNameAttribute(): string
    {
        return $this->getTranslated('name');
    }
}
```

**踩坑 1：N+1 查询问题。** 列表页每件商品单独查一次翻译表，100 件商品 = 100 次查询。解决方案：

```php
// 预加载当前语言的翻译
$products = Product::with(['translations' => function ($query) {
    $query->where('locale', app()->getLocale());
}])->paginate(20);

// 更优方案：用 JOIN 替代 N+1
$products = Product::select('products.*')
    ->join('translations as t', function ($join) {
        $join->on('t.translatable_id', '=', 'products.id')
             ->where('t.translatable_type', '=', Product::class)
             ->where('t.locale', '=', app()->getLocale())
             ->where('t.field', '=', 'name');
    })
    ->addSelect('t.value as translated_name')
    ->paginate(20);
```

### 2.3 翻译管理后台

```php
// app/Http/Controllers/Admin/TranslationController.php
class TranslationController extends Controller
{
    // 翻译覆盖率报表
    public function coverage(): JsonResponse
    {
        $locales = config('app.available_locales');
        $defaultLocale = config('app.fallback_locale');
        $translatableModels = [Product::class, Category::class, Page::class];

        $report = [];
        foreach ($translatableModels as $model) {
            $totalCount = $model::count();
            foreach ($locales as $locale) {
                if ($locale === $defaultLocale) continue;

                $translatedCount = Translation::where('translatable_type', $model)
                    ->where('locale', $locale)
                    ->distinct('translatable_id')
                    ->count();

                $report[$model][$locale] = [
                    'total' => $totalCount,
                    'translated' => $translatedCount,
                    'coverage' => $totalCount > 0
                        ? round($translatedCount / $totalCount * 100, 1)
                        : 0,
                ];
            }
        }

        return response()->json($report);
    }

    // 批量导出待翻译内容
    public function export(string $locale): BinaryFileResponse
    {
        $rows = Translation::where('locale', config('app.fallback_locale'))
            ->whereNotIn('translatable_id', function ($query) use ($locale) {
                $query->select('translatable_id')
                    ->from('translations')
                    ->where('locale', $locale);
            })
            ->get(['translatable_type', 'translatable_id', 'field', 'value']);

        return Excel::download(new TranslationExport($locale), "translations_{$locale}.xlsx");
    }
}
```

**踩坑 2：翻译团队协作。** 开发直接改翻译文件会导致和翻译团队的冲突。解决方案：使用 Crowdin 或 Weblate 做翻译管理平台，通过 CI 自动同步。

```yaml
# .github/workflows/sync-translations.yml
name: Sync Translations
on:
  push:
    branches: [main]
    paths: ['lang/**']

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload to Crowdin
        uses: crowdin/github-action@v1
        with:
          upload_sources: true
          upload_translations: false
          download_translations: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CROWDIN_PROJECT_ID: ${{ secrets.CROWDIN_PROJECT_ID }}
          CROWDIN_PERSONAL_TOKEN: ${{ secrets.CROWDIN_PERSONAL_TOKEN }}
```

## 三、Locale 中间件

```php
// app/Http/Middleware/SetLocale.php
class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $request->route('locale');

        if (!in_array($locale, config('app.available_locales'))) {
            abort(404);
        }

        app()->setLocale($locale);

        // 设置货币
        $currency = config("localization.currencies.{$locale}", 'USD');
        session(['currency' => $currency]);

        // 设置时区
        $timezone = config("localization.timezones.{$locale}", 'UTC');
        config(['app.timezone' => $timezone]);

        // 设置 HTML 方向
        $direction = config("localization.directions.{$locale}", 'ltr');
        view()->share('htmlDirection', $direction);

        // 向所有 URL 生成器注入 locale
        URL::defaults(['locale' => $locale]);

        return $next($request);
    }
}
```

### 3.1 自动语言检测

```php
// app/Http/Middleware/DetectLocale.php — 放在 SetLocale 之前
class DetectLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->route('locale')) {
            return $next($request);
        }

        // 1. 检查 session
        if ($locale = session('locale')) {
            return $this->redirectWithLocale($request, $locale);
        }

        // 2. 检查 cookie
        if ($locale = $request->cookie('locale')) {
            return $this->redirectWithLocale($request, $locale);
        }

        // 3. 检查 Accept-Language 头
        $browserLocale = $request->getPreferredLanguage(
            config('app.available_locales')
        );

        if ($browserLocale) {
            return $this->redirectWithLocale($request, $browserLocale);
        }

        // 4. 根据 IP 地理位置
        $country = GeoIP::getCountry($request->ip());
        $locale = $this->countryToLocale($country);

        return $this->redirectWithLocale($request, $locale);
    }

    private function redirectWithLocale(Request $request, string $locale): Response
    {
        return redirect("/{$locale}" . $request->getRequestUri(), 302)
            ->withCookie(cookie('locale', $locale, 525600)); // 1 year
    }
}
```

## 四、SEO：hreflang 标签

### 4.1 hreflang 生成器

```php
// app/Services/SEO/HreflangGenerator.php
class HreflangGenerator
{
    public function generate(string $currentRoute, array $params = []): string
    {
        $html = '';
        $locales = config('app.available_locales');

        foreach ($locales as $locale) {
            $url = route($currentRoute, array_merge($params, ['locale' => $locale]));
            $hreflang = $this->toHreflangCode($locale);
            $html .= "<link rel=\"alternate\" hreflang=\"{$hreflang}\" href=\"{$url}\" />\n";
        }

        // x-default 指向默认语言
        $defaultUrl = route($currentRoute, array_merge($params, [
            'locale' => config('app.fallback_locale'),
        ]));
        $html .= "<link rel=\"alternate\" hreflang=\"x-default\" href=\"{$defaultUrl}\" />\n";

        return $html;
    }

    private function toHreflangCode(string $locale): string
    {
        return match ($locale) {
            'zh-TW' => 'zh-Hant',
            'zh-CN' => 'zh-Hans',
            default => $locale,
        };
    }
}
```

### 4.2 Blade 组件

```php
// app/View/Components/Hreflang.php
class Hreflang extends Component
{
    public string $html;

    public function __construct(HreflangGenerator $generator)
    {
        $route = Route::currentRouteName();
        $params = Route::current()->parameters();
        $this->html = $generator->generate($route, $params);
    }

    public function render(): string
    {
        return '<!-- hreflang -->' . $this->html;
    }
}
```

```blade
{{-- layouts/app.blade.php --}}
<head>
    <x-hreflang />
    {{-- 其他 meta 标签 --}}
</head>
```

**踩坑 3：hreflang 指向不存在的页面。** 有些商品只有部分语言的翻译，hreflang 必须只指向有内容的页面。

```php
public function generate(string $currentRoute, array $params = []): string
{
    $html = '';
    $locales = config('app.available_locales');

    // 检查当前页面是否有各语言版本
    if (isset($params['product'])) {
        $product = $params['product'];
        $availableLocales = $product->translations()
            ->where('field', 'name')
            ->pluck('locale')
            ->toArray();
    } else {
        $availableLocales = $locales;
    }

    foreach ($availableLocales as $locale) {
        $url = route($currentRoute, array_merge($params, ['locale' => $locale]));
        $hreflang = $this->toHreflangCode($locale);
        $html .= "<link rel=\"alternate\" hreflang=\"{$hreflang}\" href=\"{$url}\" />\n";
    }

    return $html;
}
```

## 五、货币格式化

### 5.1 货币服务

```php
// app/Services/Localization/CurrencyService.php
class CurrencyService
{
    private array $exchangeRates = [];
    private array $symbols = [
        'USD' => '$',
        'TWD' => 'NT$',
        'CNY' => '¥',
        'JPY' => '¥',
        'KRW' => '₩',
        'THB' => '฿',
        'EUR' => '€',
        'GBP' => '£',
        'SAR' => 'ر.س',
    ];

    // 获取实时汇率（从 Redis 缓存）
    public function getExchangeRate(string $from, string $to): float
    {
        $cacheKey = "exchange_rate:{$from}:{$to}";

        return Cache::remember($cacheKey, 3600, function () use ($from, $to) {
            // 调用汇率 API
            $response = Http::get('https://api.exchangerate-api.com/v4/latest/' . $from);
            return $response->json("rates.{$to}", 1.0);
        });
    }

    // 格式化价格
    public function format(float $amount, string $currency, ?string $locale = null): string
    {
        $locale = $locale ?? app()->getLocale();

        $formatter = new \NumberFormatter(
            $this->toICULocale($locale),
            \NumberFormatter::CURRENCY
        );

        return $formatter->formatCurrency($amount, $currency);
    }

    // 转换并格式化
    public function convertAndFormat(float $basePrice, string $baseCurrency = 'USD'): string
    {
        $targetCurrency = session('currency', $baseCurrency);

        if ($baseCurrency === $targetCurrency) {
            return $this->format($basePrice, $baseCurrency);
        }

        $rate = $this->getExchangeRate($baseCurrency, $targetCurrency);
        $convertedPrice = $basePrice * $rate;

        return $this->format($convertedPrice, $targetCurrency);
    }

    private function toICULocale(string $locale): string
    {
        return str_replace('-', '_', $locale);
    }
}
```

### 5.2 Blade 辅助函数

```php
// app/helpers.php
function price(float $amount, string $baseCurrency = 'USD'): string
{
    return app(CurrencyService::class)->convertAndFormat($amount, $baseCurrency);
}
```

```blade
{{-- 商品详情页 --}}
<div class="product-price">
    <span class="current-price">{{ price($product->price) }}</span>
    @if($product->original_price > $product->price)
        <span class="original-price">{{ price($product->original_price) }}</span>
        <span class="discount">-{{ $product->discount_percent }}%</span>
    @endif
</div>
```

**踩坑 4：货币精度问题。** JPY 和 KRW 没有小数位，而 BHD 有 3 位小数。不能简单用 `number_format($amount, 2)`，必须根据货币规则处理。

```php
public function format(float $amount, string $currency): string
{
    $decimals = match ($currency) {
        'JPY', 'KRW', 'VND' => 0,
        'BHD', 'KWD', 'OMR' => 3,
        default => 2,
    };

    $symbol = $this->symbols[$currency] ?? $currency;

    // 根据 locale 决定千分位和小数点符号
    $locale = app()->getLocale();
    $formatter = new \NumberFormatter(
        $this->toICULocale($locale),
        \NumberFormatter::DECIMAL
    );
    $formatter->setAttribute(\NumberFormatter::MIN_FRACTION_DIGITS, $decimals);
    $formatter->setAttribute(\NumberFormatter::MAX_FRACTION_DIGITS, $decimals);

    $formattedNumber = $formatter->format($amount);

    return "{$symbol}{$formattedNumber}";
}
```

## 六、日期与时间本地化

```php
// app/Services/Localization/DateService.php
class DateService
{
    // 本地化日期格式
    public function format(Carbon $date, string $style = 'medium'): string
    {
        $locale = app()->getLocale();
        $formatter = new \IntlDateFormatter(
            $this->toICULocale($locale),
            match ($style) {
                'short' => \IntlDateFormatter::SHORT,
                'medium' => \IntlDateFormatter::MEDIUM,
                'long' => \IntlDateFormatter::LONG,
                default => \IntlDateFormatter::MEDIUM,
            },
            \IntlDateFormatter::NONE,
        );

        return $formatter->format($date->timestamp);
    }

    // 相对时间（"3 小时前" / "3 hours ago"）
    public function diffForHumans(Carbon $date): string
    {
        return $date->locale(app()->getLocale())->diffForHumans();
    }

    // 带时区的格式化
    public function formatWithTimezone(Carbon $date, string $format = 'Y-m-d H:i'): string
    {
        $timezone = config("localization.timezones." . app()->getLocale(), 'UTC');
        return $date->setTimezone($timezone)->format($format);
    }
}
```

## 七、RTL 语言支持

### 7.1 CSS 方案

```scss
// resources/scss/_directional.scss
// 使用 CSS 逻辑属性代替物理属性
.product-card {
    padding-inline-start: 16px;  // 替代 padding-left
    margin-inline-end: 12px;     // 替代 margin-right
    text-align: start;           // 替代 text-align: left
    border-inline-start: 3px solid blue; // 替代 border-left
}

// 需要物理方向时用 mixin
@mixin rtl-aware($property, $ltr-value, $rtl-value) {
    [dir="ltr"] & { #{$property}: $ltr-value; }
    [dir="rtl"] & { #{$property}: $rtl-value; }
}

.sidebar {
    @include rtl-aware(float, left, right);
}
```

### 7.2 Blade 布局

```blade
{{-- layouts/app.blade.php --}}
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}" dir="{{ $htmlDirection ?? 'ltr' }}">
<head>
    <meta charset="UTF-8">
    {{-- hreflang --}}
    <x-hreflang />
    <title>{{ $title ?? config('app.name') }}</title>
    @vite(['resources/scss/app.scss'])
</head>
<body class="direction-{{ $htmlDirection ?? 'ltr' }}">
    @include('layouts.partials.header')
    <main>
        @yield('content')
    </main>
    @include('layouts.partials.footer')
</body>
</html>
```

## 八、搜索的多语言处理

### 8.1 Elasticsearch 多语言索引

```php
// app/Services/Search/MultilingualSearchService.php
class MultilingualSearchService
{
    public function createIndex(): void
    {
        $settings = [
            'settings' => [
                'analysis' => [
                    'analyzer' => [
                        'english_analyzer' => ['type' => 'standard'],
                        'chinese_analyzer' => ['type' => 'ik_max_word'],
                        'japanese_analyzer' => ['type' => 'kuromoji'],
                        'thai_analyzer' => ['type' => 'thai'],
                    ],
                ],
            ],
            'mappings' => [
                'properties' => [
                    'name' => [
                        'type' => 'text',
                        'fields' => [
                            'en' => ['type' => 'text', 'analyzer' => 'english_analyzer'],
                            'zh' => ['type' => 'text', 'analyzer' => 'chinese_analyzer'],
                            'ja' => ['type' => 'text', 'analyzer' => 'japanese_analyzer'],
                            'th' => ['type' => 'text', 'analyzer' => 'thai_analyzer'],
                        ],
                    ],
                ],
            ],
        ];

        $this->elasticsearch->indices()->create([
            'index' => 'products',
            'body' => $settings,
        ]);
    }

    public function search(string $query, ?string $locale = null): array
    {
        $locale = $locale ?? app()->getLocale();
        $langField = $this->localeToLangField($locale);

        return $this->elasticsearch->search([
            'index' => 'products',
            'body' => [
                'query' => [
                    'multi_match' => [
                        'query' => $query,
                        'fields' => ["name.{$langField}^3", "description.{$langField}", "tags"],
                    ],
                ],
            ],
        ]);
    }
}
```

## 九、测试策略

```php
// tests/Feature/LocalizationTest.php
class LocalizationTest extends TestCase
{
    /** @test */
    public function homepage_loads_in_all_locales(): void
    {
        foreach (config('app.available_locales') as $locale) {
            $response = $this->get("/{$locale}");
            $response->assertStatus(200);
            $response->assertSee("lang=\"{$locale}\"");
        }
    }

    /** @test */
    public function product_page_has_hreflang_tags(): void
    {
        $product = Product::factory()->create();
        // 创建翻译
        $product->setTranslated('name', 'Test Product', 'en');
        $product->setTranslated('name', '測試商品', 'zh-TW');

        $response = $this->get("/en/products/{$product->slug}");
        $response->assertSee('hreflang="en"');
        $response->assertSee('hreflang="zh-Hant"');
        $response->assertSee('hreflang="x-default"');
    }

    /** @test */
    public function price_formats_correctly_per_locale(): void
    {
        $this->app->setLocale('ja');
        session(['currency' => 'JPY']);
        $this->assertEquals('¥1,000', price(1000, 'JPY'));

        $this->app->setLocale('en');
        session(['currency' => 'USD']);
        $this->assertEquals('$9.99', price(9.99, 'USD'));
    }

    /** @test */
    public function rtl_direction_applied_for_arabic(): void
    {
        $response = $this->get('/ar');
        $response->assertSee('dir="rtl"');
    }
}
```

## 十、性能优化

| 优化点 | 方案 |
|-------|------|
| 翻译缓存 | Redis 缓存数据库翻译，变更时清除 |
| 汇率缓存 | 每小时更新，Redis 存储 |
| hreflang 缓存 | 页面级缓存，包含 hreflang 标签 |
| 搜索索引 | 按语言维护独立索引或字段 |
| 静态资源 | 按语言打包不同的 JS/CSS bundle |

## 总结

i18n 远不止"翻译文案"这么简单。一个完整的多语言电商系统需要：

1. **URL 策略**：路径前缀 + SEO hreflang
2. **翻译管理**：文件翻译（UI 文案）+ 数据库翻译（商品内容）+ 翻译管理平台
3. **货币处理**：汇率转换 + 本地化格式 + 精度处理
4. **本地化**：日期时间 + 数字格式 + RTL 支持
5. **搜索适配**：多语言分词器 + 语言感知的搜索排序

关键原则：**永远不要硬编码任何面向用户的字符串**。即使现在只支持一种语言，也要从第一天开始用 `__('key')` 和翻译文件，未来扩展时你会感谢自己的。

## 相关阅读

- [Laravel API 版本控制进阶：URL / Header / MediaType 三种策略的工程实践](/05_PHP/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [ETL 实战：Laravel + Airflow 数据管道构建](/05_PHP/Laravel/ETL-实战-Laravel-Airflow-数据管道构建/)
- [Laravel Sanctum 实战：SPA / API 令牌认证与移动端适配](/05_PHP/Laravel/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
