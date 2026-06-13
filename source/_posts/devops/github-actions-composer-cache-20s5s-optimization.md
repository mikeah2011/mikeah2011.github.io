---

title: GitHub-Actions-Composer-Cache-构建时间从20s到5s-优化实战踩坑记录
keywords: [GitHub, Actions, Composer, Cache, 构建时间从, 优化实战踩坑记录]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-05 02:30:33
updated: 2026-05-05 02:31:49
categories:
- devops
- docker
tags:
- CI/CD
- Composer
- Laravel
- 性能优化
- 缓存
description: 在 Laravel B2C 项目中，通过 GitHub Actions 的 Composer 缓存策略，将 CI 构建时间从 20s 优化到 5s 的完整实战记录，涵盖 actions/cache、dependency caching、Lock 文件管理与踩坑经验。
---


# GitHub Actions + Composer Cache：构建时间从 20s→5s 的优化实战踩坑记录

> 在 KKday B2C 后端团队的 Laravel 项目中，每次 CI 跑流程都要花 20 秒以上等 Composer install，这对一天几十次提交的团队来说，累积的时间浪费是巨大的。本文记录了我们如何通过缓存策略把构建时间压到 5 秒以内的完整过程。

## 背景：为什么 Composer install 这么慢？

Laravel B2C API 项目的 `composer.json` 依赖了 100+ 个包，其中不乏大型框架包（如 Laravel Framework、Doctrine DBAL、PHPStan 等）。每次 CI 执行 `composer install`，都需要：

1. 解析依赖树（dependency resolution）
2. 下载所有包的 zip/tar
3. 解压到 `vendor/`
4. 生成 autoload 文件

```
┌─────────────────────────────────────────────────────────┐
│                   CI Pipeline 耗时分布                     │
├──────────────────────┬──────────────────────────────────┤
│  Checkout code       │  ~1s                             │
│  Setup PHP           │  ~3s                             │
│  Composer install    │  ~12s  ← 主要瓶颈！               │
│  PHPUnit tests       │  ~3s                             │
│  Static analysis     │  ~1s                             │
├──────────────────────┼──────────────────────────────────┤
│  Total               │  ~20s                            │
└──────────────────────┴──────────────────────────────────┘
```

Composer install 占了 60% 的时间，而其中「下载 + 解压」又是最大头。如果能复用上次构建的 `vendor/` 目录，就可以跳过这些步骤。

## 方案一：actions/cache 基础用法

最直接的思路是用 GitHub Actions 官方的 `actions/cache` 来缓存 `vendor/` 目录：

```yaml
# .github/workflows/ci.yml
name: Laravel CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
          extensions: mbstring, xml, ctype, json, bcmath, pdo_mysql, redis
          coverage: xdebug

      # ✅ 核心：缓存 vendor 目录
      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ runner.os }}-${{ hashFiles('**/composer.lock') }}
          restore-keys: |
            composer-${{ runner.os }}-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress

      - name: Run tests
        run: php artisan test --parallel
```

### 关键点解读

**`key` 的设计**：用 `composer.lock` 的 hash 作为缓存 key。这意味着：

- `composer.lock` 变了 → 新 key → 缓存失效 → 全量安装
- `composer.lock` 没变 → 命中缓存 → 跳过安装

**`restore-keys` 的回退**：如果精确 key 没命中，会用 `composer-Linux-` 前缀去匹配最近一次的缓存，这样即使 lock 文件小改，也能复用大部分 vendor 内容。

**效果**：第一次构建无缓存（~12s），后续构建命中缓存后 `composer install` 降到 **2-3s**。

## 方案二：Composer 官方推荐的缓存目录

上一种方案直接缓存整个 `vendor/` 目录，有时会遇到 autoload 残留问题。Composer 其实有官方的缓存目录：

```bash
# 查看 Composer 缓存目录
composer config cache-files-dir
# 输出类似：/home/runner/.composer/cache
```

更精准的做法是只缓存 Composer 的 **下载缓存**（zip 包），而不是整个 `vendor/`：

```yaml
      - name: Get Composer Cache Directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer packages
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: |
            ${{ runner.os }}-composer-

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --no-progress
```

### 两种方案对比

```
┌─────────────────────┬──────────────────┬──────────────────┐
│       维度           │  缓存 vendor/    │  缓存 cache-dir  │
├─────────────────────┼──────────────────┼──────────────────┤
│ 缓存大小            │  150-300MB       │  50-100MB        │
│ 命中后 install 时间  │  2-3s            │  4-6s            │
│ autoload 准确性     │  可能有残留       │  每次重新生成     │
│ lock 变化时回退表现  │  需全量重建       │  增量下载         │
│ 推荐场景            │  lock 文件稳定    │  lock 频繁变动    │
└─────────────────────┴──────────────────┴──────────────────┘
```

