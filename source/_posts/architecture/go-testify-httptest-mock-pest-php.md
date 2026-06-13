---

title: Go 测试实战：表驱动测试、Testify 断言、httptest Mock——从 Pest PHP 到 Go 的测试思维迁移
keywords: [Go, Testify, httptest Mock, Pest PHP, 测试实战, 表驱动测试, 断言, 的测试思维迁移]
date: 2026-06-02 10:00:00
tags:
- Go
- 测试
- Testify
- httptest
- Pest
- TDD
- 基准测试
categories:
- architecture
description: Go 测试实战全面指南：表驱动测试、Testify 断言库、httptest HTTP Mock、基准测试。从 Pest PHP/Laravel 开发者视角，深入对比 Go testing 包与 PHPUnit/Pest 的测试哲学差异，提供 Mock 接口、子测试并行、覆盖率分析等完整代码示例，助你掌握 Go 测试最佳实践与 TDD 工作流。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



# Go 测试实战：表驱动测试、Testify 断言、httptest Mock——从 Pest PHP 到 Go 的测试思维迁移

## 前言

测试是软件工程中最重要但最容易被忽视的环节之一。作为 Laravel 开发者，我习惯了 Pest PHP 那种优雅流畅的测试语法：

```php
it('returns a user by id', function () {
    $user = User::factory()->create();
    $response = $this->getJson("/api/users/{$user->id}");
    $response->assertOk()->assertJsonFragment(['name' => $user->name]);
});
```

当我第一次接触 Go 的测试时，最大的冲击是：**Go 的测试看起来像是在写普通的 Go 代码，没有 DSL，没有魔法方法，甚至没有 assert**。Go 标准库的 `testing` 包只提供了 `t.Error`、`t.Fatal` 等基础方法，连 `assertEqual` 都没有。

但随着深入使用，我逐渐理解了 Go 的测试哲学：**测试代码也是代码，应该和产品代码一样简洁、可维护、可组合**。没有魔法意味着完全可控，没有 DSL 意味着 IDE 支持完美。

这篇文章将从 Laravel/Pest PHP 开发者的视角出发，全面介绍 Go 的测试体系。我们会从最基础的 `testing` 包开始，深入表驱动测试、Testify 断言库、httptest HTTP 测试、Mock 技巧，最后对比 Pest PHP 的测试模式。

---

## 第一章：Go 测试基础

### 1.1 测试文件约定

Go 的测试有严格的文件命名约定：

```
# 测试文件必须以 _test.go 结尾
user.go          → user_test.go
order_service.go → order_service_test.go

# 测试函数必须以 Test 开头，参数为 *testing.T
func TestCreateUser(t *testing.T) { ... }
func TestGetUserByID(t *testing.T) { ... }

# 基准测试函数以 Benchmark 开头，参数为 *testing.B
func BenchmarkCreateUser(b *testing.B) { ... }

# 示例函数以 Example 开头
func ExampleCreateUser() { ... }
```

### 1.2 基本测试用法

```go
// user.go
package user

import "errors"

var ErrUserNotFound = errors.New("user not found")

type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
    Age   int    `json:"age"`
}

type UserRepository interface {
    FindByID(id int) (*User, error)
    FindByEmail(email string) (*User, error)
    Create(user *User) error
}

type UserService struct {
    repo UserRepository
}

func NewUserService(repo UserRepository) *UserService {
    return &UserService{repo: repo}
}

func (s *UserService) GetUser(id int) (*User, error) {
    if id <= 0 {
        return nil, errors.New("invalid user id")
    }
    return s.repo.FindByID(id)
}

func (s *UserService) Register(name, email string, age int) (*User, error) {
    if name == "" {
        return nil, errors.New("name is required")
    }
    if email == "" {
        return nil, errors.New("email is required")
    }
    if age < 0 || age > 150 {
        return nil, errors.New("invalid age")
    }
    
    existing, _ := s.repo.FindByEmail(email)
    if existing != nil {
        return nil, errors.New("email already exists")
    }
    
    user := &User{Name: name, Email: email, Age: age}
    if err := s.repo.Create(user); err != nil {
        return nil, err
    }
    return user, nil
}
```

