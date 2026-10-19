<div align="center">

# Marginal Vocabulary

**黑白极简的背单词工具**

[在线使用](https://adrian-z-wong.github.io/Margin/Margin.html) · [下载到电脑](https://adrian-z-wong.github.io/Margin/) · [反馈问题](https://github.com/Adrian-Z-Wong/Margin/issues/new/choose)

![License](https://img.shields.io/github/license/Adrian-Z-Wong/Margin?color=000)
![Single file](https://img.shields.io/badge/single%20file-no%20install-000)
![Offline](https://img.shields.io/badge/offline-ready-000)

</div>

![Marginal Vocabulary 首页](docs/screenshots/home.png)

## 功能

- 选好词库和每天背多少新词，首页显示今日进度
- 每组三步：看英文写中文 → 看中文拼英文 → 听发音拼英文
- 每日复习：昨天的新词和错题本
- 词根：按词库学词根词缀，每组三步：看词根选意思 → 看意思选词根 → 在单词里填词根；背单词时显示单词拆解
- 词库：Finance、Medicine、CET-4、CET-6、GEE、TOEFL、IELTS、GRE、GMAT
- 导入自己的词表
- 错题本答对自动移出，已掌握的词不再出现
- 美式 / 英式发音
- 打卡热力图
- 黑白两种外观
- Mac 应用，也可以在线用或下载网页文件，离线可用

![背诵界面](docs/screenshots/practice.png)

## 怎么用

**在线使用**：打开 <https://adrian-z-wong.github.io/Margin/Margin.html>。

**下载到电脑**：打开 <https://adrian-z-wong.github.io/Margin/>，点「下载到电脑」，再双击下载好的 `Marginal Vocabulary.html`（推荐 Chrome 或 Edge）。

**Mac 应用**：在 [Releases](https://github.com/Adrian-Z-Wong/Margin/releases/latest) 下载以 `_aarch64.dmg` 结尾的文件，双击后把 Marginal Vocabulary 拖进「应用程序」。第一次打开如果提示「无法验证开发者」，打开「系统设置 → 隐私与安全性」，点「仍要打开」。适用于 Apple 芯片（M1–M4）的 Mac。

进度保存在浏览器或 App 里。换电脑之前，在「设置」里导出备份。

## 词库

| 词库 | 词数 |
| --- | --- |
| Finance | 18,299 |
| Medicine | 24,293 |
| CET-4 | 5,331 |
| CET-6 | 7,086 |
| GEE | 6,511 |
| TOEFL | 6,974 |
| IELTS | 5,040 |
| GRE | 8,806 |
| GMAT | 4,137 |

Finance 收录经济、金融、会计、管理、公司治理、财务管理、资本市场、货币政策等专业词汇。Medicine 收录解剖、基础医学、内外妇儿各科疾病、临床检查、药理、公共卫生，以及中医理论、经络穴位、中药方剂。CET-4 包含高考词汇，CET-6 和 GEE（考研）包含 CET-4 词汇。原始表格在 [`data/finance/`](data/finance/) 和 [`data/medicine/`](data/medicine/)，可以直接用 Excel 打开。

词根板块收录 909 个前缀、词根、后缀（含医学常用构词成分），以及 1.1 万多个单词的拆解，数据在 [`data/roots/`](data/roots/)。发现不准的地方，欢迎[提 Issue](https://github.com/Adrian-Z-Wong/Margin/issues/new/choose)。

## 开发

不依赖任何框架。源码在 `src/`，运行 `python3 tools/build.py` 打包成 `Margin.html`。Mac 应用在 `desktop/`（[Tauri](https://tauri.app)），由 GitHub Actions 自动打包发布。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

考试词库、音标和中文词向量来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 许可证），详见 [NOTICE.md](NOTICE.md)。发音来自有道词典。

## 许可证

[MIT](LICENSE)
