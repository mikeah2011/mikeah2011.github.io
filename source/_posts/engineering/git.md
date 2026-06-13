---

title: Git基础命令与工作流实战指南
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags: [Git, 版本控制, 工程化]
keywords: [Git, 版本控制, 工程化]
categories:
  - engineering
  - git
date: 2020-03-20 15:05:07
description: >
---
# Git 基础命令与工作流实战指南

Git 是现代软件开发中最核心的版本控制工具。无论你是独立开发者还是大型团队的一员，掌握 Git 的核心概念与工作流都是必备技能。本文将从基础概念出发，逐步深入到分支策略、合并技巧、自动化钩子和问题排查，构建一个完整的 Git 知识体系。
---

## 一、Git 核心概念

### 1.1 四个工作区域

Git 的工作模型由四个区域构成，理解它们之间的数据流转是掌握 Git 的关键：

```
┌──────────┐   add    ┌──────────┐   commit  ┌──────────┐   push   ┌──────────┐
│ 工作区    │ ───────> │ 暂存区    │ ────────> │ 本地仓库  │ ───────> │ 远程仓库  │
│(Working)  │         │(Staging)  │          │(Repository)│         │(Remote)   │
└──────────┘         └──────────┘          └──────────┘         └──────────┘
      ^                   |                      |                     |
      |                   |  reset               |                     |
      +──────────────────-+──────────────────────+                     |
      |                                                                 |
      +───────────── checkout / pull ─────────────────────────────────-+
```

| 区域 | 说明 | 对应文件 |
|------|------|---------|
| **工作区（Working Directory）** | 你当前编辑的文件目录 | 项目文件夹中的所有文件 |
| **暂存区（Staging Area / Index）** | `git add` 后准备提交的变更快照 | `.git/index` |
| **本地仓库（Local Repository）** | `git commit` 后的完整历史记录 | `.git/objects` |
| **远程仓库（Remote Repository）** | GitHub/GitLab 等服务器上的仓库 | 远程服务器 |

### 1.2 文件状态流转

一个文件在 Git 中的生命周期：

```
Untracked ──(add)──> Staged ──(commit)──> Unmodified
    ^                                        |
    |                                        | (edit)
    |                                        v
    +──(remove)── Modified <────────────────┘
                     |
                     +──(add)──> Staged ──(commit)──> Unmodified
```

- **Untracked**：新建的文件，Git 尚未跟踪
- **Modified**：已跟踪的文件被修改，但未暂存
- **Staged**：修改已加入暂存区，等待提交
- **Unmodified**：文件与上次提交一致

### 1.3 Git 对象模型（简述）

Git 底层存储基于四种对象类型：

- **blob**：文件内容的快照
- **tree**：目录结构，记录 blob 和子 tree 的对应关系
- **commit**：指向一个 tree 对象，附带作者、时间、提交信息和父 commit
- **tag**：指向 commit 的带注释引用

每个对象通过 SHA-1 哈希值唯一标识，这就是为什么 Git 能保证数据完整性。

---

## 二、常用命令详解与可运行示例

### 2.1 仓库初始化与克隆

```bash
# 初始化本地仓库
mkdir my-project && cd my-project
git init

# 克隆远程仓库
git clone https://github.com/user/repo.git
git clone --depth 1 https://github.com/user/repo.git  # 浅克隆，只拉最新一次提交

# 查看仓库状态
git status
git status -s  # 简洁模式
```

### 2.2 添加与提交

```bash
# 添加单个文件到暂存区
git add README.md

# 添加所有修改（包括删除）
git add -A

# 添加当前目录的修改（不含删除）
git add .

# 交互式暂存——逐个选择要暂存的代码块
git add -p

# 提交
git commit -m "feat: 添加用户登录功能"

# 跳过暂存区，直接提交已跟踪文件的修改
git commit -am "fix: 修复登录验证逻辑"

# 修改最近一次提交（不改信息）
git commit --amend
git commit --amend -m "feat: 添加用户登录与注册功能"
```

### 2.3 查看差异与日志

```bash
# 工作区 vs 暂存区
git diff

# 暂存区 vs 最新提交
git diff --staged
git diff --cached  # 同义

# 两个 commit 之间的差异
git diff abc1234 def5678

# 查看提交历史
git log
git log --oneline                 # 单行模式
git log --graph --oneline         # 带分支图形
git log --pretty=format:"%h %an %ar %s"  # 自定义格式
git log -5                        # 最近 5 条
git log --since="2024-01-01"      # 按日期过滤
git log -- path/to/file           # 查看某个文件的历史

# 以行模式查看提交日志
git log --pretty=oneline
```

