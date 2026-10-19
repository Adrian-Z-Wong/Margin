"""把 ECDICT 词典转换成 Margin 内置词库 src/words.js。

用法：
    python3 tools/build_words.py [ecdict.csv 的路径]

不给路径时，会自动下载 ECDICT（约 65 MB）到 tools/.cache/。
ECDICT 项目：https://github.com/skywind3000/ECDICT （MIT 许可证）

补充词表：data/gre.tsv（ECDICT 的 GRE 标签以外补充的 GRE 词）和 data/gmat.tsv（GMAT 词表），
每行：单词<Tab>中文释义。释义优先用 ECDICT 的，ECDICT 里查不到时才用表里写的；
表里写的释义判分时也算对。
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
# 补充词表：标签 -> 文件
EXTRA = {"gre": os.path.join(ROOT, "data", "gre.tsv"), "gmat": os.path.join(ROOT, "data", "gmat.tsv")}
LAYERS = os.path.join(ROOT, "data", "layers.tsv")
URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"

# 顺序决定位掩码，app.js 里的 EXAM_BOOKS 必须保持一致；gmat 只来自 data/gmat.tsv
TAGS = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "gmat"]

MAX_LINES = 4
MAX_CHARS = 120


def clean_phonetic(p):
    p = p.strip()
    if not p:
        return ""
    # ECDICT 里混用了一些旧式音标字符，统一成常见写法
    p = p.replace("ә", "ə").replace("є", "ɛ").replace("'", "ˈ")
    return p


def general_lines(t):
    lines = [ln.strip() for ln in t.replace("\\r", "").split("\\n") if ln.strip()]
    # 去掉 [网络] [计] [医] 这类专业 / 网络释义（包括「art. [计] ...」这种词性后面跟专业标签的）
    general = [ln for ln in lines if not re.sub(r"^([a-z]+\.\s*)+", "", ln).startswith("[")]
    if not general and lines:
        general = [re.sub(r"^\[[^\]]*\]\s*", "", lines[0])]
    return general


def clean_translation(t):
    """显示用的释义：最多 MAX_LINES 行、MAX_CHARS 个字。"""
    out, total = [], 0
    for ln in general_lines(t)[:MAX_LINES]:
        if total + len(ln) > MAX_CHARS and out:
            break
        out.append(ln)
        total += len(ln)
    return "|".join(out)


def extra_translation(t, shown):
    """判分用：显示时被截掉的那部分释义，写对这些意思也算对。"""
    rest = [ln for ln in general_lines(t) if ln not in shown.split("|")]
    return "|".join(rest)


def term_set(meaning):
    """释义里的中文词语集合（去掉词性、标点、重复），用来确认分层前后意思没变。"""
    out = set()
    for line in meaning.split("|"):
        line = re.sub(r"^((?:[a-z]+\.\s*(?:&\s*)?)+)", "", line.strip())
        for t in re.split(r"[,，;；、]", line):
            t = re.sub(r"[（(\[【][^）)\]】]*[）)\]】]", "", t)
            t = re.sub(r"[^\u3400-\u9fffA-Za-z0-9]", "", t)
            if len(t) > 1:
                t = re.sub(r"^[的地得之]", "", re.sub(r"[的地得]$", "", t))
            if t:
                out.add(t)
    return out


def load_layers():
    """data/layers.tsv：每个词分好「意思层」的释义（见 tools/build_layers.py）。"""
    layers = {}
    if os.path.exists(LAYERS):
        with open(LAYERS, encoding="utf-8") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                if len(cols) == 2:
                    layers[cols[0]] = cols[1]
    return layers


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else CACHE
    if not os.path.exists(src):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        print("下载 ECDICT ...")
        urllib.request.urlretrieve(URL, CACHE)
        src = CACHE

    extra_lists = {}  # 小写单词 -> [写法, 释义, 位掩码]
    for tag, path in EXTRA.items():
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                cols = [c.strip() for c in line.rstrip("\r\n").split("\t")]
                if cols and cols[0] and not cols[0].startswith("#"):
                    key = cols[0].lower()
                    item = extra_lists.setdefault(key, [cols[0], "", 0])
                    item[2] |= 1 << TAGS.index(tag)
                    if len(cols) > 1 and cols[1] and cols[1] not in item[1].split("|"):
                        item[1] = "|".join(x for x in (item[1], cols[1]) if x)
    layers = load_layers()
    layered = 0

    entries = []
    found = set()
    with open(src, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            word = row["word"].strip()
            tags = row["tag"].split()
            mask = 0
            for i, tag in enumerate(TAGS):
                if tag in tags:
                    mask |= 1 << i
            key = word.lower()
            # ECDICT 里同一个词可能有大小写不同的几条（Polish / polish），只认小写的那条或和表里写法一致的那条
            listed = key in extra_lists and key not in found and (word == key or word == extra_lists[key][0])
            if listed:
                mask |= extra_lists[key][2]
                found.add(key)
            if not mask:
                continue
            meaning = clean_translation(row["translation"])
            if not meaning and listed:
                meaning = extra_lists[key][1]
            if not meaning:
                continue
            extra = extra_translation(row["translation"], meaning)
            # 用分好层的释义来显示；词语和原释义对不上时（比如词典更新了）就不用
            if word in layers and term_set(layers[word]) == term_set(meaning):
                meaning = layers[word]
                layered += 1
            if listed and extra_lists[key][1]:
                # 补充词表里写的语境释义，判分时也算对
                extra = "|".join(x for x in (extra, extra_lists[key][1]) if x)
            frq = int(row["frq"] or 0) or int(row["bnc"] or 0) or 10**9
            entries.append((frq, word, clean_phonetic(row["phonetic"]), meaning, mask, extra))

    # ECDICT 里查不到的补充词（多是固定搭配），用表里写的释义
    for key, (word, meaning, mask) in extra_lists.items():
        if key not in found and meaning:
            if word in layers and term_set(layers[word]) == term_set(meaning):
                meaning = layers[word]
                layered += 1
            entries.append((10**9, word, "", meaning, mask, ""))

    # 常用词排前面：背「新词」时先出现
    entries.sort(key=lambda e: (e[0], e[1].lower()))
    lines = ["\t".join([w, p, m, str(mask), x]) for _, w, p, m, mask, x in entries]
    data = "\n".join(lines)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_words.py 根据 ECDICT（MIT 许可证）生成，请勿手动修改\n")
        f.write("// 每行：单词\\t音标\\t释义（多行用 | 分隔）\\t词库位掩码\\t判分时额外接受的释义\n")
        f.write("window.MARGIN_DICT = " + json.dumps(data, ensure_ascii=False) + ";\n")

    counts = {tag: sum(1 for e in entries if e[4] & (1 << i)) for i, tag in enumerate(TAGS)}
    print(f"共 {len(entries)} 个词（{layered} 个用了分好层的释义），写入 {OUT}（{os.path.getsize(OUT) // 1024} KB）")
    print(counts)


if __name__ == "__main__":
    main()
