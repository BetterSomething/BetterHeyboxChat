/**
 * installer / 设置页重启后，回到原来的页面和语音频道。
 * 普通点图标启动不恢复。逻辑函数可在 Node 里单独测。
 */
(function (root) {
  'use strict';

  var TTL_MS = 15 * 60 * 1000;
  var SNAPSHOT_KEY = 'bhchat.session.last';
  var INTENT_KEY = 'bhchat.session.intent';
  var INTENT_FILE = 'session-restore.intent';
  var SAVE_DEBOUNCE_MS = 300;
  var JUMP_WAIT_MS = 20000;
  var JUMP_POLL_MS = 250;
  var SKIP_ROUTE_NAMES = { room: 1, home: 1, main: 1 };

  function isFresh(snapshot, now) {
    if (!snapshot || typeof snapshot.savedAt !== 'number') return false;
    now = typeof now === 'number' ? now : Date.now();
    var age = now - snapshot.savedAt;
    return age >= 0 && age <= TTL_MS;
  }

  function collectSnapshot(input) {
    input = input || {};
    var voiceId = input.voiceChannelId ? String(input.voiceChannelId) : '';
    var voiceRoom = input.voiceRoomId ? String(input.voiceRoomId) : '';
    return {
      v: 1,
      savedAt: typeof input.now === 'number' ? input.now : Date.now(),
      view: {
        name: input.routeName ? String(input.routeName) : '',
        path: input.routePath ? String(input.routePath) : '',
        roomId: input.roomId ? String(input.roomId) : '',
        textChannelId: input.textChannelId ? String(input.textChannelId) : '',
      },
      voice: voiceId
        ? { roomId: voiceRoom || (input.roomId ? String(input.roomId) : ''), channelId: voiceId }
        : null,
    };
  }

  function isDefaultPath(path) {
    return !path || path === '/' || path === '/app' || path === '/app/' || path === '/home';
  }

  function buildPlan(snapshot) {
    var steps = [];
    if (!snapshot) return steps;
    var view = snapshot.view || {};
    var voice = snapshot.voice;
    if (voice && voice.roomId && voice.channelId) {
      steps.push({ type: 'voice', roomId: String(voice.roomId), channelId: String(voice.channelId) });
    }
    if (view.roomId && view.textChannelId) {
      steps.push({ type: 'text', roomId: String(view.roomId), channelId: String(view.textChannelId) });
    } else if (view.roomId && (!voice || String(view.roomId) !== String(voice.roomId))) {
      steps.push({ type: 'room', roomId: String(view.roomId) });
    }
    if (view.name && !SKIP_ROUTE_NAMES[view.name]) {
      steps.push({ type: 'route', name: String(view.name), path: view.path ? String(view.path) : '' });
    } else if (!view.roomId && view.path && !isDefaultPath(view.path) && !SKIP_ROUTE_NAMES[view.name]) {
      steps.push({ type: 'route', name: view.name ? String(view.name) : '', path: String(view.path) });
    }
    return steps;
  }

  function shouldRestore(hasIntent, snapshot, now) {
    return !!hasIntent && isFresh(snapshot, now);
  }

  var exported = {
    TTL_MS: TTL_MS,
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    INTENT_FILE: INTENT_FILE,
    isFresh: isFresh,
    collectSnapshot: collectSnapshot,
    buildPlan: buildPlan,
    shouldRestore: shouldRestore,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }

  if (typeof window === 'undefined' || !window.BHChat) {
    return;
  }

  var saveTimer = null;
  var restoring = false;
  var originalRestart = window.BHChat.restart;

  function getAppVue() {
    var app = document.getElementById('app');
    return (app && app.__vue__) || null;
  }

  function walkVue(vm, depth, visit) {
    if (!vm || depth > 8) return null;
    var hit = visit(vm);
    if (hit) return hit;
    var kids = vm.$children || [];
    for (var i = 0; i < kids.length; i++) {
      var found = walkVue(kids[i], depth + 1, visit);
      if (found) return found;
    }
    return null;
  }

  function getRouter() {
    return walkVue(getAppVue(), 0, function (vm) {
      return vm.$router || null;
    });
  }

  function readRoute() {
    var fromRouter = walkVue(getAppVue(), 0, function (vm) {
      return vm.$route || null;
    });
    if (fromRouter) {
      return { name: fromRouter.name || '', path: fromRouter.path || fromRouter.fullPath || '' };
    }
    var hash = (window.location && window.location.hash) || '';
    return { name: '', path: hash.replace(/^#/, '') };
  }

  function getterValue(key) {
    var store = window.BHChat.getStore && window.BHChat.getStore();
    if (!store) return null;
    if (store.getters && store.getters[key] !== undefined) return store.getters[key];
    return null;
  }

  function idOf(obj, key) {
    if (!obj || obj[key] == null || obj[key] === '') return '';
    return String(obj[key]);
  }

  function readLiveInput() {
    var route = readRoute();
    var room = getterValue('cur_room_data') || {};
    var text = getterValue('cur_text_channel_data') || {};
    var voice = getterValue('cur_channel_data') || {};
    return {
      now: Date.now(),
      routeName: route.name,
      routePath: route.path,
      roomId: idOf(room, 'room_id'),
      textChannelId: idOf(text, 'channel_id'),
      voiceRoomId: idOf(voice, 'room_id'),
      voiceChannelId: idOf(voice, 'channel_id'),
    };
  }

  function dataRoot() {
    var plugins = window.BHChat && window.BHChat.plugins;
    if (plugins && typeof plugins.dataRoot === 'function') {
      return plugins.dataRoot() || '';
    }
    var preload = window.bhchatPreload && window.bhchatPreload.plugins;
    if (preload && typeof preload.dataRoot === 'function') {
      return preload.dataRoot() || '';
    }
    return '';
  }

  function intentPath() {
    var root = dataRoot();
    if (!root) return '';
    try {
      return require('path').join(root, INTENT_FILE);
    } catch (err) {
      return '';
    }
  }

  function writeIntentFile() {
    try {
      var fs = require('fs');
      var p = intentPath();
      if (!p) return false;
      fs.mkdirSync(require('path').dirname(p), { recursive: true });
      fs.writeFileSync(p, String(Date.now()));
      return true;
    } catch (err) {
      return false;
    }
  }

  function consumeIntentFile() {
    try {
      var fs = require('fs');
      var p = intentPath();
      if (!p || !fs.existsSync(p)) return false;
      fs.unlinkSync(p);
      return true;
    } catch (err) {
      return false;
    }
  }

  function storageGet(key) {
    var storage = window.BHChat && window.BHChat.storage;
    if (!storage || typeof storage.get !== 'function') return Promise.resolve(null);
    return Promise.resolve(storage.get(key));
  }

  function storageSet(key, value) {
    var storage = window.BHChat && window.BHChat.storage;
    if (!storage || typeof storage.set !== 'function') return Promise.resolve();
    return Promise.resolve(storage.set(key, value));
  }

  function storageDel(key) {
    var storage = window.BHChat && window.BHChat.storage;
    if (!storage || typeof storage.del !== 'function') return Promise.resolve();
    return Promise.resolve(storage.del(key));
  }

  function persistLive() {
    if (restoring) return Promise.resolve();
    return storageSet(SNAPSHOT_KEY, collectSnapshot(readLiveInput()));
  }

  function scheduleSave() {
    if (restoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persistLive();
    }, SAVE_DEBOUNCE_MS);
  }

  function markRestart() {
    writeIntentFile();
    return persistLive().then(function () {
      return storageSet(INTENT_KEY, Date.now());
    });
  }

  function consumeIntent() {
    var fromFile = consumeIntentFile();
    return storageGet(INTENT_KEY).then(function (value) {
      return storageDel(INTENT_KEY).then(function () {
        return fromFile || value != null;
      });
    });
  }

  function getOfficialBus() {
    var req = window.__bhchat_require__;
    if (typeof req !== 'function') return null;
    var map = window.__bhchat_module_map__ || {};
    var id = map.EVENT_BUS || '30570';
    try {
      var mod = req(id);
      var bus = mod && (mod.A || mod.default || mod);
      if (bus && (typeof bus.$jump === 'function' || typeof bus.$emit === 'function')) return bus;
    } catch (err) {
      return null;
    }
    return null;
  }

  function toastError(message) {
    var vm = walkVue(getAppVue(), 0, function (node) {
      return node.$toast ? node : null;
    });
    if (vm && vm.$toast && typeof vm.$toast.error === 'function') {
      try {
        vm.$toast.error(message);
        return;
      } catch (err) {
        /* ignore */
      }
    }
    console.warn('[BetterHeyboxChat]', message);
  }

  function waitFor(pred, timeout) {
    return new Promise(function (resolve) {
      if (pred()) {
        resolve(true);
        return;
      }
      var startedAt = Date.now();
      var timer = setInterval(function () {
        if (pred()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - startedAt >= timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, JUMP_POLL_MS);
    });
  }

  function canJump() {
    var bus = getOfficialBus();
    if (!bus || typeof bus.$jump !== 'function') return false;
    var store = window.BHChat.getStore && window.BHChat.getStore();
    if (!store || !store.getters) return false;
    if (!store.getters.is_login) return false;
    if (!store.getters.ws_id) return false;
    return true;
  }

  function jumpTo(roomId, channelId) {
    var bus = getOfficialBus();
    if (!bus || typeof bus.$jump !== 'function') return false;
    var payload = { room_id: roomId };
    if (channelId) payload.channel_id = channelId;
    bus.$jump(payload, 'bhchat-restore');
    return true;
  }

  function joinChannel(roomId, channelId) {
    var bus = getOfficialBus();
    if (!bus || typeof bus.$emit !== 'function') return false;
    bus.$emit('Join_Room_Or_Channel', { room_id: roomId, channel_id: channelId || '' });
    return true;
  }

  function pushRoute(step) {
    var router = getRouter();
    if (!router || typeof router.push !== 'function') return Promise.resolve(false);
    var target =
      step.name && router.hasRoute && router.hasRoute(step.name)
        ? { name: step.name }
        : step.path
          ? step.path
          : null;
    if (!target) return Promise.resolve(false);
    return Promise.resolve(router.push(target)).then(
      function () {
        return true;
      },
      function () {
        if (step.path && target !== step.path) {
          return Promise.resolve(router.push(step.path)).then(
            function () {
              return true;
            },
            function () {
              return false;
            },
          );
        }
        return false;
      },
    );
  }

  function applyPlan(steps) {
    var chain = Promise.resolve(true);
    steps.forEach(function (step) {
      chain = chain.then(function (ok) {
        if (!ok) return false;
        if (step.type === 'voice') {
          if (!jumpTo(step.roomId, step.channelId)) return false;
          return waitFor(function () {
            return idOf(getterValue('cur_channel_data'), 'channel_id') === step.channelId;
          }, JUMP_WAIT_MS);
        }
        if (step.type === 'text') {
          var alreadyInRoom = idOf(getterValue('cur_room_data'), 'room_id') === step.roomId;
          if (alreadyInRoom) {
            if (!joinChannel(step.roomId, step.channelId)) return false;
          } else if (!jumpTo(step.roomId, step.channelId)) {
            return false;
          }
          return waitFor(function () {
            return idOf(getterValue('cur_text_channel_data'), 'channel_id') === step.channelId;
          }, JUMP_WAIT_MS);
        }
        if (step.type === 'room') {
          if (!jumpTo(step.roomId, '')) return false;
          return waitFor(function () {
            return idOf(getterValue('cur_room_data'), 'room_id') === step.roomId;
          }, JUMP_WAIT_MS);
        }
        if (step.type === 'route') {
          return waitFor(function () {
            var router = getRouter();
            return !!(router && (!step.name || !router.hasRoute || router.hasRoute(step.name) || step.path));
          }, 5000).then(function () {
            return pushRoute(step);
          });
        }
        return true;
      });
    });
    return chain;
  }

  function tryRestore() {
    return consumeIntent()
      .then(function (hasIntent) {
        return storageGet(SNAPSHOT_KEY).then(function (snapshot) {
          if (!shouldRestore(hasIntent, snapshot, Date.now())) {
            console.log('[BetterHeyboxChat] session restore skipped:', hasIntent ? 'stale-or-missing' : 'no-intent');
            return null;
          }
          var steps = buildPlan(snapshot);
          if (!steps.length) {
            console.log('[BetterHeyboxChat] session restore skipped: empty-plan');
            return null;
          }
          console.log('[BetterHeyboxChat] session restore', steps);
          return waitFor(canJump, JUMP_WAIT_MS).then(function (ready) {
            if (!ready) return false;
            return applyPlan(steps);
          });
        });
      })
      .then(function (ok) {
        if (ok === false) toastError('未能回到原来的频道');
        return ok;
      })
      .catch(function (err) {
        console.warn('[BetterHeyboxChat] session restore failed:', err);
        toastError('未能回到原来的频道');
        return false;
      });
  }

  function startWatch() {
    window.addEventListener('hashchange', scheduleSave);
    var router = getRouter();
    if (router && typeof router.afterEach === 'function') {
      router.afterEach(function () {
        scheduleSave();
      });
    }
    if (window.BHChat.watch) {
      window.BHChat.watch(function () {
        var room = getterValue('cur_room_data') || {};
        var text = getterValue('cur_text_channel_data') || {};
        var voice = getterValue('cur_channel_data') || {};
        return [idOf(room, 'room_id'), idOf(text, 'channel_id'), idOf(voice, 'room_id'), idOf(voice, 'channel_id')].join(
          '|',
        );
      }, scheduleSave);
    }
    persistLive();
  }

  function wrappedRestart() {
    return markRestart().then(function () {
      if (typeof originalRestart === 'function') return originalRestart();
      if (window.electronAPI && typeof window.electronAPI.restartApp === 'function') {
        return window.electronAPI.restartApp();
      }
      return Promise.reject(new Error('electronAPI.restartApp 不可用'));
    });
  }

  window.BHChat.restart = wrappedRestart;
  window.BHChat.session = {
    capture: persistLive,
    restore: tryRestore,
    markRestart: markRestart,
    isRestoring: function () {
      return !!restoring;
    },
  };

  window.BHChat.on('ready', function () {
    restoring = true;
    tryRestore().then(function () {
      restoring = false;
      startWatch();
      window.BHChat.emit('session-ready');
    });
  });
})(typeof window !== 'undefined' ? window : this);
