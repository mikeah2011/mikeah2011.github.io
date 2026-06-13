---

title: Laravel 多语言内容管理实战：运营后台的翻译工作流、机器翻译预填、Fallback 链路——i18n 从技术方案到运营工具的演进
keywords: [Laravel, Fallback, i18n, 多语言内容管理实战, 运营后台的翻译工作流, 机器翻译预填, 链路, 从技术方案到运营工具的演进, PHP]
date: 2026-06-10 02:25:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- i18n
- 多语言
- CMS
- 工作流
- 机器翻译
description: 从 Laravel 项目中多语言内容管理的实际痛点出发，完整实现翻译工作流（待翻译→翻译中→审核→已发布）、机器翻译预填（百度/Google/DeepL）、Fallback 链路设计，让 i18n 从技术方案变成运营工具。
---



## 背景：为什么 i18n 不只是 `__()` ？

Laravel 自带的 `resources/lang/{locale}/` 方案，适合静态 UI 文案——按钮文字、表单标签、校验信息。但当你的产品进入多国市场，真正的痛点不是「按钮怎么翻译」，而是：

1. **运营内容**：产品描述、活动文案、Banner 文案、邮件模板——这些是运营同学在后台录入的，不是写在代码里的。
2. **翻译流程**：谁翻译？翻译成什么状态？谁审核？什么时候上线？这些是业务流程，不是技术问题。
3. **机器翻译预填**：能不能先把机器翻译填进去，人工再润色？而不是让翻译从零开始。
4. **Fallback**：某个语言没翻译完，展示什么？不能直接显示空白或 key。

本文基于一个真实的 B2C 旅游平台（KKday）的实践，完整实现一个「运营可用」的多语言内容管理系统。

## 一、数据模型设计

### 1.1 核心思路：主表 + 翻译表分离

传统方案是把所有语言塞进一张表的 JSON 字段：

```php
// ❌ 反模式：JSON 字段存翻译
Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->json('title');        // {"zh_TW":"...","en":"...","ja":"..."}
    $table->json('description');
});
```

问题：
- 无法对单个语言做索引
- 无法追踪翻译状态
- 运营无法按语言筛选「未翻译」的内容
- SQL 查询极不友好

**推荐方案：主表存默认语言，翻译表存其他语言。**

```php
// 主表：products
Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->string('title');           // 默认语言（zh_TW）
    $table->text('description');
    $table->string('default_locale', 10)->default('zh_TW');
    $table->timestamps();
});

// 翻译表：product_translations
Schema::create('product_translations', function (Blueprint $table) {
    $table->id();
    $table->foreignId('product_id')->constrained()->cascadeOnDelete();
    $table->string('locale', 10);        // en, ja, ko, th...
    $table->string('title');
    $table->text('description')->nullable();
    $table->enum('status', ['pending', 'machine', 'translated', 'approved', 'published'])
          ->default('pending');
    $table->string('translator_type')->nullable();  // machine/human
    $table->string('translator_id')->nullable();     // 机器翻译引擎名 或 用户ID
    $table->timestamp('translated_at')->nullable();
    $table->timestamp('approved_at')->nullable();
    $table->timestamps();

    $table->unique(['product_id', 'locale']);
    $table->index(['locale', 'status']);
});
```

### 1.2 可翻译 Trait

```php
// app/Traits/Translatable.php
namespace App\Traits;

use Illuminate\Database\Eloquent\Relations\HasMany;

trait Translatable
{
    public function translations(): HasMany
    {
        return $this->hasMany($this->getTranslationModel());
    }

    public function translation(string $locale = null): ?object
    {
        $locale = $locale ?? app()->getLocale();

        // 当前语言有翻译
        if ($t = $this->translations->where('locale', $locale)->first()) {
            return $t;
        }

        // Fallback 链路
        return $this->resolveFallback($locale);
    }

    public function getTranslated(string $field, string $locale = null): string
    {
        $locale = $locale ?? app()->getLocale();
        $translation = $this->translation($locale);

        if ($translation && !empty($translation->{$field})) {
            return $translation->{$field};
        }

        // 最终 fallback：返回默认语言的原始值
        return $this->{$field} ?? '';
    }

    protected function resolveFallback(string $locale): ?object
    {
        $fallbackChain = config("app.fallback_chain.{$locale}", [
            config('app.fallback_locale', 'en'),
        ]);

        foreach ($fallbackChain as $fallbackLocale) {
            if ($t = $this->translations->where('locale', $fallbackLocale)->where('status', 'published')->first()) {
                return $t;
            }
        }

        return null;
    }

    protected function getTranslationModel(): string
    {
        return get_class($this) . 'Translation';
    }

    // 批量获取需要翻译的语言
    public function getMissingLocales(array $targetLocales): array
    {
        $existing = $this->translations()->pluck('locale')->toArray();
        return array_diff($targetLocales, $existing);
    }
}
```

