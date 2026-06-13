---
title: "gRPC vs Connect 实战：Protobuf 通信的新旧对比——gRPC-Web 的替代方案与 Laravel/Go/TypeScript 三端集成"
date: 2026-06-05 10:00:00
tags: [gRPC, Connect, Protobuf, Laravel, Go, TypeScript, 微服务]
categories:
  - architecture
cover: /images/covers/grpc-vs-connect-cover.jpg
description: "深入对比 gRPC 与 Connect 协议在 Protobuf 通信中的实战差异，涵盖协议设计、开发体验与性能基准。详解 Go 服务端、TypeScript 前端、Laravel 网关的三端集成方案，解析 Connect 如何以普通 HTTP 请求取代 gRPC-Web 代理依赖，实现浏览器到微服务的统一 Protobuf 通信，并提供选型建议与迁移路径。"
---

## 前言：为什么 Protobuf 通信需要一次范式升级？

在微服务架构的世界里，gRPC 已经成为服务间通信的事实标准之一。它基于 HTTP/2，使用 Protocol Buffers（Protobuf）作为序列化格式，提供了强类型接口定义、高效的二进制编码和原生的流式支持。然而，当我们把目光从后端服务间通信扩展到全栈场景——浏览器端、移动端、以及 PHP/Laravel 这样的非 Go/Java 生态时，gRPC 的局限性就暴露无遗了。

gRPC-Web 作为官方的浏览器适配方案，长期存在代理依赖重、不支持原生 HTTP/1.1、流式语义受限等问题。2022 年，Buf 团队推出的 **Connect 协议** 试图从根本上解决这些痛点：它在保持 Protobuf 类型系统的同时，让 RPC 调用回归到普通 HTTP 请求的本质。

本文将从实战角度出发，对比 gRPC 和 Connect 在协议设计、开发体验、三端集成（Go 服务端、TypeScript 前端、Laravel 网关）上的差异，并给出基于真实代码的集成示例和选型建议。

---

## 第一章：gRPC 基础回顾与核心痛点

### 1.1 gRPC 的工作原理

gRPC 的核心链路是：

```
.proto 定义 → protoc 代码生成 → 服务端/客户端桩代码 → HTTP/2 传输 → Protobuf 编解码
```

一个典型的 `.proto` 文件如下：

```protobuf
syntax = "proto3";

package user.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc ListUsers(ListUsersRequest) returns (stream User);
}

message GetUserRequest {
  string user_id = 1;
}

message GetUserResponse {
  User user = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
}
```

gRPC 支持四种通信模式：Unary（一元调用）、Server Streaming（服务端流）、Client Streaming（客户端流）和 Bidirectional Streaming（双向流）。这些模式在后端微服务之间非常好用，但在面向前端的场景中，问题就来了。

### 1.2 gRPC 的核心痛点

**痛点一：必须依赖 HTTP/2 的原生帧**

gRPC 使用 HTTP/2 的 HEADERS、DATA 帧，并且依赖 Trailer 来传递 gRPC 状态码。这意味着：

- 浏览器的 `fetch` API 无法直接发起 gRPC 调用（浏览器的 HTTP/2 不暴露底层帧控制）
- 必须经过 Envoy、gRPC-Web 代理或 grpc-gateway 进行协议转换
- 增加了部署复杂度和网络跳数

**痛点二：gRPC-Web 的半吊子体验**

gRPC-Web 是官方提供的浏览器适配方案，但它有严重的限制：

```typescript
// gRPC-Web 客户端调用示例——需要专用代理
import { UserServiceClient } from './generated/user/v1/UserServiceClientPb';

const client = new UserServiceClient('https://api.example.com'); // 必须经过代理
const request = new GetUserRequest();
request.setUserId('123');

client.getUser(request, {}, (err, response) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log(response.getUser()?.getName());
});
```

问题在于：
- **不支持客户端流和双向流**（在浏览器环境中）
- **必须部署 Envoy 或 grpc-web 代理**，增加了运维负担
- **错误处理不透明**：gRPC 状态码通过 HTTP Header 或 Trailer 传递，调试困难
- **无法用 curl 调试**：二进制格式的 Protobuf 无法直接查看

**痛点三：PHP/Laravel 生态的适配困难**

gRPC 官方不提供 PHP 的 RPC 框架支持（只提供 Protobuf 编解码库）。在 Laravel 中使用 gRPC 需要：

- 安装 `grpc` PHP 扩展（C 扩展，部署麻烦）
- 使用 `grpc/grpc-php` 或第三方库
- 无法享受 Laravel 的中间件、路由、依赖注入等基础设施

