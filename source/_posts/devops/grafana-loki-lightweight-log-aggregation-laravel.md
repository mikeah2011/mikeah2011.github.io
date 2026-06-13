---
title: Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化
date: 2026-06-02 00:00:00
tags: [Grafana Loki, 日志, ELK, 可观测性, Laravel]
keywords: [Grafana Loki, ELK, Laravel, 轻量级日志聚合替代, 应用的日志采集与查询优化, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Grafana Loki 是替代 ELK 的轻量级日志聚合方案，本文从零搭建 Loki + Promtail + Grafana 生产级日志系统，深度集成 Laravel 应用。涵盖 LogQL 查询实战、JSON 日志解析、标签设计最佳实践、分层存储策略、Grafana 告警规则配置，以及与 Prometheus 的联动方案。相比 Elasticsearch，Loki 资源消耗降低 1-2 个数量级，适合中小团队低成本构建可观测性体系。
---


# Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化

## 前言

日志是系统可观测性的三大支柱之一（另外两个是 Metrics 和 Traces），但在实际运维中，日志系统往往是最让团队头疼的部分。

如果你用过 ELK（Elasticsearch + Logstash + Kibana），你一定有过这样的体验：

- **资源消耗巨大**：一个中等规模的 Laravel 应用，每天产生 50GB 日志，Elasticsearch 集群需要至少 3 个节点、64GB 内存的服务器
- **运维复杂**：索引管理、分片策略、节点扩容、集群健康监控……ELK 本身就是一个需要专人维护的系统
- **成本高昂**：存储成本随着日志量线性增长，加上 Elasticsearch 的内存需求，月费用轻松过万

**Grafana Loki** 是 Grafana Labs 开发的轻量级日志聚合系统，它的设计哲学是"like Prometheus, but for logs"——只索引标签（labels），不索引日志内容。这种设计使得 Loki 的资源消耗比 Elasticsearch 低 1-2 个数量级，同时通过 LogQL 查询语言和 Grafana 的可视化能力，提供了足够的日志分析能力。

本文将从零开始，完整展示如何使用 Loki + Promtail + Grafana 搭建一套生产级的日志系统，并深度集成 Laravel 应用。

---

## 一、ELK 的痛点与 Loki 的设计哲学

### 1.1 ELK 的核心问题

**资源消耗模型：**

```
ELK 日志处理链路：
  应用日志 → Logstash（CPU/内存密集）→ Elasticsearch（CPU/内存/磁盘密集）→ Kibana

典型的 ELK 集群（处理 100GB/天日志）：
  - 3 × Elasticsearch 节点（64GB RAM, 8 CPU, 2TB SSD）
  - 2 × Logstash 节点（16GB RAM, 4 CPU）
  - 1 × Kibana 节点（8GB RAM, 2 CPU）
  
  总计：~224GB RAM, ~36 CPU cores, ~6TB SSD
  月成本（云上）：约 ¥15,000-25,000
```

**索引膨胀问题：**

Elasticsearch 为每个字段建立倒排索引，一条日志如果有 20 个字段，就需要维护 20 个索引。当字段基数（cardinality）很高时（如 user_id、request_id），索引大小甚至可能超过原始数据。

### 1.2 Loki 的设计哲学

Loki 的核心理念可以用一句话概括：**"只索引你关心的东西（标签），不索引日志内容本身"**。

```
ELK 的方式：
  日志原文 → 全文分词 → 倒排索引 → 可以搜索任意字段
  代价：巨大的存储和计算开销

Loki 的方式：
  日志原文 → 提取标签 → 只存标签索引 → 搜索时先按标签过滤，再扫描原始日志
  代价：复杂查询较慢（需要扫描），但存储极省
```

**类比理解：**

想象一个图书馆：
- **ELK** 像是一个为每本书的每个段落都建立索引的图书馆——查找任何内容都很快，但索引本身占据了大量空间
- **Loki** 像是一个只按书架号和分类标签管理的图书馆——找某类书很快，但要在某本书里找特定段落需要翻阅

### 1.3 资源对比

同样的 100GB/天日志量：

| 指标 | ELK | Loki |
|-----|-----|------|
| 总内存 | 224GB | 16-32GB |
| 总 CPU | 36 cores | 4-8 cores |
| 存储需求 | 6TB (含索引) | 1.5TB (原始 + 标签) |
| 月成本（云上） | ¥15,000-25,000 | ¥2,000-5,000 |
| 查询延迟（精确标签） | ~100ms | ~200ms |
| 查询延迟（全文搜索） | ~500ms | 较慢（需扫描） |

---

## 二、Loki 架构解析

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    Loki 架构                              │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │   Promtail   │    │    Grafana   │    │  客户端     │  │
│  │   (采集)     │    │   (查询UI)   │    │  (推送)     │  │
│  └──────┬───────┘    └──────┬───────┘    └─────┬──────┘  │
│         │                   │                  │         │
│         ▼                   ▼                  ▼         │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Distributor (分发器)                     │  │
│  │  - 接收日志数据                                      │  │
│  │  - 验证和预处理                                      │  │
│  │  - 根据标签哈希分发到 Ingester                       │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │              Ingester (摄入器)                        │  │
│  │  - 在内存中构建日志块（chunks）                       │  │
│  │  - 定期刷写到存储后端                                │  │
│  │  - 维护标签索引                                      │  │
│  │  - WAL（预写日志）保证数据不丢                        │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │              Querier (查询器)                         │  │
│  │  - 接收 LogQL 查询                                  │  │
│  │  - 从 Ingester 查询近期数据                          │  │
│  │  - 从存储后端查询历史数据                             │  │
│  │  - 合并和返回结果                                    │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │              Compactor (压缩器)                       │  │
│  │  - 合并和压缩历史日志块                               │  │
│  │  - 应用保留策略                                      │  │
│  │  - 优化查询性能                                      │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │              Storage (存储后端)                       │  │
│  │  - 日志块: 本地磁盘 / S3 / GCS                       │  │
│  │  - 索引:  BoltDB / Cassandra / DynamoDB              │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 数据存储模型

```
日志流（Log Stream）= 一组标签 + 日志条目序列

标签（Labels）：
  {app="laravel", env="production", host="web-01", level="error"}

日志条目（Log Entry）：
  timestamp: 2026-06-02T10:30:45.123Z
  line: {"message":"SQLSTATE[HY000]: General error","level":"error",...}

Chunk（日志块）：
  - 同一个日流的连续日志条目被压缩存储
  - 典型大小：1-10MB（压缩后）
  - 存储格式：GZIP 或 Snappy 压缩的 JSON
```

### 2.3 标签设计原则

标签是 Loki 的核心，好的标签设计直接决定了查询性能和存储成本：

```
✅ 好的标签（低基数）：
  app="laravel"
  env="production"
  host="web-01"
  level="error"
  service="api"

❌ 坏的标签（高基数）：
  user_id="12345"        # 用户数量级，标签会爆炸
  request_id="abc-def"   # 每个请求一个标签，完全不可行
  url="/api/users/12345" # URL 路径，无限种可能

规则：标签的可选值应该在 10-1000 之间
```

---

## 三、部署实战：Docker Compose 全栈部署

### 3.1 目录结构

```
loki-stack/
├── docker-compose.yml
├── loki/
│   ├── loki-config.yml
│   └── rules/
│       └── alerts.yml
├── promtail/
│   └── promtail-config.yml
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       │   └── loki.yml
│       └── dashboards/
│           └── loki.yml
└── logs/
    └── laravel/
        └── laravel.log
```

### 3.2 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ============ Loki ============
  loki:
    image: grafana/loki:3.0.0
    container_name: loki
    ports:
      - "3100:3100"
    volumes:
      - ./loki/loki-config.yml:/etc/loki/local-config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--output-document=-", "http://localhost:3100/ready"]
      interval: 15s
      timeout: 5s
      retries: 5

  # ============ Promtail ============
  promtail:
    image: grafana/promtail:3.0.0
    container_name: promtail
    volumes:
      - ./promtail/promtail-config.yml:/etc/promtail/config.yml
      - /var/log:/var/log:ro
      - ./logs:/var/log/app:ro
      - promtail-positions:/positions
    command: -config.file=/etc/promtail/config.yml
    restart: unless-stopped
    depends_on:
      loki:
        condition: service_healthy

  # ============ Grafana ============
  grafana:
    image: grafana/grafana:11.0.0
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=secure_password
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    restart: unless-stopped
    depends_on:
      loki:
        condition: service_healthy

volumes:
  loki-data:
  promtail-positions:
  grafana-data:
```

### 3.3 Loki 配置

```yaml
# loki/loki-config.yml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096
  log_level: info

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

query_range:
  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 100

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  # 标签限制
  max_label_name_length: 1024
  max_label_value_length: 2048
  max_label_names_per_series: 30
  
  # 查询限制
  max_query_series: 5000
  max_query_parallelism: 32
  
  # 每用户速率限制
  per_stream_rate_limit: 5MB
  per_stream_rate_limit_burst: 15MB
  ingestion_rate_mb: 10
  ingestion_burst_size_mb: 20
  
  # 保留策略
  retention_period: 30d  # 日志保留 30 天

compactor:
  working_directory: /loki/compactor
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150
  delete_request_store: filesystem

analytics:
  reporting_enabled: false
```

### 3.4 Promtail 配置

```yaml
# promtail/promtail-config.yml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /positions/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # ============ Laravel 应用日志 ============
  - job_name: laravel
    static_configs:
      - targets:
          - localhost
        labels:
          app: laravel
          env: production
          __path__: /var/log/app/laravel/*.log

    pipeline_stages:
      # Laravel 日志通常是 JSON 格式或多行格式
      # 先尝试 JSON 解析
      - json:
          expressions:
            level: level_name
            message: message
            context: context
            channel: channel
            datetime: datetime

      # 如果不是 JSON，使用正则解析 Laravel 默认日志格式
      - match:
          selector: '{app="laravel"}'
          stages:
            - regex:
                expression: '^\[(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (?P<channel>\w+)\.(?P<level>\w+): (?P<message>.*)'
            
      # 设置日志级别标签
      - labels:
          level:
          channel:
      
      # 时间戳解析
      - timestamp:
          source: datetime
          format: '2006-01-02T15:04:05.000000Z'
          fallback_formats:
            - '2006-01-02 15:04:05'
      
      # 敏感字段脱敏
      - replace:
          expression: '(password|token|secret|api_key)["\s:=]+\S+'
          replace: '$1=***REDACTED***'

  # ============ Nginx 访问日志 ============
  - job_name: nginx-access
    static_configs:
      - targets:
          - localhost
        labels:
          app: nginx
          log_type: access
          __path__: /var/log/nginx/access.log

    pipeline_stages:
      - regex:
          expression: '^(?P<remote_addr>[\d\.]+) - (?P<remote_user>\S+) \[(?P<time_local>.+)\] "(?P<method>\w+) (?P<request_uri>\S+) (?P<protocol>[^"]+)" (?P<status>\d+) (?P<body_bytes_sent>\d+) "(?P<http_referer>[^"]*)" "(?P<http_user_agent>[^"]*)"'
      - labels:
          method:
          status:
      - timestamp:
          source: time_local
          format: '02/Jan/2006:15:04:05 -0700'

  # ============ 系统日志 ============
  - job_name: syslog
    static_configs:
      - targets:
          - localhost
        labels:
          app: syslog
          __path__: /var/log/syslog

  # ============ Docker 容器日志 ============
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
        filters:
          - name: label
            values: ["logging=enabled"]
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'service'
    pipeline_stages:
      - docker: {}
```

### 3.5 Grafana 数据源配置

```yaml
# grafana/provisioning/datasources/loki.yml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    jsonData:
      maxLines: 1000
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "trace_id=(\\w+)"
          name: TraceID
          url: '$${__value.raw}'
```

---

## 四、Laravel 日志采集配置

### 4.1 Laravel 日志格式配置

Laravel 支持多种日志格式，推荐使用 JSON 格式便于 Loki 解析：

```php
// config/logging.php
return [
    'default' => env('LOG_CHANNEL', 'stack'),
    
    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => ['single', 'loki'],
            'ignore_exceptions' => false,
        ],
        
        // Loki 专用通道 - JSON 格式
        'loki' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.json'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => 14,
            'replace_placeholders' => true,
            'formatter' => \Monolog\Formatter\JsonFormatter::class,
        ],
        
        // 错误单独一个文件
        'error' => [
            'driver' => 'daily',
            'path' => storage_path('logs/error.json'),
            'level' => 'error',
            'days' => 30,
            'formatter' => \Monolog\Formatter\JsonFormatter::class,
        ],
    ],
];
```

### 4.2 自定义日志处理器——添加上下文信息

```php
<?php

namespace App\Logging;

use Monolog\Processor\ProcessorInterface;

class LaravelContextProcessor implements ProcessorInterface
{
    public function __invoke(array $record): array
    {
        // 添加请求上下文
        if (app()->bound('request')) {
            $request = request();
            $record['extra']['request'] = [
                'method' => $request->method(),
                'url' => $request->fullUrl(),
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'request_id' => $request->header('X-Request-ID', uniqid()),
            ];
            
            // 用户信息（脱敏）
            if ($user = $request->user()) {
                $record['extra']['user'] = [
                    'id' => $user->id,
                    // 不要记录 email、phone 等敏感信息到日志
                ];
            }
        }
        
        // 添加应用上下文
        $record['extra']['app'] = [
            'name' => config('app.name'),
            'env' => config('app.env'),
            'version' => config('app.version', 'unknown'),
        ];
        
        // 添加性能指标
        $record['extra']['performance'] = [
            'memory_usage' => memory_get_usage(true),
            'peak_memory' => memory_get_peak_usage(true),
        ];
        
        return $record;
    }
}
```

注册处理器：

```php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    // 添加全局日志处理器
    $this->app->make('log')
        ->pushProcessor(new \App\Logging\LaravelContextProcessor());
}
```

### 4.3 敏感字段脱敏

日志中的敏感数据是合规审计的重点：

```php
<?php

namespace App\Logging;

use Monolog\Processor\ProcessorInterface;

class SanitizeProcessor implements ProcessorInterface
{
    // 需要脱敏的字段
    protected array $sensitiveKeys = [
        'password', 'password_confirmation',
        'token', 'api_key', 'api_secret',
        'access_token', 'refresh_token',
        'credit_card', 'card_number', 'cvv',
        'ssn', 'social_security',
        'secret', 'private_key',
    ];
    
    // 匹配敏感值的正则
    protected array $sensitivePatterns = [
        '/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/',  // 信用卡号
        '/\b\d{3}-\d{2}-\d{4}\b/',                          // SSN
        '/bearer\s+[a-zA-Z0-9\-._~+\/]+=*/i',              // Bearer token
    ];
    
    public function __invoke(array $record): array
    {
        $record['context'] = $this->sanitize($record['context']);
        $record['extra'] = $this->sanitize($record['extra']);
        $record['message'] = $this->sanitizeString($record['message']);
        
        return $record;
    }
    
    protected function sanitize(array $data): array
    {
        foreach ($data as $key => &$value) {
            if (is_array($value)) {
                $value = $this->sanitize($value);
            } elseif (is_string($value)) {
                foreach ($this->sensitiveKeys as $sensitiveKey) {
                    if (stripos($key, $sensitiveKey) !== false) {
                        $value = '***REDACTED***';
                        break;
                    }
                }
                $value = $this->sanitizeString($value);
            }
        }
        return $data;
    }
    
    protected function sanitizeString(string $value): string
    {
        foreach ($this->sensitivePatterns as $pattern) {
            $value = preg_replace($pattern, '***REDACTED***', $value);
        }
        return $value;
    }
}
```

---

## 五、LogQL 查询语法实战

### 5.1 标签过滤

LogQL 的基本语法是 `{标签选择器}`：

```logql
# 基本标签过滤
{app="laravel"}