### 1.3 Fallback 链路配置

```php
// config/app.php
'fallback_locale' => 'en',
'fallback_chain' => [
    'ja'   => ['en', 'zh_TW'],
    'ko'   => ['en', 'zh_TW'],
    'th'   => ['en', 'zh_TW'],
    'en'   => ['zh_TW'],
    'zh_TW' => [],
],
```

这个链路的意思：日语缺翻译 → 优先显示英文 → 再 fallback 到繁体中文原版。

## 二、翻译工作流状态机

### 2.1 状态流转

```
pending → machine → translated → approved → published
  ↑         │          │
  └─────────┴──────────┘  (翻译质量不达标，打回)
```

```php
// app/Enums/TranslationStatus.php
namespace App\Enums;

enum TranslationStatus: string
{
    case Pending     = 'pending';
    case Machine     = 'machine';
    case Translated  = 'translated';
    case Approved    = 'approved';
    case Published   = 'published';

    public function label(): string
    {
        return match ($this) {
            self::Pending    => '待翻译',
            self::Machine    => '机器已翻译',
            self::Translated => '人工已翻译',
            self::Approved   => '审核通过',
            self::Published  => '已发布',
        };
    }

    public function color(): string
    {
        return match ($this) {
            self::Pending    => 'gray',
            self::Machine    => 'blue',
            self::Translated => 'yellow',
            self::Approved   => 'green',
            self::Published  => 'emerald',
        };
    }
}
```

### 2.2 状态流转服务

```php
// app/Services/TranslationWorkflowService.php
namespace App\Services;

use App\Enums\TranslationStatus;
use Illuminate\Database\Eloquent\Model;

class TranslationWorkflowService
{
    public function submitTranslation(Model $translation, string $content, int $translatorId): void
    {
        $translation->update([
            'title'         => $content['title'] ?? $translation->title,
            'description'   => $content['description'] ?? $translation->description,
            'status'        => TranslationStatus::Translated->value,
            'translator_type' => 'human',
            'translator_id' => (string) $translatorId,
            'translated_at' => now(),
        ]);

        // 通知审核人
        $this->notifyReviewers($translation);
    }

    public function approve(Model $translation, int $reviewerId): void
    {
        $translation->update([
            'status'      => TranslationStatus::Approved->value,
            'approved_at' => now(),
        ]);

        activity()
            ->performedOn($translation)
            ->causedBy($reviewerId)
            ->withProperties(['action' => 'approve', 'locale' => $translation->locale])
            ->log('translation_approved');
    }

    public function publish(Model $translation): void
    {
        $translation->update([
            'status' => TranslationStatus::Published->value,
        ]);
    }

    public function reject(Model $translation, string $reason): void
    {
        $translation->update([
            'status' => TranslationStatus::Pending->value,
            'notes'  => $reason,
        ]);

        // 通知翻译人
        $this->notifyTranslator($translation, $reason);
    }

    public function batchPublish(string $modelClass, array $ids, string $locale): int
    {
        $translationTable = (new $modelClass)->getTable() . '_translations';

        return \DB::table($translationTable)
            ->whereIn($modelClass::find($ids)->first()->getForeignKey(), $ids)
            ->where('locale', $locale)
            ->where('status', TranslationStatus::Approved->value)
            ->update(['status' => TranslationStatus::Published->value]);
    }

    protected function notifyReviewers(Model $translation): void
    {
        // 发送到飞书/Slack/邮件
    }

    protected function notifyTranslator(Model $translation, string $reason): void
    {
        // 打回通知
    }
}
```

