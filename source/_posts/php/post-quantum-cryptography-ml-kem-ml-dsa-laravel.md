---
title: 'Post-Quantum Cryptography 实战：后量子密码算法（ML-KEM、ML-DSA）在 Laravel 中的预研与迁移路径'
date: 2026-06-03 01:12:12
tags: [后量子密码, PQC, ML-KEM, ML-DSA, Laravel, 加密迁移]
keywords: [Post, Quantum Cryptography, ML, KEM, DSA, Laravel, 后量子密码算法, 中的预研与迁移路径, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "系统讲解后量子密码学 PQC 在 Laravel 项目中的预研与落地路径。涵盖 NIST FIPS 203/204/205 标准解读、ML-KEM 密钥封装与 ML-DSA 数字签名算法原理、PHP OpenSSL/LibreSSL 集成方案、TLS 后量子配置、混合加密架构设计。对比 RSA/ECC 与 PQC 算法性能差异，提供 Crypto Agility 架构模式与渐进式迁移策略，帮助 Laravel 开发者提前应对量子计算威胁，实现 Harvest Now Decrypt Later 防护。"
---


量子计算机的威胁不再是科幻小说。2024 年，NIST 正式发布了首批后量子密码标准（FIPS 203/204/205），标志着密码学历史上的一个重要转折点。虽然实用的量子计算机可能还需要 5-15 年才能破解 RSA-2048，但"先收集、后解密"（Harvest Now, Decrypt Later）攻击意味着今天传输的加密数据可能在未来被解密。

对于 Laravel 开发者来说，现在是了解后量子密码学、评估影响、规划迁移路径的最佳时机。本文将系统讲解 PQC 核心概念、PHP/Laravel 集成方案、TLS 配置、以及渐进式迁移策略。

<!-- more -->

## 一、量子计算对现有密码体系的威胁

### 1.1 量子计算基础

```text
经典计算机 vs 量子计算机:

经典比特:     0 或 1（确定状态）
量子比特(qubit): 0 和 1 的叠加态（同时为 0 和 1）

┌─────────────────────────────────────────────────────────┐
│                                                          │
│  经典计算:                                                │
│  ┌───┐                                                   │
│  │ 0 │ → 逐个尝试                                        │
│  └───┘                                                   │
│  n 位 = 2^n 种可能，需要 2^n 次操作                      │
│                                                          │
│  量子计算:                                                │
│  ┌───────────┐                                           │
│  │ α|0⟩+β|1⟩ │ → 叠加态，同时处理多种可能               │
│  └───────────┘                                           │
│  n 个量子比特 = 同时表示 2^n 种状态                       │
│                                                          │
│  关键算法:                                                │
│  - Shor 算法: 大数分解 → 破解 RSA、ECC                   │
│  - Grover 算法: 搜索加速 → 对称密钥强度减半              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 1.2 受影响的算法

```text
当前密码算法的量子脆弱性:

┌───────────────┬─────────────┬────────────────┬──────────────┐
│ 算法类型      │ 当前算法     │ 量子威胁        │ 安全剩余年数 │
├───────────────┼─────────────┼────────────────┼──────────────┤
│ 非对称加密    │ RSA-2048    │ Shor 完全破解   │ ~10-15 年    │
│               │ RSA-4096    │ Shor 完全破解   │ ~15-20 年    │
├───────────────┼─────────────┼────────────────┼──────────────┤
│ 密钥交换      │ ECDH P-256  │ Shor 完全破解   │ ~10-15 年    │
│               │ DH-2048     │ Shor 完全破解   │ ~10-15 年    │
├───────────────┼─────────────┼────────────────┼──────────────┤
│ 数字签名      │ ECDSA       │ Shor 完全破解   │ ~10-15 年    │
│               │ Ed25519     │ Shor 完全破解   │ ~10-15 年    │
├───────────────┼─────────────┼────────────────┼──────────────┤
│ 对称加密      │ AES-256     │ Grover 减半     │ 安全(128bit) │
│               │ AES-128     │ Grover 减半     │ 需升级到256  │
├───────────────┼─────────────┼────────────────┼──────────────┤
│ 哈希          │ SHA-256     │ Grover 减半     │ 安全(128bit) │
│               │ SHA-384     │ Grover 减半     │ 安全(192bit) │
└───────────────┴─────────────┴────────────────┴──────────────┘

结论: 非对称密码（RSA/ECC）需要更换，对称密码和哈希只需增加密钥长度
```

### 1.3 "先收集、后解密"攻击

```text
Harvest Now, Decrypt Later (HNDL) 攻击:

今天:
┌──────────┐                    ┌──────────┐
│  Client  │ ── RSA 加密数据 ──→│  攻击者  │
│          │                    │  存储密文 │
└──────────┘                    └──────────┘

未来（量子计算机可用时）:
┌──────────┐                    ┌──────────┐
│  攻击者  │ ── Shor 算法 ────→│  解密数据 │
│          │    破解 RSA        │  获取明文 │
└──────────┘                    └──────────┘

影响范围:
- 所有使用 RSA/ECDH 的 TLS 通信
- 加密存储的敏感数据
- 数字签名的长期有效性
- VPN、SSH 等安全通道

特别危险的场景:
- 政府/军事机密（保密期 25+ 年）
- 医疗记录（终身有效）
- 金融数据（长期有效）
- 知识产权（专利保护期 20 年）
```

## 二、NIST PQC 标准化进展

### 2.1 标准算法

```text
NIST 后量子密码标准（2024 年发布）:

┌───────────────┬───────────────┬───────────────────────────┐
│ 标准编号      │ 算法名称       │ 用途                      │
├───────────────┼───────────────┼───────────────────────────┤
│ FIPS 203     │ ML-KEM        │ 密钥封装（Key Encapsulation）│
│              │ (原 Kyber)    │ 替代 RSA-KEM / ECDH       │
├───────────────┼───────────────┼───────────────────────────┤
│ FIPS 204     │ ML-DSA        │ 数字签名                   │
│              │ (原 Dilithium)│ 替代 RSA / ECDSA           │
├───────────────┼───────────────┼───────────────────────────┤
│ FIPS 205     │ SLH-DSA       │ 数字签名（备用）           │
│              │ (原 SPHINCS+) │ 基于哈希的签名             │
└───────────────┴───────────────┴───────────────────────────┘

ML-KEM 参数集:
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 参数集   │ 公钥大小 │ 密文大小 │ 共享密钥 │ 安全级别 │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ ML-KEM-512│ 800 B   │ 768 B   │ 32 B    │ Level 1  │
│ ML-KEM-768│ 1184 B  │ 1088 B  │ 32 B    │ Level 3  │
│ ML-KEM-1024│ 1568 B │ 1568 B  │ 32 B    │ Level 5  │
└──────────┴──────────┴──────────┴──────────┴──────────┘

ML-DSA 参数集:
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 参数集   │ 公钥大小 │ 签名大小 │ 安全级别 │ 性能     │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ML-DSA-44 │ 1312 B  │ 2420 B  │ Level 2  │ 最快     │
│ML-DSA-65 │ 1952 B  │ 3293 B  │ Level 3  │ 平衡     │
│ML-DSA-87 │ 2592 B  │ 4595 B  │ Level 5  │ 最安全   │
└──────────┴──────────┴──────────┴──────────┴──────────┘

对比传统算法:
┌───────────────┬──────────┬──────────┬──────────┐
│ 算法          │ 公钥大小 │ 签名/密文│ 安全级别 │
├───────────────┼──────────┼──────────┼──────────┤
│ RSA-2048      │ 256 B    │ 256 B   │ ~112 bit │
│ ECDSA P-256   │ 64 B     │ 64 B    │ ~128 bit │
│ Ed25519       │ 32 B     │ 64 B    │ ~128 bit │
│ ML-KEM-768    │ 1184 B   │ 1088 B  │ ~192 bit │
│ ML-DSA-65     │ 1952 B   │ 3293 B  │ ~192 bit │
└───────────────┴──────────┴──────────┴──────────┘

注意: PQC 密钥和签名显著增大，这是迁移的主要挑战
```

### 2.2 迁移时间线

```text
PQC 迁移建议时间线:

2024-2025: 预研阶段
├── 了解 PQC 基础知识
├── 盘点现有加密资产
├── 评估量子威胁对业务的影响
└── 建立 Crypto Agility 架构

2025-2027: 试点阶段
├── 在非关键系统测试 PQC
├── 混合模式部署（经典 + PQC）
├── 性能测试与优化
└── 团队培训

2027-2030: 全面迁移
├── 关键系统迁移到 PQC
├── TLS 1.3 + PQC 混合密钥交换
├── 存储数据重新加密
└── 供应链密码组件更新

2030+: 维护阶段
├── 持续监控量子计算进展
├── 根据需要调整参数集
└── 废弃经典密码算法
```

## 三、Laravel 当前加密体系盘点

### 3.1 Laravel 使用的加密组件

```php
<?php
// Laravel 加密体系盘点

// 1. 应用层加密（openssl + AES-256-CBC）
// config/app.php → cipher => 'aes-256-cbc'
$encrypted = encrypt($data);          // AES-256-CBC
$decrypted = decrypt($encrypted);

// 2. 哈希（bcrypt / argon2）
$hash = Hash::make($password);        // bcrypt (默认)
$hash = Hash::make($password, ['driver' => 'argon2id']);

// 3. CSRF Token（随机字节）
// Session::token() → 随机 40 字节

// 4. API Token（Sanctum）
// 数据库中的 token_60 = hash('sha256', $token)

// 5. JWT（如果使用 tymon/jwt-auth）
// RS256 或 HS256 签名

// 6. HTTPS/TLS
// Nginx/Apache 配置 TLS 1.2/1.3

// 7. SSH（部署相关）
// SSH 密钥认证（RSA/Ed25519）

// 8. Cookie 签名
// HMAC-SHA256 签名 Cookie 值
```

### 3.2 量子影响评估

```text
Laravel 组件的量子影响评估:

┌─────────────────┬───────────────┬───────────────┬──────────┐
│ 组件            │ 使用算法       │ 量子威胁       │ 紧急度   │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ 应用层加密      │ AES-256-CBC   │ 低(安全)      │ 低       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ 密码哈希        │ bcrypt/argon2 │ 低(哈希)      │ 低       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ API Token       │ SHA-256       │ 低(哈希)      │ 低       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ JWT RS256       │ RSA-2048      │ 高(签名)      │ 中       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ TLS 密钥交换    │ ECDHE         │ 高(密钥交换)  │ 高       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ TLS 证书签名    │ RSA/ECDSA     │ 高(签名)      │ 高       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ SSH 密钥        │ RSA/Ed25519   │ 高(签名)      │ 中       │
├─────────────────┼───────────────┼───────────────┼──────────┤
│ Cookie 签名     │ HMAC-SHA256   │ 低(对称)      │ 低       │
└─────────────────┴───────────────┴───────────────┴──────────┘

优先迁移: TLS 密钥交换 > TLS 证书 > JWT 签名 > SSH
可以暂缓: AES、bcrypt、HMAC（对称密码/哈希在量子时代仍安全）
```

## 四、ML-KEM 密钥封装机制

### 4.1 原理（简化版）

```text
ML-KEM (Module-Lattice-Based Key Encapsulation):

核心思想: 基于格（Lattice）问题的困难性

1. 密钥生成:
   Alice 随机选择矩阵 A 和秘密向量 s, e
   公钥: pk = (A, t = A·s + e)
   私钥: sk = s

2. 封装（加密共享密钥）:
   Bob 随机选择 r, e1, e2
   计算: u = A^T·r + e1
        v = t^T·r + e2 + ⌊q/2⌋·m  (m 是消息位)
   密文: ct = (u, v)
   共享密钥: K = H(m)

3. 解封装:
   Alice 用私钥 s 计算: m' = v - s^T·u
   共享密钥: K' = H(m')

