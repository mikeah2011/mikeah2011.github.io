---
title: "Software Bill of Materials (SBOM) 实战：Syft/Trivy 生成依赖清单——供应链安全合规与 CI 集成"
date: 2026-06-09 20:24:00
categories:
  - CI/CD
tags:
  - SBOM
  - 供应链安全
  - Syft
  - Trivy
  - CI/CD
  - CycloneDX
  - SPDX
  - DevSecOps
description: "从零开始掌握 SBOM 的生成、管理与 CI 集成。用 Syft 和 Trivy 为你的项目生成标准化依赖清单，落地供应链安全合规。"
---

## 前言

2021 年 Log4Shell 漏洞爆发，全球数百万 Java 应用受到影响。很多团队花了整整一周才搞清楚自己到底哪些项目用了 Log4j——这就是没有 SBOM 的代价。

**Software Bill of Materials（SBOM）**，软件物料清单，本质上就是你项目的「配料表」。就像食品包装上的成分表一样，SBOM 列出了你的软件用了哪些组件、什么版本、来自哪里。

本文不讲概念科普，直接上手：用 Syft 和 Trivy 生成 SBOM，集成到 CI/CD 流水线，对接安全合规检查。

---

## 1. SBOM 格式：CycloneDX vs SPDX

两个主流格式，先搞清楚区别：

| 特性 | CycloneDX | SPDX |
|------|-----------|------|
| 主导方 | OWASP | Linux Foundation |
| 定位 | 安全导向 | 许可证合规导向 |
| 格式 | XML / JSON / protobuf | JSON / YAML / RDF / tag-value |
| 漏洞关联 | 原生支持 (VEX) | 需扩展 |
| 工具生态 | 偏安全扫描工具 | 偏许可证审计工具 |

**实际建议**：如果你的核心目标是安全漏洞排查，用 CycloneDX；如果要做许可证合规审计，用 SPDX。两者不冲突，可以同时生成。

---

## 2. Syft：Anchore 出品的 SBOM 生成利器

### 2.1 安装

```bash
# macOS
brew install syft

# Linux
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Docker（不想装本地的）
docker pull anchore/syft:latest
```

### 2.2 基本用法

```bash
# 扫描本地目录（PHP/Laravel 项目）
syft dir:. -o cyclonedx-json > sbom.json

# 扫描 Docker 镜像
syft my-app:latest -o cyclonedx-json > sbom-image.json

# 扫描并指定输出格式
syft dir:. -o spdx-json > sbom-spdx.json
syft dir:. -o cyclonedx-xml > sbom-cyclonedx.xml
```

### 2.3 Laravel 项目实战

以一个标准 Laravel 项目为例：

```bash
cd ~/my-laravel-app

# 生成 CycloneDX 格式的 SBOM
syft dir:. -o cyclonedx-json > sbom-cyclonedx.json

# 看看生成了什么
cat sbom-cyclonedx.json | python3 -m json.tool | head -50
```

输出的 JSON 包含完整的依赖树，包括 `composer.lock` 里锁定的所有 PHP 包：

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "version": 1,
  "metadata": {
    "timestamp": "2026-06-09T12:00:00Z",
    "tools": [
      {
        "vendor": "anchore",
        "name": "syft",
        "version": "1.x.x"
      }
    ]
  },
  "components": [
    {
      "type": "library",
      "name": "laravel/framework",
      "version": "11.x.x",
      "purl": "pkg:composer/laravel/framework@11.x.x",
      "licenses": [...]
    }
  ]
}
```

### 2.4 自定义配置

在项目根目录创建 `.syft.yaml`：

```yaml
# .syft.yaml
output:
  - cyclonedx-json=sbom.json

# 排除开发依赖（PHP 项目）
package:
  cataloger:
    scope: squashed  # 只扫描最终依赖，不含 build-time

# 排除不需要的目录
exclude:
  - './.git'
  - './node_modules'
  - './vendor/bin'
  - './storage'
  - './tests'
```

---

## 3. Trivy：一体化安全扫描工具

Trivy 不仅能生成 SBOM，还能直接扫描漏洞。一个工具干两件事。

### 3.1 安装

```bash
# macOS
brew install trivy

# Linux
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Docker
docker pull aquasec/trivy:latest
```

### 3.2 生成 SBOM

```bash
# 扫描项目目录
trivy fs --format cyclonedx --output sbom-trivy.json .

# 扫描 Docker 镜像
trivy image --format cyclonedx --output sbom-image.json my-app:latest

