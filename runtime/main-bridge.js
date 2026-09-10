/**
 * BetterHeyboxChat 主进程桥：在明文 index.js 里先于 bytenode 主进程加载。
 *
 * 禁止替换 / Proxy BrowserWindow（Electron 原生类被换掉后窗口会只剩背景色）。
 * 只在 app 事件上挂 F12 快捷键和 IPC。
 */
'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');
const patchGuard = require('./lib/patch-guard.js');
const guestPolicy = require('./lib/guest-policy.js');
const perfPolicy = require('./lib/perf-policy.js');
const guestWatches = new Map();

const FLAG_PATH = path.join(__dirname, 'devtools.disabled');
const APP_DIR = path.join(__dirname, '..');

try {
  const ensured = patchGuard.ensurePatches(APP_DIR);
  if (ensured && ensured.repaired && ensured.repaired.length) {
    console.log('[BetterHeyboxChat] repaired patches:', ensured.repaired.join(', '));
  }
  patchGuard.ensureDefaultBlockFlags(__dirname);
} catch (err) {
  console.warn('[BetterHeyboxChat] ensure patches failed:', err);
}

function isDevToolsEnabled() {
  try {
    return !fs.existsSync(FLAG_PATH);
  } catch (err) {
    return true;
  }
}

function isAllowedCookieUrl(url) {
  return guestPolicy.isAllowedCookieUrl(url);
}

function resolveFrame(mod, processId, routingId) {
  try {
    if (!mod.webFrameMain || typeof mod.webFrameMain.fromId !== 'function') return null;
    return mod.webFrameMain.fromId(processId, routingId);
  } catch (err) {
    return null;
  }
}

function injectWatch(frame, watch) {
  if (!frame || !watch || typeof frame.executeJavaScript !== 'function') return;
  if (!guestPolicy.watchMatchesUrl(watch, frame.url)) return;
  const code = guestPolicy.buildInjectScript(watch);
  Promise.resolve(frame.executeJavaScript(code)).catch((err) => {
    console.warn('[BetterHeyboxChat] guest inject failed:', err);
  });
}

function injectWatches(frame) {
  guestWatches.forEach((watch) => {
    injectWatch(frame, watch);
  });
}

function attachGuest(mod, wc) {
  if (!wc || wc.__bhchat_guest || wc.isDestroyed()) return;
  wc.__bhchat_guest = true;
  wc.on('did-frame-navigate', (_event, _url, _code, _text, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) return;
    const frame = resolveFrame(mod, frameProcessId, frameRoutingId);
    if (frame) injectWatches(frame);
  });
  wc.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) return;
    const frame = resolveFrame(mod, frameProcessId, frameRoutingId);
    if (frame) injectWatches(frame);
  });
}

function attachShortcuts(win) {
  if (!win || !win.webContents || win.webContents.isDestroyed()) return;
  if (win.webContents.__bhchat_dt) return;
  win.webContents.__bhchat_dt = true;

  win.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsEnabled()) return;
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '');
    const open =
      key === 'F12' || ((input.control || input.meta) && input.shift && key.toLowerCase() === 'i');
    if (!open) return;
    try {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    } catch (err) {
      console.warn('[BetterHeyboxChat] openDevTools failed:', err);
    }
  });
}

function attachExisting(mod) {
  try {
    if (!mod.BrowserWindow || typeof mod.BrowserWindow.getAllWindows !== 'function') return;
    mod.BrowserWindow.getAllWindows().forEach((win) => {
      attachShortcuts(win);
      if (win && win.webContents) attachGuest(mod, win.webContents);
    });
  } catch (err) {
    console.warn('[BetterHeyboxChat] attach existing windows failed:', err);
  }
}

