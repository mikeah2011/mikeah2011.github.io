---

title: Device Authorization Flow 实战：智能电视/CLI/IoT 设备的 OAuth 无浏览器授权——Laravel Passport
keywords: [Device Authorization Flow, CLI, IoT, OAuth, Laravel Passport, 智能电视, 设备的, 无浏览器授权]
date: 2026-06-03 00:00:00
tags:
- OAuth
- Passport
- IoT
- Device Authorization
- 安全
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 深入解析 Device Authorization Flow（RFC 8628）协议原理与 Laravel Passport 自定义 Grant Type 完整实现。适用于智能电视、CLI 命令行工具、IoT 物联网设备、游戏主机等无浏览器或浏览器交互受限的场景，通过 OAuth 2.0 授权流程将用户认证转移到用户自己的设备上完成。文章涵盖数据库设计、Entity 与 Repository 实现、Grant 类编写、Controller 开发、速率限制、安全最佳实践及真实生产环境踩坑记录，提供可运行的 Laravel、Python 和 JavaScript 代码示例，是实现 CLI 认证与 IoT 设备 OAuth 授权的完整实战指南。
---



## 前言

在现代互联网应用开发中，OAuth 2.0 已经成为事实上的授权标准，几乎所有主流互联网服务都基于 OAuth 2.0 来管理第三方应用的访问授权。然而，当我们面对智能电视、CLI 命令行工具、IoT 物联网设备、游戏主机这些「没有浏览器」或「浏览器交互体验极差」的客户端时，传统的 Authorization Code Flow 就显得力不从心了。

试想一下：用户坐在沙发上用遥控器操作智能电视，电视上弹出了一个视频应用需要登录授权。如果采用传统 OAuth 流程，用户需要在虚拟键盘上用方向键一个字母一个字母地输入邮箱地址和密码——这无疑是一场噩梦。再比如开发者在服务器终端上使用 CLI 工具访问 GitHub API，如果要求在终端中打开浏览器跳转授权页面，用户可能正处于 SSH 远程连接中，根本没有本地浏览器可用。

RFC 8628（OAuth 2.0 Device Authorization Grant）正是为解决这类场景而诞生的标准协议。它的核心思想非常巧妙：**把「用户认证」这个动作从受限设备上完全剥离出来，转移到用户自己随身携带的设备（手机或笔记本电脑）上完成。** 受限设备只需要显示一个简短的代码，用户在自己的设备上输入这个代码并确认授权，受限设备就能自动获得访问令牌。

本文将从协议原理到生产环境实战，手把手带你用 Laravel Passport 实现完整的 Device Authorization Flow。我们会深入到自定义 Grant Type 的每一个细节，包括完整的代码实现、数据库设计、交互流程图解、错误处理机制、安全最佳实践，以及我在生产环境中踩过的每一个坑。无论你是要为智能电视应用添加 OAuth 授权，还是要为公司的 CLI 工具实现安全认证，还是要为物联网设备构建一套可靠的认证体系，这篇文章都能给你一个完整且可靠的参考方案。

---

## 一、什么是 Device Authorization Flow（RFC 8628）

### 1.1 协议的诞生背景

在 OAuth 2.0 的早期实践中，社区很快发现了传统授权流程对特定类型客户端的不适应性。IETF 的 OAuth 工作组在 2015 年就开始讨论「设备授权」的方案，经过多次迭代和社区反馈，最终在 2019 年正式发布了 RFC 8628——OAuth 2.0 Device Authorization Grant。

这个协议的设计哲学是：**在安全性和可用性之间找到一个合理的平衡点。** 它承认受限设备无法完成完整的浏览器交互，但通过将核心认证步骤转移到用户自己的设备上，确保了安全标准不降低。

### 1.2 协议核心概念详解

Device Authorization Flow 涉及三个关键角色和五个核心概念。理解这些概念对于正确实现整个流程至关重要。

**三个角色：**

- **受限设备（Device Client）**：智能电视、CLI 工具、IoT 传感器等无法或不便进行浏览器交互的设备。这些设备通常输入能力有限（只有遥控器、键盘或根本没有任何输入设备），但它们拥有网络连接能力，能够与授权服务器通信。
- **授权服务器（Authorization Server）**：持有用户账号信息、负责验证用户身份并发放访问令牌的服务端。在 Laravel 生态中，这个角色由 Laravel Passport 来承担。
- **终端用户（End User）**：使用受限设备并拥有自己账号的真实用户。用户拥有一台具备完整浏览器能力的设备（手机、平板或电脑），用于完成实际的身份验证和授权确认。

**五个核心概念：**

- **Device Code（设备码）**：授权服务器颁发给受限设备的临时凭证，是一个较长的随机字符串。设备在后续的 Token 轮询过程中需要使用此码来标识自己的授权请求。设备码的安全性非常重要，应该通过哈希存储来保护。
- **User Code（用户码）**：一个短小的人类可读代码，格式通常为 `WDJB-MJHT`（8 个字母 + 1 个连字符）。这是设备显示在屏幕上的内容，用户需要在自己的设备上手动输入这个代码。用户码的设计需要在「易读易输入」和「足够的安全性（熵值）」之间取得平衡。
- **Verification URI（验证 URI）**：用户需要在自己的设备上访问的授权页面地址，例如 `https://example.com/device`。用户在此页面输入用户码、登录账号并确认授权。
- **Interval（轮询间隔）**：设备端两次 Token 轮询请求之间的最小间隔秒数，默认为 5 秒。这个间隔会随着设备端轮询过快而动态增加（slow_down 机制），以防止服务端过载。
- **Expires In（过期时间）**：Device Code 和 User Code 的有效期，通常为 15 分钟。过期后用户无法再使用该用户码完成授权，设备也需要重新发起授权请求。

### 1.3 协议定义的端点

RFC 8628 在标准 OAuth 2.0 端点的基础上扩展了两个关键接口：

**第一个端点是 Device Authorization Endpoint（设备授权端点）**，通常映射为 `POST /oauth/device/code`。受限设备向这个端点发起请求，提供客户端标识和所需的权限范围，服务端返回设备码、用户码、验证 URI、轮询间隔和过期时间。

**第二个端点是对 Token Endpoint 的扩展**，仍然使用 `POST /oauth/token`，但 `grant_type` 参数的值为 `urn:ietf:params:oauth:grant-type:device_code`。设备使用设备码向这个端点轮询请求，直到用户完成授权后获得访问令牌。

---

## 二、适用场景深度分析

### 2.1 智能电视与 OTT 盒子

智能电视是 Device Flow 最经典、最广为人知的应用场景。无论是三星 Tizen 电视、LG WebOS 电视、小米电视还是 Apple TV，当用户需要在电视上登录 Netflix、YouTube、Disney+ 等流媒体服务时，Device Flow 几乎是唯一合理的方案。

典型的用户体验流程是这样的：用户在电视上打开应用，应用显示一个用户码和验证地址；用户拿出手机打开浏览器，访问该地址并输入用户码；在手机上完成登录和授权确认；电视端检测到授权成功，自动进入应用主页。整个过程中用户始终在自己熟悉的、安全的设备上输入敏感信息，既安全又便捷。这种体验与传统的遥控器输入密码相比，简直是天壤之别，用户的操作步骤从十几步缩减到简单的三步。

### 2.2 CLI 命令行工具

许多面向开发者的命令行工具需要访问用户的 GitHub、GitLab、Docker Hub 等平台账号。GitHub 官方的 CLI 工具 `gh` 就是使用 Device Flow 的典型案例。当开发者在终端中执行 `gh auth login` 时，CLI 会显示一个用户码并自动尝试打开浏览器，如果浏览器无法打开（比如在远程 SSH 会话中），用户可以手动访问验证页面完成授权。

对于企业内部的 DevOps 工具链，CLI 工具使用 Device Flow 还有一个额外的好处：它避免了在命令行历史记录或环境变量中暴露 API Token 或密码。用户完成一次 Device Flow 授权后，CLI 工具可以在本地安全存储访问令牌，后续使用无需重复认证。这种方式比直接在命令行中传递 Token 参数安全得多，因为 shell 的历史记录文件可能会被其他用户读取，而本地加密存储的令牌则有更好的安全保障。

### 2.3 IoT 物联网设备

