---

title: PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 的组合拳——从代码风格到架构规范的 CI
keywords: [PR Review Checklist, Danger.js, lint, staged, Husky, CI, 自动化实战, 的组合拳, 从代码风格到架构规范的]
date: 2026-06-06 10:00:00
tags:
- danger.js
- lint-staged
- husky
- pr review
- CI/CD
categories:
- devops
description: 深入实战 Husky + lint-staged + Danger.js 组合拳，构建从代码风格到架构规范的多层 CI 门禁体系。涵盖 pre-commit/pre-push/commit-msg 三层 Git Hooks 配置、lint-staged 增量检查与自动修复、Danger.js PR 元数据智能校验（标题格式、描述模板、Jira Ticket 关联、UI 截图验证、测试覆盖门禁、架构约束检查），以及 GitHub Actions/GitLab CI 完整集成方案、monorepo 适配、Fork PR 权限处理等 6 大真实踩坑案例与团队渐进式落地策略。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



# PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 的组合拳——从代码风格到架构规范的 CI 门禁

## 前言：为什么你的 PR Review 总是在"无效沟通"中消耗

你是否经历过这样的场景？

一个简单的 Bug Fix PR，Reviewer 花了 20 分钟在评论区指出"这里少了个分号"、"缩进不对"、"commit message 格式错了"。某个 PR 改了 3000 行代码，Reviewer 只看了最后 50 行就点了 Approve。PR 描述里写的是"fix bug"，既没有关联 Jira Ticket，也没有截图证明修复效果。合并后发现某个模块的架构约束被违反了——比如 domain 层直接依赖了 framework 层的实现。

这些问题的根源不是 Reviewer 不认真，而是**我们将太多本应自动化的检查任务，留给了人工 Review**。在软件工程实践中，代码审查（Code Review）一直被认为是提升代码质量最有效的手段之一。然而，当审查者把大量的时间和精力消耗在机械性的格式检查上时，真正需要人类智慧判断的部分——比如业务逻辑的正确性、系统架构的合理性、以及代码可维护性的深层考量——反而被严重挤压。

更糟糕的是，这类机械性检查往往存在极大的主观性和不一致性。不同的 Reviewer 可能有不同的偏好：有人喜欢单引号，有人喜欢双引号；有人要求每个 PR 都要有详细的测试说明，有人觉得只要看到测试代码就够了。这种不确定性不仅浪费了提交者和审查者双方的时间，还容易引发团队内部的摩擦和不满。

本文将深入讲解如何用 **Husky + lint-staged + Danger.js** 构建一套从代码风格到架构规范的多层 CI 门禁，让人工 Review 回归真正的价值——业务逻辑与架构设计的讨论。这不是一篇泛泛而谈的入门教程，而是基于我在多个中大型团队中实际落地这套方案的真实经验，包含了大量的踩坑记录、性能优化技巧和团队推广策略。

---

## 一、PR Review Checklist 自动化的三层模型

在深入工具细节之前，我们先建立一个认知框架。PR Review 中的检查项可以按照执行位置和检查深度分为三层。理解这个分层模型是设计自动化门禁的基础。

### 1.1 L1 层：代码风格层

代码风格层是最基础的一层，它涵盖了缩进、分号使用、引号选择、import 排序、尾部逗号等纯粹的格式问题。这些问题的特点是规则明确、可自动化修复、不存在歧义。它们适合在开发者本地提交代码时就进行拦截，因为这类检查的执行速度极快（通常在秒级以内），而且可以自动修复大部分问题。

这一层对应的主要工具包括 ESLint（用于 JavaScript/TypeScript 代码风格检查和质量检查）、Prettier（用于通用代码格式化）、PHP-CS-Fixer（用于 PHP 代码风格检查和修复）、以及 Stylelint（用于 CSS/SCSS 的样式规则检查）。

### 1.2 L2 层：代码质量层

代码质量层比风格层更深一步，它关注的是代码的正确性和健壮性。这一层包括 TypeScript 类型检查、代码复杂度阈值、禁止使用的模式（如 `console.log`、`eval`、`any` 类型等）、测试覆盖率要求、以及依赖版本安全检查等。

这一层的检查通常需要更多的时间和计算资源，因此不适合放在 pre-commit 阶段（否则会严重影响开发者的提交效率）。更好的做法是放在 pre-push 阶段或者 CI 流水线中执行。pre-push 阶段执行增量检查（只检查本次推送中变更的文件），CI 阶段执行全量检查。

### 1.3 L3 层：PR 流程规范层

PR 流程规范层是最高层次的检查，它关注的是 PR 本身的规范性和完整性。这一层的检查无法通过静态分析工具完成，因为它需要访问 PR 的元数据——标题、描述、标签、关联的 Issue、文件变更统计等。这就是 Danger.js 发挥作用的舞台。

这一层的典型检查项包括：PR 标题是否符合 Conventional Commits 规范、PR 描述是否足够详细、是否关联了 Jira 或 Linear 的工单、是否包含了 UI 变更的截图、代码变更量是否超过阈值需要拆分、新增代码是否有对应的测试覆盖、以及是否违反了项目的架构规范等。

### 1.4 分层总结

| 层级 | 检查内容 | 工具 | 执行时机 | 速度 |
|------|---------|------|---------|------|
| **L1: 代码风格层** | 缩进、分号、引号、import 排序、格式化 | ESLint、Prettier、PHP-CS-Fixer | pre-commit（本地） | < 3 秒 |
| **L2: 代码质量层** | 类型检查、复杂度阈值、禁止模式、测试覆盖 | TypeScript、custom rules、Rector | pre-push（本地）+ CI | < 30 秒 |
| **L3: PR 流程规范层** | PR 标题格式、描述模板、Ticket 关联、截图检查 | Danger.js | CI（远程） | < 10 秒 |

这三层从左到右，成本递增但价值也递增。本地的 L1/L2 能在开发者提交代码前就拦截大部分问题，而 L3 在 CI 中执行，确保 PR 级别的规范性。关键的设计原则是：**越轻量的检查越早执行，越重量的检查越晚执行**。这样既能保证开发者的工作流不被频繁打断，又能确保代码质量的全面覆盖。

---

## 二、Husky 的安装与 Git Hooks 配置

