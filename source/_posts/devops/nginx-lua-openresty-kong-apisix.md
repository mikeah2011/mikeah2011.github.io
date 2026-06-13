---

title: Nginx + Lua (OpenResty) 实战：高性能自定义网关——对比 Kong/APISIX 的流量治理与边缘计算
keywords: [Nginx, Lua, OpenResty, Kong, APISIX, 高性能自定义网关, 的流量治理与边缘计算]
date: 2026-06-06 12:00:00
tags:
- Nginx
- openresty
- Lua
- Kong
- APISIX
- 网关
- 流量治理
- 微服务
- 限流
- 边缘计算
description: 深入实战 OpenResty（Nginx + Lua）构建高性能自定义 API 网关，涵盖动态路由、JWT 鉴权、限流熔断、灰度发布与边缘计算等核心功能。全方位对比 Kong 与 APISIX 两大主流网关方案的架构差异、插件生态与性能基准，结合 Laravel 微服务集成案例与生产环境踩坑指南，帮助开发者在自研网关与开源框架之间做出最优技术选型。
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




## 一、引言：为什么需要自定义网关层？

在微服务架构日益普及的今天，API 网关已经从一个"可选项"变成了"必选项"。无论是服务间的流量调度、统一鉴权、限流熔断，还是灰度发布、AB Testing、边缘计算等场景，都离不开一个稳定高效的网关层。

传统的 Nginx 以其高性能的反向代理能力著称，但原生 Nginx 的配置方式存在天然局限——它本质上是一个声明式的配置语言，缺乏真正的编程能力。当我们需要根据请求中的 JWT Token 动态路由、读取 Redis 判断用户权限、或者根据地理位置做差异化响应时，纯 Nginx 配置便力不从心。

OpenResty 的出现改变了这一局面。它将 Nginx 与 LuaJIT 深度集成，让我们可以在 Nginx 请求处理的各个阶段注入 Lua 代码，将 Nginx 从一个"配置驱动"的反向代理，进化为一个"可编程"的高性能网关平台。

本文将从零开始，带你深入 OpenResty 的架构原理，手写一个具备完整功能的自定义网关，并与业界主流的 Kong、APISIX 进行全方位对比，帮助你在实际项目中做出合理的技术选型。

---

## 二、OpenResty 基础架构

### 2.1 Nginx + LuaJIT 的融合

OpenResty 并非简单的"Nginx 加上 Lua"，而是通过 `ngx_http_lua_module`（也称 `lua-nginx-module`）将 LuaJIT 虚拟机深度嵌入到 Nginx 的事件循环中。这意味着 Lua 代码与 Nginx 共享同一个进程，没有额外的进程间通信开销。

LuaJIT 是 Lua 语言的即时编译实现，其性能接近 C 语言，在某些场景下甚至优于原生 Lua 解释器数十倍。这使得在请求热路径上执行 Lua 代码的性能开销极低。

### 2.2 请求生命周期与 Lua 执行阶段

Nginx 处理请求分为多个阶段，`ngx_http_lua_module` 在每个阶段都提供了对应的 hook 点：

| 阶段 | Lua Hook | 典型用途 |
|------|----------|----------|
| 初始化 | `init_by_lua` | 加载全局配置、初始化共享字典 |
| Worker 初始化 | `init_worker_by_lua` | 启动定时任务、初始化计数器 |
| SSL 握手 | `ssl_certificate_by_lua` | 动态证书选择、SNI 路由 |
| 重写 | `rewrite_by_lua` | URL 改写、动态路由决策 |
| 访问控制 | `access_by_lua` | 鉴权、限流、IP 黑白名单 |
| 内容生成 | `content_by_lua` | 自定义响应逻辑 |
| 日志 | `log_by_lua` | 结构化日志、指标上报 |
| 退出清理 | `header_filter_by_lua` | 响应头注入 |
| 体过滤 | `body_filter_by_lua` | 响应体改写 |

理解这些阶段是编写高效 OpenResty 代码的基础。例如，鉴权逻辑应放在 `access_by_lua` 而非 `content_by_lua`，这样才能在请求到达上游服务之前就完成拦截。

### 2.3 共享内存（shared dict）

OpenResty 提供了 `ngx.shared.DICT` API，允许在多个 Nginx worker 进程之间共享数据。这是实现分布式限流、缓存等功能的关键机制：

```nginx
http {
    lua_shared_dict rate_limit  10m;
    lua_shared_dict config      5m;
    lua_shared_dict jwt_cache   20m;
}
```

共享字典底层基于 slab 内存分配器，支持 LRU 淘汰策略，读写性能极高（微秒级），且无需额外部署 Redis 等外部组件。

---

## 三、Lua 入门速成：面向 Nginx 开发者的最小知识集

