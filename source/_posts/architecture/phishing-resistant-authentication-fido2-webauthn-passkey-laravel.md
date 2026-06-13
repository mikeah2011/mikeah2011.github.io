---
title: "Phishing-Resistant Authentication 实战：FIDO2/WebAuthn + Passkey 的渐进式迁移——从密码到无密码的 Laravel 认证演进路线"
keywords: [Phishing, Resistant Authentication, FIDO2, WebAuthn, Passkey, Laravel, 的渐进式迁移, 从密码到无密码的, 认证演进路线, 架构]
date: 2026-06-09 18:57:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - FIDO2
  - WebAuthn
  - Passkey
  - Laravel
  - 认证安全
  - 无密码认证
  - MFA
description: "从传统密码认证到 FIDO2/Passkey 无密码认证的完整 Laravel 实战指南，涵盖渐进式迁移策略、WebAuthn API 对接、多设备同步、踩坑记录与生产环境落地方案。"
---


## 概述

密码泄露事件从未停止。2025 年 RockYou2024 泄露了 100 亿条密码凭证，钓鱼攻击年增长超 40%。传统的「密码 + 短信验证码」认证方式已经成为安全链条中最脆弱的一环。

FIDO2/WebAuthn 协议和 Passkey 的出现，让我们有机会从根本上消除钓鱼攻击的风险。但现实是——你不可能一夜之间把所有用户的密码认证切换掉。用户需要适应，系统需要兼容，迁移必须是**渐进式**的。

本文记录了我在 Laravel 项目中实施 FIDO2/Passkey 认证的完整过程：

- 如何在不破坏现有认证流程的前提下，逐步引入 WebAuthn
- 如何让用户从密码 → MFA → Passkey 平滑过渡
- 踩过的坑和生产环境的落地方案

## 核心概念速览

### FIDO2 与 WebAuthn 的关系

```
FIDO2 = WebAuthn (W3C 标准，浏览器 API) + CTAP2 (Client to Authenticator Protocol，设备协议)
```

简单来说：

- **WebAuthn** 是浏览器暴露给前端的 API，让网页可以调用设备的生物识别（指纹、Face ID）
- **CTAP2** 是设备与认证器之间的通信协议（USB、NFC、BLE）
- **Passkey** 是 Apple/Google/Microsoft 在 FIDO2 基础上的商业化封装，支持云同步

### 为什么 Passkey 是终局

| 特性 | 密码 | TOTP/MFA | 硬件密钥 | Passkey |
|------|------|----------|---------|---------|
| 防钓鱼 | ❌ | ❌ | ✅ | ✅ |
| 用户体验 | 差 | 中 | 差 | 好 |
| 设备丢失恢复 | N/A | 恢复码 | 备份密钥 | 云同步 |
| 实施成本 | 低 | 中 | 高 | 中 |

Passkey 的杀手级特性是**云同步**——你的私钥通过 iCloud Keychain / Google Password Manager 同步到所有设备，丢了手机也不会丢失认证。

## 第一阶段：密码认证 + WebAuthn 二次验证

### 数据库设计

```php
// database/migrations/2026_06_09_create_webauthn_credentials_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webauthn_credentials', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('credential_id', 512)->unique(); // Base64URL encoded
            $table->text('public_key'); // COSE 格式的公钥
            $table->unsignedBigInteger('sign_count')->default(0);
            $table->string('aaguid', 36)->nullable(); // 认证器标识
            $table->string('nickname', 100)->default('default'); // 设备名称
            $table->json('transports')->nullable(); // ['internal', 'usb', 'ble', 'nfc']
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'credential_id']);
        });

        // 认证挑战临时存储
        Schema::create('webauthn_challenges', function (Blueprint $table) {
            $table->id();
            $table->string('session_id', 128);
            $table->text('challenge'); // Base64URL encoded
            $table->enum('type', ['registration', 'authentication']);
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index('session_id');
        });
    }
};
```

### 后端：WebAuthn 服务层

