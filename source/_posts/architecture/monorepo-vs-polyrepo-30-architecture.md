---

title: Monorepo vs Polyrepo：30+ 仓库架构选型与管理经验
keywords: [Monorepo vs Polyrepo, 仓库架构选型与管理经验]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 06:30:55
updated: 2026-05-05 06:33:13
categories:
- architecture
tags:
- CI/CD
- Composer
- Git
- Laravel
- macOS
- 工程管理
- 微服务
description: 基于 KKday B2C 团队 30+ Git 仓库的真实管理经验，深度对比 Monorepo 与 Polyrepo 的优劣势、决策框架与混合架构选型策略。涵盖 Git filter-repo 历史保留合并、Composer Path Repository 配置、GitHub Actions CI/CD 路径检测矩阵策略、Docker 多阶段构建、Sparse Checkout 优化等完整迁移踩坑记录与最佳实践。
---


# Monorepo vs Polyrepo：30+ 仓库架构选型与管理经验

## 前言

在 KKday B2C Backend Team，我们维护着 30+ 个 Git 仓库——从核心 API 服务、BFF 层、共享 Composer 包，到 OpenAPI Spec、CI 配置、部署脚本。这种 Polyrepo（多仓库）模式在团队扩张到一定规模后，逐渐暴露出依赖管理混乱、跨仓库变更困难、CI 配置重复等问题。

本文基于真实的 30+ 仓库管理经验，系统性对比 Monorepo 与 Polyrepo 的优劣势，并分享我们在评估迁移过程中的决策框架和踩坑记录。

## 架构全景：当前 Polyrepo 布局

```
GitHub Organization: kkday-backend
├── b2c-api                    # 核心 Laravel API 服务
├── b2c-bff                    # BFF 聚合层（Laravel）
├── b2c-admin                  # 后台管理 API
├── affiliate-api              # 联盟营销 API（Laravel + PostgreSQL）
├── shared-auth                # 认证共享包（Composer）
├── shared-utils               # 工具库（Composer）
├── shared-monitor             # 监控 SDK（Composer）
├── shared-log                 # 日志 SDK（Composer）
├── openapi-specs              # OpenAPI YAML 规范
├── infra-terraform            # Terraform 基础设施
├── infra-helm                 # Kubernetes Helm Charts
├── ci-templates               # GitHub Actions 复用模板
├── ...                        # 另有 20+ 仓库
```

### 多仓库带来的真实痛点

**痛点 1：蝴蝶效应式的依赖更新**

```
shared-utils v2.3.1 修复了一个 JSON 序列化 bug
  → b2c-api 需要更新 composer.json
  → b2c-bff 需要更新 composer.json
  → b2c-admin 需要更新 composer.json
  → affiliate-api 需要更新 composer.json
  → 4 个仓库各自发起 PR、各自跑 CI、各自合并
  → 总耗时：~2 小时（含等待 review）
```

**痛点 2：跨仓库 Feature 无法原子提交**

一个需求需要同时修改 `shared-auth`（新增 Scope）和 `b2c-api`（使用新 Scope），但这两个仓库的 PR 是独立的。如果 `shared-auth` 先合并但 `b2c-api` 还没上线，其他消费方可能会误用。

**痛点 3：CI 配置的「复制粘贴地狱」**

```yaml
# b2c-api/.github/workflows/ci.yml
# b2c-bff/.github/workflows/ci.yml
# b2c-admin/.github/workflows/ci.yml
# affiliate-api/.github/workflows/ci.yml
# 4 个仓库的 CI 配置 90% 相同，维护成本极高
```

## 方案对比：三种仓库架构模式

### 1. Polyrepo（多仓库）— 当前状态

```
优点                          缺点
✅ 仓库边界清晰               ❌ 依赖管理复杂（Composer 跨仓库）
✅ 权限隔离（按团队）          ❌ 跨仓库变更无法原子化
✅ 单仓库 clone 速度快         ❌ CI 配置大量重复
✅ 独立部署节奏                ❌ 共享包版本碎片化
```

### 2. Monorepo（单仓库）

```
优点                          缺点
✅ 原子提交（一次 PR 改多模块）  ❌ 仓库体积增长快
✅ 依赖自动解析                 ❌ 权限粒度粗（GitHub 无目录级权限）
✅ CI 配置统一                  ❌ 需要专用工具（Nx/Turborepo）
✅ 代码搜索/重构覆盖全          ❌ clone 时间长（需 sparse checkout）
```

