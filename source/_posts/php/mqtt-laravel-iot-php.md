---
title: 'MQTT + Laravel 实战：IoT 消息协议与 PHP 后端集成——设备数据采集、指令下发与规则引擎'
date: 2026-06-06 10:00:00
tags: [MQTT, Laravel, IoT, 消息队列, PHP, EMQX, Mosquitto]
keywords: [MQTT, Laravel, IoT, PHP, 消息协议与, 后端集成, 设备数据采集, 指令下发与规则引擎]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "MQTT + Laravel 实战指南：从 EMQX Broker 部署到 PHP 后端集成，详解 IoT 物联网场景下的设备数据采集、指令下发与规则引擎设计。涵盖 QoS 选型、Topic 规划、TLS 安全认证、Supervisor 守护进程、高可用扩展及 Prometheus 监控，附完整可运行代码与生产踩坑总结，助你构建可靠的 IoT 消息协议后端系统。"
---


## 一、前言：MQTT 在 IoT 架构中的地位与 Laravel 的对接需求

在物联网（IoT）体系架构中，设备与云端之间的通信协议选择直接决定了整个系统的可靠性、实时性与扩展能力。MQTT（Message Queuing Telemetry Transport）自 IBM 于 1999 年提出以来，已经成为 IoT 领域事实标准的轻量级消息传输协议。其设计初衷便是面向低带宽、高延迟、不稳定网络环境下的设备通信，协议头部最小仅 2 字节，这使得它在嵌入式设备、传感器网络等资源受限场景中表现卓越。

为什么选择 Laravel 作为 MQTT 的后端集成框架？首先，Laravel 拥有成熟的消息队列（Queue）体系、事件系统（Event System）和任务调度（Scheduler），这些基础设施天然适配 IoT 场景中的异步消息处理需求。其次，Laravel 的 Eloquent ORM 和 Migration 机制能够快速构建设备管理、数据存储、规则配置等业务模型。再者，Laravel 生态中已经出现了 `php-mqtt/laravel-client` 等成熟的 MQTT 客户端包，大大降低了集成门槛。

本文将从协议原理出发，以一个完整的工业物联网场景为背景，详细讲解如何在 Laravel 中实现设备数据采集（上行链路）、指令下发（下行链路）以及基于规则引擎的消息处理，涵盖从开发环境搭建到生产部署的全流程。

## 二、MQTT 协议核心概念深度解析

### 2.1 QoS（服务质量等级）

MQTT 定义了三个 QoS 等级，理解它们对于设计可靠的 IoT 系统至关重要：

- **QoS 0（At most once）**：消息最多送达一次，不保证送达，不会重试。适用于高频传感器数据上报（如每秒一次的温度采样），丢一两条数据不影响趋势分析。
- **QoS 1（At least once）**：消息至少送达一次，可能重复。接收方通过 PUBACK 确认。适用于设备状态变更、告警触发等场景，业务端需做幂等处理。
- **QoS 2（Exactly once）**：消息恰好送达一次，通过四次握手（PUBLISH → PUBREC → PUBREL → PUBCOMP）保证。适用于计费数据、指令下发确认等对精确性要求极高的场景，但开销最大。

在实际生产中，大多数 IoT 数据采集使用 QoS 1，关键控制指令使用 QoS 2，实时遥测数据使用 QoS 0。

### 2.2 Topic 设计模式

Topic 是 MQTT 消息路由的核心。良好的 Topic 设计应遵循以下原则：

```
# 推荐的层级结构
{区域}/{产品类型}/{设备ID}/{消息方向}/{数据类型}

# 示例
cn/east/sensor/DEV001/telemetry/temperature
cn/east/sensor/DEV001/commands/ota
cn/east/actuator/DEV002/status/online
cn/east/actuator/DEV002/commands/relay

# 通配符
+  — 匹配单层，如 cn/east/sensor/+/telemetry/temperature
#  — 匹配多层，如 cn/east/#
```

避免在 Topic 中使用 `$` 开头（系统保留），避免过深的层级嵌套（一般不超过 5 层），避免在 Topic 中传递业务数据。

### 2.3 Retained Messages、Last Will 与 Clean Session