```php
// app/Services/WebAuthn/WebAuthnService.php

namespace App\Services\WebAuthn;

use App\Models\User;
use App\Models\WebAuthnCredential;
use App\Models\WebAuthnChallenge;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Session;

class WebAuthnService
{
    // 依赖的配置
    private string $rpId;      // relying party ID，通常是域名
    private string $rpName;    // 应用名称
    private string $origin;    // 完整的 origin

    public function __construct()
    {
        $this->rpId = config('webauthn.rp_id', parse_url(config('app.url'), PHP_URL_HOST));
        $this->rpName = config('webauthn.rp_name', config('app.name'));
        $this->origin = config('webauthn.origin', config('app.url'));
    }

    /**
     * 生成注册挑战
     */
    public function generateRegistrationChallenge(User $user): array
    {
        $challenge = $this->generateChallenge();

        // 存储挑战到数据库（比 session 更可靠）
        WebAuthnChallenge::create([
            'session_id' => Session::getId(),
            'challenge' => $challenge,
            'type' => 'registration',
            'expires_at' => now()->addMinutes(5),
        ]);

        // 获取用户已有的凭证，用于排除重复注册
        $existingCredentials = WebAuthnCredential::where('user_id', $user->id)
            ->pluck('credential_id')
            ->map(fn($id) => ['type' => 'public-key', 'id' => $id])
            ->values()
            ->toArray();

        return [
            'challenge' => $challenge,
            'rp' => [
                'id' => $this->rpId,
                'name' => $this->rpName,
            ],
            'user' => [
                'id' => base64_encode($user->id), // WebAuthn 要求 user.id 是 bytes
                'name' => $user->email,
                'displayName' => $user->name,
            ],
            'pubKeyCredParams' => [
                ['type' => 'public-key', 'alg' => -7],   // ES256
                ['type' => 'public-key', 'alg' => -257], // RS256
            ],
            'timeout' => 60000,
            'excludeCredentials' => $existingCredentials,
            'authenticatorSelection' => [
                'authenticatorAttachment' => 'platform', // 优先使用平台认证器（指纹/Face ID）
                'residentKey' => 'preferred',
                'userVerification' => 'required',
            ],
            'attestation' => 'none', // 生产环境通常不需要 attestation
        ];
    }

    /**
     * 验证注册响应并存储凭证
     */
    public function verifyRegistration(User $user, array $credential): WebAuthnCredential
    {
        // 1. 验证挑战存在且未过期
        $challenge = WebAuthnChallenge::where('session_id', Session::getId())
            ->where('type', 'registration')
            ->where('expires_at', '>', now())
            ->latest()
            ->firstOrFail();

        // 2. 解析客户端数据
        $clientDataJSON = base64_decode($credential['response']['clientDataJSON']);
        $clientData = json_decode($clientDataJSON, true);

        // 3. 验证 challenge 匹配
        if ($clientData['challenge'] !== $challenge->challenge) {
            throw new \InvalidArgumentException('Challenge 不匹配');
        }

        // 4. 验证 origin
        if ($clientData['origin'] !== $this->origin) {
            throw new \InvalidArgumentException('Origin 不匹配');
        }

        // 5. 解析 attestationObject 获取公钥和凭证 ID
        $attestationObject = $this->parseAttestationObject(
            base64_decode($credential['response']['attestationObject'])
        );

        // 6. 提取认证数据
        $authData = $attestationObject['authData'];
        $credentialId = $attestationObject['attStmt']['credentialId']
            ?? $this->extractCredentialId($authData);
        $publicKey = $this->extractPublicKey($authData);
        $signCount = $this->extractSignCount($authData);
        $aaguid = $this->extractAAGUID($authData);

        // 7. 存储凭证
        $webAuthnCredential = WebAuthnCredential::create([
            'user_id' => $user->id,
            'credential_id' => base64_encode($credentialId),
            'public_key' => base64_encode($publicKey),
            'sign_count' => $signCount,
            'aaguid' => $aaguid ? bin2hex($aaguid) : null,
            'nickname' => $credential['nickname'] ?? '我的设备',
            'transports' => $credential['response']['transports'] ?? ['internal'],
            'last_used_at' => now(),
        ]);

        // 8. 删除已使用的挑战
        $challenge->delete();

        return $webAuthnCredential;
    }

    /**
     * 生成认证挑战（登录时）
     */
    public function generateAuthenticationChallenge(?User $user = null): array
    {
        $challenge = $this->generateChallenge();

        WebAuthnChallenge::create([
            'session_id' => Session::getId(),
            'challenge' => $challenge,
            'type' => 'authentication',
            'expires_at' => now()->addMinutes(5),
        ]);

        // 如果指定了用户，只允许该用户的凭证
        $allowCredentials = [];
        if ($user) {
            $allowCredentials = WebAuthnCredential::where('user_id', $user->id)
                ->get()
                ->map(fn($c) => [
                    'type' => 'public-key',
                    'id' => $c->credential_id,
                    'transports' => $c->transports,
                ])
                ->toArray();
        }

        return [
            'challenge' => $challenge,
            'timeout' => 60000,
            'rpId' => $this->rpId,
            'allowCredentials' => $allowCredentials,
            'userVerification' => 'required',
        ];
    }

    /**
     * 验证认证响应（登录时）
     */
    public function verifyAuthentication(array $credential): User
    {
        // 1. 获取挑战
        $challenge = WebAuthnChallenge::where('session_id', Session::getId())
            ->where('type', 'authentication')
            ->where('expires_at', '>', now())
            ->latest()
            ->firstOrFail();

        // 2. 解析客户端数据
        $clientDataJSON = base64_decode($credential['response']['clientDataJSON']);
        $clientData = json_decode($clientDataJSON, true);

        if ($clientData['challenge'] !== $challenge->challenge) {
            throw new \InvalidArgumentException('Challenge 不匹配');
        }

        // 3. 查找凭证
        $storedCredential = WebAuthnCredential::where(
            'credential_id',
            $credential['id']
        )->firstOrFail();

        // 4. 验证签名（核心安全步骤）
        $authenticatorData = base64_decode($credential['response']['authenticatorData']);
        $signature = base64_decode($credential['response']['signature']);

        // 构建验证数据 = authenticatorData + SHA256(clientDataJSON)
        $signedData = $authenticatorData . hash('sha256', $clientDataJSON, true);

        // 使用存储的公钥验证签名
        $publicKeyDer = base64_decode($storedCredential->public_key);
        $isValid = $this->verifySignature($publicKeyDer, $signature, $signedData);

        if (!$isValid) {
            throw new \InvalidArgumentException('签名验证失败');
        }

        // 5. 验证签名计数器（防重放攻击）
        $newSignCount = $this->extractSignCount($authenticatorData);
        if ($newSignCount !== 0 && $newSignCount <= $storedCredential->sign_count) {
            // 可能是克隆的认证器，标记异常
            \Log::warning('WebAuthn: 检测到可能的克隆认证器', [
                'user_id' => $storedCredential->user_id,
                'credential_id' => $storedCredential->credential_id,
                'old_count' => $storedCredential->sign_count,
                'new_count' => $newSignCount,
            ]);
        }

        // 6. 更新凭证
        $storedCredential->update([
            'sign_count' => max($storedCredential->sign_count, $newSignCount),
            'last_used_at' => now(),
        ]);

        $challenge->delete();

        return $storedCredential->user;
    }

    private function generateChallenge(): string
    {
        return rtrim(base64_encode(random_bytes(32)), '=');
    }

    private function verifySignature(string $publicKeyDer, string $signature, string $data): bool
    {
        $pem = "-----BEGIN PUBLIC KEY-----\n"
            . chunk_split(base64_encode($publicKeyDer), 64, "\n")
            . "-----END PUBLIC KEY-----\n";

        return openssl_verify($data, $signature, $pem, OPENSSL_ALGO_SHA256) === 1;
    }

    // CBOR 解析和其他辅助方法省略，生产环境建议使用 web-auth/webauthn-lib
}
```

