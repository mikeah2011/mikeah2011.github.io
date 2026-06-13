---

title: 敏感数据保护实战：加密存储、脱敏展示、审计日志合规——Laravel B2C API 多层防御踩坑记录
date: 2026-06-01 09:00:00
description: 本文围绕 Laravel B2C API 的敏感数据保护实践，系统拆解加密存储、数据脱敏、审计日志三层防线，结合真实踩坑案例讲解字段级加密、哈希索引查询、日志脱敏、权限分级展示、密钥轮换与合规审计落地方法，帮助团队建立可执行的敏感数据保护体系。
tags:
- Laravel
- 安全
- 加密
- 数据保护
- 合规
- PHP
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop---


---


## 为什么需要敏感数据保护？

### 真实事故回顾

在一次安全审计中，我们发现以下问题：

1. **日志泄漏**：Laravel 日志中完整记录了用户的手机号和身份证号
2. **API 响应泄漏**：管理后台 API 返回了完整的银行卡号（前端只做了遮罩）
3. **数据库明文**：用户的收货地址以明文存储，数据库被拖库即全量泄漏
4. **无审计追踪**：无法回答"谁在什么时候查看了哪个用户的敏感信息"

### 合规要求

| 法规 | 核心要求 | 影响范围 |
|------|---------|---------|
| GDPR（欧盟） | 数据最小化、用户可删除、泄露通知 | 欧盟用户 |
| 中国个保法 | 敏感信息单独同意、加密存储、日志审计 | 中国用户 |
| PCI DSS | 银行卡号不可明文存储、访问需审计 | 支付相关 |
| SOC 2 | 访问控制、变更管理、安全监控 | 企业客户 |

---

## 第一层：加密存储

### 1. Laravel Encrypted Casts

Laravel 内置了 `encrypted` 和 `encrypted:array` Cast，使用 AES-256-CBC 加密：

```php
// app/Models/UserProfile.php
class UserProfile extends Model
{
    protected $casts = [
        'id_number'      => 'encrypted',      // 身份证号
        'bank_card'      => 'encrypted',      // 银行卡号
        'phone'          => 'encrypted',      // 手机号（可选加密）
        'address_detail' => 'encrypted',      // 详细地址
        'medical_info'   => 'encrypted:array', // 医疗信息（JSON）
    ];
}
```

**踩坑 1：加密字段无法查询**

加密后的数据是随机密文，无法直接 `WHERE` 查询：

```php
// ❌ 这样查询永远找不到结果
UserProfile::where('id_number', '110101199001011234')->first();

// ✅ 方案 A：存储哈希索引
class UserProfile extends Model
{
    protected static function booted(): void
    {
        static::saving(function (UserProfile $profile) {
            if ($profile->isDirty('id_number')) {
                $profile->id_number_hash = hash('sha256', $profile->id_number);
            }
        });
    }
}

// 查询时用哈希匹配
UserProfile::where('id_number_hash', hash('sha256', '110101199001011234'))->first();
```

**踩坑 2：加密密钥轮换**

当 `APP_KEY` 泄漏需要轮换时，所有加密字段需要重新加密：

```php
// app/Console/Commands/ReEncryptSensitiveData.php
class ReEncryptSensitiveData extends Command
{
    protected $signature = 'security:re-encrypt {--table=*}';
    protected $description = '用新密钥重新加密敏感字段';

    public function handle(): int
    {
        $tables = $this->option('table');
        $oldKey = config('security.old_app_key');

        foreach ($tables as $table) {
            $this->reEncryptTable($table, $oldKey);
        }

        return Command::SUCCESS;
    }

    protected function reEncryptTable(string $table, string $oldKey): void
    {
        $encryptedColumns = config("security.encrypted_columns.{$table}", []);

        DB::table($table)->orderBy('id')->chunk(500, function ($rows) use ($table, $encryptedColumns, $oldKey) {
            foreach ($rows as $row) {
                $updates = [];
                foreach ($encryptedColumns as $column) {
                    if (empty($row->{$column})) continue;

                    // 用旧密钥解密
                    $decrypted = $this->decryptWithKey($row->{$column}, $oldKey);
                    // 用新密钥加密（Laravel 自动使用当前 APP_KEY）
                    $updates[$column] = encrypt($decrypted);
                }

                if (!empty($updates)) {
                    DB::table($table)->where('id', $row->id)->update($updates);
                }
            }
        });
    }
}
```

### 2. 字段级加密（手动控制）

