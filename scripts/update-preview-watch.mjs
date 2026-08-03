/**
 * Watch 模式：监听源文件变化，自动重新生成 README 预览截图
 *
 * 用法：
 *   node scripts/update-preview-watch.mjs
 *   npm run screenshot:watch
 *
 * 监听 index.html、styles.css 和 assets/ 目录的变化，
 * 变化后自动调用 update-preview.mjs 重新生成 assets/preview.png，
 * 让预览截图与源文件始终同步。
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const screenshotScript = resolve(__dirname, 'update-preview.mjs');

let running = false;
let pending = false;
let timer = null;

function runScreenshot() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;

  console.log(`\n${new Date().toLocaleTimeString()} 检测到变化，重新生成截图...`);

  const child = spawn('node', [screenshotScript], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    running = false;
    if (code === 0) {
      console.log('截图已更新，继续监听...');
    } else {
      console.log(`截图生成异常 (exit ${code})，继续监听...`);
    }
    if (pending) {
      // 上次生成期间又有变化，立即重新生成
      timer = setTimeout(runScreenshot, 200);
    }
  });
}

// 防抖：200ms 内的多次变化合并为一次生成
function scheduleScreenshot() {
  clearTimeout(timer);
  timer = setTimeout(runScreenshot, 200);
}

// 监听源文件
const watchDirs = [
  resolve(ROOT, 'index.html'),
  resolve(ROOT, 'styles.css'),
  resolve(ROOT, 'assets'),
];

for (const target of watchDirs) {
  try {
    watch(target, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // 忽略本脚本自己的输出文件：update-preview.mjs 会把 preview.png 和
      // preview.sources.json 写进 assets/，不过滤会形成"生成截图→触发 watch→
      // 再次生成"的无限循环
      if (filename === 'preview.png' || filename === 'preview.sources.json') return;
      console.log(`  变化：${filename} (${eventType})`);
      scheduleScreenshot();
    });
  } catch (e) {
    console.warn(`无法监听 ${target}：${e.message}`);
  }
}

console.log('VibeCourseReport · 截图 Watch 模式');
console.log('监听文件变化，自动更新 assets/preview.png');
console.log('按 Ctrl+C 退出\n');

// 首次立即生成
runScreenshot();
