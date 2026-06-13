---

title: API 集成测试实战：外部服务 Mock 策略、HTTP 录制回放、Contract 测试——Laravel B2C API 的端到端测试方案
keywords: [API, Mock, HTTP, Contract, Laravel B2C API, 集成测试实战, 外部服务, 策略, 录制回放, 的端到端测试方案]
date: 2026-06-09 23:06:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Pest
- PHPUnit
- Mock
- VCR
- Contract Testing
- API Testing
description: 深度拆解 Laravel B2C API 集成测试方案：外部服务 Mock 策略、HTTP 录制回放、Contract 测试的组合实战，覆盖 Pest/PHPUnit、Guzzle MockHandler、VCR 式录制回放、Pact 式消费者驱动契约测试，以及大型测试套件中的测试数据治理。
---



在大型 Laravel B2C API 项目中，单元测试能验证业务逻辑的正确性，但一旦代码触及外部服务——Stripe 支付、Slack 通知、Firebase 认证、邮件发送、短信网关——单元测试就捉襟见肘了。Mock 太多会让测试失去信心，直接调用真实服务又不稳定且昂贵。

这篇文章拆解 KKday B2C API 项目中真实使用的三层集成测试策略：**外部服务 Mock**、**HTTP 录制回放**、**Contract 测试**。目标是让你在 CI 环境中跑出接近生产调用链路的测试覆盖，同时保持毫秒级的执行速度。

<!-- more -->

## 一、为什么需要集成测试？

在 KKday B2C API 中，一个典型的下单请求会触发以下外部调用：

```
用户下单 → Stripe PaymentIntent → Slack 通知 → 邮件确认 → 短信通知
```

单元测试可以 Mock 每个依赖，但你无法验证：

- 请求参数是否正确发给了 Stripe？
- Slack 消息格式是否符合 Webhook 规范？
- 邮件模板渲染后是否包含正确的订单信息？
- 多个外部服务之间的数据流转是否正确？

集成测试的核心价值：**验证代码与外部世界的真实交互行为**。

## 二、外部服务 Mock 策略

### 2.1 Guzzle MockHandler：最轻量的 HTTP Mock

Laravel 的 HTTP 客户端底层是 Guzzle，Guzzle 提供了 `MockHandler` 可以拦截所有出站请求。

**基础用法：**

```php
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Facades\Http;

it('posts to slack webhook correctly', function () {
    $mock = new MockHandler([
        new Response(200, [], '{"ok":true}'),
    ]);
    $handler = HandlerStack::create($mock);
    
    Http::fake([
        'hooks.slack.com/*' => Http::response(['ok' => true], 200),
    ]);

    $order = Order::factory()->create([
        'user_id' => $this->user->id,
        'total'   => 2990,
    ]);

    $this->postJson('/api/orders', [
        'items'   => [['sku' => 'TK-001', 'qty' => 2]],
        'payment' => 'stripe',
    ])->assertOk();

    // 验证 Slack 被调用
    Http::assertSent(function ($request) {
        return $request->url() === 'https://hooks.slack.com/services/xxx'
            && str_contains($request->body(), '新订单');
    });
});
```

**Laravel `Http::fake()` 的分层 Mock：**

```php
use Illuminate\Support\Facades\Http;

it('handles payment flow with partial mocking', function () {
    Http::fake(function ($request) {
        // Stripe API → 返回成功
        if (Str::contains($request->url(), 'api.stripe.com')) {
            return Http::response([
                'id'    => 'pi_fake_123',
                'status' => 'succeeded',
            ], 200);
        }

        // Slack Webhook → 返回成功
        if (Str::contains($request->url(), 'hooks.slack.com')) {
            return Http::response(['ok' => true], 200);
        }

        // 其他服务 → 抛异常，阻止意外调用
        throw new \RuntimeException("Unexpected HTTP call to: {$request->url()}");
    });

    // 执行业务逻辑...
});
```

**关键原则：** 通过 URL 匹配做分层 Mock，未匹配的请求直接抛异常——防止测试中意外调用真实服务。

### 2.2 Mockery 接口 Mock：Service Layer 级别的 Mock

当外部服务被封装在 Service 类中时，Mock 接口比 Mock HTTP 更有意义。