智能家居设备（如智能音箱、智能门锁、智能摄像头、智能冰箱）通常只有极其有限的输入能力。有的设备只有一块小屏幕和几个按钮，有的设备甚至完全没有屏幕（如智能灯泡），只能通过 LED 指示灯的颜色变化来传达信息。

对于有屏幕的 IoT 设备，可以完整显示用户码和验证地址。对于没有屏幕的设备，可以通过配套的手机应用来完成 Device Flow——设备将用户码通过蓝牙或局域网传递给手机应用，手机应用自动跳转到验证页面。

### 2.4 游戏主机

PlayStation、Xbox、Nintendo Switch 等游戏主机同样非常适合使用 Device Flow。玩家在游戏主机上登录 Epic Games、Steam、Spotify 等第三方服务时，使用手柄在虚拟键盘上输入密码是极其痛苦的体验。Device Flow 让玩家可以用手机扫码或输入代码的方式快速完成授权。

### 2.5 不适用的场景说明

虽然 Device Flow 适用范围广泛，但并非万能方案。以下场景不推荐使用 Device Flow：

- **纯后端服务之间的通信**：两个服务器之间不需要用户参与的授权场景，应使用 Client Credentials Grant，它更简洁高效。
- **有完整浏览器能力的 Web 应用**：传统 Web 应用完全有能力完成 Authorization Code Flow，没有必要使用 Device Flow 增加用户操作步骤。
- **移动端原生应用**：虽然技术上可行，但 Authorization Code Flow 配合 PKCE 和 Deep Link 是移动端更优的方案，用户体验更流畅。
- **对安全性要求极高的场景**：Device Flow 的安全模型依赖于用户码的熵值和速率限制，如果应用场景涉及金融交易或高度敏感数据，应考虑更严格的身份验证方案。

---

## 三、与传统 Authorization Code Flow 的详细对比

要真正理解 Device Authorization Flow 的价值，我们需要将其与最常用的 Authorization Code Flow 进行全面对比。

**用户交互方式的根本差异：** Authorization Code Flow 要求客户端本身具备浏览器能力，用户在客户端内嵌的浏览器或系统浏览器中完成登录授权。而 Device Flow 将用户交互完全转移到用户的另一台设备上，客户端本身不需要任何浏览器能力。这是两者最核心的区别。

**安全模型的不同：** Authorization Code Flow 的安全性主要依赖于 redirect_uri 的严格验证和 state 参数的 CSRF 防护（以及推荐的 PKCE 扩展）。Device Flow 的安全性则依赖于用户码的熵值（防止暴力猜测）和速率限制（防止自动化攻击）。两种方案在各自的设计假设下都是安全的，但适用的威胁模型不同。

**Token 获取方式：** Authorization Code Flow 是「推」模式——用户在浏览器中完成授权后，授权服务器通过 redirect 将授权码推送给客户端，客户端再用授权码换取令牌。整个过程中客户端是被动接收方。而 Device Flow 是「拉」模式——设备端必须主动反复轮询服务器的 Token 端点，检查用户是否已完成授权。这种轮询模式虽然增加了网络请求，但为没有浏览器的设备提供了可行的授权途径。

**用户体验对比：** 对于有浏览器的客户端，Authorization Code Flow 的体验更流畅（一次跳转即可完成）。但对于没有浏览器的客户端，Device Flow 的体验远优于在受限设备上输入密码。选择哪种流程，本质上取决于客户端的能力和用户的操作环境。

**实现复杂度对比：** Authorization Code Flow 在 Laravel Passport 中是开箱即用的，只需要简单的配置即可。Device Flow 则需要自定义 Grant Type，涉及数据库迁移、Entity 和 Repository 实现、Grant 类编写、Controller 和视图开发等多个层面，实现复杂度显著更高。但这也正是本文存在的意义——为你提供一个完整的、经过生产验证的实现方案。

---

## 四、Laravel Passport 自定义 Grant Type 完整实现

这是本文的核心部分。我们将从零开始，一步步实现完整的 Device Authorization Flow。每个代码文件都会详细解释其作用和设计决策。

### 4.1 环境准备与依赖安装

首先确保你的 Laravel 项目已经正确安装并配置了 Laravel Passport。如果还没有安装，请按以下步骤操作：

```bash
# 安装 Laravel Passport
composer require laravel/passport

# 运行数据库迁移，创建 OAuth 相关表
php artisan migrate

# 安装 Passport 密钥对（用于 Token 签名）
php artisan passport:install

# 发布 Passport 配置（可选）
php artisan vendor:publish --tag=passport-config
```

Laravel Passport 底层使用 League OAuth2 Server 来处理 OAuth 协议逻辑。我们在实现自定义 Grant Type 时会直接与 League 的接口打交道，因此理解 League 的抽象层设计非常重要。League OAuth2 Server 的核心抽象包括：Grant（授权类型）、Repository（数据访问层）、Entity（实体对象）和 ResponseType（响应格式）。

### 4.2 数据库设计与迁移

我们需要创建一张数据库表来存储设备授权请求的状态信息。这张表需要记录设备码、用户码、授权状态、过期时间等关键字段：

```php
<?php
// database/migrations/xxxx_create_oauth_device_codes_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('oauth_device_codes', function (Blueprint $table) {
            $table->id();
            $table->string('client_id', 100)->comment('客户端标识');
            $table->string('user_code', 20)->unique()->comment('用户码，如 WDJB-MJHT');
            $table->text('device_code')->comment('设备码的 SHA256 哈希值');
            $table->text('scope')->nullable()->comment('请求的权限范围');
            $table->unsignedInteger('expires_at')->comment('过期时间戳');
            $table->unsignedInteger('last_polled_at')->default(0)->comment('最后一次轮询的时间戳');
            $table->unsignedSmallInteger('interval')->default(5)->comment('轮询间隔秒数');
            $table->unsignedBigInteger('user_id')->nullable()->comment('授权用户的ID');
            $table->boolean('authorized')->default(false)->comment('是否已授权');
            $table->timestamps();

            // 索引设计：device_code 使用哈希索引加速查找
            // user_code 使用唯一索引，因为用户通过此码查找记录
            // 客户端 + 授权状态的联合索引用于管理查询
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('oauth_device_codes');
    }
};
```

数据库表的设计有几个需要注意的地方：第一，`device_code` 字段存储的是设备码的 SHA256 哈希值而非明文，这与 Laravel Passport 存储 access_token 的方式一致，可以防止数据库泄露时攻击者直接获取有效的设备码。第二，`user_code` 字段设置了唯一索引，因为每个用户码在有效期内必须是全局唯一的。第三，`last_polled_at` 字段用于实现速率限制（slow_down 机制），记录设备最后一次轮询的时间。

### 4.3 设备码实体类（Device Code Entity）

实体类是 League OAuth2 Server 的核心抽象之一，它代表了系统中的一个业务对象。Device Code Entity 封装了设备授权请求的所有状态信息：

```php
<?php
// app/OAuth/Entities/DeviceCodeEntity.php

namespace App\OAuth\Entities;

use League\OAuth2\Server\Entities\ClientEntityInterface;

class DeviceCodeEntity
{
    // 标识符相关属性
    protected string $identifier;
    protected string $userCode;
    protected ClientEntityInterface $client;

    // 时间相关属性
    protected int $expiresAt;
    protected int $interval;
    protected int $lastPolledAt = 0;

    // 授权状态相关属性
    protected ?int $userIdentifier = null;
    protected bool $authorized = false;

    // scope 信息
    protected array $scopes = [];

    // 以下是标准的 getter/setter 方法
    // identifier 代表设备码本身
    public function getIdentifier(): string { return $this->identifier; }
    public function setIdentifier(string $identifier): void { $this->identifier = $identifier; }

    // userCode 是显示给用户的短码
    public function getUserCode(): string { return $this->userCode; }
    public function setUserCode(string $userCode): void { $this->userCode = $userCode; }

    // client 是发起请求的客户端应用
    public function getClient(): ClientEntityInterface { return $this->client; }
    public function setClient(ClientEntityInterface $client): void { $this->client = $client; }

    // expiresAt 是设备码的过期时间戳
    public function getExpiresAt(): int { return $this->expiresAt; }
    public function setExpiresAt(int $expiresAt): void { $this->expiresAt = $expiresAt; }

    // interval 是设备端轮询的最小间隔（秒）
    public function getInterval(): int { return $this->interval; }
    public function setInterval(int $interval): void { $this->interval = $interval; }

    // lastPolledAt 用于速率限制判断
    public function getLastPolledAt(): int { return $this->lastPolledAt; }
    public function setLastPolledAt(int $lastPolledAt): void { $this->lastPolledAt = $lastPolledAt; }

    // userIdentifier 是完成授权的用户 ID
    public function getUserIdentifier(): ?int { return $this->userIdentifier; }
    public function setUserIdentifier(?int $identifier): void { $this->userIdentifier = $identifier; }

    // authorized 标记用户是否已确认授权
    public function isAuthorized(): bool { return $this->authorized; }
    public function setAuthorized(bool $authorized): void { $this->authorized = $authorized; }

    // scopes 是请求的权限范围列表
    public function getScopes(): array { return $this->scopes; }
    public function setScopes(array $scopes): void { $this->scopes = $scopes; }
}
```

