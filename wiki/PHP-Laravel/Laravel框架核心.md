# Laravel 框架核心

## 定义
Laravel 是 PHP 最流行的全栈框架，以优雅的语法和强大的功能著称。博客中深度覆盖了服务容器、服务提供者、Facade、请求生命周期、12.x 新特性等核心机制。

## 核心原理

### 服务容器（Service Container）
- 依赖注入的核心引擎
- **绑定方式**：bind（每次新建）、singleton（单例）、instance（已有实例）
- **上下文绑定**：同一接口不同实现的条件注入
- **延迟加载**：defer 标记 + 提供者延迟解析
- **自动解析**：通过反射自动构造依赖链
- 10 个真实踩坑记录

### 服务提供者（Service Provider）
- register() 注册绑定，boot() 执行引导
- 延迟提供者（DeferrableProvider）
- 发现机制（Package Auto-Discovery）

### Facade
- 静态代理模式，底层调用容器中的实例
- __callStatic 魔术方法转发
- Real-time Facades（运行时将类转为 Facade）

### 请求生命周期
- public/index.php → Kernel::handle()
- HTTP Kernel 中间件栈 → 路由解析 → 控制器 → 响应
- Terminable 中间件与 afterResponse

### Laravel 12.x 新特性
- Context（请求级上下文传播）
- Concurrency facade（并发任务执行）
- Artisan 改进（命令注册简化）

### Controller-Service-Repository 模式
- Controller 薄：只负责请求/响应转换
- Service 厚：业务逻辑层
- Repository：数据访问抽象层
- 大项目职责分离实践

## 实战案例
来自博客文章：
- [Laravel 服务容器深度解析](/categories/PHP-Laravel/laravel-container/) - 10 个真实踩坑记录
- [Service Container 实战](/categories/PHP-Laravel/service-container-guide/) - 依赖注入、上下文绑定、延迟加载
- [Controller-Service-Repository 三层架构](/categories/PHP-Laravel/controller-service-repository/) - 大项目职责分离
- [Controller 薄 + Service 厚](/categories/PHP-Laravel/controller-service-laravel/) - 职责分离踩坑
- [Laravel 12.x 新特性](/categories/PHP-Laravel/2026-06-01-laravel-12x-new-features/) - Context、Concurrency、Artisan

## 相关概念
- [PHP 语言基础](PHP语言基础.md) - OOP、反射、自动加载
- [路由与中间件](路由与中间件.md) - 请求管道的前半段
- [架构模式](架构模式.md) - DDD、CQRS、六边形架构
- [性能优化](性能优化.md) - Octane 常驻内存对容器的影响

## 常见问题
- **什么时候用 singleton vs bind？** 无状态服务用 singleton（省资源），有状态或需要隔离的用 bind
- **Facade 到底好不好？** 测试方便（可 mock），但隐藏了依赖关系，大型项目建议用依赖注入替代
- **Provider 的 register 和 boot 有什么区别？** register 只做绑定，boot 中可以使用其他已注册的服务
