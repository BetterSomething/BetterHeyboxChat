/**
 * 插件包 manifest 校验、路径安全、纯文本洗白。
 * 不含 Node 独有逻辑；inspectDirectory 接受传入的 fs。
 */
'use strict';

var MAX_DESC_LENGTH = 100;
var MAX_NAME_LENGTH = 80;
var MAX_AUTHOR_LENGTH = 80;
var ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function sanitizePlainText(value, maxLen) {
  var text = value == null ? '' : String(value);
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/[<>]/g, '');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

function sanitizeHttpUrl(value) {
  var raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  try {
    var url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch (err) {
    return '';
  }
}

function normalizeRelPath(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function isSafeRelPath(rel) {
  var n = normalizeRelPath(rel);
  if (!n) return false;
  if (/^[a-zA-Z]:/.test(n)) return false;
  var parts = n.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '' || parts[i] === '.' || parts[i] === '..') return false;
  }
  return true;
}

function parseManifest(raw) {
  var src = raw;
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: 'manifest.json 不是合法 JSON' };
    }
  }
  if (!src || typeof src !== 'object') {
    return { ok: false, error: 'manifest.json 无效' };
  }
  var id = sanitizePlainText(src.id, 64);
  if (!ID_RE.test(id)) {
    return { ok: false, error: '插件 id 只能是小写字母、数字和连字符' };
  }
  var entry = normalizeRelPath(src.entry || 'index.js');
  if (!isSafeRelPath(entry)) {
    return { ok: false, error: 'entry 路径不合法' };
  }
  var style = src.style ? normalizeRelPath(src.style) : '';
  if (style && !isSafeRelPath(style)) {
    return { ok: false, error: 'style 路径不合法' };
  }
  return {
    ok: true,
    manifest: {
      id: id,
      name: sanitizePlainText(src.name || id, MAX_NAME_LENGTH) || id,
      version: sanitizePlainText(src.version || '0.0.0', 32) || '0.0.0',
      author: sanitizePlainText(src.author, MAX_AUTHOR_LENGTH),
      repository: sanitizeHttpUrl(src.repository),
      desc: sanitizePlainText(src.desc, MAX_DESC_LENGTH),
      minClientVersion: sanitizePlainText(src.minClientVersion, 32),
      enabled: src.enabled !== false,
      entry: entry,
      style: style || '',
    },
  };
}

function fileMapKeys(map) {
  return Object.keys(map).map(normalizeRelPath);
}

function findPluginRoot(names) {
  var normalized = names.map(normalizeRelPath);
  if (normalized.indexOf('manifest.json') !== -1) return '';
  var roots = {};
  normalized.forEach(function (name) {
    var idx = name.indexOf('/');
    if (idx > 0) roots[name.slice(0, idx)] = true;
  });
  var rootList = Object.keys(roots);
  if (rootList.length === 1) {
    var prefix = rootList[0] + '/';
    if (normalized.indexOf(prefix + 'manifest.json') !== -1) return rootList[0];
  }
  return null;
}

function inspectFileMap(map) {
  var names = fileMapKeys(map);
  var bad = names.filter(function (n) {
    return !isSafeRelPath(n);
  });
  if (bad.length) {
    return { ok: false, error: 'zip/目录含有非法路径' };
  }
  var root = findPluginRoot(names);
  if (root === null) {
    return { ok: false, error: '未找到唯一的 manifest.json' };
  }
  var prefix = root ? root + '/' : '';
  var manifestRaw = map[prefix + 'manifest.json'] || map[normalizeRelPath(prefix + 'manifest.json')];
  if (!manifestRaw) {
    return { ok: false, error: '缺少 manifest.json' };
  }
  var parsed = parseManifest(
    Buffer.isBuffer(manifestRaw) ? manifestRaw.toString('utf8') : String(manifestRaw),
  );
  if (!parsed.ok) return parsed;
  var entryPath = prefix + parsed.manifest.entry;
  var hasEntry = Object.prototype.hasOwnProperty.call(map, entryPath);
  if (!hasEntry) {
    hasEntry = names.indexOf(normalizeRelPath(entryPath)) !== -1;
  }
  if (!hasEntry) {
    return { ok: false, error: '缺少入口文件 ' + parsed.manifest.entry };
  }
  return {
    ok: true,
    root: root,
    prefix: prefix,
    manifest: parsed.manifest,
    files: map,
  };
}

function walkDirectory(dir, fsApi, base, out) {
  var entries = fsApi.readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i];
    if (name === '.' || name === '..' || name === 'node_modules' || name === '.git') continue;
    var full = require('path').join(dir, name);
    var rel = require('path').relative(base, full).replace(/\\/g, '/');
    var stat = fsApi.statSync(full);
    if (stat.isDirectory()) {
      walkDirectory(full, fsApi, base, out);
    } else if (stat.isFile()) {
      if (!isSafeRelPath(rel)) {
        throw new Error('非法路径: ' + rel);
      }
      out[rel] = fsApi.readFileSync(full);
    }
  }
}

function inspectDirectory(dir, fsApi) {
  try {
    var map = {};
    walkDirectory(dir, fsApi, dir, map);
    return inspectFileMap(map);
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

function compareClientVersion(current, minRequired) {
  if (!minRequired) return true;
  var cur = String(current || '').split('.').map(function (n) {
    return parseInt(n, 10) || 0;
  });
  var min = String(minRequired).split('.').map(function (n) {
    return parseInt(n, 10) || 0;
  });
  var len = Math.max(cur.length, min.length);
  for (var i = 0; i < len; i++) {
    var a = cur[i] || 0;
    var b = min[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

module.exports = {
  MAX_DESC_LENGTH: MAX_DESC_LENGTH,
  sanitizePlainText: sanitizePlainText,
  sanitizeHttpUrl: sanitizeHttpUrl,
  parseManifest: parseManifest,
  inspectFileMap: inspectFileMap,
  inspectDirectory: inspectDirectory,
  isSafeRelPath: isSafeRelPath,
  normalizeRelPath: normalizeRelPath,
  compareClientVersion: compareClientVersion,
  ID_RE: ID_RE,
};
