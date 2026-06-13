---
title: "GitHub Actions CI/CD 优化实战：Laravel 单体仓库的矩阵拆分、缓存命中与并行发布踩坑记录"
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:40:00
categories:
  - php
  - cicd
tags: [CI/CD, Composer, Docker, Kubernetes, Laravel]
keywords: [GitHub Actions CI, CD, Laravel, 优化实战, 单体仓库的矩阵拆分, 缓存命中与并行发布踩坑记录, PHP]
description: GitHub Actions CI/CD 优化实战指南，基于 Laravel B2C API 单体仓库的真实改造经验，详解如何将流水线从 18 分钟优化到 7 分钟。内容覆盖 dorny/paths-filter 变更感知、Pest/PHPStan 矩阵并行、Composer lock 缓存策略、Docker BuildKit 层缓存、workflow_run 发布解耦、concurrency 防重入锁、Kubernetes rollout 回滚保护等核心技术点，并附真实缓存事故排查记录与踩坑总结，适合 Laravel 团队落地 CI/CD 提速。



---

Laravel 项目做大之后，CI/CD 变慢几乎是必然的。最常见的坏味道不是“不会写 workflow”，而是**把所有事情都塞进一个 job**：`composer install`、Pest、PHPStan、Docker build、推镜像、部署、健康检查全部串起来。结果就是一个只改了验证规则的小 PR，也要排队十几分钟；更糟糕的是，部署和测试耦合在一起后，失败原因也越来越难定位。

这篇文章记录我在一个 Laravel B2C API 单体仓库里的真实改造过程。改造前主流水线平均 **18 分 20 秒**，高峰时接近 22 分钟；改造后稳定在 **6 分 50 秒到 7 分 30 秒**。这里真正起作用的不是“多开几个 runner”，而是四件事：**变更感知、矩阵并行、缓存收敛、发布防重入**。

## 一、先明确目标：不是更花，而是更快拿到可信反馈

我最开始做这次改造时，先定了三个约束：

1. **PR 阶段只做质量校验，不做生产部署。**
2. **任何优化都不能牺牲可观测性。** 失败时要能一眼看出是测试、静态分析、构建还是发布的问题。
3. **发布必须可串行、可回滚、可追溯。**

很多团队一上来就讨论 reusable workflow、self-hosted runner、并发矩阵，其实顺序反了。真正该先问的是：**这条流水线里，哪些步骤是所有改动都必须执行的？哪些只是少数场景需要？** 这个问题不回答清楚，再复杂的优化都只是把浪费并行化而已。

## 二、改造后的整体结构

```text
Pull Request / Push
        │
        ▼
  changes(paths-filter)
        │
        ├── php-changed ───► Pint + Pest + PHPStan
        ├── docker-changed ► Docker Build
        ├── infra-changed ─► Deploy Script Check
        └── main merged  ──► Release Workflow
                               │
                               ▼
                    Build Image -> Push GHCR
                               │
                               ▼
               Staging Deploy -> Smoke Test -> Prod Deploy
                               │
                               ▼
                 concurrency lock + rollout status + rollback
```

这个结构看起来没什么神奇的，但和旧流程相比有两个根本差异：

- **质量校验和交付发布彻底解耦。**
- **是否执行某个 job，不再靠“习惯”，而是靠文件变更来判断。**

## 三、第一刀：先做变更感知，砍掉无意义执行

在旧流程里，哪怕只是改一篇文档、一个 README、甚至一个注释，也会触发完整流水线。这个问题非常常见，而且是最先应该处理的，因为收益立竿见影。

我会先放一个 `changes` job，只负责计算这次提交到底改了什么：

```yaml
name: laravel-ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      php: ${{ steps.filter.outputs.php }}
      docker: ${{ steps.filter.outputs.docker }}
      infra: ${{ steps.filter.outputs.infra }}
    steps:
      - uses: actions/checkout@v4

      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            php:
              - 'app/**'
              - 'bootstrap/**'
              - 'config/**'
              - 'database/**'
              - 'routes/**'
              - 'tests/**'
              - 'composer.*'
            docker:
              - 'Dockerfile'
              - 'docker/**'
            infra:
              - '.github/workflows/**'
              - 'deploy/**'
              - 'k8s/**'
```

