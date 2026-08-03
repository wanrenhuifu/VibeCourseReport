/**
 * 页面渲染健康检查（export-pdf.mjs 与 update-preview.mjs 共用）。
 *
 * 与 scripts/lib/chrome.mjs 同理：这段检测逻辑曾在这两个脚本里各写一份，
 * 容易漂移——某个脚本修了判据或告警文案，另一个却不知道。统一收口到这里，
 * 任何检测相关的修复只需改这一处。告警文案两处共用（以"导出产物"统称
 * PDF 与截图），产物名差异由调用脚本的输出上下文自然体现。
 */

/**
 * CJK 字体检测。
 *
 * 两个常见判据都不灵（已在 headless Chrome 实测排除）：
 * 1. getComputedStyle().fontFamily 返回的是 CSS **声明**的字体列表（必含
 *    Noto/SimSun 等名字），不是渲染时实际命中的字体，字符串匹配恒为假阳性；
 * 2. document.fonts.check() 对**不存在**的字体也返回 true，对不覆盖给定文本的
 *    字体同样返回 true，无法区分"已安装且能渲染"。
 * 可靠判据——宽度对比：同一段混合探针文本渲染两次，一次用页面字体栈，一次强制
 * 走必然不存在的字体（Chromium 回落到 last-resort 字体，每个字符都是等宽方块，
 * 即 tofu 的真实形态）。两宽度一致 ⇒ 页面字体栈没命中任何能渲染这些字形的字体，
 * 导出产物中的中文必为方块。探针混入拉丁字母是因为真实字体中拉丁字形宽度必然
 * 不同于等宽方块，防止"CJK 字形恰为 1em 宽、总宽与方块串巧合一致"的漏报。
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function checkCjkFonts(page) {
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
  if (fontCheck.hasCjk) return { ok: true };
  return {
    ok: false,
    message:
      `⚠ 警告：页面字体栈无法渲染 CJK 字形（声明字体: ${fontCheck.pageStack}）。\n` +
      `   无头 Linux / Docker 环境需安装 CJK 字体包，否则导出产物中的中文会显示为方块（tofu）。\n` +
      `   Debian/Ubuntu: sudo apt install fonts-noto-cjk\n` +
      `   RHEL/Fedora:   sudo yum install google-noto-cjk-fonts`,
  };
}

/**
 * 缺失资源检测：检查所有 <img> 是否成功加载。
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function checkMissingAssets(page) {
  const missing = await page.evaluate(() => {
    const missing = [];
    // 检查所有图片是否成功加载
    for (const img of document.images) {
      if (img.naturalWidth === 0 && img.naturalHeight === 0) {
        missing.push(img.getAttribute('src') || img.currentSrc || '(未知来源)');
      }
    }
    return missing;
  });
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    message:
      `⚠ 警告：${missing.length} 个图片资源加载失败，导出产物中对应位置将为空白：\n` +
      `   ${missing.join('\n   ')}`,
  };
}
