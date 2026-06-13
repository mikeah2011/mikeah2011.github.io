---

title: OAuth 2.0 Token Exchange 实战：Laravel 中的服务间令牌交换——RFC 8693 标准与微服务间的最小权限调用
keywords: [OAuth, Token Exchange, Laravel, RFC, 中的服务间令牌交换, 标准与微服务间的最小权限调用]
date: 2026-06-06 10:00:00
tags:
- OAuth
- Token
- RFC 8693
- Laravel
- 微服务
- SSO
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深入解析 RFC 8693 OAuth 2.0 Token Exchange 标准，手把手实现 Laravel 中服务间最小权限令牌交换，涵盖自定义 Grant Type、Subject/Actor 模型、范围缩减策略与审计日志，解决微服务架构下 SSO 与服务间认证的安全难题。
---



# OAuth 2.0 Token Exchange 实战：Laravel 中的服务间令牌交换——RFC 8693 标准与微服务间的最小权限调用

## 前言

在微服务架构日益普及的今天，服务间的认证与授权已经成为了系统安全设计中最棘手的问题之一。当一个用户请求经过 API Gateway 进入系统之后，下游的每一个微服务往往都需要代表这个用户去调用其他服务来获取数据或执行操作。在这个过程中，如何安全地传递用户的身份信息？如何确保每一个服务只拥有它实际需要的最小权限？如何做到完整的审计追踪以便在安全事件发生时能够快速定位问题的根源？

这些问题在单体架构时代几乎不存在，因为所有的业务逻辑都在同一个进程内运行，共享同一份数据库连接和用户会话。但当我们把系统拆分成十几个甚至几十个微服务之后，每一个服务间的调用都变成了一次独立的 HTTP 请求，每一次请求都需要携带认证信息。如何管理这些认证信息，就成了架构师必须回答的关键问题。

传统的做法通常有两种。第一种是简单地将用户的 Access Token 透传到下游服务，这种方式实现起来最简单，但却带来了严重的安全隐患——下游服务获得了用户的完整权限，任何一个服务的漏洞都可能导致用户数据的全面泄露。第二种方式是使用 OAuth 2.0 的 Client Credentials Grant，让每个服务使用自己的客户端凭证去获取服务级别的令牌，这种方式虽然避免了权限过高的问题，但却完全丢失了用户上下文，下游服务无法知道当前请求是代表哪个用户发起的，也就无法做权限控制和审计追踪。

OAuth 2.0 Token Exchange（RFC 8693）正是为了解决这个两难困境而诞生的标准协议。它允许一个服务使用已有的用户令牌去授权服务器交换一个受限的新令牌，这个新令牌既保留了用户的标识信息，又将权限范围缩减到下游服务实际需要的最小集合。这正是微服务间最小权限调用的理想方案。

本文将从实际问题出发，深入剖析 RFC 8693 Token Exchange 标准的核心设计思想，然后在 Laravel 生态中实现一套完整的 Token Exchange 方案，包括自定义 Grant Type、服务端实现、客户端封装、下游服务验证、安全策略配置等完整流程。同时，我还会分享在实际项目中遇到的各种踩坑经验和安全最佳实践。

---

## 一、问题场景：微服务间调用的认证困境

### 1.1 一个典型的微服务调用链

让我们从一个真实场景开始。假设我们在构建一个电商系统，这个系统包含以下微服务：

- **API Gateway**：系统的统一入口，负责用户认证、请求路由和限流
- **Order Service**：订单服务，负责创建和管理订单
- **Inventory Service**：库存服务，负责管理商品库存和库存预留
- **Payment Service**：支付服务，负责处理支付和退款
- **User Profile Service**：用户信息服务，负责管理用户的收货地址和个人偏好
- **Notification Service**：通知服务，负责发送订单确认、发货提醒等消息

当用户在客户端提交一个订单时，系统内部的调用链是这样的：

用户首先向 API Gateway 发送一个创建订单的请求，请求中携带了用户的 Access Token。API Gateway 验证令牌的有效性后，将请求转发给 Order Service。Order Service 在创建订单之前，需要执行一系列操作：首先调用 Inventory Service 检查商品库存是否充足并预留库存，然后调用 User Profile Service 获取用户的默认收货地址，接着调用 Payment Service 创建支付订单，最后在所有前置操作都成功之后，才能正式创建订单记录。在整个流程完成之后，Order Service 还需要调用 Notification Service 给用户发送订单确认消息。

这个过程中涉及到了四次跨服务调用，每一次调用都需要携带认证信息。那么问题来了：这四次调用应该如何认证？

### 1.2 方案一：Token 透传——方便但危险

最直觉的做法是将用户的 Access Token 原封不动地传递给所有下游服务。Order Service 收到用户的令牌后，在调用 Inventory Service、Payment Service 等下游服务时，直接将同一个令牌放在 HTTP 请求头中传递过去。

这种做法看似方便，实际上存在严重的安全问题。每个下游服务都拿到了用户的完整 Access Token，这意味着它们可以执行用户权限范围内的任何操作。举个例子：如果 Inventory Service 存在一个安全漏洞被攻击者利用，攻击者就可以使用截获的用户令牌去调用 Payment Service 进行欺诈性支付，或者调用 User Profile Service 窃取用户的个人信息。

更糟糕的是，从用户的视角来看，他的令牌被一个本不应该拥有支付权限的服务使用了，这违反了最小权限原则。在安全审计中，我们也无法区分这次支付请求到底是 Order Service 发起的还是 Inventory Service 发起的，因为它们使用的是同一个令牌。

从合规的角度来看，特别是在涉及 GDPR 或个人信息保护法的场景下，这种无差别的令牌共享可能构成违规行为。审计人员需要能够精确地追踪"谁在什么时候用什么权限访问了什么数据"，而令牌透传使得这种追踪变得不可能。

### 1.3 方案二：Client Credentials Grant——安全但不完整

另一种常见的做法是让每个服务使用 OAuth 2.0 的 Client Credentials Grant 来获取自己的服务级令牌。Order Service 用自己的 client_id 和 client_secret 从授权服务器获取一个令牌，然后用这个令牌去调用下游服务。

这种方式确实解决了权限过高的问题，因为我们可以为每个服务配置精确的权限范围。但它带来了一个新的问题：丢失了用户上下文。当 Inventory Service 收到 Order Service 的请求时，它只知道"Order Service 在请求库存信息"，而不知道"是哪个用户的订单在请求库存信息"。

这意味着我们无法实现基于用户的权限控制。比如，某些 VIP 用户可能有优先发货的特权，但如果 Inventory Service 不知道当前用户是谁，就无法应用这个业务规则。同样，在安全审计和问题排查时，我们也无法将服务间的调用关联到具体的用户操作。

此外，在某些场景下，下游服务可能需要根据用户的身份来决定是否允许某个操作。比如，一个用户可能只能查询和管理自己的订单，如果下游服务不知道用户是谁，就无法执行这样的权限校验。

### 1.4 方案三：Token Exchange——两全其美

RFC 8693 Token Exchange 提供了一个优雅的解决方案。核心思想是：Order Service 使用用户的 Access Token 向授权服务器请求交换一个新的、权限受限的令牌。这个新令牌具有以下特性：

首先，新令牌保留了用户的身份标识。在 JWT 令牌的 `sub`（subject）声明中，记录的是原始用户的 ID，这样下游服务就知道当前请求是代表哪个用户发起的。