```go
// user_test.go - 基本测试
package user

import (
    "testing"
)

func TestGetUser_ValidID(t *testing.T) {
    // 准备
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
        },
    }
    service := NewUserService(repo)
    
    // 执行
    user, err := service.GetUser(1)
    
    // 断言
    if err != nil {
        t.Errorf("expected no error, got %v", err)
    }
    if user == nil {
        t.Fatal("expected user, got nil")
    }
    if user.Name != "张三" {
        t.Errorf("expected name '张三', got '%s'", user.Name)
    }
}

func TestGetUser_InvalidID(t *testing.T) {
    repo := &mockRepo{}
    service := NewUserService(repo)
    
    _, err := service.GetUser(0)
    if err == nil {
        t.Error("expected error for invalid id, got nil")
    }
}

func TestGetUser_NotFound(t *testing.T) {
    repo := &mockRepo{users: map[int]*User{}}
    service := NewUserService(repo)
    
    _, err := service.GetUser(999)
    if err == nil {
        t.Error("expected error for non-existent user, got nil")
    }
}

// Mock Repository
type mockRepo struct {
    users map[int]*User
}

func (m *mockRepo) FindByID(id int) (*User, error) {
    user, ok := m.users[id]
    if !ok {
        return nil, ErrUserNotFound
    }
    return user, nil
}

func (m *mockRepo) FindByEmail(email string) (*User, error) {
    for _, u := range m.users {
        if u.Email == email {
            return u, nil
        }
    }
    return nil, ErrUserNotFound
}

func (m *mockRepo) Create(user *User) error {
    if m.users == nil {
        m.users = make(map[int]*User)
    }
    user.ID = len(m.users) + 1
    m.users[user.ID] = user
    return nil
}
```

### 1.3 运行测试

```bash
# 运行当前包的所有测试
go test

# 运行并显示详细输出
go test -v

# 运行特定测试
go test -run TestGetUser_ValidID

# 运行所有子目录的测试
go test ./...

# 运行并显示覆盖率
go test -cover

# 生成覆盖率报告
go test -coverprofile=coverage.out
go tool cover -html=coverage.out -o coverage.html

# 运行基准测试
go test -bench=.

# 带超时的测试
go test -timeout 30s
```

### 1.4 对比 Pest PHP

| 概念 | Pest PHP | Go testing |
|------|----------|------------|
| 文件命名 | `UserTest.php` | `user_test.go` |
| 测试函数 | `it('...', fn)` | `func TestXxx(t *testing.T)` |
| 断言 | `expect($x)->toBe($y)` | `if x != y { t.Error() }` |
| setup/teardown | `beforeEach()` / `afterEach()` | `TestMain(m *testing.M)` |
| 数据提供 | `it()->with([...])` | 表驱动测试 |
| 跳过测试 | `it()->skip()` | `t.Skip()` |
| 并行测试 | `pest()->parallel()` | `t.Parallel()` |

---

## 第二章：表驱动测试——Go 的杀手级测试模式

### 2.1 什么是表驱动测试？

表驱动测试（Table-Driven Tests）是 Go 社区最推崇的测试模式。它的核心思想是：**把测试用例定义为一个结构体切片，然后用循环执行所有用例**。

```go
func TestGetUser(t *testing.T) {
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
        },
    }
    service := NewUserService(repo)
    
    tests := []struct {
        name    string  // 测试用例名称
        id      int     // 输入参数
        want    *User   // 期望结果
        wantErr bool    // 是否期望错误
    }{
        {
            name:    "有效ID返回用户",
            id:      1,
            want:    &User{ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
            wantErr: false,
        },
        {
            name:    "无效ID返回错误",
            id:      0,
            want:    nil,
            wantErr: true,
        },
        {
            name:    "不存在的ID返回错误",
            id:      999,
            want:    nil,
            wantErr: true,
        },
        {
            name:    "负数ID返回错误",
            id:      -1,
            want:    nil,
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := service.GetUser(tt.id)
            
            if tt.wantErr {
                if err == nil {
                    t.Errorf("expected error, got nil")
                }
                return
            }
            
            if err != nil {
                t.Errorf("unexpected error: %v", err)
                return
            }
            
            if got.Name != tt.want.Name {
                t.Errorf("name = %v, want %v", got.Name, tt.want.Name)
            }
        })
    }
}
```

### 2.2 子测试（Subtests）

`t.Run` 创建的子测试有独立的生命周期，可以单独运行：

```bash
# 运行所有子测试
go test -run TestGetUser

# 运行特定子测试
go test -run "TestGetUser/有效ID返回用户"

# 使用正则匹配
go test -run "TestGetUser/.*ID.*"
```

### 2.3 并行表驱动测试

