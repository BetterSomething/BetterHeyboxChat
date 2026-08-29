/**
 * 在线 registry：只拉 registry.json，按需下载插件目录（mock http，不访问外网）
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(__dirname, '../../../runtime/lib/plugin-registry.js');
const pkg = require(path.resolve(__dirname, '../../../runtime/lib/plugin-package.js'));

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(registryPath), '应存在 runtime/lib/plugin-registry.js');

const registry = require(registryPath);

const GITHUB_WEB_BASE =
  'https://github.com/BetterSomething/BetterHeyboxChat-plugins/blob/main/';
const MIRROR_PREFIX = 'https://gh.qmqaq.top/';
const MIRROR_BASE = MIRROR_PREFIX + GITHUB_WEB_BASE;

assert(
  registry.DEFAULT_BASE ===
    'https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/',
  '默认 raw 基址应指向 BetterHeyboxChat-plugins/main/',
);
assert(registry.GITHUB_WEB_BASE === GITHUB_WEB_BASE, '加速源应拼接 GitHub blob 基址');

assert(
  registry.resolveBase('') === registry.DEFAULT_BASE,
  '空加速源应回落到默认 GitHub raw',
);
assert(registry.resolveBase('gh.qmqaq.top') === MIRROR_BASE, '加速源缺协议时应补 https://');
assert(registry.resolveBase('gh.qmqaq.top/') === MIRROR_BASE, '加速源缺协议且带尾斜杠时应规范化');
assert(registry.resolveBase('https://gh.qmqaq.top') === MIRROR_BASE, '加速源已有 https 时应只补尾斜杠');
assert(registry.resolveBase('https://gh.qmqaq.top/') === MIRROR_BASE, '加速源协议和斜杠齐全时应原样拼接');
assert(
  registry.resolveBase('http://mirror.example') ===
    'http://mirror.example/' + GITHUB_WEB_BASE,
  '已写 http 的加速源应保留协议',
);
assert(
  registry.joinUrl(MIRROR_BASE, 'registry.json') === MIRROR_BASE + 'registry.json',
  '加速源下载地址应为 加速源 + GitHub blob 链接',
);
assert(
  pkg.sanitizeHttpUrl(MIRROR_BASE + 'registry.json') === MIRROR_BASE + 'registry.json',
  '加速源拼接后的完整 URL 应能通过下载地址校验',
);
assert(registry.resolveBase('javascript:alert(1)') === '', '非 http(s) 加速源应拒绝');
assert(registry.resolveBase('ftp://x/') === '', 'ftp 加速源应拒绝');

const parsed = registry.parseRegistry({
  version: 1,
  plugins: [
    {
      id: 'cool-plugin',
      name: '<b>Cool</b>',
      version: '1.2.0',
      author: 'Bob<script>',
      desc: '<img src=x>朗读消息',
      minClientVersion: '1.56.0',
    },
    { id: '../etc', name: 'bad' },
  ],
});
assert(parsed.ok, 'version=1 的 registry 应通过');
assert(parsed.plugins.length === 1, '非法 id 的货架项应丢掉');
assert(parsed.plugins[0].name === 'Cool', '货架 name 应去标签');
assert(parsed.plugins[0].desc.indexOf('<') === -1, '货架 desc 应洗白');

assert(!registry.parseRegistry({ version: 2, plugins: [] }).ok, '不认识的清单版本应拒绝');
assert(!registry.parseRegistry('{').ok, '非法 JSON 应拒绝');

const rels = registry.collectRemoteRelPaths({
  id: 'cool-plugin',
  entry: 'index.js',
  style: 'style.css',
  files: ['assets/icon.png', 'index.js', '../escape.js', 'assets/icon.png'],
});
assert(rels.indexOf('manifest.json') !== -1, '必须下载 manifest.json');
assert(rels.indexOf('index.js') !== -1, '必须下载 entry');
assert(rels.indexOf('style.css') !== -1, '必须下载 style');
assert(rels.indexOf('assets/icon.png') !== -1, '应下载 extra files');
assert(rels.filter((n) => n === 'assets/icon.png').length === 1, 'files 应去重');
assert(rels.indexOf('../escape.js') === -1, '路径穿越的 files 应丢弃');

const files = {
  'registry.json': JSON.stringify({
    version: 1,
    plugins: [
      {
        id: 'hello-remote',
        name: 'Hello',
        version: '1.0.0',
        author: 'AwCat',
        desc: '远程示例',
        minClientVersion: '1.56.0',
      },
    ],
  }),
  'hello-remote/manifest.json': JSON.stringify({
    id: 'hello-remote',
    name: 'Hello',
    version: '1.0.0',
    author: 'AwCat',
    desc: '远程示例',
    minClientVersion: '1.56.0',
    entry: 'index.js',
    style: 'style.css',
    files: ['extra.txt'],
  }),
  'hello-remote/index.js': 'void 0;',
  'hello-remote/style.css': '/* ok */',
  'hello-remote/extra.txt': 'extra',
};

