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

// ---------- 引号兼容的属性匹配 ----------
// HTML 属性值允许单引号或双引号。AI 偶尔生成单引号属性（如 id='sec-1'），
// 按双引号硬匹配的正则会漏判——明明 id 存在却报"找不到"。下面的辅助函数
// 统一处理两种引号。
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 提取 html 中所有 attrName 属性的值（单/双引号均可），返回字符串数组 */
function attrValues(html, attrName) {
  const re = new RegExp(`\\b${escapeRe(attrName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g');
  const values = [];
  let m;
  while ((m = re.exec(html)) !== null) values.push(m[1] ?? m[2]);
  return values;
}

/** html 中是否存在 attrName="value" 或 attrName='value' */
function hasAttr(html, attrName, value) {
  const re = new RegExp(`\\b${escapeRe(attrName)}\\s*=\\s*(?:"${escapeRe(value)}"|'${escapeRe(value)}')`);
  return re.test(html);
}

console.log('VibeCourseReport · 结构校验\n');

if (!existsSync(htmlPath)) {
  console.error('错误：未找到 index.html');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf-8');

// --- 1. data-toc-target ↔ id 对应 ---
console.log('[1] 目录条目 ↔ 正文标题');
const tocTargets = attrValues(html, 'data-toc-target');

if (tocTargets.length === 0) {
  warn('未找到任何 data-toc-target 条目');
} else {
  for (const target of tocTargets) {
    if (hasAttr(html, 'id', target)) {
      ok(`#${target}`);
    } else {
      err(`data-toc-target="#${target}" 在文档中找不到对应的 id，页码将留空`);
    }
  }
}

