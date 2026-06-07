---
title: 'Supply Chain Security 实战：npm audit + composer audit + SLSA 框架——Laravel 全栈项目的供应链安全治理与 CI 门禁'
date: 2026-06-06 10:00:00
tags: [供应链安全, npm audit, composer audit, SLSA, CI/CD, Laravel]
description: "全面实战指南：从 npm audit、composer audit 到 SLSA 框架，手把手教你为 Laravel 全栈项目构建供应链安全治理体系。涵盖依赖漏洞扫描、CI/CD 安全门禁、SBOM 生成、Provenance 校验与 Dependabot 自动更新，附完整 GitHub Actions Pipeline 配置。"
categories: [DevOps, CI/CD]
cover: /images/covers/supply-chain-security-cover.jpg
---

## 引言：为什么供应链安全是 2024-2026 最热门的安全话题

2021 年 12 月爆发的 Log4Shell（CVE-2021-44228）将一个严峻的事实推到了所有开发者的面前：**你的软件有多安全，取决于你依赖的最弱一环**。这个藏身于 Apache Log4j 日志库中的远程代码执行漏洞，影响了全球超过 40% 的 Java 生态系统，从 Minecraft 服务器到企业级 ERP 系统无一幸免。攻击者只需要一行 JNDI 注入字符串，就能在受害者服务器上执行任意代码。

如果 Log4Shell 让人意识到"已知漏洞"的可怕，那么 2024 年 3 月的 **xz-utils 后门事件**则揭示了更深层的恐惧——**开源供应链的核心维护者可以被社会工程学攻陷**。攻击者 "Jia Tan" 用近两年的时间逐步获取了 xz-utils 的提交权限，在 liblzma 中植入后门（CVE-2024-3094），使受影响版本的 SSH 服务器可以被远程绕过认证。幸运的是，一位 Microsoft 工程师 Andres Freund 在性能排查时偶然发现了异常。如果后门进入了稳定版 Linux 发行包，后果将不堪设想。

进入 2025-2026 年，供应链攻击的态势愈发严峻：

- **PyPI/npm 恶意包潮**：安全公司 Socket 和 Phylum 每月报告数百个 typosquatting 恶意包，从窃取环境变量到植入 cryptominer，手段层出不穷。
- **GitHub Actions 供应链攻击**：2025 年 3 月，多个流行的第三方 Action（如 tj-actions/changed-files）被发现存在供应链篡改风险，攻击者可以通过修改上游 Action 在 CI/CD 流水线中注入恶意代码。
- **容器镜像投毒**：公共 Docker Hub 上的恶意镜像持续增长，部分镜像下载量超过百万。

这一切让 **Supply Chain Security（供应链安全）** 从一个边缘安全概念跃升为 DevSecOps 的核心议题。美国白宫在 2021 年发布行政令 14028（Executive Order on Improving the Nation's Cybersecurity），明确要求联邦供应商提供 SBOM（软件物料清单）并采用安全软件开发实践。NIST 随后发布了 Secure Software Development Framework（SSDF），而 Google 主导的 SLSA 框架则为供应链完整性提供了可量化的分级标准。

本文将以一个 **Laravel 全栈项目**（PHP 后端 + Node.js 前端构建）为例，从实战角度完整覆盖供应链安全治理的三大支柱：**漏洞扫描**（npm audit + composer audit）、**构建完整性**（SLSA 框架）、**持续监控**（Dependabot + SBOM），并在最后给出一套可直接复用的 GitHub Actions CI 安全门禁 Pipeline。

---

## 一、供应链攻击面分析

在开始实战之前，我们必须先理解 Laravel 全栈项目面临的供应链攻击面。一个典型的 Laravel 项目通常包含以下依赖来源：

| 依赖来源 | 工具链 | 典型数量 | 攻击面 |
|---------|--------|---------|-------|
| PHP 依赖 | Composer / Packagist | 80-200 个包 | typosquatting, 包劫持, 维护者沦陷 |
| Node.js 依赖 | npm / yarn | 500-2000+ 个包（含嵌套依赖） | 依赖混淆, 恶意脚本, install script |
| 容器基础镜像 | Docker Hub | 5-10 个镜像 | 基础镜像投毒, CVE 漏洞 |
| CI/CD Actions | GitHub Marketplace | 5-20 个 Action | Action 篡改, pin 绕过 |
| 系统级依赖 | apt/yum | 若干 | repo 劫持 |

