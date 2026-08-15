/**
 * 目录自动生成脚本
 *
 * 从 .content 区域扫描所有 h2/h3，自动生成 .toc-list 的目录条目。
 * AI 只管写正文，目录由本脚本注入——不再需要手动维护 toc-item。
 *
 * 同时自动重排章节编号：已有数字前缀的标题（如"2.1　..."）按实际顺序
 * 重新编号（h2 → "1""2"...，h3 → "2.1""2.2"...），增删章节后不再需要
 * 手动顺延编号。没有数字前缀的标题（如"参考文献"）保持原样不动。
 *
 * 用法：
 *   node scripts/build-toc.mjs              # 更新目录并重排编号
 *   node scripts/build-toc.mjs --dry-run    # 仅打印结果，不修改文件
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
// id 属性兼容单/双引号（AI 偶尔会生成单引号属性，按双引号硬匹配会漏掉标题）
const headingRe = /<(h[23])\b[^>]*?\bid\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/\1>/gi;
const headings = [];
let match;
while ((match = headingRe.exec(contentHtml)) !== null) {
  const level = match[1]; // 'h2' or 'h3'
  const id = match[2] ?? match[3];
  const innerHtml = match[4];
  // Strip HTML tags from heading text
  const text = innerHtml.replace(/<[^>]*>/g, '').trim();
  // 记录内层 HTML 在 contentHtml 中的起始位置，重排编号时按区间精准替换，
  // 避免全文 replace 误伤正文中恰好相同的文字。
  // 完整匹配形如 <h2 ...>inner</h2>，结尾闭合标签长度 = match[1].length + 3（即 "</h2>"）
  const innerStart = match.index + match[0].length - (match[1].length + 3) - innerHtml.length;
  headings.push({ level, id, text, innerStart, innerHtml });
}

if (headings.length === 0) {
  console.warn('警告：未在 .content 中找到任何带 id 的 h2/h3 标题');
  process.exit(0);
}

// ---------- 章节编号重排 ----------
// 规则：只对开头已有数字前缀（如"2.1　..."）的标题重排为顺序编号
// （h2 → "1""2"...，h3 → "2.1""2.2"...）；没有数字前缀的标题（如"参考文献"、
// 附录标题）不动。分隔符（全角空格/半角空格）保持原样。
const NUM_PREFIX_RE = /^\s*(\d+(?:\.\d+)*)/;
let chapter = 0;
let sub = 0;
let renumbered = 0;
let contentUpdated = contentHtml;
let offset = 0; // 前序替换造成的长度偏移，用于修正后续区间位置

for (const h of headings) {
  const numMatch = h.text.match(NUM_PREFIX_RE);
  if (!numMatch) continue; // 无编号标题（参考文献等），跳过
  const parts = numMatch[1].split('.');
  const expectedParts = h.level === 'h2' ? 1 : 2;
  if (parts.length !== expectedParts) {
    // 编号层级与标题层级不符（如 h2 标了"2.1"）——多半是标题层级写错了，
    // 自动改会掩盖问题，只告警不动
    console.warn(`警告：${h.level}#${h.id} 的编号"${numMatch[1]}"与标题层级不符，未改动——请人工检查`);
    continue;
  }
  if (h.level === 'h2') {
    chapter++;
    sub = 0;
  } else {
    if (chapter === 0) {
      console.warn(`警告：${h.level}#${h.id} 前面没有带编号的 h2 章标题，无法确定编号，未改动`);
      continue;
    }
    sub++;
  }
  const newNum = h.level === 'h2' ? String(chapter) : `${chapter}.${sub}`;
  if (newNum === numMatch[1]) continue; // 编号本来就对，无需替换

  // 在 innerHtml（未 trim）里重新定位数字前缀：text 是 trim 过的，
  // innerHtml 开头可能还有空白，必须以 innerHtml 为准找到数字的真实位置
  const innerNumMatch = h.innerHtml.match(/^\s*(\d+(?:\.\d+)*)/);
  const wsLen = innerNumMatch[0].length - innerNumMatch[1].length;
  const start = h.innerStart + offset + wsLen;
  contentUpdated = contentUpdated.slice(0, start) + newNum + contentUpdated.slice(start + innerNumMatch[1].length);
  offset += newNum.length - innerNumMatch[1].length;
  renumbered++;
  h.text = h.text.replace(NUM_PREFIX_RE, newNum);
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
  if (renumbered > 0) console.log(`\n并将重排 ${renumbered} 个标题的章节编号`);
  process.exit(0);
}

// 替换 .toc-list 区域。正则把 nav 行首的缩进空白也纳入匹配（[ \t]*），
// 替换串统一用固定缩进——保证幂等：重复运行不会在 nav 行累积多余空格
const tocListRe = /[ \t]*<nav class="toc-list">[\s\S]*?<\/nav>/;
if (!tocListRe.test(html)) {
  console.error('错误：未找到 <nav class="toc-list">，无法替换');
  process.exit(1);
}

// 写回两处改动：重排后的正文标题编号 + 重新生成的目录。
// 正文区域用原始匹配串做整体替换，编号修改只发生在其内部。
// 替换值用函数形式返回：字符串形式会把正文里的 "$$"/"$&" 等当作替换模式，
// 破坏 KaTeX 公式
let updated = html;
if (contentUpdated !== contentHtml) {
  updated = updated.replace(contentMatch[1], () => contentUpdated);
}
updated = updated.replace(tocListRe, () => tocListHtml);
writeFileSync(htmlPath, updated, 'utf-8');

const h2Count = headings.filter(h => h.level === 'h2').length;
const h3Count = headings.filter(h => h.level === 'h3').length;
console.log(`目录已更新：${headings.length} 个条目（${h2Count} 章，${h3Count} 节）` +
  (renumbered > 0 ? `；章节编号已重排 ${renumbered} 处` : ''));
