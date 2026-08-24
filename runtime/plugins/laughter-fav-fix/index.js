/**
 * 语音包收藏显示修复：频道内收藏/取消收藏他人播放的语音包后，同步刷新收藏列表。
 *
 * 官方语音包平台收藏会 $emit('Refresh_User_Laughter')，由主界面 handleRefreshUserLaughter
 * 重新拉取 voice_packs 并 SET_VOICE_PACKS_MAP / SET_LAUGHTER_FLATTEN_LIST。
 * 频道 IM 右键收藏（addLaughterToFavorite）只 commit SET_FAVORITE_VOICE_PACK_IDS，
 * 收藏 ID 变了，列表不会重拉。本插件在收藏与取消收藏后补发同一事件，不伪造协议。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'laughter-fav-fix';
  var STORAGE_KEY = 'settings';
  var OFFICIAL_REFRESH_EVENT = 'Refresh_User_Laughter';
  var FAVORITE_IDS_MUTATION = 'SET_FAVORITE_VOICE_PACK_IDS';

  var DEFAULTS = {
    enabled: true,
  };

  var settings = {
    enabled: DEFAULTS.enabled,
  };

  var storeNs = null;
  var hooked = false;
  var refreshTimer = null;
  var refreshing = false;
  var ignoreFavoriteUntil = 0;
  var lastStatus = '等待挂接客户端…';
  var lastRefreshAt = 0;
  var hookRetry = null;
  var storeUnsub = null;
  var origDispatch = null;
  var origCommit = null;
  var origEmit = null;
  var origFetch = null;
  var origXhrOpen = null;
  var origXhrSend = null;
  var hookedBus = null;
  var hookedStore = null;

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
      settings = { enabled: DEFAULTS.enabled };
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      settings = { enabled: saved.enabled !== false };
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, { enabled: !!settings.enabled });
  }

  function getStore() {
    if (window.BHChat && window.BHChat.getStore) {
      return window.BHChat.getStore();
    }
    var app = document.getElementById('app');
    if (app && app.__vue__ && app.__vue__.$store) {
      return app.__vue__.$store;
    }
    return null;
  }

  function getClientBus() {
    var req = window.__bhchat_require__;
    var map = window.__bhchat_module_map__ || {};
    var id = map.EVENT_BUS;
    if (!req || !id) return null;
    try {
      if (!req.m || typeof req.m[id] !== 'function') return null;
      var mod = req(id);
      var bus = (mod && (mod.A || mod.default || mod)) || null;
      if (bus && typeof bus.$on === 'function') return bus;
    } catch (err) {
      return null;
    }
    return null;
  }

  function nameOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value.type === 'string') return value.type;
      if (typeof value.name === 'string') return value.name;
    }
    return String(value);
  }

  function isFavoriteIdsMutation(name) {
    return String(name || '') === FAVORITE_IDS_MUTATION;
  }

  function isOfficialRefreshEvent(name) {
    return String(name || '') === OFFICIAL_REFRESH_EVENT;
  }

  function isRefreshName(name) {
    name = String(name || '');
    if (isOfficialRefreshEvent(name)) return true;
    return (
      /(fetch|load|get|list|query|refresh|reload|update).*(laugh|voice.?pack|favorit|collect|收藏|语音包)/i.test(
        name,
      ) ||
      /(laugh|voice.?pack|favorit|collect|收藏|语音包).*(fetch|load|get|list|query|refresh|reload|update)/i.test(
        name,
      )
    );
  }

  function isCollectOrUncollectName(name) {
    name = String(name || '');
    if (isRefreshName(name) || isOfficialRefreshEvent(name)) return false;
    if (isFavoriteIdsMutation(name)) return true;
    return /(collect|uncollect|favorite|unfavorite|favour|star|收藏|取消收藏|add.*(laugh|voice)|remove.*(laugh|voice)|delete.*(laugh|voice)|laugh.*(add|collect|remove|delete)|voice.?pack.*(add|collect|remove|delete))/i.test(
      name,
    );
  }

  function isCollectUrl(url) {
    url = String(url || '');
    if (!url) return false;
    if (/(list|query|get_|\/get\b|\/list\b)/i.test(url) && !/collect|favorite|收藏|取消收藏/i.test(url)) {
      return false;
    }
    return /(laugh|voice.?pack|voice_pack|laughter|collect|uncollect|favorite|favour|收藏|取消收藏|语音包)/i.test(
      url,
    );
  }

  function isCollectPostUrl(url, method) {
    method = String(method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return false;
    return isCollectUrl(url);
  }

  function notifyToast(ok, text) {
    var api = window.toastAPI;
    if (!api) return;
    try {
      if (ok && typeof api.success === 'function') api.success(text);
      else if (!ok && typeof api.error === 'function') api.error(text);
      else if (typeof api.info === 'function') api.info(text);
    } catch (err) {}
  }

  function emitOfficialRefresh() {
    var bus = hookedBus || getClientBus();
    if (!bus || typeof bus.$emit !== 'function') return false;
    ignoreFavoriteUntil = Date.now() + 2500;
    try {
      bus.$emit(OFFICIAL_REFRESH_EVENT);
      return true;
    } catch (err) {
      return false;
    }
  }

  function refreshLists(reason, opts) {
    opts = opts || {};
    var force = !!opts.force;
    if (!force && !settings.enabled) return;
    if (refreshing) return;
    refreshing = true;
    lastRefreshAt = Date.now();
    var ok = emitOfficialRefresh();
    lastStatus = ok
      ? '已触发官方刷新（' + (reason || 'manual') + '）'
      : '未找到 EventBus，无法刷新收藏列表';
    if (force) notifyToast(ok, ok ? '已请求刷新收藏列表' : lastStatus);
    setTimeout(function () {
      refreshing = false;
    }, 1600);
  }

  function scheduleRefresh(reason) {
    if (!settings.enabled) return;
    if (isFavoriteIdsMutation(String(reason || '').split(':').pop()) && Date.now() < ignoreFavoriteUntil) {
      return;
    }
    if (Date.now() < ignoreFavoriteUntil && /vuex|commit|sub/i.test(String(reason || ''))) {
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshLists(reason);
    }, 280);
  }

  function wrapStore(store) {
    if (!store || hookedStore === store) return;
    hookedStore = store;
    if (typeof store.dispatch === 'function' && !store.dispatch.__bhchat_laughter) {
      origDispatch = store.dispatch.bind(store);
      store.dispatch = function (type) {
        var name = nameOf(type);
        var ret = origDispatch.apply(store, arguments);
        if (settings.enabled && isCollectOrUncollectName(name)) {
          Promise.resolve(ret)
            .then(function () {
              scheduleRefresh('vuex-dispatch:' + name);
            })
            .catch(function () {});
        }
        return ret;
      };
      store.dispatch.__bhchat_laughter = true;
    }
    if (typeof store.commit === 'function' && !store.commit.__bhchat_laughter) {
      origCommit = store.commit.bind(store);
      store.commit = function (type) {
        var name = nameOf(type);
        var ret = origCommit.apply(store, arguments);
        if (settings.enabled && isCollectOrUncollectName(name)) {
          scheduleRefresh('vuex-commit:' + name);
        }
        return ret;
      };
      store.commit.__bhchat_laughter = true;
    }
    if (typeof store.subscribe === 'function' && !storeUnsub) {
      storeUnsub = store.subscribe(function (mutation) {
        var name = mutation && mutation.type ? mutation.type : '';
        if (settings.enabled && isCollectOrUncollectName(name)) {
          scheduleRefresh('vuex-sub:' + name);
        }
      });
    }
  }

  function wrapBus(bus) {
    if (!bus || hookedBus === bus) return;
    hookedBus = bus;
    if (typeof bus.$emit === 'function' && !bus.$emit.__bhchat_laughter) {
      origEmit = bus.$emit.bind(bus);
      bus.$emit = function (event) {
        var name = nameOf(event);
        var ret = origEmit.apply(bus, arguments);
        if (settings.enabled && isCollectOrUncollectName(name) && !isOfficialRefreshEvent(name)) {
          scheduleRefresh('bus:' + name);
        }
        return ret;
      };
      bus.$emit.__bhchat_laughter = true;
    }
  }

  function wrapNetwork() {
    if (typeof window.fetch === 'function' && !window.fetch.__bhchat_laughter) {
      origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = '';
        var method = 'GET';
        if (typeof input === 'string') url = input;
        else if (input && input.url) url = input.url;
        if (init && init.method) method = init.method;
        else if (input && input.method) method = input.method;
        return origFetch.apply(window, arguments).then(function (res) {
          if (settings.enabled && res && res.ok && isCollectPostUrl(url, method)) {
            scheduleRefresh('fetch');
          }
          return res;
        });
      };
      window.fetch.__bhchat_laughter = true;
    }
    if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__bhchat_laughter) {
      origXhrOpen = XMLHttpRequest.prototype.open;
      origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bhchat_laughter_method = method;
        this.__bhchat_laughter_url = url;
        return origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        xhr.addEventListener('load', function () {
          if (
            settings.enabled &&
            xhr.status >= 200 &&
            xhr.status < 300 &&
            isCollectPostUrl(xhr.__bhchat_laughter_url, xhr.__bhchat_laughter_method)
          ) {
            scheduleRefresh('xhr');
          }
        });
        return origXhrSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype.__bhchat_laughter = true;
    }
  }

  function tryHook() {
    wrapNetwork();
    var store = getStore();
    if (store) wrapStore(store);
    var bus = getClientBus();
    if (bus) wrapBus(bus);
    if (store || bus) {
      hooked = true;
      lastStatus =
        '已挂接' +
        (store ? ' Vuex' : '') +
        (bus ? ' EventBus' : '') +
        '，等待收藏或取消收藏';
      return true;
    }
    return false;
  }

  function startHook() {
    if (tryHook()) return;
    var tries = 0;
    hookRetry = setInterval(function () {
      tries += 1;
      if (tryHook() || tries > 120) {
        clearInterval(hookRetry);
        hookRetry = null;
        if (!hooked) lastStatus = '未接到 Vuex / EventBus，收藏刷新暂不可用';
      }
    }, 500);
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.laughterFav = {
      refresh: function () {
        refreshLists('manual', { force: true });
      },
      getStatus: function () {
        return lastStatus;
      },
      getSettings: function () {
        return { enabled: !!settings.enabled };
      },
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatLaughterFavFixPanel',
      data: function () {
        return {
          enabled: settings.enabled,
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
          this.enabled = settings.enabled;
          this.status = lastStatus;
        },
        persist: function () {
          settings.enabled = !!this.enabled;
          saveSettings();
        },
        onToggle: function () {
          this.enabled = !this.enabled;
          this.persist();
        },
        onRefresh: function () {
          refreshLists('manual', { force: true });
          this.status = lastStatus;
        },
      },
      render: function (h) {
        function btn(text, kind, onClick) {
          return h(
            'button',
            {
              class: {
                'bhchat-btn': true,
                'bhchat-btn-primary': kind === 'primary',
                'bhchat-btn-secondary': kind === 'secondary',
              },
              attrs: { type: 'button' },
              on: { click: onClick },
            },
            text,
          );
        }
        return h('div', [
          h('div', { class: 'cell-title' }, '语音包收藏显示修复'),
          h('div', { class: 'bhchat-list' }, [
            h(
              'div',
              {
                class: 'row bhchat-row-click',
                on: { click: this.onToggle },
              },
              [
                h('span', '收藏或取消收藏后立即刷新列表'),
                h('span', { class: { 'bhchat-switch': true, on: !!this.enabled } }, [
                  h('span', { class: 'bhchat-switch-core' }),
                ]),
              ],
            ),
          ]),
          h('p', { class: 'bhchat-hint' }, this.status),
          h('div', { class: 'bhchat-actions' }, [
            btn('立即刷新收藏列表', 'primary', this.onRefresh),
          ]),
        ]);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '语音包收藏显示修复',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    loadSettings().then(function () {
      registerApi();
      registerPanel();
      startHook();
      console.log('[BetterHeyboxChat] laughter-fav-fix plugin activated');
    });
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