### 1.1 依赖混淆（Dependency Confusion）

2021 年安全研究员 Alex Birsan 演示了依赖混淆攻击：通过在公共 npm/PyPI 上发布与企业内部包同名但版本号更高的包，利用包管理器的默认解析策略优先下载公共包。对于 Laravel 项目，如果你的 `composer.json` 或 `package.json` 引用了未在公共仓库发布的内部包名，攻击者可以在 Packagist 或 npm 上抢注同名包。

**防御措施**：
- 使用 scoped packages（如 `@your-org/package`）
- 在 `.npmrc` 中配置 `registry` 限制
- 在 `composer.json` 中显式声明 `repositories` 优先级

### 1.2 Typosquatting（拼写错误劫持）

攻击者注册与流行包名极其相似的包名，等待开发者手误输入。例如：

- `laravel-framwork`（正确：`laravel/framework`）
- `exrpess`（正确：`express`）
- `cross-envv`（正确：`cross-env`）

npm 生态尤其容易受到此类攻击，因为 npm 包名不区分大小写且允许嵌套依赖引入。

### 1.3 恶意包注入

攻击者通过以下方式将恶意代码注入合法包：

1. **维护者账户被盗**：通过钓鱼邮件获取 npm/PyPI 维护者的发布凭证
2. **Protestware**：维护者故意在包中加入破坏性代码（如 node-ipc 事件）
3. **postinstall 脚本**：npm 的 lifecycle scripts 在安装时自动执行，可以被滥用

### 1.4 构建时攻击（Build-time Attack）

即使源代码是安全的，构建过程也可能被篡改：

- CI/CD 流水线中的缓存投毒
- 构建环境的环境变量泄露
- 构建产物在传输过程中被替换
- GitHub Actions 的 `pull_request_target` 事件触发的脚本注入

理解了这些攻击面，我们就可以有针对性地在 CI 流水线中部署防御措施。

---

## 二、npm audit 实战

npm audit 是 Node.js 生态中最基础也最重要的安全扫描工具。它将项目中安装的依赖版本与 GitHub Advisory Database 中的已知漏洞进行比对。

### 2.1 基础用法与 lockfile 的重要性

```bash
# 在项目根目录执行
npm audit

# 输出 JSON 格式（适合 CI 解析）
npm audit --json

# 只报告 high 和 critical 级别漏洞
npm audit --audit-level=high
```

**lockfile 是 npm audit 的基础**。没有 `package-lock.json`，npm audit 无法确定你实际安装的是哪些版本。确保以下配置：

```json
// package.json
{
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "preinstall": "npx only-allow npm",
    "audit:ci": "npm audit --audit-level=high --json"
  }
}
```

**关键原则**：`package-lock.json` 必须提交到版本控制系统。这是可重复构建和安全审计的前提。

### 2.2 npm audit fix 与 overrides

```bash
# 自动修复（更新到安全版本）
npm audit fix

# 强制修复（可能包含 breaking changes）
npm audit fix --force
```

当上游包尚未发布修复版本时，可以使用 `overrides` 强制指定安全版本：

```json
// package.json
{
  "overrides": {
    "semver": "^7.5.4",
    "got": "^11.8.6",
    "axios": "^1.7.4"
  }
}
```

`overrides` 是 npm 7+ 的特性，它会递归地将指定版本应用到整个依赖树，比传统的 `resolutions`（yarn）更直观。

### 2.3 audit-ci 集成

`audit-ci` 是专门为 CI/CD 设计的 npm audit 封装工具，支持白名单和更灵活的配置：

```bash
npm install --save-dev audit-ci
```

```json
// audit-ci.json
{
  "moderate": true,
  "allowlist": [
    {
      "GHSA-xxxx-yyyy-zzzz": {
        "active": true,
        "expiry": "2026-07-01",
        "notes": "等待 upstream 发布修复，仅影响 devDependencies"
      }
    }
  ],
  "report-type": "full",
  "skip-dev": true
}
```

```bash
# CI 中执行
npx audit-ci --config audit-ci.json
```