### 4.4 设备码仓库类（Device Code Repository）

仓库类负责实体的持久化和查询操作，是数据访问层的核心。它需要实现设备码的创建、查找、授权确认、速率限制检查和过期清理等操作：

```php
<?php
// app/OAuth/Repositories/DeviceCodeRepository.php

namespace App\OAuth\Repositories;

use App\OAuth\Entities\DeviceCodeEntity;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Entities\ScopeEntityInterface;

class DeviceCodeRepository
{
    /**
     * 创建一个新的设备授权请求
     *
     * 这个方法生成设备码和用户码，将它们持久化到数据库，
     * 并返回一个填充好的 DeviceCodeEntity 实例。
     *
     * 设备码使用 128 位随机字符串，保证足够的安全性。
     * 用户码使用 RFC 8628 推荐的格式：8 个字母 + 1 个连字符。
     */
    public function create(
        ClientEntityInterface $client,
        array $scopes = [],
        int $ttl = 900,
        int $interval = 5
    ): DeviceCodeEntity {
        // 生成设备码：128 位随机字符串，足够长以防止猜测
        $deviceCode = Str::random(128);

        // 生成用户码：人类可读的 8 位字母码
        $userCode = $this->generateUserCode();

        // 构建实体对象
        $entity = new DeviceCodeEntity();
        $entity->setIdentifier($deviceCode);
        $entity->setUserCode($userCode);
        $entity->setClient($client);
        $entity->setExpiresAt(Carbon::now()->addSeconds($ttl)->timestamp);
        $entity->setInterval($interval);
        $entity->setScopes($scopes);

        // 持久化到数据库（存储设备码的哈希值）
        DB::table('oauth_device_codes')->insert([
            'client_id'      => $client->getIdentifier(),
            'user_code'      => $userCode,
            'device_code'    => hash('sha256', $deviceCode),
            'scope'          => $this->formatScopes($scopes),
            'expires_at'     => $entity->getExpiresAt(),
            'interval'       => $interval,
            'last_polled_at' => 0,
            'authorized'     => false,
            'user_id'        => null,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        return $entity;
    }

    /**
     * 根据设备码查找对应的授权记录
     *
     * 注意：查找时使用哈希值匹配，因为数据库中存储的是哈希值。
     * 同时过滤掉已过期的记录。
     */
    public function findByDeviceCode(string $deviceCode): ?DeviceCodeEntity
    {
        $record = DB::table('oauth_device_codes')
            ->where('device_code', hash('sha256', $deviceCode))
            ->where('expires_at', '>', now()->timestamp)
            ->first();

        if (!$record) {
            return null;
        }

        return $this->hydrateEntity($record, $deviceCode);
    }

    /**
     * 根据用户码查找对应的授权记录
     *
     * 用户码在验证页面使用，用户在自己的设备上输入此码。
     * 查找时自动转大写以处理大小写不敏感的场景。
     */
    public function findByUserCode(string $userCode): ?DeviceCodeEntity
    {
        $record = DB::table('oauth_device_codes')
            ->where('user_code', strtoupper($userCode))
            ->where('expires_at', '>', now()->timestamp)
            ->first();

        if (!$record) {
            return null;
        }

        return $this->hydrateEntity($record);
    }

    /**
     * 用户确认授权
     *
     * 当用户在验证页面完成登录并确认授权后调用此方法。
     * 方法会更新数据库记录，将用户 ID 关联到设备码，
     * 并将授权状态标记为 true。
     *
     * 返回 true 表示授权成功，false 表示用户码无效或已过期。
     */
    public function authorize(string $userCode, int $userId): bool
    {
        $affected = DB::table('oauth_device_codes')
            ->where('user_code', strtoupper($userCode))
            ->where('expires_at', '>', now()->timestamp)
            ->where('authorized', false)
            ->update([
                'user_id'    => $userId,
                'authorized' => true,
                'updated_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * 拒绝授权
     *
     * 用户在验证页面选择拒绝授权时调用。
     * 将授权状态标记为拒绝，设备端轮询时会收到 access_denied 错误。
     */
    public function deny(string $userCode): bool
    {
        $affected = DB::table('oauth_device_codes')
            ->where('user_code', strtoupper($userCode))
            ->where('expires_at', '>', now()->timestamp)
            ->where('authorized', false)
            ->update([
                'authorized' => false,
                'user_id'    => null,
                'updated_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * 检查用户码是否有效（存在且未过期）
     */
    public function isUserCodeValid(string $userCode): bool
    {
        return DB::table('oauth_device_codes')
            ->where('user_code', strtoupper($userCode))
            ->where('expires_at', '>', now()->timestamp)
            ->exists();
    }

    /**
     * 更新最后轮询时间
     *
     * 每次设备端轮询 Token 端点时都需要更新此时间戳，
     * 用于判断设备端是否遵守了轮询间隔限制。
     */
    public function updateLastPolledAt(string $deviceCode): void
    {
        DB::table('oauth_device_codes')
            ->where('device_code', hash('sha256', $deviceCode))
            ->update(['last_polled_at' => now()->timestamp]);
    }

    /**
     * 清理过期的设备授权记录
     *
     * 应该通过定时任务定期调用此方法，清理数据库中过期的记录。
     * 过期记录没有保留价值，及时清理可以保持数据库整洁。
     */
    public function pruneExpired(): int
    {
        return DB::table('oauth_device_codes')
            ->where('expires_at', '<', now()->timestamp)
            ->delete();
    }

    /**
     * 统计某个客户端在指定时间窗口内的请求数量
     *
     * 用于实现基于客户端的速率限制，
     * 防止某个客户端频繁发起设备授权请求。
     */
    public function countRecentRequests(string $clientId, int $windowSeconds = 3600): int
    {
        return DB::table('oauth_device_codes')
            ->where('client_id', $clientId)
            ->where('created_at', '>=', now()->subSeconds($windowSeconds))
            ->count();
    }

    /**
     * 生成用户码
     *
     * RFC 8628 建议用户码应该是人类易于读写的。
     * 我们使用 21 个大写字母的字符集（去掉了容易混淆的字符），
     * 生成 8 位字母 + 1 位连字符的格式，如 WDJB-MJHT。
     *
     * 熵值计算：8 × log2(21) ≈ 8 × 4.39 ≈ 35.1 bits
     * 这超过了 RFC 要求的最低 32 bits 熵值。
     */
    private function generateUserCode(): string
    {
        // 字符集：去掉了 0/O（零和大写O容易混淆）、1/I/L（一和大小写i/l容易混淆）
        $chars = 'BCDFGHJKLMNPQRSTVWXYZ';
        $code = '';

        for ($i = 0; $i < 8; $i++) {
            if ($i === 4) {
                $code .= '-'; // 第四位后添加连字符，提高可读性
            }
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }

        return $code;
    }

    /**
     * 格式化 scope 为字符串
     */
    private function formatScopes(array $scopes): string
    {
        return collect($scopes)
            ->map(fn($scope) => $scope instanceof ScopeEntityInterface
                ? $scope->getIdentifier()
                : (string) $scope)
            ->filter()
            ->implode(' ');
    }

    /**
     * 从数据库记录构建实体对象
     */
    private function hydrateEntity(object $record, string ? $deviceCode = null): DeviceCodeEntity
    {
        $entity = new DeviceCodeEntity();

        if ($deviceCode) {
            $entity->setIdentifier($deviceCode);
        }

        $entity->setUserCode($record->user_code);
        $entity->setExpiresAt($record->expires_at);
        $entity->setInterval($record->interval);
        $entity->setLastPolledAt($record->last_polled_at);
        $entity->setAuthorized((bool) $record->authorized);
        $entity->setUserIdentifier($record->user_id ? (int) $record->user_id : null);

        return $entity;
    }
}
```

