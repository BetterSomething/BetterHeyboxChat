/**
 * 启动时补回被热更新盖掉的 patch，并按标记拦截官方更新 IPC。
 * index.html 的 .backup 若还指向已经删掉的入口文件，会改成当前官方页面。
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
var BACKUP_DIR = '.backup';
var UPDATE_CHECK_PATH = '/chatroom/v2/settings/version/update/check';
var UPDATE_CONTENT_PATH = '/chatroom/v2/settings/version/content';
var UPDATE_API_FILTER = ['*://*/chatroom/v2/settings/version/*'];

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

function hasBlockUpdatePlugin() {
  try {
    var pluginStore = require('./plugin-store.js');
    var list = pluginStore.listUserPlugins() || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'block-update') return true;
    }
  } catch (err) {}
  return false;
}

function isUpdateApiUrl(url) {
  var text = String(url || '');
  return text.indexOf(UPDATE_CHECK_PATH) !== -1 || text.indexOf(UPDATE_CONTENT_PATH) !== -1;
}

function shouldBlockUpdateApi(flags, url) {
  flags = flags || {};
  if (!isUpdateApiUrl(url)) return false;
  return !!(flags.client || flags.hotfix);
}

function readBlockFlags(runtimeDir) {
  var saved = readJson(path.join(runtimeDir, BLOCK_FILE), {});
  return {
    client: !!saved.client,
    hotfix: !!saved.hotfix,
  };
}

function ensureDefaultBlockFlags(runtimeDir) {
  var filePath = path.join(runtimeDir, BLOCK_FILE);
  if (fs.existsSync(filePath)) return readBlockFlags(runtimeDir);
  if (!hasBlockUpdatePlugin()) return { client: false, hotfix: false };
  return writeBlockFlags(runtimeDir, { client: true, hotfix: true });
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

function stripHtmlSnippet(content) {
  return String(content || '').split(HTML_SNIPPET).join('');
}

function htmlLocalAssetRefs(html) {
  var refs = [];
  var re = /(?:^|\s)(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  var match;
  while ((match = re.exec(html))) {
    var rel = localWebappAsset(match[2]);
    if (rel) refs.push(rel);
  }
  return refs;
}

function localWebappAsset(value) {
  var pathOnly = String(value || '').trim().split(/[?#]/)[0];
  if (
    !pathOnly ||
    pathOnly.charAt(0) === '#' ||
    pathOnly.charAt(0) === '/' ||
    pathOnly.indexOf('//') === 0 ||
    pathOnly.indexOf('://') !== -1 ||
    pathOnly.indexOf('..') !== -1
  ) {
    return '';
  }
  return pathOnly;
}

function htmlLocalAssetsExist(webappDir, html) {
  var refs = htmlLocalAssetRefs(html);
  if (!refs.length) return null;
  for (var i = 0; i < refs.length; i++) {
    var filePath = path.join(webappDir, refs[i]);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  }
  return true;
}

function syncHtmlBackup(appDir, result) {
  var runtimeDir = path.join(appDir, 'betterheyboxchat');
  var livePath = path.join(appDir, 'webapp', 'index.html');
  if (!fs.existsSync(runtimeDir) || !fs.existsSync(livePath)) return;
  var official = stripHtmlSnippet(fs.readFileSync(livePath, 'utf8'));
  var webappDir = path.join(appDir, 'webapp');
  if (htmlLocalAssetsExist(webappDir, official) !== true) return;
  var backupPath = path.join(runtimeDir, BACKUP_DIR, 'webapp', 'index.html');
  if (fs.existsSync(backupPath)) {
    var backup = fs.readFileSync(backupPath, 'utf8');
    if (backup === official) return;
    if (htmlLocalAssetsExist(webappDir, backup) !== false) return;
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, official, 'utf8');
  result.htmlBackupRefreshed = true;
}

function ensurePatches(appDir) {
  var result = {
    repaired: [],
    intact: [],
    missing: [],
    envFixed: false,
    htmlBackupRefreshed: false,
    at: new Date().toISOString(),
  };
  repairHtml(appDir, result);
  syncHtmlBackup(appDir, result);
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

function attachUpdateApiFilter(session, getFlags) {
  if (!session || !session.webRequest || typeof session.webRequest.onBeforeRequest !== 'function') {
    return session;
  }
  if (session.webRequest.__bhchat_update_api) return session;
  session.webRequest.__bhchat_update_api = true;
  session.webRequest.onBeforeRequest({ urls: UPDATE_API_FILTER }, function (details, callback) {
    var flags = typeof getFlags === 'function' ? getFlags() || {} : {};
    if (shouldBlockUpdateApi(flags, details && details.url)) {
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  return session;
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
  UPDATE_CHECK_PATH: UPDATE_CHECK_PATH,
  UPDATE_CONTENT_PATH: UPDATE_CONTENT_PATH,
  UPDATE_API_FILTER: UPDATE_API_FILTER,
  resolveAppDir: resolveAppDir,
  ensurePatches: ensurePatches,
  readBlockFlags: readBlockFlags,
  writeBlockFlags: writeBlockFlags,
  ensureDefaultBlockFlags: ensureDefaultBlockFlags,
  readStatus: readStatus,
  writeStatus: writeStatus,
  isUpdateApiUrl: isUpdateApiUrl,
  shouldBlockUpdateApi: shouldBlockUpdateApi,
  wrapIpcMain: wrapIpcMain,
  attachUpdateApiFilter: attachUpdateApiFilter,
};
