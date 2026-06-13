---
title: Supabase 实战：开源 Firebase 替代——实时数据库、Auth、Edge Functions 与 Laravel B2C 集成
date: 2026-06-03 10:00:00
tags: [Supabase, Firebase, PostgreSQL, Realtime, Auth, Laravel]
keywords: [Supabase, Firebase, Auth, Edge Functions, Laravel B2C, 开源, 替代, 实时数据库, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "Supabase 实战指南：基于 PostgreSQL 的开源 Firebase 替代方案，深入讲解实时数据库、Auth 认证、Edge Functions、Row Level Security 安全策略，并通过 supabase-php SDK 与 Laravel 集成实现 B2C 电商订单系统，附 Firebase 迁移策略、7 大踩坑记录与成本对比分析。"
---


# Supabase 实战：开源 Firebase 替代——实时数据库、Auth、Edge Functions 与 Laravel B2C 集成

> **TL;DR**：Supabase 是基于 PostgreSQL 的开源 BaaS 平台，提供实时数据库、身份认证、对象存储和 Edge Functions，可完全替代 Firebase。本文从架构原理出发，深入讲解 Supabase 的五大核心模块，展示如何通过 supabase-php SDK 与 Laravel 集成实现 B2C 电商场景，涵盖实时订单状态推送、Row Level Security 安全策略、Edge Functions Webhook 处理、文件上传等实战内容，并附带从 Firebase 迁移的完整策略、踩坑记录和成本对比分析。

---

## 一、为什么需要 Firebase 的替代方案？

Firebase 是 Google 提供的 BaaS（Backend as a Service）平台，凭借开箱即用的实时数据库、认证和云函数，成为众多创业团队和独立开发者的首选。然而，随着项目规模增长，Firebase 的局限性逐渐暴露：

1. **供应商锁定**：数据存储在 Google 基础设施中，迁移成本极高
2. **查询能力受限**：Firestore 的查询不支持复杂的 JOIN 和聚合操作
3. **定价不透明**：按读写次数计费，流量突增时账单可能失控
4. **不开源**：无法自托管，无法审计底层代码
5. **关系型数据建模困难**：文档型数据库不适合强关联的业务模型

Supabase 的口号是 **"The open source Firebase alternative"**，它将 PostgreSQL 的强大关系型能力与 Firebase 式的开发者体验结合，提供了五个核心模块。

---

## 二、Supabase 架构全景

Supabase 并非从零构建，而是将一系列优秀的开源项目组合成一个完整的平台：

```
┌─────────────────────────────────────────────────┐
│                  Supabase Platform               │
├──────────┬──────────┬──────────┬────────┬────────┤
│ Database │  Auth    │ Realtime │ Storage│  Edge  │
│(Postgres)|(GoTrue)  │(Postgres │(S3兼容)│Functions│
│          │          │  Logical │        │(Deno)  │
│          │          │  Replic.)│        │        │
├──────────┴──────────┴──────────┴────────┴────────┤
│            PostgreSQL 15+ (核心引擎)              │
├─────────────────────────────────────────────────┤
│          pgvector · pg_cron · pg_net · PostGIS    │
└─────────────────────────────────────────────────┘
```

每个模块对应的开源项目：

| 模块 | 开源项目 | 功能 |
|------|---------|------|
| Database | PostgreSQL | 关系型数据库，支持 JSON、全文搜索、向量检索 |
| Auth | GoTrue | 基于 JWT 的认证，支持邮箱/密码、OAuth、Magic Link |
| Realtime | Postgres Changes | 基于 PostgreSQL Logical Replication 的实时推送 |
| Storage | supabase/storage | 兼容 S3 的对象存储，配合 Postgres 做权限控制 |
| Edge Functions | Deno Runtime | 基于 Deno 的 Serverless Functions，部署在边缘节点 |

---

## 三、Supabase vs Firebase：技术对比

| 特性 | Supabase | Firebase |
|------|----------|----------|
| **数据库类型** | PostgreSQL（关系型） | Firestore/RTDB（文档型） |
| **查询能力** | 完整 SQL，支持 JOIN、CTE、窗口函数 | 有限查询，不支持 JOIN |
| **实时更新** | 基于 WAL 的变更流 | 基于 SDK 的监听器 |
| **认证** | GoTrue（OAuth 2.0） | Firebase Auth |
| **存储** | S3 兼容 + RLS 权限 | Cloud Storage + Security Rules |
| **云函数** | Edge Functions（Deno） | Cloud Functions（Node.js） |
| **开源** | ✅ 全部开源，可自托管 | ❌ 闭源 |
| **定价** | 按项目计费，可预测 | 按操作计费，难预测 |
| **供应商锁定** | 低（标准 PostgreSQL） | 高 |

---

## 四、实战：Laravel B2C 电商集成

### 4.1 项目初始化

首先通过 Composer 安装 Supabase PHP SDK：

```bash
composer require supabase/supabase-php
```

在 Laravel 项目的 `.env` 中配置 Supabase 凭据：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...  # anon key
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...  # service_role key
```

创建 Supabase 服务提供者：

```php
<?php
// app/Providers/SupabaseServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Supabase\SupabaseClient;

class SupabaseServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SupabaseClient::class, function () {
            return new SupabaseClient(
                config('services.supabase.url'),
                config('services.supabase.key'),
                [
                    'autoRefreshToken' => true,
                    'persistSession' => true,
                ]
            );
        });
    }
}
```

配置文件：

```php
<?php
// config/services.php (添加 supabase 部分)

