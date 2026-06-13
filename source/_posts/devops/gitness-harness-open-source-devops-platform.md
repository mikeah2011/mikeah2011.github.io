---

title: Gitness 实战：Harness 开源的 Git 托管——CI/CD Pipeline、代码审查与自托管 DevOps 平台搭建
keywords: [Gitness, Harness, Git, CI, CD Pipeline, DevOps, 开源的, 托管, 代码审查与自托管, 平台搭建]
description: Gitness 是 Harness（Drone CI 母公司）推出的开源 Git 托管与 CI/CD 平台，集代码仓库、Pull Request、自动化 Pipeline、制品仓库于一体。本文从 Docker 部署、Pipeline YAML 配置、代码审查工作流、Webhook 集成到生产环境踩坑，完整实战搭建一套自托管 DevOps 平台。
date: 2026-06-10 05:42:00
tags:
- Git
- harness
- CI/CD
- self-hosted
- DevOps
- Docker
- drone
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




## 一、为什么需要自托管 Git 平台

GitHub 好用，但不是万能的：

- **代码主权**：核心业务代码放在第三方平台，合规团队不放心
- **成本**：GitHub Team $4/user/month，50 人团队一年 $2,400
- **内网访问**：工厂、金融等场景，生产网络无法访问公网
- **定制化**：想要深度集成内部系统（飞书通知、内部制品库、审批流）

自托管方案里，GitLab 功能全但资源消耗大（最低 4GB RAM），Gitea 轻量但 CI 能力弱，Gitness 刚好卡在中间——轻量（$4 的 VPS 就能跑）、自带 CI/CD、基于久经考验的 Drone 引擎。

## 二、Gitness 是什么

Gitness 由 Harness 公司于 2023 年 9 月开源发布。Harness 是谁？就是收购了 Drone CI 的那家公司。Gitness 可以理解为 **Drone CI 的下一代产品**，在 CI 能力之上增加了代码托管、代码审查、制品仓库等完整的 DevOps 功能。

核心特性一览：

| 能力 | 说明 |
|------|------|
| Git 代码托管 | 仓库、分支、合并、标签 |
| Pull Request | 代码审查、强制 Reviewer、Quality Gate |
| CI/CD Pipeline | 基于 Drone 引擎，YAML 定义，容器化执行 |
| 制品仓库 | Docker 镜像、Helm Chart 等 |
| Gitspaces | 云端开发环境（类似 GitHub Codespaces） |
| Webhook | 支持推送到飞书、钉钉、Slack 等 |
| REST API | 完整的 Swagger 文档 |

技术栈：Go 后端 + React 前端，Apache 2.0 协议。

## 三、Docker 一键部署

### 3.1 最简启动

```bash
docker run -d \
  -p 3000:3000 \
  -p 3022:3022 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /data/harness:/data \
  --name harness \
  --restart always \
  harness/harness
```

启动后访问 `http://localhost:3000`，默认管理员账号：

- 用户名：`admin`
- 密码：`changeit`

> ⚠️ 生产环境务必第一时间改密码。

### 3.2 Docker Compose 生产配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  harness:
    image: harness/harness:latest
    container_name: harness
    restart: always
    ports:
      - "3000:3000"   # Web UI
      - "3022:3022"   # SSH Git 克隆
    volumes:
      - harness_data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      # 基础配置
      GITNESS_HTTP_PORT: 3000
      GITNESS_SSH_PORT: 3022
      # 数据库（默认内嵌 SQLite，生产建议用 Postgres）
      GITNESS_DATABASE_DRIVER: postgres
      GITNESS_DATABASE_DATASOURCE: host=postgres port=5432 user=gitness password=YOUR_PASSWORD dbname=gitness sslmode=disable
      # Docker 配置
      GITNESS_DOCKER_HOST: unix:///var/run/docker.sock
      # URL 配置（反向代理时必填）
      GITNESS_URL_BASE: https://git.yourdomain.com
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    container_name: harness_postgres
    restart: always
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: gitness
      POSTGRES_PASSWORD: YOUR_PASSWORD
      POSTGRES_DB: gitness

volumes:
  harness_data:
  postgres_data:
```

### 3.3 Nginx 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name git.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/git.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/git.yourdomain.com/privkey.pem;

    client_max_body_size 100M;  # 允许大文件推送

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # SSH Git 克隆需要单独暴露 3022 端口
    # 或通过 stream 模块代理
}
```

## 四、Pipeline YAML 详解

Gitness 的 Pipeline 引擎源自 Drone，语法高度相似。Pipeline 文件默认放在仓库根目录的 `.harness/` 目录下，也支持自定义路径。

### 4.1 基础结构

```yaml
# .harness/ci.yaml
kind: pipeline
spec:
  stages:
    - type: ci
      name: build-and-test
      spec:
        clone:
          depth: 50  # 浅克隆，加速

        steps:
          - name: install
            type: run
            spec:
              container: composer:2
              script: |
                composer install --no-interaction --prefer-dist

          - name: test
            type: run
            spec:
              container: php:8.4-cli
              script: |
                php vendor/bin/phpunit --coverage-clover=coverage.xml
              env:
                APP_ENV: testing
                DB_CONNECTION: sqlite
                DB_DATABASE: ":memory:"
```

### 4.2 PHP/Laravel 完整 Pipeline

这是一个真实可用的 Laravel 项目 Pipeline 配置：

```yaml
kind: pipeline
spec:
  stages:
    - type: ci
      name: laravel-ci
      spec:
        platform:
          os: linux
          arch: amd64

        steps:
          # Step 1: 安装依赖
          - name: composer-install
            type: run
            spec:
              container: composer:2
              script: |
                composer install \
                  --no-interaction \
                  --no-progress \
                  --prefer-dist \
                  --optimize-autoloader

          # Step 2: 代码风格检查
          - name: php-cs-fixer
            type: run
            spec:
              container: php:8.4-cli
              script: |
                php vendor/bin/php-cs-fixer fix --dry-run --diff
              when:
                branch == "main" || branch == "develop"

          # Step 3: 静态分析
          - name: phpstan
            type: run
            spec:
              container: php:8.4-cli
              script: |
                php vendor/bin/phpstan analyse --memory-limit=512M
              when:
                branch == "main" || branch == "develop"

          # Step 4: 单元测试
          - name: phpunit
            type: run
            spec:
              container: php:8.4-cli
              script: |
                php vendor/bin/phpunit \
                  --coverage-clover=coverage.xml \
                  --log-junit=junit.xml
              env:
                APP_ENV: testing
                APP_KEY: base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                DB_CONNECTION: sqlite
                DB_DATABASE: ":memory:"
                CACHE_DRIVER: array
                SESSION_DRIVER: array
                QUEUE_DRIVER: sync

          # Step 5: 构建前端资源
          - name: npm-build
            type: run
            spec:
              container: node:20-alpine
              script: |
                npm ci
                npm run build
              when:
                branch == "main"

          # Step 6: 构建 Docker 镜像
          - name: docker-build
            type: plugin
            spec:
              name: docker
              inputs:
                repo: registry.yourdomain.com/your-app
                registry: registry.yourdomain.com
                tags:
                  - ${tag}
                  - latest
                dockerfile: Dockerfile
              when:
                branch == "main" && tag =~ "v.*"

          # Step 7: 部署到 Staging
          - name: deploy-staging
            type: plugin
            spec:
              name: ssh
              inputs:
                host:
                  from_secret: staging_host
                user: deploy
                key:
                  from_secret: deploy_key
                script: |
                  cd /opt/your-app
                  docker compose pull
                  docker compose up -d --remove-orphans
                  php artisan migrate --force
                  php artisan config:cache
                  php artisan route:cache
              when:
                branch == "main"

        # 失败时通知
        failure:
          - name: notify-failure
            type: plugin
            spec:
              name: webhook
              inputs:
                content_type: application/json
                urls:
                  from_secret: feishu_webhook_url
                template: |
                  {
                    "msg_type": "text",
                    "content": {
                      "text": "❌ Pipeline 失败\n仓库: {{ repo.name }}\n分支: {{ build.branch }}\n构建号: #{{ build.number }}\n链接: {{ build.link }}"
                    }
                  }
```

### 4.3 多阶段 Pipeline（Build → Staging → Production）