- **Retained Messages**：Broker 会为设置了 Retain 标志的消息保留最后一条。当新客户端订阅该 Topic 时，立即收到最新状态。适用于设备的当前状态（在线/离线、最新读数等）。
- **Last Will and Testament（遗嘱消息）**：客户端在连接时预设一条"遗嘱"，当 Broker 检测到客户端异常断开时，自动发布该消息。常用于设备离线通知。
- **Clean Session**：设为 `false` 时，Broker 会为客户端持久化未确认的 QoS 1/2 消息和订阅关系。设备重连后可收到断线期间的消息。生产环境中的设备端通常设置 `cleanSession=false`。

## 三、环境搭建：Broker 部署与 Laravel 客户端选型

### 3.1 EMQX Broker 部署

EMQX 是一款高性能的开源 MQTT Broker，支持百万级并发连接。使用 Docker 快速部署：

```bash
docker run -d --name emqx \
  -p 1883:1883 \
  -p 8083:8083 \
  -p 8883:8883 \
  -p 18083:18083 \
  emqx/emqx:5.5
```

- `1883`：标准 MQTT 端口
- `8883`：MQTT over TLS 端口
- `8083`：MQTT over WebSocket 端口
- `18083`：EMQX Dashboard 管理界面

如果项目规模较小或仅用于开发测试，Mosquitto 是更轻量的选择：

```bash
docker run -d --name mosquitto \
  -p 1883:1883 \
  -v ./mosquitto/config:/mosquitto/config \
  -v ./mosquitto/data:/mosquitto/data \
  eclipse-mosquitto:2
```

### 3.2 Laravel MQTT 客户端库选型

推荐使用 `php-mqtt/laravel-client`，它是 `php-mqtt/client` 的 Laravel 封装，提供了优雅的集成方式：

```bash
composer require php-mqtt/laravel-client
```

发布配置文件：

```bash
php artisan vendor:publish --provider="PhpMqtt\Client\MqttClientServiceProvider"
```

配置文件 `config/mqtt-client.php` 的核心内容：

```php
return [
    'connections' => [
        'emqx' => [
            'host'               => env('MQTT_HOST', '127.0.0.1'),
            'port'               => env('MQTT_PORT', 1883),
            'protocol'           => PhpMqtt\Client\Connection\MqttProtocol::MQTT_3_1_1,
            'username'           => env('MQTT_USERNAME', ''),
            'password'           => env('MQTT_PASSWORD', ''),
            'client_id'          => env('MQTT_CLIENT_ID', 'laravel-backend'),
            'keep_alive_interval'=> 60,
            'quality_of_service' => \PhpMqtt\Client\MqttClient::QOS_AT_LEAST_ONCE,
            'clean_session'      => true,
            'tls'                => [
                'enabled' => env('MQTT_TLS_ENABLED', false),
                'ca_file' => env('MQTT_TLS_CA_FILE'),
            ],
        ],
    ],
];
```

### 3.3 验证连通性

在 Laravel 中快速测试 Broker 连通性：

```php
// routes/console.php
use PhpMqtt\Client\Facades\MQTT;

Artisan::command('mqtt:test', function () {
    $mqtt = MQTT::connection('emqx');
    $mqtt->connect();
    $this->info('MQTT connected: ' . ($mqtt->isConnected() ? 'YES' : 'NO'));
    $mqtt->publish('test/hello', json_encode(['msg' => 'Hello from Laravel']), MqttClient::QOS_AT_LEAST_ONCE);
    $this->info('Message published.');
    $mqtt->disconnect();
});
```

## 四、设备数据采集实战：从订阅到存储

### 4.1 场景定义

假设我们有大量温湿度传感器设备，每个设备每隔 10 秒上报一次数据，Topic 格式为 `devices/{device_id}/telemetry`，Payload 格式为 JSON：

```json
{
    "device_id": "SENSOR-001",
    "temperature": 25.6,
    "humidity": 62.3,
    "battery": 85,
    "timestamp": 1717651200
}
```

### 4.2 数据库设计

创建设备表和遥测数据表：

```php
// database/migrations/xxxx_create_devices_table.php
Schema::create('devices', function (Blueprint $table) {
    $table->id();
    $table->string('device_id')->unique();
    $table->string('name');
    $table->string('type')->default('sensor');
    $table->string('region')->default('cn-east');
    $table->json('metadata')->nullable();
    $table->boolean('is_online')->default(false);
    $table->timestamp('last_seen_at')->nullable();
    $table->timestamps();
});

// database/migrations/xxxx_create_telemetry_data_table.php
Schema::create('telemetry_data', function (Blueprint $table) {
    $table->id();
    $table->string('device_id')->index();
    $table->decimal('temperature', 6, 2);
    $table->decimal('humidity', 6, 2);
    $table->unsignedTinyInteger('battery')->nullable();
    $table->timestamp('measured_at')->index();
    $table->timestamps();

    $table->index(['device_id', 'measured_at']);
});
```

