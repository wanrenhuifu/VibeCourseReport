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

import { createHash } from 'node:crypto';
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

// --- 5. 脚注锚点 ---
// 检查正文脚注引用 <sup class="fn-ref"><a href="#fn-N"> 与底部 <ol class="footnotes"> 的对应。
// 属性引号必须用直引号 "：曾出现过用弯引号 ” 包裹属性导致样式与跳转全部失效的回归，
// 此处正则按直引号匹配，弯引号写法会因匹配不到 id 而报错（防回归）。
console.log('\n[5] 脚注锚点');
const fnRefRe = /<sup class="fn-ref"[^>]*>\s*<a[^>]*href="#(fn-\d+)"[^>]*>/g;
const fnRefTargets = [];
while ((m = fnRefRe.exec(html)) !== null) fnRefTargets.push(m[1]);

if (fnRefTargets.length === 0) {
  warn('未找到任何脚注引用（<sup class="fn-ref">）');
} else {
  for (const target of fnRefTargets) {
    const idRe = new RegExp(`\\bid\\s*=\\s*"${target}"`);
    if (idRe.test(html)) {
      ok(`脚注引用 #${target} → 对应 <li id="${target}"> 存在`);
    } else {
      err(`脚注引用 #${target} 在文档中找不到对应的 <li id="${target}">，跳转将失效`);
    }
  }
}

// 反向检查：每个脚注 li 都应被正文引用，回跳链接都应指向存在的 id
const fnLiRe = /<li id="(fn-\d+)">/g;
const fnIds = [];
while ((m = fnLiRe.exec(html)) !== null) fnIds.push(m[1]);
for (const id of fnIds) {
  if (!fnRefTargets.includes(id)) {
    warn(`脚注 <li id="${id}"> 在正文中没有对应的引用（死脚注）`);
  }
}
const fnBackRe = /href="#(fnref-\d+)"/g;
while ((m = fnBackRe.exec(html)) !== null) {
  const idRe = new RegExp(`\\bid\\s*=\\s*"${m[1]}"`);
  if (idRe.test(html)) {
    ok(`回跳链接 #${m[1]} → 对应 id 存在`);
  } else {
    err(`回跳链接 #${m[1]} 找不到对应的 id，点击 ↩ 无法回到正文`);
  }
}

// --- 6. README 预览截图与同步标记 ---
// 防止"改了 index.html / styles.css 却忘了重跑 npm run screenshot"导致的过期 preview.png
// 被提交上去（CI 的 npm run check 会因此失败）。判定依据是 update-preview.mjs 写入的
// assets/preview.sources.json 里的源文件指纹，与当前源文件逐一比对，跨平台可靠。
console.log('\n[6] 预览截图（assets/preview.png）');
const previewPath = resolve(ROOT, 'assets/preview.png');
const manifestPath = resolve(ROOT, 'assets/preview.sources.json');

if (!existsSync(previewPath)) {
  err('assets/preview.png 不存在（README 顶部预览图引用它）——请运行 npm run screenshot 生成');
} else {
  ok('assets/preview.png 存在');
}

if (existsSync(manifestPath)) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    err('assets/preview.sources.json 无法解析（JSON 损坏）——请重新运行 npm run screenshot');
    manifest = null;
  }
  if (manifest) {
    if (!manifest.sources || typeof manifest.sources !== 'object') {
      err('assets/preview.sources.json 格式无效（缺少 sources 字段）——请重新运行 npm run screenshot');
    } else {
      let stale = false;
      for (const [file, recordedHash] of Object.entries(manifest.sources)) {
        const abs = resolve(ROOT, file);
        if (!existsSync(abs)) {
          err(`同步标记引用的源文件不存在：${file}`);
          stale = true;
          continue;
        }
        const current = createHash('sha256').update(readFileSync(abs)).digest('hex');
        if (current !== recordedHash) {
          err(`preview.png 已过期：${file} 已变更但截图未重新生成——请运行 npm run screenshot`);
          stale = true;
        }
      }
      if (!stale) ok('preview.png 与源文件同步（assets/preview.sources.json）');
    }
  }
} else if (existsSync(previewPath)) {
  err('缺少 assets/preview.sources.json（截图同步标记）——请运行 npm run screenshot 重新生成');
}

// --- 汇总 ---
console.log(`\n${errors > 0 ? '❌' : '✅'} ${errors} 个错误，${warnings} 个警告`);
process.exit(errors > 0 ? 1 : 0);