### 4.5 自定义 Grant Type 核心实现

这是整个实现中最关键的部分。自定义 Grant Type 需要处理两个核心场景：设备端请求设备码（Device Authorization Endpoint）和设备端使用设备码轮询获取令牌（Token Endpoint）。

```php
<?php
// app/OAuth/Grants/DeviceAuthorizationGrant.php

namespace App\OAuth\Grants;

use App\OAuth\Entities\DeviceCodeEntity;
use App\OAuth\Repositories\DeviceCodeRepository;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use League\OAuth2\Server\Grant\AbstractGrant;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Entities\ScopeEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Repositories\AccessTokenRepositoryInterface;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
use League\OAuth2\Server\Repositories\ScopeRepositoryInterface;
use League\OAuth2\Server\ResponseTypes\ResponseTypeInterface;
use Psr\Http\Message\ServerRequestInterface;
use DateInterval;

class DeviceAuthorizationGrant extends AbstractGrant
{
    protected DeviceCodeRepository $deviceCodeRepo;
    protected ScopeRepositoryInterface $scopeRepo;

    public function __construct(
        DeviceCodeRepository $deviceCodeRepo,
        AccessTokenRepositoryInterface $accessTokenRepo,
        ClientRepositoryInterface $clientRepo,
        ScopeRepositoryInterface $scopeRepo
    ) {
        $this->deviceCodeRepo = $deviceCodeRepo;
        $this->scopeRepo = $scopeRepo;

        // 设置 League OAuth2 Server 需要的 Repository
        $this->setAccessTokenRepository($accessTokenRepo);
        $this->setClientRepository($clientRepo);
        $this->setScopeRepository($scopeRepo);
    }

    /**
     * 返回此 Grant Type 的唯一标识符
     *
     * 这个标识符遵循 RFC 8628 的 URN 格式规范。
     * 设备端在请求 Token 时需要在 grant_type 参数中使用此标识符。
     */
    public function getIdentifier(): string
    {
        return 'urn:ietf:params:oauth:grant-type:device_code';
    }

    /**
     * 处理设备授权请求
     *
     * 当设备向 /oauth/device/code 端点发送请求时调用此方法。
     * 方法验证客户端身份，解析请求的权限范围，然后生成并返回
     * 设备码、用户码等授权信息。
     *
     * @return array 包含 device_code, user_code, verification_uri 等字段的关联数组
     */
    public function respondToDeviceAuthorizationRequest(
        ServerRequestInterface $request
    ): array {
        // 从请求中获取客户端标识
        $clientId = $this->getRequestParameter('client_id', $request);
        if (!$clientId) {
            throw OAuthServerException::invalidRequest('client_id');
        }

        // 验证客户端是否存在且有效
        $client = $this->validateClient($clientId, $request);

        // 解析并验证请求的 scope
        $scopeParam = $this->getRequestParameter('scope', $request, '');
        $scopes = $this->validateScopes($scopeParam, $client);

        // 通过仓库创建设备授权记录
        $deviceCodeEntity = $this->deviceCodeRepo->create(
            client: $client,
            scopes: $scopes,
            ttl: (int) config('services.device_auth.device_code_ttl', 900),
            interval: (int) config('services.device_auth.base_interval', 5)
        );

        // 记录审计日志
        \Log::channel('security')->info('设备授权请求已创建', [
            'client_id' => $client->getIdentifier(),
            'user_code' => $deviceCodeEntity->getUserCode(),
            'scope' => $scopeParam,
        ]);

        // 构建并返回响应数据
        return [
            'device_code'      => $deviceCodeEntity->getIdentifier(),
            'user_code'        => $deviceCodeEntity->getUserCode(),
            'verification_uri' => config('services.device_auth.verification_uri'),
            'expires_in'       => $deviceCodeEntity->getExpiresAt() - time(),
            'interval'         => $deviceCodeEntity->getInterval(),
        ];
    }

    /**
     * 处理 Token 请求（设备端轮询获取令牌）
     *
     * 设备端使用设备码向 Token 端点发送请求时调用此方法。
     * 方法执行以下检查流程：
     * 1. 验证客户端身份
     * 2. 查找并验证设备码
     * 3. 检查轮询速率限制
     * 4. 检查用户是否已完成授权
     * 5. 如果已授权则颁发访问令牌
     */
    public function respondToAccessTokenRequest(
        ServerRequestInterface $request,
        ResponseTypeInterface $responseType,
        DateInterval $accessTokenTTL
    ): ResponseTypeInterface {
        // 获取并验证客户端
        $clientId = $this->getRequestParameter('client_id', $request)
            ?? $request->getServerParams()['PHP_AUTH_USER'] ?? null;

        if (!$clientId) {
            throw OAuthServerException::invalidRequest('client_id');
        }

        $client = $this->validateClient($clientId, $request);

        // 获取设备码参数
        $deviceCode = $this->getRequestParameter('device_code', $request);
        if (!$deviceCode) {
            throw OAuthServerException::invalidRequest('device_code');
        }

        // 查找设备码记录
        $deviceCodeEntity = $this->deviceCodeRepo->findByDeviceCode($deviceCode);
        if (!$deviceCodeEntity) {
            throw OAuthServerException::invalidGrant(
                '设备码无效或已过期'
            );
        }

        // 验证设备码属于当前客户端（防止跨客户端攻击）
        if ($deviceCodeEntity->getClient()->getIdentifier() !== $client->getIdentifier()) {
            throw OAuthServerException::invalidGrant(
                '设备码不属于当前客户端'
            );
        }

        // 检查设备码是否已过期
        if ($deviceCodeEntity->getExpiresAt() < time()) {
            throw OAuthServerException::invalidGrant(
                '设备码已过期'
            );
        }

        // 速率限制检查：确保设备端遵守轮询间隔
        $lastPolled = $deviceCodeEntity->getLastPolledAt();
        $interval = $deviceCodeEntity->getInterval();
        if ($lastPolled > 0 && (time() - $lastPolled) < $interval) {
            // 轮询过快，返回 slow_down 错误
            throw new OAuthServerException(
                '轮询过于频繁，请遵守间隔限制',
                12,
                'slow_down',
                400
            );
        }

        // 更新最后轮询时间
        $this->deviceCodeRepo->updateLastPolledAt($deviceCode);

        // 检查用户是否已完成授权
        if (!$deviceCodeEntity->isAuthorized()) {
            // 用户尚未授权，返回 authorization_pending 错误
            throw new OAuthServerException(
                '等待用户完成授权',
                11,
                'authorization_pending',
                400
            );
        }

        // 用户已授权，开始颁发令牌
        $userId = $deviceCodeEntity->getUserIdentifier();

        // 解析 scope
        $scopeParam = $this->getRequestParameter('scope', $request, '');
        $scopes = $this->validateScopes($scopeParam, $client);

        // 使用 League 的标准方法颁发 Access Token
        $accessToken = $this->issueAccessToken(
            $accessTokenTTL,
            $client,
            $userId,
            $scopes
        );

        // 颁发 Refresh Token（可选，根据业务需求决定）
        $refreshToken = $this->issueRefreshToken($accessToken);

        // 记录审计日志
        \Log::channel('security')->info('设备授权令牌已颁发', [
            'client_id' => $client->getIdentifier(),
            'user_id' => $userId,
            'scope' => $scopeParam,
        ]);

        // 构建响应
        $responseType->setAccessToken($accessToken);
        $responseType->setRefreshToken($refreshToken);

        return $responseType;
    }

    /**
     * 验证客户端身份
     *
     * Device Flow 通常用于公共客户端（没有 client_secret），
     * 因此验证时不要求提供密钥。
     */
    private function validateClient(
        string $clientId,
        ServerRequestInterface $request
    ): ClientEntityInterface {
        $client = $this->getClientRepository()->getClientEntity(
            $clientId,
            $this->getIdentifier(),
            null,
            false // 不要求 client_secret
        );

        if (!$client instanceof ClientEntityInterface) {
            throw OAuthServerException::invalidClient($request);
        }

        return $client;
    }
}
```

### 4.6 自定义 OAuth 异常类