[Husky](https://typicode.github.io/husky/) 是目前最流行的 Git Hooks 管理工具。它的核心价值在于将 Git Hooks 的配置变成项目代码的一部分（而不是每个开发者本地 `.git/hooks/` 目录下的脚本），通过 `npm install` 或 `pnpm install` 自动安装，确保团队中的每一个人在克隆仓库后都能获得一致的 Hooks 配置。

### 2.1 安装与初始化

```bash
# 安装 Husky
pnpm add -D husky

# 初始化（会创建 .husky/ 目录和相关配置）
npx husky init
```

执行 `npx husky init` 后，项目根目录下会创建 `.husky/` 目录，同时 `package.json` 会自动添加 `prepare` 脚本：

```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

`prepare` 脚本是一个 npm 生命周期钩子，它会在 `npm install` / `pnpm install` 之后自动执行。这意味着当团队成员克隆仓库并安装依赖时，Husky 会自动配置好所有 Git Hooks，无需任何额外的手动操作。这是 Husky 相比手动编写 Git Hooks 脚本的最大优势之一。

### 2.2 配置 pre-commit Hook

pre-commit Hook 是整个门禁体系的第一道防线，它在开发者执行 `git commit` 时触发。在这个阶段，我们运行 lint-staged 来对暂存区的文件进行增量检查和自动修复。

`.husky/pre-commit` 文件的内容非常简洁：

```bash
npx lint-staged
```

就这么简单。Husky 9.x 的设计哲学发生了重大变化——hook 文件本质上就是一个普通的 shell 脚本，不再需要使用旧版本中的 `husky add` 命令来创建。你只需要在 `.husky/` 目录下创建对应名称的文件，写入要执行的命令即可。

### 2.3 配置 commit-msg Hook

commit-msg Hook 在开发者编写完 commit message 之后、正式创建 commit 之前触发。它的主要用途是强制 commit message 的格式规范。我们使用 [commitlint](https://commitlint.js.org/) 这个工具来实现。

首先安装依赖：

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

然后创建 `commitlint.config.js` 配置文件：

```js
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 类型必须是以下枚举值之一
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // Bug 修复
        'docs',     // 文档变更
        'style',    // 代码风格（不影响功能）
        'refactor', // 重构（既不修复 Bug 也不添加功能）
        'perf',     // 性能优化
        'test',     // 添加或修改测试
        'build',    // 构建系统或外部依赖变更
        'ci',       // CI 配置变更
        'chore',    // 杂项（不修改 src 或 test 文件）
        'revert',   // 回滚之前的 commit
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],     // 类型必须小写
    'type-empty': [2, 'never'],                    // 类型不能为空
    'subject-empty': [2, 'never'],                 // 描述不能为空
    'subject-full-stop': [2, 'never', '.'],        // 描述末尾不能有句号
    'header-max-length': [2, 'always', 100],       // header 最长 100 字符
    'body-max-line-length': [1, 'always', 200],    // body 每行最长 200 字符
    'body-leading-blank': [2, 'always'],           // body 前必须有空行
    'footer-leading-blank': [1, 'always'],         // footer 前必须有空行
  },
};
```

配置中的数字含义：`0` 表示禁用，`1` 表示警告（warn），`2` 表示错误（error，会阻断 commit）。在初始阶段，你可以将一些规则设为 `1`（警告），待团队适应后再逐步升级为 `2`。

`.husky/commit-msg` 文件：

```bash
npx --no -- commitlint --edit ${1}
```

这里的 `${1}` 是 Git 传给 hook 脚本的参数，即 commit message 文件的路径。`--edit` 参数告诉 commitlint 从该文件读取 commit message 内容。

### 2.4 配置 pre-push Hook

pre-push Hook 在开发者执行 `git push` 时触发。由于推送操作不像提交那样频繁，我们可以在这个阶段执行一些更重量级的检查，比如 TypeScript 类型检查和增量单元测试。

`.husky/pre-push` 文件：

```bash
npx tsc --noEmit
npx vitest run --changed
```

`npx tsc --noEmit` 执行 TypeScript 编译检查但不输出编译产物，只报告类型错误。`npx vitest run --changed` 运行 Vitest 测试框架，`--changed` 参数让它只运行与已修改文件相关的测试用例，避免全量测试带来的长时间等待。

**关键设计决策**：pre-commit 要快（目标 < 3 秒），pre-push 可以稍慢（目标 < 30 秒），CI 可以更慢（分钟级）。这个时间梯度确保开发者的工作流不会被频繁打断。如果 pre-push 检查耗时超过 30 秒，开发者会感到明显的不耐烦，此时应该考虑将部分检查移到 CI 阶段。

### 2.5 完整的 Hook 配置结构

```
.husky/
├── pre-commit        # lint-staged 增量检查（ESLint + Prettier + PHP-CS-Fixer）
├── commit-msg        # commitlint 格式校验（Conventional Commits）
└── pre-push          # TypeScript 类型检查 + 增量单元测试
```

**一个重要提醒**：虽然 Husky 提供了完善的 Hook 机制，但开发者仍然可以通过 `git commit --no-verify` 或 `git push --no-verify` 跳过这些检查。这是一个设计上的"逃生通道"，用于紧急 hotfix 等特殊场景。但团队应该建立明确的规范：使用 `--no-verify` 后必须在后续的 PR 中补充修复所有被跳过的检查。

---

## 三、lint-staged 的配置：增量检查的艺术

[lint-staged](https://github.com/lint-staged/lint-staged) 的核心理念是**只检查本次提交中改动的文件**。相比全量扫描整个项目，增量检查有几个显著优势：速度快（通常在 1-3 秒内完成）、对开发者友好（不会因为别人的遗留问题阻断自己的提交）、以及更容易集成到 Git 工作流中。

### 3.1 基础配置：ESLint + Prettier

最常见也最推荐的做法是在 `package.json` 中直接配置，或者使用独立的 `.lintstagedrc.js` 文件（当配置变得复杂时，独立文件更易维护）：

```js
// .lintstagedrc.js
module.exports = {
  // TypeScript / JavaScript 文件：先 ESLint 修复，再 Prettier 格式化
  '*.{ts,tsx,js,jsx}': [
    'eslint --fix --max-warnings 0',
    'prettier --write',
  ],

  // JSON / YAML / Markdown：仅 Prettier 格式化
  '*.{json,yaml,yml,md}': [
    'prettier --write',
  ],

  // CSS / SCSS / Less：Prettier + Stylelint
  '*.{css,scss,less}': [
    'prettier --write',
    'stylelint --fix',
  ],

  // package.json：排序依赖字段
  'package.json': [
    'prettier --write',
    'sort-package-json',
  ],
};
```

`--max-warnings 0` 是一个非常重要的参数。它告诉 ESLint 将所有 warning 视为 error 来处理。如果没有这个参数，ESLint 的 warning 只会显示但不会阻断执行，随着时间推移，项目中的 warning 会越积越多，最终变成"背景噪音"而被所有人忽略。

### 3.2 进阶配置：PHP-CS-Fixer + Rector

对于全栈项目，尤其是 PHP + JavaScript 混合的项目，lint-staged 的配置需要覆盖多种语言。以下是一个同时处理 JS/TS 和 PHP 文件的配置示例：

```js
// .lintstagedrc.js
module.exports = {
  // JavaScript / TypeScript
  '*.{ts,tsx,js,jsx}': [
    'eslint --fix --max-warnings 0',
    'prettier --write',
  ],

  // PHP 文件：代码风格修复 + 自动重构
  '*.php': [
    // 第一步：PHP-CS-Fixer 修复代码风格（PSR-12 + 自定义规则）
    'php-cs-fixer fix --config=.php-cs-fixer.dist.php --allow-risky=yes',
    // 第二步：Rector 自动重构（如数组语法统一、废弃 API 替换、类型声明补全）
    'rector process --config=rector.php',
  ],

  // 通用格式化
  '*.{json,yaml,yml,md,css,scss}': [
    'prettier --write',
  ],
};
```

这里有两个 PHP 工具需要特别说明。PHP-CS-Fixer 是 PHP 社区最流行的代码风格修复工具，类似于 JavaScript 世界的 Prettier + ESLint 的结合体。它支持 PSR-12、Symfony、Laravel 等多种编码规范，并且可以通过 `--allow-risky=yes` 开启一些有风险但有用的修复规则（比如将 `array()` 语法替换为 `[]` 短语法）。

Rector 则是一个更强大的工具，它不仅能修复代码风格，还能进行语义级别的自动重构。比如将旧版本的 PHP 语法升级到新版本（PHP 7.x → 8.x）、移除死代码、统一数组函数调用方式等。它使用 AST（抽象语法树）分析代码，比简单的正则匹配更加精准和安全。

### 3.3 Rector 配置示例

`rector.php` 配置文件展示了如何用 Rector 做架构级别的自动重构：

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Set\ValueObject\SetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/src',
        __DIR__ . '/app',
    ])
    ->withSkip([
        __DIR__ . '/src/Legacy',      // 跳过遗留代码目录
        __DIR__ . '/src/*/Generated',  // 跳过自动生成的代码
    ])
    ->withSets([
        // PHP 版本升级规则（从 PHP 7.4 升级到 PHP 8.3 语法）
        LevelSetList::UP_TO_PHP_83,
        // 代码质量改进规则
        SetList::CODE_QUALITY,
        // 命名规范规则（如变量名语义化）
        SetList::NAMING,
        // 移除死代码规则
        SetList::DEAD_CODE,
    ])
    ->withImportNames()       // 自动优化 import 语句
    ->withPhpSets(php83: true);
```

