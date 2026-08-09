#!/usr/bin/env bash
#
# 产出社交预览卡片，以及使用这些卡片的分语言分享入口页。
#
#   ./export-og.sh              # 四张卡片 + 三个分享页
#   ./export-og.sh en zh-TW     # 只导指定的卡片（分享页始终重新生成）
#
# 产出：
#   assets/og-cover.png          双语版，主 URL（/cv/、resume.html、deck.html）用
#   assets/og-cover.<lang>.png   单语版，share/<lang>.html 用
#   share/<lang>.html            分语言分享入口，见文件末尾的生成逻辑
#
# 为什么要分语言的入口页：社交平台的爬虫不执行 JS，抓到的永远是 HTML 源码
# 里那组静态 og 标签，一个 URL 只能声明一张图。页面上的语言切换是前端做的，
# 爬虫看不见 —— 所以要按语言显示不同卡片，只能让每个语言各有自己的 URL。
#
# 用 Chrome headless 而不是导设计稿：卡片和站点共用同一套配色与系统字体，
# 改了品牌色重跑一次就同步。
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="assets/og-cover.html"

[ -x "$CHROME" ] || { echo "✗ 找不到 Chrome：$CHROME" >&2; exit 1; }
[ -f "$SRC" ] || { echo "✗ 找不到源文件：$SRC" >&2; exit 1; }

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(bilingual zh-CN zh-TW en)

for t in "${TARGETS[@]}"; do
  # 双语版是默认卡片，落在没有语言后缀的文件名上。
  if [ "$t" = "bilingual" ]; then out="assets/og-cover.png"; else out="assets/og-cover.$t.png"; fi

  # --hide-scrollbars 是必要的：否则 630px 高的视口会挤出一条滚动条，右侧
  # 被切掉约 15px。片段（#$t）用 CSS :target 选中要渲染的那一版，纯 CSS，
  # 首屏就已定妆，不存在脚本没跑完就快门的时序问题。
  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=0a1315 \
    --window-size=1200,630 \
    --screenshot="$out" \
    "file://$PWD/$SRC#$t" >/dev/null 2>&1

  [ -f "$out" ] || { echo "✗ $t 截图失败" >&2; exit 1; }

  read -r w h < <(sips -g pixelWidth -g pixelHeight "$out" 2>/dev/null |
    awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}')
  if [ "$w" != "1200" ] || [ "$h" != "630" ]; then
    echo "✗ $out 尺寸不对：${w}×${h}，应为 1200×630" >&2
    exit 1
  fi

  printf '✓ %-32s %6s  %s×%s\n' "$out" "$(ls -lh "$out" | awk '{print $5}')" "$w" "$h"
done

# ── 分语言分享入口页 ─────────────────────────────────────────
# 三个页面只有文案不同，结构必须一模一样 —— 用一张数据表生成，避免手写三份
# 之后其中一份悄悄跑偏。这是这个项目已经踩过的坑（下载描述过期、简报时间轴
# 没跟上简历），能生成的就不手写。
node <<'NODE'
const fs = require('fs');
// 文案与 index.html 的 i18n 字典逐字一致。
const LANGS = {
  'zh-CN': {
    htmlLang: 'zh-CN', ogLocale: 'zh_CN', site: '马成军 Michael Ma',
    title: '马成军 Michael Ma · 资深后端工程师',
    desc: '13 年研发经验 · 高并发交易系统 · 分布式架构 · AI 工程化',
    alt: '马成军 Michael Ma · 资深后端工程师 · 13 年研发经验',
    redirecting: '正在前往简历…', fallback: '如果没有自动跳转，请点这里'
  },
  'zh-TW': {
    htmlLang: 'zh-TW', ogLocale: 'zh_TW', site: '馬成軍 Michael Ma',
    title: '馬成軍 Michael Ma · 資深後端工程師',
    desc: '13 年研發經驗 · 高並發交易系統 · 分散式架構 · AI 工程化',
    alt: '馬成軍 Michael Ma · 資深後端工程師 · 13 年研發經驗',
    redirecting: '正在前往履歷…', fallback: '如果沒有自動跳轉，請點這裡'
  },
  'en': {
    htmlLang: 'en', ogLocale: 'en_US', site: 'Michael Ma',
    title: 'Michael Ma · Senior Backend Engineer',
    desc: '13 years of experience · High-concurrency transaction systems · Distributed architecture · AI engineering',
    alt: 'Michael Ma · Senior Backend Engineer · 13 Years of Experience',
    redirecting: 'Taking you to the résumé…', fallback: 'Not redirected? Continue here'
  }
};
const BASE = 'https://mikeah2011.github.io/cv';
const ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%230b6e78'/><text x='50' y='69' font-family='-apple-system,BlinkMacSystemFont,Helvetica Neue,Arial,sans-serif' font-size='58' font-weight='800' fill='%23ffffff' text-anchor='middle'>M</text></svg>";

fs.mkdirSync('share', { recursive: true });
for (const [lang, t] of Object.entries(LANGS)) {
  const target = `../index.html?lang=${lang}`;
  fs.writeFileSync(`share/${lang}.html`, `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!--
  由 ../export-og.sh 生成，不要手改 —— 三个语言版本的结构必须保持一致。

  这是一个「分享入口」：社交平台的爬虫不执行 JS，抓到的永远是 HTML 源码里
  那组静态 og 标签，一个 URL 只能声明一张预览图。站点的语言切换是前端做的，
  爬虫看不见 —— 所以要让不同语言的受众看到对应语言的卡片，只能让每个语言
  各有自己的 URL，这就是它们。

  跳转刻意只用 JS，不用 meta refresh：不少爬虫会跟随 meta refresh 然后改读
  目标页的 og 标签，那就前功尽弃了。爬虫不跑 JS，读完标签就停在这里；真人
  会被送到对应语言的简历。

  noindex 是因为这三个页面对搜索引擎是重复内容，真正该被收录的是 canonical
  指向的那一页。这不影响社交预览 —— 抓预览卡片的爬虫不看 robots 指令。
-->
<title>${t.title}</title>
<meta name="description" content="${t.desc}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${BASE}/">
<meta property="og:type" content="profile">
<meta property="og:url" content="${BASE}/share/${lang}.html">
<meta property="og:site_name" content="${t.site}">
<meta property="og:locale" content="${t.ogLocale}">
<meta property="og:title" content="${t.title}">
<meta property="og:description" content="${t.desc}">
<meta property="og:image" content="${BASE}/assets/og-cover.${lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t.alt}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${ICON}">
<style>
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px;
    background: #0a1315; color: #7e959c;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "PingFang TC", sans-serif;
    font-size: 14px;
  }
  a { color: #3fbecb; }
</style>
</head>
<body>
  <p>${t.redirecting}</p>
  <p><a href="${target}">${t.fallback}</a></p>
  <script>location.replace('${target}');</script>
</body>
</html>
`);
  console.log('✓ ' + ('share/' + lang + '.html').padEnd(32) + '→  ' + target);
}
NODE
