# Go 部署与工具链

## 定义

Go 的核心部署优势是**静态编译为单个二进制文件**，无运行时依赖。配合 `go:embed` 指令（Go 1.16+）可以在编译时将静态资源嵌入二进制，实现真正的"一个文件走天下"。

## 核心原理

### go:embed — 编译时嵌入静态资源

```go
import "embed"

// 嵌入单个文件
//go:embed config.json
var configData []byte

// 嵌入多个文件
//go:embed templates/*
var templates embed.FS

// 嵌入单个字符串
//go:embed version.txt
var version string

// 使用嵌入的文件系统
func handler(w http.ResponseWriter, r *http.Request) {
    tmpl, _ := template.ParseFS(templates, "templates/index.html")
    tmpl.Execute(w, nil)
}
```

### 交叉编译

```bash
# 编译 Linux 二进制（在 macOS 上）
GOOS=linux GOARCH=amd64 go build -o myapp-linux .

# 编译 ARM64（如 AWS Graviton、Apple Silicon）
GOOS=linux GOARCH=arm64 go build -o myapp-arm64 .

# 编译 Windows
GOOS=windows GOARCH=amd64 go build -o myapp.exe .

# 静态编译（无 CGO 依赖）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -ldflags '-s -w' -o myapp .
```

### Docker 多阶段构建

```dockerfile
# 构建阶段
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags '-s -w' -o server .

# 运行阶段——仅 ~10MB
FROM scratch
COPY --from=builder /app/server /server
COPY --from=builder /app/config.json /config.json
EXPOSE 8080
ENTRYPOINT ["/server"]
```

### ldflags — 编译时注入信息

```go
var (
    version   = "dev"
    buildTime = "unknown"
    gitHash   = "unknown"
)
```

```bash
go build -ldflags "-X main.version=1.0.0 -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) -X main.gitHash=$(git rev-parse --short HEAD)"
```

### go mod 依赖管理

```bash
go mod init github.com/user/project  # 初始化
go mod tidy                            # 整理依赖（添加缺失，删除未用）
go mod download                        # 下载依赖到本地缓存
go mod vendor                          # 生成 vendor 目录
go list -m all                         # 查看所有依赖
go list -m -u all                      # 检查可更新的依赖
```

### 构建标签（Build Tags）

```go
//go:build linux
// +build linux

package main

// 仅在 Linux 上编译的代码
```

```go
//go:build !production

package main

// 仅在非生产环境编译的调试代码
```

### 常用工具链

```bash
go fmt ./...           # 格式化代码
go vet ./...           # 静态分析
go test ./...          # 运行测试
go test -cover ./...   # 测试覆盖率
go test -bench=.       # 基准测试
go tool pprof          # 性能分析
go generate ./...      # 代码生成
gofumpt -w .           # 更严格的格式化（第三方）
golangci-lint run      # 综合 linter
```

## 与 Laravel 部署的对比

| 维度 | Go | Laravel |
|------|-----|---------|
| 部署产物 | 单二进制文件（~10MB） | 整个项目目录 + vendor |
| 运行时依赖 | 无 | PHP-FPM + Composer + 扩展 |
| 冷启动 | 即时（无启动时间） | 秒级（OPcache 预热） |
| 内存占用 | ~10-30MB | ~50-200MB |
| 交叉编译 | 原生支持 | 需要对应 PHP 环境 |
| 静态资源 | go:embed 内嵌 | public 目录 / CDN |
| Docker 镜像 | scratch ~10MB | php-fpm ~150MB+ |

## 实战案例

来自博客文章：
- [Go embed + 单二进制部署实战：静态资源内嵌与零依赖发布——对比 Laravel 的前端资源编译部署](/2026/06/01/10_Go/go-embed-single-binary-deployment-zero-dependency/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - 包管理、go mod
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - 微服务部署
- [Go 与 PHP 生态集成](Go与PHP生态集成.md) - FrankenPHP、RoadRunner

## 常见问题

**Q: scratch 镜像里没有 shell，怎么调试？**
A: 用 `gcr.io/distroless/static` 替代 scratch，它包含 CA 证书和时区数据，但仍无 shell。或者用 `alpine` 镜像（~5MB）。

**Q: go:embed 支持哪些文件类型？**
A: 支持任意文件。`[]byte` 存二进制，`string` 存文本，`embed.FS` 存虚拟文件系统。目录用 `//go:embed dir/*` 嵌入。

**Q: CGO_ENABLED=0 有什么影响？**
A: 禁用 CGO 后不能使用依赖 C 库的包（如 SQLite 的 `go-sqlite3`），但大多数纯 Go 包不受影响。用 `modernc.org/sqlite` 替代。
