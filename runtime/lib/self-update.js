/**
 * BHC 本体更新：清单比较、镜像下载、拉起静默安装器。
 * preload 里 require；纯函数也可被 ci-test 引用。
 */
'use strict';

var DEFAULT_MIRROR = 'https://gh.qmqaq.top/';
var REPO_DOWNLOAD = 'https://github.com/BetterSomething/BetterHeyboxChat/releases/download/';
var LATEST_MANIFEST =
  'https://github.com/BetterSomething/BetterHeyboxChat/releases/latest/download/update.json';
var DEV_MANIFEST =
  'https://github.com/BetterSomething/BetterHeyboxChat/releases/download/dev/update.json';
var API_LATEST =
  'https://api.github.com/repos/BetterSomething/BetterHeyboxChat/releases/latest';
var API_DEV =
  'https://api.github.com/repos/BetterSomething/BetterHeyboxChat/releases/tags/dev';
var MAX_JSON_BYTES = 512 * 1024;
var MAX_INSTALLER_BYTES = 40 * 1024 * 1024;
var USER_AGENT = 'BetterHeyboxChat-self-update';
var DEFAULT_THREADS = 4;
var MAX_THREADS = 8;
var MIN_PART_BYTES = 256 * 1024;

function normalizeMirrorPrefix(mirror) {
  var raw = String(mirror || '').trim();
  if (!raw) raw = DEFAULT_MIRROR;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = 'https://' + raw.replace(/^\/+/, '');
  }
  if (raw.charAt(raw.length - 1) !== '/') raw += '/';
  return raw;
}

function joinMirrorUrl(mirror, target) {
  return normalizeMirrorPrefix(mirror) + String(target || '').replace(/^\/+/, '');
}

function manifestUrl(channel, mirror) {
  return joinMirrorUrl(mirror, channel === 'release' ? LATEST_MANIFEST : DEV_MANIFEST);
}

function apiUrl(channel) {
  return channel === 'release' ? API_LATEST : API_DEV;
}

function installerUrl(manifest, mirror) {
  if (!manifest || !manifest.tag || !manifest.artifact) return '';
  return joinMirrorUrl(mirror, REPO_DOWNLOAD + manifest.tag + '/' + manifest.artifact);
}

function stripV(value) {
  var text = String(value || '').trim();
  return text.charAt(0) === 'v' || text.charAt(0) === 'V' ? text.slice(1) : text;
}

function parseSemver(value) {
  var parts = stripV(value).split('.');
  if (parts.length !== 3) return null;
  var nums = parts.map(function (part) {
    return /^\d+$/.test(part) ? parseInt(part, 10) : NaN;
  });
  if (nums.some(function (n) { return !isFinite(n); })) return null;
  return nums;
}

function normalizeSha(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
}

function shaEqual(a, b) {
  var left = normalizeSha(a);
  var right = normalizeSha(b);
  if (left.length < 7 || right.length < 7) return false;
  var len = Math.min(left.length, right.length);
  return left.slice(0, len) === right.slice(0, len);
}

function hasUpdate(local, remote) {
  if (!remote || !remote.version) return false;
  var channel = (local && local.channel) || 'dev';
  if (channel === 'release') {
    var remoteVer = parseSemver(remote.version);
    var localVer = parseSemver(local && local.version);
    if (!remoteVer) return false;
    if (!localVer) return true;
    for (var i = 0; i < 3; i++) {
      if (remoteVer[i] > localVer[i]) return true;
      if (remoteVer[i] < localVer[i]) return false;
    }
    return false;
  }
  var localSha = (local && (local.version || local.commit)) || '';
  return !shaEqual(localSha, remote.version || remote.commit);
}

function isIgnored(ignored, remote) {
  if (!ignored || !remote) return false;
  return (
    String(ignored.channel || '') === String(remote.channel || '') &&
    String(ignored.version || '') === String(remote.version || '')
  );
}

function normalizeSha256(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
}