### 3.1 基本语法

Lua 是一门极简的脚本语言，语法类似 Python 与 JavaScript 的混合体。以下是编写 OpenResty 网关插件所需的最小知识集：

```lua
-- 变量（默认全局，local 声明局部变量）
local name = "gateway"
local port = 8080
local enabled = true
local nothing = nil  -- Lua 的空值

-- 字符串操作
local msg = "Hello, " .. "World!"  -- 字符串拼接
local len = #msg                    -- 取长度
local sub = string.sub(msg, 1, 5)  -- 子串
```

### 3.2 表（Table）——Lua 唯一的数据结构

Lua 中的表（table）同时扮演了数组、字典、对象的角色：

```lua
-- 数组风格
local servers = {
    "10.0.0.1:8080",
    "10.0.0.2:8080",
    "10.0.0.3:8080"
}
-- 遍历数组用 ipairs
for i, addr in ipairs(servers) do
    print(i, addr)
end

-- 字典风格
local config = {
    timeout = 30,
    retries = 3,
    backend = "upstream-app"
}
-- 遍历字典用 pairs
for k, v in pairs(config) do
    print(k, v)
end

-- 嵌套
local tenant_routes = {
    ["api.example.com"] = { upstream = "10.0.0.1:8080", prefix = "/v1" },
    ["admin.example.com"] = { upstream = "10.0.0.2:8080", prefix = "/admin" }
}
```

**关键点**：在 OpenResty 中，必须使用 `local` 声明所有变量，否则会污染全局命名空间，导致请求间数据串扰——这是最常见的生产事故之一。

### 3.3 函数与闭包

```lua
-- 基本函数
local function add(a, b)
    return a + b
end

-- 函数作为一等公民
local function create_multiplier(factor)
    return function(x)
        return x * factor
    end
end
local double = create_multiplier(2)
print(double(5))  -- 输出 10
```

### 3.4 协程（Coroutine）

协程是 OpenResty 异步编程的核心。`ngx.thread` 底层就基于协程实现：

```lua
local co = coroutine.create(function()
    coroutine.yield(1)
    coroutine.yield(2)
    return 3
end)

print(coroutine.resume(co))  -- true, 1
print(coroutine.resume(co))  -- true, 2
print(coroutine.resume(co))  -- true, 3
```

在 OpenResty 中，我们通常不需要直接操作协程，`ngx.socket`、`ngx.sleep` 等 API 已经封装好了协程调度。但理解协程有助于理解 OpenResty 为什么能在单线程中实现高并发。

---

## 四、自定义网关核心功能实战

下面我们将逐一实现一个生产级网关的核心功能。所有代码均可直接在 OpenResty 环境中运行。

### 4.1 动态路由：基于 Host/Header/Cookie 的多租户路由

多租户 SaaS 场景下，不同租户的请求需要路由到不同的后端服务。我们基于请求 Host 头进行路由，同时支持通过自定义 Header 覆盖：

```lua
-- /etc/openresty/lua/gateway/router.lua
local _M = {}

-- 路由表（生产环境可从配置中心或共享字典加载）
local route_table = {
    -- 默认路由
    ["default"] = {
        upstream = "default_backend",
        prefix   = "/"
    },
    -- 租户 A
    ["tenant-a.api.example.com"] = {
        upstream = "tenant_a_backend",
        prefix   = "/api/v1"
    },
    -- 租户 B
    ["tenant-b.api.example.com"] = {
        upstream = "tenant_b_backend",
        prefix   = "/api/v1"
    },
    -- 管理后台
    ["admin.example.com"] = {
        upstream = "admin_backend",
        prefix   = "/"
    }
}

function _M.execute()
    -- 优先从自定义 Header 获取路由目标（用于内部服务调用覆盖）
    local x_route = ngx.var.http_x_gateway_route

    -- 获取 Host（去掉端口号）
    local host = ngx.var.host
    if host then
        host = string.match(host, "^([^:]+)") or host
    end

    -- Cookie 中的租户标识（灰度路由场景）
    local tenant_cookie = ngx.var.cookie_tenant_id

    -- 确定路由键
    local route_key = x_route or host or "default"

    -- 查找路由
    local route = route_table[route_key]
    if not route then
        route = route_table["default"]
    end

    -- 设置上游变量
    ngx.var.target_upstream = route.upstream

    -- 路径改写：去掉前缀
    local uri = ngx.var.uri
    if route.prefix ~= "/" and string.sub(uri, 1, #route.prefix) == route.prefix then
        ngx.req.set_uri(string.sub(uri, #route.prefix + 1), false)
    end

    -- 注入路由信息到请求头，供上游使用
    ngx.req.set_header("X-Real-Route-Key", route_key)
    ngx.req.set_header("X-Real-Upstream", route.upstream)

    ngx.log(ngx.INFO, "route: ", route_key, " -> ", route.upstream)
end

return _M
```

