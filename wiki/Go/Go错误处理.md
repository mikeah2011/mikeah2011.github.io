# Go 错误处理

## 定义

Go 没有异常（exception）机制，而是通过**多返回值**将 error 作为函数的普通返回值显式传递。Go 1.13+ 引入了错误链（errors.Wrap/Is/As），Go 1.20+ 引入了 errors.Join，让错误处理更优雅。

## 核心原理

### 基础错误处理

```go
// error 是一个内置接口
type error interface {
    Error() string
}

// 函数返回 (结果, error)
func readFile(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err  // 向上传播
    }
    return data, nil
}

// 调用方显式检查
data, err := readFile("config.json")
if err != nil {
    log.Fatal(err)
}
```

### 创建错误

```go
// errors.New — 简单错误
var ErrNotFound = errors.New("resource not found")

// fmt.Errorf — 格式化错误
err := fmt.Errorf("user %d not found", userID)

// 自定义错误类型
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}
```

### 错误链（Go 1.13+）

```go
// %w 包装错误——保留原始错误
func getUser(id int) (*User, error) {
    user, err := db.Query(id)
    if err != nil {
        return nil, fmt.Errorf("getUser(%d): %w", id, err)
    }
    return user, nil
}

// errors.Is — 检查错误链中是否包含特定错误
if errors.Is(err, sql.ErrNoRows) {
    fmt.Println("用户不存在")
}

// errors.As — 从错误链中提取特定类型
var ve *ValidationError
if errors.As(err, &ve) {
    fmt.Printf("字段 %s 校验失败: %s\n", ve.Field, ve.Message)
}
```

### errors.Join（Go 1.20+）

```go
// 合并多个错误（所有错误都会保留）
err1 := validateName(name)
err2 := validateEmail(email)
err3 := validateAge(age)

if err := errors.Join(err1, err2, err3); err != nil {
    return fmt.Errorf("validation failed: %w", err)
}
```

### 错误处理哲学对比

| 维度 | Go (error) | PHP (Exception) | Rust (Result) |
|------|------------|-----------------|---------------|
| 机制 | 显式返回值 | 抛出/捕获 | 枚举类型 |
| 控制流 | `if err != nil` | `try/catch` | `match`/`?` |
| 编译器检查 | 无强制（容易遗忘） | 无强制 | 强制（must use） |
| 性能 | 零开销 | 栈展开开销 | 零开销 |
| 错误链 | errors.Wrap/Is/As | Exception::$previous | thiserror/anyhow |
| 可读性 | 啰嗦但清晰 | 简洁但隐式 | 简洁且安全 |

### 错误处理最佳实践

```go
// ✅ 好：立即检查，尽早返回
func process(data []byte) error {
    if len(data) == 0 {
        return errors.New("empty data")
    }
    result, err := parse(data)
    if err != nil {
        return fmt.Errorf("parse: %w", err)
    }
    return save(result)
}

// ❌ 坏：忽略错误
data, _ := readFile("important.txt")  // 危险！

// ❌ 坏：只检查不包装——丢失上下文
if err != nil {
    return err  // 调用方不知道错误来自哪里
}
```

## 实战案例

来自博客文章：
- [Go error handling 深度实战：errors.Join/Wrap/Is/As 与自定义错误类型——对比 PHP Exception 层级的设计哲学](/2026/06/01/10_Go/Go-error-handling-深度实战-errors-Join-Wrap-Is-As-自定义错误类型-对比PHP-Exception设计哲学/)
- [Rust 错误处理哲学：Result/Option/thiserror/anyhow——对比 PHP Exception 和 Go error](/2026/06/01/00_架构/rust-error-handling-philosophy-result-option-thiserror-anyhow/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - 函数多返回值
- [Go 测试体系](Go测试体系.md) - 测试错误路径
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - gRPC 错误码

## 常见问题

**Q: 为什么不引入像 Rust 的 Result 类型？**
A: Go 的设计哲学是简洁。多返回值 + `if err != nil` 虽然啰嗦但足够清晰，且 Go 泛型（1.18+）后社区有 Result 库可选。

**Q: errors.Is 和 errors.As 的区别？**
A: `errors.Is` 比较错误值（类似 `==`），`errors.As` 提取错误类型（类似类型断言）。`Is` 用于检查特定哨兵错误，`As` 用于提取自定义错误类型。

**Q: panic/recover 和 error 的关系？**
A: `panic` 是不可恢复的程序错误（类似 PHP 的 Fatal Error），`recover` 只在 `defer` 中有效。正常业务错误应该用 `error` 返回，`panic` 只用于真正不可恢复的情况。
