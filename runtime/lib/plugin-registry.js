/**
 * 在线插件货架：只拉 registry.json，按需下载某个插件目录。
 * fetch 可注入，便于单测不走外网。
 */
'use strict';

var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var pkg = require('./plugin-package.js');

var DEFAULT_BASE =
  'https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/';
var GITHUB_WEB_BASE =
  'https://github.com/BetterSomething/BetterHeyboxChat-plugins/blob/main/';
var MAX_FILES = 256;
var MAX_TOTAL_BYTES = 40 * 1024 * 1024;
var MAX_FILE_BYTES = 20 * 1024 * 1024;

function joinUrl(base, rel) {
  return String(base || '').replace(/\/+$/, '/') + String(rel || '').replace(/^\/+/, '');
}

function normalizeMirrorPrefix(mirror) {
  var raw = String(mirror || '').trim();
  if (!raw) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = 'https://' + raw.replace(/^\/+/, '');
  }
  var url = pkg.sanitizeHttpUrl(raw);
  if (!url) return '';
  if (url.charAt(url.length - 1) !== '/') url += '/';
  return url;
}

function resolveBase(mirror) {
  var raw = String(mirror || '').trim();
  if (!raw) return DEFAULT_BASE;
  var prefix = normalizeMirrorPrefix(raw);
  if (!prefix) return '';
  return prefix + GITHUB_WEB_BASE;
}

function collectRemoteRelPaths(manifest) {
  var out = [];
  function add(rel) {
    var n = pkg.normalizeRelPath(rel);
    if (!pkg.isSafeRelPath(n)) return;
    if (out.indexOf(n) === -1) out.push(n);
  }
  add('manifest.json');
  add((manifest && manifest.entry) || 'index.js');
  if (manifest && manifest.style) add(manifest.style);
  var extra = (manifest && manifest.files) || [];
  for (var i = 0; i < extra.length; i++) add(extra[i]);
  return out;
}

function parseRegistry(raw) {
  var src = raw;
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: 'registry.json 不是合法 JSON' };
    }
  }
  if (!src || typeof src !== 'object') {
    return { ok: false, error: 'registry.json 无效' };
  }
  if (Number(src.version) !== 1) {
    return { ok: false, error: '不支持的 registry 版本' };
  }
  if (!Array.isArray(src.plugins)) {
    return { ok: false, error: 'registry.plugins 必须是数组' };
  }
  var plugins = [];
  for (var i = 0; i < src.plugins.length; i++) {
    var item = src.plugins[i] || {};
    var parsed = pkg.parseManifest({
      id: item.id,
      name: item.name,
      version: item.version,
      author: item.author,
      desc: item.desc,
      minClientVersion: item.minClientVersion,
      entry: 'index.js',
    });
    if (!parsed.ok) continue;
    plugins.push({
      id: parsed.manifest.id,
      name: parsed.manifest.name,
      version: parsed.manifest.version,
      author: parsed.manifest.author,
      desc: parsed.manifest.desc,
      minClientVersion: parsed.manifest.minClientVersion,
    });
  }
  return { ok: true, version: 1, plugins: plugins };
}

