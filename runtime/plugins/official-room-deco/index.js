/**
 * 探测官方房间背景写接口是否仍可用。
 * 复用客户端 webpack 模块 26737.DC 与 uploadCustomFile(source=room_deco_pic)，
 * 不读 canChangeBgPic / room_decorate 门闩。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'official-room-deco';
  var ROOM_API_ID = 26737;
  var UPLOADER_CHUNK = 7749;
  var UPLOADER_ID = 57749;
  var helpersCache = null;

  function createLocalHelpers() {
    var ROOM_DECORATE_CLOSE_ALL = 2;
    var ROOM_DECORATE_OPEN_ALL = 1;
    function pick(patchVal, roomVal, fallback) {
      if (patchVal != null) return patchVal;
      if (roomVal != null) return roomVal;
      return fallback;
    }
    function canSubmit(room) {
      if (!room || room.room_id == null || room.room_id === '') {
        return { ok: false, error: '请先进入一个房间' };
      }
      return { ok: true };
    }
    function isClientUploadBlocked(room, globalConfig) {
      var flag = globalConfig && globalConfig.numbers ? Number(globalConfig.numbers.room_decorate) : 0;
      if (flag === ROOM_DECORATE_CLOSE_ALL) return true;
      if (flag === ROOM_DECORATE_OPEN_ALL) return false;
      return !(room && room.can_change_bg_pic);
    }
    function asRoomId(value) {
      if (value == null || value === '') return '';
      return String(value);
    }
    function buildDecoratePayload(room, patch) {
      room = room || {};
      patch = patch || {};
      var nextPic = patch.bg_pic != null ? patch.bg_pic : room.bg_pic || '';
      var hasPic = !!nextPic;
      var mainColor = hasPic
        ? pick(patch.bg_pic_main_color, room.bg_pic_main_color, '#1F2225')
        : '';
      var barColor = hasPic
        ? pick(patch.bar_color, room.bar_color, '#1F2225,#1F2225')
        : pick(patch.bar_color, room.bar_color, '');
      return {
        type: pick(patch.type, null, 'room'),
        room_id: asRoomId(room.room_id),
        bg_color: hasPic ? '' : pick(patch.bg_color, room.bg_color, ''),
        transparency: Number(pick(patch.transparency, room.transparency, hasPic ? 70 : 0)) || 0,
        blur_rate: Number(pick(patch.blur_rate, room.blur_rate, 0)) || 0,
        main_color_v2: Number(pick(patch.main_color_v2, room.main_color_v2, 0)) || 0,
        bar_color: barColor,
        bar_main_color_v2: Number(pick(patch.bar_main_color_v2, room.bar_main_color_v2, 0)) || 0,
        bg_pic: hasPic ? nextPic : '',
        bg_pic_main_color: mainColor,
        show_channel_bar_filter: hasPic
          ? !!pick(patch.show_channel_bar_filter, room.show_channel_bar_filter, true)
          : false,
        can_change_bg_pic: !!hasPic,
      };
    }
    function parseDecorateResult(res) {
      var data = res && (res.data || res);
      if (!data || typeof data !== 'object') {
        return { ok: false, status: 'error', errorType: '', message: '无响应', raw: data || null };
      }
      if (data.status === 'ok') {
        return { ok: true, status: 'ok', errorType: '', message: '', result: data.result, raw: data };
      }
      return {
        ok: false,
        status: data.status || 'error',
        errorType: data.error_type || '',
        message: data.msg || data.message || data.error_type || '服务端拒绝',
        raw: data,
      };
    }
    function validateUploadFile(file, options) {
      options = options || {};
      if (!file) return { ok: false, error: '未选择文件' };
      if (file.size / 1024 > (options.maxKb || 5120)) return { ok: false, error: '不能上传超过5mb的图片！' };
      var type = file.type || '';
      if (type === 'image/gif' && !options.allowGif) {
        return { ok: false, error: '当前房间等级不支持 GIF' };
      }
      if (type && !/^image\/(jpeg|jpg|pjpeg|png|gif)$/i.test(type)) {
        return { ok: false, error: '仅支持 JPG / PNG / GIF' };
      }
      return { ok: true };
    }
    return {
      canSubmit: canSubmit,
      isClientUploadBlocked: isClientUploadBlocked,
      buildDecoratePayload: buildDecoratePayload,
      parseDecorateResult: parseDecorateResult,
      validateUploadFile: validateUploadFile,
    };
  }

  function getHelpers() {
    if (helpersCache) return helpersCache;
    if (window.BhchatOfficialRoomDeco) {
      helpersCache = window.BhchatOfficialRoomDeco;
      return helpersCache;
    }
    helpersCache = createLocalHelpers();
    window.BhchatOfficialRoomDeco = helpersCache;
    return helpersCache;
  }

  function getStore() {
    return window.BHChat && window.BHChat.getStore ? window.BHChat.getStore() : null;
  }

  function mapState(keys) {
    return window.BHChat && window.BHChat.mapState ? window.BHChat.mapState(keys) : {};
  }

  function getCurrentRoom() {
    var mapped = mapState(['cur_room_data']);
    if (mapped && mapped.cur_room_data) return mapped.cur_room_data;
    var store = getStore();
    if (store && store.getters && store.getters.cur_room_data) return store.getters.cur_room_data;
    return null;
  }

  function getGlobalConfig() {
    var mapped = mapState(['global_config']);
    if (mapped && mapped.global_config) return mapped.global_config;
    var store = getStore();
    if (store && store.getters && store.getters.global_config) return store.getters.global_config;
    if (store && store.state && store.state.global_config) return store.state.global_config;
    return null;
  }

  function getRequire() {
    return window.__bhchat_require__ || null;
  }

  function getRoomApi() {
    var req = getRequire();
    if (!req) return null;
    try {
      return req(ROOM_API_ID);
    } catch (err) {
      return null;
    }
  }

  function decorateRoom(payload) {
    var api = getRoomApi();
    if (!api || typeof api.DC !== 'function') {
      return Promise.reject(new Error('官方 decorate 模块未就绪（__bhchat_require__(26737).DC）'));
    }
    return api.DC({}, payload);
  }

  function fetchApplying() {
    var api = getRoomApi();
    if (!api || typeof api.lI !== 'function') {
      return Promise.reject(new Error('官方 decorate/applying 模块未就绪'));
    }
    var room = getCurrentRoom();
    return api.lI({ room_id: room && room.room_id });
  }

  function uploadRoomDecoPic(file) {
    var req = getRequire();
    if (!req || typeof req.e !== 'function') {
      return Promise.reject(new Error('官方上传模块未就绪'));
    }
    var ext = ((file.name && file.name.split('.').pop()) || 'jpg').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (file.type === 'image/png') ext = 'png';
    if (file.type === 'image/gif') ext = 'gif';
    return req.e(UPLOADER_CHUNK).then(function () {
      return req(UPLOADER_ID);
    }).then(function (mod) {
      var uploader = mod && (mod.default || mod);
      if (!uploader || typeof uploader.uploadCustomFile !== 'function') {
        throw new Error('uploadCustomFile 不可用');
      }
      return uploader.uploadCustomFile({
        type: 'pic',
        source: 'room_deco_pic',
        upload_infos: [{ file: file, ext: ext }],
      });
    });
  }

  function allowGif(room) {
    var level = room && room.room_task && Number(room.room_task.room_level);
    return level >= 3;
  }

  function snapshotRoom() {
    var helpers = getHelpers();
    var room = getCurrentRoom();
    var globalConfig = getGlobalConfig();
    var submit = helpers ? helpers.canSubmit(room, globalConfig) : { ok: false, error: 'helpers 未就绪' };
    return {
      room: room,
      roomId: room && room.room_id ? String(room.room_id) : '',
      roomName: (room && room.room_name) || '当前房间',
      canDecorate: !!(room && room.can_decorate),
      canChangeBgPic: !!(room && room.can_change_bg_pic),
      roomDecorate: globalConfig && globalConfig.numbers ? globalConfig.numbers.room_decorate : null,
      clientBlocked: helpers && room ? helpers.isClientUploadBlocked(room, globalConfig) : null,
      bgPic: (room && room.bg_pic) || '',
      canSubmit: submit.ok,
      submitError: submit.error || '',
    };
  }

  function stringifyResult(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  }

  async function submitDecorate(patch) {
    var helpers = getHelpers();
    var room = getCurrentRoom();
    var gate = helpers.canSubmit(room);
    if (!gate.ok) throw new Error(gate.error);
    var payload = helpers.buildDecoratePayload(room, patch);
    var res = await decorateRoom(payload);
    var parsed = helpers.parseDecorateResult(res);
    parsed.payload = payload;
    return parsed;
  }

  function fileMainColor(file) {
    return new Promise(function (resolve) {
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = 8;
          canvas.height = 8;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 8, 8);
          var data = ctx.getImageData(0, 0, 8, 8).data;
          var r = 0;
          var g = 0;
          var b = 0;
          var n = 0;
          for (var i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n += 1;
          }
          r = Math.round(r / n);
          g = Math.round(g / n);
          b = Math.round(b / n);
          resolve(
            '#' +
              [r, g, b]
                .map(function (x) {
                  return ('0' + x.toString(16)).slice(-2);
                })
                .join(''),
          );
        } catch (err) {
          resolve('#1F2225');
        }
        URL.revokeObjectURL(objectUrl);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        resolve('#1F2225');
      };
      img.src = objectUrl;
    });
  }

  async function forceUpload(file) {
    var helpers = getHelpers();
    var room = getCurrentRoom();
    var gate = helpers.canSubmit(room);
    if (!gate.ok) throw new Error(gate.error);
    var check = helpers.validateUploadFile(file, { allowGif: allowGif(room) });
    if (!check.ok) throw new Error(check.error);
    var uploaded = await uploadRoomDecoPic(file);
    var url = uploaded && (uploaded.url || uploaded.path);
    if (!url) throw new Error('上传成功但没有返回 url：' + stringifyResult(uploaded));
    var color = await fileMainColor(file);
    return submitDecorate({
      bg_pic: url,
      bg_pic_main_color: color,
      bar_color: color + ',' + color,
    }).then(function (parsed) {
      parsed.upload = uploaded;
      return parsed;
    });
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.officialRoomDeco = {
      snapshot: snapshotRoom,
      decorate: submitDecorate,
      upload: forceUpload,
      applying: fetchApplying,
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatOfficialRoomDecoPanel',
      data: function () {
        return {
          snap: snapshotRoom(),
          fileName: '',
          pending: false,
          statusText: '',
          lastResult: '',
          _file: null,
        };
      },
      mounted: function () {
        this.refresh();
        if (window.BHChat && window.BHChat.watch) {
          this._unwatch = window.BHChat.watch(function () {
            var mapped = window.BHChat.mapState(['cur_room_data']);
            return mapped && mapped.cur_room_data;
          }, this.refresh);
        }
      },
      beforeDestroy: function () {
        if (this._unwatch) this._unwatch();
      },
      methods: {
        refresh: function () {
          this.snap = snapshotRoom();
        },
        onChooseFile: function () {
          if (!this.snap.canSubmit || this.pending) return;
          var input = this.$refs && this.$refs.decoFile;
          if (input) input.click();
        },
        onFileChange: function (e) {
          var file = e && e.target && e.target.files && e.target.files[0];
          if (e && e.target) e.target.value = '';
          this._file = file || null;
          this.fileName = file ? file.name : '';
          this.statusText = file ? '已选择 ' + file.name : '';
        },
        run: function (task, doingText) {
          var self = this;
          if (this.pending) return;
          this.pending = true;
          this.statusText = doingText;
          this.lastResult = '';
          Promise.resolve()
            .then(task)
            .then(function (parsed) {
              self.lastResult = stringifyResult(parsed);
              self.statusText = parsed && parsed.ok ? '服务端接受了请求' : '服务端拒绝或返回非 ok';
              self.refresh();
            })
            .catch(function (err) {
              self.statusText = (err && err.message) || '请求失败';
              self.lastResult = stringifyResult({
                ok: false,
                message: self.statusText,
              });
            })
            .then(function () {
              self.pending = false;
            });
        },
        onForceUpload: function () {
          if (!this._file) {
            this.statusText = '请先选择一张图片';
            return;
          }
          var self = this;
          this.run(function () {
            return forceUpload(self._file);
          }, '正在走官方上传 + decorate…');
        },
        onProbeCurrent: function () {
          this.run(function () {
            return submitDecorate({});
          }, '正在提交当前主题…');
        },
        onApplying: function () {
          this.run(function () {
            return fetchApplying().then(function (res) {
              return { ok: true, applying: res && res.data ? res.data : res };
            });
          }, '正在查询审核状态…');
        },
      },
      render: function (h) {
        var self = this;
        var snap = this.snap || {};
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
          h('div', { class: 'cell-title' }, '官方房间背景探测'),
          h(
            'p',
            { class: 'bhchat-warn' },
            '这是官方全员背景，不是本地 custom-room-bg。上传会忽略客户端 can_change_bg_pic，服务端仍可能拒绝。',
          ),
        ];
        if (!snap.canSubmit) {
          children.push(h('p', { class: 'bhchat-warn' }, snap.submitError || '请先进入一个房间。'));
        }
        children.push(
          h('div', { class: 'bhchat-list' }, [
            h('div', { class: 'row' }, [h('span', '房间'), h('span', snap.roomName + ' / ' + (snap.roomId || '-'))]),
            h('div', { class: 'row' }, [h('span', 'can_decorate'), h('span', String(snap.canDecorate))]),
            h('div', { class: 'row' }, [h('span', 'can_change_bg_pic'), h('span', String(snap.canChangeBgPic))]),
            h('div', { class: 'row' }, [
              h('span', 'room_decorate'),
              h('span', snap.roomDecorate == null ? '-' : String(snap.roomDecorate)),
            ]),
            h('div', { class: 'row' }, [
              h('span', '客户端上传门闩'),
              h('span', snap.clientBlocked == null ? '-' : snap.clientBlocked ? '已关闭' : '未关'),
            ]),
          ]),
          h('div', { class: 'bhchat-field' }, [
            h('span', { class: 'bhchat-field-label' }, '当前官方 bg_pic'),
            h('input', {
              class: 'bhchat-native-input',
              attrs: { type: 'text', readonly: 'readonly' },
              domProps: { value: snap.bgPic || '（无）' },
            }),
          ]),
          h('div', { class: 'bhchat-field' }, [
            h('span', { class: 'bhchat-field-label' }, '强制上传图片'),
            h('div', { class: 'bhchat-file-row' }, [
              h('input', {
                class: 'bhchat-native-input',
                attrs: { type: 'text', readonly: 'readonly', placeholder: '未选择文件' },
                domProps: { value: this.fileName },
              }),
              h('input', {
                ref: 'decoFile',
                class: 'bhchat-file-hidden',
                attrs: { type: 'file', accept: 'image/jpeg,image/png,image/gif' },
                on: { change: this.onFileChange },
              }),
              btn('选择图片', 'secondary', this.onChooseFile, !snap.canSubmit || this.pending),
            ]),
          ]),
          h('div', { class: 'bhchat-actions' }, [
            btn('强制上传并保存', 'primary', this.onForceUpload, !snap.canSubmit || this.pending),
            btn('仅提交当前主题', 'secondary', this.onProbeCurrent, !snap.canSubmit || this.pending),
            btn('查询审核状态', 'secondary', this.onApplying, !snap.canSubmit || this.pending),
          ]),
        );
        if (this.statusText) {
          children.push(h('p', { class: 'bhchat-hint' }, this.statusText));
        }
        if (this.lastResult) {
          children.push(
            h('div', { class: 'bhchat-field' }, [
              h('span', { class: 'bhchat-field-label' }, '返回数据（可复制）'),
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
                domProps: { value: this.lastResult },
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
      title: '官方房间背景探测',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    if (window.BHChat && window.BHChat.injectStyleUrl) {
      window.BHChat.injectStyleUrl('../betterheyboxchat/plugins/official-room-deco/style.css');
    }
    getHelpers();
    registerApi();
    registerPanel();
    console.log('[BetterHeyboxChat] official-room-deco plugin activated');
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
