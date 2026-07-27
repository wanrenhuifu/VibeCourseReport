/**
 * 目录自动生成脚本
 *
 * 从 .content 区域扫描所有 h2/h3，自动生成 .toc-list 的目录条目。
 * AI 只管写正文，目录由本脚本注入——不再需要手动维护 toc-item。
 *
 * 用法：
 *   node scripts/build-toc.mjs              # 更新 index.html 的目录
 *   node scripts/build-toc.mjs --dry-run    # 仅打印将生成的目录，不修改文件
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const htmlPath = resolve(ROOT, 'index.html');

const dryRun = process.argv.includes('--dry-run');

const html = readFileSync(htmlPath, 'utf-8');

// 提取 .content 中的所有 h2/h3 及其 id
// 注意：.content 内可能嵌套 <section>（如 appendix），用 </main> 作为截止标记
const contentMatch = html.match(/<section class="content"[^>]*>([\s\S]*?)<\/main>/);
if (!contentMatch) {
  console.error('错误：未找到 <section class="content">');
  process.exit(1);
}

const contentHtml = contentMatch[1];
const headingRe = /<(h[23])\b[^>]*?\bid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
const headings = [];
let match;
while ((match = headingRe.exec(contentHtml)) !== null) {
  const level = match[1]; // 'h2' or 'h3'
  const id = match[2];
  // Strip HTML tags from heading text
  const text = match[3].replace(/<[^>]*>/g, '').trim();
  headings.push({ level, id, text });
}

if (headings.length === 0) {
  console.warn('警告：未在 .content 中找到任何带 id 的 h2/h3 标题');
  process.exit(0);
}

// 生成目录条目 HTML
const tocItems = headings.map(h => {
  const cls = h.level === 'h2' ? 'lv1' : 'lv2';
  return `        <a class="toc-item ${cls}" href="#${h.id}"><span class="toc-text">${h.text}</span><span class="toc-dots"></span><span class="toc-page" data-toc-target="${h.id}"></span></a>`;
}).join('\n');

const tocListHtml = `      <nav class="toc-list">\n${tocItems}\n      </nav>`;

if (dryRun) {
  console.log('将生成以下目录（--dry-run，未修改文件）：\n');
  console.log(tocListHtml);
  process.exit(0);
}

// 替换 .toc-list 区域
const tocListRe = /<nav class="toc-list">[\s\S]*?<\/nav>/;
if (!tocListRe.test(html)) {
  console.error('错误：未找到 <nav class="toc-list">，无法替换');
  process.exit(1);
}

const updated = html.replace(tocListRe, tocListHtml);
writeFileSync(htmlPath, updated, 'utf-8');
console.log(`目录已更新：${headings.length} 个条目（${headings.filter(h => h.level === 'h2').length} 章，${headings.filter(h => h.level === 'h3').length} 节）`);
