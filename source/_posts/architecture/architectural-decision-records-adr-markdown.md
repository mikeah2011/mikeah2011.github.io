---

title: Architectural Decision Records (ADR) 实战：用 Markdown 管理架构决策——团队技术共识的可追溯性
keywords: [Architectural Decision Records, ADR, Markdown, 管理架构决策, 团队技术共识的可追溯性]
date: 2026-06-02 12:00:00
tags:
- adr
- 架构决策
- Markdown
- 团队协作
- 文档化
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 用 Markdown 管理架构决策的完整实战指南，解决团队技术共识丢失、新人入职理解困难、决策原因无据可查等痛点。涵盖 ADR 生命周期状态机（Proposed→Accepted→Superseded）、MADR 与 Nygard 两种模板设计、adr-tools/Log4brains/adr-viewer 工具链对比、Laravel Artisan 命令一键生成 ADR、GitHub Actions 自动检查 PR 中的架构变更、ADR Review Bot 集成，以及渐进式团队采纳策略与电商平台架构演进的 18 个 ADR 实战案例。
---



# Architectural Decision Records (ADR) 实战：用 Markdown 管理架构决策——团队技术共识的可追溯性

## 前言

你是否经历过这样的场景？

```
新人："为什么我们用 MongoDB 存日志而不是 Elasticsearch？"
老员工："嗯...好像是去年谁决定的，具体原因记不清了。"
新人："那我们能不能换成 ES？"
老员工："不知道，当初的决定可能有原因，但没人记录下来。"
```

或者这个：

```
CTO："为什么选了 Laravel 而不是 Symfony？"
Tech Lead："当时是前任 Tech Lead 选的，文档里没写。"
CTO："那现在换成 Symfony 还来得及吗？"
Tech Lead："已经有 50 万行 Laravel 代码了，换不了了。"
```

**架构决策如果没有被记录，就等于没有发生过。** 三个月后没人记得为什么做了这个选择，新人加入时只能靠口口相传（通常还不准确），而"当初的决策依据"早已消失在 Slack 的历史消息中。

**Architectural Decision Records（ADR）** 就是解决这个问题的极简方案——用一个 Markdown 文件记录每一个重要的架构决策，包括背景、选项、决策和后果。就这么简单。

---

## 一、什么是 ADR？

### 1.1 起源

ADR 的概念由 Michael Nygard 在 2011 年的文章 [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) 中首次提出。核心理念：

> 架构是一组决策的结果，而不是一组文档的结果。记录决策比记录架构更重要。

### 1.2 ADR 的本质

一个 ADR 就是一个 Markdown 文件，回答以下问题：

```
1. 我们面临什么问题？（背景）
2. 我们考虑了哪些方案？（选项）
3. 我们最终选了什么？（决策）
4. 这个决策会带来什么影响？（后果）
```

就这么简单。没有复杂的模板，没有冗长的流程，就是一个文件，提交到 Git 仓库，和代码一起版本管理。

### 1.3 ADR vs 其他文档

| 文档类型 | 用途 | 格式 | 生命周期 |
|---------|------|------|---------|
| **ADR** | 记录一个决策 | 结构化 Markdown | 提出 → 接受 → 废弃/替代 |
| **RFC** | 征求对重大变更的意见 | 自由格式 | 讨论 → 批准/拒绝 |
| **设计文档** | 描述系统设计 | 详细文档 | 编写 → 评审 → 维护 |
| **Wiki** | 通用知识库 | 自由格式 | 持续更新 |
| **注释** | 解释代码细节 | 代码内 | 随代码变更 |

ADR 填补了一个独特的空白：**它记录的是"为什么"，而不是"是什么"或"怎么做"。**

代码告诉你系统是怎样的，设计文档告诉你系统应该怎样工作，ADR 告诉你**为什么做了这个选择而不是那个选择**。

---

## 二、ADR 的生命周期

### 2.1 状态流转