## 三、机器翻译预填

### 3.1 统一翻译引擎接口

```php
// app/Services/Translation/TranslationEngineInterface.php
namespace App\Services\Translation;

interface TranslationEngineInterface
{
    public function translate(string $text, string $from, string $to): string;
    public function batchTranslate(array $texts, string $from, string $to): array;
    public function getName(): string;
}
```

### 3.2 百度翻译实现

```php
// app/Services/Translation/BaiduTranslationEngine.php
namespace App\Services\Translation;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class BaiduTranslationEngine implements TranslationEngineInterface
{
    private string $appId;
    private string $secretKey;
    private string $endpoint = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

    // 百度语言代码映射
    private array $localeMap = [
        'zh_TW' => 'cht',
        'zh_CN' => 'zh',
        'en'    => 'en',
        'ja'    => 'jp',
        'ko'    => 'kor',
        'th'    => 'th',
        'vi'    => 'vie',
        'id'    => 'id',
        'ms'    => 'may',
    ];

    public function __construct()
    {
        $this->appId    = config('services.baidu_translate.app_id');
        $this->secretKey = config('services.baidu_translate.secret_key');
    }

    public function translate(string $text, string $from, string $to): string
    {
        if (empty(trim($text))) {
            return '';
        }

        $cacheKey = sprintf('baidu_translate:%s:%s:%s', $from, $to, md5($text));

        return Cache::remember($cacheKey, 86400 * 30, function () use ($text, $from, $to) {
            $salt    = (string) random_int(10000, 99999);
            $signStr = $this->appId . $text . $salt . $this->secretKey;
            $sign    = md5($signStr);

            $response = Http::timeout(10)->get($this->endpoint, [
                'q'     => $text,
                'from'  => $this->localeMap[$from] ?? $from,
                'to'    => $this->localeMap[$to] ?? $to,
                'appid' => $this->appId,
                'salt'  => $salt,
                'sign'  => $sign,
            ]);

            $data = $response->json();

            if (isset($data['trans_result'])) {
                return collect($data['trans_result'])
                    ->pluck('dst')
                    ->implode("\n");
            }

            \Log::warning('Baidu translate failed', $data);
            return $text; // 失败时返回原文
        });
    }

    public function batchTranslate(array $texts, string $from, string $to): array
    {
        // 百度单次最多 6000 字符，分批处理
        $batches = array_chunk($texts, 20, true);
        $results = [];

        foreach ($batches as $batch) {
            $joined = implode("\n", $batch);
            $translated = $this->translate($joined, $from, $to);
            $lines = explode("\n", $translated);

            foreach (array_keys($batch) as $i => $key) {
                $results[$key] = $lines[$i] ?? $batch[$key];
            }

            usleep(200_000); // 限速：5次/秒
        }

        return $results;
    }

    public function getName(): string
    {
        return 'baidu';
    }
}
```

### 3.3 DeepL 实现（质量更高）

```php
// app/Services/Translation/DeepLTranslationEngine.php
namespace App\Services\Translation;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class DeepLTranslationEngine implements TranslationEngineInterface
{
    private string $apiKey;
    private string $endpoint;

    private array $localeMap = [
        'zh_TW' => 'ZH',
        'zh_CN' => 'ZH',
        'en'    => 'EN',
        'ja'    => 'JA',
        'ko'    => 'KO',
        'th'    => 'TH',  // DeepL 不直接支持泰语，需 fallback
    ];

    public function __construct()
    {
        $this->apiKey  = config('services.deepl.api_key');
        $this->endpoint = config('services.deepl.is_pro')
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';
    }

    public function translate(string $text, string $from, string $to): string
    {
        if (empty(trim($text))) {
            return '';
        }

        $cacheKey = sprintf('deepl_translate:%s:%s:%s', $from, $to, md5($text));

        return Cache::remember($cacheKey, 86400 * 30, function () use ($text, $from, $to) {
            $response = Http::withHeaders([
                'Authorization' => 'DeepL-Auth-Key ' . $this->apiKey,
                'Content-Type'  => 'application/json',
            ])->timeout(15)->post($this->endpoint, [
                'text'           => [$text],
                'source_lang'    => $this->localeMap[$from] ?? strtoupper($from),
                'target_lang'    => $this->localeMap[$to] ?? strtoupper($to),
                'preserve_formatting' => 1,
            ]);

            $data = $response->json();

            if (isset($data['translations'][0]['text'])) {
                return $data['translations'][0]['text'];
            }

            \Log::warning('DeepL translate failed', $data);
            return $text;
        });
    }

    public function batchTranslate(array $texts, string $from, string $to): array
    {
        $results = [];
        foreach ($texts as $key => $text) {
            $results[$key] = $this->translate($text, $from, $to);
            usleep(100_000);
        }
        return $results;
    }

    public function getName(): string
    {
        return 'deepl';
    }
}
```

