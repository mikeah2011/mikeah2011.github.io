#!/usr/bin/env bash
#
# 修正 downloads/ 下 PDF 的文字抽取编码，并校验结果。
#
#   ./fix-pdf-text.sh           # 修所有 PDF
#   ./fix-pdf-text.sh --check   # 只报告，有问题时退出码非 0
#
# 问题：Chrome 内嵌 PingFang 子集时，生成的 /ToUnicode 对照表把一部分字形指
# 到了「康熙部首」「CJK 部首补充」区的码位，而不是真正的汉字 —— 字形几乎一
# 样，人眼完全看不出，只有文字抽取时才现形：
#
#     马成军  →  ⻢成军        (U+9A6C → U+2EE2)
#     高并发  →  ⾼并发        (U+9AD8 → U+2FBC)
#     技术负责人 → 技术负责⼈   (U+4EBA → U+2F08)
#
# 每份中文简历有 160–200 处。这对海投是实伤：ATS 用中文关键词检索时，
# 「高并发」匹配不到「⾼并发」，等于这些关键词在机器眼里根本不存在。
#
# 修法：只改 /ToUnicode 对照表，把部首码位映射回统一汉字。ToUnicode 只用于
# 文字抽取与复制，不参与字形渲染 —— 所以 PDF 的外观一个像素都不会变。
#
# 为什么不换字体：系统上只有 STHeiti 的子集映射是干净的，但它只有 Light 和
# Medium 两个字重，简历刻意建立的粗细层级会塌。
#
# 只处理简历 PDF，不动简报 —— 不是漏了。pypdf 会重写整个文件，而它写的是
# 传统 xref 表，复现不了 Marp 原本的对象流压缩：简报因此凭空涨 70–80%
# （实测过：不做任何修改、只是 clone 再 write，就已经涨 70%）。简历只涨
# 0.8%，代价可以忽略。
#
# 这个取舍的依据是「谁在读这个文件」：简历要过 ATS 的机器解析，抽取编码错
# 了等于关键词不存在；简报是人打开来看的，抽取只影响复制粘贴，不值得拿
# 八成的下载体积去换。简报的抽取编码因此仍是坏的 —— 是知情的选择，不是遗漏。
#
# 幂等：已经修过的 PDF 里没有部首码位可改，重跑无副作用。
set -euo pipefail
cd "$(dirname "$0")"

python3 -c 'import pypdf' 2>/dev/null || {
  echo "✗ 需要 pypdf：pip3 install pypdf" >&2; exit 1; }

python3 - "$@" <<'PY'
import sys, re, glob, zlib, unicodedata as ud
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject

CHECK = '--check' in sys.argv[1:]

# 「康熙部首」U+2F00–2FDF 与「CJK 部首补充」U+2E80–2EFF。前者绝大多数有 NFKC
# 兼容分解，可以自动还原；后者（简体专用的那几个）没有，只能手工列。
RADICAL_RANGES = ((0x2E80, 0x2EFF), (0x2F00, 0x2FDF))
# 简繁各有自己的码位，别混：⻓ U+2ED3 是简体的「长」，⻑ U+2ED1 是繁体的
# 「長」—— 后者出现在繁中简报的「年增長 200%」里。其余繁体字（頁齊馬見車門）
# 落在康熙部首区，NFKC 自己能还原，不用列在这。
MANUAL = {
    0x2ED1: 0x9577,  # ⻑ → 長（繁）
    0x2ED2: 0x9577,  # ⻒ → 長（繁，另一变体）
    0x2ED3: 0x957F,  # ⻓ → 长（简）
    0x2EDA: 0x9875,  # ⻚ → 页
    0x2EEC: 0x9F50,  # ⻬ → 齐
    0x2EE2: 0x9A6C,  # ⻢ → 马
    0x2EC5: 0x89C1,  # ⻅ → 见
    0x2ECB: 0x8F66,  # ⻋ → 车
    0x2ED4: 0x95E8,  # ⻔ → 门
}

def is_radical(cp):
    return any(lo <= cp <= hi for lo, hi in RADICAL_RANGES)

def unify(cp):
    """部首码位 → 统一汉字码位；无从判断时返回 None（宁可不改）。"""
    if cp in MANUAL:
        return MANUAL[cp]
    if is_radical(cp):
        n = ud.normalize('NFKC', chr(cp))
        if len(n) == 1 and 0x3400 <= ord(n) <= 0x9FFF:
            return ord(n)
    return None

# CMap 里源码位和目标码位都写成 <hex>，形状一样 —— 不能整体正则替换，否则
# 会把「源码位恰好长得像部首码位」的那些也一起改掉，映射表就废了。所以按
# bfchar / bfrange 的结构走一遍，只碰目标位置。
TOKEN = re.compile(rb'<([0-9A-Fa-f]+)>|(\[)|(\])|\b(beginbfchar|endbfchar|beginbfrange|endbfrange)\b')