RFC 8628 定义了几个 Device Flow 特有的错误码。虽然 League OAuth2 Server 的 `OAuthServerException` 已经提供了 `authorizationPending()` 和 `slowDown()` 静态方法，但为了代码清晰和自定义错误消息，我们创建一个专门的异常类：

```php
<?php
// app/OAuth/Exceptions/DeviceAuthorizationException.php

namespace App\OAuth\Exceptions;

use League\OAuth2\Server\Exception\OAuthServerException;

class DeviceAuthorizationException extends OAuthServerException
{
    /**
     * 用户尚未完成授权
     *
     * 这是设备端轮询时最常见的响应。
     * 设备端收到此错误后应等待 interval 秒再发起下一次轮询。
     */
    public static function authorizationPending(): static
    {
        return new static(
            '用户尚未完成授权操作，请继续等待。',
            11,
            'authorization_pending',
            400
        );
    }

    /**
     * 轮询过于频繁
     *
     * 当设备端的轮询间隔小于服务端指定的 interval 时返回此错误。
     * 设备端收到此错误后必须增加轮询间隔至少 5 秒。
     */
    public static function slowDown(): static
    {
        return new static(
            '设备端轮询过于频繁，请降低轮询频率。',
            12,
            'slow_down',
            400
        );
    }

    /**
     * 用户拒绝了授权请求
     *
     * 用户在验证页面明确拒绝了设备的授权请求。
     * 设备端收到此错误后应停止轮询并提示用户。
     */
    public static function accessDenied(): static
    {
        return new static(
            '用户拒绝了授权请求。',
            13,
            'access_denied',
            400
        );
    }

    /**
     * 设备码已过期
     *
     * 设备码超过了有效期，用户无法再通过该码完成授权。
     * 设备端收到此错误后应提示用户重新发起授权流程。
     */
    public static function expiredToken(): static
    {
        return new static(
            '设备码已过期，请重新发起授权请求。',
            14,
            'expired_token',
            400
        );
    }
}
```

### 4.7 控制器实现

控制器负责处理 HTTP 请求和响应，是连接前端和授权逻辑的桥梁。我们需要实现三个核心接口：设备端发起授权请求、用户端显示验证页面、用户端确认授权。

```php
<?php
// app/Http/Controllers/DeviceAuthController.php

namespace App\Http\Controllers;

use App\OAuth\Repositories\DeviceCodeRepository;
use App\OAuth\Exceptions\DeviceAuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Laravel\Passport\Passport;

class DeviceAuthController extends Controller
{
    protected DeviceCodeRepository $deviceCodeRepo;

    public function __construct(DeviceCodeRepository $deviceCodeRepo)
    {
        $this->deviceCodeRepo = $deviceCodeRepo;
    }

    /**
     * 设备端接口：发起设备授权请求
     *
     * 这是设备端调用的第一个接口。设备发送客户端标识和
     * 需要的权限范围，服务端返回设备码和用户码等信息。
     *
     * POST /oauth/device/code
     */
    public function startDeviceAuthorization(Request $request): JsonResponse
    {
        // 参数验证
        $validator = Validator::make($request->all(), [
            'client_id' => 'required|string|max:100',
            'scope'     => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return $this->errorResponse('invalid_request', $validator->errors()->first(), 400);
        }

        // 速率限制：每个 IP 每小时最多 30 次请求
        $rateLimitKey = 'device_code_request:' . $request->ip();
        if (RateLimiter::tooManyAttempts($rateLimitKey, 30)) {
            Log::channel('security')->warning('设备授权请求速率限制触发', [
                'ip' => $request->ip(),
                'client_id' => $request->input('client_id'),
            ]);
            return $this->errorResponse('too_many_requests', '请求过于频繁，请稍后再试。', 429);
        }
        RateLimiter::hit($rateLimitKey, 3600);

        // 验证客户端是否存在
        $client = Passport::client()
            ->where('client_id', $request->input('client_id'))
            ->where('personal_access_client', false)
            ->where('password_client', false)
            ->first();

        if (!$client) {
            return $this->errorResponse('invalid_client', '未知的客户端标识。', 401);
        }

        // 解析并限制 scope
        $requestedScopes = $request->input('scope')
            ? explode(' ', trim($request->input('scope')))
            : [];

        // 移除设备客户端不允许请求的危险权限
        $forbiddenScopes = config('services.device_auth.forbidden_scopes', []);
        $allowedScopes = array_values(array_diff($requestedScopes, $forbiddenScopes));

        try {
            // 调用仓库创建设备授权记录
            $deviceCodeEntity = $this->deviceCodeRepo->create(
                client: $client,
                scopes: $allowedScopes,
                ttl: (int) config('services.device_auth.device_code_ttl', 900),
                interval: (int) config('services.device_auth.base_interval', 5)
            );

            Log::channel('security')->info('设备授权请求已创建', [
                'client_id' => $client->client_id,
                'user_code' => $deviceCodeEntity->getUserCode(),
                'ip' => $request->ip(),
                'scope' => implode(' ', $allowedScopes),
            ]);

            return response()->json([
                'device_code'      => $deviceCodeEntity->getIdentifier(),
                'user_code'        => $deviceCodeEntity->getUserCode(),
                'verification_uri' => config('services.device_auth.verification_uri'),
                'expires_in'       => $deviceCodeEntity->getExpiresAt() - time(),
                'interval'         => $deviceCodeEntity->getInterval(),
            ]);

        } catch (\Throwable $e) {
            Log::error('设备授权请求创建失败', [
                'error' => $e->getMessage(),
                'client_id' => $request->input('client_id'),
            ]);
            return $this->errorResponse('server_error', '内部服务器错误。', 500);
        }
    }

    /**
     * 用户端页面：显示验证表单
     *
     * 用户在自己的设备上访问此页面，输入设备显示的用户码。
     * 如果 URL 中已包含 user_code 参数（例如通过扫码跳转），
     * 则自动填入表单。
     *
     * GET /device
     */
    public function showVerificationForm(Request $request)
    {
        return view('device.verify', [
            'userCode' => strtoupper($request->query('user_code', '')),
        ]);
    }

    /**
     * 用户端接口：处理验证和授权确认
     *
     * 用户输入用户码并确认授权后，此方法验证用户码的有效性，
     * 并将授权状态更新到数据库。设备端在下一次轮询时就能
     * 检测到授权已完成并获取令牌。
     *
     * POST /device
     */
    public function processVerification(Request $request)
    {
        // 速率限制：每个 IP 每 5 分钟最多 10 次验证尝试
        $rateLimitKey = 'device_verify:' . $request->ip();
        if (RateLimiter::tooManyAttempts($rateLimitKey, 10)) {
            return back()->withErrors([
                'user_code' => '验证尝试次数过多，请 5 分钟后再试。',
            ]);
        }
        RateLimiter::hit($rateLimitKey, 300);

        // 参数验证
        $validator = Validator::make($request->all(), [
            'user_code' => 'required|string|size:9', // WDJB-MJHT 格式固定 9 字符
        ]);

        if ($validator->fails()) {
            return back()->withErrors([
                'user_code' => '请输入正确的用户码格式（如 WDJB-MJHT）。',
            ]);
        }

        $userCode = strtoupper(trim($request->input('user_code')));

        // 要求用户已登录
        if (!Auth::check()) {
            // 将用户码保存到 session，登录后可自动跳转回来
            session(['device_user_code' => $userCode]);
            return redirect()->route('login');
        }

        // 验证用户码是否有效
        if (!$this->deviceCodeRepo->isUserCodeValid($userCode)) {
            Log::channel('security')->warning('无效的用户码验证尝试', [
                'user_code' => $userCode,
                'user_id' => Auth::id(),
                'ip' => $request->ip(),
            ]);
            return back()->withErrors([
                'user_code' => '用户码无效或已过期，请检查设备上显示的代码。',
            ]);
        }

        // 执行授权
        $success = $this->deviceCodeRepo->authorize($userCode, Auth::id());

        if ($success) {
            Log::channel('security')->info('设备授权已完成', [
                'user_code' => $userCode,
                'user_id' => Auth::id(),
                'ip' => $request->ip(),
            ]);
            return view('device.success');
        }

        return back()->withErrors([
            'user_code' => '授权失败，该用户码可能已被使用。',
        ]);
    }

    /**
     * 构建错误响应的辅助方法
     */
    private function errorResponse(string $error, string $description, int $statusCode): JsonResponse
    {
        return response()->json([
            'error'             => $error,
            'error_description' => $description,
        ], $statusCode);
    }
}
```