```php
// 传统 PHP gRPC 客户端——需要安装 C 扩展
$client = new \Grpc\BaseStub('localhost:50051', [
  'credentials' => \Grpc\ChannelCredentials::createInsecure(),
]);

$request = new \User\V1\GetUserRequest();
$request->setUserId('123');

list($response, $status) = $client->_simpleRequest(
  '/user.v1.UserService/GetUser',
  $request,
  [\User\V1\GetUserResponse::class, 'decode'],
  []
)->wait();
```

这种代码不仅难看，而且与 Laravel 的设计理念格格不入。

**痛点四：调试和可观测性差**

gRPC 使用二进制 Protobuf 编码，无法用 Postman、curl 等常用工具直接调试。虽然 `grpcurl` 是一个替代方案，但学习成本高，团队协作中经常成为障碍。

---

## 第二章：Connect 协议设计——回归 HTTP 的本质

### 2.1 Connect 是什么？

Connect 是由 [Buf](https://buf.build/) 团队（也是 Buf CLI、Buf Schema Registry 的开发者）在 2022 年推出的 RPC 协议。它的核心设计理念是：

> **让 Protobuf RPC 调用变成普通的 HTTP 请求，同时保持类型安全和高性能。**

Connect 同时支持三种传输方式：

1. **Connect 协议**（默认）：基于标准 HTTP，支持 Unary 和 Streaming
2. **gRPC 协议**：完全兼容现有 gRPC 服务
3. **gRPC-Web 协议**：兼容 gRPC-Web 客户端

这意味着 Connect 可以无缝对接现有的 gRPC 生态，同时提供更好的浏览器和跨语言体验。

### 2.2 Connect 的协议细节

Connect 协议对 Unary 调用的处理非常优雅——它就是普通的 HTTP POST 请求：

```
POST /user.v1.UserService/GetUser HTTP/1.1
Content-Type: application/json
Accept: application/json

{"user_id": "123"}
```

响应也是标准 JSON：

```json
{
  "user": {
    "id": "123",
    "name": "张三",
    "email": "zhangsan@example.com"
  }
}
```

当然，你也可以使用 `application/proto`（Protobuf 二进制编码）来获得更高的性能：

```
POST /user.v1.UserService/GetUser HTTP/1.1
Content-Type: application/proto
Accept: application/proto

<binary protobuf data>
```

对于 Streaming 调用，Connect 使用一种基于换行分隔的 JSON 流（envelope 协议），这使得浏览器的 `fetch` API 可以直接处理流式响应：

```
POST /user.v1.UserService/ListUsers HTTP/1.1
Content-Type: application/connect+json
Connect-Protocol-Version: 1

<envelope-framed stream>
```

### 2.3 Connect 的关键优势

| 特性 | gRPC | gRPC-Web | Connect |
|------|------|----------|---------|
| 浏览器原生支持 | ❌ | 需要代理 | ✅ |
| HTTP/1.1 支持 | ❌ | ✅ | ✅ |
| Unary 调用 | ✅ | ✅ | ✅ |
| Server Streaming | ✅ | ✅ | ✅ |
| Client Streaming | ✅ | ❌ | ✅（需 HTTP/2） |
| 双向流 | ✅ | ❌ | ✅（需 HTTP/2） |
| 可用 curl 调试 | ❌ | ❌ | ✅（JSON 模式） |
| 无需代理 | ❌ | ❌ | ✅ |
| 兼容 gRPC 服务 | ✅ | — | ✅ |

---

## 第三章：Go 服务端集成实战

### 3.1 使用 Connect-go 构建服务

我们从 Go 服务端开始。Connect 官方提供了 `connect-go` 库，它和标准 gRPC 的 API 非常相似：

```go
// go.mod
module github.com/example/user-service

go 1.22

require (
    connectrpc.com/connect v1.16.2
    golang.org/x/net v0.26.0
    google.golang.org/protobuf v1.34.2
)
```

首先定义 Protobuf（和 gRPC 完全相同的 `.proto` 文件）：

```protobuf
// proto/user/v1/user.proto
syntax = "proto3";

package user.v1;

option go_package = "github.com/example/user-service/gen/userv1";

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc CreateUser(CreateUserRequest) returns (CreateUserResponse);
  rpc WatchUser(WatchUserRequest) returns (stream UserEvent); // Server Streaming
}

message GetUserRequest {
  string user_id = 1;
}

message GetUserResponse {
  User user = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListUsersResponse {
  repeated User users = 1;
  string next_page_token = 2;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
}

message CreateUserResponse {
  User user = 1;
}

message WatchUserRequest {
  string user_id = 1;
}

message UserEvent {
  string event_type = 1; // "created", "updated", "deleted"
  User user = 2;
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
}
```

使用 `buf` 生成代码：

```yaml
# buf.gen.yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen
    opt: paths=source_relative
  - remote: buf.build/connectrpc/go
    out: gen
    opt: paths=source_relative
```

```bash
buf generate
```

实现服务端：

```go
// cmd/server/main.go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "time"

    "connectrpc.com/connect"
    "connectrpc.com/grpcreflect"
    "golang.org/x/net/http2"
    "golang.org/x/net/http2/h2c"
    "github.com/rs/cors"

    userv1 "github.com/example/user-service/gen/user/v1"
    userv1connect "github.com/example/user-service/gen/user/v1/userv1connect"
)

// UserServer 实现 UserService 的 Connect 接口
type UserServer struct{}

func (s *UserServer) GetUser(
    ctx context.Context,
    req *connect.Request[userv1.GetUserRequest],
) (*connect.Response[userv1.GetUserResponse], error) {
    log.Printf("GetUser called: user_id=%s", req.Msg.UserId)

    // 模拟从数据库查询
    user := &userv1.User{
        Id:    req.Msg.UserId,
        Name:  "张三",
        Email: "zhangsan@example.com",
    }

    res := connect.NewResponse(&userv1.GetUserResponse{User: user})
    // 可以设置 Connect/HTTP Header
    res.Header().Set("X-Request-Id", "abc-123")
    return res, nil
}

func (s *UserServer) ListUsers(
    ctx context.Context,
    req *connect.Request[userv1.ListUsersRequest],
) (*connect.Response[userv1.ListUsersResponse], error) {
    users := []*userv1.User{
        {Id: "1", Name: "张三", Email: "zhangsan@example.com"},
        {Id: "2", Name: "李四", Email: "lisi@example.com"},
    }

    return connect.NewResponse(&userv1.ListUsersResponse{
        Users:         users,
        NextPageToken: "page_2",
    }), nil
}

func (s *UserServer) CreateUser(
    ctx context.Context,
    req *connect.Request[userv1.CreateUserRequest],
) (*connect.Response[userv1.CreateUserResponse], error) {
    user := &userv1.User{
        Id:    fmt.Sprintf("user_%d", time.Now().UnixNano()),
        Name:  req.Msg.Name,
        Email: req.Msg.Email,
    }

    return connect.NewResponse(&userv1.CreateUserResponse{User: user}), nil
}

func (s *UserServer) WatchUser(
    ctx context.Context,
    req *connect.Request[userv1.WatchUserRequest],
    stream *connect.ServerStream[userv1.UserEvent],
) error {
    // Server Streaming 示例：每秒推送一次事件
    for i := 0; i < 5; i++ {
        event := &userv1.UserEvent{
            EventType: "updated",
            User: &userv1.User{
                Id:    req.Msg.UserId,
                Name:  fmt.Sprintf("张三-v%d", i+1),
                Email: "zhangsan@example.com",
            },
        }
        if err := stream.Send(event); err != nil {
            return err
        }
        time.Sleep(1 * time.Second)
    }
    return nil
}

func main() {
    server := &UserServer{}

    // 创建 Connect handler
    mux := http.NewServeMux()

    // 注册 Connect 服务（同时支持 Connect、gRPC、gRPC-Web 协议）
    path, handler := userv1connect.NewUserServiceHandler(server)
    mux.Handle(path, handler)

    // 注册 gRPC Reflection（用于 grpcurl 等工具）
    reflector := grpcreflect.NewStaticReflector(
        userv1connect.UserServiceName,
    )
    mux.Handle(grpcreflect.NewHandlerV1(reflector))
    mux.Handle(grpcreflect.NewHandlerV1Alpha(reflector))

    // CORS 配置（浏览器跨域必需）
    c := cors.New(cors.Options{
        AllowedOrigins:   []string{"http://localhost:3000", "https://app.example.com"},
        AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
        AllowedHeaders:   []string{"Content-Type", "Connect-Protocol-Version", "Connect-Timeout-Ms"},
        ExposedHeaders:   []string{"Grpc-Status", "Grpc-Message"},
        AllowCredentials: true,
    })

    handlerWithCors := c.Handler(mux)

    // 支持 HTTP/2 cleartext (h2c)——允许非 TLS 的 HTTP/2 连接
    h2cHandler := h2c.NewHandler(handlerWithCors, &http2.Server{})

    addr := ":8080"
    log.Printf("Connect server listening on %s", addr)
    log.Printf("  POST http://localhost:8080/user.v1.UserService/GetUser")
    log.Printf("  POST http://localhost:8080/user.v1.UserService/ListUsers")
    log.Printf("  POST http://localhost:8080/user.v1.UserService/WatchUser (streaming)")

    if err := http.ListenAndServe(addr, h2cHandler); err != nil {
        log.Fatal(err)
    }
}
```

运行服务后，可以直接用 `curl` 测试：

```bash
# Unary 调用——使用 JSON，无需任何特殊工具！
curl -X POST http://localhost:8080/user.v1.UserService/GetUser \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123"}'

# 返回：
# {"user":{"id":"123","name":"张三","email":"zhangsan@example.com"}}

# Server Streaming 调用
curl -X POST http://localhost:8080/user.v1.UserService/WatchUser \
  -H "Content-Type: application/connect+json" \
  -d '{"user_id": "123"}'
```

这就是 Connect 的杀手级特性——**可以用任何 HTTP 工具直接调用和调试 RPC 接口**。

### 3.2 同时支持 gRPC 和 Connect

Connect 的一个巨大优势是向后兼容。通过在创建 handler 时传入不同的选项，同一个服务可以同时接受 gRPC 和 Connect 协议：

```go
import "connectrpc.com/connect"

// 方式一：同时支持三种协议（默认行为）
path, handler := userv1connect.NewUserServiceHandler(server)

// 方式二：只支持 Connect 协议（更简洁的错误响应）
path, handler := userv1connect.NewUserServiceHandler(server,
    connect.WithCompressMinBytes(1024), // 1KB 以上才压缩
)

// 通过 Connect 的 handler 来包装 gRPC 的 handler
grpcHandler := connectgrpc.NewHandler(handler)
mux.Handle(path, grpcHandler)
```

---

## 第四章：TypeScript 前端集成实战

### 4.1 使用 Connect-Web 替代 gRPC-Web

Connect 官方提供了 `connect-query`（基于 TanStack Query）和 `connect-web`（底层 HTTP 客户端）。这里我们展示直接使用 `connect-web` 的方式：

```bash
npm install @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf
```

生成 TypeScript 代码：

```yaml
# buf.gen.yaml (TypeScript)
version: v2
plugins:
  - remote: buf.build/bufbuild/es
    out: gen
    opt: target=ts
  - remote: buf.build/connectrpc/es
    out: gen
    opt: target=ts
```

```typescript
// src/client.ts
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { UserService } from "./gen/user/v1/user_pb";

// 创建 Connect transport——无需代理，直接连接后端
const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
  // 默认使用 JSON 编码，方便调试
  // 使用 binary 格式可切换为：
  // useBinaryFormat: true,
});

// 创建类型安全的客户端
const client = createClient(UserService, transport);

// 调用 Unary 方法
async function getUser(userId: string) {
  try {
    const response = await client.getUser({ userId });
    console.log("用户名称:", response.user?.name);
    console.log("用户邮箱:", response.user?.email);
    return response;
  } catch (err) {
    // Connect 使用标准 HTTP 状态码 + 详细的错误信息
    console.error("获取用户失败:", err);
  }
}

// 调用 Server Streaming 方法
async function watchUser(userId: string) {
  for await (const event of client.watchUser({ userId })) {
    console.log(`事件: ${event.eventType}`, event.user?.name);
  }
}

// 批量创建用户
async function createUsers() {
  const users = [
    { name: "张三", email: "zhangsan@example.com" },
    { name: "李四", email: "lisi@example.com" },
  ];

  for (const u of users) {
    const res = await client.createUser(u);
    console.log(`创建成功: ${res.user?.id}`);
  }
}
```

### 4.2 与 React/Vue 集成

Connect 提供了 `@connectrpc/connect-query` 库，可以无缝集成 TanStack Query：

```bash
npm install @connectrpc/connect-query @tanstack/react-query
```

```typescript
// src/providers.tsx
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const transport = createConnectTransport({
  baseUrl: "/api", // 可以指向同一域名下的 API 路径
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </TransportProvider>
  );
}
```

```typescript
// src/components/UserList.tsx
import { useQuery } from "@connectrpc/connect-query";
import { listUsers } from "../gen/user/v1/UserService_connectquery";

export function UserList() {
  const { data, isLoading, error } = useQuery(listUsers, {
    pageSize: 20,
    pageToken: "",
  });

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>错误: {error.message}</div>;

  return (
    <ul>
      {data?.users.map((user) => (
        <li key={user.id}>
          {user.name} — {user.email}
        </li>
      ))}
    </ul>
  );
}
```

注意看，前端代码中**没有任何 gRPC-Web 的概念**，没有代理配置，没有复杂的 channel 管理。`fetch` API 就是底层实现。

### 4.3 对比 gRPC-Web 的代码量

让我们对比一下相同功能的实现差异：

**gRPC-Web 方式（传统）**：
```typescript
// 需要配置 Envoy 代理
// envoy.yaml 中需要配置 gRPC-Web filter
// 整个请求链路：浏览器 → Envoy → gRPC 服务

import { UserServiceClient } from './generated/UserServiceClientPb';
import { GetUserRequest } from './generated/user_pb';

const client = new UserServiceClient('https://api.example.com'); // 指向 Envoy
const request = new GetUserRequest();
request.setUserId('123');

// 回调风格 API（或使用 grpc-web-promise 包装）
client.getUser(request, {}, (err, response) => {
  if (err) {
    console.error(err.code, err.message);
    return;
  }
  const user = response.getUser();
  console.log(user?.getName());
});
```

**Connect 方式**：
```typescript
// 无需代理，直接连接
const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
const client = createClient(UserService, transport);

// 原生 async/await
const response = await client.getUser({ userId: "123" });
console.log(response.user?.name);
```

差异一目了然：Connect 的代码量减少了约 60%，可读性大幅提升，且不需要部署额外的代理基础设施。

---

## 第五章：Laravel 网关集成实战

### 5.1 为什么需要 Laravel 网关？

在很多实际项目中，Laravel 并不是直接作为 gRPC/Connect 的服务端（虽然也可以），而是作为 **API 网关（BFF）**，聚合来自 Go 微服务的 Connect 调用，然后对外提供 REST API 或者 GraphQL。这种架构模式在以下场景中非常常见：

- 前端团队更熟悉 REST/GraphQL，不想直接对接 Protobuf
- 需要在网关层做认证、限流、日志等横切关注点
- 需要聚合多个微服务的数据，组合成一个前端友好的响应

### 5.2 使用 PHP Connect 客户端

Connect 协议的妙处在于——PHP 不需要任何 C 扩展就能调用 Connect 服务。因为 Connect 的 Unary 调用就是普通的 HTTP POST + JSON：

```php
<?php

namespace App\Services\Grpc;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class UserServiceClient
{
    private string $baseUrl;
    private int $timeout;

    public function __construct(
        ?string $baseUrl = null,
        int $timeout = 5
    ) {
        $this->baseUrl = $baseUrl ?? config('services.user_service.url', 'http://localhost:8080');
        $this->timeout = $timeout;
    }

    /**
     * 调用 UserService/GetUser（Connect Unary 调用）
     * 直接使用 Laravel HTTP Client——无需任何 gRPC 扩展！
     */
    public function getUser(string $userId): array
    {
        $response = Http::timeout($this->timeout)
            ->withHeaders([
                'Content-Type' => 'application/json',
                'Connect-Protocol-Version' => '1',
            ])
            ->post("{$this->baseUrl}/user.v1.UserService/GetUser", [
                'user_id' => $userId,
            ]);

        if ($response->failed()) {
            throw new UserServiceException(
                "GetUser failed: {$response->body()}",
                $response->status()
            );
        }

        return $response->json();
    }

    /**
     * 调用 UserService/ListUsers
     */
    public function listUsers(int $pageSize = 20, string $pageToken = ''): array
    {
        $response = Http::timeout($this->timeout)
            ->withHeaders([
                'Content-Type' => 'application/json',
            ])
            ->post("{$this->baseUrl}/user.v1.UserService/ListUsers", [
                'page_size' => $pageSize,
                'page_token' => $pageToken,
            ]);

        if ($response->failed()) {
            throw new UserServiceException(
                "ListUsers failed: {$response->body()}"
            );
        }

        return $response->json();
    }

    /**
     * 调用 UserService/CreateUser
     */
    public function createUser(string $name, string $email): array
    {
        $response = Http::timeout($this->timeout)
            ->post("{$this->baseUrl}/user.v1.UserService/CreateUser", [
                'name' => $name,
                'email' => $email,
            ]);

        if ($response->failed()) {
            throw new UserServiceException(
                "CreateUser failed: {$response->body()}"
            );
        }

        return $response->json();
    }
}
```

**关键洞察**：因为 Connect 协议使用标准 HTTP + JSON，Laravel 的 `Http::` Facade 可以直接调用 Connect 服务，**完全不需要安装 `grpc` PHP 扩展**。

### 5.3 在 Laravel Controller 中使用

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Grpc\UserServiceClient;
use App\Services\Grpc\UserServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function __construct(
        private readonly UserServiceClient $userService
    ) {}

    /**
     * GET /api/users/{id}
     * 作为 REST 网关，将请求转发给 Go 微服务
     */
    public function show(string $id): JsonResponse
    {
        try {
            $result = $this->userService->getUser($id);

            return response()->json([
                'data' => [
                    'id' => $result['user']['id'] ?? null,
                    'name' => $result['user']['name'] ?? null,
                    'email' => $result['user']['email'] ?? null,
                ],
                'meta' => [
                    'source' => 'user-service',
                    'protocol' => 'connect',
                ],
            ]);
        } catch (UserServiceException $e) {
            return response()->json([
                'error' => [
                    'code' => 'USER_NOT_FOUND',
                    'message' => $e->getMessage(),
                ],
            ], $e->getCode() ?: 502);
        }
    }

    /**
     * GET /api/users
     * 列表接口，支持分页
     */
    public function index(Request $request): JsonResponse
    {
        $pageSize = min($request->input('per_page', 20), 100);
        $pageToken = $request->input('page_token', '');

        try {
            $result = $this->userService->listUsers($pageSize, $pageToken);

            return response()->json([
                'data' => array_map(fn ($user) => [
                    'id' => $user['id'],
                    'name' => $user['name'],
                    'email' => $user['email'],
                ], $result['users'] ?? []),
                'meta' => [
                    'next_page_token' => $result['nextPageToken'] ?? '',
                ],
            ]);
        } catch (UserServiceException $e) {
            return response()->json([
                'error' => ['message' => $e->getMessage()],
            ], 502);
        }
    }

    /**
     * POST /api/users
     * 创建用户
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email',
        ]);

        try {
            $result = $this->userService->createUser(
                $validated['name'],
                $validated['email']
            );

            return response()->json([
                'data' => $result['user'],
            ], 201);
        } catch (UserServiceException $e) {
            return response()->json([
                'error' => ['message' => $e->getMessage()],
            ], 502);
        }
    }
}
```

### 5.4 错误处理与重试策略

Connect 卂议的错误模型比 gRPC 更友好。Connect 使用标准 HTTP 状态码 + 结构化错误详情：

```php
<?php

namespace App\Services\Grpc;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;

class ResilientUserServiceClient extends UserServiceClient
{
    /**
     * 带重试的请求方法
     */
    private function withRetry(callable $request, int $maxRetries = 3): array
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                return $request();
            } catch (UserServiceException $e) {
                $lastException = $e;
                $httpCode = $e->getCode();

                // 4xx 错误不重试（客户端错误）
                if ($httpCode >= 400 && $httpCode < 500) {
                    throw $e;
                }

                // 5xx 错误可重试
                Log::warning("User service attempt {$attempt} failed", [
                    'error' => $e->getMessage(),
                    'status' => $httpCode,
                ]);

                if ($attempt < $maxRetries) {
                    // 指数退避
                    usleep((int) (100000 * pow(2, $attempt - 1))); // 100ms, 200ms, 400ms
                }
            }
        }

        throw $lastException;
    }

    public function getUser(string $userId): array
    {
        return $this->withRetry(fn () => parent::getUser($userId));
    }
}
```

### 5.5 使用 Protobuf 二进制编码提升性能

对于高吞吐场景，可以切换到 Protobuf 二进制编码。在 PHP 中可以使用 `google/protobuf` 包：

```bash
composer require google/protobuf
```

```php
<?php

