---
title: 'API Gateway 插件开发实战：Kong/APISIX 自定义 Lua/Go 插件——认证、限流、日志的网关层下沉'
date: 2026-06-06 10:00:00
tags: [API Gateway, Kong, APISIX, Lua, Go, 插件开发]
keywords: [API Gateway, Kong, APISIX, Lua, Go, 插件开发实战, 自定义, 插件, 认证, 限流]
description: 深入讲解 API 网关插件开发实战，基于 Kong 和 Apache APISIX 两大主流开源网关，使用 Lua 和 Go 自定义开发认证、限流、日志插件。涵盖插件生命周期、Schema 配置、Redis 滑动窗口限流、结构化日志采集、多租户认证等生产级场景，包含踩坑排查与性能测试对比，帮助团队将横切关注点下沉到网关层，统一安全管理与流量治理。
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---


# API Gateway 插件开发实战：Kong/APISIX 自定义 Lua/Go 插件——认证、限流、日志的网关层下沉

## 一、引言：为什么需要网关层下沉？

在微服务架构大规模落地的今天，API Gateway 已经成为企业级系统中不可或缺的基础设施组件。随着业务服务数量从十几个膨胀到上百个，我们面临着一个经典问题：**认证、限流、日志、灰度发布等横切关注点（Cross-Cutting Concerns）应该放在哪里？**

传统的做法是将这些逻辑嵌入到每个微服务的代码中，但这带来了几个严重的痛点：

- **代码重复**：每个服务都需要引入认证 SDK、限流组件、日志上报模块，导致大量重复代码
- **技术栈耦合**：Java 服务用一套实现，Go 服务用另一套，Node.js 服务又是另一套
- **运维成本高**：一旦认证策略变更，需要逐个服务升级重启
- **一致性难以保证**：不同团队的实现细节可能存在差异，导致安全漏洞

**网关层下沉**的核心思想是：将这些横切关注点统一收口到 API Gateway 层，通过插件机制实现标准化、集中化管理。这样业务服务只需关注核心业务逻辑，所有通用能力由网关统一提供。

本文将基于目前最流行的两个开源 API Gateway——**Kong** 和 **Apache APISIX**，深入讲解如何开发自定义插件，涵盖认证、限流、日志三大核心场景，并给出生产级的实战代码。

---

## 二、API Gateway 核心概念与架构

### 2.1 什么是 API Gateway？

API Gateway 是位于客户端与后端服务之间的中间层，负责请求的路由、转换、安全控制、流量管理等。它在微服务架构中扮演着"门卫"的角色：

```
客户端 → API Gateway → 后端服务集群
              ↓
         插件处理链：
         [认证] → [限流] → [日志] → [路由] → [负载均衡]
```

### 2.2 Kong 与 APISIX 的架构对比

| 特性 | Kong | Apache APISIX |
|------|------|---------------|
| 底层引擎 | OpenResty (Nginx + LuaJIT) | OpenResty (Nginx + LuaJIT) |
| 配置存储 | PostgreSQL / 声明式 YAML | etcd |
| 插件语言 | Lua（主）、Go（PDK）、Python 等 | Lua（主）、Go、Java、Python 等 |
| 插件数量 | 100+ 官方插件 | 80+ 官方插件 |
| 性能 | 优秀 | 更优（shared memory + radixtree 路由） |
| 热更新 | 需要 reload | 支持热加载，无需 restart |
| Admin API | RESTful | RESTful |
| 社区活跃度 | 非常活跃 | 快速增长 |

两者都基于 OpenResty 生态，但设计理念有所不同。Kong 更偏向"企业级一站式解决方案"，而 APISIX 则强调"极致性能与灵活扩展"。

### 2.4 插件开发生态深度对比

在选择 API Gateway 进行自定义插件开发之前，了解两者的插件开发生态差异至关重要：

| 对比维度 | Kong | Apache APISIX |
|----------|------|---------------|
| 插件开发语言 | Lua（一等公民）、Go/Python/JS（通过 PDK 跨语言） | Lua（一等公民）、Go/Java/Python/Wasm（外部插件 Runner） |
| 插件加载方式 | 文件放到插件目录 + `kong.conf` 注册，**需要 reload** | Lua 文件放入目录自动发现，**热加载无需重启** |
| 配置校验 | 基于自定义 Schema DSL，学习曲线较陡 | 基于标准 JSON Schema，开发者更熟悉 |
| 插件调试 | 需要查看 Nginx error.log，调试体验一般 | 内置 `core.log` 分级日志 + `debug` 模式可输出请求上下文 |
| 插件测试框架 | Kong 提供 `kong.plugins.*` 测试工具 | APISIX 提供 `lib.test_admin` + `Test::Nginx` 集成测试 |
| Go 插件支持 | 通过 Kong PDK（基于 gRPC），延迟较高 | 通过 APISIX Runner（原生 Unix Socket 协议），延迟更低 |
| Wasm 支持 | 实验性（Proxy-Wasm） | 正式支持（APISIX 3.0+） |
| 社区插件生态 | Kong Hub 100+ 官方/第三方插件 | APISIX 插件市场 80+ 官方插件，社区贡献活跃 |
| 企业版功能 | 企业版额外提供高级安全、分析插件 | 商业版 API7 提供增强管控 |
| 插件隔离性 | 同一 Nginx worker 内共享 Lua VM | 同上，但支持外部插件进程隔离 |
| 配置生效速度 | Admin API 写入 PostgreSQL 后需同步（有延迟） | Admin API 直接写入 etcd，毫秒级推送生效 |

> **选型建议**：如果团队以 Lua 为主且需要大量社区插件，两者均可；如果更看重热加载和 Go 插件性能，APISIX 有优势；如果已有 Kong 生态或需要企业级支持，Kong 是更成熟的选择。

### 2.3 插件执行生命周期

理解插件的执行阶段是开发自定义插件的基础。以 APISIX 为例，插件可以在以下阶段介入：