# SPDX 格式
trivy fs --format spdx-json --output sbom-spdx.json .
```

### 3.3 SBOM + 漏洞扫描一步到位

```bash
# 生成 SBOM 并同时扫描漏洞
trivy fs --format json --output report.json --scanners vuln .

# 只看高危和严重漏洞
trivy fs --severity HIGH,CRITICAL --scanners vuln .

# 扫描 Docker 镜像（最常见场景）
trivy image --severity HIGH,CRITICAL my-app:latest
```

输出示例：

```json
{
  "Results": [
    {
      "Target": "composer.lock",
      "Vulnerabilities": [
        {
          "VulnerabilityID": "CVE-2024-XXXXX",
          "PkgName": "guzzlehttp/guzzle",
          "InstalledVersion": "7.4.0",
          "FixedVersion": "7.8.1",
          "Severity": "HIGH",
          "Title": "..."
        }
      ]
    }
  ]
}
```

### 3.4 Trivy vs Syft 选择

| 场景 | 推荐 |
|------|------|
| 只生成 SBOM | Syft（更快、更专注） |
| SBOM + 漏洞扫描 | Trivy（一站式） |
| CI 集成（轻量） | Trivy |
| 深度 SBOM 定制 | Syft |

**我的做法**：CI 里用 Trivy 一步到位，正式发布时用 Syft 生成更精细的 SBOM 存档。

---

## 4. CI/CD 集成

### 4.1 GitHub Actions

```yaml
# .github/workflows/sbom.yml
name: SBOM & Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  # 每天定时扫描（新漏洞可能随时披露）
  schedule:
    - cron: '0 2 * * *'

jobs:
  sbom-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate SBOM with Syft
        uses: anchore/sbom-action@v0
        with:
          format: cyclonedx-json
          output-file: sbom.cdx.json

      - name: Scan vulnerabilities with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          format: json
          output: trivy-report.json
          severity: HIGH,CRITICAL
          exit-code: 1  # 有高危漏洞则 CI 失败

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: sbom.cdx.json
          retention-days: 90

      - name: Upload scan report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: trivy-report
          path: trivy-report.json
```

### 4.2 GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - security

sbom-generation:
  stage: security
  image:
    name: anchore/syft:latest
    entrypoint: [""]
  script:
    - syft dir:. -o cyclonedx-json > sbom-${CI_COMMIT_SHORT_SHA}.json
  artifacts:
    paths:
      - sbom-${CI_COMMIT_SHORT_SHA}.json
    expire_in: 30 days

vulnerability-scan:
  stage: security
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    - trivy fs --severity HIGH,CRITICAL --exit-code 1 --no-progress .
  allow_failure: false
```

### 4.3 Docker 构建时集成

```dockerfile
# Dockerfile 多阶段构建中生成 SBOM
FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --optimize-autoloader

FROM php:8.4-fpm AS app
WORKDIR /var/www
COPY --from=deps /app/vendor ./vendor
COPY . .

# 在构建阶段添加 SBOM 生成
FROM anchore/syft:latest AS sbom
COPY --from=app /app /app
RUN syft dir:/app -o cyclonedx-json > /sbom.json

# 最终镜像
FROM php:8.4-fpm
COPY --from=app /var/www /var/www
# 把 SBOM 嵌入镜像
COPY --from=sbom /sbom.json /var/www/sbom.json
```

---

## 5. 进阶：漏洞数据库与 VEX

### 5.1 Grype：配合 Syft 做漏洞扫描

Syft 生成的 SBOM 可以直接喂给 Grype 做漏洞分析：

```bash
# 安装 Grype
brew install grype

# 基于 SBOM 扫描漏洞
grype sbom:./sbom-cyclonedx.json

# 输出 JSON 格式
grype sbom:./sbom-cyclonedx.json -o json > vuln-report.json

# 只看可修复的漏洞
grype sbom:./sbom-cyclonedx.json --only-fixed
```

### 5.2 VEX（Vulnerability Exploitability eXchange）

VEX 是 SBOM 的伴侣文档，告诉你「这个漏洞在你的项目里到底能不能被利用」：

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "vulnerabilities": [
    {
      "id": "CVE-2024-XXXXX",
      "analysis": {
        "state": "not_affected",
        "justification": "code_not_reachable",
        "response": ["will_not_fix"],
        "detail": "该漏洞存在于未使用的 API 端点"
      },
      "affects": [
        {
          "ref": "pkg:composer/guzzlehttp/guzzle@7.4.0"
        }
      ]
    }
  ]
}
```

VEX 的意义：大量 CVE 是误报（漏洞存在但你的代码根本没用到那个功能）。VEX 帮你标记这些，避免安全团队被海量告警淹没。

---

## 6. 供应链安全合规实践

### 6.1 合规要求

美国行政命令 14028（2021）要求向联邦政府提供软件的厂商必须提供 SBOM。即使你不卖软件给美国政府，SBOM 也是以下合规框架的加分项：

- **ISO 27001**：信息安全管理体系
- **SOC 2**：服务组织控制报告
- **PCI DSS 4.0**：支付卡行业数据安全标准
- **等保 2.0**：中国网络安全等级保护

### 6.2 落地流程

```
开发者提交代码
    ↓