其次，新令牌的权限范围被大幅缩减。比如用户的原始令牌可能包含 `inventory:read inventory:write payment:create payment:query user:profile:read` 等多个权限，但 Order Service 在调用 Inventory Service 时，只需要交换一个只包含 `inventory:read inventory:reserve` 权限的令牌。即使这个令牌被泄露，攻击者也只能读取和预留库存，而不能执行支付操作。

第三，新令牌记录了代理者（Actor）的信息。在 JWT 的 `act`（actor）声明中，记录的是发起交换请求的服务标识，比如 `order-service`。这样下游服务就知道"是 Order Service 代表用户在执行操作"，实现了完整的审计追踪。

第四，新令牌设置了很短的过期时间。通常只有几分钟，大大降低了令牌泄露后的风险窗口。

让我们通过一个具体的对比来直观地理解三种方案的差异。假设用户张三拥有 `user:read user:write inventory:read inventory:write payment:create` 等权限，Order Service 需要代表张三调用 Inventory Service：

- **Token 透传**：Inventory Service 收到的令牌包含张三的所有权限，包括 `payment:create`
- **Client Credentials**：Inventory Service 收到的令牌没有张三的身份信息，只有服务级别的 `inventory:read inventory:write` 权限
- **Token Exchange**：Inventory Service 收到的令牌记录了"张三"的身份，只有 `inventory:read inventory:reserve` 权限，由 `order-service` 代理

这就是 Token Exchange 的核心价值：在保留用户上下文的同时，实现精确的权限控制和完整的审计追踪。

---

## 二、RFC 8693 Token Exchange 标准深度解析

### 2.1 标准背景与设计动机

RFC 8693 全称为 "OAuth 2.0 Token Exchange"，于 2020 年 1 月由 IETF 发布。它属于 OAuth 2.0 协议族的扩展标准，定义了一种标准化的令牌交换协议。

在 RFC 8693 出现之前，业界已经有了各种私有的令牌交换机制。比如 Google 的 STS（Security Token Service）API、AWS 的 AssumeRole API、Azure 的 On-Behalf-Of 流程等。这些私有方案虽然在各自平台上运行良好，但缺乏互操作性。如果你的系统同时使用了多个云平台的服务，就需要为每个平台实现不同的令牌交换逻辑。

RFC 8693 的设计目标就是提供一个统一的、标准化的令牌交换协议，使得不同的授权服务器和资源服务器之间能够以一致的方式进行令牌交换。这个标准是通用的，既可以用于 OAuth 2.0 的 Access Token，也可以用于 SAML Assertion、OpenID Connect ID Token 等多种类型的令牌。

### 2.2 请求参数详解

Token Exchange 请求使用一个特殊的 `grant_type` 值：`urn:ietf:params:oauth:grant-type:token-exchange`。这个 URI 格式的 grant type 本身就表明了这是一个令牌交换类型的授权请求。

请求中包含以下关键参数：

**grant_type**：这是必需参数，值固定为 `urn:ietf:params:oauth:grant-type:token-exchange`。授权服务器通过这个参数来识别这是一个令牌交换请求，而不是普通的授权码流程或客户端凭证流程。

**subject_token**：这是必需参数，表示当前持有的、需要被交换的令牌。通常这是用户的 Access Token。授权服务器会验证这个令牌的有效性，包括签名验证、过期检查、撤销状态检查等。

**subject_token_type**：这是必需参数，用于描述 subject_token 的类型。对于 OAuth 2.0 的 Access Token，使用 `urn:ietf:params:oauth:token-type:access_token`。对于 SAML 2.0 的 Assertion，使用 `urn:ietf:params:oauth:token-type:saml2`。这个参数帮助授权服务器正确解析令牌的格式。

**requested_token_type**：这是可选参数，用于指定期望获得的令牌类型。如果不提供，授权服务器通常会签发与 subject_token 相同类型的令牌。

**audience**：这是可选参数，用于指定期望的目标服务标识符。授权服务器可以根据这个参数来限制新令牌只能被特定的服务使用。在 JWT 令牌中，这对应 `aud`（audience）声明。

**scope**：这是可选参数，用于指定期望的权限范围。授权服务器会对请求的 scope 进行验证，确保它不会超过原始令牌的权限范围。这是实现最小权限的关键机制。

**actor_token** 和 **actor_token_type**：这是可选参数，用于标识代理者（Actor）的令牌。在某些复杂场景下，可能有多个实体参与代理链，这个参数可以帮助追踪完整的代理关系。

### 2.3 响应格式

Token Exchange 的成功响应遵循 OAuth 2.0 的标准格式，但额外包含了一些 RFC 8693 特有的字段：

`access_token` 是签发的新令牌，通常是 JWT 格式。`issued_token_type` 表示签发的令牌类型，对应请求中的 `requested_token_type`。`token_type` 固定为 `Bearer`。`expires_in` 表示令牌的有效期，单位是秒。对于 Token Exchange 场景，这个值通常设置得很短。`scope` 是实际授权的权限范围，它可能小于请求的 scope。

当授权服务器拒绝请求时，会返回标准的 OAuth 2.0 错误响应。除了 `invalid_grant`、`invalid_client` 等标准错误码之外，RFC 8693 还定义了 `invalid_target` 错误码，用于表示请求的 audience 不被允许。

### 2.4 Subject 与 Actor 模型

RFC 8693 引入了 Subject（主体）和 Actor（代理者）的概念模型，这是理解 Token Exchange 的核心。

Subject 是资源的拥有者或者授权的发起者。在我们的场景中，Subject 就是最终用户。Actor 是代表 Subject 执行操作的实体。在我们的场景中，Actor 就是发起 Token Exchange 请求的微服务，比如 Order Service。

这个模型在 JWT 令牌中通过 `sub` 和 `act` 两个声明来表达。一个通过 Token Exchange 签发的 JWT 令牌看起来是这样的：

```json
{
  "iss": "https://auth.example.com",
  "sub": "user-123",
  "aud": "https://inventory.example.com",
  "scope": "inventory:read inventory:reserve",
  "act": {
    "sub": "order-service-client-id"
  },
  "iat": 1686000000,
  "exp": 1686000300,
  "jti": "unique-token-id"
}
```

在这个令牌中，`sub` 字段告诉我们这个令牌代表的是用户 `user-123`，`act.sub` 字段告诉我们这个令牌是由 `order-service-client-id` 代理签发的，`aud` 字段表明这个令牌只能被 `inventory.example.com` 使用，`scope` 字段限制了具体的权限范围。

当 Inventory Service 收到这个令牌时，它不仅能验证令牌的合法性和权限范围，还能知道这次请求是代表哪个用户发起的、由哪个服务代理的。这为审计追踪提供了完整的数据支撑。

### 2.5 代理链与嵌套交换

RFC 8693 还支持更复杂的代理链场景。比如 Order Service 代表用户交换了一个令牌，然后调用 Payment Service。Payment Service 又需要用这个令牌去调用第三方的支付网关。在这种情况下，Payment Service 可以再次发起 Token Exchange，将 Order Service 交换的令牌作为 subject_token，同时在 actor_token 中传入自己的凭证。

这样一来，最终的令牌中会记录完整的代理链：原始用户 → Order Service → Payment Service。这在金融和医疗等对审计要求极高的行业中非常有价值。

