/**
 * BetterHeyboxChat Preload Bridge
 * 在 preload 上下文中执行，可访问 Node.js 与 ipcRenderer。
 * 禁止改写 env.js：ELECTRON_ENV=local 会让正式包去拉调试前端，主界面变灰。
 */
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var ipcRenderer = require('electron').ipcRenderer;

  var DEVTOOLS_FLAG = path.join(__dirname, 'devtools.disabled');
  var STORAGE_KEY = 'bhchat.devtools.enabled';

  function persistEnabled(enabled) {
    var json = JSON.stringify(!!enabled);
    if (global.electronAPI && global.electronAPI.setData) {
      return global.electronAPI.setData(STORAGE_KEY, json);
    }
    return Promise.resolve();
  }

  function readEnabled() {
    if (global.electronAPI && global.electronAPI.getData) {
      return global.electronAPI.getData(STORAGE_KEY).then(function (raw) {
        if (raw == null || raw === '') return null;
        var value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return !!value;
      });
    }
    return Promise.resolve(null);
  }

  function writeDevToolsFlag(enabled) {
    if (enabled) {
      if (fs.existsSync(DEVTOOLS_FLAG)) fs.unlinkSync(DEVTOOLS_FLAG);
    } else {
      fs.writeFileSync(DEVTOOLS_FLAG, '1', 'utf8');
    }
  }

  function setNativeDevToolsEnabled(enabled) {
    try {
      writeDevToolsFlag(enabled);
    } catch (err) {
      console.warn('[BetterHeyboxChat] set DevTools flag failed:', err);
    }
    return persistEnabled(enabled).then(function () {
      return {
        enabled: enabled,
        restarted: false,
        message: enabled
          ? '已启用。按 F12 或 Ctrl+Shift+I 打开原生 DevTools。'
          : '已关闭原生 DevTools 快捷键。重启后完全生效。',
      };
    });
  }

  function isNativeDevToolsEnabled() {
    return readEnabled().then(function (stored) {
      if (stored != null) return stored;
      return !fs.existsSync(DEVTOOLS_FLAG);
    });
  }

  function getNativeDevToolsStatus() {
    return isNativeDevToolsEnabled().then(function (enabled) {
      return enabled
        ? '已启用。按 F12 或 Ctrl+Shift+I 打开原生 DevTools。'
        : '未启用原生 DevTools。';
    });
  }

  function openNativeDevTools() {
    return isNativeDevToolsEnabled().then(function (enabled) {
      if (!enabled) {
        return { ok: false, message: '原生 DevTools 已关闭，请先在设置中启用。' };
      }
      try {
        ipcRenderer.send('bhchat:open-devtools');
        return { ok: true, message: '已请求打开 DevTools。也可按 F12 / Ctrl+Shift+I。' };
      } catch (err) {
        return { ok: false, message: '无法发送打开 DevTools 请求。' };
      }
    });
  }

  var pluginStore = require('./lib/plugin-store.js');
  var patchGuard = require('./lib/patch-guard.js');
  var APP_DIR = path.join(__dirname, '..');

  window.bhchatPreload = {
    version: '0.1.0',
    ready: true,
    devtools: {
      isEnabled: isNativeDevToolsEnabled,
      getStatus: getNativeDevToolsStatus,
      setEnabled: setNativeDevToolsEnabled,
      open: openNativeDevTools,
    },
    plugins: {
      dataRoot: function () {
        return pluginStore.getDataRoot();
      },
      listUserPlugins: function () {
        return pluginStore.listUserPlugins();
      },
      inspectZipPath: function (p) {
        return pluginStore.inspectZipPath(p);
      },
      inspectZipBuffer: function (buf) {
        return pluginStore.inspectZipBuffer(Buffer.from(buf));
      },
      inspectFolderPath: function (p) {
        return pluginStore.inspectFolderPath(p);
      },
      installZipPath: function (p) {
        return pluginStore.installZipPath(p);
      },
      installZipBuffer: function (buf) {
        return pluginStore.installZipBuffer(Buffer.from(buf));
      },
      installFolderPath: function (p) {
        return pluginStore.installFolderPath(p);
      },
      uninstall: function (id) {
        return pluginStore.uninstall(id);
      },
      fetchRegistry: function (mirror) {
        return pluginStore.fetchRegistry({ mirror: mirror });
      },
      inspectRemote: function (opts) {
        return pluginStore.inspectRemote(opts || {});
      },
      installRemote: function (opts) {
        return pluginStore.installRemote(opts || {});
      },
      readUserFile: function (id, rel) {
        var buf = pluginStore.readUserFile(id, rel);
        return buf ? buf.toString('utf8') : null;
      },
    },
    patch: {
      getStatus: function () {
        return patchGuard.readStatus(__dirname);
      },
      ensure: function () {
        return patchGuard.ensurePatches(APP_DIR);
      },
    },
    updateBlock: {
      get: function () {
        return patchGuard.readBlockFlags(__dirname);
      },
      set: function (flags) {
        return patchGuard.writeBlockFlags(__dirname, flags);
      },
    },
  };

  console.log('[BetterHeyboxChat] preload bridge loaded');
})();