# 多标签组合
{app="laravel", env="production"}

# 正则匹配标签值
{app="laravel", host=~"web-.*"}

# 排除特定标签值
{app="laravel", env!="dev"}

# 正则排除
{app="laravel", host!~"test-.*"}
```

### 5.2 行过滤

```logql
# 包含关键词
{app="laravel"} |= "SQLSTATE"

# 不包含关键词
{app="laravel"} != "healthcheck"

# 正则匹配
{app="laravel"} |~ `exception.*\d{3}`

# 正则排除
{app="laravel"} !~ `debug|info`

# 多个过滤条件（AND 关系）
{app="laravel"} |= "error" != "timeout"
```

### 5.3 日志格式解析

```logql
# JSON 解析
{app="laravel"} | json

# 解析后过滤特定字段
{app="laravel"} | json | level="error"

# 正则解析
{app="nginx"} | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>`

# 解析后过滤
{app="nginx"} | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>` | status >= 500

# URL 编码解码
{app="laravel"} | json | line_format `{{ .request_uri }} | urldecode`
```

### 5.4 指标提取

从日志中提取数值指标：

```logql
# 统计每分钟错误数量
count_over_time({app="laravel", level="error"}[1m])

# 统计不同状态码的分布
count by (status) (
  {app="nginx"} 
  | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>` 
  | __error__ = ""
)

# 计算响应时间的 P95
quantile_over_time(0.95,
  {app="laravel"} 
  | json 
  | __error__ = "" 
  | unwrap duration_ms 
  [5m]
)

# 速率计算（每秒请求数）
rate({app="nginx"}[1m])

# 按 URL 路径分组的请求速率
sum by (uri) (
  rate(
    {app="nginx"} 
    | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>` 
    [5m]
  )
)
```

### 5.5 高级查询示例

```logql
# Laravel 慢查询（响应时间 > 1000ms）
{app="laravel"} | json | duration_ms > 1000 | line_format `{{.request.method}} {{.request.url}} took {{.duration_ms}}ms`

