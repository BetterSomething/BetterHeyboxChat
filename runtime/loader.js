/**
 * BetterHeyboxChat 渲染进程入口
 * 依赖 index.html 中先于本脚本同步加载的 webpack-hook.js
 */
(function () {
  'use strict';

  var RUNTIME_SCRIPT = '../betterheyboxchat/runtime.js';
  var STORAGE_SCRIPT = '../betterheyboxchat/lib/storage.js';
  var INDICATOR_SCRIPT = '../betterheyboxchat/indicator.js';
  var PLUGINS_MANIFEST = '../betterheyboxchat/plugins.json';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Failed to load script: ' + src));
      };
      document.head.appendChild(script);
    });
  }

  function boot() {
    if (!window.__bhchat_webpack_hook__) {
      console.error('[BetterHeyboxChat] webpack hook missing — check patch order');
    }

    loadScript(STORAGE_SCRIPT)
      .then(function () {
        return loadScript(INDICATOR_SCRIPT);
      })
      .then(function () {
        if (window.__bhchat_bootstrap_patch__) {
          window.__bhchat_bootstrap_patch__();
        }
        return loadScript(RUNTIME_SCRIPT);
      })
      .then(function () {
        if (!window.BHChat) {
          throw new Error('BHChat runtime missing after load');
        }
        if (window.BHChat._loadEnabledMap) {
          return window.BHChat._loadEnabledMap();
        }
      })
      .then(function () {
        return fetch(PLUGINS_MANIFEST)
          .then(function (res) {
            if (!res.ok) throw new Error('plugins.json not found');
            return res.json();
          })
          .then(function (plugins) {
            return Promise.all(
              plugins.map(function (plugin) {
                window.BHChat._registerPlugin(plugin, false);
                if (window.BHChat.isPluginEnabled && !window.BHChat.isPluginEnabled(plugin.id)) {
                  console.log('[BetterHeyboxChat] plugin disabled, skip:', plugin.id);
                  return Promise.resolve();
                }
                return loadScript('../betterheyboxchat/plugins/' + plugin.id + '/' + plugin.entry).then(
                  function () {
                    window.BHChat._registerPlugin(plugin, true);
                  },
                );
              }),
            );
          })
          .catch(function (err) {
            console.warn('[BetterHeyboxChat] plugin load skipped:', err);
          });
      })
      .then(function () {
        window.BHChat._ready();
        console.log('[BetterHeyboxChat] loaded v' + window.BHChat.version);
      })
      .catch(function (err) {
        console.error('[BetterHeyboxChat] boot failed:', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
