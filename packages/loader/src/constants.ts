import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_BUILD = { version: 'dev', channel: 'dev', commit: 'unknown' };

function loadBuild(): { version: string; channel: string; commit: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../runtime/version.json'),
    path.resolve(here, '../../runtime/version.json'),
    path.resolve(here, '../../../runtime/version.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        version?: string;
        channel?: string;
        commit?: string;
      };
      if (parsed && parsed.version) {
        return {
          version: parsed.version,
          channel: parsed.channel || 'dev',
          commit: parsed.commit || 'unknown',
        };
      }
    } catch {
      /* 试下一个 */
    }
  }
  return FALLBACK_BUILD;
}

const build = loadBuild();

export const LOADER_VERSION = build.version;
export const LOADER_CHANNEL = build.channel;
export const LOADER_COMMIT = build.commit;

export const MARKER_BEGIN = '// BetterHeyboxChat:begin';
export const MARKER_END = '// BetterHeyboxChat:end';

export const HTML_MARKER = '<!-- BetterHeyboxChat:begin -->';

export const PRELOAD_SNIPPET = `
${MARKER_BEGIN}
try { require('../../betterheyboxchat/preload-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] preload bridge failed:', e); }
${MARKER_END}
`.trim();

export const HTML_SNIPPET =
  `${HTML_MARKER}<script src="../betterheyboxchat/webpack-hook.js"></script><script src="../betterheyboxchat/loader.js"></script>`;

export const INDEX_SNIPPET = `
${MARKER_BEGIN}
try { require('./betterheyboxchat/main-bridge.js'); } catch (e) { console.error('[BetterHeyboxChat] main bridge failed:', e); }
${MARKER_END}
`.trim();

/**
 * 黑盒客户端最低支持版本（含）。只有下限，不设上限：
 * 官方更新后只要探测出的版本不低于此值就允许安装，由运行时做能力探测降级。
 * 文档和报错都用这一串，不要再逐个列版本。
 */
export const MIN_SUPPORTED_CLIENT_VERSION = '1.56.0';

function parseClientVersion(version: string): number[] | null {
  const text = String(version || '').trim();
  if (!text) return null;
  const parts = text.split('.');
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  return nums.length ? nums : null;
}

function compareClientVersionParts(left: number[], right: number[]): number {
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

export function isSupportedClientVersion(version: string): boolean {
  const current = parseClientVersion(version);
  const min = parseClientVersion(MIN_SUPPORTED_CLIENT_VERSION);
  if (!current || !min) return false;
  return compareClientVersionParts(current, min) >= 0;
}

export const PROGRAM_FILES_FOLDERS = ['Program Files', 'Program Files (x86)'];

export const REGISTRY_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

export const REGISTRY_APP_PATH_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\HeyboxChat.exe',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\HeyboxChat.exe',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\HeyboxChat.exe',
];

export const HEYBOX_DISPLAY_NAME_HINTS = ['heybox', '黑盒语音', '黑盒', 'heybox chat'];