# 按用户统计错误（找出问题用户）
sum by (user_id) (
  count_over_time(
    {app="laravel", level="error"} | json | user_id != "" [1h]
  )
) > 5

# Nginx 5xx 错误的请求体
{app="nginx"} 
  | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>` 
  | status >= 500 
  | line_format `[{{.ip}}] {{.method}} {{.uri}} → {{.status}}`

# 链路追踪：根据 request_id 串联日志
{app=~"laravel|nginx"} | json | request_id="abc-123-def"
```

---

## 六、告警配置

### 6.1 Grafana Alerting 规则

```yaml
# loki/rules/alerts.yml
groups:
  - name: laravel-alerts
    interval: 1m
    rules:
      # 错误率告警
      - alert: HighErrorRate
        expr: |
          sum(rate({app="laravel", level="error"}[5m])) 
          / 
          sum(rate({app="laravel"}[5m])) 
          > 0.05
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Laravel 错误率超过 5%"
          description: "当前错误率: {{ $value | humanizePercentage }}"
      
      # 慢请求告警
      - alert: SlowRequests
        expr: |
          quantile_over_time(0.95,
            {app="laravel"} | json | unwrap duration_ms [5m]
          ) > 2000
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "P95 响应时间超过 2 秒"
      
      # 特定异常告警
      - alert: DatabaseConnectionError
        expr: |
          count_over_time(
            {app="laravel"} |= "SQLSTATE[HY000]" [5m]
          ) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "数据库连接错误频发"
      
      # Nginx 5xx 告警
      - alert: Nginx5xxErrors
        expr: |
          sum(rate(
            {app="nginx"} 
            | pattern `<ip> - - [<ts>] "<method> <uri> <_>" <status> <size>` 
            | status >= 500 
            [5m]
          )) > 10
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "Nginx 5xx 错误率过高"

  - name: infrastructure-alerts
    interval: 1m
    rules:
      # 日志量异常（可能是日志风暴）
      - alert: LogStorm
        expr: |
          sum(rate({app="laravel"}[5m])) > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "日志量异常高，可能存在日志风暴"
```

