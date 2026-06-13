---

title: 容器安全扫描实战：Trivy/Snyk/Grype CI 集成——镜像漏洞检测、SBOM 生成与修复工作流
date: 2026-06-03 00:00:00
tags:
- Docker
- Security
- Trivy
- snyk
- grype
- SBOM
- CI/CD
description: 容器安全扫描实战指南，深入对比 Trivy、Snyk、Grype 三大主流镜像漏洞扫描工具的架构原理与 CI/CD 集成方案。涵盖 GitHub Actions 与 GitLab CI 中的安全门禁配置、SBOM 生成（SPDX/CycloneDX 标准）、Dependency-Track 漏洞管理平台部署、OPA/Kyverno Policy-as-Code 策略编写，以及 Trivy Operator 持续监控。附带完整可运行的 CI 配置示例与 7 个真实踩坑案例，帮助 DevSecOps 团队在构建阶段拦截 90% 以上的容器安全风险。
categories:
  - devops
keywords: [Trivy, Snyk, Grype CI, SBOM, 容器安全扫描实战, 镜像漏洞检测, 生成与修复工作流]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




在云原生时代，容器已成为应用部署的标准单元。Docker 镜像中包含的操作系统包、运行时依赖和应用程序库都可能存在已知漏洞。据统计，超过 60% 的容器镜像在生产环境中存在已知高危漏洞，而这些漏洞中有相当比例可以通过及时的扫描和修复来避免。本文将深入探讨容器安全扫描的实战方法，对比 Trivy、Snyk、Grype 三大主流扫描工具，展示如何在 CI/CD 流水线中集成镜像漏洞检测，生成 SBOM（Software Bill of Materials），并建立完整的漏洞修复工作流。

<!-- more -->

## 一、为什么容器安全扫描至关重要

### 1.1 容器安全的现状与挑战

容器技术的广泛采用带来了部署效率的极大提升，但同时也引入了新的安全挑战。与传统虚拟机不同，容器共享宿主机内核，一旦容器内部存在漏洞被利用，攻击者可能突破容器隔离边界，进而影响整个宿主机甚至集群的安全。

根据 Sysdig 2025 年容器安全报告的数据，超过 87% 的容器镜像存在高危或严重漏洞，其中大部分来自基础镜像中的操作系统级包。这些漏洞的平均修复周期为 28 天，而攻击者利用零日漏洞的平均时间仅为几天。这意味着如果我们不能在构建阶段就发现并修复这些漏洞，生产环境将长时间暴露在风险之中。

容器安全面临的主要挑战包括：

- **供应链风险**：镜像构建过程中引入的第三方依赖可能包含恶意代码或已知漏洞
- **基础镜像老化**：长期未更新的基础镜像积累了大量已修补但本地未更新的漏洞
- **配置错误**：不当的 Dockerfile 配置（如以 root 用户运行、暴露不必要的端口）增加了攻击面
- **密钥泄露**：镜像层中可能意外包含 API 密钥、数据库密码等敏感信息
- **合规要求**：金融、医疗等行业对软件供应链安全有严格的合规要求（如 PCI DSS、HIPAA）

### 1.2 左移安全（Shift-Left Security）理念

传统的安全模型将安全检查放在部署阶段，而 DevSecOps 倡导的左移安全理念要求将安全检查前移到开发阶段。在容器安全领域，这意味着：

1. **代码编写阶段**：使用安全的基础镜像，编写最小权限的 Dockerfile
2. **构建阶段**：在 CI 流水线中自动扫描镜像漏洞
3. **发布阶段**：生成 SBOM 并签名，确保镜像来源可信
4. **运行阶段**：持续监控已部署容器的漏洞状态

通过在 CI/CD 流水线中集成容器安全扫描工具，我们可以在代码提交后几分钟内发现镜像中的安全问题，大幅缩短漏洞暴露时间窗口。

### 1.3 容器安全扫描的核心价值

容器安全扫描不仅仅是一个"打补丁"的过程，它在软件开发生命周期中扮演着多重角色：

- **风险量化**：将模糊的安全担忧转化为可度量的指标（漏洞数量、严重等级分布）
- **决策支持**：为是否阻断构建/部署提供数据依据
- **合规证明**：生成可审计的安全报告，满足监管要求
- **供应链可见性**：通过 SBOM 清楚了解软件物料组成
- **持续改进**：追踪漏洞趋势，评估安全改进效果

## 二、主流容器安全扫描工具深度对比

### 2.1 Trivy：开源全能扫描器

Trivy 是由 Aqua Security 开发的开源安全扫描工具，目前是 CNCF 的孵化项目。它以其全面的扫描能力、简洁的接口设计和快速的扫描速度著称。

**核心特性：**

- 扫描容器镜像中的 OS 包和应用依赖漏洞
- 支持扫描文件系统、Git 仓库、Kubernetes 集群
- 检测 IaC（Infrastructure as Code）配置错误
- 内置密钥泄露检测
- 支持 SBOM 生成（SPDX 和 CycloneDX 格式）
- 可作为 Go 库集成到自定义工具中

**安装与基本使用：**

```bash
# macOS 安装
brew install trivy

# Linux 安装
sudo apt-get install trivy
# 或者
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Docker 方式运行
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image nginx:latest

# 扫描镜像并仅显示高危和严重漏洞
trivy image --severity HIGH,CRITICAL nginx:latest

# 扫描并输出 JSON 格式
trivy image --format json --output result.json nginx:latest

# 扫描本地 Dockerfile
trivy config --severity HIGH,CRITICAL ./Dockerfile

# 生成 SBOM
trivy image --format spdx-json --output sbom.spdx.json nginx:latest
```

**漏洞数据库：**

Trivy 使用多个漏洞数据库来源：
- **NVD**（National Vulnerability Database）：美国国家漏洞数据库
- **OS 厂商公告**：Debian Security Tracker、Ubuntu CVE Tracker、Red Hat CVE Tracker、Alpine SecDB 等
- **语言生态系统安全公告**：GitHub Advisory Database、PHP advisories 等
- **GitLab Advisory Database**

数据库每 12 小时自动更新一次，首次使用时会自动下载缓存。

### 2.2 Snyk：商业级开发者安全平台

Snyk 是一个商业化的开发者安全平台，提供容器扫描、代码安全、依赖安全和 IaC 安全等全方位功能。其最大的优势在于开发者友好的体验和精准的漏洞修复建议。

**核心特性：**

- 深度的漏洞上下文分析（可利用性评估）
- 精准的自动修复建议
- 漏洞优先级排序（基于 EPSS 评分和可达性分析）
- 与开发工具链深度集成（IDE 插件、Git 集成）
- 持续监控已部署容器
- 强大的策略管理能力

**安装与基本使用：**

```bash
# 安装 Snyk CLI
npm install -g snyk

# 首次认证
snyk auth

# 扫描 Docker 镜像
snyk container test nginx:latest

# 扫描并输出 JSON 格式
snyk container test nginx:latest --json-file-output=result.json

# 扫描并只显示可升级修复的漏洞
snyk container test nginx:latest --dockerfile-path=./Dockerfile

# 持续监控
snyk container monitor nginx:latest --file=Dockerfile --project-name=my-project
```

**Snyk 的差异化优势——可利用性分析：**

Snyk 不仅仅报告漏洞，还会分析漏洞是否在当前上下文中可被利用。例如，一个 OpenCV 库中的缓冲区溢出漏洞如果在项目中从未被调用到相关函数，Snyk 会将其标记为"不可利用"，从而帮助团队聚焦真正有风险的漏洞。这种可达性分析（Reachability Analysis）基于静态代码分析技术，可以减少 70% 以上的误报。

### 2.3 Grype：专注镜像扫描的轻量级工具

Grype 是由 Anchore 开发的开源容器镜像漏洞扫描器，专注于提供快速、准确的镜像漏洞检测。与 Anchore 的另一个开源项目 Syft（SBOM 生成工具）配合使用，可以构建完整的容器安全扫描流水线。

**核心特性：**

- 快速的镜像漏洞扫描
- 支持多种 Linux 发行版和语言生态系统
- 丰富的输出格式（table、json、cyclonedx）
- 支持自定义漏洞匹配规则
- 可与 Syft 集成生成 SBOM
- 支持漏洞忽略和豁免规则

**安装与基本使用：**

```bash
# macOS 安装
brew install grype

# Linux 安装
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# Docker 方式运行
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  anchore/grype:latest nginx:latest

# 扫描镜像并输出 JSON 格式
grype nginx:latest -o json > result.json

# 仅显示高危和严重漏洞
grype nginx:latest --fail-on high

# 使用指定的漏洞数据库
grype nginx:latest --db auto-update=true

# 配合 Syft 生成 SBOM
syft nginx:latest -o cyclonedx-json > sbom.json
grype sbom:./sbom.json
```

