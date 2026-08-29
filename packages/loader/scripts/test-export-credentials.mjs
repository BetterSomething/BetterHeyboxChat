/**
 * 用户凭据导出：对照 official-cos-upload.md 第 0 节，一键收集登录态与 query。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '../../../runtime/plugins/export-credentials');
const collectPath = path.join(pluginDir, 'collect.js');
const indexPath = path.join(pluginDir, 'index.js');
const manifestPath = path.join(pluginDir, 'manifest.json');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(collectPath), '应存在 export-credentials/collect.js');

const collectSource = fs.readFileSync(collectPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(collectSource, electronLike);
assert(
  electronLike.window.BhchatExportCredentials &&
    typeof electronLike.window.BhchatExportCredentials.collectSnapshot === 'function',
  'Electron 渲染进程有 module.exports 时，collect.js 仍必须挂到 window',
);
assert(
  electronLike.module.exports &&
    typeof electronLike.module.exports.collectSnapshot === 'function',
  'Node require 路径仍应导出 collectSnapshot',
);

const collect = require(collectPath);

const snap = collect.collectSnapshot({
  now: '2026-08-30T00:00:00.000Z',
  localStorage: { heybox_id: '10001', pkey: 'test-pkey' },
  userInfo: { user_id: 10001 },
  window: {
    asar_version: '1.56.0',
    exe_bit: 64,
    windows_version: '10.0.19045',
    x_os_type: 'Windows',
    device_info: 'Win64',
    chat_exe_version: '1.56.0.1234',
    electron_version: '22.3.0',
  },
  sessionCookies: [
    { name: 'user_pkey', value: 'ck-a', domain: 'api.xiaoheihe.cn', path: '/', httpOnly: true, secure: true },
    { name: 'sessionid', value: 'ck-b', domain: '.xiaoheihe.cn', path: '/', httpOnly: false, secure: true },
  ],
  documentCookie: 'foo=bar',
  clientVersion: '1.56.0.999',
});

assert(snap.exportedAt === '2026-08-30T00:00:00.000Z', 'exportedAt 应使用传入的 now');
assert(snap.login.heybox_id === '10001', 'heybox_id 应来自 localStorage');
assert(snap.login.pkey === 'test-pkey', 'pkey 应来自 localStorage');
assert(snap.login.loggedIn === true, '同时有 heybox_id 与 pkey 应视为已登录');
assert(snap.query.heybox_id === '10001', 'query.heybox_id 必须带上');
assert(snap.query.pkey === 'test-pkey', 'query.pkey 必须带上');
assert(snap.query.client_type === 'heybox_chat', 'client_type 应为 heybox_chat');
assert(snap.query.x_client_type === 'pc', 'x_client_type 应为 pc');
assert(snap.query.os_type === 'web', 'os_type 应为 web');
assert(snap.query.x_app === 'heybox_chat', 'x_app 应为 heybox_chat');
assert(snap.query.version === '999.0.4', 'version 默认 999.0.4');
assert(snap.query.web_version === '1.0.0', 'web_version 默认 1.0.0');
assert(snap.query.chat_os_type === 'client', 'chat_os_type 应为 client');
assert(snap.query.chat_version === '1.56.0', 'chat_version 应来自 asar_version');
assert(snap.query.x_os_type === 'Windows', '应带上探测到的 x_os_type');
assert(snap.query.device_info === 'Win64', '应带上探测到的 device_info');
assert(snap.query.chat_exe_version === '1.56.0.1234', 'chat_exe_version 优先 window');
assert(snap.query.electron_version === '22.3.0', '应带上 electron_version');
assert(String(snap.query.client_bit) === '64', 'client_bit 应来自 exe_bit');
assert(snap.query.win_version === '10.0.19045', 'win_version 应来自 windows_version');
assert(
  snap.queryString.indexOf('heybox_id=10001') !== -1 && snap.queryString.indexOf('pkey=test-pkey') !== -1,
  'queryString 必须含 heybox_id 与 pkey',
);
assert(snap.cookieHeader.indexOf('user_pkey=ck-a') !== -1, 'Cookie 头应含会话 cookie');
assert(snap.cookieHeader.indexOf('foo=bar') !== -1, 'Cookie 头应合并 document.cookie');
assert(snap.env.HEYBOX_ID === '10001' && snap.env.PKEY === 'test-pkey', 'env 应给出 HEYBOX_ID / PKEY');
assert(Array.isArray(snap.missing) && snap.missing.length === 0, '齐全快照不应有 missing');

const fallback = collect.collectSnapshot({
  localStorage: {},
  userInfo: { user_id: 20002 },
  window: { asar_version: '1.56.0' },
  sessionCookies: [],
  documentCookie: '',
  clientVersion: '1.56.0.1',
});
assert(fallback.login.heybox_id === '20002', 'localStorage 没有 heybox_id 时应回退 user_info.user_id');
assert(fallback.login.loggedIn === false, '没有 pkey 不应视为已登录');
assert(fallback.query.chat_exe_version === '1.56.0.1', '没有 window.chat_exe_version 时应回退 getClientVersion');
assert(fallback.missing.indexOf('pkey') !== -1, '缺 pkey 应记入 missing');
assert(fallback.missing.indexOf('cookies') !== -1, '没有 Cookie 应记入 missing');

const quoted = collect.collectSnapshot({
  localStorage: { heybox_id: '"60731191"' },
  userInfo: {},
  window: { asar_version: '1.56.0' },
  sessionCookies: [
    {
      name: 'user_pkey',
      value: 'cookie-pkey',
      domain: '.xiaoheihe.cn',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ],
  documentCookie: '',
});
assert(quoted.login.heybox_id === '60731191', 'localStorage 带 JSON 引号的 heybox_id 应去掉引号');
assert(quoted.query.heybox_id === '60731191', 'query.heybox_id 不应带引号');
assert(quoted.queryString.indexOf('heybox_id=60731191') !== -1, 'queryString 的 heybox_id 不应带引号');
assert(quoted.queryString.indexOf('%22') === -1, 'queryString 不应把引号编成 %22');
assert(quoted.login.pkey === 'cookie-pkey', 'localStorage 无 pkey 时应回退 user_pkey Cookie');
assert(quoted.query.pkey === 'cookie-pkey', 'query.pkey 应使用 user_pkey Cookie');
assert(quoted.login.loggedIn === true, '有 heybox_id 与 Cookie pkey 应视为已登录');
assert(quoted.missing.indexOf('pkey') === -1, '有 user_pkey Cookie 时 missing 不应含 pkey');
assert(quoted.env.PKEY === 'cookie-pkey', 'env.PKEY 应使用 Cookie 回退值');

assert(collect.isAllowedCookieUrl('https://api.xiaoheihe.cn') === true, '应允许 api.xiaoheihe.cn');
assert(collect.isAllowedCookieUrl('https://chat.max-c.com/') === true, '应允许 chat.max-c.com');
assert(collect.isAllowedCookieUrl('https://evil.example') === false, '应拒绝无关域名');
assert(collect.isAllowedCookieUrl('javascript:alert(1)') === false, '应拒绝非 http(s)');
assert(collect.DEFAULT_COOKIE_URL === 'https://api.xiaoheihe.cn', '默认 Cookie URL 应为 api.xiaoheihe.cn');

const envText = collect.formatEnv(snap);
assert(/HEYBOX_ID=10001/.test(envText) && /PKEY=test-pkey/.test(envText), 'formatEnv 应输出可粘贴的环境变量');
const jsonText = collect.formatJson(snap);
assert(jsonText.indexOf('"pkey": "test-pkey"') !== -1, 'formatJson 应包含完整 pkey');

assert(fs.existsSync(indexPath), '应存在 export-credentials/index.js');
const pluginIndex = fs.readFileSync(indexPath, 'utf8');
assert(/registerPanel/.test(pluginIndex), '凭据导出应通过 registerPanel 挂到设置页');
assert(/bhchat-btn-primary/.test(pluginIndex), '应使用主按钮一键导出');
assert(/pkey/.test(pluginIndex) && /heybox_id/.test(pluginIndex), '插件应读取 heybox_id / pkey');
assert(/不要发给|不要把|仓库/.test(pluginIndex), '设置页必须警告凭据不要外传或入库');
assert(!/storage\.set|ns\(/.test(pluginIndex), '不得把凭据写入 BHChat.storage');
assert(!/window\.confirm/.test(pluginIndex), '不得使用原生 confirm');
assert(!/'30570'|\"30570\"/.test(pluginIndex), '不应写死 EventBus 模块 ID');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.id === 'export-credentials', 'manifest.id 必须是 export-credentials');
assert(manifest.name === '用户凭据导出', '显示名应为「用户凭据导出」');
assert(typeof manifest.desc === 'string' && manifest.desc.length > 0 && manifest.desc.length <= 100, 'desc 不超过 100 字');

const pluginsJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  pluginsJson.some(
    (p) => p.id === 'export-credentials' && p.entry === 'index.js' && p.name === '用户凭据导出',
  ),
  'plugins.json 应注册 export-credentials',
);

const mainBridge = fs.readFileSync(path.resolve(__dirname, '../../../runtime/main-bridge.js'), 'utf8');
assert(/bhchat:get-session-cookies/.test(mainBridge), 'main-bridge 应提供只读会话 Cookie IPC');
assert(/xiaoheihe\.cn/.test(mainBridge) && /max-c\.com/.test(mainBridge), 'Cookie IPC 应限制 heybox 域名');

const preload = fs.readFileSync(path.resolve(__dirname, '../../../runtime/preload-bridge.js'), 'utf8');
assert(/get-session-cookies/.test(preload), 'preload 应暴露会话 Cookie 读取');
assert(/cookies/.test(preload), 'preload 应挂 cookies API');

console.log('ok: export-credentials collects login + query + cookies');
