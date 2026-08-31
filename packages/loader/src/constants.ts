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

export const SUPPORTED_CLIENT_VERSIONS = ['1.56.0'];

/** Program Files 常见路径。官方默认目录 `%LOCALAPPDATA%\\Qingfeng\\HeyboxChat` 由 `defaultInstallFallbacks` 动态补上。 */
export const DEFAULT_INSTALL_CANDIDATES = [
  'C:\\Program Files\\Qingfeng\\HeyboxChat',
  'C:\\Program Files (x86)\\Qingfeng\\HeyboxChat',
  'D:\\Program Files\\Qingfeng\\HeyboxChat',
];

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
