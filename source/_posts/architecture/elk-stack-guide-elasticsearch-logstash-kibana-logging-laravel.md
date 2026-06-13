---

title: ELK Stack 实战：Elasticsearch + Logstash + Kibana 集中式日志系统与 Laravel 集成踩坑记录
keywords: [ELK Stack, Elasticsearch, Logstash, Kibana, Laravel, 集中式日志系统与, 集成踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-17 03:06:55
updated: 2026-05-17 03:10:28
categories:
- architecture
- logging
tags:
- Elasticsearch
- Laravel
- 监控
description: 从零搭建 ELK Stack 集中式日志系统，与 Laravel B2C API 深度集成。涵盖 Docker Compose 编排、Logstash Pipeline 配置、Kibana 可视化仪表板、日志字段结构化、慢查询追踪、生产环境性能调优，以及 30+ 仓库日志治理的真实踩坑经验。适合 Laravel 中高级开发者与运维工程师参考。
---


## 为什么需要 ELK？

Laravel 自带的 `storage/logs/laravel.log` 在单机开发阶段足够用，但当你的 B2C API 跑在 3 台以上的服务器、每天产生 500MB+ 日志时，你会面临三个致命问题：

1. **查日志要 SSH 到每台机器**，`grep` + `tail` 组合拳效率极低
2. **日志格式不统一**，有的用 JSON，有的用纯文本，有的混在一起
3. **没有聚合分析能力**，想知道"过去 1 小时有多少 500 错误"需要写脚本

ELK Stack（Elasticsearch + Logstash + Kibana）就是为了解决这三个问题而生的。本文基于 KKday B2C API 的真实生产环境，记录从零搭建到日均处理 200GB 日志的完整过程。

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      Laravel B2C API                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │ API-01   │  │ API-02   │  │ API-03   │   ...           │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
│        │             │             │                        │
│        ▼             ▼             ▼                        │
│   ┌──────────────────────────────────────┐                  │
│   │     Monolog → Filebeat / Logstash    │                  │
│   └──────────────────┬───────────────────┘                  │
└──────────────────────┼──────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Logstash Pipeline                          │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐                 │
│   │  Input   │───▶│  Filter │───▶│  Output │                 │
│   │  beats   │    │  grok   │    │  es     │                 │
│   │  tcp     │    │  mutate │    │  stdout │                 │
│   └─────────┘    │  json   │    └─────────┘                 │
│                   │  date   │                                │
│                   └─────────┘                                │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                   Elasticsearch Cluster                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│   │  Node-1  │  │  Node-2  │  │  Node-3  │                  │
│   │  master  │  │  data    │  │  data    │                  │
│   └──────────┘  └──────────┘  └──────────┘                  │
│                                                              │
│   Index: laravel-logs-2026.05.17                             │
│   Shards: 3  │  Replicas: 1                                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                       Kibana                                 │
│   Dashboard: Laravel Error Rate / Slow Query / API Traffic   │
└──────────────────────────────────────────────────────────────┘
```

## 第一步：Docker Compose 搭建 ELK 环境

### 本地开发版（单节点）

```yaml
# docker-compose.elk.yml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
    container_name: elk-es
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false          # 本地开发关闭鉴权
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"     # ⚠️ 生产环境建议 4g+
      - cluster.name=laravel-logs
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

  logstash:
    image: docker.elastic.co/logstash/logstash:8.13.0
    container_name: elk-logstash
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
      - ./logstash/config/logstash.yml:/usr/share/logstash/config/logstash.yml
    ports:
      - "5044:5044"    # Beats input
      - "5000:5000"    # TCP input
      - "9600:9600"    # Monitoring API
    depends_on:
      elasticsearch:
        condition: service_healthy
    environment:
      - "LS_JAVA_OPTS=-Xms256m -Xmx256m"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.13.0
    container_name: elk-kibana
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      elasticsearch:
        condition: service_healthy

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.13.0
    container_name: elk-filebeat
    user: root
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
      - /var/log/nginx:/var/log/nginx:ro           # Nginx 日志
      - /Users/michael/projects/storage/logs:/app/logs:ro  # Laravel 日志
    depends_on:
      - logstash

volumes:
  es-data:
```

### 踩坑 #1：ES_JAVA_OPTS 内存设置

```bash
# ❌ 错误：不设置内存限制，ES 默认吃 1GB，生产环境 OOM
# ✅ 正确：根据日志量设置
# 日志量 < 10GB/天 → 512m~1g
# 日志量 10-100GB/天 → 2g~4g
# 日志量 > 100GB/天 → 4g~8g，考虑集群

# ⚠️ 重要：vm.max_map_count 必须 >= 262144
sudo sysctl -w vm.max_map_count=262144
# 持久化
echo "vm.max_map_count=262144" >> /etc/sysctl.conf
```

## 第二步：Laravel 端日志结构化

### 配置 Monolog JSON 格式

```php
// config/logging.php
'channels' => [
    'elk' => [
        'driver' => 'monolog',
        'handler' => StreamHandler::class,
        'formatter' => \Monolog\Formatter\JsonFormatter::class,
        'formatter_with' => [
            'includeStacktraces' => true,  // ⚠️ 包含堆栈信息
        ],
        'tap' => [App\Logging\AddContextData::class],
    ],
],
```

### 自定义 Context 处理器

```php
<?php
// app/Logging/AddContextData.php

namespace App\Logging;

use Monolog\Logger;
use Monolog\Processor\PsrLogMessageProcessor;
use Illuminate\Support\Facades\Auth;

class AddContextData
{
    public function __invoke(Logger $logger): void
    {
        // 添加 request_id 用于链路追踪
        $logger->pushProcessor(function (array $record) {
            $record['extra']['request_id'] = request()->header('X-Request-Id', uniqid('req_', true));
            $record['extra']['trace_id'] = request()->header('X-Trace-Id', '');
            $record['extra']['user_id'] = Auth::id() ?? 0;
            $record['extra']['ip'] = request()->ip();
            $record['extra']['method'] = request()->method();
            $record['extra']['url'] = request()->fullUrl();
            $record['extra']['user_agent'] = request()->userAgent();
            $record['extra']['response_time'] = microtime(true) - LARAVEL_START;
            $record['extra']['app_env'] = config('app.env');
            $record['extra']['app_version'] = config('app.version', 'unknown');

            return $record;
        });

        // PSR-3 消息占位符替换
        $logger->pushProcessor(new PsrLogMessageProcessor());
    }
}
```

### 在 Kernel 中注册全局日志中间件

```php
<?php
// app/Http/Kernel.php

protected $middleware = [
    \App\Http\Middleware\LoggingMiddleware::class,
    // ... 其他中间件
];
```

```php
<?php
// app/Http/LoggingMiddleware.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;

class LoggingMiddleware
{
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        // 记录 API 请求日志
        Log::channel('elk')->info('api.access', [
            'status_code' => $response->getStatusCode(),
            'content_type' => $response->headers->get('Content-Type'),
            'request_body_size' => $request->header('Content-Length', 0),
            'response_size' => strlen($response->getContent()),
        ]);

        // ⚠️ 踩坑：不要记录请求体（可能含敏感数据）
        // 只记录 GET 参数，POST body 按需脱敏

        return $response;
    }
}
```

### 踩坑 #2：日志文件切割

```php
// config/logging.php - 必须配合 daily 切割
'elk' => [
    'driver' => 'daily',
    'path' => storage_path('logs/elk.json'),
    'days' => 7,                              // 保留 7 天
    'formatter' => \Monolog\Formatter\JsonFormatter::class,
],
```

```bash
# ⚠️ 常见问题：Filebeat 读到正在写入的日志文件导致 JSON 解析失败
# 解决方案：Filebeat 的 close_inactive 设置
filebeat.inputs:
  - type: log
    paths:
      - /app/logs/elk-*.json
    close_inactive: 5m          # 5 分钟无新数据关闭文件句柄
    json.keys_under_root: true  # JSON 字段提升到顶层
    json.add_error_key: true    # 解析失败添加 error 字段
