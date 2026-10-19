# 参与贡献

谢谢你愿意帮 Margin 变得更好。

## 词库纠错（最欢迎）

Finance 词库的原始表格在 [`data/finance/`](data/finance/)：

| 文件 | 学科 |
| --- | --- |
| `economics.tsv` | 经济学（含计量、统计、研究方法） |
| `finance.tsv` | 金融学 |
| `management.tsv` | 管理学 |
| `accounting.tsv` | 会计学 |

每行一个词条，三列用 Tab 分隔：`英文术语	中文释义	小类`。

- 英文用美式拼写，缩写写在中文释义末尾的括号里，例如 `capital asset pricing model	资本资产定价模型（CAPM）	资产定价`。
- 中文用国内教材最通行的译名；几个译名都常用时用全角分号「；」隔开，常用的放前面。
- 改完运行 `python3 tools/build_finance.py` 和 `python3 tools/build.py`，再提交 Pull Request。

不熟悉 Git 也没关系，直接[提一个「词条纠错」Issue](https://github.com/Adrian-Z-Wong/Margin/issues/new/choose) 就行。

托福、雅思、GRE 词库来自 [ECDICT](https://github.com/skywind3000/ECDICT)，释义问题可以同时反馈给上游。

## 改代码

- 不用任何框架和依赖，源码在 `src/`：`index.html`、`style.css`、`app.js`。
- 开发时直接用浏览器打开 `src/index.html`，改完刷新。
- 提交前运行 `python3 tools/build.py`，更新打包好的 `Margin.html`。
- 风格：黑白极简；英文用 Times New Roman 斜体，中文用仿宋；界面文字用中文。
- 进度存在浏览器 `localStorage` 的 `margin.v1` 里。改数据结构时要兼容旧数据。