```lua
-- APISIX 插件生命周期
local _M = {
    version = 0.1,
    priority = 1000,       -- 优先级，数值越大越先执行
    name = plugin_name,
    schema = schema        -- JSON Schema 配置校验
}

-- rewrite 阶段：在请求转发之前执行
function _M.rewrite(conf, ctx)
    -- 认证、限流等逻辑在此阶段
end

-- access 阶段：在连接后端服务之前执行
function _M.access(conf, ctx)
    -- 路由修改、请求转换等
end

-- header_filter 阶段：收到后端响应头后执行
function _M.header_filter(conf, ctx)
    -- 响应头修改
end

-- body_filter 阶段：收到后端响应体后执行
function _M.body_filter(conf, ctx)
    -- 响应体修改
end

-- log 阶段：请求完成后执行（异步）
function _M.log(conf, ctx)
    -- 日志记录、指标上报
end
```

Kong 的生命周期类似，但阶段名称略有不同：`init_worker`、`certificate`、`rewrite`、`access`、`header_filter`、`body_filter`、`log`。

---

## 三、Kong 自定义插件开发（Lua）

### 3.1 开发环境搭建

首先，我们需要搭建 Kong 插件的开发环境：

```bash
# 安装 Kong（以 Ubuntu 为例）
curl -1sLf 'https://packages.konghq.com/public/gateway-37/gpg.15BF24BEDD02A284.key' | \
    sudo gpg --dearmor -o /usr/share/keyrings/kong-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/kong-archive-keyring.gpg] https://packages.konghq.com/public/gateway-37/deb/ubuntu $(lsb_release -sc) main" | \
    sudo tee /etc/apt/sources.list.d/kong.list

sudo apt update && sudo apt install -y kong

# 创建插件目录
mkdir -p /usr/local/share/lua/5.1/kong/plugins/my-auth
```

### 3.2 实战一：自定义 JWT 认证插件

我们将开发一个增强版的 JWT 认证插件，支持从多种来源提取 Token，并提供 Token 黑名单功能。

**插件结构：**

```
kong/plugins/my-jwt-auth/
├── handler.lua        -- 插件业务逻辑
├── schema.lua         -- 配置 Schema 定义
└── daos.lua           -- 自定义 DAO（可选）
```

**schema.lua — 配置定义：**

```lua
local typedefs = require "kong.db.schema.typedefs"

return {
    name = "my-jwt-auth",
    fields = {
        { consumer = typedefs.no_consumer },
        { protocols = typedefs.protocols_http },
        { config = {
            type = "record",
            fields = {
                { token_sources = {
                    type = "array",
                    elements = { type = "string", one_of = { "header", "query", "cookie" } },
                    default = { "header" },
                }},
                { header_name = {
                    type = "string",
                    default = "Authorization",
                }},
                { query_param_name = {
                    type = "string",
                    default = "jwt",
                }},
                { cookie_name = {
                    type = "string",
                    default = "jwt_token",
                }},
                { secret_key = {
                    type = "string",
                    required = true,
                    referenceable = true,
                }},
                { algorithm = {
                    type = "string",
                    default = "HS256",
                    one_of = { "HS256", "HS384", "HS512", "RS256", "RS384", "RS512" },
                }},
                { blacklist_enabled = {
                    type = "boolean",
                    default = true,
                }},
                { blacklist_prefix = {
                    type = "string",
                    default = "jwt:blacklist:",
                }},
                { blacklist_ttl = {
                    type = "integer",
                    default = 3600,
                }},
                { claims_to_verify = {
                    type = "array",
                    elements = { type = "string" },
                    default = { "exp", "nbf" },
                }},
            },
        }},
    },
}
```

**handler.lua — 核心逻辑：**

```lua
local jwt = require "resty.jwt"
local redis = require "resty.redis"
local cjson = require "cjson.safe"
local pl_stringx = require "pl.stringx"

local kong = kong
local ngx = ngx
local ipairs = ipairs
local setmetatable = setmetatable
local fmt = string.format

local MyJwtAuthHandler = {
    PRIORITY = 1100,  -- 在标准认证插件之后执行
    VERSION = "1.0.0",
}

-- 从请求中提取 JWT Token
local function extract_token(conf)
    for _, source in ipairs(conf.token_sources) do
        if source == "header" then
            local header_value = kong.request.get_header(conf.header_name)
            if header_value then
                -- 支持 "Bearer <token>" 格式
                local token = pl_stringx.lstrip(header_value, "Bearer ")
                if token and #token > 0 then
                    return token
                end
            end
        elseif source == "query" then
            local token = kong.request.get_query_arg(conf.query_param_name)
            if token then
                return token
            end
        elseif source == "cookie" then
            local token = kong.request.get_cookie(conf.cookie_name)
            if token then
                return token
            end
        end
    end
    return nil
end

-- 连接 Redis
local function connect_redis()
    local red = redis:new()
    red:set_timeout(1000)  -- 1 秒超时
    
    local ok, err = red:connect("127.0.0.1", 6379)
    if not ok then
        kong.log.err("Failed to connect to Redis: ", err)
        return nil, err
    end
    
    -- 使用连接池
    local ok, err = red:set_keepalive(60000, 100)
    if not ok then
        kong.log.err("Failed to set keepalive: ", err)
    end
    
    return red
end

-- 检查 Token 是否在黑名单中
local function is_blacklisted(conf, token)
    if not conf.blacklist_enabled then
        return false
    end
    
    local red, err = connect_redis()
    if not red then
        -- Redis 不可用时不阻止请求，但记录警告
        kong.log.warn("Redis unavailable, skipping blacklist check: ", err)
        return false
    end
    
    -- 使用 token 的 MD5 哈希作为 key，避免存储完整 token
    local key = conf.blacklist_prefix .. ngx.md5(token)
    local res, err = red:exists(key)
    
    if res == 1 then
        return true
    end
    
    return false
end

-- 将 Token 加入黑名单
local function blacklist_token(conf, token)
    local red, err = connect_redis()
    if not red then
        kong.log.err("Failed to blacklist token: ", err)
        return
    end
    
    local key = conf.blacklist_prefix .. ngx.md5(token)
    red:setex(key, conf.blacklist_ttl, "1")
end

function MyJwtAuthHandler:access(conf)
    -- Step 1: 提取 Token
    local token, err = extract_token(conf)
    if not token then
        return kong.response.exit(401, {
            message = "未提供认证 Token",
            code = "MISSING_TOKEN",
        })
    end
    
    -- Step 2: 检查黑名单
    if is_blacklisted(conf, token) then
        return kong.response.exit(401, {
            message = "Token 已被注销",
            code = "TOKEN_BLACKLISTED",
        })
    end
    
    -- Step 3: 验证 JWT
    local jwt_obj = jwt:verify(conf.secret_key, token)
    
    if not jwt_obj.verified then
        kong.log.warn("JWT verification failed: ", jwt_obj.reason)
        return kong.response.exit(401, {
            message = "Token 验证失败",
            code = "INVALID_TOKEN",
            detail = jwt_obj.reason,
        })
    end
    
    -- Step 4: 验证声明（claims）
    local payload = jwt_obj.payload
    
    for _, claim in ipairs(conf.claims_to_verify) do
        if claim == "exp" then
            if payload.exp and payload.exp < ngx.time() then
                return kong.response.exit(401, {
                    message = "Token 已过期",
                    code = "TOKEN_EXPIRED",
                })
            end
        elseif claim == "nbf" then
            if payload.nbf and payload.nbf > ngx.time() then
                return kong.response.exit(401, {
                    message = "Token 尚未生效",
                    code = "TOKEN_NOT_VALID_YET",
                })
            end
        end
    end
    
    -- Step 5: 将用户信息传递给后端服务
    kong.service.request.set_header("X-User-Id", payload.sub or payload.user_id or "")
    kong.service.request.set_header("X-User-Role", payload.role or "")
    kong.service.request.set_header("X-JWT-Payload", cjson.encode(payload))
    
    -- Step 6: 存入 Kong Context，供其他插件使用
    kong.ctx.shared.authenticated_user = {
        user_id = payload.sub or payload.user_id,
        role = payload.role,
        payload = payload,
    }
end

return MyJwtAuthHandler
```

