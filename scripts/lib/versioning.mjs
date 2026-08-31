const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_TAG = /^v(\d+\.\d+\.\d+)$/;

const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'ci', 'chore', 'style', 'other'];
const SECTION_TITLES = {
  feat: '新功能',
  fix: '修复',
  perf: '性能',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  ci: 'CI',
  chore: '杂项',
  style: '格式',
  other: '其他',
};

export function isSemver(value) {
  return SEMVER.test(String(value || ''));
}

export function stripV(value) {
  const text = String(value || '').trim();
  return text.startsWith('v') ? text.slice(1) : text;
}

export function resolveBuild({ bhcVersion, exactTag, shortSha }) {
  const commit = String(shortSha || '').trim() || 'unknown';
  const forced = String(bhcVersion || '').trim();
  if (forced) {
    const version = stripV(forced);
    if (!isSemver(version)) {
      throw new Error('BHC_VERSION 必须是 semver（例如 0.2.0）');
    }
    return { version, channel: 'release', commit: commit === 'unknown' ? version : commit };
  }

  const tag = String(exactTag || '').trim();
  const tagged = tag.match(SEMVER_TAG);
  if (tagged) {
    return { version: tagged[1], channel: 'release', commit };
  }

  if (commit !== 'unknown') {
    return { version: commit, channel: 'dev', commit };
  }

  return { version: 'dev', channel: 'dev', commit: 'unknown' };
}

export function installerArtifactName(version) {
  return `bhchat-installer-${version}.exe`;
}

export function pickReleaseTag(tags) {
  const found = (tags || [])
    .map((tag) => String(tag || '').trim())
    .filter((tag) => SEMVER_TAG.test(tag))
    .sort(compareSemverTag);
  return found.length ? found[found.length - 1] : '';
}

export function previousReleaseTag(tags, currentTag) {
  const semverTags = (tags || [])
    .map((tag) => String(tag || '').trim())
    .filter((tag) => SEMVER_TAG.test(tag))
    .sort(compareSemverTag)
    .reverse();

  if (!currentTag) {
    return semverTags[0] || null;
  }

  const current = String(currentTag).trim();
  const older = semverTags.filter((tag) => tag !== current);
  return older[0] || null;
}

function compareSemverTag(a, b) {
  const pa = stripV(a).split('.').map(Number);
  const pb = stripV(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function parseCommitSubject(line) {
  const subject = String(line || '').trim();
  if (!subject) return null;
  if (/^merge\b/i.test(subject)) return null;
  const matched = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.*)$/);
  if (!matched) {
    return { type: 'other', scope: '', subject, raw: subject };
  }
  const type = SECTION_TITLES[matched[1]] ? matched[1] : 'other';
  return { type, scope: matched[2] || '', subject: matched[3], raw: subject };
}

export function formatReleaseNotes({ version, channel, previousTag, currentRef, subjects }) {
  const groups = new Map();
  for (const line of subjects || []) {
    const parsed = parseCommitSubject(line);
    if (!parsed) continue;
    const list = groups.get(parsed.type) || [];
    list.push(parsed.raw);
    groups.set(parsed.type, list);
  }

  const heading =
    channel === 'release'
      ? `BetterHeyboxChat ${version}`
      : `BetterHeyboxChat 开发版 \`${version}\``;

  const lines = [heading, ''];
  for (const type of SECTION_ORDER) {
    const items = groups.get(type);
    if (!items || items.length === 0) continue;
    lines.push(`## ${SECTION_TITLES[type]}`, '');
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  const current = currentRef || (channel === 'release' ? `v${version}` : version);
  if (previousTag && current) {
    lines.push(`**完整变更:** \`${previousTag}...${current}\``, '');
  } else if (!previousTag && channel === 'release') {
    lines.push('首次正式版。', '');
  }

  return lines.join('\n').trim() + '\n';
}

export function renderVersionJs(build) {
  const json = JSON.stringify({
    version: build.version,
    channel: build.channel,
    commit: build.commit,
  });
  return `var BHC_BUILD = ${json};\nif (typeof module !== 'undefined' && module.exports) module.exports = BHC_BUILD;\n`;
}

export function renderVersionJson(build) {
  return JSON.stringify(
    {
      version: build.version,
      channel: build.channel,
      commit: build.commit,
    },
    null,
    2,
  ) + '\n';
}