```yaml
kind: pipeline
spec:
  stages:
    # 阶段一：构建与测试
    - type: ci
      name: build
      spec:
        steps:
          - name: test
            type: run
            spec:
              container: php:8.4-cli
              script: php vendor/bin/phpunit

          - name: build-image
            type: plugin
            spec:
              name: docker
              inputs:
                repo: registry.yourdomain.com/app
                tags: ${build.number}
                insecure: true

    # 阶段二：部署到 Staging
    - type: ci
      name: deploy-staging
      spec:
        steps:
          - name: deploy
            type: plugin
            spec:
              name: helm3
              inputs:
                chart: ./charts/app
                namespace: staging
                release: app
                values: image.tag=${build.number}
        when:
          branch == "main"

    # 阶段三：手动审批后部署 Production
    - type: approval
      name: production-approval
      spec:
        approve:
          type: manual
        when:
          branch == "main"

    # 阶段四：部署 Production
    - type: ci
      name: deploy-production
      spec:
        steps:
          - name: deploy
            type: plugin
            spec:
              name: helm3
              inputs:
                chart: ./charts/app
                namespace: production
                release: app
                values: image.tag=${build.number}
        when:
          branch == "main"
```

### 4.4 常用内置变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `${build.number}` | 构建序号 | `42` |
| `${build.branch}` | 当前分支 | `main` |
| `${build.event}` | 触发事件 | `push`, `manual`, `pull_request` |
| `${build.tag}` | Git 标签 | `v1.0.0` |
| `${build.link}` | 构建页面链接 | `https://git.xxx.com/...` |
| `${repo.name}` | 仓库名 | `my-app` |
| `${commit.sha}` | 提交哈希 | `a1b2c3d` |
| `${commit.author}` | 提交作者 | `michael` |

## 五、代码审查工作流

### 5.1 Pull Request 配置

Gitness 的 PR 系统比较完善：

1. **强制 Reviewer**：Settings → Branch Protection → Required Reviewers
2. **Status Check**：Pipeline 必须通过才能合并
3. **代码所有者（CODEOWNERS）**：在仓库根目录创建 `CODEOWNERS` 文件

```
# CODEOWNERS
*.php           @backend-team
*.vue           @frontend-team
Dockerfile      @devops-team
charts/         @devops-team
.env.example    @security-team
```

### 5.2 Quality Gate

```yaml
# .harness/quality-gate.yaml
kind: pipeline
spec:
  stages:
    - type: ci
      name: quality-gate
      spec:
        steps:
          - name: coverage-check
            type: run
            spec:
              container: php:8.4-cli
              script: |
                php vendor/bin/phpunit --coverage-clover=coverage.xml
                # 解析覆盖率，低于 80% 则失败
                COVERAGE=$(php -r "
                  \$xml = simplexml_load_file('coverage.xml');
                  \$metrics = \$xml->project->metrics;
                  \$covered = (int)\$metrics['coveredstatements'];
                  \$total = (int)\$metrics['statements'];
                  echo round(\$covered / \$total * 100, 2);
                ")
                echo "代码覆盖率: ${COVERAGE}%"
                if [ $(echo "$COVERAGE < 80" | bc) -eq 1 ]; then
                  echo "❌ 代码覆盖率低于 80%，请补充测试"
                  exit 1
                fi
              when:
                event == "pull_request"
```

### 5.3 与 GitHub/GitLab 双向同步

Gitness 支持从主流平台一键导入：

1. 进入 Settings → Import
2. 选择 GitHub/GitLab/Bitbucket
3. 输入 Personal Access Token
4. 选择要导入的仓库

也支持通过 Webhook 双向同步 Push 事件。

## 六、Webhook 与通知集成

### 6.1 飞书通知