### 3.3 注册并启用插件

编辑 `kong.conf`：

```yaml
plugins = bundled,my-jwt-auth
```

通过 Admin API 或声明式配置启用：

```bash
# 创建 Service 和 Route
curl -X POST http://localhost:8001/services/ \
    --data name=user-service \
    --data url=http://user-backend:8080

curl -X POST http://localhost:8001/services/user-service/routes \
    --data name=user-api \
    --data paths[]=/api/users

# 启用插件
curl -X POST http://localhost:8001/services/user-service/plugins \
    --data name=my-jwt-auth \
    --data config.secret_key=your-secret-key-here \
    --data config.algorithm=HS256 \
    --data config.blacklist_enabled=true
```

---

## 四、Apache APISIX 自定义插件开发

### 4.1 Lua 插件开发

APISIX 的插件开发体验比 Kong 更加简洁。以一个 Lua 版本的限流插件为例：

**custom-rate-limit.lua：**

```lua
local core = require("apisix.core")
local limit_count = require("resty.limit.count")
local limit_req = require("resty.limit.req")

local plugin_name = "custom-rate-limit"
local ngx = ngx
local ipairs = ipairs
local tonumber = tonumber

local schema = {
    type = "object",
    properties = {
        rate = {
            type = "integer",
            minimum = 1,
            description = "每秒允许的请求数",
        },
        burst = {
            type = "integer",
            minimum = 0,
            default = 0,
            description = "突发流量缓冲区大小",
        },
        rejected_code = {
            type = "integer",
            minimum = 200,
            maximum = 599,
            default = 429,
        },
        rejected_msg = {
            type = "string",
            default = "请求过于频繁，请稍后再试",
        },
        key = {
            type = "string",
            enum = { "remote_addr", "server_addr", "http_x_forwarded_for",
                     "consumer_name", "service_id" },
            default = "remote_addr",
        },
        policy = {
            type = "string",
            enum = { "local", "redis", "redis-cluster" },
            default = "local",
        },
        redis_host = { type = "string" },
        redis_port = { type = "integer", default = 6379 },
        redis_password = { type = "string" },
        redis_database = { type = "integer", default = 0 },
    },
    required = { "rate" },
}

local _M = {
    version = 0.1,
    priority = 1001,
    name = plugin_name,
    schema = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

-- 生成限流 key
local function gen_limit_key(conf, ctx)
    local key
    if conf.key == "remote_addr" then
        key = ctx.var.remote_addr
    elseif conf.key == "server_addr" then
        key = ctx.var.server_addr
    elseif conf.key == "http_x_forwarded_for" then
        key = ctx.var.http_x_forwarded_for
    elseif conf.key == "consumer_name" then
        key = ctx.var.consumer_name or "unknown"
    elseif conf.key == "service_id" then
        key = ctx.var.service_id or "unknown"
    end
    return plugin_name .. ":" .. key
end

-- 初始化限流器（使用 lru_cache 避免重复创建）
local limiters = core.lrucache.new({
    ttl = 300,       -- 5 分钟 TTL
    count = 1000,    -- 最多缓存 1000 个限流器
})

function _M.access(conf, ctx)
    local key = gen_limit_key(conf, ctx)
    
    local lim, err = limiters(key, nil, limit_count.new,
                              "plugin-limit-count-store",
                              conf.rate, 1, {
                                  dict = "plugin-limit-count-global",
                              })
    
    if not lim then
        core.log.error("failed to create limiter: ", err)
        return 500
    end
    
    local delay, remaining = lim:incoming(key, true)
    
    -- 设置响应头，告知客户端剩余配额
    core.response.set_header("X-RateLimit-Limit", conf.rate)
    core.response.set_header("X-RateLimit-Remaining", remaining)
    
    if not delay then
        local rejected_msg = conf.rejected_msg or "请求过于频繁，请稍后再试"
        core.log.warn("rate limit exceeded for key: ", key)
        return conf.rejected_code, { message = rejected_msg, code = "RATE_LIMITED" }
    end
    
    -- 如果使用漏桶算法（burst > 0），计算需要延迟的时间
    if conf.burst > 0 and delay >= 0.001 then
        ngx.sleep(delay)
    end
end

return _M
```

