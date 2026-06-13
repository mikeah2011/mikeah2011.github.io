#!/usr/bin/env python3
"""统一 categories.json 和 tags.json 中的重复项"""
import json, sys, os

blog_dir = os.path.dirname(os.path.abspath(sys.argv[0]))

def normalize_json(filepath, output_name):
    if not os.path.exists(filepath):
        print(f"  {output_name}: 文件不存在，跳过")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    merged = {}
    for item in data:
        name = item.get('name', item.get('slug', ''))
        lower = name.lower()
        if lower not in merged:
            merged[lower] = {**item, 'name': lower, 'count': 0}
            if 'postList' in item:
                merged[lower]['postList'] = list(item['postList'])
        else:
            merged[lower]['count'] += item.get('count', 0)
            if 'postList' in item:
                merged[lower].setdefault('postList', []).extend(item['postList'])

    result = sorted(merged.values(), key=lambda x: -x.get('count', 0))
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"  {output_name}: {len(data)} → {len(result)} 条目")

# 处理分类
cat_file = os.path.join(blog_dir, "public", "api", "categories.json")
print("=== 处理分类 ===")
normalize_json(cat_file, "categories.json")

# 处理标签
tag_file = os.path.join(blog_dir, "public", "api", "tags.json")
print("\n=== 处理标签 ===")
normalize_json(tag_file, "tags.json")

# 同时处理每个分类的子 JSON
cat_dir = os.path.join(blog_dir, "public", "api", "categories")
if os.path.exists(cat_dir):
    count = 0
    for fn in os.listdir(cat_dir):
        if fn.endswith('.json'):
            fp = os.path.join(cat_dir, fn)
            normalize_json(fp, f"categories/{fn}")
            count += 1
    print(f"\n处理了 {count} 个分类子文件")