### 3. Meta-repo + Git Submodule（中间路线）

```
优点                          缺点
✅ 保留独立仓库                 ❌ Submodule 是 Git 的"恶魔"
✅ 可锁定版本                   ❌ CI 需要额外处理 submodule 初始化
✅ 渐进式迁移                   ❌ 新人踩坑率极高
```

## 我们的决策框架

在评估是否迁移到 Monorepo 时，我们使用以下决策矩阵：

```
                    权重    Polyrepo    Monorepo    Meta-repo
代码复用频率         30%      3/10        9/10        6/10
跨服务变更频率       25%      2/10        9/10        5/10
团队规模             15%      7/10        5/10        6/10
CI/CD 工具成熟度     15%      8/10        6/10        6/10
部署独立性需求       15%      9/10        5/10        7/10
                    ----    ------      ------      ------
加权总分                    5.25/10     7.15/10     5.90/10
```

### 关键决策：混合策略

我们最终选择了 **「核心服务 Monorepo + 外围独立仓库」** 的混合策略：

```
Monorepo（合并后）：
├── services/
│   ├── b2c-api/
│   ├── b2c-bff/
│   ├── b2c-admin/
│   └── affiliate-api/
├── packages/
│   ├── shared-auth/
│   ├── shared-utils/
│   ├── shared-monitor/
│   └── shared-log/
├── specs/                    # OpenAPI YAML
├── infra/
│   ├── terraform/
│   └── helm/
└── .github/workflows/        # 统一 CI

独立仓库（保持不变）：
├── infra-terraform-prod      # 生产环境（安全隔离）
├── secrets-vault             # 密钥管理（权限隔离）
└── docs-confluence-export    # 文档备份
```

## 实战：从 Polyrepo 迁移到混合 Monorepo

### Step 1：保留 Git 历史的合并

```bash
# 关键：使用 git filter-repo 保留完整历史
# 以 shared-utils 为例

# 1. 克隆源仓库
git clone git@github.com:kkday-backend/shared-utils.git /tmp/shared-utils
cd /tmp/shared-utils

# 2. 将所有文件移动到子目录（保留历史）
git filter-repo --to-subdirectory-filter packages/shared-utils

# 3. 在 monorepo 中添加 remote 并合并
cd ~/monorepo
git remote add shared-utils /tmp/shared-utils
git fetch shared-utils
git merge shared-utils/main --allow-unrelated-histories

# 4. 解决冲突后移除 remote
git remote remove shared-utils
```

### Step 2：Composer Path Repository 配置

这是 Monorepo 中最关键的一环——让本地包互相引用：

```json
// monorepo/composer.json
{
    "repositories": [
        {
            "type": "path",
            "url": "packages/*",
            "options": {
                "symlink": true
            }
        }
    ],
    "require": {
        "kkday/shared-auth": "*",
        "kkday/shared-utils": "*",
        "kkday/shared-monitor": "*"
    }
}
```

```json
// monorepo/packages/shared-auth/composer.json
{
    "name": "kkday/shared-auth",
    "autoload": {
        "psr-4": {
            "KKday\\Shared\\Auth\\": "src/"
        }
    }
}
```

**踩坑记录 #1：Path Repository 的版本解析**

```
问题：`"kkday/shared-auth": "*"` 在 CI 环境报错
原因：Path repository 默认解析为 symlink，但 CI 用的是 `--no-symlink`
修复：统一使用 symlink，并在 CI 中配置：
```

```yaml
# .github/workflows/ci.yml
- name: Install dependencies
  run: |
    composer config repositories.local path 'packages/*'
    composer install --prefer-dist --no-progress
  env:
    COMPOSER_MIRROR_PATH_REPOS: 1  # 强制 symlink
```

### Step 3：统一 CI/CD 流水线

```
# 变更检测：只对有修改的模块跑 CI
# 使用 dorny/paths-filter 检测变更目录
```

```yaml
# .github/workflows/ci.yml
name: CI Pipeline
on:
  pull_request:
    branches: [main]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      services: ${{ steps.filter.outputs.services }}
      packages: ${{ steps.filter.outputs.packages }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            services:
              - 'services/**'
            packages:
              - 'packages/**'
            infra:
              - 'infra/**'

  test-services:
    needs: detect-changes
    if: needs.detect-changes.outputs.services == 'true' || needs.detect-changes.outputs.packages == 'true'
    strategy:
      matrix:
        service: [b2c-api, b2c-bff, b2c-admin, affiliate-api]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
      - name: Install ${{ matrix.service }}
        working-directory: services/${{ matrix.service }}
        run: composer install --prefer-dist
      - name: Test ${{ matrix.service }}
        working-directory: services/${{ matrix.service }}
        run: vendor/bin/pest --parallel
```

