/**
 * 极简 zip 解压（仅 store / deflate，无 zip64 / 加密 / data descriptor）
 * Node preload 与测试共用。
 */
'use strict';

var zlib = require('zlib');

var MAX_ZIP_BYTES = 20 * 1024 * 1024;
var MAX_UNCOMPRESSED = 40 * 1024 * 1024;
var MAX_FILES = 256;

function u16(buf, off) {
  return buf.readUInt16LE(off);
}

function u32(buf, off) {
  return buf.readUInt32LE(off);
}

function findEocd(buf) {
  var min = Math.max(0, buf.length - 22 - 65535);
  for (var i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i;
  }
  return -1;
}

function unzip(input) {
  var buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length > MAX_ZIP_BYTES) {
    return { ok: false, error: 'zip 超过 20MB 上限' };
  }
  var eocd = findEocd(buf);
  if (eocd < 0) return { ok: false, error: '不是有效的 zip' };
  var count = u16(buf, eocd + 10);
  var centralSize = u32(buf, eocd + 12);
  var centralOff = u32(buf, eocd + 16);
  if (count > MAX_FILES) return { ok: false, error: 'zip 内文件过多' };
  if (centralOff + centralSize > buf.length) {
    return { ok: false, error: 'zip 目录损坏' };
  }

  var files = Object.create(null);
  var totalUncomp = 0;
  var cursor = centralOff;
  for (var n = 0; n < count; n++) {
    if (u32(buf, cursor) !== 0x02014b50) {
      return { ok: false, error: 'zip 中央目录损坏' };
    }
    var flags = u16(buf, cursor + 8);
    var method = u16(buf, cursor + 10);
    var compSize = u32(buf, cursor + 20);
    var uncompSize = u32(buf, cursor + 24);
    var nameLen = u16(buf, cursor + 28);
    var extraLen = u16(buf, cursor + 30);
    var commentLen = u16(buf, cursor + 32);
    var localOff = u32(buf, cursor + 42);
    var name = buf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x01) return { ok: false, error: '不支持加密 zip' };
    if (flags & 0x08) return { ok: false, error: '不支持 data descriptor zip' };
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      return { ok: false, error: '不支持 zip64' };
    }
    if (name.slice(-1) === '/') continue;

    if (u32(buf, localOff) !== 0x04034b50) {
      return { ok: false, error: 'zip 本地头损坏: ' + name };
    }
    var localNameLen = u16(buf, localOff + 26);
    var localExtraLen = u16(buf, localOff + 28);
    var dataOff = localOff + 30 + localNameLen + localExtraLen;
    var data = buf.slice(dataOff, dataOff + compSize);
    var out;
    try {
      if (method === 0) {
        out = Buffer.from(data);
      } else if (method === 8) {
        out = zlib.inflateRawSync(data);
      } else {
        return { ok: false, error: '不支持的压缩方式: ' + method };
      }
    } catch (err) {
      return { ok: false, error: '解压失败: ' + name };
    }
    if (uncompSize && out.length !== uncompSize) {
      return { ok: false, error: '解压大小不匹配: ' + name };
    }
    totalUncomp += out.length;
    if (totalUncomp > MAX_UNCOMPRESSED) {
      return { ok: false, error: '解压后超过 40MB 上限' };
    }
    files[name.replace(/\\/g, '/')] = out;
  }
  return { ok: true, files: files };
}

module.exports = {
  unzip: unzip,
  MAX_ZIP_BYTES: MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED: MAX_UNCOMPRESSED,
  MAX_FILES: MAX_FILES,
};
