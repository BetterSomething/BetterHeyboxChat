/**
 * 构建时版本解析与 Conventional Commits 发版说明。
 */
import {
  formatReleaseNotes,
  installerArtifactName,
  isSemver,
  pickReleaseTag,
  previousReleaseTag,
  renderVersionJs,
  resolveBuild,
  stripV,
} from './lib/versioning.mjs';

function assert(cond, message) {
  if (!cond) throw new Error('FAIL: ' + message);
}

assert(isSemver('0.1.0') === true, '0.1.0 应是 semver');
assert(isSemver('v0.1.0') === false, '带 v 前缀不应直接当 semver');
assert(isSemver('c357f16') === false, '短 SHA 不是 semver');
assert(stripV('v0.2.0') === '0.2.0', 'stripV 应去掉 v');
assert(stripV('0.2.0') === '0.2.0', 'stripV 对无前缀应原样返回');

const fromEnv = resolveBuild({
  bhcVersion: '0.2.0',
  exactTag: null,
  shortSha: 'c357f16',
});
assert(fromEnv.version === '0.2.0', 'BHC_VERSION 应覆盖为正式版号');
assert(fromEnv.channel === 'release', '有 BHC_VERSION 时 channel=release');
assert(fromEnv.commit === 'c357f16', '正式版仍应记下 commit');

const fromEnvWithV = resolveBuild({
  bhcVersion: 'v0.2.0',
  exactTag: null,
  shortSha: 'c357f16',
});
assert(fromEnvWithV.version === '0.2.0', 'BHC_VERSION=v0.2.0 应去掉 v');

const fromTag = resolveBuild({
  bhcVersion: '',
  exactTag: 'v0.1.0',
  shortSha: 'aaa1111',
});
assert(fromTag.version === '0.1.0' && fromTag.channel === 'release', 'HEAD 正好是 vX.Y.Z 时为正式版');

const fromSha = resolveBuild({
  bhcVersion: '',
  exactTag: null,
  shortSha: 'c357f16',
});
assert(fromSha.version === 'c357f16', '无 tag 时版本应为短 SHA');
assert(fromSha.channel === 'dev', '无 tag 时 channel=dev');

const noGit = resolveBuild({
  bhcVersion: '',
  exactTag: null,
  shortSha: '',
});
assert(noGit.version === 'dev' && noGit.channel === 'dev', '没有 git 时应回退 dev');

assert(
  installerArtifactName('0.1.0') === 'bhchat-installer-0.1.0.exe',
  '正式版安装器文件名',
);
assert(
  installerArtifactName('c357f16') === 'bhchat-installer-c357f16.exe',
  'dev 安装器文件名',
);

assert(pickReleaseTag(['dev', 'v0.1.0']) === 'v0.1.0', 'HEAD 同时有 dev 与正式 tag 时应选正式 tag');
assert(pickReleaseTag(['dev']) === '', '只有 dev tag 时不算正式版');

assert(previousReleaseTag(['v0.2.0', 'v0.1.0', 'dev'], 'v0.2.0') === 'v0.1.0', '应取上一正式 tag');
assert(previousReleaseTag(['v0.1.0'], 'v0.1.0') === null, '首个正式版没有上一 tag');
assert(previousReleaseTag(['v0.1.0', 'dev'], null) === 'v0.1.0', 'dev 构建的上一正式版是最新 v*');

const notes = formatReleaseNotes({
  version: '0.2.0',
  channel: 'release',
  previousTag: 'v0.1.0',
  currentRef: 'v0.2.0',
  subjects: [
    'feat(channel-tts): 朗读当前频道的聊天',
    'feat(custom-room-bg): 增加仅自己可见的房间背景',
    'docs: 登记公开货架插件',
    'Merge branch \'main\' of origin',
    'fix(indicator): 角标回退文案',
  ],
});
assert(notes.includes('## 新功能'), '应有新功能分组');
assert(notes.includes('- feat(channel-tts): 朗读当前频道的聊天'), '应保留完整 conventional subject');
assert(notes.includes('- feat(custom-room-bg): 增加仅自己可见的房间背景'), '应列出全部 feat');
assert(notes.includes('## 文档'), 'docs 应单独分组');
assert(notes.includes('- docs: 登记公开货架插件'), '应列出 docs');
assert(notes.includes('## 修复'), 'fix 应单独分组');
assert(!notes.includes('Merge branch'), '应丢掉 merge commit');
assert(notes.includes('v0.1.0...v0.2.0'), '应带上比较范围');

const js = renderVersionJs({ version: 'c357f16', channel: 'dev', commit: 'c357f16' });
assert(js.includes('c357f16'), '生成的 version.js 应含版本号');
assert(js.includes('var BHC_BUILD'), '生成的 version.js 应声明 BHC_BUILD');

console.log('OK: versioning resolve / notes / artifact name');