### 3.4 翻译引擎选择器 + 级联策略

```php
// app/Services/Translation/TranslationService.php
namespace App\Services\Translation;

use App\Enums\TranslationStatus;
use Illuminate\Database\Eloquent\Model;

class TranslationService
{
    /** @var TranslationEngineInterface[] */
    private array $engines;

    public function __construct()
    {
        $this->engines = [
            app(DeepLTranslationEngine::class),    // 优先 DeepL（质量高）
            app(BaiduTranslationEngine::class),    // 百度兜底（便宜）
        ];
    }

    /**
     * 为指定内容批量预填机器翻译
     */
    public function prefillMachineTranslations(
        Model $model,
        array $targetLocales,
        array $fields = ['title', 'description']
    ): array {
        $results = [];
        $defaultLocale = $model->default_locale ?? 'zh_TW';

        foreach ($targetLocales as $locale) {
            // 跳过默认语言
            if ($locale === $defaultLocale) {
                continue;
            }

            // 跳过已有翻译
            if ($model->translations()->where('locale', $locale)->exists()) {
                $results[$locale] = 'skipped';
                continue;
            }

            $translatedFields = [];
            $engineUsed = '';

            foreach ($fields as $field) {
                $original = $model->{$field};
                if (empty($original)) {
                    continue;
                }

                // 尝试引擎级联
                foreach ($this->engines as $engine) {
                    try {
                        $translated = $engine->translate($original, $defaultLocale, $locale);
                        $translatedFields[$field] = $translated;
                        $engineUsed = $engine->getName();
                        break;
                    } catch (\Exception $e) {
                        \Log::warning("Translation engine {$engine->getName()} failed", [
                            'model'  => get_class($model),
                            'id'     => $model->id,
                            'locale' => $locale,
                            'error'  => $e->getMessage(),
                        ]);
                        continue;
                    }
                }
            }

            if (!empty($translatedFields)) {
                $model->translations()->updateOrCreate(
                    ['locale' => $locale],
                    array_merge($translatedFields, [
                        'status'         => TranslationStatus::Machine->value,
                        'translator_type' => 'machine',
                        'translator_id'  => $engineUsed,
                        'translated_at'  => now(),
                    ])
                );

                $results[$locale] = "machine:{$engineUsed}";
            } else {
                $results[$locale] = 'failed';
            }
        }

        return $results;
    }

    /**
     * 批量为多个模型预填翻译（队列任务用）
     */
    public function batchPrefill(string $modelClass, array $ids, array $locales): array
    {
        $results = [];
        $model = new $modelClass;

        $modelClass::whereIn($model->getKeyName(), $ids)
            ->chunk(50, function ($models) use ($locales, &$results) {
                foreach ($models as $model) {
                    $results[$model->id] = $this->prefillMachineTranslations($model, $locales);
                }
            });

        return $results;
    }
}
```

### 3.5 队列任务：新内容自动预填

```php
// app/Jobs/PrefillTranslationJob.php
namespace App\Jobs;

use App\Services\Translation\TranslationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class PrefillTranslationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        public string $modelClass,
        public int $modelId,
        public array $locales,
    ) {}

    public function handle(TranslationService $service): void
    {
        $model = $this->modelClass::findOrFail($this->modelId);
        $service->prefillMachineTranslations($model, $this->locales);
    }
}
```

在 Model Observer 中自动触发：

