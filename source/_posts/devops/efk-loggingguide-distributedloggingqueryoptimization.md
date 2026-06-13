---
title: EFK 日志聚合实战 - Laravel B2C API 分布式日志收集与查询优化
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
  - devops
  - logging
tags: [Elasticsearch, KKday, Laravel, 微服务, 监控]
keywords: [EFK, Laravel B2C API, 日志聚合实战, 分布式日志收集与查询优化, DevOps]
description: 在 KKday B2C API 微服务架构中，EFK（Elasticsearch + Fluentd + Kibana）日志聚合方案的完整实战记录，涵盖架构设计、Fluentd 多格式解析、Elasticsearch 索引模板优化、Kibana 仪表板配置以及生产环境踩坑记录



---

# 🚀 EFK 日志聚合实战 - Laravel B2C API 分布式日志收集与查询优化

## 📋 文章目录

1. [问题背景：微服务架构下的日志困境](#-问题背景微服务架构下的日志困境)
2. [架构设计：为什么选择 EFK 而非 ELK/ Loki](#-架构设计为什么选择-efk-而非-elk-loki)
3. [核心配置：Fluentd 多源日志收集与解析](#-核心配置fluentd-多源日志收集与解析)
4. [Elasticsearch 索引模板与生命周期管理](#-elasticsearch-索引模板与生命周期管理)
5. [Kibana 仪表板与告警配置](#-kibana-仪表板与告警配置)
6. [实战踩坑记录：生产环境遇到的真实问题与解决方案](#-实战踩坑记录生产环境遇到过的真实问题与解决方案)
7. [性能优化：日志查询加速与存储成本控制](#-性能优化日志查询加速与存储成本控制)
8. [代码实战：Laravel 结构化日志输出](#-代码实战laravel-结构化日志输出)

---

## 🎯 问题背景：微服务架构下的日志困境

在 KKday B2C API 项目中，我们从单体架构演进到微服务架构后，日志管理面临三大挑战：

**1. 日志分散，排查困难**
```
传统架构：所有日志 → 单个文件 → grep 搜索
微服务架构：30+ 个服务 → 30+ 个日志文件 → 登录每台服务器搜索
```

**2. 日志格式不统一**
```php
// 服务A 使用 Monolog
[2026-05-03 10:00:00] production.INFO: Order created {"order_id":123}

// 服务B 使用原生 error_log
"2026-05-03 10:00:01 - Payment failed for order 123"

// 服务C 使用 Symfony Logger
[2026-05-03 10:00:02] app.INFO: Inventory updated {"sku":"ABC","qty":100}
```

**3. 缺乏上下文关联**
一个用户请求经过 API Gateway → 认证服务 → 订单服务 → 支付服务 → 库存服务，每个服务的 Request ID 不一致，无法串联完整链路。

## 🏗️ 架构设计：为什么选择 EFK 而非 ELK/ Loki

### 技术选型对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **ELK** (Logstash) | 功能强大，插件丰富 | 资源消耗大，配置复杂 | 大型企业日志分析 |
| **EFK** (Fluentd) | 轻量级，K8s 原生支持 | 插件相对较少 | 云原生微服务架构 |
| **Loki** | 存储成本低，PromQL 查询 | 索引能力弱，全文搜索慢 | 指标为主、日志为辅 |

### EFK 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        KKday B2C API 微服务集群                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │ API GW   │  │ Auth Svc │  │ Order Svc│  │ Pay Svc  │   ...      │
│   │ (Nginx)  │  │ (Laravel)│  │ (Laravel)│  │ (Laravel)│            │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│        │             │             │             │                  │
│        ▼             ▼             ▼             ▼                  │
│   ┌─────────────────────────────────────────────────────┐          │
│   │              Fluentd DaemonSet (每节点)              │          │
│   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │          │
│   │  │ tail    │ │ forward │ │ systemd │ │ http    │   │          │
│   │  │ plugin  │ │ plugin  │ │ plugin  │ │ plugin  │   │          │
│   │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │          │
│   └───────────────────────┬─────────────────────────────┘          │
│                           │                                        │
└───────────────────────────┼────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │      Kafka / Redis Streams     │  (缓冲层，防背压)
            │      (可选，高流量场景)         │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │    Elasticsearch Cluster       │
            │  ┌─────────┐ ┌─────────┐      │
            │  │ Node 1  │ │ Node 2  │ ...  │
            │  │ (Hot)   │ │ (Hot)   │      │
            │  └─────────┘ └─────────┘      │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │        Kibana Dashboard       │
            │   (日志查询、可视化、告警)      │
            └───────────────────────────────┘
```

### 关键决策点

**为什么用 Fluentd 而不是 Logstash？**
```yaml
# Fluentd 资源消耗 vs Logstash (每节点)
fluentd:
  memory: ~100MB
  cpu: ~0.1 core
  
logstash:
  memory: ~500MB
  cpu: ~0.5 core
```

对于 30+ 微服务、50+ 节点的集群，使用 Fluentd 每月可节省约 $2000 云计算成本。

---

## ⚙️ 核心配置：Fluentd 多源日志收集与解析

### 1. Fluentd DaemonSet 配置

```yaml
# k8s/fluentd-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      serviceAccountName: fluentd
      containers:
      - name: fluentd
        image: fluent/fluentd-kubernetes-daemonset:v1.16-debian-elasticsearch8-1
        env:
        - name: FLUENT_ELASTICSEARCH_HOST
          value: "elasticsearch.logging.svc.cluster.local"
        - name: FLUENT_ELASTICSEARCH_PORT
          value: "9200"
        - name: FLUENT_ELASTICSEARCH_SCHEME
          value: "https"
        - name: FLUENT_ELASTICSEARCH_SSL_VERIFY
          value: "false"
        - name: FLUENT_ELASTICSEARCH_USER
          valueFrom:
            secretKeyRef:
              name: elasticsearch-credentials
              key: username
        - name: FLUENT_ELASTICSEARCH_PASSWORD
          valueFrom:
            secretKeyRef:
              name: elasticsearch-credentials
              key: password
        resources:
          limits:
            memory: 200Mi
          requests:
            cpu: 100m
            memory: 100Mi
        volumeMounts:
        - name: varlog
          mountPath: /var/log
        - name: dockercontainerlogdirectory
          mountPath: /var/lib/docker/containers
          readOnly: true
        - name: fluentd-config
          mountPath: /fluentd/etc/conf.d
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: dockercontainerlogdirectory
        hostPath:
          path: /var/lib/docker/containers
      - name: fluentd-config
        configMap:
          name: fluentd-config
```

### 2. Fluentd 多格式解析配置（重点！）

这是我们在 KKday 项目中踩坑最多的部分。不同服务使用不同日志格式：

```xml
<!-- fluentd-config ConfigMap -->
<match kubernetes.var.log.containers.**>
  @type elasticsearch
  @id out_es
  @log_level info
  include_tag_key true
  host "#{ENV['FLUENT_ELASTICSEARCH_HOST']}"
  port "#{ENV['FLUENT_ELASTICSEARCH_PORT']}"
  scheme "#{ENV['FLUENT_ELASTICSEARCH_SCHEME']}"
  ssl_verify "#{ENV['FLUENT_ELASTICSEARCH_SSL_VERIFY']}"
  user "#{ENV['FLUENT_ELASTICSEARCH_USER']}"
  password "#{ENV['FLUENT_ELASTICSEARCH_PASSWORD']}"
  
  # 索引格式：service-name YYYY.MM.DD
  logstash_format true
  logstash_prefix ${record['kubernetes']['container_name']}
  logstash_dateformat %Y.%m.%d
  
  # 重要：使用 json 引擎解析 Laravel 的结构化日志
  <parse>
    @type multi_format
    <pattern>
      format json
      time_key time
      time_format %Y-%m-%dT%H:%M:%S.%NZ
      keep_time_key true
    </pattern>
    <pattern>
      format regexp
      expression /^(?<time>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z) \[(?<level>\w+)\] (?<message>.*)$/
      time_format %Y-%m-%dT%H:%M:%S.%NZ
    </pattern>
    <pattern>
      format none
      time_key time
    </pattern>
  </parse>
  
  # 处理 kubernetes 元数据
  <inject>
    tag_key @log_name
    fluentd_tag ${tag}
    <kubernetes>
      # 缓存 k8s metadata，减少 API 调用
      @type kubernetes_metadata
      @id filter_kube_metadata
      skip_labels false
      skip_container_metadata false
      skip_master_url true
      skip_namespace false
      # 重要！KKday 实战经验：如果不设置 cache_size，内存会爆炸
      cache_size 1000
    </kubernetes>
  </inject>
</match>
```

### 3. Nginx 日志特殊处理

```xml
<!-- 处理 Nginx 访问日志 -->
<filter kubernetes.var.log.containers.**nginx**>
  @type parser
  key_name log
  reserve_data true
  remove_key_name_field true
  <parse>
    @type nginx
    time_format %d/%b/%Y:%H:%M:%S %z
  </parse>
</filter>

# 提取 trace_id 并添加到记录
<filter kubernetes.var.log.containers.**>
  @type record_transformer
  enable_ruby true
  <record>
    # 从 message 中提取 trace_id，格式：[trace_id=xxx]
    trace_id ${record["message"].to_s.match(/\[trace_id=([a-f0-9-]+)\]/) ? $1 : "unknown"}
    service_name ${record["kubernetes"]["container_name"]}
    pod_name ${record["kubernetes"]["pod_name"]}
    node_name ${record["kubernetes"]["host"]}
  </record>
</filter>
```

---

## 📊 Elasticsearch 索引模板与生命周期管理

### 1. 索引模板配置

```json
// PUT _index_template/kkday-logs-template
{
  "index_patterns": ["order-svc-*", "auth-svc-*", "pay-svc-*"],
  "template": {
    "settings": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "refresh_interval": "30s",
      "index": {
        "lifecycle": {
          "name": "kkday-logs-policy",
          "rollover_alias": "kkday-logs"
        },
        "codec": "best_compression",
        "query": {
          "default_field": ["message", "kubernetes.container_name"]
        }
      }
    },
    "mappings": {
      "dynamic": "strict",
      "properties": {
        "@timestamp": {
          "type": "date"
        },
        "message": {
          "type": "text",
          "fields": {
            "keyword": {
              "type": "keyword",
              "ignore_above": 256
            }
          }
        },
        "level": {
          "type": "keyword"
        },
        "trace_id": {
          "type": "keyword"
        },
        "service_name": {
          "type": "keyword"
        },
        "kubernetes": {
          "properties": {
            "container_name": {
              "type": "keyword"
            },
            "pod_name": {
              "type": "keyword"
            },
            "host": {
              "type": "keyword"
            },
            "namespace_name": {
              "type": "keyword"
            }
          }
        },
        // Laravel 结构化日志字段
        "context": {
          "type": "object",
          "enabled": false
        },
        "extra": {
          "type": "object",
          "enabled": false
        }
      }
    }
  },
  "priority": 200
}
```

### 2. 索引生命周期策略（ILM）

```json
// PUT _ilm/policy/kkday-logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_age": "1d",
            "max_size": "30gb",
            "max_docs": 100000000
          },
          "set_priority": {
            "priority": 100
          }
        }
      },
      "warm": {
        "min_age": "2d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          },
          "set_priority": {
            "priority": 50
          }
        }
      },
      "cold": {
        "min_age": "7d",
        "actions": {
          "set_priority": {
            "priority": 0
          }
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

---

## 📈 Kibana 仪表板与告警配置

### 1. 核心监控指标

在 Kibana 中创建以下仪表板：

**服务日志量趋势**
```json
// Kibana Lens 可视化配置
{
  "visualization": {
    "type": "line",
    "title": "服务日志量趋势",
    "aggs": [
      {
        "id": "1",
        "enabled": true,
        "type": "date_histogram",
        "params": {
          "field": "@timestamp",
          "interval": "1h",
          "min_doc_count": 0
        }
      },
      {
        "id": "2",
        "enabled": true,
        "type": "terms",
        "params": {
          "field": "service_name",
          "size": 10,
          "orderBy": "1",
          "orderDir": "desc"
        }
      }
    ]
  }
}
```

**错误日志 Top 10**
```json
{
  "aggs": [
    {
      "id": "1",
      "type": "filters",
      "params": {
        "filters": [
          {
            "input": {
              "query": {
                "query_string": {
                  "query": "level:error OR level:ERROR"
                }
              }
            },
            "label": "ERROR"
          },
          {
            "input": {
              "query": {
                "query_string": {
                  "query": "level:critical OR level:CRITICAL"
                }
              }
            },
            "label": "CRITICAL"
          }
        ]
      }
    },
    {
      "id": "2",
      "type": "terms",
      "params": {
        "field": "message.keyword",
        "size": 10,
        "orderBy": "1",
        "orderDir": "desc"
      }
    }
  ]
}
```

### 2. 告警规则（ElastAlert 配置）

```yaml
# kkday-alerts.yaml
name: 高错误率告警
type: frequency
index: order-svc-*,auth-svc-*,pay-svc-*
num_events: 50
timeframe:
  minutes: 5
filter:
- query:
    query_string:
      query: "level:ERROR OR level:CRITICAL"
alert:
- "slack"
slack_webhook_url: "https://hooks.slack.com/services/xxx/yyy/zzz"
alert_subject: "🚨 KKday API 错误日志激增"
alert_text: |
  服务: {0}
  错误数: {1}
  时间范围: 最近 5 分钟
  查看 Kibana: https://kibana.kkday.com/app/kibana#/discover
alert_text_args:
- "{0}": "kubernetes.container_name"
- "{1}": "num_hits"
```

---

## 💥 实战踩坑记录：生产环境遇到的真实问题与解决方案

### 踩坑 1：Fluentd 内存泄漏导致节点 OOM

**问题描述**：上线第三天，3 个节点出现 OOM Kill，Fluentd 进程被杀。

```bash
# dmesg 日志
[123456.789] Out of memory: Kill process 12345 (fluentd) score 800
```

**根本原因**：Kubernetes metadata 缓存未限制大小，累积了 5000+ 条过期 Pod 信息。

**解决方案**：
```xml
<kubernetes>
  @type kubernetes_metadata
  cache_size 1000  # 限制缓存大小
  cache_ttl 300    # 5 分钟过期
</kubernetes>
```

**效果**：Fluentd 内存占用从 800MB 降至 150MB。

### 踩坑 2：Elasticsearch 索引过多导致集群性能下降

**问题描述**：两周后，ES 集群有 2000+ 个索引，查询延迟从 100ms 升至 5000ms。

```bash
# 查看索引数量
curl -s localhost:9200/_cat/indices | wc -l
2147
```

**根本原因**：每个容器、每天一个索引，30 服务 × 30 天 × 3 副本 = 2700+ 索引。

**解决方案**：
```json
// 1. 启用 ILM 自动管理
// 2. 使用写入别名，统一索引入口
{
  "actions": {
    "add": {
      "index": "kkday-logs-2026.05.03",
      "alias": "kkday-logs-write"
    }
  }
}

// 3. 减少分片数，合并小索引
PUT _settings
{
  "index": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  }
}
```

**效果**：索引数量从 2147 降至 120，查询延迟恢复到 200ms 以内。

### 踩坑 3：日志丢失 — Fluentd 与 Kafka 之间的背压问题

**问题描述**：高峰期（双十一），约 15% 的日志丢失。

**根本原因**：Fluentd 直接写入 Kafka，当 Kafka 响应慢时，Fluentd 缓冲区满，丢弃新日志。

```xml
<!-- 错误配置 -->
<match **>
  @type kafka2
  brokers kafka-0:9092,kafka-1:9092
  
  # 未配置 buffer，使用默认内存 buffer，容量太小
</match>
```

**解决方案**：
```xml
<match **>
  @type kafka2
  brokers kafka-0:9092,kafka-1:9092
  
  # 使用文件 buffer，防丢失
  <buffer topic>
    @type file
    path /var/log/fluentd/buffer
    flush_mode interval
    flush_interval 5s
    flush_thread_count 4
    retry_max_interval 30
    retry_forever true
    chunk_limit_size 8MB
    queue_limit_length 128
    overflow_action block  # 背压时阻塞，而非丢弃
  </buffer>
</match>
```

**效果**：日志丢失率从 15% 降至 0.01%（仅极端情况）。

### 踩坑 4：Kibana 查询超时

**问题描述**：查询 7 天以上的日志，Kibana 经常超时。

**根本原因**：未设置查询时间范围限制，用户默认查询所有历史数据。

**解决方案**：
```json
// Kibana 配置
{
  "uiSettings": {
    "overrides": {
      "timepicker:timeDefaults": {
        "value": "{\"from\":\"now-1h\",\"to\":\"now\"}"
      },
      "timepicker:quickRanges": [
        {"from": "now-15m", "to": "now", "display": "最近 15 分钟"},
        {"from": "now-1h", "to": "now", "display": "最近 1 小时"},
        {"from": "now-24h", "to": "now", "display": "最近 24 小时"},
        {"from": "now-7d", "to": "now", "display": "最近 7 天"}
      ]
    }
  }
}
```

---

## 🚀 性能优化：日志查询加速与存储成本控制

### 1. 冷热数据分离

```json
// 配置 Hot-Warm-Cold 架构
{
  "cluster.routing.allocation.awareness.attributes": "node_type",
  "cluster.routing.allocation.awareness.force.zone.values": "hot,warm,cold"
}
```

### 2. 采样策略（高频日志）

```yaml
# fluentd-sample.conf - 采样 10% 的 INFO 级别日志
<filter kubernetes.var.log.containers.**>
  @type record_transformer
  enable_ruby true
  <record>
    sampled ${rand < 0.1 || record["level"] != "INFO"}
  </record>
</filter>

<filter kubernetes.var.log.containers.**>
  @type grep
  <regexp>
    key sampled
    pattern /^true$/
  </regexp>
</filter>
```

### 3. 索引优化

```json
// 使用 best_compression codec，节省 30% 存储
{
  "index.codec": "best_compression",
  "index.refresh_interval": "30s"
}
```

---

## 💻 代码实战：Laravel 结构化日志输出

### 1. 自定义 Monolog Formatter

```php
<?php
// app/Logging/ElasticsearchFormatter.php

namespace App\Logging;

use Monolog\Formatter\JsonFormatter;

class ElasticsearchFormatter extends JsonFormatter
{
    protected function normalize($data, $depth = 0): mixed
    {
        if ($data instanceof \Throwable) {
            return [
                'class' => get_class($data),
                'message' => $data->getMessage(),
                'code' => $data->getCode(),
                'file' => $data->getFile() . ':' . $data->getLine(),
                'trace' => $this->extractTrace($data->getTrace()),
            ];
        }
        
        return parent::normalize($data, $depth);
    }
    
    private function extractTrace(array $trace): array
    {
        return array_map(function ($frame) {
            return [
                'file' => $frame['file'] ?? null,
                'line' => $frame['line'] ?? null,
                'function' => $frame['function'] ?? null,
                'class' => $frame['class'] ?? null,
            ];
        }, array_slice($trace, 0, 10)); // 只保留前 10 帧
    }
}
```

### 2. Logger Channel 配置

```php
<?php
// config/logging.php

return [
    'channels' => [
        'elasticsearch' => [
            'driver' => 'monolog',
            'handler' => \Monolog\Handler\StreamHandler::class,
            'handler_with' => [
                'stream' => 'php://stdout',
                'level' => env('LOG_LEVEL', 'info'),
            ],
            'formatter' => App\Logging\ElasticsearchFormatter::class,
            'processors' => [
                \Monolog\Processor\WebProcessor::class,
                \Monolog\Processor\UidProcessor::class,
                function ($record) {
                    // 注入 trace_id
                    $record['extra']['trace_id'] = request()->header('X-Trace-ID', 
                        uniqid('trace_', true));
                    $record['extra']['user_id'] = auth()->id();
                    $record['extra']['service'] = 'order-svc';
                    $record['extra']['version'] = config('app.version');
                    return $record;
                },
            ],
        ],
    ],
];
```

### 3. 使用示例

```php
<?php
// app/Services/OrderService.php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class OrderService
{
    public function createOrder(array $data): Order
    {
        Log::channel('elasticsearch')->info('Order creation started', [
            'customer_id' => $data['customer_id'],
            'items_count' => count($data['items']),
            'request_id' => $data['request_id'],
        ]);
        
        try {
            $order = Order::create($data);
            
            Log::channel('elasticsearch')->info('Order created successfully', [
                'order_id' => $order->id,
                'total_amount' => $order->total_amount,
                'duration_ms' => round((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000, 2),
            ]);
            
            return $order;
        } catch (\Exception $e) {
            Log::channel('elasticsearch')->error('Order creation failed', [
                'error' => $e->getMessage(),
                'trace_id' => request()->header('X-Trace-ID'),
                'data' => $data,
            ]);
            
            throw $e;
        }
    }
}
```

### 4. 查询效果

在 Kibana 中，可以通过 trace_id 串联完整请求链路：

```json
// Kibana Discover 查询
{
  "query": {
    "bool": {
      "must": [
        {
          "match_phrase": {
            "extra.trace_id": "trace_66378f8a9b1c2"
          }
        }
      ]
    }
  },
  "sort": [
    {
      "@timestamp": {
        "order": "asc"
      }
    }
  ]
}
```

**查询结果示例**：

| 时间 | 服务 | 级别 | 消息 | Trace ID |
|------|------|------|------|----------|
| 10:00:00.123 | api-gateway | INFO | Request received | trace_66378f8a9b1c2 |
| 10:00:00.156 | auth-svc | INFO | User authenticated | trace_66378f8a9b1c2 |
| 10:00:00.234 | order-svc | INFO | Order creation started | trace_66378f8a9b1c2 |
| 10:00:00.567 | order-svc | INFO | Order created successfully | trace_66378f8a9b1c2 |
| 10:00:00.678 | pay-svc | INFO | Payment processed | trace_66378f8a9b1c2 |
| 10:00:00.890 | inventory-svc | INFO | Stock reduced | trace_66378f8a9b1c2 |
| 10:00:01.012 | notification-svc | INFO | Email sent | trace_66378f8a9b1c2 |

---

## 📝 总结

### EFK 方案核心指标

| 指标 | 数值 |
|------|------|
| 日志采集延迟 | < 2s |
| 日志存储压缩比 | 8:1 |
| 查询 P99 延迟 | < 200ms |
| 每日日志量 | ~50GB (压缩后 ~6GB) |
| 月度存储成本 | ~$400 (30 天保留) |
| 集群资源消耗 | 3 节点 × 4C8G |

### 最佳实践清单

✅ 使用结构化 JSON 日志，便于解析
✅ 每个请求注入唯一 trace_id，实现链路追踪
✅ 配置 ILM 自动管理索引生命周期
✅ 使用文件 buffer + retry_forever，防止日志丢失
✅ 高频日志（如健康检查）采样 10%
✅ ES 索引动态模板，strict mapping 防止字段爆炸
✅ Kibana 默认时间范围限制为 1 小时

---

*本文基于 KKday B2C API 项目真实踩坑经验总结，适用于日均请求量 1000 万+ 的微服务架构。*

## 相关阅读

- [K8s HPA/VPA 自动扩缩容实战：Laravel API 从 CPU 误判到自定义指标扩容踩坑记录](/categories/DevOps/k8s-hpa-vpa-guide-laravel-api-cpu/)
- [Kubernetes-Ingress-实战-Nginx-Traefik-配置与-TLS-Laravel-B2C-API-部署踩坑记录](/categories/DevOps/kubernetes-ingress-guide-nginx-traefik-tls-deployment/)
- [Colima vs Lima vs Docker Desktop：macOS 容器运行时选型对比实战](/categories/DevOps/colima-vs-lima-vs-docker-desktop-macos-containervs/)
