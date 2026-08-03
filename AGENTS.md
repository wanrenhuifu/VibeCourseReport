# AGENTS.md

This file provides guidance to AI coding assistants (Claude Code, Cursor, Gemini CLI, etc.) when working with code in this repository.

> This is a cross-tool version of `CLAUDE.md`. If your AI tool does not support `AGENTS.md`,
> point it to `CLAUDE.md` instead, or copy the relevant content directly.

## Project Overview

VibeCourseReport — 像 vibe coding 一样写课程作业报告。核心理念：**网页即源文件，AI 即编辑器和排版师，PDF 即构建产物**。灵感来自 [vibe-resume](https://github.com/LiuMengxuan04/vibe-resume)。

## Commands

所有命令在项目根目录执行（需要 Node.js ≥ 18 和本机 Chrome/Chromium）：

```bash
npm install              # 安装依赖
npm run dev              # 本地预览 http://localhost:4173
npm run preview          # 同上（前端肌肉记忆别名）
npm run export:pdf       # 导出 PDF → export/vibe-course-report-demo.pdf
npm run export:pdf:watch # 监听源文件变化自动导出
npm run build:toc        # 从正文标题自动生成目录
npm run check            # 结构校验（目录对应、图片存在、标题 id、脚注锚点、preview.png 是否过期）
npm run screenshot       # 重新生成 README 预览截图 assets/preview.png
npm run screenshot:watch # 监听源文件变化自动更新预览截图
```

## Architecture

- `index.html` — 报告源文件（封面、摘要、目录、正文、参考文献）
- `styles.css` — 排版源文件（页面几何、三线表、插图、公式）
- `scripts/export-pdf.mjs` — PDF 导出脚本（Chromium screen 布局 → A4 多页 PDF，含 CJK 字体 / 缺失资源检测）
- `scripts/build-toc.mjs` — 目录自动生成
- `scripts/check-report.mjs` — 结构校验
- `scripts/export-pdf-watch.mjs` / `scripts/update-preview-watch.mjs` — Watch 模式
- `scripts/update-preview.mjs` — README 预览截图生成（含构图 / 字体 / 资源校验）
- `scripts/lib/chrome.mjs` — 共享 Chromium 探测与启动（浏览器相关修复只改这一处）
- `scripts/lib/page-checks.mjs` — 共享页面检测（CJK 字体 / 缺失资源，两个渲染脚本共用）
- `skills/vibe-report-editor/SKILL.md` — AI 编辑规则

## Key Rules

1. Only edit `index.html` and `styles.css` — PDF is generated, never hand-edited
2. Keep CSS `--margin-x`/`--margin-y` in sync with `PAGE` constants in export script
3. Leave TOC page numbers empty — the export script auto-fills them
4. Cover / abstract / TOC each occupy exactly one page in export mode
5. All px values are exact `mm × 96 / 25.4` conversions — do not round
6. Don't fabricate content — references must be verifiable, data must be real
7. After changing cover or styles, rerun `npm run screenshot` — `npm run check` fails if
   the screenshot is stale (fingerprints in `assets/preview.sources.json`), and CI enforces it