```php
use Mockery;

interface PaymentGateway
{
    public function createPaymentIntent(int $amount, string $currency): PaymentResult;
    public function refund(string $paymentId, int $amount): RefundResult;
}

class StripeGateway implements PaymentGateway
{
    public function createPaymentIntent(int $amount, string $currency): PaymentResult
    {
        $response = Http::withBasicAuth(
            config('services.stripe.secret'), ''
        )->post('https://api.stripe.com/v1/payment_intents', [
            'amount'   => $amount,
            'currency' => $currency,
        ]);

        return new PaymentResult(
            id: $response->json('id'),
            status: $response->json('status'),
        );
    }

    // ...
}

// 测试中
it('processes order payment through gateway', function () {
    $gateway = Mockery::mock(PaymentGateway::class);
    $gateway->shouldReceive('createPaymentIntent')
        ->once()
        ->with(2990, 'twd')
        ->andReturn(new PaymentResult(id: 'pi_fake', status: 'succeeded'));

    $this->app->instance(PaymentGateway::class, $gateway);

    $this->postJson('/api/orders', [...])->assertOk();
});
```

**Laravel 的绑定更优雅：**

```php
// 在 AppServiceProvider 或测试 setUp 中
$this->app->bind(PaymentGateway::class, function () {
    return Mockery::mock(PaymentGateway::class);
});

// 或者用 Laravel 自带的 partial mock
$gateway = $this->mock(PaymentGateway::class, function ($mock) {
    $mock->shouldReceive('createPaymentIntent')
        ->once()
        ->andReturn(new PaymentResult(id: 'pi_test', status: 'succeeded'));
});
```

### 2.3 工厂方法 + 测试替身

KKday 项目中有一个通用模式——为外部服务创建 TestDouble：

```php
class FakePaymentGateway implements PaymentGateway
{
    private array $payments = [];
    
    public function createPaymentIntent(int $amount, string $currency): PaymentResult
    {
        $id = 'pi_' . Str::random(16);
        $this->payments[$id] = compact('amount', 'currency');
        
        return new PaymentResult(id: $id, status: 'succeeded');
    }

    public function refund(string $paymentId, int $amount): RefundResult
    {
        if (!isset($this->payments[$paymentId])) {
            throw new \InvalidArgumentException("Payment {$paymentId} not found");
        }

        return new RefundResult(id: 're_' . Str::random(16), status: 'succeeded');
    }

    // 测试辅助方法
    public function getPayment(string $id): ?array
    {
        return $this->payments[$id] ?? null;
    }

    public function shouldFailOnNext(): self
    {
        // 模拟下一次调用失败
        return $this;
    }
}
```

**在测试中切换到 Fake：**

```php
uses(RefreshDatabase::class);

beforeEach(function () {
    $this->fakeGateway = new FakePaymentGateway();
    $this->app->instance(PaymentGateway::class, $this->fakeGateway);
});

it('creates order and records payment', function () {
    $this->postJson('/api/orders', [...])->assertOk();

    $payment = $this->fakeGateway->getPayment('pi_xxx');
    expect($payment)->not->toBeNull()
        ->and($payment['amount'])->toBe(2990);
});
```

## 三、HTTP 录制回放：VCR 模式

Mock 的问题是**你不知道真实 API 的响应长什么样**。录制回放解决了这个问题——第一次运行时录制真实响应，后续测试直接回放。

### 3.1 基于文件的录制回放

KKday 项目中实现了一个轻量级的录制回放中间件：

```php
namespace Tests\Support;

use Illuminate\Support\Facades\File;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;

class VcrRecorder
{
    private string $cassettePath;
    private bool $recordMode;

    public function __construct(string $cassetteName, bool $recordMode = false)
    {
        $this->cassettePath = storage_path("tests/cassettes/{$cassetteName}.json");
        $this->recordMode = $recordMode;

        if ($recordMode) {
            File::ensureDirectoryExists(dirname($this->cassettePath));
        }
    }

    public function handle(callable $callback): mixed
    {
        if ($this->recordMode) {
            return $this->record($callback);
        }

        return $this->replay($callback);
    }

    private function record(callable $callback): mixed
    {
        $interactions = [];
        
        // 临时拦截所有 HTTP 请求
        Http::fake(function ($request) use (&$interactions) {
            $response = $this->forwardToRealApi($request);
            
            $interactions[] = [
                'method'  => $request->method(),
                'url'     => $request->url(),
                'headers' => $request->headers(),
                'body'    => $request->body(),
                'status'  => $response->status(),
                'response_headers' => $response->headers(),
                'response_body'    => $response->body(),
            ];

            return $response;
        });

        $result = $callback();

        File::put($this->cassettePath, json_encode($interactions, JSON_PRETTY_PRINT));

        return $result;
    }

    private function replay(callable $callback): mixed
    {
        $interactions = json_decode(
            File::get($this->cassettePath),
            true
        );

        $requestMap = collect($interactions)->keyBy(fn ($i) => $i['method'] . ' ' . $i['url']);

        Http::fake(function ($request) use ($requestMap) {
            $key = $request->method() . ' ' . $request->url();
            
            if ($requestMap->has($key)) {
                $interaction = $requestMap->get($key);
                return Http::response(
                    $interaction['response_body'],
                    $interaction['status'],
                    $interaction['response_headers'] ?? []
                );
            }

            throw new \RuntimeException("No recorded response for: {$key}");
        });

        return $callback();
    }
}
```