### 4.3 MQTT 订阅命令实现

创建一个 Artisan 命令作为 MQTT 消费者守护进程：

```php
// app/Console/Commands/MqttSubscribeCommand.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use PhpMqtt\Client\Facades\MQTT;
use PhpMqtt\Client\MqttClient;
use App\Services\MqttMessageHandler;

class MqttSubscribeCommand extends Command
{
    protected $signature = 'mqtt:subscribe {--topic=devices/# : Topic filter}';
    protected $description = 'Subscribe to MQTT topics and process device telemetry';

    public function handle(MqttMessageHandler $handler): void
    {
        $topic = $this->option('topic');
        $this->info("Subscribing to topic: {$topic}");

        $mqtt = MQTT::connection('emqx');
        $mqtt->connect();

        $mqtt->subscribe($topic, function (string $topic, string $message) use ($handler) {
            $this->line("Received on [{$topic}]: {$message}");
            $handler->handle($topic, $message);
        }, MqttClient::QOS_AT_LEAST_ONCE);

        // 阻塞式循环，保持连接
        $mqtt->loop(true);
    }
}
```

### 4.4 消息处理器与事件触发

```php
// app/Services/MqttMessageHandler.php
namespace App\Services;

use App\Models\Device;
use App\Models\TelemetryData;
use App\Events\TelemetryReceived;
use Illuminate\Support\Facades\Log;

class MqttMessageHandler
{
    public function handle(string $topic, string $message): void
    {
        try {
            $payload = json_decode($message, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            Log::warning('MQTT: Invalid JSON payload', ['topic' => $topic, 'raw' => $message]);
            return;
        }

        // 解析 Topic：devices/{device_id}/telemetry
        $segments = explode('/', $topic);
        if (count($segments) < 3 || $segments[2] !== 'telemetry') {
            Log::debug('MQTT: Ignoring non-telemetry topic', ['topic' => $topic]);
            return;
        }

        $deviceId = $segments[1];

        // 更新设备在线状态
        Device::where('device_id', $deviceId)->update([
            'is_online'    => true,
            'last_seen_at' => now(),
        ]);

        // 写入遥测数据
        $record = TelemetryData::create([
            'device_id'    => $deviceId,
            'temperature'  => $payload['temperature'] ?? 0,
            'humidity'     => $payload['humidity'] ?? 0,
            'battery'      => $payload['battery'] ?? null,
            'measured_at'  => isset($payload['timestamp'])
                ? \Carbon\Carbon::createFromTimestamp($payload['timestamp'])
                : now(),
        ]);

        // 触发事件，供规则引擎消费
        event(new TelemetryReceived($record, $deviceId));
    }
}
```

Event 类定义：

```php
// app/Events/TelemetryReceived.php
namespace App\Events;

use App\Models\TelemetryData;
use Illuminate\Foundation\Events\Dispatchable;

class TelemetryReceived
{
    use Dispatchable;

    public function __construct(
        public TelemetryData $data,
        public string $deviceId,
    ) {}
}
```

### 4.5 使用 Supervisor 管理订阅进程

```ini
# /etc/supervisor/conf.d/mqtt-subscribe.conf
[program:mqtt-subscribe]
command=php /var/www/artisan mqtt:subscribe --topic=devices/#
directory=/var/www
autostart=true
autorestart=true
user=www-data
numprocs=2
redirect_stderr=true
stdout_logfile=/var/www/storage/logs/mqtt-subscribe.log
```

## 五、指令下发实战：从 API 到设备确认

### 5.1 指令下发架构

指令下发是 IoT 系统的下行链路。完整流程为：用户通过 Web 界面发起请求 → Laravel API 接收 → 写入指令记录 → 通过 MQTT 发布到设备 → 设备回复确认 → 更新指令状态。如果设备在指定时间内未回复，则触发超时重试。

### 5.2 指令数据模型

