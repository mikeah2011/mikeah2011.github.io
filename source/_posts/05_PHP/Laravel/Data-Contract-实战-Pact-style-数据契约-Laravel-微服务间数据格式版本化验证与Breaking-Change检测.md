---
title: 'Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测'
date: 2026-06-05 08:00:00
tags: [Data Contract, Pact, Laravel, 微服务, 契约测试, JSON Schema, OpenAPI, Breaking Change]
categories: [PHP, Laravel]
cover: /images/covers/data-contract-pact-laravel-cover.jpg
description: "Data Contract（数据契约）实战指南，详解如何在 Laravel 微服务架构中落地 Pact-style 数据契约。涵盖 Consumer-Driven Contracts（CDC）核心概念与 Pact 框架 PHP 集成、JSON Schema 与 OpenAPI Spec 定义数据格式的版本化策略（语义版本 + Header 版本控制）、Contract 验证中间件与 API Resource 适配实现多层数据校验、基于 openapi-diff 的 Breaking Change 自动检测与 GitHub Actions CI 集成、契约注册中心与版本生命周期管理。附生产环境四大踩坑（Schema 漂移、嵌套版本化、Consumer 版本碎片化、测试状态管理）解决方案与最佳实践总结，适合构建 Laravel 微服务间可靠数据交换体系的团队参考。"
---

## 引言：为什么微服务需要数据契约

在单体应用时代，模块间的数据交换发生在进程内部，类型安全由编译器或 IDE 静态分析保障。一旦系统拆分为微服务，数据交换就变成了跨进程、跨网络的 HTTP/gRPC 调用，原本由类型系统守护的"隐形契约"也随之消失。

我们来看一个典型的痛点：**订单服务**（Order Service）调用**用户服务**（User Service）获取用户信息。用户服务某天将响应字段 `user_name` 重命名为 `username`，没有通知下游。订单服务上线后，用户名称全部显示为空，直到客户投诉才发现。这就是经典的 **Breaking Change** 问题。

<!--more-->

这类问题在微服务架构中极其常见，根源在于：

1. **接口文档与代码脱节**：Swagger/OpenAPI 文档通常是事后补写的，与实际实现不同步。
2. **缺乏消费者视角**：Provider 端单方面决定字段变更，不知道哪些 Consumer 依赖了哪些字段。
3. **没有自动化检测手段**：Breaking Change 完全依赖人工 Code Review，在快节奏迭代中容易遗漏。

**数据契约（Data Contract）** 正是为了解决上述问题而提出的。它将服务间的数据交换格式定义为一份可版本化、可验证、可自动检测变更的"合同"，在 Consumer 和 Provider 之间建立明确的协议。

本文将介绍 Pact-style 数据契约的核心概念，展示如何在 Laravel 微服务架构中实现数据契约的版本化、验证与 Breaking Change 自动检测。

---

## 数据契约核心概念

### Consumer-Driven Contracts（CDC）

Consumer-Driven Contracts（消费者驱动契约）是一种契约测试方法论，核心思想是：**契约由消费者定义，而非提供者**。

传统的 API 设计模式是 Provider 先定义接口，Consumer 被动适配。CDC 模式反转了这个关系：

```
Consumer A ──┐
              ├──▶ 定义契约 ──▶ Provider 验证并满足所有契约
Consumer B ──┘
```

每个 Consumer 声明自己依赖 Provider 的哪些端点、哪些字段、哪些数据格式。Provider 在每次发布前，验证自己是否满足了所有已知 Consumer 的契约。

### Provider（提供者）

Provider 是提供数据的服务。在我们的例子中，用户服务就是 Provider。Provider 的职责：

- 实际实现 API 端点
- 运行 Provider-side 契约测试，确保实现满足所有 Consumer 的期望
- 在发布前检测 Breaking Change

### Consumer（消费者）

Consumer 是消费数据的服务。订单服务、支付服务都可以是 Consumer。Consumer 的职责：

- 定义自己对 Provider 的期望（交互 + 数据格式）
- 运行 Consumer-side 契约测试，确保自己的消费逻辑正确

### Pact 框架

Pact 是最流行的 CDC 框架，最初由 Ruby 社区实现，目前支持几乎所有主流语言。Pact 的工作流程：

```
1. Consumer 端：定义交互期望（请求/响应对）→ 生成 Pact 文件（JSON）
2. 将 Pact 文件发布到 Pact Broker（中央仓库）
3. Provider 端：从 Broker 拉取所有 Consumer 的 Pact 文件 → 验证自己的实现
4. 验证结果回写 Broker → 形成兼容性矩阵
```

---

## Pact 框架介绍与 Laravel 集成

### PHP 生态中的 Pact 支持

PHP 生态对 Pact 的支持经历了从 `pact-php` 到 `pact-ffi` 的演进。目前推荐使用基于 FFI 的方案，它依赖 Pact Rust 核心库：

```bash
# 安装 pact-php（基于 FFI）
composer require pact-foundation/pact-php
```

> **注意**：需要 PHP 安装了 FFI 扩展，且系统安装了 Pact FFI 共享库。

### Laravel 中集成 Pact 的基本架构

在 Laravel 项目中，我们通常将契约测试放在 `tests/Contract/` 目录下：

```
tests/
├── Contract/
│   ├── Consumer/
│   │   └── UserServiceContractTest.php
│   └── Provider/
│       └── UserApiVerificationTest.php
├── Feature/
└── Unit/
```

### Consumer 端：定义交互期望

以下是一个 Laravel Consumer 端的契约测试示例，假设订单服务需要调用用户服务获取用户详情：

