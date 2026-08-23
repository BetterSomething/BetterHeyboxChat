export const LOADER_VERSION = '0.1.0';

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

export const HEYBOX_DISPLAY_NAME_HINTS = ['heybox', '黑盒语音', '黑盒', 'heybox chat'];
