---

title: Git 高级用法实战：Rebase、Cherry-pick、Bisect、Worktree 踩坑记录
keywords: [Git, Rebase, Cherry, pick, Bisect, Worktree, 高级用法实战, 踩坑记录]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-16 18:30:46
updated: 2026-05-16 18:34:57
categories:
- engineering
- git
tags:
- Git
- rebase
- cherry-pick
- bisect
- Worktree
- 工程管理
description: Git 高级用法实战指南：深入讲解 rebase 保持线性历史、cherry-pick 跨分支移植 hotfix、bisect 二分法定位回归 Bug、worktree 多目录并行开发四大核心命令。涵盖交互式变基、cherry-pick merge commit 技巧、bisect 自动化脚本等 30+ 仓库真实踩坑经验，附 Rebase vs Merge 对比表。
---



# Git 高级用法实战：Rebase、Cherry-pick、Bisect、Worktree 踩坑记录

> 在管理 30+ 个 Laravel 仓库的日常中，我发现很多开发者对 Git 的使用停留在 `add → commit → push → pull`。但当你面对「需要把一个 hotfix 同时应用到 3 个环境分支」「生产出了 Bug 但不知道哪个 commit 引入的」「需要同时在 v2 和 v3 上开发」这些场景时，基础操作就不够用了。

本文基于 KKday B2C Backend Team 的真实项目经验，深入讲解四个高频但容易踩坑的 Git 高级用法。

---

## 整体架构：四个命令在开发流程中的位置

```
┌─────────────────────────────────────────────────────────┐
│                    Git 开发工作流                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Feature   │───→│  Rebase  │───→│   MR/PR  │          │
│  │ Branch    │    │ (线性化)  │    │  (合并)   │          │
│  └──────────┘    └──────────┘    └──────────┘          │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Hotfix    │───→│ Cherry-  │───→│ 多分支    │          │
│  │ Commit    │    │  pick    │    │ 同步修复   │          │
│  └──────────┘    └──────────┘    └──────────┘          │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ 生产 Bug  │───→│  Bisect  │───→│ 定位引入  │          │
│  │ 回归      │    │ (二分法)  │    │ 的 commit │          │
│  └──────────┘    └──────────┘    └──────────┘          │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ 多分支    │───→│ Worktree │───→│ 并行开发  │          │
│  │ 并行开发  │    │ (多目录)  │    │ 互不干扰   │          │
│  └──────────┘    └──────────┘    └──────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 一、Rebase：保持线性历史的利器

### 1.1 为什么用 Rebase 而非 Merge？

在我们的 Laravel B2C 项目中，一个典型的 feature 分支可能有 10-20 个 commit。如果用 `git merge`，会产生一个多余的 merge commit：

```
# Merge 方式（菱形历史）
*   Merge branch 'feature/order-export' into develop
|\
| * feat: add CSV export endpoint
| * feat: add export job
|/
* fix: pagination bug
```

```
# Rebase 方式（线性历史）
* feat: add CSV export endpoint
* feat: add export job
* fix: pagination bug
```

线性历史的好处：`git log --oneline` 一目了然，`git bisect` 更高效（后面会讲）。

### 1.2 实战操作

```bash
# 1. 切到 feature 分支
git checkout feature/order-export

# 2. Rebase 到最新的 develop
git rebase develop

# 3. 如果有冲突，解决后继续
git add .
git rebase --continue

# 4. 如果冲突太多想放弃
git rebase --abort

# 5. 强推到远端（因为 rebase 改写了历史）
git push --force-with-lease
```

### 1.3 ⚠️ 踩坑记录

**踩坑 1：Rebase 公共分支**

> 🚨 绝对不要对 `develop`/`main`/`release` 等公共分支执行 rebase！

我们团队曾有同事对 `develop` 执行了 rebase，导致其他人的本地分支全部冲突。修复方式：

```bash
# 其他人需要重新基于远端 develop
git fetch origin
git rebase origin/develop
```

**踩坑 2：`--force` vs `--force-with-lease`**

```bash
# ❌ 危险：强制覆盖远端
git push --force