```php
// app/Observers/ProductObserver.php
namespace App\Observers;

use App\Jobs\PrefillTranslationJob;
use App\Models\Product;

class ProductObserver
{
    public function created(Product $product): void
    {
        $locales = config('app.supported_locales', ['en', 'ja', 'ko']);

        // 延迟 10 秒执行，等主数据落库
        PrefillTranslationJob::dispatch(
            Product::class,
            $product->id,
            $locales
        )->delay(now()->addSeconds(10));
    }

    public function updated(Product $product): void
    {
        if ($product->wasChanged(['title', 'description'])) {
            // 内容变更时，标记现有翻译为 outdated
            $product->translations()
                ->where('status', 'published')
                ->update(['status' => 'pending']);
        }
    }
}
```

## 四、运营后台 UI

### 4.1 翻译状态看板

```php
// app/Http/Controllers/Admin/TranslationDashboardController.php
namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\DB;

class TranslationDashboardController extends Controller
{
    public function index()
    {
        // 按语言统计翻译进度
        $stats = DB::table('product_translations')
            ->select(
                'locale',
                DB::raw('COUNT(*) as total'),
                DB::raw("SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published"),
                DB::raw("SUM(CASE WHEN status = 'machine' THEN 1 ELSE 0 END) as machine_only"),
                DB::raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
            )
            ->groupBy('locale')
            ->get();

        // 最近 7 天翻译产出
        $recentActivity = DB::table('product_translations')
            ->where('translated_at', '>=', now()->subDays(7))
            ->select(
                'locale',
                DB::raw('COUNT(*) as count'),
                DB::raw("SUM(CASE WHEN translator_type = 'machine' THEN 1 ELSE 0 END) as machine_count")
            )
            ->groupBy('locale')
            ->get();

        return view('admin.translation.dashboard', compact('stats', 'recentActivity'));
    }
}
```

### 4.2 翻译列表页（按语言筛选）

```php
// app/Http/Controllers/Admin/ProductTranslationController.php
namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Enums\TranslationStatus;
use Illuminate\Http\Request;

class ProductTranslationController extends Controller
{
    public function index(Request $request)
    {
        $query = Product::query()
            ->with(['translations' => function ($q) use ($request) {
                if ($locale = $request->input('locale')) {
                    $q->where('locale', $locale);
                }
            }])
            ->when($request->input('status'), function ($q, $status) {
                $q->whereHas('translations', function ($sq) use ($status) {
                    $sq->where('status', $status);
                });
            })
            ->when($request->input('missing_locale'), function ($q, $locale) {
                $q->whereDoesntHave('translations', function ($sq) use ($locale) {
                    $sq->where('locale', $locale);
                });
            });

        $products = $query->paginate(20);

        return view('admin.product.translations', [
            'products'      => $products,
            'locales'       => config('app.supported_locales'),
            'statuses'      => TranslationStatus::cases(),
            'currentLocale' => $request->input('locale', 'en'),
        ]);
    }
}
```

### 4.3 翻译编辑表单

```php
// Blade 视图片段
<form action="{{ route('admin.translations.update', $translation) }}" method="POST">
    @csrf
    @method('PUT')

    <div class="grid grid-cols-2 gap-6">
        {{-- 左侧：原文 --}}
        <div class="bg-gray-50 p-4 rounded">
            <h3 class="text-sm font-medium text-gray-500 mb-2">
                原文（{{ $product->default_locale }}）
            </h3>

            @foreach(['title', 'description'] as $field)
            <div class="mb-4">
                <label class="block text-xs text-gray-400 mb-1">{{ $field }}</label>
                <div class="p-2 bg-white rounded border text-sm">
                    {{ $product->{$field} }}
                </div>
            </div>
            @endforeach
        </div>

        {{-- 右侧：翻译 --}}
        <div class="p-4 rounded border-2
            @if($translation?->status === 'machine') border-blue-300 bg-blue-50
            @elseif($translation?->status === 'pending') border-gray-300
            @else border-green-300 bg-green-50
            @endif">

            <div class="flex items-center justify-between mb-2">
                <h3 class="text-sm font-medium">
                    翻译（{{ $translation?->locale ?? $targetLocale }}）
                </h3>

                @if($translation?->translator_type === 'machine')
                <span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    机器翻译 · {{ $translation->translator_id }}
                </span>
                @endif
            </div>

            @foreach(['title', 'description'] as $field)
            <div class="mb-4">
                <label class="block text-xs text-gray-400 mb-1">{{ $field }}</label>
                @if($field === 'description')
                    <textarea name="{{ $field }}" rows="4"
                        class="w-full p-2 border rounded text-sm">{{ $translation?->{$field} }}</textarea>
                @else
                    <input type="text" name="{{ $field }}"
                        value="{{ $translation?->{$field} }}"
                        class="w-full p-2 border rounded text-sm">
                @endif
            </div>
            @endforeach
        </div>
    </div>

    <div class="mt-4 flex gap-2">
        <button type="submit" name="action" value="save"
            class="bg-blue-600 text-white px-4 py-2 rounded">
            保存为翻译中
        </button>
        <button type="submit" name="action" value="submit"
            class="bg-green-600 text-white px-4 py-2 rounded">
            提交审核
        </button>
        @if(auth()->user()->hasRole('reviewer'))
        <button type="submit" name="action" value="approve"
            class="bg-emerald-600 text-white px-4 py-2 rounded">
            审核通过并发布
        </button>
        @endif
    </div>
</form>
```