### 3.4 lint-staged 的高级特性

**并发控制与执行顺序**：默认情况下，lint-staged 会并发运行不同 glob 匹配的任务。但同一 glob 下的多个命令是串行执行的，前一个命令的文件修改会传递给下一个命令。如果需要在不同 glob 之间建立依赖关系，可以使用函数形式：

```js
module.exports = {
  '*.{ts,tsx}': [
    'eslint --fix',
    // eslint 修改完文件后，再交给 prettier 格式化
    (filenames) => `prettier --write ${filenames.join(' ')}`,
  ],
};
```

**处理大量文件**：当暂存区中的文件数量非常多时，可能会遇到命令行参数长度限制（"Argument list too long" 错误）。此时需要分批处理：

```js
module.exports = {
  '*.php': [
    (filenames) => {
      const batchSize = 50;
      const commands = [];
      for (let i = 0; i < filenames.length; i += batchSize) {
        const batch = filenames.slice(i, i + batchSize);
        commands.push(
          `php-cs-fixer fix ${batch.join(' ')} --allow-risky=yes`
        );
      }
      return commands;
    },
  ],
};
```

**与 lint-staged 配合的 debug 模式**：当配置出现问题时，可以通过设置环境变量来查看 lint-staged 的详细执行日志：

```bash
# 开启 debug 模式
npx lint-staged --debug

# 或者通过环境变量
DEBUG=lint-staged:* npx lint-staged
```

这在排查"为什么某个文件没有被检查"或"为什么自动修复没有生效"等问题时非常有用。

---

## 四、Danger.js 的深度使用：PR 级别的智能门禁

如果说 Husky + lint-staged 是"本地守门员"，那么 [Danger.js](https://danger.systems/js/) 就是"CI 裁判"。它运行在 CI 流水线中，可以访问 PR 的所有元数据——标题、描述、标签、文件变更列表、新增/删除行数、分支名称等，是实现 PR 流程规范自动化的终极利器。

Danger.js 的工作原理是：在 CI 环境中，通过环境变量获取 PR 的上下文信息（如 GitHub Token、PR 编号等），然后执行开发者编写的 `dangerfile.ts`（或 `dangerfile.js`）脚本。脚本中通过 Danger.js 提供的 API 来检查 PR 的各项属性，并通过 `fail()`、`warn()`、`message()`、`markdown()` 等函数输出检查结果。这些结果会自动以评论的形式发布到 PR 页面上，让所有参与者都能看到。

### 4.1 安装与基础配置

```bash
pnpm add -D danger
```

在项目根目录创建 `dangerfile.ts`（推荐使用 TypeScript 以获得类型提示）：

```typescript
// dangerfile.ts
import { danger, warn, fail, message, markdown } from 'danger';
```

### 4.2 PR 标题格式检查

PR 标题是代码变更的第一张名片。一个规范的 PR 标题应该能够让人一眼看出这次变更的类型、影响范围和简要描述。我们使用 Conventional Commits 规范来约束 PR 标题格式：

```typescript
// dangerfile.ts

// Conventional Commits 格式正则表达式
const PR_TITLE_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?!?: .{1,80}/;

const checkPRTitle = () => {
  const title = danger.github.pr.title;

  if (!PR_TITLE_REGEX.test(title)) {
    fail(
      `❌ **PR 标题格式不符合 Conventional Commits 规范。**\n\n` +
      `当前标题：\`${title}\`\n\n` +
      `期望格式：\`type(scope): description\`\n\n` +
      `允许的 type：\n` +
      `- \`feat\`：新功能\n` +
      `- \`fix\`：Bug 修复\n` +
      `- \`docs\`：文档变更\n` +
      `- \`style\`：代码风格（不影响功能）\n` +
      `- \`refactor\`：重构\n` +
      `- \`perf\`：性能优化\n` +
      `- \`test\`：测试\n` +
      `- \`build\`：构建系统\n` +
      `- \`ci\`：CI 配置\n` +
      `- \`chore\`：杂项\n\n` +
      `示例：\`feat(auth): add OAuth2 login support\``
    );
  }

  // 检查标题长度
  if (title.length > 80) {
    warn(
      `⚠️ PR 标题过长（${title.length} 字符），建议控制在 80 字符以内，以便在 Git log 和 GitHub UI 中完整显示。`
    );
  }
};

checkPRTitle();
```

### 4.3 代码变更量告警

大型 PR 是代码质量的天敌。Google 的工程实践研究表明，当 PR 超过 400 行代码后，Review 的效果会急剧下降——Reviewers 开始遗漏问题，审查时间反而变得更长（因为需要反复来回理解上下文）。因此，我们需要在 CI 层面设置变更量的告警和限制：

```typescript
const checkPRSize = () => {
  const additions = danger.github.pr.additions;
  const deletions = danger.github.pr.deletions;
  const linesOfCode = additions + deletions;

  if (linesOfCode > 1000) {
    fail(
      `🚨 **超大 PR**：本次变更 ${linesOfCode} 行代码（+${additions} / -${deletions}）。\n\n` +
      `研究表明，超过 400 行的 PR Review 质量会显著下降。\n` +
      `请将本次变更拆分为多个小 PR，每个 PR 聚焦于单一的关注点（Single Responsibility）。`
    );
  } else if (linesOfCode > 500) {
    warn(
      `⚠️ **大 PR**：本次变更 ${linesOfCode} 行代码（+${additions} / -${deletions}）。\n` +
      `请确认是否可以拆分为更小的 PR。`
    );
  }

  // 文件数量检查
  const changedFiles =
    danger.git.modified_files.length +
    danger.git.created_files.length +
    danger.git.deleted_files.length;

  if (changedFiles > 30) {
    warn(
      `⚠️ 本次 PR 修改了 ${changedFiles} 个文件。` +
      `文件数量过多可能影响 Review 质量，请检查是否引入了无关变更。`
    );
  }

  // 删除大量代码的提示
  if (deletions > 200 && deletions > additions * 2) {
    message(
      `ℹ️ 本次 PR 删除了 ${deletions} 行代码（新增 ${additions} 行）。` +
      `大量删除通常是好事（清理遗留代码），请在 PR 描述中说明删除原因。`
    );
  }
};

