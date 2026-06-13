---
title: Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理——Laravel 应用的密钥轮换与审计日志
date: 2026-06-03 09:00:00
tags: [Secrets-Management, HashiCorp-Vault, SOPS, age, 安全, Laravel]
categories:
  - devops
cover: /images/covers/secrets-management-vault-sops-cover.jpg
description: "生产环境的密钥管理是安全基础设施的核心。本文深入对比 HashiCorp Vault、SOPS、age 三种主流密钥管理方案在 Laravel 应用中的实战落地，涵盖动态凭据生成、自动密钥轮换、审计日志配置、CI/CD 集成等关键场景。通过真实踩坑案例讲解 .env 文件的安全隐患，提供从零搭建 Vault 集群、SOPS 加密工作流的完整步骤，帮助团队选择最适合自身规模的密钥管理策略，彻底告别明文密钥泄露风险。"
---

# Secrets Management 实战：HashiCorp Vault/SOPS/age 密钥管理——Laravel 应用的密钥轮换与审计日志

## 一、为什么 .env 不够安全？

每个 Laravel 项目都有一个 `.env` 文件，里面存放着数据库密码、API Key、Redis 凭据等敏感信息。这个文件被 `gitignore` 了，看起来很安全——但真的是这样吗？

### .env 的典型问题

```bash
# .env 典型内容
DB_PASSWORD=SuperSecret123!
AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
JWT_SECRET=my-jwt-secret-key
```

**问题清单：**

| 问题 | 影响 | 严重程度 |
|------|------|---------|
| 明文存储在磁盘 | 服务器被入侵即泄露 | 🔴 高 |
| 多人共享同一份 | 无法审计谁访问了什么 | 🔴 高 |
| 无法自动轮换 | 密钥泄露后换密钥需手动操作 | 🟡 中 |
| Git 历史残留 | 曾经误提交过 .env 的人不在少数 | 🔴 高 |
| 无访问控制 | 能 SSH 就能看所有密钥 | 🔴 高 |
| 无法审计 | 谁在什么时候读了密钥？不知道 | 🟡 中 |
| 跨环境混乱 | staging 和 production 用同一套密钥 | 🟡 中 |

### 真实安全事故案例

2019 年，某知名 Laravel SaaS 公司因为前员工的开发机 `.env` 文件泄露（该开发机未加密），导致攻击者获取了生产数据库的 root 密钥，最终 50 万用户数据泄露。事后复盘发现：

1. 生产环境的数据库密码从未更换过
2. 所有环境（dev/staging/prod）共用同一个 AWS key
3. 没有任何密钥访问日志

这些都可以通过 Secrets Management 解决。

## 二、Secrets Management 核心原则

### 2.1 CIA 三要素在密钥管理中的映射

```
┌─────────────────────────────────────────────────┐
│           Secrets Management 核心原则            │
├─────────────────────────────────────────────────┤
│                                                  │
│  Confidentiality（机密性）                       │
│  ├─ 加密存储（静态加密）                         │
│  ├─ 传输加密（TLS）                              │
│  └─ 最小权限访问                                 │
│                                                  │
│  Integrity（完整性）                             │
│  ├─ 防篡改（签名/校验）                          │
│  ├─ 版本控制                                     │
│  └─ 审计日志                                     │
│                                                  │
│  Availability（可用性）                          │
│  ├─ 高可用部署                                   │
│  ├─ 自动故障转移                                 │
│  └─ 备份与恢复                                   │
│                                                  │
│  额外原则：                                      │
│  ├─ Rotation（轮换）：密钥定期更换               │
│  ├─ Revocation（撤销）：即时失效                 │
│  └─ Auditing（审计）：全链路追踪                 │
└─────────────────────────────────────────────────┘
```

### 2.2 密钥管理成熟度模型

```
Level 0: 明文硬编码在代码中
Level 1: .env 文件 + gitignore
Level 2: 加密的 .env 文件（SOPS/age）
Level 3: 集中式密钥管理（Vault）
Level 4: 自动轮换 + 审计日志 + 最小权限
Level 5: 零信任 + 短生命周期凭据 + 动态密钥
```

## 三、HashiCorp Vault：企业级密钥管理

### 3.1 Vault 架构概览

