#!/usr/bin/env bash
#
# Re-export every deck artifact from the Marp sources in src/.
#
#   ./export-deck.sh            # all 6 sources × PDF + PPTX = 12 artifacts
#   ./export-deck.sh deck.md    # only the named source(s)
#
# --html is REQUIRED, not optional: the slides embed inline <svg> icons, and
# Marp CLI escapes raw HTML by default regardless of the `html: true` front
# matter. Without it every icon silently renders as its literal markup — the
# failure looks like flaky rendering but is entirely deterministic.
#
# --allow-local-files is what lets Chrome read the sources off disk during
# conversion; Marp warns about it, which is expected here since the input is
# our own repo.
#
# Output: downloads/简历简报_马成军[.<lang>][.light].{pdf,pptx}
set -euo pipefail

cd "$(dirname "$0")"

MARP="${MARP:-npx --yes @marp-team/marp-cli@4.5.0}"
OUT_DIR="downloads"
BASE="简历简报_马成军"

# source file → output suffix. Slidev sources are for reading, not exporting.
declare -a SOURCES=(
  "deck.md::"
  "deck.light.md::.light"
  "deck.zh-TW.md::.zh-TW"
  "deck.light.zh-TW.md::.zh-TW.light"
  "deck.en.md::.en"
  "deck.light.en.md::.en.light"
)

# Optional filter: only export sources whose filename was passed in.
if [ $# -gt 0 ]; then
  filtered=()
  for entry in "${SOURCES[@]}"; do
    for want in "$@"; do
      [ "${entry%%::*}" = "$want" ] && filtered+=("$entry")
    done
  done
  SOURCES=("${filtered[@]}")
  [ ${#SOURCES[@]} -eq 0 ] && { echo "✗ no matching source" >&2; exit 1; }
fi

ok=0; failed=0
for entry in "${SOURCES[@]}"; do
  src="src/${entry%%::*}"
  suffix="${entry##*::}"
  [ -f "$src" ] || { echo "  ✗ missing source: $src"; failed=$((failed+1)); continue; }

  for fmt in pdf pptx; do
    out="$OUT_DIR/$BASE$suffix.$fmt"
    if $MARP --"$fmt" --html --allow-local-files -o "$out" "$src" >/dev/null 2>&1 && [ -s "$out" ]; then
      printf "  ✓ %-38s %s\n" "$(basename "$out")" "$(ls -lh "$out" | awk '{print $5}')"
      ok=$((ok+1))
    else
      printf "  ✗ %-38s (export failed)\n" "$(basename "$out")"
      failed=$((failed+1))
    fi
  done
done

echo
echo "done — $ok written, $failed failed"

# 注意：简报 PDF 的文字抽取编码是坏的（PingFang 子集把部分汉字映射到康熙
# 部首码位），这里刻意不修 —— 见 fix-pdf-text.sh 文件头的取舍说明。简报是
# 人打开来看的，修它要付 70–80% 的体积代价。

[ "$failed" -eq 0 ]