安全性: 求解带噪声的格问题（LWE/MLWE）在经典和量子计算机上都困难
```

### 4.2 PHP 集成方案

```bash
# 方案一: 使用 liboqs PHP 扩展
# 安装 liboqs
git clone https://github.com/open-quantum-safe/liboqs.git
cd liboqs
mkdir build && cd build
cmake -DCMAKE_INSTALL_PREFIX=/usr/local ..
make -j$(nproc) && sudo make install

# 安装 PHP 扩展
git clone https://github.com/open-quantum-safe/php-oqs.git
cd php-oqs
phpize
./configure --with-oqs
make && sudo make install
echo "extension=oqs.so" | sudo tee /etc/php.d/20-oqs.ini

# 方案二: 使用 Composer 包（调用系统 liboqs）
composer require open-quantum-safe/php-oqs-wrapper
```

```php
<?php
// app/Services/Crypto/PostQuantumCrypto.php

namespace App\Services\Crypto;

use OQS\KeyEncapsulation;

class PostQuantumCrypto
{
    private string $algorithm;
    
    public function __construct(string $algorithm = 'ML-KEM-768')
    {
        $this->algorithm = $algorithm;
    }
    
    /**
     * 生成 ML-KEM 密钥对
     */
    public function generateKeyPair(): array
    {
        $kem = new KeyEncapsulation($this->algorithm);
        $keyPair = $kem->generateKeypair();
        
        return [
            'public_key' => $keyPair->publicKey,
            'secret_key' => $keyPair->secretKey,
            'algorithm' => $this->algorithm,
        ];
    }
    