### 6.2 通知渠道配置

```yaml
# Grafana Contact Points（通过 UI 或 API 配置）
# Slack 通知
contact_points:
  - name: slack-backend
    slack:
      url: https://hooks.slack.com/services/xxx/yyy/zzz
      title: |
        {{ len .Alerts.Firing }} alert(s) firing
      text: |
        {{ range .Alerts }}
        *{{ .Labels.alertname }}*
        {{ .Annotations.summary }}
        {{ end }}

# 钉钉通知
  - name: dingtalk-backend
    webhook_configs:
      - url: https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN
        send_resolved: true
```

---

## 七、查询性能优化

### 7.1 标签设计最佳实践

```
✅ 推荐的标签设计：
  app="laravel"           # 应用名
  env="production"        # 环境
  host="web-01"          # 主机名
  level="error"          # 日志级别
  service="api"          # 服务名
  region="ap-southeast"  # 地域

标签值数量控制：
  app: ~5-20 个应用
  env: 3-5 个环境
  host: 10-100 台主机
  level: 5-8 个级别
  这些都是低基数，非常适合做标签

❌ 避免的高基数标签：
  user_id: 百万级
  request_id: 无限
  session_id: 百万级
  url_path: 无限种可能
```

### 7.2 查询优化技巧

```logql
# ❌ 慢查询：没有标签过滤，全量扫描
| json | duration_ms > 1000

# ✅ 快查询：先过滤标签
{app="laravel", env="production"} | json | duration_ms > 1000

# ❌ 慢查询：大时间范围
{app="laravel"} |= "error"  # 查 7 天

# ✅ 快查询：缩小时间范围
{app="laravel"} |= "error"  # 只查最近 1 小时

# ❌ 慢查询：正则过于复杂
{app="laravel"} |~ `.*(?:error|exception|fatal|critical).*`

# ✅ 快查询：使用多个简单过滤
{app="laravel", level="error"} |= "exception"
```

