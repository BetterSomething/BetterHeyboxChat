/**
 * 回归：main-bridge 不得替换 / Proxy BrowserWindow，否则正式客户端会只剩灰色窗口。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/main-bridge.js'),
  'utf8',
);

if (/BrowserWindow\s*=/.test(source) || /mod\.BrowserWindow\s*=/.test(source)) {
  throw new Error('FAIL: main-bridge 不得赋值替换 BrowserWindow');
}
if (source.includes('new Proxy')) {
  throw new Error('FAIL: main-bridge 不得 Proxy BrowserWindow');
}
if (!source.includes('browser-window-created')) {
  throw new Error('FAIL: 必须用 app 的 browser-window-created 挂钩快捷键');
}
if (!source.includes('patch-guard') || !source.includes('ensurePatches')) {
  throw new Error('FAIL: main-bridge 必须在窗口创建前 ensurePatches');
}
if (!source.includes('wrapIpcMain')) {
  throw new Error('FAIL: main-bridge 必须拦截官方更新 IPC');
}
const guardSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/lib/patch-guard.js'),
  'utf8',
);
if (!guardSource.includes('update-client') || !guardSource.includes('updateAsarResource')) {
  throw new Error('FAIL: patch-guard 必须按官方 IPC 名拦截更新');
}

const preload = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/preload-bridge.js'),
  'utf8',
);
if (preload.includes("ELECTRON_ENV: 'local'") || preload.includes('setElectronEnv')) {
  throw new Error('FAIL: preload-bridge 不得改写 env.js / ELECTRON_ENV');
}

console.log('OK: main-bridge 不再替换 BrowserWindow');
console.log('OK: preload-bridge 不再改写 env.js');
