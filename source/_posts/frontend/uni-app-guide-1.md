---

cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
title: uni-app 微信小程序实战：登录、支付、分享完整流程
date: 2026-05-17 06:05:13
updated: 2026-05-17 06:09:37
categories:
  - frontend
keywords: [uni, app, 微信小程序实战, 登录, 支付, 分享完整流程]
tags:
- uni-app
- Vue
- 微信小程序
- Laravel
- 支付
- 前端
description: 基于 KKday B2C 电商项目的真实经验，完整拆解 uni-app 微信小程序的登录、支付、分享三大核心流程。涵盖 wx.login → code2session → 自定义登录态 → 微信支付 v3 → 分享卡片的全链路实现，附带 Vue 3 + Laravel 后端代码、架构图、以及 10+ 真实踩坑记录。
---




# uni-app 微信小程序实战：登录、支付、分享完整流程

## 前言

在 B2C 电商项目中，微信小程序是最常见的获客渠道之一。但微信小程序的登录、支付、分享三大流程，涉及**前端 SDK、后端 API、微信开放平台、商户平台**四方协作，任何一环出错都会导致用户流失。

本文基于 KKday B2C 电商项目的真实经验，完整拆解 uni-app 微信小程序中的三大核心流程，附带 Vue 3 + Laravel 后端代码和踩坑记录。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    用户设备 (微信小程序)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐           │
│  │ wx.login │  │ wx.pay   │  │ wx.share     │           │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘           │
│       │             │               │                    │
│  ┌────▼─────────────▼───────────────▼──────┐             │
│  │         uni-app (Vue 3 + Pinia)         │             │
│  └──────────────────┬──────────────────────┘             │
└─────────────────────┼───────────────────────────────────┘
                      │ HTTPS
┌─────────────────────┼───────────────────────────────────┐
│              Laravel B2C API Server                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ AuthController│  │PaymentCtrl  │  │ShareCtrl     │   │
│  │  code2session │  │ wxpay v3    │  │ share config │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │           │
│  ┌──────▼─────────────────▼──────────────────▼───────┐   │
│  │              Service Layer                         │   │
│  │  WechatAuthService / WechatPayService / ShareSvc   │   │
│  └──────────────────────┬────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│              微信服务器                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │sns/jscode│  │  Pay API v3  │  │  Link API    │       │
│  │  2session│  │  统一下单     │  │  Short Link  │       │
│  └──────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────┘
```

---

## 一、微信登录：从 wx.login 到自定义登录态

### 1.1 登录流程时序

```
用户 ──→ 小程序(前端) ──→ Laravel API ──→ 微信服务器
 │         │                  │                │
 │  1.打开小程序              │                │
 │         │──2.wx.login()──→│                │
 │         │  获取 code       │                │
 │         │──3.发送 code ──→│                │
 │         │                  │──4.code2session→│
 │         │                  │←─session_key+openid─│
 │         │                  │                │
 │         │                  │  5.生成自定义token│
 │         │←──6.返回 token──│                │
 │         │                  │                │
 │  7.存储token,后续请求携带   │                │
```

### 1.2 前端实现（uni-app + Vue 3）

```typescript
// composables/useWechatLogin.ts
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'

interface LoginResult {
  token: string
  user: {
    id: number
    nickname: string
    avatar: string
    openid: string
  }
}

