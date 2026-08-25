/**
 * 热更新后补丁完整性 + 屏蔽更新 IPC 拦截
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guardPath = path.resolve(__dirname, '../../../runtime/lib/patch-guard.js');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(guardPath), '应存在 runtime/lib/patch-guard.js');

const guard = require(guardPath);
assert(typeof guard.ensurePatches === 'function', '应导出 ensurePatches');
assert(typeof guard.wrapIpcMain === 'function', '应导出 wrapIpcMain');
assert(typeof guard.readBlockFlags === 'function', '应导出 readBlockFlags');
assert(typeof guard.writeBlockFlags === 'function', '应导出 writeBlockFlags');
assert(
  guard.HTML_SNIPPET &&
    guard.HTML_SNIPPET.includes('webpack-hook.js') &&
    guard.HTML_SNIPPET.includes('loader.js'),
  'HTML_SNIPPET 必须先 hook 再 loader',
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-patch-guard-'));
const appDir = path.join(tmp, 'app');
const runtimeDir = path.join(appDir, 'betterheyboxchat');
fs.mkdirSync(path.join(appDir, 'webapp'), { recursive: true });
fs.mkdirSync(path.join(appDir, 'source', 'preload'), { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

fs.writeFileSync(path.join(appDir, 'webapp', 'index.html'), '<html><head></head><body></body></html>', 'utf8');
fs.writeFileSync(path.join(appDir, 'source', 'preload', 'index.js'), 'console.log("preload");\n', 'utf8');
fs.writeFileSync(path.join(appDir, 'index.js'), 'require("./source/main");\n', 'utf8');
fs.writeFileSync(path.join(appDir, 'env.js'), "module.exports = { ELECTRON_ENV: 'local' };\n", 'utf8');

const first = guard.ensurePatches(appDir);
assert(first.repaired.indexOf('webapp/index.html') !== -1, '应补回 html 注入');
assert(first.repaired.indexOf('source/preload/index.js') !== -1, '应补回 preload 注入');
assert(first.repaired.indexOf('index.js') !== -1, '应补回 index.js 注入');
assert(first.envFixed === true, '应将 env.js 的 local 改回 prod');

const html = fs.readFileSync(path.join(appDir, 'webapp', 'index.html'), 'utf8');
assert(html.includes(guard.HTML_MARKER), '修复后 html 应含标记');
assert(html.indexOf('webpack-hook.js') < html.indexOf('loader.js'), 'hook 必须先于 loader');

const preload = fs.readFileSync(path.join(appDir, 'source', 'preload', 'index.js'), 'utf8');
assert(preload.includes(guard.MARKER_BEGIN), '修复后 preload 应含标记');

const indexJs = fs.readFileSync(path.join(appDir, 'index.js'), 'utf8');
assert(indexJs.includes(guard.MARKER_BEGIN), '修复后 index.js 应含标记');
assert(indexJs.indexOf('main-bridge.js') < indexJs.indexOf('require("./source/main")'), 'main-bridge 必须在官方入口之前');

const env = fs.readFileSync(path.join(appDir, 'env.js'), 'utf8');
assert(/ELECTRON_ENV:\s*'prod'/.test(env), 'env.js 必须是 prod');
assert(!/ELECTRON_ENV:\s*'local'/.test(env), '禁止把 env 留在 local');

const second = guard.ensurePatches(appDir);
assert(second.repaired.length === 0, '完整时不应重复写入');
assert(second.intact.indexOf('webapp/index.html') !== -1, '完整文件应记入 intact');

const flagsDefault = guard.readBlockFlags(runtimeDir);
assert(flagsDefault.client === false && flagsDefault.hotfix === false, '无标记文件时默认不屏蔽');
guard.writeBlockFlags(runtimeDir, { client: true, hotfix: true });
const flagsOn = guard.readBlockFlags(runtimeDir);
assert(flagsOn.client === true && flagsOn.hotfix === true, '应能持久化屏蔽开关');

const sent = [];
const official = { client: 0, asar: 0, setVer: 0 };
const ipcMain = {
  on(channel, listener) {
    ipcMain._listeners = ipcMain._listeners || {};
    ipcMain._listeners[channel] = listener;
  },
};
guard.wrapIpcMain(ipcMain, function () {
  return guard.readBlockFlags(runtimeDir);
});
ipcMain.on('update-client', function () {
  official.client += 1;
});
ipcMain.on('updateAsarResource', function () {
  official.asar += 1;
});
ipcMain.on('setAsarVersion', function () {
  official.setVer += 1;
});
ipcMain.on('unrelated', function () {});

const event = {
  sender: {
    send: function (ch, a, b) {
      sent.push({ ch: ch, a: a, b: b });
    },
  },
};

ipcMain._listeners['update-client'](event, { url: 'http://example' });
ipcMain._listeners['updateAsarResource'](event, '1.56.1', 'http://example', {});
ipcMain._listeners['setAsarVersion'](event, '1.56.1', true);
assert(official.client === 0 && official.asar === 0 && official.setVer === 0, '屏蔽开启时不得进入官方更新处理');
assert(
  sent.some(function (item) {
    return item.ch === 'update-result' && item.a && item.a.blocked;
  }),
  '屏蔽完整更新时应回 update-result，避免官方弹窗空等',
);
assert(
  sent.some(function (item) {
    return item.ch === 'updateAsarResource:callback' && item.a === 'error';
  }),
  '屏蔽热更新时应回 updateAsarResource:callback error',
);

guard.writeBlockFlags(runtimeDir, { client: false, hotfix: false });
ipcMain._listeners['update-client'](event, {});
ipcMain._listeners['updateAsarResource'](event, '1.56.1', 'http://example', {});
assert(official.client === 1 && official.asar === 1, '关闭屏蔽后应放行官方更新');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK: patch-guard ensure + update IPC block');