def remap_cmap(data):
    out, pos, changed = bytearray(), 0, 0
    mode, slot, in_array = None, 0, False

    for m in TOKEN.finditer(data):
        hexval, lbracket, rbracket, kw = m.groups()
        out += data[pos:m.start()]
        pos = m.end()

        if kw:
            kw = kw.decode()
            mode = kw[5:] if kw.startswith(b'begin'.decode()) else None
            slot, in_array = 0, False
            out += m.group(0)
            continue
        if lbracket:
            in_array = True
            out += m.group(0)
            continue
        if rbracket:
            in_array = False
            slot = 0            # 数组结束即一条 bfrange 记录结束
            out += m.group(0)
            continue

        # 是否落在「目标码位」这一格：
        #   bfchar  每两个一组 (src, dst) → 第 2 个
        #   bfrange 每三个一组 (lo, hi, dst) → 第 3 个；dst 为数组时全是目标
        if mode == 'bfchar':
            is_dst = (slot % 2 == 1)
            slot += 1
        elif mode == 'bfrange':
            is_dst = in_array or (slot % 3 == 2)
            if not in_array:
                slot += 1
        else:
            is_dst = False

        token = m.group(0)
        if is_dst:
            raw = bytes.fromhex(hexval.decode())
            if len(raw) % 2 == 0:
                cps = [int.from_bytes(raw[i:i+2], 'big') for i in range(0, len(raw), 2)]
                fixed = [unify(c) or c for c in cps]
                if fixed != cps:
                    changed += sum(1 for a, b in zip(cps, fixed) if a != b)
                    token = b'<' + b''.join(c.to_bytes(2, 'big') for c in fixed).hex().upper().encode() + b'>'
        out += token

    out += data[pos:]
    return bytes(out), changed

def font_objects(reader):
    """页面资源里的字体，含 XObject 里嵌套的那些。"""
    seen = set()
    def walk(res):
        if not res: return
        for key in ('/Font', '/XObject'):
            d = res.get(key)
            if not d: continue
            for obj in d.get_object().values():
                obj = obj.get_object()
                if id(obj) in seen: continue
                seen.add(id(obj))
                if key == '/Font':
                    yield obj
                else:
                    yield from walk(obj.get('/Resources'))
    for page in reader.pages:
        yield from walk(page.get('/Resources'))

def scan_text(path):
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(path).pages)
    return [c for c in txt if is_radical(ord(c))]

files = sorted(glob.glob('downloads/简历_马成军*.pdf'))   # 见文件头：刻意不含简报
if not files:
    print('downloads/ 下没有简历 PDF'); sys.exit(0)

bad_after, total_fixed, touched = 0, 0, 0
for path in files:
    before = scan_text(path)
    if not before:
        continue

    if CHECK:
        print(f'✗ {path.replace("downloads/", ""):40} {len(before):4} 处部首码位  '
              f'{"".join(sorted(set(before)))}')
        bad_after += len(before)
        continue

    writer = PdfWriter(clone_from=path)
    fixed = 0
    for font in font_objects(writer):
        tu = font.get('/ToUnicode')
        if tu is None:
            continue
        stream = tu.get_object()
        data = stream.get_data()
        new, n = remap_cmap(data)
        if not n:
            continue
        # 写回时重新用 Flate 压缩。曾经图省事直接写未压缩的流 —— 简历只涨了
        # 1.6%，但 Marp 简报每页都带自己的字体子集，CMap 数量多，体积一下涨了
        # 七成到八成。压回去之后增量可以忽略。
        stream._data = zlib.compress(new, 9)
        stream[NameObject('/Filter')] = NameObject('/FlateDecode')
        stream[NameObject('/Length')] = NumberObject(len(stream._data))
        stream.pop(NameObject('/DecodeParms'), None)
        fixed += n

    if fixed:
        with open(path, 'wb') as fh:
            writer.write(fh)
        after = scan_text(path)
        status = '✓' if not after else f'✗ 仍余 {len(after)} 处'
        print(f'{status} {path.replace("downloads/", ""):40} 修正 {fixed:4} 处映射')
        bad_after += len(after)
        total_fixed += fixed
        touched += 1

if CHECK:
    if bad_after:
        print(f'\n共 {bad_after} 处抽取编码有问题，跑 ./fix-pdf-text.sh 修正。')
        sys.exit(1)
    print('✓ 所有 PDF 的文字抽取编码正确。')
else:
    if not touched:
        print('✓ 所有 PDF 的文字抽取编码已正确，无需修改。')
    else:
        print(f'\n共修正 {touched} 个文件、{total_fixed} 处映射。')
    sys.exit(1 if bad_after else 0)
PY