export function useWechatLogin() {
  const loading = ref(false)
  const userStore = useUserStore()

  const login = async (): Promise<LoginResult | null> => {
    loading.value = true
    try {
      // Step 1: 调用 wx.login 获取 code
      const { code } = await new Promise<UniApp.LoginRes>((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: resolve,
          fail: reject,
        })
      })

      if (!code) {
        throw new Error('wx.login 获取 code 失败')
      }

      // Step 2: 将 code 发送到后端
      const { data } = await uni.request({
        url: `${import.meta.env.VITE_API_BASE}/api/wechat/login`,
        method: 'POST',
        data: { code },
      })

      if (data.code !== 0) {
        throw new Error(data.message || '登录失败')
      }

      const result = data.data as LoginResult

      // Step 3: 存储 token
      userStore.setToken(result.token)
      userStore.setUser(result.user)

      // Step 4: 更新 uni.request 的默认 header
      uni.$emit('login-success', result)

      return result
    } catch (error) {
      console.error('[WeChatLogin]', error)
      uni.showToast({ title: '登录失败，请重试', icon: 'none' })
      return null
    } finally {
      loading.value = false
    }
  }

  // 静默登录：App onLaunch 时调用
  const silentLogin = async (): Promise<boolean> => {
    const token = userStore.token
    if (!token) return false

    try {
      // 验证 token 是否仍然有效
      const { data } = await uni.request({
        url: `${import.meta.env.VITE_API_BASE}/api/user/profile`,
        method: 'GET',
        header: { Authorization: `Bearer ${token}` },
      })
      return data.code === 0
    } catch {
      userStore.clearAuth()
      return false
    }
  }

  return { login, silentLogin, loading }
}
```

```typescript
// stores/user.ts (Pinia)
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(uni.getStorageSync('auth_token') || '')
  const userInfo = ref<any>(uni.getStorageSync('user_info') || null)

  const isLoggedIn = computed(() => !!token.value)

  const setToken = (newToken: string) => {
    token.value = newToken
    uni.setStorageSync('auth_token', newToken)
  }

  const setUser = (user: any) => {
    userInfo.value = user
    uni.setStorageSync('user_info', JSON.stringify(user))
  }

  const clearAuth = () => {
    token.value = ''
    userInfo.value = null
    uni.removeStorageSync('auth_token')
    uni.removeStorageSync('user_info')
  }

  return { token, userInfo, isLoggedIn, setToken, setUser, clearAuth }
})
```

### 1.3 后端实现（Laravel）

```php
// app/Http/Controllers/Api/WechatAuthController.php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Wechat\WechatAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WechatAuthController extends Controller
{
    public function __construct(
        private readonly WechatAuthService $authService
    ) {}

    /**
     * 微信小程序登录
     * POST /api/wechat/login
     */
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'code' => 'required|string|size:32',
        ]);

        try {
            $result = $thisauthService->loginByCode($request->input('code'));

            return response()->json([
                'code'    => 0,
                'message' => 'ok',
                'data'    => $result,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'code'    => 500,
                'message' => '微信登录失败: ' . $e->getMessage(),
            ], 500);
        }
    }
}
```

```php
// app/Services/Wechat/WechatAuthService.php
namespace App\Services\Wechat;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WechatAuthService
{
    private string $appId;
    private string $appSecret;

    public function __construct()
    {
        $this->appId     = config('services.wechat.mini_app_id');
        $this->appSecret = config('services.wechat.mini_app_secret');
    }

    /**
     * 通过 code 登录：调用微信 code2session 接口
     */
    public function loginByCode(string $code): array
    {
        // Step 1: 调用微信 code2session
        $sessionData = $this->code2session($code);

        $openid  = $sessionData['openid'];
        $unionid = $sessionData['unionid'] ?? null;
        $sessionKey = $sessionData['session_key'];

        // Step 2: 查找或创建用户
        $user = $this->findOrCreateUser($openid, $unionid);

        // Step 3: 缓存 session_key（用于后续数据解密）
        Cache::put(
            "wechat:session_key:{$user->id}",
            $sessionKey,
            now()->addDays(7)
        );

        // Step 4: 生成自定义登录态 (Sanctum token)
        $token = $user->createToken('wechat-mini-app')->plainTextToken;

        return [
            'token' => $token,
            'user'  => [
                'id'       => $user->id,
                'nickname' => $user->nickname,
                'avatar'   => $user->avatar,
                'openid'   => $openid,
            ],
        ];
    }

