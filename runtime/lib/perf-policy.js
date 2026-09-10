/**
 * 性能回收的通用策略（无插件 UI）。
 * 配置在数据根 perf-tune.json；主进程启动前读，用来加 Chromium 开关。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');

var CONFIG_NAME = 'perf-tune.json';
var PLUGIN_ID = 'perf-tune';
var TRIM_INTERVAL_MS = 60 * 1000;
var DISK_CACHE_A = 64 * 1024 * 1024;
var DISK_CACHE_C = 32 * 1024 * 1024;
var PROCESS_SET_QUOTA = 0x0100;
var PROCESS_QUERY_INFORMATION = 0x0400;

var appliedAtBoot = null;
var lastTrim = null;
var lastTrimAt = 0;

function normalizeMode(mode) {
  var text = String(mode || 'A').toUpperCase();
  if (text === 'B' || text === 'C') return text;
  return 'A';
}

function diskCacheBytesFor(mode) {
  return mode === 'C' ? DISK_CACHE_C : DISK_CACHE_A;
}

function normalizeConfig(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  var mode = normalizeMode(raw.mode);
  return {
    enabled: raw.enabled !== false,
    mode: mode,
    diskCacheBytes: diskCacheBytesFor(mode),
    inProcessGpu: mode === 'C',
  };
}

function snapshotOf(config) {
  config = normalizeConfig(config);
  return {
    enabled: !!config.enabled,
    diskCacheBytes: config.diskCacheBytes,
    inProcessGpu: !!config.inProcessGpu,
  };
}

function sameSnapshot(a, b) {
  if (!a || !b) return false;
  return (
    !!a.enabled === !!b.enabled &&
    Number(a.diskCacheBytes) === Number(b.diskCacheBytes) &&
    !!a.inProcessGpu === !!b.inProcessGpu
  );
}

function configPath() {
  try {
    var pluginStore = require('./plugin-store.js');
    return path.join(pluginStore.getDataRoot(), CONFIG_NAME);
  } catch (err) {
    return '';
  }
}

function readJson(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  if (!filePath) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  return true;
}

function hasPerfTunePlugin() {
  try {
    var pluginStore = require('./plugin-store.js');
    var list = pluginStore.listUserPlugins() || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === PLUGIN_ID) return true;
    }
  } catch (err) {}
  return false;
}

function readConfig() {
  return normalizeConfig(readJson(configPath(), { enabled: hasPerfTunePlugin(), mode: 'A' }));
}

function writeConfig(partial) {
  var current = readJson(configPath(), {});
  var next = normalizeConfig({
    enabled: partial && Object.prototype.hasOwnProperty.call(partial, 'enabled') ? partial.enabled : current.enabled,
    mode: partial && partial.mode != null ? partial.mode : current.mode,
  });
  if (!hasPerfTunePlugin()) next.enabled = false;
  writeJson(configPath(), { enabled: next.enabled, mode: next.mode });
  return next;
}

function effectiveConfig() {
  var cfg = readConfig();
  if (!hasPerfTunePlugin()) {
    return normalizeConfig({ enabled: false, mode: cfg.mode });
  }
  return cfg;
}

function applyCommandLine(app, config) {
  config = normalizeConfig(config);
  appliedAtBoot = snapshotOf(config);
  if (!app || !app.commandLine || typeof app.commandLine.appendSwitch !== 'function') {
    return { applied: false, reason: 'no-command-line' };
  }
  if (!config.enabled) return { applied: false, reason: 'disabled' };
  try {
    app.commandLine.appendSwitch('aggressive-cache-discard');
    app.commandLine.appendSwitch('disk-cache-size', String(config.diskCacheBytes));
    if (config.inProcessGpu) {
      app.commandLine.appendSwitch('in-process-gpu');
    }
    return { applied: true };
  } catch (err) {
    return { applied: false, reason: String(err && err.message ? err.message : err) };
  }
}

function needsRestart(config) {
  if (!appliedAtBoot) return true;
  return !sameSnapshot(appliedAtBoot, snapshotOf(config));
}

function windowStateFrom(win) {
  if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
    return { visible: true, minimized: false, focused: true, ok: false };
  }
  try {
    return {
      visible: typeof win.isVisible === 'function' ? !!win.isVisible() : true,
      minimized: typeof win.isMinimized === 'function' ? !!win.isMinimized() : false,
      focused: typeof win.isFocused === 'function' ? !!win.isFocused() : true,
      ok: true,
    };
  } catch (err) {
    return { visible: true, minimized: false, focused: true, ok: false };
  }
}

function collectAppPids(mod, sender) {
  var pids = {};
  function add(id) {
    id = Number(id);
    if (id > 0) pids[id] = true;
  }
  add(process.pid);
  try {
    if (mod && mod.app && typeof mod.app.getAppMetrics === 'function') {
      (mod.app.getAppMetrics() || []).forEach(function (item) {
        if (item && item.pid) add(item.pid);
      });
    }
  } catch (err) {}
  try {
    if (sender && typeof sender.getOSProcessId === 'function') add(sender.getOSProcessId());
  } catch (err) {}
  try {
    if (mod && mod.BrowserWindow && typeof mod.BrowserWindow.getAllWindows === 'function') {
      mod.BrowserWindow.getAllWindows().forEach(function (win) {
        if (!win || !win.webContents || win.webContents.isDestroyed()) return;
        if (typeof win.webContents.getOSProcessId === 'function') {
          add(win.webContents.getOSProcessId());
        }
      });
    }
  } catch (err) {}
  return Object.keys(pids).map(function (id) {
    return Number(id);
  });
}

function findShell() {
  var candidates = ['pwsh', 'pwsh.exe'];
  var root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  candidates.push(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  return candidates;
}

function emptyWorkingSet(pids) {
  var now = Date.now();
  if (lastTrimAt && now - lastTrimAt < TRIM_INTERVAL_MS) {
    lastTrim = { at: lastTrimAt, ok: false, skipped: 'rate-limit', trimmed: 0 };
    return Promise.resolve(lastTrim);
  }
  var list = (pids || [])
    .map(function (id) {
      return parseInt(id, 10);
    })
    .filter(function (id) {
      return id > 0;
    });
  if (!list.length) {
    lastTrim = { at: now, ok: false, error: 'no-pids', trimmed: 0 };
    return Promise.resolve(lastTrim);
  }

  var script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class BhWs {',
    '  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);',
    '  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool b, int p);',
    '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
    '  public static bool Trim(int pid) {',
    '    var h = OpenProcess(' + (PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION) + ', false, pid);',
    '    if (h == IntPtr.Zero) return false;',
    '    var ok = EmptyWorkingSet(h);',
    '    CloseHandle(h);',
    '    return ok;',
    '  }',
    '}',
    '"@',
    '$ids = @(' + list.join(',') + ')',
    '$n = 0',
    'foreach ($id in $ids) { if ([BhWs]::Trim([int]$id)) { $n++ } }',
    'Write-Output $n',
  ].join('\n');

  function runWith(cmd) {
    return new Promise(function (resolve) {
      var child;
      try {
        child = spawn(cmd, ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
        });
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message ? err.message : err) });
        return;
      }
      var out = '';
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        try {
          child.kill();
        } catch (err) {}
      }, 12000);
      child.stdout.on('data', function (buf) {
        out += String(buf);
      });
      child.on('error', function (err) {
        clearTimeout(timer);
        resolve({ ok: false, error: String(err && err.message ? err.message : err) });
      });
      child.on('close', function (code) {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ ok: false, error: 'timeout' });
          return;
        }
        var trimmed = parseInt(String(out).trim(), 10);
        if (!isFinite(trimmed)) trimmed = 0;
        resolve({ ok: code === 0 && trimmed > 0, trimmed: trimmed, exit: code });
      });
    });
  }

  var shells = findShell();
  function tryNext(i) {
    if (i >= shells.length) {
      lastTrimAt = Date.now();
      lastTrim = { at: lastTrimAt, ok: false, error: 'no-shell', trimmed: 0 };
      return Promise.resolve(lastTrim);
    }
    return runWith(shells[i]).then(function (result) {
      if (result && result.ok) {
        lastTrimAt = Date.now();
        lastTrim = { at: lastTrimAt, ok: true, trimmed: result.trimmed };
        return lastTrim;
      }
      if (result && result.error && /ENOENT|not found|不是内部/i.test(String(result.error))) {
        return tryNext(i + 1);
      }
      lastTrimAt = Date.now();
      lastTrim = {
        at: lastTrimAt,
        ok: false,
        error: result && result.error ? result.error : 'trim-failed',
        trimmed: result && result.trimmed ? result.trimmed : 0,
      };
      return lastTrim;
    });
  }

  return tryNext(0);
}

function collectAppMemory(mod) {
  var kb = 0;
  var count = 0;
  try {
    if (mod && mod.app && typeof mod.app.getAppMetrics === 'function') {
      (mod.app.getAppMetrics() || []).forEach(function (item) {
        var mem = item && item.memory;
        if (!mem) return;
        var ws = Number(mem.workingSetSize);
        if (ws > 0) {
          kb += ws;
          count += 1;
        }
      });
    }
  } catch (err) {}
  return { ok: kb > 0, workingSetKb: kb, processes: count };
}

function getRuntimeStatus(config) {
  config = normalizeConfig(config);
  return {
    config: config,
    applied: appliedAtBoot,
    needsRestart: needsRestart(config),
    lastTrim: lastTrim,
  };
}

module.exports = {
  PLUGIN_ID: PLUGIN_ID,
  CONFIG_NAME: CONFIG_NAME,
  TRIM_INTERVAL_MS: TRIM_INTERVAL_MS,
  DISK_CACHE_A: DISK_CACHE_A,
  DISK_CACHE_C: DISK_CACHE_C,
  normalizeConfig: normalizeConfig,
  snapshotOf: snapshotOf,
  sameSnapshot: sameSnapshot,
  readConfig: readConfig,
  writeConfig: writeConfig,
  effectiveConfig: effectiveConfig,
  applyCommandLine: applyCommandLine,
  needsRestart: needsRestart,
  windowStateFrom: windowStateFrom,
  collectAppPids: collectAppPids,
  emptyWorkingSet: emptyWorkingSet,
  collectAppMemory: collectAppMemory,
  getRuntimeStatus: getRuntimeStatus,
  hasPerfTunePlugin: hasPerfTunePlugin,
};
