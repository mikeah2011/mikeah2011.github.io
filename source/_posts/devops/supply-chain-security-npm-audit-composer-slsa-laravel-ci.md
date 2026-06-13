---

title: Supply Chain Security 实战：npm audit + composer audit + SLSA 框架——Laravel 全栈项目的供应链安全治理与
keywords: [Supply Chain Security, npm audit, composer audit, SLSA, Laravel, 全栈项目的供应链安全治理与]
date: 2026-06-06 18:00:00
tags:
- 供应链安全
- SLSA
- npm audit
- composer audit
- CI/CD
- Laravel
- 安全
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文以真实 Laravel 全栈项目为例，系统讲解供应链安全治理的四大核心维度：使用 npm audit 和 composer audit 进行依赖漏洞扫描、许可证合规检查、SLSA 框架保障构建完整性、以及 GitHub Actions CI 门禁集成。涵盖从基础用法到高级配置的完整代码示例，包含 Dependency Confusion 防护、lock 文件管理、SBOM 生成等实战踩坑案例，帮助团队建立从开发到部署的全链路供应链安全防线。
---




## 前言：供应链攻击已成为头号威胁

2025 年，供应链攻击在 OWASP Top 10 中的排名持续攀升。从 `event-stream` 事件到 `ua-parser-js` 恶意包注入，再到 `Log4Shell` 的深远影响，每一次都在提醒我们：**你自己的代码可能是安全的，但你依赖的几百个包呢？**

一个典型的 Laravel 全栈项目，`composer.json` 可能引入 80-150 个 PHP 包，`package.json` 可能引入 200-500 个 npm 包。任何一个包被劫持、注入恶意代码，你的生产服务器就等于对攻击者敞开了大门。

本文将以一个真实的 Laravel B2C 项目为例，从**漏洞扫描、许可证合规、构建完整性、CI 门禁**四个维度，构建一套完整的供应链安全治理体系。

---

## 一、理解供应链攻击面

### 1.1 依赖链的层级风险

```
你的 Laravel 项目
├── laravel/framework (直接依赖)
│   ├── symfony/http-foundation (间接依赖)
│   │   └── symfony/polyfill-* (更深层依赖)
│   └── nesbot/carbon
├── guzzlehttp/guzzle
│   └── psr/http-client
└── npm 前端依赖树 (可能 500+ 个包)
```

**关键认知**：你安装一个包，实际上信任的是整个依赖链。攻击者不需要攻破顶层包，只需攻破某个深层的小众依赖。

### 1.2 常见攻击向量

| 攻击向量 | 示例 | 影响 | 防御手段 |
|---------|------|------|---------|
| 包劫持（Typosquatting） | `laravle/framework` vs `laravel/framework` | 恶意代码执行 | 人工审查 + 自动化检查包名 |
| 维护者账号被盗 | `event-stream` 事件 | 后门注入 | 2FA + 签名验证 |
| 依赖混淆（Dependency Confusion） | 内部包名与公开包名冲突 | 代码泄露 | 命名空间前缀 + 私有仓库配置 |
| 恶意 postinstall 脚本 | npm `preinstall`/`postinstall` 钩子 | 服务器被控 | `--ignore-scripts` + 审查脚本 |
| 锁文件篡改 | 修改 `composer.lock` 中的 hash | 供应链替换 | Git 签名 + CI 校验 |

### 1.3 供应链安全工具全景对比

在选择工具之前，先了解主流方案的能力矩阵：

| 工具 | 漏洞扫描 | 许可证检查 | 行为分析 | SBOM 生成 | CI 集成 | 价格 |
|------|---------|-----------|---------|----------|--------|------|
| `npm audit` | ✅ 基于 Advisory DB | ❌ | ❌ | ❌ | 原生支持 | 免费 |
| `composer audit` | ✅ 基于 Packagist | ❌ | ❌ | ❌ | 原生支持 | 免费 |
| Snyk | ✅ 深度扫描 | ✅ | ✅ 部分 | ✅ | 优秀 | 免费层 + 付费 |
| Socket.dev | ✅ 行为分析 | ✅ | ✅ 核心能力 | ❌ | GitHub App | 免费层 + 付费 |
| Trivy | ✅ 多生态 | ✅ | ❌ | ✅ | 优秀 | 开源免费 |
| OWASP Dependency-Check | ✅ NVD 数据库 | ❌ | ❌ | ✅ | 一般 | 开源免费 |
| Grype | ✅ 多数据库 | ✅ | ❌ | ✅ | 优秀 | 开源免费 |

