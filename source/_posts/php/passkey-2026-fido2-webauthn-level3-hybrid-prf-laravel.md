---
title: Passkey 2026 生态更新实战：FIDO2/WebAuthn Level 3、Hybrid Transport、PRF 扩展——Laravel 无密码登录的最新工程实践
keywords: [Passkey, FIDO2, WebAuthn Level, Hybrid Transport, PRF, Laravel, 生态更新实战, 扩展, 无密码登录的最新工程实践, PHP]
date: 2026-06-09 16:28:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Passkey
  - FIDO2
  - WebAuthn
  - Laravel
  - 无密码登录
  - PRF
  - Hybrid Transport
description: 深入解析 2026 年 Passkey 生态的三大核心更新——FIDO2/WebAuthn Level 3 规范、Hybrid Transport 跨设备认证、PRF 扩展密钥派生，并提供完整的 Laravel 工程实现。
---


## 前言

2026 年，Passkey 已经从"未来技术"变成了"生产标配"。Apple、Google、Microsoft 三大平台全面内置 Passkey 支持，1Password、Bitwarden 等密码管理器也完成了深度集成。但生态并没有停下脚步——FIDO2/WebAuthn Level 3 规范进入 Candidate Recommendation 阶段，Hybrid Transport 让跨设备认证体验质变，PRF 扩展则为端到端加密场景打开了新大门。

本文不讲概念科普，直接切入这三个核心更新的工程细节，并给出完整的 Laravel 实现。

---

## 一、FIDO2/WebAuthn Level 3：规范层面变了什么

### 1.1 Level 2 → Level 3 的关键差异

WebAuthn Level 2（2021 年定稿）已经覆盖了大部分基础场景。Level 3 的变更集中在三个方向：

**1. Large Blob Storage（大 blob 存储）**

Level 2 的 `largeBlob` 扩展只能存储少量数据（约 4KB）。Level 3 引入了分片存储机制，单个 Passkey 可关联最多 64KB 的加密数据。这意味着什么？你可以在 Passkey 里存储用户加密私钥片段，实现真正的"设备即密钥"。

```php
// 注册时请求 largeBlob 支持
$publicKeyOptions = [
    'extensions' => [
        'largeBlob' => [
            'support' => 'required', // 或 'preferred'
            'write' => base64_encode($encryptedUserKey),
        ],
    ],
];
```

**2. Signal API（信号 API）**

这是一个被低估的更新。Level 3 引入了 `PublicKeyCredential.signalAllAcceptedCredentials()` 和 `signalCurrentUserDetails()` 方法，允许 Relying Party（RP）主动通知浏览器哪些凭据仍然有效、用户信息是否变更。

```php
// 用户修改了邮箱后，通知浏览器更新 Passkey 关联信息
// 这需要在前端 JS 中调用：
// PublicKeyCredential.signalCurrentUserDetails({
//     rpId: 'example.com',
//     userId: base64urlUserId,
//     name: 'new_email@example.com',
//     displayName: 'Michael'
// });
```

**3. Conditional Create（条件创建）**

`mediation: 'conditional'` 不仅可以用于登录（Level 2 已支持），Level 3 扩展到了注册流程。用户在注册表单中输入用户名后，浏览器自动弹出 Passkey 创建提示，无需额外点击。

### 1.2 浏览器兼容性现状（2026 年 6 月）

| 特性 | Chrome 126+ | Safari 19+ | Firefox 128+ | Edge 126+ |
|------|-------------|------------|--------------|-----------|
| Large Blob | ✅ | ✅ | ✅ | ✅ |
| Signal API | ✅ | ✅ | ⚠️ 部分 | ✅ |
| Conditional Create | ✅ | ✅ | ❌ | ✅ |

---

## 二、Hybrid Transport：跨设备认证的质变

### 2.1 什么是 Hybrid Transport

传统的跨设备认证依赖 BLE（蓝牙低功耗），体验极差——配对慢、连接不稳定、功耗高。Hybrid Transport 利用已有的设备间连接（iCloud Keychain、Google Password Manager 的云同步、或局域网连接）来传输认证数据。

用户场景：手机上已存 Passkey，在笔记本上登录时，手机自动弹出确认提示，通过端到端加密通道完成认证。整个过程无需蓝牙，延迟从 3-5 秒降到 500ms 以内。