```php
// database/migrations/xxxx_create_device_commands_table.php
Schema::create('device_commands', function (Blueprint $table) {
    $table->id();
    $table->string('command_id')->unique();
    $table->string('device_id')->index();
    $table->string('command_type'); // e.g., relay_on, relay_off, set_threshold
    $table->json('parameters')->nullable();
    $table->enum('status', ['pending', 'sent', 'acknowledged', 'failed', 'timeout'])->default('pending');
    $table->unsignedTinyInteger('retry_count')->default(0);
    $table->unsignedTinyInteger('max_retries')->default(3);
    $table->timestamp('sent_at')->nullable();
    $table->timestamp('acknowledged_at')->nullable();
    $table->timestamps();
});
```

### 5.3 指令下发 Controller

```php
// app/Http/Controllers/DeviceCommandController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use App\Models\DeviceCommand;
use App\Jobs\SendMqttCommand;

class DeviceCommandController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_id'     => 'required|string|exists:devices,device_id',
            'command_type'  => 'required|string|in:relay_on,relay_off,set_threshold,reboot',
            'parameters'    => 'nullable|array',
        ]);

        $command = DeviceCommand::create([
            'command_id'   => Str::uuid(),
            'device_id'    => $validated['device_id'],
            'command_type' => $validated['command_type'],
            'parameters'   => $validated['parameters'] ?? null,
            'status'       => 'pending',
        ]);

        // 异步发送指令
        SendMqttCommand::dispatch($command);

        return response()->json([
            'message'     => 'Command queued successfully',
            'command_id'  => $command->command_id,
            'status'      => $command->status,
        ], 202);
    }

    public function show(string $commandId): JsonResponse
    {
        $command = DeviceCommand::where('command_id', $commandId)->firstOrFail();

        return response()->json([
            'command_id'     => $command->command_id,
            'device_id'      => $command->device_id,
            'command_type'   => $command->command_type,
            'status'         => $command->status,
            'retry_count'    => $command->retry_count,
            'sent_at'        => $command->sent_at,
            'acknowledged_at'=> $command->acknowledged_at,
        ]);
    }
}
```

### 5.4 MQTT 指令发送 Job

```php
// app/Jobs/SendMqttCommand.php
namespace App\Jobs;

use App\Models\DeviceCommand;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use PhpMqtt\Client\Facades\MQTT;
use PhpMqtt\Client\MqttClient;
use Illuminate\Support\Facades\Log;

class SendMqttCommand implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 4;
    public int $backoff = 30;

    public function __construct(
        public DeviceCommand $command,
    ) {}

    public function handle(): void
    {
        if ($this->command->status === 'acknowledged') {
            return; // 幂等：已被确认则跳过
        }

        $topic = "devices/{$this->command->device_id}/commands/{$this->command->command_type}";
        $payload = json_encode([
            'command_id' => $this->command->command_id,
            'type'       => $this->command->command_type,
            'parameters' => $this->command->parameters,
            'timestamp'  => now()->timestamp,
        ]);

        try {
            $mqtt = MQTT::connection('emqx');
            $mqtt->connect();
            $mqtt->publish($topic, $payload, MqttClient::QOS_EXACTLY_ONCE);
            $mqtt->disconnect();

            $this->command->update([
                'status'  => 'sent',
                'sent_at' => now(),
                'retry_count' => $this->command->retry_count + 1,
            ]);

            Log::info('MQTT: Command sent', [
                'command_id' => $this->command->command_id,
                'topic'      => $topic,
            ]);

            // 派发超时检查 Job
            CheckCommandTimeout::dispatch($this->command)
                ->delay(now()->addSeconds(30));

        } catch (\Throwable $e) {
            Log::error('MQTT: Failed to send command', [
                'command_id' => $this->command->command_id,
                'error'      => $e->getMessage(),
            ]);

            if ($this->command->retry_count >= $this->command->max_retries) {
                $this->command->update(['status' => 'failed']);
            }

            throw $e; // 触发 Laravel 重试机制
        }
    }
}
```

### 5.5 设备确认与超时处理

设备执行完指令后，会发布确认消息到 `devices/{device_id}/commands/ack` Topic。在消息处理器中增加确认逻辑：

```php
// 在 MqttMessageHandler 中增加分支
if ($segments[2] === 'commands' && $segments[3] === 'ack') {
    $commandId = $payload['command_id'] ?? null;
    if ($commandId) {
        DeviceCommand::where('command_id', $commandId)
            ->where('status', 'sent')
            ->update([
                'status'         => 'acknowledged',
                'acknowledged_at'=> now(),
            ]);
        Log::info("Command {$commandId} acknowledged by device {$deviceId}");
    }
    return;
}
```