```php
<?php

namespace Tests\Contract\Consumer;

use PhpPact\Consumer\InteractionBuilder;
use PhpPact\Consumer\Model\ConsumerRequest;
use PhpPact\Consumer\Model\ProviderResponse;
use PhpPact\Standalone\MockService\MockServerConfig;
use PHPUnit\Framework\TestCase;
use App\Services\UserServiceClient;

class UserServiceContractTest extends TestCase
{
    private InteractionBuilder $builder;
    private MockServerConfig $config;

    protected function setUp(): void
    {
        $this->config = new MockServerConfig();
        $this->config
            ->setConsumer('order-service')
            ->setProvider('user-service')
            ->setPactDir(__DIR__ . '/../../../pacts')
            ->setPactSpecificationVersion('4.0')
            ->setLogLevel('debug');

        $this->builder = new InteractionBuilder($this->config);
    }

    public function testGetUserById(): void
    {
        // 定义请求
        $request = new ConsumerRequest();
        $request
            ->setMethod('GET')
            ->setPath('/api/v1/users/42')
            ->addHeader('Accept', 'application/json')
            ->addHeader('X-Contract-Version', '1.2.0');

        // 定义期望的响应
        $response = new ProviderResponse();
        $response
            ->setStatus(200)
            ->addHeader('Content-Type', 'application/json; charset=utf-8')
            ->setBody([
                'id'         => 42,
                'username'   => 'mikeah',
                'email'      => 'mikeah@example.com',
                'avatar_url' => $this->builder->term(
                    'https://cdn.example.com/avatars/.*',
                    'https://cdn.example.com/avatars/42.jpg'
                ),
                'created_at' => $this->builder->dateTimeFuzzy('Y-m-d\TH:i:s\Z'),
                'is_active'  => true,
                'role'       => $this->builder->regexMatch('/^(admin|user|guest)$/', 'user'),
            ]);

        $this->builder
            ->given('a user with ID 42 exists')
            ->uponReceiving('a request to get user by ID')
            ->with($request)
            ->willRespondWith($response);

        // 执行实际的 HTTP 调用（打到 Mock Server）
        $client = new UserServiceClient($this->config->getBaseUri());
        $user = $client->getUser(42);

        // 断言 Consumer 端正确解析了响应
        $this->assertEquals(42, $user['id']);
        $this->assertEquals('mikeah', $user['username']);
        $this->assertTrue($user['is_active']);

        // 验证交互并生成 Pact 文件
        $this->builder->verifyInteractions();
    }

    public function testGetUserNotFound(): void
    {
        $request = new ConsumerRequest();
        $request
            ->setMethod('GET')
            ->setPath('/api/v1/users/99999')
            ->addHeader('Accept', 'application/json');

        $response = new ProviderResponse();
        $response
            ->setStatus(404)
            ->addHeader('Content-Type', 'application/json')
            ->setBody([
                'error'   => 'not_found',
                'message' => 'User not found',
            ]);

        $this->builder
            ->given('no user with ID 99999 exists')
            ->uponReceiving('a request for a non-existent user')
            ->with($request)
            ->willRespondWith($response);

        $client = new UserServiceClient($this->config->getBaseUri());
        $result = $client->getUser(99999);

        $this->assertNull($result);

        $this->builder->verifyInteractions();
    }
}
```

运行 Consumer 测试后，Pact 会在 `pacts/` 目录下生成 JSON 格式的契约文件 `order-service-user-service.json`。

### Provider 端：验证契约

Provider 端的验证测试从 Pact Broker（或本地文件）拉取契约文件，验证真实实现是否满足所有 Consumer 的期望：

```php
<?php

namespace Tests\Contract\Provider;

use PhpPact\Standalone\ProviderVerifier\Model\VerifierConfig;
use PhpPact\Standalone\ProviderVerifier\Verifier;
use Tests\TestCase;

class UserApiVerificationTest extends TestCase
{
    public function testVerifyUserApiAgainstAllConsumers(): void
    {
        $config = new VerifierConfig();
        $config
            ->setProviderName('user-service')
            ->setProviderBaseUrl('http://127.0.0.1:8001')
            ->addCustomHeader('X-Contract-Test', 'true')
            ->setPublishVerificationResults(true)
            ->setProviderVersion('1.3.2')
            ->setProviderVersionBranch('main');

        // 从 Pact Broker 拉取所有与 user-service 相关的契约
        $config->addBrokerUri(
            'https://pact-broker.example.com',
            'order-service',
            'develop'
        );
        $config->addBrokerUri(
            'https://pact-broker.example.com',
            'payment-service',
            'develop'
        );

        $verifier = new Verifier($config);

        // 设置状态处理器：处理 given() 中定义的状态
        $verifier->addState('a user with ID 42 exists', function () {
            // 在测试数据库中准备数据
            \App\Models\User::factory()->create([
                'id'       => 42,
                'username' => 'mikeah',
                'email'    => 'mikeah@example.com',
            ]);
        });

        $verifier->addState('no user with ID 99999 exists', function () {
            \App\Models\User::where('id', 99999)->delete();
        });

        // 运行验证
        $result = $verifier->verify();

        $this->assertTrue($result, 'Provider verification failed against consumer contracts');
    }
}
```

---

## 实战：定义数据契约（JSON Schema / OpenAPI）

### 使用 JSON Schema 定义数据格式