**踩坑记录 #2：矩阵策略的缓存冲突**

```
问题：4 个 service 并行跑 CI 时，Composer cache 偶尔互相覆盖
原因：所有 matrix job 共享同一个 cache key
修复：使用 service 名称作为 cache key 的一部分
```

```yaml
- name: Cache Composer
  uses: actions/cache@v4
  with:
    path: |
      services/${{ matrix.service }}/vendor
    key: composer-${{ matrix.service }}-${{ hashFiles('services/${{ matrix.service }}/composer.lock') }}
    restore-keys: |
      composer-${{ matrix.service }}-
```

### Step 4：共享包的发布策略

Monorepo 内部使用 path repository，但外部消费者（如第三方集成）仍然需要 Packagist 发布：

```php
// packages/shared-auth/.github/workflows/release.yml
// 当 shared-auth 有 tag 时，自动发布到 Packagist

name: Publish to Packagist
on:
  push:
    tags:
      - 'packages/shared-auth/v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Extract tag
        id: tag
        run: echo "version=${GITHUB_REF#packages/shared-auth/}" >> $GITHUB_OUTPUT
      - name: Notify Packagist
        run: |
          curl -XPOST -d '{"repository":{"url":"https://github.com/kkday-backend/shared-auth"}}' \
            https://packagist.org/api/update-package?username=$PACKAGIST_USER&apiToken=$PACKAGIST_TOKEN
```

## 混合模式下的目录规范

```
monorepo/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # 主 CI（路径检测 + 矩阵测试）
│   │   ├── deploy-staging.yml        # Staging 部署
│   │   └── deploy-production.yml     # Production 部署（手动触发）
│   ├── CODEOWNERS                    # 目录级 owner 定义
│   └── pull_request_template.md      # 统一 PR 模板
├── services/
│   ├── b2c-api/                      # 每个 service 有自己的 composer.json
│   ├── b2c-bff/
│   ├── b2c-admin/
│   └── affiliate-api/
├── packages/
│   ├── shared-auth/                  # 共享包，内部 symlink + 外部 Packagist
│   ├── shared-utils/
│   └── shared-monitor/
├── specs/
│   ├── b2c-api-v3.yaml
│   └── b2c-bff-v2.yaml
├── infra/
│   ├── terraform/
│   └── helm/
├── composer.json                     # Root composer（统一依赖管理）
├── phpstan.neon                      # 统一静态分析配置
├── phpunit.jenkins.xml               # 统一测试配置
└── README.md
```

### CODEOWNERS 配置

```
# .github/CODEOWNERS
/services/b2c-api/         @team-backend-api
/services/b2c-bff/         @team-backend-bff
/services/affiliate-api/   @team-affiliate
/packages/shared-auth/     @team-backend-api @team-security
/packages/shared-monitor/  @team-sre
/infra/terraform/          @team-sre
/.github/workflows/        @team-sre @team-devops
```

## 踩坑记录汇总

### 踩坑 #3：Git 仓库体积暴涨

```
问题：合并后仓库从各 50MB → 总计 800MB+（远超预期）
原因：每个子仓库的历史都包含了 vendor/ 的误提交
修复：使用 BFG Repo-Cleaner 清理历史中的大文件
```

```bash
# 清理历史中的 vendor 目录
java -jar bfg.jar --delete-folders vendor .

# 清理后的体积：800MB → 120MB
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 踩坑 #4：Sparse Checkout 拯救新人 onboarding

```
问题：新人 clone 整个 monorepo 要 3 分钟，本地磁盘占用 2GB+
方案：使用 Git sparse-checkout 只 checkout 需要的目录
```

```bash
# 新人只负责 b2c-api 开发
git clone --filter=blob:none --sparse git@github.com:kkday-backend/monorepo.git
cd monorepo
git sparse-checkout set services/b2c-api packages/shared-auth packages/shared-utils