这一步落地后，我们做过一次统计：在一段两周的迭代里，大约 **31% 的 PR 根本不需要跑镜像构建**，还有一部分只需要检查 workflow 或部署脚本。如果没有变更感知，这些任务全都白跑。

不过这里有一个非常容易踩的坑：**不要把 filter 规则写得过细**。我曾经只匹配 `app/Services/**` 和 `app/Http/**`，结果 `app/Domain/**` 改动漏跑测试，问题直接进了 `main`。所以我的经验是：过滤粒度只到“大类”，不要细到业务目录层级。

## 四、第二刀：测试拆矩阵，让 CPU 等待变成并行执行

单体仓库最浪费时间的另一部分，是把所有检查串行执行。Pest 跑完再跑 PHPStan，再跑 Pint，再跑架构检查，开发者只能干等。

实际落地时，我会拆成矩阵 job：

```yaml
  quality:
    needs: changes
    if: needs.changes.outputs.php == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        suite: [pint, pest, phpstan]
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, bcmath, pcntl, redis, pdo_mysql
          coverage: none

      - uses: actions/cache@v4
        with:
          path: |
            vendor
            ~/.composer/cache/files
          key: composer-${{ runner.os }}-${{ hashFiles('composer.lock') }}
          restore-keys: |
            composer-${{ runner.os }}-

      - run: composer install --prefer-dist --no-interaction --no-progress
      - run: cp .env.example .env && php artisan key:generate

      - run: vendor/bin/pint --test
        if: matrix.suite == 'pint'

      - run: php artisan test --parallel
        if: matrix.suite == 'pest'

      - run: vendor/bin/phpstan analyse --memory-limit=1G
        if: matrix.suite == 'phpstan'
```

这里有两个点我会强制要求：

### 1. `fail-fast: false` 必须开

很多人默认开矩阵，却忘了这个设置。结果 Pint 先失败，Pest 和 PHPStan 被取消，PR 作者只能收到一半反馈。对中大型团队来说，这种“修一轮、再等一轮”的反复，是非常贵的。

### 2. `composer.lock` 才是缓存 key 的核心

我见过很多 workflow 用分支名、commit SHA、甚至 job 名称做 vendor 缓存 key，这会直接把命中率打没。对 PHP 项目来说，**依赖缓存最稳定的判断条件就是 `composer.lock`**，不要自己创造复杂规则。

## 五、缓存不是“加了就快”，关键看缓存边界

GitHub Actions 里最容易出现的错觉就是：加了 `actions/cache`，流水线就一定会变快。现实完全不是这样。缓存如果设计错了，不仅不会快，还会带来脏状态。

我最后保留的缓存只有两类：

1. **Composer 下载缓存 + vendor 缓存**。
2. **Docker BuildKit 层缓存**。

Composer 缓存配置如下：

```yaml
- uses: actions/cache@v4
  with:
    path: |
      vendor
      ~/.composer/cache/files
    key: composer-${{ runner.os }}-${{ hashFiles('composer.lock') }}
    restore-keys: |
      composer-${{ runner.os }}-
```

而 Docker 构建这样写：

```yaml
  docker:
    needs: changes
    if: github.ref == 'refs/heads/main' && needs.changes.outputs.docker == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ghcr.io/mikeah2011/b2c-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 我踩过最严重的一次缓存事故

曾经为了“更快”，我把 `bootstrap/cache`、`storage/framework/cache` 也一起缓存了。结果某个 job 执行过 `php artisan config:cache` 之后，下一次测试直接复用了旧配置，数据库连到了错误环境。那次排查花了接近半天，因为表面上看 workflow 是绿色的，实际上执行上下文已经被污染了。

所以我的原则很简单：**只缓存可重复生成且不会串环境的内容**。运行态缓存、配置缓存、框架临时目录，一律不进 CI 缓存。

## 六、第三刀：把部署链路从测试链路里拆出去

测试流水线和发布流水线混在一起，是很多 Laravel 项目后期最痛的点。因为一旦 build 成功、发布失败，开发者就会在同一个 workflow 里翻半天日志，搞不清到底是质量问题还是环境问题。

我后来把发布独立成单独 workflow，只在主流程成功后触发：

```yaml
name: deploy-prod