**漏洞数据库：**

Grype 使用 Anchore 自己维护的漏洞数据库，该数据库聚合了多个来源的漏洞信息，包括 NVD、各 Linux 发行版的安全公告、GitHub Advisory Database 等。数据库支持自动更新和离线使用。

### 2.4 三工具深度对比

| 特性 | Trivy | Snyk | Grype |
|------|-------|------|-------|
| **开源协议** | Apache 2.0 | 商业（有免费层） | Apache 2.0 |
| **扫描对象** | 镜像/文件系统/K8s/IaC | 镜像/代码/依赖/IaC | 镜像 |
| **漏洞数据库来源** | NVD + OS 厂商 + 语言生态 | Snyk 自维护 | Anchore 聚合数据库 |
| **SBOM 生成** | ✅ SPDX/CycloneDX | ✅ 有限支持 | ✅ 通过 Syft |
| **扫描速度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **误报率** | 低 | 最低（可达性分析） | 中等 |
| **修复建议** | ✅ 基础 | ✅ 精准（含 PR 修复） | ❌ 有限 |
| **CI 集成** | GitHub Actions/GitLab CI/Jenkins | 原生支持所有主流 CI | GitHub Actions/GitLab CI |
| **Kubernetes 集成** | ✅ 原生 Operator | ✅ Snyk Controller | ❌ 需配合其他工具 |
| **策略引擎** | ✅ OPA 集成 | ✅ 内置策略 | ✅ .grype.yaml 配置 |
| **密钥检测** | ✅ | ❌ | ❌ |
| **License 扫描** | ✅ | ✅ | ✅ |

**综合评价：**

- **Trivy** 是综合能力最强的开源选择，适合追求全面覆盖和零成本的团队
- **Snyk** 提供最佳的开发者体验和最低的误报率，适合愿意付费换取高效率的企业
- **Grype** 是最轻量的选择，适合只需要基础镜像扫描且对速度有要求的场景

在实际项目中，推荐使用**双工具策略**：以 Trivy 为主力扫描器，配合 Snyk 或 Grype 进行交叉验证。不同工具的漏洞数据库和匹配策略存在差异，使用两个工具可以显著降低漏报率。

## 三、GitHub Actions 集成实战

### 3.1 基础流水线配置

以下是一个完整的 GitHub Actions 工作流配置，集成了 Trivy、Snyk 和 Grype 三个扫描器：

```yaml
# .github/workflows/container-security.yml
name: Container Security Scanning

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    # 每周一早上 8 点执行定期扫描
    - cron: '0 0 * * 1'

env:
  IMAGE_NAME: myapp/laravel
  IMAGE_TAG: ${{ github.sha }}

jobs:
  build-image:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          load: true
          tags: ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Save image as tar
        run: docker save ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -o /tmp/image.tar

      - name: Upload image artifact
        uses: actions/upload-artifact@v4
        with:
          name: docker-image
          path: /tmp/image.tar
          retention-days: 1

  trivy-scan:
    needs: build-image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load Docker image
        run: docker load -i /tmp/image.tar

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload Trivy scan results to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Generate Trivy JSON report
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          format: 'json'
          output: 'trivy-results.json'
          severity: 'CRITICAL,HIGH,MEDIUM'

      - name: Upload Trivy report
        uses: actions/upload-artifact@v4
        with:
          name: trivy-report
          path: trivy-results.json

  grype-scan:
    needs: build-image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load Docker image
        run: docker load -i /tmp/image.tar

      - name: Scan image with Grype
        uses: anchore/scan-action@v4
        id: grype-scan
        with:
          image: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          fail-build: true
          severity-cutoff: high
          output-format: sarif

      - name: Upload Grype SARIF results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: ${{ steps.grype-scan.outputs.sarif }}

      - name: Generate Grype JSON report
        run: |
          curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
          grype ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} -o json > grype-results.json

      - name: Upload Grype report
        uses: actions/upload-artifact@v4
        with:
          name: grype-report
          path: grype-results.json

  snyk-scan:
    needs: build-image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load Docker image
        run: docker load -i /tmp/image.tar

      - name: Run Snyk container test
        uses: snyk/actions/docker@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          image: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          args: --file=Dockerfile --severity-threshold=high --json-file-output=snyk-results.json

      - name: Upload Snyk report
        uses: actions/upload-artifact@v4
        with:
          name: snyk-report
          path: snyk-results.json

  generate-sbom:
    needs: build-image
    runs-on: ubuntu-latest
    steps:
      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load Docker image
        run: docker load -i /tmp/image.tar

      - name: Generate SBOM with Trivy (SPDX)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          format: 'spdx-json'
          output: 'sbom-spdx.json'

      - name: Generate SBOM with Trivy (CycloneDX)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          format: 'cyclonedx'
          output: 'sbom-cyclonedx.json'

      - name: Upload SBOM artifacts
        uses: actions/upload-artifact@v4
        with:
          name: sbom-reports
          path: |
            sbom-spdx.json
            sbom-cyclonedx.json

  vulnerability-report:
    needs: [trivy-scan, grype-scan, snyk-scan, generate-sbom]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Download all reports
        uses: actions/download-artifact@v4
        with:
          path: ./reports

      - name: Generate consolidated report
        run: |
          echo "## 🔒 Container Security Scan Results" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "### Scan Tool Results" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY

          # Parse Trivy results
          if [ -f ./reports/trivy-report/trivy-results.json ]; then
            TRIVY_CRITICAL=$(cat ./reports/trivy-report/trivy-results.json | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length')
            TRIVY_HIGH=$(cat ./reports/trivy-report/trivy-results.json | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="HIGH")] | length')
            echo "| Tool | Critical | High | Status |" >> $GITHUB_STEP_SUMMARY
            echo "|------|----------|------|--------|" >> $GITHUB_STEP_SUMMARY
            echo "| Trivy | $TRIVY_CRITICAL | $TRIVY_HIGH | ✅ Completed |" >> $GITHUB_STEP_SUMMARY
          fi

          # Parse Grype results
          if [ -f ./reports/grype-report/grype-results.json ]; then
            GRYPE_CRITICAL=$(cat ./reports/grype-report/grype-results.json | jq '[.matches[] | select(.vulnerability.severity=="Critical")] | length')
            GRYPE_HIGH=$(cat ./reports/grype-report/grype-results.json | jq '[.matches[] | select(.vulnerability.severity=="High")] | length')
            echo "| Grype | $GRYPE_CRITICAL | $GRYPE_HIGH | ✅ Completed |" >> $GITHUB_STEP_SUMMARY
          fi

      - name: Comment PR with scan results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const trivyReport = JSON.parse(fs.readFileSync('./reports/trivy-report/trivy-results.json', 'utf8'));

            let criticalCount = 0;
            let highCount = 0;
            let vulnList = [];

            for (const result of (trivyReport.Results || [])) {
              for (const vuln of (result.Vulnerabilities || [])) {
                if (vuln.Severity === 'CRITICAL') criticalCount++;
                if (vuln.Severity === 'HIGH') highCount++;
                if (vulnList.length < 10) {
                  vulnList.push(`| ${vuln.VulnerabilityID} | ${vuln.Severity} | ${vuln.PkgName} | ${vuln.InstalledVersion} | ${vuln.FixedVersion || 'N/A'} |`);
                }
              }
            }

            const body = `## 🔒 Container Security Scan Summary
            | Metric | Count |
            |--------|-------|
            | Critical | ${criticalCount} |
            | High | ${highCount} |

            ### Top Vulnerabilities
            | CVE | Severity | Package | Installed | Fixed |
            |-----|----------|---------|-----------|-------|
            ${vulnList.join('\n')}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

### 3.2 高级配置：条件阻断与阈值策略

在实际生产环境中，我们需要根据漏洞严重程度和数量来决定是否阻断构建：