```yaml
# Pipeline 中添加通知 Step
- name: notify-success
  type: plugin
  spec:
    name: webhook
    inputs:
      content_type: application/json
      urls:
        from_secret: feishu_webhook
      template: |
        {
          "msg_type": "interactive",
          "card": {
            "header": {
              "title": {
                "tag": "plain_text",
                "content": "✅ Pipeline 构建成功"
              },
              "template": "green"
            },
            "elements": [
              {
                "tag": "div",
                "fields": [
                  { "is_short": true, "text": { "tag": "lark_md", "content": "**仓库：**{{ repo.name }}" } },
                  { "is_short": true, "text": { "tag": "lark_md", "content": "**分支：**{{ build.branch }}" } },
                  { "is_short": true, "text": { "tag": "lark_md", "content": "**构建号：**#{{ build.number }}" } },
                  { "is_short": true, "text": { "tag": "lark_md", "content": "**提交者：**{{ commit.author }}" } }
                ]
              },
              {
                "tag": "action",
                "actions": [
                  {
                    "tag": "button",
                    "text": { "tag": "plain_text", "content": "查看详情" },
                    "url": "{{ build.link }}",
                    "type": "primary"
                  }
                ]
              }
            ]
          }
        }
  when:
    status == "success" || status == "failure"
```

### 6.2 Webhook 触发外部系统

在仓库 Settings → Webhooks 中配置：

- **URL**：`https://your-api.com/webhook/gitness`
- **Events**：`push`, `pull_request`, `tag`
- **Secret**：用于验证请求签名

## 七、API 与自动化

### 7.1 生成 API Token

```bash
# 登录
docker exec -it harness ./gitness login

# 生成 PAT（有效期 30 天）
docker exec -it harness ./gitness user pat "my-token" 2592000
```

### 7.2 常用 API 调用

```bash
# 获取用户信息
curl -s http://localhost:3000/api/v1/user \
  -H "Authorization: Bearer $TOKEN" | jq

# 列出所有仓库
curl -s http://localhost:3000/api/v1/repos \
  -H "Authorization: Bearer $TOKEN" | jq '.[].identifier'

# 触发 Pipeline
curl -s -X POST \
  "http://localhost:3000/api/v1/repos/my-org/my-repo/pipelines" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "branch": "main",
    "event": "manual"
  }' | jq

# 获取构建日志
curl -s \
  "http://localhost:3000/api/v1/repos/my-org/my-repo/pipelines/42/stages/1/steps/1/logs" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 7.3 CLI 批量操作脚本

```bash
#!/bin/bash
# batch-import.sh - 批量从 GitHub 导入仓库

TOKEN="your-gitness-token"
GITHUB_TOKEN="your-github-token"
GITHUB_ORG="your-github-org"

# 获取 GitHub 仓库列表
REPOS=$(curl -s "https://api.github.com/orgs/$GITHUB_ORG/repos?per_page=100" \
  -H "Authorization: Bearer $GITHUB_TOKEN" | jq -r '.[].clone_url')

for REPO_URL in $REPOS; do
  REPO_NAME=$(basename "$REPO_URL" .git)
  echo "导入: $REPO_NAME"

  curl -s -X POST "http://localhost:3000/api/v1/repos" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"identifier\": \"$REPO_NAME\",
      \"default_branch\": \"main\",
      \"import_from\": {
        \"provider\": \"github\",
        \"source\": \"$REPO_URL\",
        \"token\": \"$GITHUB_TOKEN\"
      }
    }" | jq '.identifier'

  sleep 1
done
```

## 八、踩坑记录

### 8.1 Pipeline 找不到 Docker Socket

**症状**：Pipeline 报 `Cannot connect to the Docker daemon`

**原因**：macOS 上 Docker Desktop 的 socket 路径不是 `/var/run/docker.sock`

**解决**：

```bash
# Colima 用户
sudo ln -sf ~/.colima/default/docker.sock /var/run/docker.sock

# 或在 docker-compose.yml 中设置环境变量
GITNESS_DOCKER_HOST=unix:///Users/michael/.colima/default/docker.sock
```

### 8.2 大文件推送失败

**症状**：`git push` 时 413 Request Entity Too Large

**解决**：Nginx 配置 `client_max_body_size 100M;`

### 8.3 数据库迁移后 Pipeline 丢失

**症状**：从 SQLite 迁移到 PostgreSQL 后，已有 Pipeline 不显示

**原因**：Gitness 使用内嵌 SQLite 时数据在 `/data` 目录，迁移需要导出再导入

**预防**：一开始就用 PostgreSQL，不要用 SQLite 跑生产

### 8.4 Pipeline 中 PHP 扩展缺失

**症状**：`php artisan test` 报 `Class 'DOMDocument' not found`

**解决**：不要用 `php:8.4-cli` 基础镜像，用自定义 Dockerfile：

```dockerfile
FROM php:8.4-cli

