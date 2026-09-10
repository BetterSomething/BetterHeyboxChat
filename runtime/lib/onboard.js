/**
 * 首次用户分步引导：一张教练卡带路，不代圈官方 DOM。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'bhchat.onboard';
  var HOST_ID = 'bhchat-onboard-host';
  var STYLE_ID = 'bhchat-onboard-style';
  var PLUGIN_CONCURRENCY = 4;

  function runPool(items, limit, worker) {
    var list = items || [];
    var cap = Math.max(1, limit || 1);
    var out = new Array(list.length);
    var cursor = 0;
    var active = 0;
    return new Promise(function (resolve, reject) {
      function next() {
        if (cursor >= list.length && active === 0) {
          resolve(out);
          return;
        }
        while (active < cap && cursor < list.length) {
          (function (index) {
            active += 1;
            Promise.resolve(worker(list[index], index)).then(
              function (value) {
                out[index] = value;
                active -= 1;
                next();
              },
              reject,
            );
          })(cursor++);
        }
      }
      if (!list.length) resolve(out);
      else next();
    });
  }

  var RECOMMENDED = [
    {
      id: 'heybox-bbs',
      name: '社区功能补全',
      usage: '左侧会多社区入口，电脑上也能刷帖',
    },
    {
      id: 'screen-share-danmaku',
      name: '屏幕共享增强',
      usage: '开始共享后，操作栏会出现弹幕和 P2P/中转',
    },
    {
      id: 'custom-room-bg',
      name: '自定义房间背景',
      usage: '进房间后可给自己换背景（仅自己看见）',
    },
    {
      id: 'misc-fix',
      name: '杂项修复',
      usage: '语音包收藏、设备列表、评论签名，装上即可',
    },
    {
      id: 'perf-tune',
      name: '内存优化',
      usage: '设置里三档，默认就能用',
    },
    {
      id: 'channel-tts',
      name: '频道文字消息 TTS',
      usage: '朗读当前正在看的频道里的新文字消息',
    },
    {
      id: 'block-update',
      name: '屏蔽客户端更新',
      usage: '不再弹出官方客户端更新',
    },
  ];

  var WELCOME_LINES = [
    '欢迎使用 BetterHeyboxChat! (下称 BHC)',
    'BHC 只是一个框架，实际功能由各个开发者编写插件实现',
    '接下来进行一个简单的新手指导~',
    '随时可以点跳过按钮跳过哦',
  ];

  var state = {
    active: false,
    replay: false,
    step: 'welcome',
    installing: false,
    installError: '',
    installStatus: '',
    installedIds: [],
    percent: 0,
  };

  var bootStarted = false;

  function storage() {
    return window.BHChat && window.BHChat.storage;
  }

  function loadRecord() {
    var api = storage();
    if (!api) return Promise.resolve(null);
    return Promise.resolve(api.get(STORAGE_KEY)).then(function (saved) {
      return saved && typeof saved === 'object' ? saved : null;
    });
  }

  function saveRecord(status) {
    var api = storage();
    if (!api) return Promise.resolve();
    return Promise.resolve(api.set(STORAGE_KEY, { version: 1, status: status }));
  }

  function userPlugins() {
    var list = (window.BHChat && window.BHChat.listPlugins && window.BHChat.listPlugins()) || [];
    return list.filter(function (item) {
      return item.source === 'user';
    });
  }

  function installedIdMap() {
    var map = {};
    userPlugins().forEach(function (item) {
      map[item.id] = true;
    });
    var preload = window.bhchatPreload && window.bhchatPreload.plugins;
    if (preload && typeof preload.listUserPlugins === 'function') {
      (preload.listUserPlugins() || []).forEach(function (item) {
        if (item && item.id) map[item.id] = true;
      });
    }
    return map;
  }

  function shouldAutoStart(record, userCount) {
    if (record && (record.status === 'done' || record.status === 'skipped')) return false;
    return !(userCount > 0);
  }

  function isLoggedIn() {
    var store = window.BHChat && window.BHChat.getStore && window.BHChat.getStore();
    return !!(store && store.getters && store.getters.is_login);
  }

  function isScreenSharing() {
    var store = window.BHChat && window.BHChat.getStore && window.BHChat.getStore();
    if (!store || !store.getters) return false;
    if (store.getters.my_screen_sharing) return true;
    var info = store.getters.screen_sharing_info;
    return !!(info && info.user_id);
  }

  function isRestoring() {
    var session = window.BHChat && window.BHChat.session;
    return !!(session && typeof session.isRestoring === 'function' && session.isRestoring());
  }

  function waitFor(pred, timeout) {
    return new Promise(function (resolve) {
      if (pred()) {
        resolve(true);
        return;
      }
      var started = Date.now();
      var timer = setInterval(function () {
        if (pred()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started >= timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, 120);
    });
  }

  function clientVersion() {
    return (window.asar_version || (window.BHChat && window.BHChat.clientVersion) || '1.56.0') + '';
  }

  function loadMarketSettings() {
    var ns = window.BHChat && window.BHChat.storage && window.BHChat.storage.ns('marketplace');
    if (!ns) return Promise.resolve({ mirror: 'https://gh.qmqaq.top/', localDebug: false, localRoot: '' });
    return Promise.resolve(ns.get('settings')).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      return {
        mirror: typeof saved.mirror === 'string' && saved.mirror.trim() ? saved.mirror.trim() : 'https://gh.qmqaq.top/',
        localDebug: !!saved.localDebug,
        localRoot: typeof saved.localRoot === 'string' ? saved.localRoot.trim() : '',
      };
    });
  }

  function recommendIds() {
    return RECOMMENDED.map(function (item) {
      return item.id;
    });
  }

  function emitSelect() {
    if (window.BHChat && window.BHChat.emit) {
      window.BHChat.emit('onboard-select-catalog', recommendIds());
    }
  }

  function openSettingsHome() {
    if (!window.BHChat) return Promise.resolve(false);
    if (typeof window.BHChat.openSettings === 'function') {
      window.BHChat.openSettings('betterheyboxchat');
    }
    if (window.BHChat.emit) window.BHChat.emit('open-panel', '');
    return waitFor(function () {
      return !!document.querySelector('.betterheyboxchat-setting-block');
    }, 4000);
  }

  function openMarket() {
    return openSettingsHome().then(function (ok) {
      if (window.BHChat.emit) window.BHChat.emit('open-panel', 'marketplace');
      if (typeof window.BHChat.openPanel === 'function') {
        window.BHChat.openPanel('marketplace');
      }
      emitSelect();
      return ok;
    });
  }

  function setStep(step) {
    state.step = step;
    render();
    if (step === 'market' || step === 'install') emitSelect();
  }

  function setInactive(status) {
    state.active = false;
    state.installing = false;
    render();
    if (status) saveRecord(status);
    if (window.BHChat && window.BHChat.emit) window.BHChat.emit('onboard-inactive');
  }

  function skip() {
    if (!state.replay) saveRecord('skipped');
    setInactive('');
  }

  function finish(status) {
    setInactive(state.replay ? '' : status || 'done');
    if (!state.replay) saveRecord(status || 'done');
  }

  function start(opts) {
    opts = opts || {};
    state.active = true;
    state.replay = !!opts.replay;
    state.step = 'welcome';
    state.installing = false;
    state.installError = '';
    state.installStatus = '';
    state.installedIds = [];
    state.percent = 0;
    if (window.BHChat && window.BHChat.emit) window.BHChat.emit('onboard-active');
    render();
  }

  function replay() {
    start({ replay: true });
  }

  function beginGuide() {
    setStep('settings');
    openSettingsHome();
  }

  function goNext() {
    if (state.step === 'welcome') {
      beginGuide();
      return;
    }
    if (state.step === 'settings') {
      setStep('market');
      openMarket();
      return;
    }
    if (state.step === 'market') {
      setStep('usage');
      return;
    }
    if (state.step === 'usage') {
      setStep('install');
      openMarket();
    }
  }

  function installRecommended() {
    if (state.installing) return;
    var api = window.BHChat && window.BHChat.plugins;
    if (!api || typeof api.installRemote !== 'function') {
      state.installError = '在线安装接口不可用，请用 Debug 安装器重装';
      render();
      return;
    }
    state.installing = true;
    state.installError = '';
    state.installStatus = '正在准备…';
    state.percent = 0;
    render();
    loadMarketSettings()
      .then(function (settings) {
        var installed = installedIdMap();
        var ids = recommendIds().filter(function (id) {
          return !installed[id];
        });
        if (!ids.length) {
          state.installing = false;
          state.installStatus = '推荐插件都已安装';
          setStep('restart');
          return null;
        }
        emitSelect();
        var okIds = [];
        var errors = [];
        var done = 0;
        return runPool(ids, PLUGIN_CONCURRENCY, function (id) {
          return Promise.resolve(
            api.installRemote({
              id: id,
              mirror: settings.mirror,
              clientVersion: clientVersion(),
              localDebug: !!settings.localDebug,
              localRoot: settings.localDebug ? settings.localRoot : '',
            }),
          ).then(function (result) {
            done += 1;
            state.installStatus = '正在并发安装 ' + done + '/' + ids.length + '：' + id;
            state.percent = Math.round((done / ids.length) * 100);
            render();
            if (result && result.ok) okIds.push(result.id || id);
            else errors.push(id);
          });
        }).then(function () {
          state.installing = false;
          if (!state.active) return;
          state.installedIds = okIds;
          state.percent = 100;
          if (!okIds.length) {
            state.installError = errors.length ? '安装失败：' + errors.join('、') : '安装失败';
            state.installStatus = '';
            render();
            return;
          }
          state.installError = errors.length ? '部分失败：' + errors.join('、') : '';
          state.installStatus = '已安装 ' + okIds.join('、');
          setStep('restart');
        });
      })
      .catch(function (err) {
        state.installing = false;
        state.installError = (err && err.message) || '安装失败';
        render();
      });
  }

  function restartNow() {
    finish('done');
    if (window.BHChat && window.BHChat.restart) window.BHChat.restart();
  }

  function later() {
    finish('done');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#bhchat-onboard-host{position:fixed;inset:0;pointer-events:none;z-index:14000}',
      '#bhchat-onboard-host.is-welcome{pointer-events:auto}',
      '.bhchat-onboard-mask{position:absolute;inset:0;background:var(--opacity-s5,rgba(0,0,0,.7));display:flex;align-items:center;justify-content:center}',
      '.bhchat-onboard-card{width:min(420px,calc(100vw - 48px));max-height:min(76vh,560px);display:flex;flex-direction:column;border-radius:12px;background:var(--fill-1,#36393e);color:var(--text-1,#fff);box-shadow:0 12px 40px rgba(0,0,0,.4);overflow:hidden;pointer-events:auto;transition:transform .2s ease,opacity .2s ease,width .2s ease}',
      'html[theme=light] .bhchat-onboard-card,body[theme=light] .bhchat-onboard-card{background:var(--fill-1,#fff);color:var(--text-1,#000);box-shadow:0 12px 40px rgba(0,0,0,.18)}',
      '.bhchat-onboard-card.is-docked{position:absolute;right:20px;bottom:20px;width:min(360px,calc(100vw - 40px));max-height:min(56vh,420px)}',
      '.bhchat-onboard-head{padding:20px 20px 12px;background:var(--brand-h,#2d7d46);flex-shrink:0}',
      '.bhchat-onboard-head .title{font-weight:700;font-size:16px;line-height:22px;color:#fff}',
      '.bhchat-onboard-head .desc{margin-top:6px;font-size:13px;line-height:18px;color:hsla(0,0%,100%,.5)}',
      '.bhchat-onboard-body{padding:16px 20px 0;overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin}',
      '.bhchat-onboard-text{margin:0 0 10px;font-size:14px;line-height:22px;color:var(--text-2,#d2d3d7);white-space:pre-wrap;word-break:break-word}',
      'html[theme=light] .bhchat-onboard-text,body[theme=light] .bhchat-onboard-text{color:var(--text-2,#32373c)}',
      '.bhchat-onboard-list{margin:0;padding:0 0 8px 18px;font-size:13px;line-height:20px;color:var(--text-2,#d2d3d7)}',
      'html[theme=light] .bhchat-onboard-list,body[theme=light] .bhchat-onboard-list{color:var(--text-2,#32373c)}',
      '.bhchat-onboard-list li{margin:0 0 8px}',
      '.bhchat-onboard-list strong{color:var(--text-1,#fff)}',
      'html[theme=light] .bhchat-onboard-list strong,body[theme=light] .bhchat-onboard-list strong{color:var(--text-1,#000)}',
      '.bhchat-onboard-error{margin:0 0 8px;font-size:13px;line-height:20px;color:var(--f-error-text,#f64e54)}',
      '.bhchat-onboard-progress{margin:8px 0;height:6px;border-radius:3px;overflow:hidden;background:var(--opacity-2,rgba(255,255,255,.14))}',
      '.bhchat-onboard-progress-bar{height:100%;background:var(--brand-text,#7dd95e);transition:width .2s ease}',
      '.bhchat-onboard-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;padding:16px 20px 20px;flex-shrink:0}',
    ].join('');
    document.head.appendChild(style);
  }

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = HOST_ID;
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function clearHost() {
    var el = document.getElementById(HOST_ID);
    if (el) el.innerHTML = '';
    if (el) el.className = '';
  }

  function makeBtn(label, kind, onClick, disabled) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bhchat-btn bhchat-btn-' + kind;
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (disabled) return;
      onClick();
    });
    return btn;
  }

  function addSkip(actions) {
    actions.appendChild(makeBtn('跳过', 'secondary', skip));
  }

  function renderWelcome(root) {
    root.className = 'is-welcome';
    var mask = document.createElement('div');
    mask.className = 'bhchat-onboard-mask';
    var card = document.createElement('div');
    card.className = 'bhchat-onboard-card';
    var head = document.createElement('div');
    head.className = 'bhchat-onboard-head';
    head.innerHTML = '<div class="title">BetterHeyboxChat</div><div class="desc">新手指导</div>';
    var body = document.createElement('div');
    body.className = 'bhchat-onboard-body';
    var text = document.createElement('p');
    text.className = 'bhchat-onboard-text';
    text.textContent = WELCOME_LINES.join('\n');
    body.appendChild(text);
    var actions = document.createElement('div');
    actions.className = 'bhchat-onboard-actions';
    addSkip(actions);
    actions.appendChild(makeBtn('开始', 'primary', beginGuide));
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actions);
    mask.appendChild(card);
    root.appendChild(mask);
  }

  function renderDocked(root, title, desc, bodyFill, extraBtns) {
    root.className = '';
    var card = document.createElement('div');
    card.className = 'bhchat-onboard-card is-docked';
    var head = document.createElement('div');
    head.className = 'bhchat-onboard-head';
    var h = document.createElement('div');
    h.className = 'title';
    h.textContent = title;
    var d = document.createElement('div');
    d.className = 'desc';
    d.textContent = desc || '新手指导';
    head.appendChild(h);
    head.appendChild(d);
    var body = document.createElement('div');
    body.className = 'bhchat-onboard-body';
    bodyFill(body);
    var actions = document.createElement('div');
    actions.className = 'bhchat-onboard-actions';
    addSkip(actions);
    (extraBtns || []).forEach(function (btn) {
      actions.appendChild(btn);
    });
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actions);
    root.appendChild(card);
  }

  function appendText(body, value) {
    var p = document.createElement('p');
    p.className = 'bhchat-onboard-text';
    p.textContent = value;
    body.appendChild(p);
  }

  function render() {
    injectStyle();
    var root = host();
    root.innerHTML = '';
    if (!state.active) {
      clearHost();
      return;
    }
    if (state.step === 'welcome') {
      renderWelcome(root);
      return;
    }
    if (state.step === 'settings') {
      renderDocked(
        root,
        'BHC 设置',
        '入口',
        function (body) {
          appendText(body, '我帮你打开了官方设置。左侧侧栏里的「BetterHeyboxChat」就是以后找 BHC 的地方。');
          appendText(body, '框架版本、插件开关、重看引导都在这一页。先认一下，下一步再进插件市场。');
        },
        [makeBtn('下一步', 'primary', goNext)],
      );
      return;
    }
    if (state.step === 'market') {
      renderDocked(
        root,
        '插件市场',
        '管理插件',
        function (body) {
          appendText(body, '装、卸、更新都在这一页。以后从 BHC 设置里点插件市场的「设置」就能回来。');
        },
        [makeBtn('下一步', 'primary', goNext)],
      );
      return;
    }
    if (state.step === 'usage') {
      renderDocked(
        root,
        '装了之后怎么用',
        '推荐插件',
        function (body) {
          var ul = document.createElement('ul');
          ul.className = 'bhchat-onboard-list';
          RECOMMENDED.forEach(function (item) {
            var li = document.createElement('li');
            var name = document.createElement('strong');
            name.textContent = item.name;
            li.appendChild(name);
            li.appendChild(document.createTextNode('：' + item.usage));
            ul.appendChild(li);
          });
          body.appendChild(ul);
        },
        [makeBtn('下一步', 'primary', goNext)],
      );
      return;
    }
    if (state.step === 'install') {
      renderDocked(
        root,
        '安装推荐插件',
        '已在货架勾选',
        function (body) {
          appendText(body, '推荐项已勾选。点一次即可安装，不会自动重启。');
          if (state.installStatus) appendText(body, state.installStatus);
          if (state.installing) {
            var bar = document.createElement('div');
            bar.className = 'bhchat-onboard-progress';
            var inner = document.createElement('div');
            inner.className = 'bhchat-onboard-progress-bar';
            inner.style.width = state.percent + '%';
            bar.appendChild(inner);
            body.appendChild(bar);
          }
          if (state.installError) {
            var err = document.createElement('p');
            err.className = 'bhchat-onboard-error';
            err.textContent = state.installError;
            body.appendChild(err);
          }
        },
        [makeBtn(state.installing ? '安装中…' : '安装已勾选', 'primary', installRecommended, state.installing)],
      );
      return;
    }
    if (state.step === 'restart') {
      renderDocked(
        root,
        '重启后生效',
        '可以稍后',
        function (body) {
          appendText(
            body,
            (state.installedIds.length ? '已安装 ' + state.installedIds.join('、') + '。' : '推荐插件已就绪。') +
              '这些插件重启客户端后才会加载。',
          );
          if (state.installError) {
            var err = document.createElement('p');
            err.className = 'bhchat-onboard-error';
            err.textContent = state.installError;
            body.appendChild(err);
          }
        },
        [makeBtn('稍后', 'secondary', later), makeBtn('立即重启', 'primary', restartNow)],
      );
    }
  }

  function waitSessionReady() {
    return new Promise(function (resolve) {
      if (!window.BHChat.session || typeof window.BHChat.session.restore !== 'function') {
        resolve();
        return;
      }
      if (!isRestoring()) {
        resolve();
        return;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      window.BHChat.on('session-ready', finish);
      setTimeout(finish, 8000);
    });
  }

  function maybeAutoStart() {
    if (state.active) return;
    return loadRecord().then(function (record) {
      if (!shouldAutoStart(record, userPlugins().length)) return;
      return waitFor(isLoggedIn, 30000).then(function (loggedIn) {
        if (!loggedIn) return;
        return waitFor(function () {
          return !isScreenSharing();
        }, 120000).then(function (idle) {
          if (!idle || state.active) return;
          return loadRecord().then(function (again) {
            if (!shouldAutoStart(again, userPlugins().length)) return;
            start({ replay: false });
          });
        });
      });
    });
  }

  function boot() {
    if (bootStarted || !window.BHChat) return;
    bootStarted = true;
    waitSessionReady()
      .then(maybeAutoStart)
      .catch(function (err) {
        console.warn('[BetterHeyboxChat] onboard boot failed:', err);
      });
  }

  function attach() {
    window.BHChat.onboard = {
      recommend: RECOMMENDED.slice(),
      isActive: function () {
        return !!state.active;
      },
      getStep: function () {
        return state.step;
      },
      start: start,
      replay: replay,
      skip: skip,
      finish: finish,
    };
    window.BHChat.on('ready', boot);
    window.BHChat.on('session-ready', function () {
      if (bootStarted) maybeAutoStart();
      else boot();
    });
  }

  if (window.BHChat) {
    attach();
    if (document.body) injectStyle();
  }
})();