checkPRSize();
```

### 4.4 Jira / Linear Ticket 关联验证

在企业级项目中，每个代码变更都应该能追溯到具体的业务需求或 Bug 工单。这种可追溯性不仅有助于项目管理，还能在出现问题时快速定位变更的上下文。Danger.js 可以自动检查 PR 是否关联了 Jira 或 Linear 的工单：

```typescript
const checkTicketLink = () => {
  const prBody = danger.github.pr.body || '';
  const branchName = danger.github.pr.head.ref;
  const title = danger.github.pr.title;

  // 从分支名、标题、描述中提取 Jira Ticket ID
  // Jira Ticket 格式通常是 PROJECT-123（大写字母 + 横线 + 数字）
  const jiraRegex = /[A-Z][A-Z0-9]+-\d+/g;

  const jiraTicketsFromBranch = branchName.match(jiraRegex) || [];
  const jiraTicketsFromTitle = title.match(jiraRegex) || [];
  const jiraTicketsFromBody = prBody.match(jiraRegex) || [];

  // 合并去重
  const allTickets = new Set([
    ...jiraTicketsFromBranch,
    ...jiraTicketsFromTitle,
    ...jiraTicketsFromBody,
  ]);

  if (allTickets.size === 0) {
    fail(
      `❌ **未找到关联的 Jira Ticket。**\n\n` +
      `请在以下位置之一添加 Ticket ID：\n` +
      `- 分支名：\`feature/PROJ-123-add-login\`\n` +
      `- PR 标题：\`feat(auth): add login (PROJ-123)\`\n` +
      `- PR 描述中包含 Ticket 链接\n\n` +
      `每个 PR 都应该关联一个工单，以确保变更可追溯。`
    );
  } else {
    const ticketList = [...allTickets].map(t => `\`${t}\``).join(', ');
    message(`🔗 关联的工单: ${ticketList}`);
  }

  // 检查 Linear 链接（如果团队使用 Linear 而非 Jira）
  const linearRegex = /linear\.app\/[a-z-]+\/issue\/[a-z0-9-]+/i;
  if (!prBody.match(linearRegex) && allTickets.size === 0) {
    warn(
      `⚠️ 未找到 Linear issue 链接。如果团队使用 Linear 管理工单，请在 PR 描述中添加链接。`
    );
  }
};

checkTicketLink();
```

### 4.5 PR 描述模板检查与截图验证

一份好的 PR 描述应该包含四要素：What（做了什么）、Why（为什么做）、How（怎么实现的）、Testing（如何测试）。对于包含 UI 变更的 PR，还应该附带变更前后的截图：

```typescript
const checkPRDescription = () => {
  const body = danger.github.pr.body || '';
  const minLength = 50;

  // 描述长度检查
  if (body.trim().length < minLength) {
    fail(
      `❌ **PR 描述过于简短**（当前 ${body.trim().length} 字符，最少需要 ${minLength} 字符）。\n\n` +
      `一份好的 PR 描述应包含：\n` +
      `1. **What**：这个 PR 做了什么？\n` +
      `2. **Why**：为什么要做这个改动？关联的业务需求是什么？\n` +
      `3. **How**：技术实现方式是什么？有哪些关键设计决策？\n` +
      `4. **Testing**：如何验证这个改动是正确的？截图/录屏？`
    );
  }

  // 检测是否包含截图
  const hasImage =
    /!\[.*\]\(.*\)/.test(body) ||  // Markdown 图片语法
    /<img\s/.test(body) ||          // HTML img 标签
    /!\[.*\]\[.*\]/.test(body);     // Markdown 引用式图片

  // 检测是否修改了 UI 相关文件
  const uiFilePatterns = [
    /\.vue$/,
    /\.tsx$/,
    /\.jsx$/,
    /\.scss$/,
    /\.css$/,
    /\.less$/,
    /components?\//i,
    /views?\//i,
    /pages?\//i,
    /layouts?\//i,
    /templates?\//i,
  ];

  const modifiedFiles = [
    ...danger.git.modified_files,
    ...danger.git.created_files,
  ];

  const hasUIChanges = modifiedFiles.some(file =>
    uiFilePatterns.some(pattern => pattern.test(file))
  );

  if (hasUIChanges && !hasImage) {
    warn(
      `⚠️ **本次 PR 包含 UI 相关文件的变更**（${modifiedFiles.filter(f =>
        uiFilePatterns.some(p => p.test(f))
      ).length} 个文件），但 PR 描述中未包含截图。\n\n` +
      `请添加变更前后的截图或 GIF 录屏，方便 Reviewer 理解视觉效果的变化。` +
      `推荐使用 [CleanShot X](https://cleanshot.com/) 或 [Kap](https://getkap.co/) 进行截图和录屏。`
    );
  }
};

checkPRDescription();
```

### 4.6 测试覆盖门禁

测试是代码质量的最后一道防线。Danger.js 可以通过分析文件变更列表来判断新增代码是否有对应的测试覆盖：

```typescript
const checkTestCoverage = () => {
  // 获取修改和新增的源文件（排除测试文件自身）
  const modifiedSource = danger.git.modified_files.filter(
    f =>
      /^src\/.*\.(ts|tsx|js|jsx|php)$/.test(f) &&
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('__tests__')
  );

  // 获取修改和新增的测试文件
  const modifiedTests = danger.git.modified_files.filter(
    f =>
      /\.(test|spec)\.(ts|tsx|js|jsx|php)$/.test(f) ||
      /__tests__\//.test(f) ||
      /tests?\//i.test(f)
  );

  // 新增的源文件（排除测试文件）
  const createdSource = danger.git.created_files.filter(
    f =>
      /^src\/.*\.(ts|tsx|js|jsx|php)$/.test(f) &&
      !f.includes('.test.') &&
      !f.includes('.spec.')
  );

  // 硬性规则：新增源文件必须有测试
  if (createdSource.length > 0 && modifiedTests.length === 0) {
    fail(
      `❌ **新增了 ${createdSource.length} 个源文件，但没有新增或修改任何测试文件。**\n\n` +
      `新增的文件：\n${createdSource.map(f => `- \`${f}\``).join('\n')}\n\n` +
      `请为新增代码编写对应的单元测试。如果代码不需要测试（如纯配置文件），请在 PR 描述中说明原因。`
    );
  }

  // 软性规则：修改较多源文件时提示
  if (modifiedSource.length > 5 && modifiedTests.length === 0) {
    warn(
      `⚠️ 修改了 ${modifiedSource.length} 个源文件，但没有修改测试文件。\n` +
      `如果本次变更影响了现有行为（修改了函数签名、改变了条件逻辑等），请更新对应的测试用例。`
    );
  }

  // 检测删除了测试但保留了源代码的情况
  const deletedTests = danger.git.deleted_files.filter(
    f => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f)
  );
  if (deletedTests.length > 0) {
    warn(
      `⚠️ 本次 PR 删除了 ${deletedTests.length} 个测试文件。请确认这是有意为之（如重构测试结构）而非误删。`
    );
  }
};

checkTestCoverage();
```

### 4.7 架构规范门禁

这是整套 Danger.js 配置中最有深度的部分——在 CI 层面强制执行项目的架构约束。传统的架构规范检查依赖人工 Review 和文档描述，但这些规范很容易被遗忘或忽视。通过 Danger.js，我们可以将架构规范转化为可执行的代码：

```typescript
const checkArchitectureRules = async () => {
  const allModified = [
    ...danger.git.modified_files,
    ...danger.git.created_files,
  ];

  // ===== 规则 1: Domain 层不应依赖 Infrastructure/Framework 层 =====
  // 这是六边形架构（Hexagonal Architecture）或整洁架构（Clean Architecture）的核心原则
  const domainFiles = allModified.filter(f => /^src\/domain\//.test(f));

  for (const file of domainFiles) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) continue;

    const addedLines = diff.added.split('\n');

    // 检测是否引入了 Infrastructure 层的依赖
    const hasInfraImport = addedLines.some(
      line =>
        /import.*from\s+['"].*\/(infrastructure|framework|vendor|adapter)\//i.test(line) ||
        /use\s+App\\(Infrastructure|Framework|Adapter)/i.test(line) ||
        /require\(.*\/(infrastructure|framework)\//i.test(line)
    );

    if (hasInfraImport) {
      fail(
        `🏗️ **架构违规**：\`${file}\` 属于 Domain 层，但引入了 Infrastructure/Framework 层的依赖。\n\n` +
        `根据依赖反转原则（Dependency Inversion Principle），Domain 层应该是架构的核心，` +
        `不应直接依赖外部实现。请使用接口抽象或依赖注入来解耦。`
      );
    }
  }

  // ===== 规则 2: Controller 不应包含复杂业务逻辑 =====
  const controllerFiles = allModified.filter(
    f => /controllers?\//i.test(f) || /Controller\.(ts|php)$/i.test(f)
  );

  for (const file of controllerFiles) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) continue;

    const addedLines = diff.added.split('\n');

    // 统计新增代码中的条件/循环语句数量
    const conditionCount = addedLines.filter(l =>
      /^\+.*(if|switch|for|while|try)\s*[\({]/.test(l)
    ).length;

    if (conditionCount > 10) {
      warn(
        `⚠️ \`${file}\`（Controller）新增了 ${conditionCount} 个条件/循环/异常处理语句。\n` +
        `Controller 应该只负责接收请求、调用 Service、返回响应。` +
        `业务逻辑应下沉到 Service/UseCase/Application 层。`
      );
    }

    // 检测直接数据库操作
    const hasDirectDBAccess = addedLines.some(
      line =>
        /\.(query|execute|raw)\s*\(/i.test(line) ||
        /DB::(table|raw|select|insert|update|delete)/i.test(line) ||
        /\$pdo->/i.test(line) ||
        /EntityManager::/i.test(line)
    );

    if (hasDirectDBAccess) {
      fail(
        `🏗️ **架构违规**：\`${file}\`（Controller）中包含直接数据库操作。\n` +
        `数据库访问必须通过 Repository/DAO 层封装。`
      );
    }
  }

  // ===== 规则 3: 检测非 Repository 文件中的数据库操作 =====
  const nonRepoFiles = allModified.filter(
    f =>
      !/repositor(y|ies)\/|dao\/|mapper\/|gateway\//i.test(f) &&
      /^src\/.*\.(ts|js|php)$/.test(f) &&
      !/model\/entity/i.test(f)
  );

  for (const file of nonRepoFiles) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) continue;

    const hasDirectDBAccess = diff.added.split('\n').some(
      line =>
        /\.(query|execute|raw)\s*\(/i.test(line) ||
        /DB::/i.test(line) ||
        /\$pdo->/i.test(line) ||
        /SELECT\s+.*FROM/i.test(line)
    );

    if (hasDirectDBAccess) {
      warn(
        `⚠️ \`${file}\` 中疑似包含直接数据库操作。\n` +
        `数据库访问应通过 Repository/DAO 层封装，遵循数据访问层抽象原则。`
      );
    }
  }

  // ===== 规则 4: 检测新增的外部依赖 =====
  const packageJsonModified = allModified.includes('package.json') ||
    allModified.includes('composer.json');

  if (packageJsonModified) {
    // 检查是否修改了 lock 文件
    const lockFileModified = allModified.some(f =>
      /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock/.test(f)
    );

    if (!lockFileModified) {
      warn(
        `⚠️ 检测到 \`package.json\` 或 \`composer.json\` 被修改，但没有更新对应的 lock 文件。\n` +
        `新增依赖时请一并提交 lock 文件，以确保团队成员获得一致的依赖版本。`
      );
    }

    message(
      `📦 本次 PR 修改了依赖配置文件。请确认：\n` +
      `- 新增的依赖是否有安全漏洞（运行 \`npm audit\` 或 \`composer audit\`）\n` +
      `- 新增的依赖是否在项目允许的许可证范围内\n` +
      `- 是否有更轻量的替代方案`
    );
  }
};