    /**
     * 调用微信 code2session 接口
     */
    private function code2session(string $code): array
    {
        $url = 'https://api.weixin.qq.com/sns/jscode2session';

        $response = Http::timeout(5)->get($url, [
            'appid'      => $this->appId,
            'secret'     => $this->appSecret,
            'js_code'    => $code,
            'grant_type' => 'authorization_code',
        ]);

        $data = $response->json();

        Log::info('WechatAuthService.code2session', [
            'code'  => $code,
            'resp'  => $data,
        ]);

        if (isset($data['errcode']) && $data['errcode'] !== 0) {
            throw new \RuntimeException(
                "微信 code2session 失败: [{$data['errcode']}] {$data['errmsg']}"
            );
        }

        if (empty($data['openid'])) {
            throw new \RuntimeException('微信返回数据异常: 缺少 openid');
        }

        return $data;
    }

    /**
     * 查找或创建微信用户
     */
    private function findOrCreateUser(string $openid, ?string $unionid): User
    {
        return User::firstOrCreate(
            ['wechat_openid' => $openid],
            [
                'wechat_unionid' => $unionid,
                'nickname'       => '微信用户_' . substr($openid, -6),
                'avatar'         => '',
                'status'         => 'active',
            ]
        );
    }
}
```

### 1.4 🔥 踩坑记录

**坑 1：session_key 有效期问题**

> 微信的 `session_key` 有效期由微信决定（通常 2-3 天），但不会提前告知。如果前端长期不调用 `wx.login`，`session_key` 可能失效，导致 `wx.getUserProfile` 等接口报错。

**解决方案**：在 `App.onShow` 中每次都重新调用 `wx.login` 获取新 code，发送到后端刷新 session_key。

```typescript
// App.vue
onShow(() => {
  // 每次小程序前台展示时刷新 session_key
  if (userStore.isLoggedIn) {
    uni.login({
      provider: 'weixin',
      success: ({ code }) => {
        uni.request({
          url: `${API_BASE}/api/wechat/refresh-session`,
          method: 'POST',
          header: { Authorization: `Bearer ${userStore.token}` },
          data: { code },
        })
      },
    })
  }
})
```

**坑 2：code 只能用一次**

> 同一个 code 重复调用 `code2session` 会返回 `code been used` 错误码 40163。在弱网环境下，前端可能超时重试发送同一个 code。

**解决方案**：前端确保 wx.login 后立即发送 code，失败时重新调用 wx.login 获取新 code，而不是重试旧 code。

**坑 3：unionid 获取条件**

> `unionid` 只有在微信开放平台绑定了小程序后才会返回。如果后端用 `unionid` 做用户唯一标识，但小程序未绑定开放平台，所有用户的 `unionid` 都是 null，导致用户数据混乱。

**解决方案**：优先使用 `openid` 做小程序内用户唯一标识，`unionid` 仅作为跨平台关联的辅助字段。

---

## 二、微信支付：统一下单到回调处理

### 2.1 支付流程时序

```
用户 ──→ 小程序 ──→ Laravel ──→ 微信支付
 │        │           │            │
 │  1.点击支付         │            │
 │        │──2.创建订单→│            │
 │        │           │──3.统一下单→│
 │        │           │←─prepay_id─│
 │        │←4.支付参数──│            │
 │        │            │            │
 │  5.wx.requestPayment│            │
 │        │──→ 微信支付弹窗 ←──────│
 │        │            │            │
 │  6.用户确认支付      │            │
 │        │            │←──7.异步通知│
 │        │            │──8.验证签名→│
 │        │            │──9.更新订单 │
 │        │←─10.支付结果─│            │
```

### 2.2 后端：微信支付 v3 统一下单

```php
// app/Services/Wechat/WechatPayService.php
namespace App\Services\Wechat;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WechatPayService
{
    private string $mchId;
    private string $appId;
    private string $apiV3Key;
    private string $serialNo;
    private string $privateKeyPath;

    public function __construct()
    {
        $this->mchId          = config('services.wechat-pay.mch_id');
        $this->appId          = config('services.wechat.mini_app_id');
        $this->apiV3Key       = config('services.wechat-pay.api_v3_key');
        $this->serialNo       = config('services.wechat-pay.serial_no');
        $this->privateKeyPath = config('services.wechat-pay.private_key_path');
    }

