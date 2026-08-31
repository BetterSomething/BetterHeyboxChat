/**
 * 屏幕共享直链 / OBS 推流：纯函数探测与本机地址，不碰 TRTC 音频。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const officialPluginsRepo = path.resolve(__dirname, '../../../../BetterHeyboxChat-plugins');
const pluginDir = path.join(officialPluginsRepo, 'screen-share-stream');
const extractPath = path.join(pluginDir, 'extract.js');
const indexPath = path.join(pluginDir, 'index.js');
const ingestPath = path.join(pluginDir, 'ingest.js');
const manifestPath = path.join(pluginDir, 'manifest.json');

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(fs.existsSync(extractPath), '应存在 screen-share-stream/extract.js');

const extractSource = fs.readFileSync(extractPath, 'utf8');
const electronLike = {
  module: { exports: {} },
  window: {},
  globalThis: null,
};
electronLike.globalThis = electronLike;
vm.runInNewContext(extractSource, electronLike);
assert(
  electronLike.window.BhchatScreenShareStream &&
    typeof electronLike.window.BhchatScreenShareStream.collectUrlStrings === 'function',
  'Electron 渲染进程有 module.exports 时，extract.js 仍必须挂到 window',
);
assert(
  electronLike.module.exports &&
    typeof electronLike.module.exports.collectUrlStrings === 'function',
  'Node require 路径仍应导出 collectUrlStrings',
);

const extract = require(extractPath);

const nested = {
  result: {
    token: 'secret-user-sig',
    private_map_key: 'map-key',
    app_id: '12345',
    play: 'https://cdn.example.com/live/abc.flv',
    push: 'rtmp://push.example.com/live/stream?token=abc',
    page: 'https://chat.xiaoheihe.cn/obs/index?port=1',
    nested: [{ href: 'http://127.0.0.1:8080/watch.m3u8' }],
  },
};

const urls = extract.collectUrlStrings(nested);
assert(urls.indexOf('https://cdn.example.com/live/abc.flv') !== -1, '应收集 flv 播放地址');
assert(urls.indexOf('rtmp://push.example.com/live/stream?token=abc') !== -1, '应收集 rtmp 推流地址');
assert(urls.indexOf('http://127.0.0.1:8080/watch.m3u8') !== -1, '应收集嵌套 m3u8');
assert(urls.indexOf('https://chat.xiaoheihe.cn/obs/index?port=1') !== -1, '普通 https 也应被收集供分类');

assert(extract.isLikelyStreamUrl('rtmp://a/b'), 'rtmp 应视为流地址');
assert(extract.isLikelyStreamUrl('https://x/a.flv'), 'flv 应视为流地址');
assert(extract.isLikelyStreamUrl('https://x/a.m3u8'), 'm3u8 应视为流地址');
assert(!extract.isLikelyStreamUrl('https://chat.xiaoheihe.cn/obs/index'), 'OBS 覆盖页不是流地址');

const classified = extract.classifyUrls(urls);
assert(classified.push.indexOf('rtmp://push.example.com/live/stream?token=abc') !== -1, 'rtmp 应归入 push');
assert(classified.play.indexOf('https://cdn.example.com/live/abc.flv') !== -1, 'flv 应归入 play');
assert(classified.play.indexOf('http://127.0.0.1:8080/watch.m3u8') !== -1, 'm3u8 应归入 play');
assert(
  classified.other.indexOf('https://chat.xiaoheihe.cn/obs/index?port=1') !== -1,
  'OBS 覆盖页应归入 other',
);

const redacted = extract.redactSecrets(nested);
assert(redacted.result.token === '[redacted]', 'token 必须打码');
assert(redacted.result.private_map_key === '[redacted]', 'private_map_key 必须打码');
assert(redacted.result.app_id === '12345', 'app_id 可保留');
assert(redacted.result.play === 'https://cdn.example.com/live/abc.flv', '播放地址不应打码');

const noShare = extract.snapshotShare({
  screen_sharing_info: {},
  my_screen_sharing: false,
  cur_channel_data: { channel_id: 'c1', channel_type: 2 },
  cur_room_data: { room_id: 'r1', room_name: '房' },
});
assert(noShare.watching === false, '无 user_id 不算正在观看');
assert(noShare.hasShare === false, '成员没有 screen_share_info 则频道内无共享');
assert(noShare.roomId === 'r1', '应带上 room_id');
assert(noShare.channelId === 'c1', '应带上 channel_id');

const listed = extract.snapshotShare({
  screen_sharing_info: {},
  screen_share_user_list: [{ user_id: 43625960, nickname: '主播', screen_share_info: { session_id: 's1', publish_state: true } }],
  my_screen_sharing: false,
  cur_channel_data: {
    channel_id: 'c1',
    channel_type: 0,
    api_type: 'volc',
    members: [{ user_id: 43625960, nickname: '主播', screen_share_info: { session_id: 's1' } }],
  },
  cur_room_data: { room_id: 'r1' },
});
assert(listed.hasShare === true, 'screen_share_user_list 有人就算频道内有共享');
assert(listed.watching === false, '没点观看时 screen_sharing_info 仍可为空');
assert(String(listed.sharers[0].userId) === '43625960', 'sharers 应列出正在共享的人');
assert(listed.apiType === 'volc', '应记下当前 RTC 线路');
assert(listed.lineLabel === '线路2 火山云', 'volc 应显示为线路2');

const watching = extract.snapshotShare({
  screen_sharing_info: { user_id: 99, nickname: '主播' },
  my_screen_sharing: false,
  cur_channel_data: { channel_id: 'c1', channel_type: 2 },
  cur_room_data: { room_id: 'r1' },
});
assert(watching.watching === true, '有 user_id 算正在观看');
assert(String(watching.sharerId) === '99', '应记录共享者');

const flat = extract.flattenCaptureSources([
  [{ sourceName: '屏幕1', source_info: { type: 2, source_id: 1 } }],
  [{ sourceName: 'OBS', source_info: { type: 1, source_id: 2, application: 'obs64.exe' } }],
]);
assert(flat.length === 2, '采集源应拍平屏幕+窗口两组');
assert(flat[1].name === 'OBS', '窗口源应保留名称');

assert(
  extract.canProbe({
    roomId: 'r1',
    channelId: 'c1',
    channelType: 2,
  }).ok,
  '在语音频道应可探测',
);
assert(
  !extract.canProbe({ roomId: '', channelId: 'c1' }).ok,
  '没进房间不可探测',
);
assert(
  !extract.canProbe({ roomId: 'r1', channelId: '' }).ok,
  '没进频道不可探测',
);

const local = extract.buildLocalEndpoints({
  host: '127.0.0.1',
  rtmpPort: 1935,
  httpPort: 18080,
  streamKey: 'heybox',
});
assert(local.rtmp === 'rtmp://127.0.0.1:1935/live/heybox', '本机 RTMP 地址格式');
assert(local.rtmpServer === 'rtmp://127.0.0.1:1935/live/heybox', 'OBS 服务器应填整段 URL');
assert(local.rtmpKey === '', 'OBS 推流码必须留空，否则 FFmpeg 会把 live/heybox 拆开');
assert(local.play === 'http://127.0.0.1:18080/watch.mjpg', '本机播放地址应为 MJPEG');
assert(extract.lineLabel('trtc') === '线路1 TRTC', '线路1 是 TRTC');
assert(extract.lineLabel('volc') === '线路2 火山云', '线路2 是火山云');

const merged = extract.mergeProbe({
  check: { data: { status: 'ok', result: { play_url: 'https://cdn.example.com/x.flv' } } },
  token: { data: { status: 'ok', result: { res: { token: 'sig', app_id: '1', api_type: 'volc' } } } },
  vuexShare: { watching: true, sharerId: '99' },
  local: local,
});
assert(merged.officialPlay.indexOf('https://cdn.example.com/x.flv') !== -1, 'merge 应抽出官方播放地址');
assert(merged.officialPush.length === 0, '无 rtmp 时 officialPush 为空');
assert(merged.rtc.app_id === '1', '应保留 RTC app_id');
assert(merged.rtc.api_type === 'volc', 'token.res.api_type 应记入 merge');
assert(merged.rtc.token === '[redacted]', 'merge 后 token 必须打码');
assert(merged.local.rtmp === local.rtmp, 'merge 应带上本机 RTMP');
assert(merged.probeCallsStart !== true, '探测不得调用 start');

const pluginIndex = fs.readFileSync(indexPath, 'utf8');
assert(/52587/.test(pluginIndex) && /Wj/.test(pluginIndex), '探测 check 应走 webpack 52587.Wj');
assert(/26737/.test(pluginIndex) && /IX/.test(pluginIndex), '探测 token 应走 webpack 26737.IX');
assert(!/\.YA\(/.test(pluginIndex), '探测路径不得调用 screen_share/start（YA）');
assert(!/window\.confirm/.test(pluginIndex), '不得使用原生 confirm');
assert(!/location\.reload/.test(pluginIndex), '不得整页刷新');
assert(/readUserFile/.test(pluginIndex), 'extract/ingest 应从用户插件目录读取');
assert(
  !/betterheyboxchat\/plugins\/screen-share-stream/.test(pluginIndex),
  '不得写死内置插件路径',
);
assert(/startReceiveScreenCapture/.test(pluginIndex), '本机播放应走官方 RTC startReceiveScreenCapture');
assert(/23255/.test(pluginIndex) && /78564/.test(pluginIndex), '应按 api_type 选 volc 23255 或 trtc 78564');
assert(!/只支持火山/.test(pluginIndex), 'OBS 直推必须同时支持 trtc');
assert(/BHChat-OBS|ffplay/.test(pluginIndex), 'TRTC 应用预览窗给官方窗口采集');
assert(/ensureFfmpegListen/.test(pluginIndex), '本机 RTMP 与 OBS 直推应共用收流');
assert(/onFlv|createMediaFlvPump/.test(pluginIndex), 'OBS RTMP 应由 Node 收并转 FLV，不能再让 FFmpeg listen 对 app');
assert(/startWindowOfficial/.test(pluginIndex), '官方共享应走预览窗采集，不依赖火山外部帧');
assert(/startScreenCapture/.test(pluginIndex), '应用官方 startScreenCapture 开共享');
assert(/watch\.mjpg/.test(pluginIndex), '本机播放地址应是 MJPEG');

assert(fs.existsSync(ingestPath), '应存在 ingest.js（本机 RTMP / HTTP）');
const ingest = require(ingestPath);
const ingestSource = fs.readFileSync(ingestPath, 'utf8');
assert(/1935|createServer/.test(ingestSource), 'ingest 应能监听本机端口');
assert(!/startLocalAudio|muteRemoteAudio/.test(ingestSource), '不得 hook TRTC 音频');
assert(ingest.FLV_HEADER && ingest.FLV_HEADER[0] === 0x46, '应导出 FLV 头');
assert(typeof ingest.createMediaFlvPump === 'function', '应能把 RTMP 媒体打成 FLV');
assert(typeof ingest.buildFlvTag === 'function', '应导出 FLV tag');
const flvParts = [];
const pump = ingest.createMediaFlvPump(function (chunk) {
  flvParts.push(chunk);
});
const videoPayload = Buffer.from([0x17, 0x00, 0x00, 0x00, 0x00]);
const rtmpVideo = Buffer.alloc(12 + videoPayload.length);
rtmpVideo[0] = 4;
rtmpVideo[4] = 0;
rtmpVideo[5] = 0;
rtmpVideo[6] = videoPayload.length;
rtmpVideo[7] = 9;
rtmpVideo.writeUInt32LE(1, 8);
videoPayload.copy(rtmpVideo, 12);
pump.push(rtmpVideo);
const flv = Buffer.concat(flvParts);
assert(flv[0] === 0x46 && flv[1] === 0x4c && flv[2] === 0x56, '第一条应写出 FLV 头');
assert(flv[13] === 9, '随后应有 video tag');

const volcMap = {
  480: { width: 614, height: 469, bitrate: 900, min_bitrate: 500 },
  720: { width: 1280, height: 720, bitrate: 1800, min_bitrate: 1000 },
  1080: { width: 1920, height: 1080, bitrate: 8000, min_bitrate: 2000 },
  1440: { width: 2560, height: 1440, bitrate: 12000, min_bitrate: 4000 },
  2160: { width: 3840, height: 2160, bitrate: 20000, min_bitrate: 8000 },
};
const enc = extract.buildEncoderConfig({
  resolution: 1080,
  frameRate: 60,
  map: volcMap,
});
assert(enc.width === 1920 && enc.height === 1080, '1080 档应按官方 map 取 1920x1080');
assert(enc.frame_rate === 60, '帧率应原样带上');
assert(enc.max_bitrate === 8000 && enc.min_bitrate === 2000, '自定义采集必须带码率');
assert(enc.resolution === 1080, 'HTTP start 用的档位应与编码一致');
assert(enc.encoder_preference === 1, '屏幕流应走画质优先');

const odd = extract.buildEncoderConfig({ resolution: 480, frameRate: 30, map: volcMap });
assert(odd.width % 2 === 0 && odd.height % 2 === 0, 'I420 宽高必须偶数');
assert(odd.width === 614 && odd.height === 468, '469 应向下对齐到 468');

const fallback = extract.buildEncoderConfig({ resolution: 999, frameRate: 12, map: {} });
assert(fallback.resolution === 1080 && fallback.frame_rate === 60, '非法档位回落到默认 1080p60');
assert(fallback.width === 1920 && fallback.height === 1080, '无 map 时用内置 1080 尺寸');

assert(extract.i420ByteLength(1920, 1080) === 1920 * 1080 * 1.5, 'I420 一帧字节数');
assert(extract.rgbaByteLength(1920, 1080) === 1920 * 1080 * 4, 'RGBA 一帧字节数');
const ffmpegArgs = extract.buildFfmpegArgs({
  input: 'pipe:0',
  width: 1920,
  height: 1080,
  frameRate: 60,
});
assert(ffmpegArgs.indexOf('pipe:0') !== -1, 'FFmpeg 应从 stdin 读 Node 转出来的 FLV');
assert(ffmpegArgs.indexOf('-listen') === -1, 'FFmpeg 不应再自己 listen RTMP');
assert(ffmpegArgs.indexOf('flv') !== -1, 'FFmpeg 输入格式应是 flv');
assert(ffmpegArgs.indexOf('rawvideo') !== -1, 'FFmpeg 应输出 rawvideo');
assert(ffmpegArgs.indexOf('rgba') !== -1, 'FFmpeg 像素格式应是 rgba（火山自定义采集）');
assert(ffmpegArgs.some((a) => String(a).indexOf('1920') !== -1), 'FFmpeg 应缩放到目标宽');
const plane = { length: 1920 * 1080 * 4 };
const extFrame = extract.buildExternalFrame({
  width: 1920,
  height: 1080,
  data: plane,
  timestampMs: 16,
});
assert(extFrame.pixel_fmt === 5, '外部帧应是 RGBA');
assert(extFrame.linesize[0] === 1920 * 4, 'RGBA linesize 应是 width*4');
assert(extFrame.timestamp_ms === 16, '时间戳应从 0 递增，不能用 Date.now');
assert(extFrame.width === 1920 && extFrame.height === 1080, '外部帧尺寸应与编码一致');
assert(extract.clampQuality({ resolution: 2160, frameRate: 15 }).resolution === 2160, '应允许 4K 档');
const ffplayArgs = extract.buildFfplayArgs({ width: 1920, height: 1080, frameRate: 60, title: 'BHChat-OBS' });
assert(ffplayArgs.indexOf('BHChat-OBS') !== -1, 'ffplay 窗口标题应是 BHChat-OBS');
assert(ffplayArgs.indexOf('rgba') !== -1 || ffplayArgs.indexOf('rgb0') !== -1, 'ffplay 应吃 RGBA raw');
const found = extract.findSourceByName(
  [{ name: '屏幕1' }, { name: 'BHChat-OBS' }, { name: 'QQ' }],
  'BHChat-OBS',
);
assert(found && found.name === 'BHChat-OBS', '应按窗口标题找到预览源');
assert(extract.clampQuality({ resolution: 720, frameRate: 30 }).frameRate === 30, '应允许 30 帧');

const pushPath = path.join(pluginDir, 'push.js');
assert(fs.existsSync(pushPath), '应存在 push.js（FFmpeg raw 读帧）');
const pushSource = fs.readFileSync(pushPath, 'utf8');
assert(/spawn|child_process/.test(pushSource), 'push.js 应拉起 FFmpeg');
assert(/i420|yuv420|rawvideo/.test(pushSource), 'push.js 应按 I420 切帧');
assert(/stdin|\['pipe'/.test(pushSource), 'FFmpeg stdin 应能写入 Node 转出的 FLV');

assert(/setVideoSourceType/.test(pluginIndex), '推进 RTC 应 setVideoSourceType');
assert(/pushExternalVideoFrame/.test(pluginIndex), '推进 RTC 应 pushExternalVideoFrame');
assert(/reportScreenShareRole/.test(pluginIndex), '开共享应走官方 reportScreenShareRole');
assert(/buildEncoderConfig/.test(pluginIndex), '编码参数应走 extract.buildEncoderConfig');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.id === 'screen-share-stream', 'manifest.id 必须是 screen-share-stream');
assert(manifest.name.indexOf('屏幕共享') !== -1, '显示名应包含屏幕共享');
assert(typeof manifest.desc === 'string' && manifest.desc.length > 0 && manifest.desc.length <= 100, 'desc 不超过 100 字');
assert(Array.isArray(manifest.files) && manifest.files.indexOf('extract.js') !== -1, 'files 应包含 extract.js');
assert(manifest.files.indexOf('ingest.js') !== -1, 'files 应包含 ingest.js');
assert(manifest.files.indexOf('push.js') !== -1, 'files 应包含 push.js');

const bundled = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  !bundled.some((p) => p.id === 'screen-share-stream'),
  'screen-share-stream 不应出现在内置 plugins.json',
);
const registry = JSON.parse(fs.readFileSync(path.join(officialPluginsRepo, 'registry.json'), 'utf8'));
assert(
  registry.plugins.some((p) => p.id === 'screen-share-stream'),
  '插件仓 registry 应登记 screen-share-stream',
);

console.log('ok: screen-share-stream extract + plugin layout');