```

## 第三步：Logstash Pipeline 配置

### 核心 Pipeline

```ruby
# logstash/pipeline/laravel.conf

input {
  beats {
    port => 5044
  }

  # 也可以直接接收 TCP（适合调试）
  tcp {
    port => 5000
    codec => json_lines
  }
}

filter {
  # 1. JSON 解析
  if [message] =~ /^\{/ {
    json {
      source => "message"
      target => "log"
      skip_on_invalid_json => true
    }
  }

  # 2. 提取时间戳
  date {
    match => [ "[log][datetime]", "yyyy-MM-dd HH:mm:ss", "ISO8601" ]
    target => "@timestamp"
    timezone => "Asia/Taipei"
  }

  # 3. 字段映射与清理
  mutate {
    rename => {
      "[log][level_name]" => "[log][level]"
      "[log][extra][request_id]" => "[request][id]"
      "[log][extra][trace_id]" => "[trace][id]"
      "[log][extra][user_id]" => "[user][id]"
      "[log][extra][method]" => "[http][method]"
      "[log][extra][url]" => "[http][url]"
      "[log][extra][status_code]" => "[http][status_code]"
      "[log][extra][response_time]" => "[http][response_time_ms]"
      "[log][extra][ip]" => "[client][ip]"
      "[log][extra][app_env]" => "[app][env]"
      "[log][extra][app_version]" => "[app][version]"
    }
    remove_field => [
      "[log][extra][user_agent]",
      "[log][extra][app_env]",
      "[beat]",
      "[agent]",
      "[ecs]",
      "[host]"
    ]
  }

  # 4. 类型转换（ES 只接受数值类型做 range 查询）
  mutate {
    convert => {
      "[user][id]" => "integer"
      "[http][status_code]" => "integer"
      "[http][response_time_ms]" => "float"
    }
  }

  # 5. 慢请求标记（response_time > 500ms）
  if [http][response_time_ms] and [http][response_time_ms] > 500 {
    mutate {
      add_tag => ["slow_request"]
    }
  }

  # 6. 错误级别标记
  if [log][level] == "ERROR" or [log][level] == "CRITICAL" {
    mutate {
      add_tag => ["error_alert"]
    }
  }

  # 7. GeoIP（可选：根据 IP 解析地理位置）
  if [client][ip] {
    geoip {
      source => "[client][ip]"
      target => "[client][geo]"
    }
  }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "laravel-logs-%{+YYYY.MM.dd}"

    # ⚠️ 踩坑：必须配置 ilm 否则 index 会无限增长
    ilm_enabled => true
    ilm_rollover_alias => "laravel-logs"
    ilm_pattern => "{now/d}-000001"
    ilm_policy => "laravel-logs-policy"
  }

  # 调试用：输出到 stdout
  # stdout { codec => rubydebug }
}
```

### 踩坑 #3：Logstash Grok 解析性能

```ruby
# ❌ 错误：对每条日志都用复杂的 grok 匹配
filter {
  grok {
    match => {
      "message" => '%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} %{GREEDYDATA:msg}'
    }
  }
}