```
┌──────────────────────────────────────────────────┐
│                Vault 架构                         │
├──────────────────────────────────────────────────┤
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │              Vault Server                    │  │
│  │                                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Auth     │  │ Secret   │  │ Audit    │  │  │
│  │  │ Methods  │  │ Engines  │  │ Devices  │  │  │
│  │  │          │  │          │  │          │  │  │
│  │  │ Token    │  │ KV v2    │  │ File     │  │  │
│  │  │ AppRole  │  │ PKI      │  │ Syslog   │  │  │
│  │  │ LDAP     │  │ Transit  │  │ Socket   │  │  │
│  │  │ K8s      │  │ Database │  │          │  │  │
│  │  │ AWS      │  │ AWS      │  │          │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  │  │
│  │                                              │  │
│  │  ┌────────────────────────────────────────┐ │  │
│  │  │          Storage Backend                │ │  │
│  │  │  Consul / Raft / PostgreSQL / S3        │ │  │
│  │  └────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐ │
│  │ Laravel│  │  CI/CD │  │  K8s   │  │ Scripts│ │
│  │  App   │  │ Runner │  │  Pods  │  │        │ │
│  └────────┘  └────────┘  └────────┘  └────────┘ │
└──────────────────────────────────────────────────┘
```

### 3.2 安装与启动

```bash
# Docker 快速启动（开发模式）
docker run -d --name vault-dev \
  -p 8200:8200 \
  -e VAULT_DEV_ROOT_TOKEN_ID=my-root-token \
  -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 \
  hashicorp/vault:1.15

# 生产模式配置 (vault.hcl)
storage "raft" {
  path    = "/vault/data"
  node_id = "vault-node-1"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/tls/cert.pem"
  tls_key_file  = "/vault/tls/key.pem"
}

api_addr = "https://vault.example.com:8200"
cluster_addr = "https://vault.example.com:8201"
ui = true

# Seal 配置 (Shamir 或 Auto Unseal with KMS)
seal "awskms" {
  region     = "ap-northeast-1"
  kms_key_id = "alias/vault-unseal"
}
```

```bash
# 初始化 Vault
vault operator init -key-shares=5 -key-threshold=3

# 输出（安全保存！）：
# Unseal Key 1: xxx
# Unseal Key 2: xxx
# Unseal Key 3: xxx
# Unseal Key 4: xxx
# Unseal Key 5: xxx
# Initial Root Token: hvs.xxxxx

# 解封（需要 3/5 个 unseal key）
vault operator unseal <key1>
vault operator unseal <key2>
vault operator unseal <key3>
```

### 3.3 KV Secret Engine

```bash
# 启用 KV v2 引擎
vault secrets enable -path=secret kv-v2

# 写入密钥
vault kv put secret/myapp/database \
  host="prod-db.example.com" \
  port="3306" \
  username="app_user" \
  password="SuperSecret123!"

vault kv put secret/myapp/redis \
  host="prod-redis.example.com" \
  password="RedisPass456!"

vault kv put secret/myapp/aws \
  access_key="AKIAIOSFODNN7EXAMPLE" \
  secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

# 读取密钥
vault kv get secret/myapp/database
vault kv get -field=password secret/myapp/database

# 密钥版本管理（v2 支持多版本）
vault kv put secret/myapp/database password="NewPassword789!"
vault kv get -version=1 secret/myapp/database  # 读取旧版本
vault kv rollback -version=1 secret/myapp/database  # 回滚
```

### 3.4 AppRole 认证（适合应用）

```bash
# 启用 AppRole 认证
vault auth enable approle

# 创建策略
vault policy write myapp-policy - <<EOF
path "secret/data/myapp/*" {
  capabilities = ["read", "list"]
}
path "secret/data/shared/*" {
  capabilities = ["read"]
}
EOF

# 创建 AppRole
vault write auth/approle/role/myapp \
  secret_id_ttl=10m \
  token_num_uses=10 \
  token_ttl=20m \
  token_max_ttl=30m \
  secret_id_num_uses=40 \
  policies="myapp-policy"

# 获取 Role ID 和 Secret ID
ROLE_ID=$(vault read -field=role_id auth/approle/role/myapp/role-id)
SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/myapp/secret-id)
```

### 3.5 Dynamic Database Credentials

