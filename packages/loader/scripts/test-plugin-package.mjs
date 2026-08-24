/**
 * 插件包校验 / 文本洗白 / zip 解压
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '../../../runtime/lib/plugin-package.js');
const zipPath = path.resolve(__dirname, '../../../runtime/lib/zip-inflate.js');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

const pkg = require(pkgPath);
const zip = require(zipPath);

assert(pkg.MAX_DESC_LENGTH === 100, 'desc 上限应为 100 字');

assert(pkg.sanitizePlainText('<script>alert(1)</script>hello', 100) === 'alert(1)hello', '应剥掉 HTML 标签');
assert(pkg.sanitizePlainText('a'.repeat(105), 100).length === 100, '超长应截断为 100');
assert(!pkg.sanitizePlainText('ok\u0000\u0007x', 100).includes('\u0000'), '应去掉控制字符');
assert(pkg.sanitizeHttpUrl('javascript:alert(1)') === '', 'javascript: URL 应丢弃');
assert(pkg.sanitizeHttpUrl('https://github.com/a/b') === 'https://github.com/a/b', 'https URL 应保留');
assert(pkg.sanitizeHttpUrl('http://example.com/x') === 'http://example.com/x', 'http URL 应保留');

const parsed = pkg.parseManifest({
  id: 'cool-plugin',
  name: '<b>Cool</b>',
  version: '1.2.3',
  author: 'Bob<script>',
  desc: '<img src=x onerror=alert(1)>朗读当前频道消息。',
  repository: 'https://github.com/a/b',
  minClientVersion: '1.56.0',
  entry: 'index.js',
});
assert(parsed.ok, '合法 manifest 应通过');
assert(parsed.manifest.name === 'Cool', 'name 应去标签');
assert(parsed.manifest.desc === '朗读当前频道消息。', 'desc 应去标签');
assert(parsed.manifest.author.indexOf('<') === -1, 'author 不应含 <');

const badId = pkg.parseManifest({ id: '../etc', name: 'x', version: '1', entry: 'index.js' });
assert(!badId.ok, '非法 id 应拒绝');

const nested = pkg.inspectFileMap({
  'foo/manifest.json': JSON.stringify({
    id: 'foo',
    name: 'Foo',
    version: '1.0.0',
    desc: '测试插件',
    entry: 'index.js',
  }),
  'foo/index.js': 'console.log(1)',
});
assert(nested.ok && nested.manifest.id === 'foo', '应识别单层目录 zip 布局');

const traversal = pkg.inspectFileMap({
  'manifest.json': JSON.stringify({
    id: 'evil',
    name: 'E',
    version: '1',
    entry: '../outside.js',
  }),
  '../outside.js': 'x',
});
assert(!traversal.ok, 'entry 路径穿越应拒绝');

function crc32(buf) {
  return zlib.crc32(Buffer.from(buf)) >>> 0;
}

function makeStoreZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const eocd = Buffer.alloc(22);
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat(centrals).concat([eocd]));
}

const zipBuf = makeStoreZip([
  {
    name: 'demo/manifest.json',
    data: JSON.stringify({
      id: 'demo',
      name: 'Demo',
      version: '0.1.0',
      desc: '演示',
      entry: 'index.js',
    }),
  },
  { name: 'demo/index.js', data: 'void 0;' },
]);
const unzipped = zip.unzip(zipBuf);
assert(unzipped.ok, 'store zip 应解压成功: ' + (unzipped.error || ''));
assert(unzipped.files['demo/index.js'], '应包含 demo/index.js');
const inspected = pkg.inspectFileMap(unzipped.files);
assert(inspected.ok && inspected.manifest.id === 'demo', 'zip 内插件应可 inspect');

const deflated = zlib.deflateRawSync(Buffer.from('hello-plugin'));
function makeDeflateZip() {
  const name = Buffer.from('hello.txt');
  const crc = crc32('hello-plugin');
  const local = Buffer.alloc(30 + name.length + deflated.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(12, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  deflated.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(12, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}
const inflated = zip.unzip(makeDeflateZip());
assert(inflated.ok, 'deflate zip 应解压');
assert(Buffer.from(inflated.files['hello.txt']).toString() === 'hello-plugin', 'deflate 内容应还原');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-plugin-'));
fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
  id: 'from-dir',
  name: 'Dir',
  version: '1.0.0',
  desc: '从文件夹安装',
  entry: 'index.js',
}));
fs.writeFileSync(path.join(tmp, 'index.js'), 'void 0;');
const fromDir = pkg.inspectDirectory(tmp, fs);
assert(fromDir.ok && fromDir.manifest.id === 'from-dir', '应能 inspect 文件夹');

process.env.BETTERHEYBOXCHAT_PROFILE = tmp;
const store = require(path.resolve(__dirname, '../../../runtime/lib/plugin-store.js'));
const installed = store.installFolderPath(tmp);
assert(installed.ok, '应从文件夹安装插件: ' + (installed.error || ''));
const listed = store.listUserPlugins();
assert(listed.some((p) => p.id === 'from-dir'), '安装后应出现在用户插件列表');
const removed = store.uninstall('from-dir');
assert(removed.ok, '应能卸载用户插件');
assert(!store.listUserPlugins().some((p) => p.id === 'from-dir'), '卸载后列表应为空项');

console.log('OK: plugin-package / zip-inflate / desc sanitize / plugin-store');