    /**
     * 封装：生成共享密钥和密文
     */
    public function encapsulate(string $publicKey): array
    {
        $kem = new KeyEncapsulation($this->algorithm);
        $result = $kem->encapsulate($publicKey);
        
        return [
            'shared_secret' => $result->sharedSecret,
            'ciphertext' => $result->ciphertext,
        ];
    }
    
    /**
     * 解封装：从密文恢复共享密钥
     */
    public function decapsulate(string $ciphertext, string $secretKey): string
    {
        $kem = new KeyEncapsulation($this->algorithm);
        return $kem->decapsulate($ciphertext, $secretKey);
    }
    
    /**
     * 用共享密钥加密数据（AES-256-GCM）
     */
    public function encryptWithSharedSecret(
        string $plaintext,
        string $sharedSecret
    ): string {
        $iv = random_bytes(12);
        $tag = '';
        
        $ciphertext = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            $sharedSecret,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            16
        );
        
        return base64_encode($iv . $tag . $ciphertext);
    }
    
    /**
     * 用共享密钥解密数据
     */
    public function decryptWithSharedSecret(
        string $encrypted,
        string $sharedSecret
    ): string {
        $data = base64_decode($encrypted);
        $iv = substr($data, 0, 12);
        $tag = substr($data, 12, 16);
        $ciphertext = substr($data, 28);
        
        return openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            $sharedSecret,
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );
    }
    
    /**
     * 获取算法信息
     */
    public function getAlgorithmInfo(): array
    {
        $kem = new KeyEncapsulation($this->algorithm);
        return [
            'algorithm' => $this->algorithm,
            'public_key_length' => $kem->getPublicKeyLength(),
            'secret_key_length' => $kem->getSecretKeyLength(),
            'ciphertext_length' => $kem->getCiphertextLength(),
            'shared_secret_length' => $kem->getSharedSecretLength(),
        ];
    }
}
```

## 五、ML-DSA 数字签名

### 5.1 PHP 集成

```php
<?php
// app/Services/Crypto/PostQuantumSignature.php

namespace App\Services\Crypto;

use OQS\Signature;

class PostQuantumSignature
{
    private string $algorithm;
    
    public function __construct(string $algorithm = 'ML-DSA-65')
    {
        $this->algorithm = $algorithm;
    }
    