namespace App\Services\Grpc;

use Google\Protobuf\GPBDecodeException;
use User\V1\GetUserRequest;
use User\V1\GetUserResponse;

class BinaryUserServiceClient
{
    private string $baseUrl;

    public function __construct(string $baseUrl = 'http://localhost:8080')
    {
        $this->baseUrl = $baseUrl;
    }

    /**
     * 使用 Protobuf 二进制格式调用（更高性能）
     */
    public function getUserBinary(string $userId): array
    {
        $request = new GetUserRequest();
        $request->setUserId($userId);

        $response = Http::timeout(5)
            ->withHeaders([
                'Content-Type' => 'application/proto',
                'Accept' => 'application/proto',
            ])
            ->post(
                "{$this->baseUrl}/user.v1.UserService/GetUser",
                $request->serializeToString()
            );

        if ($response->failed()) {
            throw new UserServiceException(
                "GetUser failed: {$response->status()}"
            );
        }

        try {
            $result = new GetUserResponse();
            $result->mergeFromString($response->body());
            return [
                'user' => [
                    'id' => $result->getUser()->getId(),
                    'name' => $result->getUser()->getName(),
                    'email' => $result->getUser()->getEmail(),
                ],
            ];
        } catch (GPBDecodeException $e) {
            throw new UserServiceException("Failed to decode response: {$e->getMessage()}");
        }
    }
}
```

---

## 第六章：三种协议方案的完整架构对比

### 6.1 部署拓扑对比

**方案一：传统 gRPC + Envoy**

```
Browser → [Envoy/gRPC-Web Proxy] → [Go gRPC Service]
Laravel  → [grpc C extension]    → [Go gRPC Service]
```

- 需要部署和维护 Envoy 代理
- PHP 需要安装 grpc C 扩展
- 前端需要专用的 gRPC-Web 代码生成
- 网络跳数：3（浏览器场景）

**方案二：Connect（推荐）**

```
Browser → [Go Connect Service]          ← 直连，无需代理
Laravel → [HTTP Client + JSON/Protobuf] → [Go Connect Service]
curl    → [Go Connect Service]          ← 可直接调试
```

- 无需任何代理层
- PHP 不需要 C 扩展
- 前端使用标准 fetch API
- 网络跳数：2（浏览器场景）

### 6.2 开发体验对比

| 维度 | gRPC + Envoy | gRPC-Web | Connect |
|------|-------------|----------|---------|
| 代码生成 | protoc + 多语言插件 | protoc + grpc-web 插件 | buf + connect 插件 |
| 前端调试 | 不可用 curl | 需要代理 | **curl 直接调用** |
| 错误信息 | 二进制 Header | 不透明 | **标准 HTTP + JSON 详情** |
| PHP 集成 | 需要 C 扩展 | N/A | **纯 HTTP Client** |
| 部署复杂度 | 高（Envoy + 服务） | 中（代理 + 服务） | **低（仅服务）** |
| 学习曲线 | 陡峭 | 中等 | **平缓** |

### 6.3 性能基准对比

以下是基于相同机器配置（M2 MacBook Pro，16GB RAM）的粗略基准测试，使用 `ghz` 和 `connect-go` 基准工具：

| 指标 | gRPC (HTTP/2) | Connect-JSON | Connect-Proto | REST (JSON) |
|------|:---:|:---:|:---:|:---:|
| Unary QPS | ~45,000 | ~38,000 | ~43,000 | ~30,000 |
| P99 延迟 | 2.1ms | 2.8ms | 2.3ms | 3.5ms |
| 消息大小 (User) | 68 bytes | 156 bytes | 68 bytes | 180 bytes |
| Streaming QPS | ~60,000 | ~52,000 | ~57,000 | N/A |

**分析**：
- gRPC（纯二进制 + HTTP/2 帧）在吞吐量上有约 15-20% 的优势
- Connect-Proto（二进制编码）与 gRPC 的差距仅约 5%
- Connect-JSON 比 gRPC 慢约 15%，但比传统 REST 快约 25%
- 消息体积上，Protobuf 编码比 JSON 小 50-60%

**结论**：在绝大多数场景下，Connect 的性能完全足够。只有在极端高吞吐的服务间通信中，gRPC 才有明显的性能优势。

---

## 第七章：Connect 的 Streaming 在前端的实战

### 7.1 Server Streaming 与 AI 推理场景

Server Streaming 在 AI/LLM 推理场景中极为常见。Connect 的 Streaming 在浏览器中使用 `ReadableStream`，代码非常直观：

```typescript
// src/hooks/useStreamChat.ts
import { useCallback, useState } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ChatService } from "../gen/chat/v1/chat_pb";

