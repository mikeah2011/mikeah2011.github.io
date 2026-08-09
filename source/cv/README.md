# 简历站点

线上：**<https://mikeah2011.github.io/cv/>**

Hexo 的 `skip_render: cv/**` 让这个目录原样输出，不经模板渲染 —— 所以它是
一套独立的静态站，改完直接提交即可，不需要 `hexo generate`。

---

## 投递时用的分享链接

按对象挑语言。社交平台的爬虫不执行 JS，只认 HTML 源码里的静态 `og` 标签，
一个 URL 只能声明一张预览图 —— 所以每个语言各有自己的入口，贴出去才会显示
对应语言的卡片。

| 对象 | 链接 |
|------|------|
| 简中 | `https://mikeah2011.github.io/cv/share/zh-CN.html` |
| 繁中 | `https://mikeah2011.github.io/cv/share/zh-TW.html` |
| 英文 | `https://mikeah2011.github.io/cv/share/en.html` |
| 不确定 / 混合场合 | `https://mikeah2011.github.io/cv/` （双语卡片） |

分享页只有 `og` 标签和一段纯 JS 跳转，真人会被送到对应语言的首页，语言会
一路带到简历页和 PDF 下载。

> LinkedIn 与 Facebook 会缓存抓取结果。改过卡片或文案后，到各自的
> Post Inspector / Sharing Debugger 点一次 **Scrape Again** 才会看到新的。

需要更针对性的，可以直接给深链接（同样带上 `lang`）：

```
https://mikeah2011.github.io/cv/resume.html?v=lead&lang=en
```

`v` 可选 `backend` / `lead` / `ai`，省略即通用版；`lang` 可选
`zh-CN` / `zh-TW` / `en`。

---

## 内容从哪来

所有文字都在 `src/*.md`，一处事实、多处产出。命名规则：

```
<base>[.<修饰>][.<语系>].md      简中不带语系后缀
```

`<修饰>` 是投递变体（`backend` / `lead` / `ai`）、`light`（浅色版简报）或
`slidev`（另一种简报格式）。`src/view.html` 就是按这个规则拆装文件名的，
所以切语系时能保持当前变体、切变体时能保持当前语系。

| 文件 | 说明 |
|------|------|
| `src/resume[.<变体>][.<语系>].md` | 简历正文，4 个变体 × 3 个语系 |
| `src/deck[.light][.<语系>].md` | 简报，Marp 源稿 |
| `src/deck.slidev[.<语系>].md` | 同一份简报的 Slidev 源稿 |

变体：通用（无后缀）、`backend`（纯后端）、`lead`（Tech Lead）、`ai`（AI 工程）。

HTML 页面各自内联一份 i18n 字典（`index.html`、`resume.html`、`deck.html`，
以及 `src/view.html` 的界面文案），`assets/cv-ui.js` 负责语言与主题的切换、
持久化和文件链接联动。**改文案时页面字典和 `src/*.md` 要一起改** —— 这两边
没有自动同步，`stats.sh` 也查不出来（它只看 `src/`）。

---

## 脚本

改完内容后按这个顺序跑：

```bash
./export-resume-pdf.sh     # 简历 PDF：4 变体 × 3 语系 = 12 份
./export-deck.sh           # 简报 PDF + PPTX：6 源稿 × 2 格式 = 12 份
./export-og.sh             # 社交卡片 4 张 + share/ 三个入口页
./sync-download-meta.sh    # 把真实页数/体积回写进 index.html 的下载描述
```

都支持只导指定目标，例如 `./export-resume-pdf.sh lead ai`、
`./export-deck.sh deck.md`、`./export-og.sh en`。

`export-resume-pdf.sh` 和 `export-og.sh` 直接调用本机 Chrome（可用环境变量
`CHROME` 覆盖路径）；`export-deck.sh` 走 `npx @marp-team/marp-cli`，它自己
会去找本机的 Chrome / Edge。`sync-download-meta.sh` 和 `stats.sh` 只用 Node。

### 检查

```bash
./sync-download-meta.sh --check   # 下载描述是否与产物一致
./stats.sh                        # 各变体 × 语系的篇幅表
./stats.sh --check                # 有漂移时退出码非 0
```

`stats.sh` 会对三类漂移告警：某变体比同组中位数长 20% 以上、简繁篇幅差超过
3%（多半是漏译）、某变体的英文/中文比值偏离其他变体 8 个百分点以上。

---

## 为什么有这些脚本

这个站点的产出是「一份内容、十几个文件」，历史上栽过三次：

1. 所有 PDF 相对源稿过期了很久，没人发现 → `export-*.sh`
2. 简报的时间轴没跟上简历的改动 → `stats.sh` 的漂移告警
3. 下载描述标着「2 页 1.0 MB」，实际是 3 页 1.1 MB → `sync-download-meta.sh`

能生成的就不手写，能检查的就别靠记性。