## 五、Blade 多语言辅助函数

```php
// app/Helpers/TranslationHelper.php

/**
 * 获取翻译内容，自动 Fallback
 */
function trans_content(Model $model, string $field, string $locale = null): string
{
    return $model->getTranslated($field, $locale);
}

/**
 * Blade 中使用：显示翻译状态标记
 */
function translation_badge(Model $model, string $locale = null): string
{
    $locale = $locale ?? app()->getLocale();
    $translation = $model->translations->where('locale', $locale)->first();

    if (!$translation) {
        return '<span class="text-xs text-gray-400">未翻译</span>';
    }

    $colors = [
        'pending'    => 'bg-gray-100 text-gray-600',
        'machine'    => 'bg-blue-100 text-blue-600',
        'translated' => 'bg-yellow-100 text-yellow-600',
        'approved'   => 'bg-green-100 text-green-600',
        'published'  => 'bg-emerald-100 text-emerald-600',
    ];

    $color = $colors[$translation->status] ?? 'bg-gray-100';

    return "<span class=\"text-xs px-2 py-0.5 rounded {$color}\">"
        . ucfirst($translation->status)
        . '</span>';
}
```

Blade 模板中使用：

```blade
<h1>{{ trans_content($product, 'title') }}</h1>
<div>{!! trans_content($product, 'description') !!}</div>

{{-- 显示翻译状态 --}}
@if(app()->getLocale() !== $product->default_locale)
    {!! translation_badge($product) !!}
@endif
```

## 六、踩坑记录

### 6.1 字符串长度膨胀

机器翻译后，文本长度可能膨胀 1.5-2 倍（中→英）。如果数据库字段长度不够，会静默截断。

**解决方案**：翻译字段统一用 `text` 而非 `varchar(255)`，UI 层做截断显示。

### 6.2 HTML 内容翻译

产品描述常包含 HTML（富文本编辑器）。机器翻译会破坏 HTML 标签。

```php
// 正确做法：提取纯文本翻译，再映射回 HTML
function translateHtml(string $html, string $from, string $to, TranslationEngineInterface $engine): string
{
    // 1. 提取文本节点
    $dom = new \DOMDocument();
    @$dom->loadHTML(mb_convert_encoding($html, 'HTML-ENTITIES', 'UTF-8'), LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);

    $xpath = new \DOMXPath($dom);
    $textNodes = $xpath->query('//text()[normalize-space()]');

    $texts = [];
    foreach ($textNodes as $node) {
        $texts[] = $node->nodeValue;
    }

    if (empty($texts)) {
        return $html;
    }

    // 2. 批量翻译
    $translated = $engine->batchTranslate($texts, $from, $to);

    // 3. 回填
    $i = 0;
    foreach ($textNodes as $node) {
        $node->nodeValue = $translated[$i] ?? $texts[$i];
        $i++;
    }

    return $dom->saveHTML();
}
```

### 6.3 机器翻译缓存一致性

机器翻译结果会被 Cache 缓存 30 天。如果运营修改了原文，旧的缓存翻译可能不一致。

**解决方案**：原文变更时清除对应缓存 key，或用版本号参与 cache key。