```bash
# 启用数据库引擎
vault secrets enable database

# 配置 MySQL 连接
vault write database/config/myapp-mysql \
  plugin_name=mysql-database-plugin \
  connection_url="{{username}}:{{password}}@tcp(db.example.com:3306)/" \
  allowed_roles="myapp-readonly" \
  username="vault_admin" \
  password="VaultAdminPass!"

# 创建角色（动态生成凭据）
vault write database/roles/myapp-readonly \
  db_name=myapp-mysql \
  creation_statements="CREATE USER '{{name}}'@'%' IDENTIFIED BY '{{password}}'; \
    GRANT SELECT ON myapp.* TO '{{name}}'@'%';" \
  default_ttl="1h" \
  max_ttl="24h"

# 获取动态凭据（每次调用生成新用户！）
vault read database/creds/myapp-readonly
# Key                Value
# ---                -----
# lease_id           database/creds/myapp-readonly/abc123
# lease_duration     1h
# password           A1b2-C3d4-E5f6
# v-token-myapp-abc  A1b2-C3d4-E5f6
```

### 3.6 Laravel 集成 Vault

```bash
# 安装 Laravel Vault 包
composer require denismitr/laravel-vault
# 或者使用官方 API 客户端
composer require guzzlehttp/guzzle
```

```php
<?php
// app/Services/VaultService.php

namespace App\Services;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;

class VaultService
{
    private Client $client;
    private string $token;
    private string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = config('services.vault.url', 'https://vault.example.com:8200');
        $this->token = $this->authenticate();
        $this->client = new Client([
            'base_uri' => $this->baseUrl,
            'timeout' => 5,
            'verify' => true,
        ]);
    }

    /**
     * 通过 AppRole 认证获取 Token
     */
    private function authenticate(): string
    {
        $roleId = config('services.vault.role_id');
        $secretId = config('services.vault.secret_id');

        // 缓存 token（避免每次请求都认证）
        return Cache::remember('vault_token', 900, function () use ($roleId, $secretId) {
            $client = new Client(['base_uri' => $this->baseUrl, 'timeout' => 5]);
            $response = $client->post('/v1/auth/approle/login', [
                'json' => [
                    'role_id' => $roleId,
                    'secret_id' => $secretId,
                ]
            ]);

            $data = json_decode($response->getBody(), true);
            return $data['auth']['client_token'];
        });
    }

    /**
     * 读取 KV v2 密钥
     */
    public function getSecret(string $path, ?string $field = null): mixed
    {
        $response = $this->client->get("/v1/secret/data/{$path}", [
            'headers' => [
                'X-Vault-Token' => $this->token,
            ]
        ]);

        $data = json_decode($response->getBody(), true);
        $secretData = $data['data']['data'] ?? [];

        if ($field) {
            return $secretData[$field] ?? null;
        }

        return $secretData;
    }

    /**
     * 获取动态数据库凭据
     */
    public function getDynamicDbCredentials(string $role = 'myapp-readonly'): array
    {
        $cacheKey = "vault_db_creds_{$role}";

        return Cache::remember($cacheKey, 2700, function () use ($role) {
            $response = $this->client->get("/v1/database/creds/{$role}", [
                'headers' => ['X-Vault-Token' => $this->token]
            ]);

            $data = json_decode($response->getBody(), true);
            return [
                'username' => $data['data']['username'],
                'password' => $data['data']['password'],
                'lease_id' => $data['lease_id'],
                'ttl' => $data['lease_duration'],
            ];
        });
    }

    /**
     * 撤销凭据（应用关闭时调用）
     */
    public function revokeLease(string $leaseId): void
    {
        $this->client->put("/v1/sys/leases/revoke", [
            'headers' => ['X-Vault-Token' => $this->token],
            'json' => ['lease_id' => $leaseId]
        ]);
    }
}
```

```php
<?php
// config/services.php 中添加
return [
    'vault' => [
        'url' => env('VAULT_ADDR', 'https://vault.example.com:8200'),
        'role_id' => env('VAULT_ROLE_ID'),
        'secret_id' => env('VAULT_SECRET_ID'),
    ],
];
```