JSON Schema 是定义数据契约最通用的方式，语言无关、工具链成熟。我们为用户信息定义一个严格的 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://api.example.com/schemas/user/v1.2.json",
  "title": "User",
  "description": "用户信息数据契约 v1.2",
  "type": "object",
  "required": ["id", "username", "email", "is_active", "created_at"],
  "properties": {
    "id": {
      "type": "integer",
      "minimum": 1,
      "description": "用户唯一标识"
    },
    "username": {
      "type": "string",
      "minLength": 3,
      "maxLength": 50,
      "pattern": "^[a-zA-Z0-9_]+$"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "avatar_url": {
      "type": ["string", "null"],
      "format": "uri"
    },
    "is_active": {
      "type": "boolean"
    },
    "role": {
      "type": "string",
      "enum": ["admin", "user", "guest"]
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
}
```

### 在 Laravel 中加载和使用 JSON Schema

创建一个 Artisan 命令来管理数据契约：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use JsonSchema\Validator;
use JsonSchema\Constraints\Contract as SchemaConstraint;

class ValidateDataContract extends Command
{
    protected $signature = 'contract:validate
        {--schema= : Path to the JSON Schema file}
        {--data= : Path to the data JSON file to validate}';

    protected $description = 'Validate data against a JSON Schema contract';

    public function handle(): int
    {
        $schemaPath = $this->option('schema');
        $dataPath = $this->option('data');

        if (!$schemaPath || !$dataPath) {
            $this->error('Both --schema and --data options are required.');
            return self::FAILURE;
        }

        $schema = json_decode(file_get_contents($schemaPath));
        $data = json_decode(file_get_contents($dataPath));

        $validator = new Validator();
        $validator->validate($data, $schema);

        if ($validator->isValid()) {
            $this->info("✅ Data is valid against the contract.");
            return self::SUCCESS;
        }

        $this->error("❌ Data violates the contract:");
        foreach ($validator->getErrors() as $error) {
            $this->error("  [{$error['property']}] {$error['message']}");
        }

        return self::FAILURE;
    }
}
```

### 在 Laravel 服务中使用 JSON Schema 验证响应

创建一个 Trait，让所有 API Client 都具备 Schema 验证能力：

```php
<?php

namespace App\Traits;

use JsonSchema\Validator;
use Illuminate\Support\Facades\Log;

trait ValidatesDataContract
{
    protected function validateAgainstSchema(
        array $data,
        string $schemaPath
    ): bool {
        $schema = json_decode(
            file_get_contents(
                base_path('contracts/' . $schemaPath)
            )
        );

        $dataObject = json_decode(json_encode($data));
        $validator = new Validator();
        $validator->validate($dataObject, $schema);

        if (!$validator->isValid()) {
            $errors = $validator->getErrors();
            Log::warning('Data contract validation failed', [
                'schema'  => $schemaPath,
                'errors'  => $errors,
                'data'    => $data,
            ]);

            throw new \App\Exceptions\ContractViolationException(
                "Data contract violation against {$schemaPath}",
                $errors
            );
        }

        return true;
    }
}
```

在 Consumer 端的 HTTP Client 中使用：

```php
<?php

namespace App\Services;

use App\Traits\ValidatesDataContract;
use Illuminate\Support\Facades\Http;
use App\Exceptions\ContractViolationException;

class UserServiceClient
{
    use ValidatesDataContract;

    private string $baseUrl;
    private string $contractVersion = '1.2.0';

    public function __construct(string $baseUrl)
    {
        $this->baseUrl = $baseUrl;
    }

    public function getUser(int $id): ?array
    {
        $response = Http::withHeaders([
            'Accept'            => 'application/json',
            'X-Contract-Version' => $this->contractVersion,
        ])->get("{$this->baseUrl}/api/v1/users/{$id}");

        if ($response->status() === 404) {
            return null;
        }

        $response->throw();

        $data = $response->json();

        // 验证响应是否符合数据契约
        $this->validateAgainstSchema($data, 'user/v1.2.json');

        return $data;
    }
}
```

### 使用 OpenAPI Spec 定义契约

对于更复杂的场景，OpenAPI 3.0 是更好的选择，因为它天然支持路径参数、查询参数、请求体、响应体的完整定义：

```yaml
openapi: 3.0.3
info:
  title: User Service API
  version: 1.2.0
  description: 用户服务数据契约

paths:
  /api/v1/users/{id}:
    get:
      summary: 获取用户详情
      operationId: getUserById
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
            minimum: 1
      responses:
        '200':
          description: 成功
          headers:
            X-Contract-Version:
              schema:
                type: string
                example: 1.2.0
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: 未找到
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

components:
  schemas:
    User:
      type: object
      required: [id, username, email, is_active, created_at]
      properties:
        id:
          type: integer
        username:
          type: string
          minLength: 3
        email:
          type: string
          format: email
        avatar_url:
          type: string
          nullable: true
        is_active:
          type: boolean
        role:
          type: string
          enum: [admin, user, guest]
        created_at:
          type: string
          format: date-time

    ErrorResponse:
      type: object
      required: [error, message]
      properties:
        error:
          type: string
        message:
          type: string
```

---

## 契约版本化策略

### 语义版本（Semantic Versioning）

数据契约的版本管理推荐采用语义版本（SemVer）：

- **MAJOR（主版本）**：Breaking Change，如删除字段、修改字段类型、缩小枚举范围
- **MINOR（次版本）**：新增字段（向后兼容）、新增可选参数
- **PATCH（补丁版本）**：文档修正、描述修改，不影响结构

示例：

| 变更 | 版本变化 | 说明 |
|------|----------|------|
| 新增 `nickname` 可选字段 | 1.2.0 → 1.3.0 | MINOR：向后兼容 |
| 删除 `avatar_url` 字段 | 1.3.0 → 2.0.0 | MAJOR：Breaking Change |
| 修改 `role` 枚举新增 `moderator` | 1.3.0 → 1.4.0 | MINOR：向后兼容 |
| 修正文档描述 | 1.4.0 → 1.4.1 | PATCH |
| `username` 最小长度从 3 改为 5 | 1.4.1 → 2.0.0 | MAJOR：可能拒绝之前合法的数据 |

### Header 版本控制

在 Laravel 微服务间，通过自定义 Header 传递契约版本：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ContractVersionMiddleware
{
    // Provider 端支持的契约版本列表
    private array $supportedVersions = ['1.0.0', '1.1.0', '1.2.0'];

    // 当前最新版本
    private string $currentVersion = '1.2.0';

    // 即将废弃的版本（给下游迁移窗口）
    private array $deprecatedVersions = ['1.0.0'];

    public function handle(Request $request, Closure $next): Response
    {
        $requestedVersion = $request->header('X-Contract-Version');

        if (!$requestedVersion) {
            // 未指定版本时使用最新版本
            $requestedVersion = $this->currentVersion;
        }

        // 验证版本是否支持
        if (!in_array($requestedVersion, $this->supportedVersions)) {
            return response()->json([
                'error'   => 'unsupported_contract_version',
                'message' => "Contract version {$requestedVersion} is not supported.",
                'supported_versions' => $this->supportedVersions,
                'current_version'    => $this->currentVersion,
            ], 406); // 406 Not Acceptable
        }

        // 废弃版本警告
        if (in_array($requestedVersion, $this->deprecatedVersions)) {
            // 在响应中添加 Deprecation 警告 Header
            $response = $next($request);
            $response->headers->set('Deprecation', 'true');
            $response->headers->set(
                'Sunset',
                '2026-12-31T23:59:59Z'
            );
            $response->headers->set(
                'Link',
                '</api/v2/users>; rel="successor-version"'
            );
            return $response;
        }

        // 将版本注入请求上下文，供后续处理使用
        $request->attributes->set('contract_version', $requestedVersion);

        $response = $next($request);
        $response->headers->set('X-Contract-Version', $requestedVersion);

        return $response;
    }
}
```

在 `bootstrap/app.php` 中注册中间件（Laravel 11+）：

```php
<?php

use App\Http\Middleware\ContractVersionMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->api(append: [
            ContractVersionMiddleware::class,
        ]);
    })
    ->create();