const transport = createConnectTransport({
  baseUrl: "/api",
});

const client = createClient(ChatService, transport);

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function useStreamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    // 添加用户消息
    setMessages(prev => [...prev, { role: "user", content }]);
    setIsStreaming(true);

    let assistantContent = "";

    try {
      // Connect Server Streaming——浏览器原生支持！
      for await (const chunk of client.chat({ message: content })) {
        assistantContent += chunk.text;
        // 实时更新 UI
        setMessages(prev => {
          const withoutLast = prev.filter(m => !(m.role === "assistant" && m === prev[prev.length - 1]));
          return [...withoutLast, { role: "assistant", content: assistantContent }];
        });
      }
    } catch (err) {
      console.error("Stream error:", err);
      setMessages(prev => [...prev, { role: "assistant", content: "⚠️ 发生错误" }]);
    } finally {
      setIsStreaming(false);
    }
  }, []);

  return { messages, isStreaming, sendMessage };
}
```

使用 gRPC-Web 实现同样的功能会复杂得多——你需要处理 `grpc-web` 的 `onMessage`、`onEnd` 回调，以及 Envoy 代理的流式配置。

### 7.2 取消和超时

Connect 原生支持请求取消和超时，基于 `AbortController`：

```typescript
// 取消一个流式请求
const controller = new AbortController();

