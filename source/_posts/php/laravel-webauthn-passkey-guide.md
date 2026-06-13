---
title: Laravel WebAuthn / Passkey 实战：后台无密码登录、设备绑定与挑战过期踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 15:15:59
updated: 2026-05-04 15:17:45
categories:
  - php
tags: [Laravel, 安全, WebAuthn, Passkey, FIDO2, 无密码登录]
keywords: [Laravel WebAuthn, Passkey, 后台无密码登录, 设备绑定与挑战过期踩坑记录, PHP]
description: Laravel 后台 WebAuthn / Passkey 无密码登录完整实战指南：涵盖 FIDO2 设备注册、签名验证、挑战过期处理、多设备绑定管理、signCount 回放防护、会话升级策略及线上踩坑记录，附可运行代码示例与 Passkey vs 传统认证方案对比表。



---

后台系统一旦接入财务、退款、优惠券配置这类高风险能力，账号安全就不能只靠短信和 TOTP。我们后来把管理员登录改成 **Password + Passkey 升级**，再逐步推进到高权限角色的 **Passkey 优先登录**。真正难的不是把浏览器弹窗调起来，而是把挑战、设备、会话、回放防护这几件事在 Laravel 里收严。

这篇只讲我在线上落地时真正会做的部分：**注册一把可用的凭证、登录时验证签名、处理多设备与 challenge 过期、避免 worker/缓存把状态搞乱。**

## 一、为什么我最后选 WebAuthn，而不是继续堆短信验证码

短信方案在后台场景里有三个硬伤：

1. 运维账号常共用值班手机，责任边界不清。
2. 海外漫游、短信延迟会把紧急操作卡死。
3. 短信本质仍是共享秘密，抗钓鱼能力很弱。

WebAuthn 的价值是把认证秘密放进系统钥匙串、安全芯片或硬件密钥里，服务端只保存公钥材料。即使后台登录页被仿冒，没有正确的 `rpId` 也签不出来。

### 认证方案对比一览

| 维度 | 密码 + 短信验证码 | TOTP (Google Authenticator) | WebAuthn / Passkey |
|---|---|---|---|
| 抗钓鱼 | ❌ 弱，用户仍可能输入到假站 | ❌ 弱，TOTP 码可被实时钓鱼 | ✅ 强，签名绑定 rpId + origin |
| 抗中间人 | ❌ 短信可被劫持（SS7/钓鱼） | ❌ 码可被实时转发 | ✅ 签名含 origin，无法中转 |
| 用户体验 | 😐 需记密码 + 等短信 | 😐 需手动输入 6 位码 | ✅ 指纹/面容/设备一键认证 |
| 设备依赖 | 无（短信依赖手机号） | 手机 App（丢失需恢复） | 设备安全芯片/平台认证器 |
| 密码泄露影响 | 🔴 一泄全泄 | 🟡 OTP 可被钓鱼转发 | 🟢 无私钥泄露风险 |
| 恢复难度 | 简单（重置密码） | 中等（备份码） | 需预设备份凭证 |
| FIDO2 合规 | ❌ | ❌ | ✅ |

选择 WebAuthn 的核心理由是 **抗钓鱼**。后台系统一旦暴露登录页面 URL，传统方案的钓鱼风险是 100% 的，而 WebAuthn 在浏览器层面就拦住了。

## 二、落地后的架构图

```text
Admin Browser / Passkey
        |
        | 1. GET /webauthn/challenge
        v
Laravel API  ------------------------------+
  |                                         |
  | 2. challenge 写 Redis / Session         |
  |                                         v
  |<------------------------------ Redis / Session Store
  |
  | 3. POST /webauthn/assertion
  v
WebAuthnVerifier
  |-- 读取 credential 公钥
  |-- 校验 clientDataJSON.origin
  |-- 校验 authenticatorData.rpIdHash
  |-- 校验签名与 signCount
  v
Login Session + Audit Log + Device Registry
```

我最后采用的原则很简单：

- **challenge 放短 TTL 的服务端存储，不放前端本地。**
- **credential 作为设备维度管理，不直接绑死账号唯一登录方式。**
- **签名成功后立刻删除 challenge，避免重放。**

## 三、表结构先别偷懒，设备维度一定要单独建模

很多实现把 passkey 直接塞进 `users.passkey_id`，上线后马上会遇到两个问题：用户换电脑怎么办、同一个管理员用 Mac 和 iPhone 怎么共存。

我最后拆成独立表：

