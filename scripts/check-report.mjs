/**
 * 报告结构校验脚本
 *
 * 检查 index.html 的结构完整性：
 *   - data-toc-target 是否都有对应的 id
 *   - <img src> 是否都指向存在的文件
 *   - .content 中的 h2 是否都有 id
 *   - data-toc-target 条目数是否与 .content 中的 h2/h3 数一致
 *
 * 用法：
 *   node scripts/check-report.mjs              # 检查并报告结果
 *   npm run check                              # 同上（通过 package.json scripts）
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const htmlPath = resolve(ROOT, 'index.html');

let errors = 0;
let warnings = 0;

function err(msg) { console.error(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.warn(`  ⚠ ${msg}`); warnings++; }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log('VibeCourseReport · 结构校验\n');

if (!existsSync(htmlPath)) {
  console.error('错误：未找到 index.html');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf-8');

// --- 1. data-toc-target ↔ id 对应 ---
console.log('[1] 目录条目 ↔ 正文标题');
const tocTargetRe = /data-toc-target="([^"]+)"/g;
const tocTargets = [];
let m;
while ((m = tocTargetRe.exec(html)) !== null) tocTargets.push(m[1]);

if (tocTargets.length === 0) {
  warn('未找到任何 data-toc-target 条目');
} else {
  for (const target of tocTargets) {
    const idRe = new RegExp(`\\bid\\s*=\\s*"${target}"`);
    if (idRe.test(html)) {
      ok(`#${target}`);
    } else {
      err(`data-toc-target="#${target}" 在文档中找不到对应的 id，页码将留空`);
    }
  }
}

// --- 2. <img src> 检查 ---
console.log('\n[2] 图片资源');
const imgSrcRe = /<img[^>]*\bsrc\s*=\s*"([^"]*)"[^>]*>/gi;
let imgCount = 0;
while ((m = imgSrcRe.exec(html)) !== null) {
  imgCount++;
  const src = m[1];
  // 跳过外部 URL
  if (/^https?:/.test(src)) {
    ok(`${src} (外部 URL，跳过)`);
    continue;
  }
  const imgPath = resolve(ROOT, src);
  if (existsSync(imgPath)) {
    ok(src);
  } else {
    err(`图片不存在：${src}`);
  }
}
if (imgCount === 0) warn('未找到任何 <img> 元素');

// --- 3. .content 中 h2/h3 的 id ---
console.log('\n[3] 正文标题 id');
// 注意：.content 内可能嵌套 <section>（如 appendix），用 </main> 作为截止标记
const contentMatch = html.match(/<section class="content"[^>]*>([\s\S]*?)<\/main>/);
if (!contentMatch) {
  err('未找到 <section class="content">');
} else {
  const contentHtml = contentMatch[1];
  const headingRe = /<(h[23])\b([^>]*)>/gi;
  let headingCount = 0;
  while ((m = headingRe.exec(contentHtml)) !== null) {
    headingCount++;
    const attrs = m[2];
    const idMatch = attrs.match(/\bid\s*=\s*"([^"]*)"/);
    if (idMatch) {
      ok(`${m[1]}#${idMatch[1]}`);
    } else {
      // Try to extract heading text for better error message
      const tagEnd = contentHtml.indexOf('>', m.index + m[0].length);
      const closeTag = contentHtml.indexOf(`</${m[1]}>`, tagEnd);
      const text = closeTag > tagEnd ? contentHtml.slice(tagEnd + 1, closeTag).replace(/<[^>]*>/g, '').trim().slice(0, 40) : '';
      err(`${m[1]} 缺少 id 属性：${text}`);
    }
  }
  if (headingCount === 0) warn('未找到任何 h2/h3 标题');
}

// --- 4. 目录条目与正文标题数量比较 ---
console.log('\n[4] 数量一致性');
const contentH2H3 = [...html.matchAll(/<section class="content"[^>]*>([\s\S]*?)<\/main>/g)];
if (contentH2H3.length > 0) {
  const contentSection = contentH2H3[0][0];
  const h2Count = (contentSection.match(/<h2\b/gi) || []).length;
  const h3Count = (contentSection.match(/<h3\b/gi) || []).length;
  const headingTotal = h2Count + h3Count;
  if (tocTargets.length === headingTotal) {
    ok(`目录 ${tocTargets.length} 条 = 正文标题 ${headingTotal} 个（${h2Count} h2 + ${h3Count} h3）`);
  } else {
    warn(`目录 ${tocTargets.length} 条 ≠ 正文标题 ${headingTotal} 个（${h2Count} h2 + ${h3Count} h3）——考虑运行 npm run build:toc 重新生成目录`);
  }
}

// --- 汇总 ---
console.log(`\n${errors > 0 ? '❌' : '✅'} ${errors} 个错误，${warnings} 个警告`);
process.exit(errors > 0 ? 1 : 0);
