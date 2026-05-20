---
title: OOP - 面向对象
tags: [Laravel, PHP]categories:
  - PHP
date: 2021-03-20 15:05:07
description: 面向对象的三大特性（封装/继承/多态）与 SOLID 五大原则，配 PHP 代码示例与实际工程取舍。OOP 不是银弹，知道何时不用比何时用更重要。
---

# 一句话

> **OOP = 把"数据"和"操作数据的方法"封装到一起，再用继承/多态在不改旧代码的前提下扩展新行为。**

它的对立面是「面向过程」（数据是数据，函数是函数）和「函数式」（数据不可变，靠函数组合）。三种范式各有适用场景，**OOP 不是唯一正解**。

# 三大特性

## 1. 封装（Encapsulation）

把内部状态藏起来，只暴露必要接口。

```php
class BankAccount {
    private int $balance = 0;   // 外面碰不到

    public function deposit(int $amount): void {
        if ($amount <= 0) throw new InvalidArgumentException();
        $this->balance += $amount;
    }
    public function balance(): int { return $this->balance; }
}
```

**为什么有用**：调用方不需要知道余额怎么存的；以后改成数据库/Redis，外面零改动。

## 2. 继承（Inheritance）

子类自动获得父类的属性和方法。

```php
class Animal {
    public function eat(): string { return 'eating'; }
}
class Dog extends Animal {
    public function bark(): string { return 'woof'; }
}
(new Dog())->eat();   // 'eating'
```

**坑**：继承是强耦合，父类改一行可能炸所有子类。**「优先组合，不要继承」** 是设计模式的第一条铁律。

## 3. 多态（Polymorphism）

**同一个调用，不同的实现**。PHP 里通过接口/抽象类实现：

```php
interface Payment {
    public function pay(int $amount): bool;
}
class Alipay   implements Payment { public function pay(int $a): bool { /*...*/ return true; } }
class WeChatPay implements Payment { public function pay(int $a): bool { /*...*/ return true; } }

function checkout(Payment $p, int $amount): void {
    $p->pay($amount);   // 不关心具体是哪种支付
}
```

**这是 OOP 最值钱的部分**：扩展新支付方式，`checkout()` 一个字都不用改。

# SOLID 五大原则

| 字母 | 名字 | 一句话 | 反例 |
|---|---|---|---|
| **S** | Single Responsibility | 一个类只做一件事 | `User` 类同时管理"用户数据 + 发邮件 + 存数据库" |
| **O** | Open / Closed | 对扩展开放，对修改关闭 | 加个新支付方式就要改 `checkout()` 的 if-else |
| **L** | Liskov Substitution | 子类必须能替换父类不出错 | `Square extends Rectangle` 改 width 同时改 height，违反父类语义 |
| **I** | Interface Segregation | 接口要小，不要逼实现类用不到的方法 | `IBird` 里塞 `fly()`，企鹅类被迫抛异常 |
| **D** | Dependency Inversion | 依赖抽象（接口），不依赖具体类 | 控制器直接 `new MysqlUserRepo()`，测试和切库都地狱 |

## 一个 SOLID 友好的例子

```php
// D: 依赖抽象
interface UserRepo {
    public function find(int $id): ?User;
}

// S: 只做"用 MySQL 查用户"这一件事
class MysqlUserRepo implements UserRepo {
    public function __construct(private PDO $db) {}
    public function find(int $id): ?User { /* SQL */ return null; }
}

// O: 想换 Redis 就再写个 RedisUserRepo，不动 UserService
class UserService {
    public function __construct(private UserRepo $repo) {}
    public function profile(int $id): ?User {
        return $this->repo->find($id);
    }
}
```

# 什么时候**不要**用 OOP

- **简单脚本** / 一次性数据处理 → 函数式或过程式更轻
- **数据为主、行为很少** → 用 DTO / struct / record 即可，硬塞 method 反而麻烦
- **领域天然函数式**（管道、流处理、纯计算）→ FP 更合适

# 常见误区

1. **类越多越 OOP** —— 错。一堆只有 getter/setter 的"贫血模型"和过程式没区别。
2. **继承越深越显设计能力** —— 错。继承超过 2 层基本都是问题信号。
3. **设计模式必须用** —— 模式是事后总结，不是事前框框。先写出能跑的代码，重复 3 次再考虑抽象。

# 参考

- Robert C. Martin, *Clean Architecture*（SOLID 出处）
- 《设计模式》GoF — 23 个模式分创建/结构/行为三大类
- PHP The Right Way: <https://phptherightway.com/>