checkArchitectureRules();
```

### 4.8 禁止模式扫描

除了架构规范，还有一些常见的代码质量问题可以通过 Danger.js 来检测：

```typescript
const checkForbiddenPatterns = async () => {
  // 定义禁止模式及其对应的提示信息
  const forbiddenPatterns = [
    {
      pattern: /console\.(log|debug|info)\s*\(/,
      message: '请移除 `console.log`，使用项目统一的 Logger 工具。',
      severity: 'fail' as const,
    },
    {
      pattern: /@ts-ignore|@ts-nocheck/,
      message: '请修复类型问题而非使用 `@ts-ignore`。如果是第三方库的类型问题，请使用 `@ts-expect-error` 并添加说明。',
      severity: 'warn' as const,
    },
    {
      pattern: /as any\b/,
      message: '请尽量避免使用 `any` 类型。如果确实需要，请添加注释说明原因。',
      severity: 'warn' as const,
    },
    {
      pattern: /eval\s*\(/,
      message: '禁止使用 `eval()`，存在严重的安全风险。',
      severity: 'fail' as const,
    },
    {
      pattern: /\.only\(/,
      message: '请移除 `.only()`（`test.only`、`describe.only`、`it.only`），这会导致其他测试被跳过。',
      severity: 'fail' as const,
    },
    {
      pattern: /TODO|FIXME|HACK|XXX/,
      message: '检测到 TODO/FIXME/HACK 注释。如果是已知的技术债务，请关联对应的 Jira Ticket。',
      severity: 'warn' as const,
    },
  ];

  for (const file of danger.git.modified_files) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) continue;

    for (const { pattern, message, severity } of forbiddenPatterns) {
      const violations = diff.added
        .split('\n')
        .filter(line => pattern.test(line));

      if (violations.length > 0) {
        const fn = severity === 'fail' ? fail : warn;
        fn(`🚫 \`${file}\`：${message}（检测到 ${violations.length} 处违规）`);
      }
    }
  }
};

checkForbiddenPatterns();
```

### 4.9 完整的 dangerfile.ts 组装

将上述所有检查模块组织成一个结构清晰的完整配置文件：

```typescript
// dangerfile.ts
import { danger, warn, fail, message, markdown } from 'danger';

// ============================================================
// 配置常量 - 根据团队实际情况调整
// ============================================================
const CONFIG = {
  maxLinesOfCode: 1000,          // 硬性限制：超过则 fail
  warnLinesOfCode: 500,          // 软性限制：超过则 warn
  maxFilesChanged: 30,           // 文件数量告警阈值
  minDescriptionLength: 50,      // PR 描述最短字符数
  maxControllerConditions: 10,   // Controller 中最大条件语句数
  ticketRegex: /[A-Z][A-Z0-9]+-\d+/g,  // Jira Ticket 正则
};

// ============================================================
// 工具函数
// ============================================================
const getModifiedUIFiles = (): string[] => {
  const uiPatterns = [/\.vue$/, /\.tsx$/, /\.jsx$/, /\.scss$/, /\.css$/, /components?\//i, /views?\//i, /pages?\//i];
  const allFiles = [...danger.git.modified_files, ...danger.git.created_files];
  return allFiles.filter(f => uiPatterns.some(p => p.test(f)));
};

// ============================================================
// L3-A: PR 元数据检查
// ============================================================
async function checkPRMetadata() {
  const titleRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?!?: .{1,80}/;

  // 标题检查
  if (!titleRegex.test(danger.github.pr.title)) {
    fail(`❌ PR 标题不符合 Conventional Commits 规范: \`${danger.github.pr.title}\``);
  }

  // 变更量检查
  const loc = danger.github.pr.additions + danger.github.pr.deletions;
  if (loc > CONFIG.maxLinesOfCode) {
    fail(`🚨 超大 PR（${loc} 行），请拆分为多个小 PR。`);
  } else if (loc > CONFIG.warnLinesOfCode) {
    warn(`⚠️ 大 PR（${loc} 行），建议拆分。`);
  }

  // Ticket 关联
  const branch = danger.github.pr.head.ref;
  const body = danger.github.pr.body || '';
  const tickets = new Set([
    ...(branch.match(CONFIG.ticketRegex) || []),
    ...(danger.github.pr.title.match(CONFIG.ticketRegex) || []),
    ...(body.match(CONFIG.ticketRegex) || []),
  ]);
  if (tickets.size === 0) {
    fail('❌ 未关联 Jira/Linear Ticket。');
  } else {
    message(`🔗 关联工单: ${[...tickets].map(t => `\`${t}\``).join(', ')}`);
  }

  // 描述检查
  if (body.trim().length < CONFIG.minDescriptionLength) {
    fail(`❌ PR 描述过短（${body.trim().length} 字符，最少 ${CONFIG.minDescriptionLength}）。`);
  }
}

// ============================================================
// L3-B: 代码质量门禁
// ============================================================
async function checkCodeQuality() {
  // 测试覆盖
  const srcFiles = danger.git.created_files.filter(
    f => /^src\/.*\.(ts|tsx)$/.test(f) && !f.includes('.test.') && !f.includes('.spec.')
  );
  const testFiles = danger.git.modified_files.filter(
    f => /\.(test|spec)\.(ts|tsx)$/.test(f) || /__tests__\//.test(f)
  );
  if (srcFiles.length > 0 && testFiles.length === 0) {
    fail(`❌ 新增了 ${srcFiles.length} 个源文件但无测试覆盖。`);
  }

  // 禁止模式扫描
  const forbidden = [
    { pattern: /console\.(log|debug)\s*\(/, msg: '请移除 console.log', severity: 'fail' as const },
    { pattern: /@ts-ignore/, msg: '请修复类型问题而非使用 @ts-ignore', severity: 'warn' as const },
    { pattern: /\.only\(/, msg: '请移除 .only()', severity: 'fail' as const },
    { pattern: /eval\s*\(/, msg: '禁止使用 eval()', severity: 'fail' as const },
  ];

  for (const file of danger.git.modified_files) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) continue;
    for (const { pattern, msg, severity } of forbidden) {
      const hits = diff.added.split('\n').filter(l => pattern.test(l));
      if (hits.length > 0) {
        (severity === 'fail' ? fail : warn)(`🚫 \`${file}\`: ${msg}（${hits.length} 处）`);
      }
    }
  }
}