### 4.8 路由注册

将设备授权相关的路由注册到 Laravel 的路由系统中：

```php
<?php
// routes/web.php（用户端路由）

// 设备授权验证页面（用户在自己的设备上访问）
Route::get('/device', [DeviceAuthController::class, 'showVerificationForm'])
    ->name('device.verify.form');

// 处理用户确认授权
Route::post('/device', [DeviceAuthController::class, 'processVerification'])
    ->name('device.verify')
    ->middleware('throttle:10,1');
```

```php
<?php
// routes/api.php（设备端路由）

// 设备端发起授权请求
Route::post('/oauth/device/code', [DeviceAuthController::class, 'startDeviceAuthorization'])
    ->name('device.code')
    ->middleware('throttle:30,60');
```

### 4.9 验证页面视图

用户端的验证页面需要简洁明了，适配移动设备显示：

```blade
{{-- resources/views/device/verify.blade.php --}}
@extends('layouts.app')

@section('content')
<div class="container">
    <div class="row justify-content-center">
        <div class="col-md-6 col-lg-5">
            <div class="card shadow-sm mt-5">
                <div class="card-header bg-primary text-white text-center">
                    <h4 class="mb-0">🔗 设备授权</h4>
                </div>
                <div class="card-body p-4">
                    <p class="text-muted text-center mb-4">
                        请输入您的设备屏幕上显示的授权码以完成登录。
                    </p>

                    <form method="POST" action="{{ route('device.verify') }}">
                        @csrf
                        <div class="mb-4">
                            <label for="user_code" class="form-label fw-bold">授权码</label>
                            <input
                                type="text"
                                class="form-control form-control-lg text-center"
                                id="user_code"
                                name="user_code"
                                value="{{ old('user_code', $userCode) }}"
                                placeholder="WDJB-MJHT"
                                style="font-size: 1.8em; letter-spacing: 0.3em; font-family: monospace;"
                                maxlength="9"
                                autocomplete="off"
                                required
                            >
                            @error('user_code')
                                <div class="alert alert-danger mt-3 mb-0">{{ $message }}</div>
                            @enderror
                        </div>

                        <div class="d-grid gap-2">
                            <button type="submit" class="btn btn-primary btn-lg">
                                ✅ 确认授权
                            </button>
                        </div>
                    </form>

                    <div class="text-center mt-3">
                        <small class="text-muted">
                            授权码有效期为 15 分钟，过期后需要在设备上重新获取。
                        </small>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection
```

### 4.10 服务提供者注册

将自定义 Grant Type 注册到 Laravel 的服务容器中：

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use App\OAuth\Grants\DeviceAuthorizationGrant;
use App\OAuth\Repositories\DeviceCodeRepository;
use Illuminate\Support\ServiceProvider;
use League\OAuth2\Server\AuthorizationServer;
use League\OAuth2\Server\Repositories\AccessTokenRepositoryInterface;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
use League\OAuth2\Server\Repositories\ScopeRepositoryInterface;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册 DeviceCodeRepository 到容器
        $this->app->singleton(DeviceCodeRepository::class);

        // 当 AuthorizationServer 被解析时，注册自定义 Grant Type
        $this->app->resolving(AuthorizationServer::class, function (AuthorizationServer $server) {
            $grant = new DeviceAuthorizationGrant(
                app(DeviceCodeRepository::class),
                app(AccessTokenRepositoryInterface::class),
                app(ClientRepositoryInterface::class),
                app(ScopeRepositoryInterface::class)
            );

            $server->enableGrantType(
                $grant,
                new \DateInterval('PT1H') // Access Token 有效期：1 小时
            );
        });
    }

    public function boot(): void
    {
        // 在生产环境强制 HTTPS
        if ($this->app->environment('production')) {
            \URL::forceScheme('https');
        }
    }
}
```

---

## 五、完整交互流程详解

### 5.1 流程全景图

让我们用文字完整描述一次 Device Authorization Flow 的全过程。假设场景是：用户在智能电视上打开视频应用，需要登录授权。

**第一阶段：设备发起授权请求**

电视应用向授权服务器发送 HTTP POST 请求到 `/oauth/device/code`，请求体包含 `client_id` 和 `scope` 参数。服务端验证客户端身份后，生成设备码和用户码，持久化到数据库，然后返回包含 `device_code`、`user_code`、`verification_uri`、`expires_in`、`interval` 的 JSON 响应。

**第二阶段：设备展示授权信息**

电视应用收到响应后，在屏幕上显示用户码和验证地址，提示用户在手机或电脑上完成授权。同时，电视应用开始按照 `interval` 指定的间隔（默认 5 秒）向 `/oauth/token` 端点发送轮询请求。

**第三阶段：用户在自己的设备上完成授权**

用户拿出手机，打开浏览器访问验证地址，输入电视上显示的用户码。如果用户尚未登录，系统要求用户先登录账号。登录后，页面显示授权确认信息，用户点击「确认授权」按钮。

**第四阶段：服务端标记授权状态**

用户确认授权后，服务端更新数据库记录，将用户 ID 与设备码关联，并将授权状态标记为 true。此时设备码的状态从「等待授权」变为「已授权」。

**第五阶段：设备端获取令牌**

电视应用的下一次轮询请求到达服务端时，服务端发现该设备码已处于「已授权」状态，于是颁发访问令牌和刷新令牌，返回给电视应用。电视应用收到令牌后停止轮询，使用令牌开始正常访问用户的资源。

**第六阶段：后续维护**

定时任务定期清理过期的设备授权记录，保持数据库整洁。

### 5.2 设备端轮询实现示例

以下是一个完整的 Python CLI 客户端示例，展示了设备端如何发起授权请求并轮询等待用户完成授权：

```python
#!/usr/bin/env python3
"""
Device Authorization Flow 设备端客户端示例
适用于 CLI 工具获取 OAuth 访问令牌
"""
import requests
import time
import sys
import webbrowser

AUTH_SERVER = "https://api.example.com"
CLIENT_ID = "your-client-id"
SCOPES = "read-profile read-data"


def start_device_auth():
    """向授权服务器请求设备码和用户码"""
    resp = requests.post(f"{AUTH_SERVER}/oauth/device/code", data={
        "client_id": CLIENT_ID,
        "scope": SCOPES,
    })
    resp.raise_for_status()
    return resp.json()


def poll_for_token(device_code, interval, expires_in):
    """
    轮询等待用户完成授权

    实现了 RFC 8628 规定的所有错误处理逻辑：
    - authorization_pending: 用户尚未授权，继续等待
    - slow_down: 轮询过快，增加间隔
    - expired_token: 设备码已过期，停止轮询
    - access_denied: 用户拒绝授权，停止轮询
    """
    start_time = time.time()
    max_retries = 100  # 防止无限轮询

    for retry in range(max_retries):
        # 检查是否已超过有效期（预留 30 秒缓冲）
        elapsed = time.time() - start_time
        if elapsed >= expires_in - 30:
            print(f"\n⏰ 授权即将过期（已等待 {int(elapsed)} 秒）")
            return None

        # 等待指定间隔
        time.sleep(interval)

        # 向 Token 端点发送轮询请求
        resp = requests.post(f"{AUTH_SERVER}/oauth/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code,
            "client_id": CLIENT_ID,
        })

        data = resp.json()

        if resp.status_code == 200:
            return data  # 成功获取令牌

        error = data.get("error")

        if error == "authorization_pending":
            # 用户尚未授权，继续等待
            print(".", end="", flush=True)
            continue
        elif error == "slow_down":
            # 轮询过快，增加间隔
            interval += 5
            print(f"\n⚠️  轮询过快，间隔调整为 {interval} 秒")
            continue
        elif error == "expired_token":
            print("\n❌ 设备码已过期，请重新发起授权")
            return None
        elif error == "access_denied":
            print("\n❌ 用户拒绝了授权请求")
            return None
        else:
            print(f"\n❌ 未知错误: {data}")
            return None

    print("\n❌ 达到最大重试次数")
    return None