```php
// database/migrations/2026_05_04_000000_create_webauthn_credentials_table.php
Schema::create('webauthn_credentials', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('credential_id', 255)->unique();
    $table->text('public_key');
    $table->unsignedBigInteger('sign_count')->default(0);
    $table->string('transports')->nullable();
    $table->string('aaguid', 64)->nullable();
    $table->string('device_name')->nullable();
    $table->timestamp('last_used_at')->nullable();
    $table->timestamps();
});
```

这里 `sign_count` 非常关键。它不是“展示字段”，而是你识别**凭证复制、回放或设备异常**的重要依据。少了它，签名虽然能过，但风控几乎是瞎的。

## 四、注册 challenge 与 assertion challenge 要分开

我踩过一个很蠢但很真实的坑：前端注册和登录共用一个 `webauthn:challenge:{userId}` key，结果用户刚绑定完设备，马上登录时拿到了旧 challenge，浏览器端报 `InvalidStateError`，后端还很难复现。

所以我直接拆两类 key：

```php
final class WebAuthnChallengeService
{
    public function putRegisterChallenge(int $userId, string $challenge): void
    {
        Cache::put("webauthn:register:{$userId}", $challenge, now()->addMinutes(5));
    }

    public function putLoginChallenge(string $requestId, string $challenge): void
    {
        Cache::put("webauthn:login:{$requestId}", $challenge, now()->addMinutes(3));
    }

    public function pullLoginChallenge(string $requestId): ?string
    {
        $key = "webauthn:login:{$requestId}";
        $value = Cache::get($key);
        Cache::forget($key);

        return $value;
    }
}
```

登录 challenge 我不用 `userId` 做 key，而是用一次性 `requestId`，因为未登录阶段你还不能完全相信“前端声称自己是谁”。

## 五、验证签名时，别只校验 challenge

线上最常见的错误实现，是只比较 challenge 一致，然后凭证 ID 能对上就认为登录成功。真正应该至少校验下面四层：

1. `challenge` 是否匹配且未过期
2. `origin` 是否等于后台域名
3. `rpIdHash` 是否对应你的 `rpId`
4. `signCount` 是否单调递增

控制器里我会把验证入口收口成服务：

```php
public function verify(LoginAssertionRequest $request, WebAuthnVerifier $verifier): JsonResponse
{
    $requestId = $request->string('request_id')->toString();
    $expectedChallenge = $this->challengeService->pullLoginChallenge($requestId);

    abort_if(!$expectedChallenge, 422, 'Challenge expired');

    $credential = WebAuthnCredential::query()
        ->where('credential_id', $request->string('credential_id'))
        ->firstOrFail();

    $result = $verifier->verifyAssertion(
        credential: $credential,
        expectedChallenge: $expectedChallenge,
        clientDataJson: $request->string('client_data_json')->toString(),
        authenticatorData: $request->string('authenticator_data')->toString(),
        signature: $request->string('signature')->toString(),
    );

    abort_unless($result->passed(), 422, $result->message());

    $credential->forceFill([
        'sign_count' => $result->newSignCount(),
        'last_used_at' => now(),
    ])->save();

    Auth::login($credential->user);

    return response()->json(['ok' => true]);
}
```

真正的签名解析我会交给成熟库，例如 `web-auth/webauthn-lib`。原因很现实：自己手写 COSE key、CBOR、ASN.1 解析，出错概率极高，而且你未必养得起这套安全细节。

## 六、会话升级要和后台权限模型一起设计

我没有一上来就强制所有人“只准 Passkey 登录”。实际做法是两阶段：

- 普通管理员：账号密码登录后，敏感操作前二次验证 Passkey
- 财务、风控、超管：登录阶段就要求 Passkey

这样迁移阻力小很多，也能降低首次 rollout 风险。Laravel 里可以直接在中间件判断：

```php
class RequirePasskeyVerified
{
    public function handle($request, Closure $next)
    {
        if (! session('passkey_verified_at')) {
            abort(403, 'Passkey verification required');
        }

        if (now()->diffInMinutes(session('passkey_verified_at')) > 10) {
            session()->forget('passkey_verified_at');
            abort(403, 'Passkey verification expired');
        }

        return $next($request);
    }
}
```

这比“登录成功后整站永远信任”稳得多，尤其适合退款、导出、改价这类动作。

## 七、前端发起断言时，我会强制把 requestId 一起回传

前端如果只把 `credential_id` 和签名材料发回来，后端很难把这次断言和哪一个 challenge 绑定起来。我的做法是后端下发 challenge 时顺便给一个 `request_id`，前端原样带回：