**我们的选择**：Laravel B2C 项目 lock 文件一周才变一次，直接缓存 `vendor/` 更快。Affiliate 项目依赖变动频繁，用 `cache-dir` 更稳。

## 踩坑记录：那些花了我们半天才定位的问题

### 踩坑 1：`vendor/` 缓存导致 autoload 类找不到

**现象**：缓存命中后跑 PHPUnit，报 `Class 'App\Models\XXX' not found`。

**原因**：我们用了 `composer install --no-scripts` 加速安装，但缓存的 `vendor/autoload.php` 是旧的，新增的 Model 类没被映射进去。

**修复**：

```yaml
      - name: Install dependencies
        run: |
          composer install --no-interaction --prefer-dist --no-progress
          # 强制重新生成 autoload
          composer dump-autoload --optimize
```

> ⚠️ 不要用 `--no-scripts` 来「加速」—— Laravel 的 post-autoload-dump 脚本（生成 service manifest 等）必须执行。

### 踩坑 2：`composer.lock` 与 `composer.json` 不一致

**现象**：本地开发更新了 `composer.json` 加了新包但没跑 `composer update`，CI 缓存命中旧 lock 文件，导致安装版本与预期不符。

**修复**：在 CI 中加一步校验：

```yaml
      - name: Validate composer.lock
        run: |
          composer validate --strict --no-check-all
          # 确保 lock 文件与 json 同步
          if [ -f composer.lock ]; then
            composer install --dry-run 2>&1 | grep -q "Nothing to install" || echo "::warning::composer.lock may be outdated"
          fi
```

### 踩坑 3：缓存大小超出 GitHub 限制（10GB）

**现象**：多个分支的缓存累积后，老缓存被自动淘汰，导致 `develop` 分支经常缓存 miss。

**原因**：GitHub Actions 缓存上限 10GB（per repo），每个 OS + lock hash 组合都是一份缓存。

**修复**：

```yaml
      # 在 CI 结束时清理无用缓存
      - name: Cleanup old caches
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const caches = await github.rest.actions.getActionsCacheList({
              owner: context.repo.owner,
              repo: context.repo.repo,
              per_page: 100,
              sort: 'created_at',
              direction: 'asc'
            });
            // 保留最近 20 个，删除旧的
            const toDelete = caches.data.actions_caches.slice(0, -20);
            for (const cache of toDelete) {
              await github.rest.actions.deleteActionsCacheById({
                owner: context.repo.owner,
                repo: context.repo.repo,
                cache_id: cache.id
              });
            }
```

### 踩坑 4：并行 Job 之间的缓存竞争

**现象**：我们有 3 个并行 Job（unit test / static analysis / lint），同时写入同一个 cache key，最后一个写入的覆盖了前面的。

**修复**：给每个 Job 加后缀区分：

```yaml
    strategy:
      matrix:
        include:
          - job: unit
            cache-suffix: unit
          - job: static
            cache-suffix: static

    steps:
      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ runner.os }}-${{ hashFiles('**/composer.lock') }}-${{ matrix.cache-suffix }}
```

## 最终优化效果

```
┌─────────────────────────────────────────────────────────┐
│              优化前 vs 优化后 Pipeline 对比                │
├──────────────────────┬──────────────┬───────────────────┤
│  Step                │  优化前       │  优化后            │
├──────────────────────┼──────────────┼───────────────────┤
│  Checkout            │  1s          │  1s                │
│  Setup PHP           │  3s          │  2s (有缓存)       │
│  Composer install    │  12s         │  2s (缓存命中)     │
│  PHPUnit             │  3s          │  3s                │
│  Static analysis     │  1s          │  1s                │
├──────────────────────┼──────────────┼───────────────────┤
│  Total               │  ~20s        │  ~5s (⚡ 快了 4x)  │
└──────────────────────┴──────────────┴───────────────────┘
```

按团队每天 30 次 CI 触发算：`(20s - 5s) × 30 = 450s/天 ≈ 7.5 分钟/天`，一个月省下 **2.5 小时**的等待时间。更关键的是开发者的心流不被打断。

## 完整 Workflow 参考

```yaml
# .github/workflows/ci-optimized.yml
name: Laravel CI (Optimized)

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.0']

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP ${{ matrix.php }}
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: mbstring, xml, ctype, json, bcmath, pdo_mysql, redis
          coverage: xdebug

      - name: Get Composer Cache Directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer packages
        uses: actions/cache@v4
        with:
          path: |
            vendor
            ${{ steps.composer-cache.outputs.dir }}
          key: composer-${{ runner.os }}-php${{ matrix.php }}-${{ hashFiles('**/composer.lock') }}
          restore-keys: |
            composer-${{ runner.os }}-php${{ matrix.php }}-

      - name: Install dependencies
        run: |
          composer install --no-interaction --prefer-dist --no-progress
          composer dump-autoload --optimize

      - name: Validate composer files
        run: composer validate --strict

      - name: Run PHPUnit
        run: php artisan test --parallel

      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --memory-limit=512M
```

