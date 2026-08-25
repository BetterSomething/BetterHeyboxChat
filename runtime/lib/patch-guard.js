/**
 * 启动时补回被热更新盖掉的 patch，并按标记拦截官方更新 IPC。
 * 供 main-bridge / preload-bridge 共用（Node 上下文）。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var MARKER_BEGIN = '// BetterHeyboxChat:begin';
var MARKER_END = '// BetterHeyboxChat:end';
var HTML_MARKER = '<!-- BetterHeyboxChat:begin -->';

var PRELOAD_SNIPPET = [
  MARKER_BEGIN,
  "try { require('../../betterheyboxchat/preload-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] preload bridge failed:', e); }",
  MARKER_END,
].join('\n');

var HTML_SNIPPET =
  HTML_MARKER +
  '<script src="../betterheyboxchat/webpack-hook.js"></script>' +
  '<script src="../betterheyboxchat/loader.js"></script>';

var INDEX_SNIPPET = [
  MARKER_BEGIN,
  "try { require('./betterheyboxchat/main-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] main bridge failed:', e); }",
  MARKER_END,
].join('\n');

var BLOCK_FILE = 'update-block.json';
var STATUS_FILE = 'patch-status.json';

function resolveAppDir(runtimeDir) {
  return path.join(runtimeDir, '..');
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readBlockFlags(runtimeDir) {
  var saved = readJson(path.join(runtimeDir, BLOCK_FILE), {});
  return {
    client: !!saved.client,
    hotfix: !!saved.hotfix,
  };
}

function writeBlockFlags(runtimeDir, flags) {
  flags = flags || {};
  var next = {
    client: !!flags.client,
    hotfix: !!flags.hotfix,
  };
  writeJson(path.join(runtimeDir, BLOCK_FILE), next);
  return next;
}

function readStatus(runtimeDir) {
  return readJson(path.join(runtimeDir, STATUS_FILE), null);
}

function writeStatus(runtimeDir, status) {
  writeJson(path.join(runtimeDir, STATUS_FILE), status);
  return status;
}

function repairHtml(appDir, result) {
  var filePath = path.join(appDir, 'webapp', 'index.html');
  if (!fs.existsSync(filePath)) {
    result.missing.push('webapp/index.html');
    return;
  }
  var original = fs.readFileSync(filePath, 'utf8');
  if (original.indexOf(HTML_MARKER) !== -1) {
    result.intact.push('webapp/index.html');
    return;
  }
  var injected = original.indexOf('<head>') !== -1
    ? original.replace('<head>', '<head>' + HTML_SNIPPET)
    : HTML_SNIPPET + original;
  fs.writeFileSync(filePath, injected, 'utf8');
  result.repaired.push('webapp/index.html');
}

function repairPreload(appDir, result) {
  var filePath = path.join(appDir, 'source', 'preload', 'index.js');
  if (!fs.existsSync(filePath)) {
    result.missing.push('source/preload/index.js');
    return;
  }
  var original = fs.readFileSync(filePath, 'utf8');
  if (original.indexOf(MARKER_BEGIN) !== -1) {
    result.intact.push('source/preload/index.js');
    return;
  }
  fs.writeFileSync(filePath, original.replace(/\s*$/, '') + '\n\n' + PRELOAD_SNIPPET + '\n', 'utf8');
  result.repaired.push('source/preload/index.js');
}

function repairIndexJs(appDir, result) {
  var filePath = path.join(appDir, 'index.js');
  if (!fs.existsSync(filePath)) {
    result.missing.push('index.js');
    return;
  }
  var original = fs.readFileSync(filePath, 'utf8');
  if (original.indexOf(MARKER_BEGIN) !== -1) {
    result.intact.push('index.js');
    return;
  }
  fs.writeFileSync(filePath, INDEX_SNIPPET + '\n\n' + original, 'utf8');
  result.repaired.push('index.js');
}

function repairEnv(appDir, result) {
  var filePath = path.join(appDir, 'env.js');
  if (!fs.existsSync(filePath)) return;
  var original = fs.readFileSync(filePath, 'utf8');
  if (!/ELECTRON_ENV:\s*'local'/.test(original)) return;
  fs.writeFileSync(filePath, original.replace(/ELECTRON_ENV:\s*'local'/, "ELECTRON_ENV: 'prod'"), 'utf8');
  result.envFixed = true;
}

function ensurePatches(appDir) {
  var result = {
    repaired: [],
    intact: [],
    missing: [],
    envFixed: false,
    at: new Date().toISOString(),
  };
  repairHtml(appDir, result);
  repairPreload(appDir, result);
  repairIndexJs(appDir, result);
  repairEnv(appDir, result);

  var runtimeDir = path.join(appDir, 'betterheyboxchat');
  if (fs.existsSync(runtimeDir)) {
    writeStatus(runtimeDir, result);
  }
  return result;
}

function wrapIpcMain(ipcMain, getFlags) {
  if (!ipcMain || typeof ipcMain.on !== 'function' || ipcMain.__bhchat_update_wrap) return ipcMain;
  ipcMain.__bhchat_update_wrap = true;
  var origOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = function (channel, listener) {
    if (
      channel === 'update-client' ||
      channel === 'updateAsarResource' ||
      channel === 'setAsarVersion'
    ) {
      return origOn(channel, function (event) {
        var flags = typeof getFlags === 'function' ? getFlags() || {} : {};
        if (channel === 'update-client' && flags.client) {
          try {
            event.sender.send('update-result', {
              ok: false,
              blocked: true,
              message: 'BetterHeyboxChat 已屏蔽客户端更新',
            });
          } catch (err) {}
          return;
        }
        if ((channel === 'updateAsarResource' || channel === 'setAsarVersion') && flags.hotfix) {
          if (channel === 'updateAsarResource') {
            try {
              event.sender.send('updateAsarResource:callback', 'error', {
                message: 'BetterHeyboxChat 已屏蔽热更新',
              });
            } catch (err) {}
          }
          return;
        }
        return listener.apply(this, arguments);
      });
    }
    return origOn.apply(this, arguments);
  };
  return ipcMain;
}

module.exports = {
  MARKER_BEGIN: MARKER_BEGIN,
  MARKER_END: MARKER_END,
  HTML_MARKER: HTML_MARKER,
  PRELOAD_SNIPPET: PRELOAD_SNIPPET,
  HTML_SNIPPET: HTML_SNIPPET,
  INDEX_SNIPPET: INDEX_SNIPPET,
  BLOCK_FILE: BLOCK_FILE,
  STATUS_FILE: STATUS_FILE,
  resolveAppDir: resolveAppDir,
  ensurePatches: ensurePatches,
  readBlockFlags: readBlockFlags,
  writeBlockFlags: writeBlockFlags,
  readStatus: readStatus,
  writeStatus: writeStatus,
  wrapIpcMain: wrapIpcMain,
};