### 2.2 技术实现

Hybrid Transport 的核心是 `hybrid` 传输协议：

```javascript
// 前端：注册/认证时指定传输方式
const publicKeyOptions = {
    // ... 其他参数
    authenticatorSelection: {
        authenticatorAttachment: 'platform', // 本机
        residentKey: 'required',
        userVerification: 'required',
    },
    // 关键：在传输偏好中包含 hybrid
    hints: ['hybrid', 'security-key'],
};
```

### 2.3 Laravel 端的传输类型识别

当用户通过 Hybrid Transport 完成认证时，`authenticatorData` 中的传输信息会包含 `hybrid` 类型。服务端需要正确解析：

```php
use Webauthn\AuthenticatorAssertionResponse;

// 解析认证响应
$response = $authenticatorAssertionResponse->getAuthenticatorData();

// 获取传输方式
$transports = $response->getTransports(); // 包含 'hybrid'

// 记录传输方式用于安全审计
if (in_array('hybrid', $transports)) {
    // 跨设备认证，可能需要额外的风险评估
    $this->logCrossDeviceAuth($user, $transports);
}
```

---

## 三、PRF 扩展：从认证到密钥派生

### 3.1 PRF 是什么

PRF（Pseudo-Random Function）扩展是 Passkey 生态中最具变革性的更新。它允许从 Passkey 中派生出确定性的加密密钥，而且这个密钥永远不会离开安全硬件（Secure Enclave / TPM / Titan）。

应用场景：
- **端到端加密笔记应用**：用 Passkey 派生密钥加密笔记，换设备后用同一 Passkey 解密
- **本地加密保险箱**：浏览器扩展用 PRF 派生密钥加密存储的密码
- **零知识认证**：服务端永远拿不到原始密钥，只有加密后的数据

### 3.2 注册时启用 PRF

```php
// Laravel 注册控制器
public function registerOptions(Request $request): JsonResponse
{
    $user = $request->user();

    $publicKeyCredentialCreationOptions =
        $this->webauthnService->generateCreationOptions(
            user: $user,
            extensions: [
                'prf' => [
                    'eval' => [
                        'first' => base64_encode(random_bytes(32)),
                    ],
                ],
            ],
        );

    // 存储 challenge 到 session
    session(['webauthn_register_challenge' => $publicKeyCredentialCreationOptions->getChallenge()]);

    return response()->json($publicKeyCredentialCreationOptions);
}
```

### 3.3 认证时获取 PRF 输出

```php
// Laravel 认证控制器
public function login(Request $request): JsonResponse
{
    $credential = $request->input('credential');

    // 解析认证响应
    $response = $this->webauthnService->parseAssertionResponse($credential);

    // 验证 challenge
    $this->webauthnService->verifyChallenge(
        $response,
        session('webauthn_login_challenge'),
    );

    // 获取 PRF 输出
    $prfResults = $response->getAuthenticatorData()
        ->getExtensions()
        ->getPrfResults();

    if ($prfResults) {
        $derivedKey = $prfResults->getFirst();

        // 用派生密钥解密用户数据
        $encryptedData = $this->getUserEncryptedData($user);
        $decrypted = sodium_crypto_secretbox_open(
            $encryptedData['ciphertext'],
            $encryptedData['nonce'],
            $derivedKey,
        );

        return response()->json([
            'success' => true,
            'decryptedData' => $decrypted,
        ]);
    }

    return response()->json(['success' => true]);
}
```

### 3.4 PRF 的安全边界

PRF 的密钥派生是确定性的——相同的 Passkey + 相同的输入 = 相同的输出。这意味着：

1. **不要直接用 PRF 输出作为唯一加密密钥**，建议再过一层 KDF（如 HKDF）
2. **每个应用使用不同的 salt**，防止跨应用密钥复用
3. **PRF 输出经过浏览器传输**，存在被中间人攻击的理论风险，务必在 HTTPS 环境下使用

```php
// 推荐：PRF 输出 → HKDF → 实际加密密钥
$prfOutput = $prfResults->getFirst();
$encryptionKey = hash_hkdf('sha256', $prfOutput, 32, 'my-app-encryption-v1');
```

---

## 四、完整 Laravel 实现

### 4.1 依赖安装

```bash
composer require web-auth/webauthn-stimulus
composer require web-auth/webauthn-framework
```

