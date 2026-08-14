<h1 align="center">Michael's Blog</h1>

<p align="center">
  技术笔记与工程实践 · 1300+ 篇 · Hexo 静态站
</p>

<p align="center">
  <a href="https://mikeah2011.github.io"><img src="https://img.shields.io/badge/%E5%8D%9A%E5%AE%A2-Blog-2b6cb0?style=for-the-badge" alt="博客"></a>
  <a href="https://mikeah2011.github.io/cv/"><img src="https://img.shields.io/badge/%E7%AE%80%E5%8E%86-R%C3%A9sum%C3%A9-0e7c86?style=for-the-badge" alt="简历"></a>
  <a href="https://github.com/mikeah2011"><img src="https://img.shields.io/badge/Profile-%40mikeah2011-24292f?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Profile"></a>
</p>

<p align="center">
  <a href="https://github.com/mikeah2011/mikeah2011.github.io/actions/workflows/pages.yml"><img src="https://github.com/mikeah2011/mikeah2011.github.io/actions/workflows/pages.yml/badge.svg" alt="Pages"></a>
  <a href="https://github.com/mikeah2011/mikeah2011.github.io/actions/workflows/lint-posts.yml"><img src="https://github.com/mikeah2011/mikeah2011.github.io/actions/workflows/lint-posts.yml/badge.svg" alt="Lint posts"></a>
  <img src="https://img.shields.io/badge/Hexo-8.1-0E834D?style=flat-square&logo=hexo&logoColor=white" alt="Hexo 8.1">
  <img src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
  <img src="https://img.shields.io/badge/CC%20BY--NC--SA-4.0-lightgrey?style=flat-square" alt="CC BY-NC-SA 4.0">
</p>

---

个人技术博客的源码仓库。push 到 `main` 后由 GitHub Actions 构建并部署到 GitHub Pages，
`public/` 不入库。

同一个站点下还挂着一套独立的 [简历站点](source/cv/)，它有自己的构建脚本和说明。

## 内容

`source/_posts/` 按分类分目录存放，共 **1317** 篇：

| 分类 | 篇数 | 分类 | 篇数 |
|------|-----:|------|-----:|
| `php` PHP / Laravel / Swoole | 344 | `mobile` iOS / Android / RN | 21 |
| `architecture` 微服务 / DDD / 设计模式 | 247 | `misc` 工具与杂记 | 20 |
| `database` MySQL / Redis / 索引优化 | 148 | `go` Go 与云原生 | 10 |
| `ai` LLM / Agent / RAG / MLOps | 140 | `network` TCP/IP / HTTP / DNS | 9 |
| `devops` Docker / K8s / CI/CD / SRE | 136 | `security` Web 安全 / 认证授权 | 8 |
| `frontend` Vue / TS / 构建工具 | 119 | `mq` Kafka / RabbitMQ | 7 |
| `macos` 开发环境与终端工具链 | 57 | `rust` Rust / 系统编程 | 7 |
| `engineering` 工程实践 / 测试 / 流程 | 42 | `elixir` · `python` | 1 · 1 |

分类的图标、描述与配色定义在 `scripts/patch-categories-chunk.js` 的 `CAT_META` 里，
`_config.yml` 的 `category_map` 负责把历史文章的旧分类名归并过去。

## 本地开发

```bash
npm ci                 # postinstall 会自动打 Aurora 补丁
npm run server         # 本地预览 http://localhost:4000
npm run build:local    # 增量构建（2GB heap，日常改稿够用）
npm run build          # 完整构建 + 分类页补丁，与 CI 一致
npm run clean          # 清掉 db.json 和 public/
```

`db.json` 有 400MB+，已在 `.gitignore` 里。增量构建出问题时先 `npm run clean`。

装 pre-commit 钩子（只需一次）：

```bash
git config core.hooksPath .githooks
```

## 目录

```
source/_posts/<分类>/     文章，按分类分目录
source/images/            图片，文章里一律用 /images/<name> 引用
source/cv/                简历站点，skip_render 原样输出（见其 README）
source/{about,link,message-board,404}/   独立页面
scripts/                  构建脚本与 Hexo 插件（见下）
.github/workflows/        pages.yml 构建部署 · lint-posts.yml 文章校验
_config.yml               Hexo 主配置
_config.aurora.yml        Aurora 主题配置
```

## 构建脚本

Hexo 会把 `scripts/` 下的每个文件当插件自动 require，所以这里混着两类东西 ——
真正的 Hexo 插件，和只在 npm script 里跑的独立脚本。后者用 `require.main === module`
守住，否则 Hexo 加载时会执行到一半报错。