### 7.3 Chunk 存储配置优化

```yaml
# loki-config.yml 中的存储优化
chunk_store_config:
  chunk_cache_config:
    embedded_cache:
      enabled: true
      max_size_mb: 500

# Ingester 配置
ingester:
  chunk_idle_period: 30m      # 30分钟无新日志就刷写
  chunk_retain_period: 1m     # 刷写后保留1分钟供查询
  chunk_target_size: 1536000  # 目标 chunk 大小 ~1.5MB
  max_chunk_age: 2h           # 最大 chunk 年龄
  chunk_encoding: snappy      # 压缩算法（snappy 比 gzip 更快）
```

---

## 八、Loki vs ELK vs ClickHouse 日志方案对比

| 维度 | ELK (Elasticsearch) | Loki | ClickHouse |
|-----|-------------------|------|------------|
| **索引方式** | 全文倒排索引 | 标签索引 | 列式存储 |
| **存储成本** | 高（索引膨胀） | 低（只存标签） | 中（列压缩） |
| **内存需求** | 高（224GB+） | 低（16-32GB） | 中（64GB） |
| **查询能力** | 强（全文搜索） | 中（标签+行过滤） | 强（SQL分析） |
| **查询延迟** | 快（精确查询） | 中（精确标签快） | 快（聚合分析） |
| **全文搜索** | 强 | 弱 | 中 |
| **聚合分析** | 中 | 弱 | 强 |
| **运维复杂度** | 高 | 低 | 中 |
| **生态集成** | 成熟 | Grafana 生态 | 独立 |
| **适用场景** | 复杂日志分析 | 可观测性日志 | 大规模分析 |