function mockFetch(url) {
  const base = registry.DEFAULT_BASE;
  assert(url.indexOf(base) === 0, '应按基址拼接: ' + url);
  const rel = url.slice(base.length);
  if (!Object.prototype.hasOwnProperty.call(files, rel)) {
    return Promise.reject(new Error('404 ' + rel));
  }
  return Promise.resolve(Buffer.from(files[rel]));
}

const catalog = await registry.fetchRegistry({ fetch: mockFetch });
assert(catalog.ok && catalog.plugins[0].id === 'hello-remote', 'fetchRegistry 应只拉 registry.json');

const inspected = await registry.inspectRemote({
  id: 'hello-remote',
  fetch: mockFetch,
  clientVersion: '1.56.0',
});
assert(inspected.ok, 'inspectRemote 应成功: ' + (inspected.error || ''));
assert(inspected.source === 'remote', '来源应为 remote');
assert(inspected.manifest.id === 'hello-remote', 'manifest id 应匹配');
assert(inspected.files['index.js'] || inspected.files['hello-remote/index.js'], '应包含入口文件');

const mismatch = await registry.inspectRemote({
  id: 'hello-remote',
  fetch: function (url) {
    if (url.endsWith('manifest.json')) {
      return Promise.resolve(
        Buffer.from(
          JSON.stringify({
            id: 'other-id',
            name: 'X',
            version: '1',
            entry: 'index.js',
          }),
        ),
      );
    }
    return mockFetch(url);
  },
});
assert(!mismatch.ok, 'manifest id 与目录/请求 id 不一致应拒绝');

const tooNew = await registry.inspectRemote({
  id: 'hello-remote',
  fetch: mockFetch,
  clientVersion: '1.50.0',
});
assert(!tooNew.ok, 'minClientVersion 高于当前客户端应拒绝');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-registry-'));
process.env.BETTERHEYBOXCHAT_PROFILE = tmp;
const store = require(path.resolve(__dirname, '../../../runtime/lib/plugin-store.js'));
const installed = await store.installRemote({
  id: 'hello-remote',
  fetch: mockFetch,
  clientVersion: '1.56.0',
});
assert(installed.ok, 'installRemote 应写入用户目录: ' + (installed.error || ''));
assert(
  store.listUserPlugins().some(function (p) {
    return p.id === 'hello-remote';
  }),
  '安装后应出现在用户插件列表',
);

