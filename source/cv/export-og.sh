#!/usr/bin/env bash
#
# 把 assets/og-cover.html 截成 assets/og-cover.png（1200×630）——
# 贴连结到 LINE / Slack / 微信 / X 时显示的那张预览卡片图。
#
#   ./export-og.sh
#
# 用 Chrome headless 而不是找设计稿导出，是为了让这张图和站点用同一套
# CSS 变量、同一批系统字体：改了品牌色，重跑一次就同步了。
#
# 注意：社交平台的爬虫不执行 JS，抓到的永远是 HTML 源码里那份 og 标签，
# 也就是简中版。这张图因此固定是简中，切语言不影响它。
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="assets/og-cover.html"
OUT="assets/og-cover.png"

[ -x "$CHROME" ] || { echo "✗ 找不到 Chrome：$CHROME" >&2; exit 1; }
[ -f "$SRC" ] || { echo "✗ 找不到源文件：$SRC" >&2; exit 1; }

# --hide-scrollbars 是必要的：否则 630px 高的视口会挤出一条滚动条，
# 右侧被切掉约 15px。--default-background-color 防止透明底。
"$CHROME" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --force-device-scale-factor=1 \
  --default-background-color=0a1315 \
  --window-size=1200,630 \
  --screenshot="$OUT" \
  "file://$PWD/$SRC" >/dev/null 2>&1

[ -f "$OUT" ] || { echo "✗ 截图失败" >&2; exit 1; }

read -r w h < <(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null |
  awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}')
if [ "$w" != "1200" ] || [ "$h" != "630" ]; then
  echo "✗ 尺寸不对：${w}×${h}，应为 1200×630" >&2
  exit 1
fi

echo "✓ $OUT  ($(ls -lh "$OUT" | awk '{print $5}')  ${w}×${h})"