## 总结

| 策略 | 适用场景 | 效果 |
|------|---------|------|
| 缓存 `vendor/` | lock 文件稳定的大项目 | 最快（2-3s） |
| 缓存 `cache-dir` | lock 文件频繁变动 | 较快（4-6s） |
| 两者结合 | 不确定情况 | 兼顾速度与稳定性 |
| `--prefer-dist` | 所有 CI 环境 | 下载更小更快 |
| `dump-autoload` | 缓存命中后 | 确保 autoload 正确 |

CI 优化不是一次性的事，而是一个持续观察、迭代的过程。建议先加 `actions/cache` 跑一周，观察缓存命中率（GitHub Actions → Insights → Caches），再针对性调整 key 策略。

## 常见 CI 缓存排查清单
在实际项目中，缓存策略上线后往往会遇到各种意想不到的问题。以下是我们团队在多个 Laravel 项目中总结出的排查清单，遇到缓存相关问题时可以逐项检查：
### 缓存命中率持续偏低
如果在 GitHub Insights → Caches 页面发现命中率低于 50%，优先排查以下几点：

- **key 包含了不稳定变量**：不要在 key 中使用 `github.run_id`、`github.run_number` 等每次构建都变化的变量，这会导致每次都是新缓存。正确的 key 应该基于 `composer.lock` 的 hash 值。
- **restore-keys 缺失或过于严格**：`restore-keys` 应该保留足够宽泛的前缀回退。如果设置得太精确，一旦 lock 文件变更就完全无法回退到旧缓存。
- **多分支缓存互相挤占**：GitHub Actions 的缓存按分支 scope 隔离，但缓存总量有 10GB 上限。如果团队分支很多，老分支的缓存会优先被清除。建议使用 `actions/cache/restore` 在 CI 开头读取主分支缓存作为回退源。
### 缓存命中但安装仍然很慢
缓存命中了 `vendor/` 目录，但 `composer install` 仍然耗时 8-10 秒？常见原因：

- **lock 文件变更导致全量解析**：即使 vendor 目录已缓存，`composer.lock` 变化后 Composer 仍会重新解析依赖树。建议在缓存命中时使用 `composer install --no-scripts` 跳过脚本执行，但前提是项目不依赖 post-install-cmd 生成的文件。
- **缺少 `--prefer-dist` 参数**：没有这个参数，Composer 会尝试从源码安装而非下载 zip 包，速度差距可达 3-5 倍。在 CI 环境中应该始终加上 `--prefer-dist`。
- **autoload 生成耗时**：大型项目的 `composer dump-autoload --optimize` 可能需要 2-3 秒。如果项目对 autoload 优化没有强需求，可以去掉 `--optimize` 参数。
### 缓存导致构建结果不一致
这是最隐蔽的问题——缓存命中后测试通过，但清缓存后测试失败，或反过来。排查方向：

- **版本漂移**：缓存的 `vendor/` 中某些包版本与 lock 文件不一致。确保 key 严格绑定 `composer.lock` 的完整 hash，不要用模糊匹配。
- **平台扩展变化**：如果 `phpunit.xml` 或环境变量因 CI 配置变更而不同，缓存的 vendor 可能不兼容。建议在 key 中加入 `php-version` 后缀。
- **IDE 和本地环境同步问题**：本地开发者执行了 `composer update` 但没有提交 lock 文件，CI 缓存中仍是旧版本。团队应约定：修改 `composer.json` 后必须一并提交 `composer.lock`。
### 缓存大小的实用经验值
不同项目类型的缓存大小参考：

| 项目规模 | composer.json 包数 | vendor/ 目录大小 | cache-dir 大小 | 建议策略 |
|---------|-------------------|-----------------|---------------|---------|
| 小型项目 | 20-40 个 | 30-60 MB | 10-20 MB | 两者皆可，差异不大 |
| 中型项目（Laravel 标准） | 80-120 个 | 100-200 MB | 40-80 MB | 缓存 vendor/ 更快 |
| 大型企业项目 | 200+ 个 | 300-500 MB | 100-200 MB | 缓存 vendor/ + 限制分支缓存量 |

当缓存总量接近 GitHub 的 10GB 限制时，优先清理 `cache-dir` 而非 `vendor/` 缓存，因为后者对安装速度的提升更直接。

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录](/categories/CI_CD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地](/categories/CI_CD/Trunk-Based-Development-深度实战-Feature-Flag-替代长生命周期分支的工程化落地/)
- [PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 的组合拳——从代码风格到架构规范的 CI 门禁](/categories/CI_CD/PR-Review-Checklist-自动化实战-Danger-js-lint-staged-Husky组合拳-CI门禁/)