**注册插件到 APISIX 配置：**

```yaml
# config.yaml
apisix:
    extra_plugins:
        - custom-rate-limit

plugin_attr:
    custom-rate-limit:
        redis_host: 127.0.0.1
        redis_port: 6379
```

**通过 Admin API 配置：**

```bash
# 创建路由并启用自定义限流插件
curl -X PUT http://127.0.0.1:9080/apisix/admin/routes/1 \
    -H 'X-API-KEY: your-admin-key' \
    -d '{
        "uri": "/api/*",
        "plugins": {
            "custom-rate-limit": {
                "rate": 100,
                "burst": 20,
                "key": "remote_addr",
                "rejected_code": 429,
                "rejected_msg": "请求过于频繁，请稍后再试"
            }
        },
        "upstream": {
            "type": "roundrobin",
            "nodes": {
                "backend1:8080": 1,
                "backend2:8080": 1
            }
        }
    }'
```

### 4.2 Go 插件开发（APISIX Runner）

APISIX 从 2.x 版本开始支持通过外部插件机制使用 Go 开发插件，这极大地降低了 Go 开发者的入门门槛。

**项目结构：**

```
apisix-go-plugin-demo/
├── go.mod
├── go.sum
├── main.go                    # APISIX Runner 入口
├── conf
│   └── config.yaml            # 配置文件
└── plugins
    ├── logger.go              # 自定义日志插件
    └── auth.go                # 自定义认证插件
```

**go.mod：**

```go
module github.com/your-org/apisix-go-plugins

go 1.21

require (
    github.com/apache/apisix-go-plugin-runner v0.6.0
)
```

**自定义日志插件 logger.go：**

```go
package plugins

import (
    "context"
    "encoding/json"
    "fmt"
    "net"
    "net/http"
    "strings"
    "sync"
    "time"

    "github.com/apache/apisix-go-plugin-runner/pkg/apisix"
    "github.com/apache/apisix-go-plugin-runner/pkg/log"
    "github.com/apache/apisix-go-plugin-runner/pkg/plugin"
)

// AccessLogEntry 定义访问日志结构
type AccessLogEntry struct {
    Timestamp    string            `json:"timestamp"`
    ClientIP     string            `json:"client_ip"`
    Method       string            `json:"method"`
    URI          string            `json:"uri"`
    StatusCode   int               `json:"status_code"`
    Latency      int64             `json:"latency_ms"`
    RequestBody  string            `json:"request_body,omitempty"`
    ResponseSize int               `json:"response_size"`
    UserAgent    string            `json:"user_agent"`
    Upstream     string            `json:"upstream"`
    RouteID      string            `json:"route_id"`
    Headers      map[string]string `json:"headers,omitempty"`
}

// MyLogger 是自定义日志插件
type MyLogger struct {
    plugin.DefaultPlugin
}

// Config 插件配置
type LoggerConfig struct {
    Endpoint    string   `json:"endpoint"`
    BatchSize   int      `json:"batch_size"`
    FlushTime   int      `json:"flush_time_sec"`
    LogHeaders  []string `json:"log_headers"`
    IncludeBody bool     `json:"include_body"`
}

var (
    logBuffer   []AccessLogEntry
    bufferMu    sync.Mutex
    batchCh     chan AccessLogEntry
)

func init() {
    batchCh = make(chan AccessLogEntry, 10000)
    go batchSender()
}

// batchSender 异步批量发送日志
func batchSender() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case entry := <-batchCh:
            bufferMu.Lock()
            logBuffer = append(logBuffer, entry)
            shouldFlush := len(logBuffer) >= 100
            bufferMu.Unlock()

            if shouldFlush {
                flushLogs()
            }
        case <-ticker.C:
            flushLogs()
        }
    }
}

func flushLogs() {
    bufferMu.Lock()
    if len(logBuffer) == 0 {
        bufferMu.Unlock()
        return
    }
    batch := make([]AccessLogEntry, len(logBuffer))
    copy(batch, logBuffer)
    logBuffer = logBuffer[:0]
    bufferMu.Unlock()

    data, err := json.Marshal(batch)
    if err != nil {
        log.Errorf("failed to marshal logs: %v", err)
        return
    }

    // 发送到日志收集端点（如 Kafka HTTP proxy、Elasticsearch 等）
    client := &http.Client{Timeout: 3 * time.Second}
    resp, err := client.Post(
        "http://log-collector:9090/ingest",
        "application/json",
        strings.NewReader(string(data)),
    )
    if err != nil {
        log.Errorf("failed to send logs: %v", err)
        return
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        log.Errorf("log endpoint returned status: %d", resp.StatusCode)
    }
}

func (l *MyLogger) Name() string {
    return "my-logger"
}

func (l *MyLogger) ParseConf(in []byte) (interface{}, error) {
    conf := &LoggerConfig{
        BatchSize: 100,
        FlushTime: 5,
    }
    if err := json.Unmarshal(in, conf); err != nil {
        return nil, fmt.Errorf("failed to parse config: %w", err)
    }
    return conf, nil
}

func (l *MyLogger) RequestFilter(conf interface{}, w http.ResponseWriter, r *http.Request) {
    // 在请求阶段记录开始时间
    ctx := context.WithValue(r.Context(), "start_time", time.Now())
    r = r.WithContext(ctx)

    // 调用下一个插件
    if err := plugin.GetAPISIXContext(r).NextRequest(w, r); err != nil {
        log.Errorf("NextRequest error: %v", err)
    }
}

func (l *MyLogger) ResponseFilter(conf interface{}, w http.ResponseWriter, r *http.Request) {
    cfg := conf.(*LoggerConfig)
    startTime := r.Context().Value("start_time").(time.Time)
    latency := time.Since(startTime).Milliseconds()

    apisixCtx := plugin.GetAPISIXContext(r)

    entry := AccessLogEntry{
        Timestamp:    time.Now().UTC().Format(time.RFC3339),
        ClientIP:     getClientIP(r),
        Method:       r.Method,
        URI:          r.RequestURI,
        StatusCode:   apisixCtx.StatusCode(),
        Latency:      latency,
        ResponseSize: apisixCtx.ResponseSize(),
        UserAgent:    r.UserAgent(),
        RouteID:      apisixCtx.RouteID(),
    }

    // 记录指定请求头
    if len(cfg.LogHeaders) > 0 {
        entry.Headers = make(map[string]string)
        for _, h := range cfg.LogHeaders {
            if v := r.Header.Get(h); v != "" {
                entry.Headers[h] = v
            }
        }
    }

    // 异步发送
    select {
    case batchCh <- entry:
    default:
        log.Warn("log buffer full, dropping entry")
    }
}

func getClientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        parts := strings.Split(xff, ",")
        return strings.TrimSpace(parts[0])
    }
    if xri := r.Header.Get("X-Real-IP"); xri != "" {
        return xri
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return host
}

func init() {
    plugin.Register(&MyLogger{})
}
```

