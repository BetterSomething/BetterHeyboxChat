/**
 * 屏幕共享解锁：把官方 check 返回的灰档改成可点，不碰 OBS / RTC 音频。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const officialPluginsRepo = path.resolve(__dirname, '../../../../BetterHeyboxChat-plugins');
const pluginDir = path.join(officialPluginsRepo, 'screen-share-unlock');
const extractPath = path.join(pluginDir, 'extract.js');
const indexPath = path.join(pluginDir, 'index.js');
const manifestPath = path.join(pluginDir, 'manifest.json');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(extractPath), '应存在 screen-share-unlock/extract.js');
assert(fs.existsSync(indexPath), '应存在 screen-share-unlock/index.js');

const extractSource = fs.readFileSync(extractPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(extractSource, electronLike);
assert(
  electronLike.window.BhchatScreenShareUnlock &&
    typeof electronLike.window.BhchatScreenShareUnlock.unlockShareOptions === 'function',
  'Electron 渲染进程有 module.exports 时，extract.js 仍必须挂到 window',
);

const extract = require(extractPath);
const locked = {
  frame_rate: [
    { enable: true, value: 15, desc: '15帧', tool_tip: '', tab: 0 },
    { enable: true, value: 30, desc: '30帧', tool_tip: '', tab: 0 },
    { enable: true, value: 60, desc: '60帧', tool_tip: '', tab: 0 },
  ],
  resolution: [
    { enable: true, value: 480, desc: '480p', tool_tip: '', tab: 0 },
    { enable: false, value: 720, desc: '720p', tool_tip: '充值解锁升级版', tab: 1 },
    { enable: false, value: 1080, desc: '1080p', tool_tip: '充值解锁升级版', tab: 1 },
    { enable: false, value: 1440, desc: '2k', tool_tip: '充值解锁专业版', tab: 1 },
    { enable: false, value: 2160, desc: '4k', tool_tip: '充值解锁专业版', tab: 1 },
  ],
};

const unlocked = extract.unlockShareOptions(locked);
assert(unlocked.resolution.every((item) => item.enable === true), '所有分辨率应可点');
assert(unlocked.resolution.find((item) => item.value === 2160).tool_tip === '', '解锁后不应再提示充值');
assert(locked.resolution[4].enable === false, 'unlock 不得改入参');
assert(unlocked.frame_rate.length === 3 && unlocked.frame_rate[2].value === 60, '帧率列表应保留');

const check = extract.unlockCheckInfo({
  check: false,
  tag: '免费版',
  plus_tag: '',
  options: locked,
});
assert(check.check === true, 'check 应为 true，官方面板按已解锁渲染');
assert(check.tag === '免费版', '不要伪造会员 tag');

assert(extract.lineLabel('trtc') === '线路1 TRTC', '线路1 是 TRTC');
assert(extract.lineLabel('volc') === '线路2 火山云', '线路2 是火山云');

const pluginIndex = fs.readFileSync(indexPath, 'utf8');
assert(/SET_GLOBAL_CONFIG/.test(pluginIndex), '应在 SET_GLOBAL_CONFIG 后改 screenshare_options');
assert(/SET_SCREEN_SHARE_CHECK_INFO/.test(pluginIndex), '应在 SET_SCREEN_SHARE_CHECK_INFO 后改 check');
assert(/bhchatPreload/.test(pluginIndex), '读附加脚本应走 preload.readUserFile');
assert(!/\.YA\(/.test(pluginIndex), '不得调用 screen_share/start（YA）');
assert(!/window\.confirm/.test(pluginIndex), '不得使用原生 confirm');
assert(!/location\.reload/.test(pluginIndex), '不得整页刷新');
assert(!/ffmpeg|ffplay|rtmp:\/\/|:1935|startObsPush|startRawPipe/i.test(pluginIndex), '不得再做本机推流');
assert(!/52587|23255|78564|2597/.test(pluginIndex), '不得写死 webpack 模块 ID');
assert(!/startLocalAudio|muteRemoteAudio/.test(pluginIndex), '不得 hook RTC 音频');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.id === 'screen-share-unlock', 'manifest.id 必须是 screen-share-unlock');
assert(manifest.name.indexOf('解锁') !== -1, '显示名应包含解锁');
assert(typeof manifest.desc === 'string' && manifest.desc.length > 0 && manifest.desc.length <= 100, 'desc 不超过 100 字');
assert(!manifest.files || manifest.files.indexOf('extract.js') !== -1, 'files 应包含 extract.js');

assert(!fs.existsSync(path.join(officialPluginsRepo, 'screen-share-stream', 'manifest.json')), '旧插件 screen-share-stream 应删除');

const bundled = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'));
assert(!bundled.some((p) => p.id === 'screen-share-unlock' || p.id === 'screen-share-stream'), '解锁插件不应内置');

const registry = JSON.parse(fs.readFileSync(path.join(officialPluginsRepo, 'registry.json'), 'utf8'));
assert(!registry.plugins.some((p) => p.id === 'screen-share-unlock'), 'screen-share-unlock 不进公开货架');
assert(!registry.plugins.some((p) => p.id === 'screen-share-stream'), '货架不应再挂 screen-share-stream');

console.log('ok: screen-share-unlock extract + plugin layout');