### 前端：注册和认证流程

```javascript
// resources/js/webauthn.js

class WebAuthnClient {
    /**
     * 检测浏览器是否支持 WebAuthn
     */
    static isSupported() {
        return window.PublicKeyCredential !== undefined;
    }

    /**
     * 检测是否支持平台认证器（指纹/Face ID）
     */
    static async isPlatformAuthenticatorAvailable() {
        if (!this.isSupported()) return false;
        return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }

    /**
     * 注册新设备
     */
    static async register(nickname) {
        // 1. 从服务端获取注册选项
        const optionsResp = await fetch('/webauthn/register/options', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
            },
            body: JSON.stringify({ nickname }),
        });

        const options = await optionsResp.json();

        // 2. Base64URL 转 ArrayBuffer
        options.challenge = this.base64UrlToBuffer(options.challenge);
        options.user.id = this.base64UrlToBuffer(options.user.id);

        if (options.excludeCredentials) {
            options.excludeCredentials = options.excludeCredentials.map(cred => ({
                ...cred,
                id: this.base64UrlToBuffer(cred.id),
            }));
        }

        // 3. 调用浏览器 WebAuthn API
        const credential = await navigator.credentials.create({ publicKey: options });

        // 4. 将响应发回服务端验证
        const verifyResp = await fetch('/webauthn/register/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
            },
            body: JSON.stringify({
                id: credential.id,
                rawId: this.bufferToBase64Url(credential.rawId),
                response: {
                    clientDataJSON: this.bufferToBase64Url(credential.response.clientDataJSON),
                    attestationObject: this.bufferToBase64Url(credential.response.attestationObject),
                    transports: credential.response.getTransports?.() || ['internal'],
                },
                type: credential.type,
                nickname,
            }),
        });

        return verifyResp.json();
    }

    /**
     * 使用 Passkey 登录
     */
    static async authenticate() {
        // 1. 获取认证选项
        const optionsResp = await fetch('/webauthn/authenticate/options', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
            },
        });

        const options = await optionsResp.json();

        // 2. 转换格式
        options.challenge = this.base64UrlToBuffer(options.challenge);

        if (options.allowCredentials) {
            options.allowCredentials = options.allowCredentials.map(cred => ({
                ...cred,
                id: this.base64UrlToBuffer(cred.id),
            }));
        }

        // 3. 调用浏览器认证 API（弹出指纹/Face ID）
        const credential = await navigator.credentials.get({ publicKey: options });

        // 4. 发回服务端验证
        const verifyResp = await fetch('/webauthn/authenticate/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
            },
            body: JSON.stringify({
                id: credential.id,
                rawId: this.bufferToBase64Url(credential.rawId),
                response: {
                    authenticatorData: this.bufferToBase64Url(credential.response.authenticatorData),
                    clientDataJSON: this.bufferToBase64Url(credential.response.clientDataJSON),
                    signature: this.bufferToBase64Url(credential.response.signature),
                },
                type: credential.type,
            }),
        });

        return verifyResp.json();
    }

    // 工具方法
    static base64UrlToBuffer(base64Url) {
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const padLen = (4 - (base64.length % 4)) % 4;
        const padded = base64 + '='.repeat(padLen);
        const binary = atob(padded);
        return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
    }

    static bufferToBase64Url(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
}
```