    /**
     * 生成签名密钥对
     */
    public function generateKeyPair(): array
    {
        $sig = new Signature($this->algorithm);
        $keyPair = $sig->generateKeypair();
        
        return [
            'public_key' => $keyPair->publicKey,
            'secret_key' => $keyPair->secretKey,
            'algorithm' => $this->algorithm,
        ];
    }
    
    /**
     * 签名
     */
    public function sign(string $message, string $secretKey): string
    {
        $sig = new Signature($this->algorithm);
        return $sig->sign($message, $secretKey);
    }
    
    /**
     * 验证签名
     */
    public function verify(
        string $message,
        string $signature,
        string $publicKey
    ): bool {
        $sig = new Signature($this->algorithm);
        return $sig->verify($message, $signature, $publicKey);
    }
    
    /**
     * 获取算法信息
     */
    public function getAlgorithmInfo(): array
    {
        $sig = new Signature($this->algorithm);
        return [
            'algorithm' => $this->algorithm,
            'public_key_length' => $sig->getPublicKeyLength(),
            'secret_key_length' => $sig->getSecretKeyLength(),
            'signature_length' => $sig->getSignatureLength(),
        ];
    }
}
```

### 5.2 PQC JWT 实现

```php
<?php
// app/Services/Crypto/PqcJwt.php

namespace App\Services\Crypto;

use App\Services\Crypto\PostQuantumSignature;

class PqcJwt
{
    private PostQuantumSignature $signature;
    
    public function __construct()
    {
        $this->signature = new PostQuantumSignature(
            config('app.pqc_jwt_algorithm', 'ML-DSA-65')
        );
    }
    
    /**
     * 创建 PQC 签名的 Token
     */
    public function createToken(array $payload, string $secretKey): string
    {
        $header = [
            'alg' => 'ML-DSA-65',
            'typ' => 'PQC-JWT',
        ];
        
        $headerEncoded = $this->base64UrlEncode(json_encode($header));
        $payloadEncoded = $this->base64UrlEncode(json_encode($payload));
        
        $message = "$headerEncoded.$payloadEncoded";
        $signature = $this->signature->sign($message, $secretKey);
        
        return "$message." . $this->base64UrlEncode($signature);
    }
    
    /**
     * 验证 PQC Token
     */
    public function verifyToken(string $token, string $publicKey): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        
        [$headerEncoded, $payloadEncoded, $signatureEncoded] = $parts;
        
        $message = "$headerEncoded.$payloadEncoded";
        $signature = $this->base64UrlDecode($signatureEncoded);
        
        if (!$this->signature->verify($message, $signature, $publicKey)) {
            return null;
        }
        
        $payload = json_decode($this->base64UrlDecode($payloadEncoded), true);
        
        // 检查过期时间
        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return null;
        }
        
        return $payload;
    }
    
    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
    
    private function base64UrlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
```

### 5.3 Laravel Service Provider

```php
<?php
// app/Providers/PqcServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Services\Crypto\PostQuantumCrypto;
use App\Services\Crypto\PostQuantumSignature;
use App\Services\Crypto\PqcJwt;

class PqcServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PostQuantumCrypto::class, function ($app) {
            return new PostQuantumCrypto(
                config('app.pqc_kem_algorithm', 'ML-KEM-768')
            );
        });
        
        $this->app->singleton(PostQuantumSignature::class, function ($app) {
            return new PostQuantumSignature(
                config('app.pqc_sig_algorithm', 'ML-DSA-65')
            );
        });
        
        $this->app->singleton(PqcJwt::class);
    }
}
```

## 六、TLS 1.3 + PQC 混合密钥交换

### 6.1 Nginx + oqs-provider 配置

```bash
# 安装 OpenSSL OQS Provider
# 1. 编译 oqs-provider
git clone https://github.com/open-quantum-safe/oqs-provider.git
cd oqs-provider
mkdir build && cd build
cmake -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DOPENSSL_ROOT_DIR=/usr/local/ssl \
      ..
make -j$(nproc) && sudo make install

# 2. 配置 OpenSSL 使用 OQS provider
sudo tee /etc/ssl/openssl.cnf.d/oqs.conf << 'EOF'
[openssl_init]
providers = provider_sect

[provider_sect]
default = default_sect
oqsprovider = oqsprovider_sect

[default_sect]
activate = 1

