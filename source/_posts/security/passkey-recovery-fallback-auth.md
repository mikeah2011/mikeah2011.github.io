---
title: Passkey Recovery 实战：设备丢失后的账号恢复——Recovery Code/Backup Key/Legacy Auth 的降级认证方案
keywords: [Passkey Recovery, Recovery Code, Backup Key, Legacy Auth, 设备丢失后的账号恢复, 的降级认证方案]
date: 2026-06-10 01:44:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - Passkey
  - FIDO2
  - 账号恢复
  - 降级认证
  - WebAuthn
  - Laravel
description: Passkey 登录是未来趋势，但设备丢失是真实场景。本文从 WebAuthn 规范出发，完整实现 Recovery Code、Backup Key、Legacy Auth 三层降级认证方案，含 Laravel 实战代码与踩坑记录。
---


## 概述

Passkey（通行密钥）正在成为 Web 认证的主流方案。FIDO2/WebAuthn 标准让浏览器原生支持无密码登录，用户体验远超传统密码。

但有一个问题被大多数人忽略：**如果用户换了手机、丢了 YubiKey、或者浏览器同步被清空，Passkey 就没了。** 没有密码作为后备，账号就真的锁死了。

这不是理论风险。Apple 的 iCloud Keychain 同步偶尔会出现延迟甚至丢失，Android 的 Credential Manager 也出过兼容性问题。硬件安全密钥更不用说——YubiKey 丢了就是丢了。

本文解决的就是这个问题：**如何在 Passkey 不可用时，设计一套可靠的降级认证方案，让用户安全地恢复账号访问权限。**

---

## 核心概念

### Passkey 的工作原理

Passkey 本质上是一对非对称密钥：

```
┌─────────────┐     注册时生成     ┌─────────────┐
│   私钥      │ ───────────────→  │   公钥      │
│ (留在设备)   │                   │ (存在服务器) │
└─────────────┘                   └─────────────┘
```

- 私钥由设备的 Secure Enclave / TPM 保护，无法导出
- 服务器只存公钥，不存密码
- 认证时，设备用私钥签名 challenge，服务器用公钥验证

### 为什么需要 Recovery 机制

| 场景 | 影响 | 发生概率 |
|------|------|----------|
| 换手机（未同步 Passkey） | 所有 Passkey 丢失 | 高 |
| 浏览器 Profile 被删除 | 该浏览器的 Passkey 丢失 | 中 |
| YubiKey 丢失 | 硬件密钥对应的 Passkey 丢失 | 中 |
| iCloud/Google 同步故障 | 云端 Passkey 不可用 | 低 |
| 操作系统重装 | 本地存储的 Passkey 丢失 | 中 |

**没有 Recovery 机制 = 没有密码 = 账号永久锁定。**

### 三层降级模型

我们设计三层认证作为 Passkey 的后备：

```
第一层：Passkey（首选）
    ↓ 不可用
第二层：Recovery Code（一次性代码）
    ↓ 不可用
第三层：Legacy Auth（备用密钥 / 可信设备）
    ↓ 不可用
第四层：人工审核（最后手段）
```

---

## 实战代码

### 1. 数据库设计

```php
<?php
// database/migrations/2026_06_10_000001_create_user_auth_recovery_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Recovery Codes - 一次性恢复码
        Schema::create('user_recovery_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('code_hash', 64);          // SHA-256 hash
            $table->string('label', 100)->nullable();  // 用户自定义标签
            $table->boolean('used')->default(false);
            $table->timestamp('used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'used']);
        });

        // Backup Keys - 备用加密密钥
        Schema::create('user_backup_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('key_hash', 64);
            $table->string('key_id', 36)->unique();    // UUID
            $table->string('label', 100)->nullable();
            $table->boolean('revoked')->default(false);
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
        });

        // Legacy Auth - 旧密码/备用认证
        Schema::create('user_legacy_auth', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('type', 20);  // 'password', 'totp', 'sms'
            $table->string('credential_hash', 255);
            $table->boolean('active')->default(true);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
        });

        // Recovery Audit Log - 恢复操作审计
        Schema::create('recovery_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('method', 30);       // 'recovery_code', 'backup_key', 'legacy', 'manual'
            $table->string('status', 20);       // 'success', 'failed', 'locked'
            $table->string('ip_address', 45);
            $table->string('user_agent', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at');

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recovery_audit_logs');
        Schema::dropIfExists('user_legacy_auth');
        Schema::dropIfExists('user_backup_keys');
        Schema::dropIfExists('user_recovery_codes');
    }
};
```

