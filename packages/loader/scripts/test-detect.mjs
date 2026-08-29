import assert from 'node:assert/strict';
import path from 'node:path';
import {
  collectCandidateRoots,
  defaultInstallFallbacks,
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

const fallbacks = defaultInstallFallbacks();
const localBase =
  process.env.LOCALAPPDATA ||
  (process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, 'AppData', 'Local')
    : '');
if (localBase) {
  assert.equal(
    fallbacks[0],
    path.join(localBase, 'Qingfeng', 'HeyboxChat'),
    '官方默认目录应排在 fallback 首位: %LOCALAPPDATA%\\Qingfeng\\HeyboxChat',
  );
}
assert.ok(
  fallbacks.includes(String.raw`C:\Program Files\Qingfeng\HeyboxChat`),
  '仍应保留 Program Files 候选',
);

console.log('OK: detect registry-first + DisplayIcon parse');
