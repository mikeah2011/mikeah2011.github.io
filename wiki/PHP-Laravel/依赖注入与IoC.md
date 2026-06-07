# 依赖注入（DI）与 IoC 容器

## 定义

- **依赖注入** = 一个类不自己创建依赖，而是由外部传入
- **IoC 容器** = 自动帮你完成「传入」这个动作的工厂 + 注册表

## 问题：为什么不能自己 new

```php
class OrderService {
    private MysqlOrderRepo $repo;
    public function __construct() {
        $this->repo = new MysqlOrderRepo(new PDO(...));   // ❌
    }
}
```

毛病：不可换实现、不可测、强耦合、依赖隐藏。

## 三种注入方式

### 1. 构造器注入（推荐）

```php
class OrderService {
    public function __construct(private OrderRepo $repo) {}
}
$svc = new OrderService(new MysqlOrderRepo($pdo));
```

依赖必填、对象不可变、看签名一目了然。

### 2. Setter 注入

```php
class OrderService {
    private OrderRepo $repo;
    public function setRepo(OrderRepo $repo): void { $this->repo = $repo; }
}
```

适用可选依赖、运行时切换。缺点：对象创建后状态不完整。

### 3. 接口注入 / 属性注入

```php
class OrderService {
    #[Inject] public OrderRepo $repo;   // PHP 8 attribute
}
```

适用框架内部魔法。缺点：依赖魔法、IDE 补全难。

## 面向接口编程

DI 真正的价值要配合**接口**：

```php
interface OrderRepo {
    public function find(int $id): ?Order;
}
class MysqlOrderRepo implements OrderRepo { /*...*/ }
class RedisOrderRepo implements OrderRepo { /*...*/ }
class FakeOrderRepo  implements OrderRepo { /* for test */ }
```

## 实战案例

来自博客文章：[依赖注入与 IoC 容器](/categories/PHP/dependency-injection/) | [服务容器深度解析](/categories/PHP/laravel-container/)

## 相关概念

- [服务容器](服务容器.md) - Laravel 的 IoC 容器实现
- [面向对象](面向对象.md) - SOLID-D 依赖反转原则
- [三层架构](三层架构.md) - 依赖注入在分层架构中的应用

## 常见问题

**Q: DI 和 Service Locator 有什么区别？**
A: DI 是「被动接收」，Service Locator 是「主动去拿」。DI 更利于测试和解耦。

**Q: Laravel 的自动注入原理是什么？**
A: 利用反射（Reflection）分析构造函数参数类型，从容器自动解析并注入。
