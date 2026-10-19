"""生成「英 → 中」判分用的中文词向量 src/vectors.js。

思路：两个中文词如果经常被用来翻译同一批英文单词（比如「好处」和「利益」都是
benefit、advantage、profit 的释义），它们的意思就相近；反义词几乎不会翻译同一个
英文单词，所以这种词向量能把「增加 / 减少」这样的反义词分开。

做法：用 ECDICT 建一个「中文词 × 英文单词」矩阵，做 TF-IDF 加权后用截断 SVD
降到 DIM 维（潜在语义分析，LSA），再量化成 int8 打包进网页，判分完全离线。

用法：
    pip install numpy scipy
    python3 tools/build_vectors.py [ecdict.csv 的路径]
"""

import base64
import csv
import json
import os
import re
import sys
from collections import Counter

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import svds

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache", "ecdict.csv")
OUT = os.path.join(ROOT, "src", "vectors.js")

DIM = 96
MIN_COUNT = 2  # 至少在 2 个英文单词的释义里出现过，才给它一个向量


def terms(line):
    """和 app.js 里的 zhTerms 保持一致：去括号、去词性，按标点拆开。"""
    line = re.sub(r"[（(\[【][^）)\]】]*[）)\]】]", " ", line)
    line = re.sub(r"^([a-z]+\.\s*)+", "", line)
    out = []
    for t in re.split(r"[,，;；、/\s]+", line):
        t = re.sub(r"[^㐀-鿿]", "", t)
        if len(t) > 1:
            t = re.sub(r"^[的地得之]", "", re.sub(r"[的地得]$", "", t))
        if t:
            out.append(t)
    return out


def load_entries(path):
    entries = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            w = r["word"]
            if not re.fullmatch(r"[a-zA-Z][a-zA-Z '\-]*", w):
                continue
            # 只用常见词，去掉大量生僻词条带来的噪声
            if not (r["tag"].strip() or int(r["frq"] or 0) or int(r["bnc"] or 0) or r["collins"] or r["oxford"]):
                continue
            ts = []
            for ln in r["translation"].split("\\n"):
                if not ln or ln.startswith("[") or re.match(r"^([a-z]+\.\s*)+\[", ln):
                    continue
                ts += terms(ln)
            ts = list(dict.fromkeys(ts))
            if ts:
                entries.append(ts)
    return entries


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else CACHE
    if not os.path.exists(src):
        sys.exit(f"找不到 {src}，先运行 python3 tools/build_words.py 下载 ECDICT")

    entries = load_entries(src)
    count = Counter(t for ts in entries for t in ts)
    vocab = sorted((t for t, c in count.items() if c >= MIN_COUNT), key=lambda t: (-count[t], t))
    tid = {t: i for i, t in enumerate(vocab)}

    rows, cols = [], []
    for j, ts in enumerate(entries):
        for t in ts:
            if t in tid:
                rows.append(tid[t])
                cols.append(j)
    m = sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(vocab), len(entries)))
    # 释义很多的英文单词（比如 get、take）区分度低，权重调小
    df = np.maximum(np.asarray(m.sum(axis=0)).ravel(), 1)
    m = m.multiply(1.0 / np.log1p(df)).tocsr()

    u, s, _ = svds(m, k=DIM)
    e = u * np.sqrt(s)
    e /= np.linalg.norm(e, axis=1, keepdims=True) + 1e-12
    q = np.clip(np.round(e * 127), -127, 127).astype(np.int8)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_vectors.py 根据 ECDICT（MIT 许可证）生成，请勿手动修改\n")
        f.write("// 中文词向量（LSA，int8 量化），用于「英 → 中」的近义词判分\n")
        f.write("window.MARGIN_VEC = ")
        json.dump({"dim": DIM, "words": "\t".join(vocab), "data": base64.b64encode(q.tobytes()).decode()}, f, ensure_ascii=False)
        f.write(";\n")
    print(f"{len(entries)} 个英文词条，{len(vocab)} 个中文词，{DIM} 维，写入 {OUT}（{os.path.getsize(OUT) // 1024} KB）")


if __name__ == "__main__":
    main()
