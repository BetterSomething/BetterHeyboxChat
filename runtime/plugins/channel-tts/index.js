/**
 * 频道文字消息 TTS：朗读当前房间当前文字频道的新消息。
 * 消息来源：官方 EventBus SOCKET_SEND_MESSAGE / SOCKET_USER_IM_MESSAGE
 *（与客户端 handleNewIM 相同通道，不扫历史、不碰 Webpack 数字 ID）。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'channel-tts';
  var STORAGE_KEY = 'settings';
  var BUS_EVENTS = ['SOCKET_SEND_MESSAGE', 'SOCKET_USER_IM_MESSAGE'];

  var RECEIVE_PRIVATE = 1;
  var RECEIVE_AUDIO_CHANNEL = 2;
  var RECEIVE_TEXT_CHANNEL = 3;
  var RECEIVE_CHAT_GROUP = 5;
  var RECEIVE_GLOBAL_TEAM = 6;

  var SPEAKABLE_TYPES = {
    text: true,
    pure_text: true,
    html: true,
    markdown: true,
    textAndImg: true,
    AtOrChannel: true,
    1: true,
    2: true,
    4: true,
    6: true,
    10: true,
  };

  var SKIP_TYPES = {
    sticker: true,
    img: true,
    uploadFile: true,
    teamCard: true,
    teamInvite: true,
    channelAnc: true,
    bot: true,
    teamCardV2: true,
    welcomeMsg: true,
    cdKey: true,
    postComment: true,
    post: true,
    vote: true,
    voteAnc: true,
    customCard: true,
    punishNotify: true,
    fight: true,
    miniProgram: true,
    miniProDetail: true,
    screenShareGift: true,
    feedbackCard: true,
    groupAnnouncement: true,
    chatGroupUniversal: true,
    globalTeamVoiceInvite: true,
    3: true,
    5: true,
    7: true,
    8: true,
    9: true,
    11: true,
    12: true,
    13: true,
    14: true,
    15: true,
    16: true,
    17: true,
    18: true,
    19: true,
    20: true,
    22: true,
    23: true,
    24: true,
    25: true,
    26: true,
    27: true,
    29: true,
    30: true,
    31: true,
  };

  var DEFAULTS = {
    rate: 1,
    volume: 1,
    speakName: true,
  };

  var settings = {
    rate: DEFAULTS.rate,
    volume: DEFAULTS.volume,
    speakName: DEFAULTS.speakName,
  };

  var storeNs = null;
  var queue = [];
  var speaking = false;
  var currentUtterance = null;
  var resumeTimer = null;
  var seenKeys = {};
  var seenCount = 0;
  var lastScopeKey = '';
  var hookStatus = '等待客户端事件总线…';
  var lastStatus = '';
  var busRetry = null;
  var unwatchScope = null;
  var hookedBus = null;

  function clamp(n, min, max) {
    n = Number(n);
    if (isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function getNs() {
    if (storeNs) return storeNs;
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      storeNs = window.BHChat.storage.ns(PLUGIN_ID);
    }
    return storeNs;
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      rate: clamp(raw.rate != null ? raw.rate : DEFAULTS.rate, 0.5, 2),
      volume: clamp(raw.volume != null ? raw.volume : DEFAULTS.volume, 0, 1),
      speakName: raw.speakName !== false,
    };
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) {
      settings = normalizeSettings(DEFAULTS);
      return Promise.resolve(settings);
    }
    return ns.get(STORAGE_KEY).then(function (saved) {
      settings = normalizeSettings(saved);
      return settings;
    });
  }

  function saveSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      rate: settings.rate,
      volume: settings.volume,
      speakName: settings.speakName,
    });
  }

  function mapState(keys) {
    if (window.BHChat && window.BHChat.mapState) {
      return window.BHChat.mapState(keys) || {};
    }
    return {};
  }

  function pushChannelId(list, value) {
    if (value != null && value !== '') list.push(String(value));
  }

  function pushChannel(list, channel) {
    if (channel && channel.channel_id != null) pushChannelId(list, channel.channel_id);
  }

  function currentScope() {
    var snap = mapState([
      'cur_room_data',
      'cur_text_channel_data',
      'cur_channel_data',
      'channel_data',
      'channelIMId',
      'user_info',
    ]);
    var room = snap.cur_room_data || null;
    var channelIds = [];
    pushChannelId(channelIds, snap.channelIMId);
    pushChannel(channelIds, snap.channel_data);
    pushChannel(channelIds, snap.cur_text_channel_data);
    pushChannel(channelIds, snap.cur_channel_data);
    return {
      roomId: room && room.room_id != null ? String(room.room_id) : '',
      channelIds: unique(channelIds),
      userId: snap.user_info && snap.user_info.user_id != null ? String(snap.user_info.user_id) : '',
    };
  }

  function unique(list) {
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) {
        seen[list[i]] = true;
        out.push(list[i]);
      }
    }
    return out;
  }

  function looksLikeIm(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (
      obj.channel_id != null ||
      obj.im_seq != null ||
      obj.msg_id != null ||
      obj.receive_type != null ||
      typeof obj.msg === 'string' ||
      typeof obj.text === 'string'
    );
  }

  function unwrapMsg(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (looksLikeIm(payload)) return payload;
    if (payload.data && looksLikeIm(payload.data)) return payload.data;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    return payload;
  }

  function msgKey(msg) {
    if (!msg) return '';
    if (msg.msg_id != null && msg.msg_id !== '') return 'id:' + msg.msg_id;
    if (msg.im_seq != null && msg.im_seq !== '') return 'im:' + msg.im_seq;
    if (msg.sequence != null && msg.sequence !== '') return 'seq:' + msg.sequence;
    if (msg.key != null && msg.key !== '') return 'key:' + msg.key;
    return [
      msg.room_id || '',
      msg.channel_id || '',
      msg.user_id || '',
      msg.msg || msg.text || '',
      msg.timestamp || msg.time || msg.send_time || '',
    ].join('|');
  }

  function remember(key) {
    if (!key) return false;
    if (seenKeys[key]) return false;
    seenKeys[key] = true;
    seenCount += 1;
    if (seenCount > 400) {
      seenKeys = {};
      seenCount = 0;
      seenKeys[key] = true;
      seenCount = 1;
    }
    return true;
  }

  function decodeHtml(text) {
    return String(text)
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripMarkup(text) {
    text = String(text || '');
    text = text.replace(/<img[\s\S]*?(?:>|\/>)/gi, '');
    text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    text = text.replace(/\[custom[^\]]*\]/g, '');
    text = text.replace(/\[表情\]/g, '');
    text = text.replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]+>/g, '');
    text = decodeHtml(text);
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function isMostlyNonSpeech(text) {
    if (!text) return true;
    var stripped = text
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[\s.,!?;:，。！？、…~～·\-_=+*#@/\\|()[\]{}<>'"`“”‘’]/g, '');
    if (!stripped) return true;
    var noEmoji = stripped.replace(
      /[\u2190-\u21ff\u2300-\u27bf\u2b00-\u2bff\u3000-\u303f\u3297\u3299\ud83c-\ud83e]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]/g,
      '',
    );
    if (!noEmoji) return true;
    return noEmoji.length < 1;
  }

  function isSpeakableType(msg) {
    var type = msg.msg_type;
    if (type == null || type === '') return true;
    if (SKIP_TYPES[type]) return false;
    if (SPEAKABLE_TYPES[type]) return true;
    return true;
  }

  function extractText(msg) {
    if (!msg || msg.updated || msg.is_revoke) return '';
    if (!isSpeakableType(msg)) return '';
    var raw = msg.msg != null ? msg.msg : msg.text;
    if (typeof raw !== 'string') raw = '';
    return stripMarkup(raw);
  }

  function extractName(msg) {
    return (
      msg.room_nickname ||
      msg.nickname ||
      msg.username ||
      msg.user_name ||
      '有人'
    );
  }

  function receiveTypeNum(msg) {
    if (!msg || msg.receive_type == null || msg.receive_type === '') return null;
    var n = Number(msg.receive_type);
    return isNaN(n) ? null : n;
  }

  function isCurrentChannelMsg(msg, scope) {
    if (!msg || !scope) return false;
    var receiveType = receiveTypeNum(msg);
    if (
      receiveType === RECEIVE_PRIVATE ||
      receiveType === RECEIVE_CHAT_GROUP ||
      receiveType === RECEIVE_GLOBAL_TEAM
    ) {
      return false;
    }
    if (msg.room_id != null && scope.roomId && String(msg.room_id) !== scope.roomId) return false;
    if (msg.channel_id == null || msg.channel_id === '') return false;
    if (!scope.channelIds.length) return false;
    return scope.channelIds.indexOf(String(msg.channel_id)) !== -1;
  }

  function getSynth() {
    return window.speechSynthesis || null;
  }

  function stopSpeaking() {
    queue = [];
    speaking = false;
    currentUtterance = null;
    var synth = getSynth();
    if (synth) {
      try {
        synth.cancel();
      } catch (err) {}
    }
    lastStatus = '已停止';
  }

  function startResumeWatch() {
    if (resumeTimer) return;
    resumeTimer = setInterval(function () {
      var synth = getSynth();
      if (speaking && synth && synth.speaking && synth.paused) {
        try {
          synth.resume();
        } catch (err) {}
      }
    }, 4000);
  }

  function speakNext() {
    if (speaking) return;
    var synth = getSynth();
    if (!synth) {
      hookStatus = '当前环境没有 Web Speech API';
      queue = [];
      return;
    }
    if (!queue.length) return;

    var item = queue.shift();
    var utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = 'zh-CN';
    utter.rate = settings.rate;
    utter.volume = settings.volume;
    utter.pitch = 1;
    currentUtterance = utter;
    speaking = true;
    lastStatus = '朗读中：' + item.text;

    var done = function () {
      if (currentUtterance !== utter) return;
      speaking = false;
      currentUtterance = null;
      if (!queue.length) lastStatus = '空闲';
      speakNext();
    };
    utter.onend = done;
    utter.onerror = done;

    try {
      if (synth.paused) synth.resume();
      synth.speak(utter);
      startResumeWatch();
    } catch (err) {
      console.warn('[BetterHeyboxChat] channel-tts speak failed:', err);
      done();
    }
  }

  function enqueue(text) {
    if (!text) return;
    queue.push({ text: text });
    if (queue.length > 20) queue = queue.slice(-20);
    lastStatus = '排队 ' + queue.length + ' 条';
    speakNext();
  }

  function skip(reason) {
    lastStatus = reason;
  }

  function onIncoming(payload) {
    try {
      var msg = unwrapMsg(payload);
      if (!msg) return skip('收到空消息');
      var key = msgKey(msg);
      if (!remember(key)) return;
      var scope = currentScope();
      if (scope.userId && msg.user_id != null && String(msg.user_id) === scope.userId) {
        return skip('已跳过：自己的消息');
      }
      if (!isCurrentChannelMsg(msg, scope)) {
        return skip(
          scope.channelIds.length
            ? '已跳过：不在当前频道'
            : '已跳过：未取到当前频道 ID',
        );
      }
      var text = extractText(msg);
      if (!text || isMostlyNonSpeech(text)) return skip('已跳过：无可朗读文本');
      if (settings.speakName) {
        text = extractName(msg) + '说：' + text;
      }
      enqueue(text);
    } catch (err) {
      console.warn('[BetterHeyboxChat] channel-tts message handler:', err);
    }
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

  function hookBus() {
    if (hookedBus) return true;
    var bus = getClientBus();
    if (!bus) return false;
    for (var i = 0; i < BUS_EVENTS.length; i++) {
      bus.$on(BUS_EVENTS[i], onIncoming);
    }
    hookedBus = bus;
    hookStatus = '已监听当前频道新文字消息';
    return true;
  }

  function startBusHook() {
    if (hookBus()) return;
    var tries = 0;
    busRetry = setInterval(function () {
      tries += 1;
      if (hookBus() || tries > 120) {
        clearInterval(busRetry);
        busRetry = null;
        if (!hookedBus) hookStatus = '未接到事件总线，TTS 暂不可用';
      }
    }, 500);
  }

  function onScopeChange() {
    var scope = currentScope();
    var key = scope.roomId + '|' + scope.channelIds.join(',');
    if (!lastScopeKey) {
      lastScopeKey = key;
      return;
    }
    if (key !== lastScopeKey) {
      lastScopeKey = key;
      stopSpeaking();
      lastStatus = '已切换频道，停止朗读';
    }
  }

  function startScopeWatch() {
    onScopeChange();
    if (window.BHChat && window.BHChat.watch) {
      unwatchScope = window.BHChat.watch(function () {
        var snap = mapState([
          'cur_room_data',
          'cur_text_channel_data',
          'cur_channel_data',
          'channel_data',
          'channelIMId',
        ]);
        var room = snap.cur_room_data;
        var textCh = snap.cur_text_channel_data;
        var voiceCh = snap.cur_channel_data;
        var channel = snap.channel_data;
        return [
          room && room.room_id,
          textCh && textCh.channel_id,
          voiceCh && voiceCh.channel_id,
          channel && channel.channel_id,
          snap.channelIMId,
        ].join('|');
      }, onScopeChange);
    }
  }

  function speakTest() {
    enqueue('这是频道文字消息朗读测试');
  }

  function registerApi() {
    if (!window.BHChat) return;
    window.BHChat.channelTts = {
      stop: stopSpeaking,
      test: speakTest,
      getSettings: function () {
        return {
          rate: settings.rate,
          volume: settings.volume,
          speakName: settings.speakName,
        };
      },
    };
  }

  function buildPanelComponent() {
    return {
      name: 'BhchatChannelTtsPanel',
      data: function () {
        return {
          rate: Math.round(settings.rate * 100),
          volume: Math.round(settings.volume * 100),
          speakName: settings.speakName,
          hookStatus: hookStatus,
          lastStatus: lastStatus,
          hasSynth: !!getSynth(),
        };
      },
      mounted: function () {
        this.syncFromPlugin();
        var self = this;
        this._timer = setInterval(function () {
          self.hookStatus = hookStatus;
          self.lastStatus = lastStatus;
        }, 500);
      },
      beforeDestroy: function () {
        if (this._timer) clearInterval(this._timer);
      },
      methods: {
        syncFromPlugin: function () {
          this.rate = Math.round(settings.rate * 100);
          this.volume = Math.round(settings.volume * 100);
          this.speakName = settings.speakName;
          this.hookStatus = hookStatus;
          this.lastStatus = lastStatus;
          this.hasSynth = !!getSynth();
        },
        persist: function () {
          settings.rate = clamp(this.rate / 100, 0.5, 2);
          settings.volume = clamp(this.volume / 100, 0, 1);
          settings.speakName = !!this.speakName;
          saveSettings();
        },
        onTest: function () {
          this.persist();
          speakTest();
        },
        onStop: function () {
          stopSpeaking();
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
          h('div', { class: 'cell-title' }, '频道文字消息 TTS'),
          h(
            'p',
            { class: 'bhchat-hint' },
            '朗读当前正在看的频道的新消息（含语音房文字）。不会读历史记录、自己发的消息、私聊或纯表情。',
          ),
        ];
        if (!this.hasSynth) {
          children.push(h('p', { class: 'bhchat-warn' }, '当前环境没有 Web Speech API，无法朗读。'));
        }
        children.push(
          h('div', { class: 'bhchat-list' }, [
            h('div', { class: 'row' }, [
              h('span', '语速 ' + (this.rate / 100).toFixed(2)),
              h('input', {
                class: 'bhchat-native-range',
                style: rangeStyle(this.rate, 50, 200),
                attrs: { type: 'range', min: '50', max: '200' },
                domProps: { value: String(this.rate) },
                on: {
                  input: function (e) {
                    self.rate = Number(e.target.value);
                    self.persist();
                  },
                },
              }),
            ]),
            h('div', { class: 'row' }, [
              h('span', '音量 ' + this.volume + '%'),
              h('input', {
                class: 'bhchat-native-range',
                style: rangeStyle(this.volume, 0, 100),
                attrs: { type: 'range', min: '0', max: '100' },
                domProps: { value: String(this.volume) },
                on: {
                  input: function (e) {
                    self.volume = Number(e.target.value);
                    self.persist();
                  },
                },
              }),
            ]),
            h(
              'div',
              {
                class: 'row bhchat-row-click',
                on: {
                  click: function () {
                    self.speakName = !self.speakName;
                    self.persist();
                  },
                },
              },
              [
                h('span', '朗读发送者昵称'),
                h('span', { class: { 'bhchat-switch': true, on: !!this.speakName } }, [
                  h('span', { class: 'bhchat-switch-core' }),
                ]),
              ],
            ),
          ]),
          h('div', { class: 'bhchat-actions' }, [
            btn('测试朗读', 'primary', this.onTest, !this.hasSynth),
            btn('立即停止', 'danger', this.onStop),
          ]),
        );
        if (this.hookStatus) {
          children.push(h('p', { class: 'bhchat-hint' }, this.hookStatus));
        }
        if (this.lastStatus) {
          children.push(h('p', { class: 'bhchat-hint' }, this.lastStatus));
        }
        return h('div', children);
      },
    };
  }

  function registerPanel() {
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '频道文字消息 TTS',
      component: buildPanelComponent(),
    });
  }

  function activate() {
    loadSettings().then(function () {
      registerApi();
      registerPanel();
      startScopeWatch();
      startBusHook();
      console.log('[BetterHeyboxChat] channel-tts plugin activated');
    });
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
