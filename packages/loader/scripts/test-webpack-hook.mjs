/**
 * 回归：webpack-hook 不得在 UserConfig 工厂未就绪时 require(93509)，
 * 否则会把空模块写进 webpack 缓存，导致设置弹窗再也打不开。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/webpack-hook.js'),
  'utf8',
);

function createWebpackRuntime() {
  const modules = Object.create(null);
  const cache = Object.create(null);

  function __webpack_require__(id) {
    const key = String(id);
    if (cache[key] !== undefined) return cache[key].exports;
    const module = (cache[key] = { exports: {} });
    if (typeof modules[key] !== 'function') {
      throw new TypeError('__webpack_modules__[' + key + '] is not a function');
    }
    modules[key](module, module.exports, __webpack_require__);
    return module.exports;
  }
  __webpack_require__.m = modules;

  function installChunk(chunk) {
    const moreModules = chunk[1] || {};
    for (const id of Object.keys(moreModules)) {
      modules[String(id)] = moreModules[id];
    }
    if (typeof chunk[2] === 'function') {
      chunk[2](__webpack_require__);
    }
  }

  const chunks = [];
  chunks.push = function webpackPush() {
    for (let i = 0; i < arguments.length; i++) {
      installChunk(arguments[i]);
    }
    return Array.prototype.push.apply(this, arguments);
  };

  return { modules, cache, __webpack_require__, chunks };
}

function createVueUserConfigFactory() {
  const vueComponent = {
    name: 'UserConfig',
    options: { components: {}, methods: {} },
    cid: 42,
  };
  return function factory(_module, exports) {
    Object.defineProperty(exports, 'default', {
      enumerable: true,
      get() {
        return vueComponent;
      },
    });
  };
}

const runtime = createWebpackRuntime();
runtime.modules['42416'] = function settingsBlocks(_module, exports) {
  exports.Q4 = [{ key: 'private', label: '隐私设置' }, { key: 'audio', label: '语音' }];
};

const documentStub = {
  readyState: 'complete',
  addEventListener() {},
  getElementById() {
    return null;
  },
  createElement() {
    return { id: '', textContent: '' };
  },
  head: { appendChild() {} },
};

const sandbox = {
  console,
  document: documentStub,
  self: {},
  window: {},
  setInterval,
  setTimeout,
  clearInterval,
  clearTimeout,
};
sandbox.window = sandbox.self;
sandbox.self.webpackChunkheybox_chat = runtime.chunks;
sandbox.window.webpackChunkheybox_chat = runtime.chunks;
sandbox.window.document = documentStub;

vm.runInNewContext(hookSource, sandbox);

if (typeof sandbox.window.__bhchat_bootstrap_patch__ !== 'function') {
  throw new Error('webpack hook 未暴露 __bhchat_bootstrap_patch__');
}

sandbox.window.__bhchat_bootstrap_patch__();
sandbox.window.__bhchat_bootstrap_patch__();

if (runtime.cache['93509']) {
  throw new Error('FAIL: bootstrap 在 UserConfig 工厂未就绪时污染了 webpack 缓存');
}

const vueFactory = createVueUserConfigFactory();
runtime.chunks.push([
  [9691],
  {
    93509: vueFactory,
  },
]);

const userMod = runtime.__webpack_require__('93509');
const comp = userMod.default;

if (!comp || comp.name !== 'UserConfig' || comp.cid !== 42) {
  throw new Error('FAIL: require(93509).default 不再是原始 UserConfig，设置弹窗会打不开');
}

if (typeof userMod.default === 'function' && userMod.default.name === 'bhchatUserConfigDefault') {
  throw new Error('FAIL: 不应替换 UserConfig 的 default 导出');
}

const setting = comp.options.components.BetterHeyboxChatSetting;
if (!setting) {
  throw new Error('FAIL: BetterHeyboxChatSetting 未注册到 UserConfig.components');
}
if (typeof setting.render !== 'function') {
  throw new Error('FAIL: 运行时 Vue 无 template 编译器，必须提供 render');
}
if (setting.template) {
  throw new Error('FAIL: 不应使用 template 字符串');
}

if (!runtime.__webpack_require__('42416').Q4.some((item) => item.key === 'betterheyboxchat')) {
  throw new Error('FAIL: 设置侧栏未注入 BetterHeyboxChat');
}

function collectTexts(node, out) {
  const acc = out || [];
  if (node == null) return acc;
  if (typeof node === 'string' || typeof node === 'number') {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectTexts(child, acc));
    return acc;
  }
  if (node.children) collectTexts(node.children, acc);
  return acc;
}

function h(tag, data, children) {
  if (children === undefined && (typeof data === 'string' || Array.isArray(data))) {
    return { tag, data: undefined, children: data };
  }
  return { tag, data, children };
}

const settingCtx = {
  plugins: [],
  panels: [],
  restartStatus: '',
  devToolsEnabled: true,
  devToolsStatus: '',
  indicatorVisible: true,
  frameworkVersion: '0.1.0',
  pendingRestart: false,
  onRestart() {},
  onToggleDevTools() {},
  onOpenDevTools() {},
  onToggleIndicator() {},
};
const settingTree = setting.render.call(settingCtx, h);
const settingTexts = collectTexts(settingTree);
if (!settingTexts.includes('显示角标')) {
  throw new Error('FAIL: 设置页框架区未包含角标开关');
}

console.log('OK: webpack-hook 不再污染 UserConfig 缓存，组件已注册');
process.exit(0);