CI 生成 SBOM (Syft)
    ↓
漏洞扫描 (Trivy/Grype)
    ↓
高危漏洞？ → 阻断 CI，通知开发者
    ↓
SBOM 存档到制品库
    ↓
定期重新扫描（新漏洞披露）
    ↓
安全审计时导出完整 SBOM 报告
```

### 6.3 SBOM 管理平台

如果项目多了，手动管理 SBOM 不现实。几个选择：

- **Dependency-Track**：开源，OWASP 出品，支持持续监控
- **Anchore Enterprise**：Syft/Grype 的商业版
- **Socket.dev**：专注 npm/PyPI 供应链安全
- **Snyk**：开发者友好的安全平台

---

## 7. PHP/Laravel 项目特别注意事项

### 7.1 Composer 依赖的特殊性

PHP 项目扫描依赖 `composer.lock`，确保：

```bash
# 必须提交 composer.lock 到 Git
echo "composer.lock" >> .gitignore  # ❌ 错误做法
# composer.lock 应该被版本控制
```

### 7.2 排除开发依赖

SBOM 通常只关心生产依赖：

```bash
# Syft 会自动识别 composer.lock 里的 dev 标记
# 但为了保险，生成时可以过滤
syft dir:. -o cyclonedx-json --package . --exclude './vendor/bin' > sbom-prod.json
```

### 7.3 Node.js 前端资源

Laravel 项目通常有前端依赖（Vite/Webpack），也需要扫描：

```bash
# 同时扫描 PHP 和 JS 依赖
syft dir:. -o cyclonedx-json > sbom-full.json

# 分开扫描
syft dir:. --name php-deps -o cyclonedx-json > sbom-php.json
syft dir:./node_modules --name js-deps -o cyclonedx-json > sbom-js.json
```

---

## 踩坑记录

### 坑 1：Syft 扫描 Laravel 项目超慢

**原因**：`vendor` 目录太大，`storage` 下有大量日志和缓存。

**解决**：创建 `.syft.yaml` 排除不需要的目录（见 2.4 节）。

### 坑 2：Trivy 扫描时网络超时

**原因**：Trivy 首次运行需要下载漏洞数据库（约 30MB），CI 环境网络不稳。

**解决**：

```bash
# 提前下载数据库，缓存到 CI
trivy --download-db-only

# GitHub Actions 中缓存
- uses: actions/cache@v4
  with:
    path: ~/.cache/trivy
    key: trivy-db-${{ runner.os }}
```

### 坑 3：SBOM 文件太大，制品库存储成本高

**原因**：Laravel 项目几百个依赖，SBOM JSON 可能好几 MB。

**解决**：

```bash
# 压缩存储
gzip sbom-cyclonedx.json

# 只保留最近 N 个版本
find ./sbom-archive -name "*.json.gz" -mtime +90 -delete
```

### 坑 4：镜像扫描误报太多

**原因**：基础镜像里的系统包有大量已知漏洞，但很多不影响你的应用。

**解决**：

```bash
# 使用 distroless 或 Alpine 基础镜像
FROM php:8.4-fpm-alpine

# 或者用 VEX 过滤误报（见 5.2 节）
```

---

## 总结

| 步骤 | 工具 | 输出 |
|------|------|------|
| 生成 SBOM | Syft / Trivy | CycloneDX / SPDX JSON |
| 漏洞扫描 | Trivy / Grype | 漏洞报告 |
| CI 集成 | GitHub Actions / GitLab CI | 自动化流水线 |
| 持续监控 | Dependency-Track | 漏洞告警 |
| 合规证明 | SBOM + VEX | 审计文档 |

供应链安全不是「有了 SBOM 就安全了」，而是「有了 SBOM 你至少知道自己有什么」。在 Log4Shell 那样的零日漏洞面前，能快速回答「我用了这个组件吗」的能力，就是你的竞争优势。

三步开始：

1. `brew install syft trivy`
2. 在项目根目录跑 `syft dir:. -o cyclonedx-json > sbom.json`
3. 把 SBOM 生成加到你的 CI 流水线里

就这么简单。先跑起来，再优化。