对于需要更细粒度控制的场景，使用自定义 Cast：

```php
// app/Casts/AesGcmEncryptedCast.php
class AesGcmEncryptedCast implements CastsAttributes
{
    public function get($model, string $key, $value, array $attributes): ?string
    {
        if (empty($value)) return null;

        $decoded = base64_decode($value);
        $iv = substr($decoded, 0, 12);
        $tag = substr($decoded, 12, 16);
        $ciphertext = substr($decoded, 28);

        $decrypted = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            $this->getKey(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        return $decrypted === false ? null : $decrypted;
    }

    public function set($model, string $key, $value, array $attributes): ?string
    {
        if (empty($value)) return null;

        $iv = random_bytes(12);
        $tag = '';

        $ciphertext = openssl_encrypt(
            $value,
            'aes-256-gcm',
            $this->getKey(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        return base64_encode($iv . $tag . $ciphertext);
    }

    protected function getKey(): string
    {
        return config('app.encryption_key') ?? config('app.key');
    }
}
```

**为什么用 AES-256-GCM？**

| 模式 | 认证加密 | 性能 | 适用场景 |
|------|---------|------|---------|
| AES-256-CBC | ❌ 无完整性校验 | 快 | Laravel 默认 |
| AES-256-GCM | ✅ 内置认证标签 | 中 | 敏感数据存储 |
| AES-256-CTR + HMAC | ✅ 手动认证 | 中 | 自定义控制 |

GCM 模式自带认证标签（Tag），防篡改。CBC 模式如果攻击者修改密文，解密后会得到错误数据但不会报错。

### 3. 数据库层加密（MySQL）

对于需要在 SQL 层面加密的场景：

```php
// app/Console/Commands/EncryptColumn.php
class EncryptColumn extends Command
{
    protected $signature = 'db:encrypt-column {table} {column}';

    public function handle(): int
    {
        $table = $this->argument('table');
        $column = $this->argument('column');
        $key = config('app.encryption_key');

        // 使用 MySQL AES_ENCRYPT 函数
        DB::statement("
            UPDATE {$table}
            SET {$column} = TO_BASE64(AES_ENCRYPT({$column}, ?))
            WHERE {$column} IS NOT NULL AND {$column} NOT LIKE 'eyJ%'  -- 排除已加密的
        ", [$key]);

        $this->info("Column {$table}.{$column} encrypted successfully.");
        return Command::SUCCESS;
    }
}
```

**踩坑 3：MySQL 加密与 Laravel 加密混用**

```php
// ❌ 不要混用两种加密方式
// MySQL AES_ENCRYPT 的输出格式与 Laravel encrypt() 不同
// 如果混用，解密会失败

// ✅ 统一使用 Laravel 层加密
// 数据库层只做辅助（如加密索引字段的哈希值）
```

### 4. 加密存储最佳实践决策树

```
需要查询该字段吗？
├── 是 → 使用哈希索引 + Laravel encrypted Cast
└── 否 → 直接使用 Laravel encrypted Cast

字段长度超过 255 字节吗？
├── 是 → 使用 TEXT 类型 + encrypted Cast
└── 否 → 使用 VARCHAR(512) + encrypted Cast

需要在数据库层面加密吗？
├── 是 → 使用 AES-256-GCM 自定义 Cast
└── 否 → 使用 Laravel 内置 encrypted Cast

需要支持密钥轮换吗？
├── 是 → 实现 re-encrypt 命令 + 版本化密钥
└── 否 → 使用单一 APP_KEY
```

### 5. 加密方案选型对比

很多团队会在“Laravel 内置加密够不够”“要不要自己做字段级加密”“数据库函数能不能直接顶上”之间反复横跳。实际落地时，建议先明确：**谁负责加解密、谁负责查询、谁负责轮换密钥**。

| 方案 | 实现方式 | 优点 | 缺点 | 适用场景 |
|------|----------|------|------|---------|
| Laravel `encrypted` Cast | 应用层自动加解密 | 开发成本低，和 Eloquent 集成最好 | 无法直接按明文查询 | 大多数用户资料字段 |
| 自定义 AES-256-GCM Cast | 应用层手动控制 IV / Tag | 可做版本化密钥、认证加密更完整 | 开发和测试成本更高 | 高敏字段、需要更细粒度控制 |
| 哈希索引 + 加密字段 | 明文字段不存储，仅保存哈希索引辅助查询 | 兼顾查询和安全 | 只能做等值匹配，不能模糊搜索 | 身份证号、手机号、证件号 |
| MySQL `AES_ENCRYPT` | 数据库层加密 | 可在 SQL 迁移脚本中快速处理存量数据 | 与 Laravel 加密格式不统一、维护复杂 | 历史数据迁移、一次性批处理 |
| 第三方 KMS/HSM | 密钥托管到云服务 | 密钥管理规范、适合审计要求高场景 | 成本高、接入复杂度高 | 金融、支付、跨区域合规业务 |