```go
func TestGetUser_Parallel(t *testing.T) {
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三"},
        },
    }
    service := NewUserService(repo)
    
    tests := []struct {
        name string
        id   int
    }{
        {"case 1", 1},
        {"case 2", 0},
        {"case 3", 999},
    }
    
    for _, tt := range tests {
        tt := tt // 重要：捕获循环变量
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // 标记为并行测试
            
            _, err := service.GetUser(tt.id)
            if tt.id <= 0 && err == nil {
                t.Error("expected error")
            }
        })
    }
}
```

### 2.4 对比 Pest PHP 的数据提供

```php
// Pest PHP 数据提供
it('validates user age', function (int $age, bool $expected) {
    $user = new User(['age' => $age]);
    expect($user->isValid())->toBe($expected);
})->with([
    [25, true],
    [0, true],
    [-1, false],
    [200, false],
]);

// Go 表驱动测试
func TestValidateAge(t *testing.T) {
    tests := []struct {
        name     string
        age      int
        expected bool
    }{
        {"正常年龄", 25, true},
        {"零岁", 0, true},
        {"负数年龄", -1, false},
        {"超大年龄", 200, false},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := validateAge(tt.age)
            if got != tt.expected {
                t.Errorf("validateAge(%d) = %v, want %v", tt.age, got, tt.expected)
            }
        })
    }
}
```

表驱动测试的优势：
1. **可读性**：所有测试用例一目了然
2. **可维护性**：新增用例只需要添加一行
3. **独立性**：每个子测试独立运行，失败不影响其他
4. **可并行**：配合 `t.Parallel()` 可以并行执行

---

## 第三章：Testify 断言库深度实战

### 3.1 为什么需要 Testify？

Go 标准库的 `testing` 包只提供了 `t.Error`、`t.Fatal` 等基础方法。写多了这样的代码：

```go
if got.Name != want.Name {
    t.Errorf("Name = %v, want %v", got.Name, want.Name)
}
if got.Age != want.Age {
    t.Errorf("Age = %v, want %v", got.Age, want.Age)
}
if got.Email != want.Email {
    t.Errorf("Email = %v, want %v", got.Email, want.Email)
}
```

你会觉得非常繁琐。Testify 提供了简洁的断言和 require：

```go
import (
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

// assert - 失败后继续执行后续断言
assert.Equal(t, want.Name, got.Name)
assert.Equal(t, want.Age, got.Age)
assert.Equal(t, want.Email, got.Email)

// require - 失败后立即终止当前测试
require.NoError(t, err)
require.NotNil(t, user)
```

### 3.2 Testify 的三个核心包

#### assert 包

```go
import "github.com/stretchr/testify/assert"

// 相等性断言
assert.Equal(t, expected, actual)
assert.NotEqual(t, expected, actual)
assert.Exactly(t, expected, actual) // 严格类型检查

// Nil 断言
assert.Nil(t, obj)
assert.NotNil(t, obj)

// 布尔断言
assert.True(t, condition)
assert.False(t, condition)

// 集合断言
assert.Contains(t, []string{"a", "b", "c"}, "b")
assert.NotContains(t, []string{"a", "b", "c"}, "d")
assert.Len(t, slice, 3)
assert.Empty(t, slice)
assert.NotEmpty(t, slice)

// 字符串断言
assert.Regexp(t, `^hello`, "hello world")
assert.NotRegexp(t, `^bye`, "hello world")

// 错误断言
assert.NoError(t, err)
assert.Error(t, err)
assert.ErrorIs(t, err, ErrUserNotFound)
assert.ErrorContains(t, err, "not found")

// 类型断言
assert.IsType(t, &User{}, obj)

// 比较断言
assert.Greater(t, 5, 3)
assert.Less(t, 3, 5)
assert.GreaterOrEqual(t, 5, 5)
assert.InDelta(t, 3.14, 3.141, 0.01) // 浮点数近似比较

// JSON 断言
assert.JSONEq(t, `{"name":"张三"}`, jsonString)
```

#### require 包

`require` 的 API 与 `assert` 完全一致，唯一区别是失败后立即调用 `t.FailNow()`，终止当前测试。适用于后续代码依赖当前断言结果的场景：

```go
func TestGetUser(t *testing.T) {
    user, err := service.GetUser(1)
    
    // 如果这里失败，后续的 user.Name 访问会 panic
    // 所以用 require 而非 assert
    require.NoError(t, err)
    require.NotNil(t, user)
    
    // 后续断言用 assert，即使失败也不会影响其他字段检查
    assert.Equal(t, "张三", user.Name)
    assert.Equal(t, "zhangsan@example.com", user.Email)
    assert.Equal(t, 25, user.Age)
}
```