**选型建议：**

- **ELK**：需要复杂全文搜索、日志分析是核心业务（如安全审计）
- **Loki**：已使用 Grafana 生态、资源有限、日志主要用于可观测性
- **ClickHouse**：超大规模日志（TB级/天）、需要复杂 SQL 分析

---

## 九、生产环境踩坑记录

### 9.1 高基数标签陷阱

**问题描述：** Promtail 配置中不小心将 `request_uri` 设为了标签，导致 Loki 内存暴涨、查询变慢。

```yaml
# ❌ 错误配置
- labels:
    request_uri:  # 每个 URL 都是一个标签值！
```

**原因：** Loki 在内存中维护标签索引，高基数标签会导致索引爆炸。

**解决方案：**
```yaml
# ✅ 正确配置：只用低基数字段做标签
- labels:
    app: laravel
    level: error
    host: web-01
# request_uri 通过日志内容搜索，不作为标签
```

### 9.2 查询性能调优

**问题描述：** 某个 LogQL 查询扫描了 3 天的日志数据，查询超时。

```logql
# ❌ 慢查询
{app="laravel"} |= "SQLSTATE" | json | status="500"
# Loki 需要扫描所有 laravel 日志来查找包含 SQLSTATE 的行
```

**优化方案：**

```logql
# ✅ 优化 1：缩小时间范围
{app="laravel", level="error"} |= "SQLSTATE" | json | status="500"

# ✅ 优化 2：使用标签预先过滤
{app="laravel", level="error", channel="database"} |= "SQLSTATE"

# ✅ 优化 3：在 Promtail 端提取更多标签
pipeline_stages:
  - json:
      expressions:
        level: level_name
        channel: channel
  - labels:
      level:
      channel:
```