超时检查 Job：

```php
// app/Jobs/CheckCommandTimeout.php
namespace App\Jobs;

use App\Models\DeviceCommand;
use App\Jobs\SendMqttCommand;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class CheckCommandTimeout implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public DeviceCommand $command) {}

    public function handle(): void
    {
        $this->command->refresh();

        if ($this->command->status === 'acknowledged') {
            return; // 已确认，无需处理
        }

        if ($this->command->retry_count < $this->command->max_retries) {
            // 重新入队
            SendMqttCommand::dispatch($this->command);
        } else {
            $this->command->update(['status' => 'timeout']);
        }
    }
}
```

## 六、规则引擎设计：Events + Jobs 的消息路由

### 6.1 规则引擎架构

规则引擎的核心思想是：当遥测数据到达时，根据预定义的规则条件触发相应的动作。我们利用 Laravel 的 Event + Listener + Job 组合来实现，避免引入额外的规则引擎中间件。

### 6.2 规则数据模型

```php
Schema::create('rules', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('device_id')->nullable(); // null 表示全局规则
    $table->string('field');                  // temperature, humidity, battery
    $table->string('operator');               // gt, lt, eq, between
    $table->json('threshold');                // 阈值，支持单值或范围
    $table->json('actions');                  // 动作列表
    $table->boolean('enabled')->default(true);
    $table->unsignedInteger('cooldown_seconds')->default(300); // 告警冷却
    $table->timestamps();
});
```

### 6.3 规则引擎 Listener

```php
// app/Listeners/ProcessTelemetryRules.php
namespace App\Listeners;

use App\Events\TelemetryReceived;
use App\Models\Rule;
use App\Jobs\ExecuteRuleAction;
use Illuminate\Support\Facades\Cache;

class ProcessTelemetryRules
{
    public function handle(TelemetryReceived $event): void
    {
        $deviceId = $event->deviceId;
        $data = $event->data;

        // 获取适用于该设备的规则（全局 + 设备专属）
        $rules = Rule::where('enabled', true)
            ->where(function ($query) use ($deviceId) {
                $query->where('device_id', $deviceId)
                      ->orWhereNull('device_id');
            })
            ->get();

        foreach ($rules as $rule) {
            $value = $data->{$rule->field};
            if ($value === null) continue;

            $triggered = match ($rule->operator) {
                'gt'     => $value > $rule->threshold['value'],
                'lt'     => $value < $rule->threshold['value'],
                'eq'     => $value == $rule->threshold['value'],
                'between'=> $value >= $rule->threshold['min'] && $value <= $rule->threshold['max'],
                default  => false,
            };

            if ($triggered) {
                // 冷却检查：同一规则在同一设备上避免重复告警
                $cacheKey = "rule_cooldown:{$rule->id}:{$deviceId}";
                if (Cache::has($cacheKey)) continue;

                Cache::put($cacheKey, true, $rule->cooldown_seconds);
                ExecuteRuleAction::dispatch($rule, $deviceId, $data->toArray());
            }
        }
    }
}
```

### 6.4 规则动作执行 Job

```php
// app/Jobs/ExecuteRuleAction.php
namespace App\Jobs;

use App\Models\Rule;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Notification;
use App\Notifications\DeviceAlertNotification;
use App\Jobs\SendMqttCommand;
use App\Models\DeviceCommand;
use Illuminate\Support\Str;

class ExecuteRuleAction implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(
        public Rule $rule,
        public string $deviceId,
        public array $data,
    ) {}

    public function handle(): void
    {
        foreach ($this->rule->actions as $action) {
            match ($action['type']) {
                'notification' => $this->sendNotification($action),
                'mqtt_command' => $this->sendMqttCommand($action),
                'webhook'      => $this->callWebhook($action),
                default        => null,
            };
        }
    }

    private function sendNotification(array $action): void
    {
        $users = \App\Models\User::whereIn('id', $action['user_ids'] ?? [])->get();
        Notification::send($users, new DeviceAlertNotification(
            deviceId:  $this->deviceId,
            ruleName:  $this->rule->name,
            data:      $this->data,
            message:   $action['message'] ?? 'Device alert triggered',
        ));
    }

    private function sendMqttCommand(array $action): void
    {
        $command = DeviceCommand::create([
            'command_id'   => Str::uuid(),
            'device_id'    => $action['target_device'] ?? $this->deviceId,
            'command_type' => $action['command_type'],
            'parameters'   => $action['parameters'] ?? null,
        ]);
        SendMqttCommand::dispatch($command);
    }

    private function callWebhook(array $action): void
    {
        \Illuminate\Support\Facades\Http::timeout(10)
            ->post($action['url'], [
                'device_id'  => $this->deviceId,
                'rule_name'  => $this->rule->name,
                'trigger_data' => $this->data,
                'triggered_at' => now()->toIso8601String(),
            ]);
    }
}
```