#### suite 包

Testify 的 suite 包提供了类似 JUnit 的测试套件，适合需要 setup/teardown 的场景：

```go
import "github.com/stretchr/testify/suite"

type UserServiceTestSuite struct {
    suite.Suite
    service *UserService
    repo    *mockRepo
}

// 测试套件初始化
func (s *UserServiceTestSuite) SetupSuite() {
    s.repo = &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
            2: {ID: 2, Name: "李四", Email: "lisi@example.com", Age: 30},
        },
    }
    s.service = NewUserService(s.repo)
}

// 每个测试前执行
func (s *UserServiceTestSuite) SetupTest() {
    // 重置 mock 状态
}

func (s *UserServiceTestSuite) TestGetUser() {
    user, err := s.service.GetUser(1)
    s.NoError(err)
    s.Equal("张三", user.Name)
}

func (s *UserServiceTestSuite) TestGetUserNotFound() {
    _, err := s.service.GetUser(999)
    s.Error(err)
}

func (s *UserServiceTestSuite) TestRegister() {
    user, err := s.service.Register("王五", "wangwu@example.com", 28)
    s.NoError(err)
    s.NotNil(user)
    s.Equal("王五", user.Name)
}

// 运行测试套件
func TestUserService(t *testing.T) {
    suite.Run(t, new(UserServiceTestSuite))
}
```

### 3.3 自定义断言消息

```go
// 自定义失败消息
assert.Equal(t, expected, actual, "用户ID不匹配，期望 %d，实际 %d", expected.ID, actual.ID)

// 带上下文的断言
assert.True(t, user.Age >= 18, "用户 %s 的年龄 %d 不满足成人要求", user.Name, user.Age)
```

### 3.4 对比 Pest PHP 断言

| Pest PHP | Testify assert |
|----------|---------------|
| `expect($x)->toBe($y)` | `assert.Equal(t, y, x)` |
| `expect($x)->toBeNull()` | `assert.Nil(t, x)` |
| `expect($x)->toBeTrue()` | `assert.True(t, x)` |
| `expect($x)->toBeInstanceOf(User::class)` | `assert.IsType(t, &User{}, x)` |
| `expect($arr)->toContain($val)` | `assert.Contains(t, arr, val)` |
| `expect($arr)->toHaveCount(3)` | `assert.Len(t, arr, 3)` |
| `expect($str)->toBeEmpty()` | `assert.Empty(t, str)` |
| `expect(fn())->toThrow(Exception::class)` | `assert.Panics(t, fn)` |
| `expect($err)->toBeNull()` | `assert.NoError(t, err)` |

---

## 第四章：httptest —— HTTP Handler 测试

### 4.1 测试 HTTP Handler

Go 的 `net/http/httptest` 包提供了测试 HTTP Handler 的完整工具：

```go
// handler.go
package handler

import (
    "encoding/json"
    "net/http"
    "strconv"
)

type UserHandler struct {
    service *UserService
}

func NewUserHandler(service *UserService) *UserHandler {
    return &UserHandler{service: service}
}

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
    idStr := r.URL.Query().Get("id")
    id, err := strconv.Atoi(idStr)
    if err != nil {
        http.Error(w, "invalid id", http.StatusBadRequest)
        return
    }
    
    user, err := h.service.GetUser(id)
    if err != nil {
        http.Error(w, err.Error(), http.StatusNotFound)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(user)
}

func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid request body", http.StatusBadRequest)
        return
    }
    
    user, err := h.service.Register(req.Name, req.Email, req.Age)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}
```