当然，代理链不能无限延伸。在实际实现中，我们需要限制最大交换深度，防止令牌被反复交换导致安全边界模糊。通常建议将最大深度设置为 2 到 3 层。

---

## 三、Laravel 中实现 Token Exchange 的完整方案

### 3.1 技术架构概览

在 Laravel 生态中实现 Token Exchange，我们采用以下技术栈：

- **Laravel Passport**：作为 OAuth 2.0 授权服务器的基础框架
- **League OAuth2 Server**：Passport 底层使用的 OAuth 2.0 服务器实现
- **自定义 Grant Type**：扩展 Passport 以支持 Token Exchange
- **Redis**：用于缓存交换后的令牌，减少对授权服务器的请求压力
- **Firebase JWT**：用于在下游服务中验证和解析 JWT 令牌

整体架构如下：Auth Server（运行 Laravel Passport）作为中心化的授权服务器，负责验证原始令牌、执行权限策略、签发新的受限令牌。Order Service 作为 Token Exchange 的发起方，代表用户向 Auth Server 请求交换令牌。Inventory Service 等下游服务作为 Token 的使用方，验证并接受交换后的受限令牌。

### 3.2 环境准备与基础配置

首先确保你的 Laravel 项目已安装并配置好 Passport：

```bash
composer require laravel/passport
php artisan passport:install --uuids
php artisan migrate
```

在 `config/auth.php` 中配置 Passport 作为 API 的认证守卫：

```php
'guards' => [
    'web' => [
        'driver' => 'session',
        'provider' => 'users',
    ],
    'api' => [
        'driver' => 'passport',
        'provider' => 'users',
    ],
],
```

在 `App\Models\User` 模型中添加 Passport 的 HasApiTokens trait：

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Passport\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens;
    // ...
}
```

### 3.3 实现自定义 TokenExchangeGrant

Laravel Passport 默认支持 Authorization Code、Client Credentials、Password 等标准授权类型，但不包含 Token Exchange。我们需要通过 League OAuth2 Server 的扩展接口来添加自定义的 Grant Type。

在 `app/OAuth/Grants/TokenExchangeGrant.php` 中创建核心实现：

```php
<?php

namespace App\OAuth\Grants;