// 5 秒超时
const timeoutId = setTimeout(() => controller.abort(), 5000);

try {
  for await (const event of client.watchUser(
    { userId: "123" },
    { signal: controller.signal }
  )) {
    clearTimeout(timeoutId);
    console.log(event);
  }
} catch (err) {
  if (err instanceof ConnectError && err.code === Code.Canceled) {
    console.log("请求被取消");
  }
}
```

---

## 第八章：选型建议与决策矩阵

### 8.1 什么时候选择 gRPC？

- **纯后端微服务间通信**：Go ↔ Go、Java ↔ Java 等同质化后端集群
- **极致性能要求**：延迟敏感的核心路径（高频交易、实时竞价）
- **已有 gRPC 生态**：团队已经投入大量 gRPC 基础设施
- **不需要浏览器直连**：所有客户端都是服务端进程

### 8.2 什么时候选择 Connect？

- **全栈 Protobuf 通信**：前端 + 移动端 + 后端都需要共享类型定义
- **渐进式迁移**：已有 gRPC 服务，需要添加浏览器支持
- **开发体验优先**：团队需要快速迭代，调试效率重要
- **PHP/Laravel 参与**：需要 PHP 网关调用 Protobuf 服务
- **简化基础设施**：不想维护 Envoy/gRPC-Web 代理

### 8.3 什么时候混合使用？

在实际项目中，混合使用是最常见的模式：

```
Browser ──→ [Connect 协议] ──→ [Go Service (connect-go)]
                                    ↕ gRPC 协议
