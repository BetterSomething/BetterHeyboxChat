/**
 * BetterHeyboxChat 本地存储封装
 * 优先 electronAPI，回退 localStorage
 */
(function (global) {
  'use strict';

  async function get(key) {
    try {
      if (global.electronAPI && global.electronAPI.getData) {
        var raw = await global.electronAPI.getData(key);
        if (raw == null || raw === '') return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
      var ls = global.localStorage.getItem(key);
      return ls ? JSON.parse(ls) : null;
    } catch (err) {
      console.warn('[BetterHeyboxChat] storage.get failed:', key, err);
      return null;
    }
  }

  async function set(key, value) {
    var json = JSON.stringify(value);
    if (global.electronAPI && global.electronAPI.setData) {
      await global.electronAPI.setData(key, json);
      return;
    }
    global.localStorage.setItem(key, json);
  }

  async function del(key) {
    if (global.electronAPI && global.electronAPI.delData) {
      await global.electronAPI.delData(key);
      return;
    }
    global.localStorage.removeItem(key);
  }

  global.BHChatStorage = { get: get, set: set, del: del };
})(window);
