#!/usr/bin/env bash
#
# 统计 src/ 下所有简历与简报源稿的篇幅，并对版本间／语系间的漂移发警报。
#
#   ./stats.sh           # 打印表格与警报
#   ./stats.sh --check   # 有警报时退出码非 0，可用于提交前检查
#
# 为什么需要这个：这套内容是「一处事实、多处产出」—— 4 个投递版本 × 3 个
# 语系 × 2 种简报格式。改动只落在其中一份、其他忘了跟上，是这个项目已经
# 踩过两次的坑（PDF 过期、简报时间轴没跟上简历）。篇幅数字对不上，往往
# 就是漏改的第一个征兆。
#
# 计数口径：中日韩汉字按「字」计，拉丁按「词」计 —— wc -w 对中文毫无意义
# （中文没有空格分词）。跨语系的比值只用来横向比较各版本之间是否一致，
# 不代表「英文版信息量少 43%」：一个英文单词本来就约当 1.5–2 个汉字。
set -euo pipefail
cd "$(dirname "$0")"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
export CHECK

node <<'NODE'
const fs = require('fs');
const CHECK = process.env.CHECK === '1';

const LANGS = ['zh-CN', 'zh-TW', 'en'];
const VARIANTS = [
  { key: '', label: '通用' },
  { key: 'backend', label: 'backend' },
  { key: 'lead', label: 'lead' },
  { key: 'ai', label: 'ai' }
];

// 版本比同组中位数长这么多就告警。20% 大约就是「多了一整段」的量级。
const VARIANT_SPREAD = 0.20;
// 简繁之间应该几乎逐句对应，差超过这个比例通常是漏译或多出一段。
const HANT_DRIFT = 0.03;
// 各版本的「英文/中文」比值应该彼此接近；某一版偏离中位数这么多，
// 说明那一版的英文稿单独漂移了。以百分点计。
const EN_RATIO_DRIFT = 8;
// 两种简报源稿是同一份内容的不同格式，汉字数应当几乎相同。
const DECK_DRIFT = 0.03;

