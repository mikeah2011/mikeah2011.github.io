# API 生命周期管理

## 定义

API 生命周期管理是指**从 API 设计、发布、版本控制、监控到废弃退役**的全生命周期治理。在微服务架构中，API 数量快速增长，缺乏生命周期管理会导致版本混乱、废弃不通知、客户端迁移困难等问题。

## 核心原理

### 1. API 生命周期阶段

```
设计 → 开发 → 测试 → 发布 → 监控 → 版本演进 → 废弃通知 → 退役迁移
 │      │      │      │      │        │           │          │
 OpenAPI  CI/CD  Contract  灰度   可观测性    向后兼容    Sunset    客户端
  Spec   Pipeline Testing  发布   Metrics    Schema     Header    迁移
```

### 2. 版本控制策略

| 策略 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| **URL 路径** | `/api/v1/users` | 简单直观 | URL 膨胀 |
| **Header** | `Accept: application/vnd.api.v2+json` | URL 干净 | 客户端实现复杂 |
| **Query 参数** | `?version=2` | 简单 | 不够 RESTful |

**推荐**：URL 路径版本（v1/v2），适合 B2C API。

### 3. 废弃通知标准

#### Sunset Header（RFC 8594）

```http
HTTP/1.1 200 OK
Sunset: Sat, 01 Jan 2027 00:00:00 GMT
Deprecation: true
Link: <https://api.example.com/docs/v2-migration>; rel="deprecation"
```

- **Sunset**：API 将在指定日期后停止服务
- **Deprecation**：标记为已废弃（RFC 8594）
- **Link**：指向迁移文档

#### 废弃阶段

```
Phase 1: 标记废弃（Deprecation: true）
  └── 新客户端不应使用，现有客户端继续工作

Phase 2: 阳光期（Sunset Header）
  └── 通知最终关闭日期，建议迁移

Phase 3: 退役
  └── 返回 410 Gone 或重定向到新版本
```

### 4. Schema 兼容性管理

| 兼容性 | 规则 | 示例 |
|--------|------|------|
| **BACKWARD** | 新 Schema 能读旧数据 | 新增可选字段 |
| **FORWARD** | 旧 Schema 能读新数据 | 删除废弃字段 |
| **FULL** | 双向兼容 | 只改默认值 |

### 5. API 文档自动化

- **OpenAPI Spec**：API 描述的单一事实来源
- **Swagger UI / Redoc**：自动生成交互式文档
- **Contract Testing**：Pact/Specmatic 验证客户端与服务端契约一致
- **SDK 生成**：从 OpenAPI 自动生成客户端 SDK

## 实战案例

来自博客文章：
- [API 生命周期管理实战：设计、版本控制、废弃通知、客户端迁移——Sunset Header 与 Deprecation 标准](/2026/06/01/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/)
- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/2026/06/01/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/)
- [Schema Registry 实战：Confluent/Apicurio API 契约演进——事件驱动系统中的 Schema 兼容性治理](/2026/06/01/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)

### Laravel 实践

1. **版本路由**：`Route::prefix('v1')->group(...)` / `Route::prefix('v2')->group(...)`
2. **废弃中间件**：自动添加 Sunset/Deprecation Header
3. **API 监控**：记录已废弃端点的调用量，识别迁移进度
4. **客户端通知**：通过 Webhook/Email 通知已注册的 API 消费者

## 相关概念

- [API 安全加固](API安全加固.md) - 安全是 API 生命周期的重要环节
- [API 网关](API网关.md) - 网关统一管理版本路由和废弃策略
- [BFF 模式](BFF模式.md) - BFF 层的 API 版本管理
- [CDC 与事件流](CDC与事件流.md) - Schema Registry 管理事件 Schema 演进
- [微服务架构](微服务架构.md) - 微服务间 API 契约管理

## 常见问题

### Q: 多久应该淘汰一个 API 版本？
A: 通常 6-12 个月。关键指标：旧版本调用量降到总流量的 5% 以下。

### Q: 如何通知客户端 API 废弃？
A: (1) HTTP Header（Sunset/Deprecation）；(2) 开发者门户公告；(3) Email/Webhook 通知；(4) 日志中的 Deprecation Warning。

### Q: 向后兼容 vs 破坏性变更如何判断？
A: 新增可选字段 = 向后兼容。删除字段、修改类型、改变语义 = 破坏性变更，需要新版本。

### Q: 内部 API 需要版本管理吗？
A: 需要。内部 API 也有多个消费者（微服务），版本混乱会导致连锁故障。