// ============================================================
// L3-C: UI 截图检查
// ============================================================
async function checkUIScreenshots() {
  const hasUIChanges = getModifiedUIFiles().length > 0;
  const body = danger.github.pr.body || '';
  const hasScreenshot = /!\[.*\]\(.*\)|<img|screenshot|截图/i.test(body);

  if (hasUIChanges && !hasScreenshot) {
    warn('⚠️ 包含 UI 变更但 PR 描述中未附截图/录屏。');
  }
}

// ============================================================
// 执行
// ============================================================
(async () => {
  await checkPRMetadata();
  await checkCodeQuality();
  await checkUIScreenshots();

  const totalFiles = danger.git.modified_files.length + danger.git.created_files.length;
  markdown(
    `---\n### 📊 PR Review 自动化检查完成\n` +
    `- 📁 文件数: ${totalFiles}\n` +
    `- 📝 变更: +${danger.github.pr.additions} / -${danger.github.pr.deletions}\n`
  );
})();
```

---

## 五、与 GitHub Actions / GitLab CI 的集成

### 5.1 GitHub Actions 集成

创建 `.github/workflows/pr-review.yml`，这是最完整的配置示例：

```yaml
name: PR Review Checklist

on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

# Danger.js 需要向 PR 发表评论的权限
permissions:
  pull-requests: write
  contents: read

jobs:
  # ---- 第一层：JavaScript/TypeScript 代码质量 ----
  lint-js:
    name: JS/TS Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: ESLint
        run: pnpm eslint . --max-warnings 0

      - name: Prettier Check
        run: pnpm prettier --check .

      - name: TypeScript Type Check
        run: pnpm tsc --noEmit

  # ---- 第二层：测试 ----
  test:
    name: Unit Tests & Coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Tests with Coverage
        run: pnpm vitest run --coverage

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  # ---- 第二层（PHP）：代码质量 ----
  lint-php:
    name: PHP Quality Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer, php-cs-fixer, rector

      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist

      - name: PHP-CS-Fixer (dry-run)
        run: php-cs-fixer fix --dry-run --diff --allow-risky=yes

      - name: Rector (dry-run)
        run: rector process --dry-run

      - name: PHPStan
        run: vendor/bin/phpstan analyse --level=8

  # ---- 第三层：Danger.js PR 规范检查 ----
  danger:
    name: Danger.js PR Review
    needs: [lint-js, test, lint-php]
    if: always() && !cancelled()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Danger.js
        run: npx danger ci
        env:
          DANGER_GITHUB_API_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

注意 Danger.js job 使用了 `needs: [lint-js, test, lint-php]` 和 `if: always() && !cancelled()` 的组合。这意味着 Danger.js 会在所有前置 job 完成后运行（包括失败的情况），确保即使代码风格检查失败，PR 规范检查的结果也能被展示出来。

### 5.2 GitLab CI 集成

```yaml
stages:
  - lint
  - test
  - review

variables:
  DANGER_GITLAB_API_TOKEN: $GITLAB_TOKEN

lint-javascript:
  stage: lint
  image: node:20-slim
  before_script:
    - corepack enable
    - pnpm install --frozen-lockfile
  script:
    - pnpm eslint . --max-warnings 0
    - pnpm prettier --check .
    - pnpm tsc --noEmit
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

lint-php:
  stage: lint
  image: php:8.3-cli
  before_script:
    - composer install --no-interaction --prefer-dist
  script:
    - vendor/bin/php-cs-fixer fix --dry-run --diff
    - vendor/bin/rector process --dry-run
    - vendor/bin/phpstan analyse --level=8
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

test:
  stage: test
  image: node:20-slim
  before_script:
    - corepack enable
    - pnpm install --frozen-lockfile
  script:
    - pnpm vitest run --coverage
  coverage: '/All files[^|]*\|[^|]*\s+([\d.]+)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

danger-review:
  stage: review
  image: node:20-slim
  needs: ["lint-javascript", "lint-php", "test"]
  before_script:
    - corepack enable
    - pnpm install --frozen-lockfile
  script:
    - npx danger ci --failOnErrors
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  allow_failure: false
```

---

## 六、多层门禁设计的整体架构

将前面所有内容整合，形成一个完整的从本地到远程的门禁体系：