### 6. 可运行的 Laravel 落地示例：迁移 + 模型 + 服务

如果团队里有人只看概念不看代码，最终通常会出现“知道要加密，但没人真正上线”的情况。下面给出一套可以直接放进 Laravel 项目的最小实现。

```php
// database/migrations/2026_06_01_000001_create_user_profiles_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('user_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('phone_hash', 64)->nullable()->index();
            $table->string('id_number_hash', 64)->nullable()->index();
            $table->text('phone')->nullable();
            $table->text('id_number')->nullable();
            $table->text('bank_card')->nullable();
            $table->text('address_detail')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_profiles');
    }
};
```

```php
// app/Models/UserProfile.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserProfile extends Model
{
    protected $fillable = [
        'user_id', 'phone', 'id_number', 'bank_card', 'address_detail',
    ];

    protected $casts = [
        'phone' => 'encrypted',
        'id_number' => 'encrypted',
        'bank_card' => 'encrypted',
        'address_detail' => 'encrypted',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $profile) {
            if ($profile->phone !== null) {
                $profile->phone_hash = hash('sha256', trim($profile->phone));
            }

            if ($profile->id_number !== null) {
                $profile->id_number_hash = hash('sha256', strtoupper(trim($profile->id_number)));
            }
        });
    }
}
```

```php
// app/Services/SensitiveProfileService.php
namespace App\Services;

use App\Models\UserProfile;
use Illuminate\Support\Facades\DB;

class SensitiveProfileService
{
    public function store(array $payload): UserProfile
    {
        return DB::transaction(function () use ($payload) {
            return UserProfile::updateOrCreate(
                ['user_id' => $payload['user_id']],
                [
                    'phone' => $payload['phone'] ?? null,
                    'id_number' => $payload['id_number'] ?? null,
                    'bank_card' => $payload['bank_card'] ?? null,
                    'address_detail' => $payload['address_detail'] ?? null,
                ]
            );
        });
    }

    public function findByPhone(string $phone): ?UserProfile
    {
        return UserProfile::where('phone_hash', hash('sha256', trim($phone)))->first();
    }
}
```

```php
// app/Http/Controllers/Api/ProfileController.php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SensitiveProfileService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController extends Controller
{
    public function __construct(private readonly SensitiveProfileService $service)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => ['required', 'integer'],
            'phone' => ['nullable', 'string', 'max:20'],
            'id_number' => ['nullable', 'string', 'max:32'],
            'bank_card' => ['nullable', 'string', 'max:32'],
            'address_detail' => ['nullable', 'string', 'max:500'],
        ]);

        $profile = $this->service->store($validated);

        return response()->json([
            'id' => $profile->id,
            'message' => 'profile stored securely',
        ], 201);
    }
}
```

这套实现至少解决了三个关键问题：

1. **数据库不保存明文**，字段读取时自动解密；
2. **仍然支持按手机号/证件号精确查询**，通过哈希索引实现；
3. **服务层统一入口**，避免控制器、Job、Command 各自复制加密逻辑。

### 7. 踩坑补充：搜索、排序、唯一约束

在真实 B2C 项目中，光“能加密”还不够，还会遇到下面三类需求冲突：

- 运营想按手机号模糊搜索用户；
- 风控想按身份证唯一识别用户；
- 客服想按最近修改时间排序并查看部分明文。

这三类需求如果直接压给一个加密字段，通常都会失败。

```php
// ❌ 错误示例：试图直接对密文字段做 like 搜索
UserProfile::where('phone', 'like', '%138%')->get();

// ✅ 正确思路：拆成“检索字段”和“展示字段”
Schema::table('user_profiles', function (Blueprint $table) {
    $table->string('phone_last4', 4)->nullable()->index();
    $table->string('phone_prefix', 3)->nullable()->index();
});
```

