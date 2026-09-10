#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  formatUpdateNotes,
  installerArtifactName,
  isSemver,
  pickReleaseTag,
  renderUpdateJson,
  resolveBuild,
  stripV,
} from './lib/versioning.mjs';

const require = createRequire(import.meta.url);
const selfUpdate = require('../runtime/lib/self-update.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patchJs = path.join(root, 'packages/loader/dist/patch.js');
const cliJs = path.join(root, 'packages/loader/dist/cli.js');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function testVersioning() {
  assert(isSemver('0.2.0'), '0.2.0 应是 semver');
  assert(!isSemver('dev'), 'dev 不是 semver');
  assert(stripV('v1.2.3') === '1.2.3', 'stripV 应去掉 v');
  assert(installerArtifactName('0.2.0') === 'bhchat-installer-0.2.0.exe', 'artifact 名');

  const release = resolveBuild({ bhcVersion: '0.2.0', exactTag: '', shortSha: 'abc1234' });
  assert(release.version === '0.2.0' && release.channel === 'release', 'BHC_VERSION 应走正式版');

  const tagged = resolveBuild({ bhcVersion: '', exactTag: 'v0.3.0', shortSha: 'abc1234' });
  assert(tagged.version === '0.3.0' && tagged.channel === 'release', 'tag 应走正式版');

  const dev = resolveBuild({ bhcVersion: '', exactTag: '', shortSha: 'c73b142' });
  assert(dev.version === 'c73b142' && dev.channel === 'dev', '短 SHA 应走开发版');

  assert(pickReleaseTag(['v0.1.0', 'v0.2.0', 'dev']) === 'v0.2.0', '应取最大 semver tag');

  const notes = formatUpdateNotes([
    'docs: skip',
    'feat(runtime): 兼容 1.57.0',
    'fix(installer): 自动提权',
    'perf: 降内存',
    'feat: 第二项',
    'feat: 第三项',
    'feat: 第四项',
    'chore: ignore',
    'feat: 第五项多余',
  ]);
  assert(notes.includes('兼容 1.57.0'), '摘要应去掉 feat 前缀');
  assert(notes.includes('第五项多余'), 'feat 优先占满 5 条');
  assert(notes.includes('另有 2 条，见完整说明'), 'fix/perf 超出应计入其余');
  assert(!notes.includes('feat('), '摘要不应保留 conventional 前缀');

  const manifest = JSON.parse(renderUpdateJson({
    build: { version: '1.1.0', channel: 'release', commit: 'abc1234' },
    sha256: 'SHA256:ABCD',
    notes: 'hello',
    publishedAt: '2026-09-10T00:00:00Z',
  }));
  assert(manifest.tag === 'v1.1.0' && manifest.artifact === 'bhchat-installer-1.1.0.exe', '正式版清单');
  assert(manifest.sha256 === 'abcd', 'sha256 应小写并去掉前缀');
}

function testSelfUpdateCompare() {
  assert(
    selfUpdate.hasUpdate({ channel: 'release', version: '1.0.0' }, { version: '1.1.0' }),
    '正式版应识别更新',
  );
  assert(
    !selfUpdate.hasUpdate({ channel: 'release', version: '1.1.0' }, { version: '1.0.0' }),
    '正式版不应降级',
  );
  assert(
    selfUpdate.hasUpdate({ channel: 'release', version: 'a4c21a4' }, { version: '1.0.0' }),
    '本机非正式 semver 应当成需要更新',
  );
  assert(
    !selfUpdate.hasUpdate(
      { channel: 'dev', version: 'a4c21a4' },
      { version: 'a4c21a41d3affce' },
    ),
    '开发版短 SHA 前缀相同则已最新',
  );
  assert(
    selfUpdate.hasUpdate({ channel: 'dev', version: 'a4c21a4' }, { version: '085340d' }),
    '开发版 SHA 不同则有更新',
  );
  assert(
    selfUpdate.isIgnored({ channel: 'dev', version: '085340d' }, { channel: 'dev', version: '085340d' }),
    '忽略应匹配通道+版本',
  );
  const parsed = selfUpdate.parseManifest({
    version: '1.1.0',
    channel: 'release',
    artifact: 'bhchat-installer-1.1.0.exe',
    sha256: 'SHA256:ABCD',
  });
  assert(parsed.ok && parsed.manifest.sha256 === 'abcd', '清单应洗白 sha256');
  assert(
    selfUpdate.resolveInstallRoot('D:/x/1.57.0/resources/versions/1.57.0/app').replace(/\\/g, '/')
      === 'D:/x',
    '安装根应从 app 上推到黑盒安装根',
  );
}

function testCliHelp() {
  if (!fs.existsSync(cliJs)) {
    throw new Error('缺少 packages/loader/dist/cli.js，请先 pnpm build');
  }
  const result = spawnSync(process.execPath, [cliJs, '--help'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(result.status === 0, `--help 退出码应为 0，实际 ${result.status}`);
  const text = `${result.stdout}\n${result.stderr}`;
  assert(/\breinstall\b/.test(text), 'CLI 帮助应列出 reinstall');
}

async function testReinstall() {
  if (!fs.existsSync(patchJs)) {
    throw new Error('缺少 packages/loader/dist/patch.js，请先 pnpm build');
  }
  const { installPatches, reinstallPatches, uninstallPatches, readPatchState } = await import(
    pathToFileURL(patchJs).href
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-ci-'));
  try {
    const appDir = path.join(tmp, '1.56.0', 'resources', 'versions', '1.56.0', 'app');
    fs.mkdirSync(path.join(appDir, 'source', 'preload'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'webapp'), { recursive: true });
    fs.writeFileSync(path.join(appDir, 'source/preload/index.js'), 'console.log("preload");\n');
    fs.writeFileSync(path.join(appDir, 'webapp/index.html'), '<html><head></head><body></body></html>\n');
    fs.writeFileSync(path.join(appDir, 'index.js'), 'console.log("main");\n');
    fs.writeFileSync(path.join(appDir, 'env.js'), "module.exports = { ELECTRON_ENV: 'prod' };\n");

    const install = {
      installRoot: tmp,
      version: '1.56.0',
      versionDir: path.join(tmp, '1.56.0'),
      appDir,
      packageName: 'heybox-chat-electron',
    };

    await installPatches(install);
    assert(readPatchState(appDir).installed, '首次安装后应为已安装');
    const loaderAfterInstall = fs.readFileSync(path.join(appDir, 'betterheyboxchat/loader.js'), 'utf8');

    fs.writeFileSync(path.join(appDir, 'betterheyboxchat/loader.js'), '// stale\n');
    await reinstallPatches(install);
    assert(readPatchState(appDir).installed, '重装后应仍为已安装');
    const loaderAfterReinstall = fs.readFileSync(path.join(appDir, 'betterheyboxchat/loader.js'), 'utf8');
    assert(loaderAfterReinstall === loaderAfterInstall, '重装应覆盖运行时文件');
    assert(!loaderAfterReinstall.includes('stale'), '重装不应留下旧 runtime');

    await uninstallPatches(appDir);
    assert(!readPatchState(appDir).installed, '卸载后应为未安装');
    assert(!fs.existsSync(path.join(appDir, 'betterheyboxchat')), '卸载应删除 runtime 目录');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const steps = [
  ['versioning', testVersioning],
  ['self-update-compare', testSelfUpdateCompare],
  ['cli-help', testCliHelp],
  ['reinstall', testReinstall],
];

let failed = 0;
for (const [name, fn] of steps) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`fail ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('CI checks passed');
}
