# Go 泛型

## 定义

Go 1.18（2022 年 3 月）正式引入泛型（Generics），通过**类型参数**和**类型约束**实现类型安全的通用代码。这是 Go 自 1.0 以来最大的语言特性变更。

## 核心原理

### 类型参数基础

```go
// 泛型函数
func Map[T any, U any](slice []T, fn func(T) U) []U {
    result := make([]U, len(slice))
    for i, v := range slice {
        result[i] = fn(v)
    }
    return result
}

// 使用
names := []string{"Alice", "Bob"}
lengths := Map(names, func(s string) int { return len(s) })
// [5, 3]
```

### 类型约束（Constraints）

```go
// 内置约束
// any          = interface{}（任意类型）
// comparable   = 可用 == != 比较的类型

// 自定义约束
type Number interface {
    ~int | ~int8 | ~int64 | ~float32 | ~float64
}

func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums {
        total += n
    }
    return total
}

// ~ 表示包含底层类型的派生类型
type MyInt int
Sum([]MyInt{1, 2, 3})  // ✅ 合法，因为 MyInt 的底层类型是 int
```

### 泛型 struct

```go
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(item T) {
    s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 {
        var zero T
        return zero, false
    }
    item := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return item, true
}

// 使用
intStack := &Stack[int]{}
intStack.Push(42)
intStack.Push(100)
val, _ := intStack.Pop()  // 100
```

### 泛型接口

```go
type Repository[T any] interface {
    FindByID(id int) (*T, error)
    Save(entity *T) error
    Delete(id int) error
}

type UserRepo struct{}
func (r *UserRepo) FindByID(id int) (*User, error) { /* ... */ }
func (r *UserRepo) Save(u *User) error { /* ... */ }
func (r *UserRepo) Delete(id int) error { /* ... */ }
```

### 与 PHP 泛型的对比

| 维度 | Go 泛型 | PHP 泛型 |
|------|---------|----------|
| 引入版本 | 1.18（2022） | 无原生支持（通过 docblock 约束） |
| 类型擦除 | 无（单态化 + 字典 GC） | N/A |
| 约束系统 | interface 类型集 | @template 注解（PHPStan/Psalm） |
| 运行时检查 | 编译时检查 | 静态分析工具检查 |
| 泛型 struct | 支持 | 不支持 |
| 泛型方法 | 支持 | 不支持 |

### 与 Laravel 泛型容器的对比

```go
// Go 泛型容器
type Container[T any] struct {
    items map[string]T
}

func (c *Container[T]) Get(key string) (T, bool) {
    v, ok := c.items[key]
    return v, ok
}
```

```php
// PHP 通过 PHPStan @template
/** @template T */
class Container {
    /** @var array<string, T> */
    private array $items = [];
    
    /** @return T|null */
    public function get(string $key): mixed { /* ... */ }
}
```

## 实战案例

来自博客文章：
- [Go Generic 深度实战：类型参数、约束、类型推断——PHP 开发者视角的泛型编程与 Laravel 泛型容器设计对比](/2026/06/01/10_Go/Go-Generic-深度实战-类型参数-约束-类型推断-PHP开发者视角泛型编程与Laravel容器对比/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - interface、struct
- [Go 数据库操作](Go数据库操作.md) - 泛型 Repository 模式
- [Go 测试体系](Go测试体系.md) - 泛型测试辅助函数

## 常见问题

**Q: Go 泛型有性能损失吗？**
A: Go 编译器使用两种实现策略：GC Shape Stenciling（共享相同 GC 形状的类型）和字典传参。大多数场景性能接近手写代码，极端场景可能有 1-5% 开销。

**Q: 为什么 Go 泛型不用尖括号 <T>？**
A: Go 语法使用 `[T]` 方括号，因为尖括号 `<>` 在 Go 中已经是比较运算符，会产生语法歧义（如 `f<int>(x)` 是泛型调用还是比较？）。

**Q: 泛型和 interface{} 的区别？**
A: `interface{}` 是运行时动态类型，丧失类型安全。泛型在编译时保证类型安全，且避免类型断言的运行时开销。