```

### 基于版本的响应适配

在 Provider 端，根据契约版本返回不同结构的响应：

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function show(Request $request, int $id): JsonResponse
    {
        $user = User::findOrFail($id);
        $version = $request->attributes->get('contract_version', '1.2.0');

        return match ($version) {
            '1.0.0' => $this->respondV1($user),
            '1.1.0' => $this->respondV1_1($user),
            default => $this->respondV1_2($user),
        };
    }

    private function respondV1(User $user): JsonResponse
    {
        // v1.0.0 原始格式：使用 user_name 而非 username
        return response()->json([
            'id'         => $user->id,
            'user_name'  => $user->username, // 旧字段名
            'email'      => $user->email,
            'is_active'  => $user->is_active,
            'created_at' => $user->created_at->toIso8601String(),
        ]);
    }

    private function respondV1_1(User $user): JsonResponse
    {
        // v1.1.0: user_name → username，新增 avatar_url
        return response()->json([
            'id'         => $user->id,
            'username'   => $user->username,
            'email'      => $user->email,
            'avatar_url' => $user->avatar_url,
            'is_active'  => $user->is_active,
            'created_at' => $user->created_at->toIso8601String(),
        ]);
    }

    private function respondV1_2(User $user): JsonResponse
    {
        // v1.2.0: 新增 role 字段
        return response()->json([
            'id'         => $user->id,
            'username'   => $user->username,
            'email'      => $user->email,
            'avatar_url' => $user->avatar_url,
            'is_active'  => $user->is_active,
            'role'       => $user->role,
            'created_at' => $user->created_at->toIso8601String(),
        ]);
    }
}
```

---

## Breaking Change 自动检测

### 什么是 Breaking Change

在数据契约语境下，Breaking Change 是指 Provider 端的变更会导致已有 Consumer 的契约验证失败。常见场景：

| 变更类型 | 是否 Breaking | 说明 |
|----------|---------------|------|
| 新增必填请求参数 | ✅ | Consumer 不会发送该参数 |
| 删除响应字段 | ✅ | Consumer 依赖该字段 |
| 缩小字段取值范围 | ✅ | Consumer 可能使用被移除的值 |
| 修改字段类型 | ✅ | Consumer 解析会失败 |
| 新增可选响应字段 | ❌ | 向后兼容 |
| 新增可选请求参数 | ❌ | 向后兼容 |
| 扩大枚举范围 | ❌ | 向后兼容 |

### 基于 OpenAPI Diff 的自动检测

使用 `openapi-diff` 工具对比两个版本的 OpenAPI Spec，自动检测 Breaking Change。

首先安装工具：

```bash
# 使用 Docker 运行 openapi-diff
docker pull openapitools/openapi-diff:latest

# 或在项目中通过 npm 安装（CI 环境推荐）
npm install --save-dev @openapitools/openapi-diff
```

创建 CI 检测脚本 `scripts/check-contract-diff.sh`：

