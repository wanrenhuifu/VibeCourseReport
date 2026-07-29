/**
 * Vibe 课程报告 · README 预览截图生成
 *
 * 用无头 Chromium 以 screen 布局渲染 index.html 并截图到 assets/preview.png，
 * 供 README 顶部预览图使用。模板内容或样式变更后重跑此脚本，可保持截图与模板同步。
 *
 * 用法：
 *   npm run screenshot
 *   node scripts/update-preview.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/update-preview.mjs
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const htmlPath = resolve(ROOT, 'index.html');
const outputPath = resolve(ROOT, 'assets/preview.png');

// 截图构图：1100×1500 视口（页面宽 793.7px + 两侧灰底边距），保留顶部工具栏；
// deviceScaleFactor 2 以 2 倍物理分辨率输出，README 放大查看时文字仍清晰
const VIEWPORT = { width: 1100, height: 1500 };

if (!existsSync(htmlPath)) {
  console.error(`错误：未找到 index.html（${htmlPath}）`);
  process.exit(1);
}

// 查找本机 Chromium（与 export-pdf.mjs 同源，覆盖 Win/macOS/Linux 常见安装路径）
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const { PROGRAMFILES, 'PROGRAMFILES(X86)': PROGRAMFILES_X86, LOCALAPPDATA } = process.env;
  if (PROGRAMFILES) candidates.push(
    join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  );
  if (PROGRAMFILES_X86) candidates.push(
    join(PROGRAMFILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAMFILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  );
  if (LOCALAPPDATA) candidates.push(join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('未找到 Chrome / Chromium，请设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
}

let browser;
try {
  const args = ['--force-color-profile=srgb'];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-dev-shm-usage');

  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args });
  const page = await browser.newPage();
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 2 });
  await page.emulateMediaType('screen');
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 30_000 });
  // 等字体就绪，避免截图时 CJK 字形尚未加载
  await page.evaluate(() => document.fonts.ready);

  // 默认 fullPage:false，截取当前视口（= VIEWPORT 尺寸），构图确定不随正文长度变化
  await page.screenshot({ path: outputPath, type: 'png' });
  console.log(`预览截图已更新：${outputPath}`);
} finally {
  if (browser) await browser.close();
}