`audit-ci` 的优势在于：退出码准确（有漏洞返回非零码）、支持 allowlist 管理已知风险、可以跳过 devDependencies。对于 Laravel 项目中负责前端构建的 `package.json`，这是 CI 门禁的理想选择。

### 2.4 npm 漏洞分级与应急响应

npm audit 报告的漏洞严重级别与 CVSS 评分对应：

| 级别 | CVSS 范围 | 建议响应时间 |
|------|----------|------------|
| Critical | 9.0-10.0 | 24 小时内修复 |
| High | 7.0-8.9 | 7 天内修复 |
| Moderate | 4.0-6.9 | 30 天内修复 |
| Low | 0.1-3.9 | 下个 Sprint 处理 |

在 CI 门禁中，通常将 `high` 作为阻断门槛，`critical` 应触发即时告警（如 Slack 通知）。

---

## 三、composer audit 实战

Composer 2.4+ 内置了 `composer audit` 命令，这是 PHP 生态供应链安全的重要里程碑。此前，开发者需要依赖第三方工具如 Roave Security Advisories。

### 3.1 基础用法

```bash
# 扫描已安装的依赖
composer audit

# 输出 JSON 格式
composer audit --format=json

# 只报告特定严重级别
composer audit --no-dev  # 跳过 dev 依赖
```