# ✅ 安全：只有在远端没有新 commit 时才推送
git push --force-with-lease
```

`--force-with-lease` 会在远端有新提交时拒绝推送，避免覆盖队友的代码。

**踩坑 3：Rebase 后 Code Review 丢失**

在 GitLab/GitHub 上，如果 MR 已经开了一段时间，rebase 后所有的 review comment 都会变成 "outdated"。我们的做法：

```bash
# 只在 MR 最终合并前做一次 rebase，中间不要频繁 rebase
# 如果需要同步 develop，用 merge 更安全
git merge develop
```

**踩坑 4：Interactive Rebase 清理 commit**

```bash
# 合并最近 5 个 commit 为一个
git rebase -i HEAD~5

# 在编辑器中：
pick abc1234 feat: add export endpoint
squash def5678 fix: typo in export
squash ghi9012 fix: missing validation
squash jkl3456 test: add unit test
squash mno7890 fix: cs fixer

# 结果：1 个干净的 commit
# feat: add export endpoint with validation and tests
```

### 1.5 交互式 Rebase 完整操作流程

交互式 rebase 是 Git 最强大的历史重写工具。除了上面提到的 `squash`，还有 `fixup`、`edit`、`reword`、`drop` 等操作，每个都有独特用途。

#### 编辑器命令一览

```text
pick   abc1234 feat: add export     # 保留该 commit，不做修改
reword def5678 fix: typo             # 保留修改，但重新编辑 commit message
edit   ghi9012 feat: add filter      # 暂停在该 commit，允许修改代码或拆分
squash jkl3456 test: add test        # 合并到前一个 commit，保留该 commit message 供编辑
fixup  mno7890 fix: cs fixer         # 合并到前一个 commit，丢弃该 commit message
drop   pqr0123 chore: debug log      # 删除该 commit
```

`squash` 和 `fixup` 的区别非常关键：两者都会把当前 commit 合并到前一个，但 `squash` 会打开编辑器让你编辑合并后的 commit message，`fixup` 则直接丢弃当前 commit message。实际操作中，修复类 commit（typo fix、cs fixer）适合用 `fixup`，功能追加类 commit 适合用 `squash`。

#### 实战：squash + fixup 清理分支历史

假设 feature 分支的提交历史如下：

```bash
git log --oneline feature/order-export
# mno7890 fix: cs fixer
# jkl3456 chore: add dependency
# ghi9012 fix: typo in validation message
# def5678 test: add unit test for export
# abc1234 feat: add order CSV export
# 789abcd feat: add order filter model
# fed0123 WIP: start order export feature
```

运行交互式 rebase：

```bash
git rebase -i HEAD~7
```

在编辑器中这样安排：

```text
pick   fed0123 WIP: start order export feature
squash 789abcd feat: add order filter model
squash abc1234 feat: add order CSV export
fixup  ghi9012 fix: typo in validation message
fixup  mno7890 fix: cs fixer
pick   def5678 test: add unit test for export
pick   jkl3456 chore: add dependency
```

结果：7 个 commit 变成 3 个，历史变得非常干净：

```text
jkl3456 chore: add dependency
def5678 test: add unit test for export
xxxxxxx feat: add order CSV export with filter and validation
```

#### `--autosquash`：提前标记 fixup commit

开发过程中发现之前的 commit 有小问题，但不想中断当前工作。可以用 `fixup!` 前缀提前标记：

```bash
# 发现 commit abc1234 有 typo，直接提交 fixup
git commit -m "fixup! feat: add order CSV export" --only app/Services/ExportService.php

# 发现需要追加测试到 commit def5678
git commit -m "squash! test: add unit test for export" --only tests/ExportTest.php

# 交互式 rebase 时加上 --autosquash
git rebase -i HEAD~9 --autosquash

# Git 会自动将 fixup!/squash! 开头的 commit 排列到目标 commit 后面
# 无需手动调整顺序
```

先启用 autosquash 配置，这样每次 `rebase -i` 都会自动排序：

```bash
git config --global rebase.autosquash true
```

#### `edit`：暂停修改或拆分 commit

`edit` 命令让 rebase 暂停在指定 commit 处，你可以修改代码、修改 message，甚至拆分 commit：

```bash
# rebase -i 中标记某个 commit 为 edit
edit abc1234 feat: add order export with filters and validation

# rebase 会在这里暂停
# Stopped at abc1234... feat: add order export with filters and validation

# 查看当前状态
git status
# interactive rebase in progress; onto def5678