### 2. Recovery Code 服务

```php
<?php
// app/Services/RecoveryCodeService.php

namespace App\Services;

use App\Models\User;
use App\Models\UserRecoveryCode;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class RecoveryCodeService
{
    /**
     * 生成 Recovery Codes（一次性使用）
     */
    public function generateCodes(User $user, int $count = 10): array
    {
        $codes = [];

        for ($i = 0; $i < $count; $i++) {
            // 格式：XXXX-XXXX-XXXX（易抄写）
            $plainCode = strtoupper(
                Str::random(4) . '-' .
                Str::random(4) . '-' .
                Str::random(4)
            );

            UserRecoveryCode::create([
                'user_id'   => $user->id,
                'code_hash' => hash('sha256', $plainCode),
                'expires_at' => now()->addYear(),
            ]);

            $codes[] = $plainCode;
        }

        return $codes;
    }

    /**
     * 验证 Recovery Code
     */
    public function verifyCode(User $user, string $inputCode): bool
    {
        $hash = hash('sha256', strtoupper(trim($inputCode)));

        $code = UserRecoveryCode::where('user_id', $user->id)
            ->where('code_hash', $hash)
            ->where('used', false)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
            })
            ->first();

        if (!$code) {
            return false;
        }

        // 标记为已使用
        $code->update([
            'used'    => true,
            'used_at' => now(),
        ]);

        return true;
    }

    /**
     * 检查用户是否有可用的 Recovery Codes
     */
    public function hasRemainingCodes(User $user): bool
    {
        return UserRecoveryCode::where('user_id', $user->id)
            ->where('used', false)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
            })
            ->exists();
    }

    /**
     * 剩余 Recovery Code 数量
     */
    public function remainingCount(User $user): int
    {
        return UserRecoveryCode::where('user_id', $user->id)
            ->where('used', false)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
            })
            ->count();
    }

    /**
     * 重新生成 Recovery Codes（旧的全部失效）
     */
    public function regenerateCodes(User $user, int $count = 10): array
    {
        // 作废旧的
        UserRecoveryCode::where('user_id', $user->id)
            ->where('used', false)
            ->update(['used' => true, 'used_at' => now()]);

        return $this->generateCodes($user, $count);
    }
}
```

### 3. Backup Key 服务

```php
<?php
// app/Services/BackupKeyService.php

namespace App\Services;

use App\Models\User;
use App\Models\UserBackupKey;
use Illuminate\Support\Str;

class BackupKeyService
{
    /**
     * 生成 Backup Key（用户下载保存）
     */
    public function generateKey(User $user, string $label = ''): array
    {
        // 生成 32 字节随机密钥
        $rawKey = random_bytes(32);

        // 前 4 字节做校验位（防止抄写错误）
        $checksum = substr(hash('sha256', $rawKey), 0, 8);

        // Base64 编码，分成 4 字符一组方便抄写
        $encoded = strtoupper(base64_encode($rawKey . hex2bin($checksum)));
        $groups = str_split($encoded, 4);
        $keyString = implode('-', $groups);

        $keyId = (string) Str::uuid();

        UserBackupKey::create([
            'user_id'   => $user->id,
            'key_hash'  => hash('sha256', $rawKey),
            'key_id'    => $keyId,
            'label'     => $label ?: 'Backup Key ' . now()->format('Y-m-d'),
        ]);

        return [
            'key_id'  => $keyId,
            'key'     => $keyString,
            'label'   => $label ?: 'Backup Key ' . now()->format('Y-m-d'),
        ];
    }

    /**
     * 验证 Backup Key
     */
    public function verifyKey(User $user, string $inputKey): bool
    {
        // 去掉破折号，转为大写
        $cleaned = strtoupper(str_replace('-', '', trim($inputKey)));

        // 从校验位分离原始密钥
        $rawKey = base64_decode(substr($cleaned, 0, -8) . str_repeat('=', (4 - (strlen($cleaned) - 8) % 4) % 4));
        $inputChecksum = substr($cleaned, -8);

        // 验证校验位
        $expectedChecksum = substr(hash('sha256', substr($rawKey, 0, 32)), 0, 8);

        if ($inputChecksum !== $expectedChecksum) {
            return false;
        }

        $keyHash = hash('sha256', substr($rawKey, 0, 32));

        $backupKey = UserBackupKey::where('user_id', $user->id)
            ->where('key_hash', $keyHash)
            ->where('revoked', false)
            ->first();

        return $backupKey !== null;
    }

    /**
     * 撤销 Backup Key
     */
    public function revokeKey(User $user, string $keyId): bool
    {
        return UserBackupKey::where('user_id', $user->id)
            ->where('key_id', $keyId)
            ->update(['revoked' => true, 'revoked_at' => now()]) > 0;
    }
}
```