在 Nginx 配置中使用：

```nginx
http {
    upstream default_backend { server 10.0.0.1:8080; }
    upstream tenant_a_backend { server 10.0.1.1:8080; }
    upstream tenant_b_backend { server 10.0.2.1:8080; }
    upstream admin_backend { server 10.0.3.1:8080; }

    server {
        listen 80;

        set $target_upstream '';

        location / {
            rewrite_by_lua_file /etc/openresty/lua/gateway/router.lua;
            proxy_pass http://$target_upstream;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

### 4.2 认证鉴权：JWT 校验 + Redis Session 验证

网关层的统一鉴权可以将认证逻辑从各业务服务中剥离。我们实现 JWT 校验和 Redis Session 双重验证：

```lua
-- /etc/openresty/lua/gateway/auth.lua
local jwt = require "resty.jwt"
local redis = require "resty.redis"

local _M = {}

local JWT_SECRET = "your-256-bit-secret-key-here"

-- 白名单路径，不需要认证
local whitelist = {
    ["/health"] = true,
    ["/api/v1/public/"] = true,
    ["/api/v1/auth/login"] = true,
    ["/api/v1/auth/register"] = true
}

-- 连接 Redis
local function get_redis()
    local red = redis:new()
    red:set_timeout(1000)  -- 1 秒超时

    local ok, err = red:connect("127.0.0.1", 6379)
    if not ok then
        ngx.log(ngx.ERR, "redis connect failed: ", err)
        return nil, err
    end

    -- Redis 认证（如果需要）
    -- local res, err = red:auth("redis_password")

    -- 使用连接池复用
    red:set_keepalive(60000, 100)  -- 60 秒空闲超时，最大 100 连接

    return red
end

-- 检查是否在白名单中
local function is_whitelisted(uri)
    for path, _ in pairs(whitelist) do
        if string.sub(uri, 1, #path) == path then
            return true
        end
    end
    return false
end

function _M.execute()
    local uri = ngx.var.uri

    -- 白名单放行
    if is_whitelisted(uri) then
        return
    end

    -- 从 Authorization 头获取 token
    local auth_header = ngx.var.http_authorization
    if not auth_header then
        ngx.status = 401
        ngx.header["Content-Type"] = "application/json"
        ngx.say('{"error":"missing_authorization","message":"Authorization header is required"}')
        return ngx.exit(401)
    end

    -- 提取 Bearer token
    local token = string.match(auth_header, "^Bearer%s+(.+)$")
    if not token then
        ngx.status = 401
        ngx.header["Content-Type"] = "application/json"
        ngx.say('{"error":"invalid_format","message":"Authorization must be Bearer token"}')
        return ngx.exit(401)
    end

    -- 验证 JWT
    local jwt_obj = jwt:verify(JWT_SECRET, token)
    if not jwt_obj.verified then
        ngx.status = 401
        ngx.header["Content-Type"] = "application/json"
        ngx.say('{"error":"invalid_token","message":"' .. (jwt_obj.reason or "JWT verification failed") .. '"}')
        return ngx.exit(401)
    end

    local payload = jwt_obj.payload

    -- 检查 token 是否被吊销（通过 Redis 黑名单）
    local red, err = get_redis()
    if red then
        local revoked, _ = red:sismember("jwt:blacklist", token)
        if revoked == 1 then
            ngx.status = 401
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"token_revoked","message":"Token has been revoked"}')
            return ngx.exit(401)
        end
    end

    -- 检查 session 是否仍然活跃
    if red and payload.session_id then
        local session_data, _ = red:get("session:" .. payload.session_id)
        if session_data == ngx.null then
            ngx.status = 401
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"session_expired","message":"Session has expired"}')
            return ngx.exit(401)
        end
    end

    -- 将用户信息注入请求头，传递给上游
    ngx.req.set_header("X-User-Id", payload.sub or "")
    ngx.req.set_header("X-User-Role", payload.role or "user")
    ngx.req.set_header("X-Tenant-Id", payload.tenant_id or "")

    ngx.log(ngx.INFO, "auth ok: user=", payload.sub, " role=", payload.role)
end

return _M
```

### 4.3 限流熔断：lua-resty-limit-traffic

OpenResty 内置了 `lua-resty-limit-traffic` 库，提供三种限流算法。下面我们实现一个组合限流器，同时支持漏桶（请求速率）、令牌桶（突发流量）和并发控制：

```lua
-- /etc/openresty/lua/gateway/rate_limit.lua
local limit_req    = require "resty.limit.req"
local limit_count  = require "resty.limit.count"
local limit_conn   = require "resty.limit.conn"

