---

title: Hexo 博客工程化实战：GitHub Actions 自动部署、AI 辅助选题、SEO 优化、阅读量分析——从手动写作到自动化内容工厂的演进
keywords: [Hexo, GitHub Actions, AI, SEO, 博客工程化实战, 自动部署, 辅助选题, 阅读量分析, 从手动写作到自动化内容工厂的演进, DevOps]
date: 2026-06-10 03:18:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- Hexo
- GitHub Actions
- AI
- SEO
- 自动化
- 工程化
- Aurora
description: 一套完整的 Hexo 博客工程化方案：GitHub Actions 自动部署、AI 驱动的选题与写作流水线、SEO 深度优化、阅读量分析看板，从手动 hexo deploy 到自动化内容工厂的全链路实战。
---



## 为什么要把博客"工程化"？

写博客这件事，技术人通常的路径是：

1. 本地 `hexo new` 创建文章
2. Markdown 写内容
3. `hexo g && hexo d` 手动部署

这条路径在只有几十篇文章时完全够用。但当文章数量突破 400+、你希望保持周更甚至日更节奏时，手动流程就会暴露出几个致命问题：

- **部署依赖本地环境**：换台电脑就写不了
- **选题靠灵感驱动**：没灵感就断更
- **SEO 全靠感觉**：标题写得好不好、结构化数据有没有、sitemap 对不对，全凭手感
- **写完就忘**：哪篇文章阅读量高、哪些关键词带来流量，完全没有数据反馈

这篇文章记录的是我把自己的 Hexo 博客（Aurora 主题、400+ 篇文章）从"手动写作"改造成"自动化内容工厂"的完整过程。涉及四个核心模块：

1. **GitHub Actions 自动部署**：push 即发布
2. **AI 辅助选题与写作**：选题池 + 多 Worker 并行生产
3. **SEO 工程化**：结构化数据、自动 sitemap、内链策略
4. **阅读量分析**：数据采集 → 看板 → 反哺选题

每个模块都有可直接复用的配置和代码。

---

## 一、GitHub Actions 自动部署

### 1.1 基础流水线

最核心的需求：`git push` 之后自动构建、自动部署到 GitHub Pages。

在仓库根目录创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy Hexo Blog

on:
  push:
    branches:
      - main

# 防止同时触发多次部署，排队执行
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史用于 git log 生成文章列表

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npx hexo generate
        env:
          NODE_ENV: production

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
          publish_branch: gh-pages
          commit_message: "deploy: ${{ github.event.head_commit.message }}"
```

### 1.2 进阶：多环境部署

如果你有多个环境（比如 GitHub Pages + 自建服务器），可以用矩阵策略或者分步部署：

```yaml
  deploy-to-server:
    needs: build-and-deploy
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout built files
        uses: actions/checkout@v4
        with:
          ref: gh-pages
          path: public

      - name: Deploy via rsync
        uses: burnett01/rsync-deployments@7.0.1
        with:
          switches: -avzr --delete
          path: public/
          remote_path: /var/www/blog/
          remote_host: ${{ secrets.SERVER_HOST }}
          remote_user: ${{ secrets.SERVER_USER }}
          remote_key: ${{ secrets.SSH_PRIVATE_KEY }}
```

### 1.3 构建缓存优化

400+ 篇文章的构建时间是个问题。加入缓存后构建时间从 90s 降到 25s：

```yaml
      - name: Cache Hexo
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            .deploy_git
          key: hexo-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            hexo-${{ runner.os }}-
```

### 1.4 自动化预检

在部署前加入 lint 和链接检查，防止发布有问题的内容：

```yaml
      - name: Check broken links
        run: |
          npx hexo generate
          # 检查生成的 HTML 中是否有死链
          npx broken-link-checker http://localhost:4000 --recursive --ordered --filter-level 3 || true

      - name: Validate HTML
        run: |
          npx html-validate public/**/*.html || true
```

---

## 二、AI 辅助选题与写作

这是整个工程化改造中投入产出比最高的部分。

### 2.1 选题池设计

在仓库根目录维护一个 `.writing-backlog.md` 文件，格式简单：

```markdown
# Writing Backlog