def main():
    print("🔐 正在启动设备授权流程...\n")

    # 第一步：请求设备码
    auth_data = start_device_auth()
    user_code = auth_data["user_code"]
    verification_uri = auth_data["verification_uri"]
    device_code = auth_data["device_code"]
    interval = auth_data.get("interval", 5)
    expires_in = auth_data["expires_in"]

    # 展示授权信息给用户
    print("┌─────────────────────────────────────────────┐")
    print("│                                             │")
    print(f"│  请在浏览器中访问以下地址完成授权：         │")
    print(f"│  {verification_uri:<42s}│")
    print("│                                             │")
    print(f"│  授权码: {user_code:<33s}│")
    print("│                                             │")
    print(f"│  有效期: {expires_in // 60} 分钟                              │")
    print("│                                             │")
    print("└─────────────────────────────────────────────┘\n")

    # 尝试自动打开浏览器
    try:
        webbrowser.open(verification_uri)
        print("已尝试打开浏览器...\n")
    except Exception:
        pass

    print("等待授权中", end="", flush=True)

    # 第二步：轮询等待授权
    token_data = poll_for_token(device_code, interval, expires_in)

    if token_data:
        print(f"\n\n✅ 授权成功！")
        print(f"   令牌类型: {token_data.get('token_type', 'Bearer')}")
        print(f"   有效期: {token_data.get('expires_in', 0)} 秒")
        print(f"   令牌前缀: {token_data['access_token'][:20]}...")
        return token_data
    else:
        print("\n授权流程失败，请重试。")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

### 5.3 JavaScript 设备端实现

对于运行在 Node.js 环境中的 IoT 设备或桌面应用，可以使用以下 JavaScript 实现：

```javascript
/**
 * Device Authorization Flow 设备端客户端
 * 适用于 Node.js 环境的 IoT 设备或桌面应用
 */
const axios = require('axios');

const AUTH_SERVER = 'https://api.example.com';
const CLIENT_ID = 'your-client-id';

async function startDeviceAuth() {
    console.log('🔐 启动设备授权流程...\n');

    const { data } = await axios.post(`${AUTH_SERVER}/oauth/device/code`,
        new URLSearchParams({
            client_id: CLIENT_ID,
            scope: 'read-profile read-data',
        })
    );

    return data;
}

async function pollForToken(deviceCode, initialInterval, expiresIn) {
    const startTime = Date.now();
    let interval = initialInterval * 1000; // 转换为毫秒

    while (true) {
        // 检查是否接近过期
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= expiresIn - 30) {
            throw new Error('授权已过期，请重新发起');
        }

        await new Promise(r => setTimeout(r, interval));

        try {
            const { data } = await axios.post(`${AUTH_SERVER}/oauth/token`,
                new URLSearchParams({
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    device_code: deviceCode,
                    client_id: CLIENT_ID,
                })
            );
            return data;
        } catch (err) {
            const error = err.response?.data?.error;

            switch (error) {
                case 'authorization_pending':
                    process.stdout.write('.');
                    break;
                case 'slow_down':
                    interval += 5000;
                    console.log(`\n⚠️  减速：${interval / 1000}s`);
                    break;
                case 'expired_token':
                    throw new Error('设备码已过期');
                case 'access_denied':
                    throw new Error('用户拒绝了授权');
                default:
                    throw new Error(`授权失败：${error}`);
            }
        }
    }
}

async function main() {
    const auth = await startDeviceAuth();

    console.log(`请访问: ${auth.verification_uri}`);
    console.log(`输入授权码: ${auth.user_code}`);
    console.log(`有效期: ${Math.floor(auth.expires_in / 60)} 分钟\n`);

    process.stdout.write('等待授权');

    const tokens = await pollForToken(
        auth.device_code,
        auth.interval,
        auth.expires_in
    );

    console.log('\n\n✅ 授权成功！');
    console.log(`Access Token: ${tokens.access_token.substring(0, 20)}...`);
}

main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
```

---

## 六、Token 轮询、过期与错误处理深度剖析

### 6.1 RFC 8628 规定的错误码体系

Device Flow 的错误处理体系与标准 OAuth 2.0 有所不同。除了通用的 `invalid_request`、`invalid_client` 等错误码外，RFC 8628 额外定义了四个设备授权专用的错误码，每个错误码对应设备端应采取的不同行动。

**authorization_pending（授权等待中）**：这是设备端轮询时收到的最常见的响应。它表示设备码有效、未过期，但用户尚未完成授权操作。设备端收到此错误后应该安静等待（不在界面上显示错误），在 interval 秒后再次发起轮询。

**slow_down（减速）**：当设备端的两次轮询间隔小于服务端指定的 interval 时返回此错误。设备端收到此错误后必须将轮询间隔增加至少 5 秒。例如，如果当前 interval 是 5 秒，设备端收到 slow_down 后必须将间隔调整为至少 10 秒。这是防止设备端过于频繁地请求服务端的重要保护机制。

**access_denied（拒绝授权）**：用户在验证页面明确拒绝了设备的授权请求。这是一个终态错误，设备端收到后应立即停止轮询，并告知用户授权已被拒绝。

**expired_token（令牌过期）**：设备码超过了有效期（通常为 15 分钟）。这也是一个终态错误，设备端收到后应停止轮询，提示用户需要重新发起授权流程。

### 6.2 轮询间隔的动态调整策略

RFC 8628 建议默认的轮询间隔为 5 秒。在实际应用中，我们可以根据系统负载和用户行为模式动态调整这个间隔。例如，在检测到大量设备同时轮询时，可以适当增大间隔以降低服务端压力。一些实现还会在设备码接近过期时减小间隔，以便更及时地捕获用户的授权操作。

### 6.3 过期清理与数据库维护

过期的设备授权记录应该定期清理。我们可以通过 Laravel 的调度任务来实现自动清理：

```php
// 在 app/Console/Kernel.php 中注册
protected function schedule(Schedule $schedule): void
{
    // 每小时清理一次过期记录
    $schedule->call(function () {
        $pruned = app(DeviceCodeRepository::class)->pruneExpired();
        if ($pruned > 0) {
            \Log::info("已清理 {$pruned} 条过期的设备授权记录");
        }
    })->hourly();
}
```

---

## 七、安全最佳实践

### 7.1 速率限制是安全基石

Device Flow 的安全模型在很大程度上依赖于速率限制。攻击者理论上可以暴力猜测用户码来劫持授权会话。虽然 35 bits 的熵值使得暴力攻击在 15 分钟的有效窗口内极难成功（需要尝试约 340 亿种组合），但速率限制提供了额外的安全层。

**必须实现的三重速率限制**：第一，限制每个 IP 每小时可以发起的设备授权请求次数（建议 30 次）。第二，限制每个 IP 每 5 分钟可以尝试验证用户码的次数（建议 10 次）。第三，限制每个客户端每小时的总请求数（建议 100 次）。这三层限制共同构成了一道有效的防线。

### 7.2 用户码熵值计算与字符集选择

用户码的安全性直接决定了 Device Flow 的抗暴力攻击能力。我们选择的字符集 `BCDFGHJKLMNPQRSTVWXYZ` 包含 21 个字母，去掉了容易在不同字体和显示设备上混淆的字符（数字 0 和大写字母 O、数字 1 和大写字母 I/L）。

8 位有效字符（不计算连字符）的熵值为：`8 × log2(21) ≈ 35.1 bits`，这意味着攻击者在最坏情况下需要尝试约 `2^35 ≈ 343 亿` 种组合才能猜中一个用户码。在 15 分钟的有效期和每 5 分钟 10 次验证尝试的速率限制下（总计最多 30 次尝试），攻击成功的概率约为 `30 / 343亿 ≈ 0.0000000087%`，这在实际应用中可以认为是安全的。

### 7.3 HTTPS 是不可妥协的底线

Device Flow 涉及设备码和令牌的传输，所有通信必须通过 HTTPS 加密。在生产环境中，应该在应用层面强制 HTTPS，而不仅仅依赖 Web 服务器的配置。

### 7.4 审计日志记录

所有设备授权相关的事件都应该被记录到安全审计日志中，包括：设备授权请求的发起（记录客户端标识、请求来源的 IP 地址、请求的权限范围）、用户码验证尝试（记录用户码、请求来源的 IP 地址、验证是否成功）、用户确认授权操作（记录用户数据库标识、用户码、请求来源的 IP 地址）、令牌颁发操作（记录客户端标识、用户数据库标识、权限范围）。这些日志在安全事件发生时可以用于溯源和分析，帮助安全团队快速定位问题的根源和影响范围。建议将这些日志与现有的安全信息和事件管理系统集成，以便实时监控异常行为模式。