```
┌──────────┐    讨论通过    ┌──────────┐    被新 ADR 替代    ┌───────────┐
│ Proposed │ ──────────→  │ Accepted │ ──────────────→   │Superseded │
│ (提议中)  │              │ (已接受)  │                    │ (已替代)   │
└──────────┘              └──────────┘                    └───────────┘
     │                         │
     │ 讨论未通过               │ 决策不再适用
     ▼                         ▼
┌──────────┐              ┌───────────┐
│ Rejected │              │ Deprecated│
│ (已拒绝)  │              │ (已废弃)   │
└──────────┘              └───────────┘
```

**各状态含义：**

- **Proposed**：刚提出，团队正在讨论
- **Accepted**：讨论通过，团队同意执行
- **Deprecated**：决策不再适用（如技术栈更新导致）
- **Superseded**：被新的 ADR 替代（引用新 ADR 编号）
- **Rejected**：讨论后决定不执行（同样值得记录——避免后人重复提议）

### 2.2 ADR 的不可变性

**ADR 一旦被接受，就不应该被修改。** 如果需要改变决策，应该创建一个新的 ADR 来替代旧的。

```
ADR-001: 选择 MySQL 作为主数据库 (Accepted)
  ↓ 时间推移，业务变化
ADR-015: 引入 PostgreSQL 作为分析数据库 (Accepted)
  ↓ ADR-001 仍然有效（OLTP 用 MySQL），ADR-015 补充了 OLAP 场景
ADR-023: 将主数据库从 MySQL 迁移到 PostgreSQL (Accepted)
  ↓ ADR-023 替代了 ADR-001
ADR-001 更新为 Superseded by ADR-023
```

---

## 三、ADR 模板设计

### 3.1 MADR 格式（推荐）

MADR（Markdown Any Decision Records）是目前最流行的 ADR 格式：

```markdown
# {编号}. {决策标题}

日期：{YYYY-MM-DD}

## 状态

{Proposed | Accepted | Deprecated | Superseded by ADR-XXX}

## 背景

{描述问题的背景。为什么需要做这个决策？有什么约束条件？}

## 决策驱动因素

- {因素 1：例如性能要求}
- {因素 2：例如团队技能栈}
- {因素 3：例如预算限制}
- {因素 4：例如时间压力}

## 考虑的选项

### 选项 1：{选项名称}

{描述选项 1}

- 优点：{...}
- 缺点：{...}

### 选项 2：{选项名称}

{描述选项 2}

- 优点：{...}
- 缺点：{...}

### 选项 3：{选项名称}

{描述选项 3}

- 优点：{...}
- 缺点：{...}

## 决策

{我们选择 {选项 X}，因为 {原因}。}

## 后果

### 正面后果

- {正面后果 1}
- {正面后果 2}

### 负面后果

- {负面后果 1}
- {负面后果 2}

### 风险

- {风险 1 及缓解措施}

## 相关决策

- ADR-XXX: {相关决策}
- ADR-YYY: {相关决策}

## 参考资料

- {参考链接 1}
- {参考链接 2}
```

### 3.2 Nygard 简化格式

如果你觉得 MADR 太详细，可以用 Nygard 的原始简化格式：

```markdown
# {编号}. {决策标题}

日期：{YYYY-MM-DD}

## 状态

{状态}

## 上下文

{描述问题背景和约束}

## 决策

{我们决定...}

## 后果

{这将导致...}
```

### 3.3 实战示例：选择 Laravel 队列驱动

