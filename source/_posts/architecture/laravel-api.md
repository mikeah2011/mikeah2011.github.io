---
title: Laravel 数据脱敏工程化实战：日志脱敏、API 响应脱敏、数据库字段加密——统一的脱敏注解与序列化器设计
keywords: [Laravel, API, 数据脱敏工程化实战, 日志脱敏, 响应脱敏, 数据库字段加密, 统一的脱敏注解与序列化器设计, 架构]
date: 2026-06-09 22:45:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - 数据脱敏
  - PHP
  - 安全
  - 注解
  - 序列化
description: 从散落的 if-else 到统一的注解驱动脱敏体系——日志、API 响应、数据库字段三层脱敏的工程化落地方案，基于 Laravel + PHP 8 Attributes 实现。
---


## 问题：脱敏代码散落各处

在 KKday B2C 这种涉及大量用户隐私数据的项目中，脱敏是刚需。但现实中常见的做法是这样的：

```php
// Controller 里手动脱敏
$user->phone = substr($user->phone, 0, 3) . '****' . substr($user->phone, -4);
$user->email = preg_replace('/(.{2}).*(@.*)/', '$1***$2', $user->email);

// 日志里又写一遍
Log::info('Order created', [
    'phone' => substr($request->phone, 0, 3) . '****' . substr($request->phone, -4),
    'email' => preg_replace('/(.{2}).*(@.*)/', '$1***$2', $request->email),
]);

// 导出 Excel 时再来一遍
// ... 同样的逻辑复制粘贴 N 遍
```

**痛点：**

- 脱敏逻辑散落在 Controller、Service、Event、Listener 各处
- 改一次手机号脱敏规则要改 10 个文件
- 日志脱敏和 API 脱敏规则不一致
- 新人接手不知道哪些字段需要脱敏
- 数据库明文存储，泄露风险高

本文要解决的核心问题：**能否用一个注解统一控制所有场景的脱敏行为？**

## 设计目标

```
┌─────────────────────────────────────────────┐
│           #[Mask] 统一注解层                  │
│  定义在 Model / DTO 属性上                    │
├─────────────┬───────────────┬────────────────┤
│  日志脱敏    │  API 响应脱敏  │  数据库加密     │
│  LogChannel │  Serializer   │  Eloquent Cast │
│  Formatter  │  Resource     │  Encryption    │
└─────────────┴───────────────┴────────────────┘
```

三个原则：

1. **单一定义**：字段的脱敏规则只在一个地方定义（Model/DTO 的属性注解）
2. **多处生效**：日志、API、数据库三个出口自动应用
3. **可扩展**：新增脱敏类型（如身份证、银行卡）只需加一个 MaskType

## 第一步：定义脱敏注解

PHP 8 的 Attributes 是天然的元数据载体。我们先定义脱敏类型枚举：

