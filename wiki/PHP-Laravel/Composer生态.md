# Composer 生态

## 定义
Composer 是 PHP 的依赖管理工具，也是现代 PHP 项目的基础设施。博客中覆盖了自动加载、插件开发、私有仓库、脚本自动化等主题。

## 核心原理

### 自动加载机制
- **PSR-4**：命名空间与目录结构的标准映射
- **classmap**：扫描类文件生成映射表，性能更优
- **files**：无命名空间的函数/辅助文件加载
- composer dump-autoload 与优化选项（-o）

### 插件开发
- Composer Plugin API
- 自定义安装器（Custom Installer）
- 包类型（library、project、metapackage、composer-plugin）

### 私有仓库配置
- repositories 配置（VCS、Composer、Path）
- Private Packagist / Satis / Toran Proxy
- GitLab/GitHub 私有包认证

### Composer 脚本
- pre-install-cmd / post-install-cmd
- pre-autoload-dump / post-autoload-dump
- 自定义脚本与事件钩子
- 与 CI/CD 流水线集成

### 安全审计
- composer audit 依赖漏洞检查
- roave/security-advisories 安全锁
- Lock 文件的重要性

## 实战案例
来自博客文章：
- [Composer 深度实战](/categories/PHP-Laravel/composer-deep-dive-autoloading/) - 自动加载、插件开发、私有仓库
- [Composer 脚本实战](/categories/PHP-Laravel/composer-guide/) - 自动化构建、测试、部署
- [Supply Chain Security 实战](/categories/DevOps/Supply-Chain-Security/) - npm audit + composer audit + SLSA

## 相关概念
- [PHP 语言基础](PHP语言基础.md) - 自动加载、命名空间
- [Laravel 框架核心](Laravel框架核心.md) - Service Provider 注册机制
- [代码质量治理](代码质量治理.md) - PHPStan、Pint 与 Composer 集成
- [部署与运维](部署与运维.md) - 生产环境依赖管理

## 常见问题
- **composer install 和 composer update 的区别？** install 按 lock 文件安装，update 重新解析依赖并更新 lock 文件
- **为什么生产环境要用 --no-dev？** 排除开发依赖（PHPUnit、PHPStan 等），减小包体积
- **autoload dump 什么时候需要跑？** 修改了 composer.json 的 autoload 配置后需要重新 dump