return [
    // ...其他配置
    'supabase' => [
        'url' => env('SUPABASE_URL'),
        'key' => env('SUPABASE_KEY'),
        'service_key' => env('SUPABASE_SERVICE_KEY'),
    ],
];
```

### 4.2 数据库 Schema 设计

在 Supabase Dashboard 的 SQL Editor 中执行以下 DDL：

```sql
-- 订单表
CREATE TABLE public.orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    order_no VARCHAR(32) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')),
    total_amount DECIMAL(10, 2) NOT NULL,
    shipping_address JSONB NOT NULL,
    items JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 订单状态变更日志
CREATE TABLE public.order_status_logs (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.orders(id),
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 创建索引
CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX idx_order_status_logs_order_id ON public.order_status_logs(order_id);

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.3 Row Level Security（RLS）策略

RLS 是 Supabase 最强大的安全特性之一。它在数据库层面实现行级访问控制，无需在应用层编写过滤逻辑。

```sql
-- 启用 RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_logs ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的订单
CREATE POLICY "Users can view own orders"
    ON public.orders FOR SELECT
    USING (auth.uid() = user_id);

-- 用户只能创建自己的订单
CREATE POLICY "Users can create own orders"
    ON public.orders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己订单的收货地址（在 pending 状态下）
CREATE POLICY "Users can update own pending orders"
    ON public.orders FOR UPDATE
    USING (auth.uid() = user_id AND status = 'pending')
    WITH CHECK (auth.uid() = user_id);

-- 管理员可以通过 JWT claim 访问所有订单
CREATE POLICY "Admins can access all orders"
    ON public.orders FOR ALL
    USING (
        (auth.jwt() ->> 'role')::text = 'admin'
    );

-- 状态日志：用户可读自己订单的日志
CREATE POLICY "Users can view own order logs"
    ON public.order_status_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_status_logs.order_id
            AND orders.user_id = auth.uid()
        )
    );
```

**踩坑记录 #1：RLS 默认拒绝所有**

> 启用 RLS 后，如果没有匹配的 POLICY，所有查询返回空结果集，而不是报错。调试时常常困惑"为什么查不到数据"。**务必在启用 RLS 后立即创建策略**。另外，`service_role` key 可以绕过 RLS，适合后端管理操作，但绝不能暴露给前端。

**踩坑记录 #2：RLS 性能优化**

> 当表数据量大时，关联子查询的 RLS 策略会导致性能下降。建议在 RLS 策略中使用的列上创建索引，例如 `orders.user_id`。可以使用 `EXPLAIN ANALYZE` 验证 RLS 查询计划。

### 4.4 Laravel 中的订单管理服务

```php
<?php
// app/Services/SupabaseOrderService.php

namespace App\Services;

use Supabase\SupabaseClient;

class SupabaseOrderService
{
    private SupabaseClient $client;

    public function __construct(SupabaseClient $client)
    {
        $this->client = $client;
    }

    /**
     * 创建订单（使用 service_role 绕过 RLS）
     */
    public function createOrder(array $data): array
    {
        $orderNo = 'ORD' . date('YmdHis') . str_pad(random_int(0, 9999), 4, '0', STR_PAD_LEFT);

        $result = $this->client->from('orders')
            ->insert([
                'user_id' => $data['user_id'],
                'order_no' => $orderNo,
                'status' => 'pending',
                'total_amount' => $data['total_amount'],
                'shipping_address' => $data['shipping_address'],
                'items' => $data['items'],
            ])
            ->select()
            ->single()
            ->execute();

        // 记录初始状态日志
        $this->logStatusChange($result['id'], null, 'pending', $data['user_id'], '订单创建');

        return $result;
    }

    /**
     * 更新订单状态
     */
    public function updateStatus(string $orderId, string $newStatus, string $changedBy, ?string $note = null): array
    {
        // 获取当前状态
        $order = $this->client->from('orders')
            ->select('status')
            ->eq('id', $orderId)
            ->single()
            ->execute();

        $fromStatus = $order['status'];

        // 更新订单状态
        $result = $this->client->from('orders')
            ->update(['status' => $newStatus])
            ->eq('id', $orderId)
            ->select()
            ->single()
            ->execute();

        // 记录状态变更
        $this->logStatusChange($orderId, $fromStatus, $newStatus, $changedBy, $note);

        return $result;
    }

    /**
     * 记录状态变更日志
     */
    private function logStatusChange(string $orderId, ?string $from, string $to, string $changedBy, ?string $note): void
    {
        $this->client->from('order_status_logs')
            ->insert([
                'order_id' => $orderId,
                'from_status' => $from,
                'to_status' => $to,
                'changed_by' => $changedBy,
                'note' => $note,
            ])
            ->execute();
    }

    /**
     * 获取用户订单列表
     */
    public function getUserOrders(string $userId, int $page = 1, int $perPage = 20): array
    {
        $offset = ($page - 1) * $perPage;

        return $this->client->from('orders')
            ->select('*', ['count' => 'exact'])
            ->eq('user_id', $userId)
            ->order('created_at', ['ascending' => false])
            ->range($offset, $offset + $perPage - 1)
            ->execute();
    }
}
```

### 4.5 Auth 集成：Magic Link + OAuth

Supabase 的 Auth 模块基于 GoTrue，支持多种认证方式。在 B2C 场景中，我们通常需要邮箱注册 + 第三方登录：

```php
<?php
// app/Services/SupabaseAuthService.php

namespace App\Services;

use Supabase\SupabaseClient;

class SupabaseAuthService
{
    private SupabaseClient $client;

    public function __construct(SupabaseClient $client)
    {
        $this->client = $this->client;
    }

    /**
     * 邮箱密码注册
     */
    public function signUp(string $email, string $password, array $metadata = []): array
    {
        return $this->client->auth->signUp([
            'email' => $email,
            'password' => $password,
            'data' => $metadata, // 存储用户昵称、头像等
        ]);
    }

    /**
     * 邮箱密码登录
     */
    public function signIn(string $email, string $password): array
    {
        return $this->client->auth->signInWithPassword([
            'email' => $email,
            'password' => $password,
        ]);
    }

    /**
     * Magic Link 登录（免密码）
     */
    public function sendMagicLink(string $email): void
    {
        $this->client->auth->signInWithOtp([
            'email' => $email,
            'options' => [
                'emailRedirectTo' => config('app.url') . '/auth/callback',
            ],
        ]);
    }

    /**
     * 第三方 OAuth 登录（微信、Google 等）
     */
    public function getOAuthUrl(string $provider): string
    {
        return $this->client->auth->signInWithOAuth([
            'provider' => $provider, // 'google', 'github', etc.
            'options' => [
                'redirectTo' => config('app.url') . '/auth/callback',
            ],
        ])['url'];
    }

    /**
     * 刷新 Token
     */
    public function refreshSession(string $refreshToken): array
    {
        return $this->client->auth->refreshSession([
            'refresh_token' => $refreshToken,
        ]);
    }

    /**
     * 登出
     */
    public function signOut(string $accessToken): void
    {
        $this->client->auth->signOut();
    }
}
```

**踩坑记录 #3：JWT Token 过期处理**

> Supabase 的 access_token 默认有效期为 1 小时。在 Laravel 后端使用时，务必实现 token 刷新逻辑。建议在中间件中捕获 401 错误并自动 refresh。前端则可利用 Supabase JS SDK 的 `autoRefreshToken` 配置。

---

## 五、Realtime 实时订单状态推送

这是 Supabase 最令人兴奋的特性之一。在 B2C 电商中，用户下单后需要实时看到订单状态变化（如"已支付→发货中→已签收"）。

### 5.1 后端：启用 Realtime

```sql
-- 启用 orders 表的 Realtime（在 Supabase Dashboard → Database → Replication 中启用）
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- 或者通过 SQL
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE public.orders;
COMMIT;
```

### 5.2 前端：订阅订单状态变更

```javascript
// 前端 JavaScript（Vue.js 示例）
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VUE_APP_SUPABASE_URL,
  process.env.VUE_APP_SUPABASE_KEY
)

// 订阅特定订单的状态变更
function subscribeOrderStatus(orderId, userId) {
  const channel = supabase
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      },
      (payload) => {
        const { new: newOrder } = payload
        console.log('订单状态变更:', newOrder.status)

        // 更新 UI
        updateOrderStatusUI(newOrder)

        // 订单完成时取消订阅
        if (['delivered', 'cancelled'].includes(newOrder.status)) {
          supabase.removeChannel(channel)
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('已连接实时推送')
      }
    })

  return channel
}

// 订阅用户所有订单的状态变更
function subscribeUserOrders(userId) {
  const channel = supabase
    .channel('user-orders')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        switch (payload.eventType) {
          case 'INSERT':
            showNotification('新订单已创建', payload.new.order_no)
            break
          case 'UPDATE':
            handleOrderUpdate(payload.new, payload.old)
            break
        }
      }
    )
    .subscribe()

  return channel
}

// Vue Composition API 封装
import { onMounted, onUnmounted, ref } from 'vue'

export function useRealtimeOrder(orderId) {
  const currentStatus = ref(null)
  let channel = null

  onMounted(() => {
    channel = supabase
      .channel(`order-status-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          currentStatus.value = payload.new.status
        }
      )
      .subscribe()
  })

  onUnmounted(() => {
    if (channel) supabase.removeChannel(channel)
  })

  return { currentStatus }
}
```

**踩坑记录 #4：Realtime 连接数限制**

> Supabase 免费版限制 200 个并发 Realtime 连接，Pro 版 500 个。在高并发场景下，建议使用 **Realtime Broadcast** 替代 Postgres Changes——Broadcast 走 WebSocket 直连，不依赖 Logical Replication，性能更好。对于订单状态这种低频更新场景，Postgres Changes 足够。

---

## 六、Edge Functions：Webhook 与异步处理

Edge Functions 基于 Deno 运行时，适合处理 Webhook 回调、定时任务等场景。

### 6.1 支付回调 Webhook

```typescript
// supabase/functions/payment-webhook/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMENT_WEBHOOK_SECRET = Deno.env.get('PAYMENT_WEBHOOK_SECRET')!