// Marp / Slidev 用 `---` 分隔幻灯片，每张之后可以再跟一段属于该页的 YAML
// （layout: / class: / background:）。只剥文件头那一段是不够的 —— 漏掉的
// 那些键名全是拉丁字母，会把词数灌到超过汉字数，让一份中文简报被判成英文稿。
function stripFrontMatter(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  if (lines[0] === '---') {                       // 文件头 front matter
    for (i = 1; i < lines.length && lines[i] !== '---'; i++);
    i++;
  }
  for (; i < lines.length; i++) {
    if (lines[i].trim() !== '---') { out.push(lines[i]); continue; }
    // 分隔符本身丢弃；紧随其后的连续 `key:` 行是该页配置，一并丢弃。
    // 要求紧邻，正文里的「GitHub: ...」这类行才不会被误伤。
    let j = i + 1;
    while (j < lines.length && /^[A-Za-z][\w-]*\s*:/.test(lines[j])) j++;
    i = j - 1;
  }
  return out.join('\n');
}
function strip(md) {
  return stripFrontMatter(md)
    .replace(/```[\s\S]*?```/g, '')              // 代码块
    // 连内容一起丢：Slidev 源稿内联了一整段 CSS，只剥 <style> 标签会把
    // 几十行选择器和属性名当成正文词汇，凭空多出几百个「词」。
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')                    // 其余内联 HTML 标签
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // 链接保留可见文字
    .replace(/[#*_>|`~-]/g, ' ');
}
function count(file) {
  const body = strip(fs.readFileSync(file, 'utf8'));
  const cjk = (body.match(/[一-鿿]/g) || []).length;
  const latin = (body.match(/[A-Za-z][A-Za-z0-9@.'+-]*/g) || []).length;
  return { cjk, latin, total: cjk + latin };
}
// 只数汉字，可以绕开 Marp / Slidev 各自的标记开销，直接比内容本身。
function cjkOnly(file) {
  return (fs.readFileSync(file, 'utf8').match(/[一-鿿]/g) || []).length;
}
const resumeFile = (v, l) =>
  'src/resume' + (v ? '.' + v : '') + (l === 'zh-CN' ? '' : '.' + l) + '.md';
const deckFile = (base, l) =>
  'src/' + base + (l === 'zh-CN' ? '' : '.' + l) + '.md';

const median = ns => {
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pad = (s, n) => String(s).padStart(n);
const warnings = [];

// ── 简历 ─────────────────────────────────────────────────────
const rows = VARIANTS.map(v => {
  const cells = {};
  for (const l of LANGS) cells[l] = count(resumeFile(v.key, l)).total;
  return { ...v, cells, enRatio: cells.en / cells['zh-CN'] * 100 };
});

// 表头写明「字+词」：这里是汉字数与拉丁词数的合计，衡量的是「页面上有多少
// 内容」。view.html 标题栏那个数字只取占多数的一种口径（因为它得配一个诚实
// 的单位标签），所以两边对同一份文件会给出不同的数 —— 各自都对，别对着比。
console.log('简历            ' + LANGS.map(l => pad(l, 10)).join('') + pad('en/zh', 10) + '   (字+词)');
rows.forEach(r =>
  console.log(r.label.padEnd(14) + LANGS.map(l => pad(r.cells[l], 10)).join('') +
              pad(r.enRatio.toFixed(0) + '%', 10)));

// 跨度常驻打印，而不是靠警报才浮现：最长/最短版本的比值是「哪一版该瘦」
// 的直接答案，但它长期偏高可能是刻意的。做成永远消不掉的警报只会被忽略，
// 做成每次都看得到的一行数字才有用。
const longest = rows.reduce((a, b) => a.cells['zh-CN'] >= b.cells['zh-CN'] ? a : b);
const shortest = rows.reduce((a, b) => a.cells['zh-CN'] <= b.cells['zh-CN'] ? a : b);
console.log('跨度            最长 ' + longest.label + ' ' + longest.cells['zh-CN'] +
            '　最短 ' + shortest.label + ' ' + shortest.cells['zh-CN'] +
            '　= ' + (longest.cells['zh-CN'] / shortest.cells['zh-CN']).toFixed(2) + '×');

const baseMedian = median(rows.map(r => r.cells['zh-CN']));
rows.forEach(r => {
  const over = r.cells['zh-CN'] / baseMedian - 1;
  if (over > VARIANT_SPREAD)
    warnings.push(`简历「${r.label}」比同组中位数长 ${(over * 100).toFixed(0)}%` +
                  `（${r.cells['zh-CN']} vs ${baseMedian}）—— 确认是刻意保留还是没跟着精简`);

  const drift = Math.abs(r.cells['zh-TW'] - r.cells['zh-CN']) / r.cells['zh-CN'];
  if (drift > HANT_DRIFT)
    warnings.push(`简历「${r.label}」简繁篇幅差 ${(drift * 100).toFixed(1)}%` +
                  `（${r.cells['zh-CN']} vs ${r.cells['zh-TW']}）—— 可能有段落漏译或多出`);
});

const ratioMedian = median(rows.map(r => r.enRatio));
rows.forEach(r => {
  const off = Math.abs(r.enRatio - ratioMedian);
  if (off > EN_RATIO_DRIFT)
    warnings.push(`简历「${r.label}」的英文/中文比值 ${r.enRatio.toFixed(0)}% ` +
                  `偏离其他版本（中位数 ${ratioMedian.toFixed(0)}%）—— 该版英文稿可能单独漂移了`);
});

// ── 简报 ─────────────────────────────────────────────────────
console.log('\n简报            ' + LANGS.map(l => pad(l, 10)).join(''));
for (const base of ['deck', 'deck.slidev'])
  console.log(base.padEnd(14) + LANGS.map(l => pad(count(deckFile(base, l)).total, 10)).join(''));

for (const l of LANGS) {
  if (l === 'en') continue; // 英文稿没有汉字可比，跳过
  const marp = cjkOnly(deckFile('deck', l));
  const slidev = cjkOnly(deckFile('deck.slidev', l));
  const drift = Math.abs(slidev - marp) / marp;
  if (drift > DECK_DRIFT)
    warnings.push(`简报 ${l} 的 Marp 与 Slidev 源稿汉字数差 ${(drift * 100).toFixed(1)}%` +
                  `（${marp} vs ${slidev}）—— 两份源稿的内容可能不同步了`);
}

// ── 结果 ─────────────────────────────────────────────────────
if (!warnings.length) {
  console.log('\n✓ 各版本与语系篇幅一致，未发现漂移。');
} else {
  console.log('');
  warnings.forEach(w => console.log('⚠ ' + w));
  if (CHECK) process.exit(1);
}
NODE