    /**
     * JSAPI 统一下单（小程序支付）
     */
    public function createJsapiOrder(array $params): array
    {
        $url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi';

        $body = [
            'appid'        => $this->appId,
            'mchid'        => $this->mchId,
            'description'  => $params['description'],
            'out_trade_no' => $params['order_no'],
            'notify_url'   => $params['notify_url'],
            'amount'       => [
                'total'    => $params['amount'],  // 单位：分
                'currency' => 'CNY',
            ],
            'payer'        => [
                'openid' => $params['openid'],
            ],
        ];

        // 生成签名并请求
        $token = $this->generateAuthorizationToken('POST', $url, json_encode($body));

        $response = Http::withHeaders([
            'Authorization' => $token,
            'Content-Type'  => 'application/json',
        ])->timeout(10)->post($url, $body);

        $data = $response->json();

        Log::info('WechatPayService.createJsapiOrder', [
            'order_no' => $params['order_no'],
            'response' => $data,
        ]);

        if ($response->failed()) {
            throw new \RuntimeException(
                "微信统一下单失败: {$data['message'] ?? 'unknown error'}"
            );
        }

        // 生成前端调用 wx.requestPayment 所需的参数
        return $this->buildPaymentParams($data['prepay_id']);
    }

    /**
     * 生成前端支付参数（带签名）
     */
    private function buildPaymentParams(string $prepayId): array
    {
        $timestamp = (string) time();
        $nonceStr  = $this->generateNonceStr();
        $package   = "prepay_id={$prepayId}";

        // 签名串: appid\nnonceStr\npackage\ntimestamp\n
        $signStr = "{$this->appId}\n{$nonceStr}\n{$package}\n{$timestamp}\n";
        $signature = $this->rsaSign($signStr);

        return [
            'timeStamp' => $timestamp,
            'nonceStr'  => $nonceStr,
            'package'   => $package,
            'signType'  => 'RSA',
            'paySign'   => $signature,
        ];
    }

    /**
     * RSA-SHA256 签名（微信支付 v3）
     */
    private function rsaSign(string $data): string
    {
        $privateKey = file_get_contents($this->privateKeyPath);
        $key = openssl_pkey_get_private($privateKey);

        if (!$key) {
            throw new \RuntimeException('无法读取微信支付私钥');
        }

        openssl_sign($data, $signature, $key, OPENSSL_ALGO_SHA256);

        return base64_encode($signature);
    }

    /**
     * 生成 Authorization Header
     */
    private function generateAuthorizationToken(string $method, string $url, string $body): string
    {
        $timestamp = (string) time();
        $nonceStr  = $this->generateNonceStr();
        $urlParts  = parse_url($url);
        $signUrl   = $urlParts['path'] . ($urlParts['query'] ?? '' ? '?' . $urlParts['query'] : '');

        $signStr = "{$method}\n{$signUrl}\n{$timestamp}\n{$nonceStr}\n{$body}\n";
        $signature = $this->rsaSign($signStr);

        return sprintf(
            'WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",timestamp="%s",serial_no="%s",signature="%s"',
            $this->mchId,
            $nonceStr,
            $timestamp,
            $this->serialNo,
            $signature
        );
    }