```yaml
# .github/workflows/container-security-advanced.yml
  gate-decision:
    needs: [trivy-scan, grype-scan, snyk-scan]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Download all reports
        uses: actions/download-artifact@v4
        with:
          path: ./reports

      - name: Evaluate security gate
        id: security-gate
        run: |
          # 定义阈值
          MAX_CRITICAL=0
          MAX_HIGH=5

          # 解析 Trivy 报告
          TRIVY_CRITICAL=$(cat ./reports/trivy-report/trivy-results.json | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length' 2>/dev/null || echo 0)
          TRIVY_HIGH=$(cat ./reports/trivy-report/trivy-results.json | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="HIGH")] | length' 2>/dev/null || echo 0)

          # 解析 Grype 报告
          GRYPE_CRITICAL=$(cat ./reports/grype-report/grype-results.json | jq '[.matches[] | select(.vulnerability.severity=="Critical")] | length' 2>/dev/null || echo 0)
          GRYPE_HIGH=$(cat ./reports/grype-report/grype-results.json | jq '[.matches[] | select(.vulnerability.severity=="High")] | length' 2>/dev/null || echo 0)

          # 取两个工具的并集（去重）
          TOTAL_CRITICAL=$((TRIVY_CRITICAL > GRYPE_CRITICAL ? TRIVY_CRITICAL : GRYPE_CRITICAL))
          TOTAL_HIGH=$((TRIVY_HIGH > GRYPE_HIGH ? TRIVY_HIGH : GRYPE_HIGH))

          echo "Critical: $TOTAL_CRITICAL, High: $TOTAL_HIGH"

          if [ "$TOTAL_CRITICAL" -gt "$MAX_CRITICAL" ]; then
            echo "gate_passed=false" >> $GITHUB_OUTPUT
            echo "❌ Security gate FAILED: $TOTAL_CRITICAL critical vulnerabilities found (max: $MAX_CRITICAL)"
            exit 1
          elif [ "$TOTAL_HIGH" -gt "$MAX_HIGH" ]; then
            echo "gate_passed=false" >> $GITHUB_OUTPUT
            echo "⚠️ Security gate WARNING: $TOTAL_HIGH high vulnerabilities found (max: $MAX_HIGH)"
            exit 1
          else
            echo "gate_passed=true" >> $GITHUB_OUTPUT
            echo "✅ Security gate PASSED"
          fi
```

## 四、GitLab CI 集成实战

### 4.1 GitLab CI 流水线配置

```yaml
# .gitlab-ci.yml
stages:
  - build
  - scan
  - sbom
  - gate
  - publish

variables:
  IMAGE_NAME: ${CI_REGISTRY_IMAGE}
  IMAGE_TAG: ${CI_COMMIT_SHORT_SHA}
  TRIVY_SEVERITY: "CRITICAL,HIGH,MEDIUM"
  TRIVY_EXIT_CODE: "1"
  TRIVY_NO_PROGRESS: "true"

build:
  stage: build
  image: docker:24-dind
  services:
    - docker:24-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
    - docker push ${IMAGE_NAME}:${IMAGE_TAG}
  only:
    - main
    - merge_requests

trivy-scan:
  stage: scan
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  services:
    - docker:24-dind
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    # 生成表格报告用于控制台输出
    - trivy image --severity ${TRIVY_SEVERITY} ${IMAGE_NAME}:${IMAGE_TAG}
    # 生成 SARIF 报告上传到 GitLab Security Dashboard
    - trivy image --format sarif --output trivy-sarif.json ${IMAGE_NAME}:${IMAGE_TAG}
    # 生成 JSON 报告用于后续分析
    - trivy image --format json --output trivy-results.json --severity ${TRIVY_SEVERITY} ${IMAGE_NAME}:${IMAGE_TAG}
  artifacts:
    paths:
      - trivy-sarif.json
      - trivy-results.json
    reports:
      container_scanning: trivy-sarif.json
  allow_failure: true

grype-scan:
  stage: scan
  image:
    name: anchore/grype:latest
    entrypoint: [""]
  services:
    - docker:24-dind
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - grype registry:${IMAGE_NAME}:${IMAGE_TAG} -o table
    - grype registry:${IMAGE_NAME}:${IMAGE_TAG} -o json > grype-results.json
  artifacts:
    paths:
      - grype-results.json
  allow_failure: true

snyk-scan:
  stage: scan
  image:
    name: snyk/snyk:docker
    entrypoint: [""]
  services:
    - docker:24-dind
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: "/certs"
    SNYK_TOKEN: ${SNYK_TOKEN}
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - snyk container test ${IMAGE_NAME}:${IMAGE_TAG} --severity-threshold=high --json-file-output=snyk-results.json
  artifacts:
    paths:
      - snyk-results.json
  allow_failure: true

generate-sbom:
  stage: sbom
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  services:
    - docker:24-dind
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    # 生成 SPDX 格式 SBOM
    - trivy image --format spdx-json --output sbom-spdx.json ${IMAGE_NAME}:${IMAGE_TAG}
    # 生成 CycloneDX 格式 SBOM
    - trivy image --format cyclonedx --output sbom-cyclonedx.json ${IMAGE_NAME}:${IMAGE_TAG}
    # 上传 SBOM 到 Dependency Track 或其他管理系统
    - |
      if [ -n "$DEPENDENCY_TRACK_URL" ]; then
        curl -X POST "${DEPENDENCY_TRACK_URL}/api/v1/bom" \
          -H "X-Api-Key: ${DEPENDENCY_TRACK_API_KEY}" \
          -H "Content-Type: multipart/form-data" \
          -F "project=${DEPENDENCY_TRACK_PROJECT_UUID}" \
          -F "bom=@sbom-cyclonedx.json"
      fi
  artifacts:
    paths:
      - sbom-spdx.json
      - sbom-cyclonedx.json

security-gate:
  stage: gate
  image: python:3.11-slim
  needs:
    - trivy-scan
    - grype-scan
    - snyk-scan
  script:
    - pip install jq pyyaml
    - |
      python3 << 'EOF'
      import json
      import sys

      # 读取报告
      def load_json(path):
          try:
              with open(path) as f:
                  return json.load(f)
          except (FileNotFoundError, json.JSONDecodeError):
              return None

      trivy = load_json('trivy-results.json')
      grype = load_json('grype-results.json')

      critical_count = 0
      high_count = 0

      # 解析 Trivy 结果
      if trivy:
          for result in trivy.get('Results', []):
              for vuln in result.get('Vulnerabilities', []):
                  if vuln.get('Severity') == 'CRITICAL':
                      critical_count += 1
                  elif vuln.get('Severity') == 'HIGH':
                      high_count += 1

      # 如果有 Grype 结果，取最大值
      if grype:
          grype_critical = len([m for m in grype.get('matches', []) if m.get('vulnerability', {}).get('severity') == 'Critical'])
          grype_high = len([m for m in grype.get('matches', []) if m.get('vulnerability', {}).get('severity') == 'High'])
          critical_count = max(critical_count, grype_critical)
          high_count = max(high_count, grype_high)

      print(f"Critical: {critical_count}, High: {high_count}")

      # 安全门禁
      if critical_count > 0:
          print(f"❌ FAILED: {critical_count} critical vulnerabilities")
          sys.exit(1)
      elif high_count > 5:
          print(f"⚠️ WARNING: {high_count} high vulnerabilities exceed threshold")
          sys.exit(1)
      else:
          print("✅ PASSED: Security gate cleared")
      EOF

publish:
  stage: publish
  image: docker:24-dind
  services:
    - docker:24-dind
  needs:
    - build
    - security-gate
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker pull ${IMAGE_NAME}:${IMAGE_TAG}
    - docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
    - docker push ${IMAGE_NAME}:latest
  only:
    - main
```

### 4.2 GitLab 安全仪表盘集成

GitLab 提供了内置的安全仪表盘功能，可以直接展示扫描结果。要启用此功能，需要确保扫描报告以正确的格式输出：

```yaml
# 在 .gitlab-ci.yml 中添加安全报告解析
trivy-scan:
  # ... 其他配置 ...
  script:
    # 使用 GitLab 兼容的容器扫描报告格式
    - trivy image --format json --output gl-container-scanning-report.json ${IMAGE_NAME}:${IMAGE_TAG}
  artifacts:
    reports:
      container_scanning: gl-container-scanning-report.json
```

## 五、Laravel 项目实战：镜像漏洞扫描与修复

### 5.1 创建一个有漏洞的 Laravel Dockerfile

为了演示真实的漏洞扫描和修复流程，我们先创建一个典型的 Laravel 应用 Dockerfile，这个 Dockerfile 故意使用了较老的 PHP 基础镜像：

```dockerfile
# Dockerfile (vulnerable version)
FROM php:8.1-fpm

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    zip \
    unzip \
    libpq-dev \
    libzip-dev \
    && docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd zip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 安装 Composer
COPY --from=composer:2.5 /usr/bin/composer /usr/bin/composer

# 设置工作目录
WORKDIR /var/www

# 复制应用代码
COPY . /var/www

# 安装 PHP 依赖
RUN composer install --no-dev --optimize-autoloader

# 设置权限
RUN chown -R www-data:www-data /var/www/storage /var/www/bootstrap/cache

# 以 root 用户运行（安全问题！）
USER root

EXPOSE 9000
CMD ["php-fpm"]
```

