# Composer 深度实战

## 定义

Composer 是 PHP 的依赖管理工具，负责包安装、自动加载、版本约束和脚本执行。

## 核心概念

### 自动加载（PSR-4）

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "app/"
        },
        "files": ["app/helpers.php"]
    }
}
```

运行 `composer dump-autoload` 生成映射表。

### 版本约束

```json
{
    "require": {
        "laravel/framework": "^10.0",    // >=10.0 <11.0
        "guzzlehttp/guzzle": "~7.0",     // >=7.0 <8.0
        "monolog/monolog": "2.*",        // >=2.0 <3.0
        "php": "^8.1"                    // PHP 版本约束
    }
}
```

### Composer 脚本

```json
{
    "scripts": {
        "post-autoload-dump": [
            "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
            "@php artisan package:discover"
        ],
        "post-install-cmd": [
            "@php artisan clear-compiled"
        ],
        "test": "php artisan test",
        "lint": "phpstan analyse"
    }
}
```

## 常用命令

```bash
composer install                 # 安装依赖（读 composer.lock）
composer update                  # 更新依赖（重新解析版本）
composer require package/name    # 添加依赖
composer remove package/name     # 移除依赖
composer dump-autoload           # 重新生成自动加载映射
composer show --tree             # 查看依赖树
composer outdated                # 查看过时的包
```

## 私有仓库

```json
{
    "repositories": [
        {
            "type": "composer",
            "url": "https://packages.example.com",
            "options": {
                "http-basic": {
                    "packages.example.com": {
                        "username": "token",
                        "password": "xxx"
                    }
                }
            }
        }
    ]
}
```

## 插件开发

```php
class MyPlugin implements PluginInterface {
    public function activate(Composer $composer, IOInterface $io): void {
        // 注册事件监听器
        $eventDispatcher = $composer->getEventDispatcher();
        $eventDispatcher->addListener(
            ScriptEvents::POST_INSTALL_CMD,
            [$this, 'onPostInstall']
        );
    }
}
```

## 踩坑记录

- **composer.lock 不提交**：生产环境和开发环境版本不一致 → 必须提交
- **autoload 缓存**：添加新类后 `composer dump-autoload` 才生效
- **版本冲突**：两个包要求同一依赖的不同版本 → 检查 `composer why-not`
- **内存不足**：`COMPOSER_MEMORY_LIMIT=-1 composer update`

## 实战案例

来自博客文章：[Composer 深度实战](/categories/PHP/composer-deep-dive-autoloading/) | [Composer 脚本实战](/categories/PHP/composer-guide-automationtestingdeployment/) | [Composer autoload 优化](/categories/PHP/composer-autoload/)

## 相关概念

- [自动加载](自动加载.md) - PHP 自动加载演进历程
- [静态分析工具](静态分析工具.md) - Composer 脚本集成 PHPStan
- [代码风格与重构](代码风格与重构.md) - Composer 脚本集成 Pint/Rector

## 常见问题

**Q: install 和 update 有什么区别？**
A: `install` 按 `composer.lock` 安装确定版本；`update` 重新解析依赖，可能升级版本。

**Q: 如何加速 Composer？**
A: 使用国内镜像（`composer config repo.packagist composer https://mirrors.aliyun.com/composer/`）。
