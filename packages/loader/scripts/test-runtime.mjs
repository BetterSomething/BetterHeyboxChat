/**
 * Phase 2：BHChat API（getVue / mapState / watch / panel / 插件启停）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/runtime.js'),
  'utf8',
);

function createVueCtor() {
  function Vue() {}
  Vue.component = function () {};
  Vue.options = { components: {} };
  return Vue;
}

function createStore(state) {
  const watchers = [];
  return {
    state,
    getters: state,
    watch(getter, cb) {
      watchers.push({ getter, cb });
      return function unwatch() {
        const idx = watchers.indexOf(arguments[0] ? null : watchers.find((w) => w.cb === cb));
        for (let i = 0; i < watchers.length; i++) {
          if (watchers[i].cb === cb) {
            watchers.splice(i, 1);
            break;
          }
        }
      };
    },
    _notify() {
      watchers.forEach((w) => w.cb(w.getter()));
    },
    _watcherCount() {
      return watchers.length;
    },
  };
}

function loadRuntime(opts) {
  const Vue = createVueCtor();
  const store = createStore(
    opts.state || {
      cur_room_data: { room_id: 'r1', room_name: '测试房' },
      room_list: [{ room_id: 'r1' }],
    },
  );
  const appEl = {
    id: 'app',
    __vue__: {
      constructor: Vue,
      $root: { constructor: Vue },
      $store: store,
    },
  };
  const storage = new Map();
  const electronAPI = {
    restartApp() {
      electronAPI.restarted += 1;
    },
    restarted: 0,
    async getData(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    async setData(key, value) {
      storage.set(key, value);
    },
    async delData(key) {
      storage.delete(key);
    },
  };

  const documentStub = {
    readyState: 'complete',
    getElementById(id) {
      return id === 'app' ? appEl : null;
    },
    createElement(tag) {
      return { tagName: tag, setAttribute() {}, textContent: '', rel: '', href: '' };
    },
    head: { appendChild() {} },
  };

  const sandbox = {
    console,
    document: documentStub,
    window: {
      asar_version: '1.56.0',
      electronAPI,
      BHChatStorage: {
        get: (key) => electronAPI.getData(key).then((raw) => (raw == null ? null : JSON.parse(raw))),
        set: (key, value) => electronAPI.setData(key, JSON.stringify(value)),
        del: (key) => electronAPI.delData(key),
      },
    },
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
  };
  sandbox.window.document = documentStub;
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(runtimeSource, sandbox);
  return { BHChat: sandbox.window.BHChat, store, Vue, electronAPI, storage };
}

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

const { BHChat, store, Vue, electronAPI } = loadRuntime({});

assert(BHChat, 'runtime 未暴露 window.BHChat');
assert(BHChat.getVue() === Vue, 'getVue() 应返回 #app.__vue__ 的构造函数');

const mapped = BHChat.mapState(['cur_room_data', 'room_list']);
assert(mapped.cur_room_data && mapped.cur_room_data.room_id === 'r1', 'mapState 应读取 getters.cur_room_data');
assert(Array.isArray(mapped.room_list), 'mapState 应读取 getters.room_list');

const snapshot = BHChat.mapState();
assert(snapshot.cur_room_data && snapshot.cur_room_data.room_id === 'r1', 'mapState() 无参应返回已知房间快照');

let watched = 0;
const unwatch = BHChat.watch(
  function () {
    return store.getters.cur_room_data;
  },
  function () {
    watched += 1;
  },
);
assert(typeof unwatch === 'function', 'watch 应返回取消函数');
assert(store._watcherCount() === 1, '有 Vuex store 时应走 store.watch');
store._notify();
assert(watched === 1, 'store.watch 回调应被触发');
unwatch();
assert(store._watcherCount() === 0, '取消 watch 后不应再持有监听');

BHChat.registerPanel({
  id: 'demo-panel',
  title: '演示',
  component: {
    render() {
      return null;
    },
  },
});
const panels = BHChat.listPanels();
assert(panels.length === 1 && panels[0].id === 'demo-panel', 'registerPanel / listPanels 应记录设置区块');

BHChat.registerPlugin({
  id: 'demo',
  name: '演示插件',
  version: '1.0.0',
  author: 'AwCat',
  repository: 'https://github.com/BetterSomething/BetterHeyboxChat',
  enabled: true,
  entry: 'index.js',
});
assert(BHChat.isPluginEnabled('demo') === true, '未写用户覆盖时，manifest.enabled=true 应启用');

await BHChat.setPluginEnabled('demo', false);
assert(BHChat.isPluginEnabled('demo') === false, 'setPluginEnabled(false) 后应视为禁用（重启后不加载）');
const listed = BHChat.listPlugins();
const demo = listed.find((p) => p.id === 'demo');
assert(demo && demo.enabled === false, 'listPlugins 应反映用户禁用状态');
assert(demo.author === 'AwCat', 'listPlugins 应带上 author');
assert(demo.repository === 'https://github.com/BetterSomething/BetterHeyboxChat', 'listPlugins 应带上 repository');
assert(demo.source === 'bundled', '未标 source 的插件应视为 bundled');
assert(typeof demo.desc === 'string', 'listPlugins 应带上 desc');

const pluginsJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  pluginsJson.every((p) => p.author && p.repository),
  'plugins.json 每项应有 author 与 repository',
);
assert(
  pluginsJson.every((p) => typeof p.desc === 'string' && p.desc.length > 0 && p.desc.length <= 100),
  'plugins.json 每项应有不超过 100 字的 desc',
);
assert(
  pluginsJson.some((p) => p.id === 'marketplace' && p.entry === 'index.js'),
  'plugins.json 应注册 marketplace',
);

const ns = BHChat.storage.ns('demo');
assert(ns && typeof ns.get === 'function' && typeof ns.set === 'function', 'storage.ns(pluginId) 应返回隔离存储');
await ns.set('theme', 'dark');
assert((await ns.get('theme')) === 'dark', '插件命名空间应能读写');
assert((await BHChat.storage.get('bhchat.plugin.demo.theme')) === 'dark', '隔离 key 前缀应为 bhchat.plugin.{id}.');

BHChat.restart();
assert(electronAPI.restarted === 1, 'restart() 应调用 electronAPI.restartApp');

let updateSeen = null;
BHChat.onClientUpdate(function (info) {
  updateSeen = info;
});
assert(typeof BHChat.onClientUpdate === 'function', 'onClientUpdate 应注册回调');
BHChat._notifyClientUpdate({ repaired: ['webapp/index.html'], intact: [], missing: [], envFixed: false });
assert(updateSeen && updateSeen.repaired[0] === 'webapp/index.html', 'onClientUpdate 应收到补丁修复结果');
let lateSeen = null;
BHChat.onClientUpdate(function (info) {
  lateSeen = info;
});
assert(lateSeen && lateSeen.repaired[0] === 'webapp/index.html', '晚注册的 onClientUpdate 应补发上次结果');
assert(BHChat.patch && typeof BHChat.patch.getStatus === 'function', 'BHChat.patch.getStatus 应存在');
assert(typeof BHChat.patch.ensure === 'function', 'BHChat.patch.ensure 应存在');

const loaderSource = fs.readFileSync(path.resolve(__dirname, '../../../runtime/loader.js'), 'utf8');
assert(
  /isPluginEnabled|enabledMap|plugin\.enabled/.test(loaderSource),
  'loader 应按启用表跳过禁用插件',
);

const pluginSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/custom-room-bg/index.js'),
  'utf8',
);
assert(!/setInterval\(\s*tick\s*,\s*800\s*\)/.test(pluginSource), '房间背景不应再 800ms 轮询');
assert(/BHChat\.watch|this\.watch|\.watch\(/.test(pluginSource), '房间背景应使用 BHChat.watch');
assert(/registerPanel/.test(pluginSource), '房间背景 UI 应通过 registerPanel 挂到设置页');
assert(/bhchat-btn-primary/.test(pluginSource), '房间背景保存应使用主按钮而不是文本行');
assert(/type:\s*'file'|accept:\s*'image/.test(pluginSource), '房间背景应支持从本地选择图片');
assert(/fileToDataUrl|readAsDataURL|toDataURL/.test(pluginSource), '本地图片应转为可持久化的 data URL');
assert(!/pointer-keyset/.test(pluginSource), '房间背景设置不应再用 pointer-keyset 充当按钮');

const ttsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/channel-tts/index.js'),
  'utf8',
);
assert(/registerPanel/.test(ttsSource), 'TTS 设置应通过 registerPanel 挂到设置页');
assert(/type:\s*'number'/.test(ttsSource), '语速应使用数字输入框');
assert(!/不会读历史记录/.test(ttsSource), 'TTS 设置页不应再放说明长文');
assert(/bhchat-switch/.test(ttsSource) && /bhchat-btn-primary/.test(ttsSource), 'TTS 设置应使用开关与主按钮');
assert(!/pointer-keyset/.test(ttsSource), 'TTS 设置不应再用 pointer-keyset 充当按钮');
assert(/speechSynthesis/.test(ttsSource), 'TTS 应使用 Web Speech API');
assert(/SOCKET_SEND_MESSAGE/.test(ttsSource) && /SOCKET_USER_IM_MESSAGE/.test(ttsSource), 'TTS 应订阅官方文字消息事件');
assert(/channel_data/.test(ttsSource) && /cur_channel_data/.test(ttsSource), 'TTS 应按官方 channel_data 匹配当前频道（含语音房）');
assert(!/__webpack_require__\(93509\)/.test(ttsSource), 'TTS 不应直接 require 设置模块');
assert(!/'30570'|\"30570\"/.test(ttsSource), 'TTS 不应写死 EventBus 模块 ID');

const pluginsManifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  pluginsManifest.some((p) => p.id === 'channel-tts' && p.entry === 'index.js'),
  'plugins.json 应注册 channel-tts',
);

const laughterSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/laughter-fav-fix/index.js'),
  'utf8',
);
assert(/registerPanel/.test(laughterSource), '语音包收藏修复设置应通过 registerPanel 挂到设置页');
assert(/bhchat-switch/.test(laughterSource) && /bhchat-btn-primary/.test(laughterSource), '语音包收藏修复应使用开关与主按钮');
assert(!/pointer-keyset/.test(laughterSource), '语音包收藏修复不应再用 pointer-keyset 充当按钮');
assert(/dispatch|subscribe|\$emit/.test(laughterSource), '语音包收藏修复应挂接 Vuex / EventBus 以刷新列表');
assert(!/'30570'|\"30570\"/.test(laughterSource), '语音包收藏修复不应写死 EventBus 模块 ID');
assert(
  /Refresh_User_Laughter/.test(laughterSource),
  '语音包收藏修复应触发官方 Refresh_User_Laughter（与语音包平台收藏相同）',
);
assert(
  /SET_FAVORITE_VOICE_PACK_IDS/.test(laughterSource),
  '语音包收藏修复应监听 SET_FAVORITE_VOICE_PACK_IDS（频道内收藏/取消收藏只改了这个 mutation）',
);
assert(/取消收藏/.test(laughterSource), '语音包收藏修复应覆盖取消收藏路径');
assert(/bhchat-hint/.test(laughterSource), '语音包收藏修复设置页应展示刷新结果反馈');

const danmakuSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/screen-share-danmaku/index.js'),
  'utf8',
);
assert(/registerPanel/.test(danmakuSource), '屏幕共享增强设置应通过 registerPanel 挂到设置页');
assert(/bhchat-switch/.test(danmakuSource), '屏幕共享增强应使用开关');
assert(!/pointer-keyset/.test(danmakuSource), '屏幕共享增强不应再用 pointer-keyset 充当按钮');
assert(/SOCKET_SEND_MESSAGE/.test(danmakuSource) && /SOCKET_USER_IM_MESSAGE/.test(danmakuSource), '屏幕共享弹幕应订阅官方文字消息事件');
assert(/bhchat-ss-danmaku-layer|LAYER_ID/.test(danmakuSource), '屏幕共享增强应在共享画面上叠加弹幕层');
assert(!/'30570'|\"30570\"/.test(danmakuSource), '屏幕共享增强不应写死 EventBus 模块 ID');
assert(
  /screen_sharing_info/.test(danmakuSource),
  '弹幕开关应读官方 Vuex screen_sharing_info（观众是否在看共享，ScreenShareOccupy.isWatching 同源）',
);
assert(
  /my_screen_sharing/.test(danmakuSource),
  '弹幕开关应读官方 Vuex my_screen_sharing（自己是否在共享）',
);
assert(
  /screen_share_cpt_height/.test(danmakuSource),
  '弹幕开关应读官方 Vuex screen_share_cpt_height（观看区占位高度，未观看时为 0）',
);
assert(
  /cpt-screen-share-occupy/.test(danmakuSource),
  '弹幕层应挂到观众端官方占位节点 cpt-screen-share-occupy（TRTC 画面填进该节点）',
);
assert(
  /cpt-screenshare-me-preview/.test(danmakuSource),
  '分享者侧应识别官方预览节点 cpt-screenshare-me-preview（可能被暂停预览）',
);
assert(
  /querySelectorAll/.test(danmakuSource),
  '共享画面宿主应遍历全部候选节点并取最大块，避免 querySelector 命中配置弹窗缩略图后整段选择器被跳过',
);
assert(
  /attributeFilter/.test(danmakuSource),
  '应观察 occupy 的 style/class，否则只改高度时 MutationObserver(childList) 不会触发',
);
assert(
  /screen-share-operate/.test(danmakuSource),
  '弹幕输入框应挂到官方屏幕共享控制栏 .screen-share-operate，而不是 occupy 底边另起一条',
);
assert(
  !/#['"] \+\s*LAYER_ID[\s\S]*bhchat-ss-form\{position:absolute/.test(danmakuSource) &&
    !/bhchat-ss-form\{position:absolute;left:50%;bottom:18px/.test(danmakuSource),
  '弹幕输入框不应再绝对定位在共享画面底部凸出',
);
assert(
  /requestPictureInPicture/.test(danmakuSource),
  '应钩住官方 video.requestPictureInPicture（客户端 enablePictureInPicture 走这条）',
);
assert(
  /documentPictureInPicture/.test(danmakuSource),
  '非 Electron 环境可走 Document PiP，在 PiP 窗口里叠弹幕层',
);
assert(
  /captureStream/.test(danmakuSource),
  'Electron 原生 Video PiP 画不了 HTML，应把弹幕合成进 canvas 流再进画中画',
);
assert(
  /pictureInPictureElement/.test(danmakuSource),
  '应兼容官方 diasblePictureInPicture 对 document.pictureInPictureElement 的检查',
);
assert(
  !/view-room-inner-page/.test(danmakuSource) && !/view-room-inner/.test(danmakuSource),
  '弹幕宿主不能回退到房间聊天页 view-room-inner-page，否则未观看共享时弹幕会盖在主界面上',
);
assert(
  !/return Object\.keys\(info\)\.length > 0/.test(danmakuSource),
  '观看判定不能把任意非空 screen_sharing_info 当成正在看共享（官方 isWatching 只认 user_id）',
);
assert(
  !/if \(Number\(snap\.screen_share_cpt_height\) > 40\) return true/.test(danmakuSource),
  '不能单凭 screen_share_cpt_height>40 就开弹幕（进房/停看后高度可能残留，occupy 却不在）',
);
assert(
  /info\.user_id/.test(danmakuSource),
  '观众端是否在看共享应与官方 ScreenShareOccupy.isWatching 一致：Boolean(screen_sharing_info.user_id)',
);


assert(
  pluginsManifest.some((p) => p.id === 'laughter-fav-fix' && p.entry === 'index.js'),
  'plugins.json 应注册 laughter-fav-fix',
);
assert(
  pluginsManifest.some((p) => p.id === 'screen-share-danmaku' && p.entry === 'index.js'),
  'plugins.json 应注册 screen-share-danmaku',
);
assert(
  pluginsManifest.some((p) => p.id === 'block-update' && p.entry === 'index.js'),
  'plugins.json 应注册 block-update',
);
assert(
  pluginsManifest.some((p) => p.id === 'official-room-deco' && p.entry === 'index.js'),
  'plugins.json 应注册 official-room-deco',
);

const officialDecoSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/official-room-deco/index.js'),
  'utf8',
);
assert(/registerPanel/.test(officialDecoSource), '官方背景探测应通过 registerPanel 挂到设置页');
assert(/room_deco_pic/.test(officialDecoSource), '官方背景探测换图应走 room_deco_pic');
assert(/26737/.test(officialDecoSource) && /\.DC\b/.test(officialDecoSource), '官方背景探测应调用 26737.DC');
assert(!/canChangeBgPic\s*\(/.test(officialDecoSource), '官方背景探测不得调用 canChangeBgPic()');

const blockSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/block-update/index.js'),
  'utf8',
);
assert(/registerPanel/.test(blockSource), '屏蔽更新设置应通过 registerPanel 挂到设置页');
assert(/bhchat-switch/.test(blockSource), '屏蔽更新应使用开关');
assert(/updateClient/.test(blockSource) && /updateAsarResource/.test(blockSource), '屏蔽更新应钩官方 electronAPI 更新方法');
assert(/setAsarVersion/.test(blockSource), '屏蔽更新应拦截切换 asar 版本');
assert(/updateBlock/.test(blockSource), '屏蔽更新应把开关写到 preload/main-bridge 可读的标记');
assert(!/'30570'|\"30570\"/.test(blockSource), '屏蔽更新不应写死 EventBus 模块 ID');

const mainBridgeSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/main-bridge.js'),
  'utf8',
);
assert(/ensurePatches/.test(mainBridgeSource), 'main-bridge 启动时应检查并补回 patch');
assert(/wrapIpcMain/.test(mainBridgeSource), 'main-bridge 应拦截官方更新 IPC');

const hookSource = fs.readFileSync(path.resolve(__dirname, '../../../runtime/webpack-hook.js'), 'utf8');
assert(/listPanels|registerPanel/.test(hookSource), '设置页应渲染已注册 panel');
assert(/立即重启|restart\(/.test(hookSource), '设置页应提供立即重启按钮');
assert(/bhchat-btn-primary/.test(hookSource) && /bhchat-switch/.test(hookSource), '设置页应区分主按钮与开关样式');
assert(!/pointer-keyset/.test(hookSource), '设置页不应再用 pointer-keyset 把按钮做成列表行');
assert(/bhchat-row-desc/.test(hookSource), '设置页插件行应展示 desc');
assert(/safeHttpUrl/.test(hookSource), '仓库链接应经过 http(s) 校验');

const marketplaceSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/marketplace/index.js'),
  'utf8',
);
assert(/registerPanel/.test(marketplaceSource), '插件市场应挂到设置页');
assert(/webkitdirectory/.test(marketplaceSource), '插件市场应支持选择文件夹');
assert(/dragover|drop/.test(marketplaceSource), '插件市场应支持拖放安装');
assert(/确认安装/.test(marketplaceSource), '安装前应二次确认');
assert(!/innerHTML|v-html|domProps/.test(marketplaceSource), '确认框不得把插件字段当 HTML 插入');
assert(/fetchRegistry/.test(marketplaceSource), '插件市场应拉取在线 registry.json');
assert(/inspectRemote/.test(marketplaceSource) && /installRemote/.test(marketplaceSource), '插件市场应按需下载远程插件目录');
assert(/刷新货架/.test(marketplaceSource), '插件市场应能刷新在线货架');
assert(/加速源/.test(marketplaceSource), '插件市场应允许配置加速源前缀');

const loaderSource2 = fs.readFileSync(path.resolve(__dirname, '../../../runtime/loader.js'), 'utf8');
assert(/loadUserPlugins/.test(loaderSource2), 'loader 应加载用户目录插件');
assert(/injectTextScript/.test(loaderSource2), '用户插件应通过文本注入而不是 file://');

const installerUi = fs.readFileSync(path.resolve(__dirname, '../../../installer/src/ui.rs'), 'utf8');
const installerApp = fs.readFileSync(path.resolve(__dirname, '../../../installer/src/app.rs'), 'utf8');
const installerMain = fs.readFileSync(path.resolve(__dirname, '../../../installer/src/main.rs'), 'utf8');
const installerDetect = fs.readFileSync(path.resolve(__dirname, '../../../installer/src/detect.rs'), 'utf8');
assert(!/测试通道/.test(installerUi) && !/beta_channel/.test(installerUi) && !/beta_channel/.test(installerApp), '安装器应删除测试通道开关');
assert(/确定/.test(installerUi), '指定路径输入后应有确定按钮');
assert(
  /show_manual_path[\s\S]*浏览/.test(installerUi) || /浏览[\s\S]*show_manual_path/.test(installerUi),
  '浏览按钮应放在路径输入框旁边，而不是按钮网格里单独一格',
);
assert(/apply_manual_path/.test(installerApp) && /apply_manual_path/.test(installerUi), '确定按钮应调用 apply_manual_path');
assert(/ScrollArea/.test(installerUi), '安装器内容超出窗口时应可纵向滚动');
assert(
  /DisplayIcon|display_icon/.test(installerDetect),
  '注册表 InstallLocation 为空时应回退 DisplayIcon（本机 HeyboxChat 卸载项就是这样）',
);
assert(
  /collect_candidate_roots/.test(installerDetect),
  '探测根目录收集应独立成 collect_candidate_roots，保证注册表优先于硬编码路径',
);
const installerToml = fs.readFileSync(path.resolve(__dirname, '../../../installer/Cargo.toml'), 'utf8');
assert(
  /features\s*=\s*\[[^\]]*["']wgpu["']/.test(installerToml),
  '安装器应启用 eframe wgpu（Windows 走 DX11/12），避免 egui_glow 因 OpenGL 2.0 不可用而启动失败',
);
assert(
  /Renderer::Wgpu/.test(installerMain),
  '安装器启动应显式选择 wgpu 渲染后端',
);

console.log('OK: BHChat Phase 2 API / 插件启停 / watch / panel');
process.exit(0);