注册 Event Listener：

```php
// app/Providers/EventServiceProvider.php
protected $listen = [
    \App\Events\TelemetryReceived::class => [
        \App\Listeners\ProcessTelemetryRules::class,
    ],
];
```

## 七、高可用与水平扩展

### 7.1 MQTT Broker 集群

EMQX 支持原生集群部署，推荐使用 Kubernetes + EMQX Operator 实现自动扩缩容。核心要点：

- 使用 `node discovery` 自动发现机制（支持 DNS、K8s、etcd 等）
- 客户端通过负载均衡器（如 HAProxy/Nginx Stream）连接集群
- 跨节点的消息路由由 EMQX 内部完成，对客户端透明

### 7.2 Laravel Queue Worker 扩展

MQTT 消费者的并发模型是单连接阻塞式循环，水平扩展方式为启动多个订阅进程或使用不同的 Topic 分片：

```ini
# supervisor: 每个 worker 订阅不同 shard
[program:mqtt-shard-0]
command=php /var/www/artisan mqtt:subscribe --topic=devices/shard-0/#

[program:mqtt-shard-1]
command=php /var/www/artisan mqtt:subscribe --topic=devices/shard-1/#
```

对于下游的 Job 处理（规则引擎、指令下发等），增加 Queue Worker 数量即可：

```bash
php artisan queue:work --queue=commands,rules,default --max-time=3600
```

### 7.3 消息积压处理

当设备数据量突增导致消息积压时的应对策略：

- **短期方案**：增加 Worker 进程数量，使用 `php artisan queue:work --once` 应急消费
- **中期方案**：将规则引擎处理降级为异步批量处理，使用 `chunk` 批量写入数据库
- **长期方案**：在 MQTT Broker 和 Laravel 之间引入 Kafka 作为缓冲层，解耦生产与消费速率

## 八、安全实践

### 8.1 TLS/mTLS 加密传输

在 Broker 端配置 TLS 证书：

```bash
# EMQX 配置 (emqx.conf)
listeners.ssl.default {
  bind = "0.0.0.0:8883"
  ssl_options {
    certfile = "/etc/emqx/certs/server.crt"
    keyfile  = "/etc/emqx/certs/server.key"
    cacertfile = "/etc/emqx/certs/ca.crt"
    verify = verify_peer
    fail_if_no_peer_cert = true  # mTLS
  }
}
```

Laravel 端配置 TLS 连接：

```php
// .env
MQTT_TLS_ENABLED=true
MQTT_TLS_CA_FILE=/var/www/storage/certs/ca.crt
MQTT_TLS_CLIENT_CERT=/var/www/storage/certs/client.crt
MQTT_TLS_CLIENT_KEY=/var/www/storage/certs/client.key
```

### 8.2 ACL 权限控制

EMQX 内置了基于 Topic 的 ACL 规则：

```sql
-- EMQX Dashboard 中配置 ACL
-- 设备只能发布自己的 telemetry topic
ALLOW devices/${clientid}/telemetry FOR publish
-- 设备只能订阅自己的 commands topic
ALLOW devices/${clientid}/commands/# FOR subscribe
-- Laravel 后端拥有所有权限
ALLOW # FOR subscribe WHERE clientid = 'laravel-backend'
```

### 8.3 设备认证

推荐使用 Token + 设备证书双重认证：

```php
// EMQX HTTP 认证插件对接 Laravel 认证接口
// app/Http/Controllers/MqttAuthController.php
public function authenticate(Request $request): JsonResponse
{
    $validated = $request->validate([
        'clientid' => 'required|string',
        'username' => 'required|string',
        'password' => 'required|string',
    ]);

    $device = Device::where('device_id', $validated['clientid'])->first();

    if (!$device || !Hash::check($validated['password'], $device->mqtt_token)) {
        return response()->json(['result' => 'deny'], 403);
    }

    return response()->json(['result' => 'allow', 'is_superuser' => false]);
}
```