on:
  workflow_run:
    workflows: [laravel-ci]
    types: [completed]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    concurrency:
      group: production
      cancel-in-progress: false
    steps:
      - name: Set image
        run: kubectl set image deployment/b2c-api app=ghcr.io/mikeah2011/b2c-api:${{ github.event.workflow_run.head_sha }} -n production

      - name: Wait rollout
        run: kubectl rollout status deployment/b2c-api -n production --timeout=180s

      - name: Smoke test
        run: |
          curl --fail --silent https://api.mikeah.dev/healthz
          curl --fail --silent https://api.mikeah.dev/version | grep "${{ github.event.workflow_run.head_sha }}"
```

这里最关键的是 `concurrency`：

```yaml
concurrency:
  group: production
  cancel-in-progress: false
```

CI 阶段我支持取消旧任务，因为旧 PR 的结果通常已经没有意义；但生产部署绝不能这么做。**一条正在 rollout 的发布任务被新的 merge 中断，后果比单纯失败严重得多**，因为它很可能留下半切流量、半更新 Pod、半刷新配置的中间态。

## 七、Laravel 项目特有的发布动作，不能偷懒

Laravel 的 CD 和普通静态服务不一样，真正容易翻车的是迁移、配置缓存、队列 worker 和 Horizon 重启。很多团队只是 `kubectl set image` 之后等 rollout success，就以为完成了，其实远远不够。

如果是非容器场景，我通常会把发布后动作明确写出来：

```yaml
steps:
  - name: Run migration
    run: php artisan migrate --force

  - name: Rebuild cache
    run: |
      php artisan config:clear
      php artisan config:cache
      php artisan route:cache
      php artisan event:cache

  - name: Restart workers
    run: |
      php artisan queue:restart
      php artisan horizon:terminate || true
```

如果已经是 Kubernetes 部署，我不会直接在 Runner 上执行这些命令，而是下沉到 Job、Helm hook 或单独的 maintenance task。原因很现实：**Runner 执行成功，不等于新 Pod 真的完成了这些动作**。把应用生命周期操作留在集群内，比把它们散在 GitHub Runner 上更可靠。

## 八、把重复 setup 抽成 reusable workflow，但别过度设计

当仓库里出现多个近似 workflow，比如 `api-ci.yml`、`admin-ci.yml`、`worker-ci.yml`，复制粘贴迟早会失控。这个时候，把 PHP 环境准备抽成 reusable workflow 是合理的：

```yaml
# .github/workflows/php-check.yml
name: php-check

on:
  workflow_call:
    inputs:
      php-version:
        required: true
        type: string
      command:
        required: true
        type: string

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ inputs.php-version }}
          extensions: mbstring, bcmath, pcntl, redis, pdo_mysql
      - uses: actions/cache@v4
        with:
          path: |
            vendor
            ~/.composer/cache/files
          key: composer-${{ runner.os }}-${{ hashFiles('composer.lock') }}
      - run: composer install --prefer-dist --no-interaction --no-progress
      - run: ${{ inputs.command }}
```

调用时只需要：

```yaml
jobs:
  pest:
    uses: ./.github/workflows/php-check.yml
    with:
      php-version: '8.3'
      command: php artisan test --parallel

  phpstan:
    uses: ./.github/workflows/php-check.yml
    with:
      php-version: '8.3'
      command: vendor/bin/phpstan analyse --memory-limit=1G
