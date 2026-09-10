/**
 * BetterHeyboxChat 渲染进程运行时（Phase 2）
 */
(function () {
  'use strict';

  var KNOWN_STATE_KEYS = [
    'cur_room_data',
    'room_list',
    'all_notify_settings',
    'cur_roles_list',
    'show_friend_sidebar',
  ];
  var ENABLED_STORAGE_KEY = 'bhchat.plugins.enabled';

  var readyCallbacks = [];
  var clientUpdateCallbacks = [];
  var lastClientUpdate = null;
  var plugins = {};
  var panels = [];
  var eventBus = {};
  var enabledOverrides = {};

  function injectCSS(css) {
    var style = document.createElement('style');
    style.setAttribute('data-bhchat', 'injected');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

  function injectStyleUrl(url) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-bhchat', 'injected');
    document.head.appendChild(link);
    return link;
  }

  function getAppVue() {
    var app = document.getElementById('app');
    return (app && app.__vue__) || null;
  }

  function getVue() {
    var vue = getAppVue();
    if (!vue) return null;
    return (vue.$root && vue.$root.constructor) || vue.constructor || null;
  }

  function getStore() {
    var vue = getAppVue();
    return (vue && vue.$store) || null;
  }

  function readStateKey(store, key) {
    if (store.getters && store.getters[key] !== undefined) return store.getters[key];
    if (store.state && store.state[key] !== undefined) return store.state[key];
    return undefined;
  }

  function mapState(keys) {
    var store = getStore();
    if (!store) return {};
    var list = keys && keys.length ? keys : KNOWN_STATE_KEYS;
    var result = {};
    for (var i = 0; i < list.length; i++) {
      var key = list[i];
      var value = readStateKey(store, key);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  function watch(getter, callback) {
    if (typeof getter !== 'function' || typeof callback !== 'function') {
      return function noop() {};
    }
    var store = getStore();
    if (store && typeof store.watch === 'function') {
      return store.watch(getter, callback);
    }
    var last = getter();
    var timer = setInterval(function () {
      var next = getter();
      if (next !== last) {
        var prev = last;
        last = next;
        try {
          callback(next, prev);
        } catch (err) {
          console.error('[BetterHeyboxChat] watch error:', err);
        }
      }
    }, 500);
    return function unwatch() {
      clearInterval(timer);
    };
  }

  function getBackingStorage() {
    return window.BHChatStorage || null;
  }

  function createNamespacedStorage(pluginId) {
    var prefix = 'bhchat.plugin.' + pluginId + '.';
    return {
      get: function (key) {
        var storage = getBackingStorage();
        return storage ? storage.get(prefix + key) : Promise.resolve(null);
      },
      set: function (key, value) {
        var storage = getBackingStorage();
        return storage ? storage.set(prefix + key, value) : Promise.resolve();
      },
      del: function (key) {
        var storage = getBackingStorage();
        return storage ? storage.del(prefix + key) : Promise.resolve();
      },
    };
  }

  var storageApi = {
    get: function (key) {
      var storage = getBackingStorage();
      return storage ? storage.get(key) : Promise.resolve(null);
    },
    set: function (key, value) {
      var storage = getBackingStorage();
      return storage ? storage.set(key, value) : Promise.resolve();
    },
    del: function (key) {
      var storage = getBackingStorage();
      return storage ? storage.del(key) : Promise.resolve();
    },
    ns: createNamespacedStorage,
  };

  function isPluginEnabled(id) {
    if (Object.prototype.hasOwnProperty.call(enabledOverrides, id)) {
      return !!enabledOverrides[id];
    }
    var plugin = plugins[id];
    if (plugin && plugin.enabledDefault === false) return false;
    return true;
  }

  function registerPluginRecord(manifest, loaded) {
    if (!manifest || !manifest.id) return;
    var prev = plugins[manifest.id] || {};
    plugins[manifest.id] = {
      id: manifest.id,
      name: manifest.name || manifest.id,
      version: manifest.version || '0.0.0',
      author: manifest.author || prev.author || '',
      repository: manifest.repository || prev.repository || '',
      desc: manifest.desc || prev.desc || '',
      source: manifest.source || prev.source || 'bundled',
      entry: manifest.entry || 'index.js',
      minClientVersion: manifest.minClientVersion,
      enabledDefault: manifest.enabled !== false,
      loaded: loaded != null ? !!loaded : !!prev.loaded,
    };
  }

  function listPlugins() {
    return Object.keys(plugins).map(function (id) {
      var plugin = plugins[id];
      return {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        author: plugin.author || '',
        repository: plugin.repository || '',
        desc: plugin.desc || '',
        source: plugin.source || 'bundled',
        entry: plugin.entry,
        minClientVersion: plugin.minClientVersion,
        enabled: isPluginEnabled(id),
        loaded: !!plugin.loaded,
      };
    });
  }

  function persistEnabledMap() {
    return storageApi.set(ENABLED_STORAGE_KEY, enabledOverrides);
  }

  function loadEnabledMap() {
    return storageApi.get(ENABLED_STORAGE_KEY).then(function (saved) {
      if (saved && typeof saved === 'object') {
        enabledOverrides = saved;
      }
      return enabledOverrides;
    });
  }

  function syncBlockFlagsIfDisabled() {
    if (isPluginEnabled('block-update')) return;
    if (window.bhchatPreload && window.bhchatPreload.updateBlock) {
      window.bhchatPreload.updateBlock.set({ client: false, hotfix: false });
    }
  }

  function syncPerfFlagsIfDisabled() {
    if (isPluginEnabled('perf-tune')) return;
    if (window.bhchatPreload && window.bhchatPreload.perf && window.bhchatPreload.perf.setConfig) {
      return window.bhchatPreload.perf.setConfig({ enabled: false });
    }
  }

  function notifyClientUpdate(info) {
    lastClientUpdate = info || lastClientUpdate;
    if (!lastClientUpdate) return lastClientUpdate;
    clientUpdateCallbacks.forEach(function (cb) {
      try {
        cb(lastClientUpdate);
      } catch (err) {
        console.error('[BetterHeyboxChat] onClientUpdate error:', err);
      }
    });
    if (window.BHChat && window.BHChat.emit) {
      window.BHChat.emit('client-update', lastClientUpdate);
    }
    return lastClientUpdate;
  }

  function setPluginEnabled(id, enabled) {
    enabledOverrides[id] = !!enabled;
    return persistEnabledMap().then(function () {
      if (id === 'block-update' && !enabled) {
        syncBlockFlagsIfDisabled();
      }
      if (id === 'perf-tune' && !enabled) {
        syncPerfFlagsIfDisabled();
      }
      if (window.BHChat) {
        window.BHChat.emit('plugin-enabled-changed', { id: id, enabled: !!enabled });
      }
      return { id: id, enabled: !!enabled, restartRequired: true };
    });
  }

  function registerPanel(panel) {
    if (!panel || !panel.id || !panel.component || typeof panel.component.render !== 'function') {
      console.warn('[BetterHeyboxChat] registerPanel 需要 id 与 component.render(h)');
      return false;
    }
    panels = panels.filter(function (item) {
      return item.id !== panel.id;
    });
    panels.push({
      id: panel.id,
      title: panel.title || panel.id,
      component: panel.component,
    });
    if (window.BHChat) {
      window.BHChat.emit('panel-registered', panel.id);
    }
    return true;
  }

  function listPanels() {
    return panels.slice();
  }

  function restart() {
    if (window.electronAPI && typeof window.electronAPI.restartApp === 'function') {
      return window.electronAPI.restartApp();
    }
    return Promise.reject(new Error('electronAPI.restartApp 不可用'));
  }

  function callPluginStore(method, arg) {
    var api = window.bhchatPreload && window.bhchatPreload.plugins;
    if (!api || typeof api[method] !== 'function') {
      return { ok: false, error: 'preload 插件接口不可用' };
    }
    return api[method](arg);
  }

  function callPreloadNs(ns, method, arg) {
    var api = window.bhchatPreload && window.bhchatPreload[ns];
    if (!api || typeof api[method] !== 'function') {
      return Promise.resolve(null);
    }
    return api[method](arg);
  }

  var UPDATE_STORAGE_KEY = 'bhchat.update';
  var lastSelfUpdate = null;

  function defaultUpdateChannel() {
    return window.BHChat && window.BHChat.channel === 'release' ? 'release' : 'dev';
  }

  function loadUpdateSettings() {
    return storageApi.get(UPDATE_STORAGE_KEY).then(function (saved) {
      var mode = saved && (saved.mode === 'quiet' || saved.mode === 'auto') ? saved.mode : 'notify';
      var channel =
        saved && saved.channel === 'release'
          ? 'release'
          : saved && saved.channel === 'dev'
            ? 'dev'
            : defaultUpdateChannel();
      var ignored =
        saved && saved.ignored && saved.ignored.version
          ? { channel: String(saved.ignored.channel || ''), version: String(saved.ignored.version) }
          : null;
      return { mode: mode, channel: channel, ignored: ignored };
    });
  }

  function saveUpdateSettings(next) {
    return storageApi.set(UPDATE_STORAGE_KEY, {
      mode: next.mode || 'notify',
      channel: next.channel === 'release' ? 'release' : 'dev',
      ignored: next.ignored || null,
    });
  }

  function loadUpdateMirror() {
    return storageApi.ns('marketplace').get('settings').then(function (saved) {
      var mirror = saved && typeof saved.mirror === 'string' ? saved.mirror.trim() : '';
      return mirror || 'https://gh.qmqaq.top/';
    });
  }

  function isSessionBusy() {
    try {
      var rtc = window.$rtc;
      if (rtc && rtc.clientData && rtc.clientData.channel_id) return true;
    } catch (err) {}
    try {
      var store = getStore();
      if (store && store.state && Number(store.state.rtc_connection) === 1) return true;
    } catch (err) {}
    try {
      if (document.querySelector('.bhchat-ss-track')) return true;
    } catch (err) {}
    return false;
  }

  function localUpdateBuild() {
    return {
      version: (window.BHChat && window.BHChat.version) || 'dev',
      channel: (window.BHChat && window.BHChat.channel) || 'dev',
      commit: (window.BHChat && window.BHChat.commit) || 'unknown',
    };
  }

  function updateApi() {
    return window.bhchatPreload && window.bhchatPreload.update;
  }

  function decideUpdateAction(result, manual) {
    if (!result.ok || !result.available || result.ignored) return 'none';
    if (result.mode === 'auto' && !result.busy && !manual) return 'auto';
    if (manual && result.available && !result.ignored) return 'dialog';
    if (!manual && (result.mode === 'notify' || (result.mode === 'auto' && result.busy))) {
      return 'dialog';
    }
    return 'none';
  }

  function checkSelfUpdate(opts) {
    opts = opts || {};
    var manual = !!opts.manual;
    var api = updateApi();
    if (!api || typeof api.fetchManifest !== 'function') {
      var missing = {
        ok: false,
        error: '更新模块未就绪',
        available: false,
        ignored: false,
        busy: false,
        mode: 'notify',
        local: localUpdateBuild(),
        remote: null,
        action: 'none',
      };
      lastSelfUpdate = missing;
      return Promise.resolve(missing);
    }
    return Promise.all([loadUpdateSettings(), loadUpdateMirror()]).then(function (pair) {
      var settings = pair[0];
      var mirror = pair[1];
      var local = localUpdateBuild();
      var track = settings.channel === 'release' ? 'release' : 'dev';
      var compareLocal = {
        version: local.version,
        commit: local.commit,
        channel: track,
      };
      return api.fetchManifest({ channel: track, mirror: mirror }).then(function (fetched) {
        if (!fetched || !fetched.ok) {
          var fail = {
            ok: false,
            error: (fetched && fetched.error) || '检查更新失败',
            available: false,
            ignored: false,
            busy: isSessionBusy(),
            mode: settings.mode,
            channel: track,
            local: local,
            remote: null,
            mirror: mirror,
            action: 'none',
          };
          lastSelfUpdate = fail;
          if (window.BHChat && window.BHChat.emit) window.BHChat.emit('self-update', fail);
          return fail;
        }
        var remote = fetched.manifest;
        var result = {
          ok: true,
          error: '',
          available: !!api.hasUpdate(compareLocal, remote),
          ignored: false,
          busy: isSessionBusy(),
          mode: settings.mode,
          channel: track,
          local: local,
          remote: remote,
          mirror: mirror,
          action: 'none',
        };
        result.ignored = !!(result.available && api.isIgnored(settings.ignored, remote));
        result.action = decideUpdateAction(result, manual);
        lastSelfUpdate = result;
        if (window.BHChat && window.BHChat.emit) window.BHChat.emit('self-update', result);
        if (result.action === 'auto') {
          applySelfUpdate(remote).catch(function (err) {
            result.action = 'dialog';
            result.error = (err && err.message) || String(err);
            lastSelfUpdate = result;
            if (window.BHChat && window.BHChat.emit) window.BHChat.emit('self-update', result);
          });
        }
        return result;
      });
    });
  }

  function applySelfUpdate(remote) {
    var api = updateApi();
    if (!api || !remote) {
      return Promise.reject(new Error('更新模块未就绪'));
    }
    return loadUpdateMirror().then(function (mirror) {
      function emitProgress(progress) {
        if (window.BHChat && window.BHChat.emit && progress) {
          window.BHChat.emit('self-update-progress', progress);
        }
      }
      var timer = setInterval(function () {
        if (api.lastProgress) emitProgress(api.lastProgress());
      }, 150);
      return Promise.resolve(
        api.downloadInstaller({
          manifest: remote,
          mirror: mirror,
        }),
      )
        .then(function (exePath) {
          api.cleanupOldInstallers(remote.artifact);
          api.launchInstaller(exePath, api.resolveInstallRoot());
          return { ok: true, launched: true };
        })
        .then(
          function (result) {
            clearInterval(timer);
            return result;
          },
          function (err) {
            clearInterval(timer);
            throw err;
          },
        );
    });
  }

  function ignoreSelfUpdate(remote) {
    return loadUpdateSettings().then(function (settings) {
      settings.ignored = remote
        ? { channel: remote.channel, version: remote.version }
        : null;
      return saveUpdateSettings(settings);
    });
  }

  var build =
    typeof BHC_BUILD !== 'undefined' && BHC_BUILD
      ? BHC_BUILD
      : { version: 'dev', channel: 'dev', commit: 'unknown' };

  window.BHChat = {
    version: build.version || 'dev',
    channel: build.channel || 'dev',
    commit: build.commit || 'unknown',
    clientVersion: window.asar_version || 'unknown',

    onReady: function (cb) {
      if (typeof cb === 'function') readyCallbacks.push(cb);
    },

    onClientUpdate: function (cb) {
      if (typeof cb !== 'function') return;
      clientUpdateCallbacks.push(cb);
      if (lastClientUpdate) {
        try {
          cb(lastClientUpdate);
        } catch (err) {
          console.error('[BetterHeyboxChat] onClientUpdate error:', err);
        }
      }
    },

    patch: {
      getStatus: function () {
        if (window.bhchatPreload && window.bhchatPreload.patch) {
          return window.bhchatPreload.patch.getStatus();
        }
        return lastClientUpdate;
      },
      ensure: function () {
        if (window.bhchatPreload && window.bhchatPreload.patch) {
          return notifyClientUpdate(window.bhchatPreload.patch.ensure());
        }
        return null;
      },
    },

    getVue: getVue,
    getStore: getStore,
    mapState: mapState,
    watch: watch,

    on: function (event, handler) {
      if (!eventBus[event]) eventBus[event] = [];
      eventBus[event].push(handler);
    },

    off: function (event, handler) {
      if (!eventBus[event]) return;
      eventBus[event] = eventBus[event].filter(function (h) {
        return h !== handler;
      });
    },

    emit: function (event) {
      var args = Array.prototype.slice.call(arguments, 1);
      (eventBus[event] || []).forEach(function (handler) {
        try {
          handler.apply(null, args);
        } catch (err) {
          console.error('[BetterHeyboxChat] event handler error:', err);
        }
      });
    },

    injectCSS: injectCSS,
    injectStyleUrl: injectStyleUrl,

    registerPanel: registerPanel,
    listPanels: listPanels,

    registerPlugin: function (manifest) {
      registerPluginRecord(manifest, false);
    },

    getPlugin: function (id) {
      var list = listPlugins();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
      }
      return null;
    },

    listPlugins: listPlugins,
    isPluginEnabled: isPluginEnabled,
    setPluginEnabled: setPluginEnabled,
    restart: restart,

    update: {
      check: function (opts) {
        return checkSelfUpdate(opts);
      },
      apply: function (remote) {
        return applySelfUpdate(remote);
      },
      ignore: function (remote) {
        return ignoreSelfUpdate(remote);
      },
      getSettings: function () {
        return loadUpdateSettings();
      },
      setMode: function (mode) {
        return loadUpdateSettings().then(function (settings) {
          settings.mode = mode === 'quiet' || mode === 'auto' ? mode : 'notify';
          return saveUpdateSettings(settings).then(function () {
            return settings;
          });
        });
      },
      setChannel: function (channel) {
        return loadUpdateSettings().then(function (settings) {
          settings.channel = channel === 'release' ? 'release' : 'dev';
          return saveUpdateSettings(settings).then(function () {
            return settings;
          });
        });
      },
      lastResult: function () {
        return lastSelfUpdate;
      },
    },

    plugins: {
      dataRoot: function () {
        return window.bhchatPreload && window.bhchatPreload.plugins
          ? window.bhchatPreload.plugins.dataRoot()
          : '';
      },
      inspectZipPath: function (p) {
        return callPluginStore('inspectZipPath', p);
      },
      inspectZipBuffer: function (buf) {
        return callPluginStore('inspectZipBuffer', buf);
      },
      inspectFolderPath: function (p) {
        return callPluginStore('inspectFolderPath', p);
      },
      getPathForFile: function (file) {
        var api = window.bhchatPreload && window.bhchatPreload.plugins;
        if (!api || typeof api.getPathForFile !== 'function') return '';
        try {
          return api.getPathForFile(file) || '';
        } catch (err) {
          return '';
        }
      },
      installZipPath: function (p) {
        return callPluginStore('installZipPath', p);
      },
      installZipBuffer: function (buf) {
        return callPluginStore('installZipBuffer', buf);
      },
      installFolderPath: function (p) {
        return callPluginStore('installFolderPath', p);
      },
      uninstall: function (id) {
        return callPluginStore('uninstall', id);
      },
      fetchRegistry: function (opts) {
        return callPluginStore('fetchRegistry', opts);
      },
      resolveLocalRoot: function (p) {
        return callPluginStore('resolveLocalRoot', p);
      },
      inspectRemote: function (opts) {
        return callPluginStore('inspectRemote', opts);
      },
      installRemote: function (opts) {
        return callPluginStore('installRemote', opts);
      },
      installPreview: function (preview) {
        return callPluginStore('installPreview', preview);
      },
      readUserFile: function (id, rel) {
        var api = window.bhchatPreload && window.bhchatPreload.plugins;
        if (!api || typeof api.readUserFile !== 'function') return '';
        try {
          return api.readUserFile(id, rel) || '';
        } catch (err) {
          return '';
        }
      },
    },

    guest: {
      watch: function (spec) {
        return callPreloadNs('guest', 'watch', spec);
      },
      unwatch: function (id) {
        return callPreloadNs('guest', 'unwatch', id);
      },
      list: function () {
        return callPreloadNs('guest', 'list');
      },
      run: function (opts) {
        return callPreloadNs('guest', 'run', opts);
      },
    },

    cookies: {
      get: function (url) {
        return callPreloadNs('cookies', 'get', url);
      },
      makeEmbeddable: function (opts) {
        return callPreloadNs('cookies', 'makeEmbeddable', opts);
      },
    },

    electron: window.electronAPI,
    overlay: window.overlayAPI,
    steam: window.steamAPI,
    laughter: window.laughterAPI,

    storage: storageApi,

    devtools: {
      isEnabled: function () {
        if (window.bhchatPreload && window.bhchatPreload.devtools) {
          return window.bhchatPreload.devtools.isEnabled();
        }
        return Promise.resolve(false);
      },
      getStatus: function () {
        if (window.bhchatPreload && window.bhchatPreload.devtools) {
          return window.bhchatPreload.devtools.getStatus();
        }
        return Promise.resolve('preload bridge 未就绪');
      },
      setEnabled: function (enabled) {
        if (window.bhchatPreload && window.bhchatPreload.devtools) {
          return window.bhchatPreload.devtools.setEnabled(!!enabled);
        }
        return Promise.resolve({ enabled: false, message: 'preload bridge 未就绪' });
      },
      open: function () {
        if (window.bhchatPreload && window.bhchatPreload.devtools) {
          return window.bhchatPreload.devtools.open();
        }
        return Promise.resolve({ ok: false, message: 'preload bridge 未就绪' });
      },
    },

    openRoomBgPanel: function () {
      if (this.openSettings('betterheyboxchat')) return;
      if (this.roomBg && this.roomBg.openPanel) {
        this.roomBg.openPanel();
      }
    },

    openSettings: function (blockKey) {
      blockKey = blockKey || 'betterheyboxchat';
      if (window.__bhchat_bootstrap_patch__) {
        window.__bhchat_bootstrap_patch__();
      }
      if (!window.__bhchat_require__) return false;
      try {
        var map = window.__bhchat_module_map__ || {};
        var busMod = window.__bhchat_require__(map.EVENT_BUS || '30570');
        var bus = busMod.A || busMod.default || busMod;
        if (bus && bus.$dynamic) {
          bus.$dynamic('UserConfig', blockKey);
          return true;
        }
      } catch (err) {
        console.warn('[BetterHeyboxChat] openSettings failed:', err);
      }
      return false;
    },

    openPanel: function (panelId) {
      this.openSettings('betterheyboxchat');
      if (panelId && this.emit) this.emit('open-panel', panelId);
      return true;
    },

    _registerPlugin: function (manifest, loaded) {
      registerPluginRecord(manifest, loaded);
    },

    _loadEnabledMap: loadEnabledMap,

    _notifyClientUpdate: notifyClientUpdate,

    perf: {
      getStatus: function () {
        return callPreloadNs('perf', 'getStatus');
      },
      setConfig: function (partial) {
        return callPreloadNs('perf', 'setConfig', partial);
      },
      getWindowState: function () {
        return callPreloadNs('perf', 'windowState');
      },
      lightReclaim: function () {
        return callPreloadNs('perf', 'lightReclaim');
      },
      trimWorkingSet: function () {
        return callPreloadNs('perf', 'trimWorkingSet');
      },
      getMemory: function () {
        return callPreloadNs('perf', 'getMemory');
      },
    },

    _ready: function () {
      syncBlockFlagsIfDisabled();
      syncPerfFlagsIfDisabled();
      if (window.bhchatPreload && window.bhchatPreload.patch) {
        notifyClientUpdate(window.bhchatPreload.patch.getStatus());
      }
      readyCallbacks.forEach(function (cb) {
        try {
          cb();
        } catch (err) {
          console.error('[BetterHeyboxChat] onReady error:', err);
        }
      });
      readyCallbacks = [];
      window.BHChat.emit('ready');
      if (window.__bhchat_bootstrap_patch__) {
        window.__bhchat_bootstrap_patch__();
      }
      if (window.bhchatPreload && window.bhchatPreload.update) {
        window.bhchatPreload.update.cleanupOldInstallers('');
      }
      setTimeout(function () {
        checkSelfUpdate({ manual: false }).catch(function () {});
      }, 1200);
    },
  };
})();
