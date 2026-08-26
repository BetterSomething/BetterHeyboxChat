/**
 * 官方房间背景探测：payload 必须忽略客户端 can_change_bg_pic / room_decorate 门闩。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decoPath = path.resolve(
  __dirname,
  '../../../runtime/plugins/official-room-deco/deco.js',
);

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(decoPath), '应存在 official-room-deco/deco.js');

const decoSource = fs.readFileSync(decoPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(decoSource, electronLike);
assert(
  electronLike.window.BhchatOfficialRoomDeco &&
    typeof electronLike.window.BhchatOfficialRoomDeco.canSubmit === 'function',
  'Electron 渲染进程有 module.exports 时，deco.js 仍必须挂到 window',
);
assert(
  electronLike.module.exports && typeof electronLike.module.exports.canSubmit === 'function',
  'Node require 路径仍应导出 helpers',
);

const deco = require(decoPath);

const blockedRoom = {
  room_id: '175167',
  room_name: '测试房',
  can_decorate: false,
  can_change_bg_pic: false,
  bg_pic: 'https://img.example/old.png',
  bg_pic_main_color: '#112233',
  bg_color: '#1F2225,#36393E',
  transparency: 40,
  blur_rate: 2,
  main_color_v2: 1,
  bar_color: '#111,#111',
  bar_main_color_v2: 1,
  show_channel_bar_filter: true,
};

assert(deco.canSubmit(null).ok === false, '未进房不能提交');
assert(deco.canSubmit({}).ok === false, '没有 room_id 不能提交');
assert(deco.canSubmit(blockedRoom).ok === true, '即使 can_change_bg_pic / can_decorate 为假也允许提交');

const closeAll = { numbers: { room_decorate: 2 } };
assert(
  deco.isClientUploadBlocked(blockedRoom, closeAll) === true,
  '诊断函数应识别官方 close_all 门闩',
);
assert(
  deco.canSubmit(blockedRoom, closeAll).ok === true,
  '提交判定不得被 room_decorate=close_all 挡住',
);

const payload = deco.buildDecoratePayload(blockedRoom, {
  bg_pic: 'https://img.example/new.png',
  bg_pic_main_color: '#abcdef',
});
assert(payload.room_id === '175167', 'decorate 必须带 room_id');
assert(typeof payload.room_id === 'string', 'room_id 必须是字符串，避免大整数精度丢失');
assert(payload.type === 'room', '官方 Theme Manager 会带 type=room');
assert(payload.bg_pic === 'https://img.example/new.png', '应使用新图 URL');
assert(payload.bg_color === '', '有图时应清空 bg_color');
assert(payload.can_change_bg_pic === true, '有图时 can_change_bg_pic 必须是布尔 true（官方 !!imageSrc）');
assert(payload.bg_pic_main_color === '#abcdef', '有主色时应原样带上');

const bigId = deco.buildDecoratePayload(
  { room_id: 3591628880981909504, can_change_bg_pic: false },
  { bg_pic: 'https://img.example/x.png' },
);
assert(typeof bigId.room_id === 'string', '数值 room_id 也要转成字符串再提交');
assert(bigId.bg_pic_main_color, '有图但没给主色时不能交空字符串（服务端会参数错误）');
assert(/,/.test(bigId.bar_color), '有图但没给侧栏色时要补成 color,color');
assert(blockedRoom.can_change_bg_pic === false, '不得改写传入的房间对象');

const colorOnly = deco.buildDecoratePayload(
  { room_id: '1', can_change_bg_pic: false, bg_color: '#111,#222' },
  { bg_pic: '' },
);
assert(colorOnly.bg_pic === '', '无图时应清空 bg_pic');
assert(colorOnly.bg_color === '#111,#222', '无图时应保留渐变色');
assert(colorOnly.can_change_bg_pic === false, '无图时 can_change_bg_pic 应为布尔 false');

const ok = deco.parseDecorateResult({ data: { status: 'ok', result: { bg_pic: 'x' } } });
assert(ok.ok === true && ok.status === 'ok', 'status=ok 应视为成功');
const denied = deco.parseDecorateResult({
  data: { status: 'failed', error_type: 'feature_off', msg: '该功能已下架' },
});
assert(denied.ok === false, '非 ok 应视为失败');
assert(denied.errorType === 'feature_off', '应保留 error_type 便于对照服务端拒绝原因');
assert(denied.message === '该功能已下架', '应露出服务端文案');

assert(deco.validateUploadFile(null).ok === false, '未选文件应拒绝');
assert(
  deco.validateUploadFile({ size: 6 * 1024 * 1024, type: 'image/png' }).ok === false,
  '超过 5MB 应拒绝',
);
assert(
  deco.validateUploadFile({ size: 1024, type: 'image/gif' }, { allowGif: false }).ok === false,
  '未解锁 GIF 时应拒绝 gif',
);
assert(
  deco.validateUploadFile({ size: 1024, type: 'image/png' }).ok === true,
  '常规 PNG 应通过本地预检',
);

const pluginIndex = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/official-room-deco/index.js'),
  'utf8',
);
assert(/registerPanel/.test(pluginIndex), '探测插件应挂设置页');
assert(/room\/decorate|DC\(/.test(pluginIndex), '探测插件应调用官方 decorate');
assert(/room_deco_pic/.test(pluginIndex), '换图应走官方 uploadCustomFile source=room_deco_pic');
assert(!/canChangeBgPic\s*\(/.test(pluginIndex), '探测插件不得调用官方 UI 门闩 canChangeBgPic()');
assert(
  /createLocalHelpers/.test(pluginIndex),
  '探测插件应内置 helpers，不能只靠二次加载 deco.js',
);
assert(!/HELPERS_SRC/.test(pluginIndex), '探测插件不应再依赖 deco.js 的 script src');
assert(/textarea/.test(pluginIndex), '探测结果应使用 textarea 便于复制完整 payload');

const pluginsJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  pluginsJson.some((p) => p.id === 'official-room-deco' && p.entry === 'index.js'),
  'plugins.json 应注册 official-room-deco',
);

console.log('ok: official-room-deco payload bypasses client upload gate');