use App\Models\TokenExchangeLog;
use League\OAuth2\Server\Grant\AbstractGrant;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Entities\AccessTokenEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Repositories\AccessTokenRepositoryInterface;
use League\OAuth2\Server\Repositories\RefreshTokenRepositoryInterface;
use League\OAuth2\Server\RequestEvent;
use League\OAuth2\Server\ResponseTypes\ResponseTypeInterface;
use Psr\Http\Message\ServerRequestInterface;
use DateInterval;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class TokenExchangeGrant extends AbstractGrant
{
    /**
     * Grant 的唯一标识符，使用 RFC 8693 定义的 URI
     */
    public function getIdentifier(): string
    {
        return 'urn:ietf:params:oauth:grant-type:token-exchange';
    }

    public function __construct(
        AccessTokenRepositoryInterface $accessTokenRepository,
        RefreshTokenRepositoryInterface $refreshTokenRepository
    ) {
        $this->setAccessTokenRepository($accessTokenRepository);
        $this->setRefreshTokenRepository($refreshTokenRepository);
    }

    /**
     * 处理 Token Exchange 的 Access Token 请求
     * 这是 Grant 的核心入口方法
     */
    public function respondToAccessTokenRequest(
        ServerRequestInterface $request,
        ResponseTypeInterface $responseType,
        DateInterval $accessTokenTTL
    ): ResponseTypeInterface {
        // 第一步：验证客户端身份
        // 客户端必须通过 client_id 和 client_secret 认证
        $client = $this->validateClient($request);

        // 第二步：解析请求参数
        $subjectToken = $this->getRequestParameter('subject_token', $request);
        if (empty($subjectToken)) {
            throw OAuthServerException::invalidRequest('subject_token');
        }

        $subjectTokenType = $this->getRequestParameter(
            'subject_token_type',
            $request,
            'urn:ietf:params:oauth:token-type:access_token'
        );

        $requestedTokenType = $this->getRequestParameter(
            'requested_token_type',
            $request,
            'urn:ietf:params:oauth:token-type:access_token'
        );

        // 第三步：验证原始令牌的有效性
        $tokenData = $this->validateSubjectToken($subjectToken, $subjectTokenType);

        // 第四步：解析目标受众和权限范围
        $requestedScope = $this->getRequestParameter('scope', $request, '');
        $audience = $this->getRequestParameter('audience', $request, null);

        // 第五步：验证交换权限——检查客户端是否被允许进行交换
        $this->validateExchangePermission($client, $audience, $requestedScope);

        // 第六步：执行范围缩减策略
        // 这是安全性的核心：新令牌的权限绝不能超过原始令牌
        $originalScopes = $tokenData['scopes'];
        $finalScope = $this->downgradeScope(
            $originalScopes,
            $requestedScope ? $this->getScopesFromString($requestedScope) : $originalScopes
        );

        // 第七步：验证交换深度，防止无限交换链
        $exchangeCount = ($tokenData['exchange_count'] ?? 0) + 1;
        $maxDepth = (int) config('auth.token_exchange.max_depth', 3);
        if ($exchangeCount > $maxDepth) {
            Log::warning('Token exchange depth exceeded', [
                'client_id' => $client->getIdentifier(),
                'depth' => $exchangeCount,
            ]);
            throw OAuthServerException::invalidRequest(
                'subject_token',
                'Maximum token exchange depth exceeded'
            );
        }

        // 第八步：签发新的受限令牌
        $accessToken = $this->issueAccessToken(
            $accessTokenTTL,
            $client,
            $tokenData['user_id'],
            $finalScope,
            $audience,
            $tokenData['subject'],
            $exchangeCount
        );

        // 第九步：记录审计日志
        $this->logTokenExchange($client, $tokenData, $finalScope, $audience, $exchangeCount);

        // 第十步：构建响应
        $responseType->setAccessToken($accessToken);

        $this->getEmitter()->emit(new RequestEvent(
            RequestEvent::ACCESS_TOKEN_ISSUED,
            $request
        ));

        return $responseType;
    }

    /**
     * 验证 subject_token 的合法性
     * 包括签名验证、过期检查和撤销状态检查
     */
    protected function validateSubjectToken(string $token, string $tokenType): array
    {
        // 只支持 Access Token 类型的交换
        $supportedTypes = [
            'urn:ietf:params:oauth:token-type:access_token',
        ];

        if (!in_array($tokenType, $supportedTypes)) {
            throw OAuthServerException::invalidRequest(
                'subject_token_type',
                'Unsupported subject token type. Supported: access_token'
            );
        }

        try {
            // 解码 JWT 令牌
            $tokenParsed = $this->parseJwtToken($token);

            // 检查令牌是否已过期
            if (isset($tokenParsed['exp']) && $tokenParsed['exp'] < time()) {
                throw OAuthServerException::invalidRequest(
                    'subject_token',
                    'The subject token has expired'
                );
            }

            // 检查令牌是否已被撤销
            if (isset($tokenParsed['jti']) && $this->isTokenRevoked($tokenParsed['jti'])) {
                throw OAuthServerException::invalidRequest(
                    'subject_token',
                    'The subject token has been revoked'
                );
            }

            return $tokenParsed;
        } catch (OAuthServerException $e) {
            throw $e;
        } catch (\Exception $e) {
            Log::error('Token exchange: subject token validation failed', [
                'error' => $e->getMessage(),
            ]);
            throw OAuthServerException::invalidRequest(
                'subject_token',
                'Token validation failed'
            );
        }
    }

    /**
     * 验证客户端是否有权执行这次交换
     * 检查 audience 白名单和 scope 白名单
     */
    protected function validateExchangePermission(
        ClientEntityInterface $client,
        ?string $audience,
        string $requestedScope
    ): void {
        if ($audience) {
            // 查询数据库中的 audience 白名单
            $allowedAudiences = DB::table('oauth_client_allowed_audiences')
                ->where('client_id', $client->getIdentifier())
                ->pluck('audience')
                ->toArray();

            if (!empty($allowedAudiences) && !in_array($audience, $allowedAudiences)) {
                Log::warning('Token exchange: audience not allowed', [
                    'client_id' => $client->getIdentifier(),
                    'requested_audience' => $audience,
                ]);
                throw OAuthServerException::invalidRequest(
                    'audience',
                    'The requested audience is not allowed for this client'
                );
            }
        }

        if ($requestedScope) {
            // 查询数据库中的 scope 白名单
            $allowedScopes = DB::table('oauth_client_exchange_scopes')
                ->where('client_id', $client->getIdentifier())
                ->pluck('scope')
                ->toArray();

            if (!empty($allowedScopes)) {
                $requestedScopes = $this->getScopesFromString($requestedScope);
                foreach ($requestedScopes as $scope) {
                    if (!in_array($scope->getIdentifier(), $allowedScopes)) {
                        throw OAuthServerException::invalidScope($scope->getIdentifier());
                    }
                }
            }
        }
    }

    /**
     * 范围缩减：确保新令牌的 scope 不超过原始令牌的范围
     * 这是实现最小权限的关键方法
     */
    protected function downgradeScope(
        array $originalScopes,
        array $requestedScopes
    ): array {
        if (empty($requestedScopes)) {
            // 如果没有请求特定的 scope，返回原始 scope 的子集
            // 策略可配置：可以返回全部原始 scope 或空
            return config('auth.token_exchange.default_to_full_scope', false)
                ? $originalScopes
                : [];
        }

        // 取交集：只保留原始令牌中已有的权限
        $originalIdentifiers = array_map(
            fn($scope) => $scope->getIdentifier(),
            $originalScopes
        );
        $requestedIdentifiers = array_map(
            fn($scope) => $scope->getIdentifier(),
            $requestedScopes
        );

        $downgradedIdentifiers = array_intersect($requestedIdentifiers, $originalIdentifiers);

        if (empty($downgradedIdentifiers)) {
            throw OAuthServerException::invalidScope(
                implode(' ', $requestedIdentifiers)
            );
        }

        // 构建 Scope 对象数组
        return array_filter($requestedScopes, function ($scope) use ($downgradedIdentifiers) {
            return in_array($scope->getIdentifier(), $downgradedIdentifiers);
        });
    }

    /**
     * 签发新的 Access Token
     * 在 JWT 中写入 sub（用户）和 act（代理者）声明
     */
    protected function issueAccessToken(
        DateInterval $ttl,
        ClientEntityInterface $client,
        $userIdentifier,
        array $scopes,
        ?string $audience,
        string $subjectIdentifier,
        int $exchangeCount
    ): AccessTokenEntityInterface {
        $accessToken = $this->accessTokenRepository->getNewToken(
            $client,
            $scopes,
            $userIdentifier
        );

        // 设置较短的过期时间
        $accessToken->setExpiryDateTime((new \DateTime())->add($ttl));

        // 设置 audience
        if ($audience) {
            $accessToken->setAudience($audience);
        }

        // 设置自定义声明
        $additionalClaims = [
            'act' => ['sub' => $client->getIdentifier()],
            'exchange_count' => $exchangeCount,
        ];
        $accessToken->setAdditionalClaims($additionalClaims);

        $this->accessTokenRepository->persistNewAccessToken($accessToken);

        return $accessToken;
    }

    /**
     * 记录 Token Exchange 审计日志
     */
    protected function logTokenExchange(
        ClientEntityInterface $client,
        array $tokenData,
        array $scopes,
        ?string $audience,
        int $exchangeCount
    ): void {
        TokenExchangeLog::create([
            'client_id'          => $client->getIdentifier(),
            'user_id'            => $tokenData['user_id'] ?? null,
            'subject'            => $tokenData['subject'] ?? null,
            'subject_token_hash' => hash('sha256', $tokenData['raw_token'] ?? ''),
            'granted_scopes'     => implode(' ', array_map(
                fn($s) => $s->getIdentifier(),
                $scopes
            )),
            'audience'           => $audience,
            'exchange_count'     => $exchangeCount,
            'ip_address'         => request()->ip(),
            'user_agent'         => request()->userAgent(),
            'exchanged_at'       => now(),
        ]);
    }
}
```

这个实现包含了完整的安全检查逻辑。其中几个关键设计决策值得注意：

第一，`downgradeScope` 方法确保了新令牌的权限永远不能超过原始令牌。即使客户端请求了更多的权限，最终签发的令牌也只能包含原始令牌已有的权限。这是最小权限原则的核心保障。

第二，`validateExchangePermission` 方法实现了客户端级别的权限控制。我们可以为每个 OAuth 客户端配置允许交换的 audience 和 scope 白名单，确保 Order Service 只能获取到调用 Inventory Service 和 Payment Service 所需的权限，而不能获取到调用 Admin Service 的权限。

第三，`exchangeCount` 参数实现了交换深度限制。每次 Token Exchange 都会将深度加一，当超过最大限制时就拒绝请求。这防止了攻击者通过反复交换来构造复杂的代理链。

### 3.4 注册自定义 Grant 到 Passport

在 `App\Providers\AuthServiceProvider` 中将自定义的 TokenExchangeGrant 注册到 Passport 的授权服务器中：

```php
<?php

namespace App\Providers;

use App\OAuth\Grants\TokenExchangeGrant;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;
use Laravel\Passport\Passport;
use League\OAuth2\Server\AuthorizationServer;
use DateInterval;

class AuthServiceProvider extends ServiceProvider
{
    public function boot()
    {
        $this->registerPolicies();

        // 获取授权服务器实例
        $server = app(AuthorizationServer::class);

        // 计算交换后令牌的 TTL
        $tokenTTL = new DateInterval(
            config('auth.token_exchange.ttl', 'PT5M')
        );

        // 注册 Token Exchange Grant
        $server->enableGrantType(
            function () use ($server) {
                $grant = new TokenExchangeGrant(
                    $server->getAccessTokenRepository(),
                    $server->getRefreshTokenRepository()
                );
                // 设置加密密钥
                $grant->setPrivateKey(
                    new CryptKey(
                        'file://' . Passport::keyPath('oauth-private.key'),
                        null,
                false
                )
                );
                return $grant;
            },
            $tokenTTL
        );

        // 其他 Passport 配置
        Passport::tokensExpireIn(now()->addHours(1));
        Passport::refreshTokensExpireIn(now()->addDays(30));
        Passport::personalAccessTokensExpireIn(now()->addMonths(6));
    }
}
```

### 3.5 配置文件

在 `config/auth.php` 中添加 Token Exchange 相关的配置项：

```php
'token_exchange' => [
    // 交换后令牌的有效期，默认 5 分钟
    'ttl' => env('TOKEN_EXCHANGE_TTL', 'PT5M'),

    // 最大交换深度，防止无限交换链
    'max_depth' => env('TOKEN_EXCHANGE_MAX_DEPTH', 3),

    // 当未指定 scope 时是否默认返回原始令牌的全部 scope
    'default_to_full_scope' => false,

    // 是否启用审计日志
    'audit_log_enabled' => true,
],
```

### 3.6 TokenExchangeService 服务类

为了在业务代码中优雅地使用 Token Exchange，我们封装一个 Service 类来处理与授权服务器的通信、令牌缓存、错误处理等逻辑：

```php
<?php

