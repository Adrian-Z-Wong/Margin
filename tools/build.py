"""把 src/ 里的网页打包成一个文件 Margin.html（双击就能打开，也用于 GitHub Pages）。

用法：
    python3 tools/build.py
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "Margin.html")


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")

    def inline_css(m):
        return "<style>\n" + read(m.group(1)) + "</style>"

    def inline_js(m):
        name = m.group(1)
        if not os.path.exists(os.path.join(SRC, name)):
            print(f"跳过不存在的 {name}")
            return ""
        # 防止脚本里的 </script> 提前结束标签
        return "<script>\n" + read(name).replace("</script", "<\\/script") + "</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"已生成 {OUT}（{os.path.getsize(OUT) // 1024} KB）")


if __name__ == "__main__":
    main()
