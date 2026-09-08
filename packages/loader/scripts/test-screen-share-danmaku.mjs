/**
 * 屏幕共享增强：连接模式文案与 P2P/中转切换判定，不碰 RTC 实例。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const officialPluginsRepo = path.resolve(__dirname, '../../../../BetterHeyboxChat-plugins');
const pluginDir = path.join(officialPluginsRepo, 'screen-share-danmaku');
const extractPath = path.join(pluginDir, 'extract.js');
const indexPath = path.join(pluginDir, 'index.js');
const manifestPath = path.join(pluginDir, 'manifest.json');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(extractPath), '应存在 screen-share-danmaku/extract.js');
assert(fs.existsSync(indexPath), '应存在 screen-share-danmaku/index.js');

const extractSource = fs.readFileSync(extractPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(extractSource, electronLike);
assert(
  electronLike.window.BhchatScreenShareDanmaku &&
    typeof electronLike.window.BhchatScreenShareDanmaku.modeLabel === 'function',
  'Electron 渲染进程有 module.exports 时，extract.js 仍必须挂到 window',
);

const extract = require(extractPath);

assert(extract.modeLabel('p2p', 'volc') === 'P2P', 'P2P 传输应显示 P2P');
assert(extract.modeLabel('p2p', 'trtc') === 'P2P', 'P2P 时忽略商业线路名');
assert(extract.modeLabel('switching', 'volc') === '切换中', '升级/回落中应显示切换中');
assert(extract.modeLabel('commercial', 'trtc') === 'TRTC', '商业 TRTC 应显示 TRTC');
assert(extract.modeLabel('commercial', 'volc') === '火山RTC', '商业火山应显示火山RTC');
assert(extract.modeLabel('', 'volc') === '火山RTC', '空 transport 时按频道线路显示');
assert(extract.modeLabel('commercial', '') === '中转', '未知商业线路回落为中转');

assert(extract.isP2P('p2p') === true, 'p2p 应判定为 P2P');
assert(extract.isP2P('commercial') === false, 'commercial 不是 P2P');
assert(extract.isP2P('switching') === false, '切换中不是已接通的 P2P');

assert(extract.canUseP2P(true, 2) === true, '服务端开启且两人频道才能 P2P');
assert(extract.canUseP2P(true, 3) === false, '三人频道不能 P2P');
assert(extract.canUseP2P(false, 2) === false, '服务端未开不能 P2P');
assert(extract.p2pUnavailableReason(false, 2) === '当前房间未开启 P2P', '未开 flag 的原因');
assert(extract.p2pUnavailableReason(true, 3) === 'P2P 仅支持两人频道', '人数不对的原因');
assert(extract.p2pUnavailableReason(true, 2) === '', '可用时没有原因');

assert(extract.toggleTarget('p2p') === 'commercial', '当前 P2P 时按钮切到中转');
assert(extract.toggleTarget('commercial') === 'p2p', '当前中转时按钮切到 P2P');
assert(extract.toggleTarget('switching') === 'p2p', '切换中默认仍指向 P2P 重试');

const pluginIndex = fs.readFileSync(indexPath, 'utf8');
assert(/quality-block/.test(pluginIndex), '模式字应写进官方 quality-block');
assert(/data-bhchat-mode/.test(pluginIndex), '用 data-bhchat-mode 撑开官方胶囊，不另起一颗');
assert(/min-width:142px/.test(pluginIndex), '官方胶囊加宽后才能放下火山RTC');
assert(!/bhchat-ss-mode-block\{position:absolute/.test(pluginIndex), '不要再单独挂一颗模式胶囊');
assert(/left-operate/.test(pluginIndex), 'P2P/中转应插入官方 left-operate');
assert(!/else if \(now\) \{\s*syncChrome\(\);/.test(pluginIndex), 'Observer 不得在每次 mutation 都 syncChrome，否则会和官方 class 互踢假死');
assert(/tryP2PReupgrade/.test(pluginIndex), '切到 P2P 应走官方 $rtc.tryP2PReupgrade');
assert(/cancelP2PUpgrade/.test(pluginIndex), '切到中转应走官方 $rtc.cancelP2PUpgrade');
assert(/cancelScheduledP2PReupgrade/.test(pluginIndex), '选中转后应取消官方自动回升');
assert(/bhchatPreload/.test(pluginIndex), '读附加脚本应走 preload.readUserFile');
assert(!/52587|23255|78564|2597/.test(pluginIndex), '不得写死 webpack 模块 ID');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.id === 'screen-share-danmaku', 'manifest.id 必须是 screen-share-danmaku');
assert(manifest.name.indexOf('屏幕共享增强') !== -1, '显示名应包含屏幕共享增强');
assert(typeof manifest.desc === 'string' && manifest.desc.length > 0 && manifest.desc.length <= 100, 'desc 不超过 100 字');
assert(manifest.files && manifest.files.indexOf('extract.js') !== -1, 'files 应包含 extract.js');

const registry = JSON.parse(fs.readFileSync(path.join(officialPluginsRepo, 'registry.json'), 'utf8'));
const item = registry.plugins.find((p) => p.id === 'screen-share-danmaku');
assert(item, '货架应有 screen-share-danmaku');
assert(item.version === manifest.version, '货架 version 应与 manifest 一致');

console.log('ok: screen-share-danmaku extract + plugin layout');