# 拆分这个 commit 为两个独立的 commit
git reset HEAD~1                    # 撤销该 commit，保留文件修改
git add app/Exports/
git commit -m "feat: add export service layer"
git add app/Http/Controllers/
git commit -m "feat: add export API endpoint"

# 继续 rebase
git rebase --continue
```

`edit` 的另一个用途是修改某个历史 commit 的 message：

```bash
# 在 rebase -i 中用 reword 标记
reword abc1234 feat: export

# Git 会打开编辑器，将 message 改为：
# feat: add order CSV export with date range filter
```

#### 完整工作流示例

```bash
# 开发过程中的典型工作流
# 1. 查看当前分支的 commit 情况
git log --oneline develop..feature/order-export

# 2. 启动交互式 rebase（基于 develop 的分叉点）
git rebase -i develop

# 3. 整理 commit（squash 修复类、fixup 小改动、reword 不清晰的 message）

# 4. Rebase 完成后，检查结果
git log --oneline feature/order-export

# 5. 强推（使用 --force-with-lease 保证安全）
git push --force-with-lease origin feature/order-export

# 6. 在 MR/PR 描述中说明 "rebased and squashed commits"
```

---

## 二、Cherry-pick：跨分支移植修复

### 2.1 典型场景

我们的项目有多个环境分支：

```
develop → staging → release → main
```

当 staging 发现一个 Bug，修复后需要同时应用到 develop 和 release：

```
         develop    staging    release
            |          |          |
            |     fix: hotfix    |
            |     (abc1234)      |
            |          |          |
cherry-pick ──────────→          |
            |          |          |
            |          └──────────→ cherry-pick
            |          |          |
```

### 2.2 实战操作

```bash
# 1. 在 staging 上修复并提交
git checkout staging
git commit -m "fix: order export timeout on large dataset"

# 记下 commit hash
# abc1234

# 2. Cherry-pick 到 develop
git checkout develop
git cherry-pick abc1234

# 3. Cherry-pick 到 release
git checkout release
git cherry-pick abc1234

# 4. 一次 cherry-pick 多个 commit
git cherry-pick abc1234..def5678  # 不包含 abc1234
git cherry-pick abc1234^..def5678 # 包含 abc1234

# 5. Cherry-pick 但不自动提交（可以修改）
git cherry-pick --no-commit abc1234
# 做一些调整
git commit -m "fix: order export timeout (adapted for release)"
```

### 2.3 ⚠️ 踩坑记录

**踩坑 1：Cherry-pick 后重复合并冲突**

这是最常见的坑。场景：

```bash
# 1. 在 feature 分支修复了 Bug
git checkout feature
git commit -m "fix: validation"  # abc1234

# 2. Cherry-pick 到 develop
git checkout develop
git cherry-pick abc1234  # def5678

# 3. 后来 feature 合并到 develop
git checkout develop
git merge feature
# 💥 冲突！因为同一个修改被应用了两次
```

解决方案：用 `-m` 标记或记录已 cherry-pick 的 commit：

```bash
# 在 commit message 中标记来源
git cherry-pick abc1234
# 修改 message 为：
# fix: validation (cherry-picked from feature/abc1234)
```

**踩坑 2：Cherry-pick Merge Commit**

```bash
# ❌ 直接 cherry-pick merge commit 会丢失一个分支的修改
git cherry-pick merge_commit_hash

# ✅ 指定 parent（通常 -m 1 表示保留主线）
git cherry-pick -m 1 merge_commit_hash
```

**踩坑 3：Cherry-pick 顺序问题**

如果要 cherry-pick 多个有依赖关系的 commit，必须按时间顺序：

```bash
# ❌ 乱序 cherry-pick
git cherry-pick def5678  # 后面的 commit
git cherry-pick abc1234  # 前面的 commit（可能冲突）

# ✅ 按顺序 cherry-pick
git cherry-pick abc1234 def5678
```

### 2.4 Cherry-pick 范围选择进阶

除了单个 commit，cherry-pick 支持多种范围选择方式，在批量同步修复时非常实用。

```bash
# 方式一：多个不连续的 commit
git cherry-pick abc1234 def5678 7890abc

# 方式二：连续范围（不含起始 commit）
git cherry-pick abc1234..def5678