**main.go — 启动入口：**

```go
package main

import (
    "github.com/apache/apisix-go-plugin-runner/pkg/apisix"
    _ "github.com/your-org/apisix-go-plugins/plugins"  // 注册所有插件
)

func main() {
    apisix.Run()
}
```

**构建并运行：**

```bash
# 编译 Go 插件 runner
go build -o apisix-go-plugin-runner main.go

# 启动
./apisix-go-plugin-runner
```

**在 APISIX 配置中声明外部插件：**

```yaml
# config.yaml
apisix:
    extra_plugins:
        - name: my-logger
          attrs:
              endpoint: "http://log-collector:9090/ingest"
              batch_size: 100
              flush_time_sec: 5
```

---

## 五、核心场景实战：认证、限流、日志

### 5.1 多因素认证插件（APISIX Lua）

在生产环境中，我们经常需要支持多种认证方式并存。以下是一个支持 API Key + HMAC 签名双重认证的插件：

```lua
local core = require("apisix.core")
local hmac = require("resty.hmac")
local ngx_re = require("ngx.re")

local plugin_name = "multi-auth"

local schema = {
    type = "object",
    properties = {
        auth_methods = {
            type = "array",
            items = {
                type = "object",
                properties = {
                    method = { type = "string", enum = { "api_key", "hmac" } },
                    key_header = { type = "string", default = "X-API-Key" },
                    secret_header = { type = "string", default = "X-HMAC-Signature" },
                    timestamp_header = { type = "string", default = "X-Timestamp" },
                    timestamp_tolerance = { type = "integer", default = 300 },
                    allowed_keys = {
                        type = "object",
                        additionalProperties = { type = "string" },
                    },
                },
                required = { "method" },
            },
            minItems = 1,
        },
    },
    required = { "auth_methods" },
}

local _M = {
    version = 0.1,
    priority = 2500,
    name = plugin_name,
    schema = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

-- 验证 API Key
local function verify_api_key(method_conf)
    local api_key = core.request.header(nil, method_conf.key_header or "X-API-Key")
    if not api_key then
        return false, "missing API key"
    end

    if not method_conf.allowed_keys then
        return false, "no allowed keys configured"
    end

    local secret = method_conf.allowed_keys[api_key]
    if not secret then
        return false, "invalid API key"
    end

    return true, secret
end

-- 验证 HMAC 签名
local function verify_hmac(method_conf)
    local signature = core.request.header(nil, method_conf.secret_header or "X-HMAC-Signature")
    local timestamp = core.request.header(nil, method_conf.timestamp_header or "X-Timestamp")
    local api_key = core.request.header(nil, method_conf.key_header or "X-API-Key")

    if not signature or not timestamp or not api_key then
        return false, "missing HMAC headers"
    end

    -- 验证时间戳
    local now = ngx.time()
    local req_time = tonumber(timestamp)
    if not req_time then
        return false, "invalid timestamp"
    end

    local tolerance = method_conf.timestamp_tolerance or 300
    if math.abs(now - req_time) > tolerance then
        return false, "timestamp expired"
    end

    -- 构造签名字符串
    local method = core.request.get_method()
    local uri = ngx.var.request_uri
    local body = core.request.get_body() or ""
    local sign_str = method .. "\n" .. uri .. "\n" .. timestamp .. "\n" .. body

    -- 获取 secret
    local secret = method_conf.allowed_keys and method_conf.allowed_keys[api_key]
    if not secret then
        return false, "unknown API key"
    end

    -- 计算 HMAC-SHA256
    local hmac_obj = hmac:new(secret, hmac.ALGOS.SHA256)
    hmac_obj:update(sign_str)
    local computed = ngx.encode_base64(hmac_obj:final())

    if computed ~= signature then
        return false, "signature mismatch"
    end

    return true, nil
end

function _M.rewrite(conf, ctx)
    for _, method_conf in ipairs(conf.auth_methods) do
        local ok, err
        if method_conf.method == "api_key" then
            ok, err = verify_api_key(method_conf)
        elseif method_conf.method == "hmac" then
            ok, err = verify_hmac(method_conf)
        end

        if ok then
            ctx.multi_auth_method = method_conf.method
            return
        end
    end

    return 401, {
        message = "认证失败：所有认证方式均未通过",
        code = "AUTH_FAILED",
    }
end

return _M
```

### 5.2 滑动窗口限流（生产级方案）

相比于固定窗口限流，滑动窗口限流能更精确地控制流量，避免"窗口边界突发"问题。以下是一个基于 Redis 的滑动窗口限流实现：

