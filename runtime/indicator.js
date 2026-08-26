/**
 * 注入成功指示角标（右下角小标记）
 */
(function () {
  'use strict';

  var INDICATOR_ID = 'bhchat-indicator';
  var STORAGE_KEY = 'bhchat.indicator.visible';
  var visible = true;

  function versionLabel() {
    var ver = (window.BHChat && window.BHChat.version) || '0.1.0';
    return 'BHC v' + ver;
  }

  function applyVisible() {
    var el = document.getElementById(INDICATOR_ID);
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  function applyLabel() {
    var el = document.getElementById(INDICATOR_ID);
    if (!el) return;
    var ver = (window.BHChat && window.BHChat.version) || '0.1.0';
    el.textContent = versionLabel();
    el.title = 'BetterHeyboxChat v' + ver + ' 已加载';
  }

  function persistVisible() {
    if (window.BHChatStorage) {
      return window.BHChatStorage.set(STORAGE_KEY, visible);
    }
    return Promise.resolve();
  }

  function setVisible(next) {
    visible = !!next;
    applyVisible();
    return persistVisible();
  }

  function isVisible() {
    return visible;
  }

  function loadVisible() {
    if (!window.BHChatStorage) return Promise.resolve();
    return window.BHChatStorage.get(STORAGE_KEY).then(function (saved) {
      if (saved === false) {
        visible = false;
        applyVisible();
      }
    });
  }

  function attachApi() {
    if (!window.BHChat) return false;
    window.BHChat.indicator = {
      isVisible: function () {
        return visible;
      },
      setVisible: function (next) {
        return Promise.resolve(setVisible(next)).then(function () {
          return { visible: visible };
        });
      },
    };
    return true;
  }

  function mount() {
    if (document.getElementById(INDICATOR_ID)) return;

    var style = document.createElement('style');
    style.setAttribute('data-bhchat', 'indicator');
    style.textContent =
      '#' +
      INDICATOR_ID +
      '{' +
      'position:fixed;right:5px;bottom:5px;z-index:2147483646;' +
      'padding:0 4px;height:13px;line-height:13px;' +
      'border-radius:3px;text-align:center;' +
      'font:8px/13px system-ui,sans-serif;font-weight:600;letter-spacing:.2px;' +
      'color:#134e3a;background:#6ee7b7;' +
      'opacity:.65;pointer-events:none;user-select:none;' +
      'box-shadow:0 0 0 1px rgba(0,0,0,.15);' +
      '}';
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.id = INDICATOR_ID;
    el.textContent = versionLabel();
    el.title = 'BetterHeyboxChat';
    document.documentElement.appendChild(el);
    applyVisible();
    loadVisible();
  }

  function onRuntimeReady() {
    attachApi();
    applyLabel();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }

  if (window.BHChat) {
    window.BHChat.onReady(onRuntimeReady);
    attachApi();
    applyLabel();
  } else {
    var timer = setInterval(function () {
      if (window.BHChat) {
        clearInterval(timer);
        window.BHChat.onReady(onRuntimeReady);
        onRuntimeReady();
      }
    }, 200);
  }
})();