```markdown
# ADR-003: 选择 Redis 作为 Laravel 队列驱动

日期：2026-03-15

## 状态

Accepted

## 背景

我们的 Laravel B2C 电商平台需要处理异步任务：订单确认邮件、库存同步、
支付回调处理、报表生成。日均任务量约 50 万条，峰值（大促期间）可达 200 万条/天。

当前使用 `sync` 驱动（同步执行），导致 API 响应时间不稳定，用户下单后
等待时间过长。

## 决策驱动因素

- **可靠性**：任务不能丢失（特别是支付回调）
- **性能**：需要支持 200 万条/天的峰值吞吐
- **运维成本**：不希望引入过多中间件
- **团队熟悉度**：团队已有 Redis 使用经验
- **延迟**：低优先级任务可以延迟处理，但支付回调需要实时

## 考虑的选项

### 选项 1：Redis 队列

Laravel 原生支持，使用 `php artisan queue:work redis` 驱动。

- 优点：
  - 团队已熟悉 Redis
  - 已有 Redis Cluster 部署
  - Laravel 原生支持，零额外配置
  - 支持延迟队列和优先级队列
  - 性能优异（单实例 10 万+ 任务/分钟）
- 缺点：
  - Redis 是内存数据库，队列数据不持久化（需要配置 AOF）
  - Redis 故障时任务可能丢失（可以通过配置改善）
  - 不支持复杂的消息路由

### 选项 2：RabbitMQ

专业消息队列中间件，AMQP 协议。

- 优点：
  - 消息持久化，不丢失
  - 支持复杂的路由规则（exchange, binding）
  - 成熟稳定，社区庞大
  - 支持消息确认和重试机制
- 缺点：
  - 需要额外部署和维护 RabbitMQ 服务
  - 团队没有 RabbitMQ 运维经验
  - Erlang 技术栈，排查问题需要额外学习
  - 配置复杂度高于 Redis

### 选项 3：Amazon SQS

AWS 托管消息队列服务。

- 优点：
  - 完全托管，无需运维
  - 按使用量付费
  - 无限扩展
  - 与 AWS 生态深度集成
- 缺点：
  - 依赖 AWS，供应商锁定
  - 延迟较高（标准队列平均延迟 100-200ms）
  - 成本随任务量线性增长
  - 本地开发需要 LocalStack 或 mock
  - FIFO 队列吞吐量有限（300 条/秒）

## 决策

我们选择 **Redis 作为队列驱动**，配合以下配置确保可靠性：

1. 开启 Redis AOF 持久化（everysec）
2. 配置 `retry_after` 为任务最大执行时间的 2 倍
3. 使用 `horizon` 管理队列 worker
4. 支付相关任务使用独立队列（高优先级）
5. 配置 Redis Sentinel 实现高可用

选择原因：
- 团队已有 Redis 运维经验，学习成本最低
- 已有 Redis Cluster，无需新增基础设施
- Laravel 原生支持，代码改动最小
- 性能完全满足当前需求

## 后果

### 正面后果

- API 响应时间从 2-5 秒降至 200ms 以内
- 任务处理吞吐量满足 200 万/天峰值需求
- 无新增运维成本（复用现有 Redis）
- 可通过 Horizon Dashboard 实时监控队列状态

### 负面后果

- Redis 需要配置 AOF 持久化，内存占用增加约 10%
- 如果 Redis 节点故障，可能丢失最近 1 秒内的任务（AOF everysec）
- 复杂的消息路由场景需要自行实现

### 风险

- **风险**：Redis 内存不足导致任务丢失
  **缓解**：监控 Redis 内存使用率，设置告警阈值 80%
- **风险**：Redis 主从切换时任务中断
  **缓解**：使用 Redis Sentinel 自动故障转移，配置合理的超时时间

## 相关决策

- ADR-001: 选择 Laravel 作为后端框架
- ADR-005: Redis Cluster 部署方案

## 参考资料

- [Laravel Queue Documentation](https://laravel.com/docs/queues)
- [Redis Persistence](https://redis.io/docs/management/persistence/)
- [Laravel Horizon](https://laravel.com/docs/horizon)
```

---

## 四、ADR 工具链

### 4.1 adr-tools（CLI 工具）

`adr-tools` 是最流行的 ADR 命令行工具：

```bash
# 安装
brew install adr-tools

# 初始化 ADR 目录
adr init docs/adr

# 创建新 ADR
adr new "选择 Redis 作为队列驱动"
# 创建 docs/adr/0003-选择-redis-作为队列驱动.md

# 创建替代旧 ADR 的新 ADR
adr new -s 1 "将主数据库从 MySQL 迁移到 PostgreSQL"
# 创建 docs/adr/0005-将主数据库从-mysql-迁移到-postgresql.md
# 自动更新 ADR-001 状态为 "Superseded by ADR-005"

# 列出所有 ADR
adr list

# 生成 ADR 索引页
adr generate toc > docs/adr/index.md
```

### 4.2 Log4brains（Web 界面）

Log4brains 为 ADR 提供了一个漂亮的 Web 界面：