```php
// 在 saving 事件中同步辅助检索字段
static::saving(function (self $profile) {
    $phone = preg_replace('/\D+/', '', (string) $profile->phone);

    if ($phone !== '') {
        $profile->phone_hash = hash('sha256', $phone);
        $profile->phone_prefix = substr($phone, 0, 3);
        $profile->phone_last4 = substr($phone, -4);
    }
});
```

上面这种做法不是为了“恢复明文搜索”，而是为了在业务允许的范围内，提供**受限检索能力**。比如客服只能用“前 3 位 + 后 4 位”组合定位用户，而不是直接看到完整手机号。

---

## 第二层：脱敏展示

### 1. API 响应脱敏

**核心原则**：后端做脱敏，前端不做。前端遮罩只是 UI 层面的，API 响应如果返回完整数据，抓包即可获取。

```php
// app/Transformers/UserProfileTransformer.php
class UserProfileTransformer extends Fractal\TransformerAbstract
{
    // 定义脱敏规则
    protected array $maskingRules = [
        'phone'     => 'phone',      // 138****5678
        'id_number' => 'id_card',    // 110101****1234
        'bank_card' => 'bank_card',  // 6222 **** **** 1234
        'email'     => 'email',      // t***@example.com
    ];

    public function transform(UserProfile $profile): array
    {
        $data = $profile->toArray();

        // 根据当前用户权限决定脱敏程度
        $context = $this->getContext();

        if ($context['is_self'] || $context['is_admin']) {
            // 本人或管理员看部分脱敏
            return $this->applyMasking($data, 'partial');
        }

        // 其他人看完全脱敏
        return $this->applyMasking($data, 'full');
    }

    protected function applyMasking(array $data, string $level): array
    {
        foreach ($this->maskingRules as $field => $type) {
            if (!isset($data[$field]) || empty($data[$field])) continue;

            $data[$field] = match ($level) {
                'partial' => $this->mask($data[$field], $type),
                'full'    => $this->maskFull($data[$field], $type),
                default   => $data[$field],
            };
        }

        return $data;
    }
}
```

### 2. 脱敏工具类

```php
// app/Support/DataMasker.php
class DataMasker
{
    /**
     * 手机号脱敏：138****5678
     */
    public static function phone(string $phone): string
    {
        if (strlen($phone) < 7) return str_repeat('*', strlen($phone));

        return substr($phone, 0, 3) . '****' . substr($phone, -4);
    }

    /**
     * 身份证号脱敏：110101********1234
     */
    public static function idCard(string $idCard): string
    {
        if (strlen($idCard) < 8) return str_repeat('*', strlen($idCard));

        return substr($idCard, 0, 6) . str_repeat('*', strlen($idCard) - 10) . substr($idCard, -4);
    }

    /**
     * 银行卡号脱敏：6222 **** **** 1234
     */
    public static function bankCard(string $card): string
    {
        $cleaned = preg_replace('/\s+/', '', $card);
        if (strlen($cleaned) < 8) return str_repeat('*', strlen($cleaned));

        $masked = substr($cleaned, 0, 4) . ' ' . str_repeat('**** ', (int)ceil((strlen($cleaned) - 8) / 4)) . substr($cleaned, -4);

        return trim($masked);
    }

    /**
     * 邮箱脱敏：t***@example.com
     */
    public static function email(string $email): string
    {
        $parts = explode('@', $email);
        if (count($parts) !== 2) return $email;

        $local = $parts[0];
        $masked = strlen($local) > 1
            ? $local[0] . str_repeat('*', min(strlen($local) - 1, 3))
            : str_repeat('*', 3);

        return $masked . '@' . $parts[1];
    }

    /**
     * 姓名脱敏：*明 / 张*明
     */
    public static function name(string $name): string
    {
        $length = mb_strlen($name);
        if ($length <= 1) return '*';
        if ($length === 2) return mb_substr($name, 0, 1) . '*';

        return mb_substr($name, 0, 1) . str_repeat('*', $length - 2) . mb_substr($name, -1);
    }

    /**
     * 地址脱敏：保留省市区，详细地址用 * 替代
     */
    public static function address(string $address): string
    {
        // 匹配省市区后面的内容
        if (preg_match('/^(.{6,15}(?:省|市|区|县|镇|街道))(.+)$/u', $address, $matches)) {
            return $matches[1] . str_repeat('*', mb_strlen($matches[2]));
        }

        // 无法解析时，保留前 1/3
        $keepLength = (int)(mb_strlen($address) / 3);
        return mb_substr($address, 0, $keepLength) . str_repeat('*', mb_strlen($address) - $keepLength);
    }
}
```