    private function generateNonceStr(int $length = 32): string
    {
        return bin2hex(random_bytes($length / 2));
    }
}
```

### 2.3 前端：调起支付

```typescript
// composables/useWechatPay.ts
export function useWechatPay() {
  const payLoading = ref(false)

  const requestPayment = async (orderNo: string): Promise<boolean> => {
    payLoading.value = true
    try {
      // Step 1: 请求后端创建预支付单
      const { data } = await uni.request({
        url: `${API_BASE}/api/payment/wechat/create`,
        method: 'POST',
        header: { Authorization: `Bearer ${useUserStore().token}` },
        data: { order_no: orderNo },
      })

      if (data.code !== 0) {
        throw new Error(data.message)
      }

      const payParams = data.data

      // Step 2: 调起微信支付
      await new Promise<void>((resolve, reject) => {
        uni.requestPayment({
          provider: 'weixin',
          timeStamp: payParams.timeStamp,
          nonceStr: payParams.nonceStr,
          package: payParams.package,
          signType: payParams.signType as 'RSA',
          paySign: payParams.paySign,
          success: () => resolve(),
          fail: (err) => {
            // 用户取消 vs 系统错误
            if (err.errMsg?.includes('cancel')) {
              reject(new Error('USER_CANCEL'))
            } else {
              reject(new Error(err.errMsg || '支付失败'))
            }
          },
        })
      })

      uni.showToast({ title: '支付成功', icon: 'success' })
      return true
    } catch (error: any) {
      if (error.message === 'USER_CANCEL') {
        uni.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        uni.showToast({ title: error.message || '支付失败', icon: 'none' })
      }
      return false
    } finally {
      payLoading.value = false
    }
  }

  return { requestPayment, payLoading }
}
```

### 2.4 后端：支付回调处理

```php
// app/Http/Controllers/Api/WechatPayController.php
public function notify(Request $request): JsonResponse
{
    // Step 1: 验证签名
    $notification = $this->payService->decryptNotification($request->all());

    if (!$notification) {
        return response()->json(['code' => 'FAIL', 'message' => '签名验证失败'], 400);
    }

    // Step 2: 幂等处理（防止重复回调）
    $orderNo = $notification['out_trade_no'];

    DB::transaction(function () use ($orderNo, $notification) {
        $order = Order::where('order_no', $orderNo)
            ->lockForUpdate()
            ->first();

        if (!$order) {
            Log::warning('PayNotify: 订单不存在', ['order_no' => $orderNo]);
            return;
        }

        // 已支付则跳过（幂等）
        if ($order->status === Order::STATUS_PAID) {
            Log::info('PayNotify: 订单已支付，跳过', ['order_no' => $orderNo]);
            return;
        }

        // Step 3: 更新订单状态
        $order->update([
            'status'       => Order::STATUS_PAID,
            'paid_at'      => now(),
            'transaction_id' => $notification['transaction_id'],
        ]);

        // Step 4: 触发后续业务（队列异步处理）
        OrderPaid::dispatch($order);
    });

    // 必须返回 200 + 特定格式，否则微信会重复通知
    return response()->json(['code' => 'SUCCESS', 'message' => 'OK']);
}
```

### 2.5 🔥 踩坑记录

**坑 1：支付金额单位是分**

> 微信支付 v3 的金额单位是**分**，不是元。如果传了 `10.50`（元），实际扣款 0.1 元。这在商品价格有小数时特别容易出错。

```php
// ❌ 错误：直接传元
'amount' => ['total' => 10.50]

