/**
 * Watch 模式：监听源文件变化，自动重新导出 PDF
 *
 * 用法：
 *   node scripts/export-pdf-watch.mjs [输出路径]
 *   npm run export:pdf:watch
 *
 * 监听 index.html、styles.css 和 assets/ 目录的变化，
 * 变化后自动调用 export-pdf.mjs 重新导出。
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const output = process.argv[2] || 'export/vibe-course-report-demo.pdf';
const exportScript = resolve(__dirname, 'export-pdf.mjs');

let running = false;
let pending = false;
let timer = null;

function runExport() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;

  console.log(`\n${new Date().toLocaleTimeString()} 检测到变化，重新导出...`);

  const child = spawn('node', [exportScript, output], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    running = false;
    if (code === 0) {
      console.log('导出完成，继续监听...');
    } else {
      console.log(`导出异常 (exit ${code})，继续监听...`);
    }
    if (pending) {
      // 在上次导出期间又有变化，立即重新导出
      timer = setTimeout(runExport, 200);
    }
  });
}

// 防抖：200ms 内的多次变化合并为一次导出
function scheduleExport() {
  clearTimeout(timer);
  timer = setTimeout(runExport, 200);
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
      // 忽略截图管线的输出文件（assets/ 中会生成 preview.png / preview.sources.json），
      // 否则两个 watch 模式同时运行时会产生无意义的重复导出
      if (filename === 'preview.png' || filename === 'preview.sources.json') return;
      console.log(`  变化：${filename} (${eventType})`);
      scheduleExport();
    });
  } catch (e) {
    console.warn(`无法监听 ${target}：${e.message}`);
  }
}

console.log('VibeCourseReport · Watch 模式');
console.log(`监听文件变化，自动导出到 ${output}`);
console.log('按 Ctrl+C 退出\n');

// 首次立即导出
runExport();