### 3. 中间件自动脱敏

创建一个中间件，在响应返回前自动脱敏敏感字段：

```php
// app/Http/Middleware/SensitiveDataMasking.php
class SensitiveDataMasking
{
    protected array $sensitiveFields = [
        'phone', 'mobile', 'id_number', 'id_card',
        'bank_card', 'card_number', 'credit_card',
        'password', 'secret', 'token',
        'address_detail', 'full_address',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$response instanceof JsonResponse) {
            return $response;
        }

        // 仅对非管理员 API 生效
        if ($request->user()?->hasRole('admin')) {
            return $response;
        }

        $data = $response->getData(true);
        $masked = $this->maskRecursive($data);
        $response->setData($masked);

        return $response;
    }

    protected function maskRecursive(array $data): array
    {
        foreach ($data as $key => &$value) {
            if (is_array($value)) {
                $value = $this->maskRecursive($value);
                continue;
            }

            if (!is_string($value) || empty($value)) continue;

            $lowerKey = strtolower($key);

            foreach ($this->sensitiveFields as $field) {
                if (str_contains($lowerKey, $field)) {
                    $value = $this->autoMask($value, $field);
                    break;
                }
            }
        }

        return $data;
    }

    protected function autoMask(string $value, string $type): string
    {
        return match (true) {
            str_contains($type, 'phone') || str_contains($type, 'mobile')
                => DataMasker::phone($value),
            str_contains($type, 'id_number') || str_contains($type, 'id_card')
                => DataMasker::idCard($value),
            str_contains($type, 'bank_card') || str_contains($type, 'card_number')
                => DataMasker::bankCard($value),
            str_contains($type, 'address')
                => DataMasker::address($value),
            str_contains($type, 'password') || str_contains($type, 'secret')
                => '******',
            default => $value,
        };
    }
}
```

**踩坑 4：脱敏中间件与 API 文档不一致**

脱敏后，API 返回的数据格式变了，导致前端和 API 文档对不上。

```php
// ✅ 在 API 文档中标注脱敏规则
/**
 * @response {
 *   "phone": "138****5678",  // 脱敏后的手机号
 *   "id_number": "110101****1234",  // 脱敏后的身份证号
 * }
 */
public function show(UserProfile $profile): JsonResponse
{
    return response()->json(new UserProfileResource($profile));
}
```

### 4. 日志脱敏

**这是最容易被忽略的泄漏点。**

```php
// app/Logging/SensitiveDataProcessor.php
class SensitiveDataProcessor
{
    protected array $patterns = [
        // 手机号
        '/1[3-9]\d{9}/' => '***手机***',
        // 身份证号
        '/[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/' => '***身份证***',
        // 银行卡号
        '/[1-9]\d{15,18}/' => '***卡号***',
        // 邮箱
        '/[\w.]+@[\w.]+\.\w+/' => '***邮箱***',
    ];

    public function __invoke(array $record): array
    {
        if (isset($record['message'])) {
            $record['message'] = $this->maskString($record['message']);
        }

        if (isset($record['context']) && is_array($record['context'])) {
            $record['context'] = $this->maskArray($record['context']);
        }

        return $record;
    }

    protected function maskString(string $text): string
    {
        foreach ($this->patterns as $pattern => $replacement) {
            $text = preg_replace($pattern, $replacement, $text);
        }

        return $text;
    }

    protected function maskArray(array $data): array
    {
        $sensitiveKeys = ['password', 'token', 'secret', 'phone', 'id_number', 'bank_card', 'credit_card'];

        foreach ($data as $key => &$value) {
            if (in_array(strtolower($key), $sensitiveKeys)) {
                $value = '***已脱敏***';
                continue;
            }

            if (is_string($value)) {
                $value = $this->maskString($value);
            } elseif (is_array($value)) {
                $value = $this->maskArray($value);
            }
        }

        return $data;
    }
}
```

**注册到日志配置：**

```php
// config/logging.php
'channels' => [
    'daily' => [
        'driver' => 'daily',
        'path' => storage_path('logs/laravel.log'),
        'level' => 'debug',
        'days' => 30,
        'tap' => [
            App\Logging\SensitiveDataProcessor::class,
        ],
    ],
],
```

**踩坑 5：第三方日志服务也需要脱敏**

如果使用 Sentry、New Relic 等第三方错误追踪服务，也要确保敏感数据不被上报：