`composer audit` 的数据来源是 [Packagist Security Advisories](https://packagist.org/advisories)，这是一个由 PHP 社区维护的集中式安全公告数据库。

### 3.2 composer.lock 安全检查

与 npm 类似，`composer.lock` 文件是安全审计的基础。它记录了每个依赖的精确版本和内容哈希（content-hash）：

```json
// composer.lock（节选）
{
    "packages": [
        {
            "name": "laravel/framework",
            "version": "v11.31.0",
            "source": {
                "type": "git",
                "url": "https://github.com/laravel/framework.git",
                "reference": "a1b2c3d4e5f6..."
            },
            "content-hash": "..."
        }
    ]
}
```

**content-hash 的安全意义**：当 `composer.lock` 的 content-hash 与 `composer.json` 不匹配时，Composer 会发出警告，提示锁文件可能过期。这在 CI 中可以用来检测依赖篡改：

```bash
# CI 中验证 lockfile 一致性
composer validate --no-check-all --no-check-publish
composer install --no-interaction --no-scripts --prefer-dist
```

### 3.3 私有仓库安全

Laravel 项目中经常使用私有 Composer 仓库（如 Private Packagist、Satis、自建 repo）。安全要点：

```json
// composer.json
{
    "repositories": [
        {
            "type": "composer",
            "url": "https://packages.your-org.com",
            "canonical": true
        }
    ]
}
```

- 使用 `canonical: true` 确保同名包优先使用私有仓库
- 配置 `allowlist` 只允许从可信仓库拉取特定包
- 私有仓库的 TLS 证书必须验证（避免 MITM 攻击）

### 3.4 Composer 安全最佳实践

```bash
# 1. 始终使用 --no-scripts（避免安装时执行恶意脚本）
composer install --no-scripts --no-interaction

# 2. 验证后手动执行可信脚本
composer run-script post-autoload-dump

# 3. 在 CI 中锁定平台版本
composer config platform.php 8.3.0

# 4. 使用最小版本范围而非宽松范围
# ❌ "guzzlehttp/guzzle": "*"
# ✅ "guzzlehttp/guzzle": "^7.9"
```

---

## 四、SLSA 框架详解

SLSA（Supply-chain Levels for Software Artifacts，发音同 "salsa"）是由 Google 主导、现由 OpenSSF（Open Source Security Foundation）维护的供应链完整性框架。它为构建和分发过程定义了可量化的安全级别。

### 4.1 SLSA 级别解析

| 级别 | 要求 | 适用场景 |
|------|------|---------|
| L0 | 无要求 | 个人项目 |
| L1 | 构建过程有文档记录，生成 provenance | 内部项目起步 |
| L2 | 使用托管构建服务（如 GitHub Actions），provenance 签名 | 中型团队 |
| L3 | 构建平台具有防篡改能力，源码有双重审查 | 开源关键项目 |
| L4 | 所有变更需两人审查，构建过程完全密封 | 关键基础设施 |

对于大多数 Laravel 全栈项目，**达到 SLSA L2 是一个现实且有价值的目标**。

### 4.2 Provenance 生成

Provenance（来源证明）描述了一个制品是如何构建的，包括：源代码仓库、构建命令、构建时间、构建者身份。

GitHub 原生支持通过 `actions/attest-build-provenance` 生成 SLSA provenance：

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  id-token: write   # 用于 OIDC token（关键！）
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build artifacts
        run: |
          composer install --no-dev --no-scripts
          npm ci && npm run build
          tar -czf release.tar.gz -C build .

      - name: Generate SLSA provenance
        uses: actions/attest-build-provenance@v2
        with:
          subject-path: 'release.tar.gz'
```

这条 Action 会自动：
1. 收集构建上下文（commit SHA、workflow run ID 等）
2. 使用 GitHub 的 Sigstore 签名密钥对 provenance 进行签名
3. 将签名的 provenance 附加到 GitHub Release

### 4.3 slsa-verifier 校验

消费者（部署方）可以使用 `slsa-verifier` 校验制品的 provenance：

```bash
# 安装 slsa-verifier
go install github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@latest

# 校验制品
slsa-verifier verify-artifact release.tar.gz \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/your-org/your-laravel-app \
  --source-tag v1.0.0
```

校验会验证：
- Provenance 是否由可信构建平台签名
- 源代码 URI 和版本是否匹配
- 构建过程是否在预期的 CI 环境中执行

### 4.4 在 Laravel 项目中的实践建议

对于 Laravel 全栈项目，SLSA provenance 可以覆盖以下制品：

- **生产容器镜像**：Docker 镜像 + provenance（使用 `docker buildx build --provenance=true`）
- **部署包**：tar.gz 归档 + provenance
- **编译前端资产**：`public/build/` 目录的 hash manifest

---

## 五、GitHub Dependabot + Security Advisories 集成

Dependabot 是 GitHub 提供的自动化依赖更新和安全告警服务，对于 Laravel 项目来说是最便捷的持续监控方案。

### 5.1 Dependabot 配置

```yaml
# .github/dependabot.yml
version: 2
updates:
  # PHP 依赖（Composer）
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 10
    reviewers:
      - "your-team"
    labels:
      - "dependencies"
      - "security"
    # 安全更新始终立即创建 PR
    insecure-external-code-execution: deny

  # Node.js 依赖（npm）
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 15
    reviewers:
      - "your-team"
    labels:
      - "dependencies"
      - "security"
    ignore:
      # 忽略大版本升级（避免 breaking changes）
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "ci"
      - "security"

  # Docker
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "docker"
      - "security"
```

### 5.2 Security Advisories 自动告警

GitHub Security Advisories 会在以下情况自动通知仓库管理员：

1. GitHub Advisory Database 新增一个影响你项目依赖的漏洞
2. Dependabot 自动创建安全更新 PR
3. Dependabot Alert 出现在仓库的 Security 选项卡中

**关键配置**：在仓库 Settings → Code security and analysis 中启用：
- ✅ Dependabot alerts
- ✅ Dependabot security updates
- ✅ Dependency graph
- ✅ Code scanning（可选，配合 CodeQL）

### 5.3 Dependabot 自动合并策略

安全更新 PR 应该被快速合并。可以通过 GitHub Actions 自动化这个过程：

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto Merge
on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Auto merge security updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

这个策略仅自动合并 patch 级别的安全更新，minor 和 major 更新仍需人工审查。

---

## 六、Laravel 项目完整 CI 安全门禁 Pipeline

以下是一个完整的 GitHub Actions Pipeline，将前面所有安全检查整合在一起，作为合并 PR 前的门禁条件。

### 6.1 完整 Pipeline 配置

```yaml
# .github/workflows/security-gate.yml
name: Security Gate

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  # 每天凌晨 2 点定时扫描（捕获新披露的漏洞）
  schedule:
    - cron: '0 18 * * *'  # UTC 18:00 = 北京时间 02:00

permissions:
  contents: read
  security-events: write

jobs:
  # ============================================
  # Job 1: PHP 依赖安全扫描
  # ============================================
  composer-audit:
    name: "🔒 Composer Security Audit"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2

      - name: Validate composer.json
        run: composer validate --strict

      - name: Install dependencies
        run: |
          composer install --no-interaction --no-scripts --prefer-dist
          
      - name: Run composer audit
        run: |
          composer audit --format=json > audit-result.json || true
          composer audit --no-dev
          
      - name: Check for critical vulnerabilities
        run: |
          CRITICAL=$(cat audit-result.json | python3 -c "
          import sys, json
          data = json.load(sys.stdin)
          advisories = data.get('advisories', {})
          critical = sum(
            1 for pkg in advisories.values() 
            for a in pkg 
            if a.get('severity', '').lower() in ['critical', 'high']
          )
          print(critical)
          " 2>/dev/null || echo "0")
          
          if [ "$CRITICAL" -gt 0 ]; then
            echo "❌ Found $CRITICAL critical/high severity vulnerabilities!"
            exit 1
          fi
          echo "✅ No critical/high vulnerabilities found."

  # ============================================
  # Job 2: Node.js 依赖安全扫描
  # ============================================
  npm-audit:
    name: "🔒 npm Security Audit"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --ignore-scripts

      - name: Run npm audit
        run: |
          npm audit --audit-level=high --json > npm-audit-result.json || true
          npm audit --audit-level=high

      - name: Run audit-ci
        run: |
          npx audit-ci --config audit-ci.json --report-type full

  # ============================================
  # Job 3: License 合规检查
  # ============================================
  license-check:
    name: "📜 License Compliance"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Check npm licenses
        run: |
          npm ci --ignore-scripts
          npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0" \
            --summary

      - name: Check composer licenses
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2
      - run: |
          composer install --no-interaction --no-scripts
          composer licenses --no-dev --format=json

  # ============================================
  # Job 4: 容器镜像安全扫描（可选）
  # ============================================
  container-scan:
    name: "🐳 Container Security Scan"
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t app:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'app:${{ github.sha }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

  # ============================================
  # Job 5: SBOM 生成
  # ============================================
  sbom-generation:
    name: "📋 SBOM Generation"
    runs-on: ubuntu-latest
    needs: [composer-audit, npm-audit]
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/')
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js & PHP
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2

      - name: Install dependencies
        run: |
          composer install --no-interaction --no-scripts
          npm ci --ignore-scripts

      - name: Generate SBOM with Syft
        uses: anchore/sbom-action@v0
        with:
          format: cyclonedx-json
          output-file: sbom-laravel-app.cdx.json
          artifact-name: sbom.cdx.json

      - name: Upload SBOM as artifact
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: sbom-laravel-app.cdx.json
          retention-days: 90
```

### 6.2 门禁效果说明

这个 Pipeline 的关键设计原则：

1. **阻断性**：任何 Job 失败都会阻止 PR 合并（配合 GitHub Branch Protection Rules）
2. **并行执行**：composer-audit 和 npm-audit 并行运行，不互相等待
3. **定时扫描**：通过 `schedule` 事件，每天自动扫描一次，捕获新披露的漏洞
4. **SARIF 集成**：容器扫描结果上传到 GitHub Security 选项卡，便于统一管理

---

## 七、SBOM 生成：Syft + CycloneDX 格式

SBOM（Software Bill of Materials，软件物料清单）是供应链安全的基础能力——**你无法保护你不了解的东西**。

### 7.1 什么是 SBOM

SBOM 是一份完整的软件组件清单，包含：

- 每个组件的名称、版本、供应商
- 组件之间的依赖关系
- 许可证信息
- 唯一标识符（如 CPE、PURL）

主流 SBOM 格式有两种：

| 格式 | 标准 | 特点 |
|------|------|------|
| SPDX | ISO/IEC 5962:2021 | Linux Foundation 主导，偏合规 |
| CycloneDX | OWASP 项目 | 偏安全，支持 VEX（漏洞可利用性声明） |

### 7.2 使用 Syft 生成 SBOM

Syft 是 Anchore 开源的 SBOM 生成工具，支持多种输入源和输出格式：

```bash
# 安装 Syft
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# 对项目目录生成 SBOM（CycloneDX JSON 格式）
syft dir:. --output cyclonedx-json=sbom.cdx.json

# 对 Docker 镜像生成 SBOM
syft your-image:tag --output cyclonedx-json=image-sbom.cdx.json

# 对 Composer 项目生成详细 SBOM
syft dir:. \
  --output cyclonedx-json=sbom.cdx.json \
  --name your-laravel-app \
  --version 1.0.0
```

### 7.3 SBOM 内容解读

CycloneDX SBOM 文件的核心结构：

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "metadata": {
    "component": {
      "name": "your-laravel-app",
      "version": "1.0.0",
      "type": "application"
    },
    "timestamp": "2026-06-06T02:00:00Z"
  },
  "components": [
    {
      "name": "laravel/framework",
      "version": "11.31.0",
      "type": "library",
      "purl": "pkg:composer/laravel/framework@11.31.0",
      "licenses": [
        { "license": { "id": "MIT" } }
      ]
    }
  ],
  "vulnerabilities": [
    {
      "id": "CVE-2024-XXXXX",
      "ratings": [
        { "severity": "high", "method": "CVSSv3", "score": 8.1 }
      ],
      "affects": [
        { "ref": "pkg:composer/some-package@1.2.3" }
      ]
    }
  ]
}
```

### 7.4 SBOM 的实际价值

1. **合规需求**：满足 EO 14028 和 EU CRA（Cyber Resilience Act）的要求
2. **漏洞响应**：当新的 CVE 披露时，可以通过 SBOM 快速定位受影响的项目
3. **许可证审计**：自动检测是否引入了 GPL/AGPL 等 copyleft 许可证
4. **供应链可视化**：了解项目的完整依赖图谱，包括传递性依赖

### 7.5 Grype：基于 SBOM 的漏洞扫描

有了 SBOM，可以使用 Grype 进行离线漏洞扫描：

```bash
# 安装 Grype
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# 基于 SBOM 扫描漏洞
grype sbom:sbom.cdx.json --fail-on high

# 输出 SARIF 格式（可上传到 GitHub）
grype sbom:sbom.cdx.json --output sarif > grype-results.sarif
```

---

## 八、最佳实践清单与总结

### 8.1 供应链安全治理 Checklist

以下是针对 Laravel 全栈项目的供应链安全最佳实践清单，可以直接用作团队的安全审查标准：

#### 依赖管理

- [ ] `package-lock.json` 和 `composer.lock` 均提交到 Git
- [ ] 不使用 `*` 或 `dev-master` 作为依赖版本约束
- [ ] 定期（至少每周）更新依赖到最新安全版本
- [ ] 使用 `npm ci` 而非 `npm install` 安装依赖（CI 环境）
- [ ] 使用 `composer install --no-scripts` 避免执行恶意脚本
- [ ] 禁用不需要的 npm lifecycle scripts（`ignore-scripts=true`）

#### CI/CD 安全门禁

- [ ] CI Pipeline 中集成 `npm audit` 和 `composer audit`
- [ ] 漏洞扫描结果阻断 PR 合并（Branch Protection Rule）
- [ ] 定时任务每天执行安全扫描（捕获新漏洞）
- [ ] 容器镜像使用 Trivy 或 Grype 进行漏洞扫描
- [ ] GitHub Actions 使用 commit SHA pin 而非 tag（如 `actions/checkout@b4ffde...`）

#### 供应链完整性

- [ ] 启用 Dependabot alerts 和 security updates
- [ ] 生产制品生成 SLSA provenance（L2+）
- [ ] 每次发版生成 SBOM 并作为制品存储
- [ ] 容器镜像使用 `--provenance=true` 构建
- [ ] 部署时校验制品签名和 provenance

#### 凭证与访问控制

- [ ] CI/CD 使用最小权限的 Token/Secret
- [ ] npm/Composer 发布使用 granular access token
- [ ] 启用 2FA 保护所有包注册表账户
- [ ] 使用 OIDC（OpenID Connect）替代长期 CI Secret
- [ ] 定期轮换 CI/CD 密钥

#### 监控与响应

- [ ] 订阅项目依赖的安全公告（GitHub Advisory Database）
- [ ] 建立漏洞分级响应流程（Critical: 24h, High: 7d, Medium: 30d）
- [ ] 保留每次构建的 SBOM（至少 90 天）
- [ ] 定期审查第三方 GitHub Actions 的源代码变更

### 8.2 架构总览

将本文介绍的工具和流程整合到一张架构图中：

```
开发者提交代码
       │
       ▼
┌─────────────────────────────────────────┐
│         GitHub Actions Pipeline         │
│                                         │
│  ┌──────────┐  ┌──────────┐            │
│  │ composer  │  │ npm audit│            │
│  │  audit   │  │  + audit │            │
│  └────┬─────┘  └────┬─────┘            │
│       │              │                  │
│       ▼              ▼                  │
│  ┌──────────────────────────┐          │
│  │   漏洞等级判断 & 门禁      │          │
│  │   critical/high → ❌ 阻断  │          │
│  │   moderate/low  → ⚠️ 告警  │          │
│  └────────────┬─────────────┘          │
│               │                         │
│               ▼                         │
│  ┌──────────────────────────┐          │
│  │  容器镜像扫描 (Trivy)     │          │
│  └────────────┬─────────────┘          │
│               │                         │
│               ▼                         │
│  ┌──────────────────────────┐          │
│  │  SBOM 生成 (Syft/CycloneDX)│        │
│  └────────────┬─────────────┘          │
│               │                         │
│               ▼                         │
│  ┌──────────────────────────┐          │
│  │  SLSA Provenance 生成     │          │
│  └────────────┬─────────────┘          │
│               │                         │
└───────────────┼─────────────────────────┘
                │
                ▼
        ┌──────────────┐
        │   安全制品仓库  │
        │  (GHCR/OCI)   │
        │  镜像+SBOM+   │
        │  Provenance   │
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │  部署时校验    │
        │ slsa-verifier │
        │  grype scan   │
        └──────────────┘
```

### 8.3 工具速查表

| 工具 | 用途 | 安装方式 |
|------|------|---------|
| npm audit | Node.js 依赖漏洞扫描 | 内置 npm |
| audit-ci | CI 友好的 npm audit 封装 | `npm i -D audit-ci` |
| composer audit | PHP 依赖漏洞扫描 | 内置 Composer 2.4+ |
| Trivy | 容器/文件系统漏洞扫描 | `brew install trivy` |
| Syft | SBOM 生成 | `brew install syft` |
| Grype | 基于 SBOM 的漏洞扫描 | `brew install grype` |
| slsa-verifier | SLSA provenance 校验 | `go install ...` |
| Dependabot | 自动依赖更新 | GitHub 内置 |
| Cosign | 制品签名与校验 | `brew install cosign` |

### 8.4 总结

供应链安全不是一次性工程，而是一个**持续治理的过程**。对于 Laravel 全栈项目，我们需要关注三个层面：

1. **预防（Prevention）**：通过 lockfile 管理、版本约束策略、最小权限原则，在源头减少攻击面
2. **检测（Detection）**：通过 npm audit、composer audit、Trivy 等工具，在 CI 流水线中持续发现已知漏洞
3. **验证（Verification）**：通过 SLSA provenance、SBOM、签名校验，确保从构建到部署的制品完整性

本文提供的完整 CI Pipeline 配置可以直接复制到你的 Laravel 项目中使用。核心思想是：**将安全检查从"事后补救"前移到"提交时拦截"，让安全成为开发流程的有机组成部分，而非额外负担**。

供应链安全的旅程没有终点——从今天开始，为你的 Laravel 项目加上第一道安全门禁吧。

## 相关阅读

- [容器安全扫描实战：Trivy、Snyk、Grype 与 CI 集成——镜像漏洞检测、SBOM 生成与修复工作流](/categories/DevOps/容器安全扫描实战-Trivy-Snyk-Grype-CI集成-镜像漏洞检测-SBOM生成与修复工作流/)——供应链安全的"容器层"防线，与本文的依赖审计形成互补
- [Dependabot vs Renovate 实战：依赖自动更新策略——Laravel/Node.js 自动 PR 与安全补丁工作流](/categories/DevOps/Dependabot-vs-Renovate-实战-依赖自动更新策略-Laravel-Node-js自动PR与安全补丁工作流/)——漏洞发现后的自动修复闭环
- [Conventional Commits 与 Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布](/categories/DevOps/Conventional-Commits-Semantic-Release-实战-自动版本号-CHANGELOG生成与npm-Composer包发布/)——发布流水线的规范化实践，与供应链安全的 SLSA 理念一脉相承
