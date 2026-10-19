"""把专业词库的表格转换成 Marginal Vocabulary 的词库文件：
    data/finance/*.tsv   -> src/finance.js   （Finance）
    data/medicine/*.tsv  -> src/medicine.js  （Medicine）

用法：
    python3 tools/build_terms.py

每个 TSV 文件一行一个词条，三列用 Tab 分隔：英文术语、中文释义、小类。
可以直接用 Excel 打开编辑（另存时选「制表符分隔的文本」，编码选 UTF-8）。
以 # 开头的行和空行会被忽略。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS = os.path.join(ROOT, "src", "words.js")

# 每本词库：数据目录、输出文件、变量名、去重时优先保留的文件（目录里其他 .tsv 按文件名排在后面）
BOOKS = [
    {
        "name": "Finance",
        "dir": "finance",
        "out": "finance.js",
        "var": "MARGIN_FINANCE",
        "priority": ["finance.tsv", "economics.tsv", "accounting.tsv", "capital_markets.tsv", "governance.tsv", "management.tsv"],
    },
    {
        "name": "Medicine",
        "dir": "medicine",
        "out": "medicine.js",
        "var": "MARGIN_MEDICINE",
        "priority": ["clinical.tsv", "internal_medicine.tsv", "surgery_specialties.tsv", "anatomy.tsv", "basic_sciences.tsv", "pharmacology.tsv"],
    },
]


def load_phonetics():
    """单个单词的术语，从内置考试词库里借音标。"""
    with open(WORDS, encoding="utf-8") as f:
        text = f.read()
    data = json.loads(text[text.index("=") + 1 :].strip().rstrip(";"))
    out = {}
    for line in data.split("\n"):
        w, p = line.split("\t")[:2]
        if p and w.lower() not in out:
            out[w.lower()] = p
    return out


def build(book, phon):
    data = os.path.join(ROOT, "data", book["dir"])
    out = os.path.join(ROOT, "src", book["out"])
    if not os.path.isdir(data):
        print(f"{book['name']}：没有 {data}，跳过")
        return 0
    seen = {}
    rows = []
    problems = 0
    merged = 0
    names = sorted(f for f in os.listdir(data) if f.endswith(".tsv"))
    names = [f for f in book["priority"] if f in names] + [f for f in names if f not in book["priority"]]
    for name in names:
        path = os.path.join(data, name)
        code = name[: -len(".tsv")]
        kept = 0
        with open(path, encoding="utf-8-sig") as f:
            for n, raw in enumerate(f, 1):
                line = raw.rstrip("\r\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                cols = [c.strip() for c in line.split("\t")]
                if len(cols) != 3 or not all(cols):
                    print(f"{name}:{n} 格式不对（需要 3 列）：{line!r}")
                    problems += 1
                    continue
                term, meaning, topic = cols
                key = term.lower()
                if key in seen:
                    # 重复的术语不丢释义：把新的译名并到已收录的那条后面
                    i = seen[key]
                    old = rows[i].split("\t")
                    have = old[2].split("；")
                    add = [t for t in meaning.split("；") if t not in have]
                    if add:
                        old[2] = "；".join(have + add)
                        rows[i] = "\t".join(old)
                        merged += 1
                    continue
                seen[key] = len(rows)
                p = phon.get(key, "") if " " not in term else ""
                rows.append("\t".join([term, p, meaning, code, topic]))
                kept += 1
        print(f"{name}: {kept} 条")

    with open(out, "w", encoding="utf-8") as f:
        f.write(f"// 由 tools/build_terms.py 根据 data/{book['dir']}/*.tsv 生成，请勿手动修改\n")
        f.write("// 每行：术语\\t音标\\t中文释义\\t来源文件\\t小类\n")
        f.write(f"window.{book['var']} = " + json.dumps("\n".join(rows), ensure_ascii=False) + ";\n")
    print(f"{book['name']}：共 {len(rows)} 条（{merged} 条重复术语合并了译名），写入 {out}（{os.path.getsize(out) // 1024} KB）")
    return problems


def main():
    phon = load_phonetics()
    problems = sum(build(book, phon) for book in BOOKS)
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
