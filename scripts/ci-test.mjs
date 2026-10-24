#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  formatReleaseNotes,
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
const pluginRegistry = require('../runtime/lib/plugin-registry.js');

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

  const releaseNotes = formatReleaseNotes({
    version: '1.2.0',
    channel: 'release',
    previousTag: 'v1.1.0',
    currentRef: 'v1.2.0',
    subjects: ['feat: 自动生成的功能'],
    customNotes: '## 本版本特别说明\n\n请先备份配置。',
  });
  assert(releaseNotes.includes('## 本版本特别说明'), '发版说明应包含自定义 Markdown');
  assert(
    releaseNotes.indexOf('请先备份配置。') < releaseNotes.indexOf('## 新功能'),
    '自定义内容应位于自动变更之前',
  );
  assert(
    releaseNotes.includes(
      '[v1.1.0...v1.2.0](https://github.com/BetterSomething/BetterHeyboxChat/compare/v1.1.0...v1.2.0)',
    ),
    '完整变更应生成 GitHub Compare 链接',
  );

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
  const parts = selfUpdate.splitRanges(8 * 1024 * 1024, 4);
  assert(parts.length === 4, '8MB 应拆成 4 段');
  assert(parts[0].start === 0 && parts[3].end === 8 * 1024 * 1024 - 1, '分段应覆盖全文件');
  assert(
    parts.every((part, i) => i === 0 || part.start === parts[i - 1].end + 1),
    '分段应首尾相接',
  );
  assert(selfUpdate.splitRanges(100, 4).length === 1, '过小文件不应拆段');
}

async function testMapLimit() {
  const seen = [];
  const result = await pluginRegistry.mapLimit([1, 2, 3, 4, 5], 2, function (n) {
    seen.push(n);
    return Promise.resolve(n * 10);
  });
  assert(result.join(',') === '10,20,30,40,50', 'mapLimit 应保序');
  assert(seen.length === 5, 'mapLimit 应跑完全部');
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

async function testClientCompat() {
  if (!fs.existsSync(patchJs)) {
    throw new Error('缺少 packages/loader/dist/patch.js，请先 pnpm build');
  }
  const { assertClientSupported } = await import(pathToFileURL(patchJs).href);
  for (const version of ['1.56.0', '1.57.1', '1.58.2', '1.60.0']) {
    assertClientSupported(version);
  }
  for (const version of ['1.55.9', '1.60.1', '1.99.0']) {
    let rejected = false;
    try {
      assertClientSupported(version);
    } catch (err) {
      rejected = String(err && err.message).includes('支持范围：1.56.0~1.60.0');
    }
    assert(rejected, `应拒绝 ${version}，并提示支持范围 1.56.0~1.60.0`);
  }
}

function testMarketplaceLayout() {
  const source = fs.readFileSync(path.join(root, 'runtime/plugins/marketplace/index.js'), 'utf8');
  assert(source.includes("activeTab: 'catalog'"), '插件市场应默认显示在线插件标签');
  assert(source.includes("tab === 'installed'"), '插件市场应支持已安装标签');
  assert(source.includes('调试用，请勿乱填'), '本地调试区应显示风险提示');
  assert(source.includes("this.activeTab === 'installed'"), '已安装内容应按标签单独渲染');
  assert(source.includes('本地安装'), '已安装页应保留本地安装区');
  assert(source.includes('localDebugExpanded'), '本地调试区应有独立折叠状态');
}

const steps = [
  ['versioning', testVersioning],
  ['self-update-compare', testSelfUpdateCompare],
  ['map-limit', testMapLimit],
  ['cli-help', testCliHelp],
  ['reinstall', testReinstall],
  ['client-compat', testClientCompat],
  ['marketplace-layout', testMarketplaceLayout],
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