这个 Dockerfile 有以下安全问题：

1. 使用 `php:8.1-fpm` 基础镜像，包含大量操作系统包漏洞
2. 以 root 用户运行 PHP-FPM
3. 安装了不必要的开发工具
4. 没有使用多阶段构建
5. 使用了固定版本的 PHP 8.1，该版本已进入安全维护期

### 5.2 执行首次扫描

```bash
# 构建镜像
docker build -t laravel-app:vulnerable .

# 使用 Trivy 扫描
trivy image laravel-app:vulnerable --severity HIGH,CRITICAL
```

**Trivy 首次扫描结果示例：**

```
┌──────────────────────────┬──────────────────┬──────────────────────────────────────────────┬───────────────┬──────────────────────────────────────────────────┐
│         Package          │ Vulnerability    │ Installed Version                            │ Severity      │ Fixed Version                                    │
├──────────────────────────┼──────────────────┼──────────────────────────────────────────────┼───────────────┼──────────────────────────────────────────────────┤
│ libcurl4                 │ CVE-2024-7264    │ 7.88.1-10+deb12u5                           │ CRITICAL      │ 7.88.1-10+deb12u7                               │
│ libcurl4                 │ CVE-2024-6197    │ 7.88.1-10+deb12u5                           │ HIGH          │ 7.88.1-10+deb12u7                               │
│ libssl3                  │ CVE-2024-5535    │ 3.0.13-1~deb12u1                            │ CRITICAL      │ 3.0.13-1~deb12u2                                │
│ openssl                  │ CVE-2024-5535    │ 3.0.13-1~deb12u1                            │ CRITICAL      │ 3.0.13-1~deb12u2                                │
│ libxml2                  │ CVE-2024-34459   │ 2.9.14+dfsg-1.2~deb12u1                     │ HIGH          │ 2.9.14+dfsg-1.2~deb12u3                         │
│ libpng16-16              │ CVE-2023-6277    │ 1.6.39-2                                    │ HIGH          │ 1.6.39-2+deb12u1                                │
│ git                      │ CVE-2024-32002   │ 1:2.39.2-1.1                                │ CRITICAL      │ 1:2.39.2-1.1+deb12u1                            │
│ libsystemd0              │ CVE-2024-3154    │ 252.26-1~deb12u2                            │ HIGH          │ 252.28-1~deb12u1                                │
│ tar                      │ CVE-2024-26458   │ 1.34+dfsg-1.1                               │ HIGH          │ 1.34+dfsg-1.1+deb12u1                           │
│ curl                     │ CVE-2024-7264    │ 7.88.1-10+deb12u5                           │ CRITICAL      │ 7.88.1-10+deb12u7                               │
│ libexpat1                │ CVE-2024-45490   │ 2.5.0-1                                     │ CRITICAL      │ 2.5.0-1+deb12u1                                 │
│ libexpat1                │ CVE-2024-45491   │ 2.5.0-1                                     │ CRITICAL      │ 2.5.0-1+deb12u1                                 │
│ linux-libc-dev           │ CVE-2024-26925   │ 6.1.90-1                                    │ HIGH          │ 6.1.99-1                                        │
└──────────────────────────┴──────────────────┴──────────────────────────────────────────────┴───────────────┴──────────────────────────────────────────────────┘

laravel-app:vulnerable (debian 12.5)

Total: 13 (CRITICAL: 7, HIGH: 6)
```

### 5.3 使用 Grype 交叉验证

```bash
# 使用 Grype 扫描同一镜像
grype laravel-app:vulnerable --only-fixed
```

**Grype 扫描结果示例：**

```
NAME        INSTALLED           FIXED-IN            TYPE  VULNERABILITY   SEVERITY
libcurl4    7.88.1-10+deb12u5   7.88.1-10+deb12u7   deb   CVE-2024-7264   Critical
openssl     3.0.13-1~deb12u1    3.0.13-1~deb12u2    deb   CVE-2024-5535   Critical
git         1:2.39.2-1.1        1:2.39.2-1.1+deb12u1 deb  CVE-2024-32002  Critical
libexpat1   2.5.0-1             2.5.0-1+deb12u1     deb   CVE-2024-45490  Critical
libexpat1   2.5.0-1             2.5.0-1+deb12u1     deb   CVE-2024-45491  Critical
libssl3     3.0.13-1~deb12u1    3.0.13-1~deb12u2    deb   CVE-2024-5535   Critical
libxml2     2.9.14+dfsg-1.2~deb12u1  2.9.14+dfsg-1.2~deb12u3 deb CVE-2024-34459 High
libpng16-16 1.6.39-2            1.6.39-2+deb12u1    deb   CVE-2023-6277   High
libsystemd0 252.26-1~deb12u2    252.28-1~deb12u1    deb   CVE-2024-3154   High
tar         1.34+dfsg-1.1       1.34+dfsg-1.1+deb12u1 deb CVE-2024-26458  High
curl        7.88.1-10+deb12u5   7.88.1-10+deb12u7   deb   CVE-2024-7264   Critical
linux-libc-dev 6.1.90-1         6.1.99-1            deb   CVE-2024-26925  High
```

### 5.4 应用修复：安全加固的 Dockerfile

基于扫描结果，我们需要进行以下修复：

```dockerfile
# Dockerfile (fixed and hardened)
# Stage 1: Build stage
FROM composer:2.7 AS composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts --ignore-platform-reqs

# Stage 2: Final stage - 使用更新的 PHP 基础镜像
FROM php:8.3-fpm-bookworm

# 安装安全补丁和最小必要依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    libzip-dev \
    libpq-dev \
    && apt-get upgrade -y \
    && docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd zip opcache \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # 删除不必要的文件减少攻击面
    && rm -rf /usr/share/doc /usr/share/man /tmp/* /var/tmp/*

# 创建非 root 用户
RUN groupadd -r laravel && useradd -r -g laravel -d /var/www -s /sbin/nologin laravel

# 设置工作目录
WORKDIR /var/www

# 从构建阶段复制依赖
COPY --from=composer /app/vendor ./vendor
COPY . /var/www

# 安装 PHP 配置文件
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

# 禁用危险的 PHP 函数
RUN echo "disable_functions = exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source" \
    >> "$PHP_INI_DIR/conf.d/security.ini"

# 设置权限
RUN chown -R laravel:laravel /var/www/storage /var/www/bootstrap/cache \
    && chmod -R 755 /var/www/storage /var/www/bootstrap/cache \
    && chmod -R 555 /var/www \
    && chmod -R 775 /var/www/storage /var/www/bootstrap/cache

# 切换到非 root 用户
USER laravel

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD php-fpm -t || exit 1

EXPOSE 9000
CMD ["php-fpm"]
```

### 5.5 验证修复效果

```bash
# 重新构建镜像
docker build -t laravel-app:secure .

# 使用 Trivy 重新扫描
trivy image laravel-app:secure --severity HIGH,CRITICAL
```

**修复后的扫描结果：**

```
┌──────────────────────────┬──────────────────┬──────────────────────────────────────────────┬───────────────┬──────────────────────────────────────────────────┐
│         Package          │ Vulnerability    │ Installed Version                            │ Severity      │ Fixed Version                                    │
├──────────────────────────┼──────────────────┼──────────────────────────────────────────────┼───────────────┼──────────────────────────────────────────────────┤
│ libssl3                  │ CVE-2024-5535    │ 3.0.13-1~deb12u1                            │ CRITICAL      │ 3.0.13-1~deb12u2                                │
│ openssl                  │ CVE-2024-5535    │ 3.0.13-1~deb12u1                            │ CRITICAL      │ 3.0.13-1~deb12u2                                │
└──────────────────────────┴──────────────────┴──────────────────────────────────────────────┴───────────────┴──────────────────────────────────────────────────┘

laravel-app:secure (debian 12.5)

Total: 2 (CRITICAL: 2, HIGH: 0)
```

漏洞从 13 个减少到 2 个。剩余的漏洞来自基础镜像中尚未更新的 OpenSSL 包，我们可以进一步通过升级基础镜像来修复。

### 5.6 使用 Snyk 获取修复建议

```bash
# 使用 Snyk 扫描并获取修复建议
snyk container test laravel-app:secure --file=Dockerfile
```

Snyk 不仅会报告漏洞，还会提供具体的修复建议，例如：

- 推荐使用 `php:8.3-fpm-bookworm` 的更新版本
- 建议添加 `apt-get upgrade -y` 来自动安装最新安全补丁
- 对于无法通过升级修复的漏洞，Snyk 会建议安装特定版本的安全补丁包