```js
const response = await fetch('/admin/webauthn/challenge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email })
});

const options = await response.json();
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: Uint8Array.from(atob(options.challenge), c => c.charCodeAt(0)),
    rpId: options.rpId,
    allowCredentials: options.allowCredentials.map(item => ({
      ...item,
      id: Uint8Array.from(atob(item.id), c => c.charCodeAt(0)),
    })),
    userVerification: 'required',
    timeout: 60000,
  }
});

await fetch('/admin/webauthn/assertion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    request_id: options.requestId,
    credential_id: btoa(String.fromCharCode(...new Uint8Array(assertion.rawId))),
    client_data_json: btoa(String.fromCharCode(...new Uint8Array(assertion.response.clientDataJSON))),
    authenticator_data: btoa(String.fromCharCode(...new Uint8Array(assertion.response.authenticatorData))),
    signature: btoa(String.fromCharCode(...new Uint8Array(assertion.response.signature))),
  })
});
```

这里我明确要求前后端统一 **Base64URL / Base64 编码约定**。不统一时，最常见症状就是“本机 Safari 可以，Chrome 不行”，排查半天最后只是编码细节不一致。

## 八、我在线上遇到的三个坑

### 坑一：CDN 或代理把后台域名换了，`origin` 校验全部失败

预发环境最常见。浏览器看到的是 `https://admin.example.com`，应用却按内网域名去验，结果所有签名都失败。后来我把可信 origin 显式配置，不再从请求头动态猜。

### 坑二：challenge TTL 过长，用户切页后还能重放

早期为了“提升成功率”把 TTL 设成 10 分钟，结果安全审查时被指出时间窗太大。后来登录 challenge 改 3 分钟，验证成功立即删 key，体验没明显下降，风险却小很多。

### 坑三：多设备解绑没做审计，排障非常痛苦

一开始只有 `delete from webauthn_credentials where id=?`。线上有人反馈“我的钥匙突然失效”，但我们不知道是本人解绑、管理员代操作，还是脚本误删。后来所有绑定/解绑都记审计日志，包含操作者、IP、user agent、credential_id，排查立刻轻松很多。

## 九、补一层恢复机制，否则你会被自己锁在门外

Passkey 做得太“纯”，也会翻车。真实场景里，管理员换手机、公司重装电脑、iCloud 钥匙串同步失败都可能发生。如果没有恢复机制，最后一定会变成人工改库。

我比较稳妥的做法是：

- 每个高权限账号至少绑定两把凭证：主设备 + 备用设备
- 保留受控的恢复流程，例如主管审批后的临时恢复码
- 恢复成功后强制旧会话失效，并要求重新绑定凭证

后台上我会把“删除最后一把凭证”直接拦掉：

```php
public function destroy(WebAuthnCredential $credential): JsonResponse
{
    $user = $credential->user;

    abort_if(
        $user->webauthnCredentials()->count() <= 1,
        422,
        'At least one passkey must remain bound.'
    );

    AuditLog::create([
        'actor_id' => Auth::id(),
        'action' => 'webauthn_credential_deleted',
        'target_user_id' => $user->id,
        'metadata' => [
            'credential_id' => $credential->credential_id,
            'device_name' => $credential->device_name,
            'ip' => request()->ip(),
        ],
    ]);

    $credential->delete();

    return response()->json(['ok' => true]);
}
```

这段逻辑不复杂，但非常值钱。它能把“账户永久锁死”这种低频高危事故，提前拦在管理台上。

## 十一、注册流程完整代码参考

注册（Registration）和登录（Authentication）是两个独立的 WebAuthn 流程，很多人只实现了登录，注册却写得草率。这里给一个可运行的注册端到端参考。

**前端注册（JavaScript）：**

```js
async function registerPasskey(userId, challengeOptions) {
  const publicKeyCredentialCreationOptions = {
    challenge: Uint8Array.from(atob(challengeOptions.challenge), c => c.charCodeAt(0)),
    rp: {
      name: challengeOptions.rpName,
      id: challengeOptions.rpId,
    },
    user: {
      id: Uint8Array.from(atob(challengeOptions.userId), c => c.charCodeAt(0)),
      name: challengeOptions.userName,
      displayName: challengeOptions.displayName,
    },
    pubKeyCredParams: [
      { alg: -7,   type: 'public-key' },  // ES256
      { alg: -257, type: 'public-key' },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',  // 使用设备内置认证器
      userVerification: 'required',
      residentKey: 'preferred',
    },
    timeout: 60000,
    attestation: 'direct',
  };

  const credential = await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  });

  await fetch('/admin/webauthn/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: challengeOptions.requestId,
      credential_id: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
      attestation_object: btoa(String.fromCharCode(...new Uint8Array(credential.response.attestationObject))),
      client_data_json: btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))),
      device_name: navigator.userAgent.includes('Mac') ? 'Mac Safari' : 'Other Device',
    }),
  });
}
```

