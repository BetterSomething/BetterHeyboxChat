/**
 * 子 frame 注入与 Cookie embed 的通用策略（无业务站点逻辑）。
 * 供 main-bridge 在主进程使用。
 */
'use strict';

var SCRIPT_LIMIT = 65536;
var ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function hostnameOf(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch (err) {
    return '';
  }
}

function protocolOf(url) {
  try {
    return new URL(String(url || '')).protocol;
  } catch (err) {
    return '';
  }
}

function isAllowedHost(host) {
  host = String(host || '').toLowerCase();
  if (!host) return false;
  return (
    host === 'xiaoheihe.cn' ||
    host.endsWith('.xiaoheihe.cn') ||
    host === 'max-c.com' ||
    host.endsWith('.max-c.com')
  );
}

function isAllowedCookieUrl(url) {
  var protocol = protocolOf(url);
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  return isAllowedHost(hostnameOf(url));
}

function isGuestFrameUrl(url) {
  var protocol = protocolOf(url);
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  return true;
}

function normalizeSuffix(suffix) {
  return String(suffix || '')
    .toLowerCase()
    .replace(/^\.+/, '');
}

function isAllowedHostSuffix(suffix) {
  return isAllowedHost(normalizeSuffix(suffix));
}

function hostMatchesSuffix(host, suffix) {
  host = String(host || '').toLowerCase();
  suffix = normalizeSuffix(suffix);
  if (!host || !suffix) return false;
  return host === suffix || host.endsWith('.' + suffix);
}

function sanitizeWatch(spec) {
  spec = spec && typeof spec === 'object' ? spec : {};
  var id = String(spec.id || '');
  var hostSuffix = normalizeSuffix(spec.hostSuffix);
  var css = spec.css == null ? '' : String(spec.css);
  var js = spec.js == null ? '' : String(spec.js);
  if (!ID_RE.test(id)) {
    return { ok: false, error: 'invalid id' };
  }
  if (!isAllowedHostSuffix(hostSuffix)) {
    return { ok: false, error: 'host not allowed' };
  }
  if (css.length > SCRIPT_LIMIT) {
    return { ok: false, error: 'css too long' };
  }
  if (js.length > SCRIPT_LIMIT) {
    return { ok: false, error: 'js too long' };
  }
  return {
    ok: true,
    watch: {
      id: id,
      hostSuffix: hostSuffix,
      css: css,
      js: js,
    },
  };
}

function watchMatchesUrl(watch, url) {
  if (!watch || !isGuestFrameUrl(url) || !isAllowedCookieUrl(url)) return false;
  return hostMatchesSuffix(hostnameOf(url), watch.hostSuffix);
}

function isAlreadyEmbeddable(cookie) {
  if (!cookie) return false;
  var sameSite = String(cookie.sameSite || '').toLowerCase();
  return !!cookie.secure && (sameSite === 'no_restriction' || sameSite === 'none');
}

function toEmbeddableCookieDetails(cookie, pageUrl) {
  cookie = cookie || {};
  var details = {
    url: String(pageUrl || ''),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: true,
    sameSite: 'no_restriction',
    httpOnly: !!cookie.httpOnly,
  };
  if (cookie.domain) details.domain = cookie.domain;
  if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  return details;
}

function summarizeEmbedResult(result) {
  result = result || {};
  return {
    ok: !!result.ok,
    changed: Number(result.changed) || 0,
  };
}

function buildInjectScript(watch) {
  watch = watch || {};
  var styleId = 'bhchat-guest-style-' + String(watch.id || '');
  var parts = [];
  if (watch.css) {
    parts.push(
      'var __s=document.getElementById(' +
        JSON.stringify(styleId) +
        ');if(!__s){__s=document.createElement("style");__s.id=' +
        JSON.stringify(styleId) +
        ';document.documentElement.appendChild(__s);}' +
        '__s.textContent=' +
        JSON.stringify(watch.css) +
        ';',
    );
  }
  if (watch.js) {
    parts.push(watch.js);
  }
  return '(function(){' + parts.join('') + '})();';
}

function frameInfo(frame) {
  var url = frame && frame.url;
  var origin = '';
  try {
    origin = url ? new URL(url).origin : '';
  } catch (err) {
    origin = '';
  }
  return { url: url, origin: origin, frame: frame };
}

function collectGuestFrames(rootFrame) {
  var out = [];
  var seen = [];
  function consider(frame) {
    if (!frame || seen.indexOf(frame) !== -1) return;
    seen.push(frame);
    if (frame === rootFrame) return;
    var url = frame.url;
    if (!isGuestFrameUrl(url) || !isAllowedCookieUrl(url)) return;
    out.push(frameInfo(frame));
  }
  if (rootFrame && rootFrame.framesInSubtree) {
    var tree = rootFrame.framesInSubtree;
    for (var i = 0; i < tree.length; i++) consider(tree[i]);
    return out;
  }
  function walk(frame) {
    consider(frame);
    var kids = (frame && frame.frames) || [];
    for (var j = 0; j < kids.length; j++) walk(kids[j]);
  }
  walk(rootFrame);
  return out;
}

function listGuestFrameInfo(rootFrame) {
  return collectGuestFrames(rootFrame).map(function (item) {
    return { url: item.url, origin: item.origin };
  });
}

module.exports = {
  SCRIPT_LIMIT: SCRIPT_LIMIT,
  isAllowedHost: isAllowedHost,
  isAllowedCookieUrl: isAllowedCookieUrl,
  isGuestFrameUrl: isGuestFrameUrl,
  isAllowedHostSuffix: isAllowedHostSuffix,
  hostMatchesSuffix: hostMatchesSuffix,
  sanitizeWatch: sanitizeWatch,
  watchMatchesUrl: watchMatchesUrl,
  isAlreadyEmbeddable: isAlreadyEmbeddable,
  toEmbeddableCookieDetails: toEmbeddableCookieDetails,
  summarizeEmbedResult: summarizeEmbedResult,
  buildInjectScript: buildInjectScript,
  collectGuestFrames: collectGuestFrames,
  listGuestFrameInfo: listGuestFrameInfo,
};