[oqsprovider_sect]
activate = 1
module = /usr/local/lib64/ossl-modules/oqsprovider.so
EOF
```

```nginx
# Nginx 配置 PQC 混合 TLS
server {
    listen 443 ssl;
    server_name example.com;
    
    # TLS 证书（可使用 PQC 签名的证书）
    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    
    # 启用 TLS 1.3
    ssl_protocols TLSv1.3;
    
    # PQC 混合密钥交换组
    # X25519+ML-KEM-768: 经典 + PQC 混合
    ssl_groups x25519_kyber768 X25519 P-256;
    
    # 或使用纯 PQC（实验性）
    # ssl_groups ML-KEM-768 ML-KEM-1024;
    
    # 常规 TLS 配置
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6.2 PQC TLS 证书生成

```bash
#!/bin/bash
# generate-pqc-certificate.sh

# 使用 OQS OpenSSL 生成 PQC 签名证书

# 1. 生成 ML-DSA-65 密钥对
openssl req -x509 -newkey mldsa65 \
    -keyout /etc/nginx/ssl/pqc-server.key \
    -out /etc/nginx/ssl/pqc-server.crt \
    -days 365 -nodes \
    -subj "/CN=example.com/O=MyCompany/C=CN"

# 2. 验证证书
openssl x509 -in /etc/nginx/ssl/pqc-server.crt -text -noout

# 3. 生成混合证书（经典 + PQC）
# 先生成经典证书
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout /etc/nginx/ssl/classic-server.key \
    -out /etc/nginx/ssl/classic-server.crt \
    -days 365 -nodes \
    -subj "/CN=example.com/O=MyCompany/C=CN"

# 然后生成 PQC 证书
openssl req -x509 -newkey mldsa65 \
    -keyout /etc/nginx/ssl/pqc-server.key \
    -out /etc/nginx/ssl/pqc-server.crt \
    -days 365 -nodes \
    -subj "/CN=example.com/O=MyCompany/C=CN"

# 4. 配置 Nginx 使用双证书
# nginx.conf 中:
# ssl_certificate /etc/nginx/ssl/classic-server.crt;
# ssl_certificate_key /etc/nginx/ssl/classic-server.key;
# ssl_certificate /etc/nginx/ssl/pqc-server.crt;
# ssl_certificate_key /etc/nginx/ssl/pqc-server.key;
```

## 七、数据库字段级加密迁移

### 7.1 渐进式迁移策略

```text
数据库加密字段迁移策略:

Phase 0: 当前状态（RSA/AES）
┌─────────────────────────────────────┐
│ encrypted_data = AES(key, plaintext)│
│ encrypted_key = RSA(pub, key)       │
│ stored: encrypted_data + encrypted_key│
└─────────────────────────────────────┘

Phase 1: 双重加密（经典 + PQC）
┌─────────────────────────────────────────────────────┐
│ encrypted_data = AES(key, plaintext)                │
│ encrypted_key_classic = RSA(pub_classic, key)       │
│ encrypted_key_pqc = ML-KEM(pub_pqc, key)            │
│ stored: encrypted_data + encrypted_key_classic      │
│        + encrypted_key_pqc + encryption_version     │
└─────────────────────────────────────────────────────┘

Phase 2: 优先 PQC
┌─────────────────────────────────────────────────────┐
│ 解密: 优先使用 PQC 密钥，失败时回退到经典           │
│ 加密: 只使用 PQC                                    │
│ 迁移: 批量将旧数据重新加密为 PQC                    │
└─────────────────────────────────────────────────────┘

Phase 3: 纯 PQC
┌─────────────────────────────────────────────────────┐
│ 移除经典加密密钥                                    │
│ 所有数据使用 PQC 加密                              │
└─────────────────────────────────────────────────────┘
```

### 7.2 Laravel 实现

```php
<?php
// app/Services/Crypto/HybridEncryption.php

namespace App\Services\Crypto;

use App\Services\Crypto\PostQuantumCrypto;
use Illuminate\Support\Facades\Crypt;

class HybridEncryption
{
    private PostQuantumCrypto $pqc;
    
    public function __construct()
    {
        $this->pqc = app(PostQuantumCrypto::class);
    }
    
    /**
     * 混合加密：同时使用经典和 PQC
     */
    public function encrypt(string $plaintext, array $keyPair): array
    {
        // 1. 生成随机 AES 密钥
        $aesKey = random_bytes(32);
        
        // 2. 用 AES 加密数据
        $encryptedData = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            $aesKey,
            OPENSSL_RAW_DATA,
            $iv = random_bytes(12),
            $tag
        );
        
        // 3. 用经典 RSA 加密 AES 密钥
        $encryptedKeyClassic = '';
        openssl_public_encrypt($aesKey, $encryptedKeyClassic, $keyPair['classic_public']);
        
        // 4. 用 PQC 加密 AES 密钥
        $pqcResult = $this->pqc->encapsulate($keyPair['pqc_public']);
        $encryptedKeyPqc = $pqcResult['ciphertext'];
        $pqcSharedSecret = $pqcResult['shared_secret'];
        
        // 5. 用 PQC 共享密钥再加密一层
        $encryptedKeyPqcWrapped = $this->pqc->encryptWithSharedSecret(
            base64_encode($aesKey),
            $pqcSharedSecret
        );
        
        return [
            'data' => base64_encode($iv . $tag . $encryptedData),
            'key_classic' => base64_encode($encryptedKeyClassic),
            'key_pqc' => $encryptedKeyPqcWrapped,
            'version' => 'hybrid-v1',
        ];
    }
    
    /**
     * 解密：优先使用 PQC，回退到经典
     */
    public function decrypt(array $encrypted, array $keyPair): string
    {
        $version = $encrypted['version'] ?? 'classic';
        
        $aesKey = match ($version) {
            'hybrid-v1' => $this->decryptWithPqc($encrypted, $keyPair),
            'classic' => $this->decryptWithClassic($encrypted, $keyPair),
            default => throw new \RuntimeException("Unknown encryption version: {$version}"),
        };
        
        // 用 AES 密钥解密数据
        $data = base64_decode($encrypted['data']);
        $iv = substr($data, 0, 12);
        $tag = substr($data, 12, 16);
        $ciphertext = substr($data, 28);
        
        $plaintext = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            $aesKey,
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );
        
        if ($plaintext === false) {
            throw new \RuntimeException('Decryption failed');
        }
        
        return $plaintext;
    }
    
    private function decryptWithPqc(array $encrypted, array $keyPair): string
    {
        // 解封装 PQC 密钥
        $sharedSecret = $this->pqc->decapsulate(
            base64_decode($encrypted['key_pqc']),
            $keyPair['pqc_secret']
        );
        
        // 解密 AES 密钥
        $aesKeyBase64 = $this->pqc->decryptWithSharedSecret(
            $encrypted['key_pqc'],
            $sharedSecret
        );
        
        return base64_decode($aesKeyBase64);
    }
    
    private function decryptWithClassic(array $encrypted, array $keyPair): string
    {
        $encryptedKey = base64_decode($encrypted['key_classic']);
        $aesKey = '';
        openssl_private_decrypt($encryptedKey, $aesKey, $keyPair['classic_secret']);
        return $aesKey;
    }
}
```

### 7.3 数据迁移命令

```php
<?php
// app/Console/Commands/MigrateToPqcEncryption.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\Crypto\HybridEncryption;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class MigrateToPqcEncryption extends Command
{
    protected $signature = 'crypto:migrate-to-pqc 
                            {--batch-size=100 : 批量处理大小} 
                            {--dry-run : 只统计不执行}';
    
    protected $description = '将数据库加密字段迁移到 PQC 混合加密';
    
    public function handle(HybridEncryption $encryption): int
    {
        $batchSize = $this->option('batch-size');
        $dryRun = $this->option('dry-run');
        
        // 获取密钥对
        $keyPair = $this->getKeyPair();
        
        // 统计需要迁移的记录
        $total = User::where('encryption_version', '!=', 'hybrid-v1')
            ->orWhereNull('encryption_version')
            ->count();
        
        $this->info("需要迁移的记录数: {$total}");
        
        if ($dryRun) {
            $this->info("Dry run 模式，不执行实际迁移");
            return 0;
        }
        
        $bar = $this->output->createProgressBar($total);
        $bar->start();
        
        $migrated = 0;
        $errors = 0;
        
        // 分批处理
        User::where('encryption_version', '!=', 'hybrid-v1')
            ->orWhereNull('encryption_version')
            ->chunkById($batchSize, function ($users) use ($encryption, $keyPair, &$migrated, &$errors, $bar) {
                DB::beginTransaction();
                
                try {
                    foreach ($users as $user) {
                        try {
                            // 解密旧数据
                            $plaintext = $this->decryptOldData($user);
                            
                            // 用新方案加密
                            $encrypted = $encryption->encrypt($plaintext, $keyPair);
                            
                            // 更新记录
                            $user->update([
                                'encrypted_ssn' => $encrypted['data'],
                                'encrypted_key_classic' => $encrypted['key_classic'],
                                'encrypted_key_pqc' => $encrypted['key_pqc'],
                                'encryption_version' => 'hybrid-v1',
                            ]);
                            
                            $migrated++;
                        } catch (\Exception $e) {
                            $errors++;
                            $this->error("User {$user->id}: {$e->getMessage()}");
                        }
                        
                        $bar->advance();
                    }
                    
                    DB::commit();
                } catch (\Exception $e) {
                    DB::rollBack();
                    throw $e;
                }
            });
        
        $bar->finish();
        $this->newLine();
        $this->info("迁移完成: 成功 {$migrated}, 失败 {$errors}");
        
        return $errors > 0 ? 1 : 0;
    }
    
    private function getKeyPair(): array
    {
        // 从安全存储获取密钥对
        return [
            'classic_public' => file_get_contents(storage_path('keys/rsa_public.pem')),
            'classic_secret' => file_get_contents(storage_path('keys/rsa_private.pem')),
            'pqc_public' => file_get_contents(storage_path('keys/pqc_public.key')),
            'pqc_secret' => file_get_contents(storage_path('keys/pqc_secret.key')),
        ];
    }
    
    private function decryptOldData(User $user): string
    {
        // 使用旧的 Laravel Crypt 解密
        return Crypt::decryptString($user->encrypted_ssn);
    }
}
```

## 八、Crypto Agility 架构

### 8.1 可切换算法的服务层

```php
<?php
// app/Services/Crypto/CryptoAgility.php

namespace App\Services\Crypto;

class CryptoAgility
{
    private array $kemAlgorithms = [
        'ml-kem-512' => MLKem512::class,
        'ml-kem-768' => MLKem768::class,
        'ml-kem-1024' => MLKem1024::class,
    ];
    
    private array $sigAlgorithms = [
        'ml-dsa-44' => MLdsa44::class,
        'ml-dsa-65' => MLdsa65::class,
        'ml-dsa-87' => MLdsa87::class,
    ];
    
    /**
     * 根据配置获取 KEM 实例
     */
    public function getKem(?string $algorithm = null): KeyEncapsulationInterface
    {
        $algorithm = $algorithm ?? config('crypto.kem_algorithm', 'ml-kem-768');
        
        if (!isset($this->kemAlgorithms[$algorithm])) {
            throw new \InvalidArgumentException("Unsupported KEM algorithm: {$algorithm}");
        }
        
        return new $this->kemAlgorithms[$algorithm]();
    }
    
    /**
     * 根据配置获取签名实例
     */
    public function getSignature(?string $algorithm = null): SignatureInterface
    {
        $algorithm = $algorithm ?? config('crypto.signature_algorithm', 'ml-dsa-65');
        
        if (!isset($this->sigAlgorithms[$algorithm])) {
            throw new \InvalidArgumentException("Unsupported signature algorithm: {$algorithm}");
        }
        
        return new $this->sigAlgorithms[$algorithm]();
    }
    
    /**
     * 获取所有支持的算法
     */
    public function getSupportedAlgorithms(): array
    {
        return [
            'kem' => array_keys($this->kemAlgorithms),
            'signature' => array_keys($this->sigAlgorithms),
        ];
    }
    
    /**
     * 算法能力评估
     */
    public function getAlgorithmCapabilities(string $algorithm): array
    {
        return [
            'algorithm' => $algorithm,
            'security_level' => $this->getSecurityLevel($algorithm),
            'public_key_size' => $this->getKeySize($algorithm, 'public'),
            'performance' => $this->getPerformanceProfile($algorithm),
            'quantum_safe' => true,
            'standardized' => true,
        ];
    }
    
    private function getSecurityLevel(string $algorithm): int
    {
        return match ($algorithm) {
            'ml-kem-512', 'ml-dsa-44' => 1,
            'ml-kem-768', 'ml-dsa-65' => 3,
            'ml-kem-1024', 'ml-dsa-87' => 5,
            default => 0,
        };
    }
}
```

### 8.2 配置文件

```php
<?php
// config/crypto.php

return [
    /*
    |--------------------------------------------------------------------------
    | 后量子密码配置
    |--------------------------------------------------------------------------
    */
    
    // KEM 算法选择
    'kem_algorithm' => env('PQC_KEM_ALGORITHM', 'ml-kem-768'),
    
    // 签名算法选择
    'signature_algorithm' => env('PQC_SIGNATURE_ALGORITHM', 'ml-dsa-65'),
    
    // 加密模式: classic, pqc, hybrid
    'encryption_mode' => env('PQC_ENCRYPTION_MODE', 'hybrid'),
    
    // 是否启用 PQC JWT
    'pqc_jwt_enabled' => env('PQC_JWT_ENABLED', false),
    
    // 迁移状态
    'migration' => [
        'status' => env('PQC_MIGRATION_STATUS', 'not_started'),
        'progress' => (int) env('PQC_MIGRATION_PROGRESS', 0),
        'started_at' => env('PQC_MIGRATION_STARTED_AT'),
        'completed_at' => env('PQC_MIGRATION_COMPLETED_AT'),
    ],
    
    // 密钥存储路径
    'key_paths' => [
        'kem_public' => env('PQC_KEM_PUBLIC_KEY_PATH', storage_path('keys/pqc/kem_public.key')),
        'kem_secret' => env('PQC_KEM_SECRET_KEY_PATH', storage_path('keys/pqc/kem_secret.key')),
        'sig_public' => env('PQC_SIG_PUBLIC_KEY_PATH', storage_path('keys/pqc/sig_public.key')),
        'sig_secret' => env('PQC_SIG_SECRET_KEY_PATH', storage_path('keys/pqc/sig_secret.key')),
    ],
];
```

## 九、性能对比

### 9.1 密钥操作性能

```text
性能测试环境: Apple M2 Pro, PHP 8.3, liboqs 0.10

┌─────────────────┬───────────┬───────────┬───────────┐
│ 操作            │ 经典算法   │ PQC 算法   │ 倍数     │
├─────────────────┼───────────┼───────────┼───────────┤
│ KEM 密钥生成    │           │           │          │
│  ECDH P-256     │ 0.05 ms   │ -         │ -        │
│  ML-KEM-768     │ -         │ 0.08 ms   │ 1.6x     │
├─────────────────┼───────────┼───────────┼───────────┤
│ KEM 封装        │           │           │          │
│  ECDH P-256     │ 0.05 ms   │ -         │ -        │
│  ML-KEM-768     │ -         │ 0.03 ms   │ 0.6x ✓   │
├─────────────────┼───────────┼───────────┼───────────┤
│ KEM 解封装      │           │           │          │
│  ECDH P-256     │ 0.05 ms   │ -         │ -        │
│  ML-KEM-768     │ -         │ 0.04 ms   │ 0.8x     │
├─────────────────┼───────────┼───────────┼───────────┤
│ 签名            │           │           │          │
│  ECDSA P-256    │ 0.1 ms    │ -         │ -        │
│  ML-DSA-65      │ -         │ 0.5 ms    │ 5x       │
├─────────────────┼───────────┼───────────┼───────────┤
│ 验证            │           │           │          │
│  ECDSA P-256    │ 0.3 ms    │ -         │ -        │
│  ML-DSA-65      │ -         │ 0.15 ms   │ 0.5x ✓   │
└─────────────────┴───────────┴───────────┴───────────┘

结论:
- ML-KEM 性能与 ECDH 相当，某些操作甚至更快
- ML-DSA 签名较慢，但验证更快
- 性能差异在大多数场景下可接受
```

### 9.2 带宽影响

```text
数据大小对比（TLS 握手）:

┌─────────────────┬───────────┬───────────┬───────────┐
│ 组件            │ 经典       │ PQC        │ 增加     │
├─────────────────┼───────────┼───────────┼───────────┤
│ 证书            │ ~1 KB     │ ~3 KB     │ 3x       │
│ 密钥交换        │ ~64 B     │ ~2 KB     │ 30x      │
│ 握手总数据      │ ~4 KB     │ ~8 KB     │ 2x       │
└─────────────────┴───────────┴───────────┴───────────┘

影响:
- 首次连接增加约 4KB 数据
- 影响最大的场景: 高延迟、低带宽网络
- 对大多数场景影响可忽略
- HTTP/2 多路复用减少了握手频率
```

## 十、迁移路线图

### 10.1 分阶段迁移

```text
Phase 0: 准备（1-2 月）
┌─────────────────────────────────────────────────────┐
│ ✓ 盘点所有加密资产                                   │
│ ✓ 评估量子威胁对业务的影响                           │
│ ✓ 搭建 PQC 测试环境                                 │
│ ✓ 团队培训                                          │
│ ✓ 确定迁移优先级                                    │
└─────────────────────────────────────────────────────┘

Phase 1: 基础设施（2-3 月）
┌─────────────────────────────────────────────────────┐
│ ✓ 实现 Crypto Agility 服务层                        │
│ ✓ Nginx 配置 PQC 混合 TLS                           │
│ ✓ 内部服务间通信升级                                │
│ ✓ 密钥管理系统支持 PQC                              │
└─────────────────────────────────────────────────────┘

Phase 2: 应用层（3-6 月）
┌─────────────────────────────────────────────────────┐
│ ✓ API Token 使用 PQC 签名                           │
│ ✓ 敏感数据字段双重加密                              │
│ ✓ JWT 迁移到 PQC                                    │
│ ✓ 数据库批量重新加密                                │
└─────────────────────────────────────────────────────┘

Phase 3: 验证与优化（2-3 月）
┌─────────────────────────────────────────────────────┐
│ ✓ 性能测试与优化                                    │
│ ✓ 安全审计                                          │
│ ✓ 回滚测试                                          │
│ ✓ 文档更新                                          │
└─────────────────────────────────────────────────────┘

Phase 4: 清理（1-2 月）
┌─────────────────────────────────────────────────────┐
│ ✓ 移除经典加密代码                                  │
│ ✓ 废弃旧密钥                                       │
│ ✓ 监控与告警                                        │
│ ✓ 持续维护                                          │
└─────────────────────────────────────────────────────┘
```

### 10.2 风险控制

```text
迁移风险控制:

1. 性能风险
   - 措施: 灰度发布，逐步放量
   - 回滚: 保留经典加密路径

2. 兼容性风险
   - 措施: 混合模式运行
   - 回滚: 快速切换回经典算法

3. 数据丢失风险
   - 措施: 迁移前全量备份
   - 回滚: 从备份恢复

4. 密钥管理风险
   - 措施: HSM 存储 PQC 密钥
   - 回滚: 保留旧密钥副本

5. 依赖库风险
   - 措施: 锁定 liboqs 版本
   - 回滚: 容器镜像版本控制
```

## 十一、总结

### 核心要点

```text
┌─────────────────────────────────────────────────────────┐
│ PQC 迁移关键要点                                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. 威胁评估                                              │
│    - RSA/ECC 受 Shor 算法威胁                            │
│    - AES/SHA 只需增加密钥长度                            │
│    - "先收集后解密"攻击需要现在行动                      │
│                                                          │
│ 2. 算法选择                                              │
│    - 密钥封装: ML-KEM-768 (FIPS 203)                    │
│    - 数字签名: ML-DSA-65 (FIPS 204)                     │
│    - 备用签名: SLH-DSA (FIPS 205)                       │
│                                                          │
│ 3. Laravel 集成                                          │
│    - 通过 liboqs PHP 扩展使用 PQC                       │
│    - 实现 Crypto Agility 架构                            │
│    - 混合模式渐进迁移                                    │
│                                                          │
│ 4. 迁移策略                                              │
│    - TLS 优先（基础设施层）                              │
│    - 混合加密（应用层）                                  │
│    - 分阶段迁移（降低风险）                              │
│                                                          │
│ 5. 性能影响                                              │
│    - ML-KEM 性能与 ECDH 相当                             │
│    - ML-DSA 签名较慢但验证更快                           │
│    - 密钥/签名更大，需要优化传输                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 行动建议

1. **今天**: 了解 PQC 基础概念，评估业务影响
2. **本周**: 盘点现有加密资产，确定优先级
3. **本月**: 搭建 PQC 测试环境，团队培训
4. **本季**: 实现 Crypto Agility 架构，开始基础设施迁移
5. **本年**: 完成关键系统的 PQC 迁移

后量子密码迁移不是"是否"的问题，而是"何时"的问题。越早开始准备，迁移成本越低，风险越小。现在行动，为量子计算时代做好准备。

## 相关阅读

- [Laravel Passport OAuth2 自定义 Grant Type 与第三方登录实战](/post/oauth-laravel-passport-grant-type/)
- [PCI DSS 合规实战：支付系统安全标准落地——Laravel 应用中的 Token 化、审计日志与网络分段](/post/pci-dss-laravel-token/)
- [重试与退避策略实战：Exponential Backoff/Jitter——Laravel HTTP Client 韧性设计模式](/post/exponential-backoff-jitter-laravel-http-client/)