### 2.4 撤销与回滚

```bash
# 撤销工作区的修改（恢复到暂存区状态）
git checkout -- filename.txt
git restore filename.txt           # Git 2.23+ 推荐写法

# 取消暂存
git reset HEAD filename.txt
git restore --staged filename.txt  # Git 2.23+ 推荐写法

# 撤销某次提交，保留修改在工作区
git reset --soft HEAD~1

# 撤销某次提交，保留修改在暂存区
git reset --mixed HEAD~1           # 默认模式

# 彻底回退到某个提交（丢弃所有修改，慎用！）
git reset --hard HEAD~1

# 安全回滚——生成一个"反向提交"来撤销某次提交
git revert <commit-hash>
git revert e08e6b103d72a793cc0c21b06f187884c3943f83
git push  # 回滚后记得推送
```

> **`reset` vs `revert` 的选择**：`reset` 会改写历史，适用于尚未推送的提交；`revert` 生成新提交来抵消旧提交，适用于已推送到远程的提交。

### 2.5 暂存工作（Stash）

```bash
# 保存当前修改到 stash
git stash
git stash save "正在开发用户模块"

# 查看 stash 列表
git stash list

# 恢复最近一次 stash 并删除
git stash pop

# 恢复最近一次 stash 但保留记录
git stash apply

# 恢复指定 stash
git stash apply stash@{2}

# 删除指定 stash
git stash drop stash@{0}

# 清空所有 stash
git stash clear

# 从 stash 创建分支
git stash branch new-feature stash@{0}
```

### 2.6 远程操作

```bash
# 查看远程仓库
git remote -v

# 添加远程仓库
git remote add origin https://github.com/user/repo.git

# 拉取远程更新（不合并）
git fetch origin

# 拉取并合并
git pull
git pull --rebase  # 使用 rebase 代替 merge

# 推送到远程
git push
git push -u origin main  # 首次推送并设置上游分支

# 删除远程分支
git push origin --delete feature-branch

# 查看远程分支信息
git branch -r
```

### 2.7 标签管理

```bash
# 创建轻量标签
git tag v1.0.0

# 创建附注标签
git tag -a v1.0.0 -m "第一个正式版本"

# 推送标签到远程
git push origin v1.0.0
git push origin --tags  # 推送所有标签

# 删除标签
git tag -d v1.0.0
git push origin --delete v1.0.0
```

---

## 三、分支管理策略

### 3.1 Git Flow

Git Flow 是最经典的分支模型，由 Vincent Driessen 提出，适合有固定发布周期的项目：

```
main ─────●────────────────●────────────────●────── (生产)
           \              /                /
            \            /                /
release ─────\──●────●──/                /
               \  /   \/                /
feature ────────●──────●              /
                                    /
develop ──●────●────●────●────●────●──── (开发主线)
```

**分支说明：**

| 分支 | 用途 | 命名规范 |
|------|------|---------|
| `main` | 生产环境代码 | — |
| `develop` | 开发主线 | — |
| `feature/*` | 功能开发 | `feature/user-login` |
| `release/*` | 发布准备 | `release/v1.2.0` |
| `hotfix/*` | 生产紧急修复 | `hotfix/login-crash` |

```bash
# 初始化 Git Flow
git flow init

# 开始新功能
git flow feature start user-login
# ... 开发完成 ...
git flow feature finish user-login

# 开始发布
git flow release start v1.2.0
git flow release finish v1.2.0

# 紧急修复
git flow hotfix start login-crash
git flow hotfix finish login-crash
```

**Git Flow 适用场景：**
- 传统软件发布，有明确的版本号
- 需要同时维护多个版本
- 团队规模中等，角色分工明确

### 3.2 Trunk-Based Development（主干开发）

主干开发模式强调所有开发者直接向主干（main/master）提交代码，配合 Feature Flag 控制未完成功能的可见性：

```
main ──●──●──●──●──●──●──●──●──●── (持续集成)
       |     |     |     |
       +     +     +     +  ← 短生命周期 feature 分支（< 2天）
```

**核心原则：**
- 所有分支生命周期极短（通常不超过 2 天）
- 使用 Feature Flag 控制功能发布
- 依赖强大的 CI/CD 和自动化测试
- 频繁集成，减少合并冲突

**Trunk-Based 适用场景：**
- SaaS 产品，持续交付
- 团队有完善的自动化测试
- 使用 Feature Flag 管理功能灰度

### 3.3 如何选择？