### 路由和控制器

```php
// routes/web.php

use App\Http\Controllers\WebAuthnController;

Route::middleware('auth')->prefix('webauthn')->group(function () {
    Route::post('/register/options', [WebAuthnController::class, 'registerOptions']);
    Route::post('/register/verify', [WebAuthnController::class, 'registerVerify']);
});

// 认证路由不需要 auth 中间件
Route::prefix('webauthn')->group(function () {
    Route::post('/authenticate/options', [WebAuthnController::class, 'authenticateOptions']);
    Route::post('/authenticate/verify', [WebAuthnController::class, 'authenticateVerify']);
});
```

```php
// app/Http/Controllers/WebAuthnController.php

namespace App\Http\Controllers;

use App\Services\WebAuthn\WebAuthnService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class WebAuthnController extends Controller
{
    public function __construct(
        private WebAuthnService $webauthn
    ) {}

    public function registerOptions(Request $request)
    {
        $options = $this->webauthn->generateRegistrationChallenge(
            $request->user()
        );

        return response()->json($options);
    }

    public function registerVerify(Request $request)
    {
        $credential = $this->webauthn->verifyRegistration(
            $request->user(),
            $request->all()
        );

        return response()->json([
            'success' => true,
            'credential' => [
                'id' => $credential->id,
                'nickname' => $credential->nickname,
                'last_used_at' => $credential->last_used_at,
            ],
        ]);
    }

    public function authenticateOptions(Request $request)
    {
        // 如果用户输入了邮箱，可以限定特定用户的凭证
        $user = null;
        if ($request->has('email')) {
            $user = \App\Models\User::where('email', $request->email)->first();
        }

        $options = $this->webauthn->generateAuthenticationChallenge($user);

        return response()->json($options);
    }

    public function authenticateVerify(Request $request)
    {
        try {
            $user = $this->webauthn->verifyAuthentication($request->all());
            Auth::login($user);

            return response()->json([
                'success' => true,
                'redirect' => route('dashboard'),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => '认证失败：' . $e->getMessage(),
            ], 401);
        }
    }
}
```

