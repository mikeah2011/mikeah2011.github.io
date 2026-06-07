# Web 服务器选型

## 定义

Web 服务器是处理 HTTP 请求、反向代理和静态资源服务的基础设施软件。Nginx 长期统治这一领域，但 Caddy 2 作为用 Go 编写的现代 Web 服务器，凭借"自动 HTTPS 零配置"和声明式 API 正在成为替代方案。在 Laravel 应用部署中，Web 服务器的选择直接影响 SSL 管理成本、配置复杂度和运维效率。

## 核心对比

### Nginx
- **语言**：C
- **配置**：声明式 `nginx.conf`，语法复杂但功能强大
- **SSL**：需要手动配置 Let's Encrypt + Certbot + cron 续期
- **生态**：模块丰富（Lua/Stream/RTMP）、社区庞大
- **性能**：事件驱动模型，单机 10 万级并发

### Caddy 2
- **语言**：Go
- **配置**：极简 Caddyfile 或 JSON API，支持运行时热更新
- **SSL**：全自动 HTTPS（Zero-Config），自动申请/续期证书
- **生态**：插件生态较小但核心功能齐全
- **性能**：与 Nginx 相当，某些场景下略低

### 配置对比示例

**Nginx 配置 Laravel：**
```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /var/www/b2c-api/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

**Caddy 配置 Laravel（等效功能）：**
```
api.example.com {
    root * /var/www/b2c-api/public
    php_fastcgi unix//run/php/php8.3-fpm.sock
    file_server
}
```

> 注意：Caddy 自动处理了 SSL 证书申请、续期、HTTP→HTTPS 重定向、HTTP/2、OCSP Stapling，无需任何额外配置。

## 自动 HTTPS 工作原理

Caddy 内置 ACME 客户端，首次收到域名请求时：
1. 自动生成私钥和 CSR
2. 通过 ACME 协议（Let's Encrypt / ZeroSSL）申请证书
3. 通过 TLS-ALPN 或 HTTP Challenge 完成域名验证
4. 自动续期（默认在到期前 30 天）
5. OCSP Stapling 自动管理

### 配置内部/本地域名
对于内网域名或开发环境，Caddy 可以使用内部 CA 签发证书：

```
# 内网域名 - 使用内部 CA
internal-api.local {
    tls internal
    reverse_proxy app:8080
}

# 开发环境 - 自签名
localhost {
    reverse_proxy app:8080
}
```

## 反向代理高级功能

### 负载均衡
```
api.example.com {
    reverse_proxy web-01:8080 web-02:8080 web-03:8080 {
        lb_policy round_robin
        health_path /health
        health_interval 10s
    }
}
```

### 请求限流与熔断
Caddy 通过插件支持速率限制。对于更复杂的需求，可以搭配 Laravel 应用层限流。

### Docker/K8s 集成
Caddy 的 JSON API 支持运行时动态配置，非常适合容器环境：

```bash
# 通过 API 动态添加站点
curl -X POST http://localhost:2019/config/apps/http/servers/srv0/routes \
  -H "Content-Type: application/json" \
  -d '{"match": [{"host": ["new.example.com"]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "app:8080"}]}]}'
```

## 选型建议

| 场景 | 推荐 | 原因 |
|---|---|---|
| 新项目 / 小团队 | Caddy 2 | 零配置 HTTPS，运维成本最低 |
| 已有 Nginx 技术栈 | Nginx | 迁移成本高，Nginx 功能更成熟 |
| 需要 Lua 脚本 / 复杂逻辑 | Nginx | Caddy 无 Lua 支持 |
| 容器 / K8s 环境 | Caddy 2 | 动态 API、自动 HTTPS 优势明显 |
| 高并发 / 极致性能 | Nginx | 多年优化积累，社区支持 |

## 实战案例

来自博客文章：
- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署](/2026/06/02/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/) — 完整的 Caddy vs Nginx 对比与 Laravel 部署方案

## 相关概念

- [Docker 容器化](Docker容器化.md) — Web 服务器在容器中的部署
- [云部署平台选型](云部署平台选型.md) — PaaS 内置的 Web 服务器选择
- [Prometheus 监控告警](Prometheus监控告警.md) — Web 服务器指标的采集与监控

## 常见问题

### Caddy 证书申请失败
- 检查域名 DNS 是否正确解析到服务器
- 确认 80 端口未被防火墙阻断（HTTP Challenge 需要）
- 使用 `tls internal` 跳过公网证书申请

### Nginx 到 Caddy 迁移
- 使用 `caddy adapt` 将 Caddyfile 转为 JSON，检查配置完整性
- 先在非生产环境验证所有路由规则
- Caddy 的 `php_fastcgi` 指令等效于 Nginx 的 `location ~ \.php$` 块