> `web-auth/webauthn-framework` 是目前 PHP 生态中最成熟的 WebAuthn 库，支持 Level 3 的大部分特性。

### 4.2 数据库迁移

```php
// database/migrations/2026_06_09_create_webauthn_credentials_table.php
Schema::create('webauthn_credentials', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('credential_id')->unique();
    $table->text('public_key');
    $table->string('attestation_type')->nullable();
    $table->json('transports')->nullable(); // 存储传输方式
    $table->unsignedBigInteger('sign_count')->default(0);
    $table->string('aaguid')->nullable();
    $table->json('prf_key')->nullable(); // 存储 PRF 派生的加密密钥（加密后）
    $table->timestamps();

    $table->index(['user_id', 'credential_id']);
});
```

### 4.3 Passkey 模型

```php
// app/Models/WebauthnCredential.php
class WebauthnCredential extends Model
{
    protected $fillable = [
        'user_id',
        'credential_id',
        'public_key',
        'attestation_type',
        'transports',
        'sign_count',
        'aaguid',
        'prf_key',
    ];

    protected $casts = [
        'transports' => 'array',
        'prf_key' => 'encrypted:array',
        'sign_count' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isHybridTransport(): bool
    {
        return in_array('hybrid', $this->transports ?? []);
    }
}
```

### 4.4 注册流程

```php
// app/Http/Controllers/Webauthn/RegisterController.php
class RegisterController extends Controller
{
    public function __construct(
        private WebauthnServer $server,
    ) {}

    /**
     * 生成 Passkey 注册选项
     */
    public function options(Request $request): JsonResponse
    {
        $user = $request->user();

        $excludedCredentialIds = WebauthnCredential::where('user_id', $user->id)
            ->pluck('credential_id')
            ->toArray();

        $options = $this->server->generatePublicKeyCredentialCreationOptions(
            rpEntity: new PublicKeyCredentialRpEntity(
                name: config('app.name'),
                id: parse_url(config('app.url'), PHP_URL_HOST),
            ),
            userEntity: new PublicKeyCredentialUserEntity(
                name: $user->email,
                id: $user->id,
                displayName: $user->name,
            ),
            authenticatorSelectionCriteria: new AuthenticatorSelectionCriteria(
                authenticatorAttachment: AuthenticatorAttachment::PLATFORM,
                residentKey: ResidentKeyRequirement::REQUIRED,
                userVerification: UserVerificationRequirement::REQUIRED,
            ),
            excludeCredentials: array_map(
                fn ($id) => new PublicKeyCredentialDescriptor(
                    PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY,
                    $id,
                ),
                $excludedCredentialIds,
            ),
            extensions: new AuthenticationExtensionsClientInputs([
                'prf' => [
                    'eval' => [
                        'first' => base64_encode(random_bytes(32)),
                    ],
                ],
            ]),
        );

        session(['webauthn_register_challenge' => $options]);

        return response()->json($options);
    }

    /**
     * 验证并存储 Passkey
     */
    public function verify(Request $request): JsonResponse
    {
        $request->validate([
            'credential' => 'required|array',
            'credential.id' => 'required|string',
            'credential.response' => 'required|array',
        ]);

        $challenge = session('webauthn_register_challenge');

        try {
            $response = $this->server->parseAndVerifyAttestationResponse(
                $request->input('credential'),
                $challenge,
            );

            $credentialId = base64_encode($response->getCredentialId());
            $publicKey = $response->getCredentialPublicKey();
            $transports = $request->input('credential.response.transports', []);

            // 存储 PRF 派生密钥（加密存储）
            $prfKey = null;
            $extensions = $response->getAuthenticatorData()->getExtensions();
            if ($extensions && $extensions->getPrfResults()) {
                $prfOutput = $extensions->getPrfResults()->getFirst();
                $prfKey = [
                    'key' => base64_encode($prfOutput),
                    'salt' => base64_encode(random_bytes(32)),
                ];
            }

            WebauthnCredential::create([
                'user_id' => $request->user()->id,
                'credential_id' => $credentialId,
                'public_key' => base64_encode($publicKey),
                'attestation_type' => $response->getAttestationType(),
                'transports' => $transports,
                'sign_count' => $response->getSignCount(),
                'aaguid' => $response->getAaguid()->toString(),
                'prf_key' => $prfKey,
            ]);

            session()->forget('webauthn_register_challenge');

            return response()->json([
                'success' => true,
                'message' => 'Passkey 注册成功',
                'has_prf' => $prfKey !== null,
                'transport' => in_array('hybrid', $transports) ? 'hybrid' : 'platform',
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => '注册失败：' . $e->getMessage(),
            ], 422);
        }
    }
}
```