## 第二阶段：密码 + Passkey 并行认证

当用户已经注册了 Passkey 后，我们需要支持两种登录方式并存。关键点在于**登录页面要智能判断**：

```php
// app/Http/Controllers/Auth/LoginController.php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\WebAuthnCredential;
use Illuminate\Http\Request;

class LoginController extends Controller
{
    public function showLoginForm()
    {
        // 检测浏览器是否支持 Passkey
        return view('auth.login', [
            'passkeyEnabled' => config('webauthn.enabled', true),
        ]);
    }

    /**
     * 密码登录后检查是否需要升级到 Passkey
     */
    protected function authenticated(Request $request, $user)
    {
        // 如果用户还没有注册 Passkey，且浏览器支持，提示注册
        $hasPasskey = WebAuthnCredential::where('user_id', $user->id)->exists();

        if (!$hasPasskey && $this->shouldPromptPasskey($request)) {
            $request->session()->flash('prompt_passkey', true);
        }
    }

    private function shouldPromptPasskey(Request $request): bool
    {
        // 不要每次都提示，频率控制
        $lastPrompt = $request->user()->settings->get('passkey_prompt_at');
        if ($lastPrompt && now()->diffInDays($lastPrompt) < 7) {
            return false;
        }

        return true;
    }
}
```

### 登录页面的渐进式 UI

```html
<!-- resources/views/auth/login.blade.php -->

<form method="POST" action="{{ route('login') }}" id="login-form">
    @csrf

    <div class="form-group">
        <label for="email">邮箱</label>
        <input type="email" name="email" id="email" required autofocus
               value="{{ old('email') }}">
    </div>

    <div class="form-group" id="password-group">
        <label for="password">密码</label>
        <input type="password" name="password" id="password">
    </div>

    <button type="submit" class="btn btn-primary" id="login-btn">
        登录
    </button>

    @if($passkeyEnabled)
    <div class="divider">
        <span>或者</span>
    </div>

    <button type="button" class="btn btn-outline" id="passkey-login-btn"
            onclick="loginWithPasskey()" style="display: none;">
        🔑 使用 Passkey 登录
    </button>
    @endif
</form>

@push('scripts')
<script>
document.addEventListener('DOMContentLoaded', async () => {
    const passkeyBtn = document.getElementById('passkey-login-btn');

    // 检测 Passkey 支持
    if (WebAuthnClient.isSupported()) {
        const available = await WebAuthnClient.isPlatformAuthenticatorAvailable();
        if (available) {
            passkeyBtn.style.display = 'block';
        }
    }

    // 当用户输入邮箱后，检查该用户是否有 Passkey
    const emailInput = document.getElementById('email');
    let debounceTimer;

    emailInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            if (e.target.value && e.target.value.includes('@')) {
                const resp = await fetch('/webauthn/authenticate/options', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                    },
                    body: JSON.stringify({ email: e.target.value }),
                });

                const options = await resp.json();

                // 如果该用户有 Passkey，自动高亮
                if (options.allowCredentials && options.allowCredentials.length > 0) {
                    passkeyBtn.classList.add('btn-primary');
                    passkeyBtn.classList.remove('btn-outline');
                    document.getElementById('password-group').style.opacity = '0.5';
                }
            }
        }, 500);
    });
});

async function loginWithPasskey() {
    const btn = document.getElementById('passkey-login-btn');
    btn.disabled = true;
    btn.textContent = '验证中...';

    try {
        const result = await WebAuthnClient.authenticate();
        if (result.success) {
            window.location.href = result.redirect;
        } else {
            alert(result.message || 'Passkey 认证失败，请使用密码登录');
        }
    } catch (err) {
        console.error('Passkey error:', err);
        alert('Passkey 认证失败，请使用密码登录');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔑 使用 Passkey 登录';
    }
}
</script>
@endpush
```

