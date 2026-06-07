# Go 测试体系

## 定义

Go 内置 `testing` 包，无需第三方框架即可编写单元测试、基准测试和示例测试。Go 社区推崇**表驱动测试**（Table-Driven Tests）模式，配合 Testify 断言库和 `net/http/httptest` 包，形成完整的测试工具链。

## 核心原理

### 基础测试

```go
// calculator.go
func Add(a, b int) int { return a + b }

// calculator_test.go（同目录，_test.go 后缀）
func TestAdd(t *testing.T) {
    result := Add(1, 2)
    if result != 3 {
        t.Errorf("Add(1, 2) = %d, want 3", result)
    }
}
```

```bash
go test ./...           # 运行所有测试
go test -v              # 详细输出
go test -run TestAdd    # 运行指定测试
go test -count=1        # 禁用缓存
```

### 表驱动测试（Table-Driven Tests）

```go
func TestDivide(t *testing.T) {
    tests := []struct {
        name    string
        a, b    int
        want    int
        wantErr bool
    }{
        {"正常除法", 10, 2, 5, false},
        {"除以零", 10, 0, 0, true},
        {"负数", -10, 2, -5, false},
        {"零除", 0, 5, 0, false},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := Divide(tt.a, tt.b)
            if (err != nil) != tt.wantErr {
                t.Errorf("Divide(%d, %d) error = %v, wantErr %v", tt.a, tt.b, err, tt.wantErr)
                return
            }
            if got != tt.want {
                t.Errorf("Divide(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
            }
        })
    }
}
```

### Testify 断言库

```go
import (
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestUser(t *testing.T) {
    user := NewUser("Alice", "alice@example.com")
    
    // assert — 失败后继续执行
    assert.Equal(t, "Alice", user.Name)
    assert.NotEmpty(t, user.Email)
    
    // require — 失败后立即终止
    require.NotNil(t, user)
    require.NoError(t, user.Validate())
}

// suite — 测试套件（setup/teardown）
type UserSuite struct {
    suite.Suite
    db *sql.DB
}

func (s *UserSuite) SetupSuite() {
    s.db = setupTestDB()
}

func (s *UserSuite) TearDownSuite() {
    s.db.Close()
}

func (s *UserSuite) TestCreateUser() {
    user, err := Create(s.db, "Alice")
    s.NoError(err)
    s.Equal("Alice", user.Name)
}
```

### httptest — HTTP 测试

```go
func TestGetUser(t *testing.T) {
    // 创建 mock HTTP 服务器
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(map[string]string{"name": "Alice"})
    }))
    defer server.Close()

    // 测试 HTTP Client
    client := NewAPIClient(server.URL)
    user, err := client.GetUser(1)
    
    assert.NoError(t, err)
    assert.Equal(t, "Alice", user.Name)
}
```

### 基准测试

```go
func BenchmarkSort(b *testing.B) {
    data := generateRandomSlice(10000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sort.Ints(append([]int{}, data...))
    }
}
```

```bash
go test -bench=. -benchmem    # 运行基准测试，显示内存分配
```

### Mock 与接口测试

```go
// 定义接口
type UserRepository interface {
    FindByID(id int) (*User, error)
}

// 手写 Mock
type MockUserRepo struct {
    users map[int]*User
}

func (m *MockUserRepo) FindByID(id int) (*User, error) {
    user, ok := m.users[id]
    if !ok {
        return nil, ErrNotFound
    }
    return user, nil
}

// 测试 Service 层
func TestUserService(t *testing.T) {
    mock := &MockUserRepo{
        users: map[int]*User{1: {ID: 1, Name: "Alice"}},
    }
    svc := NewUserService(mock)
    user, err := svc.GetUser(1)
    assert.NoError(t, err)
    assert.Equal(t, "Alice", user.Name)
}
```

## 与 Pest PHP 的对比

| 维度 | Go testing | Pest PHP |
|------|------------|----------|
| 语法 | 函数式 `t.Run()` | 链式 `it()->expect()` |
| 断言 | 内置 `t.Errorf` 或 Testify | 内置 `expect()->toBe()` |
| 数据驱动 | 表驱动（struct slice） | `dataset()` |
| HTTP 测试 | `net/http/httptest` | `Http::fake()` |
| Mock | 手写接口实现 | Mockery / Pest Mock |
| 覆盖率 | `go test -cover` | `pest --coverage` |
| 性能测试 | `Benchmark` 内置 | `--profile`（外部工具） |

## 实战案例

来自博客文章：
- [Go 测试实战：表驱动测试、Testify 断言、httptest Mock——从 Pest PHP 到 Go 的测试思维迁移](/2026/06/01/00_架构/Go-测试实战-表驱动测试-Testify断言-httptest-Mock/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - interface 用于 Mock
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - gRPC 测试
- [Go 数据库操作](Go数据库操作.md) - 数据库测试

## 常见问题

**Q: Go 测试文件必须和源文件同目录吗？**
A: 是的，`xxx_test.go` 必须和 `xxx.go` 在同一个包。但可以用 `package xxx_test`（外部测试包）来测试公开 API。

**Q: 为什么用 Table-Driven Tests？**
A: 加新用例只需加一行 struct，不用写新函数。代码更紧凑，维护成本低。是 Go 社区的共识最佳实践。

**Q: Testify 的 assert 和 require 有什么区别？**
A: `assert` 失败后继续执行后续断言（适合收集多个失败）；`require` 失败后立即 `t.FailNow()`（适合前提条件，如数据库连接必须成功）。