## 九、监控与可观测性

### 9.1 Prometheus Metrics 暴露

在 Laravel 中暴露自定义指标：

```php
// app/Providers/PrometheusServiceProvider.php
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

public function register(): void
{
    Redis::setDefaultOptions(['host' => config('database.redis.default.host')]);
    $this->app->singleton(CollectorRegistry::class);
}

// app/Services/MetricsService.php
public function recordTelemetry(string $deviceId, float $temperature): void
{
    $registry = app(CollectorRegistry::class);
    $gauge = $registry->getOrRegisterGauge(
        'iot', 'device_temperature', 'Latest temperature reading', ['device_id']
    );
    $gauge->set($temperature, [$deviceId]);

    $counter = $registry->getOrRegisterCounter(
        'iot', 'telemetry_messages_total', 'Total telemetry messages', ['device_id']
    );
    $counter->inc([$deviceId]);
}
```

### 9.2 Grafana Dashboard 关键指标

- **消息吞吐量**：`rate(telemetry_messages_total[5m])` — 每秒消息数
- **设备在线率**：`count(devices{is_online=true}) / count(devices)` — 在线设备占比
- **指令成功率**：`acknowledged_commands / sent_commands` — 指令确认率
- **延迟分布**：`histogram_quantile(0.95, mqtt_publish_duration_seconds)` — P95 发布延迟

### 9.3 告警规则

```yaml
# Prometheus AlertManager 规则
groups:
  - name: iot_alerts
    rules:
      - alert: HighTemperature
        expr: iot_device_temperature > 60
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Device {{ $labels.device_id }} temperature exceeds 60°C"

      - alert: MessageBacklog
        expr: laravel_queue_jobs_pending{queue="default"} > 10000
        for: 5m
        labels:
          severity: warning

      - alert: DeviceOffline
        expr: time() - iot_device_last_seen_timestamp > 300
        for: 1m
        labels:
          severity: warning
```

## 十、与 Kafka/RabbitMQ 对比：MQTT 的适用场景边界

| 维度 | MQTT | Kafka | RabbitMQ |
|------|------|-------|----------|
| **设计目标** | 设备到云端轻量通信 | 大规模流数据处理 | 企业级消息路由 |
| **协议开销** | 极低（2 字节最小头部） | 较高（TCP 长连接） | 中等（AMQP） |
| **消息持久化** | Broker 可选保留 | 原生持久化、可回溯 | 支持持久化队列 |
| **消费模型** | 发布/订阅 + 通配符 | Consumer Group + Offset | Queue + Consumer |
| **适用规模** | 百万级设备连接 | TB 级数据吞吐 | 万级 TPS |
| **QoS 保障** | 0/1/2 三级 | 至少一次/精确一次 | 确认机制 |
| **PHP 生态** | php-mqtt 成熟 | 不够成熟 | php-amqplib 成熟 |

**何时选择 MQTT**：设备端资源受限、需要低功耗长连接、双向通信场景、MQTT 原生设备协议。

**何时选择 Kafka**：海量数据持久化与回溯分析、流式计算（Flink/Spark）、日志聚合。

**何时选择 RabbitMQ**：复杂的路由规则（Direct/Topic/Fanout/Headers）、需要死信队列、任务队列场景。

**混合架构推荐**：MQTT 负责设备接入层 → Kafka 负责数据管道层 → Laravel/RabbitMQ 负责业务逻辑层。这种分层架构在大型 IoT 平台中非常常见。

### 10.2 IoT 通信协议选型对比：MQTT vs AMQP vs HTTP Polling

在 IoT 项目初期，团队经常在 MQTT、AMQP 和 HTTP 轮询之间犹豫。下表从 IoT 场景的核心需求维度进行对比：

