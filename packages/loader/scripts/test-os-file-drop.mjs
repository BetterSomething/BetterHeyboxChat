/**
 * OS 文件拖入：Electron/宿主拦截下必须 preventDefault + dropEffect=copy + 解析路径
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.resolve(__dirname, '../../../runtime/lib/os-file-drop.js');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

function fakeEvent(overrides) {
  const calls = { preventDefault: 0, stopPropagation: 0 };
  const dataTransfer = Object.assign(
    {
      dropEffect: 'none',
      types: ['Files'],
      files: [],
      items: [],
    },
    overrides && overrides.dataTransfer,
  );
  return {
    preventDefault: function () {
      calls.preventDefault += 1;
    },
    stopPropagation: function () {
      calls.stopPropagation += 1;
    },
    dataTransfer: dataTransfer,
    target: (overrides && overrides.target) || null,
    _calls: calls,
  };
}

const drop = require(libPath);

assert(typeof drop.acceptOsFileDrag === 'function', '应导出 acceptOsFileDrag');
assert(typeof drop.isOsFileDrag === 'function', '应导出 isOsFileDrag');
assert(typeof drop.filesFromDropEvent === 'function', '应导出 filesFromDropEvent');
assert(typeof drop.resolveDroppedPath === 'function', '应导出 resolveDroppedPath');
assert(typeof drop.eventInside === 'function', '应导出 eventInside');

const allowed = fakeEvent();
assert(drop.isOsFileDrag(allowed) === true, 'types 含 Files 应视为 OS 文件拖入');
assert(drop.isOsFileDrag(fakeEvent({ dataTransfer: { types: ['text/plain'] } })) === false, '纯文本拖入不应当作文件');
assert(drop.isOsFileDrag(fakeEvent({ dataTransfer: { types: { contains: function (t) { return t === 'Files'; } } } })) === true, '应支持 types.contains');

drop.acceptOsFileDrag(allowed);
assert(allowed._calls.preventDefault === 1, 'accept 必须 preventDefault，否则 Windows 显示禁止光标');
assert(allowed._calls.stopPropagation === 1, 'accept 必须 stopPropagation，否则宿主可把 dropEffect 改回 none');
assert(allowed.dataTransfer.dropEffect === 'copy', 'accept 必须把 dropEffect 设为 copy');

const hostNone = fakeEvent({ dataTransfer: { dropEffect: 'none', types: ['Files'] } });
drop.acceptOsFileDrag(hostNone);
assert(hostNone.dataTransfer.dropEffect === 'copy', '即使宿主先写成 none，也要改回 copy');

const zip = { name: 'demo.zip', path: 'C:\\\\tmp\\\\demo.zip' };
const fromFiles = fakeEvent({ dataTransfer: { files: [zip], types: ['Files'] } });
assert(drop.filesFromDropEvent(fromFiles)[0] === zip, '应从 dataTransfer.files 取文件');

const viaItem = {
  name: 'via-item.zip',
};
const fromItems = fakeEvent({
  dataTransfer: {
    files: [],
    items: [{ kind: 'file', getAsFile: function () { return viaItem; } }],
    types: ['Files'],
  },
});
assert(drop.filesFromDropEvent(fromItems)[0] === viaItem, 'files 为空时应回退 dataTransfer.items');

assert(drop.resolveDroppedPath(zip) === 'C:\\\\tmp\\\\demo.zip', '应使用 file.path');
assert(
  drop.resolveDroppedPath({ name: 'x.zip' }, function () { return 'D:\\\\a.zip'; }) === 'D:\\\\a.zip',
  '无 file.path 时应走 getPathForFile',
);
assert(drop.resolveDroppedPath({ name: 'x.zip' }) === '', '没有路径时应返回空串');

const root = { contains: function (node) { return node === 'inside'; } };
assert(drop.eventInside(root, { target: 'inside' }) === true, 'target 在面板内应命中');
assert(drop.eventInside(root, { target: 'outside' }) === false, 'target 在面板外不应命中');
assert(drop.eventInside(null, { target: 'inside' }) === false, '无根节点不应命中');

const marketplace = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/marketplace/index.js'),
  'utf8',
);
assert(/BHChatOsFileDrop|os-file-drop/.test(marketplace), '市场页应使用 os-file-drop 辅助，而不是只绑 Vue on.drop');
assert(/addEventListener/.test(marketplace), '市场页应对 document 挂原生拖放监听');
assert(/capture:\s*true/.test(marketplace), '原生监听必须 capture，才能压过宿主全局拦截');
assert(/beforeDestroy|destroyed/.test(marketplace), '离开市场设置页时应卸掉 document 监听');

const loader = fs.readFileSync(path.resolve(__dirname, '../../../runtime/loader.js'), 'utf8');
assert(/os-file-drop/.test(loader), 'loader 应在插件前加载 os-file-drop.js');

const preload = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/preload-bridge.js'),
  'utf8',
);
assert(/getPathForFile/.test(preload), 'preload 应暴露 getPathForFile，兼容 Electron 去掉 File.path');

const runtime = fs.readFileSync(path.resolve(__dirname, '../../../runtime/runtime.js'), 'utf8');
assert(/getPathForFile/.test(runtime), 'BHChat.plugins 应转发 getPathForFile');

console.log('ok: os-file-drop');
