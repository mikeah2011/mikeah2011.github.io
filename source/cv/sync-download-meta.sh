#!/usr/bin/env bash
#
# 把 index.html 里 FILES 表的「页数 · 体积」描述同步成 downloads/ 下的真实值。
#
# 这些描述原本是手写的，每次重新导出 PDF/PPTX 后都会悄悄过期 —— 页数标错
# 或体积差几十 KB，读者不会发现，但它就是不准。导出脚本跑完接着跑这个，
# 描述就不会再和产物脱节。
#
#   ./export-resume-pdf.sh && ./export-deck.sh && ./sync-download-meta.sh
#
# 只改数字，不碰语言词（页/頁/pages/slides）和前缀（A4 / 16:9 / PowerPoint）。
# 用 --check 只报告差异、不写入，适合放进提交前检查。
set -euo pipefail
cd "$(dirname "$0")"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

CHECK=$CHECK node -e '
const fs = require("fs");
const { execFileSync } = require("child_process");
const CHECK = process.env.CHECK === "1";
const FILE = "index.html";

// Spotlight is the only page-count source available without extra tooling;
// Chrome-printed PDFs use compressed object streams, so the count is not
// greppable out of the raw bytes. If Spotlight has not indexed a file it
// returns "(null)" — leave the existing page count alone rather than guess.
function pageCount(f) {
  try {
    const n = execFileSync("mdls", ["-name", "kMDItemNumberOfPages", "-raw", f], {
      encoding: "utf8"
    }).trim();
    return /^\d+$/.test(n) ? Number(n) : null;
  } catch (e) { return null; }
}

function humanSize(bytes) {
  const kb = bytes / 1024;
  return kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB";
}

let html = fs.readFileSync(FILE, "utf8");
const changes = [], missing = [];

html = html.replace(
  /(href:\s*["'"'"'])(downloads\/[^"'"'"']+)(["'"'"']\s*,\s*desc:\s*["'"'"'])([^"'"'"']+)(["'"'"'])/g,
  (all, p1, file, p3, desc, p5) => {
    if (!fs.existsSync(file)) { missing.push(file); return all; }
    let next = desc;

    const pages = pageCount(file);
    if (pages !== null) {
      next = next.replace(/(\d+)(\s*(?:页|頁|pages|slides))/, (m, n, unit) =>
        Number(n) === pages ? m : pages + unit);
    }
    next = next.replace(/[\d.]+\s*(?:KB|MB)\s*$/, humanSize(fs.statSync(file).size));

    if (next !== desc) changes.push([file.replace("downloads/", ""), desc, next]);
    return p1 + file + p3 + next + p5;
  }
);

missing.forEach(f => console.error("缺少文件: " + f));

if (!changes.length) {
  console.log("下载描述与产物一致，无需更新。");
} else {
  const w = Math.max(...changes.map(c => c[0].length)) + 2;
  changes.forEach(c => console.log("  " + c[0].padEnd(w) + c[1] + "  →  " + c[2]));
  if (CHECK) {
    console.error("\n共 " + changes.length + " 处描述与实际产物不符，跑 ./sync-download-meta.sh 修正。");
    process.exit(1);
  }
  fs.writeFileSync(FILE, html);
  console.log("\n已更新 " + changes.length + " 处描述。");
}
if (missing.length) process.exit(1);
'
