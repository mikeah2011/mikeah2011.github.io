# Grafana Loki 日志聚合

## 定义

Grafana Loki 是 Grafana Labs 开发的轻量级日志聚合系统，设计哲学是"like Prometheus, but for logs"。与 ELK（Elasticsearch + Logstash + Kibana）不同，Loki 不对日志内容做全文索引，仅索引标签（Label），因此内存和存储开销远低于 Elasticsearch，被广泛称为"穷人的 ELK 替代方案"。

## 核心原理

### 架构组件
- **Promtail / Alloy / Fluentd**：日志采集代理，负责从应用/容器/syslog 收集日志并附加标签后推送到 Loki
- **Loki Server**：日志存储与查询引擎，包含 Distributor（接收）、Ingester（写入）、Querier（查询）
- **Grafana**：可视化查询界面，使用 LogQL 查询日志

### LogQL 查询语言
LogQL 是 Loki 的查询语言，分为日志查询和指标查询两部分：

```logql
# 基础标签过滤
{app="laravel", env="production"}

# 日志内容过滤（管道语法）
{app="laravel"} |= "error" | logfmt | duration > 1s

# 正则匹配
{app="laravel"} |~ "SQLSTATE\\[HY000\\]"

# 从日志中提取字段并计算指标
sum(rate({app="laravel"} |= "error" [5m])) by (level)
```

### 标签设计原则
标签是 Loki 的核心，直接影响查询性能和存储成本：

- **低基数优先**：`app="laravel"`, `env="production"`, `host="web-01"` ✅
- **避免高基数**：`user_id="12345"`, `request_id="uuid"` ❌（会产生大量流，导致内存爆炸）
- **黄金标签组合**：`app` + `env` + `level` + `host` + `job`

### 与 ELK 对比

| 维度 | ELK (Elasticsearch) | Grafana Loki |
|---|---|---|
| 索引策略 | 全文索引，查询快但存储贵 | 仅索引标签，存储省但需过滤 |
| 内存占用 | 高（JVM Heap） | 低（Go 原生） |
| 查询能力 | 强大的 KQL/Kibana | LogQL，够用但不如 ES |
| 运维复杂度 | 高（分片/副本/ILM） | 低（单二进制即可运行） |
| 成本 | 高 | 低（约 ELK 的 1/5~1/10） |

### 日志采集配置（Promtail）

```yaml
scrape_configs:
  - job_name: laravel
    static_configs:
      - targets: [localhost]
        labels:
          job: laravel
          app: b2c-api
          __path__: /var/www/html/storage/logs/laravel.log
    pipeline_stages:
      - regex:
          expression: '\\[(?P<level>\\w+)\\].*?(?P<message>.*)'
      - labels:
          level:
```

## 最佳实践

### Laravel 日志集成
Laravel 默认使用 Monolog，可配置为 JSON 格式输出以便 Loki 解析：

```php
// config/logging.php
'channels' => [
    'production' => [
        'driver' => 'monolog',
        'handler' => StreamHandler::class,
        'formatter' => JsonFormatter::class,
        'tap' => [AddRequestIdToLog::class],
    ],
]
```

### 日志保留策略
Loki 支持基于时间和大小的日志保留：
- **hot 存储**：最近 7 天，SSD，快速查询
- **warm 存储**：7-30 天，HDD，偶尔查询
- **cold/归档**：30 天以上，S3/GCS，仅审计用途

## 实战案例

来自博客文章：
- [Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化](/2026/06/02/grafana-loki-lightweight-log-aggregation-laravel/) — 完整的 Loki 部署与 Laravel 日志采集方案

## 相关概念

- [Prometheus 监控告警](Prometheus监控告警.md) — 指标与日志的关联分析
- [OpenTelemetry 可观测性](OpenTelemetry可观测性.md) — 统一的可观测性标准
- [Docker 容器化](Docker容器化.md) — 容器日志的采集与管理

## 常见问题

### 日志量太大导致 Loki OOM
- 优化标签设计，减少流的数量
- 配置 `chunk_target_size` 和 `max_chunk_age` 控制内存使用
- 使用 `reject_old_samples` 丢弃过期日志

### 查询速度慢
- 缩小时间范围（Loki 按块扫描）
- 添加更多标签过滤条件减少扫描范围
- 配置 `query_range.cache_results` 启用查询缓存