```bash
# 安装
npm install -g log4brains

# 初始化
log4brains adr init

# 本地预览
log4brains preview
# 打开 http://localhost:8080

# 构建静态站点
log4brains build
# 生成 .log4brains/ 目录，可部署到任何静态托管
```

Log4brains 的特点：
- 自动从 ADR Markdown 生成可浏览的网站
- 支持搜索和筛选
- 显示 ADR 之间的关系图
- 可部署到 GitHub Pages

集成到 GitHub Actions：

```yaml
# .github/workflows/adr-site.yml
name: Deploy ADR Site

on:
  push:
    paths:
      - 'docs/adr/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g log4brains
      - run: log4brains build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: .log4brains
```

### 4.3 adr-viewer（GitHub 集成）

```bash
# 安装
pip install adr-tools adr-viewer

# 生成 HTML 报告
adr-viewer adr-report.html

# 或者作为 GitHub Action 使用
```

### 4.4 VS Code 插件

```
ADR Tools Extension for VS Code:
  - 创建新 ADR（Ctrl+Shift+P → "ADR: New"）
  - 语法高亮
  - ADR 状态管理
  - 快速导航
```

---

## 五、Laravel 项目中的 ADR 实践

### 5.1 目录结构

```
my-laravel-project/
├── app/
├── docs/
│   └── adr/
│       ├── 0001-选择-laravel-作为后端框架.md
│       ├── 0002-选择-mysql-作为主数据库.md
│       ├── 0003-选择-redis-作为队列驱动.md
│       ├── 0004-采用-repository-pattern.md
│       ├── 0005-api-版本策略采用-url-路径方式.md
│       └── README.md  (ADR 索引)
├── composer.json
└── ...
```

### 5.2 Laravel Artisan 命令：创建 ADR

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Str;

class AdrNew extends Command
{
    protected $signature = 'adr:new {title : ADR 标题}
        {--template=full : 模板类型 (full / simple)}
        {--supersedes= : 替代的 ADR 编号}';

    protected $description = '创建新的架构决策记录 (ADR)';

    public function handle(): int
    {
        $title = $this->argument('title');
        $template = $this->option('template');
        $supersedes = $this->option('supersedes');

        // 确定编号
        $adrDir = base_path('docs/adr');
        $existing = glob("{$adrDir}/[0-9]*.md");
        $nextNumber = count($existing) + 1;

        // 生成文件名
        $slug = Str::slug($title);
        $filename = sprintf('%04d-%s.md', $nextNumber, $slug);
        $filepath = "{$adrDir}/{$filename}";

        // 确保目录存在
        if (!is_dir($adrDir)) {
            mkdir($adrDir, 0755, true);
        }

        // 生成内容
        $content = $this->generateContent($nextNumber, $title, $template, $supersedes);

        file_put_contents($filepath, $content);

        $this->info("✅ ADR 已创建: {$filepath}");

        // 如果替代了旧 ADR，更新旧 ADR 的状态
        if ($supersedes) {
            $this->updateSuperseded((int) $supersedes, $nextNumber, $adrDir);
            $this->info("✅ ADR-{$supersedes} 已标记为 Superseded by ADR-{$nextNumber}");
        }

        return 0;
    }

    protected function generateContent(
        int $number,
        string $title,
        string $template,
        ?string $supersedes
    ): string {
        $date = now()->format('Y-m-d');
        $status = 'Proposed';
        $supersededNote = $supersedes
            ? "\n替代：ADR-{$supersedes}\n"
            : '';

        if ($template === 'simple') {
            return <<<MD
            # ADR-{$number}: {$title}

            日期：{$date}
            状态：{$status}
            {$supersededNote}
            ## 背景

            {描述问题的背景和约束条件}

            ## 决策

            {我们决定...}

            ## 后果

            {这将导致...}

            MD;
        }

        return <<<MD
        # ADR-{$number}: {$title}

        日期：{$date}
        状态：{$status}
        {$supersededNote}
        ## 背景

        {描述问题的背景。为什么需要做这个决策？有什么约束条件？}

        ## 决策驱动因素

        - {因素 1}
        - {因素 2}
        - {因素 3}

        ## 考虑的选项

        ### 选项 1：{选项名称}

        {描述}

        - 优点：{...}
        - 缺点：{...}

        ### 选项 2：{选项名称}

        {描述}

        - 优点：{...}
        - 缺点：{...}

        ## 决策

        {我们选择 {选项 X}，因为 {原因}。}

        ## 后果

        ### 正面后果

        - {正面后果 1}

        ### 负面后果

        - {负面后果 1}

        ### 风险

        - {风险 1 及缓解措施}

        ## 参考资料

        - {链接}

        MD;
    }

