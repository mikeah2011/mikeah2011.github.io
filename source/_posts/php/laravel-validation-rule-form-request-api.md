---
title: Laravel Validation 深度实战：自定义 Rule 类、Form Request 嵌套验证、API 响应标准化——30+ 仓库的验证治理方法论
keywords: [Laravel Validation, Rule, Form Request, API, 深度实战, 自定义, 嵌套验证, 响应标准化, 仓库的验证治理方法论, PHP]
date: 2026-06-10 04:43:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Validation
  - FormRequest
  - Rule
  - API
  - 架构
description: 从 30+ Laravel 仓库的验证痛点出发，系统讲解自定义 Rule 类、FormRequest 嵌套验证、API 响应标准化的完整方法论，附带可运行的生产级代码。
---


# Laravel Validation 深度实战：自定义 Rule 类、Form Request 嵌套验证、API 响应标准化——30+ 仓库的验证治理方法论

## 为什么要写这篇文章

管理 30+ 个 Laravel 仓库后，验证层的问题反复出现：

- 同一个「手机号格式」校验散落在 5 个仓库里，各有各的写法
- Controller 里堆了 80 行 `if ($validator->fails())` 样板代码
- API 返回的错误格式不统一，前端同学每次都要适配不同结构
- 嵌套数据的验证逻辑写在闭包里，无法复用，也无法单元测试

这篇文章从这些真实痛点出发，给出一套完整的验证治理方案。

## 一、基础回顾：Laravel Validation 的三板斧

Laravel 内置了三种验证方式，大多数开发者只用到了第一种：

```php
// 1. 直接在 Controller 里验证（最常见，也最乱）
$request->validate([
    'name' => 'required|string|max:255',
    'email' => 'required|email',
]);

// 2. 使用 Validator Facade
$validator = Validator::make($request->all(), [
    'amount' => 'required|numeric|min:0',
]);

// 3. FormRequest（最推荐，但很多人不会用）
// app/Http/Requests/CreateOrderRequest.php
```

**问题不在基础用法，而在于当你有 30+ 仓库、几十个团队成员时，验证层会失控。**

## 二、自定义 Rule 类：把验证逻辑变成可复用的组件

### 2.1 为什么要用自定义 Rule

内联验证规则 `regex:/^1[3-9]\d{9}$/` 的问题：

- 可读性差：下一个人看不懂这个正则什么意思
- 不可复用：另一个仓库需要同样的验证，只能复制粘贴
- 无法测试：闭包和正则很难写单元测试

### 2.2 创建自定义 Rule

```bash
php artisan make:rule PhoneNumber
```

```php
<?php
// app/Rules/PhoneNumber.php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class PhoneNumber implements ValidationRule
{
    /**
     * 支持的手机号正则列表
     * 生产环境建议从配置文件读取
     */
    private const PATTERNS = [
        'CN' => '/^1[3-9]\d{9}$/',
        'TW' => '/^09\d{8}$/',
        'JP' => '/^0[789]0\d{8}$/',
    ];

    public function __construct(
        private string $country = 'CN'
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $pattern = self::PATTERNS[$this->country] ?? null;

        if ($pattern === null) {
            $fail("不支持的国家代码: {$this->country}");
            return;
        }

        if (!is_string($value) || !preg_match($pattern, $value)) {
            $fail("{$attribute} 不是有效的 {$this->country} 手机号码");
        }
    }
}
```

### 2.3 使用自定义 Rule

```php
// Controller 里
use App\Rules\PhoneNumber;

public function store(Request $request)
{
    $validated = $request->validate([
        'phone' => ['required', new PhoneNumber('CN')],
        'name'  => 'required|string|max:255',
    ]);

    // $validated 已经是清洗后的数据
}
```

### 2.4 Rule 的高级技巧：组合验证

当验证逻辑涉及多个字段的交叉校验时，Rule 类比内联规则强太多：

```php
<?php
// app/Rules/DateRange.php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class DateRange implements ValidationRule
{
    public function __construct(
        private string $startField = 'start_date',
        private string $endField = 'end_date'
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $start = request()->input($this->startField);
        $end = $value; // $value 就是 end_date 的值

        if (empty($start) || empty($end)) {
            return; // 另一个 Rule 会处理空值
        }

        $startDt = \Carbon\Carbon::parse($start);
        $endDt = \Carbon\Carbon::parse($end);

        if ($endDt->lt($startDt)) {
            $fail('结束日期不能早于开始日期');
        }

        if ($startDt->diffInDays($endDt) > 365) {
            $fail('日期范围不能超过一年');
        }
    }
}
```