serve(async (req) => {
  // 验证请求方法
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.text()
    const signature = req.headers.get('x-payment-signature') || ''

    // 验证签名
    const expectedSignature = await generateHmac(body, PAYMENT_WEBHOOK_SECRET)
    if (signature !== expectedSignature) {
      return new Response('Invalid signature', { status: 401 })
    }

    const payload = JSON.parse(body)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if (payload.event === 'payment.success') {
      const { order_no, transaction_id, amount } = payload.data

      // 更新订单状态为已支付
      const { data: order, error } = await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_info: {
            transaction_id,
            amount,
            paid_at: new Date().toISOString(),
          },
        })
        .eq('order_no', order_no)
        .eq('status', 'pending') // 防止重复处理
        .select()
        .single()

      if (error || !order) {
        console.error('订单更新失败:', error)
        return new Response(JSON.stringify({ error: 'Order not found or already processed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // 记录状态日志
      await supabase.from('order_status_logs').insert({
        order_id: order.id,
        from_status: 'pending',
        to_status: 'paid',
        note: `支付成功，交易号: ${transaction_id}`,
      })

      // 触发后续流程（发货通知等）
      await supabase.functions.invoke('send-order-notification', {
        body: {
          order_id: order.id,
          user_id: order.user_id,
          event: 'paid',
        },
      })

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Unknown event', { status: 200 })
  } catch (err) {
    console.error('Webhook 处理错误:', err)
    return new Response('Internal Server Error', { status: 500 })
  }
})

async function generateHmac(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')
}
```

部署 Edge Function：

```bash
supabase functions deploy payment-webhook --no-verify-jwt
```

**踩坑记录 #5：Edge Functions 的冷启动**

> Edge Functions 首次调用有 1-3 秒冷启动时间。对于支付 Webhook 这种关键路径，建议在 Supabase 项目设置中将 Function 的 `boot_type` 设为 `warm`（Pro 版可用），或者使用外部定时任务（如 GitHub Actions cron）预热。

---

## 七、Storage：文件上传与管理

Supabase Storage 基于 S3 协议，配合 RLS 可以实现精细化的文件访问控制。

### 7.1 创建存储桶并配置策略

```sql
-- 创建头像存储桶
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    5242880, -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- 创建订单附件存储桶（私有）
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-attachments', 'order-attachments', false);

-- 存储策略：用户只能上传自己的头像
CREATE POLICY "Users can upload own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- 存储策略：用户可以查看自己订单的附件
CREATE POLICY "Users can view order attachments"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'order-attachments'
        AND EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.user_id = auth.uid()
            AND (storage.foldername(name))[1] = orders.id::text
        )
    );