```bash
#!/bin/bash
set -euo pipefail

CONTRACTS_DIR="contracts"
BASE_BRANCH="${1:-main}"
CURRENT_BRANCH="${2:-HEAD}"

echo "🔍 Checking for Breaking Changes between ${BASE_BRANCH} and ${CURRENT_BRANCH}"

BREAKING_FOUND=0

for schema_file in $(find "${CONTRACTS_DIR}" -name "*.openapi.yaml" -o -name "*.openapi.json"); do
    echo ""
    echo "📋 Checking: ${schema_file}"

    # 获取主分支上的版本
    BASE_FILE=$(mktemp)
    CURRENT_FILE=$(mktemp)

    git show "${BASE_BRANCH}:${schema_file}" > "${BASE_FILE}" 2>/dev/null || {
        echo "   ℹ️  New schema file, skipping comparison"
        rm -f "${BASE_FILE}" "${CURRENT_FILE}"
        continue
    }

    git show "${CURRENT_BRANCH}:${schema_file}" > "${CURRENT_FILE}" 2>/dev/null || {
        cp "${schema_file}" "${CURRENT_FILE}"
    }

    # 运行 diff 检测
    DIFF_RESULT=$(npx @openapitools/openapi-diff \
        "${BASE_FILE}" "${CURRENT_FILE}" \
        --fail-on-breaking \
        --format JSON 2>&1) || {
        echo "   ❌ BREAKING CHANGE detected!"
        echo "${DIFF_RESULT}" | jq '.breakingChanges[]? // empty' 2>/dev/null || true
        BREAKING_FOUND=1
    }

    if [ "${BREAKING_FOUND}" -eq 0 ]; then
        echo "   ✅ No breaking changes"
    fi

    rm -f "${BASE_FILE}" "${CURRENT_FILE}"
done

if [ "${BREAKING_FOUND}" -eq 1 ]; then
    echo ""
    echo "💥 Breaking changes detected! Please:"
    echo "   1. Bump the MAJOR version in affected contracts"
    echo "   2. Notify all downstream consumers"
    echo "   3. Provide migration documentation"
    exit 1
fi

echo ""
echo "✅ All contracts are backward compatible"
```

### 在 GitHub Actions / CI 中集成

```yaml
# .github/workflows/contract-check.yml
name: Data Contract Check

on:
  pull_request:
    paths:
      - 'contracts/**'
      - 'app/Http/Controllers/Api/**'
      - 'app/Http/Resources/**'

jobs:
  breaking-change-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install openapi-diff
        run: npm install @openapitools/openapi-diff

      - name: Check for Breaking Changes
        run: |
          chmod +x scripts/check-contract-diff.sh
          ./scripts/check-contract-diff.sh origin/${{ github.base_ref }} HEAD

  pact-verification:
    runs-on: ubuntu-latest
    needs: breaking-change-check
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: ffi

      - name: Install dependencies
        run: composer install --no-progress

      - name: Start User Service
        run: php artisan serve --port=8001 &
        env:
          APP_ENV: testing

      - name: Run Pact Provider Verification
        run: php artisan test --filter=UserApiVerificationTest
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
```

### 自定义 Laravel 契约检测 Artisan 命令

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class DetectBreakingChanges extends Command
{
    protected $signature = 'contract:diff
        {--old= : Old contract version path}
        {--new= : New contract version path}';

    protected $description = 'Detect breaking changes between two JSON Schema versions';

    private array $breakingChanges = [];

    public function handle(): int
    {
        $oldPath = $this->option('old');
        $newPath = $this->option('new');

        $oldSchema = json_decode(File::get($oldPath), true);
        $newSchema = json_decode(File::get($newPath), true);

        $this->compareSchemas($oldSchema, $newSchema, '');

        if (empty($this->breakingChanges)) {
            $this->info('✅ No breaking changes detected.');
            return self::SUCCESS;
        }

        $this->newLine();
        $this->error('💥 Breaking changes detected:');
        $this->newLine();

        foreach ($this->breakingChanges as $change) {
            $this->error("  ❌ {$change['type']}: {$change['path']}");
            $this->line("     {$change['description']}");
        }

        $this->newLine();
        $this->warn('Total breaking changes: ' . count($this->breakingChanges));

        return self::FAILURE;
    }

    private function compareSchemas(
        array $old,
        array $new,
        string $path
    ): void {
        $oldProperties = $old['properties'] ?? [];
        $newProperties = $new['properties'] ?? [];
        $oldRequired = $old['required'] ?? [];
        $newRequired = $new['required'] ?? [];

        // 检测被删除的字段
        foreach (array_keys($oldProperties) as $field) {
            $fieldPath = "{$path}.{$field}";
            if (!isset($newProperties[$field])) {
                $this->breakingChanges[] = [
                    'type'        => 'FIELD_REMOVED',
                    'path'        => $fieldPath,
                    'description' => "Field '{$field}' was removed. "
                        . "Consumers depending on this field will break.",
                ];
            }
        }

        // 检测新增的必填字段
        $newlyRequired = array_diff($newRequired, $oldRequired);
        foreach ($newlyRequired as $field) {
            if (isset($oldProperties[$field])) {
                // 字段已存在但变为必填
                $this->breakingChanges[] = [
                    'type'        => 'FIELD_BECAME_REQUIRED',
                    'path'        => "{$path}.{$field}",
                    'description' => "Field '{$field}' is now required. "
                        . "Existing consumers may not provide it.",
                ];
            } else {
                // 新字段且为必填
                $this->breakingChanges[] = [
                    'type'        => 'REQUIRED_FIELD_ADDED',
                    'path'        => "{$path}.{$field}",
                    'description' => "New required field '{$field}' added. "
                        . "Existing consumers will not provide it.",
                ];
            }
        }

        // 检测类型变更
        foreach ($newProperties as $field => $newDef) {
            if (!isset($oldProperties[$field])) {
                continue;
            }
            $oldDef = $oldProperties[$field];
            $fieldPath = "{$path}.{$field}";

            // 类型变更检测
            $oldType = $oldDef['type'] ?? null;
            $newType = $newDef['type'] ?? null;
            if ($oldType && $newType && $oldType !== $newType) {
                $this->breakingChanges[] = [
                    'type'        => 'TYPE_CHANGED',
                    'path'        => $fieldPath,
                    'description' => "Type of '{$field}' changed from "
                        . "{$oldType} to {$newType}.",
                ];
            }

            // 枚举范围缩小检测
            if (isset($oldDef['enum']) && isset($newDef['enum'])) {
                $removedValues = array_diff($oldDef['enum'], $newDef['enum']);
                if (!empty($removedValues)) {
                    $this->breakingChanges[] = [
                        'type'        => 'ENUM_VALUES_REMOVED',
                        'path'        => $fieldPath,
                        'description' => "Removed enum values for '{$field}': "
                            . implode(', ', $removedValues),
                    ];
                }
            }

            // 递归检查嵌套对象
            if (($oldDef['type'] ?? '') === 'object' &&
                ($newDef['type'] ?? '') === 'object') {
                $this->compareSchemas($oldDef, $newDef, $fieldPath);
            }
        }
    }
}
```

运行方式：

```bash
php artisan contract:diff \
    --old=contracts/user/v1.1.json \
    --new=contracts/user/v2.0.json