| 脚本 | 时机 | 做什么 |
|------|------|--------|
| `postinstall-patch-aurora.js` | `postinstall` | 给 Aurora 主题打 10 处补丁 |
| `patch-categories-chunk.js` | `build` 之后 | 生成分类页（图标 / 描述 / 计数 / 折叠） |
| `sitemap-cv.js` | Hexo 插件（`after_generate`） | 把 `/cv/` 补进两份 sitemap |
| `sitemap-page-paths.js` | Hexo 插件（`after_generate`，优先级 20） | 核对 sitemap 每条 URL 是否真的有产物 |
| `restore-hexo-generators.js` | Hexo 插件（`before_generate`） | 补回被 Aurora 删掉的 tag / category generator |

补丁全部打在 `node_modules/` 里，不改上游仓库，重装依赖会自动重打。修的都是
Aurora 上游的实际问题：`/categories` 404、slug 里的 `%2F` 编码、SiteGenerator
提前 return 导致构建崩、`baidusitemap` 的双斜杠、`lang="en"` 写死、以及把
`search.json` 从 46MB 截到 ~2MB。改动点和原因都在脚本注释里。

`sitemap-cv.js` 单独存在是因为两个 sitemap 生成器都会主动丢掉 `skip_render`
的页面 —— 简历站正好是 `skip_render` 的，只能事后往路由里补。

`restore-hexo-generators.js` 修的是一个竞态：Aurora 会 `delete` 掉 Hexo 的
`tag` / `category` generator（它假定这些路由由 SPA 前端渲染），而 `package.json`
里又装着这两个 generator 包，谁先执行取决于插件加载顺序，构建之间并不稳定。
结果是 `/tags/<tag>/` 时有时无，退出码始终为 0。脚本注释里有四次构建的实测数据。

`sitemap-page-paths.js` 是这类问题的安全网。sitemap 生成器写的是源码路径，而
Aurora 把自定义页发布在 `/page/` 下，两边对不上；`source/` 里的静态资源也会被
当成页面收进去。它逐条核对 `<loc>` 有没有对应产物，能改写的改写、不能的剔除并
告警 —— 上面那个竞态之所以拖了很久，就是因为没人核对过 sitemap 和产物。

自定义页的发布位置有个例外：front-matter 写 `type: about` 的页面发布到站点根
目录，其余落在 `/page/` 下。`source/about/` 下两个页面都用了这个 —— 导航栏的
「About」写死指向 `/about`，`about/resume.md` 又是专门用来接旧链接的。

## 文章质量校验

图片引用是这个仓库唯一栽过的地方：编辑器写出来的路径本地能看，发布后 404。
所以本地钩子和 CI 各拦一道，规则一致 —— 绝对本地路径（`/Users/…`、`file://`）、
父级逃逸（`../`）、编辑器资源目录（`*.assets/`）一律拒绝。

- 本地：`.githooks/pre-commit`，只扫暂存区里的 `source/_posts/**.md`
- CI：`.github/workflows/lint-posts.yml`，push / PR 时全量扫

图片一律放 `source/images/`，正文里用 `/images/<name>` 引用。
急着提交可以 `git commit --no-verify` 绕过，但 CI 那道拦得住。

## SEO 与产物

`sitemap.xml` / `baidusitemap.xml` / `atom.xml` / `rss.xml` / `robots.txt` 全部构建时生成；
`hexo-yam` 负责 HTML/CSS/JS 的 minify；`hexo-filter-nofollow` 给站外链接加 `nofollow`
（本站与个人 GitHub 除外）。

预压缩（`.gz` / `.br`）**刻意关闭**。GitHub Pages 前面的 Fastly 自己做实时压缩，
不会对静态文件做预压缩内容协商 —— 生成出来只会当裸文件躺着，却要为全站 200MB 的
`api/*.json` 各跑一遍 gzip level 9 和 brotli quality 11。关掉之后构建从 160s 降到
110s，产物从 24689 个文件降到 8527 个。换到自建 Nginx / Cloudflare 再打开。

一次干净构建的开销：**约 110 秒、峰值内存 3～4 GB**。内存主要在堆外（文件 I/O 的
Buffer），所以 `--max-old-space-size` 压不下去 —— 调小只会让 V8 更早 OOM。2GB 内存
的机器跑不动，CI 用的 GitHub 托管 runner（16GB）没问题。

## 版权

文章采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
—— 署名 · 非商用 · 相同方式共享。构建脚本与配置随仓库自由取用。

写错了欢迎开 [Issue](https://github.com/mikeah2011/mikeah2011.github.io/issues) 告诉我 🙏