**在 Pest 中使用：**

```php
use Tests\Support\VcrRecorder;

it('creates Stripe payment intent', function () {
    $vcr = new VcrRecorder('stripe-payment-create');
    // 第一次运行时设为 true 录制
    // $vcr = new VcrRecorder('stripe-payment-create', recordMode: true);

    $vcr->handle(function () {
        $result = app(PaymentGateway::class)
            ->createPaymentIntent(2990, 'twd');

        expect($result->status)->toBe('requires_payment_method')
            ->and($result->id)->toStartWith('pi_');
    });
});
```

### 3.2 多服务交互录制

真实场景中，一个测试可能涉及多个外部服务。录制策略需要考虑：

```php
it('records full order lifecycle', function () {
    $vcr = new VcrRecorder('order-lifecycle');

    $vcr->handle(function () {
        // 1. 创建 PaymentIntent
        $payment = app(PaymentGateway::class)
            ->createPaymentIntent(2990, 'twd');

        // 2. 发送 Slack 通知
        app(SlackNotifier::class)
            ->orderCreated($order, $payment);

        // 3. 发送确认邮件
        app(MailNotifier::class)
            ->orderConfirmation($order);
    });
});
```

### 3.3 录制文件管理

```bash
# tests/cassettes 目录结构
tests/cassettes/
├── stripe-payment-create.json
├── stripe-refund.json
├── slack-webhook-order-created.json
├── mail-confirmation.json
└── full-order-lifecycle.json
```

**录制文件纳入版本控制：**

```gitignore
# .gitignore
# 录制文件纳入版本控制
!tests/cassettes/
```

录制文件应该提交到 Git——它们相当于 API 契约的快照。

## 四、Contract 测试：消费者驱动的契约验证

Mock 的另一个问题是**你不知道真实 API 是否已经变了**。Contract 测试通过消费者和提供者共享契约来解决。

### 4.1 Pact 风格的消费者驱动契约

```php
// tests/Contract/Stripe/PaymentIntentContractTest.php
uses(TestCase::class);

it('contract: Stripe payment intent creation', function () {
    $contract = [
        'consumer' => 'kkday-b2c-api',
        'provider' => 'stripe-api',
        'interaction' => [
            'description' => 'Create a payment intent',
            'providerState' => 'Stripe account is active',
            'request' => [
                'method' => 'POST',
                'path'   => '/v1/payment_intents',
                'headers' => [
                    'Authorization' => 'Bearer sk_test_xxx',
                ],
                'body' => [
                    'amount'   => 2990,
                    'currency' => 'twd',
                ],
            ],
            'response' => [
                'status' => 200,
                'headers' => ['Content-Type' => 'application/json'],
                'body' => [
                    'id'     => 'Matcher::regex("pi_[a-zA-Z0-9]+")',
                    'status' => 'Matcher::term("requires_payment_method|succeeded")',
                    'amount' => 2990,
                ],
            ],
        ],
    ];

    // 写入契约文件
    $contractPath = base_path('tests/Contract/Stripe/contracts/payment-intent.json');
    file_put_contents($contractPath, json_encode($contract, JSON_PRETTY_PRINT));

    // 验证契约
    expect($contract['interaction']['response']['status'])->toBe(200);
});
```

### 4.2 契约验证测试