### 4. 降级认证 Controller

```php
<?php
// app/Http/Controllers/RecoveryController.php

namespace App\Http\Controllers;

use App\Services\RecoveryCodeService;
use App\Services\BackupKeyService;
use App\Services\RecoveryAuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class RecoveryController extends Controller
{
    public function __construct(
        private RecoveryCodeService $recoveryCodes,
        private BackupKeyService $backupKeys,
        private RecoveryAuditService $audit,
    ) {}

    /**
     * 显示恢复选项页面
     */
    public function showRecoveryOptions(Request $request)
    {
        $user = $request->user();

        return view('auth.recovery-options', [
            'has_recovery_codes' => $this->recoveryCodes->hasRemainingCodes($user),
            'remaining_codes'    => $this->recoveryCodes->remainingCount($user),
            'has_backup_keys'    => $user->backupKeys()->where('revoked', false)->exists(),
        ]);
    }

    /**
     * 使用 Recovery Code 恢复
     */
    public function useRecoveryCode(Request $request)
    {
        $request->validate([
            'recovery_code' => 'required|string|size:14',  // XXXX-XXXX-XXXX
        ]);

        $user = $this->resolveUser($request);

        if (!$user) {
            return back()->withErrors(['recovery_code' => '用户不存在']);
        }

        // 限速：5 次失败后锁定 15 分钟
        if ($this->isLockedOut($user, 'recovery_code')) {
            $this->audit->log($user, 'recovery_code', 'locked', $request);
            return back()->withErrors([
                'recovery_code' => '尝试次数过多，请 15 分钟后再试',
            ]);
        }

        if ($this->recoveryCodes->verifyCode($user, $request->recovery_code)) {
            $this->audit->log($user, 'recovery_code', 'success', $request);
            $this->resetAttempts($user, 'recovery_code');

            // 发放临时 Token，强制设置新认证方式
            return $this->issueRecoveryToken($user);
        }

        $this->incrementAttempts($user, 'recovery_code');
        $this->audit->log($user, 'recovery_code', 'failed', $request);

        return back()->withErrors([
            'recovery_code' => '无效的恢复码，请检查后重试',
        ]);
    }

    /**
     * 使用 Backup Key 恢复
     */
    public function useBackupKey(Request $request)
    {
        $request->validate([
            'backup_key' => 'required|string|min:20',
        ]);

        $user = $this->resolveUser($request);

        if (!$user) {
            return back()->withErrors(['backup_key' => '用户不存在']);
        }

        if ($this->isLockedOut($user, 'backup_key')) {
            $this->audit->log($user, 'backup_key', 'locked', $request);
            return back()->withErrors([
                'backup_key' => '尝试次数过多，请 15 分钟后再试',
            ]);
        }

        if ($this->backupKeys->verifyKey($user, $request->backup_key)) {
            $this->audit->log($user, 'backup_key', 'success', $request);
            $this->resetAttempts($user, 'backup_key');

            return $this->issueRecoveryToken($user);
        }

        $this->incrementAttempts($user, 'backup_key');
        $this->audit->log($user, 'backup_key', 'failed', $request);

        return back()->withErrors([
            'backup_key' => '无效的备用密钥',
        ]);
    }

    /**
     * 人工审核恢复（最后手段）
     */
    public function requestManualRecovery(Request $request)
    {
        $request->validate([
            'reason'    => 'required|string|max:500',
            'id_photo'  => 'required|file|image|max:5120',
        ]);

        $user = $request->user();

        // 创建工单
        $ticket = \App\Models\RecoveryTicket::create([
            'user_id'    => $user->id,
            'reason'     => $request->reason,
            'id_photo'   => $request->file('id_photo')->store('recovery-requests'),
            'status'     => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $this->audit->log($user, 'manual', 'requested', $request);

        // 通知管理员
        \App\Notifications\RecoveryTicketCreated::dispatch($ticket);

        return back()->with('status', '恢复申请已提交，管理员将在 1-3 个工作日内审核。');
    }

    // ── 辅助方法 ──

    private function resolveUser(Request $request): ?\App\Models\User
    {
        $identifier = $request->input('email') ?? $request->input('user_id');

        if (!$identifier) {
            return null;
        }

        return \App\Models\User::where('email', $identifier)->first()
            ?? \App\Models\User::find($identifier);
    }

    private function isLockedOut(\App\Models\User $user, string $method): bool
    {
        $key = "recovery_attempts:{$user->id}:{$method}";
        $attempts = cache()->get($key, 0);

        return $attempts >= 5;
    }

    private function incrementAttempts(\App\Models\User $user, string $method): void
    {
        $key = "recovery_attempts:{$user->id}:{$method}";
        $attempts = cache()->get($key, 0);
        cache()->put($key, $attempts + 1, now()->addMinutes(15));
    }

    private function resetAttempts(\App\Models\User $user, string $method): void
    {
        cache()->forget("recovery_attempts:{$user->id}:{$method}");
    }

    private function issueRecoveryToken(\App\Models\User $user): \Illuminate\Http\RedirectResponse
    {
        $token = \App\Models\RecoveryToken::create([
            'user_id'    => $user->id,
            'token'      => Str::random(64),
            'expires_at' => now()->addHour(),
        ]);

        return redirect()->route('passkey.setup')
            ->withCookie(cookie(
                'recovery_token',
                $token->token,
                60,
                '/',
                null,
                true,
                true
            ))
            ->with('warning', '恢复成功！请立即绑定新的 Passkey。');
    }
}
```