```

这种抽法的价值很明确：PHP 版本、扩展、Composer 参数不会在不同 workflow 里漂移。但我不建议一开始就把所有逻辑抽成三四层模板，因为 **reusable workflow 的调试成本比单文件明显更高**。如果团队成员对 Actions 还不熟，先把主链路理顺，再抽公共模板，收益会更大。

## 九、三次最有代表性的踩坑

### 1. 缓存命中了，但流水线还是慢

一开始我以为是 `actions/cache` 没工作，后来仔细看日志才发现，下载确实变快了，但时间都耗在 `composer install` 解压、autoload dump 和 PHP 扩展初始化上。也就是说，**缓存命中不代表总耗时会线性下降**。最终真正有效的做法，是把扩展组合固定、Composer 参数固定，减少安装阶段的波动。

### 2. `paths-filter` 规则过窄，漏掉真实改动

这类问题比“全量跑慢”更危险，因为它会制造“假绿色”。当时我把 PHP 目录规则写得太精细，导致 `app/Domain/**` 和 `app/Support/**` 的改动没有触发测试。后来我的规则改成只区分 PHP、Docker、Infra 三大类，再也不做业务目录级筛选。

### 3. 我一直在优化 build，但瓶颈根本不在 build

有一次我把镜像构建从 3 分钟优化到 1 分 40 秒，自以为很成功，结果主流程总时长几乎没变。最后把每一步耗时摊开后才发现，真正的长尾在 `kubectl rollout status` 和 readiness probe。**先做时间分布分析，再决定优化方向**，这是 CI/CD 调优里最容易被忽略的一步。

## 十、CI 缓存策略对比表

| 缓存策略 | 缓存目标 | key 设计 | 命中率 | 适用场景 | 风险 |
| --- | --- | --- | --- | --- | --- |
| `actions/cache` + vendor | Composer 依赖目录 | `composer-{os}-{hash(composer.lock)}` | 高 | PHP 项目标准依赖缓存 | lock 文件未更新时命中旧依赖 |
| `actions/cache` + composer cache | `~/.composer/cache/files` | 同上 | 高 | 补充 vendor 缓存，减少网络下载 | 几乎无风险，仅缓存包下载 |
| `actions/cache` + node_modules | npm/yarn 依赖 | `npm-{os}-{hash(package-lock.json)}` | 高 | 前端构建场景 | lock 文件变更频繁时命中率下降 |
| Docker BuildKit GHA cache | Docker 层缓存 | `type=gha,mode=max` | 中高 | 多阶段构建、大镜像 | 首次构建无缓存；cache 过期需手动清理 |
| `actions/cache` + bootstrap/cache | Laravel 配置缓存 | 按 branch 或 SHA | 低 | ⚠️ 不推荐 | 污染测试环境，串配置到错误数据库 |
| `actions/cache` + storage/framework | Laravel 框架临时文件 | 按 branch 或 SHA | 低 | ⚠️ 不推荐 | 引入脏状态，导致"假绿色" |
| npm ci + lockfileOnly | 仅下载不安装 | lockfileOnly: true | 中 | 需要验证 lock 文件一致性 | 不产生可用 node_modules |

> **经验总结**：缓存的核心原则是**只缓存可重复生成且不会串环境的内容**。对 Laravel 项目来说，`composer.lock` 是最稳定的缓存 key 来源，运行态缓存（config cache、session、framework cache）一律不进 CI 缓存。

## 十一、这次改造后，我固定遵守的四条规则

1. **PR 只跑必要校验，不混入生产部署。**  
2. **缓存只缓存依赖，不缓存运行态目录。**  
3. **发布必须带环境锁、健康检查、可回滚镜像标签。**  
4. **优化目标不是 workflow 更花，而是更快给出可信反馈。**

GitHub Actions 本身并不复杂，复杂的是团队把所有步骤都塞进了一条串行流水线。对于 Laravel 项目来说，真正值得优化的不是 YAML 写法本身，而是**流程切分是否合理、缓存边界是否清晰、发布动作是否安全**。只要把这几个点做对，CI/CD 就不会再是研发效率的阻塞点，而会真正变成交付加速器。

## 相关阅读

- [Laravel Dusk 浏览器自动化 E2E 测试实战：CI 流水线集成、动态等待与选择器治理踩坑记录](/php/Laravel/laravel-dusk-automatione2etestingguide-ci/) — 本文聚焦 CI 中的 E2E 测试集成，与本文的 CI 流水线优化互为补充，覆盖 Dusk 在 GitHub Actions 中的 Headless Chrome 运行与测试稳定性治理。
- [Laravel Scheduler 定时任务实战：多实例部署下的重入保护、onOneServer 失效与 Kubernetes CronJob 取舍](/php/Laravel/laravel-scheduler-guide-deployment-ononeserver-kubernetes-cronjob/) — 延伸本文第七节的发布后动作，深入讨论 Laravel 调度器在 Kubernetes 多副本场景下的陷阱与替代方案。
- [Laravel Reverb 实战：订单状态实时推送与多实例部署踩坑记录](/php/Laravel/laravel-reverb-guide-deployment/) — 从 WebSocket 实时推送角度补充 Laravel 应用的多实例部署与健康检查实践，与本文的 Kubernetes 部署与 rollout 策略形成呼应。