```

输出示例：

```
💥 Breaking changes detected:

  ❌ FIELD_REMOVED: .avatar_url
     Field 'avatar_url' was removed. Consumers depending on this field will break.
  ❌ TYPE_CHANGED: .id
     Type of 'id' changed from integer to string.
  ❌ ENUM_VALUES_REMOVED: .role
     Removed enum values for 'role': guest

Total breaking changes: 3
```

---

## Laravel 实战代码示例

### Contract 验证中间件（完整实现）

下面是一个生产级的契约验证中间件，它在 Provider 端自动验证响应是否符合声明的 Schema：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use JsonSchema\Validator;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class ValidateResponseContract
{
    private Validator $validator;

    public function __construct()
    {
        $this->validator = new Validator();
    }

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 只验证 JSON 响应和成功状态码
        if (!$this->shouldValidate($response)) {
            return $response;
        }

        $contractVersion = $request->attributes->get(
            'contract_version',
            '1.2.0'
        );

        $schema = $this->loadSchema($request->route()->getName(), $contractVersion);

        if (!$schema) {
            return $response;
        }

        $responseData = json_decode($response->getContent());
        $this->validator->validate($responseData, $schema);

        if (!$this->validator->isValid()) {
            Log::error('Response violates data contract', [
                'route'  => $request->route()->getName(),
                'version' => $contractVersion,
                'errors'  => $this->validator->getErrors(),
                'data'    => $responseData,
            ]);

            // 在开发/测试环境直接报错，生产环境仅记录日志
            if (app()->environment('local', 'testing')) {
                return response()->json([
                    'error'           => 'contract_violation',
                    'message'         => 'Response violates the data contract',
                    'contract_errors' => $this->validator->getErrors(),
                ], 500);
            }
        }

        return $response;
    }

    private function shouldValidate(Response $response): bool
    {
        $contentType = $response->headers->get('Content-Type', '');
        return str_contains($contentType, 'application/json')
            && $response->getStatusCode() >= 200
            && $response->getStatusCode() < 300;
    }

    private function loadSchema(?string $routeName, string $version): ?object
    {
        if (!$routeName) {
            return null;
        }

        $cacheKey = "contract_schema:{$routeName}:{$version}";

        return Cache::remember($cacheKey, 3600, function () use (
            $routeName,
            $version
        ) {
            $path = base_path(
                "contracts/schemas/{$routeName}/v{$version}.json"
            );

            if (!File::exists($path)) {
                return null;
            }

            return json_decode(File::get($path));
        });
    }
}
```

### 使用 FormRequest 进行请求契约验证

在 Consumer 端，使用自定义 FormRequest 确保发送的数据符合契约：

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Exceptions\HttpResponseException;

class CreateOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // 这些规则与 order-service 的数据契约 v2.1.0 保持一致
        return [
            'user_id'    => 'required|integer|min:1',
            'items'      => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|min:1',
            'items.*.quantity'   => 'required|integer|min:1|max:999',
            'items.*.price'      => 'required|numeric|min:0.01',
            'currency'   => 'required|string|size:3', // ISO 4217
            'metadata'   => 'nullable|array',
            'metadata.source'   => 'nullable|string|max:50',
            'metadata.version'  => 'nullable|string|max:20',
        ];
    }

    public function messages(): array
    {
        return [
            'user_id.required' => 'The user_id is required by the order contract.',
            'items.min'        => 'At least one item is required by the order contract.',
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'error'   => 'contract_validation_failed',
            'message' => 'Request does not comply with the order data contract v2.1.0',
            'details' => $validator->errors(),
        ], 422));
    }
}
```

### 契约驱动的 API Resource

使用 Laravel API Resource 确保响应格式严格符合契约：

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserContractResource extends JsonResource
{
    private string $contractVersion;

    public function __construct($resource, string $contractVersion = '1.2.0')
    {
        parent::__construct($resource);
        $this->contractVersion = $contractVersion;
    }

    public function toArray(Request $request): array
    {
        return match ($this->contractVersion) {
            '1.0.0' => $this->toV1(),
            '1.1.0' => $this->toV1_1(),
            default => $this->toV1_2(),
        };
    }

    private function toV1(): array
    {
        return [
            'id'        => (int) $this->id,
            'user_name' => (string) $this->username,
            'email'     => (string) $this->email,
            'is_active' => (bool) $this->is_active,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }

    private function toV1_1(): array
    {
        return [
            'id'         => (int) $this->id,
            'username'   => (string) $this->username,
            'email'      => (string) $this->email,
            'avatar_url' => $this->avatar_url,
            'is_active'  => (bool) $this->is_active,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }

    private function toV1_2(): array
    {
        return [
            'id'         => (int) $this->id,
            'username'   => (string) $this->username,
            'email'      => (string) $this->email,
            'avatar_url' => $this->avatar_url,
            'is_active'  => (bool) $this->is_active,
            'role'       => (string) $this->role,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
```