```
┌──────────────────────────────────────────────────────────┐
│                      CI Server                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  L3: Danger.js (PR 流程规范)                        │  │
│  │  • 标题/描述/截图/Ticket 关联检查                     │  │
│  │  • 变更量告警与拆分建议                               │  │
│  │  • 架构约束检查（Domain/Controller/Repository）        │  │
│  │  • 禁止模式扫描（console.log、eval、@ts-ignore）      │  │
│  │  • 外部依赖变更检查                                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  L2: 质量门禁 (CI 全量检查)                          │  │
│  │  • TypeScript 类型检查                               │  │
│  │  • 单元测试 + 覆盖率统计                              │  │
│  │  • PHPStan / Rector --dry-run                        │  │
│  │  • npm audit / composer audit 安全扫描                │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                   Developer Local Machine                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  L2: pre-push (增量质量检查)                         │  │
│  │  • tsc --noEmit (类型检查)                           │  │
│  │  • vitest run --changed (增量测试)                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  L1: pre-commit / commit-msg (增量风格检查)          │  │
│  │  • ESLint --fix (JS/TS 代码质量)                     │  │
│  │  • Prettier --write (通用格式化)                      │  │
│  │  • PHP-CS-Fixer (PHP 代码风格)                       │  │
│  │  • Rector (PHP 自动重构)                              │  │
│  │  • commitlint (Commit 消息格式)                       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

这套体系遵循了几个核心设计原则：

**快速失败原则（Fail Fast）**：最轻量的检查最先执行，最重量级的检查最后执行。一个简单的分号问题不需要等到 CI 跑完 5 分钟后才被发现，它应该在本地 `git commit` 的瞬间就被自动修复。

**幂等安全原则**：lint-staged 的 `--fix` 操作必须是幂等的——多次运行结果一致。这确保了即使开发者反复提交，修复结果也不会出现抖动。

**渐进严格原则**：初期所有规则使用 `warn` 级别，观察一到两周团队的反馈和数据分布后，再逐步将高频且无误报的规则升级为 `fail`。这种渐进式的方式能有效降低团队的抵触情绪。

**明确的逃生通道**：提供 `--no-verify` 的文档说明和审批流程。紧急 hotfix 场景下允许跳过本地检查，但必须在后续 PR 中补充修复。

---

## 七、团队推广策略和渐进式落地经验

工具再好，推不动就是零。以下是我在三个不同规模的团队中推广这套方案的实战经验总结。每个团队的技术栈、工程文化和人员构成不同，推广策略也需要因地制宜。

### 7.1 分阶段落地路线图

```
Phase 1 (第 1-2 周): 基础设施搭建
├── 安装 Husky + lint-staged + commitlint
├── 仅对增量文件生效（lint-staged 默认行为）
├── 全部使用 warn 级别，不阻断任何工作流
├── 确保 CI 环境兼容（HUSKY=0 跳过 CI 中的 hooks）
└── 输出：团队成员首次体验"提交时自动格式化"

Phase 2 (第 3-4 周): 代码风格强制
├── ESLint --fix + Prettier 自动修复成为标准
├── commitlint 升级为 error 级别
├── 新增文件必须有测试覆盖（warn → fail）
├── 提供一键格式化脚本（pnpm format）
└── 输出：代码风格统一，commit message 规范化

Phase 3 (第 2 个月): Danger.js 入场
├── PR 标题/描述检查（初始为 warn）
├── 变更量告警（warn，收集数据）
├── Ticket 关联检查（fail，因为这是硬性需求）
├── 截图检查（warn，针对 UI 变更）
└── 输出：PR 质量可见性提升

Phase 4 (第 3 个月+): 逐步收紧与架构门禁
├── Danger.js 规则从 warn 逐步升级为 fail
├── 架构约束检查上线（Domain/Controller/Repository 规则）
├── 测试覆盖率门禁（如覆盖率不低于 80%）
├── Rector 自动重构规则（PHP 项目）
├── 定期 review 规则有效性
└── 输出：自动化门禁成为团队的默认工作方式
```

### 7.2 降低团队抵触的关键策略

**策略一：先自动修复，再人工检查**。开发者不会因为"忘记加分号"而被阻断提交——工具会帮他自动加上。只有那些无法自动修复的逻辑性问题（如使用了未定义变量、引入了架构违规的依赖）才会真正阻断工作流。这种"工具帮你做事"而非"工具挑你毛病"的心态差异，是推广成功的关键。

**策略二：提供一键格式化命令**。在 `package.json` 中提供方便的脚本，让开发者可以随时格式化整个项目：

```json
{
  "scripts": {
    "format": "prettier --write . && eslint --fix .",
    "format:staged": "lint-staged",
    "check": "prettier --check . && eslint . --max-warnings 0",
    "prepare": "husky"
  }
}
```

**策略三：使用 PR 模板引导而非强制**。创建 `.github/pull_request_template.md`：

```markdown
## What（做了什么）
<!-- 简要描述本次变更的内容 -->

## Why（为什么做）
<!-- 为什么要做这个改动？关联了什么业务需求或技术债务？ -->

## How（怎么做）
<!-- 技术实现方式、关键设计决策、影响范围 -->

## Testing（如何测试）
<!-- 测试方式、截图/录屏、手动测试步骤 -->

## Checklist
- [ ] 本地 lint 和测试通过
- [ ] 新增代码有测试覆盖
- [ ] 无 console.log / debug 残留代码
- [ ] Jira Ticket: PROJ-___
```

**策略四：数据驱动的规则调整**。上线一个月后，统计 Danger.js 的 `warn` 和 `fail` 分布，找出高频触发的规则。对于误报率高的规则，要么调整正则表达式，要么降级为 `message`（信息提示，不显示为警告）。对于从未触发的规则，评估是否有保留的必要。

---

## 八、真实踩坑记录和最佳实践

### 踩坑 1：Husky 在 Docker 和 CI 环境中误触发

**问题**：CI 流水线中的 `git commit` 操作（如自动生成 changelog 的 commit）触发了 Husky hooks，导致找不到 lint-staged 等工具而报错。

**解决**：在 CI 环境中设置环境变量 `HUSKY=0` 来跳过所有 hooks：

```yaml
# GitHub Actions 中
- name: Auto Commit
  run: git commit -m "chore: update changelog"
  env:
    HUSKY: 0
```

或者在 `prepare` 脚本中做容错处理：

```json
{
  "scripts": {
    "prepare": "husky || true"
  }
}
```

更优雅的做法是在 `.husky/` 目录下的 hook 脚本开头检查环境：

```bash
# .husky/pre-commit
if [ "$HUSKY" = "0" ]; then
  exit 0
fi
npx lint-staged
```

### 踩坑 2：lint-staged 在 monorepo 中的行为不符合预期

**问题**：monorepo 中，lint-staged 默认根据当前工作目录来匹配文件。如果你从子包目录运行 `git commit`，lint-staged 的 glob 匹配可能不会命中预期的文件。

**解决**：使用根目录级别的 lint-staged 配置，配合路径映射函数：

```js
// 根目录 .lintstagedrc.js
const path = require('path');

module.exports = {
  'packages/frontend/**/*.{ts,tsx}': (filenames) => {
    const relativeFiles = filenames.map(f =>
      path.relative(path.join(process.cwd(), 'packages/frontend'), f)
    );
    return [
      `pnpm --filter @myapp/frontend eslint --fix ${relativeFiles.join(' ')}`,
    ];
  },
  'packages/backend/**/*.php': (filenames) => [
    `php-cs-fixer fix ${filenames.join(' ')} --allow-risky=yes`,
  ],
};
```

### 踩坑 3：Danger.js 的 `danger.git.diffForFile` 在二进制文件上崩溃

**问题**：当 PR 中包含图片、字体等二进制文件时，`danger.git.diffForFile()` 会返回 null 或抛出异常，导致整个 Danger.js 脚本中断。

**解决**：编写安全的 diff 获取函数：

```typescript
const safeDiffForFile = async (file: string) => {
  try {
    const diff = await danger.git.diffForFile(file);
    return diff;
  } catch (error) {
    // 跳过二进制文件或无法 diff 的文件
    console.warn(`无法获取 ${file} 的 diff，跳过检查`);
    return null;
  }
};
```

### 踩坑 4：commitlint 与 Merge Commit 冲突

**问题**：GitHub 在合并 PR 时自动生成的 Merge Commit 消息格式为 `Merge branch 'feature/xxx' into main`，不符合 Conventional Commits 规范，导致 commitlint 报错。

**解决**：在 commitlint 配置中忽略特定模式的 commit message：

```js
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    (message) => message.startsWith('Merge'),
    (message) => message.startsWith('Revert'),
    (message) => /^WIP/i.test(message),       // 允许 WIP 提交（用于本地开发）
  ],
  // ... 其他规则
};
```

### 踩坑 5：Prettier 和 ESLint 规则冲突导致无限修复循环

**问题**：ESLint 的格式化规则（如 `indent`、`semi`、`quotes`）与 Prettier 的格式化规则不一致，导致 ESLint 修复一种格式，Prettier 又改回另一种格式，陷入无限循环。

**解决**：使用 `eslint-config-prettier` 禁用所有与 Prettier 冲突的 ESLint 格式规则：

```js
// eslint.config.js（ESLint flat config 格式）
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  // ... 其他 ESLint 配置（推荐规则、TypeScript 规则等）
  eslintConfigPrettier,  // 必须放在最后，覆盖所有格式化相关的规则
];
```

### 踩坑 6：Danger.js 在 Fork PR 上无权限评论

**问题**：当外部贡献者从 Fork 仓库提交 PR 时，`GITHUB_TOKEN` 的权限受限，Danger.js 无法向 PR 发表评论。

**解决**：这是 GitHub Actions 的安全机制限制。可以使用 `pull_request_target` 事件替代 `pull_request`，但需要注意安全风险（`pull_request_target` 会以目标仓库的权限运行，如果处理不当可能泄露 secrets）。更安全的做法是使用 `workflow_run` 事件来分步执行，或者使用 Personal Access Token（PAT）：

```yaml
on:
  pull_request_target:
    types: [opened, edited, synchronize]

