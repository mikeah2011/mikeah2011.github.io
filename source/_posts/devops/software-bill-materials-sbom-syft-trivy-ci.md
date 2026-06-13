---
title: 'Software Bill of Materials (SBOM) 实战：Syft/Trivy 生成依赖清单——供应链安全合规与 CI 集成踩坑记录'
date: 2026-06-03 01:12:12
tags: [SBOM, 供应链安全, Syft, Trivy, CI/CD, 合规]
keywords: [Software Bill of Materials, SBOM, Syft, Trivy, CI, 生成依赖清单, 供应链安全合规与, 集成踩坑记录, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "深入实战 SBOM 软件物料清单生成方案，对比 Syft 与 Trivy 两款主流工具的扫描能力、输出格式与 CI 集成方式。详解 SPDX/CycloneDX 标准选型、GitHub Actions/GitLab CI 流水线配置、依赖漏洞扫描质量门禁设置，以及满足 NTIA 最低要求和 FDA 医疗器械合规的落地路径。附带完整踩坑记录与供应链安全体系建设行动清单，帮助团队从零构建可见、可控、可审计的软件供应链安全体系。"
---


2021 年 12 月，Log4Shell 漏洞（CVE-2021-44228）震动了整个软件行业。一个被数十亿设备使用的日志库中的远程代码执行漏洞，让全球开发者第一次深刻认识到：**你不知道你的软件里有什么，你就不知道你的风险在哪里**。

Software Bill of Materials（SBOM，软件物料清单）就是解决这个问题的标准方案。本文将系统讲解如何使用 Syft 和 Trivy 生成 SBOM，如何集成到 CI/CD 流水线，以及如何满足各种合规要求。

<!-- more -->

## 一、Log4Shell 后的供应链安全觉醒

### 1.1 供应链攻击事件回顾

```text
重大供应链安全事件时间线:

2017.09  Equifax 数据泄露
         └── Apache Struts 未修补漏洞，1.47 亿用户数据泄露

2020.12  SolarWinds 供应链攻击
         └── 攻击者入侵构建系统，在 Orion 更新中植入后门
         └── 影响 18000+ 组织，包括美国政府机构

2021.01  Dependency Confusion 攻击
         └── Alex Birsan 利用包管理器优先级漏洞
         └── 影响 Apple、Microsoft、PayPal 等

2021.12  Log4Shell (CVE-2021-44228)
         └── Apache Log4j 远程代码执行
         └── CVSS 10.0，影响数十亿设备
         └── 全球紧急响应，补丁周期数月

2022.03  Spring4Shell (CVE-2022-22965)
         └── Spring Framework RCE
         └── 再次暴露 Java 生态安全问题

2023.03  3CX 供应链攻击
         └── 桌面应用被植入恶意代码
         └── 通过合法更新渠道分发

2024+    供应链攻击持续增长
         └── PyPI、npm 恶意包事件频发
         └── AI 模型供应链成为新攻击面
```

### 1.2 为什么需要 SBOM

```text
没有 SBOM 时的困境:

┌─────────────────────────────────────────────────────────┐
│                                                          │
│  Log4Shell 爆发后，CTO 问:                               │
│  "我们有哪些系统使用了 Log4j？"                          │
│                                                          │
│  开发团队: "我们需要检查每个项目的依赖..."               │
│  运维团队: "我们不知道 Docker 镜像里有什么..."           │
│  安全团队: "我们无法快速评估影响范围..."                 │
│                                                          │
│  结果:                                                   │
│  - 花了 2 周才完成全面排查                               │
│  - 有 3 个系统使用了有漏洞的版本但未被发现               │
│  - 修复期间持续暴露在风险中                              │
│                                                          │
└─────────────────────────────────────────────────────────┘

有了 SBOM 后:

┌─────────────────────────────────────────────────────────┐
│                                                          │
│  新漏洞公开后，安全团队:                                 │
│  1. 查询 SBOM 数据库 (5 分钟)                            │
│  2. 找到所有受影响的系统 (10 分钟)                       │
│  3. 通知相关团队修复 (15 分钟)                           │
│  4. 确认修复完成 (1 小时)                                │
│                                                          │
│  总计: < 2 小时                                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## 二、SBOM 格式：SPDX vs CycloneDX

### 2.1 格式对比

```text
两大 SBOM 标准:

┌─────────────────┬───────────────────┬───────────────────┐
│ 维度            │ SPDX              │ CycloneDX         │
├─────────────────┼───────────────────┼───────────────────┤
│ 维护组织        │ Linux Foundation   │ OWASP             │
│ 标准状态        │ ISO/IEC 5962:2021 │ ECMA 国际标准      │
│ 最新版本        │ SPDX 2.3          │ CycloneDX 1.6     │
│ 文件格式        │ JSON, YAML, RDF,  │ JSON, XML,        │
│                 │ Tag-Value, CSV    │ Protobuf          │
│ 主要用途        │ 许可证合规        │ 漏洞分析           │
│ 工具支持        │ 广泛              │ 广泛               │
│ 包管理器覆盖    │ 全面              │ 全面               │
│ 漏洞关联        │ 需扩展            │ 原生支持           │
│ 依赖关系        │ 支持              │ 原生支持           │
│ 服务组件        │ 有限支持          │ 原生支持 (BOM-Link)│
└─────────────────┴───────────────────┴───────────────────┘
```

### 2.2 SPDX 示例

```json
{
  "spdxVersion": "SPDX-2.3",
  "dataLicense": "CC0-1.0",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "my-laravel-app",
  "documentNamespace": "https://example.com/sbom/my-laravel-app/1.0.0",
  "creationInfo": {
    "created": "2026-06-03T01:00:00Z",
    "creators": ["Tool: syft-0.100.0"],
    "licenseListVersion": "3.22"
  },
  "packages": [
    {
      "SPDXID": "SPDXRef-Package-laravel-framework",
      "name": "laravel/framework",
      "versionInfo": "11.0.0",
      "downloadLocation": "https://github.com/laravel/framework",
      "filesAnalyzed": false,
      "licenseConcluded": "MIT",
      "licenseDeclared": "MIT",
      "copyrightText": "Copyright (c) Taylor Otwell",
      "externalRefs": [
        {
          "referenceCategory": "PACKAGE-MANAGER",
          "referenceType": "purl",
          "referenceLocator": "pkg:composer/laravel/framework@11.0.0"
        }
      ],
      "checksums": [
        {
          "algorithm": "SHA256",
          "checksumValue": "abc123..."
        }
      ]
    },
    {
      "SPDXID": "SPDXRef-Package-guzzlehttp-guzzle",
      "name": "guzzlehttp/guzzle",
      "versionInfo": "7.8.0",
      "downloadLocation": "https://github.com/guzzle/guzzle",
      "filesAnalyzed": false,
      "licenseConcluded": "MIT",
      "licenseDeclared": "MIT",
      "copyrightText": "Copyright (c) Graham Campbell",
      "externalRefs": [
        {
          "referenceCategory": "PACKAGE-MANAGER",
          "referenceType": "purl",
          "referenceLocator": "pkg:composer/guzzlehttp/guzzle@7.8.0"
        }
      ]
    }
  ],
  "relationships": [
    {
      "spdxElementId": "SPDXRef-DOCUMENT",
      "relationshipType": "DESCRIBES",
      "relatedSpdxElement": "SPDXRef-Package-laravel-framework"
    },
    {
      "spdxElementId": "SPDXRef-Package-laravel-framework",
      "relationshipType": "DEPENDS_ON",
      "relatedSpdxElement": "SPDXRef-Package-guzzlehttp-guzzle"
    }
  ]
}
```

### 2.3 CycloneDX 示例

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.6",
  "serialNumber": "urn:uuid:12345678-1234-1234-1234-123456789012",
  "version": 1,
  "metadata": {
    "timestamp": "2026-06-03T01:00:00Z",
    "tools": [
      {
        "vendor": "anchore",
        "name": "syft",
        "version": "0.100.0"
      }
    ],
    "component": {
      "type": "application",
      "bom-ref": "my-laravel-app",
      "name": "my-laravel-app",
      "version": "1.0.0"
    }
  },
  "components": [
    {
      "type": "library",
      "bom-ref": "pkg:composer/laravel/framework@11.0.0",
      "name": "laravel/framework",
      "version": "11.0.0",
      "purl": "pkg:composer/laravel/framework@11.0.0",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ]
    },
    {
      "type": "library",
      "bom-ref": "pkg:composer/guzzlehttp/guzzle@7.8.0",
      "name": "guzzlehttp/guzzle",
      "version": "7.8.0",
      "purl": "pkg:composer/guzzlehttp/guzzle@7.8.0",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ]
    }
  ],
  "dependencies": [
    {
      "ref": "my-laravel-app",
      "dependsOn": [
        "pkg:composer/laravel/framework@11.0.0"
      ]
    },
    {
      "ref": "pkg:composer/laravel/framework@11.0.0",
      "dependsOn": [
        "pkg:composer/guzzlehttp/guzzle@7.8.0"
      ]
    }
  ]
}
```

## 三、法规驱动

### 3.1 全球 SBOM 法规

```text
全球 SBOM 法规要求:

┌───────────────┬───────────────────────────────────────────┐
│ 美国          │                                           │
│  行政令 14028 │ 2021.05 签发                              │
│               │ - 联邦采购的软件必须提供 SBOM              │
│               │ - 最低要求: 直接依赖 + 版本号              │
│               │ - 格式: SPDX 或 CycloneDX                 │
│               │                                           │
│  FDA 医疗设备 │ 2023.10 生效                              │
│               │ - 医疗设备软件必须有 SBOM                  │
│               │ - 必须持续更新                            │
├───────────────┼───────────────────────────────────────────┤
│ 欧盟          │                                           │
│  EU CRA       │ 2027 生效                                 │
│  (网络弹性法案)│ - 所有联网设备必须提供 SBOM               │
│               │ - 必须在产品生命周期内维护                 │
│               │ - 漏洞披露和修复义务                      │
├───────────────┼───────────────────────────────────────────┤
│ 中国          │                                           │
│  等保 2.0     │ 持续实施中                                │
│               │ - 三级以上系统要求软件清单                │
│               │ - 关键基础设施要求更严格                  │
│               │                                           │
│  数据安全法   │ 2021.09 生效                              │
│               │ - 关键数据处理者需评估供应链风险           │
└───────────────┴───────────────────────────────────────────┘
```

### 3.2 合规检查清单

```text
SBOM 合规检查清单:

□ 格式合规
  □ 使用 SPDX 2.3+ 或 CycloneDX 1.4+
  □ 包含所有必填字段
  □ 机器可读格式（JSON/XML）

□ 内容完整
  □ 所有直接依赖
  □ 所有传递依赖（推荐）
  □ 组件名称和版本
  □ 唯一标识符（PURL、CPE）
  □ 许可证信息
  □ 供应商/作者信息

□ 生命周期管理
  □ 每次构建自动生成
  □ 与制品一起存储
  □ 定期更新（至少每次发布）
  □ 存档保留（建议 7+ 年）

□ 分发与共享
  □ 提供给客户（按需）
  □ 与安全团队共享
  □ 集成到漏洞管理系统
  □ API 访问接口

□ 漏洞关联
  □ 自动匹配 CVE
  □ 严重级别分类
  □ 修复建议
  □ 影响范围评估
```

## 四、Syft 实战

### 4.1 安装

```bash
# macOS
brew install syft

# Linux (deb)
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Docker
docker pull anchore/syft:latest

# Go install
go install github.com/anchore/syft/cmd/syft@latest

# 验证安装
syft version
# Application:     syft
# Version:         0.100.0
# BuildDate:       2026-06-01
# GitCommit:       abc123
```

### 4.2 扫描文件系统

```bash
# 扫描当前目录
syft dir:. -o spdx-json=sbom.spdx.json

# 扫描指定目录
syft dir:/path/to/project -o cyclonedx-json=sbom.cdx.json

# 扫描 PHP/Composer 项目
syft dir:/path/to/laravel-project \
  -o spdx-json=laravel-sbom.spdx.json \
  -o table  # 终端表格输出

# 扫描 Node.js 项目
syft dir:/path/to/node-project \
  -o cyclonedx-json=node-sbom.cdx.json

# 扫描并包含开发依赖
syft dir:. --scope all-layers -o spdx-json=full-sbom.spdx.json
```

### 4.3 扫描 Docker 镜像

```bash
# 扫描本地镜像
syft my-laravel-app:latest -o spdx-json=image-sbom.spdx.json

# 扫描远程镜像
syft registry:myregistry.com/myapp:v1.0.0 -o cyclonedx-json=remote-sbom.cdx.json

# 扫描并包含基础镜像层
syft my-laravel-app:latest \
  --scope all-layers \
  -o spdx-json=full-image-sbom.spdx.json

# 扫描多架构镜像
syft myapp:latest --platform linux/amd64 -o spdx-json=amd64-sbom.spdx.json
syft myapp:latest --platform linux/arm64 -o spdx-json=arm64-sbom.spdx.json

# 扫描并输出到 OCI registry
syft myapp:latest \
  -o spdx-json=sbom.spdx.json \
  --push-to-registry myregistry.com/myapp:sbom
```

### 4.4 配置文件

```yaml
# .syft.yaml
output:
  - spdx-json=sbom.spdx.json
  - cyclonedx-json=sbom.cdx.json
  - table  # 终端输出

scope: all-layers  # all-layers, squashed

# 排除路径
exclude:
  - "**/vendor/**"
  - "**/node_modules/**"
  - "**/.git/**"
  - "**/tests/**"

# 匹配器配置
match:
  java:
    using:
      - maven
      - java-archive
  javascript:
    using:
      - npm
      - yarn
  python:
    using:
      - pip
  php:
    using:
      - composer

# 注册表认证
registry:
  insecure-skip-tls-verify: false
  auth:
    - authority: myregistry.com
      username: ${REGISTRY_USER}
      password: ${REGISTRY_PASS}
```

### 4.5 输出格式详解

```bash
# 支持的输出格式
syft dir:. -o spdx-json      # SPDX JSON
syft dir:. -o spdx-tag-value # SPDX Tag-Value
syft dir:. -o spdx-rdf       # SPDX RDF/XML
syft dir:. -o cyclonedx-json # CycloneDX JSON
syft dir:. -o cyclonedx-xml  # CycloneDX XML
syft dir:. -o table          # 终端表格
syft dir:. -o template        # 自定义模板

# 多格式同时输出
syft dir:. \
  -o spdx-json=sbom.spdx.json \
  -o cyclonedx-json=sbom.cdx.json \
  -o table

# 使用 Go 模板自定义输出
syft dir:. -o template -t '{{range .Artifacts}}{{.Name}} {{.Version}} {{.Type}}{{"\n"}}{{end}}'
```

## 五、Trivy 实战

### 5.1 安装

```bash
# macOS
brew install trivy

# Linux (deb)
sudo apt-get install trivy

# Docker
docker pull aquasec/trivy:latest

# Go install
go install github.com/aquasecurity/trivy/cmd/trivy@latest

# 验证安装
trivy version
```

### 5.2 SBOM 生成

```bash
# 扫描文件系统生成 SBOM
trivy fs --format spdx-json --output fs-sbom.spdx.json /path/to/project

# 扫描 Docker 镜像生成 SBOM
trivy image --format cyclonedx-json --output image-sbom.cdx.json myapp:latest

# 扫描 Kubernetes 集群
trivy k8s --format spdx-json --output k8s-sbom.spdx.json cluster

# 扫描 Terraform/IaC
trivy config --format spdx-json --output iac-sbom.spdx.json /path/to/terraform

# 扫描并同时进行漏洞分析
trivy image --format json --output report.json \
  --scanners vuln,secret,misconfig \
  myapp:latest
```

### 5.3 SBOM + 漏洞扫描一体化

```bash
# Trivy 的核心优势：SBOM 生成 + 漏洞扫描同时进行

# 1. 生成 SBOM 并扫描漏洞
trivy image \
  --format json \
  --output report.json \
  --scanners vuln \
  myapp:latest

# 报告包含:
# - 完整的依赖清单（SBOM 内容）
# - 每个依赖的已知漏洞
# - 严重级别和修复建议

# 2. 从已生成的 SBOM 进行漏洞扫描
trivy sbom --format json --output vuln-report.json fs-sbom.spdx.json

# 3. 生成人类可读的报告
trivy image --format table myapp:latest

# 输出示例:
# myapp:latest (debian 12.4)
# ==========================
# Total: 42 (UNKNOWN: 0, LOW: 15, MEDIUM: 18, HIGH: 7, CRITICAL: 2)
#
# ┌──────────────┬──────────────┬──────────┬──────────────────────┐
# │   Library    │   Version    │ Severity │   Fixed Version      │
# ├──────────────┼──────────────┼──────────┼──────────────────────┤
# │ libssl3      │ 3.0.11-1     │ HIGH     │ 3.0.13-1~deb12u1     │
# │ curl         │ 7.88.1-10    │ CRITICAL │ 7.88.1-10+deb12u5    │
# └──────────────┴──────────────┴──────────┴──────────────────────┘
```

### 5.4 Trivy 配置文件

```yaml
# trivy.yaml
debug: false
quiet: false

# 缓存配置
cache:
  dir: /tmp/trivy-cache
  clear: false

# 扫描配置
scan:
  scanners:
    - vuln
    - secret
    - misconfig
  skip-dirs:
    - vendor
    - node_modules
    - .git
  skip-files:
    - "**/*_test.go"

# 漏洞配置
vulnerability:
  ignore-unfixed: false
  ignore-file: .trivyignore

# 报告配置
format: json
output: report.json

# 严重级别过滤
severity: CRITICAL,HIGH

# 注册表配置
registry:
  mirrors:
    "docker.io": "mirror.example.com"
  username: ${REGISTRY_USER}
  password: ${REGISTRY_PASS}
```

### 5.5 .trivyignore 文件

```text
# .trivyignore - 忽略特定漏洞

# 已评估且接受风险的漏洞
CVE-2023-12345
CVE-2023-67890

# 误报（不影响运行环境）
CVE-2024-11111

# 已在其他层面缓解
CVE-2024-22222

# 添加原因注释
CVE-2023-99999 # 仅影响 Windows，不影响 Linux 部署
```

## 六、PHP/Composer 项目 SBOM

### 6.1 Laravel 项目 SBOM 生成

```bash
# 方法一：使用 Syft 扫描 composer.lock
cd /path/to/laravel-project

# 确保 composer.lock 存在
composer install --no-dev  # 生产依赖

# Syft 自动识别 composer.lock
syft dir:. -o spdx-json=sbom.spdx.json

# 方法二：使用 Trivy
trivy fs --format spdx-json --output sbom.spdx.json .

# 方法三：使用 composer 原生能力
# Composer 2.6+ 支持 --format=lock
composer show --format=json > composer-deps.json

# 方法四：使用专门的 SBOM 工具
# 安装 sbom-tool (Microsoft)
composer global require sbom-tool/sbom-tool-php

# 生成 SBOM
sbom-tool generate \
  --build-drop-path . \
  --output-path ./sbom \
  --format spdx:2.2
```

### 6.2 分析 Composer 依赖树

```bash
# 查看完整依赖树
composer show --tree

# 导出依赖列表
composer show --format=json | jq '.installed[] | {name, version}' > deps.json

# 使用 Syft 生成的 SBOM 分析
# 查看所有包
cat sbom.spdx.json | jq '.packages[] | {name, versionInfo}'

# 统计直接 vs 传递依赖
cat sbom.spdx.json | jq '.relationships | map(select(.relationshipType == "DEPENDS_ON")) | length'

# 检查许可证合规
cat sbom.spdx.json | jq '.packages[] | {name, licenseConcluded} | select(.licenseConcluded != "MIT")'
```

### 6.3 多语言项目处理

```bash
# 一个项目可能包含多种语言
# Laravel + Node.js (前端) + Python (ML 脚本)

# Syft 自动检测所有包管理器
syft dir:. -o spdx-json=full-sbom.spdx.json

# 查看检测到的包类型
cat full-sbom.spdx.json | jq '.packages | group_by(.externalRefs[0].referenceLocator | split("/")[0]) | map({type: .[0].externalRefs[0].referenceLocator | split("/")[0], count: length})'
```

## 七、Docker 多阶段构建的 SBOM

### 7.1 多阶段构建

```dockerfile
# Dockerfile
# Stage 1: Composer 依赖安装
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --no-progress

# Stage 2: Node.js 前端构建
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY resources/ resources/
RUN npm run build

# Stage 3: 最终镜像
FROM php:8.3-fpm-alpine
WORKDIR /var/www/html

COPY . .
COPY --from=vendor /app/vendor vendor
COPY --from=frontend /app/public/build public/build

# 安全: 删除不必要的文件
RUN rm -rf tests .env.example docker-compose.yml

EXPOSE 9000
CMD ["php-fpm"]
```

### 7.2 每个阶段生成 SBOM

```bash
# 为每个构建阶段生成 SBOM

# 方法一：使用 docker build + SBOM 输出（BuildKit）
DOCKER_BUILDKIT=1 docker build \
  --sbom=true \
  --tag myapp:latest \
  .

# 查看生成的 SBOM
docker buildx imagetools inspect myapp:latest --format '{{json .SBOM}}'

# 方法二：构建后扫描
docker build -t myapp:latest .

# 扫描最终镜像
syft myapp:latest -o spdx-json=image-sbom.spdx.json

# 方法三：为每个阶段单独扫描
# 需要构建中间镜像
docker build --target vendor -t myapp:vendor .
docker build --target frontend -t myapp:frontend .

syft myapp:vendor -o spdx-json=vendor-sbom.spdx.json
syft myapp:frontend -o spdx-json=frontend-sbom.spdx.json
syft myapp:latest -o spdx-json=final-sbom.spdx.json
```

### 7.3 最小化 SBOM 面积

```dockerfile
# 优化：减小镜像体积 = 减小 SBOM 面积

# 使用 Alpine 基础镜像
FROM php:8.3-fpm-alpine

# 只安装必要的系统包
RUN apk add --no-cache \
    libpng \
    libjpeg-turbo \
    freetype \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install gd pdo_mysql

# 使用 multi-stage 减少最终镜像依赖
# Stage 1 用于编译，Stage 2 只复制编译结果
FROM php:8.3-fpm-alpine AS builder
RUN apk add --no-cache $PHPIZE_DEPS
RUN pecl install redis && docker-php-ext-enable redis

FROM php:8.3-fpm-alpine AS runtime
COPY --from=builder /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=builder /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/
# 最终镜像不包含编译工具，SBOM 更干净
```

## 八、CI 集成

### 8.1 GitHub Actions

```yaml
# .github/workflows/sbom.yml
name: SBOM Generation

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  generate-sbom:
    name: Generate SBOM
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      security-events: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Install Syft
        uses: anchore/sbom-action/download-syft@v0
        with:
          syft-version: "v0.100.0"
      
      - name: Generate filesystem SBOM
        run: |
          syft dir:. \
            -o spdx-json=sbom-files.spdx.json \
            -o cyclonedx-json=sbom-files.cdx.json \
            -o table
      
      - name: Build Docker image
        run: |
          docker build -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} .
      
      - name: Generate image SBOM
        run: |
          syft ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -o spdx-json=sbom-image.spdx.json \
            -o cyclonedx-json=sbom-image.cdx.json
      
      - name: Scan vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
      
      - name: Upload Trivy scan results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'
      
      - name: Upload SBOM artifacts
        uses: actions/upload-artifact@v4
        with:
          name: sbom-artifacts
          path: |
            sbom-files.spdx.json
            sbom-files.cdx.json
            sbom-image.spdx.json
            sbom-image.cdx.json
          retention-days: 365
      
      - name: Upload image SBOM to OCI registry
        if: github.ref == 'refs/heads/main'
        run: |
          # 使用 Cosign 签名和附加 SBOM
          cosign attach sbom \
            --sbom sbom-image.spdx.json \
            --type spdxjson \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
      
      - name: SBOM quality gate
        run: |
          # 检查 SBOM 完整性
          PACKAGE_COUNT=$(jq '.packages | length' sbom-files.spdx.json)
          echo "Total packages: $PACKAGE_COUNT"
          
          # 检查是否包含高风险组件
          HIGH_RISK=$(jq -r '.packages[] | select(.licenseConcluded | test("GPL-3.0|AGPL"; "i")) | .name' sbom-files.spdx.json)
          if [ -n "$HIGH_RISK" ]; then
            echo "⚠️ High-risk licenses found:"
            echo "$HIGH_RISK"
            # 可选：阻止合并
            # exit 1
          fi
          
          # 检查漏洞数量
          VULN_COUNT=$(trivy image --format json ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} | jq '[.Results[].Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length')
          echo "Critical vulnerabilities: $VULN_COUNT"
          
          if [ "$VULN_COUNT" -gt 0 ]; then
            echo "❌ Critical vulnerabilities found!"
            exit 1
          fi
```

### 8.2 GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - build
  - sbom
  - scan
  - publish

variables:
  TRIVY_VERSION: "0.50.0"
  SYFT_VERSION: "0.100.0"

build:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

generate-sbom:
  stage: sbom
  image: anchore/syft:v${SYFT_VERSION}
  needs: [build]
  script:
    # 文件系统 SBOM
    - syft dir:. -o spdx-json=sbom-files.spdx.json -o table
    # 镜像 SBOM
    - syft $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA -o spdx-json=sbom-image.spdx.json -o cyclonedx-json=sbom-image.cdx.json
  artifacts:
    paths:
      - sbom-*.spdx.json
      - sbom-*.cdx.json
    expire_in: never  # SBOM 永久保存

vulnerability-scan:
  stage: scan
  image: aquasec/trivy:${TRIVY_VERSION}
  needs: [build]
  script:
    # 镜像漏洞扫描
    - trivy image --exit-code 1 --severity CRITICAL $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
    # 生成报告
    - trivy image --format json --output vuln-report.json $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  artifacts:
    paths:
      - vuln-report.json
    when: always

license-check:
  stage: scan
  image: anchore/syft:v${SYFT_VERSION}
  needs: [generate-sbom]
  script:
    - |
      FORBIDDEN_LICENSES="GPL-3.0 AGPL-3.0 SSPL-1.0"
      for license in $FORBIDDEN_LICENSES; do
        FOUND=$(jq -r ".packages[] | select(.licenseConcluded | test(\"$license\")) | .name" sbom-files.spdx.json)
        if [ -n "$FOUND" ]; then
          echo "❌ Forbidden license ($license) found in: $FOUND"
          exit 1
        fi
      done
    - echo "✅ License check passed"

publish-sbom:
  stage: publish
  needs: [generate-sbom, vulnerability-scan]
  script:
    # 上传到 SBOM 存储服务
    - curl -X POST -F "file=@sbom-image.spdx.json" https://sbom.example.com/api/v1/sbom
  only:
    - main
    - tags
```

### 8.3 质量门禁

```bash
#!/bin/bash
# scripts/sbom-quality-gate.sh

set -e

SBOM_FILE=${1:-sbom.spdx.json}
REPORT_FILE="sbom-quality-report.txt"

echo "=== SBOM Quality Gate ===" > "$REPORT_FILE"
echo "Date: $(date)" >> "$REPORT_FILE"
echo "SBOM: $SBOM_FILE" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 1. 检查 SBOM 文件有效性
if ! jq empty "$SBOM_FILE" 2>/dev/null; then
  echo "❌ Invalid SBOM JSON" >> "$REPORT_FILE"
  exit 1
fi

# 2. 检查包数量
PACKAGE_COUNT=$(jq '.packages | length' "$SBOM_FILE")
echo "📦 Total packages: $PACKAGE_COUNT" >> "$REPORT_FILE"

if [ "$PACKAGE_COUNT" -eq 0 ]; then
  echo "❌ No packages found in SBOM" >> "$REPORT_FILE"
  exit 1
fi

# 3. 检查许可证合规
echo "" >> "$REPORT_FILE"
echo "📜 License Analysis:" >> "$REPORT_FILE"
jq -r '.packages | group_by(.licenseConcluded) | map({license: .[0].licenseConcluded, count: length}) | sort_by(-.count)[] | "  \(.license): \(.count)"' "$SBOM_FILE" >> "$REPORT_FILE"

# 4. 检查高风险许可证
FORBIDDEN="GPL-3.0 AGPL-3.0 SSPL-1.0 BUSL-1.1"
RISK_FOUND=false
for license in $FORBIDDEN; do
  COUNT=$(jq "[.packages[] | select(.licenseConcluded | test(\"$license\"))] | length" "$SBOM_FILE")
  if [ "$COUNT" -gt 0 ]; then
    echo "⚠️ Found $COUNT packages with $license license" >> "$REPORT_FILE"
    RISK_FOUND=true
  fi
done

# 5. 检查版本不明确的依赖
UNKNOWN_VERSIONS=$(jq '[.packages[] | select(.versionInfo == "" or .versionInfo == null)] | length' "$SBOM_FILE")
if [ "$UNKNOWN_VERSIONS" -gt 0 ]; then
  echo "⚠️ $UNKNOWN_VERSIONS packages with unknown versions" >> "$REPORT_FILE"
fi

# 6. 输出报告
cat "$REPORT_FILE"

if [ "$RISK_FOUND" = true ]; then
  echo ""
  echo "❌ Quality gate FAILED: High-risk licenses detected"
  exit 1
fi

echo ""
echo "✅ Quality gate PASSED"
```

## 九、漏洞关联：Grype

### 9.1 使用 Grype 消费 SBOM

```bash
# 安装 Grype
brew install grype

# 从 SBOM 进行漏洞扫描
grype sbom:sbom.spdx.json

# 输出 JSON 格式
grype sbom:sbom.spdx.json -o json > vuln-report.json

# 只显示可修复的漏洞
grype sbom:sbom.spdx.json --only-fixed

# 按严重级别过滤
grype sbom:sbom.spdx.json --fail-on critical

# 与 Syft 集成使用
syft myapp:latest -o spdx-json=sbom.spdx.json && grype sbom:sbom.spdx.json
```

### 9.2 输出示例

```text
Grype 漏洞扫描输出:

NAME             INSTALLED   FIXED-IN    TYPE     VULNERABILITY   SEVERITY
laravel/framework 11.0.0     11.5.0      composer  CVE-2024-1234  High
guzzlehttp/guzzle 7.8.0      7.8.1       composer  CVE-2024-5678  Critical
php               8.3.0      8.3.4       binary    CVE-2024-9012  Medium
libssl3           3.0.11     3.0.13      deb       CVE-2024-3456  High
curl              7.88.1     7.88.1-10   deb       CVE-2024-7890  Critical

Found 5 vulnerabilities in 4 packages
```

### 9.3 自动化漏洞监控

```yaml
# .github/workflows/vuln-monitor.yml
name: Vulnerability Monitoring

on:
  schedule:
    - cron: '0 8 * * *'  # 每天早上 8 点

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Download latest SBOM
        uses: actions/download-artifact@v4
        with:
          name: sbom-artifacts
          path: sbom/
      
      - name: Scan for new vulnerabilities
        run: |
          grype sbom:sbom/sbom-image.spdx.json -o json > vuln-report.json
          
          # 检查是否有新的 Critical 漏洞
          NEW_CRITICAL=$(jq '[.matches[] | select(.vulnerability.severity == "CRITICAL")] | length' vuln-report.json)
          
          if [ "$NEW_CRITICAL" -gt 0 ]; then
            echo "::error::Found $NEW_CRITICAL critical vulnerabilities!"
            
            # 创建 Issue
            gh issue create \
              --title "🚨 Critical vulnerabilities found" \
              --body "Found $NEW_CRITICAL critical vulnerabilities. See artifacts for details." \
              --label "security,urgent"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 十、企业级 SBOM 治理

### 10.1 SBOM 管理平台

```text
企业 SBOM 治理架构:

┌─────────────────────────────────────────────────────────┐
│                    SBOM 管理平台                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 采集层    │  │ 分析层    │  │ 展示层    │              │
│  │          │  │          │  │          │              │
│  │ • Syft   │  │ • Grype  │  │ • Dashboard│             │
│  │ • Trivy  │  │ • OSV    │  │ • API     │             │
│  │ • CI集成 │  │ • NVD    │  │ • 报告    │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────▼──────────────▼──────────────▼────┐              │
│  │            SBOM 数据库                 │              │
│  │  • 存储所有版本的 SBOM                 │              │
│  │  • 版本对比与差异分析                   │              │
│  │  • 许可证合规记录                       │              │
│  │  • 漏洞关联与追踪                       │              │
│  └───────────────────────────────────────┘              │
│                                                          │
│  ┌───────────────────────────────────────┐              │
│  │            OCI Registry               │              │
│  │  • 镜像 + SBOM + 签名 一起存储        │              │
│  │  • 不可篡改的供应链记录               │              │
│  └───────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### 10.2 SBOM 存储与分发

```bash
# OCI Registry 存储 SBOM

# 1. 使用 Cosign 附加 SBOM 到镜像
cosign attach sbom \
  --sbom sbom.spdx.json \
  --type spdxjson \
  myregistry.com/myapp:v1.0.0

# 2. 使用 ORAS 推送 SBOM
oras push myregistry.com/myapp:v1.0.0-sbom \
  sbom.spdx.json:application/spdx+json

# 3. 使用 Skopeo 拉取 SBOM
skopeo inspect --raw docker://myregistry.com/myapp:v1.0.0-sbom

# 4. API 查询 SBOM
curl -s https://sbom.example.com/api/v1/apps/myapp/versions/1.0.0 \
  -H "Authorization: Bearer $TOKEN" | jq '.packages[] | {name, version}'
```

## 十一、踩坑记录

### 11.1 常见问题

```text
SBOM 生成踩坑记录:

问题 1: Syft 扫描不到 vendor 目录
原因: .syft.yaml 配置了排除 vendor
解决: 使用 --scope all-layers 或移除排除规则

问题 2: Docker 镜像 SBOM 包含基础镜像的包
原因: 默认扫描所有层
解决: 使用 --scope squashed 只扫描应用层

问题 3: Composer.lock 不存在导致 SBOM 不完整
原因: .gitignore 排除了 composer.lock
解决: 确保 CI 中执行 composer install 生成 lock 文件

问题 4: Node.js 依赖过多导致 SBOM 文件过大
原因: node_modules 包含数千个包
解决: 使用 --exclude 排除 node_modules，只扫描 package-lock.json

问题 5: SBOM 格式不兼容
原因: 不同工具使用不同版本的 SPDX/CycloneDX
解决: 统一工具版本，使用标准格式

问题 6: 私有依赖无法识别
原因: 私有包不在公共数据库中
解决: 配置 Syft 的额外扫描器或手动添加元数据
```

### 11.2 性能优化

```bash
# 大型项目 SBOM 生成优化

# 1. 使用缓存
syft dir:. --cache-dir /tmp/syft-cache -o spdx-json=sbom.spdx.json

# 2. 并行扫描
# 对于 monorepo，可以并行扫描子项目
for dir in project-a project-b project-c; do
  syft "dir:$dir" -o "spdx-json=sbom-$dir.spdx.json" &
done
wait

# 3. 增量扫描
# 只扫描变化的文件（需要自定义脚本）
CHANGED_FILES=$(git diff --name-only HEAD~1)
if echo "$CHANGED_FILES" | grep -q "composer\|package"; then
  syft dir:. -o spdx-json=sbom.spdx.json
fi

# 4. 镜像扫描优化
# 使用 --skip-dirs 跳过不需要的目录
trivy image --skip-dirs /usr/share/doc --skip-dirs /usr/share/man myapp:latest
```

## 十二、总结

### 核心要点

```text
┌─────────────────────────────────────────────────────────┐
│ SBOM 实践关键要点                                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 1. 为什么需要 SBOM                                       │
│    - 快速响应漏洞（分钟级 vs 天级）                      │
│    - 满足法规合规要求                                    │
│    - 了解软件供应链风险                                  │
│    - 许可证合规管理                                      │
│                                                          │
│ 2. 工具选择                                              │
│    - Syft: 专注于 SBOM 生成，格式全面                    │
│    - Trivy: SBOM + 漏洞扫描一体化                        │
│    - Grype: 从 SBOM 进行漏洞分析                         │
│    - 推荐: Syft 生成 + Grype 扫描                        │
│                                                          │
│ 3. 格式选择                                              │
│    - SPDX: 许可证合规首选                                │
│    - CycloneDX: 漏洞分析首选                             │
│    - 建议: 两种格式都生成                                │
│                                                          │
│ 4. CI 集成                                               │
│    - 每次构建自动生成 SBOM                               │
│    - 质量门禁：漏洞 + 许可证检查                         │
│    - SBOM 与制品一起存储                                 │
│    - 持续监控新漏洞                                      │
│                                                          │
│ 5. 企业治理                                              │
│    - 集中化 SBOM 管理平台                                │
│    - OCI Registry 存储 SBOM                              │
│    - 自动化合规报告                                      │
│    - 定期审计与更新                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 行动清单

1. **今天**: 在本地项目运行 `syft dir:. -o table` 查看当前依赖
2. **本周**: 在 CI 中添加 SBOM 生成步骤
3. **本月**: 配置漏洞扫描质量门禁，阻止高危漏洞合入
4. **本季**: 建立 SBOM 存储和查询系统，实现漏洞快速响应
5. **持续**: 每日自动扫描，及时发现新漏洞

供应链安全不是一次性工程，而是持续的过程。从生成第一个 SBOM 开始，逐步建立完整的供应链安全体系，让你的软件真正"可见、可控、可审计"。

## 相关阅读

- [PCI DSS 合规实战：支付系统安全标准落地——Laravel 应用中的 Token 化、审计日志与网络分段](/post/pci-dss-laravel-token/)
- [GDPR/个人信息保护法合规实战：Laravel 应用中的数据主体权利、同意管理与跨境传输](/post/gdpr-laravel/)
- [Docker 29.x 实战：BuildKit、多阶段构建与镜像优化策略踩坑记录](/post/docker-29-x-guide-buildkit-imageoptimization/)