| 维度 | MQTT | AMQP 1.0 | HTTP Polling |
|------|------|----------|--------------|
| **协议开销** | 极低（最小 2 字节头部） | 中等（约 8 字节帧头 + 信令） | 高（HTTP 头部数百字节） |
| **连接模型** | 长连接，低心跳开销 | 长连接，Session/Link 管理较重 | 短连接，每次请求重建 TCP |
| **实时推送** | ✅ 原生支持（Broker 推送） | ✅ 原生支持 | ❌ 仅客户端主动拉取 |
| **QoS 精细控制** | 0/1/2 三级 | 仅 At-least-once | 依赖 HTTP 状态码重试 |
| **离线消息** | ✅ Clean Session + Retained | ✅ 持久订阅 | ❌ 无 |
| **设备功耗** | 极低（适合电池供电） | 较高（TLS + 信令握手） | 最高（频繁建连） |
| **双向通信** | ✅ 订阅 + 发布 | ✅ 双向 | ❌ 仅请求-响应 |
| **适用带宽** | < 10 Kbps 可用 | 需百 Kbps 级 | 依赖轮询频率 |
| **典型延迟** | 毫秒级 | 毫秒级 | 秒级（取决于轮询间隔） |
| **边缘网关适配** | ⭐ 极佳（mosquitto 仅 1MB） | 一般（需完整 AMQP 库） | 一般（需 HTTP Client） |

**选型建议**：
- **首选 MQTT**：绝大多数 IoT 场景，尤其是传感器数据采集、设备控制、电池供电设备。
- **考虑 AMQP**：当 IoT 平台需要与企业级消息中间件（如 Azure Service Bus）深度集成时。
- **仅限 HTTP**：设备固件不支持 MQTT 且无法升级、或数据量极小（每天几条）的场景。此时可考虑 Long Polling 作为折中方案。

## 十一、总结与生产踩坑回顾

### 核心收获

通过本文的实战讲解，我们构建了一套完整的 MQTT + Laravel IoT 集成方案：设备通过 MQTT 上报遥测数据，Laravel 后端订阅、解析、存储并触发规则引擎；管理员通过 API 下发控制指令，系统自动处理重试和超时；基于 Events + Jobs 的规则引擎实现了灵活的告警和联动控制。

### 生产环境踩坑总结

**1. MQTT 连接意外断开**：网络抖动会导致 MQTT 连接断开，消费进程静默退出。解决方案：在订阅命令中监听 `disconnect` 事件并实现自动重连，同时配合 Supervisor 的 `autorestart=true`。

**2. QoS 1 消息重复**：QoS 1 保证至少送达一次，业务端必须做幂等处理。我们通过 `command_id` 唯一约束和状态机检查来避免重复消费。

**3. 大规模订阅性能瓶颈**：单个 MQTT 客户端订阅万级 Topic 时性能急剧下降。解决方案：使用通配符订阅（`devices/#`）替代逐个订阅，在应用层做 Topic 路由。

**4. 遗漏遗嘱消息**：设备端未正确配置 Last Will，导致设备离线后 `is_online` 状态未更新。务必确保每个设备客户端连接时都设置了 Will Message。

**5. 数据库写入瓶颈**：高频率的逐条写入导致 MySQL 连接池耗尽。最终方案改为先写入 Redis List，每 5 秒批量 `INSERT` 到 MySQL，QPS 从 500 提升到 5000+。

**6. 时钟同步问题**：设备端时间戳与服务器时间不一致，导致数据排序混乱。建议所有遥测数据统一以 Broker 接收时间为准，设备时间戳仅作参考。

**7. Topic 暴涨导致性能退化**：如果 Topic 中包含了时间戳等变化数据（如 `devices/DEV001/telemetry/20240601`），会导致 Broker 内部 Topic 表膨胀。Topic 应该只包含路由信息，不含业务数据。

本文提供的代码示例已经涵盖了 IoT 后端集成的核心场景，读者可以根据实际业务需求进行裁剪和扩展。MQTT 协议的轻量高效与 Laravel 框架的工程化能力相结合，能够为中小型 IoT 项目提供一套技术栈统一、开发效率高、可维护性强的解决方案。在面对更大规模的场景时，引入 Kafka 等流处理中间件进行分层架构升级，依然是平滑可行的演进路径。

## 相关阅读

- [Laravel Broadcasting + Reverb 实时通信：Presence Channel 与在线状态同步](/categories/05_PHP/Laravel/2026-06-06-Laravel-Broadcasting-Reverb-Private-Presence-Channel-B2C-Realtime-Notification/)
- [Retry 与 Dead Letter Queue 深度实战：Laravel 队列失败消息治理](/categories/05_PHP/Laravel/2026-06-06-Retry-Dead-Letter-Queue-深度实战-Laravel队列失败消息治理/)
- [Long Polling vs SSE vs WebSocket vs HTTP Streaming 实时通信方案对比](/categories/00_架构/Long-Polling-vs-SSE-vs-WebSocket-vs-HTTP-Streaming-实战-实时通信方案对比/)
