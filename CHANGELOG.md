# Changelog

## [Unreleased]

### Added
- 封面校徽正方形预留位（`.cover-emblem`）与占位图 `assets/school-emblem.svg`；替换说明见 README / SKILL.md，校徽可从 [universitylogos.top](https://universitylogos.top/) 获取
- `npm run screenshot`：重新生成 README 预览截图 `assets/preview.png`，避免模板变更后截图过时

### Fixed
- 导出脚本 CJK 字体检测恒为假阳性的问题：改用探针文本渲染宽度对比，无头 Linux / Docker 缺 CJK 字体时豆腐块（tofu）警告能真正触发

## [1.0.0] — 2026-07-27

### Added
- 初始发布：课程报告模板，支持封面、摘要、目录、正文、三线表、插图、公式、GB/T 7714 参考文献
- Puppeteer 多页 A4 PDF 导出脚本，支持目录页码自动回填、页脚页码
- `vibe-report-editor` AI Skill（Codex-style）
- 本地预览（Vite dev server）

[1.0.0]: https://github.com/wanrenhuifu/VibeCourseReport/releases/tag/v1.0.0