# ✅ 正确：用 JSON 格式在 Laravel 端就结构化，Logstash 只做字段映射
# Grok 的性能是 JSON 解析的 5-10 倍慢
# 如果必须用 Grok，提前用 pattern_definitions 缓存常用 pattern
filter {
  grok {
    match => { "message" => "%{NGINX_ACCESS}" }
    pattern_definitions => {
      "NGINX_ACCESS" => '%{IPORHOST:client_ip} ... %{GREEDYDATA:request}'
    }
    timeout_millis => 50  # ⚠️ 设置超时防止回溯爆炸
  }
}
```

## 第四步：Elasticsearch Index 管理

### ILM（Index Lifecycle Management）策略

```json
PUT _ilm/policy/laravel-logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_primary_shard_size": "10gb",
            "max_age": "1d"
          },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "3d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 },
          "set_priority": { "priority": 50 }
        }
      },
      "cold": {
        "min_age": "14d",
        "actions": {
          "freeze": {},
          "set_priority": { "priority": 0 }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

### 踩坑 #4：Shard 数量规划

```bash
# ⚠️ 常见错误：每个 index 只有 1 个 shard
# 正确公式：shard 数 = 日志量(GB/天) / 每个 shard 推荐大小(30-50GB)

# 日均 10GB → 1 shard 足够
# 日均 50GB → 2 shards
# 日均 200GB → 5 shards

# ⚠️ 另一个坑：shard 过多导致 master 节点压力
# ES 7.x 默认 1 primary + 1 replica = 2 shards/index
# 30 天保留期 = 60 个 shards，对小集群来说已经不少了
```

### Index Template

```json
PUT _index_template/laravel-logs-template
{
  "index_patterns": ["laravel-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "laravel-logs-policy",
      "index.lifecycle.rollover_alias": "laravel-logs",
      "index.codec": "best_compression",
      "index.refresh_interval": "30s"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "message": { "type": "text", "analyzer": "standard" },
        "log": {
          "properties": {
            "level": { "type": "keyword" },
            "channel": { "type": "keyword" },
            "message": { "type": "text" }
          }
        },
        "http": {
          "properties": {
            "method": { "type": "keyword" },
            "url": { "type": "keyword" },
            "status_code": { "type": "integer" },
            "response_time_ms": { "type": "float" }
          }
        },
        "user": {
          "properties": {
            "id": { "type": "long" }
          }
        },
        "client": {
          "properties": {
            "ip": { "type": "ip" },
            "geo": {
              "properties": {
                "location": { "type": "geo_point" }
              }
            }
          }
        },
        "request": {
          "properties": {
            "id": { "type": "keyword" }
          }
        },
        "trace": {
          "properties": {
            "id": { "type": "keyword" }
          }
        },
        "tags": { "type": "keyword" }
      }
    }
  }
}
```

## 第五步：Kibana 可视化仪表板

### 核心 Dashboard 设计

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard: Laravel B2C API - 日志监控                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── Filter ───────────────────────────────────────────┐   │
│  │ @timestamp: Last 24h | app.env: production           │   │
│  │ log.level: * | http.method: *                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Row 1: KPI 指标 ──────────────────────────────────┐   │
│  │ [总请求数] [错误率] [P95延迟] [慢请求占比]           │   │
│  │  1.2M      0.3%     120ms    2.1%                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Row 2: 趋势图 ────────────────────────────────────┐   │
│  │ [错误率趋势 (折线图)]    [响应时间分布 (热力图)]      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Row 3: 分布图 ────────────────────────────────────┐   │
│  │ [HTTP状态码分布 (饼图)]  [Top 10 慢请求 (表格)]      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Row 4: 日志流 ────────────────────────────────────┐   │
│  │ [错误日志实时流 (Discover)]                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### KQL 查询示例

```bash
# 查找过去 1 小时内的 500 错误
log.level: "ERROR" AND http.status_code: 500

# 查找某个用户的请求链路
request.id: "req_6651a2b3c4d5e"

# 查找慢请求（> 1s）
tags: "slow_request" AND http.response_time_ms > 1000

# 查找特定 API 端点的错误
http.url: *"/api/v2/orders"* AND log.level: "ERROR"

# 排除健康检查日志
NOT http.url: *"/health"*

# 正则匹配（KQL 不支持正则，用 Lucene 语法切换）
# 在搜索栏左侧切换为 Lucene 查询
http.url:/\/api\/v[23]\/orders\/\d+/
```

## 第六步：生产环境踩坑实录

### 踩坑 #5：磁盘空间被 ES 吃满

```bash
# ES 默认 watermark 阈值：
# cluster.routing.allocation.disk.watermark.low → 85% → 停止分配新 shard
# cluster.routing.allocation.disk.watermark.high → 90% → 尝试迁移 shard
# cluster.routing.allocation.disk.watermark.flood_stage → 95% → index read-only

# ⚠️ 最大的坑：一旦触发 flood_stage，所有 index 变成 read-only
# 你需要手动解除：
PUT _all/_settings
{
  "index.blocks.read_only_allow_delete": null
}

# 预防措施：
PUT _cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.disk.watermark.low": "80%",
    "cluster.routing.allocation.disk.watermark.high": "85%",
    "cluster.routing.allocation.disk.watermark.flood_stage": "90%",
    "cluster.routing.allocation.disk.watermark.flood_stage.max_headroom": "50gb"
  }
}
```

### 踩坑 #6：Logstash OOM 导致日志丢失

```ruby
# logstash/config/logstash.yml

# ⚠️ 默认 batch_size=125，对大批量日志来说太小
pipeline.batch.size: 500           # 每批 500 条
pipeline.batch.delay: 50           # 等待 50ms 凑批
pipeline.workers: 4                # 等于 CPU 核心数

# ⚠️ 内存队列 vs 持久化队列
# 内存队列：Logstash 挂了，未处理的日志就丢了
# 持久化队列：写磁盘，重启后恢复
queue.type: persisted
queue.max_bytes: 4gb
queue.checkpoint.writes: 1024
```

### 踩坑 #7：时区问题导致日志时间错乱

```ruby
# Logstash 的 @timestamp 默认是 UTC
# Laravel 日志是 Asia/Taipei (UTC+8)
# 导致 Kibana 显示的时间差 8 小时

# 解决方案：
filter {
  date {
    match => [ "[log][datetime]", "yyyy-MM-dd HH:mm:ss" ]
    target => "@timestamp"
    timezone => "Asia/Taipei"    # ⚠️ 必须设置
  }
}

# Kibana 也要设置：Management → Advanced Settings → dateFormat:tz → Asia/Taipei
```

### 踩坑 #8：Filebeat 与 Laravel daily 日志切换

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    paths:
      - /app/logs/elk-*.json       # 匹配 daily 切割的文件
    close_renamed: true              # ⚠️ 文件重命名时关闭
    close_removed: true              # ⚠️ 文件删除时关闭
    clean_removed: true              # ⚠️ 清理已删除文件的 registry
    scan_frequency: 10s              # 每 10s 扫描新文件
    harvester_buffer_size: 65536
```

## 第七步：性能优化与容量规划

### Elasticsearch 查询优化

```bash
# ⚠️ 踩坑：Kibana Discover 加载慢（> 10s）
# 原因：查询了所有字段的全文索引

# 优化 1：使用 keyword 字段做精确匹配
log.level: "ERROR"        # ✅ keyword，快
message: "timeout"        # ❌ text 字段，慢（需要倒排索引扫描）

# 优化 2：限制时间范围
# Kibana 默认查 last 15 minutes，改为 last 1 hour 足够

# 优化 3：关闭不需要的 index pattern 字段
# Management → Index Patterns → 选中字段 → 点击关闭
# 关闭 log.context, log.extra 等大字段，只保留常用的
```

### 容量规划公式

```
日志存储量估算：
  日志量(GB/天) = 平均每条日志大小(KB) × 日请求数 × 每请求日志条数
  示例：2KB × 1,000,000 × 5 = 10GB/天

存储空间 = 日志量 × 保留天数 × (1 + 副本数) × 1.1(overhead)
  示例：10GB × 30 × 2 × 1.1 = 660GB

ES 节点数 = 总存储 / 每节点推荐存储(500GB~1TB)
  示例：660GB / 500GB ≈ 2 节点（建议 3 节点容错）
```

## 与 Laravel Telescope/日志的关系

```
┌──────────────────────────────────────────────────────┐
│              日志工具矩阵                              │
├──────────────────┬───────────────────────────────────┤
│ Laravel Telescope │ 开发环境调试利器                   │
│                   │ DB 查询、邮件、队列、异常追踪      │
│                   │ ⚠️ 生产环境必须关闭               │
├──────────────────┼───────────────────────────────────┤
│ Laravel Logging  │ 应用层日志记录                     │
│ (Monolog)        │ 结构化日志、多通道、日志切割        │
│                   │ 写入本地文件                      │
├──────────────────┼───────────────────────────────────┤
│ ELK Stack        │ 集中式日志聚合与分析               │
│                   │ 跨机器日志聚合、实时搜索、可视化    │
│                   │ 生产环境必备                      │
├──────────────────┼───────────────────────────────────┤
│ New Relic/Sentry │ 应用性能监控 (APM)                │
│                   │ 错误追踪、性能分析、告警           │
│                   │ 与 ELK 互补                       │
└──────────────────┴───────────────────────────────────┘
```

## 总结

| 阶段 | 关键操作 | 常见坑 |
|------|---------|--------|
| 搭建 | Docker Compose + vm.max_map_count | 内存不足导致 ES 启动失败 |
| 接入 | Laravel Monolog JSON 格式 | 未结构化导致 Logstash 解析慢 |
| Pipeline | Logstash filter + ILM | 时区错乱、shard 过多 |
| 可视化 | Kibana Dashboard + KQL | 查询慢、字段太多 |
| 运维 | ILM 策略 + 磁盘监控 | 磁盘满触发 read-only |
| 扩展 | 多节点集群 + 副本 | 网络分区导致脑裂 |

ELK 不是银弹，但它是目前最成熟的集中式日志方案。如果你的日志量 < 5GB/天，可以先用 Loki + Grafana（更轻量）；如果 > 100GB/天，考虑 ClickHouse + Vector（更高性能）。但对大多数 B2C 项目来说，ELK + ILM 策略足矣。

## 相关阅读

- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/架构/kafka-debezium-cdc-实战-数据库变更事件流-Laravel互补架构/)
- [Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架](/categories/架构/Platform-Engineering-实战-Golden-Paths-与服务模板-用Backstage自助创建标准化Laravel微服务脚手架/)
- [Sidecar Pattern 实战：Laravel 微服务的 Sidecar 代理——Envoy/Telegraf/Filebeat 的基础设施下沉](/categories/架构/2026-06-06-Sidecar-Pattern-实战-Laravel-微服务-Sidecar-代理-Envoy-Telegraf-Filebeat-基础设施下沉/)
