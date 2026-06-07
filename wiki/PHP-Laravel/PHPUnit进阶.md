# PHPUnit 进阶

## 定义

PHPUnit 是 PHP 的标准测试框架。掌握 expect、mock、stub 是写出可靠测试的基础。

## 核心断言

```php
$this->assertTrue($condition);
$this->assertEquals($expected, $actual);
$this->assertContains($needle, $haystack);
$this->assertInstanceOf(Order::class, $order);
$this->assertDatabaseHas('orders', ['status' => 'paid']);
$this->assertModelMissing($order);
```

## Mock 与 Stub

### Stub（控制返回值）

```php
$mock = $this->createMock(PaymentGateway::class);
$mock->method('charge')->willReturn(true);

$orderService = new OrderService($mock);
$result = $orderService->process($order);
$this->assertTrue($result);
```

### Mock（验证调用）

```php
$mock = $this->createMock(NotificationService::class);
$mock->expects($this->once())
    ->method('send')
    ->with($this->equalTo($order->user), $this->anything());

$orderService = new OrderService($mock);
$orderService->complete($order);
```

## Laravel 测试工具

```php
class OrderTest extends TestCase {
    use RefreshDatabase;

    public function test_create_order(): void {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson('/api/orders', [
                'items' => [['product_id' => 1, 'qty' => 2]],
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('orders', ['user_id' => $user->id]);
    }

    public function test_queue_job(): void {
        Queue::fake();

        ProcessOrder::dispatch($order);

        Queue::assertPushed(ProcessOrder::class, function ($job) use ($order) {
            return $job->order->id === $order->id;
        });
    }

    public function test_event_dispatched(): void {
        Event::fake();

        $this->postJson('/api/orders', $data);

        Event::assertDispatched(OrderPlaced::class);
    }
}
```

## 实战案例

来自博客文章：[PHPUnit 断言实战](/categories/PHP/phpunit-guide-beyond-assertequals-expect-mock-stub/)

## 相关概念

- [Pest 测试](Pest测试.md) - 更现代的测试语法
- [浏览器自动化测试](浏览器自动化测试.md) - E2E 测试

## 常见问题

**Q: Mock 和 Stub 有什么区别？**
A: Stub 只控制返回值；Mock 还验证方法是否被调用、调用参数和次数。