```

### 7.2 Laravel 中的文件上传

```php
<?php
// app/Services/SupabaseStorageService.php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Supabase\SupabaseClient;

class SupabaseStorageService
{
    private SupabaseClient $client;

    public function __construct(SupabaseClient $client)
    {
        $this->client = $client;
    }

    /**
     * 上传用户头像
     */
    public function uploadAvatar(UploadedFile $file, string $userId): string
    {
        $path = "{$userId}/avatar." . $file->getClientOriginalExtension();

        $this->client->storage
            ->from('avatars')
            ->upload($path, $file->getContent(), [
                'contentType' => $file->getMimeType(),
                'upsert' => true, // 覆盖旧头像
            ]);

        // 获取公开 URL
        return $this->client->storage
            ->from('avatars')
            ->getPublicUrl($path);
    }

    /**
     * 上传订单附件（带签名的临时 URL）
     */
    public function uploadOrderAttachment(
        UploadedFile $file,
        string $orderId,
        string $userId
    ): array {
        $filename = $file->getClientOriginalName();
        $path = "{$orderId}/{$filename}";

        $this->client->storage
            ->from('order-attachments')
            ->upload($path, $file->getContent(), [
                'contentType' => $file->getMimeType(),
            ]);

        // 生成有效期 1 小时的签名 URL
        $signedUrl = $this->client->storage
            ->from('order-attachments')
            ->createSignedUrl($path, 3600);

        return [
            'path' => $path,
            'signed_url' => $signedUrl,
        ];
    }