## 六、SBOM 生成与管理

### 6.1 SBOM 概述

SBOM（Software Bill of Materials，软件物料清单）是一份包含软件中所有组件、依赖和库的详细清单。它类似于食品包装上的成分表，为软件供应链安全提供了基础的可见性。

SBOM 的核心价值包括：

- **供应链可见性**：清楚了解软件中包含的所有组件
- **漏洞影响评估**：当新的 CVE 被披露时，快速确定哪些软件受到影响
- **合规证明**：满足如美国行政令 14028 等法规对 SBOM 的要求
- **许可证合规**：追踪所有组件的许可证类型，避免法律风险

### 6.2 SPDX 格式

SPDX（Software Package Data Exchange）是由 Linux 基金会维护的 SBOM 标准格式。SPDX 3.0 是当前最新版本，支持 JSON、YAML、RDF 等多种序列化格式。

```bash
# 使用 Trivy 生成 SPDX 格式 SBOM
trivy image --format spdx-json --output sbom-spdx.json laravel-app:secure

# 查看 SBOM 内容
cat sbom-spdx.json | jq '.packages[] | {name, versionInfo, supplier}' | head -20
```

**SPDX SBOM 结构示例：**

```json
{
  "spdxVersion": "SPDX-2.3",
  "dataLicense": "CC0-1.0",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "laravel-app",
  "documentNamespace": "https://aquasecurity.github.io/trivy/...",
  "creationInfo": {
    "created": "2026-06-03T00:00:00Z",
    "creators": [
      "Tool: trivy-0.50.0"
    ]
  },
  "packages": [
    {
      "SPDXID": "SPDXRef-Package-os-debian-libcurl4",
      "name": "libcurl4",
      "versionInfo": "7.88.1-10+deb12u7",
      "supplier": "Organization: Debian",
      "downloadLocation": "https://packages.debian.org/bookworm/libcurl4",
      "filesAnalyzed": false,
      "licenseConcluded": "MIT",
      "externalRefs": [
        {
          "referenceCategory": "PACKAGE-MANAGER",
          "referenceType": "purl",
          "referenceLocator": "pkg:deb/debian/libcurl4@7.88.1-10+deb12u7?arch=amd64&distro=debian-12"
        }
      ]
    }
  ],
  "relationships": [
    {
      "spdxElementId": "SPDXRef-DOCUMENT",
      "relationshipType": "DESCRIBES",
      "relatedSpdxElement": "SPDXRef-Package-os-debian-libcurl4"
    }
  ]
}
```

### 6.3 CycloneDX 格式

CycloneDX 是由 OWASP 维护的另一个 SBOM 标准，特别注重安全特性，支持漏洞信息的嵌入。

```bash
# 使用 Trivy 生成 CycloneDX 格式 SBOM
trivy image --format cyclonedx --output sbom-cyclonedx.json laravel-app:secure

# 使用 Syft 生成 CycloneDX 格式 SBOM
syft laravel-app:secure -o cyclonedx-json > sbom-cyclonedx-syft.json
```

**CycloneDX SBOM 结构示例：**

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "version": 1,
  "metadata": {
    "timestamp": "2026-06-03T00:00:00Z",
    "tools": [
      {
        "vendor": "aquasecurity",
        "name": "trivy",
        "version": "0.50.0"
      }
    ],
    "component": {
      "type": "application",
      "name": "laravel-app",
      "version": "latest"
    }
  },
  "components": [
    {
      "type": "library",
      "bom-ref": "pkg:deb/debian/libcurl4@7.88.1-10+deb12u7",
      "name": "libcurl4",
      "version": "7.88.1-10+deb12u7",
      "purl": "pkg:deb/debian/libcurl4@7.88.1-10+deb12u7?arch=amd64",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ]
    }
  ],
  "vulnerabilities": [
    {
      "id": "CVE-2024-7264",
      "source": {
        "name": "NVD",
        "url": "https://nvd.nist.gov/vuln/detail/CVE-2024-7264"
      },
      "ratings": [
        {
          "severity": "critical",
          "method": "CVSSv3",
          "score": 9.8
        }
      ],
      "affects": [
        {
          "ref": "pkg:deb/debian/libcurl4@7.88.1-10+deb12u7"
        }
      ]
    }
  ]
}
```

### 6.4 SBOM 管理平台

生成 SBOM 后，需要一个管理平台来存储、分析和追踪。推荐的开源方案是 OWASP Dependency-Track：

```yaml
# docker-compose.yml - Dependency-Track 部署
version: '3.8'
services:
  dtrack-apiserver:
    image: dependencytrack/apiserver:latest
    ports:
      - "8081:8080"
    volumes:
      - dtrack-data:/data
    environment:
      - ALPINE_DATABASE_URL=jdbc:postgresql://dtrack-db:5432/dtrack
      - ALPINE_DATABASE_USERNAME=dtrack
      - ALPINE_DATABASE_PASSWORD=dtrack_password
    depends_on:
      - dtrack-db
    restart: unless-stopped

  dtrack-frontend:
    image: dependencytrack/frontend:latest
    ports:
      - "8080:8080"
    environment:
      - API_BASE_URL=http://localhost:8081
    depends_on:
      - dtrack-apiserver
    restart: unless-stopped

  dtrack-db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=dtrack
      - POSTGRES_PASSWORD=dtrack_password
      - POSTGRES_DB=dtrack
    volumes:
      - dtrack-db:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  dtrack-data:
  dtrack-db:
```

```bash
# 上传 SBOM 到 Dependency-Track
curl -X POST "http://localhost:8081/api/v1/bom" \
  -H "X-Api-Key: your-api-key" \
  -H "Content-Type: multipart/form-data" \
  -F "autoCreate=true" \
  -F "projectName=laravel-app" \
  -F "projectVersion=1.0.0" \
  -F "bom=@sbom-cyclonedx.json"
```

### 6.5 自动化 SBOM 生成流水线

将 SBOM 生成集成到 CI/CD 流水线中，并自动上传到管理平台：

```yaml
# GitHub Actions 中的 SBOM 自动化流水线
  sbom-lifecycle:
    needs: build-image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download image
        uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load Docker image
        run: docker load -i /tmp/image.tar

      - name: Generate SBOM
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}'
          format: 'cyclonedx'
          output: 'sbom.json'

      - name: Sign SBOM with cosign
        run: |
          cosign sign-blob --key cosign.key --output-signature sbom.json.sig --output-certificate sbom.json.cert sbom.json

      - name: Upload SBOM to Dependency-Track
        run: |
          curl -X POST "${{ secrets.DTRACK_URL }}/api/v1/bom" \
            -H "X-Api-Key: ${{ secrets.DTRACK_API_KEY }}" \
            -F "autoCreate=true" \
            -F "projectName=${{ env.IMAGE_NAME }}" \
            -F "projectVersion=${{ env.IMAGE_TAG }}" \
            -F "bom=@sbom.json"

      - name: Upload SBOM to OCI registry
        run: |
          # 使用 oras 将 SBOM 作为 OCI 附件推送到镜像仓库
          oras attach \
            --artifact-type application/vnd.cyclonedx+json \
            ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} \
            sbom.json:cyclonedx-json
```

## 七、漏洞修复工作流

### 7.1 完整的修复流程

一个成熟的漏洞修复工作流包括以下阶段：

**阶段 1：检测（Detection）**

在 CI 流水线中自动触发扫描，发现镜像中的漏洞：

```yaml
# 触发条件配置
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 1'  # 每周一定期扫描
```

**阶段 2：分类与优先级（Triage）**

对发现的漏洞进行分类和优先级排序：

```python
# scripts/triage_vulnerabilities.py
import json
import sys
from dataclasses import dataclass
from typing import List
from enum import Enum