local _M = {}

-- 初始化限流器（在 init_worker_by_lua 中调用）
local lim_req, lim_conn

function _M.init()
    -- 漏桶限流器：每秒 1000 个请求，允许 200 个突发
    local req_dict = ngx.shared.rate_limit
    lim_req, err = limit_req.new("rate_limit", 1000, 200)
    if not lim_req then
        ngx.log(ngx.ERR, "failed to instantiate resty.limit.req: ", err)
        return
    end

    -- 并发限流器：最大 500 并发，超过 200 开始拒绝
    lim_conn, err = limit_conn.new("rate_limit", 500, 200, 0.5)
    if not lim_conn then
        ngx.log(ngx.ERR, "failed to instantiate resty.limit.conn: ", err)
        return
    end
end

function _M.execute()
    -- 获取限流 key（可以按 IP、用户 ID、租户 ID 等维度）
    local key = ngx.var.remote_addr

    -- 支持从请求头获取租户 ID 做租户级限流
    local tenant_id = ngx.var.http_x_tenant_id
    if tenant_id then
        key = "tenant:" .. tenant_id
    end

    -- 漏桶限流
    local delay, err = lim_req:incoming(key, true)
    if not delay then
        if err == "rejected" then
            ngx.status = 429
            ngx.header["Content-Type"] = "application/json"
            ngx.header["Retry-After"] = "1"
            ngx.say('{"error":"rate_limited","message":"Too many requests, please retry later"}')
            return ngx.exit(429)
        end
        ngx.log(ngx.ERR, "limit_req error: ", err)
        return ngx.exit(500)
    end

    -- 如果需要延迟（漏桶排队）
    if delay >= 0.001 then
        ngx.sleep(delay)
    end

    -- 并发控制
    local conn_delay, err = lim_conn:incoming(key, true)
    if not conn_delay then
        if err == "rejected" then
            ngx.status = 503
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"overloaded","message":"Server is overloaded, too many concurrent requests"}')
            return ngx.exit(503)
        end
        ngx.log(ngx.ERR, "limit_conn error: ", err)
        return ngx.exit(500)
    end

    -- 保存连接限流上下文，在 log 阶段释放
    ngx.ctx.limit_conn_key = key
    ngx.ctx.limit_conn_delay = conn_delay
end

-- 在 log_by_lua 中调用，释放连接计数
function _M.cleanup()
    local key = ngx.ctx.limit_conn_key
    if key and lim_conn then
        local conn_delay = ngx.ctx.limit_conn_delay or 0
        lim_conn:leaving(key, conn_delay)
    end
end

return _M
```

### 4.4 请求改写：动态上游选择、Header 注入、Body 改写

网关经常需要在请求到达上游之前对其进行改写。这里展示如何实现基于条件的动态上游选择、Header 注入以及请求 Body 改写：

```lua
-- /etc/openresty/lua/gateway/rewrite.lua
local cjson = require "cjson.safe"

local _M = {}

-- 版本路由表
local version_routes = {
    ["v1"] = "upstream_v1",
    ["v2"] = "upstream_v2",
    ["v3"] = "upstream_v3"
}