RUN apt-get update && apt-get install -y \
    libxml2-dev \
    libzip-dev \
    && docker-php-ext-install \
    dom \
    zip \
    pdo_mysql \
    bcmath \
    gd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
```

在 Pipeline 中引用：

```yaml
- name: test
  type: run
  spec:
    image: registry.yourdomain.com/php-84-ci:latest
    script: php vendor/bin/phpunit
```

### 8.5 SSH Git 克隆端口冲突

**症状**：`git clone ssh://git@yourdomain.com:3022/org/repo.git` 连接超时

**解决**：确保防火墙开放 3022 端口，或使用 Nginx stream 模块代理：

```nginx
stream {
    upstream gitness_ssh {
        server 127.0.0.1:3022;
    }

    server {
        listen 3022;
        proxy_pass gitness_ssh;
    }
}
```

### 8.6 Pipeline 并发限制

**症状**：多个 Push 同时触发，Pipeline 排队等待

**解决**：在 Pipeline YAML 中配置并发策略：

```yaml
kind: pipeline
spec:
  concurrency:
    limit: 3          # 最多 3 个同时运行
    cancel_in_progress: true  # 新 Push 时取消旧的运行
```

## 九、Gitness vs 竞品对比

| 特性 | Gitness | Gitea | GitLab CE | GitHub |
|------|---------|-------|-----------|--------|
| 语言 | Go | Go | Ruby | — |
| 内存占用 | ~200MB | ~100MB | ~4GB+ | SaaS |
| 内置 CI/CD | ✅ Drone 引擎 | ❌ 需外挂 | ✅ Runner | ✅ Actions |
| 制品仓库 | ✅ | ❌ | ✅ | ✅ |
| 代码审查 | ✅ | ✅ | ✅ | ✅ |
| AI 搜索 | ✅ | ❌ | ❌ | ✅ Copilot |
| 一键迁移 | ✅ | ❌ | ✅ | ✅ |
| License | Apache 2.0 | MIT | MIT | Proprietary |
| 社区活跃度 | 中等 | 高 | 高 | 最高 |

**选型建议**：

- **只需轻量 Git + 外部 CI** → Gitea
- **要完整 DevOps 平台但资源有限** → Gitness
- **要企业级功能（RBAC、审计、合规）** → GitLab CE 或 GitHub Enterprise
- **已有 Drone 基础设施** → Gitness（天然兼容）

## 十、总结

Gitness 是一个值得尝试的自托管 DevOps 平台。它的核心优势在于：

1. **轻量**：$4 VPS 就能跑，不像 GitLab 吃 4GB RAM
2. **CI 原生集成**：不需要额外配置 Runner，Pipeline 和代码仓库一体化
3. **Drone 生态**：大量 Drone 插件可以直接使用
4. **迁移友好**：一键从 GitHub/GitLab/Bitbucket 导入

适合的场景：

- 小团队（5-30 人）想要一站式 DevOps 平台
- 对代码主权有要求的企业
- 已有 Drone 经验，想要升级到完整平台

不太适合的场景：

- 需要复杂的 RBAC 和审计合规（建议 GitLab）
- 团队已在 GitHub Actions 上深度绑定
- 需要最大的社区生态支持

启动命令再贴一次：

```bash
docker run -d \
  -p 3000:3000 \
  -p 3022:3022 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /data/harness:/data \
  --name harness \
  --restart always \
  harness/harness
```

30 秒部署，即刻拥有自己的 Git + CI/CD 平台。

---

> 参考资料：
> - [Gitness GitHub 仓库](https://github.com/harness/harness)
> - [Harness Open Source 文档](https://developer.harness.io/docs/open-source/overview)
> - [Gitness Pipeline Samples](https://developer.harness.io/docs/open-source/category/samples)
> - [Harness Blog: Gitness 发布公告](https://www.harness.io/blog/gitness-your-ultimate-open-source-development-platform)