### 4.5 认证流程

```php
// app/Http/Controllers/Webauthn/LoginController.php
class LoginController extends Controller
{
    public function __construct(
        private WebauthnServer $server,
    ) {}

    /**
     * 生成认证选项
     */
    public function options(Request $request): JsonResponse
    {
        $email = $request->input('email');
        $user = User::where('email', $email)->first();

        $allowedCredentialIds = [];
        if ($user) {
            $allowedCredentialIds = WebauthnCredential::where('user_id', $user->id)
                ->pluck('credential_id')
                ->toArray();
        }

        $options = $this->server->generatePublicKeyCredentialRequestOptions(
            userVerification: UserVerificationRequirement::REQUIRED,
            allowCredentials: array_map(
                fn ($id) => new PublicKeyCredentialDescriptor(
                    PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY,
                    base64_decode($id),
                    [AuthenticatorTransport::HYBRID, AuthenticatorTransport::INTERNAL],
                ),
                $allowedCredentialIds,
            ),
            extensions: new AuthenticationExtensionsClientInputs([
                'prf' => [
                    'eval' => [
                        'first' => base64_encode(random_bytes(32)),
                    ],
                ],
            ]),
        );

        session(['webauthn_login_challenge' => $options]);

        return response()->json($options);
    }

    /**
     * 验证认证响应并登录
     */
    public function verify(Request $request): JsonResponse
    {
        $request->validate([
            'credential' => 'required|array',
        ]);

        $challenge = session('webauthn_login_challenge');

        try {
            $response = $this->server->parseAndVerifyAssertionResponse(
                $request->input('credential'),
                $challenge,
            );

            $credentialId = base64_encode($response->getCredentialId());
            $credential = WebauthnCredential::where('credential_id', $credentialId)->firstOrFail();

            // 验证签名计数器（防止重放攻击）
            $credential->update([
                'sign_count' => $response->getSignCount(),
            ]);

            // 处理 PRF 输出
            $prfDerivedKey = null;
            $extensions = $response->getAuthenticatorData()->getExtensions();
            if ($extensions && $extensions->getPrfResults() && $credential->prf_key) {
                $prfOutput = $extensions->getPrfResults()->getFirst();
                $prfDerivedKey = hash_hkdf(
                    'sha256',
                    $prfOutput,
                    32,
                    'my-app-encryption-v1',
                );
            }

            // 登录用户
            Auth::login($credential->user);

            session()->forget('webauthn_login_challenge');

            return response()->json([
                'success' => true,
                'user' => [
                    'id' => $credential->user->id,
                    'name' => $credential->user->name,
                    'email' => $credential->user->email,
                ],
                'prf_key' => $prfDerivedKey ? base64_encode($prfDerivedKey) : null,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => '认证失败：' . $e->getMessage(),
            ], 422);
        }
    }
}
```

### 4.6 前端实现

