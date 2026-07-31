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

  // 设置页面加载超时：避免因挂起的网络请求（如不存在的远程字体 CDN）导致无限等待
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 30_000 });

  // 等待字体就绪（evaluate 不带 Handle 会等待返回的 Promise 在浏览器内 resolve）
  await page.evaluate(() => document.fonts.ready);

  // ---------- 读取页面元数据 ----------
  const pageMeta = await page.evaluate(() => {
    const title = document.title || '';
    const authorEl = document.querySelector('meta[name="author"]');
    const author = authorEl ? authorEl.getAttribute('content') || '' : '';
    return { title, author };
  });
  if (pageMeta.title) {
    console.log(`报告标题：${pageMeta.title}`);
    // 将页面标题注入为 PDF 文档标题（通过 <title> 元素，Chromium 读取后写入 PDF metadata）
    await page.evaluate((t) => { document.title = t; }, pageMeta.title);
  }

  // ---------- CJK 字体检测 ----------
  // 两个常见判据都不灵（已在 headless Chrome 实测排除）：
  // 1. getComputedStyle().fontFamily 返回的是 CSS **声明**的字体列表（必含
  //    Noto/SimSun 等名字），不是渲染时实际命中的字体，字符串匹配恒为假阳性；
  // 2. document.fonts.check() 对**不存在**的字体也返回 true，对不覆盖给定文本的
  //    字体同样返回 true，无法区分"已安装且能渲染"。
  // 可靠判据——宽度对比：同一段混合探针文本渲染两次，一次用页面字体栈，一次强制
  // 走必然不存在的字体（Chromium 回落到 last-resort 字体，每个字符都是等宽方块，
  // 即 tofu 的真实形态）。两宽度一致 ⇒ 页面字体栈没命中任何能渲染这些字形的字体，
  // PDF 中文必为方块。探针混入拉丁字母是因为真实字体中拉丁字形宽度必然不同于
  // 等宽方块，防止"CJK 字形恰为 1em 宽、总宽与方块串巧合一致"的漏报。
  const fontCheck = await page.evaluate(() => {
    const pageStack = getComputedStyle(document.body).fontFamily;
    const probeText = '中A文B测C试D';
    const measure = (fontFamily) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:72px;';
      s.style.fontFamily = fontFamily;
      s.textContent = probeText;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const tofuWidth = measure('"VibeReportLastResortProbe_NoSuchFont"');
    const pageWidth = measure(pageStack);
    return { pageStack, tofuWidth, pageWidth, hasCjk: Math.abs(pageWidth - tofuWidth) > 0.01 };
  });
  if (!fontCheck.hasCjk) {
    console.warn(
      `⚠ 警告：页面字体栈无法渲染 CJK 字形（声明字体: ${fontCheck.pageStack}）。\n` +
      `   无头 Linux / Docker 环境需安装 CJK 字体包，否则 PDF 中文会显示为方块（tofu）。\n` +
      `   Debian/Ubuntu: sudo apt install fonts-noto-cjk\n` +
      `   RHEL/Fedora:   sudo yum install google-noto-cjk-fonts`
    );
    hasWarnings = true;
  }

  // ---------- 缺失资源预检 ----------
  const missingAssets = await page.evaluate(() => {
    const missing = [];
    // 检查所有图片是否成功加载
    for (const img of document.images) {
      if (img.naturalWidth === 0 && img.naturalHeight === 0) {
        missing.push(img.getAttribute('src') || img.currentSrc || '(未知来源)');
      }
    }
    return missing;
  });
  if (missingAssets.length > 0) {
    console.warn(
      `⚠ 警告：${missingAssets.length} 个图片资源加载失败，PDF 中对应位置将为空白：\n` +
      `   ${missingAssets.join('\n   ')}`
    );
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

    // 检测前置部分溢出：固定页高 + overflow:hidden 会静默裁掉超长内容，必须显式告警
    const overflowing = [];
    [['.cover', '封面'], ['.abstract', '摘要'], ['.toc', '目录']].forEach(([sel, name]) => {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight - el.clientHeight > 0.5) overflowing.push(name);
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