**后端注册控制器（PHP）：**

```php
public function register(RegisterRequest $request, WebAuthnVerifier $verifier): JsonResponse
{
    $userId = Auth::id();
    $expectedChallenge = $this->challengeService->pullRegisterChallenge($userId);
    abort_if(!$expectedChallenge, 422, 'Registration challenge expired');

    $result = $verifier->verifyAttestation(
        expectedChallenge: $expectedChallenge,
        attestationObject: $request->string('attestation_object')->toString(),
        clientDataJson: $request->string('client_data_json')->toString(),
    );

    abort_unless($result->passed(), 422, $result->message());

    WebAuthnCredential::create([
        'user_id'       => $userId,
        'credential_id' => $result->credentialId(),
        'public_key'    => $result->publicKey(),
        'sign_count'    => 0,
        'transports'    => $request->string('transports')->toString(),
        'aaguid'        => $result->aaguid(),
        'device_name'   => $request->string('device_name', 'Unknown Device'),
    ]);

    AuditLog::create([
        'actor_id' => $userId,
        'action'   => 'webauthn_credential_registered',
        'metadata' => [
            'credential_id' => $result->credentialId(),
            'device_name'   => $request->string('device_name'),
            'ip'            => $request->ip(),
        ],
    ]);

    return response()->json(['ok' => true, 'message' => 'Passkey registered successfully']);
}
```

注意 `pubKeyCredParams` 里同时声明 ES256 和 RS256，是为了兼容不同平台的认证器——iOS/macOS 优先用 ES256，部分 Windows Hello 设备用 RS256。

## 十二、WebAuthn PHP 库选型对比

在 Laravel 里落地 WebAuthn，主要有以下几种技术路线：

| 库/方案 | 维护状态 | 优点 | 缺点 | 适用场景 |
|---|---|---|---|---|
| `web-auth/webauthn-lib` (Spomky-Labs) | ✅ 活跃维护 | 功能最全，支持 attestation + assertion，社区活跃 | 学习曲线较陡，配置项多 | 生产环境首选 |
| `asbiin/laravel-webauthn` | ✅ 维护中 | Laravel 生态集成好，开箱即用 | 定制灵活性稍弱 | 快速接入、中小项目 |
| 自己封装 CBOR/COSE 解析 | ❌ 不推荐 | 完全可控 | 极易出错，安全风险高，维护成本大 | 不推荐生产使用 |
| `Laravel Fortify` + Passkey | ✅ 官方支持 (11.x+) | 与 Jetstream 深度集成 | 仅支持完整认证流程，定制二次验证较难 | 新项目快速搭建 |

我个人倾向于 `web-auth/webauthn-lib` 作为底层库，再自己封装一层 Laravel Service。原因有二：一是后台权限系统往往有大量定制逻辑，开箱即用的包反而会碍手；二是出了安全问题时，你需要能快速定位到底是哪层校验没过。

## 十三、我的最终结论

WebAuthn / Passkey 在 Laravel 里并不难接，难的是把它当成**认证系统**而不是“前端弹一次系统框”。真正决定它是否能上线的，是这五件事：**设备建模、challenge 生命周期、origin/rpId 校验、signCount 更新、审计闭环**。

如果你的后台已经有高风险操作，我很建议从"敏感动作二次验证"开始，而不是一次性全站替换密码登录。这样既能尽快拿到安全收益，也更容易把浏览器兼容性、设备迁移和运营流程一点点补齐。

## 相关阅读

- [OWASP Top 10 安全漏洞实战指南：SQL 注入、XSS、CSRF、SSRF 详解](/post/owasp-top-10-guide-sql-xss-csrf-ssrf/) — 理解 Web 应用常见攻击面，WebAuthn 能有效防御其中的钓鱼与凭证泄露类攻击
- [Laravel Sanctum 与 Passport Token 认证全指南：并发、刷新与选型](/post/laravel-sanctum-passport-token-guide-token-concurrency/) — API Token 认证方案对比，适合需要同时支持 Web 登录与 API 认证的项目
- [Firebase JWT vs Token：Laravel Passport、Sanctum 深度对比](/post/firebase-jwt-vs-token-laravel-passport-sanctum-vs/) — JWT 与 Session Token 选型分析，理解不同认证策略的适用场景