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

const FLAG_PATH = path.join(__dirname, 'devtools.disabled');

function isDevToolsEnabled() {
  try {
    return !fs.existsSync(FLAG_PATH);
  } catch (err) {
    return true;
  }
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
    mod.BrowserWindow.getAllWindows().forEach(attachShortcuts);
  } catch (err) {
    console.warn('[BetterHeyboxChat] attach existing windows failed:', err);
  }
}

function patchElectron(mod) {
  if (!mod || !mod.app || mod.app.__bhchat_dt) return;

  mod.app.__bhchat_dt = true;
  mod.app.on('browser-window-created', (_event, win) => {
    attachShortcuts(win);
  });

  if (mod.app.isReady()) {
    attachExisting(mod);
  } else {
    mod.app.whenReady().then(() => attachExisting(mod));
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
  }
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
