/**
 * 收集黑盒语音登录态与官方 API query（对照 official-cos-upload.md 第 0 节）。
 * 纯函数，不读真实 localStorage / Cookie。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.BhchatExportCredentials = api;
  } else if (root) {
    root.BhchatExportCredentials = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_COOKIE_URL = 'https://api.xiaoheihe.cn';
  var FIXED_QUERY = {
    client_type: 'heybox_chat',
    x_client_type: 'pc',
    os_type: 'web',
    x_app: 'heybox_chat',
    version: '999.0.4',
    web_version: '1.0.0',
    chat_os_type: 'client',
  };
  var REQUIRED_QUERY = [
    'heybox_id',
    'pkey',
    'client_type',
    'x_client_type',
    'os_type',
    'x_app',
    'version',
    'web_version',
    'chat_os_type',
    'chat_version',
  ];

  function asText(value) {
    if (value == null) return '';
    return String(value);
  }

  function unwrapStored(value) {
    var text = asText(value).trim();
    if (!text) return '';
    var first = text.charAt(0);
    var last = text.charAt(text.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      try {
        var parsed = JSON.parse(first === '"' ? text : '"' + text.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
        return asText(parsed).trim();
      } catch (err) {
        return text.slice(1, -1).trim();
      }
    }
    return text;
  }

  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var text = unwrapStored(arguments[i]);
      if (text) return text;
    }
    return '';
  }

  function cookieValueByName(cookies, names) {
    var list = Array.isArray(cookies) ? cookies : [];
    var wanted = Array.isArray(names) ? names : [];
    var n;
    var i;
    for (n = 0; n < wanted.length; n++) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && list[i].name === wanted[n]) {
          var value = unwrapStored(list[i].value);
          if (value) return value;
        }
      }
    }
    return '';
  }

  function isAllowedCookieUrl(url) {
    try {
      var parsed = new URL(asText(url));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      var host = parsed.hostname.toLowerCase();
      return (
        host === 'xiaoheihe.cn' ||
        host.slice(-13) === '.xiaoheihe.cn' ||
        host === 'max-c.com' ||
        host.slice(-10) === '.max-c.com'
      );
    } catch (err) {
      return false;
    }
  }

  function parseDocumentCookie(raw) {
    var out = [];
    var text = asText(raw);
    if (!text) return out;
    var parts = text.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      var eq = part.indexOf('=');
      if (eq <= 0) continue;
      out.push({
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1),
        domain: '',
        path: '/',
        httpOnly: false,
        secure: false,
        source: 'document',
      });
    }
    return out;
  }

  function normalizeCookie(item, source) {
    if (!item || !item.name) return null;
    return {
      name: asText(item.name),
      value: asText(item.value),
      domain: asText(item.domain),
      path: asText(item.path) || '/',
      httpOnly: !!item.httpOnly,
      secure: !!item.secure,
      source: source || item.source || 'session',
    };
  }

  function mergeCookies(sessionCookies, documentCookie) {
    var seen = {};
    var items = [];
    var list = Array.isArray(sessionCookies) ? sessionCookies : [];
    var i;
    for (i = 0; i < list.length; i++) {
      var sessionItem = normalizeCookie(list[i], 'session');
      if (!sessionItem || seen[sessionItem.name]) continue;
      seen[sessionItem.name] = true;
      items.push(sessionItem);
    }
    var docItems = parseDocumentCookie(documentCookie);
    for (i = 0; i < docItems.length; i++) {
      if (seen[docItems[i].name]) continue;
      seen[docItems[i].name] = true;
      items.push(docItems[i]);
    }
    return items;
  }

  function toCookieHeader(items) {
    var parts = [];
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].name) continue;
      parts.push(list[i].name + '=' + asText(list[i].value));
    }
    return parts.join('; ');
  }

  function buildQueryString(query) {
    var parts = [];
    var i;
    for (i = 0; i < REQUIRED_QUERY.length; i++) {
      var requiredKey = REQUIRED_QUERY[i];
      parts.push(encodeURIComponent(requiredKey) + '=' + encodeURIComponent(asText(query[requiredKey])));
    }
    var keys = Object.keys(query);
    for (i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (REQUIRED_QUERY.indexOf(key) !== -1) continue;
      var value = asText(query[key]);
      if (!value) continue;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    return parts.join('&');
  }

  function collectSnapshot(input) {
    input = input || {};
    var ls = input.localStorage && typeof input.localStorage === 'object' ? input.localStorage : {};
    var win = input.window && typeof input.window === 'object' ? input.window : {};
    var userInfo = input.userInfo && typeof input.userInfo === 'object' ? input.userInfo : {};
    var cookies = mergeCookies(input.sessionCookies, input.documentCookie);
    var heyboxId = firstNonEmpty(ls.heybox_id, userInfo.user_id, win.heybox_id);
    var pkey = firstNonEmpty(ls.pkey, win.pkey, cookieValueByName(cookies, ['user_pkey', 'pkey']));
    var query = {
      heybox_id: heyboxId,
      pkey: pkey,
      client_type: FIXED_QUERY.client_type,
      x_client_type: FIXED_QUERY.x_client_type,
      os_type: FIXED_QUERY.os_type,
      x_os_type: firstNonEmpty(win.x_os_type, input.xOsType),
      device_info: firstNonEmpty(win.device_info, input.deviceInfo),
      x_app: FIXED_QUERY.x_app,
      version: firstNonEmpty(win.app_version, FIXED_QUERY.version),
      web_version: firstNonEmpty(win.web_version, FIXED_QUERY.web_version),
      chat_os_type: FIXED_QUERY.chat_os_type,
      chat_version: firstNonEmpty(win.asar_version, input.chatVersion),
      chat_exe_version: firstNonEmpty(win.chat_exe_version, input.clientVersion),
      electron_version: firstNonEmpty(win.electron_version, input.electronVersion),
      client_bit: firstNonEmpty(win.exe_bit, win.client_bit),
      win_version: firstNonEmpty(win.windows_version, win.win_version),
    };
    var cookieHeader = toCookieHeader(cookies);
    var missing = [];
    if (!query.heybox_id) missing.push('heybox_id');
    if (!query.pkey) missing.push('pkey');
    if (!cookieHeader) missing.push('cookies');
    return {
      exportedAt: input.now || new Date().toISOString(),
      login: {
        heybox_id: query.heybox_id,
        pkey: query.pkey,
        user_id: userInfo.user_id != null && userInfo.user_id !== '' ? asText(userInfo.user_id) : '',
        loggedIn: !!(query.heybox_id && query.pkey),
      },
      query: query,
      queryString: buildQueryString(query),
      cookies: cookies,
      cookieHeader: cookieHeader,
      env: {
        HEYBOX_ID: query.heybox_id,
        PKEY: query.pkey,
        HEYBOX_COOKIE: cookieHeader,
      },
      missing: missing,
    };
  }

  function formatEnv(snapshot) {
    var env = (snapshot && snapshot.env) || {};
    return (
      'HEYBOX_ID=' + asText(env.HEYBOX_ID) + '\n' +
      'PKEY=' + asText(env.PKEY) + '\n' +
      'HEYBOX_COOKIE=' + asText(env.HEYBOX_COOKIE) + '\n'
    );
  }

  function formatJson(snapshot) {
    return JSON.stringify(snapshot || {}, null, 2);
  }

  return {
    DEFAULT_COOKIE_URL: DEFAULT_COOKIE_URL,
    isAllowedCookieUrl: isAllowedCookieUrl,
    collectSnapshot: collectSnapshot,
    formatEnv: formatEnv,
    formatJson: formatJson,
    toCookieHeader: toCookieHeader,
  };
});