# 方式三：连续范围（含起始 commit）
git cherry-pick abc1234^..def5678

# 方式四：基于分支名选择（该分支独有的 commit）
git cherry-pick develop..feature/hotfix
# 等价于 feature/hotfix 有但 develop 没有的所有 commit

# 方式五：选择某个 commit 但不自动提交（便于合并修改）
git cherry-pick --no-commit abc1234 def5678 7890abc
# 所有修改都在暂存区，可以一起提交
git commit -m "fix: batch hotfixes from staging"

# 方式六：从 stash 中 cherry-pick（特殊场景）
git stash
# ... 切换分支
git stash pop  # 这不是 cherry-pick，但类似效果
# 真正的做法：
git stash show -p | git apply   # 应用修改但不 commit
git commit -m "fix: from stash"
```

### 2.5 Cherry-pick 空提交问题

**踩坑 4：Cherry-pick 产生空提交**

当目标分支已经包含了要 cherry-pick 的修改（比如之前的 merge 带入了这些变更），cherry-pick 会产生空提交：

```bash
git cherry-pick abc1234
# The previous cherry-pick is now empty, possibly due to conflict resolution.
# If you wish to commit it anyway, use:
#     git commit --allow-empty
# Otherwise, please use 'git reset'

# 三种处理方式：

# 方式一：跳过空提交（最常用）
git cherry-pick --skip

# 方式二：强制提交空 commit（保留记录，用于追踪）
git commit --allow-empty -m "fix: order export (cherry-picked from staging, already applied)"

# 方式三：用 --allow-empty-message 配合 rebase 清理
git commit --allow-empty
git rebase -i HEAD~3  # 后续清理掉空 commit
```

**踩坑 5：Cherry-pick 后的重复 merge 冲突**

这是 cherry-pick 最常见的长期问题。完整场景还原：

```bash
# 1. 在 feature 分支修复了 Bug
git checkout feature/user-auth
git commit -m "fix: JWT token refresh"  # abc1234

# 2. 紧急情况，先 cherry-pick 到 develop
git checkout develop
git cherry-pick abc1234  # 产生 def5678（不同的 hash，相同的内容）

# 3. 过了一周，feature/user-auth 合并到 develop
git checkout develop
git merge feature/user-auth
# 💥 冲突！因为 JWT token refresh 这个修改被应用了两次
```

**解决方案与预防措施：**

```bash
# 方案 A：在 cherry-pick 时记录来源（推荐）
git cherry-pick abc1234
git commit --amend -m "fix: JWT token refresh (cherry-picked from feature/user-auth/abc1234)"
# 后续合并时 Git 的 rename detection 能更好地处理

# 方案 B：合并 feature 前先 rebase（推荐）
git checkout feature/user-auth
git rebase develop  # rebase 会自动跳过已存在于 develop 的 commit
git checkout develop
git merge feature/user-auth  # 不再冲突

# 方案 C：cherry-pick 后用 revert 对冲
# 如果合并时出现冲突，先 revert cherry-pick 的 commit
git revert def5678  # 撤销 cherry-pick 的修改
git merge feature/user-auth  # 再合并 feature（这次不会冲突）
```

---

## 三、Bisect：二分法定位回归 Bug

### 3.1 为什么需要 Bisect？

场景：「上周的订单导出功能还是好的，这周突然报 500 了。」

传统方式：一个个 commit 检查，30+ 个 commit 要查半天。

Bisect 方式：用二分法，30 个 commit 只需要 `log₂(30) ≈ 5` 次就能定位。

### 3.2 实战操作

```bash
# 1. 开始 bisect
git bisect start

# 2. 标记当前版本（有 Bug）为 bad
git bisect bad

# 3. 标记一个已知正常版本为 good
git bisect good v2.1.0

# Git 会自动 checkout 到中间的 commit
# Bisecting: 15 revisions left to test after this (roughly 4 steps)
# [abc1234] feat: add new filter

# 4. 测试当前版本
php artisan test --filter=OrderExportTest

# 5. 根据测试结果标记
git bisect good  # 这个 commit 没问题
# 或
git bisect bad   # 这个 commit 有问题

# 6. 重复 4-5 直到找到引入 Bug 的 commit
# 最终输出：
# abc1234 is the first bad commit
# commit abc1234
# Author: someone
# Date: ...
#
#     feat: add new filter (这里引入了 Bug)

