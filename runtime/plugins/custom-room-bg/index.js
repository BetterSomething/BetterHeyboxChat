/**
 * MVP 验证插件：自定义房间背景（按房间本地持久化）
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'bhchat.custom_room_bg';
  var LAYER_ID = 'bhchat-room-bg-layer';

  var bgMap = {};
  var lastRoomId = null;
  var unwatch = null;
  var applyRetry = null;

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

  function getCurrentRoom() {
    var mapped = window.BHChat && window.BHChat.mapState ? window.BHChat.mapState(['cur_room_data']) : null;
    if (mapped && mapped.cur_room_data) return mapped.cur_room_data;
    var store = getStore();
    if (store && store.getters && store.getters.cur_room_data) {
      return store.getters.cur_room_data;
    }
    return null;
  }

  function getRoomId() {
    var room = getCurrentRoom();
    return room && room.room_id ? String(room.room_id) : null;
  }

  function getRoomName() {
    var room = getCurrentRoom();
    return (room && room.room_name) || '当前房间';
  }

  async function loadMap() {
    if (window.BHChatStorage) {
      bgMap = (await window.BHChatStorage.get(STORAGE_KEY)) || {};
    }
    if (!bgMap || typeof bgMap !== 'object') bgMap = {};
  }

  async function saveMap() {
    if (window.BHChatStorage) {
      await window.BHChatStorage.set(STORAGE_KEY, bgMap);
    }
  }

  function cssImageUrl(url) {
    if (!url) return '';
    return 'url(' + JSON.stringify(url) + ')';
  }

  function isDataUrl(url) {
    return typeof url === 'string' && url.slice(0, 5) === 'data:';
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1920;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var scale = Math.min(1, max / Math.max(w, h, 1));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('无法读取图片'));
      };
      img.src = objectUrl;
    });
  }

  function getHost() {
    return document.querySelector('.layout-content-wrapper');
  }

  function ensureLayer() {
    var host = getHost();
    if (!host) return null;

    var layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.className = 'bhchat-room-bg-layer';
      host.insertBefore(layer, host.firstChild);
    }
    return layer;
  }

  function applyForRoom(roomId) {
    var host = getHost();
    if (!host) {
      if (applyRetry) clearTimeout(applyRetry);
      applyRetry = setTimeout(function () {
        applyForRoom(roomId);
      }, 200);
      return;
    }

    var config = roomId ? bgMap[roomId] : null;
    var layer = ensureLayer();

    if (!config || !config.url) {
      if (layer) {
        layer.style.backgroundImage = '';
        layer.style.opacity = '0';
      }
      host.classList.remove('bhchat-room-bg-hidden-official');
      return;
    }

    var opacity = typeof config.opacity === 'number' ? config.opacity : 1;
    var blur = typeof config.blur === 'number' ? config.blur : 0;

    layer.style.backgroundImage = cssImageUrl(config.url);
    layer.style.opacity = String(opacity);
    layer.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
    host.classList.add('bhchat-room-bg-hidden-official');
  }

  function tick() {
    var roomId = getRoomId();

    if (!roomId) {
      if (lastRoomId) {
        lastRoomId = null;
        applyForRoom(null);
      }
      return;
    }

    if (roomId !== lastRoomId) {
      lastRoomId = roomId;
      applyForRoom(roomId);
    }
  }

  function openPanel() {
    if (window.BHChat && window.BHChat.openSettings && window.BHChat.openSettings('betterheyboxchat')) {
      return;
    }
    console.warn('[BetterHeyboxChat] 原生设置未就绪，请从设置中打开 BetterHeyboxChat');
  }

  function registerApi() {
    if (!window.BHChat) return;

    window.BHChat.roomBg = {
      get: function (roomId) {
        roomId = roomId || getRoomId();
        return roomId ? bgMap[roomId] || null : null;
      },
      set: async function (url, options) {
        var roomId = getRoomId();
        if (!roomId) return false;
        options = options || {};
        bgMap[roomId] = {
          url: url,
          opacity: options.opacity != null ? options.opacity : 1,
          blur: options.blur != null ? options.blur : 0,
          localName: options.localName || '',
        };
        await saveMap();
        applyForRoom(roomId);
        return true;
      },
      clear: async function (roomId) {
        roomId = roomId || getRoomId();
        if (!roomId) return false;
        delete bgMap[roomId];
        await saveMap();
        applyForRoom(roomId);
        return true;
      },
      openPanel: openPanel,
      getAll: function () {
        return Object.assign({}, bgMap);
      },
    };

    window.BHChat.openRoomBgPanel = openPanel;
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatRoomBgPanel',
      data: function () {
        return {
          url: '',
          localName: '',
          opacity: 100,
          blur: 0,
          roomName: '当前房间',
          inRoom: false,
          statusText: '',
        };
      },
      computed: {
        previewStyle: function () {
          if (!this.url) return {};
          return {
            backgroundImage: cssImageUrl(this.url),
            opacity: String(this.opacity / 100),
            filter: this.blur > 0 ? 'blur(' + this.blur + 'px)' : 'none',
          };
        },
        urlFieldValue: function () {
          if (this.localName) return this.localName;
          if (isDataUrl(this.url)) return '本地图片';
          return this.url;
        },
      },
      mounted: function () {
        this.refresh();
        if (window.BHChat && window.BHChat.watch) {
          this._unwatch = window.BHChat.watch(
            function () {
              var mapped = window.BHChat.mapState(['cur_room_data']);
              return mapped && mapped.cur_room_data;
            },
            this.refresh,
          );
        }
      },
      beforeDestroy: function () {
        if (this._unwatch) this._unwatch();
      },
      methods: {
        refresh: function () {
          this.inRoom = !!getRoomId();
          this.roomName = getRoomName();
          var roomBg = window.BHChat && window.BHChat.roomBg;
          if (!roomBg) {
            this.statusText = '插件尚未就绪，请稍后重试。';
            return;
          }
          var config = roomBg.get();
          if (config) {
            this.url = config.url || '';
            this.localName = config.localName || (isDataUrl(this.url) ? '本地图片' : '');
            this.opacity = Math.round((config.opacity != null ? config.opacity : 1) * 100);
            this.blur = config.blur || 0;
          } else {
            this.url = '';
            this.localName = '';
            this.opacity = 100;
            this.blur = 0;
          }
          this.statusText = '';
        },
        onSave: function () {
          var self = this;
          var roomBg = window.BHChat && window.BHChat.roomBg;
          if (!roomBg) return;
          if (!this.inRoom) {
            this.statusText = '请先进入一个房间后再设置背景。';
            return;
          }
          var url = (this.url || '').trim();
          var promise = url
            ? roomBg.set(url, {
                opacity: this.opacity / 100,
                blur: this.blur,
                localName: this.localName,
              })
            : roomBg.clear();
          Promise.resolve(promise)
            .then(function () {
              self.statusText = '已保存';
              setTimeout(function () {
                self.statusText = '';
              }, 2000);
            })
            .catch(function () {
              self.statusText = '保存失败，图片可能太大';
            });
        },
        onClear: function () {
          var self = this;
          var roomBg = window.BHChat && window.BHChat.roomBg;
          if (!roomBg || !this.inRoom) return;
          Promise.resolve(roomBg.clear()).then(function () {
            self.url = '';
            self.localName = '';
            self.opacity = 100;
            self.blur = 0;
            self.statusText = '已清除';
          });
        },
        onChooseFile: function () {
          if (!this.inRoom) return;
          var input = this.$refs && this.$refs.bgFile;
          if (input) input.click();
        },
        onFileChange: function (e) {
          var self = this;
          var file = e && e.target && e.target.files && e.target.files[0];
          if (e && e.target) e.target.value = '';
          if (!file) return;
          this.statusText = '正在载入图片…';
          fileToDataUrl(file)
            .then(function (dataUrl) {
              self.url = dataUrl;
              self.localName = file.name || '本地图片';
              self.statusText = '';
            })
            .catch(function (err) {
              self.statusText = (err && err.message) || '载入失败';
            });
        },
        onUrlInput: function (e) {
          var value = e.target.value;
          this.localName = '';
          this.url = value;
        },
      },
      render: function (h) {
        var self = this;
        function rangeStyle(value, min, max) {
          var pct = ((Number(value) - min) / (max - min)) * 100;
          return {
            background:
              'linear-gradient(to right, var(--brand-text,#7dd95e) ' +
              pct +
              '%, var(--opacity-2,#ffffff14) ' +
              pct +
              '%)',
          };
        }
        function btn(text, kind, onClick, disabled) {
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
              on: { click: onClick },
            },
            text,
          );
        }
        var children = [
          h('div', { class: 'cell-title' }, '自定义房间背景'),
        ];
        if (!this.inRoom) {
          children.push(h('p', { class: 'bhchat-warn' }, '请先进入一个房间。'));
        }
        children.push(
          h('div', { class: 'bhchat-field' }, [
            h('span', { class: 'bhchat-field-label' }, '图片 URL'),
            h('div', { class: 'bhchat-file-row' }, [
              h('input', {
                class: 'bhchat-native-input',
                attrs: {
                  type: 'text',
                  placeholder: 'https:// 或选择本地图片',
                  disabled: !this.inRoom,
                },
                domProps: { value: this.urlFieldValue },
                on: { input: this.onUrlInput },
              }),
              h('input', {
                ref: 'bgFile',
                class: 'bhchat-file-hidden',
                attrs: { type: 'file', accept: 'image/*' },
                on: { change: this.onFileChange },
              }),
              btn('本地图片', 'secondary', this.onChooseFile, !this.inRoom),
            ]),
          ]),
          h('div', { class: 'bhchat-list' }, [
            h('div', { class: 'row' }, [
              h('span', '不透明度 ' + this.opacity + '%'),
              h('input', {
                class: 'bhchat-native-range',
                style: rangeStyle(this.opacity, 20, 100),
                attrs: { type: 'range', min: '20', max: '100', disabled: !this.inRoom },
                domProps: { value: String(this.opacity) },
                on: {
                  input: function (e) {
                    self.opacity = Number(e.target.value);
                  },
                },
              }),
            ]),
            h('div', { class: 'row' }, [
              h('span', '模糊 ' + this.blur + 'px'),
              h('input', {
                class: 'bhchat-native-range',
                style: rangeStyle(this.blur, 0, 30),
                attrs: { type: 'range', min: '0', max: '30', disabled: !this.inRoom },
                domProps: { value: String(this.blur) },
                on: {
                  input: function (e) {
                    self.blur = Number(e.target.value);
                  },
                },
              }),
            ]),
          ]),
          h('div', { class: 'bhchat-native-preview', style: this.previewStyle }),
          h('div', { class: 'bhchat-actions' }, [
            btn('保存背景', 'primary', this.onSave, !this.inRoom),
            btn('清除背景', 'danger', this.onClear, !this.inRoom),
          ]),
        );
        if (this.statusText) {
          children.push(h('p', { class: 'bhchat-hint' }, this.statusText));
        }
        return h('div', children);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: 'custom-room-bg',
      title: '自定义房间背景',
      component: buildPanelComponent(),
    });
  }

  function startWatch() {
    tick();
    if (window.BHChat && window.BHChat.watch) {
      unwatch = window.BHChat.watch(function () {
        var mapped = window.BHChat.mapState(['cur_room_data']);
        return mapped && mapped.cur_room_data;
      }, tick);
      return;
    }
    console.warn('[BetterHeyboxChat] BHChat.watch 不可用，房间背景无法订阅 Vuex');
  }

  async function activate() {
    window.BHChat.injectStyleUrl('../betterheyboxchat/plugins/custom-room-bg/style.css');
    await loadMap();
    registerApi();
    registerPanel();
    startWatch();
    console.log('[BetterHeyboxChat] custom-room-bg plugin activated');
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
