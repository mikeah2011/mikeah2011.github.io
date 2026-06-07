# CI/CD 流水线

## 定义

CI/CD 是持续集成（Continuous Integration）、持续交付（Continuous Delivery）和持续部署（Continuous Deployment）的统称。CI 确保每次代码提交都经过自动化构建和测试；CD（交付）确保代码随时可部署到生产环境；CD（部署）则进一步实现从提交到上线的全自动流水线。

## 核心原理

### GitHub Actions 工作流
GitHub Actions 是 GitHub 原生的 CI/CD 平台，通过 YAML 格式的工作流文件（`.github/workflows/*.yml`）定义自动化流程。核心概念包括：

- **Workflow**：一次完整的自动化流程，由事件（push/PR/schedule）触发
- **Job**：工作流中的一个执行单元，运行在独立的 Runner 上
- **Step**：Job 中的单个步骤，可以是 Action 或 Shell 命令
- **Action**：可复用的步骤单元，可来自 Marketplace 或自定义

### 矩阵策略（Matrix Strategy）
当代码需要在多个运行环境上验证时（如 PHP 8.1/8.2/8.3 × MySQL 5.7/8.0/PostgreSQL 15），矩阵策略自动展开所有组合并行执行：

```yaml
strategy:
  matrix:
    php: ['8.1', '8.2', '8.3', '8.4']
    db: ['mysql:5.7', 'mysql:8.0', 'postgres:15']
  fail-fast: false
  max-parallel: 6
```

关键配置：
- `fail-fast: false` — 一个组合失败不取消其他组合，便于完整收集所有失败信息
- `max-parallel` — 控制并行度，避免 Runner 资源耗尽

### 自定义 Action 开发
当多个仓库存在重复的 CI 逻辑（如"配置 PHP 环境 + 安装依赖 + 运行测试"），可以封装为 Composite Action 或 Reusable Workflow：

- **Composite Action**（`action.yml`）：将多个步骤打包为一个可复用的 Action
- **Reusable Workflow**（`workflow_call`）：将整个工作流作为可调用的模板
- **Docker Action**：用 Docker 容器运行的 Action，适合需要特定运行环境的场景

### Service Containers
GitHub Actions 支持在 Job 中启动 Service Containers（如 MySQL、Redis、PostgreSQL），无需手动安装：

```yaml
services:
  mysql:
    image: mysql:8.0
    env:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: testing
    ports:
      - 3306:3306
    options: --health-cmd="mysqladmin ping" --health-interval=10s
```

## CI/CD 流水线最佳实践

### 分层缓存优化
```yaml
- uses: actions/cache@v4
  with:
    path: |
      vendor
      node_modules
    key: ${{ runner.os }}-deps-${{ hashFiles('**/composer.lock', '**/package-lock.json') }}
    restore-keys: ${{ runner.os }}-deps-
```

### 条件化发布
```yaml
deploy:
  needs: [test, lint]
  if: github.ref == 'refs/heads/main' && success()
  runs-on: ubuntu-latest
  steps:
    - uses: actions/deploy@v1
      with:
        environment: production
```

### 安全最佳实践
- 使用 `GITHUB_TOKEN` 而非 Personal Access Token
- 固定 Action 版本到 SHA（`actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11`）
- 使用 `permissions` 最小权限原则
- 敏感信息使用 GitHub Secrets

## 实战案例

来自博客文章：
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/2026/06/02/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/) — 12 种测试组合的自动化并行执行
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/2026/06/01/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) — Composite Action、Reusable Workflow 与 Docker Action 的选型封装
- [AI Agent + GitHub Actions 实战：CI/CD 智能化与自动化决策](/2026/06/02/AI-Agent-GitHub-Actions-CICD智能化/) — AI Code Review、智能合并决策

## 相关概念

- [Docker 容器化](Docker容器化.md) — CI/CD 中构建与推送 Docker 镜像
- [自动化配置管理](自动化配置管理.md) — Ansible 在 CD 阶段执行部署
- [基础设施即代码](基础设施即代码.md) — Terraform 在 CI/CD 中编排基础设施
- [AI Agent 驱动 DevOps](AI-Agent驱动DevOps.md) — CI/CD 的智能化升级

## 常见问题

### 矩阵策略导致 Runner 资源不足
- 使用 `max-parallel` 限制并行数
- 对非核心组合使用 `include` 精确控制而非全量展开
- 考虑使用自托管 Runner 应对高峰

### 缓存命中率低
- 确保 `key` 包含锁文件的 hash 而非随机值
- 使用 `restore-keys` 做前缀匹配回退
- 分离不同语言的缓存路径

### Workflow 运行时间过长
- 使用 `paths` 过滤器，仅在相关文件变更时触发
- 将测试拆分为快测试（单元）和慢测试（集成），分阶段执行
- 使用 `concurrency` 取消同一 PR 的旧运行
