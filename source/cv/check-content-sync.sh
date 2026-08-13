#!/usr/bin/env bash
#
# 检查两份内容源里的日期是否一致。
#
# 这个站有两处独立的内容副本：
#   · resume.html / deck.html   —— 页面自带的 i18n 字典，PDF 和线上版都由它生成
#   · src/*.md                  —— 源文件预览页（view.html）读的 Markdown
#
# 它们没有生成关系，改一处不会同步另一处。真实事故：2026-08-12 确定离职日期后，
# 只把 src/*.md 里的「2022.11 – 至今」改成了「2022.11 – 2026.08」，resume.html
# 没动 —— 重新导出 12 份 PDF，全部还是旧日期。而且导出脚本一切正常、没有任何报错，
# 唯一的症状是 PDF 内容不对。
#
# 所以这里只查一件最容易出错、后果最严重的事：**日期区间**。
# 履历上的日期写错是硬伤，而它恰好是最常改、最容易漏的字段。
#
#   ./check-content-sync.sh          有差异时列出来并退出码 1
#
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY'
import glob, re, sys

# 只认「年.月 – 年.月 / 至今 / Present」这种任职或项目区间。
# 刻意不做全文比对：两份源的措辞本来就不同（一份是页面标记、一份是 Markdown），
# 全文比对会淹没在噪音里，永远没人看。
RANGE = re.compile(
    r'20\d\d(?:\.\d{1,2})?\s*[–—-]\s*(?:20\d\d(?:\.\d{1,2})?|至今|Present|PRESENT)')


def ranges(paths):
    """把一组文件里出现的日期区间收成一个集合，顺带记住每个区间出自哪些文件。"""
    found = {}
    for p in paths:
        for m in RANGE.findall(open(p, encoding='utf-8').read()):
            key = re.sub(r'\s+', ' ', m).strip()
            found.setdefault(key, set()).add(p)
    return found


PAIRS = [
    ('简历', ['resume.html'], sorted(glob.glob('src/resume*.md'))),
    ('简报', ['deck.html'],   sorted(glob.glob('src/deck*.md'))),
]

problems = 0
for label, html, md in PAIRS:
    h, m = ranges(html), ranges(md)
    only_html = sorted(set(h) - set(m))
    only_md = sorted(set(m) - set(h))
    if not only_html and not only_md:
        print(f'✓ {label}：{len(h)} 个日期区间，两边一致')
        continue
    problems += 1
    print(f'✗ {label}：两份内容源的日期对不上')
    for r in only_html:
        print(f'    只在 {html[0]} 里：{r}')
    for r in only_md:
        print(f'    只在 src/ 里：  {r}   ({", ".join(sorted(x.split("/")[-1] for x in m[r]))})')

if problems:
    print('\n改日期要改两处。只改一处的话，导出脚本不会报错，'
          '但产出的 PDF 内容是错的。')
    sys.exit(1)
PY
