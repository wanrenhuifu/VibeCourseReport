# Contributing to VibeCourseReport

感谢你的贡献！在提交 PR 前请阅读本指南。

## 开发环境

- Node.js ≥ 18
- Chrome / Chromium（本机安装）
- Linux 环境额外需要 `fonts-noto-cjk`（避免 PDF 中文渲染为方块）

```bash
npm install
npm run dev          # 本地预览
```

## 提交前检查清单

- [ ] `npm run check` 通过（目录对应、图片存在、标题 id）
- [ ] `npm run export:pdf` 导出成功，PDF 显示正常
- [ ] 若修改了页面边距/纸张大小，已在 `styles.css` 和 `scripts/export-pdf.mjs` 两边同步
- [ ] 不包含编造的实验数据、文献或个人信息
- [ ] `npm run build:toc` 已运行（如果新增/删除了章节）

## 代码风格

- HTML/CSS/JS：2 空格缩进（见 `.editorconfig`）
- CSS px 值为 `mm × 96 / 25.4` 精确换算，**不要取整**
- JavaScript：ES module（`"type": "module"`）
- 注释使用中文（与现有代码保持一致）

## PR 流程

1. Fork 仓库并创建 feature 分支
2. 做出修改并通过上述检查清单
3. 提交 PR 到 `main` 分支
4. CI 会自动运行 `npm run check` + `npm run export:pdf` 并上传 PDF artifact

## Issue 提交

报告 bug 或功能请求时请尽量提供复现步骤。模板相关问题请附上：
- Node.js 版本
- 操作系统
- Chrome/Chromium 版本