使用方式：

```php
$request->validate([
    'start_date' => 'required|date|before_or_equal:end_date',
    'end_date'   => ['required', 'date', new DateRange('start_date', 'end_date')],
]);
```

## 三、FormRequest：验证层的正确打开方式

### 3.1 为什么 Controller 里不应该写验证

一个典型的 Controller 应该长这样：

```php
// ❌ 错误示范：验证逻辑堆在 Controller 里
class OrderController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'product_id' => 'required|exists:products,id',
            'quantity'   => 'required|integer|min:1',
            'address'    => 'required|string|max:500',
        ]);

        // 业务逻辑...
    }

    public function update(Request $request, Order $order)
    {
        $validated = $request->validate([
            'quantity'   => 'required|integer|min:1',
            'address'    => 'sometimes|string|max:500',
        ]);

        // 又是几乎一样的验证...
    }
}
```

改用 FormRequest 后：

```php
// ✅ 正确示范
class OrderController extends Controller
{
    public function store(StoreOrderRequest $request)
    {
        $order = Order::create($request->validated());
        return response()->json($order, 201);
    }

    public function update(UpdateOrderRequest $request, Order $order)
    {
        $order->update($request->validated());
        return response()->json($order);
    }
}
```

### 3.2 FormRequest 的完整写法

```php
<?php
// app/Http/Requests/StoreOrderRequest.php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 鉴权逻辑放在 Rule 里，Controller 保持干净
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'product_id' => 'required|exists:products,id',
            'quantity'   => 'required|integer|min:1|max:99',
            'address'    => 'required|string|max:500',
            'note'       => 'nullable|string|max:1000',
        ];
    }

    public function messages(): array
    {
        return [
            'product_id.required' => '请选择商品',
            'product_id.exists'   => '商品不存在或已下架',
            'quantity.min'        => '数量至少为 1',
            'quantity.max'        => '单次最多购买 99 件',
            'address.required'    => '请填写收货地址',
        ];
    }
}
```

### 3.3 FormRequest 嵌套验证：处理复杂数据结构

这是很多人不知道的高级用法。当 API 需要接收嵌套 JSON 时：

```php
<?php
// app/Http/Requests/BulkCreateOrderRequest.php

namespace App\Http\Requests;

use App\Rules\PhoneNumber;
use Illuminate\Foundation\Http\FormRequest;

class BulkCreateOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'customer_name'  => 'required|string|max:255',
            'customer_phone' => ['required', new PhoneNumber('CN')],
            'items'          => 'required|array|min:1|max:10',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.quantity'   => 'required|integer|min:1|max:99',
            'items.*.options'    => 'nullable|array',
            'items.*.options.color' => 'required_with:items.*.options|string',
            'items.*.options.size'  => 'required_with:items.*.options|in:XS,S,M,L,XL',
        ];
    }
}
```

前端发送的数据结构：

```json
{
    "customer_name": "张三",
    "customer_phone": "13800138000",
    "items": [
        {
            "product_id": 1,
            "quantity": 2,
            "options": {
                "color": "red",
                "size": "L"
            }
        }
    ]
}
```

### 3.4 FormRequest 中的条件验证

不同场景下验证规则不同，用 `Rule::when` 或条件逻辑处理：

```php
<?php
// app/Http/Requests/StorePaymentRequest.php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $rules = [
            'amount'   => 'required|numeric|min:0.01',
            'currency' => 'required|in:CNY,USD,TWD',
            'method'   => 'required|in:alipay,wechat,bank',
        ];

        // 根据支付方式添加不同的验证规则
        $rules = array_merge($rules, match ($this->input('method')) {
            'alipay' => [
                'alipay_account' => 'required|email',
            ],
            'wechat' => [
                'openid' => 'required|string',
            ],
            'bank' => [
                'bank_account' => 'required|string|min:16|max:19',
                'bank_name'    => 'required|string',
            ],
            default => [],
        });

        return $rules;
    }
}
```

