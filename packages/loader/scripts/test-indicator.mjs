/**
 * 右下角标：文案 BHC vx.x.x、字号 8px、可开关并持久化。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indicatorSource = fs.readFileSync(
  path.resolve(__dirname, '../../../runtime/indicator.js'),
  'utf8',
);

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

function createDocument() {
  const byId = new Map();
  const created = [];

  function createElement() {
    const el = {
      id: '',
      textContent: '',
      title: '',
      style: { display: '' },
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
    };
    const idDesc = Object.getOwnPropertyDescriptor(el, 'id');
    Object.defineProperty(el, 'id', {
      get() {
        return idDesc.get ? idDesc.get.call(this) : this._id || '';
      },
      set(value) {
        this._id = value;
        if (value) byId.set(value, el);
      },
      enumerable: true,
      configurable: true,
    });
    el._id = '';
    created.push(el);
    return el;
  }

  return {
    created,
    byId,
    document: {
      body: {},
      getElementById(id) {
        return byId.get(id) || null;
      },
      createElement,
      head: { appendChild() {} },
      documentElement: {
        appendChild(el) {
          if (el.id) byId.set(el.id, el);
        },
      },
      addEventListener() {},
    },
  };
}

function loadIndicator(opts) {
  const options = opts || {};
  const storage = new Map();
  if (Object.prototype.hasOwnProperty.call(options, 'storedVisible')) {
    storage.set('bhchat.indicator.visible', JSON.stringify(options.storedVisible));
  }

  const dom = createDocument();
  const bhchat = {
    version: options.version || '0.1.0',
    onReady(cb) {
      if (typeof cb === 'function') cb();
    },
  };

  const sandbox = {
    console,
    document: dom.document,
    window: {
      BHChat: options.withBhChat === false ? undefined : bhchat,
      BHChatStorage: {
        get(key) {
          return Promise.resolve(storage.has(key) ? JSON.parse(storage.get(key)) : null);
        },
        set(key, value) {
          storage.set(key, JSON.stringify(value));
          return Promise.resolve();
        },
        del(key) {
          storage.delete(key);
          return Promise.resolve();
        },
      },
    },
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
  };
  sandbox.window.document = dom.document;
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(indicatorSource, sandbox);
  return { sandbox, bhchat, storage, dom };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const shown = loadIndicator({});
const badge = shown.dom.byId.get('bhchat-indicator');
assert(badge, '应挂上 #bhchat-indicator');
assert(badge.textContent === 'BHC v0.1.0', '默认文案应为 BHC v' + shown.bhchat.version + '，实际: ' + badge.textContent);

const styleEl = shown.dom.created.find((el) => el.attrs['data-bhchat'] === 'indicator');
assert(styleEl, '应注入角标样式');
assert(/font:\s*8px\b/.test(styleEl.textContent), '字号应为 8px，实际: ' + styleEl.textContent);
assert(badge.style.display !== 'none', '默认应显示角标');

assert(shown.sandbox.window.BHChat.indicator, '应挂上 BHChat.indicator');
assert(shown.sandbox.window.BHChat.indicator.isVisible() === true, 'isVisible 默认 true');

await shown.sandbox.window.BHChat.indicator.setVisible(false);
assert(badge.style.display === 'none', '关闭后应隐藏');
assert(shown.sandbox.window.BHChat.indicator.isVisible() === false, '关闭后 isVisible 为 false');
assert(JSON.parse(shown.storage.get('bhchat.indicator.visible')) === false, '关闭后应写入 storage');

await shown.sandbox.window.BHChat.indicator.setVisible(true);
assert(badge.style.display !== 'none', '重新打开后应显示');
assert(JSON.parse(shown.storage.get('bhchat.indicator.visible')) === true, '打开后应写入 storage');

const custom = loadIndicator({ version: '1.2.3' });
assert(
  custom.dom.byId.get('bhchat-indicator').textContent === 'BHC v1.2.3',
  '文案应跟随 BHChat.version',
);

const sha = loadIndicator({ version: 'c357f16' });
assert(
  sha.dom.byId.get('bhchat-indicator').textContent === 'BHC c357f16',
  'dev 短 SHA 不应再套一层 v，实际: ' + sha.dom.byId.get('bhchat-indicator').textContent,
);

const bare = loadIndicator({ withBhChat: false });
assert(
  bare.dom.byId.get('bhchat-indicator').textContent === 'BHC dev',
  '没有 BHChat 时应回退 BHC dev，实际: ' + bare.dom.byId.get('bhchat-indicator').textContent,
);

const hidden = loadIndicator({ storedVisible: false });
await flush();
await flush();
assert(hidden.dom.byId.get('bhchat-indicator').style.display === 'none', 'storage 为 false 时应隐藏');
assert(hidden.sandbox.window.BHChat.indicator.isVisible() === false, '从 storage 恢复后 isVisible 为 false');

console.log('OK: indicator 文案 / 字号 / 开关持久化');
process.exit(0);
