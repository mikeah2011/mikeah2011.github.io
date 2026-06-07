# Pest 测试框架

## 定义

Pest 是基于 PHPUnit 的 PHP 测试框架，提供更简洁的语法和强大的功能（数据驱动、并发测试、覆盖率）。

## 基本语法

```php
// 传统 PHPUnit
class OrderTest extends TestCase {
    public function test_can_create_order(): void {
        $order = Order::factory()->create();
        $this->assertNotNull($order->id);
    }
}

// Pest 风格
it('can create order', function () {
    $order = Order::factory()->create();
    expect($order->id)->not->toBeNull();
});

test('order total is calculated correctly', function () {
    $order = Order::factory()->create(['total' => 100]);
    expect($order->total)->toBe(100);
});
```

## 数据驱动测试

```php
it('validates order status transitions', function (string $from, string $to, bool $expected) {
    $order = Order::factory()->create(['status' => $from]);
    expect($order->canTransitionTo($to))->toBe($expected);
})->with([
    ['pending', 'paid', true],
    ['pending', 'shipped', false],
    ['paid', 'shipped', true],
    ['shipped', 'cancelled', false],
]);
```

## 并发测试

```php
it('handles concurrent order creation', function () {
    $results = concurrent(fn () => Order::factory()->create(), 10);
    expect($results)->toHaveCount(10);
});
```

## Arch Testing

```php
test('controllers do not depend on repositories directly', function () {
    expect('App\Http\Controllers')
        ->not->toUse('App\Repositories');
});

test('domain layer has no framework dependencies', function () {
    expect('App\Domain')
        ->not->toUse('Illuminate\*');
});
```

## 覆盖率

```bash
# 运行测试并生成覆盖率
pest --coverage --min=100

# 使用 ParaTest 并行执行
vendor/bin/paratest --coverage --min=100
```

## 踩坑记录

- **Mock 问题**：Pest 的 mock 语法和 PHPUnit 不同，需要用 `mock()` 函数
- **并发测试隔离**：并行执行时数据库状态可能冲突 → 用 `RefreshDatabase` trait
- **覆盖率 100% 不等于质量好**：关注边界条件和异常路径

## 实战案例

来自博客文章：[Pest 测试框架 100% 覆盖率](/categories/PHP/pest-testingguide-100/) | [Pest 数据驱动与并发测试](/categories/PHP/pest-testingguide-concurrencytesting/)

## 相关概念

- [PHPUnit 进阶](PHPUnit进阶.md) - Pest 底层基于 PHPUnit
- [浏览器自动化测试](浏览器自动化测试.md) - E2E 测试

## 常见问题

**Q: Pest 和 PHPUnit 选哪个？**
A: 新项目推荐 Pest，语法更简洁。已有 PHPUnit 项目可以渐进式迁移。

**Q: 如何测试队列 Job？**
A: `Queue::fake()` + `Queue::assertPushed(ProcessOrder::class)`。