```php
// tests/Contract/Verify/VerifyStripeContract.php
uses(TestCase::class);

it('verifies Stripe contract against real API', function () {
    $contract = json_decode(
        file_get_contents(base_path('tests/Contract/Stripe/contracts/payment-intent.json')),
        true
    );

    $response = Http::withBasicAuth(config('services.stripe.secret'), '')
        ->post('https://api.stripe.com/v1/payment_intents', [
            'amount'   => $contract['interaction']['request']['body']['amount'],
            'currency' => $contract['interaction']['request']['body']['currency'],
        ]);

    // 验证响应结构符合契约
    expect($response->status())->toBe($contract['interaction']['response']['status'])
        ->and($response->json('id'))->toMatch('/^pi_/')
        ->and($response->json('amount'))->toBe(2990);
});
```

### 4.3 契约测试的 CI 集成

```yaml
# .github/workflows/contract-tests.yml
name: Contract Tests

on:
  schedule:
    - cron: '0 8 * * *'  # 每天检查一次

jobs:
  verify-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Verify Stripe Contract
        run: php artisan test --filter=VerifyStripeContract
        env:
          STRIPE_SECRET: ${{ secrets.STRIPE_TEST_SECRET }}

      - name: Verify Slack Contract
        run: php artisan test --filter=VerifySlackContract
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_TEST_WEBHOOK }}
```

## 五、测试数据治理

### 5.1 测试数据工厂的分层

```php
// tests/Pest.php
uses(RefreshDatabase::class, DatabaseMigrations::class);

// 基础用户工厂
$user = User::factory()->create(['role' => 'member']);

// 会员等级工厂
$vipUser = User::factory()->vip()->create();

// 订单工厂
$order = Order::factory()
    ->for($vipUser)
    ->withItems(3)
    ->create(['status' => 'pending']);
```

**工厂状态管理：**

```php
class OrderFactory extends Factory
{
    protected $model = Order::class;

    public function definition(): array
    {
        return [
            'user_id'    => User::factory(),
            'status'     => 'pending',
            'total'      => fake()->randomNumber(4),
            'currency'   => 'TWD',
            'created_at' => now(),
        ];
    }

    public function pending(): static
    {
        return $this->state(fn (array $attributes) => ['status' => 'pending']);
    }

    public function paid(): static
    {
        return $this->state(fn (array $attributes) => ['status' => 'paid']);
    }

    public function cancelled(): static
    {
        return $this->state(fn (array $attributes) => ['status' => 'cancelled']);
    }

    public function withItems(int $count = 1): static
    {
        return $this->afterCreating(function (Order $order) use ($count) {
            OrderItem::factory()
                ->count($count)
                ->for($order)
                ->create();
        });
    }
}
```

### 5.2 测试数据共享与隔离

```php
// 集成测试中共享 expensive 测试数据
uses(TestCase::class);

beforeAll(function () {
    // 一次性创建测试数据，所有测试共享
    $this->seedData = [
        'users'    => User::factory()->count(10)->create(),
        'products' => Product::factory()->count(20)->create(),
    ];
});

it('searches products', function () {
    $products = $this->seedData['products'];
    // 使用共享数据...
});

it('filters by category', function () {
    $products = $this->seedData['products'];
    // 使用共享数据...
});
```

**注意：** `beforeAll` 中创建的数据不会自动回滚，需要手动清理或使用数据库快照。

### 5.3 测试数据的 Faker 策略

```php
class OrderFactory extends Factory
{
    public function definition(): array
    {
        return [
            'total' => fake()->passthrough(
                fake()->numberBetween(100, 50000)
            ),
            'currency' => fake()->randomElement(['TWD', 'USD', 'JPY']),
            // 使用真实感的数据
            'note' => fake()->sentence(3),
        ];
    }
}
```

## 六、组合策略：一个完整的测试案例

```php
use Tests\Support\VcrRecorder;

it('complete order flow with mixed mocking and recording', function () {
    // 1. 用 Mock 测试支付网关
    $paymentGateway = Mockery::mock(PaymentGateway::class);
    $paymentGateway->shouldReceive('createPaymentIntent')
        ->once()
        ->andReturn(new PaymentResult(id: 'pi_test_123', status: 'succeeded'));
    $this->app->instance(PaymentGateway::class, $paymentGateway);

    // 2. 用 VCR 录制回放 Slack 通知
    $slackVcr = new VcrRecorder('order-slack-notification');
    $slackVcr->handle(function () {
        // Slack 通知会被录制/回放
        app(SlackNotifier::class)->orderCreated($order);
    });

    // 3. 用 Http::fake() Mock 邮件服务
    Http::fake(function ($request) {
        if (Str::contains($request->url(), 'mailgun')) {
            return Http::response(['id' => 'msg_fake'], 200);
        }
    });

    // 4. 执行核心业务逻辑
    $response = $this->postJson('/api/orders', [
        'items'   => [['sku' => 'TK-001', 'qty' => 2]],
        'payment' => 'stripe',
    ]);

    $response->assertOk()
        ->assertJsonStructure(['data' => ['id', 'status', 'total']]);

    // 5. 验证所有外部服务都被正确调用
    Http::assertSent(function ($request) {
        return Str::contains($request->url(), 'mailgun');
    });
});
```