function defaultFetch(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    var href = pkg.sanitizeHttpUrl(url);
    if (!href) {
      reject(new Error('非法下载地址'));
      return;
    }
    var lib = href.indexOf('https:') === 0 ? https : http;
    var req = lib.get(href, { timeout: 20000 }, function (res) {
      var loc = res.headers && res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 5) {
        res.resume();
        resolve(defaultFetch(loc, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('下载失败 HTTP ' + res.statusCode));
        return;
      }
      var chunks = [];
      var total = 0;
      res.on('data', function (chunk) {
        total += chunk.length;
        if (total > MAX_FILE_BYTES) {
          req.destroy();
          reject(new Error('文件过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

function isPathInside(root, candidate) {
  var rootAbs = path.resolve(root);
  var candAbs = path.resolve(candidate);
  var rel = path.relative(rootAbs, candAbs);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  var parts = rel.split(/[\\/]/);
  return parts.indexOf('..') === -1;
}

function resolveLocalRoot(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: '未设置本地插件仓路径' };
  if (!path.isAbsolute(raw)) return { ok: false, error: '本地插件仓路径必须是绝对路径' };
  var dir = path.normalize(raw);
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch (err) {
    return { ok: false, error: '本地插件仓路径不存在' };
  }
  for (var i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'registry.json'))) {
      return { ok: true, root: dir };
    }
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { ok: false, error: '未找到 registry.json' };
}

function fetchLocalRegistry(localRoot) {
  var resolved = resolveLocalRoot(localRoot);
  if (!resolved.ok) return resolved;
  try {
    return parseRegistry(fs.readFileSync(path.join(resolved.root, 'registry.json'), 'utf8'));
  } catch (err) {
    return { ok: false, error: '无法读取本地货架: ' + ((err && err.message) || err) };
  }
}

function inspectLocal(opts) {
  var resolved = resolveLocalRoot(opts && opts.localRoot);
  if (!resolved.ok) return Promise.resolve(resolved);
  var id = pkg.sanitizePlainText(opts && opts.id, 64);
  if (!pkg.ID_RE.test(id)) {
    return Promise.resolve({ ok: false, error: '非法插件 id' });
  }
  var pluginDir = path.join(resolved.root, id);
  if (!isPathInside(resolved.root, pluginDir)) {
    return Promise.resolve({ ok: false, error: '无法下载插件: 非法插件路径' });
  }
  var manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath) || !isPathInside(pluginDir, manifestPath)) {
    return Promise.resolve({ ok: false, error: '无法下载插件: 本地缺少 manifest.json' });
  }
  try {
    var manifestBuf = fs.readFileSync(manifestPath);
    var parsed = pkg.parseManifest(manifestBuf.toString('utf8'));
    if (!parsed.ok) return Promise.resolve(parsed);
    if (parsed.manifest.id !== id) {
      return Promise.resolve({ ok: false, error: 'manifest id 与目录不一致' });
    }
    if (!pkg.compareClientVersion(opts.clientVersion, parsed.manifest.minClientVersion)) {
      return Promise.resolve({ ok: false, error: '需要客户端 ' + parsed.manifest.minClientVersion });
    }
    var rels = collectRemoteRelPaths(parsed.manifest);
    if (rels.length > MAX_FILES) {
      return Promise.resolve({ ok: false, error: '插件文件过多' });
    }
    var map = {};
    var total = 0;
    for (var i = 0; i < rels.length; i++) {
      var rel = rels[i];
      var filePath = path.join(pluginDir, rel);
      if (!isPathInside(pluginDir, filePath)) {
        return Promise.resolve({ ok: false, error: '无法下载插件: 非法文件路径' });
      }
      if (!fs.existsSync(filePath)) {
        return Promise.resolve({ ok: false, error: '无法下载插件: 缺少 ' + rel });
      }
      var buf = fs.readFileSync(filePath);
      total += buf.length;
      if (total > MAX_TOTAL_BYTES) {
        return Promise.resolve({ ok: false, error: '插件过大' });
      }
      map[rel] = buf;
    }
    var inspected = pkg.inspectFileMap(map);
    if (!inspected.ok) return Promise.resolve(inspected);
    if (inspected.manifest.id !== id) {
      return Promise.resolve({ ok: false, error: 'manifest id 与目录不一致' });
    }
    inspected.source = 'local';
    return Promise.resolve(inspected);
  } catch (err) {
    return Promise.resolve({ ok: false, error: '无法下载插件: ' + ((err && err.message) || err) });
  }
}

function fetchBuffer(opts, rel) {
  var base = resolveBase(opts && opts.mirror);
  if (!base) return Promise.reject(new Error('加速源 URL 不合法'));
  var fetch = (opts && opts.fetch) || defaultFetch;
  return Promise.resolve(fetch(joinUrl(base, rel)));
}

function wantsLocal(opts) {
  return !!(opts && (opts.localDebug || String(opts.localRoot || '').trim()));
}

function fetchRegistry(opts) {
  opts = opts || {};
  if (wantsLocal(opts)) {
    return Promise.resolve(fetchLocalRegistry(opts.localRoot));
  }
  return fetchBuffer(opts, 'registry.json')
    .then(function (buf) {
      return parseRegistry(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
    })
    .catch(function (err) {
      return { ok: false, error: '无法拉取货架: ' + ((err && err.message) || err) };
    });
}

function inspectRemote(opts) {
  opts = opts || {};
  if (wantsLocal(opts)) {
    return inspectLocal(opts);
  }
  var id = pkg.sanitizePlainText(opts.id, 64);
  if (!pkg.ID_RE.test(id)) {
    return Promise.resolve({ ok: false, error: '非法插件 id' });
  }
  return fetchBuffer(opts, id + '/manifest.json')
    .then(function (manifestBuf) {
      var parsed = pkg.parseManifest(
        Buffer.isBuffer(manifestBuf) ? manifestBuf.toString('utf8') : String(manifestBuf),
      );
      if (!parsed.ok) return parsed;
      if (parsed.manifest.id !== id) {
        return { ok: false, error: 'manifest id 与目录不一致' };
      }
      if (!pkg.compareClientVersion(opts.clientVersion, parsed.manifest.minClientVersion)) {
        return { ok: false, error: '需要客户端 ' + parsed.manifest.minClientVersion };
      }
      var rels = collectRemoteRelPaths(parsed.manifest);
      if (rels.length > MAX_FILES) {
        return { ok: false, error: '插件文件过多' };
      }
      var map = {};
      var total = 0;
      var chain = Promise.resolve();
      rels.forEach(function (rel) {
        chain = chain.then(function () {
          if (rel === 'manifest.json') {
            map[rel] = manifestBuf;
            total += manifestBuf.length;
            return;
          }
          return fetchBuffer(opts, id + '/' + rel).then(function (buf) {
            total += buf.length;
            if (total > MAX_TOTAL_BYTES) {
              throw new Error('插件过大');
            }
            map[rel] = buf;
          });
        });
      });
      return chain.then(function () {
        var inspected = pkg.inspectFileMap(map);
        if (!inspected.ok) return inspected;
        if (inspected.manifest.id !== id) {
          return { ok: false, error: 'manifest id 与目录不一致' };
        }
        inspected.source = 'remote';
        return inspected;
      });
    })
    .catch(function (err) {
      return { ok: false, error: '无法下载插件: ' + ((err && err.message) || err) };
    });
}

module.exports = {
  DEFAULT_BASE: DEFAULT_BASE,
  GITHUB_WEB_BASE: GITHUB_WEB_BASE,
  resolveBase: resolveBase,
  joinUrl: joinUrl,
  parseRegistry: parseRegistry,
  collectRemoteRelPaths: collectRemoteRelPaths,
  resolveLocalRoot: resolveLocalRoot,
  fetchRegistry: fetchRegistry,
  inspectRemote: inspectRemote,
};