namespace App\Services\Auth;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\ClientException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use App\Exceptions\TokenExchangeException;

class TokenExchangeService
{
    private Client $httpClient;
    private string $authServerUrl;
    private string $clientId;
    private string $clientSecret;

    public function __construct()
    {
        $this->httpClient = new Client([
            'timeout' => config('services.auth_server.timeout', 5),
            'verify'  => config('services.auth_server.verify_ssl', true),
            'connect_timeout' => 2,
        ]);
        $this->authServerUrl = config('services.auth_server.url');
        $this->clientId = config('services.auth_server.token_exchange_client_id');
        $this->clientSecret = config('services.auth_server.token_exchange_client_secret');
    }

    /**
     * 交换令牌：使用用户的原始令牌获取受限的服务级令牌
     *
     * 这个方法会自动处理缓存和错误重试逻辑
     *
     * @param string $subjectToken 用户的原始 Access Token
     * @param string $targetAudience 目标服务的标识符，如 https://inventory.example.com
     * @param string $requestedScope 请求的权限范围，如 inventory:read inventory:reserve
     * @return array 包含 access_token、expires_in 等字段的响应数据
     * @throws TokenExchangeException 当交换失败时抛出
     */
    public function exchangeToken(
        string $subjectToken,
        string $targetAudience,
        string $requestedScope
    ): array {
        // 构建缓存键：基于原始令牌的哈希 + audience + scope
        // 注意：不存储原始令牌本身到缓存键中，只使用哈希值
        $cacheKey = $this->buildCacheKey($subjectToken, $targetAudience, $requestedScope);

        // 检查缓存中是否有未过期的令牌
        $cached = Cache::get($cacheKey);
        if ($cached) {
            Log::debug('Token exchange: cache hit', [
                'audience' => $targetAudience,
                'scope' => $requestedScope,
            ]);
            return $cached;
        }

        try {
            // 向授权服务器发送 Token Exchange 请求
            $response = $this->httpClient->post(
                "{$this->authServerUrl}/oauth/token",
                [
                    'form_params' => [
                        'grant_type'           => 'urn:ietf:params:oauth:grant-type:token-exchange',
                        'subject_token'        => $subjectToken,
                        'subject_token_type'   => 'urn:ietf:params:oauth:token-type:access_token',
                        'requested_token_type' => 'urn:ietf:params:oauth:token-type:access_token',
                        'audience'             => $targetAudience,
                        'scope'                => $requestedScope,
                        'client_id'            => $this->clientId,
                        'client_secret'        => $this->clientSecret,
                    ],
                    'headers' => [
                        'Accept'       => 'application/json',
                        'Content-Type' => 'application/x-www-form-urlencoded',
                    ],
                ]
            );

            $data = json_decode($response->getBody()->getContents(), true);

            // 缓存新令牌，提前 30 秒过期以避免边界情况
            $ttl = max(($data['expires_in'] ?? 300) - 30, 10);
            Cache::put($cacheKey, $data, $ttl);

            Log::info('Token exchange successful', [
                'audience'   => $targetAudience,
                'scope'      => $requestedScope,
                'expires_in' => $data['expires_in'],
                'cached_ttl' => $ttl,
            ]);

            return $data;
        } catch (ClientException $e) {
            $statusCode = $e->getResponse()->getStatusCode();
            $errorBody = json_decode(
                $e->getResponse()->getBody()->getContents(),
                true
            );

            Log::error('Token exchange failed', [
                'status_code' => $statusCode,
                'error'       => $errorBody['error'] ?? 'unknown',
                'description' => $errorBody['error_description'] ?? $e->getMessage(),
                'audience'    => $targetAudience,
                'scope'       => $requestedScope,
            ]);

            throw new TokenExchangeException(
                $errorBody['error_description'] ?? 'Token exchange failed',
                $errorBody['error'] ?? 'token_exchange_error',
                $statusCode,
                $e
            );
        } catch (\Exception $e) {
            Log::error('Token exchange: unexpected error', [
                'error'    => $e->getMessage(),
                'audience' => $targetAudience,
            ]);

            throw new TokenExchangeException(
                'Unexpected error during token exchange',
                'internal_error',
                500,
                $e
            );
        }
    }

    /**
     * 构建缓存键
     * 使用原始令牌的 SHA-256 哈希而非明文，避免缓存键泄露敏感信息
     */
    private function buildCacheKey(
        string $subjectToken,
        string $audience,
        string $scope
    ): string {
        return 'token_exchange:' . hash(
            'sha256',
            $subjectToken . '|' . $audience . '|' . $scope
        );
    }
}
```

### 3.7 自定义异常类

```php
<?php

namespace App\Exceptions;

use Exception;

class TokenExchangeException extends Exception
{
    private string $errorCode;
    private int $httpStatusCode;

    public function __construct(
        string $message,
        string $errorCode = 'token_exchange_error',
        int $httpStatusCode = 400,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, 0, $previous);
        $this->errorCode = $errorCode;
        $this->httpStatusCode = $httpStatusCode;
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    public function getHttpStatusCode(): int
    {
        return $this->httpStatusCode;
    }
}
```

### 3.8 在 Order Service 中使用 Token Exchange

在业务代码中，使用 TokenExchangeService 来代表用户调用下游服务。整个流程对调用方来说非常简洁：

```php
<?php

namespace App\Services\Order;

use App\Services\Auth\TokenExchangeService;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

class CreateOrderService
{
    private TokenExchangeService $tokenExchange;
    private Client $httpClient;

    public function __construct(
        TokenExchangeService $tokenExchange,
        Client $httpClient
    ) {
        $this->tokenExchange = $tokenExchange;
        $this->httpClient = $httpClient;
    }

    /**
     * 创建订单的完整流程
     *
     * @param array $orderData 订单数据
     * @param string $userToken 当前用户的 Access Token
     * @return array 创建的订单信息
     */
    public function execute(array $orderData, string $userToken): array
    {
        $user = auth()->user();

        // 第一步：交换令牌以调用库存服务
        // 只请求 inventory:read 和 inventory:reserve 权限
        // 即使用户的原始令牌有更多权限，这里也只会获得这两个
        $inventoryToken = $this->tokenExchange->exchangeToken(
            subjectToken: $userToken,
            targetAudience: config('services.inventory.audience'),
            requestedScope: 'inventory:read inventory:reserve'
        );

        // 使用受限令牌调用库存服务预留库存
        $reservationResult = $this->reserveInventory(
            $inventoryToken['access_token'],
            $orderData['items']
        );

        // 第二步：交换令牌以调用用户信息服务
        // 只请求 user:address:read 权限
        $profileToken = $this->tokenExchange->exchangeToken(
            subjectToken: $userToken,
            targetAudience: config('services.profile.audience'),
            requestedScope: 'user:address:read'
        );

        $shippingAddress = $this->getUserAddress(
            $profileToken['access_token'],
            $user->id
        );

        // 第三步：交换令牌以调用支付服务
        // 只请求 payment:create 权限
        $paymentToken = $this->tokenExchange->exchangeToken(
            subjectToken: $userToken,
            targetAudience: config('services.payment.audience'),
            requestedScope: 'payment:create'
        );

        $paymentResult = $this->createPayment(
            $paymentToken['access_token'],
            $orderData['total'],
            $reservationResult['reservation_id']
        );

        // 第四步：创建订单记录
        $order = $this->saveOrder([
            'user_id'          => $user->id,
            'items'            => $orderData['items'],
            'total'            => $orderData['total'],
            'shipping_address' => $shippingAddress,
            'reservation_id'   => $reservationResult['reservation_id'],
            'payment_id'       => $paymentResult['payment_id'],
        ]);

        return $order;
    }