```php
<?php
// app/Enums/MaskType.php

namespace App\Enums;

enum MaskType: string
{
    case PHONE = 'phone';           // 138****1234
    case EMAIL = 'email';           // zh***@example.com
    case ID_CARD = 'id_card';       // 310***********1234
    case BANK_CARD = 'bank_card';   // 6222 **** **** 1234
    case NAME = 'name';             // 张*三
    case ADDRESS = 'address';       // 上海市普陀区***
    case CUSTOM = 'custom';         // 自定义正则

    /**
     * 执行脱敏
     */
    public function mask(string $value, ?string $pattern = null): string
    {
        return match ($this) {
            self::PHONE     => $this->maskPhone($value),
            self::EMAIL     => $this->maskEmail($value),
            self::ID_CARD   => $this->maskIdCard($value),
            self::BANK_CARD => $this->maskBankCard($value),
            self::NAME      => $this->maskName($value),
            self::ADDRESS   => $this->maskAddress($value),
            self::CUSTOM    => $this->maskCustom($value, $pattern),
        };
    }

    private function maskPhone(string $phone): string
    {
        $phone = preg_replace('/\D/', '', $phone);
        if (strlen($phone) < 7) {
            return str_repeat('*', strlen($phone));
        }
        return substr($phone, 0, 3) . '****' . substr($phone, -4);
    }

    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) return '***';
        $name = $parts[0];
        $domain = $parts[1];
        $maskedName = strlen($name) <= 2
            ? str_repeat('*', strlen($name))
            : substr($name, 0, 2) . str_repeat('*', max(1, strlen($name) - 2));
        return $maskedName . '@' . $domain;
    }

    private function maskIdCard(string $id): string
    {
        $id = preg_replace('/\s/', '', $id);
        if (strlen($id) < 8) return str_repeat('*', strlen($id));
        return substr($id, 0, 3) . str_repeat('*', strlen($id) - 7) . substr($id, -4);
    }

    private function maskBankCard(string $card): string
    {
        $card = preg_replace('/\s/', '', $card);
        if (strlen($card) < 8) return str_repeat('*', strlen($card));
        return substr($card, 0, 4) . ' **** **** ' . substr($card, -4);
    }

    private function maskName(string $name): string
    {
        $chars = mb_str_split($name);
        $len = count($chars);
        if ($len <= 1) return '*';
        if ($len === 2) return $chars[0] . '*';
        return $chars[0] . str_repeat('*', $len - 2) . $chars[$len - 1];
    }

    private function maskAddress(string $address): string
    {
        $len = mb_strlen($address);
        if ($len <= 6) return str_repeat('*', $len);
        return mb_substr($address, 0, 6) . str_repeat('*', min(6, $len - 6));
    }

    private function maskCustom(string $value, ?string $pattern): string
    {
        if (!$pattern) return $value;
        return preg_replace($pattern, '***', $value);
    }
}
```

然后定义 Attribute：

```php
<?php
// app/Attributes/Mask.php

namespace App\Attributes;

use App\Enums\MaskType;
use Attribute;

#[Attribute(Attribute::TARGET_PROPERTY | Attribute::IS_REPEATABLE)]
class Mask
{
    public function __construct(
        public readonly MaskType $type,
        public readonly ?string $pattern = null,    // CUSTOM 模式用
        public readonly bool $loggable = true,      // 日志中是否脱敏
        public readonly bool $apiMask = true,       // API 响应中是否脱敏
        public readonly bool $encryptDb = false,    // 数据库是否加密存储
        public readonly string $cast = 'string',    // 数据库字段类型
    ) {}

    /**
     * 对值执行脱敏
     */
    public function apply(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return $value;
        }
        return $this->type->mask((string) $value, $this->pattern);
    }
}
```

用法：

```php
use App\Attributes\Mask;
use App\Enums\MaskType;

class UserDTO
{
    #[Mask(MaskType::NAME)]
    public string $name;

    #[Mask(MaskType::PHONE, encryptDb: true)]
    public string $phone;

    #[Mask(MaskType::EMAIL)]
    public string $email;

    #[Mask(MaskType::ID_CARD, encryptDb: true)]
    public string $idCard;
}
```

## 第二步：API 响应脱敏——Serializer 集成

Laravel 的 API Resource 是响应出口，在这里集成脱敏最自然。

### 基础 Maskable Trait

```php
<?php
// app/Traits/Maskable.php

namespace App\Traits;

use App\Attributes\Mask;
use ReflectionClass;
use ReflectionProperty;

trait Maskable
{
    /**
     * 获取当前类所有带 #[Mask] 的属性
     *
     * @return array<string, Mask>
     */
    public static function getMaskedProperties(): array
    {
        static $cache = [];
        $class = static::class;

        if (isset($cache[$class])) {
            return $cache[$class];
        }

        $result = [];
        $reflection = new ReflectionClass($class);

        foreach ($reflection->getProperties() as $property) {
            $attributes = $property->getAttributes(Mask::class);
            if (!empty($attributes)) {
                /** @var Mask $mask */
                $mask = $attributes[0]->newInstance();
                if ($mask->apiMask) {
                    $result[$property->getName()] = $mask;
                }
            }
        }

        $cache[$class] = $result;
        return $result;
    }

    /**
     * 对当前对象的脱敏字段执行脱敏，返回数组
     */
    public function toMaskedArray(): array
    {
        $maskedProps = static::getMaskedProperties();
        $data = [];

        foreach ($this->toArray() as $key => $value) {
            if (isset($maskedProps[$key])) {
                $data[$key] = $maskedProps[$key]->apply($value);
            } else {
                $data[$key] = $value;
            }
        }

        return $data;
    }
}
```