```lua
local core = require("apisix.core")
local redis = require("apisix.core.utils.redis")

local plugin_name = "sliding-window-rate-limit"

local schema = {
    type = "object",
    properties = {
        limit = { type = "integer", minimum = 1 },
        window_sec = { type = "integer", minimum = 1, default = 60 },
        key = { type = "string", default = "remote_addr" },
        rejected_code = { type = "integer", default = 429 },
        redis_host = { type = "string", default = "127.0.0.1" },
        redis_port = { type = "integer", default = 6379 },
        redis_password = { type = "string" },
        redis_database = { type = "integer", default = 0 },
    },
    required = { "limit", "window_sec" },
}

local _M = {
    version = 0.1,
    priority = 1002,
    name = plugin_name,
    schema = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

-- 滑动窗口限流 Lua 脚本（原子操作）
local sliding_window_script = [[
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local window_start = now - window

    -- 移除窗口外的记录
    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

    -- 获取当前窗口内的请求数
    local current = redis.call('ZCARD', key)

    if current < limit then
        -- 未超限，添加当前请求
        redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
        redis.call('EXPIRE', key, window)
        return {1, limit - current - 1}
    else
        -- 已超限
        return {0, 0}
    end
]]

local script_sha

local function check_rate_limit(conf, key)
    local red, err = redis.new({
        host = conf.redis_host,
        port = conf.redis_port,
        password = conf.redis_password,
        database = conf.redis_database,
    })

    if not red then
        core.log.error("redis connection failed: ", err)
        return true  -- Redis 不可用时放行（可配置为拒绝）
    end

    local rate_key = plugin_name .. ":" .. key

    -- 使用 EVALSHA 执行 Lua 脚本
    local now = ngx.time() * 1000 + ngx.now() % 1 * 1000  -- 毫秒精度
    local res, err

    if script_sha then
        res, err = red:evalsha(script_sha, 1, rate_key, now,
                               conf.window_sec * 1000, conf.limit)
    end

    if not res then
        -- SHA 缓存未命中，使用 EVAL
        res, err = red:eval(sliding_window_script, 1, rate_key, now,
                            conf.window_sec * 1000, conf.limit)
        if res then
            -- 缓存 SHA（实际生产中可在 init 阶段预加载）
            -- script_sha = ...
        end
    end

    redis.release_connection(red)

    if not res then
        core.log.error("rate limit eval error: ", err)
        return true
    end

    local allowed = res[1]
    local remaining = res[2]

    core.response.set_header("X-RateLimit-Limit", conf.limit)
    core.response.set_header("X-RateLimit-Remaining", remaining)
    core.response.set_header("X-RateLimit-Window", conf.window_sec .. "s")

    if allowed == 0 then
        return false
    end
    return true
end

function _M.rewrite(conf, ctx)
    local key
    if conf.key == "remote_addr" then
        key = ctx.var.remote_addr
    elseif conf.key == "consumer_name" then
        key = ctx.var.consumer_name or "anonymous"
    end

    if not check_rate_limit(conf, key) then
        return conf.rejected_code, {
            message = "Rate limit exceeded",
            retry_after = conf.window_sec,
        }
    end
end

return _M
```

### 5.3 结构化日志采集插件（支持多种输出）

在生产环境中，日志往往需要同时输出到多个目标：Elasticsearch 用于检索，Kafka 用于流处理，Prometheus 用于监控指标。以下是一个多输出的日志插件：

```lua
local core = require("apisix.core")
local http = require("resty.http")
local cjson = require("cjson.safe")

local plugin_name = "structured-logger"

local schema = {
    type = "object",
    properties = {
        outputs = {
            type = "array",
            items = {
                type = "object",
                properties = {
                    type = { type = "string", enum = { "elasticsearch", "kafka", "http", "file" } },
                    endpoint = { type = "string" },
                    index = { type = "string" },
                    topic = { type = "string" },
                    batch_size = { type = "integer", default = 50 },
                    flush_interval = { type = "integer", default = 5 },
                    auth_token = { type = "string" },
                },
                required = { "type", "endpoint" },
            },
            minItems = 1,
        },
        log_format = {
            type = "object",
            additionalProperties = { type = "string" },
        },
        include_upstream = { type = "boolean", default = true },
        include_request_body = { type = "boolean", default = false },
        include_response_body = { type = "boolean", default = false },
        max_body_size = { type = "integer", default = 4096 },
    },
    required = { "outputs" },
}

local _M = {
    version = 0.1,
    priority = 400,  -- 较低优先级，在最后阶段执行
    name = plugin_name,
    schema = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

-- 构造日志结构
local function build_log_entry(conf, ctx)
    local entry = {
        timestamp = ngx.time(),
        iso_time = ngx.cookie_time(ngx.time()),
        request_id = ctx.var.request_id or ngx.var.request_id,
        client_ip = ctx.var.remote_addr,
        method = core.request.get_method(),
        uri = ctx.var.uri,
        query_string = ctx.var.query_string or "",
        status = ngx.status,
        response_time = (ngx.now() - ngx.req.start_time()) * 1000,  -- 毫秒
        upstream_time = ctx.var.upstream_response_time or "",
        request_length = tonumber(ctx.var.request_length) or 0,
        response_length = tonumber(ctx.var.bytes_sent) or 0,
        user_agent = core.request.header(nil, "User-Agent") or "",
        host = core.request.header(nil, "Host") or "",
        route_id = ctx.var.route_id or "",
        service_id = ctx.var.service_id or "",
    }

    -- 包含请求体
    if conf.include_request_body then
        local body = core.request.get_body()
        if body and #body <= (conf.max_body_size or 4096) then
            entry.request_body = body
        end
    end

    -- 包含上游信息
    if conf.include_upstream then
        entry.upstream = {
            addr = ctx.var.upstream_addr or "",
            status = ctx.var.upstream_status or "",
        }
    end

    -- 自定义日志格式
    if conf.log_format then
        entry.custom = {}
        for k, v in pairs(conf.log_format) do
            entry.custom[k] = core.utils.resolve_var(v, ctx.var)
        end
    end

    return entry
end

-- 发送到 Elasticsearch
local function send_to_elasticsearch(output, batch)
    local httpc = http.new()
    httpc:set_timeout(5000)

    local ok, err = httpc:connect(output.endpoint, 9200)
    if not ok then
        core.log.error("ES connect failed: ", err)
        return
    end

    local bulk_body = ""
    for _, entry in ipairs(batch) do
        local index_line = cjson.encode({
            index = { _index = output.index or "api-gateway-logs" }
        })
        bulk_body = bulk_body .. index_line .. "\n" .. cjson.encode(entry) .. "\n"
    end

    local res, err = httpc:request({
        method = "POST",
        path = "/_bulk",
        headers = {
            ["Content-Type"] = "application/x-ndjson",
            ["Authorization"] = output.auth_token and ("Bearer " .. output.auth_token) or nil,
        },
        body = bulk_body,
    })

    if not res then
        core.log.error("ES request failed: ", err)
    end

    httpc:close()
end

-- 发送到 Kafka HTTP Proxy
local function send_to_kafka_http(output, batch)
    local httpc = http.new()
    httpc:set_timeout(3000)

    local ok, err = httpc:request_uri(output.endpoint .. "/topics/" .. (output.topic or "gateway-logs"), {
        method = "POST",
        body = cjson.encode({
            records = (function()
                local records = {}
                for _, entry in ipairs(batch) do
                    table.insert(records, { value = entry })
                end
                return records
            end)(),
        }),
        headers = {
            ["Content-Type"] = "application/vnd.kafka.json.v2+json",
        },
    })

    if not ok then
        core.log.error("Kafka send failed: ", err)
    end
end

-- 日志缓冲区
local log_buffers = {}

function _M.log(conf, ctx)
    local entry = build_log_entry(conf, ctx)

    for i, output in ipairs(conf.outputs) do
        if not log_buffers[i] then
            log_buffers[i] = {
                entries = {},
                last_flush = ngx.time(),
            }
        end

        local buf = log_buffers[i]
        table.insert(buf.entries, entry)

        local should_flush = #buf.entries >= (output.batch_size or 50)
            or (ngx.time() - buf.last_flush >= (output.flush_interval or 5))

        if should_flush then
            local batch = buf.entries
            buf.entries = {}
            buf.last_flush = ngx.time()

            -- 异步发送
            ngx.timer.at(0, function(premature)
                if premature then return end
                if output.type == "elasticsearch" then
                    send_to_elasticsearch(output, batch)
                elseif output.type == "kafka" then
                    send_to_kafka_http(output, batch)
                end
            end)
        end
    end
end

return _M
```