    private function reserveInventory(string $token, array $items): array
    {
        $response = $this->httpClient->post(
            config('services.inventory.url') . '/api/reserve',
            [
                'headers' => [
                    'Authorization' => "Bearer {$token}",
                ],
                'json' => ['items' => $items],
            ]
        );

        return json_decode($response->getBody()->getContents(), true);
    }

    private function getUserAddress(string $token, int $userId): array
    {
        $response = $this->httpClient->get(
            config('services.profile.url') . "/api/users/{$userId}/default-address",
            [
                'headers' => [
                    'Authorization' => "Bearer {$token}",
                ],
            ]
        );

        return json_decode($response->getBody()->getContents(), true);
    }

    private function createPayment(string $token, float $amount, string $reservationId): array
    {
        $response = $this->httpClient->post(
            config('services.payment.url') . '/api/payments',
            [
                'headers' => [
                    'Authorization' => "Bearer {$token}",
                ],
                'json' => [
                    'amount'         => $amount,
                    'currency'       => 'CNY',
                    'reservation_id' => $reservationId,
                ],
            ]
        );

        return json_decode($response->getBody()->getContents(), true);
    }
}
```

注意看这段代码的安全性设计：Order Service 在调用库存服务时只获得了 `inventory:read inventory:reserve` 权限，调用用户信息服务时只获得了 `user:address:read` 权限，调用支付服务时只获得了 `payment:create` 权限。即使某个环节的令牌被截获，攻击者也只能执行非常有限的操作。这就是最小权限原则在实际代码中的体现。

### 3.9 下游服务的令牌验证

在 Inventory Service 等下游服务中，我们需要实现一个中间件来验证接收到的受限令牌。这个验证不仅仅是检查签名和过期时间，还需要验证 audience、scope 和 actor 等声明：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\SignatureInvalidException;
use Illuminate\Support\Facades\Log;

class ValidateServiceToken
{
    /**
     * 验证通过 Token Exchange 签发的服务间令牌
     *
     * 这个中间件执行以下验证：
     * 1. JWT 签名验证
     * 2. 令牌过期检查
     * 3. audience 验证（确保令牌是签发给本服务的）
     * 4. scope 验证（确保令牌包含所需权限）
     * 5. 记录审计日志（sub + act）
     */
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'error' => 'missing_token',
                'message' => 'Authorization token is required',
            ], 401);
        }

        try {
            // 获取公钥用于验证 JWT 签名
            $publicKey = config('auth.jwt_public_key');

            // 解码并验证 JWT
            $decoded = JWT::decode($token, new Key($publicKey, 'RS256'));

            // 验证 audience：确保这个令牌确实是签发给本服务的
            $expectedAudience = config('app.service_identifier');
            if (isset($decoded->aud) && $decoded->aud !== $expectedAudience) {
                Log::warning('Service token: audience mismatch', [
                    'expected' => $expectedAudience,
                    'received' => $decoded->aud,
                    'subject'  => $decoded->sub ?? 'unknown',
                ]);

                return response()->json([
                    'error' => 'invalid_audience',
                    'message' => 'This token was not issued for this service',
                ], 403);
            }

            // 验证 scope：检查令牌是否包含路由所需的权限
            $requiredScope = $this->getRequiredScope($request);
            $tokenScopes = isset($decoded->scope)
                ? explode(' ', $decoded->scope)
                : [];

            if ($requiredScope && !in_array($requiredScope, $tokenScopes)) {
                Log::warning('Service token: insufficient scope', [
                    'required'   => $requiredScope,
                    'available'  => $tokenScopes,
                    'subject'    => $decoded->sub ?? 'unknown',
                    'actor'      => $decoded->act->sub ?? 'unknown',
                ]);

                return response()->json([
                    'error' => 'insufficient_scope',
                    'message' => "Required scope: {$requiredScope}",
                ], 403);
            }

            // 将解析后的令牌信息注入到请求中
            // 下游的控制器和业务逻辑可以通过这些信息做进一步的权限判断
            $request->merge([
                'oauth_subject'  => $decoded->sub ?? null,
                'oauth_actor'    => $decoded->act->sub ?? null,
                'oauth_scopes'   => $tokenScopes,
                'oauth_audience' => $decoded->aud ?? null,
            ]);

            // 记录访问日志用于审计追踪
            $this->logAccess($request, $decoded);

            return $next($request);

        } catch (ExpiredException $e) {
            return response()->json([
                'error' => 'token_expired',
                'message' => 'The access token has expired',
            ], 401);
        } catch (SignatureInvalidException $e) {
            Log::error('Service token: invalid signature');
            return response()->json([
                'error' => 'invalid_token',
                'message' => 'Token signature validation failed',
            ], 401);
        } catch (\Exception $e) {
            Log::error('Service token: validation error', [
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'error' => 'invalid_token',
                'message' => 'Token validation failed',
            ], 401);
        }
    }

    /**
     * 从路由的 action 中获取所需的 scope
     */
    private function getRequiredScope(Request $request): ?string
    {
        return $request->route()->getAction('required_scope')
            ?? $request->route()->getAction('scope')
            ?? null;
    }

    /**
     * 记录服务间调用的审计日志
     */
    private function logAccess(Request $request, object $decoded): void
    {
        Log::info('Service access', [
            'subject'   => $decoded->sub ?? 'unknown',
            'actor'     => $decoded->act->sub ?? 'unknown',
            'audience'  => $decoded->aud ?? 'unknown',
            'scope'     => $decoded->scope ?? '',
            'method'    => $request->method(),
            'path'      => $request->path(),
            'ip'        => $request->ip(),
        ]);

        // 如果配置了审计日志数据库表，写入持久化记录
        if (config('app.service_audit_log_enabled', false)) {
            \App\Models\ServiceAccessLog::create([
                'subject'    => $decoded->sub ?? 'unknown',
                'actor'      => $decoded->act->sub ?? null,
                'audience'   => $decoded->aud ?? null,
                'scope'      => $decoded->scope ?? '',
                'path'       => $request->path(),
                'method'     => $request->method(),
                'ip_address' => $request->ip(),
                'accessed_at' => now(),
            ]);
        }
    }
}
```

在路由定义中使用这个中间件：