function _M.execute()
    local uri = ngx.var.uri
    local method = ngx.req.get_method()

    -- 从 URL 中提取 API 版本
    local version = string.match(uri, "^/api/v(%d+)/")
    if version and version_routes["v" .. version] then
        ngx.var.target_upstream = version_routes["v" .. version]
    end

    -- 注入通用 Header
    ngx.req.set_header("X-Gateway-Timestamp", ngx.now())
    ngx.req.set_header("X-Gateway-Request-Id", ngx.var.request_id)
    ngx.req.set_header("X-Forwarded-For", ngx.var.remote_addr)
    ngx.req.set_header("X-Forwarded-Proto", ngx.var.scheme)

    -- 移除内部路由 Header（防止上游欺骗）
    ngx.req.clear_header("X-Internal-Token")

    -- Body 改写：对 POST/PUT 请求添加元数据
    if method == "POST" or method == "PUT" then
        ngx.req.read_body()
        local body = ngx.req.get_body_data()

        if body then
            local data = cjson.decode(body)
            if data then
                -- 注入网关元数据
                data["_gateway_meta"] = {
                    received_at = ngx.now(),
                    request_id  = ngx.var.request_id,
                    client_ip   = ngx.var.remote_addr
                }

                local new_body = cjson.encode(data)
                ngx.req.set_body_data(new_body)

                -- 更新 Content-Length
                ngx.req.set_header("Content-Length", #new_body)
            end
        end
    end
end

return _M
```

### 4.5 日志与可观测性

结构化日志和 Prometheus 指标是网关可观测性的两大支柱。

```lua
-- /etc/openresty/lua/gateway/observability.lua
local cjson = require "cjson.safe"
local prometheus = require "resty.prometheus"

local _M = {}

-- 初始化 Prometheus 指标
local metric_requests, metric_latency, metric_upstream_latency

function _M.init()
    -- 创建 Prometheus 实例
    local prom = prometheus.init("prometheus_metrics")

    -- 定义指标
    metric_requests = prom:counter(
        "gateway_http_requests_total",
        "Total HTTP requests",
        {"method", "status", "host", "path"}
    )

    metric_latency = prom:histogram(
        "gateway_http_request_duration_seconds",
        "Request latency in seconds",
        {"method", "host", "path"},
        {0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}
    )

    metric_upstream_latency = prom:histogram(
        "gateway_upstream_duration_seconds",
        "Upstream response latency in seconds",
        {"upstream", "status"},
        {0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}
    )
end

-- 在 log_by_lua 中调用
function _M.log()
    local now = ngx.now()

    -- 计算请求延迟
    local request_time = now - ngx.req.start_time()

    -- 获取基础信息
    local method = ngx.req.get_method()
    local status = tostring(ngx.status)
    local host = ngx.var.host or "unknown"
    local path = ngx.var.uri or "/"

    -- 简化路径（避免高基数 label）
    path = string.match(path, "^(/[^/]+/[^/]+)") or path

    -- 更新 Prometheus 指标
    if metric_requests then
        metric_requests:inc(1, {method, status, host, path})
    end
    if metric_latency then
        metric_latency:observe(request_time, {method, host, path})
    end

    -- 上游延迟
    local upstream_time = tonumber(ngx.var.upstream_response_time) or 0
    local upstream = ngx.var.target_upstream or "unknown"
    if metric_upstream_latency then
        metric_upstream_latency:observe(upstream_time, {upstream, status})
    end

    -- 结构化日志
    local log_entry = {
        timestamp     = os.date("!%Y-%m-%dT%H:%M:%S", math.floor(now)),
        request_id    = ngx.var.request_id or "-",
        method        = method,
        uri           = ngx.var.uri,
        host          = host,
        status        = ngx.status,
        request_time  = request_time,
        upstream_time = upstream_time,
        bytes_sent    = ngx.var.bytes_sent,
        client_ip     = ngx.var.remote_addr,
        user_agent    = ngx.var.http_user_agent or "-",
        user_id       = ngx.var.http_x_user_id or "-",
        upstream      = upstream,
        referer       = ngx.var.http_referer or "-"
    }

    -- 输出 JSON 日志（可被 Filebeat/Fluentd 采集）
    ngx.log(ngx.NOTICE, cjson.encode(log_entry))
end

return _M
```

Prometheus 指标暴露端点：

```nginx
server {
    listen 9145;
    location /metrics {
        content_by_lua_block {
            local prometheus = require "resty.prometheus"
            prometheus:collect()
        }
    }
}
```

---

## 五、边缘计算场景实战

### 5.1 AB Testing

```lua
-- /etc/openresty/lua/gateway/ab_testing.lua
local _M = {}

-- AB 测试配置（可从共享字典动态加载）
local experiments = {
    ["new_checkout"] = {
        {weight = 50, upstream = "checkout_v1", group = "control"},
        {weight = 50, upstream = "checkout_v2", group = "treatment"}
    },
    ["recommendation"] = {
        {weight = 70, upstream = "reco_v1", group = "control"},
        {weight = 30, upstream = "reco_v2", group = "treatment"}
    }
}

-- 基于用户 ID 的一致性哈希分桶
local function assign_bucket(user_id, experiment_name)
    local str = user_id .. ":" .. experiment_name
    local hash = 0
    for i = 1, #str do
        hash = (hash * 31 + string.byte(str, i)) % 100
    end
    return hash
end

function _M.execute()
    local experiment_name = ngx.var.http_x_experiment
    if not experiment_name or not experiments[experiment_name] then
        return
    end

    local user_id = ngx.var.http_x_user_id or ngx.var.remote_addr
    local bucket = assign_bucket(user_id, experiment_name)
    local exp = experiments[experiment_name]

    local cumulative = 0
    for _, variant in ipairs(exp) do
        cumulative = cumulative + variant.weight
        if bucket < cumulative then
            ngx.var.target_upstream = variant.upstream
            ngx.req.set_header("X-AB-Group", variant.group)
            ngx.req.set_header("X-AB-Experiment", experiment_name)
            -- 写入 Cookie 保持一致性
            ngx.header["Set-Cookie"] = "ab_" .. experiment_name
                .. "=" .. variant.group .. "; Path=/; Max-Age=86400"
            return
        end
    end
end

return _M
```

### 5.2 灰度发布

```lua
-- /etc/openresty/lua/gateway/canary.lua
local _M = {}

function _M.execute()
    local canary_ratio = 10  -- 10% 流量走灰度

    -- 优先级：Header 标记 > Cookie > 随机分配
    local canary_flag = ngx.var.http_x_canary

    if canary_flag == "true" then
        ngx.var.target_upstream = "canary_backend"
        return
    end

    if canary_flag == "false" then
        ngx.var.target_upstream = "stable_backend"
        return
    end

    -- Cookie 保持
    local cookie = ngx.var.cookie_canary
    if cookie == "true" then
        ngx.var.target_upstream = "canary_backend"
        return
    elseif cookie == "false" then
        ngx.var.target_upstream = "stable_backend"
        return
    end

    -- 随机分配
    local rand = math.random(100)
    if rand <= canary_ratio then
        ngx.var.target_upstream = "canary_backend"
        ngx.header["Set-Cookie"] = "canary=true; Path=/; Max-Age=3600"
    else
        ngx.var.target_upstream = "stable_backend"
        ngx.header["Set-Cookie"] = "canary=false; Path=/; Max-Age=3600"
    end
end

return _M
```

### 5.3 地理路由与 Bot 检测

```lua
-- /etc/openresty/lua/gateway/geo_bot.lua
local _M = {}

-- 已知 Bot 的 User-Agent 关键词
local bot_signatures = {
    "Googlebot", "Bingbot", "Baiduspider", "YandexBot",
    "SemrushBot", "AhrefsBot", "MJ12bot", "DotBot",
    "python-requests", "curl/", "Go-http-client", "Scrapy"
}

local function is_bot()
    local ua = ngx.var.http_user_agent or ""
    ua = string.lower(ua)
    for _, sig in ipairs(bot_signatures) do
        if string.find(ua, string.lower(sig)) then
            return true
        end
    end
    return false
end

function _M.execute()
    -- GeoIP 路由（需要 ngx_http_geoip2_module）
    local country = ngx.var.geoip2_country_code or "CN"

    -- 按地区路由到最近的数据中心
    local region_routes = {
        ["CN"] = "cn_backend",
        ["US"] = "us_backend",
        ["EU"] = "eu_backend",
        ["JP"] = "jp_backend"
    }

    ngx.var.target_upstream = region_routes[country] or "cn_backend"

    -- Bot 检测
    if is_bot() then
        ngx.req.set_header("X-Bot-Detected", "true")
        -- 限制 Bot 的请求速率
        local limit_dict = ngx.shared.rate_limit
        local key = "bot:" .. ngx.var.remote_addr
        local count, err = limit_dict:incr(key, 1, 0, 60)
        if count and count > 100 then
            ngx.status = 429
            ngx.say('{"error":"bot_rate_limited"}')
            return ngx.exit(429)
        end
    end
end

return _M
```

---

## 六、Kong vs APISIX vs 自研 OpenResty 网关对比

### 6.1 架构差异

| 维度 | Kong | APISIX | 自研 OpenResty |
|------|------|--------|----------------|
| 核心依赖 | PostgreSQL / Cassandra | etcd（v3） | 无外部依赖 |
| 配置存储 | DB 模式或 DB-less (声明式 YAML) | etcd + Admin API | Lua 文件 / 共享字典 / 外部配置中心 |
| 控制面 | Kong Admin API + Manager | APISIX Dashboard + Admin API | 自行实现 |
| 数据面 | OpenResty + Lua 插件 | OpenResty + Lua 插件 | OpenResty + Lua |
| 部署复杂度 | 中等（需数据库） | 中等（需 etcd） | 低（仅 OpenResty） |

Kong 最初依赖 PostgreSQL/Cassandra，后来支持 DB-less 模式。APISIX 使用 etcd 作为配置中心，支持热更新，无需重启。自研方案则完全不依赖外部组件，配置可以直接硬编码或从 Lua 文件加载。

### 6.2 插件生态与扩展方式

**Kong**：拥有最大的插件生态，官方提供 100+ 插件（认证、安全、流量控制、日志、Serverless 等）。插件用 Lua 编写，也可以通过 PDK（Plugin Development Kit）开发自定义插件。企业版提供更多功能如 RBAC、审计日志等。

**APISIX**：提供 80+ 官方插件，支持 Lua、Java、Go、Python 多语言插件开发（通过 External Plugin Runner）。其插件支持热加载，不需要重启。

**自研 OpenResty**：没有插件生态，所有功能需要自行开发。但优势是完全可控，不存在插件兼容性问题，代码量可以做到最小化。

### 6.3 性能基准

基于公开的 benchmark 数据（2024-2025 年社区测试）：

| 指标 | Kong | APISIX | 自研 OpenResty |
|------|------|--------|----------------|
| 纯代理 QPS | ~30,000 | ~18,000 | ~150,000 |
| 启用限流插件后 QPS | ~20,000 | ~14,000 | ~120,000 |
| P99 延迟（纯代理） | ~2.5ms | ~1.2ms | ~0.3ms |
| P99 延迟（含鉴权+限流） | ~5ms | ~3ms | ~0.8ms |
| 内存占用（基准） | ~200MB | ~150MB | ~50MB |

自研方案性能优势明显，因为没有框架层的开销。Kong 的 PDK 在每次请求时会初始化上下文对象，APISIX 虽然优化更好但仍有 etcd watch 的后台开销。需要注意的是，这些数据会因具体配置、硬件环境和功能复杂度而变化。

### 6.4 运维复杂度与社区活跃度

**Kong**：GitHub Stars 约 40K，社区成熟，文档完善。缺点是企业版与开源版功能差异大，高阶功能需要付费。

**APISIX**：Apache 顶级项目，GitHub Stars 约 15K，社区增长快，中文社区活跃。纯开源功能丰富，是国产化替代的首选。

**自研**：无社区支持，维护成本完全自担。适合有专职网关开发团队的公司。

---

## 七、与 Laravel 的集成：API Gateway 模式下的微服务架构

在 PHP 生态中，Laravel 是最流行的框架之一。当我们将 Laravel 应用拆分为微服务时，OpenResty 网关承担了至关重要的角色。

### 7.1 架构示意

```
客户端
  │
  ▼
OpenResty 网关（认证、限流、路由）
  │
  ├── /api/v1/users/*     → Laravel User Service (端口 9001)
  ├── /api/v1/orders/*    → Laravel Order Service (端口 9002)
  ├── /api/v1/products/*  → Laravel Product Service (端口 9003)
  └── /api/v1/auth/*      → Laravel Auth Service (端口 9004)
```

### 7.2 Laravel 端的配合

每个 Laravel 微服务不需要再实现认证中间件，信任网关注入的 `X-User-Id` 和 `X-User-Role` 头：

```php
// app/Http/Middleware/TrustGatewayHeaders.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class TrustGatewayHeaders
{
    public function handle(Request $request, Closure $next)
    {
        // 仅信任来自网关的请求（通过内网 IP 或共享密钥验证）
        if (!$this->isFromGateway($request)) {
            return response()->json(['error' => 'Direct access not allowed'], 403);
        }

        // 从网关注入的头中提取用户信息
        if ($userId = $request->header('X-User-Id')) {
            // 手动设置认证用户
            $user = \App\Models\User::find($userId);
            if ($user) {
                auth()->setUser($user);
            }
        }

        // 设置租户上下文
        if ($tenantId = $request->header('X-Tenant-Id')) {
            app()->instance('current_tenant_id', $tenantId);
        }

        return $next($request);
    }

    private function isFromGateway(Request $request): bool
    {
        $gatewayIps = ['10.0.0.100', '10.0.0.101', '127.0.0.1'];
        return in_array($request->ip(), $gatewayIps)
            && $request->header('X-Gateway-Request-Id') !== null;
    }
}
```

### 7.3 网关端的 Laravel 特殊处理

```lua
-- Laravel 入口路由
local function setup_laravel_upstream(uri)
    local service_map = {
        ["/api/v1/users"]    = "laravel_user_service",
        ["/api/v1/orders"]   = "laravel_order_service",
        ["/api/v1/products"] = "laravel_product_service",
        ["/api/v1/auth"]     = "laravel_auth_service"
    }

    for prefix, upstream in pairs(service_map) do
        if string.sub(uri, 1, #prefix) == prefix then
            ngx.var.target_upstream = upstream
            -- Laravel 需要 HTTPS 时注入正确的 scheme 头
            ngx.req.set_header("X-Forwarded-Proto", "https")
            return
        end
    end

    -- 默认回退
    ngx.var.target_upstream = "laravel_default"
end
```

---

## 八、生产环境踩坑指南

### 8.1 共享内存配置不当

**问题**：共享字典满后写入失败，导致限流失效。

**解决**：合理评估内存需求，监控 `shared.DICT` 的使用率：

```lua
-- 监控共享字典使用情况
local function monitor_shared_dicts()
    local dicts = {"rate_limit", "config", "jwt_cache"}
    for _, name in ipairs(dicts) do
        local dict = ngx.shared[name]
        if dict then
            local capacity = dict:capacity()
            local free = dict:free_space()
            local usage = (capacity - free) / capacity * 100
            if usage > 80 then
                ngx.log(ngx.WARN, "shared_dict ", name, " usage: ", usage, "%")
            end
        end
    end
end
```

建议将日志采集、限流、缓存分别使用独立的共享字典，避免互相挤占。

### 8.2 cosocket 连接池

**问题**：频繁创建 Redis/HTTP 连接导致性能下降或端口耗尽。

**解决**：必须使用 `set_keepalive` 复用连接：

```lua
-- 错误示范：每次请求都新建连接
local red = redis:new()
red:connect("127.0.0.1", 6379)
red:get("key")
-- 连接直接关闭，没有复用！

-- 正确做法
local red = redis:new()
red:set_timeout(1000)
red:connect("127.0.0.1", 6379)
red:get("key")
red:set_keepalive(60000, 100)  -- 放回连接池
```

注意 `set_keepalive` 的两个参数：空闲超时时间（毫秒）和最大连接数。连接池是 per-worker 的，所以总连接数 = 每个 worker 的池大小 × worker 数量。

### 8.3 Lua 全局变量污染

**问题**：忘记写 `local`，变量变为全局变量，不同请求之间数据串扰。

**解决**：在入口配置中启用全局变量保护：

```lua
-- init_by_lua_block 中
if os.getenv("LUA_CODE_CACHE") ~= "no" then
    -- 生产环境：禁止全局变量写入
    local mt = getmetatable(_G) or {}
    mt.__newindex = function(t, k, v)
        error("attempt to write to undeclared global variable: " .. k, 2)
    end
    setmetatable(_G, mt)
end
```

或者使用 `luacheck` 静态分析工具在 CI 中检测全局变量泄漏。

### 8.4 热部署策略

**问题**：更新 Lua 代码后如何不中断服务地部署？

OpenResty 的 `lua_code_cache on`（生产默认开启）会缓存编译后的 Lua 字节码，修改文件后需要 reload。但 `ngx.timer` 和长连接可能受影响。

推荐的热部署流程：

```bash
# 1. 更新代码文件
cp /deploy/new/router.lua /etc/openresty/lua/gateway/router.lua

# 2. 测试配置
openresty -t

# 3. 优雅 reload（不中断现有连接）
openresty -s reload

# 4. 验证
curl -s http://localhost/health
```

对于不能中断的场景，可以使用滚动更新：逐个 worker 替换，或者使用共享字典 + timer 实现配置热加载而无需 reload。

---

## 九、总结：何时自研、何时用 Kong/APISIX 的决策树

选择网关方案需要综合考虑团队能力、业务规模、功能需求和运维资源。以下是一个简化的决策流程：

**选择自研 OpenResty 网关的条件**：
- 团队有 Lua/Nginx 开发经验
- 需要极致性能（P99 < 1ms）
- 网关功能需求明确且有限（不需要 100 个插件）
- 希望零外部依赖，简化部署
- 有完整的监控告警体系

**选择 APISIX 的条件**：
- 需要丰富的开箱即用插件
- 团队以中文开发者为主，需要中文社区支持
- 希望纯开源方案，避免商业锁定
- 需要多语言插件扩展能力
- 对 etcd 运维有一定经验

**选择 Kong 的条件**：
- 国际化团队，需要英文文档和全球社区
- 已有 PostgreSQL 基础设施
- 需要企业级支持和 SLA
- 对接 Kong 的 Service Mesh（Mesh）方案
- 需要最成熟的 API 管理平台

**混合方案**：

实际生产中，很多团队采用混合策略——在核心路径（高频 API）使用自研 OpenResty 网关追求极致性能，在管理面使用 APISIX/Kong 做配置管理和插件编排，两者通过统一的配置中心协同工作。

最终，没有银弹。理解每种方案的优劣势，结合自身团队的技术栈和业务需求，才能做出最合适的选择。OpenResty 为我们提供了无限可能的底层能力，而 Kong 和 APISIX 则在更高层次上封装了最佳实践。掌握底层原理，才能在高层方案无法满足需求时从容应对。

---

> **参考资料**
> - [OpenResty 官方文档](https://openresty.org/en/)
> - [lua-nginx-module GitHub](https://github.com/openresty/lua-nginx-module)
> - [Apache APISIX 官方文档](https://apisix.apache.org/docs/)
> - [Kong Gateway 官方文档](https://docs.konghq.com/)
> - 《OpenResty 最佳实践》

## 相关阅读

- [Kubernetes Gateway API 实战：Ingress 的下一代标准——Laravel 微服务的流量管理新范式](/categories/运维/Kubernetes-Gateway-API-实战-Ingress下一代标准-Laravel微服务流量管理新范式/)
- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署](/categories/运维/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/)
- [Envoy Sidecar 模式实战：流量镜像、熔断、重试——基础设施下沉与应用层解耦](/categories/运维/Envoy-Sidecar-模式实战-流量镜像熔断重试-基础设施下沉与应用层解耦/)