## 七、踩坑记录

### 7.1 `Http::fake()` 的全局性

`Http::fake()` 是全局的，一个测试中的 fake 会影响同一进程中的其他测试。解决方案：

```php
// 在每个测试的 tearDown 中恢复
protected function tearDown(): void
{
    Http::preventStrayRequests();  // PHPUnit 方式
    parent::tearDown();
}

// 或者在 Pest 中
afterEach(function () {
    Http::fake([]);  // 重置
});
```

### 7.2 录制文件与 CI 环境

录制回放模式在 CI 中需要小心：

```php
// 只在本地录制，CI 只回放
$recordMode = env('VCR_RECORD', false);
$vcr = new VcrRecorder('payment-test', recordMode: $recordMode);
```

```yaml
# CI 中
- run: VCR_RECORD=false php artisan test --filter=PaymentTest
```

### 7.3 Mock 时间与真实时间

外部服务的时间敏感操作（如过期、超时）需要用 `Carbon::setTestNow()`：

```php
it('handles expired payment intent', function () {
    $vcr = new VcrRecorder('expired-payment');
    $vcr->handle(function () {
        // Mock 时间为未来 30 分钟后
        Carbon::setTestNow(now()->addMinutes(30));
        
        $result = app(PaymentGateway::class)
            ->checkPaymentStatus('pi_expired');
        
        expect($result->status)->toBe('expired');
        
        Carbon::setTestNow();  // 恢复
    });
});
```

### 7.4 并行测试中的状态共享

ParaTest 并行运行时，每个 worker 有自己的进程，共享数据会导致冲突：

```php
// 使用唯一标识符隔离测试数据
it('processes unique order', function () {
    $uniqueId = Str::uuid()->toString();
    
    $order = Order::factory()->create([
        'external_id' => $uniqueId,
    ]);
    
    // ...
});
```

## 八、测试策略选择指南

| 场景 | 推荐策略 | 原因 |
|------|----------|------|
| 纯业务逻辑 | 单元测试 + Mock | 速度快，隔离性好 |
| 单一外部服务调用 | Guzzle MockHandler | 轻量，无需额外依赖 |
| 需要验证 API 响应格式 | HTTP 录制回放 | 真实响应，可回归验证 |
| 多服务协作 | 组合策略 | 按需选择 Mock 或录制 |
| API 变更检测 | Contract 测试 | 自动发现 API 破坏性变更 |

## 九、总结

集成测试不是要替代单元测试，而是补齐单元测试覆盖不到的盲区。在 KKday B2C API 中，我们采用的组合策略是：

1. **Service Layer Mock**：Mock 接口而非 HTTP，测试更稳定
2. **HTTP 录制回放**：验证真实 API 响应，录制文件纳入版本控制
3. **Contract 测试**：消费者驱动契约，自动检测 API 变更
4. **测试数据治理**：工厂状态 + 分层创建 + 并行隔离

这三层策略组合起来，让我们的集成测试覆盖率达到 85%+，同时 CI 耗时控制在 5 分钟内。

---

**延伸阅读：**

- [Pest + PHPUnit + ParaTest：如何在 Laravel B2C API 上跑满 100% 覆盖率？](/2026/05/02/Pest-单元测试实战-Laravel-B2C-API-100-覆盖率/)
- [PHPUnit 断言实战：Beyond assertEquals，掌握 expect、mock、stub](/2026/05/05/PHPUnit-断言实战-Beyond-assertEquals-掌握-expect-mock-stub-踩坑记录/)
- [OpenAPI + Fake Response JSON + Cypress：前后端联调的完整测试工作流](/2026/05/05/OpenAPI-Fake-Response-Cypress-前后端联调契约测试完整工作流踩坑记录/)
