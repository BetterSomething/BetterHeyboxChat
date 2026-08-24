/**
 * BetterHeyboxChat Webpack Hook（1.56.0）
 * 必须在 webpack 主包之前同步加载；并处理主包覆盖 push 的情况。
 */
(function () {
  'use strict';

  var PATCHED_MENU = '__bhchat_menu_patched';
  var PATCHED_CONFIG = '__bhchat_config_patched';
  var MENU_KEY = 'betterheyboxchat';
  var MENU_LABEL = 'BetterHeyboxChat';
  var COMPONENT_NAME = 'BetterHeyboxChatSetting';

  var MODULE_MAP = {
    SETTINGS_BLOCKS: '42416',
    USER_CONFIG: '93509',
    EVENT_BUS: '30570',
    VUEX_STORE: '16886',
  };

  window.__bhchat_module_map__ = MODULE_MAP;

  function hSwitch(h, on) {
    return h('span', { class: { 'bhchat-switch': true, on: !!on } }, [
      h('span', { class: 'bhchat-switch-core' }),
    ]);
  }

  function hBtn(h, text, kind, onClick, disabled) {
    return h(
      'button',
      {
        class: {
          'bhchat-btn': true,
          'bhchat-btn-primary': kind === 'primary',
          'bhchat-btn-secondary': kind === 'secondary',
          'bhchat-btn-danger': kind === 'danger',
          'is-disabled': !!disabled,
        },
        attrs: { type: 'button', disabled: !!disabled },
        on: { click: onClick || function () {} },
      },
      text,
    );
  }

  function safeHttpUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      var parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch (err) {
      return '';
    }
    return '';
  }

  function buildSettingsComponent() {
    return {
      name: COMPONENT_NAME,
      data: function () {
        return {
          plugins: [],
          panels: [],
          restartStatus: '',
          devToolsEnabled: true,
          devToolsStatus: '',
        };
      },
      computed: {
        frameworkVersion: function () {
          return (window.BHChat && window.BHChat.version) || '0.1.0';
        },
        pendingRestart: function () {
          return this.plugins.some(function (plugin) {
            return plugin.enabled !== plugin.loaded;
          });
        },
      },
      mounted: function () {
        this.refresh();
        this.refreshDevTools();
        if (window.BHChat && window.BHChat.on) {
          window.BHChat.on('panel-registered', this.refreshPanels);
          window.BHChat.on('plugin-enabled-changed', this.refreshPlugins);
        }
      },
      activated: function () {
        this.refresh();
        this.refreshDevTools();
      },
      beforeDestroy: function () {
        if (window.BHChat && window.BHChat.off) {
          window.BHChat.off('panel-registered', this.refreshPanels);
          window.BHChat.off('plugin-enabled-changed', this.refreshPlugins);
        }
      },
      methods: {
        refresh: function () {
          this.refreshPlugins();
          this.refreshPanels();
        },
        refreshPlugins: function () {
          this.plugins =
            (window.BHChat && window.BHChat.listPlugins && window.BHChat.listPlugins()) || [];
        },
        refreshPanels: function () {
          this.panels =
            (window.BHChat && window.BHChat.listPanels && window.BHChat.listPanels()) || [];
        },
        refreshDevTools: function () {
          var devtools = window.BHChat && window.BHChat.devtools;
          if (!devtools) {
            this.devToolsEnabled = false;
            this.devToolsStatus = '';
            return;
          }
          var self = this;
          Promise.resolve(devtools.isEnabled()).then(function (enabled) {
            self.devToolsEnabled = !!enabled;
          });
          Promise.resolve(devtools.getStatus()).then(function (status) {
            self.devToolsStatus = status || '';
          });
        },
        onTogglePlugin: function (plugin) {
          if (!window.BHChat || !window.BHChat.setPluginEnabled) return;
          var self = this;
          Promise.resolve(window.BHChat.setPluginEnabled(plugin.id, !plugin.enabled)).then(function () {
            self.refreshPlugins();
          });
        },
        onRestart: function () {
          var self = this;
          if (!window.BHChat || !window.BHChat.restart) {
            this.restartStatus = '重启接口不可用，请手动重启黑盒语音。';
            return;
          }
          this.restartStatus = '正在重启…';
          try {
            var result = window.BHChat.restart();
            Promise.resolve(result).catch(function () {
              self.restartStatus = '重启失败，请手动重启黑盒语音。';
            });
          } catch (err) {
            this.restartStatus = '重启失败，请手动重启黑盒语音。';
          }
        },
        onToggleDevTools: function () {
          var self = this;
          var devtools = window.BHChat && window.BHChat.devtools;
          if (!devtools) return;
          var next = !this.devToolsEnabled;
          this.devToolsStatus = '正在保存…';
          Promise.resolve(devtools.setEnabled(next)).then(function (result) {
            self.devToolsEnabled = !!result.enabled;
            self.devToolsStatus = result.message || '';
          });
        },
        onOpenDevTools: function () {
          var self = this;
          var devtools = window.BHChat && window.BHChat.devtools;
          if (!devtools) return;
          this.devToolsStatus = '正在尝试打开…';
          Promise.resolve(devtools.open()).then(function (result) {
            self.devToolsStatus = result.message || '';
          });
        },
      },
      render: function (h) {
        var self = this;
        var pluginRows = [];
        if (!this.plugins.length) {
          pluginRows.push(h('p', { class: 'bhchat-hint' }, '暂无插件。'));
        } else {
          this.plugins.forEach(function (plugin) {
            var pending = plugin.enabled !== plugin.loaded;
            var subParts = ['v' + plugin.version];
            if (plugin.author) subParts.push(plugin.author);
            if (pending) subParts.push('重启后生效');
            var subChildren = [h('span', subParts.join(' · '))];
            if (plugin.repository) {
              var repoUrl = safeHttpUrl(plugin.repository);
              if (repoUrl) {
              subChildren.push(
                h(
                  'a',
                  {
                    class: 'bhchat-link',
                    attrs: { href: repoUrl, target: '_blank' },
                    on: {
                      click: function (e) {
                        if (e && e.preventDefault) e.preventDefault();
                        if (e && e.stopPropagation) e.stopPropagation();
                        window.open(repoUrl, '_blank');
                      },
                    },
                  },
                  '仓库',
                ),
              );
              }
            }
            var rowText = [
              h('div', plugin.name),
              h('div', { class: 'bhchat-row-sub' }, subChildren),
            ];
            if (plugin.desc) {
              rowText.push(h('div', { class: 'bhchat-row-desc' }, plugin.desc));
            }
            pluginRows.push(
              h(
                'div',
                {
                  class: 'row bhchat-row-click',
                  on: {
                    click: function () {
                      self.onTogglePlugin(plugin);
                    },
                  },
                },
                [
                  h('div', { class: 'bhchat-row-text' }, rowText),
                  hSwitch(h, plugin.enabled),
                ],
              ),
            );
          });
        }

        var pluginChildren = [
          h('div', { class: 'cell-title' }, '已安装插件'),
          h('div', { class: 'bhchat-list' }, pluginRows),
          h('div', { class: 'bhchat-actions' }, [hBtn(h, '立即重启客户端', 'primary', this.onRestart)]),
        ];
        if (this.pendingRestart) {
          pluginChildren.push(h('p', { class: 'bhchat-hint' }, '插件开关已更改，重启后生效。'));
        }
        if (this.restartStatus) {
          pluginChildren.push(h('p', { class: 'bhchat-hint' }, this.restartStatus));
        }

        var panelNodes = this.panels.map(function (panel) {
          return h('div', { class: 'cell', key: panel.id }, [h(panel.component)]);
        });

        var dtChildren = [
          h('div', { class: 'cell-title' }, '开发者工具'),
          h('div', { class: 'bhchat-list' }, [
            h(
              'div',
              { class: 'row bhchat-row-click', on: { click: this.onToggleDevTools } },
              [h('span', '启用原生 DevTools'), hSwitch(h, this.devToolsEnabled)],
            ),
          ]),
          h('div', { class: 'bhchat-actions' }, [
            hBtn(h, '立即打开 DevTools', 'secondary', this.onOpenDevTools),
          ]),
        ];

        return h(
          'div',
          { class: 'block betterheyboxchat-setting-block' },
          [
            h('p', { class: 'title' }, 'BetterHeyboxChat'),
            h('div', { class: 'cell' }, [
              h('div', { class: 'cell-title' }, '框架'),
              h('div', { class: 'bhchat-list' }, [
                h('div', { class: 'row' }, [
                  h('span', '版本'),
                  h('span', { class: 'bhchat-row-value' }, this.frameworkVersion),
                ]),
                h('div', { class: 'row' }, [
                  h('span', '客户端'),
                  h(
                    'span',
                    { class: 'bhchat-row-value' },
                    (window.BHChat && window.BHChat.clientVersion) || 'unknown',
                  ),
                ]),
              ]),
            ]),
            h('div', { class: 'cell' }, pluginChildren),
          ]
            .concat(panelNodes)
            .concat([h('div', { class: 'cell' }, dtChildren)]),
        );
      },
    };
  }

  function injectNativeStyles() {
    if (document.getElementById('bhchat-native-settings-style')) return;
    var style = document.createElement('style');
    style.id = 'bhchat-native-settings-style';
    style.textContent = [
      '.cpt-layout-config-content .right-side .block.betterheyboxchat-setting-block .bhchat-list{border-radius:5px;overflow:hidden}',
      '.cpt-layout-config-content .right-side .block.betterheyboxchat-setting-block .bhchat-list .row{text-align:left}',
      '.cpt-layout-config-content .right-side .block.betterheyboxchat-setting-block .bhchat-list .row+.row{box-shadow:inset 0 1px 0 var(--opacity-1,rgba(255,255,255,.06))}',
      '.betterheyboxchat-setting-block .bhchat-row-click{cursor:pointer}',
      '.betterheyboxchat-setting-block .bhchat-row-click:hover{filter:brightness(1.08)}',
      '.betterheyboxchat-setting-block .bhchat-row-text{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;flex:1;padding-right:12px}',
      '.betterheyboxchat-setting-block .bhchat-row-sub{font-size:12px;line-height:16px;color:var(--text-3,#8b8e93);display:flex;align-items:center;flex-wrap:wrap;gap:6px}',
      '.betterheyboxchat-setting-block .bhchat-row-desc{font-size:12px;line-height:18px;color:var(--text-3,#8b8e93);white-space:pre-wrap;word-break:break-word}',
      '.betterheyboxchat-setting-block .bhchat-row-value{color:var(--text-3,#8b8e93);font-size:13px}',
      '.betterheyboxchat-setting-block .bhchat-link{color:var(--brand-text,#7dd95e);text-decoration:none;cursor:pointer}',
      '.betterheyboxchat-setting-block .bhchat-link:hover{text-decoration:underline}',
      '.betterheyboxchat-setting-block .bhchat-hint{color:var(--text-3,#8b8e93);font-size:12px;line-height:20px;letter-spacing:.04em;margin:0 0 8px}',
      '.betterheyboxchat-setting-block .bhchat-hint+.bhchat-list,.betterheyboxchat-setting-block .cell-title+.bhchat-list{margin-top:0}',
      '.betterheyboxchat-setting-block .bhchat-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0 4px}',
      '.betterheyboxchat-setting-block .bhchat-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 16px;border:none;border-radius:5px;font-family:inherit;font-size:14px;font-weight:700;line-height:18px;letter-spacing:.01em;cursor:pointer;user-select:none}',
      '.betterheyboxchat-setting-block .bhchat-btn-primary{background:var(--brand-fill,#2d7d46);color:#fff}',
      '.betterheyboxchat-setting-block .bhchat-btn-primary:hover{filter:brightness(1.08)}',
      '.betterheyboxchat-setting-block .bhchat-btn-secondary{background:var(--fill-button,#4f545c);color:var(--text-1,#f2f3f5)}',
      '.betterheyboxchat-setting-block .bhchat-btn-secondary:hover{filter:brightness(1.08)}',
      '.betterheyboxchat-setting-block .bhchat-btn-danger{background:var(--f-error-fill,#d83c3f);color:#fff}',
      '.betterheyboxchat-setting-block .bhchat-btn-danger:hover{filter:brightness(1.08)}',
      '.betterheyboxchat-setting-block .bhchat-btn.is-disabled,.betterheyboxchat-setting-block .bhchat-btn:disabled{opacity:.4;cursor:not-allowed;filter:none}',
      '.betterheyboxchat-setting-block .bhchat-switch{width:26px;height:16px;flex-shrink:0;display:inline-block;position:relative}',
      '.betterheyboxchat-setting-block .bhchat-switch-core{display:block;width:100%;height:100%;border-radius:11px;background:rgba(0,0,0,.28);position:relative;transition:background-color .2s}',
      '.betterheyboxchat-setting-block .bhchat-switch-core:after{content:"";position:absolute;width:12px;height:12px;top:2px;left:2px;border-radius:50%;background:var(--text-3,#8b8e93);transition:left .2s,background-color .2s}',
      '.betterheyboxchat-setting-block .bhchat-switch.on .bhchat-switch-core{background:var(--brand-text,#7dd95e)}',
      '.betterheyboxchat-setting-block .bhchat-switch.on .bhchat-switch-core:after{left:12px;background:#fff}',
      '.betterheyboxchat-setting-block .bhchat-field{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:8px 0}',
      '.betterheyboxchat-setting-block .bhchat-field-label{font-size:12px;line-height:20px;color:var(--text-3,#8b8e93)}',
      '.betterheyboxchat-setting-block .bhchat-native-input{width:100%;box-sizing:border-box;height:32px;padding:0 10px;border:none;border-radius:5px;background:var(--opacity-1,rgba(0,0,0,.2));color:var(--text-1,#f2f3f5);font-size:13px;outline:none}',
      '.betterheyboxchat-setting-block .bhchat-native-input:focus{box-shadow:0 0 0 1px var(--brand-text,#7dd95e)}',
      '.betterheyboxchat-setting-block .bhchat-native-input:disabled{opacity:.5}',
      '.betterheyboxchat-setting-block .bhchat-input-compact{width:80px;flex:none;text-align:center;padding:0 8px}',
      '.betterheyboxchat-setting-block .bhchat-file-row{display:flex;gap:8px;align-items:center}',
      '.betterheyboxchat-setting-block .bhchat-file-row .bhchat-native-input{flex:1;min-width:0}',
      '.betterheyboxchat-setting-block .bhchat-file-hidden{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}',
      '.betterheyboxchat-setting-block .bhchat-native-range{-webkit-appearance:none;appearance:none;flex:1;max-width:180px;height:4px;border-radius:2px;outline:none;cursor:pointer}',
      '.betterheyboxchat-setting-block .bhchat-native-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;border:none;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:pointer}',
      '.betterheyboxchat-setting-block .bhchat-native-range:disabled{opacity:.5;cursor:not-allowed}',
      '.betterheyboxchat-setting-block .bhchat-native-preview{height:120px;margin:8px 0;border-radius:8px;background:var(--opacity-1,rgba(0,0,0,.2)) center/cover no-repeat;border:1px solid var(--opacity-2,rgba(255,255,255,.08))}',
      '.betterheyboxchat-setting-block .bhchat-warn{color:var(--f-error-text,#f64e54);font-size:13px;line-height:20px;margin:0 0 8px}',
    ].join('');
    document.head.appendChild(style);
  }

  function patchSettingsBlocks(blocks) {
    if (!blocks || !Array.isArray(blocks) || blocks[PATCHED_MENU]) return false;

    var item = {
      key: MENU_KEY,
      label: MENU_LABEL,
      cpt: COMPONENT_NAME,
    };

    var audioIdx = -1;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].key === 'audio') {
        audioIdx = i;
        break;
      }
    }

    blocks.splice(audioIdx >= 0 ? audioIdx : blocks.length, 0, item);
    blocks[PATCHED_MENU] = true;
    console.log('[BetterHeyboxChat] settings menu item injected');
    return true;
  }

  function getVueComponent(exports) {
    if (!exports) return null;
    var exp = exports.default || exports.A || exports;
    if (!exp) return null;
    if (exp.options || exp.cid !== undefined || exp.render || typeof exp === 'object') {
      return exp;
    }
    return null;
  }

  function registerGlobalVueComponent(definition) {
    try {
      var app = document.getElementById && document.getElementById('app');
      var vue = app && app.__vue__;
      var Vue = vue && ((vue.$root && vue.$root.constructor) || vue.constructor);
      if (Vue && Vue.component && !(Vue.options && Vue.options.components && Vue.options.components[COMPONENT_NAME])) {
        Vue.component(COMPONENT_NAME, definition);
      }
    } catch (err) {
      /* ignore */
    }
  }

  function applyUserConfigPatch(comp) {
    if (!comp || comp[PATCHED_CONFIG]) return false;

    var target = comp.options || comp;
    target.components = target.components || {};
    var definition = buildSettingsComponent();
    target.components[COMPONENT_NAME] = definition;
    registerGlobalVueComponent(definition);

    comp[PATCHED_CONFIG] = true;
    injectNativeStyles();
    console.log('[BetterHeyboxChat] UserConfig component registered');
    return true;
  }

  function patchUserConfig(exports) {
    if (!exports || exports[PATCHED_CONFIG]) return false;

    var comp = getVueComponent(exports);
    if (!comp) return false;
    if (!applyUserConfigPatch(comp)) return false;

    exports[PATCHED_CONFIG] = true;
    return true;
  }

  function moduleFactoryReady(requireFn, id) {
    if (!requireFn || !requireFn.m) return false;
    return typeof requireFn.m[id] === 'function' || typeof requireFn.m[String(id)] === 'function';
  }

  function applyKnownPatches(requireFn) {
    if (!requireFn) return;
    try {
      var mod = requireFn(MODULE_MAP.SETTINGS_BLOCKS);
      if (mod && mod.Q4) patchSettingsBlocks(mod.Q4);
    } catch (err) {
      console.warn('[BetterHeyboxChat] bootstrap Q4 patch failed:', err);
    }
    try {
      if (moduleFactoryReady(requireFn, MODULE_MAP.USER_CONFIG)) {
        var userMod = requireFn(MODULE_MAP.USER_CONFIG);
        if (userMod) patchUserConfig(userMod);
      }
    } catch (err) {
      console.warn('[BetterHeyboxChat] bootstrap UserConfig patch failed:', err);
    }
  }

  function onModuleLoaded(id, exports) {
    if (id === MODULE_MAP.SETTINGS_BLOCKS) {
      var blocks = exports.Q4;
      if (blocks) return patchSettingsBlocks(blocks);
    }
    if (id === MODULE_MAP.USER_CONFIG) {
      return patchUserConfig(exports);
    }
    return false;
  }

  function wrapFactory(id, factory) {
    return function (module, exports, require) {
      if (!window.__bhchat_require__) window.__bhchat_require__ = require;
      factory(module, exports, require);
      try {
        onModuleLoaded(String(id), exports);
      } catch (err) {
        console.error('[BetterHeyboxChat] module patch failed:', id, err);
      }
    };
  }

  function processChunk(chunk) {
    if (!chunk || !chunk[1]) return;
    var modules = chunk[1];
    var ids = [MODULE_MAP.SETTINGS_BLOCKS, MODULE_MAP.USER_CONFIG];

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (modules[id] && !modules[id].__bhchat_wrapped) {
        modules[id] = wrapFactory(id, modules[id]);
        modules[id].__bhchat_wrapped = true;
      }
    }
  }

  function wrapPush(originalPush) {
    var wrapped = function () {
      for (var i = 0; i < arguments.length; i++) {
        processChunk(arguments[i]);
      }
      return originalPush.apply(this, arguments);
    };
    wrapped.__bhchat_wrapped = true;
    return wrapped;
  }

  function installPushHook() {
    var chunks = (self.webpackChunkheybox_chat = self.webpackChunkheybox_chat || []);
    if (chunks.push && chunks.push.__bhchat_wrapped) return;
    chunks.push = wrapPush(chunks.push.bind(chunks));
  }

  function bootstrapPatch() {
    if (window.__bhchat_require__) {
      applyKnownPatches(window.__bhchat_require__);
      return;
    }

    var chunks = self.webpackChunkheybox_chat;
    if (!chunks || typeof chunks.push !== 'function') return;

    try {
      chunks.push([
        ['betterheyboxchat-bootstrap'],
        {},
        function (__webpack_require__) {
          window.__bhchat_require__ = __webpack_require__;
          applyKnownPatches(__webpack_require__);
        },
      ]);
      if (!window.__bhchat_settings_bootstrapped__) {
        window.__bhchat_settings_bootstrapped__ = true;
        console.log('[BetterHeyboxChat] settings bootstrap pushed');
      }
    } catch (err) {
      console.warn('[BetterHeyboxChat] bootstrap push failed:', err);
    }
  }

  window.__bhchat_bootstrap_patch__ = bootstrapPatch;

  // 1) 抢先 hook push
  installPushHook();

  // 2) 处理 hook 安装前已入队的 chunk
  var chunks = self.webpackChunkheybox_chat || [];
  for (var j = 0; j < chunks.length; j++) {
    processChunk(chunks[j]);
  }

  // 3) 主包会覆盖 push — 持续重新 hook（懒加载 chunk 仍需要）
  setInterval(installPushHook, 500);

  // 4) 主包就绪后通过 bootstrap chunk 直接 patch Q4
  function scheduleBootstrap() {
    bootstrapPatch();
    setTimeout(bootstrapPatch, 100);
    setTimeout(bootstrapPatch, 500);
    setTimeout(bootstrapPatch, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBootstrap);
  } else {
    scheduleBootstrap();
  }

  function getVueCtor() {
    var app = document.getElementById && document.getElementById('app');
    var vue = app && app.__vue__;
    if (!vue) return null;
    return (vue.$root && vue.$root.constructor) || vue.constructor;
  }

  function mountSettingsFallback() {
    var root = document.querySelector('.cpt-layout-config-content');
    if (!root) return;
    var active = root.querySelector('.left-side .row.active span');
    if (!active || (active.textContent || '').trim() !== MENU_LABEL) return;
    var host = root.querySelector('.config-content-wrapper') || root.querySelector('.right-side .scroll-wrapper');
    if (!host || host.querySelector('.betterheyboxchat-setting-block')) return;
    var Vue = getVueCtor();
    if (!Vue) return;
    var mountPoint = document.createElement('div');
    host.appendChild(mountPoint);
    try {
      new Vue(buildSettingsComponent()).$mount(mountPoint);
      injectNativeStyles();
      console.log('[BetterHeyboxChat] settings panel mounted via fallback');
    } catch (err) {
      console.warn('[BetterHeyboxChat] settings fallback mount failed:', err);
    }
  }

  setInterval(mountSettingsFallback, 400);

  window.__bhchat_webpack_hook__ = true;
  console.log('[BetterHeyboxChat] webpack hook installed');
})();
