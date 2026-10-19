"""把 ECDICT 词典转换成 Margin 内置词库 src/words.js。

用法：
    python3 tools/build_words.py [ecdict.csv 的路径]

不给路径时，会自动下载 ECDICT（约 65 MB）到 tools/.cache/。
ECDICT 项目：https://github.com/skywind3000/ECDICT （MIT 许可证）
"""

import csv
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache", "ecdict.csv")
OUT = os.path.join(ROOT, "src", "words.js")
URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"

# 顺序决定位掩码，app.js 里的 BUILTIN_BOOKS 必须保持一致
TAGS = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre"]

MAX_LINES = 4
MAX_CHARS = 120


def clean_phonetic(p):
    p = p.strip()
    if not p:
        return ""
    # ECDICT 里混用了一些旧式音标字符，统一成常见写法
    p = p.replace("ә", "ə").replace("є", "ɛ").replace("'", "ˈ")
    return p


def clean_translation(t):
    lines = [ln.strip() for ln in t.replace("\\r", "").split("\\n") if ln.strip()]
    # 去掉 [网络] [计] [医] 这类专业 / 网络释义（包括「art. [计] ...」这种词性后面跟专业标签的）
    general = [ln for ln in lines if not re.sub(r"^([a-z]+\.\s*)+", "", ln).startswith("[")]
    if not general and lines:
        general = [re.sub(r"^\[[^\]]*\]\s*", "", lines[0])]
    out, total = [], 0
    for ln in general[:MAX_LINES]:
        if total + len(ln) > MAX_CHARS and out:
            break
        out.append(ln)
        total += len(ln)
    return "|".join(out)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else CACHE
    if not os.path.exists(src):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        print("下载 ECDICT ...")
        urllib.request.urlretrieve(URL, CACHE)
        src = CACHE

    entries = []
    with open(src, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tags = row["tag"].split()
            mask = 0
            for i, tag in enumerate(TAGS):
                if tag in tags:
                    mask |= 1 << i
            if not mask:
                continue
            meaning = clean_translation(row["translation"])
            if not meaning:
                continue
            frq = int(row["frq"] or 0) or int(row["bnc"] or 0) or 10**9
            entries.append((frq, row["word"].strip(), clean_phonetic(row["phonetic"]), meaning, mask))

    # 常用词排前面：背「新词」时先出现
    entries.sort(key=lambda e: (e[0], e[1].lower()))
    lines = ["\t".join([w, p, m, str(mask)]) for _, w, p, m, mask in entries]
    data = "\n".join(lines)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_words.py 根据 ECDICT（MIT 许可证）生成，请勿手动修改\n")
        f.write("// 每行：单词\\t音标\\t释义（多行用 | 分隔）\\t词库位掩码\n")
        f.write("window.MARGIN_DICT = " + json.dumps(data, ensure_ascii=False) + ";\n")

    counts = {tag: sum(1 for e in entries if e[4] & (1 << i)) for i, tag in enumerate(TAGS)}
    print(f"共 {len(entries)} 个词，写入 {OUT}（{os.path.getsize(OUT) // 1024} KB）")
    print(counts)


if __name__ == "__main__":
    main()