function parseManifest(raw) {
  var src = raw;
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: 'update.json 不是合法 JSON' };
    }
  }
  if (!src || typeof src !== 'object') return { ok: false, error: 'update.json 无效' };
  var version = String(src.version || '').trim();
  var channel = src.channel === 'release' ? 'release' : 'dev';
  var artifact = String(src.artifact || '').trim();
  var tag = String(src.tag || '').trim() || (channel === 'release' ? 'v' + version : 'dev');
  if (!version || !artifact) return { ok: false, error: 'update.json 缺少 version/artifact' };
  if (!/^bhchat-installer-[A-Za-z0-9._-]+\.exe$/.test(artifact)) {
    return { ok: false, error: '安装包文件名不合法' };
  }
  return {
    ok: true,
    manifest: {
      version: version,
      channel: channel,
      commit: String(src.commit || version).trim(),
      tag: tag,
      artifact: artifact,
      sha256: normalizeSha256(src.sha256),
      notes: String(src.notes || ''),
      publishedAt: String(src.publishedAt || ''),
    },
  };
}

function pickInstallerAsset(assets) {
  var list = Array.isArray(assets) ? assets : [];
  for (var i = 0; i < list.length; i++) {
    var name = String((list[i] && list[i].name) || '');
    if (/^bhchat-installer-[A-Za-z0-9._-]+\.exe$/.test(name)) return list[i];
  }
  return null;
}

function manifestFromGithubApi(apiJson, channel) {
  if (!apiJson || typeof apiJson !== 'object') {
    return { ok: false, error: 'GitHub API 响应无效' };
  }
  var asset = pickInstallerAsset(apiJson.assets);
  if (!asset) return { ok: false, error: 'Release 没有安装包' };
  var tag = String(apiJson.tag_name || '').trim();
  var version =
    channel === 'release'
      ? stripV(tag || apiJson.name)
      : String(asset.name || '').replace(/^bhchat-installer-/, '').replace(/\.exe$/i, '');
  return parseManifest({
    version: version,
    channel: channel === 'release' ? 'release' : 'dev',
    commit: String(apiJson.target_commitish || version).slice(0, 7),
    tag: tag || (channel === 'release' ? 'v' + version : 'dev'),
    artifact: asset.name,
    sha256: asset.digest,
    notes: String(apiJson.body || '').split(/\r?\n/).filter(Boolean).slice(0, 6).join('\n').slice(0, 400),
    publishedAt: apiJson.published_at || '',
  });
}

function resolveInstallRoot(appDir) {
  var path = require('path');
  var resolved = path.resolve(String(appDir || ''));
  return path.resolve(resolved, '..', '..', '..', '..', '..');
}

function tempDir() {
  return require('path').join(require('os').tmpdir(), 'BetterHeyboxChat');
}

function splitRanges(total, threads) {
  var size = Math.max(0, parseInt(total, 10) || 0);
  var count = Math.max(1, Math.min(MAX_THREADS, parseInt(threads, 10) || DEFAULT_THREADS));
  if (size <= 0) return [];
  while (count > 1 && Math.ceil(size / count) < MIN_PART_BYTES) count -= 1;
  var part = Math.ceil(size / count);
  var ranges = [];
  var start = 0;
  for (var i = 0; i < count && start < size; i++) {
    var end = Math.min(size - 1, start + part - 1);
    ranges.push({ start: start, end: end });
    start = end + 1;
  }
  return ranges;
}