    protected function updateSuperseded(int $oldNumber, int $newNumber, string $adrDir): void
    {
        $files = glob("{$adrDir}/{$oldNumber}-*.md");
        if (empty($files)) {
            $this->warn("未找到 ADR-{$oldNumber}");
            return;
        }

        $content = file_get_contents($files[0]);

        // 更新状态
        $content = preg_replace(
            '/状态：.*$/m',
            "状态：Superseded by ADR-{$newNumber}",
            $content
        );

        file_put_contents($files[0], $content);
    }
}
```

### 5.3 ADR Review Bot

在 PR 中自动检查 ADR 相关规则：

```php
<?php

namespace App\GitHub;

class AdrReviewBot
{
    /**
     * 分析 PR 中的架构变更，建议创建 ADR
     */
    public function analyzePullRequest(array $pr): array
    {
        $suggestions = [];

        // 检查是否新增了数据库迁移（可能是 schema 决策）
        $migrations = array_filter($pr['files'], fn($f) =>
            str_contains($f, 'database/migrations/')
        );
        if (!empty($migrations)) {
            $suggestions[] = [
                'type' => 'database_schema',
                'message' => '此 PR 包含数据库迁移。如果涉及 schema 设计的重大变更，'
                    . '请考虑创建 ADR 记录决策原因。',
                'files' => $migrations,
            ];
        }

        // 检查是否引入了新的 Composer 依赖
        $composerChanged = in_array('composer.json', $pr['files']);
        if ($composerChanged) {
            $suggestions[] = [
                'type' => 'new_dependency',
                'message' => '此 PR 修改了 composer.json。如果引入了重要的新依赖，'
                    . '请考虑创建 ADR 说明选择原因。',
            ];
        }

        // 检查是否修改了 API 路由
        $apiRoutes = array_filter($pr['files'], fn($f) =>
            str_contains($f, 'routes/api.php')
        );
        if (!empty($apiRoutes)) {
            $suggestions[] = [
                'type' => 'api_change',
                'message' => '此 PR 修改了 API 路由。如果涉及 API 设计决策，'
                    . '请考虑创建 ADR。',
            ];
        }

        // 检查是否修改了配置文件
        $configChanges = array_filter($pr['files'], fn($f) =>
            str_contains($f, 'config/')
        );
        if (!empty($configChanges)) {
            $suggestions[] = [
                'type' => 'configuration',
                'message' => '此 PR 修改了配置文件。如果涉及架构级配置决策，'
                    . '请考虑创建 ADR。',
            ];
        }

        return $suggestions;
    }

    /**
     * 生成 PR 评论
     */
    public function generateComment(array $suggestions): string
    {
        if (empty($suggestions)) {
            return '';
        }

        $comment = "## 📋 ADR 提醒\n\n";
        $comment .= "检测到此 PR 可能涉及架构决策。请评估是否需要创建 ADR：\n\n";

        foreach ($suggestions as $s) {
            $comment .= "- **{$s['type']}**: {$s['message']}\n";
        }

        $comment .= "\n创建 ADR：`php artisan adr:new \"决策标题\"`\n";
        $comment .= "ADR 文档：[docs/adr/](../docs/adr/)\n";

        return $comment;
    }
}
```

### 5.4 GitHub Actions 集成

```yaml
# .github/workflows/adr-check.yml
name: ADR Check

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  adr-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for ADR in PR
        uses: actions/github-script@v7
        with:
          script: |
            const { data: files } = await github.rest.pulls.listFiles({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });

            const changedFiles = files.map(f => f.filename);

            // 检查是否有架构相关变更
            const archChanges = changedFiles.filter(f =>
              f.includes('database/migrations') ||
              f.includes('config/') ||
              f.includes('routes/api') ||
              f === 'composer.json'
            );

            const hasADR = changedFiles.some(f => f.includes('docs/adr/'));

            if (archChanges.length > 0 && !hasADR) {
              const body = `## 📋 ADR Check

              此 PR 包含可能的架构相关变更，但没有包含 ADR。

              变更的文件：
              ${archChanges.map(f => `- \`${f}\``).join('\n')}

              如果这些变更涉及重要的架构决策，请考虑创建 ADR：
              \`\`\`bash
              php artisan adr:new "决策标题"
              \`\`\`

              如果不需要 ADR，请在 PR 描述中说明原因。`;

              await github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: body,
              });
            }
