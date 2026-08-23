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

const pluginsJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../runtime/plugins.json'), 'utf8'),
);
assert(
  pluginsJson.every((p) => p.author && p.repository),
  'plugins.json 每项应有 author 与 repository',
);

const ns = BHChat.storage.ns('demo');
assert(ns && typeof ns.get === 'function' && typeof ns.set === 'function', 'storage.ns(pluginId) 应返回隔离存储');
await ns.set('theme', 'dark');
assert((await ns.get('theme')) === 'dark', '插件命名空间应能读写');
assert((await BHChat.storage.get('bhchat.plugin.demo.theme')) === 'dark', '隔离 key 前缀应为 bhchat.plugin.{id}.');

BHChat.restart();
assert(electronAPI.restarted === 1, 'restart() 应调用 electronAPI.restartApp');

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
assert(!/pointer-keyset/.test(pluginSource), '房间背景设置不应再用 pointer-keyset 充当按钮');

const ttsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/plugins/channel-tts/index.js'),
  'utf8',
);
assert(/registerPanel/.test(ttsSource), 'TTS 设置应通过 registerPanel 挂到设置页');
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

const hookSource = fs.readFileSync(path.resolve(__dirname, '../../../runtime/webpack-hook.js'), 'utf8');
assert(/listPanels|registerPanel/.test(hookSource), '设置页应渲染已注册 panel');
assert(/立即重启|restart\(/.test(hookSource), '设置页应提供立即重启按钮');
assert(/bhchat-btn-primary/.test(hookSource) && /bhchat-switch/.test(hookSource), '设置页应区分主按钮与开关样式');
assert(!/pointer-keyset/.test(hookSource), '设置页不应再用 pointer-keyset 把按钮做成列表行');

console.log('OK: BHChat Phase 2 API / 插件启停 / watch / panel');
process.exit(0);