function patchElectron(mod) {
  if (!mod || !mod.app || mod.app.__bhchat_dt) return;

  try {
    perfPolicy.applyCommandLine(mod.app, perfPolicy.effectiveConfig());
  } catch (err) {
    console.warn('[BetterHeyboxChat] apply perf switches failed:', err);
  }

  mod.app.__bhchat_dt = true;
  function attachUpdateFilter(ses) {
    if (!ses) return;
    try {
      patchGuard.attachUpdateApiFilter(ses, function () {
        return patchGuard.readBlockFlags(__dirname);
      });
    } catch (err) {
      console.warn('[BetterHeyboxChat] wrap update api filter failed:', err);
    }
  }

  mod.app.on('browser-window-created', (_event, win) => {
    attachShortcuts(win);
    try {
      if (win && win.webContents) {
        attachGuest(mod, win.webContents);
        if (win.webContents.session) attachUpdateFilter(win.webContents.session);
      }
    } catch (err) {}
  });

  if (mod.app.isReady()) {
    attachExisting(mod);
    if (mod.session && mod.session.defaultSession) attachUpdateFilter(mod.session.defaultSession);
  } else {
    mod.app.whenReady().then(() => {
      attachExisting(mod);
      if (mod.session && mod.session.defaultSession) attachUpdateFilter(mod.session.defaultSession);
    });
  }

  if (mod.ipcMain) {
    try {
      patchGuard.wrapIpcMain(mod.ipcMain, function () {
        return patchGuard.readBlockFlags(__dirname);
      });
    } catch (err) {
      console.warn('[BetterHeyboxChat] wrap update ipc failed:', err);
    }
  }

  if (mod.ipcMain && !mod.ipcMain.__bhchat_dt_ipc) {
    mod.ipcMain.__bhchat_dt_ipc = true;
    mod.ipcMain.on('bhchat:open-devtools', (event) => {
      if (!isDevToolsEnabled()) return;
      try {
        const wc = event.sender;
        if (!wc || wc.isDestroyed()) return;
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'detach' });
      } catch (err) {
        console.warn('[BetterHeyboxChat] ipc openDevTools failed:', err);
      }
    });
    mod.ipcMain.handle('bhchat:get-session-cookies', async (event, filter) => {
      const url = (filter && filter.url) || 'https://api.xiaoheihe.cn';
      if (!isAllowedCookieUrl(url)) return [];
      try {
        const sender = event && event.sender;
        if (!sender || sender.isDestroyed() || !sender.session || !sender.session.cookies) {
          return [];
        }
        const list = await sender.session.cookies.get({ url: url });
        return (list || []).map((item) => ({
          name: item.name,
          value: item.value,
          domain: item.domain,
          path: item.path,
          httpOnly: !!item.httpOnly,
          secure: !!item.secure,
        }));
      } catch (err) {
        console.warn('[BetterHeyboxChat] get session cookies failed:', err);
        return [];
      }
    });
    mod.ipcMain.handle('bhchat:guest-watch', async (event, spec) => {
      const sanitized = guestPolicy.sanitizeWatch(spec);
      if (!sanitized.ok) return sanitized;
      guestWatches.set(sanitized.watch.id, sanitized.watch);
      const sender = event && event.sender;
      if (sender && !sender.isDestroyed()) {
        attachGuest(mod, sender);
        guestPolicy.collectGuestFrames(sender.mainFrame).forEach((item) => {
          injectWatch(item.frame, sanitized.watch);
        });
      }
      attachExisting(mod);
      return { ok: true, id: sanitized.watch.id };
    });
    mod.ipcMain.handle('bhchat:guest-unwatch', async (_event, id) => {
      const removed = guestWatches.delete(String(id || ''));
      return { ok: true, removed: removed };
    });
    mod.ipcMain.handle('bhchat:guest-list', async (event) => {
      const sender = event && event.sender;
      if (!sender || sender.isDestroyed()) return [];
      return guestPolicy.listGuestFrameInfo(sender.mainFrame);
    });
    mod.ipcMain.handle('bhchat:guest-run', async (event, opts) => {
      const code = opts && opts.code != null ? String(opts.code) : '';
      if (code.length > guestPolicy.SCRIPT_LIMIT) return { ok: false, error: 'js too long' };
      const sender = event && event.sender;
      if (!sender || sender.isDestroyed()) return { ok: false, error: 'no sender' };
      const needle = opts && opts.urlIncludes != null ? String(opts.urlIncludes) : '';
      const frames = guestPolicy.collectGuestFrames(sender.mainFrame);
      const results = [];
      for (let i = 0; i < frames.length; i++) {
        const item = frames[i];
        if (needle && String(item.url).indexOf(needle) === -1) continue;
        try {
          results.push(await item.frame.executeJavaScript(code));
        } catch (err) {
          console.warn('[BetterHeyboxChat] guest run failed:', err);
        }
      }
      return { ok: true, ran: results.length, results: results };
    });
    mod.ipcMain.handle('bhchat:cookies-make-embeddable', async (event, filter) => {
      const url = (filter && filter.url) || '';
      if (!guestPolicy.isAllowedCookieUrl(url)) {
        return guestPolicy.summarizeEmbedResult({ ok: false, changed: 0 });
      }
      try {
        const sender = event && event.sender;
        if (!sender || sender.isDestroyed() || !sender.session || !sender.session.cookies) {
          return guestPolicy.summarizeEmbedResult({ ok: false, changed: 0 });
        }
        const list = await sender.session.cookies.get({ url: url });
        let changed = 0;
        for (let i = 0; i < (list || []).length; i++) {
          const item = list[i];
          if (guestPolicy.isAlreadyEmbeddable(item)) continue;
          await sender.session.cookies.set(guestPolicy.toEmbeddableCookieDetails(item, url));
          changed += 1;
        }
        return guestPolicy.summarizeEmbedResult({ ok: true, changed: changed });
      } catch (err) {
        console.warn('[BetterHeyboxChat] make embeddable cookies failed:', err);
        return guestPolicy.summarizeEmbedResult({ ok: false, changed: 0 });
      }
    });
    mod.ipcMain.handle('bhchat:perf-get-status', async (event) => {
      const config = perfPolicy.effectiveConfig();
      const win = senderWindow(mod, event);
      return Object.assign(perfPolicy.getRuntimeStatus(config), {
        window: perfPolicy.windowStateFrom(win),
      });
    });
    mod.ipcMain.handle('bhchat:perf-set-config', async (_event, partial) => {
      const config = perfPolicy.writeConfig(partial || {});
      return {
        config: config,
        needsRestart: perfPolicy.needsRestart(config),
      };
    });
    mod.ipcMain.handle('bhchat:perf-window-state', async (event) => {
      return perfPolicy.windowStateFrom(senderWindow(mod, event));
    });
    mod.ipcMain.handle('bhchat:perf-clear-http-cache', async (event) => {
      try {
        const sender = event && event.sender;
        if (!sender || sender.isDestroyed() || !sender.session || typeof sender.session.clearCache !== 'function') {
          return { ok: false };
        }
        await sender.session.clearCache();
        return { ok: true };
      } catch (err) {
        console.warn('[BetterHeyboxChat] clear http cache failed:', err);
        return { ok: false };
      }
    });
    mod.ipcMain.handle('bhchat:perf-memory', async () => {
      return perfPolicy.collectAppMemory(mod);
    });
    mod.ipcMain.handle('bhchat:perf-trim', async (event) => {
      const config = perfPolicy.effectiveConfig();
      if (!config.enabled) return { ok: false, error: 'disabled', trimmed: 0 };
      const pids = perfPolicy.collectAppPids(mod, event && event.sender);
      return perfPolicy.emptyWorkingSet(pids);
    });
  }
}

function senderWindow(mod, event) {
  try {
    const sender = event && event.sender;
    if (!sender || sender.isDestroyed()) return null;
    if (mod.BrowserWindow && typeof mod.BrowserWindow.fromWebContents === 'function') {
      return mod.BrowserWindow.fromWebContents(sender);
    }
  } catch (err) {}
  return null;
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);
  if (request === 'electron') {
    try {
      patchElectron(result);
    } catch (err) {
      console.warn('[BetterHeyboxChat] patch electron failed:', err);
    }
  }
  return result;
};

console.log('[BetterHeyboxChat] main bridge loaded');
