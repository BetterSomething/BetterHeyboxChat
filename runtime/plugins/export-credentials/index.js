/**
 * 一键导出当前登录态与官方 API query（对照 official-cos-upload.md 第 0 节）。
 * 不把 pkey / Cookie 写入 BHChat.storage。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'export-credentials';
  var COLLECT_SRC = '../betterheyboxchat/plugins/export-credentials/collect.js';

  function getHelpers() {
    return window.BhchatExportCredentials || null;
  }

  function readLocalStorage() {
    var out = {};
    try {
      out.heybox_id = window.localStorage.getItem('heybox_id');
      out.pkey = window.localStorage.getItem('pkey');
    } catch (err) {
      /* 隐私模式或被禁用 */
    }
    return out;
  }

  function readUserInfo() {
    if (!window.BHChat || typeof window.BHChat.mapState !== 'function') return {};
    try {
      var mapped = window.BHChat.mapState(['user_info']);
      return (mapped && mapped.user_info) || {};
    } catch (err) {
      return {};
    }
  }

  function readSessionCookies() {
    var api = window.bhchatPreload && window.bhchatPreload.cookies;
    if (!api || typeof api.get !== 'function') return Promise.resolve([]);
    var helpers = getHelpers();
    var url = helpers && helpers.DEFAULT_COOKIE_URL ? helpers.DEFAULT_COOKIE_URL : 'https://api.xiaoheihe.cn';
    return Promise.resolve()
      .then(function () {
        return api.get(url);
      })
      .catch(function () {
        return [];
      });
  }

  function readClientVersion() {
    var api = window.electronAPI;
    if (!api || typeof api.getClientVersion !== 'function') return Promise.resolve('');
    return Promise.resolve()
      .then(function () {
        return api.getClientVersion();
      })
      .then(function (value) {
        return value == null ? '' : String(value);
      })
      .catch(function () {
        return '';
      });
  }

  function collectSnapshot() {
    var helpers = getHelpers();
    if (!helpers || typeof helpers.collectSnapshot !== 'function') {
      return Promise.reject(new Error('凭据收集模块未就绪'));
    }
    return Promise.all([readSessionCookies(), readClientVersion()]).then(function (parts) {
      return helpers.collectSnapshot({
        now: new Date().toISOString(),
        localStorage: readLocalStorage(),
        userInfo: readUserInfo(),
        window: window,
        sessionCookies: parts[0] || [],
        documentCookie: typeof document !== 'undefined' ? document.cookie : '',
        clientVersion: parts[1] || '',
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        resolve();
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(area);
    });
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.exportCredentials = {
      snapshot: collectSnapshot,
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatExportCredentialsPanel',
      data: function () {
        return {
          pending: false,
          statusText: '',
          lastText: '',
          preview: null,
        };
      },
      mounted: function () {
        this.refreshPreview();
      },
      methods: {
        refreshPreview: function () {
          var self = this;
          collectSnapshot()
            .then(function (snap) {
              self.preview = snap;
            })
            .catch(function () {
              self.preview = null;
            });
        },
        exportAs: function (kind) {
          var self = this;
          var helpers = getHelpers();
          if (this.pending || !helpers) return;
          this.pending = true;
          this.statusText = '正在收集登录态…';
          collectSnapshot()
            .then(function (snap) {
              self.preview = snap;
              var text = '';
              if (kind === 'query') text = snap.queryString || '';
              else if (kind === 'cookie') text = snap.cookieHeader || '';
              else if (kind === 'env') text = helpers.formatEnv(snap);
              else text = helpers.formatJson(snap);
              self.lastText = text;
              return copyText(text).then(function () {
                var extra =
                  snap.missing && snap.missing.length ? '（缺 ' + snap.missing.join('、') + '）' : '';
                self.statusText = '已复制到剪贴板' + extra;
              });
            })
            .catch(function (err) {
              self.statusText = (err && err.message) || '导出失败';
            })
            .then(function () {
              self.pending = false;
            });
        },
      },
      render: function (h) {
        var self = this;
        var preview = this.preview || {};
        var login = preview.login || {};
        function btn(text, kind, onClick, disabled) {
          return h(
            'button',
            {
              class: {
                'bhchat-btn': true,
                'bhchat-btn-primary': kind === 'primary',
                'bhchat-btn-secondary': kind === 'secondary',
                'is-disabled': !!disabled,
              },
              attrs: { type: 'button', disabled: !!disabled },
              on: { click: onClick },
            },
            text,
          );
        }
        var children = [
          h('div', { class: 'cell-title' }, '用户凭据导出'),
          h(
            'p',
            { class: 'bhchat-warn' },
            '导出含 pkey 和 Cookie，等同账号。不要发给别人，不要提交到仓库。',
          ),
          h('div', { class: 'bhchat-list' }, [
            h('div', { class: 'row' }, [
              h('span', 'heybox_id'),
              h('span', login.heybox_id || '未获取'),
            ]),
            h('div', { class: 'row' }, [
              h('span', 'pkey'),
              h('span', login.pkey ? '已获取' : '未获取'),
            ]),
            h('div', { class: 'row' }, [
              h('span', 'Cookie'),
              h(
                'span',
                preview.cookies && preview.cookies.length
                  ? preview.cookies.length + ' 条'
                  : '未获取',
              ),
            ]),
            h('div', { class: 'row' }, [
              h('span', 'chat_version'),
              h('span', (preview.query && preview.query.chat_version) || '-'),
            ]),
          ]),
          h('div', { class: 'bhchat-actions' }, [
            btn('导出并复制 JSON', 'primary', function () {
              self.exportAs('json');
            }, this.pending),
            btn('复制 Query', 'secondary', function () {
              self.exportAs('query');
            }, this.pending),
            btn('复制 Cookie', 'secondary', function () {
              self.exportAs('cookie');
            }, this.pending),
            btn('复制环境变量', 'secondary', function () {
              self.exportAs('env');
            }, this.pending),
          ]),
        ];
        if (this.statusText) {
          children.push(h('p', { class: 'bhchat-hint' }, this.statusText));
        }
        if (this.lastText) {
          children.push(
            h('div', { class: 'bhchat-field' }, [
              h('span', { class: 'bhchat-field-label' }, '导出内容（可再复制）'),
              h('textarea', {
                class: 'bhchat-native-input',
                attrs: {
                  readonly: 'readonly',
                  rows: 14,
                  spellcheck: 'false',
                },
                style: {
                  minHeight: '220px',
                  height: '220px',
                  fontFamily: 'ui-monospace,Consolas,monospace',
                  fontSize: '12px',
                  lineHeight: '1.45',
                  resize: 'vertical',
                  whiteSpace: 'pre',
                },
                domProps: { value: this.lastText },
              }),
            ]),
          );
        }
        return h('div', children);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '用户凭据导出',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    registerApi();
    registerPanel();
    console.log('[BetterHeyboxChat] export-credentials plugin activated');
  }

  function loadCollectThenActivate() {
    if (getHelpers()) {
      activate();
      return;
    }
    var script = document.createElement('script');
    script.src = COLLECT_SRC;
    script.onload = activate;
    script.onerror = function () {
      console.warn('[BetterHeyboxChat] export-credentials collect.js failed to load');
      activate();
    };
    document.head.appendChild(script);
  }

  if (window.BHChat) {
    window.BHChat.onReady(loadCollectThenActivate);
  }
})();