function writeLocalRepo(root) {
  fs.mkdirSync(path.join(root, 'hello-local'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'registry.json'),
    JSON.stringify({
      version: 1,
      plugins: [
        {
          id: 'hello-local',
          name: 'Hello Local',
          version: '2.0.0',
          author: 'AwCat',
          desc: '本地示例',
          minClientVersion: '1.56.0',
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root, 'hello-local', 'manifest.json'),
    JSON.stringify({
      id: 'hello-local',
      name: 'Hello Local',
      version: '2.0.0',
      author: 'AwCat',
      desc: '本地示例',
      minClientVersion: '1.56.0',
      entry: 'index.js',
      style: 'style.css',
      files: ['extra.txt'],
    }),
  );
  fs.writeFileSync(path.join(root, 'hello-local', 'index.js'), 'void 0;');
  fs.writeFileSync(path.join(root, 'hello-local', 'style.css'), '/* local */');
  fs.writeFileSync(path.join(root, 'hello-local', 'extra.txt'), 'extra');
}

const localRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-local-plugins-'));
writeLocalRepo(localRepo);

assert(typeof registry.resolveLocalRoot === 'function', '应导出 resolveLocalRoot');

const emptyRoot = registry.resolveLocalRoot('');
assert(!emptyRoot.ok, '空路径应失败');

const relRoot = registry.resolveLocalRoot('BetterHeyboxChat-plugins');
assert(!relRoot.ok, '相对路径应拒绝');

const missing = registry.resolveLocalRoot(path.join(os.tmpdir(), 'bhchat-no-such-repo-' + Date.now()));
assert(!missing.ok, '不存在的路径应失败');

const noRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-noreg-'));
const noReg = registry.resolveLocalRoot(noRegistryDir);
assert(!noReg.ok, '没有 registry.json 应失败');

const okRoot = registry.resolveLocalRoot(localRepo);
assert(okRoot.ok, '仓根路径应通过');
assert(path.resolve(okRoot.root) === path.resolve(localRepo), '应解析到仓根');

const nested = registry.resolveLocalRoot(path.join(localRepo, 'hello-local', 'index.js'));
assert(nested.ok, '选中仓内文件应上溯到仓根');
assert(path.resolve(nested.root) === path.resolve(localRepo), '上溯结果应是仓根');

let fetchCalled = false;
const localCatalog = await registry.fetchRegistry({
  localRoot: localRepo,
  fetch: function () {
    fetchCalled = true;
    return Promise.reject(new Error('不应访问网络'));
  },
});
assert(localCatalog.ok && localCatalog.plugins[0].id === 'hello-local', 'localRoot 应读本地 registry.json');
assert(!fetchCalled, '有 localRoot 时不应走 HTTP fetch');

const badCatalog = await registry.fetchRegistry({
  localRoot: noRegistryDir,
  fetch: function () {
    throw new Error('无效 localRoot 不应回落到网络');
  },
});
assert(!badCatalog.ok, '无效 localRoot 应失败且不回落 GitHub');

let emptyFetchCalled = false;
const emptyLocal = await registry.fetchRegistry({
  localDebug: true,
  localRoot: '',
  fetch: function () {
    emptyFetchCalled = true;
    return Promise.reject(new Error('不应访问网络'));
  },
});
assert(!emptyLocal.ok, 'localDebug 开启但路径为空应失败');
assert(!emptyFetchCalled, 'localDebug 开启时不应回落 GitHub');

const localInspected = await registry.inspectRemote({
  id: 'hello-local',
  localRoot: localRepo,
  clientVersion: '1.56.0',
  fetch: function () {
    throw new Error('inspect 有 localRoot 时不应访问网络');
  },
});
assert(localInspected.ok, 'inspectRemote 应读本地插件: ' + (localInspected.error || ''));
assert(localInspected.source === 'local', '本地检查来源应为 local');
assert(localInspected.files['index.js'] || localInspected.files['hello-local/index.js'], '本地检查应包含入口文件');

const tmpInstall = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-local-install-'));
process.env.BETTERHEYBOXCHAT_PROFILE = tmpInstall;
const localInstalled = await store.installRemote({
  id: 'hello-local',
  localRoot: localRepo,
  clientVersion: '1.56.0',
});
assert(localInstalled.ok, 'installRemote 应从本地仓写入用户目录: ' + (localInstalled.error || ''));
assert(
  fs.existsSync(path.join(tmpInstall, 'plugins', 'hello-local', 'index.js')),
  '本地安装应复制入口文件到用户插件目录',
);

console.log('OK: plugin-registry parse / mirror / remote inspect+install / local debug');