| 维度 | Git Flow | Trunk-Based |
|------|----------|-------------|
| 发布节奏 | 固定周期（周/月） | 随时发布 |
| 合并冲突 | 频繁且复杂 | 少且简单 |
| CI/CD 要求 | 中等 | 极高 |
| 学习成本 | 较高 | 较低 |
| 适合团队 | 传统软件/多版本维护 | SaaS/敏捷团队 |

> 推荐阅读：[Git Flow vs Trunk-Based：30+ 仓库的分支策略选型与踩坑记录](/architecture/git-flow-vs-trunk-based-30)

---

## 四、合并（Merge）vs 变基（Rebase）

### 4.1 三种合并方式

```bash
# 1. 普通 merge——保留完整历史
git checkout main
git merge feature-branch
# 生成一个 merge commit

# 2. fast-forward merge——当 main 没有新提交时直接移动指针
git merge --ff-only feature-branch

# 3. squash merge——将 feature 分支的所有提交压缩为一个
git merge --squash feature-branch
git commit -m "feat: 实现用户登录功能"
```

### 4.2 Rebase 变基

```bash
# 将 feature 分支的提交"移植"到 main 最新提交之后
git checkout feature-branch
git rebase main

# 交互式 rebase——整理提交历史
git rebase -i HEAD~5
```

交互式 rebase 的常用操作：

```
pick abc1234 feat: 添加登录页面
squash def5678 fix: 登录按钮样式
pick ghi9012 feat: 添加注册功能
edit jkl3456 refactor: 重构验证逻辑
```

- `pick`：保留提交
- `squash`（s）：合并到上一个提交
- `reword`（r）：修改提交信息
- `edit`（e）：暂停在此提交，允许修改
- `drop`（d）：丢弃提交

### 4.3 Merge vs Rebase 对比

```
# Merge 结果（保留分支历史）：
*   Merge branch 'feature' (merge commit)
|\
| * feat: 添加注册页面
| * feat: 添加登录页面
|/
* feat: 基础框架

# Rebase 结果（线性历史）：
* feat: 添加注册页面
* feat: 添加登录页面
* feat: 基础框架
```

| 维度 | Merge | Rebase |
|------|-------|--------|
| 历史记录 | 保留完整分支拓扑 | 线性、干净 |
| 冲突处理 | 一次性解决 | 逐个提交解决 |
| 安全性 | 不改写历史 | 改写历史（需 force push） |
| 适用场景 | 多人协作的公共分支 | 个人分支整理提交 |

### 4.4 踩坑案例

**案例一：在公共分支上 rebase 导致同事代码丢失**

```bash
# 错误操作：对已推送的 main 分支做 rebase
git checkout main
git rebase feature-branch
git push --force  # 危险！覆盖了远程历史

# 后果：其他同事 pull 时会遇到大量冲突，甚至丢失代码
```

**教训：永远不要对已经推送到远程的公共分支执行 rebase。**

**案例二：rebase 过程中冲突堆积**

```bash
git rebase main
# 第 3 个提交冲突了，解决后
git add .
git rebase --continue
# 第 5 个提交又冲突了... 如此反复

# 如果搞不定，及时放弃
git rebase --abort
```

**建议：如果 rebase 冲突超过 3 次，考虑改用 merge。**

---

## 五、Git Hooks 实用示例

Git Hooks 是在特定事件触发时自动执行的脚本，存放在 `.git/hooks/` 目录下。

### 5.1 常用 Hooks

| Hook | 触发时机 | 典型用途 |
|------|---------|---------|
| `pre-commit` | `git commit` 执行前 | 代码检查、格式化 |
| `commit-msg` | 提交信息写入后 | 校验提交信息格式 |
| `pre-push` | `git push` 执行前 | 运行测试 |
| `post-merge` | `git merge` 执行后 | 自动安装依赖 |
| `prepare-commit-msg` | 默认提交信息生成后 | 自动添加分支名前缀 |

### 5.2 pre-commit：自动运行代码检查

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "🔍 运行代码检查..."

# 检查是否有 console.log 遗留
if git diff --cached --name-only | xargs grep -l "console\.log" 2>/dev/null; then
    echo "❌ 发现 console.log，请移除后再提交"
    exit 1
fi

# 运行 ESLint
npx eslint --quiet $(git diff --cached --name-only --diff-filter=ACM -- '*.js' '*.ts')
if [ $? -ne 0 ]; then
    echo "❌ ESLint 检查失败，请修复后重试"
    exit 1
fi