## 四、API 响应标准化：让前端不再适配 N 种错误格式

### 4.1 问题：30 个仓库的错误格式各不相同

```json
// 仓库 A 的返回
{"message": "Validation failed", "errors": {"email": ["邮箱已存在"]}}

// 仓库 B 的返回
{"status": "error", "msg": "参数错误", "data": {"email": "邮箱已存在"}}

// 仓库 C 的返回
{"error": 422, "detail": "email: 邮箱已存在"}
```

前端同学看到这种场面，内心是崩溃的。

### 4.2 统一的异常处理器

```php
<?php
// app/Exceptions/Handler.php

namespace App\Exceptions;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

class Handler extends ExceptionHandler
{
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    public function render($request, Throwable $e)
    {
        if ($request->is('api/*') || $request->wantsJson()) {
            return $this->handleApiException($request, $e);
        }

        return parent::render($request, $e);
    }

    private function handleApiException($request, Throwable $e)
    {
        if ($e instanceof ValidationException) {
            return $this->formatValidationErrors($e);
        }

        if ($e instanceof AuthenticationException) {
            return $this->jsonResponse([
                'code'    => 401,
                'message' => '未登录或登录已过期',
            ], 401);
        }

        if ($e instanceof NotFoundHttpException) {
            return $this->jsonResponse([
                'code'    => 404,
                'message' => '资源不存在',
            ], 404);
        }

        $status = method_exists($e, 'getStatusCode') ? $e->getStatusCode() : 500;
        $message = config('app.debug') ? $e->getMessage() : '服务器内部错误';

        return $this->jsonResponse([
            'code'    => $status,
            'message' => $message,
        ], $status);
    }

    private function formatValidationErrors(ValidationException $e): \Illuminate\Http\JsonResponse
    {
        $errors = [];
        foreach ($e->errors() as $field => $messages) {
            // 用点号表示嵌套字段：items.0.product_id
            $errors[$field] = $messages[0];
        }

        return $this->jsonResponse([
            'code'    => 422,
            'message' => '参数验证失败',
            'errors'  => $errors,
        ], 422);
    }

    private function jsonResponse(array $data, int $status): \Illuminate\Http\JsonResponse
    {
        return response()->json($data, $status);
    }
}
```

### 4.3 返回格式规范

```json
{
    "code": 422,
    "message": "参数验证失败",
    "errors": {
        "customer_phone": "customer_phone 不是有效的 CN 手机号码",
        "items.0.product_id": "所选商品不存在或已下架"
    }
}
```

字段说明：

- `code`：业务状态码，直接映射 HTTP 状态码
- `message`：人类可读的错误描述
- `errors`：字段级错误详情（仅 422 时存在）

## 五、验证规则的组织：Trait 方式复用

30 个仓库里的验证规则需要统一管理。用 Trait 把通用规则抽出来：

```php
<?php
// app/Traits/ValidationRules.php

namespace App\Traits;

use App\Rules\PhoneNumber;
use Illuminate\Validation\Rule;

trait ValidationRules
{
    /**
     * 通用字段验证规则
     */
    protected function commonRules(): array
    {
        return [
            'id'       => 'required|integer|min:1',
            'page'     => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
            'sort'     => 'nullable|in:asc,desc',
        ];
    }

    /**
     * 手机号验证
     */
    protected function phoneRule(string $country = 'CN'): array
    {
        return ['required', new PhoneNumber($country)];
    }

    /**
     * 中文姓名
     */
    protected function chineseNameRule(): array
    {
        return ['required', 'string', 'max:50', 'regex:/^[\x{4e00}-\x{9fa5}]+$/u'];
    }

    /**
     * 分页排序规则
     */
    protected function paginationRules(): array
    {
        return [
            'page'     => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
            'sort'     => ['nullable', Rule::in(['asc', 'desc'])],
            'order_by' => 'nullable|string|in:id,created_at,updated_at',
        ];
    }
}
```

在 FormRequest 中使用：

