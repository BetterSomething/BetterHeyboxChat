/**
 * 屏蔽客户端更新：拦截官方 updateClient / updateAsarResource / setAsarVersion，
 * 并把开关写到 betterheyboxchat/update-block.json，供 main-bridge 在主进程拦截 IPC。
 * 不伪造更新协议、不改 bytenode。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'block-update';
  var STORAGE_KEY = 'settings';

  var DEFAULTS = {
    blockClient: true,
    blockHotfix: true,
  };

  var settings = {
    blockClient: DEFAULTS.blockClient,
    blockHotfix: DEFAULTS.blockHotfix,
  };

  var storeNs = null;
  var lastStatus = '等待挂接…';
  var origUpdateClient = null;
  var origUpdateAsar = null;
  var origSetAsarVersion = null;
  var hooked = false;

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) {
      settings = { blockClient: DEFAULTS.blockClient, blockHotfix: DEFAULTS.blockHotfix };
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      settings = {
        blockClient: saved.blockClient !== false,
        blockHotfix: saved.blockHotfix !== false,
      };
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      blockClient: !!settings.blockClient,
      blockHotfix: !!settings.blockHotfix,
    });
  }

  function writeFlags() {
    if (window.bhchatPreload && window.bhchatPreload.updateBlock) {
      return window.bhchatPreload.updateBlock.set({
        client: !!settings.blockClient,
        hotfix: !!settings.blockHotfix,
      });
    }
    return { client: !!settings.blockClient, hotfix: !!settings.blockHotfix };
  }

  function describePatch(info) {
    if (!info) return '尚未拿到补丁状态（需 Debug 安装器重装后由 main-bridge 写入）';
    var repaired = info.repaired || [];
    var intact = info.intact || [];
    var missing = info.missing || [];
    if (repaired.length) return '本轮已补回：' + repaired.join('、');
    if (missing.length) return '缺失：' + missing.join('、') + '，请用安装器重装';
    if (intact.length) return '补丁完整（' + intact.join('、') + '）';
    return '补丁状态未知';
  }

  function refreshStatus() {
    var info = window.BHChat && window.BHChat.patch ? window.BHChat.patch.getStatus() : null;
    lastStatus =
      (settings.blockClient ? '完整更新：已屏蔽' : '完整更新：放行') +
      '；' +
      (settings.blockHotfix ? '热更新：已屏蔽' : '热更新：放行') +
      '。' +
      describePatch(info);
    return lastStatus;
  }

  function pluginActive() {
    return !(window.BHChat && window.BHChat.isPluginEnabled) || window.BHChat.isPluginEnabled(PLUGIN_ID);
  }

  function wrapElectronApi() {
    var api = window.electronAPI;
    if (!api || hooked) return !!api;
    if (typeof api.updateClient === 'function' && !api.updateClient.__bhchat_block) {
      origUpdateClient = api.updateClient.bind(api);
      api.updateClient = function (payload) {
        if (pluginActive() && settings.blockClient) {
          lastStatus = '已拦截完整客户端更新';
          return;
        }
        return origUpdateClient(payload);
      };
      api.updateClient.__bhchat_block = true;
    }
    if (typeof api.updateAsarResource === 'function' && !api.updateAsarResource.__bhchat_block) {
      origUpdateAsar = api.updateAsarResource.bind(api);
      api.updateAsarResource = function (version, downloadUrl, manifest, callback) {
        if (pluginActive() && settings.blockHotfix) {
          lastStatus = '已拦截热更新 updateAsarResource';
          if (typeof callback === 'function') callback('error', { message: lastStatus });
          return;
        }
        return origUpdateAsar(version, downloadUrl, manifest, callback);
      };
      api.updateAsarResource.__bhchat_block = true;
    }
    if (typeof api.setAsarVersion === 'function' && !api.setAsarVersion.__bhchat_block) {
      origSetAsarVersion = api.setAsarVersion.bind(api);
      api.setAsarVersion = function (version, relaunchApp) {
        if (pluginActive() && settings.blockHotfix) {
          lastStatus = '已拦截 setAsarVersion';
          return;
        }
        return origSetAsarVersion(version, relaunchApp);
      };
      api.setAsarVersion.__bhchat_block = true;
    }
    hooked = !!(api.updateClient && api.updateClient.__bhchat_block);
    return hooked;
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.blockUpdate = {
      getSettings: function () {
        return {
          blockClient: !!settings.blockClient,
          blockHotfix: !!settings.blockHotfix,
        };
      },
      getStatus: function () {
        return refreshStatus();
      },
      ensurePatch: function () {
        if (window.BHChat.patch && window.BHChat.patch.ensure) {
          return window.BHChat.patch.ensure();
        }
        return null;
      },
    };
  }

  function persist() {
    return saveSettings().then(function () {
      writeFlags();
      refreshStatus();
    });
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatBlockUpdatePanel',
      data: function () {
        return {
          blockClient: settings.blockClient,
          blockHotfix: settings.blockHotfix,
          status: lastStatus,
        };
      },
      mounted: function () {
        var self = this;
        this.syncFromPlugin();
        this._timer = setInterval(function () {
          self.status = lastStatus;
        }, 800);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        syncFromPlugin: function () {
          this.blockClient = settings.blockClient;
          this.blockHotfix = settings.blockHotfix;
          this.status = refreshStatus();
        },
        persist: function () {
          settings.blockClient = !!this.blockClient;
          settings.blockHotfix = !!this.blockHotfix;
          persist();
          this.status = lastStatus;
        },
        onToggleClient: function () {
          this.blockClient = !this.blockClient;
          this.persist();
        },
        onToggleHotfix: function () {
          this.blockHotfix = !this.blockHotfix;
          this.persist();
        },
        onEnsure: function () {
          var info =
            window.BHChat && window.BHChat.patch && window.BHChat.patch.ensure
              ? window.BHChat.patch.ensure()
              : null;
          this.status = describePatch(info);
          lastStatus = this.status;
        },
      },
      render: function (h) {
        function rowSwitch(label, on, onClick) {
          return h('div', { class: 'bhchat-list' }, [
            h('div', { class: 'row' }, [
              h('div', { class: 'bhchat-row-main' }, [h('div', { class: 'bhchat-row-title' }, label)]),
              h(
                'button',
                {
                  class: { 'bhchat-switch': true, on: on },
                  attrs: { type: 'button', 'aria-checked': on ? 'true' : 'false' },
                  on: { click: onClick },
                },
                [h('span', { class: 'bhchat-switch-knob' })],
              ),
            ]),
          ]);
        }
        return h('div', { class: 'bhchat-block' }, [
          rowSwitch('屏蔽完整客户端更新', this.blockClient, this.onToggleClient),
          rowSwitch('屏蔽热更新', this.blockHotfix, this.onToggleHotfix),
          h(
            'button',
            {
              class: { 'bhchat-btn': true, 'bhchat-btn-primary': true },
              attrs: { type: 'button' },
              on: { click: this.onEnsure },
            },
            '立即检查并修复补丁',
          ),
          h('div', { class: 'bhchat-hint' }, this.status || ''),
        ]);
      },
    };
  }

  function activate() {
    loadSettings().then(function () {
      writeFlags();
      wrapElectronApi();
      refreshStatus();
      registerApi();
      if (window.BHChat && window.BHChat.registerPanel) {
        window.BHChat.registerPanel({
          id: PLUGIN_ID,
          title: '屏蔽客户端更新',
          component: buildPanelComponent(),
        });
      }
      if (window.BHChat && window.BHChat.onClientUpdate) {
        window.BHChat.onClientUpdate(function () {
          refreshStatus();
        });
      }
    });
  }

  if (window.BHChat && window.BHChat.onReady) {
    window.BHChat.onReady(activate);
  } else {
    activate();
  }
})();