// ✅ 正确：转为分，取整
'amount' => ['total' => (int) round(10.50 * 100)]  // 1050 分 = 10.50 元
```

**坑 2：回调被重复触发**

> 微信支付回调可能被触发多次（网络超时、微信重试等）。如果不对订单状态做幂等判断，可能导致库存重复扣减、积分重复发放等严重问题。

**解决方案**：使用数据库行锁 `lockForUpdate()` + 状态判断，确保同一订单只处理一次。

**坑 3：v3 回调解密**

> 微信支付 v3 的回调 body 是加密的 AES-256-GCM 密文，需要使用 APIv3 密钥解密。直接解析 JSON 会得到乱码。

```php
// app/Services/Wechat/WechatPayService.php
public function decryptNotification(array $notification): ?array
{
    try {
        $resource = $notification['resource'];

        $ciphertext   = base64_decode($resource['ciphertext']);
        $nonce        = $resource['nonce'];
        $associatedData = $resource['associated_data'] ?? '';

        // AES-256-GCM 解密
        $plaintext = openssl_decrypt(
            substr($ciphertext, 0, -16),  // 去掉 tag
            'aes-256-gcm',
            $this->apiV3Key,
            OPENSSL_RAW_DATA,
            $nonce,
            substr($ciphertext, -16),     // tag
            $associatedData
        );

        if ($plaintext === false) {
            Log::error('PayNotify: 解密失败');
            return null;
        }

        return json_decode($plaintext, true);
    } catch (\Throwable $e) {
        Log::error('PayNotify: 解密异常', ['error' => $e->getMessage()]);
        return null;
    }
}
```

**坑 4：用户取消支付不等于支付失败**

> `uni.requestPayment` 的 fail 回调中，`errMsg` 包含 `cancel` 表示用户主动取消，不包含则可能是系统错误。需要区分处理，不要对用户取消弹"支付失败"。

---

## 三、微信分享：分享卡片与短链

### 3.1 分享架构

```
┌─────────────────────────────────────┐
│          小程序页面                   │
│  ┌───────────────────────────────┐  │
│  │  <button open-type="share">  │  │
│  │  或 onShareAppMessage()      │  │
│  └───────────┬───────────────────┘  │
│              │                      │
│  ┌───────────▼───────────────────┐  │
│  │  返回分享卡片配置              │  │
│  │  title / imageUrl / path      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
            │ 分享给好友/朋友圈
            ▼
┌─────────────────────────────────────┐
│  好友点击分享卡片 → 打开小程序       │
│  path 带参数 (商品ID, 分享者ID等)    │
│  → 追踪分享来源，关联推荐关系        │
└─────────────────────────────────────┘
```

### 3.2 前端实现

```typescript
// pages/product/detail.vue
// 分享给好友
onShareAppMessage(() => {
  const product = currentProduct.value
  return {
    title: product.name,
    path: `/pages/product/detail?id=${product.id}&share_user=${userStore.userInfo?.id}`,
    imageUrl: product.coverImage,
  }
})

// 分享到朋友圈（小程序 2.11.3+）
onShareTimeline(() => {
  const product = currentProduct.value
  return {
    title: product.name,
    query: `id=${product.id}&share_user=${userStore.userInfo?.id}`,
    imageUrl: product.coverImage,
  }
})
```

```vue
<!-- 使用按钮触发分享 -->
<template>
  <button
    class="share-btn"
    open-type="share"
    @click="trackShare('button')"
  >
    <text class="icon-share">🔗</text>
    分享给好友
  </button>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'

// 接收分享参数
onLoad((options) => {
  if (options.share_user) {
    // 记录分享来源（用于推荐关系追踪）
    trackReferral(options.share_user, options.id)
  }
})

const trackReferral = async (shareUserId: string, productId: string) => {
  await uni.request({
    url: `${API_BASE}/api/referral/track`,
    method: 'POST',
    header: { Authorization: `Bearer ${useUserStore().token}` },
    data: {
      share_user_id: shareUserId,
      product_id: productId,
      channel: 'wechat_mini_share',
    },
  })
}
</script>
```

### 3.3 生成小程序短链（用于外部渠道分享）

```php
// app/Services/Wechat/WechatShortLinkService.php
class WechatShortLinkService
{
    /**
     * 生成小程序短链（用于短信、邮件等外部渠道）
     */
    public function generateShortLink(string $path, string $title): string
    {
        $url = 'https://api.weixin.qq.com/wxa/genweapplink';

        $response = Http::withToken($this->getAccessToken())
            ->post($url, [
                'page_url'    => $path,  // 小程序页面路径
                'page_title'  => $title,
                'is_expire'   => true,
                'expire_type' => 1,      // 1=间隔失效
                'expire_interval' => 30, // 30天失效
            ]);

        $data = $response->json();

        if (isset($data['errcode']) && $data['errcode'] !== 0) {
            throw new \RuntimeException("生成短链失败: {$data['errmsg']}");
        }

        return $data['url'];  // https://wxaurl.cn/xxxx
    }
}
```

### 3.4 🔥 踩坑记录

**坑 1：imageUrl 必须是本地或已下载的临时文件**

> `onShareAppMessage` 中的 `imageUrl` 如果是网络图片 URL，在部分机型上不会显示缩略图。需要先用 `uni.downloadFile` 下载到本地再使用。

**坑 2：分享 path 中的参数长度限制**

> 微信对分享 path 的参数长度有限制（总长度不超过 1024 字符）。如果需要携带复杂数据（如商品规格），建议用短 ID + 后端查询，而不是把所有数据序列化到 URL。

**坑 3：朋友圈分享没有回调**

> `onShareTimeline` 没有成功/失败回调，无法确认用户是否真正分享了。不要依赖这个回调做业务逻辑（如"分享后领券"），应改为用户点击按钮时就给予奖励。

---

## 四、完整项目配置清单

### 4.1 微信小程序后台配置

```
✅ 开发管理 → 开发设置 → 服务器域名
   - request 合法域名: https://api.your-domain.com
   - socket 合法域名: wss://api.your-domain.com
   - uploadFile 合法域名: https://api.your-domain.com
   - downloadFile 合法域名: https://cdn.your-domain.com