## 第三阶段：密码降级策略

当大部分用户都迁移了 Passkey 后，可以开始逐步弱化密码的地位：

```php
// app/Services/Auth/AuthenticationPolicy.php

namespace App\Services\Auth;

use App\Models\User;
use App\Models\WebAuthnCredential;

class AuthenticationPolicy
{
    /**
     * 判断用户的认证等级
     */
    public function getAuthLevel(User $user): AuthLevel
    {
        $hasPasskey = WebAuthnCredential::where('user_id', $user->id)->exists();

        if ($hasPasskey) {
            return AuthLevel::Passkey;  // 最高安全等级
        }

        $hasMfa = $user->hasEnabledMfa();
        if ($hasMfa) {
            return AuthLevel::PasswordMfa; // 中等安全等级
        }

        return AuthLevel::PasswordOnly; // 最低安全等级，需要推动升级
    }

    /**
     * 根据认证等级决定可以访问的资源
     */
    public function canAccessSensitiveResource(User $user, string $resource): bool
    {
        $level = $this->getAuthLevel($user);

        return match ($resource) {
            'api_keys', 'payment_methods' => $level->value >= AuthLevel::PasswordMfa->value,
            'security_settings', 'delete_account' => $level->value >= AuthLevel::Passkey->value,
            default => true,
        };
    }
}

enum AuthLevel: int
{
    case PasswordOnly = 1;
    case PasswordMfa = 2;
    case Passkey = 3;
}
```

```php
// app/Http/Middleware/RequireAuthLevel.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\Auth\AuthenticationPolicy;

class RequireAuthLevel
{
    public function __construct(
        private AuthenticationPolicy $policy
    ) {}

    public function handle(Request $request, Closure $next, string $minLevel = 'password_mfa')
    {
        $user = $request->user();
        $currentLevel = $this->policy->getAuthLevel($user);

        $requiredLevel = match ($minLevel) {
            'passkey' => \App\Services\Auth\AuthLevel::Passkey,
            'password_mfa' => \App\Services\Auth\AuthLevel::PasswordMfa,
            default => \App\Services\Auth\AuthLevel::PasswordOnly,
        };

        if ($currentLevel->value < $requiredLevel->value) {
            if ($request->expectsJson()) {
                return response()->json([
                    'error' => 'insufficient_auth_level',
                    'message' => '需要更高安全等级的认证方式',
                    'required_level' => $requiredLevel->name,
                    'upgrade_url' => route('security.upgrade'),
                ], 403);
            }

            return redirect()->route('security.upgrade')
                ->with('warning', '请升级认证方式以访问此功能');
        }

        return $next($request);
    }
}
```

## 踩坑记录

### 坑 1：Safari 的 Passkey 同步延迟

在 iOS/macOS 上，用户通过 iCloud Keychain 创建的 Passkey 可能不会立刻同步到其他设备。我们遇到了用户在 iPhone 上注册了 Passkey，但在 Mac 上无法使用的问题。

**解决方案：**

```php
// 在认证选项中同时允许 internal 和 hybrid（跨设备）
public function generateAuthenticationChallenge(?User $user = null): array
{
    $options = $this->baseOptions();

    if ($user) {
        $options['allowCredentials'] = WebAuthnCredential::where('user_id', $user->id)
            ->get()
            ->flatMap(function ($cred) {
                // 每个凭证可以有多种传输方式
                $transports = $cred->transports ?? ['internal'];
                return [
                    [
                        'type' => 'public-key',
                        'id' => $cred->credential_id,
                        'transports' => $transports,
                    ],
                ];
            })
            ->toArray();
    }

    return $options;
}
```

