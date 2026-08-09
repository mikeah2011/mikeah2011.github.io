#!/usr/bin/env bash
#
# Re-export every résumé PDF from resume.html via Chrome's print pipeline —
# the same one the page's own footer tells a reader to use (⌘P), so what gets
# committed matches what a visitor would print for themselves.
#
# The page is driven entirely by URL params (?v= variant, ?lang= language),
# which is what makes this repeatable: no clicking, no leftover localStorage.
# Theme is irrelevant — the print stylesheet forces the light palette.
#
#   ./export-resume-pdf.sh              # all variants × all languages
#   ./export-resume-pdf.sh lead ai      # only the named variants
#
# Output: downloads/简历_马成军[.<variant>][.<lang>].pdf
# (zh-CN carries no language suffix, matching the existing naming.)
set -euo pipefail

cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8931}"
BASE="简历_马成军"
OUT_DIR="downloads"
TIMEOUT_SECS="${TIMEOUT_SECS:-40}"

[ -x "$CHROME" ] || { echo "✗ Chrome not found at: $CHROME" >&2; exit 1; }

VARIANTS=("$@")
[ ${#VARIANTS[@]} -eq 0 ] && VARIANTS=("" backend lead ai)
LANGS=(zh-CN zh-TW en)

# Serve the folder ourselves: file:// URLs can't fetch the .md sources and
# would leave the page half-rendered.
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://localhost:$PORT/resume.html" && break
  sleep 0.25
done

ok=0; failed=0
for v in "${VARIANTS[@]}"; do
  for lang in "${LANGS[@]}"; do
    query="lang=$lang"
    [ -n "$v" ] && query="$query&v=$v"

    name="$BASE"
    [ -n "$v" ] && name="$name.$v"
    [ "$lang" != "zh-CN" ] && name="$name.$lang"
    out="$OUT_DIR/$name.pdf"

    profile=$(mktemp -d)
    ( "$CHROME" --headless=new --disable-gpu --no-sandbox \
        --user-data-dir="$profile" --no-pdf-header-footer \
        --print-to-pdf="$out" \
        "http://localhost:$PORT/resume.html?$query" >/dev/null 2>&1 ) &
    pid=$!
    for _ in $(seq 1 "$TIMEOUT_SECS"); do kill -0 $pid 2>/dev/null || break; sleep 1; done
    kill -9 $pid 2>/dev/null || true
    wait $pid 2>/dev/null || true
    rm -rf "$profile"

    if [ -s "$out" ]; then
      printf "  ✓ %-38s %s\n" "$name.pdf" "$(ls -lh "$out" | awk '{print $5}')"
      ok=$((ok+1))
    else
      printf "  ✗ %-38s (empty or not written)\n" "$name.pdf"
      failed=$((failed+1))
    fi
  done
done

echo
echo "done — $ok written, $failed failed"
[ "$failed" -eq 0 ]
