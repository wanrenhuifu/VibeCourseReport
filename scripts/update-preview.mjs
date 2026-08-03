/**
 * Vibe 课程报告 · README 预览截图生成
 *
 * 用无头 Chromium 以 screen 布局渲染 index.html 并截图到 assets/preview.png，
 * 供 README 顶部预览图使用。模板内容或样式变更后重跑此脚本，可保持截图与模板同步。
 *
 * 构图约定：截图区域 = 顶部工具栏 + 完整封面 + 封面下方一段灰底留白。
 * 封面高度每次渲染时实测（不依赖写死的页高），封面内容变高时截图自动变高，
 * 不会把摘要切进画面；若封面与摘要之间的灰底留白不足，脚本会告警并以退出码 1 结束。
 *
 * 用法：
 *   npm run screenshot
 *   node scripts/update-preview.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/update-preview.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './lib/chrome.mjs';
import { checkCjkFonts, checkMissingAssets } from './lib/page-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const htmlPath = resolve(ROOT, 'index.html');
const outputPath = resolve(ROOT, 'assets/preview.png');

// 截图源文件清单（内容变化即视为截图已过期，见下面的"同步标记"）。
// page-checks.mjs 会改变告警判定行为（决定截图是否落盘），同样计入指纹
const SOURCE_FILES = ['index.html', 'styles.css', 'assets/school-emblem.svg', 'scripts/update-preview.mjs', 'scripts/lib/page-checks.mjs'];
const MANIFEST_PATH = resolve(ROOT, 'assets/preview.sources.json');

// 封面下方保留的灰底留白（px）。封面与摘要之间的灰色间隔（.page > section + section 的
// margin-top）约 48px，这里取 36px 让底边稳落在灰底上、且不越过分隔线；留白不足时告警。
const COVER_BOTTOM_MARGIN = 36;
// deviceScaleFactor 2 以 2 倍物理分辨率输出，README 放大查看时文字仍清晰。
// 代价：preview.png 体积约翻倍——这是有意的权衡，见提交记录。
const DEVICE_SCALE_FACTOR = 2;

if (!existsSync(htmlPath)) {
  console.error(`错误：未找到 index.html（${htmlPath}）`);
  process.exit(1);
}

// 提前确保输出目录存在并可写——若 assets/ 只读，这里就以清晰的报错提前失败，
// 而不是在渲染完成后抛裸 EACCES
try {
  mkdirSync(dirname(outputPath), { recursive: true });
} catch (e) {
  console.error(`错误：无法写入输出目录 ${dirname(outputPath)}：${e.message}`);
  process.exit(1);
}

let browser;
let hasWarnings = false;
try {
  browser = await launchChrome();
  const page = await browser.newPage();

  // 先用一个临时视口把页面渲染出来，稍后按实测几何调整（宽 = 纸张宽 + 两侧灰底边距）。
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  await page.emulateMediaType('screen');

  // 截图区域（工具栏 + 封面）不含 KaTeX，直接把 cdn.jsdelivr.net 的请求拦掉：
  // 否则 CDN 挂起时 DOMContentLoaded / networkidle0 永不触发，脚本白白等 30s 超时。
  // 导出 PDF 的 export-pdf.mjs 需要正文公式所以保留 CDN，两者需求不同。
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('cdn.jsdelivr.net')) req.abort();
    else req.continue();
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.cover', { timeout: 10_000 });
  // 等字体就绪（并限时），避免 CJK 字形尚未加载就截图
  await page.evaluate(() => Promise.race([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 10_000)),
  ]));
  // 等所有图片加载完成（或失败）。不等网络空闲，就显式等图片，避免把未加载的
  // 校徽误判为缺失资源
  await page.waitForFunction(
    () => [...document.images].every((img) => img.complete),
    { timeout: 10_000 }
  );

  // ---------- 读取页面几何与封面高度 ----------
  const metrics = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const cover = document.querySelector('.cover');
    const abstract = document.querySelector('.abstract');
    const coverRect = cover.getBoundingClientRect();
    return {
      sheetW: parseFloat(cs.getPropertyValue('--sheet-w')),
      marginX: parseFloat(cs.getPropertyValue('--margin-x')),
      coverBottom: coverRect.bottom,
      abstractTop: abstract ? abstract.getBoundingClientRect().top : null,
    };
  });

  if (!Number.isFinite(metrics.sheetW) || !Number.isFinite(metrics.marginX) || !Number.isFinite(metrics.coverBottom)) {
    console.error('错误：无法从页面读取几何信息（--sheet-w / --margin-x / .cover）');
    process.exit(1);
  }

  // 视口宽度不写死：从 styles.css 的计算样式读取纸张宽与左右边距（唯一真源），
  // 页面用 margin:auto 居中 → 两侧灰底边距相等。styles.css 改动几何时截图自动同步，
  // 不存在第三处需要手动维护的硬编码副本。
  const viewportWidth = Math.ceil(metrics.sheetW + 2 * metrics.marginX);

  // 截图底边 = 封面底 + 灰底留白；若封面与摘要间距不足，收到底边到分隔线之前
  const targetBottom = metrics.coverBottom + COVER_BOTTOM_MARGIN;
  const frameBottom = metrics.abstractTop !== null
    ? Math.min(targetBottom, metrics.abstractTop - 8)
    : targetBottom;
  if (frameBottom < targetBottom - 0.5) {
    console.warn(
      `⚠ 警告：封面与摘要间距过小（${Math.round(metrics.abstractTop - metrics.coverBottom)}px），\n` +
      `   封面下方灰底留白不足 ${COVER_BOTTOM_MARGIN}px，截图构图会被压缩——请精简封面内容或加大间距后重跑`
    );
    hasWarnings = true;
  }

  await page.setViewport({
    width: viewportWidth,
    height: Math.max(100, Math.ceil(frameBottom)),
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  // 调整视口后等两帧，确保重排完成再截图
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // ---------- CJK 字体检测（与 export-pdf.mjs 共用 scripts/lib/page-checks.mjs） ----------
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

  // 有告警时不写 preview.png（也不更新同步标记）：避免用一张有缺陷的渲染
  // 覆盖已提交的好图，同时以非零退出码明确失败。只有无告警的干净渲染才落盘。
  if (hasWarnings) {
    console.error('（截图有告警，未写入 preview.png——请修复上述 ⚠ 问题后重新运行）');
    process.exitCode = 1;
  } else {
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`预览截图已更新：${outputPath}`);

    // 同步标记：记录生成该截图的源文件指纹，npm run check 会用当前指纹与之比对，
    // 不一致即判定截图过期（CI 因此失败），杜绝"改了源文件却忘了重跑截图、
    // 把过期的 preview.png 提交上去"
    const sources = {};
    for (const f of SOURCE_FILES) {
      sources[f] = createHash('sha256').update(readFileSync(resolve(ROOT, f))).digest('hex');
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify({ sources }, null, 2) + '\n');
  }
} catch (e) {
  console.error(`错误：截图失败——${e.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