```php
<?php

namespace App\Http\Requests;

use App\Traits\ValidationRules;
use Illuminate\Foundation\Http\FormRequest;

class ListOrdersRequest extends FormRequest
{
    use ValidationRules;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge(
            $this->paginationRules(),
            [
                'status'    => 'nullable|in:pending,paid,shipped,completed',
                'date_from' => 'nullable|date|before_or_equal:date_to',
                'date_to'   => 'nullable|date|after_or_equal:date_from',
            ]
        );
    }
}
```

## 六、实战踩坑记录

### 坑 1：`validate()` 抛异常时返回 422，但前端收不到

**现象**：`$request->validate()` 验证失败时抛出 `ValidationException`，但返回的状态码是 404。

**原因**：路由定义的中间件里有 `ConvertEmptyStringsToNull`，它把空字符串转成 null 后，验证规则的行为发生了变化。加上 `Accept: application/json` header 没加。

**解决**：确认请求带 `Accept: application/json` header，或者在 axios 里全局设置 `headers.common['Accept'] = 'application/json'`。

### 坑 2：嵌套验证的错误消息可读性差

**现象**：返回 `"items.0.product_id": "The selected product id is invalid."`，前端展示起来很丑。

**解决**：在 FormRequest 的 `messages()` 方法中自定义，或者在异常处理器里用点号分割后格式化：

```php
// 格式化嵌套字段名
private function formatFieldName(string $field): string
{
    $parts = explode('.', $field);
    // 这里可以加翻译逻辑
    return $field;
}
```

### 坑 3：`sometimes` 规则导致字段意外被忽略

**现象**：用 `sometimes` 时，如果字段在请求中不存在，验证直接跳过，后续业务逻辑拿到 null。

**解决**：明确区分「可选字段」和「条件必填字段」：

```php
// ❌ 容易出问题
'phone' => 'sometimes|required',

// ✅ 用 nullable + required_if
'phone' => 'nullable|required_if:contact_method,phone',
```

### 坑 4：多语言错误消息的管理

30+ 个仓库，错误消息的语言管理是个大工程。用 `lang` 目录统一管理：

```php
// resources/lang/zh/validation.php
'attributes' => [
    'email'         => '邮箱',
    'password'      => '密码',
    'customer_name' => '客户姓名',
    'customer_phone'=> '手机号码',
    'product_id'    => '商品ID',
    'quantity'      => '数量',
],
```

然后在 FormRequest 的 `messages()` 中引用 key：

```php
public function messages(): array
{
    return [
        'customer_phone.required' => ':attribute 不能为空',
        'customer_phone.*'       => ':attribute 格式不正确',
    ];
}
```

### 坑 5：验证规则的执行顺序

**现象**：`exists:products,id` 在 `required` 之前执行，导致空值直接查数据库。

**解决**：Laravel 的验证规则从左到右执行，把 `required` 放在第一位永远是最安全的：

```php
// ❌ 错误顺序
'product_id' => 'exists:products,id|required',

// ✅ 正确顺序
'product_id' => 'required|exists:products,id',
```

## 七、项目中的验证治理检查清单

在 30+ 个仓库的验证治理过程中，总结出这个检查清单：

| 检查项 | 状态 |
|--------|------|
| 所有 Controller 不再直接写 `$request->validate()` | ☐ |
| 通用验证规则提取到 Trait 或 Rule 类 | ☐ |
| API 异常处理器统一返回格式 | ☐ |
| 嵌套验证有对应的 FormRequest | ☐ |
| 错误消息使用中文翻译 | ☐ |
| 自定义 Rule 有单元测试 | ☐ |
| 前端 axios 已设置 `Accept: application/json` | ☐ |

## 八、总结

Laravel 的验证系统设计得很优秀，但「能用」和「用好」之间差距很大。在多仓库、多团队的环境下，验证治理不是可选项，而是必选项：

1. **Rule 类**：把验证逻辑封装成可复用、可测试的组件
2. **FormRequest**：把验证逻辑从 Controller 中剥离，让 Controller 只负责业务流程
3. **异常处理器**：统一 API 错误返回格式，前端不再需要适配多种结构
4. **Trait 复用**：通用规则跨仓库共享，避免重复造轮子

验证不是写一次就完事的事。随着业务变化，验证规则也需要持续维护。但只要架构搭对了，维护成本会大幅降低。

---

*这篇文章写于管理 30+ Laravel 仓库的实战经验之上。如果你也在做类似的验证治理，欢迎交流。*
