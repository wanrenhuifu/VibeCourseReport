---
name: vibe-report-editor
version: 1.0.0
description: 编辑 VibeCourseReport 网页课程报告模板（index.html / styles.css），并用 scripts/export-pdf.mjs 导出多页 A4 PDF。当用户要求撰写、修改、排版课程作业报告或导出报告 PDF 时使用。
---

# Vibe 课程报告编辑器

你正在维护一个"网页即源文件"的课程作业报告。报告内容、结构、图表都在 `index.html` 中，排版在 `styles.css` 中，PDF 是构建产物。你的职责是直接修改这两个文件，并用导出脚本验证结果。

## 铁律

1. **只改源文件，不碰导出产物**：`export/*.pdf` 由脚本生成，永远不要手工编辑。
2. **不要编造内容**：不虚构实验数据、文献、成绩、人名。参考文献必须真实可查，拿不准就标注"待核实"并告知用户。
3. **目录页码不要手填**：目录中 `<span class="toc-page" data-toc-target="...">` 的内容由导出脚本自动回填，保持为空即可。
4. **页面几何两边同步**：`styles.css` 的 `--margin-x` / `--margin-y` 与 `scripts/export-pdf.mjs` 的 `PAGE` 边距必须一致，改一边必须改另一边，否则目录页码会算错。
5. **学术诚信**：提交前提醒用户核对课程关于 AI 辅助的规定；封面姓名学号等必须由用户确认。

## 报告结构约定

`index.html` 中 `<main class="page">` 内按顺序包含：

| 区块 | 标签 | 说明 |
| --- | --- | --- |
| 封面 | `section.cover` | 校徽占位（`.cover-emblem`，正方形）、学校、课程、题目、姓名学号、指导教师、日期 |
| 摘要 | `section.abstract` | 摘要正文 + `p.keywords` 关键词 |
| 目录 | `section.toc` | `a.toc-item.lv1/.lv2`，页码留空 |
| 正文 | `section.content` | `h2` 章 / `h3` 节，参考文献 `h2#sec-ref` + `ol.references` |

- 封面 / 摘要 / 目录在导出时各占一整页，**不要**在这三个区块里塞超长内容（会被裁掉）；正文长度不限。
- 新增章节时：在正文加 `h2 id="sec-N"`，并在目录加对应 `a.toc-item`，`href` 与 `data-toc-target` 指向该 id。
- 章节编号直接写在标题文本里（如 `2.1　...`），新增/删除章节后顺手重排编号。

## 排版组件

- **三线表**：`figure.table-figure` + `table.three-line`，表题在 `figcaption.table-caption`（表号由 CSS counter 自动生成，只需写题注文字，不要手写"表 N"）。
- **校徽**：封面顶部 `div.cover-emblem > img` 是正方形预留位（默认占位图 `assets/school-emblem.svg`）。替换真实校徽时从 [universitylogos.top](https://universitylogos.top/)（免费高校徽标库，PNG/SVG 透明底，无需注册）下载对应学校徽标放入 `assets/`，把 `src` 改为新文件名即可（`object-fit: contain` 已保证非正方形图也不变形）。校徽图案不可编造手绘；找不到就请用户自行提供，并仅限本校课程报告等正当用途。
- **插图**：图片放 `assets/`，用 `figure.img-figure` 引用，图题在 `figcaption`（图号由 CSS counter 自动生成，只需写题注文字，不要手写"图 N"）。
- **公式**：行内用 `$...$`，独立公式用 `$$...$$` 写在 `div.formula` 中。KaTeX 自动渲染（通过 CDN 加载）。简单公式也可用 Unicode 字符手写（如 θ φ π β）。
- **代码块**：`` ``` `` 围栏代码块或 `<pre><code>`，等宽字体，灰色背景，自动换行。
- **参考文献**：`ol.references`，GB/T 7714 编号制（作者. 题名[文献类型]. 出处, 年, 卷(期): 页码.）。
- **脚注**：正文用 `<sup class="fn-ref"><a href="#fn-1" id="fnref-1">1</a></sup>`，底部用 `<ol class="footnotes">`。
- **英文摘要**：`section.abstract.abstract-en`，结构同中文摘要。
- **附录**：`section.appendix` > `h2.appendix-heading`，编号自动用大写字母（附录 A、附录 B……）。
- 正文段落首行缩进已由 CSS 处理，不要在文本里加全角空格缩进。

## 读取作业要求

用户可能将课程作业要求以各种格式放在 `requirements/` 目录下（PDF、DOCX、PPTX、XLSX、HTML 等）。先用 `markitdown` 将其转换为 Markdown 文本再读取——不要直接读取二进制文件：

```bash
# 单个文件
markitdown requirements/作业要求.pdf

# 或批量转换
for f in requirements/*; do markitdown "$f"; done

# 也支持读取 URL 指向的网页/文档
markitdown https://example.com/assignment
```

`markitdown` 支持 PDF、DOCX、PPTX、XLSX、HTML、图片（OCR）、音频（转录）等格式。

## 修改流程

1. 明确课程、题目、章节要求、字数、格式要求：
   - 先检查 `requirements/` 目录：如果有作业要求文件，用 `markitdown` 转换后仔细阅读。
   - 仍不清楚的就问用户。
2. 改 `index.html` 内容，必要时改 `styles.css`（主题色 `--accent`、字号、行距等 CSS 变量）。
3. 如果新增或删除了章节，运行目录自动生成：
   ```bash
   npm run build:toc
   ```
4. 运行结构和导出验证：
   ```bash
   npm run check        # 先检查结构完整性
   npm run export:pdf   # 再导出 PDF
   ```
5. 检查导出日志：目录页码回填条数应与目录条目数一致。
6. 自查清单：
   - [ ] 封面信息全部替换为真实内容，无 mock 占位
   - [ ] 摘要、关键词与正文一致
   - [ ] 目录条目与正文章节一一对应（`npm run check` 可自动检查）
   - [ ] 图表均有编号与题注，正文中均有引用（"如图 1 所示"）
   - [ ] 参考文献格式统一、真实可查
   - [ ] PDF 分页无孤行标题、无被截断的表格/图片

## 常见问题

- **导出报"未找到 Chrome"**：设置 `CHROME_PATH` 环境变量指向浏览器可执行文件。
- **目录页码全错**：检查第 4 条铁律，CSS 与脚本的边距是否同步。
- **表格/图片跨页被截断**：它们默认 `break-inside: avoid`，仍被截断说明超过单页内容高度，需要缩小或拆分。
