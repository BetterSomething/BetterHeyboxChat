import assert from 'node:assert/strict';
import {
  collectCandidateRoots,
  stripIconIndex,
} from '../dist/detect.js';

assert.equal(
  stripIconIndex(String.raw`D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe`),
  String.raw`D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe`,
);
assert.equal(
  stripIconIndex(String.raw`"D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe",0`),
  String.raw`D:\Program Files\Qingfeng\HeyboxChat\HeyboxChat.exe`,
);

const roots = collectCandidateRoots({
  registryRoots: [String.raw`D:\Program Files\Qingfeng\HeyboxChat`],
  fallbacks: [
    String.raw`C:\Program Files\Qingfeng\HeyboxChat`,
    String.raw`D:\Program Files\Qingfeng\HeyboxChat`,
  ],
});
assert.equal(roots[0], String.raw`D:\Program Files\Qingfeng\HeyboxChat`);
assert.equal(roots.length, 2, '注册表路径与硬编码路径去重后应只保留一份 D 盘');

const manual = collectCandidateRoots({
  manualRoot: String.raw`E:\Games\HeyboxChat`,
  registryRoots: [String.raw`D:\Program Files\Qingfeng\HeyboxChat`],
  fallbacks: [String.raw`C:\Program Files\Qingfeng\HeyboxChat`],
});
assert.deepEqual(manual, [String.raw`E:\Games\HeyboxChat`]);

console.log('OK: detect registry-first + DisplayIcon parse');