在控制器中使用：

```php
public function show(Request $request, int $id): JsonResponse
{
    $user = User::findOrFail($id);
    $version = $request->attributes->get('contract_version', '1.2.0');

    return UserContractResource::make($user, $version)
        ->response()
        ->header('X-Contract-Version', $version);
}
```

### 契约注册中心（本地版）

如果不想引入外部 Pact Broker，可以构建一个轻量级的本地契约注册中心：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Cache;

class ContractRegistry
{
    private string $contractsPath;

    public function __construct()
    {
        $this->contractsPath = storage_path('app/contracts');
    }

    public function register(
        string $provider,
        string $consumer,
        string $version,
        array $schema
    ): void {
        $path = "{$this->contractsPath}/{$provider}/{$consumer}/v{$version}.json";
        File::ensureDirectoryExists(dirname($path));
        File::put($path, json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $this->clearCache($provider);
    }

    public function getConsumers(string $provider): array
    {
        $providerPath = "{$this->contractsPath}/{$provider}";
        if (!File::isDirectory($providerPath)) {
            return [];
        }

        return File::directories($providerPath);
    }

    public function getSchema(
        string $provider,
        string $consumer,
        string $version
    ): ?array {
        $path = "{$this->contractsPath}/{$provider}/{$consumer}/v{$version}.json";
        if (!File::exists($path)) {
            return null;
        }

        return json_decode(File::get($path), true);
    }

    public function getLatestVersion(string $provider): string
    {
        return Cache::remember("contract_latest:{$provider}", 3600, function () use ($provider) {
            $path = "{$this->contractsPath}/{$provider}/latest.json";
            if (File::exists($path)) {
                return json_decode(File::get($path), true)['version'] ?? '1.0.0';
            }
            return '1.0.0';
        });
    }

    public function getAllSchemas(string $provider): array
    {
        $cacheKey = "contract_all:{$provider}";

        return Cache::remember($cacheKey, 3600, function () use ($provider) {
            $schemas = [];
            $providerPath = "{$this->contractsPath}/{$provider}";

            if (!File::isDirectory($providerPath)) {
                return $schemas;
            }

            foreach (File::allFiles($providerPath) as $file) {
                if ($file->getExtension() === 'json') {
                    $schemas[$file->getFilenameWithoutExtension()] =
                        json_decode($file->getContents(), true);
                }
            }

            return $schemas;
        });
    }

    private function clearCache(string $provider): void
    {
        Cache::forget("contract_latest:{$provider}");
        Cache::forget("contract_all:{$provider}");
    }
}
```

---

## 生产环境踩坑与最佳实践

### 踩坑 1：Schema 与实际数据的漂移

最常见的问题是 Schema 定义与实际 API 返回数据逐渐不同步。即使有 CI 检测，开发者也可能在紧急修复时绕过验证直接上线。

**解决方案**：在每个服务的 Health Check 端点中加入契约自检：

```php
Route::get('/health/contracts', function () {
    $registry = app(ContractRegistry::class);
    $provider = config('app.service_name');
    $issues = [];

    $schemas = $registry->getAllSchemas($provider);
    foreach ($schemas as $name => $schema) {
        try {
            // 从数据库采样数据验证
            $sampleData = app("App\\Services\\{$name}Sampler")->sample();
            $validator = new \JsonSchema\Validator();
            $validator->validate(
                json_decode(json_encode($sampleData)),
                json_decode(json_encode($schema))
            );
            if (!$validator->isValid()) {
                $issues[$name] = $validator->getErrors();
            }
        } catch (\Throwable $e) {
            $issues[$name] = ['exception' => $e->getMessage()];
        }
    }

    return response()->json([
        'contracts_healthy' => empty($issues),
        'issues' => $issues,
    ], empty($issues) ? 200 : 503);
});
```

### 踩坑 2：嵌套对象和数组的版本化

当响应包含深层嵌套对象时，版本化策略需要特别注意。推荐的做法是为每个子对象定义独立的 Schema 并使用 `$ref` 引用：

```
contracts/
├── user/
│   ├── v1.0.json
│   └── v1.2.json
├── order/
│   ├── v1.0.json
│   └── v2.0.json
├── shared/
│   ├── address/v1.0.json
│   ├── money/v1.0.json
│   └── pagination/v1.0.json
```

共享 Schema 的好处是：当 `address` 格式变更时，所有引用它的 Schema 都需要更新，避免遗漏。

### 踩坑 3：Consumer 版本碎片化

随着时间推移，不同 Consumer 可能依赖不同版本的契约。当支持的版本过多时，维护成本急剧上升。

**解决方案**：制定明确的版本生命周期策略：

```php
<?php

namespace App\Services;

class ContractVersionLifecycle
{
    // 版本状态
    public const STATUS_ACTIVE     = 'active';
    public const STATUS_DEPRECATED = 'deprecated';
    public const STATUS_SUNSET     = 'sunset';
    public const STATUS_REMOVED    = 'removed';

