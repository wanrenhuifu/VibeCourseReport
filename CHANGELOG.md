# Changelog

## [Unreleased]

### Added
- 封面校徽正方形预留位（`.cover-emblem`）与占位图 `assets/school-emblem.svg`；替换说明见 README / SKILL.md，校徽可从 [universitylogos.top](https://universitylogos.top/) 获取
- `npm run screenshot`：重新生成 README 预览截图 `assets/preview.png`，避免模板变更后截图过时

### Fixed
- 导出脚本 CJK 字体检测恒为假阳性的问题：改用探针文本渲染宽度对比，无头 Linux / Docker 缺 CJK 字体时豆腐块（tofu）警告能真正触发
- 正文脚注标签属性误用弯引号 `”`（U+201D），导致 `.fn-ref` 样式与锚点跳转失效
- `update-preview-watch.mjs` 自触发无限循环：监听 `assets/` 目录却把 `preview.png` / `preview.sources.json` 写进同一目录，每次生成后立即再次触发

### Added
- `npm run check` 新增脚注锚点检查（正文引用 ↔ `<li id="fn-N">` ↔ 回跳链接），防此类回归漏网
- 导出脚本离线兜底：KaTeX CDN 不可达（断网 / 挂起）时不再干等 30s 失败，改为拦截 CDN 请求继续渲染，公式退回 HTML 实体 / Unicode 显示并告警
- 抽取共享页面检测 `scripts/lib/page-checks.mjs`：CJK 字体与缺失资源检测从 export-pdf / update-preview 两处收口为一处，告警文案统一为"导出产物"

## [1.0.0] — 2026-07-27

### Added
- 初始发布：课程报告模板，支持封面、摘要、目录、正文、三线表、插图、公式、GB/T 7714 参考文献
- Puppeteer 多页 A4 PDF 导出脚本，支持目录页码自动回填、页脚页码
- `vibe-report-editor` AI Skill（Codex-style）
- 本地预览（Vite dev server）

[1.0.0]: https://github.com/wanrenhuifu/VibeCourseReport/releases/tag/v1.0.0