class Severity(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"

@dataclass
class Vulnerability:
    cve_id: str
    severity: Severity
    package_name: str
    installed_version: str
    fixed_version: str
    title: str
    description: str
    cvss_score: float = 0.0
    epss_score: float = 0.0
    has_exploit: bool = False

def parse_trivy_report(report_path: str) -> List[Vulnerability]:
    """解析 Trivy JSON 报告"""
    with open(report_path) as f:
        data = json.load(f)

    vulns = []
    for result in data.get('Results', []):
        for v in result.get('Vulnerabilities', []):
            vulns.append(Vulnerability(
                cve_id=v['VulnerabilityID'],
                severity=Severity(v.get('Severity', 'UNKNOWN')),
                package_name=v['PkgName'],
                installed_version=v['InstalledVersion'],
                fixed_version=v.get('FixedVersion', ''),
                title=v.get('Title', ''),
                description=v.get('Description', '')[:200],
                cvss_score=v.get('CVSS', {}).get('V3Score', 0.0),
            ))
    return vulns

def calculate_priority(vuln: Vulnerability) -> int:
    """计算漏洞优先级分数（越低越优先处理）"""
    severity_scores = {
        Severity.CRITICAL: 0,
        Severity.HIGH: 10,
        Severity.MEDIUM: 20,
        Severity.LOW: 30,
        Severity.UNKNOWN: 40,
    }

    base_score = severity_scores[vuln.severity]

    # 如果有可用的修复版本，降低优先级分数（优先处理可修复的）
    if vuln.fixed_version:
        base_score -= 5

    # 如果 CVSS 分数很高，降低优先级分数
    if vuln.cvss_score >= 9.0:
        base_score -= 3
    elif vuln.cvss_score >= 7.0:
        base_score -= 2

    # 如果有已知的利用代码，最高优先级
    if vuln.has_exploit:
        base_score -= 10

    return base_score

def triage(vulns: List[Vulnerability]) -> dict:
    """对漏洞进行分类和排序"""
    # 按优先级排序
    sorted_vulns = sorted(vulns, key=lambda v: calculate_priority(v))

    # 分类
    categories = {
        'immediate_action': [],    # 需要立即处理
        'scheduled_fix': [],       # 计划修复
        'monitor': [],             # 持续监控
        'accept_risk': [],         # 风险接受
    }

    for vuln in sorted_vulns:
        priority = calculate_priority(vuln)
        if priority < 0:
            categories['immediate_action'].append(vuln)
        elif priority < 15:
            categories['scheduled_fix'].append(vuln)
        elif priority < 25:
            categories['monitor'].append(vuln)
        else:
            categories['accept_risk'].append(vuln)

    return categories

def generate_report(categories: dict):
    """生成漏洞分类报告"""
    print("## 漏洞分类报告\n")
    for category, vulns in categories.items():
        labels = {
            'immediate_action': '🔴 需要立即处理',
            'scheduled_fix': '🟠 计划修复（7 天内）',
            'monitor': '🟡 持续监控',
            'accept_risk': '🟢 风险接受',
        }
        print(f"### {labels[category]}")
        if vulns:
            for v in vulns:
                fix = f" (修复版本: {v.fixed_version})" if v.fixed_version else " (无可用修复)"
                print(f"- **{v.cve_id}** [{v.severity.value}] {v.package_name} {v.installed_version}{fix}")
        else:
            print("  无")
        print()

if __name__ == '__main__':
    vulns = parse_trivy_report(sys.argv[1])
    categories = triage(vulns)
    generate_report(categories)
```

**阶段 3：修复（Fix）**

根据漏洞类型采用不同的修复策略：

```bash
# 策略 1: 更新基础镜像
# 在 Dockerfile 中使用最新的基础镜像标签
FROM php:8.3-fpm-bookworm AS base

# 策略 2: 运行时安装安全补丁
RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 策略 3: 更新特定包
RUN apt-get update && apt-get install -y --only-upgrade \
    libcurl4=7.88.1-10+deb12u7 \
    openssl=3.0.13-1~deb12u2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 策略 4: 使用 Alpine 替代 Debian 以减少漏洞
FROM php:8.3-fpm-alpine3.19

# 策略 5: 使用 Distroless 镜像
FROM gcr.io/distroless/base-debian12
```

**阶段 4：验证（Verify）**

修复后重新扫描验证：

```bash
# 构建修复后的镜像
docker build -t laravel-app:fixed .

# 使用所有三个扫描器验证
trivy image laravel-app:fixed --severity HIGH,CRITICAL --exit-code 1
grype laravel-app:fixed --fail-on critical
snyk container test laravel-app:fixed --severity-threshold=high
```

### 7.2 自动化修复工作流

利用 GitHub Actions 创建自动化的漏洞修复 PR：

```yaml
# .github/workflows/auto-fix-vulnerabilities.yml
name: Auto Fix Vulnerabilities

on:
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨 2 点
  workflow_dispatch:

jobs:
  scan-and-fix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build image
        run: docker build -t app:current .

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'app:current'
          format: 'json'
          output: 'trivy-report.json'

      - name: Parse vulnerabilities and generate fix
        run: |
          python3 << 'PYTHON_SCRIPT'
          import json
          import re

          with open('trivy-report.json') as f:
              data = json.load(f)

          fixes = []
          for result in data.get('Results', []):
              for vuln in result.get('Vulnerabilities', []):
                  if vuln.get('FixedVersion') and vuln['Severity'] in ['CRITICAL', 'HIGH']:
                      fixes.append({
                          'cve': vuln['VulnerabilityID'],
                          'package': vuln['PkgName'],
                          'installed': vuln['InstalledVersion'],
                          'fixed': vuln['FixedVersion'],
                      })

          if fixes:
              # 读取 Dockerfile
              with open('Dockerfile') as f:
                  dockerfile = f.read()

              # 添加 apt-get upgrade 到 Dockerfile
              if 'apt-get upgrade' not in dockerfile:
                  dockerfile = dockerfile.replace(
                      'apt-get install',
                      'apt-get upgrade -y && apt-get install'
                  )

              with open('Dockerfile', 'w') as f:
                  f.write(dockerfile)

              print(f"Generated fixes for {len(fixes)} vulnerabilities")
              for fix in fixes:
                  print(f"  - {fix['cve']}: {fix['package']} {fix['installed']} -> {fix['fixed']}")
          else:
              print("No fixable vulnerabilities found")
          PYTHON_SCRIPT

      - name: Create Pull Request
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: 'fix: patch container vulnerabilities'
          title: '🔒 Auto-fix: Container vulnerability patches'
          body: |
            ## Automated Vulnerability Fixes

            This PR was automatically generated to fix known vulnerabilities in the container image.

            Please review the changes and merge if appropriate.

            ### Trivy Scan Results Before Fix
            [View full report](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})
          branch: auto-fix/vulnerabilities
          delete-branch: true
```

### 7.3 漏洞豁免管理

在某些情况下，我们需要对特定漏洞进行豁免（例如无可用修复版本、误报、已知在当前上下文中不可利用）：

```yaml
# .trivyignore
# 无可用修复版本的 CVE
CVE-2024-XXXXX
# 已评估为不可利用的 CVE
CVE-2024-YYYYY
```

```yaml
# .grype.yaml
ignore:
  - vulnerability: CVE-2024-XXXXX
    reason: "No fix available, reviewed and accepted by security team on 2026-06-01"
  - package:
      name: libsystemd0
      version: "252.26-1~deb12u2"
    vulnerability: CVE-2024-3154
    reason: "Not applicable in container context"
```

```yaml
# snyk policy file: .snyk
version: v1.0.0
ignore:
  SNYK-DEBIAN12-CURL-7264103:
    - '*':
        reason: 'No fix available for base image'
        expires: '2026-07-01T00:00:00.000Z'
patch: {}
```

## 八、Policy-as-Code：OPA/Gatekeeper 集成

### 8.1 概述

Policy-as-Code 是将安全策略以代码形式定义和管理的理念。在容器安全领域，我们可以使用 OPA（Open Policy Agent）和 Gatekeeper 来定义和执行镜像安全策略，确保只有通过安全检查的镜像才能部署到 Kubernetes 集群。

### 8.2 OPA 策略编写

```rego
# policies/container_security.rego
package container.security

import future.keywords.if
import future.keywords.in

default allow = false

# 策略 1: 禁止使用 root 用户运行
deny[msg] {
    input.Config.User == "root"
    msg := "Container must not run as root user"
}

# 策略 2: 禁止使用 latest 标签
deny[msg] {
    some image in input.images
    endswith(image, ":latest")
    msg := sprintf("Image '%s' must not use 'latest' tag", [image])
}

# 策略 3: 禁止包含严重漏洞的镜像
deny[msg] {
    some vuln in input.vulnerabilities
    vuln.severity == "CRITICAL"
    not vuln.id in input.allowed_vulnerabilities
    msg := sprintf("Critical vulnerability %s in package %s must be fixed", [vuln.id, vuln.package])
}

# 策略 4: 高危漏洞数量限制
deny[msg] {
    high_vulns := [v | v := input.vulnerabilities[_]; v.severity == "HIGH"]
    count(high_vulns) > 5
    msg := sprintf("Too many high vulnerabilities: %d (max: 5)", [count(high_vulns)])
}

# 策略 5: 要求使用指定的基础镜像
deny[msg] {
    some image in input.images
    not startswith(image, "myregistry.com/")
    not startswith(image, "php:")
    not startswith(image, "node:")
    msg := sprintf("Image '%s' is not from an approved registry", [image])
}

