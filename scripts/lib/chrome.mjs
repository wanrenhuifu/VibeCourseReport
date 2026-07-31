/**
 * 共享 Chromium 启动逻辑（export-pdf.mjs 与 update-preview.mjs 同源）。
 *
 * 浏览器探测 / 启动参数以前集中在这两个脚本里各写一份，容易漂移：
 * 某个脚本修了候选路径或启动参数，另一个却不知道。统一收口到这里，
 * 任何浏览器相关的修复只需改这一处。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const NOT_FOUND_MESSAGE = '未找到 Chrome / Chromium，请设置环境变量 CHROME_PATH 指向浏览器可执行文件。';

/**
 * 查找本机可用的 Chromium 可执行文件。
 *
 * - CHROME_PATH 已设置且有效 → 直接使用。
 * - CHROME_PATH 已设置但无效 → 告警后继续探测系统安装路径（不改变原有
 *   回退行为，但给用户一个明确的提示，而不是静默忽略后报"未设置"）。
 * - 都找不到 → 抛错，错误信息里带上 CHROME_PATH 的实际取值，方便排查。
 */
export function findChrome() {
  const envPath = process.env.CHROME_PATH;
  let envRejected = null;
  if (envPath) {
    if (existsSync(envPath)) return envPath;
    envRejected = envPath;
    console.warn(
      `⚠ 警告：CHROME_PATH=${envPath} 不存在，已忽略该设置，继续探测系统安装的浏览器`
    );
  }
  const candidates = [
    // Linux：google-chrome 优先——Ubuntu 上 /usr/bin/chromium(-browser) 常是
    // snap 过渡包的桩脚本，existsSync 为真但启动即失败（无 snapd 环境，如 CI）
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  // Windows：安装盘未必是 C 盘，用环境变量拼接而非硬编码；
  // LOCALAPPDATA 覆盖无管理员权限的每用户 Chrome 安装（新版 Windows 默认方式）
  const { PROGRAMFILES, 'PROGRAMFILES(X86)': PROGRAMFILES_X86, LOCALAPPDATA } = process.env;
  if (PROGRAMFILES) candidates.push(
    join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  );
  if (PROGRAMFILES_X86) candidates.push(
    join(PROGRAMFILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAMFILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  );
  if (LOCALAPPDATA) candidates.push(
    join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  );
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    envRejected
      ? `${NOT_FOUND_MESSAGE}\n   （已检测到 CHROME_PATH=${envRejected}，但该路径不存在）`
      : NOT_FOUND_MESSAGE
  );
}

/** 统一的 Chromium 启动参数。 */
export function chromeLaunchArgs() {
  // --no-sandbox 和 --disable-dev-shm-usage 仅 Linux 环境（Docker / CI）需要。
  // ⚠ 安全提示：--no-sandbox 会禁用 Chromium 沙箱隔离，仅用于渲染受信任的本地 HTML；
  // 切勿用来加载不可信的远程 URL。
  const args = ['--force-color-profile=srgb'];
  if (process.platform === 'linux') {
    args.push('--no-sandbox', '--disable-dev-shm-usage');
  }
  return args;
}

/** 启动 headless Chromium（探测可执行文件 + 统一参数）。 */
export function launchChrome() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: chromeLaunchArgs(),
  });
}
