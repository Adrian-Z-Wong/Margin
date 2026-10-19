<div align="center">

# Margin

**黑白极简的背单词网页 · 为去美国留学的你准备**

看英文写中文 · 看中文拼英文 · 听发音拼英文

[在线使用](https://adrian-z-wong.github.io/Margin/) · [下载 Margin.html](https://github.com/Adrian-Z-Wong/Margin/raw/HEAD/Margin.html) · [反馈问题](https://github.com/Adrian-Z-Wong/Margin/issues)

</div>

![Margin 首页](docs/screenshots/home.png)

## 功能

- **三种题型**
  - 英 → 中：看英文单词，写中文意思。电脑宽松判分，写对任何一个意思就算对。
  - 中 → 英：看中文意思，拼写英文。可以提示字母个数。
  - 听 → 写：听发音，拼写英文，类似听写。
- **一次一个词**：答完马上出下一个，答过的词一行一行留在上面。判错了可以点 ✓ ✗ 改判。
- **Finance 专业词库**：经济学、金融学、管理学、会计学，从本科入门到博士研究常用的术语。
- **留学考试词库**：托福 TOEFL、雅思 IELTS、GRE。
- **导入自己的词表**：直接粘贴，或者选 .txt / .csv 文件；只写英文也行，常见词自动补中文意思。
- **错题本**：答错自动收录，之后连续答对 2 次自动移出。
- **真人发音**：美式 / 英式可选；不联网时自动改用电脑语音。
- **键盘操作**：`Enter` 提交，`Tab` 朗读，`Esc` 结束，`1` `2` `3` 切换题型。
- **黑白两种外观**：可以跟随系统自动切换。
- **不用安装、不用注册**：一个网页文件，双击就能打开，离线也能背。

![背诵界面](docs/screenshots/practice.png)

## 怎么用

### 方法一：在线使用

打开 <https://adrian-z-wong.github.io/Margin/> 就能背。

### 方法二：下载到电脑

1. 点上面的「下载 Margin.html」，或者在本页点 `Margin.html` 文件，再点右上角的下载按钮。
2. 双击下载好的 `Margin.html`，会用浏览器打开。推荐 Chrome 或 Edge。
3. 以后想用就双击它。也可以把它拖到书签栏。

> 你的进度保存在浏览器里。下载了新版本的 `Margin.html` 直接替换就行，进度不会丢。
> 换电脑或者清理浏览器数据之前，先到「设置 → 导出备份」保存一份。

### 导入自己的词表

「词库 → 导入新词表」，把单词粘贴进去，一行一个。下面这些格式都认：

```
abandon 放弃
abandon	v. 放弃           ← 从 Excel 复制两列
abandon /əˈbændən/ v. 放弃
abandon                 ← 只写单词，自动查中文意思
moral hazard 道德风险     ← 词组也可以
```

## 词库

| 词库 | 词数 | 说明 |
| --- | --- | --- |
| Finance · 经济学 | 见网页 | 微观、宏观、计量、博弈论、国际、公共、劳动、发展等 |
| Finance · 金融学 | 见网页 | 投资、资产定价、衍生品、固定收益、公司金融、银行、实证金融等 |
| Finance · 管理学 | 见网页 | 组织行为、战略、营销、运营、人力资源、领导力等 |
| Finance · 会计学 | 见网页 | 财务会计、报表、成本与管理会计、审计、美国税务、会计研究等 |
| 托福 TOEFL | 6,974 | 来自 ECDICT |
| 雅思 IELTS | 5,040 | 来自 ECDICT |
| GRE | 7,504 | 来自 ECDICT |

Finance 词库的原始表格在 [`data/finance/`](data/finance/)，每行一个词条，三列分别是英文术语、中文释义、小类，可以直接用 Excel 打开。发现译名不准，欢迎提 [Issue](https://github.com/Adrian-Z-Wong/Margin/issues) 或直接改表格提交 Pull Request。

## 给开发者

Margin 没有用任何框架，也不需要安装依赖，只要有 Python 3。

```
src/            网页源码：index.html、style.css、app.js
  words.js      考试词库（由 tools/build_words.py 生成）
  finance.js    Finance 词库（由 tools/build_finance.py 生成）
data/finance/   Finance 词库原始表格（TSV）
tools/          转换和打包脚本
Margin.html     打包好的单文件网页（由 tools/build.py 生成）
```

```bash
python3 tools/build_words.py     # 重新生成考试词库（会自动下载 ECDICT）
python3 tools/build_finance.py   # 改了 data/finance/ 之后运行
python3 tools/build.py           # 把 src/ 打包成 Margin.html
```

开发时可以直接用浏览器打开 `src/index.html`，改完代码刷新即可。提交前运行 `python3 tools/build.py`，更新 `Margin.html`。

## 致谢

- 托福、雅思、GRE 词库与音标来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 许可证），详见 [NOTICE.md](NOTICE.md)。
- 真人发音来自有道词典的公开发音接口。

## 许可证

[MIT](LICENSE)