// --- 2. <img src> 检查 ---
console.log('\n[2] 图片资源');
const imgSrcRe = /<img[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
let imgCount = 0;
let m;
while ((m = imgSrcRe.exec(html)) !== null) {
  imgCount++;
  const src = m[1] ?? m[2];
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
// 定位 .content 区域：class 允许单/双引号、多个类名、任意属性顺序；
// .content 内可能嵌套 <section>（如 appendix），用 </main> 作为截止标记
let contentHtml = null;
{
  const sectionTagRe = /<section\b[^>]*>/gi;
  let sm;
  while ((sm = sectionTagRe.exec(html)) !== null) {
    const classMatch = sm[0].match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const classes = classMatch ? (classMatch[1] ?? classMatch[2]).split(/\s+/) : [];
    if (!classes.includes('content')) continue;
    const endIdx = html.indexOf('</main>', sm.index + sm[0].length);
    contentHtml = html.slice(sm.index + sm[0].length, endIdx >= 0 ? endIdx : undefined);
    break;
  }
}
// 收集 { level, id, text } 供 [5] 编号连续性检查复用（缺 id 的标题 id 为 null）
const contentHeadings = [];
if (contentHtml === null) {
  err('未找到 <section class="content">');
} else {
  // 完整匹配开闭标签以提取标题文本；id 属性兼容单/双引号
  const headingRe = /<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let headingCount = 0;
  while ((m = headingRe.exec(contentHtml)) !== null) {
    headingCount++;
    const attrs = m[2];
    const text = m[3].replace(/<[^>]*>/g, '').trim();
    const idMatch = attrs.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    const id = idMatch ? (idMatch[1] ?? idMatch[2]) : null;
    contentHeadings.push({ level: m[1], id, text });
    if (id) {
      ok(`${m[1]}#${id}`);
    } else {
      err(`${m[1]} 缺少 id 属性：${text.slice(0, 40)}`);
    }
  }
  if (headingCount === 0) warn('未找到任何 h2/h3 标题');
}

// --- 4. 目录条目与正文标题数量比较 ---
console.log('\n[4] 数量一致性');
if (contentHeadings.length > 0) {
  const h2Count = contentHeadings.filter(h => h.level === 'h2').length;
  const h3Count = contentHeadings.filter(h => h.level === 'h3').length;
  const headingTotal = h2Count + h3Count;
  if (tocTargets.length === headingTotal) {
    ok(`目录 ${tocTargets.length} 条 = 正文标题 ${headingTotal} 个（${h2Count} h2 + ${h3Count} h3）`);
  } else {
    warn(`目录 ${tocTargets.length} 条 ≠ 正文标题 ${headingTotal} 个（${h2Count} h2 + ${h3Count} h3）——考虑运行 npm run build:toc 重新生成目录`);
  }
}

// --- 5. 章节编号连续性 ---
// 带数字前缀的标题（如"2.1　..."）编号应按出现顺序连续（h2: 1,2,3...，
// h3: 章号.1, 章号.2...）。编号跳号/重复通常是增删章节后忘了顺延——
// 直接运行 npm run build:toc 即可自动重排。仅告警不报错：个别课程可能
// 有意使用非常规编号。
console.log('\n[5] 章节编号连续性');
const numPrefixRe = /^\s*(\d+(?:\.\d+)*)/;
{
  let chapter = 0;
  let sub = 0;
  let numberedCount = 0;
  const numberIssues = [];
  for (const h of contentHeadings) {
    const numMatch = h.text.match(numPrefixRe);
    if (!numMatch) continue; // 无编号标题（参考文献等）不参与检查
    numberedCount++;
    const num = numMatch[1];
    const parts = num.split('.');
    const label = `${h.level}${h.id ? '#' + h.id : ''}（${h.text.slice(0, 24)}）`;
    if (h.level === 'h2') {
      if (parts.length !== 1) {
        numberIssues.push(`${label} 编号"${num}"带小数点，与章级标题不符`);
        continue;
      }
      chapter++;
      sub = 0;
      if (Number(parts[0]) !== chapter) {
        numberIssues.push(`${label} 编号为 ${num}，按顺序应为 ${chapter}`);
        // 以实际编号为准继续，避免一个错误级联报出后续所有偏差
        chapter = Number(parts[0]);
      }
    } else { // h3
      if (parts.length !== 2) {
        numberIssues.push(`${label} 编号"${num}"缺少章号前缀，与节级标题不符`);
        continue;
      }
      sub++;
      const expected = `${chapter}.${sub}`;
      if (num !== expected) {
        numberIssues.push(`${label} 编号为 ${num}，按顺序应为 ${expected}`);
        if (Number(parts[0]) === chapter) sub = Number(parts[1]);
      }
    }
  }
  if (numberedCount === 0) {
    warn('正文标题均未带数字编号，跳过连续性检查');
  } else if (numberIssues.length === 0) {
    ok(`${numberedCount} 个带编号标题的编号连续一致`);
  } else {
    for (const issue of numberIssues) warn(issue);
    warn('运行 npm run build:toc 可自动重排章节编号');
  }
}

// --- 6. 脚注锚点 ---
// 检查正文脚注引用 <sup class="fn-ref"><a href="#fn-N"> 与底部 <ol class="footnotes"> 的对应。
// 属性引号必须用直引号（单/双均可）：曾出现过用弯引号 ” 包裹属性导致样式与跳转
// 全部失效的回归，此处正则只匹配直引号，弯引号写法会因匹配不到 id 而报错（防回归）。
console.log('\n[6] 脚注锚点');
const fnRefRe = /<sup\s[^>]*\bclass\s*=\s*(?:"fn-ref"|'fn-ref')[^>]*>\s*<a[^>]*\bhref\s*=\s*(?:"#(fn-\d+)"|'#(fn-\d+)')[^>]*>/g;
const fnRefTargets = [];
while ((m = fnRefRe.exec(html)) !== null) fnRefTargets.push(m[1] ?? m[2]);

if (fnRefTargets.length === 0) {
  warn('未找到任何脚注引用（<sup class="fn-ref">）');
} else {
  for (const target of fnRefTargets) {
    if (hasAttr(html, 'id', target)) {
      ok(`脚注引用 #${target} → 对应 <li id="${target}"> 存在`);
    } else {
      err(`脚注引用 #${target} 在文档中找不到对应的 <li id="${target}">，跳转将失效`);
    }
  }
}

// 反向检查：每个脚注 li 都应被正文引用，回跳链接都应指向存在的 id
const fnLiRe = /<li\s[^>]*\bid\s*=\s*(?:"(fn-\d+)"|'(fn-\d+)')[^>]*>/g;
const fnIds = [];
while ((m = fnLiRe.exec(html)) !== null) fnIds.push(m[1] ?? m[2]);
for (const id of fnIds) {
  if (!fnRefTargets.includes(id)) {
    warn(`脚注 <li id="${id}"> 在正文中没有对应的引用（死脚注）`);
  }
}
const fnBackRe = /\bhref\s*=\s*(?:"#(fnref-\d+)"|'#(fnref-\d+)')/g;
while ((m = fnBackRe.exec(html)) !== null) {
  const target = m[1] ?? m[2];
  if (hasAttr(html, 'id', target)) {
    ok(`回跳链接 #${target} → 对应 id 存在`);
  } else {
    err(`回跳链接 #${target} 找不到对应的 id，点击 ↩ 无法回到正文`);
  }
}

// --- 7. README 预览截图与同步标记 ---
// 防止"改了 index.html / styles.css 却忘了重跑 npm run screenshot"导致的过期 preview.png
// 被提交上去（CI 的 npm run check 会因此失败）。判定依据是 update-preview.mjs 写入的
// assets/preview.sources.json 里的源文件指纹，与当前源文件逐一比对，跨平台可靠。
console.log('\n[7] 预览截图（assets/preview.png）');
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