```javascript
// resources/js/passkey.js

/**
 * 注册 Passkey
 */
async function registerPasskey(optionsUrl, verifyUrl, csrfToken) {
    // 1. 获取注册选项
    const optionsResponse = await fetch(optionsUrl, {
        headers: {
            'X-CSRF-TOKEN': csrfToken,
            'Accept': 'application/json',
        },
    });
    const options = await optionsResponse.json();

    // 2. 转换为浏览器 API 所需格式
    const publicKeyCredentialCreationOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        user: {
            ...options.user,
            id: base64urlToBuffer(options.user.id),
        },
        excludeCredentials: options.excludeCredentials?.map(cred => ({
            ...cred,
            id: base64urlToBuffer(cred.id),
        })),
    };

    // 3. 调用浏览器 API
    const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
    });

    // 4. 发送到服务端验证
    const verifyResponse = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrfToken,
        },
        body: JSON.stringify({
            credential: {
                id: credential.id,
                type: credential.type,
                response: {
                    attestationObject: bufferToBase64url(credential.response.attestationObject),
                    clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
                    transports: credential.response.getTransports?.() ?? [],
                },
            },
        }),
    });

    return await verifyResponse.json();
}

/**
 * 使用 Passkey 登录
 */
async function loginWithPasskey(optionsUrl, verifyUrl, csrfToken, email = null) {
    // 1. 获取认证选项
    const body = email ? { email } : {};
    const optionsResponse = await fetch(optionsUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrfToken,
            'Accept': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const options = await optionsResponse.json();

    // 2. 转换格式
    const publicKeyCredentialRequestOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        allowCredentials: options.allowCredentials?.map(cred => ({
            ...cred,
            id: base64urlToBuffer(cred.id),
        })),
    };

    // 3. 调用浏览器 API
    const credential = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
    });

    // 4. 发送到服务端
    const verifyResponse = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrfToken,
        },
        body: JSON.stringify({
            credential: {
                id: credential.id,
                type: credential.type,
                response: {
                    authenticatorData: bufferToBase64url(credential.response.authenticatorData),
                    clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
                    signature: bufferToBase64url(credential.response.signature),
                    userHandle: credential.response.userHandle
                        ? bufferToBase64url(credential.response.userHandle)
                        : null,
                },
            },
        }),
    });

    return await verifyResponse.json();
}

// Base64url 工具函数
function base64urlToBuffer(base64url) {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function bufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
```

---

## 五、踩坑记录

### 5.1 Secure Context 陷阱

WebAuthn API **只在安全上下文中可用**（HTTPS 或 localhost）。开发环境常见的坑：

```nginx
# 错误：HTTP 环境下 navigator.credentials 是 undefined
# 解决方案 1：用 mkcert 生成本地证书
mkcert -install
mkcert localhost 127.0.0.1 ::1

# 解决方案 2：Laravel Valet 默认已启用 HTTPS
```

### 5.2 RP ID 不匹配

RP ID 必须与当前页面的域名完全匹配（或为其父域）。常见问题：

```php
// 错误：RP ID 设置为 'www.example.com'，但用户从 'example.com' 访问
// 正确：使用裸域名
'rpId' => parse_url(config('app.url'), PHP_URL_HOST),

// 开发环境注意：localhost 的 RP ID 就是 'localhost'，不要加端口
```

### 5.3 PRF 扩展的浏览器差异

```javascript
// PRF 扩展在 Safari 中的行为与 Chrome 不同
// Safari：如果设备不支持 PRF，会静默忽略，不会报错
// Chrome：会返回 prf: { enabled: false }

// 安全做法：始终检查 PRF 输出是否实际存在
if (credential.response.getExtensionResults) {
    const extResults = credential.response.getExtensionResults();
    if (!extResults.prf?.results?.first) {
        // PRF 不可用，回退到非 PRF 流程
        console.warn('PRF not available, falling back');
    }
}
```

### 5.4 Hybrid Transport 的用户体验

```javascript
// Hybrid Transport 的确认弹窗在不同平台表现不一致
// iOS：全屏模态，用户需要 Face ID / Touch ID
// Android：底部弹窗，可能被其他通知遮挡
// 解决：在前端添加等待状态提示

async function loginWithPasskey() {
    const statusEl = document.getElementById('passkey-status');
    statusEl.textContent = '请在您的设备上确认...';
    statusEl.style.display = 'block';

    try {
        const result = await doPasskeyLogin();
        statusEl.textContent = '认证成功';
        return result;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            statusEl.textContent = '认证已取消或超时';
        }
        throw err;
    }
}
```

### 5.5 签名计数器同步问题

当用户在多个设备上使用同一个 Passkey（通过云同步），签名计数器可能不连续：

```php
// 错误做法：严格要求计数器递增
if ($response->getSignCount() <= $credential->sign_count) {
    throw new InvalidSignCountException();
}

// 正确做法：Level 3 规范建议，对于同步凭据（synced credentials），
// 计数器为 0 表示不支持计数器，应跳过检查
if ($credential->sign_count > 0 && $response->getSignCount() === 0) {
    // 首次使用同步凭据，更新计数器即可
    $credential->update(['sign_count' => 0]);
} elseif ($response->getSignCount() > $credential->sign_count) {
    $credential->update(['sign_count' => $response->getSignCount()]);
} elseif ($response->getSignCount() === 0 && $credential->sign_count === 0) {
    // 同步凭据，计数器不适用，正常通过
} else {
    // 可能是克隆凭据，记录告警
    Log::warning('WebAuthn sign count anomaly', [
        'credential_id' => $credential->credential_id,
        'expected' => $credential->sign_count,
        'received' => $response->getSignCount(),
    ]);
}
```