```

---

## 六、团队采纳策略

### 6.1 常见阻力与应对

**阻力 1："写 ADR 太浪费时间了"**

```
应对：
  - 使用简化模板（Nygard 格式只需 4 个段落）
  - 提供 CLI 工具一键生成
  - 展示案例：一个 ADR 如何在 3 个月后帮助团队避免了重复讨论

示例话术：
  "写一个 ADR 只需要 15 分钟。但三个月后你忘记为什么做了这个决策，
   花在重新讨论上的时间可能是 2 小时。"
```

**阻力 2："我们的决策都很简单，不需要记录"**

```
应对：
  - 如果决策真的简单（选 ESLint 规则），确实不需要 ADR
  - ADR 只记录"重要"的决策：数据库选型、架构模式、安全策略
  - 判断标准："如果三个月后有人问'为什么这样做'，你能马上回答吗？"
```

**阻力 3："没人会去看 ADR"**

```
应对：
  - 在 Code Review 流程中集成 ADR 检查
  - 新人入职时将 ADR 作为学习材料
  - 在技术讨论中引用 ADR："这个和 ADR-003 的决策冲突"
```

### 6.2 渐进式采纳方案

**阶段 1：种子期（第 1-2 周）**

```
- Tech Lead 创建 5-10 个回顾性 ADR，记录现有架构的关键决策
- 在团队会议上介绍 ADR 概念
- 在项目中创建 docs/adr/ 目录
```

**阶段 2：试点期（第 3-4 周）**

```
- 每个技术讨论的结论都尝试写成 ADR
- Code Review 中提醒创建 ADR（不强制）
- 收集反馈，调整模板
```

**阶段 3：制度化（第 5 周起）**

```
- 架构相关的 PR 必须附带 ADR
- ADR 作为技术方案评审的必要产出
- 新人入职培训包含 ADR 学习
```

### 6.3 什么样的决策需要写 ADR？

```
需要写 ADR 的决策：
  ✅ 数据库选型（MySQL vs PostgreSQL）
  ✅ 架构模式（微服务 vs 单体）
  ✅ 缓存策略（Redis vs Memcached）
  ✅ API 设计规范（REST vs GraphQL）
  ✅ 认证方案（JWT vs Session）
  ✅ 部署策略（K8s vs ECS）
  ✅ 安全策略（加密算法选择）
  ✅ 第三方服务选型（支付、短信、邮件）

不需要写 ADR 的决策：
  ❌ 代码格式规范（用 linter 就行）
  ❌ 变量命名规范
  ❌ 日志级别选择
  ❌ 包的小版本升级
  ❌ Bug 修复的技术方案
```

---

## 七、ADR 与其他实践的结合

### 7.1 ADR + RFC（Request For Comments）

RFC 适合需要广泛讨论的决策，ADR 适合记录最终结论：

```
流程：
  1. 创建 RFC 文档，描述方案，开放讨论
  2. 团队讨论、评审、修改
  3. 达成共识后，将结论写成 ADR
  4. ADR 状态设为 Accepted
  5. RFC 可以归档或删除
```

### 7.2 ADR + Design Review

在设计评审会议中使用 ADR：

```
会前：
  - 提议者创建 ADR 草稿（状态：Proposed）
  - 分享给团队预审

会中：
  - 讨论 ADR 中的选项和利弊
  - 投票/共识

会后：
  - 更新 ADR 状态为 Accepted 或 Rejected
  - 提交到仓库