# 运行 PHP-CS-Fixer（PHP 项目）
if [ -f "vendor/bin/php-cs-fixer" ]; then
    vendor/bin/php-cs-fixer fix --dry-run --diff
fi

echo "✅ 代码检查通过"
```

### 5.3 commit-msg：校验提交信息格式

```bash
#!/bin/bash
# .git/hooks/commit-msg
# 要求 Conventional Commits 格式

commit_msg=$(cat "$1")
pattern="^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,72}$"

if ! echo "$commit_msg" | grep -qE "$pattern"; then
    echo "❌ 提交信息不符合 Conventional Commits 格式"
    echo "   格式: type(scope): message"
    echo "   示例: feat(auth): 添加微信登录功能"
    echo "   类型: feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert"
    exit 1
fi
```

### 5.4 post-merge：自动安装依赖

```bash
#!/bin/bash
# .git/hooks/post-merge

changed_files=$(git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD)

# Node.js 项目——package.json 变更后自动 npm install
if echo "$changed_files" | grep -q "package.json"; then
    echo "📦 检测到 package.json 变更，正在安装依赖..."
    npm install
fi

# PHP 项目——composer.json 变更后自动 composer install
if echo "$changed_files" | grep -q "composer.json"; then
    echo "📦 检测到 composer.json 变更，正在安装依赖..."
    composer install
fi

# 数据库迁移
if echo "$changed_files" | grep -q "database/migrations"; then
    echo "🗃️ 检测到数据库迁移文件变更..."
    php artisan migrate
fi
```

### 5.5 使用 Husky 管理 Hooks（Node.js 项目）

```bash
# 安装 husky
npm install husky --save-dev

# 初始化
npx husky init

# 添加 pre-commit hook
echo "npx lint-staged" > .husky/pre-commit

# package.json 中配置 lint-staged
```

```json
{
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.{css,scss}": ["stylelint --fix", "prettier --write"],
    "*.md": ["prettier --write"]
  }
}
```

---

## 六、常见问题排查

### 6.1 合并冲突解决

冲突文件的标记如下：

```
<<<<<<< HEAD
// 当前分支的代码
const apiUrl = 'https://api.v2.example.com';
=======
// 被合并分支的代码
const apiUrl = 'https://api.example.com';
>>>>>>> feature-branch
```

**解决步骤：**

```bash
# 1. 编辑文件，保留正确的代码，删除冲突标记
# 2. 标记为已解决
git add filename.txt

# 3. 使用图形化工具辅助解决
git mergetool

# 4. 完成合并
git commit

# 如果想放弃合并
git merge --abort
```

**推荐工具：**
- VS Code 内置的冲突解决 UI
- `git mergetool` 配合 Beyond Compare / KDiff3
- `git rerere`——记住冲突解决方案，下次自动应用

```bash
# 启用 rerere（reuse recorded resolution）
git config --global rerere.enabled true
```

### 6.2 误操作恢复

**场景一：误删分支**

```bash
# 查找被删除分支的最后一次提交
git reflog
# 找到类似: abc1234 HEAD@{5}: checkout: moving from feature to main

# 恢复分支
git checkout -b feature abc1234
```

**场景二：误执行 reset --hard**

```bash
# reflog 是你的救星
git reflog
# 找到 reset 之前的提交
# def5678 HEAD@{3}: commit: feat: 最后的正常提交

git reset --hard def5678
```

**场景三：误提交了敏感信息（密码、密钥）**

```bash
# 如果还没推送
git reset --soft HEAD~1
# 从暂存区移除敏感文件
git reset HEAD secret.txt
echo "secret.txt" >> .gitignore
git commit -m "chore: 移除敏感配置"

# 如果已经推送——仅 reset 不够，需要重写历史
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch secret.txt' \
  --prune-empty -- --all

# 或使用 BFG Repo-Cleaner（更推荐）
java -jar bfg.jar --delete-files secret.txt
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

> ⚠️ 任何已推送到远程的敏感信息，都应该立即轮换密钥/密码，因为即使从 Git 历史中删除，仍然可能已被他人获取。

**场景四：提交到了错误的分支**

```bash
# 当前在 main 分支，但提交应该在 feature 分支
# 1. 把提交移到 feature 分支
git branch feature          # 在当前位置创建 feature 分支
git reset --hard HEAD~1     # main 回退一步

# 2. 切到 feature 继续工作
git checkout feature
```

### 6.3 大文件处理

