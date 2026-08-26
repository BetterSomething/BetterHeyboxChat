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

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(registryPath), '应存在 runtime/lib/plugin-registry.js');

const registry = require(registryPath);

assert(
  registry.DEFAULT_BASE ===
    'https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/',
  '默认 raw 基址应指向 BetterHeyboxChat-plugins/main/',
);

assert(
  registry.resolveBase('') === registry.DEFAULT_BASE,
  '空加速源应回落到默认 GitHub raw',
);
assert(
  registry.resolveBase('https://mirror.example/BetterSomething/BetterHeyboxChat-plugins/main') ===
    'https://mirror.example/BetterSomething/BetterHeyboxChat-plugins/main/',
  '加速源应补上末尾斜杠',
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

console.log('OK: plugin-registry parse / mirror / remote inspect+install');