```

### 7.3 ADR + Architecture Review Board

大型组织的架构评审委员会（ARB）可以使用 ADR 作为标准化的评审文档：

```
流程：
  1. 架构师提交 ADR 到 ARB 评审队列
  2. ARB 成员异步审查 ADR
  3. 必要时召开评审会议
  4. 批准/拒绝/要求修改
  5. ADR 状态更新，记录评审意见
```

---

## 八、实战案例：用 ADR 管理电商平台的架构演进

### 8.1 ADR 索引示例

```
docs/adr/
├── 0001-选择-laravel-作为后端框架.md          (Accepted)
├── 0002-选择-mysql-作为主数据库.md            (Superseded by ADR-018)
├── 0003-选择-redis-作为缓存和队列驱动.md       (Accepted)
├── 0004-api-版本策略采用-url-路径方式.md       (Accepted)
├── 0005-采用-repository-pattern.md            (Accepted)
├── 0006-选择-docker-compose-作为本地开发环境.md (Accepted)
├── 0007-认证方案选择-jwt.md                   (Accepted)
├── 0008-选择-stripe-作为支付网关.md            (Accepted)
├── 0009-日志聚合采用-elk-stack.md             (Superseded by ADR-015)
├── 0010-采用-github-actions-作为-ci-cd.md     (Accepted)
├── 0011-选择-cloudflare-作为-cdn.md           (Accepted)
├── 0012-数据库分库分表策略.md                  (Accepted)
├── 0013-选择-kubernetes-作为容器编排平台.md     (Accepted)
├── 0014-采用-istio-服务网格.md                (Rejected)
├── 0015-日志聚合从-elk-迁移到-grafana-loki.md  (Accepted)
├── 0016-采用-feature-flag-支持-trunk-based.md (Accepted)
├── 0017-引入-ai-agent-客服系统.md             (Proposed)
├── 0018-主数据库从-mysql-迁移到-postgresql.md  (Accepted)
└── README.md
```

### 8.2 ADR-018 案例分析

```markdown
# ADR-018: 主数据库从 MySQL 迁移到 PostgreSQL

日期：2026-05-20
状态：Accepted
替代：ADR-002

## 背景

随着业务增长，我们在 MySQL 上遇到了以下挑战：

1. **JSON 查询性能**：商品属性、用户偏好等 JSON 字段的查询性能差，
   MySQL 8.0 的 JSON 函数仍然不够灵活
2. **全文搜索**：MySQL 的全文搜索功能有限，我们不得不引入 Elasticsearch
3. **地理空间查询**：门店定位功能需要 PostGIS 的支持
4. **复杂查询**：报表系统中的复杂 SQL 需要 CTE、窗口函数等高级特性，
   MySQL 8.0 的支持不够完善
5. **扩展性**：MySQL 的扩展选项有限（分库分表复杂），PostgreSQL 的
   逻辑复制和分区表更灵活

## 决策驱动因素

- JSONB 原生支持和 GIN 索引
- 地理空间扩展（PostGIS）
- 更强的 SQL 标准支持（CTE, Window Functions, MERGE）
- 逻辑复制支持在线迁移
- 社区活跃，生态完善
- Laravel Eloquent 对 PostgreSQL 的支持成熟

## 考虑的选项

### 选项 1：继续优化 MySQL

在 MySQL 8.0 上优化 JSON 查询，使用 Generated Columns 加索引。

- 优点：无需迁移，零风险
- 缺点：治标不治本，地理空间需求无法满足

### 选项 2：迁移到 PostgreSQL

将主数据库迁移到 PostgreSQL 16。

- 优点：一次性解决所有痛点
- 缺点：迁移有风险，团队需要学习

### 选项 3：MySQL + 专项数据库组合

OLTP 用 MySQL，JSON 查询用 MongoDB，地理空间用 PostGIS。

- 优点：各取所长
- 缺点：运维复杂度大增，数据同步困难

## 决策

我们选择 **选项 2：迁移到 PostgreSQL 16**。

迁移计划分三阶段：
1. **双写期**（4 周）：同时写入 MySQL 和 PostgreSQL，读取仍走 MySQL
2. **灰度期**（4 周）：逐步将读流量切换到 PostgreSQL（10% → 50% → 100%）
3. **单写期**（2 周）：只写入 PostgreSQL，MySQL 作为备份
4. **下线 MySQL**（2 周）：确认无问题后下线 MySQL

