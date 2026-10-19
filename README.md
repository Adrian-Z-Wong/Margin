<div align="center">

# Margin

**黑白极简的背单词工具**

[在线使用](https://adrian-z-wong.github.io/Margin/Margin.html) · [下载到电脑](https://adrian-z-wong.github.io/Margin/) · [反馈问题](https://github.com/Adrian-Z-Wong/Margin/issues/new/choose)

![License](https://img.shields.io/github/license/Adrian-Z-Wong/Margin?color=000)
![Single file](https://img.shields.io/badge/single%20file-no%20install-000)
![Offline](https://img.shields.io/badge/offline-ready-000)

</div>

![Margin 首页](docs/screenshots/home.png)

## 功能

- 选好词库和每天背多少新词，首页显示今日进度
- 每组三步：看英文写中文 → 看中文拼英文 → 听发音拼英文
- 每日复习：昨天的新词和错题本
- 词库：Finance、四级、六级、考研、托福、雅思、GRE、GMAT
- 导入自己的词表
- 错题本答对自动移出，已掌握的词不再出现
- 美式 / 英式发音
- 打卡热力图
- 黑白两种外观
- Mac 应用，也可以在线用或下载网页文件，离线可用

![背诵界面](docs/screenshots/practice.png)

## 怎么用

**在线使用**：打开 <https://adrian-z-wong.github.io/Margin/Margin.html>。

**下载到电脑**：打开 <https://adrian-z-wong.github.io/Margin/>，点「下载到电脑」，再双击下载好的 `Margin.html`（推荐 Chrome 或 Edge）。

**Mac 应用**：在 [Releases](https://github.com/Adrian-Z-Wong/Margin/releases/latest) 下载 `Margin_*_aarch64.dmg`，双击后把 Margin 拖进「应用程序」。第一次打开如果提示「无法验证开发者」，打开「系统设置 → 隐私与安全性」，点「仍要打开」。适用于 Apple 芯片（M1–M4）的 Mac。

进度保存在浏览器或 App 里。换电脑之前，在「设置」里导出备份。

## 词库

| 词库 | 词数 |
| --- | --- |
| Finance | 12,291 |
| 四级 | 5,331 |
| 六级 | 7,086 |
| 考研 | 6,511 |
| 托福 | 6,974 |
| 雅思 | 5,040 |
| GRE | 7,504 |
| GMAT | 2,931 |

Finance 收录经济、金融、会计、管理、公司治理、财务管理、资本市场、货币政策等专业词汇。四级包含高考词汇，六级和考研包含四级词汇。Finance 的原始表格在 [`data/finance/`](data/finance/)，可以直接用 Excel 打开。发现不准的地方，欢迎[提 Issue](https://github.com/Adrian-Z-Wong/Margin/issues/new/choose)。

## 开发

不依赖任何框架。源码在 `src/`，运行 `python3 tools/build.py` 打包成 `Margin.html`。Mac 应用在 `desktop/`（[Tauri](https://tauri.app)），由 GitHub Actions 自动打包发布。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

考试词库、音标和中文词向量来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 许可证），详见 [NOTICE.md](NOTICE.md)。发音来自有道词典。

## 许可证

[MIT](LICENSE)