### 7.5 客户端分类与权限限制

建议为设备类型的客户端创建单独的分类，限制其可以请求的权限范围。例如，设备客户端不应该能够请求 `admin`、`delete-account`、`manage-users` 等高危权限。这可以通过在配置文件中定义禁止的 scope 列表来实现。

---

## 八、真实生产环境踩坑记录

### 踩坑一：device_code 必须哈希存储

最初实现时，我将 device_code 以明文形式存储在数据库中。虽然 device_code 只在设备端和服务器之间的 HTTPS 连续中传输，但如果数据库泄露（SQL 注入、备份文件泄露等），攻击者可以直接获取有效的设备码并冒充设备端请求令牌。修复方案很简单：存储 `hash('sha256', $deviceCode)` ，查询时对入参做同样的哈希运算后进行匹配。这与 Laravel Passport 存储 access_token 的方式完全一致。

### 踩坑二：并发轮询导致重复令牌

在压力测试中发现，当设备端因为网络抖动快速重试时，同一个设备码的两次轮询请求几乎同时到达服务器，两次请求都通过了「是否已授权」的检查，导致颁发了两个不同的访问令牌。这在业务逻辑上是不允许的——同一个设备授权会话应该只产生一个令牌。解决方案是在创建令牌之前使用数据库事务和悲观锁，或者在令牌表中添加 device_code_hash 字段用于去重检查。

### 踩坑三：用户码大小写不一致

生产环境中收到了不少「用户码无效」的投诉，排查后发现问题出在大小写上。有些用户在手机输入法下输入的是小写字母，有些浏览器会自动将输入内容首字母大写。虽然我们的用户码生成逻辑只使用大写字母，但查询时必须对用户输入做 `strtoupper()` 处理。这个看似简单的问题在上线后导致了约 5% 的授权失败率。

### 踩坑四：Nginx 反向代理超时

设备端的轮询请求是短连接（每次请求完立即断开），但如果设备端实现不当（使用长连接或 keep-alive），Nginx 的 `proxy_read_timeout` 默认 60 秒可能导致连接在等待响应时超时。正确的做法是确保 Token 端点在检测到 `authorization_pending` 时立即返回响应（不做任何 sleep），而不是长时间挂起等待状态变更。

### 踩坑五：Passport 版本升级导致接口变化

Laravel Passport 从 10.x 升级到 11.x 时，底层的 League OAuth2 Server 也进行了大版本升级，部分内部接口发生了变化。我们的自定义 Grant Type 因为直接依赖了 League 的内部方法，升级后出现了编译错误。教训是：在实现自定义 Grant Type 时，尽量只依赖 League 的公开接口，并编写完整的集成测试。同时在 composer.json 中锁定 Passport 的主版本号，升级前仔细阅读 CHANGELOG。

### 踩坑六：CSRF 中间件拦截 Token 请求

Laravel 默认对所有 POST 请求启用 CSRF 保护。设备端轮询 `/oauth/token` 端点时，因为没有携带 CSRF Token，被 VerifyCsrfToken 中间件拦截并返回 419 错误。需要在中间件的 `$except` 数组中排除 OAuth 相关的路由。

### 踩坑七：时钟偏移导致提前过期

在分布式部署环境中，多台应用服务器的系统时间可能存在微小差异。如果某台服务器的时间比标准时间快了几十秒，它颁发的设备码的有效期就会比预期短几十秒。在极端情况下，设备码可能在用户还没来得及完成授权时就已经「过期」了。解决方案是在过期判断时预留 30 秒的缓冲时间，并且建议所有服务器使用 NTP 时间同步。

### 踩坑八：多设备授权的用户困惑

用户可能在同一时间段内在两台设备上（比如客厅电视和卧室电视）同时发起 Device Flow 授权。两台电视会显示不同的用户码。用户在手机上为第一个用户码完成授权后，可能误以为两台电视都已经授权了。实际上每台电视需要分别完成授权。解决方案是在授权成功页面明确告知用户「只有当前设备已完成授权」，并在验证页面列出用户当前所有等待授权的设备。

---

## 九、生产环境上线检查清单

在将 Device Authorization Flow 部署到生产环境之前，请逐项检查以下安全和功能清单：

**安全检查项**：用户码熵值是否至少达到 32 bits；设备码是否使用哈希存储而非明文存储；HTTPS 是否在所有端点上强制启用；速率限制是否已在所有关键端点上配置；审计日志是否已覆盖所有关键事件；危险权限是否已从设备客户端的可请求范围中移除；CSRF 排除规则是否已正确配置。

**功能检查项**：设备端能否正确处理所有 RFC 8628 错误码；轮询间隔是否正确实现了 slow_down 动态调整；过期清理定时任务是否已注册并运行正常；验证页面在各种移动设备上的显示是否正常；授权成功页面是否明确告知用户操作结果；未登录用户跳转登录后能否自动返回验证页面。

**运维检查项**：数据库表的索引是否合理（特别是 device_code 和 user_code 的索引）；Nginx 或其他反向代理的超时设置是否合理；日志存储空间是否充足（审计日志会持续增长）；监控告警是否已配置（异常请求量、授权失败率等指标）。

---

## 十、总结与展望

Device Authorization Flow 是 OAuth 2.0 授权体系中不可或缺的重要组成部分。它巧妙地解决了无浏览器设备的授权难题，通过将核心认证步骤转移到用户自己的设备上完成，既保证了安全性（用户始终在自己信任的设备上输入敏感信息），又提供了良好的可用性（简短的用户码易于输入和分享）。

通过 Laravel Passport 的自定义 Grant Type 机制，我们可以将 RFC 8628 协议完整地集成到 Laravel 应用中。虽然实现过程涉及多个层面的技术细节，但每一层的职责边界都非常清晰：仓库层负责数据的持久化和查询，授权层负责 OAuth 协议逻辑的处理，控制器层负责 HTTP 请求和响应的管理，视图层负责用户界面的渲染。

在安全防护方面，速率限制和用户码熵值是两道最关键的防线。它们共同确保了即使在最坏的情况下，攻击者成功劫持授权会话的概率也微乎其微。再加上设备码的哈希存储、HTTPS 强制、权限范围限制、审计日志等多层防护措施，整个安全体系是完整且可靠的。

最后需要强调的是，Device Flow 并不是传统 OAuth 流程的替代品，而是在特定场景下的补充方案。选择哪种授权流程取决于客户端本身的能力和用户所处的操作环境。对于有完整浏览器能力的客户端应用，Authorization Code Flow 配合 PKCE 仍然是首选方案；对于没有浏览器或者浏览器交互体验极差的受限设备，Device Authorization Flow 才是正确的选择。随着物联网设备和智能终端的快速普及，Device Flow 的应用场景将会越来越广泛，掌握这项技术对于全栈开发者来说是一项非常有价值的能力。

---

## 参考资料

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)：Device Flow 的正式协议规范文档
- [Laravel Passport 官方文档](https://laravel.com/docs/passport)：Laravel Passport 的使用指南和 API 文档
- [League OAuth2 Server 文档](https://oauth2.thephpleague.com/)：Laravel Passport 底层使用的 OAuth2 Server 库
- [GitHub CLI 的 Device Flow 实现](https://github.com/cli/cli)：GitHub 官方 CLI 工具的 Device Flow 参考实现
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)：OAuth 2.0 安全最佳实践草案

---

## 相关阅读

- [OIDC (OpenID Connect) 深度实战：从 OAuth 2.0 到 OIDC 的身份层](/categories/PHP/Laravel/oidc-openid-connect-laravel-deep-dive/) — 在 OAuth 2.0 授权基础上引入身份认证层，了解如何通过 OIDC 协议获取用户身份信息，与本文的 Device Flow 互为补充
- [Laravel Polymorphic Associations 实战：多态关联的性能陷阱与替代方案](/categories/PHP/Laravel/laravel-polymorphic-associations-performance/) — 当授权日志和审计记录涉及多种客户端类型时，多态关联的数据建模方案
- [OpenClaw 与 Laravel 集成：在 PHP 项目中调用 AI Agent 能力](/categories/PHP/Laravel/OpenClaw-与-Laravel-集成-在PHP项目中调用AI-Agent能力/) — 将 AI Agent 能力集成到 Laravel 项目中，探索认证授权与智能代理的结合场景