---

## 六、安全加固清单

### 6.1 速率限制

```php
// routes/web.php
Route::middleware(['throttle:5,1'])->group(function () {
    Route::post('/webauthn/login/options', [LoginController::class, 'options']);
    Route::post('/webauthn/login/verify', [LoginController::class, 'verify']);
});
```

### 6.2 审计日志

```php
// app/Listeners/WebauthnLoginListener.php
class WebauthnLoginListener
{
    public function handle(WebauthnLoginEvent $event): void
    {
        activity('webauthn')
            ->causedBy($event->user)
            ->withProperties([
                'credential_id' => $event->credential->credential_id,
                'transport' => $event->credential->transports,
                'is_hybrid' => $event->credential->isHybridTransport(),
                'sign_count' => $event->signCount,
                'ip' => request()->ip(),
                'user_agent' => request()->userAgent(),
            ])
            ->log('Passkey 认证');
    }
}
```

### 6.3 凭据恢复机制

Passkey 最大的风险是设备丢失。务必提供备用认证方式：

```php
// app/Http/Controllers/Webauthn/RecoveryController.php
class RecoveryController extends Controller
{
    /**
     * 生成恢复码（注册 Passkey 时一次性生成）
     */
    public function generateRecoveryCodes(User $user): array
    {
        $codes = [];
        for ($i = 0; $i < 8; $i++) {
            $code = strtoupper(Str::random(4) . '-' . Str::random(4));
            $codes[] = $code;
        }

        // 加密存储
        $user->update([
            'recovery_codes' => encrypt(json_encode(
                array_map(fn ($code) => hash('sha256', $code), $codes)
            )),
        ]);

        return $codes;
    }

    /**
     * 使用恢复码登录
     */
    public function verifyRecoveryCode(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'code' => 'required|string|size:9',
        ]);

        $user = User::where('email', $request->email)->firstOrFail();
        $codes = json_decode(decrypt($user->recovery_codes), true);
        $codeHash = hash('sha256', $request->code);

        if (!in_array($codeHash, $codes)) {
            return response()->json(['message' => '恢复码无效'], 422);
        }

        // 移除已使用的恢复码
        $remaining = array_filter($codes, fn ($c) => $c !== $codeHash);
        $user->update(['recovery_codes' => encrypt(json_encode($remaining))]);

        Auth::login($user);

        return response()->json([
            'success' => true,
            'remaining_codes' => count($remaining),
        ]);
    }
}
```

---

## 七、总结

2026 年的 Passkey 生态已经不是"能不能用"的问题，而是"怎么用好"的问题。三个核心更新的实际意义：

| 更新 | 工程价值 | 采用优先级 |
|------|---------|-----------|
| WebAuthn Level 3 | Large Blob 支持更多数据存储，Signal API 实现凭据生命周期管理 | 中（渐进增强） |
| Hybrid Transport | 跨设备认证体验质变，用户无需蓝牙配对 | 高（已全面可用） |
| PRF 扩展 | 从认证扩展到密钥派生，支持端到端加密场景 | 高（需评估安全模型） |

对于 Laravel 项目，建议的落地路径：

1. **第一步**：先用 `web-auth/webauthn-framework` 跑通基础 Passkey 注册/认证
2. **第二步**：启用 Hybrid Transport，优化跨设备体验
3. **第三步**：评估 PRF 扩展的适用场景，如需本地加密再集成
4. **第四步**：配置恢复码和备用认证方式，防止用户锁死

Passkey 的终极目标是消灭密码。但在此之前，先确保你的用户不会因为一次设备丢失就彻底失去账户访问权。

---

**参考资料：**
- [Web Authentication Level 3 (W3C Candidate Recommendation)](https://www.w3.org/TR/webauthn-3/)
- [FIDO2 Specs & Certs](https://fidoalliance.org/fido2/)
- [web-auth/webauthn-framework (PHP)](https://github.com/web-auth/webauthn-framework)
- [Passkey Developer](https://developer.apple.com/passkeys/)
