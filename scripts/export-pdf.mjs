/**
 * Vibe 课程报告 · PDF 导出脚本
 *
 * 思路与 vibe-resume 一致：用 Chromium 渲染网页的 screen 布局，
 * 不使用浏览器的打印对话框。区别是简历是单页测量导出，
 * 课程报告是多页 A4 自动分页导出：
 *
 *   1. 强制 screen 媒体，隐藏网页工具栏；
 *   2. 封面 / 摘要 / 目录固定各占一页，正文自然分页；
 *   3. 按页面几何计算每个目录条目对应的真实页码并回填；
 *   4. 以 A4 + 固定页边距导出 PDF，页脚自动加页码。
 *
 * 已知限制：目录页码基于浏览器 screen 布局位置（getBoundingClientRect）
 * 计算，而 PDF 实际分页由 Chromium 打印引擎决定。对中文长文档，两种布局
 * 模型可能在多页后产生微小偏差（通常 ≤ 1 页）。
 *
 * 用法：
 *   node scripts/export-pdf.mjs [输出路径]
 *   CHROME_PATH=/path/to/chrome node scripts/export-pdf.mjs
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './lib/chrome.mjs';
import { checkCjkFonts, checkMissingAssets } from './lib/page-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- 页面几何（与 styles.css 中的像素值等价，均为 mm×96/25.4 精确换算，勿取整） ----------
const MM_TO_PX = 96 / 25.4;
const PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 25,
  marginBottomMm: 25,
  marginLeftMm: 28,
  marginRightMm: 28,
};
const CONTENT_HEIGHT_PX = (PAGE.heightMm - PAGE.marginTopMm - PAGE.marginBottomMm) * MM_TO_PX;

// 输出路径相对项目根目录解析（与 htmlPath 基准一致），从其他目录调用时 PDF 也落在项目 export/ 下；
// 用 || 而非 ?? 以便把空字符串参数（如 shell 展开未设置变量得到的 ""）也视为未传参，
// 避免渲染全部跑完后 page.pdf 才因路径是目录而抛 EISDIR
const output = resolve(ROOT, process.argv[2] || 'export/vibe-course-report-demo.pdf');

// 提前创建输出目录——避免浏览器启动后因权限问题失败而浪费先前工作
mkdirSync(dirname(output), { recursive: true });

// ---------- 检查源文件 ----------
const htmlPath = resolve(ROOT, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`错误：未找到 index.html（${htmlPath}）`);
  process.exit(1);
}

let browser;
let hasWarnings = false;
try {
  // 浏览器探测与启动参数统一在 scripts/lib/chrome.mjs（findChrome/launchChrome），
  // 与 update-preview.mjs 共用，浏览器相关的修复只需改一处
  browser = await launchChrome();

  const page = await browser.newPage();
  await page.emulateMediaType('screen');

  // 页面加载：不用 networkidle0——KaTeX 从 CDN 加载，断网 / CDN 挂起时
  // DOMContentLoaded 永不触发（defer 脚本未执行完），goto 会干等 30s 超时，
  // 整个导出直接失败。改为两段式：goto 用 domcontentloaded + 短超时，再显式等网络空闲。
  // 注意：defer 脚本不阻塞 DOM 解析，CDN 挂起时文档树仍会解析完整，
  // 超时后拦截 cdn.jsdelivr.net 请求继续渲染即可——公式退回 HTML 实体 / Unicode 显示
  // （模板公式本就有实体兜底，不依赖 KaTeX 也能看懂）。
  let cdnAvailable = true;
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForNetworkIdle({ timeout: 5_000, idleTime: 500 });
  } catch (e) {
    // 只有超时（TimeoutError）才降级为离线渲染；其他错误（如浏览器崩溃）直接抛出
    if (e?.name !== 'TimeoutError') throw e;
    cdnAvailable = false;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('cdn.jsdelivr.net')) req.abort();
      else req.continue();
    });
  }
  if (!cdnAvailable) {
    console.warn('⚠ 警告：KaTeX CDN 不可达（已继续渲染，公式将显示为 HTML 实体 / Unicode）');
    hasWarnings = true;
  }

  // 确保正文已解析（'commit' 之后 DOM 可能仍在解析，后续检测依赖完整 DOM）
  await page.waitForSelector('.cover', { timeout: 10_000 });

  // 等待字体就绪（evaluate 不带 Handle 会等待返回的 Promise 在浏览器内 resolve）
  await page.evaluate(() => document.fonts.ready);

  // ---------- 读取页面元数据 ----------
  const pageMeta = await page.evaluate(() => ({
    title: document.title || '',
  }));
  if (pageMeta.title) {
    console.log(`报告标题：${pageMeta.title}`);
    // 将页面标题注入为 PDF 文档标题（通过 <title> 元素，Chromium 读取后写入 PDF metadata）
    await page.evaluate((t) => { document.title = t; }, pageMeta.title);
  }

  // ---------- CJK 字体检测 ----------
  // 判据细节见 scripts/lib/page-checks.mjs（宽度对比探针，两个常见判据
  // getComputedStyle().fontFamily / document.fonts.check() 都不可靠，已实测排除）
  const fontResult = await checkCjkFonts(page);
  if (!fontResult.ok) {
    console.warn(fontResult.message);
    hasWarnings = true;
  }

  // ---------- 缺失资源预检 ----------
  const assetResult = await checkMissingAssets(page);
  if (!assetResult.ok) {
    console.warn(assetResult.message);
    hasWarnings = true;
  }

  // ---------- 设置导出模式 + 回填目录页码 + 读取页脚字体 ----------
  const tocFilled = await page.evaluate((contentHeightPx) => {
    // 设置 CSS 变量，供 styles.css 中 body.exporting 规则使用
    document.documentElement.style.setProperty('--content-height', contentHeightPx + 'px');

    // 进入导出模式（触发 styles.css 中 body.exporting 下的所有规则）
    document.body.classList.add('exporting');

    // 回填目录页码：页码 = floor(距顶部距离 / 单页内容高度) + 1
    // epsilon (1e-9) 防止 IEEE 754 浮点精度导致边界值偏差
    let count = 0;
    const missed = [];
    document.querySelectorAll('[data-toc-target]').forEach((el) => {
      const target = document.getElementById(el.dataset.tocTarget);
      if (!target) {
        missed.push(el.dataset.tocTarget);
        return;
      }
      const top = target.getBoundingClientRect().top + window.scrollY;
      el.textContent = String(Math.floor(top / contentHeightPx + 1e-9) + 1);
      count += 1;
    });

    // 检测前置部分溢出：固定页高 + overflow:hidden 会静默裁掉超长内容，必须显式告警。
    // 用 querySelectorAll 逐个检查（.abstract 有两个：中文 + 英文），避免英文摘要溢出漏报
    const overflowing = [];
    [['.cover', '封面'], ['.abstract', '中文摘要'], ['.abstract-en', '英文摘要'], ['.toc', '目录']].forEach(([sel, name]) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.scrollHeight - el.clientHeight > 0.5) overflowing.push(name);
      });
    });

    // 读取 --sans 变量供 PDF 页脚使用（页脚字体与 CSS 始终保持一致，无需手动同步）
    const footerFont = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim();

    return { count, missed, overflowing, footerFont };
  }, CONTENT_HEIGHT_PX);

  console.log(`目录页码已回填 ${tocFilled.count} 条`);
  if (tocFilled.missed.length) {
    console.warn(
      `⚠ 警告：${tocFilled.missed.length} 个目录目标未找到，对应页码留空：` +
      tocFilled.missed.map(id => '#' + id).join(', ')
    );
    hasWarnings = true;
  }
  if (tocFilled.overflowing.length) {
    console.warn(
      `⚠ 警告：${tocFilled.overflowing.join('、')}内容超过一页，PDF 中已被截断——请精简后重新导出`
    );
    hasWarnings = true;
  }

  // 构造页脚样式。--sans 的值可能包含双引号（如 "Noto Sans CJK SC"），
  // 插入 HTML style 属性时内部双引号会截断属性值。
  // 用 JSON.stringify 对完整 style 值做 JS 字符串转义，保证任何引号都被正确编码。
  const footerStyle = `width:100%;text-align:center;font-size:9px;color:#666;font-family:${tocFilled.footerFont}`;

  await page.pdf({
    path: output,
    width: `${PAGE.widthMm}mm`,
    height: `${PAGE.heightMm}mm`,
    margin: {
      top: `${PAGE.marginTopMm}mm`,
      bottom: `${PAGE.marginBottomMm}mm`,
      left: `${PAGE.marginLeftMm}mm`,
      right: `${PAGE.marginRightMm}mm`,
    },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style=${JSON.stringify(footerStyle)}>
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`,
    // 生成 PDF 书签/大纲，阅读器侧边栏可跳转章节
    outline: true,
    tagged: true,
  });

  console.log(`PDF 已导出：${output}`);
  if (hasWarnings) {
    console.error('（导出时有警告，请检查上述 ⚠ 信息）');
    // 非零退出码让 CI 的 Export PDF 步骤失败，避免放行截断/损坏的 PDF
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
}