```php
// config/sentry.php
'traces_sampler' => function (\Sentry\Tracing\SamplingContext $context): float {
    return 0.2; // 采样率 20%
},

// 在 Sentry 初始化时过滤敏感数据
Sentry\\init([
    'dsn' => config('services.sentry.dsn'),
    'before_send' => function (Sentry\\Event $event): ?Sentry\\Event {
        // 过滤敏感字段
        $event = $this->scrubSensitiveData($event);
        return $event;
    },
    'before_breadcrumb' => function (Sentry\\Breadcrumb $breadcrumb): ?Sentry\\Breadcrumb {
        // 过滤面包屑中的敏感数据
        return $this->scrubBreadcrumb($breadcrumb);
    },
]);
```

### 5. 脱敏方案对比表

脱敏不是简单把中间几位替换成 `*`。不同场景对“可读性”和“最小暴露”要求不同，建议把策略标准化，否则今天客服看 4 位、明天运营想看 6 位，最后规则会越来越乱。

| 脱敏对象 | 部分脱敏示例 | 完全脱敏示例 | 适用角色 | 风险提示 |
|---------|-------------|-------------|---------|---------|
| 手机号 | 138****5678 | 138******** | 用户本人、客服 | 不能在日志中保留完整号码 |
| 身份证号 | 110101********1234 | **************1234 | 实名审核、风控 | 禁止在前端缓存完整值 |
| 银行卡号 | 6222 **** **** 1234 | **** **** **** 1234 | 支付对账、客服 | 受 PCI DSS 约束更严格 |
| 邮箱 | t***@example.com | ***@example.com | 登录提示、通知确认 | 注意别泄露完整域名前缀关联信息 |
| 地址 | 上海市浦东新区****** | *************** | 物流、售后 | 详细门牌不要出现在普通日志 |

### 6. 踩坑补充：导出、缓存、消息队列

很多项目把 API 响应脱敏做完就以为闭环了，但真正的大坑往往出现在“非主链路”上。

**坑一：导出文件泄漏**

```php
// ❌ 导出 Excel 时直接用了模型原始数据
return Excel::download(new UsersExport(UserProfile::query()->get()), 'users.xlsx');

// ✅ 导出前显式调用脱敏 DTO
$rows = UserProfile::query()->get()->map(fn (UserProfile $profile) => [
    'name' => DataMasker::name($profile->user->name ?? ''),
    'phone' => DataMasker::phone($profile->phone ?? ''),
    'id_number' => DataMasker::idCard($profile->id_number ?? ''),
]);
```

**坑二：缓存保存了明文对象**

```php
// ❌ 直接缓存完整模型，Redis 里可能出现已解密字段
Cache::put("profile:{$userId}", $profile, now()->addMinutes(30));

// ✅ 只缓存脱敏后的视图数据
Cache::put("profile_masked:{$userId}", [
    'phone' => DataMasker::phone($profile->phone ?? ''),
    'id_number' => DataMasker::idCard($profile->id_number ?? ''),
], now()->addMinutes(10));
```

**坑三：异步消息把敏感数据原样丢进队列**

```php
// ✅ 只投递必要字段，不把完整敏感信息塞进 Job payload
SendProfileReviewedNotification::dispatch(
    userId: $profile->user_id,
    phoneLast4: substr((string) $profile->phone, -4),
    reviewTicketId: $ticketId,
);
```

如果你用 Horizon、RabbitMQ、Kafka，务必抽查消息体和失败队列；很多团队数据库加密做得不错，结果队列系统里全是明文。

---

## 第三层：审计日志

### 1. 数据访问审计

记录"谁在什么时候访问了什么数据"：

```php
// app/Models/AuditLog.php
class AuditLog extends Model
{
    protected $fillable = [
        'user_id', 'action', 'resource_type', 'resource_id',
        'old_values', 'new_values', 'ip_address', 'user_agent',
        'request_id', 'session_id',
    ];

    protected $casts = [
        'old_values' => 'array',
        'new_values' => 'array',
    ];
}
```

### 2. 敏感数据访问专用审计