```php
Route::middleware(['service.auth'])->group(function () {
    // 需要 inventory:read 权限的路由
    Route::get('/api/stock/{sku}', [InventoryController::class, 'getStock'])
        ->middleware('required_scope:inventory:read');

    // 需要 inventory:reserve 权限的路由
    Route::post('/api/reserve', [InventoryController::class, 'reserve'])
        ->middleware('required_scope:inventory:reserve');

    // 需要 inventory:release 权限的路由
    Route::post('/api/release', [InventoryController::class, 'release'])
        ->middleware('required_scope:inventory:release');
});
```

---

## 四、Token Exchange vs Client Credentials Grant 深度对比

### 4.1 核心差异分析

在微服务架构中，Token Exchange 和 Client Credentials Grant 是两种最主要的服务间认证方式。理解它们的核心差异对于架构选型至关重要。

从用户上下文的角度来看，Client Credentials Grant 签发的令牌中不包含任何用户信息，`sub` 字段通常是客户端的 ID，代表的是"服务本身"在调用另一个服务。而 Token Exchange 签发的令牌保留了用户的身份，`sub` 字段是用户 ID，`act` 字段记录了代理服务的标识，代表的是"服务代表用户"在调用另一个服务。

从权限模型的角度来看，Client Credentials 的权限范围是在注册客户端时就固定配置好的，每次获取的令牌都包含相同的权限集合。而 Token Exchange 的权限范围是动态的，基于用户原始令牌的权限进行缩减。这意味着同一个服务在代表不同用户执行操作时，可能获得不同的权限集合——这正是我们想要的效果。

从适用场景来看，Client Credentials 适合无用户参与的纯后台任务，比如定时数据同步、日志清理、健康检查等。Token Exchange 适合需要代表用户执行操作的场景，比如前端发起的请求经过多个服务的处理链。

从安全审计的角度来看，Client Credentials 只能追踪到"是哪个服务"发起了请求，而 Token Exchange 可以追踪到"是哪个服务代表哪个用户"发起了请求。在需要满足合规要求的系统中，这种细粒度的审计能力是非常重要的。

### 4.2 选型决策指南

在实际项目中，我建议使用以下决策流程：

如果调用链中存在明确的终端用户，且下游服务需要根据用户身份做业务决策或审计记录，那么使用 Token Exchange。如果只是纯后台的系统级操作，没有任何用户参与，那么使用 Client Credentials。

有些场景可能两种方式都需要。比如在同一个 Order Service 中，"创建订单"这个操作需要代表用户调用下游服务，应该使用 Token Exchange；而"订单超时自动取消"这个定时任务没有用户参与，应该使用 Client Credentials。在这种混合场景下，我们在代码中根据是否有用户令牌来动态选择认证方式。

### 4.3 混合架构实现

```php
<?php

namespace App\Services\Auth;

class ServiceTokenManager
{
    private TokenExchangeService $exchangeService;
    private ClientCredentialService $clientCredentialService;

    /**
     * 智能令牌获取：根据上下文自动选择合适的认证方式
     */
    public function getTokenForService(
        string $serviceName,
        ?string $userToken = null,
        ?string $requiredScope = null
    ): string {
        // 如果有用户令牌，使用 Token Exchange
        // 这样下游服务能知道当前操作是代表哪个用户
        if ($userToken) {
            $result = $this->exchangeService->exchangeToken(
                $userToken,
                config("services.{$serviceName}.audience"),
                $requiredScope ?? config("services.{$serviceName}.default_scope")
            );
            return $result['access_token'];
        }

        // 否则使用 Client Credentials
        // 适用于后台任务、定时任务等无用户上下文的场景
        return $this->clientCredentialService->getToken(
            $serviceName,
            $requiredScope
        );
    }
}
```

---

## 五、安全最佳实践

### 5.1 令牌生命周期管理

Token Exchange 的核心安全策略之一是严格的令牌生命周期管理。交换后的令牌应该比原始令牌有更短的生命周期。这样做有几个好处：首先，即使令牌被泄露，攻击者能利用的时间窗口也非常短。其次，这迫使服务在每次长时间操作前重新交换令牌，确保了权限的时效性。第三，较短的 TTL 配合缓存策略，可以在安全性和性能之间取得平衡。

在实际配置中，我建议根据目标服务的敏感程度设置不同的 TTL。对于支付服务等高敏感度的目标，TTL 设置为 1 到 2 分钟。对于库存查询等中等敏感度的目标，TTL 设置为 3 到 5 分钟。对于报告生成等低敏感度的目标，TTL 可以设置为 10 到 15 分钟。

缓存策略也需要配合 TTL 来设计。建议缓存的 TTL 比令牌的 TTL 短 30 秒到 1 分钟，确保缓存过期时令牌还有少量有效期可供使用，避免在缓存刷新的瞬间出现请求失败的情况。

### 5.2 范围缩减策略

范围缩减是 Token Exchange 安全性的基石。在实现时需要注意几个细节：

第一，始终取交集。新令牌的 scope 必须是原始令牌 scope 的子集。如果请求的 scope 中有任何一个不在原始令牌中，应该拒绝整个请求而不是忽略那个无效的 scope。

第二，为 scope 设计合理的粒度。粒度过粗（如 `api:all`）会导致权限过大，失去最小权限的意义。粒度过细（如 `inventory:item:12345:read`）会导致 scope 数量爆炸，增加管理复杂度。建议按照"资源:操作"的格式设计，如 `inventory:read`、`payment:create`、`user:profile:write`。

第三，明确拒绝而非静默降级。当请求的 scope 全部不在原始令牌中时，应该返回 `invalid_scope` 错误，而不是返回一个空 scope 的令牌。静默降级会导致调试困难，开发者可能不理解为什么下游服务返回了 403 错误。

### 5.3 Audience 验证

Audience 限制是防止令牌跨服务滥用的关键机制。在实现时，建议为每个 OAuth 客户端维护一份 audience 白名单。Order Service 的客户端只能请求 Inventory Service 和 Payment Service 的 audience，而不能请求 Admin Service 的 audience。

在 JWT 令牌的验证端，下游服务必须验证 `aud` 声明是否匹配自己的服务标识符。这个验证不能省略，否则一个签发给 Inventory Service 的令牌可能被 Payment Service 接受，破坏了 audience 隔离。

### 5.4 防止交换链深度攻击

攻击者可能通过构造 A → B → C → D 这样的代理链来绕过安全检查。每一层交换都可能引入新的风险：范围缩减的累积误差、审计追踪的复杂度增加、调试困难等。

建议将最大交换深度设置为 2 到 3 层，并在审计日志中记录当前的交换深度。当检测到异常的深交换链时，应该触发安全告警。

在 JWT 令牌中记录 `exchange_count` 字段，每次交换时加一。当这个值超过配置的最大深度时，授权服务器应该拒绝交换请求。

### 5.5 审计日志设计

完善的审计日志是安全事件响应的基础。Token Exchange 的审计日志应该记录以下信息：交换发生的时间、发起交换的客户端、被交换的原始令牌的哈希值（注意不要存储原始令牌明文）、交换后获得的权限范围、目标 audience、用户的 IP 地址和 User-Agent、当前的交换深度。

同时，下游服务也应该记录每次收到 Token Exchange 令牌的访问日志，包括 subject（用户）、actor（代理服务）、scope 和访问的资源。这样在安全事件发生时，我们可以从两个方向追踪：从授权服务器看"谁交换了什么令牌"，从下游服务看"谁用什么令牌访问了什么资源"。

---

## 六、常见陷阱与踩坑记录