### 坑 2：localhost 开发环境的 rpId 问题

WebAuthn 的 `rpId` 必须与当前页面的域名匹配。在 `localhost` 开发时：

```php
// config/webauthn.php
return [
    // 生产环境用真实域名
    'rp_id' => env('WEBAUTHN_RP_ID', parse_url(config('app.url'), PHP_URL_HOST)),

    // localhost 开发时，rpId 可以留空（默认为当前域名）
    // 但不能设置为 'localhost' 以外的值
    'origin' => env('WEBAUTHN_ORIGIN', config('app.url')),
];
```

### 坑 3：CBOR 解析

WebAuthn 的 `attestationObject` 使用 CBOR 编码，PHP 没有内置的 CBOR 解析器。不要手写 CBOR 解析器，用现成的库：

```bash
composer require web-auth/webauthn-lib
```

```php
use Webauthn\AttestationStatement\AttestationObjectLoader;
use Webauthn\AuthenticatorAttestationResponseValidator;
use Webauthn\PublicKeyCredentialLoader;

// 使用库的完整实现，不要自己解析 CBOR
$publicKeyCredentialLoader = new PublicKeyCredentialLoader(
    new AttestationObjectLoader($attestationStatementSupportManager)
);
```

### 坑 4：同一设备多次注册

用户可能会在同一设备上多次点击注册，产生多个凭证。需要在前端和后端都做防重复：

```php
// 注册前检查该设备是否已经注册过
$existingCredential = WebAuthnCredential::where('user_id', $user->id)
    ->where('credential_id', $credentialId)
    ->first();

if ($existingCredential) {
    // 更新而不是新建
    $existingCredential->update([
        'last_used_at' => now(),
        'sign_count' => max($existingCredential->sign_count, $newSignCount),
    ]);
    return $existingCredential;
}
```

### 坑 5：跨域 iframe 中的 WebAuthn

如果你的应用嵌入在 iframe 中（比如第三方登录），WebAuthn 会失败。浏览器要求 WebAuthn API 必须在顶层上下文中调用。

```javascript
// 检测是否在 iframe 中
if (window !== window.top) {
    // 必须跳出 iframe 才能使用 WebAuthn
    window.top.location.href = window.location.href;
}
```

## 生产环境部署 Checklist

```
✅ HTTPS 必须开启（WebAuthn 只在安全上下文中工作）
✅ rpId 设置为实际域名（不能带端口号）
✅ CSP 头部允许 'self' 作为 frame-ancestors
✅ 备份认证方式（至少保留密码作为 fallback）
✅ 监控 WebAuthn 注册/认证失败率
✅ 设置合理的 challenge 过期时间（建议 5 分钟）
✅ 定期清理过期的 challenge 记录
✅ 日志记录所有认证事件（成功/失败）
```

## 总结

渐进式迁移的关键策略：

1. **不要一刀切**——密码和 Passkey 必须并存一段时间
2. **智能提示**——在用户登录成功后，适时提示注册 Passkey
3. **权限分级**——Passkey 用户可以解锁更多安全功能，形成正向激励
4. **备份方案**——永远保留密码作为兜底，至少在迁移期

我的迁移时间线：

- **第 1-2 周**：部署 WebAuthn 基础设施，内部团队测试
- **第 3-4 周**：面向所有用户开放注册，但不强制
- **第 5-8 周**：登录后提示注册 Passkey，新注册用户默认引导
- **第 9-12 周**：对高敏感操作强制要求 Passkey/MFA
- **第 13+ 周**：评估迁移率，决定是否逐步淘汰密码

FIDO2/Passkey 不是未来，是现在。Apple、Google、Microsoft 三大平台都在全力推进，2026 年已经是最佳的启动窗口。在 Laravel 中实现 WebAuthn 并不复杂，复杂的只是迁移策略本身——但渐进式迁移能让这个过程对用户几乎透明。