    /**
     * 删除文件
     */
    public function deleteFile(string $bucket, string $path): void
    {
        $this->client->storage
            ->from($bucket)
            ->remove([$path]);
    }
}
```

**踩坑记录 #6：Storage 大文件上传**

> Supabase Storage 的单文件上传限制默认为 50MB。如果需要上传更大文件，需使用分片上传（Multipart Upload），但目前 supabase-php SDK 对此支持不完善。一个折中方案是：前端直接使用 Supabase JS SDK 的 `createSignedUploadUrl` 生成上传 URL，由浏览器直传 Storage，避免经过 Laravel 后端中转。

---

## 八、从 Firebase 迁移策略

### 8.1 数据迁移路径

```
Firebase Firestore → 导出 JSON → 数据转换 → PostgreSQL 导入
Firebase Auth → 导出用户 → GoTrue 导入
Firebase Storage → 下载文件 → 上传至 Supabase Storage
```

### 8.2 Firestore → PostgreSQL 数据转换脚本

```javascript
// migrate-firestore-to-supabase.js
const admin = require('firebase-admin')
const { createClient } = require('@supabase/supabase-js')

// 初始化 Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccount.json')),
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function migrateOrders() {
  const snapshot = await admin.firestore().collection('orders').get()

  for (const doc of snapshot.docs) {
    const data = doc.data()

    // Firestore Timestamp → PostgreSQL TIMESTAMPTZ
    const createdAt = data.createdAt?.toDate?.() || new Date()

    // Firestore 嵌套对象 → PostgreSQL JSONB
    const items = data.items || []

    await supabase.from('orders').insert({
      // 保留原始 ID 以便关联迁移
      id: doc.id,
      user_id: await mapFirebaseUidToSupabase(data.userId),
      order_no: data.orderNo,
      status: data.status,
      total_amount: data.totalAmount,
      shipping_address: JSON.stringify(data.shippingAddress),
      items: JSON.stringify(items),
      created_at: createdAt.toISOString(),
    })

    console.log(`Migrated order: ${doc.id}`)
  }
}