# 7. 结束 bisect
git bisect reset
```

### 3.3 自动化 Bisect

更强大的用法：用脚本自动判断 good/bad：

```bash
# 创建测试脚本
cat > /tmp/test_export.sh << 'EOF'
#!/bin/bash
cd /path/to/project
php artisan test --filter=OrderExportTest 2>/dev/null
exit $?
EOF
chmod +x /tmp/test_export.sh

# 自动 bisect
git bisect start
git bisect bad HEAD
git bisect good v2.1.0
git bisect run /tmp/test_export.sh

# Git 会自动运行脚本，根据 exit code 判断 good(0) / bad(非0)
# 全自动定位到引入 Bug 的 commit
```

### 3.4 Bisect 高级自动化

#### 使用 `bisect run` 复杂脚本

上面的简单脚本只运行一个测试。实际项目中，bisect run 脚本可以做更复杂的判断：

```bash
#!/bin/bash
# save as: bisect_advanced.sh
# 支持多种判断条件的 bisect 脚本

set -o pipefail

COMMIT=$(git rev-parse --short HEAD)
echo "========================================="
echo "Testing commit: $COMMIT"
echo "Message: $(git log -1 --pretty=%s)"
echo "========================================="

# 检查 1：代码能否编译通过
echo "Step 1: Checking compilation..."
composer install --no-interaction --quiet 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️ SKIP - composer install failed"
    exit 125  # exit 125 = git bisect skip
fi

# 检查 2：运行特定测试
echo "Step 2: Running tests..."
php artisan test --filter=OrderExportTest 2>&1
TEST_RESULT=$?

if [ $TEST_RESULT -eq 0 ]; then
    echo "✅ GOOD"
    exit 0
else
    echo "❌ BAD"
    exit 1
fi
```

注意 `exit 125` 的特殊含义：告诉 Git 这个 commit 无法测试，等同于 `git bisect skip`。这在中间 commit 有语法错误或缺少依赖时非常有用。

#### `bisect run` 返回值约定

```text
exit 0    → good（测试通过）
exit 1-124, 126-127 → bad（测试失败）
exit 125  → skip（无法测试，跳过该 commit）
exit 128+ → bisect 终止（遇到致命错误）
```

#### 实战：定位 Laravel Migration 问题

```bash
#!/bin/bash
# bisect_migration.sh
# 定位哪个 commit 破坏了 database migration

set -o pipefail

# 每次测试前重置数据库
php artisan migrate:fresh --seed --quiet 2>/dev/null
if [ $? -ne 0 ]; then
    echo "❌ BAD - migration failed at $(git rev-parse --short HEAD)"
    exit 1
fi

# 运行依赖数据库的功能测试
php artisan test --filter=DatabaseTest 2>/dev/null
exit $?
```

```bash
# 使用
git bisect start
git bisect bad HEAD
git bisect good v3.0.0
git bisect run ./bisect_migration.sh

# 输出类似：
# Bisecting: 6 revisions left to test after this (roughly 3 steps)
# [abc1234] feat: add order status enum
# ❌ BAD - migration failed at abc1234
# Bisecting: 3 revisions left to test after this (roughly 2 steps)
# ...
# abc1234 is the first bad commit
```

#### 实战：用 bisect 定位性能回归

bisect 不仅能定位功能 Bug，还能定位性能回归：

```bash
#!/bin/bash
# bisect_perf.sh
# 定位哪个 commit 导致 API 响应变慢

