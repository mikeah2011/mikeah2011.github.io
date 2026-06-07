# OPcache 调优

## 定义

OPcache 是 PHP 的字节码缓存扩展，将编译后的 opcode 缓存到共享内存中，避免每次请求重新编译。

## 工作原理

```
PHP 源码 → Lexer → Parser → AST → Opcode → 执行
                         ↑
                    OPcache 缓存这一步的结果
```

## 生产环境配置

```ini
; php.ini
opcache.enable=1
opcache.memory_consumption=256          ; 共享内存大小（MB）
opcache.interned_strings_buffer=64      ; 内部字符串缓冲区
opcache.max_accelerated_files=10000     ; 最大缓存文件数
opcache.validate_timestamps=0           ; 生产环境关闭文件检查
opcache.revalidate_freq=0               ; 配合 validate_timestamps=0
opcache.save_comments=1                 ; 保留注解（Laravel 需要）
opcache.fast_shutdown=1                 ; 快速关闭
opcache.enable_cli=0                    ; CLI 模式不启用
```

## 缓存预热（Warmup）

```php
// 预热脚本：启动时遍历常用文件触发编译
$files = glob('app/**/*.php');
foreach ($files as $file) {
    opcache_compile_file($file);
}
```

### OPcache Reset

```php
opcache_reset();  // 清除所有缓存（部署后调用）
opcache_invalidate($file, true);  // 清除单个文件
```

## 性能提升

| 场景 | 提升幅度 |
|------|----------|
| 开启 OPcache | 2-5x |
| `validate_timestamps=0` | +10-20% |
| PHP 8.x JIT | +5-30%（视场景） |

## 踩坑记录

- **部署后代码不生效**：`validate_timestamps=0` 时需手动 `opcache_reset()`
- **内存不足**：`memory_consumption` 设太小，部分文件无法缓存
- **CLI 不生效**：`enable_cli=0`，CLI 脚本每次重新编译

## 实战案例

来自博客文章：[OPcache 配置实战](/categories/PHP/opcache-guide-php-common/) | [OpCache 调优](/categories/PHP/php-opcache-guide-high-concurrencyoptimization/) | [OPcache 缓存预热](/categories/05_PHP/Laravel/2026-06-01-php-opcache-production-config-cache-preheating-strategies/)

## 相关概念

- [生命周期与 SAPI](生命周期与SAPI.md) - OPcache 在 FPM/Swoole 中的角色
- [Octane 与 Swoole](Octane与Swoole.md) - 常驻进程的缓存策略

## 常见问题

**Q: 为什么 OPcache 在开发环境要关？**
A: 开发环境代码频繁变动，OPcache 会缓存旧代码。可设 `validate_timestamps=1`。

**Q: OPcache 和 Redis 缓存有什么区别？**
A: OPcache 缓存的是编译后的字节码（PHP→opcode）；Redis 缓存的是业务数据。