# 策略 6: 禁止特定的危险配置
deny[msg] {
    input.Config.Privileged == true
    msg := "Privileged mode is not allowed"
}

# 策略 7: 要求设置资源限制
deny[msg] {
    not input.Resources.Limits
    msg := "Resource limits must be set"
}

# 策略 8: 要求设置只读根文件系统
deny[msg] {
    not input.SecurityContext.ReadOnlyRootFilesystem
    msg := "Read-only root filesystem is required"
}

# 最终决策：只有在没有任何 deny 消息时才允许
allow {
    count(deny) == 0
}
```

### 8.3 OPA 测试用例

```rego
# policies/container_security_test.rego
package container.security_test

import data.container.security

test_deny_root_user {
    result := security.deny with input as {
        "Config": {"User": "root"},
        "images": ["myregistry.com/app:v1.0"],
        "vulnerabilities": []
    }
    count(result) == 1
    result[_] == "Container must not run as root user"
}

test_deny_latest_tag {
    result := security.deny with input as {
        "Config": {"User": "laravel"},
        "images": ["myregistry.com/app:latest"],
        "vulnerabilities": []
    }
    count(result) == 1
}

test_allow_secure_image {
    result := security.deny with input as {
        "Config": {"User": "laravel"},
        "images": ["myregistry.com/app:v1.0"],
        "vulnerabilities": [{"id": "CVE-2024-1234", "severity": "LOW", "package": "test"}],
        "allowed_vulnerabilities": ["CVE-2024-1234"],
        "Resources": {"Limits": true},
        "SecurityContext": {"ReadOnlyRootFilesystem": true}
    }
    count(result) == 0
}

test_deny_critical_vulnerability {
    result := security.deny with input as {
        "Config": {"User": "laravel"},
        "images": ["myregistry.com/app:v1.0"],
        "vulnerabilities": [{"id": "CVE-2024-9999", "severity": "CRITICAL", "package": "openssl"}],
        "allowed_vulnerabilities": [],
        "Resources": {"Limits": true},
        "SecurityContext": {"ReadOnlyRootFilesystem": true}
    }
    count(result) >= 1
}
```

```bash
# 运行 OPA 测试
opa test policies/ -v
```

### 8.4 Gatekeeper 集成

Gatekeeper 是 OPA 的 Kubernetes 原生集成方案，通过 CRD（Custom Resource Definition）来定义和执行策略。

```yaml
# gatekeeper/constraint-template.yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8scontainerimagesecurity
spec:
  crd:
    spec:
      names:
        kind: K8sContainerImageSecurity
      validation:
        openAPIV3Schema:
          type: object
          properties:
            allowedRegistries:
              type: array
              items:
                type: string
            maxHighVulnerabilities:
              type: integer
            blockedCVEs:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8scontainerimagesecurity

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not startswith(container.image, input.parameters.allowedRegistries[_])
          msg := sprintf("Container image '%v' is not from an approved registry", [container.image])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          endswith(container.image, ":latest")
          msg := sprintf("Container image '%v' must not use 'latest' tag", [container.image])
        }

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not contains(container.image, ":")
          msg := sprintf("Container image '%v' must specify an explicit tag", [container.image])
        }
```

```yaml
# gatekeeper/constraint.yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sContainerImageSecurity
metadata:
  name: container-image-security
spec:
  match:
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
    namespaces:
      - production
      - staging
  parameters:
    allowedRegistries:
      - "myregistry.com/"
      - "docker.io/library/"
      - "gcr.io/distroless/"
    maxHighVulnerabilities: 5
    blockedCVEs:
      - "CVE-2024-9999"
```

### 8.5 镜像准入控制器

结合 Kyverno 或自定义准入控制器，可以实现更精细的镜像准入控制：

```yaml
# kyverno/require-image-scan.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-vulnerability-scan
  annotations:
    policies.kyverno.io/title: Require Image Vulnerability Scan
    policies.kyverno.io/category: Security
    policies.kyverno.io/severity: high
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: check-image-vulnerabilities
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "myregistry.com/*"
          attestations:
            - type: cosign.sigstore.dev/attestation/vuln/v1
              conditions:
                - all:
                    - key: "{{ scanner.result.criticalCount }}"
                      operator: LessThan
                      value: 1
                    - key: "{{ scanner.result.highCount }}"
                      operator: LessThan
                      value: 6
              attestors:
                - entries:
                    - keys:
                        publicKeys: |-
                          -----BEGIN PUBLIC KEY-----
                          MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
                          -----END PUBLIC KEY-----
```

### 8.6 完整的准入控制流程

```yaml
# 完整的镜像安全准入流程
apiVersion: v1
kind: ConfigMap
metadata:
  name: image-security-policy
  namespace: security
data:
  policy.yaml: |
    # 镜像安全策略配置
    scan:
      tools:
        - name: trivy
          severity_threshold: HIGH
        - name: grype
          severity_threshold: high
      schedule: "0 */6 * * *"  # 每 6 小时扫描一次

    admission:
      mode: enforce  # enforce 或 warn
      allowed_registries:
        - myregistry.com/
        - gcr.io/distroless/
      require_scan: true
      require_sbom: true
      require_signature: true

    vulnerability_policy:
      max_critical: 0
      max_high: 5
      max_medium: 20
      auto_fix: true
      fix_sla:
        critical: 24h
        high: 7d
        medium: 30d
```

## 九、高级扫描配置与优化

### 9.1 自定义扫描规则

Trivy 支持通过配置文件自定义扫描行为：

```yaml
# trivy-config.yaml
# 漏洞数据库配置
db:
  repository: ghcr.io/aquasecurity/trivy-db
  insecure: false

# Java DB 配置（用于扫描 Java 依赖）
java-db:
  repository: ghcr.io/aquasecurity/trivy-java-db
  insecure: false

# 扫描配置
scan:
  security-checks:
    - vuln
    - secret
    - misconfig
  file-patterns:
    - "**/*.json"
    - "**/*.yml"
    - "**/*.yaml"

# 漏洞配置
vulnerability:
  ignore-unfixed: false
  ignore-file: .trivyignore

# 报告配置
report:
  format: table
  output: ""
  severity: "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL"

# 缓存配置
cache:
  dir: /tmp/trivy-cache
  clear: false

# 密钥检测配置
secret:
  config: trivy-secret.yaml
```

```bash
# 使用配置文件运行扫描
trivy image --config trivy-config.yaml laravel-app:secure
```

### 9.2 性能优化

对于大型镜像的扫描，可以采用以下优化策略：

```bash
# 1. 启用缓存（默认已启用）
trivy image --cache-dir /tmp/trivy-cache laravel-app:secure

# 2. 跳过数据库更新（如果最近已更新）
trivy image --skip-db-update laravel-app:secure

# 3. 并行扫描（通过 --parallel 参数）
trivy image --parallel 4 laravel-app:secure

# 4. 仅扫描特定目录
trivy image --skip-dirs /usr/share/doc,/usr/share/man laravel-app:secure

# 5. 仅扫描特定类型的漏洞
trivy image --vuln-type os laravel-app:secure
# 或
trivy image --vuln-type library laravel-app:secure

# 6. 使用本地镜像避免网络延迟
trivy image --input app.tar laravel-app:secure
```

### 9.3 多架构镜像扫描

对于支持多架构（amd64/arm64）的镜像，需要分别扫描：

```yaml
# GitHub Actions 中扫描多架构镜像
  scan-multi-arch:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        platform: [linux/amd64, linux/arm64]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build for platform
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: ${{ matrix.platform }}
          push: false
          load: true
          tags: app:${{ matrix.platform }}

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'app:${{ matrix.platform }}'
          format: 'json'
          output: 'trivy-${{ matrix.platform }}.json'
          severity: 'CRITICAL,HIGH'
```

### 9.4 镜像签名与验证

使用 cosign 对容器镜像进行签名，确保镜像的完整性和来源可信：

```bash
# 安装 cosign
brew install cosign

# 生成密钥对
cosign generate-key-pair

# 签名镜像
cosign sign --key cosign.key myregistry.com/laravel-app:v1.0

# 验证签名
cosign verify --key cosign.pub myregistry.com/laravel-app:v1.0

# 附加扫描结果作为证明（attestation）
cosign attest --key cosign.key \
  --type vuln \
  --predicate trivy-results.json \
  myregistry.com/laravel-app:v1.0

# 验证明
cosign verify-attestation --key cosign.pub \
  --type vuln \
  myregistry.com/laravel-app:v1.0
```

## 十、Kubernetes 集群持续监控

### 10.1 Trivy Operator 部署

Trivy Operator 可以持续扫描 Kubernetes 集群中的工作负载：

```bash
# 使用 Helm 安装 Trivy Operator
helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm repo update