---

## 六、生产案例分享

### 6.1 案例一：电商 API 网关的多租户认证

**背景**：某电商平台有超过 200 个微服务，需要支持 SaaS 多租户模式，每个租户有不同的 API 访问权限和配额。

**方案架构**：

```
                    ┌──────────────────────────────┐
                    │       API Gateway (APISIX)    │
                    │                                │
                    │  ┌──────────┐  ┌───────────┐  │
                    │  │ 租户认证  │  │ 租户限流   │  │
                    │  │  插件     │  │  插件      │  │
                    │  └────┬─────┘  └─────┬──────┘  │
                    │       │              │         │
                    │  ┌────▼──────────────▼──────┐  │
                    │  │    Redis Cluster          │  │
                    │  │  (租户配额 + 黑名单)       │  │
                    │  └───────────────────────────┘  │
                    └────────────┬─────────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
    ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
    │  用户服务      │   │  商品服务      │   │  订单服务      │
    └───────────────┘   └───────────────┘   └───────────────┘
```

**关键配置示例**：

```yaml
# 多租户路由配置
routes:
  - uri: /api/v1/*
    plugins:
      multi-auth:
        auth_methods:
          - method: hmac
            key_header: X-Tenant-Key
            secret_header: X-Tenant-Signature
            timestamp_header: X-Timestamp
            timestamp_tolerance: 120
      tenant-rate-limit:
        limit: 1000
        window_sec: 60
        key: header_X-Tenant-Key
      structured-logger:
        outputs:
          - type: elasticsearch
            endpoint: es-cluster.internal:9200
            index: "tenant-logs-{tenant_id}"
          - type: kafka
            endpoint: kafka-proxy.internal:8082
            topic: api-gateway-events
```

**效果**：
- 认证延迟 P99 < 5ms
- 日志采集吞吐量达到 50000 条/秒
- 租户级限流精确到 100 QPS/分钟窗口

### 6.2 案例二：金融级 API 安全网关

**背景**：某互联网金融公司需要符合等保三级要求，所有 API 调用必须有完整的审计日志，并且支持实时异常检测。

**核心插件组合**：

1. **双向 TLS 认证**：网关层验证客户端证书
2. **请求签名验证**：防篡改
3. **IP 黑名单**：实时更新的恶意 IP 库
4. **全量审计日志**：记录请求/响应完整报文
5. **异常行为检测**：短时间内高频调用触发告警

```lua
-- 异常行为检测插件核心逻辑
function _M.rewrite(conf, ctx)
    local client_ip = ctx.var.remote_addr
    local api_path = ctx.var.uri
    
    -- 使用滑动窗口统计
    local window_key = "abnormal:" .. client_ip .. ":" .. api_path
    local count, err = redis_incr(window_key, conf.detection_window)
    
    if count > conf.max_requests_per_window then
        -- 触发告警
        send_alert({
            type = "ABNORMAL_ACCESS",
            client_ip = client_ip,
            path = api_path,
            count = count,
            window = conf.detection_window,
            timestamp = ngx.time(),
        })
        
        -- 记录到审计日志
        audit_log({
            event = "BLOCKED_ABNORMAL_ACCESS",
            client_ip = client_ip,
            path = api_path,
            reason = "frequency_exceeded",
        })
        
        if conf.block_on_detect then
            return 403, { message = "异常访问已被拦截" }
        end
    end
end
```

---

## 七、最佳实践与踩坑总结