```go
// handler_test.go
package handler

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
    
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestGetUser_Success(t *testing.T) {
    // 准备
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
        },
    }
    service := NewUserService(repo)
    handler := NewUserHandler(service)
    
    // 创建请求
    req := httptest.NewRequest(http.MethodGet, "/api/users?id=1", nil)
    
    // 创建响应记录器
    rr := httptest.NewRecorder()
    
    // 执行
    handler.GetUser(rr, req)
    
    // 断言
    assert.Equal(t, http.StatusOK, rr.Code)
    
    var user User
    err := json.Unmarshal(rr.Body.Bytes(), &user)
    require.NoError(t, err)
    assert.Equal(t, "张三", user.Name)
    assert.Equal(t, 25, user.Age)
}

func TestGetUser_InvalidID(t *testing.T) {
    repo := &mockRepo{}
    service := NewUserService(repo)
    handler := NewUserHandler(service)
    
    req := httptest.NewRequest(http.MethodGet, "/api/users?id=abc", nil)
    rr := httptest.NewRecorder()
    
    handler.GetUser(rr, req)
    
    assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestGetUser_NotFound(t *testing.T) {
    repo := &mockRepo{users: map[int]*User{}}
    service := NewUserService(repo)
    handler := NewUserHandler(service)
    
    req := httptest.NewRequest(http.MethodGet, "/api/users?id=999", nil)
    rr := httptest.NewRecorder()
    
    handler.GetUser(rr, req)
    
    assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestCreateUser_Success(t *testing.T) {
    repo := &mockRepo{users: map[int]*User{}}
    service := NewUserService(repo)
    handler := NewUserHandler(service)
    
    body := CreateUserRequest{
        Name:  "王五",
        Email: "wangwu@example.com",
        Age:   28,
    }
    bodyBytes, _ := json.Marshal(body)
    
    req := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewReader(bodyBytes))
    req.Header.Set("Content-Type", "application/json")
    rr := httptest.NewRecorder()
    
    handler.CreateUser(rr, req)
    
    assert.Equal(t, http.StatusCreated, rr.Code)
    
    var user User
    json.Unmarshal(rr.Body.Bytes(), &user)
    assert.Equal(t, "王五", user.Name)
}
```

### 4.2 httptest.Server 集成测试

`httptest.Server` 可以启动一个真实的 HTTP 服务器，适合集成测试：

```go
func TestGetUser_Integration(t *testing.T) {
    // 准备
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Email: "zhangsan@example.com", Age: 25},
        },
    }
    service := NewUserService(repo)
    handler := NewUserHandler(service)
    
    // 启动测试服务器
    server := httptest.NewServer(http.HandlerFunc(handler.GetUser))
    defer server.Close()
    
    // 使用真实的 HTTP 客户端发送请求
    resp, err := http.Get(server.URL + "?id=1")
    require.NoError(t, err)
    defer resp.Body.Close()
    
    assert.Equal(t, http.StatusOK, resp.StatusCode)
    
    var user User
    json.NewDecoder(resp.Body).Decode(&user)
    assert.Equal(t, "张三", user.Name)
}
```

### 4.3 测试中间件

```go
func TestAuthMiddleware(t *testing.T) {
    tests := []struct {
        name       string
        token      string
        wantStatus int
    }{
        {"有效token", "valid-token", http.StatusOK},
        {"无效token", "invalid-token", http.StatusUnauthorized},
        {"空token", "", http.StatusUnauthorized},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // 创建带有中间件的 handler
            handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                w.WriteHeader(http.StatusOK)
            }))
            
            req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
            if tt.token != "" {
                req.Header.Set("Authorization", "Bearer "+tt.token)
            }
            rr := httptest.NewRecorder()
            
            handler.ServeHTTP(rr, req)
            
            assert.Equal(t, tt.wantStatus, rr.Code)
        })
    }
}
```

---

## 第五章：Mock 与依赖注入

### 5.1 手动 Mock

在 Go 中，Mock 通常通过接口实现：

```go
// 定义接口
type EmailSender interface {
    Send(to, subject, body string) error
}

type SMSSender interface {
    Send(phone, message string) error
}

// Mock 实现
type mockEmailSender struct {
    sentEmails []EmailRecord
    shouldErr  bool
}

type EmailRecord struct {
    To      string
    Subject string
    Body    string
}

func (m *mockEmailSender) Send(to, subject, body string) error {
    if m.shouldErr {
        return errors.New("email send failed")
    }
    m.sentEmails = append(m.sentEmails, EmailRecord{
        To:      to,
        Subject: subject,
        Body:    body,
    })
    return nil
}

func (m *mockEmailSender) GetSentEmails() []EmailRecord {
    return m.sentEmails
}

// 测试
func TestUserService_Register_SendsWelcomeEmail(t *testing.T) {
    repo := &mockRepo{users: map[int]*User{}}
    emailSender := &mockEmailSender{}
    service := NewUserServiceWithEmail(repo, emailSender)
    
    user, err := service.Register("张三", "zhangsan@example.com", 25)
    
    require.NoError(t, err)
    require.NotNil(t, user)
    
    // 验证邮件是否被发送
    emails := emailSender.GetSentEmails()
    assert.Len(t, emails, 1)
    assert.Equal(t, "zhangsan@example.com", emails[0].To)
    assert.Contains(t, emails[0].Subject, "欢迎")
}
```