    private array $versionPolicy = [
        '1.0.0' => self::STATUS_SUNSET,     // 即将移除
        '1.1.0' => self::STATUS_DEPRECATED,  // 已废弃
        '1.2.0' => self::STATUS_ACTIVE,      // 当前活跃
    ];

    // 保留最近 N 个 MINOR 版本
    private int $maxSupportedVersions = 3;

    // 废弃后强制移除的天数
    private int $sunsetDays = 90;

    public function isVersionSupported(string $version): bool
    {
        return isset($this->versionPolicy[$version])
            && $this->versionPolicy[$version] !== self::STATUS_REMOVED;
    }

    public function getVersionStatus(string $version): string
    {
        return $this->versionPolicy[$version] ?? self::STATUS_REMOVED;
    }

    public function getActiveVersions(): array
    {
        return array_keys(
            array_filter($this->versionPolicy, fn ($status) => $status === self::STATUS_ACTIVE)
        );
    }
}
```

### 踩坑 4：测试数据与契约状态的管理

Pact 测试中的 `given()` 状态需要与测试数据库精确同步。在并行测试时容易出现冲突。

**最佳实践**：

```php
<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;

trait ManagesContractStates
{
    protected function setUpContractState(string $state): void
    {
        // 使用独立的测试数据库连接
        DB::connection('contract_testing')->beginTransaction();

        match ($state) {
            'a user with ID 42 exists' => $this->seedUser(42),
            'no user with ID 99999 exists' => $this->removeUser(99999),
            'a user with admin role exists' => $this->seedAdminUser(),
            default => throw new \RuntimeException(
                "Unknown contract state: {$state}"
            ),
        };
    }

    protected function tearDownContractState(): void
    {
        DB::connection('contract_testing')->rollBack();
    }

    private function seedUser(int $id): void
    {
        DB::connection('contract_testing')->table('users')->insert([
            'id' => $id,
            'username' => 'test_user_' . $id,
            'email' => "user{$id}@test.example.com",
            'is_active' => true,
            'role' => 'user',
            'created_at' => now(),
        ]);
    }

    private function removeUser(int $id): void
    {
        DB::connection('contract_testing')->table('users')
            ->where('id', $id)
            ->delete();
    }
}
```

### 最佳实践总结

1. **契约文件版本控制**：将契约文件（JSON Schema / OpenAPI Spec）与代码一起存放在 Git 仓库中，放在独立的 `contracts/` 目录。
2. **CI 强制检查**：在 CI Pipeline 中加入 Breaking Change 检测步骤，Breaking Change 必须经过人工审批。
3. **版本生命周期管理**：每个版本都有明确的状态和过期时间，避免无限维护老版本。
4. **Consumer Notification**：当 Provider 计划发布 Breaking Change 时，通过 Pact Broker 或内部消息系统自动通知下游 Consumer 团队。
5. **监控与告警**：在生产环境中监控契约验证失败率，当失败率突增时自动告警。
6. **渐进式迁移**：Breaking Change 发布时，同时支持新旧版本至少一个 MINOR 版本周期，给下游充分的迁移时间。
7. **文档自动生成**：从 JSON Schema / OpenAPI Spec 自动生成 API 文档，确保文档与契约始终一致。

---

## 总结

数据契约是微服务架构中保障服务间数据交换可靠性的关键基础设施。本文从实战角度出发，介绍了如何在 Laravel 微服务中落地 Pact-style 数据契约：

1. **定义契约**：使用 JSON Schema 或 OpenAPI Spec 作为数据契约的标准格式，语言无关、工具链成熟。
2. **版本化管理**：基于语义版本和 Header 版本控制策略，支持多版本并存和平滑迁移。
3. **验证机制**：通过 Contract 验证中间件、FormRequest 校验、API Resource 适配等多层验证确保数据一致性。
4. **Breaking Change 检测**：通过 CI 自动化对比 Schema Diff，结合 Pact 框架的 Consumer-Driven 验证，在代码合并前就发现不兼容变更。

数据契约不是银弹，它需要团队建立相应的流程和文化。但一旦建立起来，它将成为微服务架构中最可靠的安全网——让接口变更从"悄悄上线导致事故"变成"提前发现、提前沟通、平滑迁移"。

如果你正在构建 Laravel 微服务架构，建议从最核心的两三个服务间接口开始试点数据契约，逐步推广到全服务链路。工具和流程可以循序渐进，但核心理念——**让消费者定义契约，让变更可检测**——应该从第一天就贯穿始终。

---

## 相关阅读

- [Strangler Fig Pattern 实战：Laravel 单体到微服务的渐进式迁移]({% post_path Strangler-Fig-Pattern-实战-Laravel-单体到微服务的渐进式迁移 %})——微服务拆分的渐进式迁移策略，与数据契约配合实现平滑过渡
- [Outbox Pattern 实战：保证数据库与消息队列的最终一致性]({% post_path Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium %})——微服务间事件驱动通信的数据一致性保障
- [Circuit Breaker 深度实战：PHP 手写熔断器 vs Laravel HTTP Client 的 resilience 模式]({% post_path Circuit-Breaker-深度实战-PHP-手写熔断器-vs-Laravel-HTTP-Client-resilience-模式 %})——微服务间调用的高可用防护，与数据契约共同构建健壮的服务间通信