### 7.1 插件开发最佳实践

**1. 优先级（Priority）设计原则**

```lua
-- 推荐的优先级规划
-- 认证类：2000-3000（最先执行，拒绝未授权请求）
-- 安全类：1500-1999（WAF、IP 黑白名单）
-- 限流类：1000-1499（认证通过后再限流）
-- 转换类：500-999（请求/响应改写）
-- 日志类：100-499（最后执行，记录完整信息）
```

**2. 错误处理——宁可放行，不可误杀**

```lua
-- 生产环境建议：依赖服务不可用时的降级策略
function _M.rewrite(conf, ctx)
    local ok, err = pcall(function()
        return do_auth(conf, ctx)
    end)
    
    if not ok then
        core.log.error("auth plugin error: ", err)
        if conf.fail_mode == "closed" then
            -- 安全模式：出错时拒绝（适用于金融场景）
            return 503, { message = "认证服务暂时不可用" }
        else
            -- 开放模式：出错时放行（适用于一般业务场景）
            core.log.warn("auth failed open, allowing request")
        end
    end
end
```

**3. 性能优化要点**

```lua
-- ✅ 使用 lru_cache 避免重复创建对象
local config_cache = core.lrucache.new({
    ttl = 60,
    count = 100,
})

-- ✅ 连接池管理
local function get_redis_connection(conf)
    local key = conf.redis_host .. ":" .. conf.redis_port
    return config_cache(key, nil, function()
        return create_redis_pool(conf)
    end)
end

-- ✅ 避免在热路径中使用字符串拼接
-- ❌ local key = "prefix:" .. var1 .. ":" .. var2
-- ✅ 使用 table.concat 或 fmt
local key = core.string.format("prefix:%s:%s", var1, var2)

-- ✅ 使用 ngx.timer.at 进行异步操作
ngx.timer.at(0, function(premature)
    if premature then return end
    -- 异步发送日志、上报指标等
    send_to_monitor(data)
end)
```

**4. 配置管理最佳实践**

```lua
-- 使用 JSON Schema 严格校验配置
local schema = {
    type = "object",
    properties = {
        -- 明确指定类型和约束
        rate = {
            type = "integer",
            minimum = 1,
            maximum = 100000,
            description = "每秒请求数限制",
        },
        -- 使用枚举限制选项
        algorithm = {
            type = "string",
            enum = { "fixed_window", "sliding_window", "token_bucket" },
            default = "sliding_window",
        },
        -- 使用 one_of 支持多种类型
        key = {
            one_of = {
                { type = "string" },
                { type = "array", items = { type = "string" } },
            },
        },
    },
    required = { "rate" },
    additionalProperties = false,  -- 禁止未知字段
}
```

### 7.2 常见踩坑与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 插件不生效 | 优先级冲突或未注册 | 检查 `priority` 值和配置文件中的插件列表 |
| 限流不准确 | 多节点时间不同步 | 使用 NTP 同步 + Redis 集中式限流 |
| 内存泄漏 | 未正确释放连接 | 使用连接池 + keepalive |
| 响应体读取失败 | body_filter 阶段流式处理 | 使用 `core.response.hold_body_chunk()` |
| 日志丢失 | 服务重启时缓冲区未 flush | 注册 `ngx.process.type("privileged agent")` 进行优雅退出 |
| Go 插件性能差 | 频繁 CGO 调用 | 使用 APISIX Runner 原生协议，避免 CGO |

### 7.3 测试策略

```lua
-- 使用 APISIX 测试框架
local t = require("lib.test_admin").test
local json = require("cjson")

-- 测试插件配置校验
local code, body = t('/apisix/admin/routes/1',
    ngx.HTTP_PUT,
    json.encode({
        uri = "/test",
        plugins = {
            ["custom-rate-limit"] = {
                rate = -1,  -- 应该校验失败
            }
        },
    })
)

assert(code == 400, "should reject invalid config")

-- 测试限流功能
for i = 1, 150 do
    local res = assert(proxy_client:request_uri("/test", {
        method = "GET",
    }))
    
    if i <= 100 then
        assert(res.status == 200, "request " .. i .. " should pass")
    else
        assert(res.status == 429, "request " .. i .. " should be limited")
    end
end
```

---

## 八、总结

API Gateway 插件开发是微服务架构中实现"横切关注点下沉"的核心手段。通过本文的实战讲解，我们可以看到：

1. **Kong 和 APISIX 都提供了强大且灵活的插件机制**，Lua 作为主要开发语言具有极低的学习成本和优秀的性能
2. **Go 插件支持**使得更多开发者能够参与到网关层的定制开发中
3. **认证、限流、日志**三大场景是最常见的网关层下沉需求，本文提供了生产级的实现方案
4. **最佳实践中**，错误处理、性能优化、配置管理是三个需要特别关注的方面

在实际项目中，建议根据团队技术栈和业务需求选择合适的 API Gateway，并从简单的插件开始逐步构建网关能力。网关层下沉不是一蹴而就的过程，而是随着业务发展不断迭代完善的。

**推荐阅读与资源**：
- [Kong 官方插件开发文档](https://docs.konghq.com/gateway/latest/plugin-development/)
- [Apache APISIX 插件开发指南](https://apisix.apache.org/docs/apisix/plugin-develop/)
- [APISIX Go Plugin Runner](https://github.com/apache/apisix-go-plugin-runner)
- [OpenResty 官方文档](https://openresty-reference.readthedocs.io/)

---

> 本文首发于作者博客，转载请注明出处。如有问题欢迎在评论区交流讨论。

## 相关阅读

- [Nginx + Lua (OpenResty) 实战：高性能自定义网关——对比 Kong/APISIX 的流量治理与边缘计算](/post/nginx-lua-openresty-kong-apisix/)
- [服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦](/post/service-mesh-sidecar-ambient-istio-laravel-mtls/)
- [Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理——Laravel 应用的密钥轮换与审计日志](/post/secrets-management-hashicorp-vault-aws-manager-doppler-laravel/)