### 6.1 陷阱一：缓存导致的令牌不同步

在高并发场景下，TokenExchangeService 的缓存机制可能导致问题。假设用户刚刚修改了密码或者撤销了某个授权，但缓存中仍然存储着旧的交换令牌。下游服务使用这个旧令牌时可能不会报错，因为令牌还没有过期，但它代表的权限可能已经不再有效。

解决方案是使用短期缓存配合令牌版本号。在用户的权限发生变更时，递增用户的令牌版本号。在验证交换令牌时，检查其关联的用户令牌版本号是否匹配。

### 6.2 陷阱二：原始令牌过期但缓存未失效

如果缓存的 TTL 设置不当，可能出现这样的情况：缓存中的交换令牌还有 2 分钟有效期，但其关联的原始用户令牌已经过期了。从安全角度来看，这个交换令牌应该立即失效。

解决方案是在缓存的 TTL 计算中同时考虑原始令牌的过期时间：取两者中较短的那个。

### 6.3 陷阱三：Scope 设计不当导致权限泄露

在设计 scope 体系时，如果某些 scope 的含义过于宽泛，可能导致无意中的权限泄露。比如定义了一个 `data:read` 的 scope，它同时覆盖了用户数据、订单数据和财务数据的读取权限。当 Order Service 只需要读取订单数据时，却通过 Token Exchange 获得了读取所有数据的权限。

解决方案是按照业务领域和资源类型来设计 scope，避免出现跨领域的万能 scope。同时定期审查 scope 的定义，确保它们与实际的 API 端点权限一致。

### 6.4 陷阱四：忽略 CORS 和跨域安全

当 Token Exchange 用于前端发起的请求时，需要注意 CORS 配置。Token Exchange 端点不应该被任意域访问，应该限制为只允许已知的前端域。

### 6.5 陷阱五：错误信息泄露

在 Token Exchange 失败时，返回的错误信息可能泄露敏感信息。比如 "The subject token for user user-123 has been revoked" 这样的错误信息暴露了用户的 ID。应该返回通用的错误信息，将详细信息记录到服务端日志中。

---

## 七、数据库迁移与配置

### 7.1 Audience 白名单表

```php
Schema::create('oauth_client_allowed_audiences', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('client_id');
    $table->string('audience')->comment('目标服务标识符，如 https://inventory.example.com');
    $table->string('allowed_scopes')->nullable()->comment('允许交换的 scope，逗号分隔');
    $table->boolean('is_active')->default(true);
    $table->timestamps();

    $table->foreign('client_id')
          ->references('id')
          ->on('oauth_clients')
          ->onDelete('cascade');

    $table->unique(['client_id', 'audience']);
});
```

### 7.2 审计日志表

```php
Schema::create('token_exchange_logs', function (Blueprint $table) {
    $table->id();
    $table->string('client_id')->comment('发起交换的客户端 ID');
    $table->string('user_id')->nullable()->comment('用户标识');
    $table->string('subject')->comment('subject 标识');
    $table->string('subject_token_hash', 64)->comment('原始令牌的 SHA-256 哈希');
    $table->string('granted_scopes')->comment('实际授权的 scope');
    $table->string('audience')->nullable()->comment('目标服务标识');
    $table->unsignedSmallInteger('exchange_count')->default(1)->comment('交换深度');
    $table->string('ip_address', 45)->nullable();
    $table->string('user_agent')->nullable();
    $table->timestamp('exchanged_at');
    $table->timestamps();

    $table->index(['client_id', 'exchanged_at']);
    $table->index('user_id');
    $table->index('subject_token_hash');
});
```

---

## 八、完整流程图

下面用文字描述整个 Token Exchange 的完整流程，帮助大家建立全局视图：

当用户在客户端提交订单请求时，请求首先到达 API Gateway。API Gateway 验证用户的 Access Token 有效后，将请求转发给 Order Service，请求头中携带了 `Authorization: Bearer <user_token>`。

Order Service 收到请求后，需要调用 Inventory Service 来检查库存。它不会直接传递用户的令牌，而是调用 TokenExchangeService 的 exchangeToken 方法。TokenExchangeService 向 Auth Server 发送一个 Token Exchange 请求，请求体中包含 grant_type、subject_token（用户的令牌）、audience（Inventory Service 的标识符）和 scope（需要的权限范围）。

Auth Server 收到请求后，执行一系列验证：验证 Order Service 的客户端凭证是否正确，验证用户的 subject_token 是否有效且未过期，验证请求的 audience 是否在 Order Service 的白名单中，验证请求的 scope 是否在用户原始令牌的权限范围内。如果所有验证都通过，Auth Server 签发一个新的 JWT 令牌，这个令牌包含用户的 ID（sub）、Order Service 的标识（act）、Inventory Service 的标识（aud）和缩减后的权限范围（scope）。

TokenExchangeService 收到新令牌后，将其缓存起来（如果配置了缓存），然后返回给 Order Service。Order Service 使用这个受限令牌向 Inventory Service 发送请求。

Inventory Service 的 ValidateServiceToken 中间件拦截请求，解码 JWT 令牌，验证签名、过期时间、audience 和 scope。如果所有验证都通过，将请求传递给控制器处理。Inventory Service 的控制器可以通过 `request('oauth_subject')` 获取用户的 ID，通过 `request('oauth_actor')` 获取代理服务的标识，从而实现基于用户的权限控制和业务逻辑。

---

## 九、总结与展望

RFC 8693 Token Exchange 为微服务架构提供了一套标准化的、安全的令牌交换机制。在 Laravel 中实现 Token Exchange 虽然需要自定义 Grant Type，但通过 Passport 的扩展机制，整个过程是可控的、可维护的。

回顾本文的核心要点：

第一，最小权限是核心原则。通过范围缩减，下游服务只获得它实际需要的权限，即使令牌被泄露，影响也被限制在最小范围内。

第二，用户上下文不可丢失。通过 Subject/Actor 模型，我们在整个调用链中保留了用户的身份标识，使得审计追踪和基于用户的权限控制成为可能。

第三，安全需要多层防御。范围缩减、Audience 验证、交换深度限制、短 TTL、审计日志——这些措施共同构成了一个纵深防御体系。

第四，性能和安全需要平衡。通过合理的缓存策略和 TTL 配置，我们可以在不牺牲安全性的前提下获得良好的性能表现。

Token Exchange 不是万能的。在纯后台任务场景下，Client Credentials Grant 依然是更简单高效的选择。真正的架构智慧在于理解每种方案的适用场景，在系统设计中灵活组合使用。

随着零信任架构的普及和服务网格技术的成熟，Token Exchange 的重要性会进一步提升。未来我们可能会看到更多的授权服务器原生支持 RFC 8693，更多的框架提供内置的 Token Exchange 实现。但无论工具如何演进，最小权限、审计追踪和纵深防御这些核心安全原则是不变的。

---

## 相关阅读

- [OpenFGA 实战：细粒度授权引擎（Zanzibar 模型）——Laravel 中的关系型权限控制与 ReBAC 落地](/categories/架构/openfga-zanzibar-rebac-laravel/)
- [OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固](/categories/05_PHP/Laravel/OAuth-2.1-实战-从OAuth2.0到2.1的迁移指南-PKCE强制隐式流废弃与安全加固/)
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录](/categories/架构/API-安全加固实战-JWT-黑名单-请求签名-IP-白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
