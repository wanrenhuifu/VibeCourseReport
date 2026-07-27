# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeCourseReport — 像 vibe coding 一样写课程作业报告。核心理念：**网页即源文件，AI 即编辑器和排版师，PDF 即构建产物**。灵感来自 [vibe-resume](https://github.com/LiuMengxuan04/vibe-resume)。

## Commands

所有命令在项目根目录执行（即 `package.json` 所在目录）。

```bash
# 安装依赖（需要 Node.js ≥ 18 和本机 Chrome/Chromium）
npm install

# 本地预览
npm run dev              # 或 npm start（前端肌肉记忆别名）
npm run preview          # Vite 启动开发服务器，访问 http://localhost:4173

# 导出 PDF（屏幕布局渲染，非打印媒体）
npm run export:pdf       # 默认输出到 export/vibe-course-report-demo.pdf

# 也可以指定输出路径
node scripts/export-pdf.mjs export/自定义文件名.pdf

# Watch 模式：监听源文件变化自动重新导出
npm run export:pdf:watch

# 自动生成目录（从正文 h2/h3 扫描，更新 .toc-list）
npm run build:toc

# 结构校验（检查目录对应、图片存在、标题 id）
npm run check
```

如果找不到浏览器，设置 `CHROME_PATH` 环境变量指向 Chrome/Chromium 可执行文件。注意依赖的是 `puppeteer-core`（不自带浏览器，必须用系统 Chrome/Chromium）；在无头 Linux / Docker 环境还需安装 CJK 字体包（如 `fonts-noto-cjk`），否则中文渲染为豆腐块。

`markitdown` 是外部 Python 工具（`pip install markitdown`），**不在** npm 依赖中。

仓库没有单元测试或 lint——改动的验证方式就是导出一次 PDF 并看日志：`目录页码已回填 N 条` 的 N 应与 `index.html` 中目录条目数一致，有 `⚠ 警告` 行说明存在找不到目标的 `data-toc-target`。

## Architecture

### 核心工作流

1. AI 先检查 `requirements/` 目录：如果用户放了作业要求文件（PDF、DOCX、PPTX 等），用 `markitdown` 转换为 Markdown 后仔细阅读。
2. AI 直接修改 `index.html`（内容/结构）和 `styles.css`（排版/样式），然后通过 `scripts/export-pdf.mjs` 用 Chromium 渲染 screen 布局生成 A4 多页 PDF。不使用浏览器打印 —— 浏览器会从 screen 切换到 print 媒体，导致纸张大小、分页、边距和字体渲染不一致。

```bash
# 读取作业要求（将各种格式转为 Markdown 文本）
markitdown requirements/作业要求.pdf
```

### 关键文件与职责

| 文件 | 职责 |
| --- | --- |
| `requirements/` | 作业要求文件（PDF/DOCX/PPTX 等），AI 用 `markitdown` 转换后读取 |
| `index.html` | 报告源文件：封面、摘要、目录、正文、参考文献。`<main class="page">` 内按 section 组织 |
| `styles.css` | 排版源文件：页面几何、字体、三线表、插图、公式、参考文献样式。通过 `--accent` 等 CSS 变量控制主题 |
| `scripts/export-pdf.mjs` | PDF 导出脚本：启动 Puppeteer → 加载页面 → 注入 `body.exporting` → 回填目录页码 → 分页导出 |
| `scripts/build-toc.mjs` | 目录自动生成：从 `.content` 扫描 h2/h3，自动更新 `.toc-list` |
| `scripts/check-report.mjs` | 结构校验：检查 data-toc-target ↔ id 对应、图片存在、标题 id 完整性 |
| `scripts/export-pdf-watch.mjs` | Watch 模式：监听源文件变化自动重新导出 |
| `skills/vibe-report-editor/SKILL.md` | AI 编辑规则（Codex-style skill），定义报告结构约定和修改流程 |

### 报告结构约定

`index.html` 中 `<main class="page">` 内按顺序包含：

- `section.cover` — 封面（学校、课程、题目、姓名学号、指导教师、日期）
- `section.abstract` — 摘要正文 + `p.keywords`
- `section.toc` — 目录（`a.toc-item.lv1/.lv2`，页码由导出脚本自动回填，保持留空）
- `section.content` — 正文（`h2` 章 / `h3` 节 / 三线表 / 插图 / 公式 / 参考文献 `h2#sec-ref` + `ol.references`）

封面/摘要/目录在导出时各占一整页，**不要**在这三个区块里塞超长内容（会被裁掉）；正文长度不限。

### PDF 导出机制

