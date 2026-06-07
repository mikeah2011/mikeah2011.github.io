# Go 数据库操作

## 定义

Go 通过标准库 `database/sql` 提供统一的数据库接口，配合驱动（如 `go-sql-driver/mysql`、`lib/pq`）实现数据库操作。社区库 `sqlx` 扩展了便捷方法，`sqlc` 从 SQL 语句生成类型安全的 Go 代码。

## 核心原理

### database/sql 标准库

```go
import (
    "database/sql"
    _ "github.com/go-sql-driver/mysql"  // 驱动注册
)

// 连接数据库
db, err := sql.Open("mysql", "user:pass@tcp(localhost:3306)/mydb?parseTime=true")
if err != nil {
    log.Fatal(err)
}
defer db.Close()

// 连接池配置
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(5 * time.Minute)

// 健康检查
if err := db.Ping(); err != nil {
    log.Fatal("数据库连接失败:", err)
}
```

### 查询操作

```go
// 单行查询
var name string
err := db.QueryRow("SELECT name FROM users WHERE id = ?", 1).Scan(&name)
if err == sql.ErrNoRows {
    fmt.Println("用户不存在")
} else if err != nil {
    log.Fatal(err)
}

// 多行查询
rows, err := db.Query("SELECT id, name, email FROM users WHERE age > ?", 18)
if err != nil {
    log.Fatal(err)
}
defer rows.Close()

for rows.Next() {
    var u User
    if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
        log.Fatal(err)
    }
    fmt.Printf("%+v\n", u)
}
if err := rows.Err(); err != nil {
    log.Fatal(err)
}
```

### 事务

```go
tx, err := db.Begin()
if err != nil {
    log.Fatal(err)
}
defer tx.Rollback()  // 如果 Commit 了，Rollback 是 no-op

_, err = tx.Exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", 100, 1)
if err != nil {
    log.Fatal(err)
}

_, err = tx.Exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", 100, 2)
if err != nil {
    log.Fatal(err)
}

if err := tx.Commit(); err != nil {
    log.Fatal(err)
}
```

### sqlx 扩展

```go
import "github.com/jmoiron/sqlx"

type User struct {
    ID    int    `db:"id"`
    Name  string `db:"name"`
    Email string `db:"email"`
}

// Struct 扫描——自动映射字段
var users []User
err := sqlx.Select(db, &users, "SELECT * FROM users WHERE age > ?", 18)

// Named 参数
user := User{Name: "Alice", Email: "alice@example.com"}
result, err := db.NamedExec("INSERT INTO users (name, email) VALUES (:name, :email)", user)

// In 查询（自动展开 ? 占位符）
ids := []int{1, 2, 3}
query, args, _ := sqlx.In("SELECT * FROM users WHERE id IN (?)", ids)
query = db.Rebind(query)
var users []User
db.Select(&users, query, args...)
```

### sqlc — SQL 生成 Go 代码

```sql
-- query.sql
-- name: GetUser :one
SELECT * FROM users WHERE id = ? LIMIT 1;

-- name: ListUsers :many
SELECT * FROM users WHERE age > ? ORDER BY name;

-- name: CreateUser :execresult
INSERT INTO users (name, email) VALUES (?, ?);
```

```yaml
# sqlc.yaml
version: "2"
sql:
  - engine: "mysql"
    queries: "query.sql"
    schema: "schema.sql"
    gen:
      go:
        out: "db"
```

```bash
sqlc generate  # 生成 db/querier.go、db/models.go
```

```go
// 生成的代码——完全类型安全
querier := db.New(conn)
user, err := querier.GetUser(ctx, 1)
users, err := querier.ListUsers(ctx, 18)
```

### 连接池对比

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| MaxOpenConns | 最大打开连接数 | 25-50 |
| MaxIdleConns | 最大空闲连接数 | 10-25 |
| ConnMaxLifetime | 连接最大存活时间 | 5min |
| ConnMaxIdleTime | 空闲连接最大存活时间 | 3min |

## 与 Laravel Eloquent 的对比

| 维度 | Go database/sql | Laravel Eloquent |
|------|----------------|-----------------|
| 查询构建器 | 原生 SQL | 链式 `->where()->get()` |
| ORM | 无（手动 Scan） | 完整 ORM（属性、关系、事件） |
| 迁移 | golang-migrate/Atlas | `php artisan migrate` |
| 类型安全 | sqlc 生成 | PHPDoc + PHPStan |
| 连接池 | 内置配置 | PDO 连接池（持久连接） |
| 事务 | 显式 `Begin/Commit/Rollback` | `DB::transaction()` |

## 实战案例

来自博客文章：
- [Go 数据库/sql 实战：连接池管理、事务控制与 sqlx/sqlc 代码生成——与 Laravel Eloquent 的对比](/2026/06/01/00_架构/Go-数据库-sql-实战-连接池管理-事务控制与-sqlx-sqlc-代码生成/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - struct、interface
- [Go 泛型](Go泛型.md) - 泛型 Repository 模式
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - 数据库层在微服务中的位置

## 常见问题

**Q: sqlx 和 sqlc 选哪个？**
A: `sqlx` 适合需要灵活 SQL 的场景（动态查询、复杂 JOIN）；`sqlc` 适合 CRUD 密集、追求类型安全的场景。可以混用。

**Q: 为什么 Go 没有像 Eloquent 那样的 ORM？**
A: Go 社区偏好"显式优于隐式"。GORM 是最接近 Eloquent 的 ORM，但很多团队更喜欢原生 SQL + sqlx/sqlc，因为更透明、性能更可控。

**Q: database/sql 的连接池是自动管理的吗？**
A: 是的，`sql.Open` 返回的 `*sql.DB` 就是连接池。默认配置通常够用，但高并发场景需要调参。