## 后果

### 正面后果

- JSONB 查询性能提升 10x
- 无需单独的 Elasticsearch 服务（全文搜索用 PostgreSQL）
- 地理空间查询原生支持
- 为未来的分析需求提供更好的基础

### 负面后果

- 迁移周期约 3 个月
- 团队需要学习 PostgreSQL 的运维知识
- 部分 MySQL 特有语法需要改写
- 暂时增加了运维成本（双数据库并行）

### 风险

- **风险**：迁移期间数据不一致
  **缓解**：使用逻辑复制 + 校验脚本，每小时比对一次数据
- **风险**：性能回退
  **缓解**：灰度期使用真实流量对比，保留快速回滚能力

## 相关决策

- ADR-002: 选择 MySQL 作为主数据库（已被本决策替代）
- ADR-012: 数据库分库分表策略（PostgreSQL 的分区表可以替代）
- ADR-015: 日志聚合从 ELK 迁移到 Grafana Loki

## 参考资料

- [PostgreSQL 16 Release Notes](https://www.postgresql.org/docs/16/release-16.html)
- [Laravel PostgreSQL Best Practices](https://laravel.com/docs/database)
- [MySQL to PostgreSQL Migration Guide](https://wiki.postgresql.org/wiki/Converting_from_other_Databases)
```

---

## 九、最佳实践总结

### 9.1 写作规范

```
✅ 用第一人称复数："我们决定..."（体现团队共识）
✅ 描述背景和约束，不要只写结论
✅ 列出所有认真考虑过的选项（包括被拒绝的）
✅ 明确记录负面后果和风险（不要只写好处）
✅ ADR 一旦接受就不再修改，需要变更就创建新 ADR
✅ 每个 ADR 都有明确的状态和日期
```

### 9.2 流程规范

```
✅ 架构相关 PR 必须检查是否需要 ADR
✅ ADR 通过 Code Review 评审后才能 Accepted
✅ 新人入职时学习现有 ADR 了解架构演进
✅ 定期回顾过期的 ADR，标记为 Deprecated 或 Superseded
✅ ADR 仓库放在代码仓库中，和代码一起版本管理
```

### 9.3 团队文化

```
✅ 鼓励记录"失败的决策"（Rejected ADR 同样有价值）
✅ ADR 是"轻量级"的，不要让它变成官僚主义
✅ 技术讨论中引用 ADR："这和 ADR-003 冲突"
✅ 把 ADR 当作团队的"技术记忆"
```

---

## 总结

ADR 不是一个复杂的文档系统——它是一个**极简的决策记录习惯**。一个 Markdown 文件，回答四个问题（背景、选项、决策、后果），提交到 Git，和代码一起管理。

但这个简单的习惯带来的价值是巨大的：

1. **知识传承**：新人可以通过 ADR 快速理解架构演进历史
2. **避免重复讨论**：已经有了决策记录，不需要重新辩论
3. **提高决策质量**：知道需要写 ADR，会促使更深入地思考选项
4. **可追溯性**：任何时候都可以查到"为什么这样做"
5. **团队共识**：ADR 的评审过程本身就是达成共识的过程

**今天就开始记录你的第一个 ADR 吧。**

## 相关阅读

- [Tech Lead 实战：从 Senior Engineer 到 Tech Lead 的角色跃迁——架构决策、Code Review 与团队赋能](/categories/架构/Tech-Lead-实战-从Senior-Engineer到Tech-Lead角色跃迁/)
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/categories/架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/)
- [OpenClaw 文档漂移问题剖析：IDENTITY.md/MEMORY.md/MODEL_STRATEGY.md 不一致的根因与治理](/categories/架构/OpenClaw-文档漂移问题剖析-IDENTITY-MEMORY-MODEL-STRATEGY-不一致的根因与治理/)

---

*参考资源：*
- [Michael Nygard - Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [MADR - Markdown Any Decision Records](https://adr.github.io/madr/)
- [adr-tools](https://github.com/npryce/adr-tools)
- [Log4brains](https://github.com/thomvaill/log4brains)
- [ThoughtWorks Technology Radar - ADRs](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records)