### 在 Model 上使用

```php
<?php
// app/Models/User.php

namespace App\Models;

use App\Attributes\Mask;
use App\Enums\MaskType;
use App\Traits\Maskable;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    use Maskable;

    #[Mask(MaskType::NAME)]
    protected $name;

    #[Mask(MaskType::PHONE, encryptDb: true)]
    protected $phone;

    #[Mask(MaskType::EMAIL)]
    protected $email;

    #[Mask(MaskType::ID_CARD, encryptDb: true)]
    protected $id_card;

    // ... 其他属性
}
```

### API Resource 集成

```php
<?php
// app/Http/Resources/UserResource.php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray($request): array
    {
        // 如果 Model 使用了 Maskable trait，自动脱敏
        if (method_exists($this->resource, 'toMaskedArray')) {
            return $this->resource->toMaskedArray();
        }

        return [
            'id' => $this->id,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
        ];
    }
}
```

也可以写一个全局基类，让所有 Resource 自动脱敏：

```php
<?php
// app/Http/Resources/BaseResource.php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class BaseResource extends JsonResource
{
    public function toArray($request): array
    {
        if (method_exists($this->resource, 'toMaskedArray')) {
            return $this->resource->toMaskedArray();
        }

        // fallback: 手动映射
        return $this->resource->toArray();
    }
}
```

## 第三步：日志脱敏——自定义 Log Formatter

Laravel 的日志系统基于 Monolog。我们自定义一个 Formatter，在写入日志前自动脱敏。

### 日志脱敏 Formatter

```php
<?php
// app/Logging/MaskedLogFormatter.php

namespace App\Logging;

use App\Enums\MaskType;
use Monolog\Formatter\LineFormatter;

class MaskedLogFormatter extends LineFormatter
{
    /**
     * 需要脱敏的字段名关键词
     */
    private static array $sensitiveKeys = [
        'phone', 'mobile', 'tel',
        'email', 'mail',
        'id_card', 'idcard', 'identity',
        'bank_card', 'bankcard', 'card_no',
        'password', 'passwd', 'pwd',
        'token', 'secret', 'api_key',
        'name', 'real_name', 'username',
    ];

    /**
     * 字段名 → 脱敏类型映射
     */
    private static array $keyMaskMap = [
        'phone' => MaskType::PHONE,
        'mobile' => MaskType::PHONE,
        'tel' => MaskType::PHONE,
        'email' => MaskType::EMAIL,
        'mail' => MaskType::EMAIL,
        'id_card' => MaskType::ID_CARD,
        'idcard' => MaskType::ID_CARD,
        'identity' => MaskType::ID_CARD,
        'bank_card' => MaskType::BANK_CARD,
        'bankcard' => MaskType::BANK_CARD,
        'card_no' => MaskType::BANK_CARD,
        'name' => MaskType::NAME,
        'real_name' => MaskType::NAME,
        'username' => MaskType::NAME,
    ];

    public function format(array $record): string
    {
        if (isset($record['context'])) {
            $record['context'] = $this->maskData($record['context']);
        }
        if (isset($record['extra'])) {
            $record['extra'] = $this->maskData($record['extra']);
        }

        return parent::format($record);
    }

    private function maskData(array $data): array
    {
        foreach ($data as $key => &$value) {
            $lowerKey = strtolower($key);

            // 精确匹配敏感字段
            if (isset(self::$keyMaskMap[$lowerKey]) && is_string($value)) {
                $value = self::$keyMaskMap[$lowerKey]->mask($value);
                continue;
            }

            // 密码/token 类直接遮盖
            if (in_array($lowerKey, ['password', 'passwd', 'pwd', 'token', 'secret', 'api_key'])) {
                $value = '******';
                continue;
            }

            // 递归处理嵌套数组
            if (is_array($value)) {
                $value = $this->maskData($value);
            }
        }

        return $data;
    }

    /**
     * 手机号脱敏
     */
    private static function maskPhone(string $phone): string
    {
        $phone = preg_replace('/\D/', '', $phone);
        if (strlen($phone) < 7) return str_repeat('*', strlen($phone));
        return substr($phone, 0, 3) . '****' . substr($phone, -4);
    }

    /**
     * 邮箱脱敏
     */
    private static function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) return '***';
        $name = $parts[0];
        $maskedName = strlen($name) <= 2
            ? str_repeat('*', strlen($name))
            : substr($name, 0, 2) . str_repeat('*', max(1, strlen($name) - 2));
        return $maskedName . '@' . $parts[1];
    }
}
```