- [ ] Laravel 事件溯源实战：Event Sourcing + EventStore 落地踩坑
- [ ] Go 并发模式：Channel、Context、errgroup 组合实战
- [ ] Redis 7.0 Function 替代 Lua 脚本：迁移指南与性能对比
- [ ] Kubernetes HPA 自定义指标：基于 Laravel 队列深度的自动扩缩容
```

`- [ ]` 表示待写，`- [x]` 表示已完成。每次 Worker 领取任务时，立刻用 `sed` 把 `[ ]` 改为 `[x]` 锁定选题，防止多个 Worker 重复写作。

### 2.2 AI Worker 流水线

用 OpenClaw 的 cron 系统配置多个定时 Worker，每个 Worker 独立运行：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Worker 1   │     │  Worker 2   │     │  Worker 3   │
│  每2小时执行 │     │  每3小时执行 │     │  每4小时执行 │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────┐
│              .writing-backlog.md                  │
│  grep → 锁定 → 写文章 → 保存 → 更新选题池        │
└──────────────────────────────────────────────────┘
```

每个 Worker 的核心逻辑：

```bash
# 1. 领取选题
TOPIC=$(grep -m1 '^- \[ \]' .writing-backlog.md)

# 2. 立刻锁定（防止其他 Worker 重复领取）
FIRST30=$(echo "$TOPIC" | cut -c1-35)
sed -i '' "s/^- \[ \] ${FIRST30}/- [x] ${FIRST30}/" .writing-backlog.md

# 3. AI 生成文章（交给 AI agent 处理）
# 4. 保存到 source/_posts/<分类>/<文件名>.md
# 5. 更新选题池，追加文件路径
```

### 2.3 选题质量控制

不是所有选题都值得写。在选题池中加入质量评估维度：

```markdown
# Writing Backlog - 格式说明
# - [ ] 选题标题 | 预估搜索量(高/中/低) | 竞争度(高/中/低) | 优先级(P0/P1/P2)

- [ ] Laravel 事件溯源实战 | 搜索量:中 | 竞争度:低 | 优先级:P0
- [ ] Go 并发模式 | 搜索量:高 | 竞争度:高 | 优先级:P1
```

**选题原则：**

- **P0**：搜索量中/低 + 竞争度低 = 蓝海词，优先写
- **P1**：搜索量高 + 竞争度高 = 需要有差异化角度
- **P2**：搜索量低 + 竞争度高 = 不值得写，除非是个人笔记

### 2.4 自动 Git 提交

Worker 写完文章后，自动 commit 并 push：

```bash
git add source/_posts/
git commit -m "post: $(date +%Y-%m-%d) 新文章标题"
git push origin main
```

push 触发 GitHub Actions 自动部署，形成闭环：

```
选题 → AI 写作 → git push → GitHub Actions 构建 → 部署上线
```

---

## 三、SEO 工程化

SEO 不是"写完文章再想"的事情，而是应该内建到写作流程中。

### 3.1 Frontmatter 规范

每篇文章的 frontmatter 必须包含以下字段：

```yaml
---
title: "主关键词 - 长尾描述"
date: 2026-06-10 03:18:00
categories:
  - 07_CICD
tags:
  - Hexo
  - GitHub Actions
description: "一句话描述，控制在 150 字符内，包含核心关键词。"
---
```

**关键点：**

- `title`：主关键词在前，长尾描述在后
- `description`：用于 `<meta name="description">`，直接影响搜索结果摘要
- `tags`：3-5 个，覆盖文章核心概念
- `categories`：唯一，用于面包屑导航和站点结构

### 3.2 结构化数据（JSON-LD）

在主题的 `<head>` 中注入 Article 类型的结构化数据：

```javascript
// themes/aurora/scripts/structured-data.js
hexo.extend.filter.register('after_render', function(html, data) {
  if (data.layout !== 'post') return html;

  const jsonLD = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": data.title,
    "description": data.description || data.title,
    "datePublished": data.date.toISOString(),
    "dateModified": (data.updated || data.date).toISOString(),
    "author": {
      "@type": "Person",
      "name": "Michael",
      "url": "https://mikeah2011.github.io"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Michael's Tech Blog"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://mikeah2011.github.io${data.path}`
    }
  };

  const script = `<script type="application/ld+json">${JSON.stringify(jsonLD, null, 2)}</script>`;
  return html.replace('</head>', `${script}\n</head>`);
});
```

### 3.3 Sitemap 自动生成

Hexo 官方插件 `hexo-generator-sitemap` 已经够用，但需要正确配置：

```yaml
# _config.yml
sitemap:
  path: sitemap.xml
  rel: true
  tags: true
  categories: true