```php
// app/Observers/SensitiveDataObserver.php
class SensitiveDataObserver
{
    protected array $sensitiveModels = [
        UserProfile::class,
        PaymentMethod::class,
        UserAddress::class,
    ];

    public function retrieved(Model $model): void
    {
        if (!in_array(get_class($model), $this->sensitiveModels)) {
            return;
        }

        $this->logAccess($model, 'read');
    }

    public function updated(Model $model): void
    {
        if (!in_array(get_class($model), $this->sensitiveModels)) {
            return;
        }

        $this->logAccess($model, 'update', $model->getChanges());
    }

    protected function logAccess(Model $model, string $action, array $changes = []): void
    {
        $request = request();

        AuditLog::create([
            'user_id'       => $request->user()?->id,
            'action'        => $action,
            'resource_type' => class_basename($model),
            'resource_id'   => $model->getKey(),
            'old_values'    => $action === 'update' ? $model->getOriginal() : null,
            'new_values'    => $changes,
            'ip_address'    => $request->ip(),
            'user_agent'    => $request->userAgent(),
            'request_id'    => $request->header('X-Request-Id'),
            'session_id'    => $request->session()?->getId(),
        ]);
    }
}
```

### 3. 管理员操作审计

```php
// app/Http/Middleware/AdminAuditLog.php
class AdminAuditLog
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$request->user()?->hasRole('admin')) {
            return $response;
        }

        // 记录管理员的所有操作
        AdminAuditLog::create([
            'admin_id'      => $request->user()->id,
            'action'        => $request->method(),
            'path'          => $request->path(),
            'query_params'  => $request->query(),
            'body_params'   => $this->sanitizeBody($request->all()),
            'response_code' => $response->getStatusCode(),
            'ip_address'    => $request->ip(),
            'user_agent'    => $request->userAgent(),
        ]);

        return $response;
    }

    protected function sanitizeBody(array $data): array
    {
        // 移除密码等字段
        unset($data['password'], $data['password_confirmation'], $data['token']);

        return $data;
    }
}
```

### 4. 审计日志的存储策略

**踩坑 6：审计日志表膨胀**

审计日志增长很快，需要分表和归档策略：

```php
// app/Console/Commands/ArchiveAuditLogs.php
class ArchiveAuditLogs extends Command
{
    protected $signature = 'audit:archive {--months=6}';

    public function handle(): int
    {
        $months = $this->option('months');
        $cutoff = now()->subMonths($months);

        // 1. 将旧日志归档到 S3
        $logs = AuditLog::where('created_at', '<', $cutoff)->orderBy('id')->chunk(1000, function ($chunk) {
            $csv = $this->toCsv($chunk);
            $filename = 'audit-logs/' . now()->format('Y-m') . '/' . Str::uuid() . '.csv';

            Storage::disk('s3')->put($filename, $csv);
        });

        // 2. 删除已归档的日志
        AuditLog::where('created_at', '<', $cutoff)->delete();

        $this->info("Archived audit logs older than {$cutoff->toDateString()}");
        return Command::SUCCESS;
    }
}
```

**数据库分表方案：**

```php
// 按月分表
Schema::create('audit_logs_' . now()->format('Y_m'), function (Blueprint $table) {
    $table->id();
    $table->nullableMorphs('user');
    $table->string('action', 20)->index();
    $table->string('resource_type', 50)->index();
    $table->unsignedBigInteger('resource_id')->index();
    $table->json('old_values')->nullable();
    $table->json('new_values')->nullable();
    $table->ipAddress('ip_address');
    $table->string('user_agent', 500)->nullable();
    $table->uuid('request_id')->nullable()->index();
    $table->timestamps();

    $table->index(['resource_type', 'resource_id']);
    $table->index(['user_id', 'action', 'created_at']);
});
```

### 5. 审计日志设计补强：谁申请、谁审批、谁查看

如果业务里存在客服查件、财务核对、风控复审等操作，建议不要只记录“有人看过”，还要记录**访问理由**和**审批链路**。否则审计时虽然能看到查看行为，却无法证明“为什么这个人有权限看”。

```php
// database/migrations/2026_06_01_000002_create_sensitive_access_requests_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('sensitive_access_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('requester_id')->constrained('users');
            $table->foreignId('approver_id')->nullable()->constrained('users');
            $table->string('resource_type', 50);
            $table->unsignedBigInteger('resource_id');
            $table->string('purpose', 100);
            $table->string('status', 20)->default('pending');
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('expired_at')->nullable();
            $table->timestamps();

            $table->index(['resource_type', 'resource_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sensitive_access_requests');
    }
};
```