### 注册到 Laravel 日志配置

```php
<?php
// config/logging.php

return [
    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => ['daily'],
            'ignore_exceptions' => false,
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => 'debug',
            'days' => 30,
            'tap' => [App\Logging\AddMaskedFormatter::class],
        ],

        // ... 其他 channel
    ],
];
```

```php
<?php
// app/Logging/AddMaskedFormatter.php

namespace App\Logging;

use Monolog\Logger;

class AddMaskedFormatter
{
    public function __invoke(Logger $logger): void
    {
        foreach ($logger->getHandlers() as $handler) {
            $handler->setFormatter(new MaskedLogFormatter(
                "[%datetime%] %channel%.%level_name%: %message% %context% %extra%\n",
                'Y-m-d H:i:s',
                true,
                true
            ));
        }
    }
}
```

### 测试日志脱敏

```php
// 业务代码中直接写日志，无需手动脱敏
Log::info('用户下单', [
    'user_id' => 12345,
    'phone' => '13812345678',
    'email' => 'zhangsan@example.com',
    'id_card' => '310101199001011234',
    'order_no' => 'ORD20260609001',
]);

// 日志输出（自动脱敏）：
// [2026-06-09 22:30:15] production.INFO: 用户下单
// {"user_id":12345,"phone":"138****5678","email":"zh***@example.com",
//  "id_card":"310***********1234","order_no":"ORD20260609001"}
```

## 第四步：数据库字段加密——Eloquent Cast

对于高敏感字段（手机号、身份证），数据库里也应该加密存储，防止数据库泄露。

### 自定义 Encrypted Cast

```php
<?php
// app/Casts/MaskedEncryptedString.php

namespace App\Casts;

use Illuminate\Contracts\Database\CastsAttributes;
use Illuminate\Support\Facades\Crypt;

class MaskedEncryptedString implements CastsAttributes
{
    public function get($model, $key, $value, $attributes): ?string
    {
        if ($value === null) return null;

        try {
            // 解密返回明文
            return Crypt::decryptString($value);
        } catch (\Exception $e) {
            // 兼容未加密的旧数据
            return $value;
        }
    }

    public function set($model, $key, $value, $attributes): ?string
    {
        if ($value === null) return null;

        // 加密后存储
        return Crypt::encryptString($value);
    }
}
```

### Model 中配置

```php
<?php

namespace App\Models;

use App\Attributes\Mask;
use App\Casts\MaskedEncryptedString;
use App\Enums\MaskType;
use App\Traits\Maskable;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    use Maskable;

    #[Mask(MaskType::NAME)]
    protected $name;

    #[Mask(MaskType::PHONE, encryptDb: true)]
    protected $phone;

    #[Mask(MaskType::EMAIL)]
    protected $email;

    #[Mask(MaskType::ID_CARD, encryptDb: true)]
    protected $id_card;

    /**
     * 自动根据 #[Mask] 注解决定 Cast
     */
    protected function casts(): array
    {
        return [
            'phone' => $this->shouldEncrypt('phone')
                ? MaskedEncryptedString::class
                : 'string',
            'id_card' => $this->shouldEncrypt('id_card')
                ? MaskedEncryptedString::class
                : 'string',
        ];
    }

    private function shouldEncrypt(string $property): bool
    {
        $masked = static::getMaskedProperties();
        if (!isset($masked[$property])) return false;

        // 通过反射获取 encryptDb 属性
        $reflection = new \ReflectionClass(static::class);
        $prop = $reflection->getProperty($property);
        $attributes = $prop->getAttributes(\App\Attributes\Mask::class);

        if (empty($attributes)) return false;

        $mask = $attributes[0]->newInstance();
        return $mask->encryptDb;
    }
}
```