helm install trivy-operator aqua/trivy-operator \
  --namespace trivy-system \
  --create-namespace \
  --set trivy.imageRef=aquasec/trivy:0.50.0 \
  --set trivyOperator.scanJobsConcurrentLimit=10 \
  --set trivyOperator.vulnerabilityScannerEnabled=true \
  --set trivyOperator.configAuditScannerEnabled=true \
  --set trivyOperator.secretScannerEnabled=true
```

### 10.2 定制扫描配置

```yaml
# trivy-operator-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: trivy-operator-config
  namespace: trivy-system
data:
  trivy.imageRef: "aquasec/trivy:0.50.0"
  trivy.severity: "CRITICAL,HIGH"
  trivy.ignoreUnfixed: "true"
  trivyOperator.scanJobsConcurrentLimit: "10"
  trivyOperator.vulnerabilityScannerEnabled: "true"
  trivyOperator.configAuditScannerEnabled: "true"
  trivyOperator.secretScannerEnabled: "true"
  trivyOperator.scanJobsRetryDelay: "30s"
  node.collector.imageRef: "ghcr.io/aquasecurity/node-collector:0.1.0"
```

### 10.3 漏洞报告与告警

```yaml
# Prometheus AlertManager 规则
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: trivy-vulnerability-alerts
  namespace: trivy-system
spec:
  groups:
    - name: trivy-vulnerabilities
      rules:
        - alert: CriticalVulnerabilityDetected
          expr: |
            trivy_vulnerability_count{severity="Critical"} > 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Critical vulnerability detected in container {{ $labels.namespace }}/{{ $labels.name }}"
            description: "Container {{ $labels.namespace }}/{{ $labels.name }} has {{ $value }} critical vulnerabilities"

        - alert: HighVulnerabilityThresholdExceeded
          expr: |
            trivy_vulnerability_count{severity="High"} > 5
          for: 15m
          labels:
            severity: warning
          annotations:
            summary: "High vulnerability threshold exceeded for {{ $labels.namespace }}/{{ $labels.name }}"
```

## 十一、最佳实践与总结

### 11.1 容器安全扫描最佳实践

1. **选择安全的基础镜像**
   - 优先使用官方镜像或可信的镜像仓库
   - 使用最小化基础镜像（Alpine、Distroless、Slim）
   - 定期更新基础镜像，保持最新安全补丁

2. **多阶段构建**
   - 使用多阶段构建分离构建工具和运行时环境
   - 减少最终镜像的层数和体积
   - 避免在最终镜像中包含不必要的开发工具

3. **最小权限原则**
   - 创建专用的非 root 用户运行应用
   - 设置只读根文件系统
   - 使用 SecurityContext 限制容器权限

4. **扫描策略**
   - 使用多个扫描工具进行交叉验证
   - 在 CI/CD 流水线中集成自动扫描
   - 定期执行全量扫描（至少每周一次）
   - 对漏洞进行分类和优先级排序

5. **SBOM 管理**
   - 每次构建都生成 SBOM
   - 将 SBOM 存储在安全的管理系统中
   - 对 SBOM 进行签名，确保完整性

6. **漏洞修复工作流**
   - 建立明确的漏洞修复 SLA
   - 自动化修复流程（自动创建修复 PR）
   - 对无法修复的漏洞进行风险评估和豁免管理

### 11.2 工具选型建议

| 场景 | 推荐工具 | 理由 |
|------|---------|------|
| 开源项目 | Trivy | 免费、全面、社区活跃 |
| 企业级部署 | Snyk + Trivy | Snyk 的可达性分析 + Trivy 的全面覆盖 |
| 轻量级需求 | Grype | 快速、简单、资源消耗低 |
| Kubernetes 集群 | Trivy Operator | 原生 K8s 集成、自动扫描 |
| 合规要求高 | Snyk | 商业支持、审计报告、SLA 保障 |

### 11.3 安全扫描成熟度模型

企业可以按照以下成熟度模型逐步提升容器安全扫描能力：

- **Level 1 - 基础**：在 CI 中集成单个扫描工具，阻断高危漏洞
- **Level 2 - 标准**：多工具交叉验证，生成 SBOM，漏洞分类管理
- **Level 3 - 进阶**：自动修复工作流，准入控制，持续监控
- **Level 4 - 高级**：Policy-as-Code 全面覆盖，自动化风险评估，供应链签名验证
- **Level 5 - 卓越**：全链路安全可视化，智能漏洞优先级排序，自动化的修复验证闭环

### 11.4 常见问题与解决方案

**问题 1：扫描速度慢**

解决方案：
- 启用本地缓存，避免重复下载漏洞数据库
- 使用 `--skip-dirs` 跳过不需要扫描的目录
- 增加并行度
- 仅扫描必要的漏洞类型（OS 或 Library）

**问题 2：误报率高**

解决方案：
- 使用 `.trivyignore` 或 `.grype.yaml` 忽略已知的误报
- 使用 Snyk 的可达性分析功能
- 定期审查和更新豁免规则
- 在 CI 中同时使用多个扫描工具进行交叉验证

**问题 3：漏洞数据库不一致**

解决方案：
- 定期更新扫描工具和漏洞数据库
- 在 CI 中配置缓存策略，平衡更新频率和构建速度
- 使用统一的漏洞管理平台整合多来源数据

**问题 4：修复后仍有漏洞**

解决方案：
- 检查是否需要更新基础镜像标签
- 确认 `apt-get upgrade` 是否已包含在 Dockerfile 中
- 对于底层镜像的漏洞，等待上游更新或切换到其他基础镜像
- 使用 Distroless 或 Alpine 镜像减少 OS 层漏洞

### 11.5 总结

容器安全扫描是现代 DevSecOps 流水线中不可或缺的一环。通过本文的介绍，我们了解了：

1. **容器安全扫描的重要性**：左移安全理念要求我们在构建阶段就发现并修复漏洞，大幅缩短漏洞暴露时间窗口。

2. **三大扫描工具的对比与选择**：Trivy 是综合能力最强的开源选择，Snyk 提供最佳的开发者体验和可达性分析，Grype 是最轻量的选择。推荐使用双工具策略进行交叉验证。

3. **CI/CD 集成**：我们展示了在 GitHub Actions 和 GitLab CI 中集成扫描器的完整配置，包括构建、扫描、SBOM 生成和安全门禁等阶段。

4. **SBOM 生成与管理**：SPDX 和 CycloneDX 是两种主要的 SBOM 标准，通过 Dependency-Track 等平台可以实现 SBOM 的集中管理和漏洞影响评估。

5. **漏洞修复工作流**：从检测、分类、修复到验证的完整流程，以及自动化修复工作流的实现。

6. **Policy-as-Code**：使用 OPA/Gatekeeper 和 Kyverno 实现镜像安全策略的代码化管理，确保只有通过安全检查的镜像才能部署到生产环境。

7. **持续监控**：通过 Trivy Operator 和 Prometheus 告警实现 Kubernetes 集群的持续安全监控。

容器安全不是一个一次性的项目，而是一个持续的过程。随着威胁形势的不断演变和工具生态的持续发展，我们需要不断优化和改进安全扫描策略。希望本文能为您的容器安全之旅提供实用的指导和参考。

### 参考资源

- [Trivy 官方文档](https://aquasecurity.github.io/trivy/)
- [Snyk 容器安全文档](https://docs.snyk.io/products/snyk-container)
- [Grype 官方文档](https://github.com/anchore/grype)
- [Syft 官方文档](https://github.com/anchore/syft)
- [OPA 官方文档](https://www.openpolicyagent.org/docs/latest/)
- [Gatekeeper 官方文档](https://open-policy-agent.github.io/gatekeeper/)
- [SPDX 规范](https://spdx.github.io/)
- [CycloneDX 规范](https://cyclonedx.org/)
- [OWASP Dependency-Track](https://dependencytrack.org/)
- [NIST SP 800-218 SSDF](https://csrc.nist.gov/publications/detail/sp/800-218/final)
- [Executive Order 14028 on Cybersecurity](https://www.whitehouse.gov/briefing-room/presidential-actions/2021/05/12/executive-order-on-improving-the-nations-cybersecurity/)

## 相关阅读

- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [Dagger 实战：用代码定义 CI/CD 流水线——Go SDK 驱动的可移植 Pipeline](/categories/07_CICD/Dagger-实战-用代码定义CICD流水线-Go-SDK驱动的可移植Pipeline与GitHub-Actions选型对比/)
- [Canary Deployment：渐进式流量放量与 Laravel 版本共存](/categories/07_CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)