1. Puppeteer 启动 headless Chromium，`emulateMediaType('screen')` 强制 screen 媒体
2. 注入 `body.exporting` 类：隐藏工具栏，封面/摘要/目录设为固定页高 + `break-after: page`
3. 目录页码自动计算：`页码 = floor(元素距文档顶部距离 / 单页内容高度) + 1`，回填到 `[data-toc-target]` 元素
4. 脚本把由 `PAGE` 几何算出的 `CONTENT_HEIGHT_PX` 注入为 CSS 变量 `--content-height`（`:root` 里已有同值默认声明兜底），`styles.css` 中 `body.exporting .cover/.abstract/.toc` 用它固定页高；前置部分（封面/摘要/目录）超长会被 `overflow:hidden` 截断，脚本检测到 `scrollHeight > clientHeight` 时会打印 ⚠ 警告
5. Chromium 按 A4 + 固定页边距导出 PDF，页脚自动加 "n / total" 页码（页脚字体读取 CSS 的 `--sans`，无需手动同步）

已知限制：目录页码按 screen 布局位置（`getBoundingClientRect`）计算，而 PDF 实际分页由 Chromium 打印引擎决定。测量宽度已与 PDF 分页宽度精确对齐（`--content-w` = 154mm），残余偏差只来自打印引擎的边界行为（标题避孤行、图表 `break-inside:avoid` 整体下移等），中文长文档可能有 ≤1 页偏差——这是机制本身的限制，不是 bug。

导出脚本关键细节：启动 Chromium 时传入 `--force-color-profile=srgb` 保证跨平台颜色一致；渲染前调用 `document.fonts.ready` 等待 web font 加载完毕，避免 CJK 字体未就绪导致 PDF 中文显示为豆腐块。导出时 `.cover-note` 和 `.toc-hint` 元素会被隐藏——不要在这两个元素中放置必须在 PDF 中出现的内容。

### 页面几何同步（铁律）

`styles.css` 与 `scripts/export-pdf.mjs` 中的页面参数必须保持一致，改一边必须改另一边，否则目录页码会算错：

| 参数 | CSS 变量 | 脚本常量 | 值 |
| --- | --- | --- | --- |
| 纸张宽 | `--sheet-w: 793.7008px` | `PAGE.widthMm` | 210mm |
| 纸张高 | — | `PAGE.heightMm` | 297mm |
| 上下边距 | `--margin-y: 94.4882px` | `PAGE.marginTopMm/BottomMm` | 25mm |
| 左右边距 | `--margin-x: 105.8268px` | `PAGE.marginLeftMm/RightMm` | 28mm |
| 单页内容高 | `--content-height: 933.5433px` | `CONTENT_HEIGHT_PX`（脚本注入同名变量覆盖） | (297−25−25)mm |

所有 px 值都是 mm×96/25.4 的**精确换算，不要取整**：`--sheet-w` 与 `--margin-x` 决定目录页码的测量宽度（`--content-w` = 582.0472px），必须与 PDF 实际分页宽度（154mm）一致，否则长文档目录页码会 ±1 页。

### 排版组件

- **三线表**：`figure.table-figure` > `figcaption.table-caption` + `table.three-line`。表号由 CSS counter 自动生成（"表 1""表 2"……），`figcaption` 中只需写题注文字，不要手写"表 N"。
- **插图**：图片放 `assets/`，`figure.img-figure` > `img` + `figcaption`。图号由 CSS counter 自动生成（"图 1""图 2"……），`figcaption` 中只需写题注文字，不要手写"图 N"。
- **公式**：行内用 `$...$`，独立公式用 `$$...$$` 写在 `div.formula` 中。KaTeX 自动渲染（通过 CDN 加载）。也支持 HTML 实体 / Unicode 手写简单公式。
- **代码块**：`pre` + `code`，等宽字体，灰色背景，自动换行。
- **参考文献**：`ol.references`，GB/T 7714 编号制
- **脚注**：正文中用 `<sup class="fn-ref"><a href="#fn-1">1</a></sup>` 标注，底部用 `<ol class="footnotes">`。
- **英文摘要**：`section.abstract.abstract-en`，结构和中文摘要一致。
- **附录**：`section.appendix` > `h2.appendix-heading`，章节编号自动用大写字母（附录 A、附录 B……）。
- **孤行标题防护**：标题设置了 `break-after: avoid`，紧邻的段落/列表设置了 `break-before: avoid`，双向保护防止标题孤悬页底。新增章节时保持此 CSS 模式。

### AI 编辑规则

详见 `skills/vibe-report-editor/SKILL.md` 的"铁律"、"报告结构约定"、"排版组件"和"修改流程"章节。核心要点：
- 只改源文件（`index.html` / `styles.css`），`export/*.pdf` 由脚本生成
- 不编造内容，参考文献必须真实可查
- 目录页码留空，由导出脚本自动回填
- 页面几何（CSS 变量 ↔ 脚本 mm 值）必须同步