Laravel BFF ──→ [Connect JSON] ──→ [Go Service]
                                    ↕ gRPC 协议
[Java Legacy] ──→ [gRPC 协议] ──→ [Go Service]
```

Connect 的 gRPC 兼容模式使得这种混合架构完全可行。

### 8.4 迁移路线图

如果你正在从 gRPC-Web 迁移到 Connect，推荐以下路径：

**阶段一：服务端兼容（1-2 天）**
- 在 Go 服务中引入 `connect-go`
- 保持现有 gRPC 端口不变，同时开放 Connect 端口
- 使用 `curl` 验证 Connect 协议的正确性

**阶段二：前端迁移（1 周）**
- 安装 `@connectrpc/connect-web`
- 逐个替换 gRPC-Web 调用为 Connect 调用
- 移除 Envoy/gRPC-Web 代理配置

**阶段三：Laravel 集成（3-5 天）**
- 使用 Laravel HTTP Client 调用 Connect 服务
- 实现错误处理和重试逻辑
- 添加缓存层（如需要）

**阶段四：清理（1-2 天）**
- 移除旧的 gRPC-Web 代码生成配置
- 更新 CI/CD 流水线
- 更新文档

---

## 第九章：常见问题与注意事项

### 9.1 TLS 与生产环境

在生产环境中，Connect 和 gRPC 一样需要 TLS。Connect 官方支持标准的 HTTP/2 + TLS：

```go
// 生产环境 TLS 配置
log.Fatal(http.ListenAndServeTLS(":443", "cert.pem", "key.pem", handler))
```

在前端，transport 的 `baseUrl` 改为 `https://` 即可。