> 💡 **选型建议**：小团队用 `npm audit` + `composer audit` 兜底，中大型团队推荐 Snyk 或 Socket.dev 作为主力，Trivy/Grype 用于容器镜像扫描的补充。

---

## 二、Composer Audit：PHP 依赖漏洞扫描

### 2.1 基本用法

Composer 2.4+ 内置了 `audit` 命令，基于 [Packagist 安全公告数据库](https://packagist.org/)：

```bash
# 扫描已安装依赖的已知漏洞
composer audit

# 输出示例：
# Found 2 security vulnerabilities in 2 packages
# Package: guzzlehttp/guzzle
# CVE: CVE-2022-31042
# Title: CURLOPT_HTTPAUTH header leak on HTTP downgrade
# Severity: medium
```

### 2.2 CI 集成：将 audit 设为门禁

在 GitHub Actions 中，将 `composer audit` 设为必经检查：

```yaml
# .github/workflows/security-audit.yml
name: Security Audit

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    # 每天凌晨 3 点扫描，捕获新披露的 CVE
    - cron: '0 3 * * *'

jobs:
  composer-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2

      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Composer Audit (fail on any vulnerability)
        run: composer audit --no-dev --format=json | jq .
        # 如果有漏洞，exit code 非零，CI 自动失败
```

### 2.3 高级配置：忽略与例外

某些低风险漏洞短期内无法修复，可以配置忽略：

```json
// composer.json
{
    "config": {
        "audit": {
            "abandoned": "report" // or "ignore"
        }
    },
    "extra": {
        "audit": {
            "allow-list": {
                "CVE-2022-XXXXX": "仅影响 dev 依赖，生产环境不使用此功能"
            }
        }
    }
}
```

> ⚠️ **最佳实践**：忽略必须附带原因和过期日期，在 CI 中用脚本检查过期的忽略项。

---

## 三、npm audit：前端依赖安全扫描

### 3.1 npm audit 基础

```bash
# 扫描 package-lock.json 中的已知漏洞
npm audit

# 输出 JSON 格式（便于 CI 解析）
npm audit --json

# 仅关注 high 和 critical 级别
npm audit --audit-level=high
```

### 3.2 npm audit 的坑与应对

**问题 1：dev 依赖的误报**

生产环境的容器不包含 devDependencies，但 `npm audit` 不区分：

```bash
# 仅审计生产依赖
npm audit --omit=dev
```

**问题 2：大量低质量 advisory 噪音**

某些 advisory 质量参差不齐，可以使用 `overrides` 强制升级：

```json
// package.json
{
    "overrides": {
        "semver": "^7.5.2",
        "got": "^12.0.0"
    }
}
```

**问题 3：无法自动修复的漏洞**

```bash
# 尝试自动修复
npm audit fix

# 如果有 breaking changes，强制修复（谨慎使用）
npm audit fix --force
```

### 3.3 更强的选择：npm audit + Socket.dev

[Socket.dev](https://socket.dev/) 通过行为分析检测供应链攻击，不依赖已知 CVE 数据库：

```bash
# 安装 Socket CLI
npm install -g @socketsecurity/cli

# 扫描项目
socket npm audit
```

Socket 可以检测到：
- 新增的网络请求（可能的数据外泄）
- 文件系统读写（可能的后门）
- 环境变量访问（凭证窃取）
- Shell 命令执行（恶意脚本）

### 3.4 npm postinstall 脚本安全防护

`postinstall` 是 npm 包最常见的攻击载体之一。攻击者通过在 `postinstall` 阶段执行恶意脚本，可以在你运行 `npm install` 时窃取环境变量、植入后门。

**防御方案 1：全局禁用脚本执行**

```bash
# .npmrc
ignore-scripts=true
```

然后在需要的包中显式允许：

```json
// package.json
{
    "scripts": {
        "prepare": "husky install"
    }
}
```

**防御方案 2：审计所有 postinstall 脚本**

```bash
# 列出所有包含 postinstall 的包
npm ls --all --json | jq -r '.. | .dependencies? // empty | to_entries[] | select(.value.scripts.postinstall != null) | .key'

# 或使用 npq 在安装前预审查
npx npq install
```

`npq` 会在安装每个包之前展示：包的下载量、最后更新时间、是否有 postinstall 脚本、已知漏洞等信息，让你在安装前做出判断。

**防御方案 3：使用 npm allowlist**

```json
// package.json
{
    "config": {
        "ignore-scripts": true
    },
    "scripts": {
        "postinstall": "npm rebuild --ignore-scripts=false --allowlist=esbuild,sharp"
    }
}
```

> ⚠️ **真实踩坑**：我们曾遇到一个间接依赖 `node-gyp` 相关包在 CI 中因 `ignore-scripts=true` 导致 native addon 编译失败。解决方法是只对生产容器禁用脚本，CI 构建环境保留脚本执行但配合 Socket.dev 监控。

### 3.5 npm audit 结果分级处理策略

面对大量漏洞报告，盲目全修不现实。建议按以下优先级分级处理：

| 优先级 | 条件 | 处理方式 | SLA |
|--------|------|---------|-----|
| P0 紧急 | Critical + 生产依赖 + 有公开 EXP | 立即升级或临时下线 | 4 小时 |
| P1 高 | High + 生产依赖 | 48 小时内修复 | 48 小时 |
| P2 中 | Medium + 生产依赖 | 下一个 Sprint 修复 | 1 周 |
| P3 低 | Low / 仅 dev 依赖 | 积压处理 | 1 个月 |
| 忽略 | 已知误报 / 不影响运行路径 | 记录原因，定期复查 | 季度审查 |

```bash
# 生成 JSON 报告并用 jq 过滤 Critical + High
npm audit --json | jq '[.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high")] | length'

# 输出 Critical 和 High 漏洞数量，非零则失败
CRITICAL_HIGH=$(npm audit --json | jq '[.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high")] | length')
if [ "$CRITICAL_HIGH" -gt 0 ]; then
  echo "❌ Found $CRITICAL_HIGH critical/high vulnerabilities"
  exit 1
fi
```

---

## 四、许可证合规：不只是安全问题

### 4.1 Composer 许可证检查

```bash
# 检查所有依赖的许可证
composer licenses --format=json

# 不允许的许可证列表（GPL 等 copyleft 许可证在商业项目中需谨慎）
composer licenses --no-dev | grep -i "GPL"
```

### 4.2 npm 许可证检查

```bash
# 使用 license-checker
npm install -g license-checker

# 列出所有许可证
license-checker --summary

# 检查是否有不允许的许可证
license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"
```

### 4.3 CI 中的许可证门禁

```yaml
  license-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check Composer Licenses
        run: |
          composer licenses --no-dev --format=json | \
          jq -r '.dependencies | to_entries[] | .value.license[]' | \
          grep -iE "GPL|AGPL" && echo "::error::Copyleft license found!" && exit 1 || echo "Licenses OK"
      - name: Check npm Licenses
        run: |
          npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"
```

---

## 五、SLSA 框架：构建完整性保障

### 5.1 SLSA 是什么

[SLSA（Supply-chain Levels for Software Artifacts）](https://slsa.dev/) 是 Google 提出的供应链安全框架，定义了 4 个安全级别：

| 级别 | 要求 | 适用场景 |
|------|------|---------|
| SLSA 1 | 构建过程有文档记录 | 最低要求 |
| SLSA 2 | 使用托管构建服务，生成出处（Provenance） | 大多数项目 |
| SLSA 3 | 构建过程防篡改，来源可验证 | 高安全要求 |
| SLSA 4 | 双人复核，可复现构建 | 关键基础设施 |

### 5.2 为 Laravel 项目生成 SLSA Provenance

使用 GitHub 的官方 SLSA 生成器：

```yaml
# .github/workflows/slsa-build.yml
name: SLSA Provenance

on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      hashes: ${{ steps.hash.outputs.hashes }}
    steps:
      - uses: actions/checkout@v4
      - name: Build assets
        run: |
          composer install --no-dev --prefer-dist
          npm ci && npm run build
      - name: Generate subject hashes
        id: hash
        run: |
          set -euo pipefail
          # 生成构建产物的 sha256
          HASHES=$(sha256sum dist.tar.gz | base64 -w0)
          echo "hashes=$HASHES" >> "$GITHUB_OUTPUT"

  provenance:
    needs: build
    permissions:
      actions: read
      id-token: write
      contents: write
    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.0.0
    with:
      base64-subjects: "${{ needs.build.outputs.hashes }}"
```

### 5.3 验证 Provenance

消费者可以验证构建产物的完整性：

```bash
# 安装 slsa-verifier
go install github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@latest

# 验证下载的 artifact
slsa-verifier verify-artifact dist.tar.gz \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/your-org/your-laravel-app \
  --source-tag v1.2.3
```

### 5.4 Sigstore 与 Cosign：镜像签名验证

SLSA 解决了构建过程的可追溯性，而 [Sigstore](https://www.sigstore.dev/) 则提供了构件的密码学签名能力。两者结合使用可以实现端到端的供应链完整性验证。

```yaml
# .github/workflows/cosign-sign.yml
name: Sign Docker Image

on:
  push:
    tags: ['v*']

jobs:
  build-and-sign:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write  # 关键：用于 keyless 签名
    steps:
      - uses: actions/checkout@v4

      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      - name: Build Docker Image
        run: |
          docker build -t ghcr.io/${{ github.repository }}:${{ github.ref_name }} .
          docker push ghcr.io/${{ github.repository }}:${{ github.ref_name }}

      - name: Sign Image (Keyless / Fulcio)
        env:
          COSIGN_EXPERIMENTAL: "1"
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
          # 使用 Fulcio 提供的短期证书，无需管理长期密钥

      - name: Verify Signature
        run: |
          cosign verify \
            --certificate-identity-regexp=".*" \
            --certificate-oidc-issuer-regexp=".*" \
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```

**在 Kubernetes 部署时强制验证签名**：

```yaml
# 使用 Kyverno 策略强制验证镜像签名
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-cosign-signature
      match:
        resources:
          kinds:
            - Pod
      verifyImages:
        - imageReferences:
            - "ghcr.io/your-org/*"
          attestors:
            - entries:
                - keyless:
                    subject: "https://github.com/your-org/your-laravel-app/*"
                    issuer: "https://token.actions.githubusercontent.com"
```

### 5.5 SLSA 各级别落地路径

对于不同阶段的团队，SLSA 的落地是一个渐进过程：

| 当前水平 | 目标级别 | 具体行动 | 预计投入 |
|---------|---------|---------|---------|
| 无任何措施 | SLSA 1 | 记录构建脚本，使用 CI 系统 | 1-2 天 |
| 使用 CI 构建 | SLSA 2 | 启用 Provenance 生成，托管构建服务 | 1 周 |
| SLSA 2 完成 | SLSA 3 | 签名验证 + 防篡改 + 部署准入控制 | 2-4 周 |
| 关键基础设施 | SLSA 4 | 双人复核 + 可复现构建 + 形式化验证 | 持续投入 |

---

## 六、完整 CI 安全门禁方案

将以上所有检查整合到一个完整的 CI 流水线：

```yaml
# .github/workflows/supply-chain-security.yml
name: Supply Chain Security Gate

on:
  push:
    branches: [main, develop]
  pull_request:
  schedule:
    - cron: '0 3 * * *'  # 每日定时扫描

jobs:
  php-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2
      - run: composer install --no-interaction --prefer-dist
      - name: Composer Audit
        run: composer audit --no-dev --format=json > composer-audit.json
      - name: Upload Audit Result
        uses: actions/upload-artifact@v4
        with:
          name: composer-audit
          path: composer-audit.json

  npm-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: npm Audit (production only)
        run: npm audit --omit=dev --audit-level=high
      - name: License Check
        run: npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"

  dependency-review:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          deny-licenses: GPL-2.0, GPL-3.0, AGPL-3.0

  # 安全门禁通过后才允许部署
  security-gate:
    needs: [php-security, npm-security, dependency-review]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Check all security jobs
        run: |
          if [ "${{ needs.php-security.result }}" != "success" ] || \
             [ "${{ needs.npm-security.result }}" != "success" ]; then
            echo "::error::Security gate failed!"
            exit 1
          fi
          echo "✅ All security checks passed"
```

---

## 七、依赖版本锁定策略

### 7.1 Composer 锁文件管理

```bash
# 开发环境：宽松约束
composer require "laravel/framework:^11.0"

# 部署时：严格安装（基于 composer.lock）
composer install --no-dev --prefer-dist --no-interaction

# 关键：永远不要在 CI/CD 中使用 composer update
# 应该使用 composer install 确保版本一致性
```

### 7.2 npm 锁文件管理

```json
// .npmrc
package-lock=true
save-exact=true
engine-strict=true
```

```bash
# 永远使用 npm ci 而非 npm install（在 CI 环境）
npm ci --omit=dev
```

### 7.3 Dependabot 配置

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
    reviewers:
      - "security-team"
    labels:
      - "dependencies"
      - "security"
    # 自动合并 patch 级别的更新
    groups:
      laravel:
        patterns: ["laravel/*"]
      symfony:
        patterns: ["symfony/*"]

  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
```

---

## 八、生产环境的安全加固

### 8.1 构建产物扫描

```bash
# 在 Docker 构建阶段扫描
RUN npm audit --omit=dev --audit-level=high || exit 1
RUN composer audit --no-dev || exit 1
```

### 8.2 运行时监控

```bash
# 使用 Socket.dev 持续监控
npx @socketsecurity/cli monitor

# 或使用 Snyk 运行时代理
docker run -e SNYK_TOKEN=$SNYK_TOKEN snyk/cli monitor
```

### 8.3 SBOM 生成

```bash
# 生成 CycloneDX 格式的 SBOM
composer require --dev cyclonedx/cyclonedx-php-composer
vendor/bin/cyclonedx-php-composer --output-file sbom.json

# npm SBOM
npm sbom --sbom-format cyclonedx > npm-sbom.json
```

### 8.4 Laravel 特有的供应链安全注意事项

Laravel 框架有一些特殊的依赖关系和运行机制，需要额外关注：

**Artisan 命令注册的安全风险**

Laravel 的 Service Provider 机制会在应用启动时自动执行，如果恶意包通过 Composer 安装后注册了 ServiceProvider，它可以在每次请求时执行任意代码。

```php
// 检查所有自动发现的 ServiceProvider
php artisan package:discover

// 审查 config/app.php 中手动注册的 providers
// 确保没有未知的 provider
```

**Laravel Mix / Vite 构建链审计**

前端构建工具链（Vite、Laravel Mix）会执行大量 npm 包的构建脚本，是供应链攻击的高风险区域：

```bash
# 审查 Vite 插件的安全性
npm ls --all | grep -i vite

# 检查是否有可疑的 Vite 插件
npm audit --omit=dev

# Vite 配置文件中禁止加载未知来源的插件
# vite.config.ts 中只使用官方和知名社区插件
```

**Queue Worker 和 Scheduler 的依赖安全**

Laravel 的队列任务和定时任务会在后台持续运行，如果被注入恶意代码，攻击者可以获得持久化的执行权限：

```php
// 在 AppServiceProvider 中检查运行环境
public function boot()
{
    // 生产环境禁用 Composer 的 autoload 优化回退
    // 确保只加载经过审计的类
    if (app()->isProduction()) {
        // 使用 --classmap-authoritative 防止动态类加载
        // composer dumpautoload --classmap-authoritative
    }
}
```

```bash
# 部署时使用权威类映射，防止动态 autoload 被利用
composer dumpautoload --classmap-authoritative --no-dev
```

### 8.5 Docker 镜像中的供应链安全加固

将供应链安全检查集成到 Docker 多阶段构建中：

```dockerfile
# Dockerfile — 多阶段构建 + 安全扫描
FROM composer:2.8 AS composer-deps
WORKDIR /app
COPY composer.json composer.lock ./
# 安装前先审计
RUN composer audit --no-dev && \
    composer install --no-dev --prefer-dist --no-scripts --no-autoloader

FROM node:20-alpine AS npm-deps
WORKDIR /app
COPY package.json package-lock.json ./
# 安装前先审计（只关注 high 和 critical）
RUN npm audit --omit=dev --audit-level=high && \
    npm ci --omit=dev

FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY --from=npm-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM php:8.3-fpm-alpine AS production
WORKDIR /var/www/html
COPY --from=composer-deps /app/vendor ./vendor
COPY --from=frontend-build /app/public/build ./public/build
COPY . .

# 最终镜像中再次审计（双保险）
RUN composer audit --no-dev || echo "Warning: vulnerabilities found"

# 使用非 root 用户运行
RUN adduser -D -s /bin/sh www-data
USER www-data
```

> 💡 **关键实践**：在构建的**前端**（安装前审计）和**后端**（最终镜像审计）都做扫描，形成双重保障。即使某个数据源延迟，另一个也可能捕获到。

---

## 九、踩坑记录

### 坑 1：Composer audit 在 CI 中误报 dev 依赖

**现象**：CI 中 `composer audit` 扫描到 dev 依赖的漏洞，导致构建失败，但生产环境并不使用这些包。

**解决**：使用 `--no-dev` 参数：

```bash
composer audit --no-dev
```

### 坑 2：npm audit fix 导致 breaking changes

**现象**：`npm audit fix --force` 自动将某个包从 v2 升级到 v3，导致构建失败。

**解决**：使用 `--dry-run` 预览变更，手动评估影响：

```bash
npm audit fix --dry-run
# 确认无 breaking changes 后再执行
npm audit fix
```

### 坑 3：Dependabot PR 合并冲突

**现象**：多个 Dependabot PR 同时修改 `composer.lock`，合并时冲突。

**解决**：配置 Dependabot groups，将同组依赖的更新合并为一个 PR：

```yaml
groups:
  all-production:
    patterns: ["*"]
    update-types: ["minor", "patch"]
```

### 坑 4：内部包名与公开包冲突（Dependency Confusion）

**现象**：公司内部 Composer 私有仓库的包名与 Packagist 上的公开包同名。

**解决**：使用 `repository` 配置明确指定包来源：

```json
{
    "repositories": [
        {
            "type": "composer",
            "url": "https://packages.company.com",
            "canonical": false
        },
        {
            "type": "composer",
            "url": "https://repo.packagist.org",
            "canonical": true
        }
    ]
}
```

### 坑 5：npm audit 报告大量 unmaintained 警告

**现象**：`npm audit` 输出中充斥大量 `Package no longer supported` 警告，真正有漏洞的包淹没在噪音中。

**解决**：区分 `advisory`（安全公告）和 `unmaintained`（无人维护）两类警告：

```bash
# 只关注有安全公告的漏洞，忽略 unmaintained 警告
npm audit --json | jq '[.vulnerabilities | to_entries[] | select(.value.via | type == "array" and (any[] | type == "object"))] | length'

# 使用 Socket.dev 获取更精准的评估
npx @socketsecurity/cli audit --severity moderate
```

### 坑 6：composer.lock 的 hash 校验与 CI 不一致

**现象**：本地开发环境 `composer install` 正常，但 CI 报 `Lock file is not up to date` 错误。

**根因**：不同 Composer 版本对 lock 文件的 hash 算法不同，或 `composer.json` 中的 `config.platform` 配置不一致。

**解决**：

```bash
# 统一 CI 和本地的 Composer 版本
composer self-update --2

# 检查 lock 文件 hash
composer validate --no-check-publish --no-check-lock

# CI 中明确指定 PHP 版本和 Composer 版本
- uses: shivammathur/setup-php@v2
  with:
    php-version: '8.3'
    tools: composer:2.8.4  # 锁定具体版本
```

### 坑 7：npm ci 在 monorepo 中安装不完整

**现象**：在 Laravel + 前端混合的 monorepo 中，`npm ci` 只安装了根目录的依赖，workspace 包的依赖缺失。

**解决**：

```bash
# 确保 npm workspace 配置正确
# package.json
{
    "workspaces": [
        "resources/js",
        "resources/css"
    ]
}

# CI 中使用 --workspaces 标志
npm ci --workspaces --if-present
```

### 坑 8：Composer audit 数据库延迟导致新 CVE 漏报

**现象**：某个包刚刚发布了安全公告，但 `composer audit` 没有检测到。

**根因**：Packagist 安全数据库同步有延迟（通常几小时到 1-2 天）。

**解决**：结合多个数据源进行交叉验证：

```yaml
# 多数据源扫描策略
- name: Composer Audit (Packagist DB)
  run: composer audit --no-dev

- name: OSV Scanner (Google OSV Database)
  run: |
    curl -sSf https://google.github.io/osv-scanner/install.sh | sh
    ./osv-scanner --lockfile=composer.lock

- name: Trivy File Scan (NVD + 多数据库)
  run: |
    trivy fs --security-checks vuln --scanners vuln .
```

---

## 十、安全治理的组织层面

### 10.1 安全评审 Checklist

每次引入新依赖前，评估以下维度：

- [ ] 维护者是否可信？（GitHub star、commit 历史、组织认证）
- [ ] 最近一次更新是什么时候？（超过 6 个月未更新的包要警惕）
- [ ] 是否有已知 CVE？
- [ ] 许可证是否与项目兼容？
- [ ] 是否有 postinstall 脚本？
- [ ] 依赖链是否过于复杂？
- [ ] npm 周下载量是否足够？（低于 1000 的要谨慎）
- [ ] 是否有 CI/CD 和测试覆盖率信息？
- [ ] 包的 README 是否完整？是否有安全策略文档（SECURITY.md）？

### 10.2 安全事件响应流程

1. **监控**：Dependabot + 定时 `composer audit` + `npm audit`
2. **评估**：确认 CVE 是否影响你的使用场景
3. **修复**：升级到安全版本 → 更新 lock 文件 → CI 验证
4. **部署**：紧急安全补丁走快速通道
5. **复盘**：记录到安全事件日志，评估是否需要架构调整

### 10.3 自动化安全报告与通知

将安全扫描结果自动推送到团队沟通工具，避免信息孤岛：

```yaml
# .github/workflows/security-report.yml
name: Daily Security Report

on:
  schedule:
    - cron: '0 9 * * 1-5'  # 工作日早上 9 点

jobs:
  security-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2
      - run: composer install --no-interaction --prefer-dist

      - name: Run Composer Audit
        id: composer-audit
        run: |
          RESULT=$(composer audit --no-dev --format=json 2>&1) || true
          VULN_COUNT=$(echo "$RESULT" | jq '.advisories | length' 2>/dev/null || echo "0")
          echo "vuln_count=$VULN_COUNT" >> "$GITHUB_OUTPUT"
          echo "$RESULT" > composer-audit-report.json

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci

      - name: Run npm Audit
        id: npm-audit
        run: |
          RESULT=$(npm audit --omit=dev --json 2>&1) || true
          VULN_COUNT=$(echo "$RESULT" | jq '.metadata.vulnerabilities.high + .metadata.vulnerabilities.critical' 2>/dev/null || echo "0")
          echo "vuln_count=$VULN_COUNT" >> "$GITHUB_OUTPUT"

      - name: Send Slack Notification
        if: steps.composer-audit.outputs.vuln_count != '0' || steps.npm-audit.outputs.vuln_count != '0'
        uses: slackapi/slack-github-action@v1.25.0
        with:
          payload: |
            {
              "text": "🔒 *每日安全扫描报告*\n• PHP 漏洞: ${{ steps.composer-audit.outputs.vuln_count }} 个\n• npm 漏洞 (High+Critical): ${{ steps.npm-audit.outputs.vuln_count }} 个\n• <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|查看详情>"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_SECURITY_WEBHOOK }}
```

### 10.4 安全治理成熟度模型

将供应链安全治理分为五个成熟度等级，帮助团队定位当前水平并规划提升路径：

| 等级 | 名称 | 特征 | 典型做法 |
|------|------|------|---------|
| L1 | 无意识 | 没有任何供应链安全措施 | 仅手动 `npm install`，不审查依赖 |
| L2 | 被动响应 | 漏洞曝光后才手动修复 | 偶尔运行 `npm audit`，手动处理 |
| L3 | 主动防御 | CI 集成安全扫描门禁 | `composer audit` + `npm audit` 在 CI 中强制执行 |
| L4 | 体系化治理 | 完整的工具链 + 流程 + 组织保障 | SBOM + 许可证合规 + SLSA + 自动通知 |
| L5 | 持续优化 | 数据驱动的安全改进 | 安全指标看板 + 定期复盘 + 攻防演练 |

> 🎯 **大多数团队的目标**：达到 L3 级别（CI 门禁集成）只需要 1-2 天的工作量，是性价比最高的提升。从 L3 到 L4 需要 2-4 周的组织协调。本文的全部内容覆盖了从 L2 到 L4 的完整路径。

---

## 总结

供应链安全不是一次性任务，而是一个持续的治理过程。对于 Laravel 全栈项目：

| 维度 | 工具 | 频率 |
|------|------|------|
| 漏洞扫描 | `composer audit` + `npm audit` | 每次 CI + 每日定时 |
| 许可证合规 | `composer licenses` + `license-checker` | 每次 PR |
| 依赖更新 | Dependabot / Renovate | 持续 |
| 构建完整性 | SLSA Provenance | 每次发版 |
| 运行时监控 | Socket.dev / Snyk | 持续 |

记住一句话：**你发布的代码的安全性，等于你最弱的那个依赖的安全性**。

---

## 相关阅读

- [Dependabot vs Renovate 实战：依赖自动更新策略——Laravel / Node.js 自动 PR 与安全补丁工作流](/categories/运维/Dependabot-vs-Renovate-实战-依赖自动更新策略-Laravel-Node-js自动PR与安全补丁工作流/) —— 本文提到的 Dependabot 配置只是冰山一角，深入了解两种主流依赖更新工具的全面对比与最佳实践
- [容器安全扫描实战：Trivy + Snyk + Grype CI 集成——镜像漏洞检测、SBOM 生成与修复工作流](/categories/运维/容器安全扫描实战-Trivy-Snyk-Grype-CI集成-镜像漏洞检测-SBOM生成与修复工作流/) —— 将供应链安全延伸到容器镜像层面，配合本文的 SLSA 框架实现端到端安全
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件踩坑记录](/categories/运维/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) —— 将本文的安全检查封装为可复用的 GitHub Actions，在团队内统一推广

---

*参考资料：*
- [SLSA 官方文档](https://slsa.dev/)
- [npm 官方安全文档](https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities)
- [Composer Audit 文档](https://getcomposer.org/doc/03-cli.md#audit)
- [OpenSSF Scorecard](https://securityscorecards.dev/)
- [GitHub Dependency Review Action](https://github.com/actions/dependency-review-action)
