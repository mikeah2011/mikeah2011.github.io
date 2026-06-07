# API 安全加固

## 定义

API 安全加固是一套**多层防御策略**，用于保护 API 免受未授权访问、重放攻击、数据泄露等威胁。在微服务和 B2C 场景下，单一的认证机制已不够，需要 JWT + 请求签名 + 限流 + IP 白名单等多层组合防御。

## 核心原理

### 1. 多层防御模型

```
请求 → IP 白名单/WAF → API Gateway 限流 → 请求签名验证 → JWT 认证 → 业务逻辑
  │        │                │                  │              │
  │     过滤恶意 IP      防止 DDoS          防篡改/重放     身份验证
  │
  └── TLS 加密传输（最外层）
```

### 2. 认证与授权

#### JWT（JSON Web Token）

```
Header.Payload.Signature

Header:  { "alg": "RS256", "typ": "JWT" }
Payload: { "sub": "user_id", "exp": 1717401600, "roles": ["admin"] }
Signature: RS256(base64(header) + "." + base64(payload), privateKey)
```

JWT 安全要点：
- 使用 RS256/ES256 非对称签名，避免密钥泄露
- 设置合理过期时间（15min-1h），配合 Refresh Token
- 敏感信息不要放入 Payload（base64 可解码）
- 黑名单机制：用户登出/密码修改后立即失效

#### JWT 黑名单实现

```php
// Laravel 实现
class JwtBlacklist
{
    public function revoke(string $jti, int $exp): void
    {
        $ttl = $exp - time();
        Redis::setex("jwt:blacklist:{$jti}", $ttl, '1');
    }

    public function isRevoked(string $jti): bool
    {
        return Redis::exists("jwt:blacklist:{$jti}");
    }
}
```

### 3. 请求签名防篡改

```
签名算法：
1. 将请求参数按字母排序拼接
2. 拼接 timestamp + nonce + body
3. 使用 HMAC-SHA256 签名
4. 验证 timestamp 在 5 分钟内（防重放）
5. 验证 nonce 未使用过（防重放）
```

### 4. 防重放攻击

| 机制 | 实现 | 说明 |
|------|------|------|
| **Timestamp** | 请求携带时间戳，服务端验证在 N 分钟内 | 防止过期请求重放 |
| **Nonce** | 唯一随机数，服务端记录已使用的 Nonce | 防止同时间窗口内重放 |
| **签名** | 将 Timestamp+Nonce 签名 | 防止篡改 |

### 5. IP 白名单与 WAF

- API Gateway 层配置 IP 白名单（管理接口）
- WAF 规则过滤 SQL 注入、XSS、路径遍历
- 地理围栏：限制特定区域的 API 访问

## 实战案例

来自博客文章：
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录](/2026/06/01/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [API 生命周期管理实战：设计、版本控制、废弃通知、客户端迁移——Sunset Header 与 Deprecation 标准](/2026/06/01/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/)
- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/2026/06/01/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/)

### Laravel 实践要点

1. **中间件链**：`VerifyCsrfToken → JwtAuth → RequestSignature → RateLimit → IpWhitelist`
2. **签名验证中间件**：提取 timestamp/nonce/signature，验证 HMAC
3. **Nonce 存储**：Redis SET + TTL，防止 Nonce 无限增长
4. **JWT 刷新**：Access Token 短有效期 + Refresh Token 长有效期

### API 版本管理

- **URL 路径版本**：`/api/v1/users`、`/api/v2/users`
- **Header 版本**：`Accept: application/vnd.api.v2+json`
- **Sunset Header**：`Sunset: Sat, 01 Jan 2027 00:00:00 GMT`
- **Deprecation Header**：`Deprecation: true` + Link 到迁移文档

## 相关概念

- [API 网关](API网关.md) - 安全策略通常在网关层统一实施
- [微服务架构](微服务架构.md) - 服务间认证（mTLS）与外部 API 安全
- [Zero Trust 架构](Zero-Trust架构.md) - 零信任是 API 安全的更高层抽象
- [限流与高并发](限流与高并发.md) - 限流是安全防护的第一道防线

## 常见问题

### Q: JWT vs Session Cookie 如何选择？
A: JWT 适合无状态 API、微服务间调用、跨域场景。Session 适合传统 Web 应用。B2C API 通常选 JWT + Refresh Token。

### Q: 请求签名会增加多少延迟？
A: HMAC-SHA256 计算在微秒级，可忽略。瓶颈在 Redis Nonce 查询，通常 1-2ms。

### Q: 如何处理 API 密钥泄露？
A: (1) 立即轮换密钥；(2) 检查访问日志；(3) 网关层 IP 白名单限制；(4) 监控异常请求模式。

### Q: 内部微服务间需要 API 安全吗？
A: 需要。至少使用 mTLS + Service Mesh（如 Istio）。零信任原则：内部网络不等于可信网络。