```php
<?php
// app/Providers/AppServiceProvider.php 中动态注入配置

namespace App\Providers;

use App\Services\VaultService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 从 Vault 动态加载数据库配置
        try {
            $vault = app(VaultService::class);
            $dbCreds = $vault->getDynamicDbCredentials();

            config([
                'database.connections.mysql.username' => $dbCreds['username'],
                'database.connections.mysql.password' => $dbCreds['password'],
            ]);
        } catch (\Exception $e) {
            logger()->warning('Vault unavailable, using fallback credentials');
        }
    }
}
```

## 四、SOPS：加密的配置文件

### 4.1 SOPS 简介

**SOPS** (Secrets OPerationS) 是 Mozilla 开发的加密文件编辑工具，支持加密 YAML、JSON、ENV、INI 等格式的文件。它的核心优势是**部分加密**——只加密敏感字段，保留文件结构可读。

```yaml
# 加密前
database:
  host: prod-db.example.com
  port: 3306        # 不需要加密
  username: app_user # 不需要加密
  password: SuperSecret123!  # 需要加密

# 加密后
database:
  host: prod-db.example.com
  port: 3306
  username: app_user
  password: ENC[AES256_GCM,data:abc123...,type:str]
```

### 4.2 安装与配置

```bash
# 安装 SOPS
brew install sops          # macOS
sudo apt install sops       # Ubuntu
# 或下载二进制
wget https://github.com/getsops/sops/releases/download/v3.8.1/sops-v3.8.1.linux.amd64
chmod +x sops-v3.8.1.linux.amd64
sudo mv sops-v3.8.1.linux.amd64 /usr/local/bin/sops
```

### 4.3 使用 age 加密

```bash
# 安装 age（简单现代的加密工具）
brew install age            # macOS
sudo apt install age        # Ubuntu

# 生成密钥对
age-keygen -o ~/.age/key.txt
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 使用 SOPS + age 加密 .env 文件
sops --encrypt \
  --age age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  .env.production > .env.production.enc

# 编辑加密文件（透明解密/加密）
sops .env.production.enc

# 解密输出到 stdout（供应用使用）
sops --decrypt .env.production.enc > .env
```

### 4.4 .sops.yaml 配置

```yaml
# .sops.yaml（放在仓库根目录）
creation_rules:
  # 生产环境配置 - 使用 age 加密
  - path_regex: \.production\.enc\.yaml$
    age: age1xxxxxxxxxxxxxxxx

  # Staging 环境 - 不同的密钥
  - path_regex: \.staging\.enc\.yaml$
    age: age1yyyyyyyyyyyyyyyy

  # Laravel .env 文件
  - path_regex: \.env\..*\.enc$
    age: age1xxxxxxxxxxxxxxxx
    unencrypted_suffix: _PLAINTEXT  # 以 _PLAINTEXT 结尾的 key 不加密

  # Docker Compose 配置
  - path_regex: docker-compose\.prod\.enc\.yaml$
    age: age1xxxxxxxxxxxxxxxx
    encrypted_regex: ^(password|secret|token|key)$
```

### 4.5 Laravel 集成 SOPS

```bash
#!/bin/bash
# deploy.sh - 部署时解密配置

set -euo pipefail

ENVIRONMENT=${1:-production}
VAULT_ADDR=${VAULT_ADDR:-""}

echo "=== Deploying to $ENVIRONMENT ==="

# 解密环境配置
echo "Decrypting environment config..."
sops --decrypt \
  --output .env \
  ".env.${ENVIRONMENT}.enc"

# 验证关键配置存在
required_vars=("APP_KEY" "DB_HOST" "DB_PASSWORD" "REDIS_PASSWORD")
for var in "${required_vars[@]}"; do
  if ! grep -q "^${var}=" .env; then
    echo "ERROR: Required variable $var not found in .env"
    exit 1
  fi
done

# 运行迁移
php artisan migrate --force

# 清除缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache

# 重启队列
php artisan queue:restart

# 清除解密的 .env（安全清理）
# 注意：实际环境中应用需要在内存中持有配置
# 这里只是示例，生产环境需要更精细的处理

echo "=== Deployment complete ==="
```