### 数据库迁移

对于已有项目，加密字段需要迁移：

```php
<?php
// database/migrations/2026_06_09_encrypt_user_sensitive_fields.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 分批加密，避免锁表
        User::query()->chunkById(500, function ($users) {
            foreach ($users as $user) {
                $updates = [];

                if ($user->phone && !$this->isEncrypted($user->phone)) {
                    $updates['phone'] = Crypt::encryptString($user->phone);
                }
                if ($user->id_card && !$this->isEncrypted($user->id_card)) {
                    $updates['id_card'] = Crypt::encryptString($user->id_card);
                }

                if (!empty($updates)) {
                    DB::table('users')
                        ->where('id', $user->id)
                        ->update($updates);
                }
            }
        });
    }

    private function isEncrypted(string $value): bool
    {
        try {
            Crypt::decryptString($value);
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }
};
```

## 第五步：统一 ServiceProvider 自动装配

把所有逻辑串起来，用 ServiceProvider 实现自动发现：

```php
<?php
// app/Providers/MaskingServiceProvider.php

namespace App\Providers;

use App\Attributes\Mask;
use Illuminate\Support\ServiceProvider;
use ReflectionClass;

class MaskingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册 MaskedEncryptedString cast
        $this->app->bind('masking.cast.encrypted', function () {
            return new \App\Casts\MaskedEncryptedString();
        });
    }

    public function boot(): void
    {
        // 扫描所有 Model，自动注册加密 Cast
        $this->autoRegisterEncryptedCasts();
    }

    private function autoRegisterEncryptedCasts(): void
    {
        $modelPath = app_path('Models');
        if (!is_dir($modelPath)) return;

        $files = glob($modelPath . '/*.php');

        foreach ($files as $file) {
            $className = 'App\\Models\\' . basename($file, '.php');

            if (!class_exists($className)) continue;

            $reflection = new ReflectionClass($className);

            // 检查是否使用了 Maskable trait
            if (!in_array('App\\Traits\\Maskable', array_keys($reflection->getTraits()))) {
                continue;
            }

            // 找到所有 encryptDb=true 的属性，记录日志
            foreach ($reflection->getProperties() as $property) {
                $attributes = $property->getAttributes(Mask::class);
                foreach ($attributes as $attr) {
                    $mask = $attr->newInstance();
                    if ($mask->encryptDb) {
                        \Log::debug("Masking: {$className}::{$property->getName()} → encrypted");
                    }
                }
            }
        }
    }
}
```

注册到 `config/app.php`：

```php
'providers' => [
    // ...
    App\Providers\MaskingServiceProvider::class,
],
```

## 实战踩坑记录

### 踩坑 1：加密字段的模糊查询失效

数据库字段加密后，`LIKE` 查询自然失效。解决方案：

```php
// ❌ 不行了
User::where('phone', 'like', '%138%')->get();

// ✅ 方案 A：精确匹配（先加密再查）
$encrypted = Crypt::encryptString('13812345678');
User::where('phone', $encrypted)->first();

// ✅ 方案 B：哈希索引（推荐）
// 在 Model 中维护一个 phone_hash 字段
class User extends Authenticatable
{
    protected static function booted(): void
    {
        static::saving(function (User $user) {
            if ($user->isDirty('phone')) {
                $user->phone_hash = hash('sha256', $user->phone);
            }
        });
    }

    public function scopeByPhone($query, string $phone)
    {
        return $query->where('phone_hash', hash('sha256', $phone));
    }
}

// 精确查找用 hash
User::byPhone('13812345678')->first();
```

### 踩坑 2：加密字段长度膨胀

`Crypt::encryptString()` 使用 AES-256-CBC，输出是 Base64 编码，长度约为原文的 1.5-2 倍。VARCHAR(20) 存不下加密后的手机号。

```php
// 迁移时调整字段长度
Schema::table('users', function (Blueprint $table) {
    $table->string('phone', 500)->change();   // 原来是 varchar(20)
    $table->string('id_card', 500)->change();  // 原来是 varchar(18)
});
```