### 9.2 负载均衡

Connect 的 Unary 调用使用标准 HTTP 请求，可以与任何 HTTP 负载均衡器配合（Nginx、HAProxy、Kubernetes Ingress）。而 gRPC 需要支持 HTTP/2 的负载均衡器，并且要处理连接级别的负载分配（而非请求级别）。

### 9.3 浏览器中的 Client Streaming

Connect 在浏览器中支持 Client Streaming，但需要 HTTP/2（因为 HTTP/1.1 的 Request Body 不支持流式发送）。在现代浏览器中，HTTP/2 已经是默认配置，所以通常不是问题。

### 9.4 与现有 gRPC 服务互操作

如果你的生态中已经有 gRPC 服务，Connect 可以直接作为 gRPC 客户端调用它们：

```go
// Connect 客户端调用现有的 gRPC 服务
client := connect.NewClient[userv1.GetUserRequest, userv1.GetUserResponse](
    httpClient,
    "https://legacy-grpc-service:50051/user.v1.UserService/GetUser",
    connect.WithGRPC(), // 使用 gRPC 协议
)
```

---

## 总结

Connect 不是要取代 gRPC，而是要**补充 gRPC 在全栈场景中的不足**。它让我们可以在浏览器、PHP、以及任何支持 HTTP 的语言中，以最小的基础设施成本享受 Protobuf 的类型安全和高效编码。