### 4.6 CI/CD 中的 SOPS 集成

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install SOPS and age
        run: |
          wget -q https://github.com/getsops/sops/releases/download/v3.8.1/sops-v3.8.1.linux.amd64 -O /usr/local/bin/sops
          chmod +x /usr/local/bin/sops
          wget -q https://github.com/FiloSottile/age/releases/download/v1.1.1/age-v1.1.1-linux-amd64.tar.gz
          tar xzf age-v1.1.1-linux-amd64.tar.gz
          mv age/age /usr/local/bin/

      - name: Setup age key
        run: |
          mkdir -p ~/.age
          echo "${{ secrets.AGE_PRIVATE_KEY }}" > ~/.age/key.txt
          chmod 600 ~/.age/key.txt

      - name: Decrypt production config
        run: |
          sops --decrypt --output .env .env.production.enc

      - name: Deploy
        run: |
          ./deploy.sh production
        env:
          VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
          VAULT_ROLE_ID: ${{ secrets.VAULT_ROLE_ID }}
          VAULT_SECRET_ID: ${{ secrets.VAULT_SECRET_ID }}
```

## 五、age：简单现代的加密工具

### 5.1 age vs GPG

| 特性 | age | GPG |
|------|-----|-----|
| 设计理念 | 简单、现代 | 功能全面、复杂 |
| 密钥格式 | X25519（简洁） | RSA/DSA/ECDSA（复杂） |
| 配置需求 | 零配置 | 需要 keyring 管理 |
| 学习曲线 | 5 分钟 | 数小时 |
| 文件大小 | ~3MB | ~5MB |
| 依赖 | 无 | gpg-agent, keyring |
| 适用场景 | 文件加密、SOPS 后端 | 邮件加密、代码签名 |

### 5.2 age 基础用法

```bash
# 生成密钥
age-keygen -o key.txt
# Created: key.txt
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 加密文件
age -r age1xxxxxxxxxxxxxxxxxxxxxxxxxxxx -o secret.age secret.txt

# 解密文件
age -d -i key.txt -o secret.txt secret.age

# 多接收者加密
age -r age1aaa... -r age1bbb... -o secret.age secret.txt

# 密码加密（简单场景）
age -p -o secret.age secret.txt
age -d -o secret.txt secret.age  # 提示输入密码

# 与 tar 结合加密目录
tar czf - /path/to/secrets | age -r age1xxx... -o backup.tar.gz.age
age -d backup.tar.gz.age | tar xzf -
```

## 六、Laravel 完整集成方案

### 6.1 统一密钥管理服务

```php
<?php
// app/Services/SecretsManager.php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class SecretsManager
{
    private array $cache = [];
    private string $driver;

    public function __construct()
    {
        $this->driver = env('SECRETS_DRIVER', 'sops');
    }

    /**
     * 获取密钥
     */
    public function get(string $key, mixed $default = null): mixed
    {
        if (isset($this->cache[$key])) {
            return $this->cache[$key];
        }

        try {
            $value = match ($this->driver) {
                'vault' => $this->getFromVault($key),
                'sops' => $this->getFromSops($key),
                'env' => env($key, $default),
                default => throw new \InvalidArgumentException("Unknown driver: {$this->driver}")
            };

            $this->cache[$key] = $value;
            return $value ?? $default;
        } catch (\Exception $e) {
            Log::error("Failed to get secret: {$key}", ['error' => $e->getMessage()]);
            return $default;
        }
    }

    private function getFromVault(string $key): ?string
    {
        $vault = app(VaultService::class);
        [$path, $field] = $this->parseVaultPath($key);
        return $vault->getSecret($path, $field);
    }

    private function getFromSops(string $key): ?string
    {
        static $sopsData = null;

        if ($sopsData === null) {
            $envFile = base_path('.env.' . app()->environment() . '.enc');
            if (!file_exists($envFile)) {
                return null;
            }

            $decrypted = shell_exec("sops --decrypt {$envFile} 2>/dev/null");
            if ($decrypted === null) {
                Log::warning('SOPS decryption failed');
                return null;
            }

            parse_str(str_replace("\n", '&', trim($decrypted)), $sopsData);
        }

        return $sopsData[$key] ?? null;
    }

    private function parseVaultPath(string $key): array
    {
        // DB_PASSWORD → secret/data/myapp/database → password
        $mapping = config('secrets.vault_mapping', []);
        if (isset($mapping[$key])) {
            return [$mapping[$key]['path'], $mapping[$key]['field']];
        }
        throw new \InvalidArgumentException("No Vault mapping for key: {$key}");
    }
}
```

### 6.2 Service Provider 注册

```php
<?php
// app/Providers/SecretsServiceProvider.php