# clone 时间：3 分钟 → 30 秒
# 磁盘占用：2GB → 200MB
```

### 踩坑 #5：Docker 构建上下文问题

```
问题：Dockerfile 在 services/b2c-api/ 下，但 COPY ../packages/ 会失败
原因：Docker build context 只能是当前目录或子目录
方案：使用多阶段构建 + build context 设为 monorepo root
```

```dockerfile
# services/b2c-api/Dockerfile
# 必须从 monorepo root 构建：
# docker build -f services/b2c-api/Dockerfile .

FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
COPY packages/ packages/
COPY services/b2c-api/composer.json services/b2c-api/

RUN cd services/b2c-api && composer install --no-dev --prefer-dist

FROM php:8.0-fpm
COPY --from=deps /app/services/b2c-api/vendor /var/www/vendor
COPY services/b2c-api/ /var/www/
COPY packages/ /var/www/packages/
```

```yaml
# GitHub Actions 中的构建
- name: Build Docker Image
  run: |
    docker build \
      -f services/b2c-api/Dockerfile \
      -t b2c-api:${{ github.sha }} \
      .  # ← 注意：context 是 monorepo root
```

### 踩坑 #6：Laravel Service Provider 自动发现冲突

```
问题：合并后，shared-auth 的 ServiceProvider 被自动加载了两次
原因：Laravel 的 auto-discovery 扫描了 vendor/ 和 packages/ 两个路径
修复：在 packages 的 composer.json 中禁用 auto-discovery
```

```json
// packages/shared-auth/composer.json
{
    "extra": {
        "laravel": {
            "providers": [],
            "aliases": {}
        }
    }
}
```

## 何时应该保持 Polyrepo？

Monorepo 不是银弹。以下场景建议保持 Polyrepo：

```
✅ 团队分布在不同时区，协作频率低
✅ 技术栈差异大（PHP + Go + Python）
✅ 部署频率差异大（核心 API 每天 vs 工具包每月）
✅ 安全合规要求严格的隔离（如 PCI-DSS 环境）
✅ 外部承包商需要有限的代码访问
```

## 总结：决策清单

```
在决定仓库架构前，回答以下 10 个问题：

1. 跨仓库变更的频率？（>1次/周 → 考虑 Monorepo）
2. 共享代码的消费方数量？（>3 个 → 考虑 Monorepo）
3. 团队规模？（<10 人 → Monorepo 更简单）
4. CI/CD 工具是否支持路径检测？（GitHub Actions ✓）
5. 是否需要目录级权限隔离？（是 → 考虑 Polyrepo）
6. 技术栈是否统一？（不统一 → Polyrepo）
7. 部署节奏是否一致？（不一致 → 需要独立 CI pipeline）
8. 是否有 SRE 团队维护 Monorepo 工具链？（无 → 慎重）
9. 仓库历史是否干净？（有 vendor 误提交 → 先清理）
10. 是否接受迁移期间的 2-4 周混乱期？（不接受 → 渐进式迁移）
```

我们的最终选择是混合策略——核心服务 Monorepo + 安全敏感仓库独立。这不是最「纯粹」的方案，但它在代码复用效率和运维复杂度之间取得了最佳平衡。迁移过程中最意外的发现是：**Monorepo 最大的价值不是代码复用，而是让跨服务的重构变得可视化和可追溯**。

---

> 本文基于 KKday B2C Backend Team 的真实仓库管理经验总结。30+ 仓库的管理不是技术问题，而是团队协作问题——技术方案只是载体。

## 相关阅读

- [Git Worktree + Bare Repo 实战：多分支并行开发——Laravel 大型项目中同时处理多个 feature 的高效工作流](/categories/CICD/Git-Worktree-Bare-Repo-实战-多分支并行开发-Laravel大型项目高效工作流/)
- [Git Hooks 深度实战：Husky/lint-staged/lefthook 选型——代码风格、提交规范与 CI 门禁的自动化治理](/categories/CICD/Git-Hooks-深度实战-Husky-lint-staged-lefthook-选型-代码风格提交规范与CI门禁的自动化治理/)
- [Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布](/categories/CICD/Conventional-Commits-Semantic-Release-实战-自动版本号-CHANGELOG生成与npm-Composer包发布/)
- [Git Flow vs Trunk-Based：30+ 仓库的分支策略选型与踩坑记录](/categories/架构/git-flow-vs-trunk-based-30/)
- [微服务拆分策略：从单体 Laravel 到微服务的渐进式演进踩坑记录](/categories/架构/microservices-laravelmicroservices/)