async function mapFirebaseUidToSupabase(firebaseUid) {
  // 通过 email 映射用户
  const firebaseUser = await admin.auth().getUser(firebaseUid)
  const { data } = await supabase.auth.admin.listUsers()
  const supabaseUser = data.users.find(u => u.email === firebaseUser.email)
  return supabaseUser?.id
}
```

### 8.3 Auth 用户迁移

Supabase 提供了 `supabase auth import` CLI 命令：

```bash
# 从 Firebase 导出用户
firebase auth:export users.json --format=json

# 转换格式并导入 Supabase
# 注意：需要保持相同的 password hash 算法
supabase auth import users.json --project-ref your-project-ref
```

**踩坑记录 #7：密码 Hash 不兼容**

> Firebase Auth 使用 scrypt 算法（带特定参数），Supabase/GoTrue 默认使用 bcrypt。如果直接迁移密码 hash，用户将无法登录。解决方案：(1) 要求用户首次迁移后通过 Magic Link 重置密码；(2) 或使用 Supabase 的 `import_users` API 配合 Firebase 的加密参数进行兼容导入。推荐方案 (1)，更安全。

---

## 九、成本分析：Supabase vs Firebase

### 9.1 典型 B2C 场景成本估算

假设场景：月活跃用户 10,000，日均订单 500，存储文件 50GB。

| 项目 | Supabase Pro | Firebase Blaze |
|------|-------------|----------------|
| 基础费用 | $25/月 | $0（按量计费） |
| 数据库存储 | 8GB 含，超出 $0.125/GB | 1GB 免费，$0.18/GB |
| 数据库读写 | 无限制 | 50K 读/20K 写免费，$0.06/10万读 |
| 带宽 | 250GB 含，超出 $0.09/GB | 10GB 免费，$0.12/GB |
| Auth | 100K MAU 含 | 50K MAU 免费 |
| 存储 | 100GB 含，超出 $0.021/GB | 5GB 免费，$0.026/GB |
| Edge Functions | 2M 调用含 | 2M 调用免费 |
| **预估月费** | **~$30-50** | **~$50-200** |

> Firebase 的费用波动主要来自 Firestore 的读写计费。促销活动期间读写量激增，账单可能翻倍。Supabase 的计费模型更可预测，对于中大型项目来说通常更经济。

### 9.2 自托管方案

Supabase 支持 Docker Compose 自托管，适合对数据合规有要求的企业：

```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# 编辑 .env 配置
docker compose up -d
```

自托管成本 = 服务器费用。一台 4C8G 的云服务器（约 $40/月）即可支撑中小型 B2C 应用。

---

## 十、踩坑记录汇总与最佳实践

### 汇总踩坑清单

| # | 问题 | 解决方案 |
|---|------|---------|
| 1 | RLS 启用后查不到数据 | 启用 RLS 前先创建 POLICY |
| 2 | RLS 关联查询性能差 | 对 RLS 涉及列建索引 |
| 3 | JWT Token 过期未刷新 | 中间件自动 refresh，前端开启 autoRefreshToken |
| 4 | Realtime 连接数超限 | 高并发场景用 Broadcast 替代 Postgres Changes |
| 5 | Edge Functions 冷启动 | 设置 warm boot 或定时预热 |
| 6 | 大文件上传限制 | 使用签名 URL 直传 |
| 7 | 密码 Hash 不兼容 | 迁移后引导用户重置密码 |
| 8 | Supabase PHP SDK 不支持 RLS 模式切换 | 分别用 anon key 和 service_role key 创建两个 Client 实例 |

### 最佳实践

1. **RLS 优先**：所有表都应启用 RLS，不要依赖应用层过滤
2. **Service Role 慎用**：`service_role` key 绝不暴露给前端，仅在后端管理操作中使用
3. **连接池**：使用 Supabase 提供的 `supavisor` 连接池模式，避免直连 PostgreSQL 耗尽连接
4. **索引策略**：对经常出现在 WHERE、JOIN、RLS POLICY 中的列建立索引
5. **Edge Functions 事务性**：使用数据库事务确保 Webhook 处理的幂等性
6. **备份策略**：虽然 Supabase Pro 提供每日自动备份，仍建议定期使用 `pg_dump` 做额外备份

---

## 十一、总结

Supabase 作为 Firebase 的开源替代，最大的优势在于：

- **PostgreSQL 的力量**：完整的 SQL 查询能力，不受文档型数据库的建模限制
- **透明的安全模型**：RLS 在数据库层面执行，比 Firebase Security Rules 更直观
- **可预测的成本**：不按操作计费，不会因流量突增而产生天价账单
- **零供应商锁定**：数据在标准 PostgreSQL 中，随时可以迁走
- **实时能力**：基于 PostgreSQL WAL 的 Realtime，无需额外维护消息队列

对于正在使用 Firebase 但受困于查询限制、成本不可预测或供应商锁定的团队，Supabase 是最值得考虑的迁移目标。特别是 Laravel 生态的开发者，通过 supabase-php SDK 可以无缝集成 Supabase 的各项能力，构建现代化的 B2C 应用。

在实际项目中，建议从**新项目开始尝试**，而非直接迁移已运行的 Firebase 项目。待团队熟悉 Supabase 的开发范式后，再制定渐进式迁移策略。

---

**参考资料：**
- [Supabase 官方文档](https://supabase.com/docs)
- [supabase-php SDK](https://github.com/supabase/supabase-php)
- [Supabase Self-Hosting Guide](https://supabase.com/docs/guides/self-hosting)
- [PostgreSQL Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase vs Firebase 官方对比](https://supabase.com/docs/guides/getting-started/migration/firebase)

---

## 相关阅读

- [Elixir Phoenix LiveView 实战：函数式语言做实时 Web，对比 Laravel Reverb 与 WebSocket 的开发体验](/categories/架构/Elixir-Phoenix-LiveView-实战-函数式语言做实时Web-对比Laravel-Reverb与WebSocket的开发体验/)
- [SSE vs WebSocket vs HTTP Streaming：实时通信方案工程选型](/categories/架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/)
- [订单状态机实战：用 Laravel + XState 实现复杂订单流转——可视化状态图与事件驱动](/categories/架构/订单状态机实战-用Laravel-XState实现复杂订单流转-可视化状态图与事件驱动/)
