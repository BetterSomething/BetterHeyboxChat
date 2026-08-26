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

  window.BHChat = {
    version: '0.1.0',
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
      fetchRegistry: function (mirror) {
        return callPluginStore('fetchRegistry', mirror);
      },
      inspectRemote: function (opts) {
        return callPluginStore('inspectRemote', opts);
      },
      installRemote: function (opts) {
        return callPluginStore('installRemote', opts);
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

    _registerPlugin: function (manifest, loaded) {
      registerPluginRecord(manifest, loaded);
    },

    _loadEnabledMap: loadEnabledMap,

    _notifyClientUpdate: notifyClientUpdate,

    _ready: function () {
      syncBlockFlagsIfDisabled();
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
    },
  };
})();
