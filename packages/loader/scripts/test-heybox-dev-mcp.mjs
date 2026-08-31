/**
 * 开发桥 host：序列化 / 打码 / RPC，不连真机。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '../../../../BetterHeyboxChat-plugins/heybox-dev-mcp');
const hostPath = path.join(pluginDir, 'host.js');
const indexPath = path.join(pluginDir, 'index.js');
const manifestPath = path.join(pluginDir, 'manifest.json');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(hostPath), '应存在 heybox-dev-mcp/host.js');
assert(fs.existsSync(indexPath), '应存在 heybox-dev-mcp/index.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');
assert(/bhchatPreload/.test(indexSource) && /readUserFile/.test(indexSource), '插件应走 preload.readUserFile 注入 host.js');

const hostSource = fs.readFileSync(hostPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(hostSource, electronLike);
assert(
  electronLike.window.BhchatHeyboxDevMcp &&
    typeof electronLike.window.BhchatHeyboxDevMcp.serialize === 'function',
  'Electron 渲染进程有 module.exports 时，host.js 仍必须挂到 window',
);

const host = require(hostPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.id === 'heybox-dev-mcp', 'manifest.id 必须是 heybox-dev-mcp');
assert(Array.isArray(manifest.files) && manifest.files.indexOf('host.js') !== -1, 'files 必须包含 host.js');
assert(Array.isArray(manifest.files) && manifest.files.indexOf('mcp-server.mjs') !== -1, 'files 必须包含 mcp-server.mjs');

assert(host.isSecretKey('pkey'), 'pkey 应打码');
assert(host.isSecretKey('user_sig'), 'user_sig 应打码');
assert(!host.isSecretKey('room_id'), 'room_id 不应打码');
assert(host.redactUrl('https://x/?pkey=abc&a=1').indexOf('pkey=[redacted]') !== -1, 'URL 里的 pkey 应打码');

const dumped = host.serialize({
  room_id: 12,
  pkey: 'should-not-leak',
  token: 'also-secret',
  href: 'https://chat.xiaoheihe.cn/?pkey=zzz',
  nested: { password: 'x', ok: true },
});
assert(dumped.pkey === '[redacted]', 'serialize 必须打码 pkey');
assert(dumped.token === '[redacted]', 'serialize 必须打码 token');
assert(dumped.nested.password === '[redacted]', '嵌套 password 必须打码');
assert(dumped.href.indexOf('zzz') === -1, 'href 查询串里的 pkey 必须打码');
assert(dumped.room_id === 12, '普通字段应保留');

const walked = host.walkPath({ a: { b: 3 } }, 'a.b');
assert(walked.ok && walked.value === 3, 'walkPath 应走到叶子');
assert(!host.walkPath({ a: 1 }, 'a.b').ok, '中断路径应失败');

const env = host.collectEnv({
  window: {
    location: { href: 'https://x/?token=abc', origin: 'https://x', pathname: '/' },
    navigator: { userAgent: 'test' },
    asar_version: '1.56.0',
    BHChat: { version: '0.1.0', clientVersion: '1.56.0' },
  },
  process: {
    env: { ELECTRON_ENV: 'prod', pkey: 'nope', PATH: 'C:\\Windows' },
    versions: { node: '22.0.0' },
    execPath: 'D:\\HeyboxChat.exe',
    cwd: function () {
      return 'D:\\app';
    },
    pid: 1,
    platform: 'win32',
  },
});
assert(env.electronEnv === 'prod', '应读到 ELECTRON_ENV');
assert(env.env.pkey === '[redacted]', 'process.env.pkey 必须打码');
assert(env.env.PATH === 'C:\\Windows', '普通环境变量应保留');
assert(env.href.indexOf('abc') === -1, 'location.href 里的 token 必须打码');

const factories = {
  30570: function eventBus() {
    return { emit: function () {}, on: function () {} };
  },
  99999: function unused() {
    return {};
  },
};
factories[30570].toString = function () {
  return 'function eventBus(){return {SOCKET_SEND_MESSAGE:1}}';
};
const fakeRequire = {
  m: factories,
  c: {
    30570: { exports: { emit: function () {}, SOCKET_SEND_MESSAGE: 1 } },
  },
};
const search = host.searchWebpack(fakeRequire, 'SOCKET_SEND_MESSAGE', 10);
assert(search.ok && search.hits.length >= 1, 'webpack 搜索应命中');
assert(String(search.hits[0].id) === '30570', '命中模块应是 30570');

const inspected = host.inspectModule({ Wj: function check() {}, IX: 1 });
assert(inspected.keys.indexOf('Wj') !== -1, 'inspectModule 应列出导出');
assert(String(inspected.exports.Wj).indexOf('Function') !== -1, '函数导出应标成 Function');

function mockWindow() {
  return {
    location: { href: 'https://chat.xiaoheihe.cn/room/1', origin: 'https://chat.xiaoheihe.cn', pathname: '/room/1' },
    document: {
      title: '黑盒语音',
      getElementById: function (id) {
        return id === 'app' ? { __vue__: { $store: { state: { cur_room_data: { room_id: 9, room_name: '测' } } } } } : null;
      },
      querySelector: function () {
        return { nodeType: 1, nodeName: 'DIV', id: 'app', className: 'root', textContent: 'hi', childElementCount: 1 };
      },
      querySelectorAll: function () {
        return [{ nodeType: 1, nodeName: 'DIV', id: 'app', className: 'root', textContent: 'hi', childElementCount: 1 }];
      },
    },
    localStorage: {
      length: 2,
      key: function (i) {
        return i === 0 ? 'heybox_id' : i === 1 ? 'pkey' : null;
      },
      getItem: function (key) {
        return key === 'pkey' ? 'secret' : '123';
      },
    },
    BHChat: {
      version: '0.1.0',
      clientVersion: '1.56.0',
      getVue: function () {
        return function Vue() {};
      },
      getStore: function () {
        return {
          state: { cur_room_data: { room_id: 9, room_name: '测', pkey: 'no' }, room_list: [] },
          getters: { cur_room_data: { room_id: 9 } },
        };
      },
      mapState: function (keys) {
        if (!keys) return { cur_room_data: { room_id: 9, room_name: '测' } };
        return { cur_room_data: { room_id: 9, room_name: '测' } };
      },
      listPlugins: function () {
        return [{ id: 'heybox-dev-mcp', loaded: true }];
      },
      storage: {
        get: function (key) {
          return Promise.resolve(key === 'pkey' ? 'no' : { a: 1 });
        },
      },
      plugins: {
        dataRoot: function () {
          return 'C:\\Users\\me\\AppData\\Roaming\\BetterHeyboxChat';
        },
      },
      devtools: {
        open: function () {
          return Promise.resolve({ ok: true, message: 'opened' });
        },
      },
    },
    __bhchat_require__: fakeRequire,
  };
}

const ctx = { window: mockWindow(), process: { env: { ELECTRON_ENV: 'prod' }, cwd: function () { return 'D:\\app'; }, execPath: 'x', pid: 2, platform: 'win32', versions: {} }, consoleBuffer: [{ level: 'log', text: 'hi' }], networkBuffer: [] };

const status = await host.handleRequest('status', {}, ctx);
assert(status.ok && status.data.roomId === '9', 'status 应带当前房间');

const vuex = await host.handleRequest('vuex', { path: 'cur_room_data' }, ctx);
assert(vuex.ok && vuex.data.room_id === 9, 'vuex path 应读到房间');
assert(vuex.data.pkey === '[redacted]', 'vuex 快照必须打码 pkey');

const storage = await host.handleRequest('storage', { key: 'pkey' }, ctx);
assert(storage.ok && storage.data.value === '[redacted]', 'localStorage.pkey 必须打码');

const plugins = await host.handleRequest('plugins', {}, ctx);
assert(plugins.ok && plugins.data[0].id === 'heybox-dev-mcp', '应列出插件');

const unknown = await host.handleRequest('nope', {}, ctx);
assert(!unknown.ok, '未知方法应失败');

const { readHandshake } = await import(
  pathToFileURL(path.join(pluginDir, 'mcp-server.mjs')).href
);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heybox-dev-mcp-'));
fs.writeFileSync(
  path.join(tmpRoot, 'heybox-dev-mcp.json'),
  JSON.stringify({ port: 19222, token: 'unit-test-token', url: 'http://127.0.0.1:19222' }),
  'utf8',
);
const hs = readHandshake(tmpRoot);
assert(hs && hs.port === 19222, '应读到握手端口');
assert(hs.token === 'unit-test-token', '应读到握手 token');
fs.rmSync(tmpRoot, { recursive: true, force: true });

const bundled = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'));
assert(!bundled.some((p) => p.id === 'heybox-dev-mcp'), 'heybox-dev-mcp 不应出现在内置 plugins.json');
const registry = JSON.parse(fs.readFileSync(path.join(pluginDir, '..', 'registry.json'), 'utf8'));
assert(
  registry.plugins.some((p) => p.id === 'heybox-dev-mcp'),
  '插件仓 registry 应登记 heybox-dev-mcp',
);

console.log('heybox-dev-mcp host tests passed');