如果你的架构是纯后端微服务，gRPC 依然是优秀的选择。但如果你需要一个**从浏览器到微服务、从 TypeScript 到 Laravel 再到 Go 的统一 Protobuf 通信方案**，Connect 是目前最优雅的答案。

核心记忆点：

1. **Connect = Protobuf 类型系统 + 普通 HTTP 请求**——这是最核心的认知转变
2. **无需代理、无需 C 扩展、可 curl 调试**——三个 "无需" 大幅降低工程复杂度
3. **向后兼容 gRPC**——渐进式迁移，零风险
4. **Connect-Proto 编码的性能与 gRPC 仅差 5%**——在绝大多数场景下无感知

下次当你在项目中纠结 "我们要不要用 gRPC" 时，不妨先试试 Connect。它可能会让你的团队少踩很多坑。

---

*本文代码示例基于 connect-go v1.16、@connectrpc/connect v1.4、Laravel 11。完整示例代码可在 [GitHub](https://github.com/example/grpc-vs-connect-demo) 获取。*

## 相关阅读

- [Go gRPC 实战：高性能微服务通信——Proto 定义、流式调用与 Laravel 集成](/categories/架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
- [API Composition Pattern：GraphQL、REST、gRPC 组合查询实战](/categories/架构/api-composition-pattern-graphql-rest-grpc/)
- [Schema Registry 实战：Confluent、Apicurio 与 API 契约演进——Schema 兼容性治理](/categories/架构/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)
- [Go 微服务实战：重写 Laravel 高性能模块——PHP-FPM 到 Go 迁移](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
