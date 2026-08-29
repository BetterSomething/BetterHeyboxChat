/**
 * 从资源管理器拖入文件：给 Electron / 宿主全局拦截用。
 * 同时挂 window 与 module.exports（渲染进程两者都可能存在）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.BHChatOsFileDrop = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function typeListHasFiles(types) {
    if (!types) return false;
    if (typeof types.contains === 'function') {
      try {
        return !!types.contains('Files');
      } catch (err) {
        return false;
      }
    }
    var i;
    for (i = 0; i < types.length; i++) {
      if (types[i] === 'Files' || types[i] === 'application/x-moz-file') return true;
    }
    return false;
  }

  function isOsFileDrag(e) {
    var dt = e && e.dataTransfer;
    if (!dt) return false;
    if (typeListHasFiles(dt.types)) return true;
    if (dt.files && dt.files.length) return true;
    return false;
  }

  function acceptOsFileDrag(e) {
    if (!e) return false;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.dataTransfer) {
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch (err) {
        /* Electron 某些版本只读 */
      }
    }
    return true;
  }

  function filesFromDropEvent(e) {
    var dt = e && e.dataTransfer;
    if (!dt) return [];
    if (dt.files && dt.files.length) {
      return Array.prototype.slice.call(dt.files);
    }
    var items = dt.items;
    if (!items || !items.length) return [];
    var out = [];
    var i;
    var file;
    for (i = 0; i < items.length; i++) {
      if (!items[i] || items[i].kind !== 'file' || typeof items[i].getAsFile !== 'function') continue;
      file = items[i].getAsFile();
      if (file) out.push(file);
    }
    return out;
  }

  function resolveDroppedPath(file, getPathForFile) {
    if (!file) return '';
    if (file.path) return String(file.path);
    if (typeof getPathForFile === 'function') {
      try {
        var resolved = getPathForFile(file);
        if (resolved) return String(resolved);
      } catch (err) {
        return '';
      }
    }
    return '';
  }

  function eventInside(root, e) {
    if (!root || !e) return false;
    var node = e.target;
    if (node && root.contains && root.contains(node)) return true;
    return false;
  }

  return {
    isOsFileDrag: isOsFileDrag,
    acceptOsFileDrag: acceptOsFileDrag,
    filesFromDropEvent: filesFromDropEvent,
    resolveDroppedPath: resolveDroppedPath,
    eventInside: eventInside,
  };
});