### 5.2 使用 testify/mock

Testify 的 mock 包提供了更强大的 Mock 能力：

```go
import "github.com/stretchr/testify/mock"

// Mock 类型
type MockUserRepository struct {
    mock.Mock
}

func (m *MockUserRepository) FindByID(id int) (*User, error) {
    args := m.Called(id)
    if args.Get(0) == nil {
        return nil, args.Error(1)
    }
    return args.Get(0).(*User), args.Error(1)
}

func (m *MockUserRepository) FindByEmail(email string) (*User, error) {
    args := m.Called(email)
    if args.Get(0) == nil {
        return nil, args.Error(1)
    }
    return args.Get(0).(*User), args.Error(1)
}

func (m *MockUserRepository) Create(user *User) error {
    args := m.Called(user)
    return args.Error(0)
}

// 测试
func TestGetUser_WithMockery(t *testing.T) {
    mockRepo := new(MockUserRepository)
    
    // 设置期望
    mockRepo.On("FindByID", 1).Return(&User{
        ID:   1,
        Name: "张三",
        Age:  25,
    }, nil)
    
    mockRepo.On("FindByID", 999).Return(nil, ErrUserNotFound)
    
    service := NewUserService(mockRepo)
    
    // 测试成功场景
    user, err := service.GetUser(1)
    assert.NoError(t, err)
    assert.Equal(t, "张三", user.Name)
    
    // 测试失败场景
    _, err = service.GetUser(999)
    assert.Error(t, err)
    
    // 验证所有期望都被满足
    mockRepo.AssertExpectations(t)
}

func TestRegister_WithMockExpectations(t *testing.T) {
    mockRepo := new(MockUserRepository)
    mockEmail := new(mockEmailSender)
    
    // 期望：查找邮箱时不重复
    mockRepo.On("FindByEmail", "zhangsan@example.com").Return(nil, ErrUserNotFound)
    
    // 期望：创建用户时修改 user 对象
    mockRepo.On("Create", mock.AnythingOfType("*user.User")).Return(nil).Run(func(args mock.Arguments) {
        user := args.Get(0).(*User)
        user.ID = 1
    })
    
    // 期望：发送欢迎邮件
    mockEmail.On("Send", "zhangsan@example.com", mock.Anything, mock.Anything).Return(nil)
    
    service := NewUserServiceWithEmail(mockRepo, mockEmail)
    
    user, err := service.Register("张三", "zhangsan@example.com", 25)
    
    assert.NoError(t, err)
    assert.Equal(t, "张三", user.Name)
    assert.Equal(t, 1, user.ID)
    
    // 验证
    mockRepo.AssertExpectations(t)
    mockEmail.AssertExpectations(t)
    
    // 验证 Create 被调用了一次
    mockRepo.AssertNumberOfCalls(t, "Create", 1)
}
```

### 5.3 对比 Laravel Mockery

```php
// Laravel Mockery 示例
public function test_get_user()
{
    $mock = Mockery::mock(UserRepository::class);
    $mock->shouldReceive('findById')
         ->with(1)
         ->andReturn(new User(['id' => 1, 'name' => '张三']));
    
    $service = new UserService($mock);
    $user = $service->getUser(1);
    
    $this->assertEquals('张三', $user->name);
    Mockery::close();
}
```

| 概念 | Laravel Mockery | Testify mock |
|------|----------------|--------------|
| 创建 Mock | `Mockery::mock(Class::class)` | `new(MockRepo)` |
| 设置期望 | `shouldReceive('method')` | `On("Method")` |
| 参数匹配 | `with(1, 'name')` | `On("Method", 1, "name")` |
| 返回值 | `andReturn($value)` | `.Return(value, nil)` |
| 任意参数 | `withAnyArgs()` | `mock.Anything` |
| 类型匹配 | `with(Mockery::type('int'))` | `mock.AnythingOfType("int")` |
| 验证调用次数 | `shouldHaveReceived()->times(1)` | `AssertNumberOfCalls(t, "Method", 1)` |
| 清理 | `Mockery::close()` | 不需要（GC 自动清理） |

---

## 第六章：基准测试（Benchmark）

### 6.1 基本基准测试

Go 内置了基准测试功能，这对性能敏感的后端服务非常重要：