namespace App\Providers;

use App\Services\SecretsManager;
use App\Services\VaultService;
use Illuminate\Support\ServiceProvider;

class SecretsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SecretsManager::class);
        $this->app->singleton(VaultService::class);

        // 便捷 facade
        $this->app->bind('secrets', fn() => app(SecretsManager::class));
    }

    public function boot(): void
    {
        // 动态覆盖 config 中的敏感值
        if ($this->app->environment('production', 'staging')) {
            $this->loadSecretsFromManager();
        }
    }

    private function loadSecretsFromManager(): void
    {
        $secrets = app(SecretsManager::class);

        $mappings = [
            'database.connections.mysql.password' => 'DB_PASSWORD',
            'redis.default.password' => 'REDIS_PASSWORD',
            'services.stripe.secret' => 'STRIPE_SECRET_KEY',
            'services.aws.credentials.secret' => 'AWS_SECRET_ACCESS_KEY',
            'app.key' => 'APP_KEY',
        ];

        foreach ($mappings as $configKey => $secretKey) {
            $value = $secrets->get($secretKey);
            if ($value !== null) {
                config([$configKey => $value]);
            }
        }
    }
}
```

## 七、密钥自动轮换策略

### 7.1 Vault Agent 自动轮换

```hcl
# vault-agent-config.hcl
vault {
  address = "https://vault.example.com:8200"
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path = "/vault/role-id"
      secret_id_file_path = "/vault/secret-id"
    }
  }

  sink "file" {
    config = {
      path = "/vault/token"
    }
  }
}

template {
  source      = "/vault/templates/database.ctmpl"
  destination = "/app/.env.database"
  perms       = "0600"
  command     = "php artisan config:cache && php artisan queue:restart"
}
```

```liquid
{{/* database.ctmpl - Consul Template 语法 */}}
DB_HOST={{ with secret "secret/data/myapp/database" }}{{ .Data.data.host }}{{ end }}
DB_PORT={{ with secret "secret/data/myapp/database" }}{{ .Data.data.port }}{{ end }}
DB_USERNAME={{ with secret "database/creds/myapp-readonly" }}{{ .Data.username }}{{ end }}
DB_PASSWORD={{ with secret "database/creds/myapp-readonly" }}{{ .Data.password }}{{ end }}
```

### 7.2 Laravel 密钥轮换中间件

```php
<?php
// app/Middleware/SecretRotationMiddleware.php

namespace App\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\SecretsManager;

class SecretRotationMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // 检查密钥是否即将过期
        $lastRotation = cache('secrets_last_rotation');
        $rotationInterval = config('secrets.rotation_interval_hours', 24);

        if ($lastRotation && now()->diffInHours($lastRotation) >= $rotationInterval) {
            // 在后台触发轮换
            dispatch(function () {
                app(SecretsManager::class)->rotate();
                cache()->put('secrets_last_rotation', now());
            })->afterResponse();
        }

        return $next($request);
    }
}
```

## 八、审计日志与合规

### 8.1 Vault 审计日志

```bash
# 启用审计日志
vault audit enable file file_path=/var/log/vault/audit.log

# 审计日志格式（JSON）
{
  "type": "response",
  "time": "2026-06-03T10:00:00Z",
  "auth": {
    "client_token": "hvs.xxxxx",
    "accessor": "xxxxx",
    "display_name": "approle-myapp",
    "policies": ["myapp-policy"]
  },
  "request": {
    "operation": "read",
    "path": "secret/data/myapp/database",
    "remote_address": "10.0.1.50"
  },
  "response": {
    "data": {
      "data": {
        "password": "*****"  # 值被 HMAC 哈希
      }
    }
  }
}
```

### 8.2 Laravel 审计日志集成

```php
<?php
// app/Listeners/SecretAccessedListener.php

namespace App\Listeners;

use App\Events\SecretAccessed;
use Illuminate\Support\Facades\Log;