```

提交到 Google Search Console 后，确保 robots.txt 包含：

```
Sitemap: https://mikeah2011.github.io/sitemap.xml
```

### 3.4 内链策略

文章之间的内链是 SEO 的重要信号。在 AI 写作流水线中加入内链注入步骤：

```python
# scripts/inject_internal_links.py
import re
import os

def find_related_posts(current_tags, posts_dir):
    """根据 tags 相似度找到相关文章"""
    related = []
    for filename in os.listdir(posts_dir):
        if not filename.endswith('.md'):
            continue
        filepath = os.path.join(posts_dir, filename)
        with open(filepath, 'r') as f:
            content = f.read()
            # 提取 frontmatter 中的 tags
            tags_match = re.search(r'tags:\s*\n((?:\s+-\s+.+\n)*)', content)
            if tags_match:
                post_tags = set(re.findall(r'-\s+(.+)', tags_match.group(1)))
                overlap = len(current_tags & post_tags)
                if overlap >= 2:
                    title_match = re.search(r'title:\s*(.+)', content)
                    if title_match:
                        related.append((overlap, title_match.group(1).strip(), filename))
    related.sort(reverse=True)
    return related[:5]

def inject_links(content, related_posts):
    """在文章末尾注入相关阅读"""
    if not related_posts:
        return content
    links = "\n".join([
        f"- [{title}](/posts/{filename.replace('.md', '')})"
        for _, title, filename in related_posts
    ])
    return f"{content}\n\n## 相关阅读\n\n{links}\n"
```

### 3.5 自动化 SEO 审计

在 CI 流水线中加入 SEO 检查：

```yaml
      - name: SEO Audit
        run: |
          # 检查所有文章的 frontmatter 是否完整
          for file in source/_posts/**/*.md; do
            if ! grep -q "description:" "$file"; then
              echo "⚠️ Missing description: $file"
            fi
            if ! grep -q "categories:" "$file"; then
              echo "⚠️ Missing categories: $file"
            fi
          done

          # 检查是否有重复的 title
          grep -r "^title:" source/_posts/ | sort | uniq -d
```

---

## 四、阅读量分析

写了很多文章，但不知道哪些有人看、哪些是"空气文"。需要建立数据反馈闭环。

### 4.1 数据采集方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| Google Analytics | 功能强大、免费 | 加载慢、隐私问题、需要翻墙配置 |
| Umami | 自托管、轻量、隐私友好 | 需要部署 |
| 不蒜子 | 一行代码集成 | 只有 PV/UV，没有详细数据 |
| 百度统计 | 国内访问友好 | 界面复杂、数据延迟 |

**推荐方案：Umami 自托管 + 不蒜子做页面级计数器**

### 4.2 不蒜子集成（最简单）

在主题模板中加入不蒜子：

```html
<!-- themes/aurora/layout/_partial/footer.ejs -->
<script async src="//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js"></script>
<span id="busuanzi_container_site_pv">
  本站总访问量: <span id="busuanzi_value_site_pv"></span> 次
</span>
<span id="busuanzi_container_site_uv">
  本站访客数: <span id="busuanzi_value_site_uv"></span> 人
</span>
```

文章页面级别：

```html
<span id="busuanzi_container_page_pv">
  本文阅读量: <span id="busuanzi_value_page_pv"></span> 次
</span>
```

### 4.3 Umami 自托管（推荐）

用 Docker Compose 部署 Umami：

```yaml
# docker-compose.yml
version: '3'
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://umami:umami@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: your-secret-here
    depends_on:
      db:
        condition: service_healthy
    restart: always

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: umami
    volumes:
      - umami-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

volumes:
  umami-db:
```

在 Hexo 主题中注入 Umami 追踪代码：

```javascript
// themes/aurora/scripts/umami.js
hexo.extend.injector.register('head_end', `
  <script defer src="https://your-umami-domain.com/script.js" data-website-id="your-website-id"></script>
`);
```

### 4.4 数据分析脚本

定期从 Umami API 拉取数据，生成文章热度报告：

```python
# scripts/umami_report.py
import requests
from datetime import datetime, timedelta

UMAMI_URL = "https://your-umami-domain.com"
USERNAME = "admin"
PASSWORD = "your-password"

def get_token():
    resp = requests.post(f"{UMAMI_URL}/api/auth/login", json={
        "username": USERNAME,
        "password": PASSWORD
    })
    return resp.json()["token"]

def get_page_stats(token, days=30):
    headers = {"Authorization": f"Bearer {token}"}
    start_at = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
    end_at = int(datetime.now().timestamp() * 1000)

    # 获取所有页面的 PV
    resp = requests.get(f"{UMAMI_URL}/api/websites/{WEBSITE_ID}/metrics", 
        headers=headers,
        params={
            "startAt": start_at,
            "endAt": end_at,
            "type": "url",
            "limit": 50
        }
    )
    return resp.json()

def generate_report(stats):
    """生成 Markdown 格式的热度报告"""
    report = "# 月度文章热度报告\n\n"
    report += f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
    report += "| 排名 | 文章路径 | 访问量 |\n"
    report += "|------|----------|--------|\n"
    for i, item in enumerate(stats, 1):
        report += f"| {i} | {item['x']} | {item['y']} |\n"
    return report

if __name__ == "__main__":
    token = get_token()
    stats = get_page_stats(token)
    report = generate_report(stats)
    
    with open("docs/analytics-report.md", "w") as f:
        f.write(report)
    print(report)
```

### 4.5 数据反哺选题

分析报告不只是看看而已，要形成闭环：

```bash
# 找出阅读量 Top 10 文章的分类和标签
grep -A5 "排名: 1-10" analytics-report.md | \
  xargs -I {} grep "tags:" source/_posts/{} | \
  sort | uniq -c | sort -rn
```

如果发现某个标签（比如 "Laravel"）的文章阅读量普遍高，就增加该领域的选题。如果某类文章长期无人问津，就降低该领域优先级。

---

## 五、完整流水线总览

把所有模块串起来，完整的自动化流程是这样的：

```
┌─────────────────────────────────────────────────────────────┐
│                    选题与写作阶段                             │
│                                                             │
│  .writing-backlog.md                                        │
│       │                                                     │
│       ▼                                                     │
│  Cron Worker 定时触发                                        │
│       │                                                     │
│       ├─→ grep 选题 → sed 锁定                               │
│       │                                                     │
│       ├─→ AI 生成文章（3000-5000字）                          │
│       │   ├─ frontmatter 规范化（SEO）                        │
│       │   ├─ 内链注入                                        │
│       │   └─ 代码示例验证                                    │
│       │                                                     │
│       ├─→ 保存到 source/_posts/<分类>/                       │
│       │                                                     │
│       └─→ git commit → git push                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    构建与部署阶段                             │
│                                                             │
│  GitHub Actions 触发                                        │
│       │                                                     │
│       ├─→ npm ci → hexo generate                            │
│       │   ├─ 结构化数据注入                                  │
│       │   ├─ sitemap 生成                                    │
│       │   └─ SEO 审计                                        │
│       │                                                     │
│       ├─→ 部署到 GitHub Pages                                │
│       │                                                     │
│       └─→ （可选）rsync 到自建服务器                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    数据分析阶段                               │
│                                                             │
│  Umami / 不蒜子 采集                                        │
│       │                                                     │
│       ├─→ 每周生成热度报告                                   │
│       │                                                     │
│       └─→ 数据反哺选题池                                     │
│           ├─ 高阅读量标签 → 增加选题                          │
│           └─ 低阅读量标签 → 降低优先级                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、踩坑记录

### 坑 1：GitHub Actions 构建超时

400+ 篇文章在免费 runner 上构建可能超时（默认 6 小时限制，但实际可能在 10 分钟左右被资源争抢卡住）。

**解决方案：**

