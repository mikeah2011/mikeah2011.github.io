# Go 微服务与 gRPC

## 定义

gRPC 是 Google 开源的高性能 RPC 框架，基于 HTTP/2 和 Protocol Buffers（Protobuf）序列化。Go 是 gRPC 的一等公民语言，Docker、Kubernetes、etcd、Prometheus 等云原生基础设施全部用 Go + gRPC 构建。

## 核心原理

### Protobuf 定义

```protobuf
// user.proto
syntax = "proto3";
package user;
option go_package = "github.com/user/project/proto/user";

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc WatchUser(WatchUserRequest) returns (stream User);  // 服务端流
}

message GetUserRequest {
  int64 id = 1;
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
}
```

```bash
protoc --go_out=. --go-grpc_out=. user.proto
```

### gRPC 四种通信模式

```go
// 1. Unary RPC（一问一答）
func (s *server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
    user, err := s.repo.FindByID(req.Id)
    if err != nil {
        return nil, status.Errorf(codes.NotFound, "user %d not found", req.Id)
    }
    return toProto(user), nil
}

// 2. Server Streaming（服务端流）
func (s *server) WatchUser(req *pb.WatchUserRequest, stream pb.UserService_WatchUserServer) error {
    for update := range s.userUpdates(req.Id) {
        if err := stream.Send(toProto(update)); err != nil {
            return err
        }
    }
    return nil
}

// 3. Client Streaming（客户端流）
func (s *server) UploadUsers(stream pb.UserService_UploadUsersServer) error {
    for {
        user, err := stream.Recv()
        if err == io.EOF {
            return stream.SendAndClose(&pb.UploadResponse{Count: count})
        }
        if err != nil {
            return err
        }
        s.repo.Save(fromProto(user))
        count++
    }
}

// 4. Bidirectional Streaming（双向流）
func (s *server) Chat(stream pb.UserService_ChatServer) error {
    for {
        msg, err := stream.Recv()
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }
        // 处理并发送响应
        stream.Send(process(msg))
    }
}
```

### gRPC 客户端

```go
conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
if err != nil {
    log.Fatal(err)
}
defer conn.Close()

client := pb.NewUserServiceClient(conn)
user, err := client.GetUser(context.Background(), &pb.GetUserRequest{Id: 1})
```

### gRPC 中间件（拦截器）

```go
// Unary 拦截器
func loggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
    start := time.Now()
    resp, err := handler(ctx, req)
    log.Printf("Method: %s, Duration: %v, Error: %v", info.FullMethod, time.Since(start), err)
    return resp, err
}

server := grpc.NewServer(
    grpc.UnaryInterceptor(loggingInterceptor),
)
```

### gRPC 错误处理

```go
import "google.golang.org/grpc/status"
import "google.golang.org/grpc/codes"

// 返回标准错误
return nil, status.Errorf(codes.NotFound, "user %d not found", id)
return nil, status.Errorf(codes.PermissionDenied, "insufficient permissions")
return nil, status.Errorf(codes.Internal, "database error: %v", err)

// 客户端解析错误
st, ok := status.FromError(err)
if ok {
    switch st.Code() {
    case codes.NotFound:
        fmt.Println("资源不存在")
    case codes.PermissionDenied:
        fmt.Println("权限不足")
    }
}
```

### gRPC vs REST vs GraphQL

| 维度 | gRPC | REST | GraphQL |
|------|------|------|---------|
| 协议 | HTTP/2 | HTTP/1.1+ | HTTP |
| 序列化 | Protobuf（二进制） | JSON（文本） | JSON |
| 性能 | 极高 | 中等 | 中等 |
| 流式 | 原生支持 | SSE/WS | Subscriptions |
| 代码生成 | 原生 protoc | OpenAPI codegen | GraphQL codegen |
| 浏览器 | 需要 gRPC-Web | 原生支持 | 原生支持 |
| 学习曲线 | 较高 | 低 | 中等 |

## 从 Laravel 迁移到 Go 微服务

典型的迁移路径：
1. 用 Go 重写性能热点模块（如订单处理、库存扣减）
2. 通过 gRPC 与 Laravel 通信（Laravel 作为 BFF/API Gateway）
3. 逐步将更多模块迁移到 Go

## 实战案例

来自博客文章：
- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/2026/06/01/00_架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块](/2026/06/01/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [gRPC vs Connect 实战：Protobuf 通信的新旧对比](/2026/06/01/00_架构/gRPC-vs-Connect实战-Protobuf通信的新旧对比-gRPC-Web替代方案与三端集成/)

## 相关概念

- [Go 语言基础](Go语言基础.md) - interface、struct
- [Go 错误处理](Go错误处理.md) - gRPC 错误码映射
- [Go 与 PHP 生态集成](Go与PHP生态集成.md) - Go 作为 PHP 的高性能层

## 常见问题

**Q: gRPC 在浏览器中怎么用？**
A: 需要 gRPC-Web 代理（如 Envoy）或使用 Connect 协议（支持 gRPC、gRPC-Web、Connect 三种协议）。

**Q: gRPC 的健康检查怎么做？**
A: gRPC 内置 `grpc.health.v1.Health` 服务，Kubernetes 的 gRPC 健康探针原生支持。

**Q: 什么时候用 gRPC，什么时候用 REST？**
A: 内部微服务间通信优先 gRPC（高性能、类型安全）；对外公开 API 优先 REST/GraphQL（浏览器兼容、生态成熟）。