```go
func BenchmarkGetUser(b *testing.B) {
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Age: 25},
        },
    }
    service := NewUserService(repo)
    
    b.ResetTimer() // 重置计时器，排除准备时间
    for i := 0; i < b.N; i++ {
        service.GetUser(1)
    }
}

func BenchmarkGetUser_Parallel(b *testing.B) {
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三", Age: 25},
        },
    }
    service := NewUserService(repo)
    
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            service.GetUser(1)
        }
    })
}
```

运行基准测试：

```bash
# 运行基准测试
go test -bench=.

# 运行并显示内存分配
go test -bench=. -benchmem

# 运行 5 次取平均
go test -bench=. -count=5

# 输出到文件用于对比
go test -bench=. -benchmem > old.txt
# 修改代码后
go test -bench=. -benchmem > new.txt
# 使用 benchstat 对比
benchstat old.txt new.txt
```

输出示例：

```
BenchmarkGetUser-8           5000000    234 ns/op    48 B/op    1 allocs/op
BenchmarkGetUser_Parallel-8 10000000    156 ns/op    48 B/op    1 allocs/op
```

### 6.2 对比不同实现的性能

```go
func BenchmarkStringConcat(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := ""
        for j := 0; j < 100; j++ {
            s += "a"
        }
    }
}

func BenchmarkStringBuilder(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        for j := 0; j < 100; j++ {
            sb.WriteString("a")
        }
        _ = sb.String()
    }
}

func BenchmarkStringJoin(b *testing.B) {
    parts := make([]string, 100)
    for j := 0; j < 100; j++ {
        parts[j] = "a"
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        strings.Join(parts, "")
    }
}
```

---

## 第七章：高级测试技巧

### 7.1 测试覆盖率

```bash
# 生成覆盖率报告
go test -coverprofile=coverage.out ./...

# 查看文本报告
go tool cover -func=coverage.out

# 生成 HTML 报告
go tool cover -html=coverage.out -o coverage.html

# 设置覆盖率阈值（CI 中使用）
go test -coverprofile=coverage.out ./...
coverage=$(go tool cover -func=coverage.out | grep total | awk '{print $3}' | sed 's/%//')
if (( $(echo "$coverage < 80" | bc -l) )); then
    echo "Coverage $coverage% is below 80% threshold"
    exit 1
fi
```

### 7.2 测试辅助函数

```go
// testutil.go
package testutil

import (
    "testing"
    "github.com/stretchr/testify/require"
)

// 创建测试数据库连接
func SetupTestDB(t *testing.T) *sql.DB {
    t.Helper() // 标记为辅助函数，错误行号会指向调用者
    
    db, err := sql.Open("mysql", "test:test@tcp(localhost:3306)/testdb")
    require.NoError(t, err)
    
    // 清理测试数据
    _, err = db.Exec("TRUNCATE TABLE users")
    require.NoError(t, err)
    
    t.Cleanup(func() {
        db.Close()
    })
    
    return db
}

// 断言 JSON 响应
func AssertJSONResponse(t *testing.T, rr *httptest.ResponseRecorder, expectedCode int, expectedBody interface{}) {
    t.Helper()
    
    require.Equal(t, expectedCode, rr.Code)
    
    var actual interface{}
    err := json.Unmarshal(rr.Body.Bytes(), &actual)
    require.NoError(t, err)
    
    expectedJSON, _ := json.Marshal(expectedBody)
    var expected interface{}
    json.Unmarshal(expectedJSON, &expected)
    
    assert.Equal(t, expected, actual)
}
```

### 7.3 测试标签（Build Tags）

```go
// integration_test.go
//go:build integration

package main

import "testing"

func TestDatabaseIntegration(t *testing.T) {
    // 这个测试只在指定 integration 标签时运行
    // go test -tags=integration ./...
}
```

### 7.4 TestMain 控制全局设置

```go
func TestMain(m *testing.M) {
    // 全局 setup
    setup()
    
    // 运行所有测试
    code := m.Run()
    
    // 全局 teardown
    teardown()
    
    os.Exit(code)
}
```

---

## 第八章：从 Pest PHP 到 Go 测试的思维迁移

### 8.1 测试风格对比

```php
// Pest PHP - 描述性语法
describe('UserService', function () {
    beforeEach(function () {
        $this->repo = Mockery::mock(UserRepository::class);
        $this->service = new UserService($this->repo);
    });
    
    it('returns user by id', function () {
        $this->repo->shouldReceive('findById')
            ->with(1)
            ->andReturn(new User(['name' => '张三']));
        
        $user = $this->service->getUser(1);
        
        expect($user->name)->toBe('张三');
    });
    
    it('throws exception for invalid id', function () {
        expect(fn() => $this->service->getUser(0))
            ->toThrow(InvalidArgumentException::class);
    });
});
```