class SecretAccessedListener
{
    public function handle(SecretAccessed $event): void
    {
        // 写入审计日志
        Log::channel('audit')->info('Secret accessed', [
            'key' => $event->key,
            'user_id' => auth()->id(),
            'ip' => request()->ip(),
            'user_agent' => request()->userAgent(),
            'timestamp' => now()->toIso8601String(),
            'purpose' => $event->purpose,
        ]);

        // 同时发送到 SIEM 系统
        app('siem')->report([
            'event_type' => 'secret_access',
            'severity' => 'info',
            'details' => [
                'secret_key' => $event->key,
                'requester' => auth()->user()?->email ?? 'system',
            ]
        ]);
    }
}
```

## 九、三种方案对比与选型建议

### 9.1 功能对比

| 特性 | HashiCorp Vault | SOPS + age | Laravel .env |
|------|----------------|------------|-------------|
| 集中式管理 | ✅ | ❌（文件分布式） | ❌ |
| 动态密钥 | ✅ | ❌ | ❌ |
| 自动轮换 | ✅ | 需脚本 | ❌ |
| 审计日志 | ✅ 内置 | 需自建 | ❌ |
| 访问控制 | ✅ 细粒度 | 文件权限 | 文件权限 |
| 多租户 | ✅ | ❌ | ❌ |
| 学习曲线 | 🔴 高 | 🟢 低 | 🟢 极低 |
| 运维成本 | 🔴 高 | 🟢 低 | 🟢 极低 |
| 适用规模 | 中大型 | 中小型 | 小型/开发 |
| 高可用 | 需部署 | N/A | N/A |

### 9.2 选型决策树

```
你的团队有多少人？
├─ 1-5 人
│   └─ 环境数量？
│       ├─ 1-2 个 → SOPS + age（简单够用）
│       └─ 3+ 个 → SOPS + age + CI/CD 自动化
├─ 5-20 人
│   └─ 有专职运维吗？
│       ├─ 没有 → SOPS + age
│       └─ 有 → Vault（值得投入）
└─ 20+ 人
    └─ 有合规要求吗？
        ├─ 没有 → Vault 或 SOPS
        └─ 有（SOC2/ISO27001）→ Vault（审计日志是刚需）
```

### 9.3 推荐组合方案

```
┌──────────────────────────────────────────┐
│        推荐：Vault + SOPS 组合           │
├──────────────────────────────────────────┤
│                                           │
│  开发环境 → .env + gitignore             │
│  CI/CD   → SOPS + age（加密配置文件）    │
│  Staging → Vault（共享配置）             │
│  生产环境 → Vault（动态凭据+审计）       │
│                                           │
│  密钥优先级：                            │
│  1. Vault 动态凭据（DB/Redis）           │
│  2. Vault KV（第三方 API Key）           │
│  3. SOPS 加密文件（降级方案）            │
│  4. .env（仅开发环境）                   │
└──────────────────────────────────────────┘
```

## 总结

Secrets Management 不是一个可选的安全增强，而是生产环境的**基础设施必备**。对于 Laravel 应用来说：

1. **小团队快速起步**：SOPS + age，零基础设施成本，5 分钟上手
2. **中大型团队生产环境**：HashiCorp Vault，动态凭据、自动轮换、审计日志
3. **CI/CD 管道**：SOPS 加密配置文件 + age 密钥存储在 CI Secrets 中

最重要的原则是：**永远不要将明文密钥提交到 Git，永远不要在多环境间共享密钥，永远保留密钥访问的审计记录**。

> 下一篇文章我们将探讨如何在 Kubernetes 环境中使用 External Secrets Operator 实现自动化的密钥同步。

## 相关阅读

- [Linux 安全加固实战：AppArmor/SELinux/seccomp 容器逃逸防护与最小权限落地](/categories/运维/Linux-安全加固实战-AppArmor-SELinux-seccomp-容器逃逸防护与最小权限落地/)
- [Software Bill of Materials (SBOM) 实战：Syft/Trivy 生成依赖清单——供应链安全合规与 CI 集成](/categories/运维/Software-Bill-of-Materials-SBOM-实战-Syft-Trivy生成依赖清单-供应链安全合规与CI集成踩坑记录/)
- [PCI DSS 合规实战：支付系统安全标准落地——Laravel Token 化、审计日志与网络分段](/categories/运维/2026-06-02-PCI-DSS-合规实战-支付系统安全标准落地-Laravel-Token化-审计日志与网络分段/)
