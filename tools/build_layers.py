"""把考试词库每个词的释义分成「意思层」，写到 data/layers.tsv。

意思相近的词放在同一层（一行），意思不同的分开。判断「相近」用三条规则：
  1. 去掉括号和「的」之后完全一样；
  2. 字面上有两个字以上重合（比如「备用品」「备用零件」）；
  3. 中文词向量足够接近（spaCy zh_core_web_md 里的 fastText 向量，余弦 ≥ 0.5）。
同一个词的几个释义里很少出现反义词，但还是排除了「不 / 无 / 非」开头和只差一个反义字的情况。

data/layers.tsv 每行：单词<Tab>分好层的释义。释义按词性分行，用 | 隔开；
同一词性里，不同的意思层用「；」隔开，同一层里的词用「，」隔开。
这个表也可以手工修改，tools/build_words.py 会优先用它。
表里已有、而且词语和现在的释义对得上的行（包括手工整理过的）原样保留，只给新词或释义变了的词重新分层。

用法（需要 spaCy 的中文模型，只在重新生成这个表时才需要）：
    pip install spacy numpy
    pip install https://github.com/explosion/spacy-models/releases/download/zh_core_web_md-3.8.0/zh_core_web_md-3.8.0-py3-none-any.whl
    python3 tools/build_layers.py
"""

import json
import os
import re
import sys

import numpy as np
from spacy.strings import hash_string
from spacy.vectors import Vectors

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS = os.path.join(ROOT, "src", "words.js")
OUT = os.path.join(ROOT, "data", "layers.tsv")
SIM_T = 0.5

OPPOSITE = set()
for pair in (
    "多空 多少 上下 进出 入出 买卖 大小 长短 高低 增减 加减 升降 涨跌 正负 内外 前后 主被 顺逆 优劣 收支 盈亏 输赢 胜败 "
    "胜负 早晚 新旧 强弱 左右 东西 南北 好坏 真假 是非 有无 开关 借贷 存取 升贬 褒贬 攻守 动静 明暗 首末 始终 生死 得失 "
    "利弊 难易 快慢 轻重 远近 深浅 宽窄 厚薄 粗细 冷热 干湿 软硬 松紧 美丑 善恶 贫富 贵贱 进退 出入 起落 正反 积消 乐悲"
).split():
    OPPOSITE.add(pair)
    OPPOSITE.add(pair[::-1])
NEG = re.compile(r"^[不无非未没]")


def model_vocab():
    try:
        import zh_core_web_md

        path = os.path.join(os.path.dirname(zh_core_web_md.__file__), os.listdir(os.path.dirname(zh_core_web_md.__file__))[0], "vocab")
        if not os.path.isdir(path):
            path = next(
                os.path.join(r, "vocab") for r, d, _ in os.walk(os.path.dirname(zh_core_web_md.__file__)) if "vocab" in d
            )
        return path
    except ImportError:
        if len(sys.argv) > 1:
            return sys.argv[1]
        sys.exit("找不到 zh_core_web_md，先按文件开头的说明安装，或者把它的 vocab 目录作为参数传进来")


V = Vectors().from_disk(model_vocab())
DATA = V.data / (np.linalg.norm(V.data, axis=1, keepdims=True) + 1e-12)


def vec(term):
    key = hash_string(term)
    if key in V.key2row:
        return DATA[V.key2row[key]]
    acc, i = [], 0
    while i < len(term):
        for length in range(min(6, len(term) - i), 0, -1):
            k = hash_string(term[i : i + length])
            if k in V.key2row:
                acc.append(DATA[V.key2row[k]])
                i += length
                break
        else:
            i += 1
    if not acc:
        return None
    v = np.sum(acc, axis=0)
    return v / (np.linalg.norm(v) + 1e-12)


def norm(term):
    t = re.sub(r"[（(\[【][^）)\]】]*[）)\]】]", "", term)
    t = re.sub(r"[^㐀-鿿]", "", t)
    if len(t) > 1:
        t = re.sub(r"^[的地得之]", "", re.sub(r"[的地得]$", "", t))
    return t


def common(a, b):
    best = 0
    for i in range(len(a)):
        for j in range(len(b)):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            best = max(best, k)
    return best


def opposite(a, b):
    if len(a) != len(b) or a == b:
        return False
    diff = [i for i in range(len(a)) if a[i] != b[i]]
    return len(diff) == 1 and a[diff[0]] + b[diff[0]] in OPPOSITE


def same_sense(a, b):
    if a == b:
        return True
    if bool(NEG.match(a)) != bool(NEG.match(b)) or opposite(a, b):
        return False
    if len(a) >= 2 and len(b) >= 2 and common(a, b) >= 2:
        return True
    va, vb = vec(a), vec(b)
    return va is not None and vb is not None and float(va @ vb) >= SIM_T


def split_line(line):
    m = re.match(r"^((?:[a-z]+\.\s*(?:&\s*)?)+)\s*(.*)$", line)
    pos, text = (m.group(1).strip(), m.group(2)) if m else ("", line)
    return pos, [t.strip() for t in re.split(r"[,，;；、]", text) if t.strip()]


def layer_meaning(meaning):
    lines, seen = [], set()
    for line in meaning.split("|"):
        pos, terms = split_line(line)
        items = []
        for t in terms:
            k = norm(t)
            if not k or k in seen:  # 同一个词在别的词性里出现过，算同一层
                continue
            seen.add(k)
            items.append((t, k))
        parent = list(range(len(items)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i in range(len(items)):
            for j in range(i):
                if same_sense(items[i][1], items[j][1]):
                    parent[find(i)] = find(j)
        groups = {}
        for i, (t, _) in enumerate(items):
            groups.setdefault(find(i), []).append(t)
        if groups:
            lines.append((pos + " " if pos else "") + "；".join("，".join(g) for g in groups.values()))
    return "|".join(lines)


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from build_words import term_set

    old = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                if len(cols) == 2:
                    old[cols[0]] = cols[1]
    with open(WORDS, encoding="utf-8") as f:
        text = f.read()
    data = json.loads(text[text.index("=") + 1 :].strip().rstrip(";"))
    rows, fresh = [], 0
    for line in data.split("\n"):
        word, _, meaning = line.split("\t")[:3]
        if word in old and term_set(old[word]) == term_set(meaning):
            rows.append(word + "\t" + old[word])
        else:
            rows.append(word + "\t" + layer_meaning(meaning))
            fresh += 1
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(rows) + "\n")
    print(f"{len(rows)} 个词（{fresh} 个重新分层），写入 {OUT}")


if __name__ == "__main__":
    main()