✅ 开发管理 → 开发设置 → 接口设置
   - 获取用户信息: 已开通（如需头像昵称）

✅ 微信支付 → 商户号绑定
   - 绑定小程序 AppID 与商户号 MchID

✅ 微信支付 → API 安全
   - APIv3 密钥已设置
   - 证书已下载（apiclient_key.pem）
```

### 4.2 Laravel 环境变量

```env
# .env
WECHAT_MINI_APP_ID=wx1234567890abcdef
WECHAT_MINI_APP_SECRET=your_app_secret

WECHAT_PAY_MCH_ID=1234567890
WECHAT_PAY_API_V3_KEY=your_api_v3_key_32_chars
WECHAT_PAY_SERIAL_NO=your_certificate_serial_number
WECHAT_PAY_PRIVATE_KEY_PATH=/path/to/apiclient_key.pem
WECHAT_PAY_NOTIFY_URL=https://api.your-domain.com/api/payment/wechat/notify
```

### 4.3 请求封装（统一拦截器）

```typescript
// utils/request.ts
const requestInterceptor = (config: UniApp.RequestOptions) => {
  const token = useUserStore().token
  if (token) {
    config.header = {
      ...config.header,
      Authorization: `Bearer ${token}`,
    }
  }
  return config
}

const responseInterceptor = (response: UniApp.RequestSuccessCallbackResult) => {
  // token 过期 → 自动重新登录
  if (response.statusCode === 401) {
    useUserStore().clearAuth()
    useWechatLogin().login()
    return Promise.reject(new Error('TOKEN_EXPIRED'))
  }
  return response
}

// 注册拦截器
uni.addInterceptor('request', {
  request: requestInterceptor,
  response: responseInterceptor,
})
```

---

## 总结

| 流程 | 核心要点 | 最大坑点 |
|------|---------|----------|
| **登录** | wx.login → code2session → Sanctum token | session_key 过期无感知 |
| **支付** | 统一下单 v3 → wx.requestPayment → 异步回调 | 金额单位是分、回调幂等 |
| **分享** | onShareAppMessage + 短链 | imageUrl 本地化、朋友圈无回调 |

微信小程序的登录/支付/分享看似标准流程，但每个环节都有**微信特有的限制和边界条件**。建议在项目初期就搭建好完整的认证链路，避免后期返工。

---

## 相关阅读

- [uni-app + Vue 3 + Vite 现代跨平台开发工作流实战踩坑记录](/categories/Frontend/uni-app-vue3-vite/)
- [uni-app 多端适配实战：H5/微信小程序/App 一套代码搞定踩坑记录](/categories/Frontend/uni-app-guide-h5-app/)
- [uni-app 条件编译实战：平台差异处理与适配策略踩坑记录](/categories/Frontend/uni-app-guide/)

---

*本文基于 KKday B2C 电商项目实战经验整理，涉及的代码已做脱敏处理。如有疑问欢迎留言交流。*