function requestResponse(url, opts) {
  opts = opts || {};
  var maxBytes = opts.maxBytes || MAX_JSON_BYTES;
  var timeout = opts.timeout || 20000;
  var redirects = opts.redirects || 0;
  var extraHeaders = opts.headers || {};
  return new Promise(function (resolve, reject) {
    var href = String(url || '');
    if (!/^https?:\/\//i.test(href)) {
      reject(new Error('非法下载地址'));
      return;
    }
    var lib = href.indexOf('https:') === 0 ? require('https') : require('http');
    var headers = { 'User-Agent': USER_AGENT, Accept: opts.accept || '*/*' };
    Object.keys(extraHeaders).forEach(function (key) {
      if (extraHeaders[key] != null) headers[key] = extraHeaders[key];
    });
    var reqOpts = { timeout: timeout, headers: headers };
    if (opts.agent) reqOpts.agent = opts.agent;
    var req = lib.get(href, reqOpts, function (res) {
      var loc = res.headers && res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 5) {
        res.resume();
        resolve(requestResponse(loc, Object.assign({}, opts, { redirects: redirects + 1 })));
        return;
      }
      if (opts.allowStatuses) {
        var allowed = opts.allowStatuses.indexOf(res.statusCode) >= 0;
        if (!allowed) {
          res.resume();
          reject(new Error('下载失败 HTTP ' + res.statusCode));
          return;
        }
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('下载失败 HTTP ' + res.statusCode));
        return;
      }
      var chunks = [];
      var received = 0;
      var announced = parseInt(res.headers['content-length'], 10) || 0;
      res.on('data', function (chunk) {
        received += chunk.length;
        if (received > maxBytes) {
          req.destroy();
          reject(new Error('文件过大'));
          return;
        }
        if (typeof opts.onProgress === 'function') {
          opts.onProgress({ received: received, total: announced });
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers || {},
          buffer: Buffer.concat(chunks),
        });
      });
    });
    if (opts.onRequest) opts.onRequest(req);
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

function requestBuffer(url, opts) {
  return requestResponse(url, opts).then(function (res) {
    return res.buffer;
  });
}

function parseContentRangeTotal(header) {
  var match = /\/(\d+)\s*$/.exec(String(header || ''));
  return match ? parseInt(match[1], 10) : 0;
}

function probeRangeSupport(url, opts) {
  return requestResponse(url, {
    headers: { Range: 'bytes=0-0' },
    accept: opts.accept,
    timeout: opts.timeout || 20000,
    maxBytes: 16,
    allowStatuses: [200, 206],
    agent: opts.agent,
  }).then(function (res) {
    var total = parseContentRangeTotal(res.headers['content-range']);
    if (!total && res.statusCode === 200) {
      total = parseInt(res.headers['content-length'], 10) || 0;
    }
    return {
      ranged: res.statusCode === 206 && total > 0,
      total: total,
    };
  });
}

function downloadSingle(url, opts) {
  var received = 0;
  return requestBuffer(url, {
    maxBytes: opts.maxBytes,
    timeout: opts.timeout,
    accept: opts.accept,
    agent: opts.agent,
    onProgress: function (progress) {
      received = progress.received || 0;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({
          received: received,
          total: progress.total || 0,
          threads: 1,
        });
      }
    },
  });
}

function downloadRanged(url, total, threads, opts) {
  var ranges = splitRanges(total, threads);
  if (ranges.length <= 1) return downloadSingle(url, opts);
  var received = ranges.map(function () {
    return 0;
  });
  var reqs = [];
  function report() {
    var sum = 0;
    for (var i = 0; i < received.length; i++) sum += received[i];
    if (typeof opts.onProgress === 'function') {
      opts.onProgress({ received: sum, total: total, threads: ranges.length });
    }
  }
  return Promise.all(
    ranges.map(function (range, index) {
      var expected = range.end - range.start + 1;
      return requestResponse(url, {
        headers: { Range: 'bytes=' + range.start + '-' + range.end },
        accept: opts.accept,
        timeout: opts.timeout,
        maxBytes: expected + 64,
        allowStatuses: [206],
        agent: opts.agent,
        onRequest: function (req) {
          reqs.push(req);
        },
        onProgress: function (progress) {
          received[index] = progress.received || 0;
          report();
        },
      }).then(function (res) {
        if (!res.buffer || res.buffer.length !== expected) {
          throw new Error('分段长度不符');
        }
        return res.buffer;
      });
    }),
  )
    .then(function (parts) {
      return Buffer.concat(parts);
    })
    .catch(function (err) {
      reqs.forEach(function (req) {
        try {
          req.destroy();
        } catch (destroyErr) {}
      });
      throw err;
    });
}