RESPONSE_TIME=$(curl -o /dev/null -s -w "%{time_total}" http://localhost:8000/api/orders/export)
THRESHOLD=2.0  # 超过 2 秒视为 bad

echo "Response time: ${RESPONSE_TIME}s (threshold: ${THRESHOLD}s)"

# 用 awk 比较浮点数
IS_SLOW=$(echo "$RESPONSE_TIME $THRESHOLD" | awk '{print ($1 > $2) ? 1 : 0}')

if [ "$IS_SLOW" -eq 1 ]; then
    echo "❌ BAD - too slow"
    exit 1
else
    echo "✅ GOOD - within threshold"
    exit 0
fi
```

```bash
# 使用（需要先启动服务）
git bisect start
git bisect bad HEAD
git bisect good v2.5.0
git bisect run ./bisect_perf.sh
```

### 3.5 ⚠️ 踩坑记录

**踩坑 1：Bisect 中间版本无法运行**

有些 commit 可能处于「半成品」状态，代码编译不过或测试不完整：

```bash
# 跳过无法测试的 commit
git bisect skip
```

**踩坑 2：Bisect 期间的 uncommitted changes**

```bash
# ❌ bisect start 前没有 stash
git bisect start
# error: Your local changes would be overwritten

# ✅ 先 stash
git stash
git bisect start
# ... bisect 完成后
git bisect reset
git stash pop
```

**踩坑 3：Merge commit 干扰 Bisect**

如果历史中有大量 merge commit，bisect 可能会 checkout 到 merge commit 上，导致代码不完整：

```bash
# 只在非 merge commit 上 bisect
git bisect start --first-parent
```

**踩坑 4：Bisect 范围选错**

```bash
# ❌ 范围太大，浪费时间
git bisect good v1.0.0  # 1000 个 commit 前

# ✅ 用 git log 缩小范围
git log --oneline --since="2 weeks ago"
# 找到最近的 good 版本
git bisect good 2_weeks_ago_commit
```

---

## 四、Worktree：并行开发多分支

### 4.1 为什么需要 Worktree？

场景：你正在 `feature/order-export` 上开发，突然需要修一个 `hotfix/payment-bug`。

传统方式：

```bash
# ❌ 切换分支
git checkout hotfix/payment-bug
# 丢失当前工作上下文（IDE 重新索引、测试环境变化）
# 修完后再切回来
git checkout feature/order-export
# 可能需要重新 npm install / composer install
```

Worktree 方式：

```bash
# ✅ 在另一个目录 checkout hotfix
git worktree add ../hotfix-payment hotfix/payment-bug
# 两个目录同时工作，互不干扰
```

### 4.2 实战操作

```bash
# 1. 创建 worktree
git worktree add ../project-hotfix hotfix/payment-bug

# 2. 创建 worktree 并新建分支
git worktree add -b feature/new-api ../project-new-api

# 3. 查看所有 worktree
git worktree list
# /path/to/project              abc1234 [develop]
# /path/to/project-hotfix       def5678 [hotfix/payment-bug]
# /path/to/project-new-api      ghi9012 [feature/new-api]

# 4. 在 worktree 中工作
cd ../project-hotfix
# 正常 git 操作
git add .
git commit -m "fix: payment callback timeout"
git push

# 5. 删除 worktree
cd /path/to/project
git worktree remove ../project-hotfix

# 6. 清理已删除的 worktree 引用
git worktree prune
```

### 4.3 我的 Worktree 工作流

```
~/Projects/
├── mikeah2011.github.io/          # 主目录 (develop)
├── mikeah2011.github.io-hotfix/   # hotfix worktree
├── mikeah2011.github.io-v3/       # v3 开发 worktree
└── mikeah2011.github.io-review/   # Code Review 专用 worktree
```

```bash
# 快速切换别名（加入 ~/.zshrc）
alias gwa='git worktree add'
alias gwl='git worktree list'
alias gwr='git worktree remove'

# 使用
gwa ../project-review origin/feature/someone-pr  # 快速 review
gwa -b hotfix/xxx ../project-hotfix               # 快速修 hotfix
```

### 4.4 ⚠️ 踩坑记录

**踩坑 1：同一个分支不能在两个 worktree 中 checkout**

```bash
# ❌ 错误
git worktree add ../project-dev develop
# fatal: 'develop' is already checked out at /path/to/project

# ✅ 解决：创建新分支或用 detached HEAD
git worktree add ../project-dev -b feature/temp-fix develop
```

**踩坑 2：Worktree 中的 `.env` 文件**

Worktree 共享同一个 `.git` 目录，但代码目录是独立的。注意：

```bash
# 主目录的 .env 不会自动复制到 worktree
cd ../project-hotfix
cp ../project/.env .env
# 或者用 symlink
ln -s ../project/.env .env
```

**踩坑 3：IDE 索引冲突**

PhpStorm/WebStorm 对 worktree 的支持有限：

```
# ❌ 两个 worktree 用同一个 IDE 窗口打开 → 索引混乱
# ✅ 每个 worktree 用独立的 IDE 窗口/项目打开
```

**踩坑 4：Worktree 路径包含空格或中文**

```bash
# ❌ 路径有问题
git worktree add ../hotfix 修复 hotfix/payment-bug

# ✅ 使用英文路径
git worktree add ../project-hotfix-payment hotfix/payment-bug
```

---

## 五、组合技：四个命令的协同使用

### 场景：生产 Bug 的完整处理流程

```
1. 发现生产 Bug
2. git bisect → 定位引入 Bug 的 commit (abc1234)
3. git worktree → 创建 hotfix 目录
4. 在 worktree 中修复
5. git cherry-pick → 将修复应用到多个环境分支
6. git rebase → 清理 feature 分支历史后合并
```

```bash
# Step 1: Bisect 定位
git bisect start
git bisect bad HEAD
git bisect good v2.1.0
git bisect run ./test_order_export.sh
# → abc1234 是引入 Bug 的 commit
git bisect reset

# Step 2: Worktree 创建 hotfix 环境
git worktree add -b hotfix/export-fix ../project-hotfix abc1234^

# Step 3: 在 worktree 中修复
cd ../project-hotfix
# 修复代码...
git add .
git commit -m "fix: order export timeout on large dataset"
# → def5678

# Step 4: Cherry-pick 到各环境分支
git checkout develop && git cherry-pick def5678
git checkout staging && git cherry-pick def5678
git checkout release && git cherry-pick def5678

# Step 5: 清理
cd ../project
git worktree remove ../project-hotfix
git push origin --delete hotfix/export-fix
```

---

## 六、实用 Alias 配置

```bash
# ~/.gitconfig
[alias]
    # Rebase
    rb = rebase
    rbi = rebase -i
    rbc = rebase --continue
    rba = rebase --abort
    
    # Cherry-pick
    cp = cherry-pick
    cpn = cherry-pick --no-commit
    
    # Bisect
    bs = bisect
    bsg = bisect good
    bsb = bisect bad
    bss = bisect skip
    bsr = bisect reset
    bsa = bisect start --first-parent
    
    # Worktree
    wa = worktree add
    wl = worktree list
    wr = worktree remove
    wp = worktree prune
    
    # 通用
    lg = log --oneline --graph --decorate --all
    wip = !git add -A && git commit -m "WIP"
    undo = reset HEAD~1 --mixed
```

---

## 七、Rebase vs Merge 决策速查表

| 维度 | `git merge` | `git rebase` |
|------|-------------|--------------|
| 历史形状 | 菱形（有 merge commit） | 线性（干净的单行历史） |
| `git bisect` 效率 | 可能跳到 merge commit | 精准定位每个 commit |
| 冲突处理 | 一次性解决所有冲突 | 逐个 commit 解决冲突 |
| Code Review | 不影响已有 review | review comment 变 outdated |
| 适用场景 | 公共分支（develop/main） | 个人 feature 分支 |
| 回退难度 | `git revert -m 1 <merge>` | 需要 `git reflog` 恢复 |
| 团队协作影响 | 无 | 需要 `--force-with-lease` |

**决策口诀**：

```text
公共分支用 merge，个人分支用 rebase；
合并前只 rebase 一次，中间同步用 merge；
不确定时用 merge，merge 永远不会丢代码。
```

---

## 八、更多实战代码示例

### 8.1 Rebase 冲突处理完整流程

```bash
# 场景：feature 分支 rebase 到 develop 时遇到冲突
git checkout feature/order-export
git rebase develop

# 输出：
# CONFLICT (content): Merge conflict in app/Models/Order.php
# CONFLICT (content): Merge conflict in app/Http/Controllers/OrderController.php
# error: could not apply abc1234... feat: add order filter

# 查看冲突文件
git status
# both modified: app/Models/Order.php
# both modified: app/Http/Controllers/OrderController.php

# 逐个解决冲突后
git add app/Models/Order.php
git add app/Http/Controllers/OrderController.php

# 继续 rebase（处理下一个冲突 commit）
git rebase --continue

# 如果某个 commit 的冲突无法解决（代码已不适用）
# 编辑器会提示，删掉该 commit 的内容后保存
git add .
git rebase --continue
```

### 8.2 Cherry-pick 批量操作与冲突处理

```bash
# 场景：将 staging 的 3 个 hotfix 一次性 cherry-pick 到 release
# 先查看要 cherry-pick 的 commit 列表
git log staging --oneline -5
# def5678 fix: payment callback timeout
# abc1234 fix: order export date format
# 7890abc fix: duplicate coupon validation

# 方式一：逐个 cherry-pick（可逐个解决冲突）
git checkout release
git cherry-pick def5678 abc1234 7890abc

# 方式二：cherry-pick 合并为一个 commit
git checkout release
git cherry-pick --no-commit def5678 abc1234 7890abc
git commit -m "fix: batch hotfixes from staging (payment/export/coupon)"

# Cherry-pick 冲突处理
git cherry-pick abc1234
# CONFLICT (content): Merge conflict in app/Services/PaymentService.php
# 手动解决冲突后
git add app/Services/PaymentService.php
git cherry-pick --continue
```

### 8.3 Bisect 自动化脚本（带日志）

```bash
#!/bin/bash
# save as: bisect_test.sh
# 用法: git bisect run ./bisect_test.sh

set -e

echo "Testing commit: $(git rev-parse --short HEAD)"
echo "Commit message: $(git log -1 --pretty=%s)"

# 运行特定测试
php artisan test --filter=OrderExportTest 2>&1 | tee /tmp/bisect_result.log

exit_code=$?

if [ $exit_code -eq 0 ]; then
    echo "✅ GOOD - test passed"
else
    echo "❌ BAD - test failed"
    # 保存失败详情
    echo "Failed at: $(git rev-parse --short HEAD)" >> /tmp/bisect_failures.log
fi

exit $exit_code
```

```bash
# 使用方式
git bisect start
git bisect bad HEAD
git bisect good v2.1.0
git bisect run ./bisect_test.sh
# 输出日志在 /tmp/bisect_failures.log
# 结束后查看
git bisect reset
cat /tmp/bisect_failures.log
```

### 8.4 Worktree 实战：同时 Review 和开发

```bash
# 场景：你正在 feature/new-dashboard 开发，同事提了一个 PR 需要 review
# 不想 stash 当前工作，用 worktree 快速创建 review 环境

# 1. 创建 worktree 拉取 PR 分支
git fetch origin pull/42/head:pr/42
git worktree add ../project-pr42-review pr/42

# 2. 在 review 目录中测试
cd ../project-pr42-review
composer install
php artisan test --filter=NewDashboardTest
php artisan serve --port=8081  # 独立端口运行

# 3. Review 完成后清理
cd ../project
git worktree remove ../project-pr42-review
git branch -d pr/42

# 4. 批量清理所有已失效的 worktree
git worktree prune

# 5. 快速查看哪些 worktree 有未提交的修改
git worktree list --porcelain | grep -B2 "worktree"
```

---

## 总结

| 命令 | 场景 | 核心价值 |
|------|------|----------|
| `rebase` | 保持线性历史 | 干净的 git log，方便 code review |
| `cherry-pick` | 跨分支移植修复 | 一个 fix 应用到多个环境分支 |
| `bisect` | 定位回归 Bug | 二分法，30 个 commit 只需 5 次检查 |
| `worktree` | 并行开发多分支 | 无需 stash/checkout 切换上下文 |

这四个命令不是日常必需，但在关键时刻能救命。建议先在个人项目中练习，熟练后再应用到团队项目。

---

## 相关阅读

- [代码审查流程设计：如何建立高效的 CR 文化与工具链](/categories/engineering/code-review-process/)
- [Git Worktree + Bare Repo 实战：多分支并行开发大型项目高效工作流](/categories/07_CICD/Git-Worktree-Bare-Repo-实战-多分支并行开发-Laravel大型项目高效工作流/)
- [Git Internals 深度剖析：对象模型、packfile 与引用规范](/categories/07_CICD/Git-Internals-深度剖析-对象模型-packfile-引用规范/)
- [开源项目贡献代码实战：PR 流程与最佳实践](/categories/engineering/open-source-pr-workflow/)

---

*本文基于 KKday B2C Backend Team 30+ 仓库的真实开发经验整理。如果你也有 Git 高级用法的踩坑经历，欢迎交流！*
