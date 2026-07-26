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
import puppeteer from 'puppeteer-core';

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

// ---------- 查找本机 Chromium ----------
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    // Linux
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  // Windows：安装盘未必是 C 盘，用环境变量拼接而非硬编码；
  // LOCALAPPDATA 覆盖无管理员权限的每用户 Chrome 安装（新版 Windows 默认方式）
  const { PROGRAMFILES, 'PROGRAMFILES(X86)': PROGRAMFILES_X86, LOCALAPPDATA } = process.env;
  if (PROGRAMFILES) candidates.push(
    `${PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  );
  if (PROGRAMFILES_X86) candidates.push(
    `${PROGRAMFILES_X86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${PROGRAMFILES_X86}\\Microsoft\\Edge\\Application\\msedge.exe`,
  );
  if (LOCALAPPDATA) candidates.push(
    `${LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  );
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('未找到 Chrome / Chromium，请设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
}

let browser;
try {
  // --no-sandbox 和 --disable-dev-shm-usage 仅 Linux 环境（Docker / CI）需要
  const args = ['--force-color-profile=srgb'];
  if (process.platform === 'linux') {
    args.push('--no-sandbox', '--disable-dev-shm-usage');
  }

  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args,
  });

  const page = await browser.newPage();
  await page.emulateMediaType('screen');
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });

  // 等待字体就绪（evaluate 不带 Handle 会等待返回的 Promise 在浏览器内 resolve）
  await page.evaluate(() => document.fonts.ready);

  // 设置导出模式 + 回填目录页码 + 读取页脚字体（合并为一次浏览器往返）
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
  }
  if (tocFilled.overflowing.length) {
    console.warn(
      `⚠ 警告：${tocFilled.overflowing.join('、')}内容超过一页，PDF 中已被截断——请精简后重新导出`
    );
  }

  // --sans 的值带双引号（如 "Noto Sans CJK SC"），原样插入双引号包裹的 style 属性
  // 会被 HTML 解析器在第一个内部引号处截断、丢弃整条 font-family 声明；
  // 换成 CSS 同样合法的单引号，页脚字体才能真正与 --sans 一致
  const footerFont = tocFilled.footerFont.replace(/"/g, "'");

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
      <div style="width:100%;text-align:center;font-size:9px;color:#666;
                  font-family:${footerFont};">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`,
  });

  console.log(`PDF 已导出：${output}`);
} finally {
  if (browser) await browser.close();
}