jobs:
  danger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      # ... 安装依赖 ...
      - name: Run Danger
        run: npx danger ci
        env:
          DANGER_GITHUB_API_TOKEN: ${{ secrets.DANGER_PAT }}
```

### 最佳实践总结

经过多个团队的实践验证，以下是最关键的几条最佳实践：

**pre-commit 要快**：目标 < 3 秒。只做增量 lint + format，绝不做类型检查和测试。开发者一天可能 commit 几十次，每次等待超过 3 秒就会产生明显的不耐烦。

**pre-push 做中等重量检查**：类型检查 + 增量测试，目标 < 30 秒。pre-push 的触发频率远低于 pre-commit，可以承担更多的检查任务。

**CI 做全量检查 + Danger.js**：全量测试 + 覆盖率统计 + PR 规范检查。CI 不受时间限制（几分钟内完成即可），应该做最全面的检查。

**Danger.js 规则渐进收紧**：先用 `warn` 级别上线，观察一到两个月团队的反馈和数据，确认没有误报后再升级为 `fail`。突然的规则收紧会引发团队的强烈抵触。

**为紧急场景提供绕过机制**：紧急 hotfix 时需要跳过某些检查，但必须有审批流程和事后修复的承诺。在 PR 模板中添加"本次 PR 使用了 --no-verify"的说明区域。

**定期审视规则的有效性**：每月花 30 分钟 review Danger.js 的规则配置，移除不再需要的检查，添加新的需求。规则应该随着团队的成熟度逐步演进。

**数据驱动优化**：统计 Danger.js 的 warn/fail 分布数据，找出高频问题，从源头改进（比如在 ESLint 配置中添加规则来提前拦截，而非等到 Danger.js 才发现）。

---

## 九、性能优化：让门禁不成为瓶颈

开发者最讨厌的莫过于"等 CI"。一个运行缓慢的门禁系统不仅会降低开发效率，还会让团队对自动化检查产生负面情绪。以下是几个经过验证的性能优化策略。

### 9.1 lint-staged 缓存

ESLint 和 Prettier 都支持文件级缓存，可以显著加速重复检查：

```json
{
  "scripts": {
    "lint": "eslint --cache --cache-location .eslintcache .",
    "format": "prettier --cache --write ."
  }
}
```

将 `.eslintcache` 添加到 `.gitignore` 中：

```gitignore
.eslintcache
*.tsbuildinfo
```

### 9.2 Danger.js 增量分析

只分析本次 PR 真正修改的文件，避免全量扫描：

```typescript
// 只分析修改的文件，跳过无关文件
const filesToAnalyze = [
  ...danger.git.modified_files,
  ...danger.git.created_files,
].filter(f => /\.(ts|tsx|php|js|jsx)$/.test(f));

// 不要对未修改的文件做任何检查
```

### 9.3 CI 并行化

将 lint、test、Danger.js 设计为并行执行的独立 job：

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    # ESLint, Prettier, PHP-CS-Fixer 并行执行

  test:
    runs-on: ubuntu-latest
    # 测试并行执行

  danger:
    needs: [lint, test]
    runs-on: ubuntu-latest
    # Danger.js 在 lint 和 test 完成后执行
```

通过 `needs` 关键字控制依赖关系，确保 Danger.js 能引用 lint 和 test 的结果。

### 9.4 本地全量检查的异步化

对于大型项目，可以在本地使用 Git hooks 的后台进程来异步执行全量检查：

```bash
# .husky/post-commit（异步执行，不阻断提交）
(
  npx tsc --noEmit 2>/dev/null && \
  npx vitest run --changed 2>/dev/null
) &
```

这样开发者在本地 commit 时不会被阻断，但如果发现问题，会在终端输出警告信息。

---

## 十、总结与展望

PR Review Checklist 自动化不是要取代人工 Review，而是**让人工 Review 回归高价值工作**。通过 Husky + lint-staged + Danger.js 的三层组合，我们可以构建一个从代码风格到架构规范的完整门禁体系：

| 工具 | 职责 | 执行位置 | 响应时间 |
|------|------|---------|---------|
| **Husky** | Git Hooks 管理框架 | 本地 | - |
| **lint-staged** | 增量代码风格自动修复 | 本地 pre-commit | 1-3 秒 |
| **commitlint** | Commit message 格式校验 | 本地 commit-msg | < 1 秒 |
| **TypeScript / Vitest** | 类型检查与增量测试 | 本地 pre-push + CI | 5-30 秒 |
| **Danger.js** | PR 流程规范智能检查 | CI | 3-10 秒 |

从今天开始，把那些"请检查格式"、"请关联 Ticket"、"请添加截图"、"这个 PR 太大了请拆分"的 Review 评论，统统交给机器来做。让代码 Review 回归到真正需要人类智慧的地方——业务逻辑的合理性、系统架构的前瞻性、以及代码可维护性的深层判断。

最终，一个好的自动化门禁体系应该像空气一样——平时你感觉不到它的存在，但当你违反规则时，它会温柔而坚定地提醒你。这就是工程自动化的最高境界：**不是约束，而是赋能**。

---

> **相关资源**
>
> - [Husky 官方文档](https://typicode.github.io/husky/)
> - [lint-staged GitHub 仓库](https://github.com/lint-staged/lint-staged)
> - [Danger.js 官方文档](https://danger.systems/js/)
> - [Conventional Commits 规范](https://www.conventionalcommits.org/)
> - [Rector PHP 自动重构工具](https://getrector.com/)
> - [commitlint 官方文档](https://commitlint.js.org/)
> - [Google Engineering Practices: Code Review](https://google.github.io/eng-practices/review/)

---

## 相关阅读

- [Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布](/categories/CI-CD/Conventional-Commits-Semantic-Release-实战-自动版本号-CHANGELOG生成与npm-Composer包发布/) — 本文 commitlint 所依赖的 Conventional Commits 规范的完整落地实践，配套 Semantic Release 实现版本号自动推算与 CHANGELOG 生成。
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI-CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) — 当 Danger.js 门禁规则在多个仓库中重复时，可以封装为可复用的 GitHub Actions 自定义 Action，本文详解 Composite Action、Reusable Workflow 与 Docker Action 的选型与封装。
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/categories/CI-CD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/) — 本文 CI 门禁中 lint/test job 的进阶方案，利用矩阵策略实现多 PHP 版本、多数据库的并行测试，进一步提升 CI 反馈速度。