```yaml
# 用 hexo 的 incremental 构建（如果主题支持）
# 或者用 --bail 参数快速失败
- name: Build with timeout
  run: timeout 300 npx hexo generate --bail
```

### 坑 2：AI 生成的文章 frontmatter 格式不一致

不同 AI 模型生成的 YAML frontmatter 格式经常出问题：缺少引号、日期格式不统一、tags 用了字符串而非数组。

**解决方案：** 写一个校验脚本，在 commit 前自动修复：

```python
# scripts/validate_frontmatter.py
import yaml
import sys
import re

def fix_frontmatter(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # 提取 frontmatter
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        print(f"❌ No frontmatter: {filepath}")
        return False
    
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        print(f"❌ Invalid YAML: {filepath} - {e}")
        return False
    
    # 必填字段检查
    required = ['title', 'date', 'categories', 'tags', 'description']
    missing = [f for f in required if f not in meta]
    if missing:
        print(f"⚠️ Missing fields {missing}: {filepath}")
        return False
    
    # 日期格式统一
    if isinstance(meta['date'], str):
        # 确保格式为 YYYY-MM-DD HH:MM:SS
        if len(meta['date']) == 10:
            meta['date'] = f"{meta['date']} 00:00:00"
    
    # tags 必须是数组
    if isinstance(meta['tags'], str):
        meta['tags'] = [meta['tags']]
    
    # categories 必须是数组
    if isinstance(meta['categories'], str):
        meta['categories'] = [meta['categories']]
    
    # 重写 frontmatter
    new_fm = yaml.dump(meta, allow_unicode=True, default_flow_style=False)
    new_content = f"---\n{new_fm}---\n{content[match.end():]}"
    
    with open(filepath, 'w') as f:
        f.write(new_content)
    
    print(f"✅ Fixed: {filepath}")
    return True

if __name__ == "__main__":
    for fp in sys.argv[1:]:
        fix_frontmatter(fp)
```

### 坑 3：内链注入导致文章过长

AI 生成的文章本身就有 3000-5000 字，再注入 5 条相关阅读链接，页面变长但用户不一定看。

**解决方案：** 只在文章末尾加 3 条最相关的，且用折叠组件：

```html
<details>
<summary>📖 相关阅读（点击展开）</summary>

- [文章1](链接)
- [文章2](链接)
- [文章3](链接)

</details>
```

### 坑 4：不蒜子服务不稳定

不蒜子是第三方服务，偶尔会挂掉或者加载很慢。

**解决方案：** 加 fallback，3 秒后如果没加载就显示"暂无数据"：

```html
<span id="busuanzi_container_page_pv">
  阅读量: <span id="busuanzi_value_page_pv">...</span>
</span>
<script>
setTimeout(() => {
  const el = document.getElementById('busuanzi_value_page_pv');
  if (el && el.textContent === '...') {
    el.textContent = '暂无数据';
  }
}, 3000);
</script>
```

---

## 七、总结

| 模块 | 工具 | 复杂度 | 投入产出比 |
|------|------|--------|-----------|
| 自动部署 | GitHub Actions | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| AI 选题写作 | Cron + AI Agent | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| SEO 优化 | JSON-LD + Sitemap + 内链 | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 阅读量分析 | Umami + 脚本 | ⭐⭐⭐⭐ | ⭐⭐⭐ |

**推荐的实施顺序：**

1. **先做自动部署**（10 分钟搞定，立刻省去每次 `hexo d` 的麻烦）
2. **再做选题池 + AI 写作**（直接解决"不知道写什么"和"没时间写"的问题）
3. **然后做 SEO 优化**（长期流量增长的基础）
4. **最后做阅读量分析**（有了内容积累后，数据才有意义）

整个工程化改造完成后，我的博客更新频率从"月更"变成了"周更甚至日更"，Google Search Console 的索引量在两个月内翻了一倍。最核心的改变不是工具，而是心态：**博客不再是"灵感驱动的个人表达"，而是"数据驱动的内容产品"**。

当你把写作当成工程来做，持续交付就变成了自然的结果。

---

*本文是 Hexo 博客工程化系列的总览篇。后续会针对每个模块单独展开详细实战。*