```go
// Go - 表驱动测试
func TestUserService(t *testing.T) {
    repo := &mockRepo{
        users: map[int]*User{
            1: {ID: 1, Name: "张三"},
        },
    }
    service := NewUserService(repo)
    
    tests := []struct {
        name    string
        id      int
        want    string
        wantErr bool
    }{
        {"有效ID", 1, "张三", false},
        {"无效ID", 0, "", true},
        {"不存在", 999, "", true},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            user, err := service.GetUser(tt.id)
            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want, user.Name)
        })
    }
}
```

### 8.2 思维迁移要点

1. **从 DSL 到代码**：Go 没有 `it`、`describe`、`expect` 等 DSL，用普通的 Go 代码代替
2. **从魔法到显式**：Go 的 Mock 需要手动实现接口，但这也意味着完全可控
3. **从灵活到严格**：Go 的测试文件必须在同一个包中（白盒测试）或 `_test` 包中（黑盒测试）
4. **从装饰到结构**：Go 用 `t.Run` 组织子测试，而不是嵌套的 `describe`

### 8.3 Go 测试最佳实践

1. **使用表驱动测试**：减少重复代码，增加用例可见性
2. **区分 assert 和 require**：assert 失败继续，require 失败终止
3. **使用 `t.Helper()`**：让错误报告指向正确的代码行
4. **使用 `t.Cleanup()`**：替代手动 defer 清理
5. **使用 `t.Parallel()`**：加速测试执行
6. **覆盖率不是目标**：80% 的有意义测试比 100% 的无意义断言更有价值

---

## 总结

Go 的测试体系与 Laravel/Pest PHP 截然不同，但各有优势：

| 维度 | Go testing + Testify | Pest PHP |
|------|---------------------|----------|
| 上手难度 | 中等（需要理解接口和结构体） | 低（DSL 直观） |
| 灵活性 | 高（纯代码，无限制） | 中（受 DSL 约束） |
| 性能 | 高（编译执行，并行测试） | 中（解释执行） |
| IDE 支持 | 完美（类型安全） | 良好（依赖插件） |
| Mock 能力 | 需要手动实现接口 | Mockery 强大 |
| 基准测试 | 内置支持 | 需要第三方包 |
| 并行测试 | 原生支持 | Pest 支持 |

作为从 Laravel 迁移到 Go 的开发者，我的建议是：

1. **先熟悉 `testing` 包**：理解 `t.Run`、`t.Helper`、`t.Cleanup` 等原语
2. **采用表驱动测试**：这是 Go 测试的最佳实践，能大幅减少重复代码
3. **引入 Testify**：`assert` 和 `require` 能让断言更简洁，`mock` 能简化依赖管理
4. **善用 `httptest`**：HTTP Handler 测试在 API 开发中非常重要
5. **不要忽视基准测试**：Go 的基准测试是性能优化的利器

Go 的测试哲学是「测试代码也是代码」。没有魔法，意味着更高的可维护性和可调试性。当你习惯了这种风格后，会发现它比 DSL 更强大、更灵活。

---

## 参考资料

- [Go testing 包文档](https://pkg.go.dev/testing)
- [Testify 官方文档](https://pkg.go.dev/github.com/stretchr/testify)
- [Go 测试官方博客](https://go.dev/blog/subtests)
- [httptest 包文档](https://pkg.go.dev/net/http/httptest)
- [Pest PHP 官方文档](https://pestphp.com/)
- [Go 测试最佳实践](https://blog.jetbrains.com/go/2022/11/22/comprehensive-guide-to-testing-in-go/)

## 相关阅读

- [Go Context 深度实战：超时控制、取消传播与请求作用域——PHP 开发者的并发思维重塑](/categories/运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)
- [Go 数据库/sql 实战：连接池管理、事务控制与 sqlx/sqlc 代码生成](/categories/架构/Go-数据库-sql-实战-连接池管理-事务控制与-sqlx-sqlc-代码生成/)
- [Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析](/categories/php/2026-06-01-pest-php-3x-elegant-php-testing-framework/)
- [PHPUnit 11.x 实战：新特性与最佳实践](/categories/engineering/phpunit-11-x-guide-best-practices/)