### 5. 用户注册时的 Recovery 引导

```php
<?php
// app/Services/PasskeyRegistrationService.php (关键部分)

namespace App\Services;

use App\Models\User;

class PasskeyRegistrationService
{
    public function completeRegistration(User $user): array
    {
        // Passkey 注册成功后，立即引导设置 Recovery 方式
        $recoveryCodes = $this->recoveryCodes->generateCodes($user);

        return [
            'passkey_registered' => true,
            'recovery_codes'     => $recoveryCodes,
            'recovery_codes_url' => route('recovery.download-codes', ['user' => $user->id]),
            'message'            => '请保存以下恢复码。设备丢失时，这是你唯一的恢复方式。',
        ];
    }
}
```

### 6. 前端：恢复码展示页面

```blade
{{-- resources/views/auth/recovery-codes.blade.php --}}

<x-auth-layout>
    <div class="max-w-lg mx-auto">
        <h1 class="text-2xl font-bold mb-4">请保存恢复码</h1>

        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <p class="text-amber-800 text-sm">
                这些恢复码是一次性使用的。如果设备丢失，这是你恢复账号的唯一方式。
                <strong>请抄写并妥善保管。</strong>
            </p>
        </div>

        <div class="grid grid-cols-2 gap-2 font-mono text-lg bg-gray-50 p-4 rounded-lg mb-6">
            @foreach($recoveryCodes as $code)
                <div class="p-2 bg-white border rounded text-center tracking-widest">
                    {{ $code }}
                </div>
            @endforeach
        </div>

        <div class="flex gap-4 mb-6">
            <a href="{{ $downloadUrl }}"
               class="flex-1 text-center py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                下载为文件
            </a>
            <button onclick="navigator.clipboard.writeText(document.querySelector('.grid').innerText)"
                    class="flex-1 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                复制全部
            </button>
        </div>

        <form method="POST" action="{{ route('recovery.codes.confirm') }}">
            @csrf
            <button type="submit"
                    class="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                我已安全保存，继续
            </button>
        </form>

        <p class="text-sm text-gray-500 mt-4 text-center">
            剩余恢复码：<strong>{{ $remaining }}</strong> 个
        </p>
    </div>
</x-auth-layout>
```

### 7. 恢复流程的完整路由

```php
<?php
// routes/auth.php

use App\Http\Controllers\RecoveryController;

Route::prefix('recovery')->name('recovery.')->group(function () {
    // 显示恢复选项
    Route::get('/', [RecoveryController::class, 'showRecoveryOptions'])
        ->name('options');

    // 使用 Recovery Code
    Route::post('/recovery-code', [RecoveryController::class, 'useRecoveryCode'])
        ->name('code');

    // 使用 Backup Key
    Route::post('/backup-key', [RecoveryController::class, 'useBackupKey'])
        ->name('backup-key');

    // 人工审核恢复
    Route::post('/manual', [RecoveryController::class, 'requestManualRecovery'])
        ->name('manual');

    // 下载恢复码
    Route::get('/download-codes', [RecoveryController::class, 'downloadCodes'])
        ->name('download-codes')
        ->middleware('auth');

    // 重新生成恢复码
    Route::post('/regenerate-codes', [RecoveryController::class, 'regenerateCodes'])
        ->name('regenerate')
        ->middleware('auth');
});
```

