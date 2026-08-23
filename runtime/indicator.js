/**
 * 注入成功指示角标（右下角小标记）
 */
(function () {
  'use strict';

  var INDICATOR_ID = 'bhchat-indicator';

  function mount() {
    if (document.getElementById(INDICATOR_ID)) return;

    var style = document.createElement('style');
    style.setAttribute('data-bhchat', 'indicator');
    style.textContent =
      '#' +
      INDICATOR_ID +
      '{' +
      'position:fixed;right:5px;bottom:5px;z-index:2147483646;' +
      'padding:0 4px;min-width:14px;height:14px;line-height:14px;' +
      'border-radius:3px;text-align:center;' +
      'font:9px/14px system-ui,sans-serif;font-weight:600;letter-spacing:.2px;' +
      'color:#134e3a;background:#6ee7b7;' +
      'opacity:.65;pointer-events:none;user-select:none;' +
      'box-shadow:0 0 0 1px rgba(0,0,0,.15);' +
      '}';
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.id = INDICATOR_ID;
    el.textContent = 'BH';
    el.title = 'BetterHeyboxChat';
    document.documentElement.appendChild(el);
  }

  function updateTitle() {
    var el = document.getElementById(INDICATOR_ID);
    if (!el) return;
    var ver = (window.BHChat && window.BHChat.version) || '0.1.0';
    el.title = 'BetterHeyboxChat v' + ver + ' 已加载';
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }

  if (window.BHChat) {
    window.BHChat.onReady(updateTitle);
  } else {
    var timer = setInterval(function () {
      if (window.BHChat) {
        clearInterval(timer);
        window.BHChat.onReady(updateTitle);
        updateTitle();
      }
    }, 200);
  }
})();