```php
$cacheKey = sprintf('translate:%s:%s:v%d:%s', $from, $to, $model->version, md5($text));
```

### 6.4 翻译队列积压

产品创建时自动触发翻译任务，如果批量导入 1000 条产品，队列会积压。

**解决方案**：限流 + 优先级队列。

```php
// 批量导入时，延迟触发翻译
PrefillTranslationJob::dispatch(...)
    ->onQueue('translation-low')
    ->delay(now()->addMinutes(rand(1, 60))); // 随机延迟，避免瞬时高峰
```

### 6.5 Fallback 展示的 SEO 问题

如果页面 URL 是 `/ja/products/xxx`，但实际展示的是英文 fallback 内容，Google 会认为页面语言与 URL 不一致。

**解决方案**：Fallback 内容加上 `hreflang` 标注，告知搜索引擎该语言版本尚未完成。

```blade
<link rel="alternate" hreflang="{{ app()->getLocale() }}"
    href="{{ url()->current() }}">
@if($isFallback)
    <meta name="robots" content="noindex"> {{-- 未完成翻译的页面不索引 --}}
@endif
```

## 七、性能优化

### 7.1 翻译预加载

```php
// 避免 N+1：列表页必须 eager load translations
$products = Product::with(['translations' => function ($q) {
    $q->where('status', 'published');
}])->paginate(20);
```

### 7.2 Redis 缓存翻译

```php
// 对高频访问的翻译内容做 Redis 缓存
public function getTranslated(string $field, string $locale = null): string
{
    $locale = $locale ?? app()->getLocale();
    $cacheKey = "translation:{$this->getTable()}:{$this->id}:{$locale}:{$field}";

    return Cache::remember($cacheKey, 3600, function () use ($field, $locale) {
        $translation = $this->translation($locale);
        return $translation?->{$field} ?? $this->{$field} ?? '';
    });
}
```

### 7.3 翻译完整性检查命令

```php
// app/Console/Commands/CheckTranslationCoverage.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckTranslationCoverage extends Command
{
    protected $signature = 'translation:coverage {--model=Product}';
    protected $description = '检查多语言翻译覆盖率';

    public function handle(): void
    {
        $modelClass = 'App\\Models\\' . $this->option('model');
        $model = new $modelClass;
        $table = $model->getTable();
        $transTable = $table . '_translations';

        $locales = config('app.supported_locales', ['en', 'ja', 'ko', 'th']);
        $total = $model->count();

        $this->info("📊 {$this->option('model')} 翻译覆盖率 (总数: {$total})");
        $this->line(str_repeat('─', 60));

        $rows = [];
        foreach ($locales as $locale) {
            $published = DB::table($transTable)
                ->where('locale', $locale)
                ->where('status', 'published')
                ->count();

            $machine = DB::table($transTable)
                ->where('locale', $locale)
                ->where('status', 'machine')
                ->count();

            $coverage = $total > 0 ? round($published / $total * 100, 1) : 0;
            $rows[] = [$locale, $published, $machine, $total - $published - $machine, "{$coverage}%"];
        }

        $this->table(['语言', '已发布', '仅机器翻译', '未翻译', '覆盖率'], $rows);
    }
}
```

## 总结

| 维度 | 方案 |
|------|------|
| 数据模型 | 主表 + 翻译表，status 字段驱动工作流 |
| 状态机 | pending → machine → translated → approved → published |
| 机器翻译 | DeepL 优先 + 百度兜底，Cache 30 天 |
| 运营工具 | 看板 + 列表筛选 + 双栏编辑表单 |
| Fallback | 可配置链路，支持多级回退 |
| 性能 | eager load + Redis 缓存 + 队列限流 |
| 踩坑 | HTML 翻译、长度膨胀、缓存一致性、SEO hreflang |

核心理念：**i18n 不是技术问题，是运营问题。** 技术方案要服务于运营流程——让运营能看懂、能操作、能追踪。机器翻译是「预填」不是「终稿」，人工审核不可省略。

---

> 本文代码基于 Laravel 10+ / PHP 8.2+，实际项目中可能需要根据业务规模做调整。翻译引擎部分建议先用 DeepL Free 测试质量，再决定是否采购付费版。