### 9.3 存储成本控制

**问题描述：** 日志量增长到每天 200GB，存储成本快速上升。

**解决方案：**

```yaml
# 1. 分层存储策略
# 热数据（7天）：本地 SSD
# 温数据（30天）：对象存储 S3
# 冷数据（90天）：S3 Glacier

# 2. 日志采样（对高频低价值日志）
pipeline_stages:
  - match:
      selector: '{app="laravel", level="debug"}'
      stages:
        - limit:
            rate: 100        # debug 日志每秒最多 100 条
            burst: 200
            drop: true       # 超过限制的直接丢弃

# 3. 合理设置保留期
limits_config:
  retention_period: 30d  # 默认 30 天

# 4. 不同日志级别设置不同保留期（需要多个 tenant 或使用 compactor 规则）
```

### 9.4 Promtail 日志文件轮转问题

**问题描述：** Laravel 使用 `daily` 日志驱动，每天轮转文件。Promtail 在文件轮转时偶尔丢失日志。

**解决方案：**

```yaml
# promtail-config.yml
positions:
  filename: /positions/positions.yaml
  sync_period: 10s  # 每 10 秒同步一次位置（降低丢失窗口）

scrape_configs:
  - job_name: laravel
    static_configs:
      - targets:
          - localhost
        labels:
          app: laravel
          __path__: /var/log/app/laravel/*.log  # 使用通配符匹配所有日志文件
    filewatch:
      min_poll_frequency: 250ms
      max_poll_frequency: 250ms
```

---

## 十、Grafana Dashboard 可视化

### 10.1 日志概览面板

在 Grafana 中创建 Dashboard，关键面板包括：

```
面板1: 日志量趋势（折线图）
  查询: sum(rate({app="laravel"}[1m])) by (level)
  展示: 不同日志级别的每秒条数

面板2: 错误率（仪表盘）
  查询: 
    sum(rate({app="laravel", level="error"}[5m]))
    / sum(rate({app="laravel"}[5m]))
  展示: 错误率百分比

面板3: Top 10 错误消息（表格）
  查询:
    topk(10,
      sum by (message) (
        count_over_time({app="laravel", level="error"} | json [1h])
      )
    )
  展示: 最常见的错误消息

面板4: 慢请求分布（直方图）
  查询:
    {app="laravel"} | json | unwrap duration_ms | __error__=""
  展示: 响应时间分布

面板5: 实时日志流（Logs 面板）
  查询: {app="laravel", level="error"}
  展示: 实时错误日志流
```

---

## 十一、总结

Loki 通过"只索引标签"的设计哲学，在保证足够查询能力的前提下，将日志系统的资源消耗降低了 1-2 个数量级。对于已经使用 Grafana 生态的团队来说，Loki 是一个天然的、低成本的日志解决方案。

### 核心建议

1. **标签设计是关键**：低基数标签提升查询性能，避免高基数标签
2. **JSON 格式优先**：结构化日志让 Loki 的解析和过滤更高效
3. **脱敏必须做**：日志是合规审计的重点，敏感数据绝不能出现在日志中
4. **分层存储**：热数据用 SSD，冷数据用对象存储，控制成本
5. **告警前置**：基于日志的告警比用户投诉更早发现问题

---

> **参考资料：**
> - [Grafana Loki 官方文档](https://grafana.com/docs/loki/latest/)
> - [LogQL 查询语言](https://grafana.com/docs/loki/latest/query/)
> - [Promtail 配置](https://grafana.com/docs/loki/latest/clients/promtail/)
> - [Loki Best Practices](https://grafana.com/docs/loki/latest/best-practices/)

## 相关阅读

- [Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成](/categories/运维/2026-06-02-sentry-error-tracking-performance-monitoring-session-replay-laravel/)
- [监控告警实战：Prometheus + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
- [OpenTelemetry 实战：统一可观测性——Laravel 全栈链路追踪与指标采集](/categories/运维/2026-06-02-opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [SLO/SLI 实战：用服务等级目标驱动可靠性](/categories/运维/SLO-SLI-实战/)