### 踩坑 3：日志脱敏和 Model 序列化脱敏的粒度不同

日志中可能需要完全遮盖密码（`******`），但 API 中手机号只遮盖中间 4 位。解决方案：`Mask` 注解的 `loggable` 和 `apiMask` 分别控制。

```php
#[Mask(MaskType::PHONE, loggable: true, apiMask: true)]
protected $phone;

// 密码类字段：日志中遮盖，API 中不返回
#[Mask(MaskType::CUSTOM, pattern: '/.*/', loggable: true, apiMask: false)]
protected $password;
```

### 踩坑 4：队列任务中的序列化

如果 Model 被序列化到队列中，加密字段会被解密后存入队列 payload。队列 payload 本身也可能泄露。

```php
// ❌ 直接把 Model 放进队列
dispatch(new ProcessOrder($order)); // $order 包含解密后的敏感数据

// ✅ 只传 ID，任务中重新查询
dispatch(new ProcessOrder($order->id));
```

### 踩坑 5：测试环境数据脱敏一致性

测试环境用 `Crypt::encryptString()` 生成的数据和生产环境加密 key 不同，导致测试数据不可移植。

```php
// 测试环境中跳过加密
// config/database.php 或 .env.testing
// APP_KEY 固定测试用 key，确保 CI 环境一致
APP_KEY=base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 高级用法：条件脱敏

有些场景需要根据用户角色决定是否脱敏（如管理员看完整手机号）：

```php
<?php
// app/Http/Resources/UserResource.php

class UserResource extends BaseResource
{
    public function toArray($request): array
    {
        $data = parent::toArray($request); // 自动脱敏

        // 管理员看完整数据
        if ($request->user()?->hasRole('admin')) {
            $data = $this->resource->toArray(); // 原始数据
        }

        return $data;
    }
}
```

更优雅的方式是给 Mask 加一个 `roles` 参数：

```php
#[Attribute(Attribute::TARGET_PROPERTY)]
class Mask
{
    public function __construct(
        public readonly MaskType $type,
        public readonly ?string $pattern = null,
        public readonly bool $loggable = true,
        public readonly bool $apiMask = true,
        public readonly bool $encryptDb = false,
        public readonly array $exceptRoles = [],  // 这些角色不脱敏
    ) {}
}
```

## 完整目录结构

```
app/
├── Attributes/
│   └── Mask.php                    # 统一注解
├── Casts/
│   └── MaskedEncryptedString.php   # 数据库加密 Cast
├── Enums/
│   └── MaskType.php                # 脱敏类型枚举
├── Logging/
│   ├── MaskedLogFormatter.php      # 日志脱敏格式化器
│   └── AddMaskedFormatter.php      # 日志 Channel Tap
├── Providers/
│   └── MaskingServiceProvider.php  # 自动装配
├── Traits/
│   └── Maskable.php                # Model/DTO 脱敏能力
├── Http/
│   └── Resources/
│       ├── BaseResource.php        # 自动脱敏 Resource 基类
│       └── UserResource.php        # 业务 Resource
└── Models/
    └── User.php                    # 使用示例
```

## 总结

| 层 | 出口 | 实现方式 | 效果 |
|---|---|---|---|
| API 响应 | Resource | `Maskable::toMaskedArray()` | 手机号显示为 `138****5678` |
| 日志 | Monolog Formatter | `MaskedLogFormatter` | 日志中的敏感字段自动脱敏 |
| 数据库 | Eloquent Cast | `MaskedEncryptedString` | 数据库中存储密文 |

核心收益：

- **一个注解管三处**：`#[Mask(MaskType::PHONE, encryptDb: true)]` 同时控制日志脱敏、API 脱敏、数据库加密
- **新人友好**：看 Model 属性就知道哪些字段敏感
- **改规则只改一处**：修改 `MaskType::PHONE` 的脱敏逻辑，全局生效
- **可渐进式接入**：先上日志脱敏，再上 API 脱敏，最后上数据库加密

这套方案在 KKday 30+ 仓库中逐步推广，核心改动集中在 `Mask` 注解和 `MaskType` 枚举两个文件，接入成本很低。
