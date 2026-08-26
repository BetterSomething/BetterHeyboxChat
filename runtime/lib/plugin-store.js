/**
 * 用户插件目录读写：安装 / 卸载 / 列举。
 * 仅在 preload（Node）中使用。
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var pkg = require('./plugin-package.js');
var zip = require('./zip-inflate.js');
var registry = require('./plugin-registry.js');

var PROFILE_ENV = 'BETTERHEYBOXCHAT_PROFILE';
var APP_FOLDER = 'BetterHeyboxChat';
var POINTER_NAME = 'data-root.txt';

function configHome() {
  var appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, APP_FOLDER);
}

function defaultDataRoot() {
  return configHome();
}

function getDataRoot() {
  var env = process.env[PROFILE_ENV];
  if (env && path.isAbsolute(env)) return env;
  try {
    var pointer = fs.readFileSync(path.join(configHome(), POINTER_NAME), 'utf8').trim();
    if (pointer && path.isAbsolute(pointer)) return pointer;
  } catch (err) {
    /* use default */
  }
  return defaultDataRoot();
}

function pluginsRoot() {
  return path.join(getDataRoot(), 'plugins');
}

function readBundledIds() {
  try {
    var list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins.json'), 'utf8'));
    return list.map(function (item) {
      return item.id;
    });
  } catch (err) {
    return [];
  }
}

function listUserPlugins() {
  var root = pluginsRoot();
  var result = [];
  if (!fs.existsSync(root)) return result;
  var names = fs.readdirSync(root);
  for (var i = 0; i < names.length; i++) {
    var dir = path.join(root, names[i]);
    var manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      var parsed = pkg.parseManifest(fs.readFileSync(manifestPath, 'utf8'));
      if (!parsed.ok) continue;
      if (parsed.manifest.id !== names[i]) continue;
      parsed.manifest.source = 'user';
      parsed.manifest.dir = dir;
      result.push(parsed.manifest);
    } catch (err) {
      /* skip broken plugin */
    }
  }
  return result;
}

function previewFromInspect(inspected, source) {
  if (!inspected.ok) return inspected;
  var bundled = readBundledIds();
  if (bundled.indexOf(inspected.manifest.id) !== -1) {
    return { ok: false, error: '不能覆盖内置插件: ' + inspected.manifest.id };
  }
  var dest = path.join(pluginsRoot(), inspected.manifest.id);
  return {
    ok: true,
    source: source,
    upgrade: fs.existsSync(path.join(dest, 'manifest.json')),
    manifest: inspected.manifest,
  };
}

function inspectZipBuffer(buffer) {
  var unzipped = zip.unzip(buffer);
  if (!unzipped.ok) return unzipped;
  return previewFromInspect(pkg.inspectFileMap(unzipped.files), 'zip');
}

function inspectZipPath(zipPath) {
  try {
    return inspectZipBuffer(fs.readFileSync(zipPath));
  } catch (err) {
    return { ok: false, error: '无法读取 zip: ' + ((err && err.message) || err) };
  }
}

function inspectFolderPath(folderPath) {
  var dir = folderPath;
  try {
    if (fs.statSync(folderPath).isFile()) {
      dir = path.dirname(folderPath);
    }
  } catch (err) {
    return { ok: false, error: '路径不存在' };
  }
  for (var i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      return previewFromInspect(pkg.inspectDirectory(dir, fs), 'folder');
    }
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { ok: false, error: '未找到 manifest.json' };
}

function writeInspected(inspected) {
  if (!inspected.ok) return inspected;
  var bundled = readBundledIds();
  if (bundled.indexOf(inspected.manifest.id) !== -1) {
    return { ok: false, error: '不能覆盖内置插件: ' + inspected.manifest.id };
  }
  var dest = path.join(pluginsRoot(), inspected.manifest.id);
  var tmp = dest + '.tmp-install';
  try {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    var prefix = inspected.prefix || '';
    var files = inspected.files || {};
    Object.keys(files).forEach(function (name) {
      var rel = pkg.normalizeRelPath(name.slice(prefix.length));
      if (!rel || !pkg.isSafeRelPath(rel)) return;
      var target = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, files[name]);
    });
    fs.mkdirSync(pluginsRoot(), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return { ok: true, id: inspected.manifest.id, dest: dest };
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    } catch (cleanup) {
      /* ignore */
    }
    return { ok: false, error: '写入插件失败: ' + ((err && err.message) || err) };
  }
}

function installZipBuffer(buffer) {
  var unzipped = zip.unzip(buffer);
  if (!unzipped.ok) return unzipped;
  return writeInspected(pkg.inspectFileMap(unzipped.files));
}

function installZipPath(zipPath) {
  try {
    return installZipBuffer(fs.readFileSync(zipPath));
  } catch (err) {
    return { ok: false, error: '无法读取 zip: ' + ((err && err.message) || err) };
  }
}

function installFolderPath(folderPath) {
  var inspected = inspectFolderPath(folderPath);
  if (!inspected.ok) return inspected;
  var dir = folderPath;
  try {
    if (fs.statSync(folderPath).isFile()) dir = path.dirname(folderPath);
  } catch (err) {
    return { ok: false, error: '路径不存在' };
  }
  for (var i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      return writeInspected(pkg.inspectDirectory(dir, fs));
    }
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { ok: false, error: '未找到 manifest.json' };
}

function uninstall(id) {
  var parsed = pkg.parseManifest({ id: id, name: id, version: '0', entry: 'index.js' });
  if (!parsed.ok) return { ok: false, error: '非法插件 id' };
  if (readBundledIds().indexOf(parsed.manifest.id) !== -1) {
    return { ok: false, error: '不能卸载内置插件' };
  }
  var dest = path.join(pluginsRoot(), parsed.manifest.id);
  if (!fs.existsSync(dest)) return { ok: false, error: '未安装该用户插件' };
  fs.rmSync(dest, { recursive: true, force: true });
  return { ok: true, id: parsed.manifest.id };
}

function inspectRemote(opts) {
  return registry.inspectRemote(opts).then(function (inspected) {
    if (!inspected.ok) return inspected;
    var preview = previewFromInspect(inspected, 'remote');
    if (!preview.ok) return preview;
    preview.files = inspected.files;
    preview.prefix = inspected.prefix;
    preview.root = inspected.root;
    return preview;
  });
}

function installRemote(opts) {
  return inspectRemote(opts).then(function (preview) {
    if (!preview.ok) return preview;
    return writeInspected(preview);
  });
}

function readUserFile(id, rel) {
  if (!pkg.isSafeRelPath(rel)) return null;
  var dest = path.join(pluginsRoot(), id, rel);
  if (!dest.startsWith(path.join(pluginsRoot(), id))) return null;
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

module.exports = {
  getDataRoot: getDataRoot,
  pluginsRoot: pluginsRoot,
  listUserPlugins: listUserPlugins,
  inspectZipBuffer: inspectZipBuffer,
  inspectZipPath: inspectZipPath,
  inspectFolderPath: inspectFolderPath,
  installZipBuffer: installZipBuffer,
  installZipPath: installZipPath,
  installFolderPath: installFolderPath,
  uninstall: uninstall,
  readUserFile: readUserFile,
  fetchRegistry: registry.fetchRegistry,
  inspectRemote: inspectRemote,
  installRemote: installRemote,
};