function fetchManifest(opts) {
  opts = opts || {};
  var channel = opts.channel === 'release' ? 'release' : 'dev';
  var mirror = opts.mirror || DEFAULT_MIRROR;
  function fromApi() {
    return requestBuffer(apiUrl(channel), { accept: 'application/vnd.github+json' }).then(function (buf) {
      var json;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch (err) {
        return { ok: false, error: 'GitHub API 不是 JSON' };
      }
      return manifestFromGithubApi(json, channel);
    });
  }

  return requestBuffer(manifestUrl(channel, mirror), { accept: 'application/json' })
    .then(function (buf) {
      var parsed = parseManifest(buf.toString('utf8'));
      return parsed.ok ? parsed : fromApi();
    })
    .catch(function () {
      return fromApi();
    })
    .catch(function (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    });
}

function sha256Buffer(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

function createDownloadAgent(threads) {
  var https = require('https');
  return new https.Agent({ keepAlive: true, maxSockets: Math.max(1, threads) });
}

function downloadInstaller(opts) {
  opts = opts || {};
  var manifest = opts.manifest;
  if (!manifest) return Promise.reject(new Error('缺少清单'));
  var url = installerUrl(manifest, opts.mirror || DEFAULT_MIRROR);
  if (!url) return Promise.reject(new Error('安装包地址无效'));
  var fs = require('fs');
  var path = require('path');
  var dir = tempDir();
  var dest = path.join(dir, manifest.artifact);
  var threads = Math.max(1, Math.min(MAX_THREADS, parseInt(opts.threads, 10) || DEFAULT_THREADS));
  var agent = createDownloadAgent(threads);
  var common = {
    maxBytes: MAX_INSTALLER_BYTES,
    timeout: 120000,
    onProgress: opts.onProgress,
    agent: agent,
  };
  function writeBuf(buf) {
    var actual = sha256Buffer(buf);
    if (manifest.sha256 && actual !== manifest.sha256) {
      throw new Error('安装包校验失败');
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, buf);
    return dest;
  }
  return probeRangeSupport(url, common)
    .then(function (probe) {
      if (probe.ranged && probe.total > 0 && probe.total <= MAX_INSTALLER_BYTES) {
        return downloadRanged(url, probe.total, threads, common);
      }
      return downloadSingle(url, common);
    })
    .catch(function () {
      return downloadSingle(url, common);
    })
    .then(writeBuf)
    .finally(function () {
      if (agent && typeof agent.destroy === 'function') agent.destroy();
    });
}

function cleanupOldInstallers(keepName) {
  var fs = require('fs');
  var path = require('path');
  var dir = tempDir();
  try {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (name) {
      if (keepName && name === keepName) return;
      if (!/^bhchat-installer-/.test(name)) return;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch (err) {}
    });
  } catch (err) {}
}

function launchInstaller(exePath, installRoot) {
  var spawn = require('child_process').spawn;
  var args = ['--reinstall', '--yes'];
  if (installRoot) args.push('--path', String(installRoot));
  var child = spawn(String(exePath), args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { ok: true };
}

module.exports = {
  DEFAULT_MIRROR: DEFAULT_MIRROR,
  normalizeMirrorPrefix: normalizeMirrorPrefix,
  joinMirrorUrl: joinMirrorUrl,
  manifestUrl: manifestUrl,
  installerUrl: installerUrl,
  hasUpdate: hasUpdate,
  isIgnored: isIgnored,
  parseManifest: parseManifest,
  manifestFromGithubApi: manifestFromGithubApi,
  resolveInstallRoot: resolveInstallRoot,
  fetchManifest: fetchManifest,
  splitRanges: splitRanges,
  downloadInstaller: downloadInstaller,
  cleanupOldInstallers: cleanupOldInstallers,
  launchInstaller: launchInstaller,
  sha256Buffer: sha256Buffer,
};
