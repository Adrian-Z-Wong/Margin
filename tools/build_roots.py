"""把 data/roots/ 合成「词根」板块的数据 src/roots.js。

data/roots/*.json：词根词缀表。每个文件是一个数组，每项：
  type      prefix（前缀）/ root（词根）/ suffix（后缀）
  forms     各种拼写形式，最常见的在前
  meaning   中文意思
  origin    来源，如「拉丁语 specere「看」」
  note      记忆提示（可以为空）
  examples  例词：[{"w": 单词, "parts": 拆解, "m": 中文意思}]

data/roots/words.tsv：词库里单词的拆解，每行「单词<Tab>拆解」，例如
  invisible	in-(不) + vis(看) + -ible(能…的)
前缀后面带连字符，后缀前面带连字符，词根不带；连接字母不写意思。
拆解里的语素按拼写和意思自动对应到词根表，词根页据此列出各个词库里含这个词根的词。

用法：
    python3 tools/build_roots.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "roots")
WORDS = os.path.join(DATA, "words.tsv")
OUT = os.path.join(ROOT, "src", "roots.js")
ORDER = {"prefix": 0, "root": 1, "suffix": 2}
TOKEN = re.compile(r"^(-?)([A-Za-z]+)(-?)(?:\s*\((.*)\))?$")
CJK = re.compile(r"[㐀-鿿]")


def load_roots():
    items, seen, problems = [], set(), 0
    for name in sorted(f for f in os.listdir(DATA) if f.endswith(".json")):
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            for x in json.load(f):
                forms = []
                for s in x.get("forms", []):
                    s = s.strip().strip("-").lower()
                    if s and s not in forms:
                        forms.append(s)
                if x.get("type") not in ORDER or not forms or not x.get("meaning") or not x.get("examples"):
                    print(f"{name}：跳过不完整的条目 {x.get('forms')}")
                    problems += 1
                    continue
                key = x["type"] + ":" + forms[0]
                if key in seen:
                    # 同形不同义（如 -en「使…」和 -en「…制的」）分成两条
                    def core(m):
                        return set(CJK.findall(re.sub(r"(名词|形容词|动词|副词)?(前缀|后缀)|名词|形容词|动词", "", m))) - set("的使")

                    if any(r["id"].split("~")[0] == key and core(x["meaning"]) & core(r["meaning"]) for r in items):
                        print(f"{name}：重复 {key}")
                        continue
                    n = 2
                    while f"{key}~{n}" in seen:
                        n += 1
                    key = f"{key}~{n}"
                seen.add(key)
                examples = [
                    {"w": e["w"].strip(), "parts": e.get("parts", "").strip(), "m": e.get("m", "").strip()}
                    for e in x["examples"]
                    if e.get("w")
                ]
                items.append(
                    {
                        "id": key,
                        "type": x["type"],
                        "forms": forms,
                        "meaning": x["meaning"].strip(),
                        "origin": x.get("origin", "").strip(),
                        "note": x.get("note", "").strip(),
                        "examples": examples,
                    }
                )
    items.sort(key=lambda x: (ORDER[x["type"]], x["forms"][0]))
    return items, problems


def parse(parts):
    """拆解 -> [(拼写, 类型或 None, 意思)]；类型由连字符决定，没有连字符时是 None。"""
    out = []
    for tok in re.split(r"\s*\+\s*", parts.strip()):
        m = TOKEN.match(tok.strip())
        if not m:
            return None
        lead, form, trail, gloss = m.groups()
        kind = "suffix" if lead else "prefix" if trail else None
        out.append((form, kind, (gloss or "").strip()))
    return out


def display(tokens):
    return " + ".join(f + (f"({g})" if g else "") for f, _, g in tokens)


class Linker:
    def __init__(self, roots):
        self.by_form = {}
        for r in roots:
            for f in r["forms"]:
                self.by_form.setdefault(f, []).append(r)

    def link(self, tokens, owner=None):
        """每个有意思的语素对应到词根表里的一项：先按类型，再按意思里相同的字挑。"""
        links, at, n = [], 0, len(tokens)
        for i, (form, kind, gloss) in enumerate(tokens):
            start, at = at, at + len(form)
            if not gloss:
                continue
            cands = self.by_form.get(form.lower(), [])
            if owner is not None and owner in cands:
                links.append((owner["id"], form.lower(), start))
                continue
            if not cands:
                continue
            if kind:
                prefer = [kind, "root"]
            elif n > 1 and i == 0:
                prefer = ["prefix", "root"]
            elif n > 1 and i == n - 1:
                prefer = ["suffix", "root"]
            else:
                prefer = ["root"]
            chars = set(CJK.findall(gloss))
            for t in prefer:
                group = [r for r in cands if r["type"] == t]
                if not group:
                    continue
                scored = sorted(group, key=lambda r: -len(chars & set(CJK.findall(r["meaning"]))))
                best = scored[0]
                overlap = len(chars & set(CJK.findall(best["meaning"])))
                # 词根同形的多，意思对不上就不连；前缀后缀标了连字符、又只有一个候选时直接连
                if overlap or (kind == t and t != "root" and len(group) == 1):
                    links.append((best["id"], form.lower(), start))
                break
        return links


def main():
    roots, problems = load_roots()
    linker = Linker(roots)
    words, bad = {}, 0
    if os.path.exists(WORDS):
        with open(WORDS, encoding="utf-8-sig") as f:
            for n, raw in enumerate(f, 1):
                line = raw.rstrip("\r\n")
                if not line.strip() or line.startswith("#"):
                    continue
                cols = line.split("\t")
                tokens = parse(cols[1]) if len(cols) == 2 else None
                word = cols[0].strip()
                if not tokens or "".join(t[0] for t in tokens).lower() != word.lower():
                    bad += 1
                    if bad <= 20:
                        print(f"words.tsv:{n} 拆解拼不回单词，跳过：{line!r}")
                    continue
                words[word.lower()] = (word, display(tokens), linker.link(tokens))
    # 词根表里的例词也算进去，至少连到它所属的词根
    for r in roots:
        for e in r["examples"]:
            k = e["w"].lower()
            tokens = parse(e["parts"])
            if not tokens:
                continue
            if k in words:
                w, d, links = words[k]
                if not any(i == r["id"] for i, _, _ in links):
                    form = next((f for f in r["forms"] if f in k), None)
                    if form:
                        links.append((r["id"], form, k.find(form)))
                continue
            links = linker.link(tokens, owner=r)
            if "".join(t[0] for t in tokens).lower() != k:
                # 例词的拆解有时省略了字母，位置改成在单词里找
                links = [(i, f, k.find(f)) for i, f, _ in links]
            words[k] = (e["w"], display(tokens), links)

    lines = []
    for k in sorted(words):
        w, d, links = words[k]
        lines.append(w + "\t" + d + "\t" + ",".join(f"{i}|{f}|{a}" for i, f, a in links))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_roots.py 根据 data/roots/ 生成，请勿手动修改\n")
        f.write("window.MARGIN_ROOTS = " + json.dumps(roots, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("// 每行：单词\\t拆解\\t对应的词根（词根id|拼写|在单词里的位置，逗号隔开）\n")
        f.write("window.MARGIN_PARTS = " + json.dumps("\n".join(lines), ensure_ascii=False) + ";\n")
    counts = {t: sum(1 for x in roots if x["type"] == t) for t in ORDER}
    linked = sum(1 for k in words if words[k][2])
    print(f"词根 {len(roots)} 条 {counts}；拆解 {len(words)} 个词，{linked} 个连上了词根；{bad} 行拼不回单词被跳过")
    print(f"写入 {OUT}（{os.path.getsize(OUT) // 1024} KB）")
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