```php
// app/Services/SensitiveDataAccessService.php
namespace App\Services;

use App\Models\AuditLog;
use App\Models\SensitiveAccessRequest;
use Illuminate\Auth\Access\AuthorizationException;

class SensitiveDataAccessService
{
    public function authorizeAndLog(SensitiveAccessRequest $request, int $viewerId): void
    {
        if ($request->status !== 'approved' || optional($request->expired_at)?->isPast()) {
            throw new AuthorizationException('sensitive access request is not valid');
        }

        AuditLog::create([
            'user_id' => $viewerId,
            'action' => 'approved_sensitive_read',
            'resource_type' => $request->resource_type,
            'resource_id' => $request->resource_id,
            'new_values' => [
                'purpose' => $request->purpose,
                'approved_by' => $request->approver_id,
                'request_id' => $request->id,
            ],
            'ip_address' => request()->ip(),
            'user_agent' => request()->userAgent(),
            'request_id' => request()->header('X-Request-Id'),
            'session_id' => request()->session()?->getId(),
        ]);
    }
}
```

这类设计在合规审计里特别有用，因为它把“权限”从静态角色，升级成了**一次有原因、有审批、有过期时间的临时授权**。

---

## 综合方案：Service Provider 整合

```php
// app/Providers/SecurityServiceProvider.php
class SecurityServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册脱敏工具
        $this->app->singleton(DataMasker::class);

        // 注册审计服务
        $this->app->singleton(AuditService::class, function ($app) {
            return new AuditService(
                logRetentionMonths: config('security.audit.retention_months', 24),
                enableRealTimeAlert: config('security.audit.realtime_alert', false),
            );
        });
    }

    public function boot(): void
    {
        // 注册模型观察者
        UserProfile::observe(SensitiveDataObserver::class);
        PaymentMethod::observe(SensitiveDataObserver::class);
        UserAddress::observe(SensitiveDataObserver::class);

        // 注册日志处理器
        $this->app->make('log')->pushProcessor(new SensitiveDataProcessor());
    }
}
```

---

## 踩坑总结

| # | 问题 | 原因 | 解决方案 |
|---|------|------|---------|
| 1 | 加密字段无法 WHERE 查询 | 加密后是随机密文 | 存储哈希索引辅助查询 |
| 2 | 密钥轮换数据丢失 | 旧密钥覆盖后无法解密 | 实现 re-encrypt 命令 + 版本化密钥 |
| 3 | 日志泄漏敏感数据 | 日志记录了完整请求/响应 | 注册日志处理器自动脱敏 |
| 4 | API 响应泄漏完整数据 | 只在前端做遮罩 | 后端中间件自动脱敏 |
| 5 | 第三方服务泄漏 | Sentry/New Relic 上报了敏感数据 | before_send 过滤 |
| 6 | 审计日志表膨胀 | 每次访问都记录 | 分表 + S3 归档 + 定期清理 |
| 7 | 脱敏后 API 文档不一致 | 文档没有标注脱敏规则 | API 文档中明确标注脱敏格式 |

---

## 安全检查清单

上线前，用以下清单自查：

```bash
# 1. 检查日志中是否有敏感数据
grep -rE '1[3-9][0-9]{9}|[1-9][0-9]{5}(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]' storage/logs/

# 2. 检查 API 响应是否包含完整手机号
curl -s https://api.example.com/v1/users/1 | grep -E '1[3-9][0-9]{9}'

# 3. 检查数据库中是否有明文敏感数据
SELECT phone FROM user_profiles WHERE phone NOT LIKE 'eyJ%' AND phone IS NOT NULL LIMIT 10;

# 4. 检查 Git 历史中是否有敏感数据
git log -p --all -S 'password' -- '*.env' '*.php'
```

---

## 总结

敏感数据保护不是单一技术能解决的问题，需要**三层防线**协同工作：

1. **加密存储**：即使数据库被拖库，攻击者也无法直接获取明文
2. **脱敏展示**：API 响应、日志、第三方服务都不会泄漏完整数据
3. **审计日志**：任何对敏感数据的访问都有迹可循，支持事后追溯

记住一个原则：**安全是一个持续的过程，不是一次性的工作。** 定期审计、持续改进，才能真正保护用户数据。

## 相关阅读

- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/架构/api-安全加固实战-jwt-黑名单-请求签名-ip白名单-防重放攻击-laravel-b2c-api踩坑记录/)
- [Laravel Sanctum 实战：SPA API 令牌认证与移动端适配](/categories/php/laravel/laravel-sanctum-实战-spa-api-令牌认证与移动端适配/)
- [Laravel 日志监控与链路追踪架构实战](/categories/php/laravel/kkday-log-monitor-tracing-laravel-architectureguide-loggingdistributed/)