```bash
# 查看仓库中的大文件
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  sed -n 's/^blob //p' | \
  sort -rnk2 | head -20

# 使用 Git LFS 管理大文件
git lfs install
git lfs track "*.psd"
git lfs track "*.zip"
git add .gitattributes
```

---

## 七、实用 Alias 配置

配置好 alias 可以大幅提升日常开发效率。以下是我推荐的配置：

```bash
# 查看状态
git config --global alias.st "status -s"

# 单行日志
git config --global alias.lg "log --oneline --graph --decorate --all"

# 漂亮的日志
git config --global alias.lg-fancy "log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"

# 快速提交
git config --global alias.cm "commit -m"

# 修改上一次提交
git config --global alias.amend "commit --amend --no-edit"

# 查看暂存区差异
git config --global alias.dfc "diff --cached"

# 取消暂存
git config --global alias.unstage "reset HEAD --"

# 撤销工作区修改
git config --global alias.discard "checkout --"

# 查看某次提交的详细改动
git config --global alias.changes "diff-tree --no-commit-id --name-status -r"

# 列出所有分支按最后提交时间排序
git config --global alias.branches "for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short)' refs/heads/"

# 找出谁写了某行代码（blame 的简写）
git config --global alias.who "blame -w -C -C -C"

# 清理已合并的本地分支
git config --global alias.cleanup "!git branch --merged | grep -v '\\*\\|main\\|master\\|develop' | xargs -n 1 git branch -d"
```

完整的 `.gitconfig` 推荐配置：

```ini
[alias]
    st = status -s
    lg = log --oneline --graph --decorate --all
    cm = commit -m
    amend = commit --amend --no-edit
    dfc = diff --cached
    unstage = reset HEAD --
    discard = checkout --
    branches = for-each-ref --sort=-committerdate --format='%(committerdate:short) %(refname:short)' refs/heads/
    cleanup = "!git branch --merged | grep -v '\\*\\|main\\|master\\|develop' | xargs -n 1 git branch -d"
    # 撤销某次提交并保留修改
    undo = reset --soft HEAD~1
    # 回滚某次提交
    revert-commit = revert --no-edit

[color]
    ui = auto

[pull]
    rebase = true

[init]
    defaultBranch = main

[core]
    autocrlf = input
    editor = code --wait

[merge]
    conflictstyle = diff3
```

---

## 八、Git 日常工作流速查表

| 场景 | 命令 |
|------|------|
| 开始新功能 | `git checkout -b feature/xxx` |
| 保存进度 | `git stash save "描述"` |
| 同步远程更新 | `git fetch origin && git rebase origin/main` |
| 提交代码 | `git add -A && git commit -m "feat: xxx"` |
| 推送分支 | `git push -u origin feature/xxx` |
| 合并前整理提交 | `git rebase -i HEAD~n` |
| 合并到主分支 | `git checkout main && git merge --no-ff feature/xxx` |
| 删除已合并分支 | `git branch -d feature/xxx` |
| 查看某文件修改历史 | `git log --follow -p -- filename` |
| 对比两个分支 | `git diff main..feature/xxx` |
| 找出引入 Bug 的提交 | `git bisect start && git bisect bad && git bisect good v1.0` |

---

## 九、总结

Git 的学习曲线虽然陡峭，但一旦理解了其核心模型——**内容寻址的文件系统 + 有向无环图的历史记录**——所有命令的行为都变得可预测。建议：

1. **先掌握核心概念**：工作区、暂存区、仓库的关系
2. **熟练常用命令**：add、commit、push、pull、branch、merge
3. **理解分支策略**：根据团队情况选择 Git Flow 或 Trunk-Based
4. **善用 Hooks 和 Alias**：自动化重复工作，提升效率
5. **学会用 reflog 救命**：几乎所有误操作都能通过 reflog 恢复

---

## 相关阅读

- [Git 高级用法实战：Rebase、Cherry-pick、Bisect、Worktree 踩坑记录](/engineering/git-guide-rebase-cherry-pick-bisect-worktree)——深入掌握交互式 rebase、精确拣选提交、二分排查 Bug、多工作树并行开发等进阶技巧
- [Git Internals 深度剖析：对象模型、packfile 与引用规范](/07_CICD/Git-Internals-深度剖析-对象模型-packfile-引用规范)——从底层理解 Git 的 blob/tree/commit 对象模型、SHA-1 寻址机制与 packfile 压缩原理
- [Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地](/07_CICD/Trunk-Based-Development-深度实战-Feature-Flag-替代长生命周期分支的工程化落地)——主干开发模式的完整方法论，包含 Laravel Feature Flag 实战与 CI/CD 流程适配