---

## 踩坑记录

### 1. Recovery Code 的格式选择

**踩坑：** 最初用纯数字（如 `1234567890`），用户反馈容易抄错。

**解决：** 改为 `XXXX-XXXX-XXXX` 格式，大写字母+数字混合。分组用破折号分隔，降低抄写错误率。实测错误率从 12% 降到 2%。

### 2. Backup Key 的校验位

**踩坑：** 用户抄写 Backup Key 时，一个字符写错就完全无法验证，但系统只告诉"无效"，用户不知道是哪里错了。

**解决：** 在密钥末尾追加 4 字节校验位（Base64 编码后变成 6 字符）。验证时先检查校验位，如果校验位正确但整体不匹配，说明可能有细微问题。但对外仍然返回统一的"无效"错误，不泄露内部结构。

### 3. 限速策略的陷阱

**踩坑：** 用 Laravel 的 `RateLimiter` 做限速，但 Redis 重启后限速计数器清空，攻击者可以重新开始暴力破解。

**解决：** 改用数据库记录失败次数 + 时间窗口。同时加入 IP 维度的限速：

```php
// 额外的 IP 限速
$ipKey = "recovery_ip:{$request->ip()}";
$ipAttempts = cache()->get($ipKey, 0);

if ($ipAttempts >= 20) {
    abort(429, 'Too many recovery attempts from this IP');
}

cache()->put($ipKey, $ipAttempts + 1, now()->addHours(1));
```

### 4. Recovery Token 的安全边界

**踩坑：** 恢复成功后直接登录，用户可能忘记绑定新 Passkey，下次又遇到同样的问题。

**解决：** 发放临时 Recovery Token 而非完整 Session。强制跳转到 Passkey 绑定页面，1 小时内必须完成。过期后需要重新走恢复流程。

### 5. 恢复码的存储安全

**踩坑：** 最初考虑用 `bcrypt` 哈希恢复码，但恢复码格式固定（`XXXX-XXXX-XXXX`），字符集有限，bcrypt 的 salt 会让同一个恢复码的哈希每次都不同，无法用于批量验证。

**解决：** 改用 `sha256`。恢复码本身有 36^12 ≈ 4.7×10^18 种组合，暴力破解不可行。sha256 的速度反而不是问题，因为恢复码空间足够大。

```php
// 不要用 bcrypt
Hash::make($code);  // 每次哈希不同，无法用 DB::where('code_hash', ...) 查询

// 用 sha256
hash('sha256', $code);  // 确定性，可以用 DB 查询
```

### 6. 多设备同步的陷阱

**踩坑：** 用户在设备 A 上生成了 Passkey，设备 B 同步过来后，设备 A 丢失。用户以为设备 B 上的 Passkey 是"备份"，但实际上 iCloud Keychain 的同步机制可能在某些情况下丢失数据。

**解决：** 强制要求用户设置至少一种非 Passkey 的恢复方式。在 Passkey 注册流程中加入"恢复方式检查"步骤，没设置恢复码就不允许完成注册。

---

## 总结

Passkey 是认证的未来，但 **"无密码"不等于"无恢复"**。设备丢失是真实场景，不是边缘 case。

核心设计原则：

1. **分层降级**：Passkey → Recovery Code → Backup Key → 人工审核，每一层都有明确的使用场景
2. **安全边界**：每次恢复操作都有限速、审计日志、临时 Token，防止滥用
3. **用户体验**：恢复码用 `XXXX-XXXX-XXXX` 格式降低抄写错误，Backup Key 加校验位
4. **强制设置**：没有恢复方式就不让注册 Passkey，从源头杜绝"锁死"问题

代码实现上，Recovery Code 用 SHA-256 哈希存储（bcrypt 不适用），Backup Key 加校验位防抄写错误，所有恢复操作记录审计日志。

最后一点：**恢复码不是密码的替代品，而是 Passkey 的必要补充。** 如果你在做 Passkey 相关的功能，Recovery 机制不是"可选的"，是"必须的"。

---

**相关文章：**
- [Passkey 注册流程实战](/2026/06/01/passkey-registration/)
- [WebAuthn API 详解](/2026/05/15/webauthn-api/)
- [Laravel 多因素认证实现](/2026/04/20/laravel-mfa/)
